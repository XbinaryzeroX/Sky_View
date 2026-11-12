#!/usr/bin/env node
// Converts the models downloaded by scripts/fetch-models.mjs into the app's model pack.
//
//   node scripts/import-models.mjs [--only a320,b737]
//
// For each model: strip animations/cameras/lights, bake node transforms, rotate into glTF axes
// (+Z forward, +Y up), scale to the real length, put the origin at the lowest point (aircraft) or
// the waterline (ships), merge and simplify the geometry (~30k triangles), shrink textures to
// ≤1024 px, then write public/vehicle-models/<id>.glb and index.json (copied into the app build).
// A preview (side, top and front silhouettes) of every model is written to
// %USERPROFILE%\.atlas-watch\models\preview\ so orientation can be checked before shipping.
// Downloaded files are parsed as data only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, normals, prune, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { detectForward, detectUp, extents, normaliseMatrix, orientationDecision, triangleList, waterlineAboveBottom } from './vehicle-models/orient.mjs';
import { readConfined } from './vehicle-models/safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
// ATLAS_MODELS_SHORTLIST: an alternative shortlist file (used to test the importer).
const shortlist = JSON.parse(fs.readFileSync(process.env.ATLAS_MODELS_SHORTLIST || path.join(here, 'vehicle-models', 'shortlist.json'), 'utf8'));
// ATLAS_MODELS_HOME / ATLAS_MODELS_OUT: alternative folders (used to test the importer on sample files).
const home = process.env.ATLAS_MODELS_HOME || path.join(os.homedir(), '.atlas-watch', 'models');
const rawRoot = path.join(home, 'raw');
const previewDir = path.join(home, 'preview');
const outDir = process.env.ATLAS_MODELS_OUT || path.join(repo, 'public', 'vehicle-models');
const TARGET_TRIS = 30000;
// Bump when the conversion changes, so earlier output is re-imported rather than kept.
const IMPORTER_VERSION = 3;
// Extensions Cesium can render; a model that requires anything else is skipped.
const RENDERABLE = new Set(['KHR_texture_transform', 'KHR_materials_unlit', 'KHR_mesh_quantization', 'KHR_materials_pbrSpecularGlossiness', 'EXT_texture_webp']);

const args = process.argv.slice(2);
const only = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();

// ------------------------------------------------------------------ matrices (column-major 4×4)

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
  return r;
}
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
/** Inverse-transpose of the upper 3×3 (for normals), as a 9-element column-major array. */
function normalMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  const det = a * A + b * B + c * C;
  // inverse = adj / det; transpose of inverse = cofactor matrix / det
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

// ------------------------------------------------------------------ baking

function readVec(acc, i, out) {
  acc.getElement(i, out);
  return out;
}

function transformed(doc, buffer, acc, fn, size) {
  const n = acc.getCount();
  const arr = new Float32Array(n * size);
  const tmp = new Array(acc.getElementSize()).fill(0);
  for (let i = 0; i < n; i++) {
    const v = fn(readVec(acc, i, tmp));
    for (let k = 0; k < size; k++) {
      // Downloaded data is untrusted: non-numeric vertex values would make an invalid model.
      if (!Number.isFinite(v[k])) throw new Error('model contains non-numeric vertex data');
      arr[i * size + k] = v[k];
    }
  }
  return doc.createAccessor().setType(size === 4 ? 'VEC4' : 'VEC3').setArray(arr).setBuffer(buffer);
}

/**
 * A copy of `prim` as an indexed triangle list with positions/normals/tangents multiplied by `m`
 * (new accessors; other attributes shared). Triangle strips and fans are converted; points and lines
 * (not surfaces) return null and are counted in `stats.dropped`.
 */
function bakePrimitive(doc, buffer, prim, m, stats) {
  const pos = prim.getAttribute('POSITION');
  if (!pos) return null;
  const srcIdx = prim.getIndices();
  const tri = triangleList(prim.getMode(), srcIdx ? (k) => srcIdx.getScalar(k) : (k) => k, srcIdx ? srcIdx.getCount() : pos.getCount());
  if (!tri) {
    stats.dropped++;
    return null;
  }
  if (!tri.length) return null; // only degenerate triangles
  if (prim.getMode() !== Primitive.Mode.TRIANGLES) stats.converted++;
  const out = prim.clone();
  for (const t of out.listTargets()) out.removeTarget(t);
  out.setMode(Primitive.Mode.TRIANGLES).setIndices(doc.createAccessor().setType('SCALAR').setArray(tri).setBuffer(buffer));
  out.setAttribute('POSITION', transformed(doc, buffer, pos, (p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ], 3));
  const flip = det3(m) < 0;
  const nrm = prim.getAttribute('NORMAL');
  if (nrm) {
    const nm = normalMatrix(m);
    out.setAttribute('NORMAL', transformed(doc, buffer, nrm, (v) => {
      const x = nm[0] * v[0] + nm[3] * v[1] + nm[6] * v[2], y = nm[1] * v[0] + nm[4] * v[1] + nm[7] * v[2], z = nm[2] * v[0] + nm[5] * v[1] + nm[8] * v[2];
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    }, 3));
  }
  const tan = prim.getAttribute('TANGENT');
  if (tan) {
    out.setAttribute('TANGENT', transformed(doc, buffer, tan, (v) => {
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l, (v[3] ?? 1) * (flip ? -1 : 1)];
    }, 4));
  }
  if (flip)
    // A mirroring transform reverses the winding: swap two corners of every triangle (the list is our own copy).
    for (let t = 0; t + 2 < tri.length; t += 3) [tri[t + 1], tri[t + 2]] = [tri[t + 2], tri[t + 1]];
  return out;
}

/**
 * Replaces the scene with one root node holding every mesh with its world transform (and `extra`)
 * baked into the vertices. Unreferenced old data is removed by prune() later.
 */
function bakeScene(doc, extra, drop, stats = { dropped: 0, converted: 0, collapsed: 0 }) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('no scene');
  const holders = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    if (drop) {
      if (drop.test(mesh.getName())) return;
      for (let ancestor = node; ancestor; ancestor = ancestor.getParentNode()) {
        if (drop.test(ancestor.getName())) return;
      }
    }
    const m = mul(extra, node.getWorldMatrix());
    // A part scaled to nothing (exporters hide parts this way) has no surface and no valid normals: skip it.
    const det = det3(m);
    if (!m.every(Number.isFinite) || !Number.isFinite(det) || det === 0 || !normalMatrix(m).every(Number.isFinite)) {
      stats.collapsed++;
      return;
    }
    holders.push({ mesh, m });
  });
  const vehicle = doc.createNode('vehicle');
  for (const { mesh, m } of holders) {
    const baked = doc.createMesh(mesh.getName());
    for (const p of mesh.listPrimitives()) {
      const b = bakePrimitive(doc, buffer, p, m, stats);
      if (b) baked.addPrimitive(b);
    }
    if (baked.listPrimitives().length) vehicle.addChild(doc.createNode(mesh.getName()).setMesh(baked));
  }
  for (const s of root.listScenes()) s.dispose();
  for (const n of root.listNodes()) if (n !== vehicle && !vehicle.listChildren().includes(n)) n.dispose();
  const fresh = doc.createScene('vehicle').addChild(vehicle);
  root.setDefaultScene(fresh);
}

/** Last check before publishing: every position, normal and tangent value is a finite number. */
function assertFiniteVertices(doc) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives())
      for (const name of ['POSITION', 'NORMAL', 'TANGENT']) {
        const a = p.getAttribute(name);
        if (a && !a.getArray().every(Number.isFinite)) throw new Error(`model has non-numeric ${name.toLowerCase()} data after conversion`);
      }
}

/** Positions (flat xyz) of every vertex the baked scene's triangles use. */
function allPoints(doc) {
  const chunks = [];
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION');
      if (!a || !mesh.listParents().some((x) => x.propertyType === 'Node')) continue;
      const arr = a.getArray();
      const idx = p.getIndices();
      if (!idx) {
        chunks.push(arr);
        total += arr.length;
        continue;
      }
      // Only vertices that triangles use: a stray unused vertex must not move the bounds, origin or waterline.
      const used = new Uint8Array(a.getCount());
      for (const i of idx.getArray()) used[i] = 1;
      let count = 0;
      for (const u of used) count += u;
      const pts = new Float32Array(count * 3);
      let o = 0;
      for (let i = 0; i < used.length; i++)
        if (used[i]) {
          pts[o++] = arr[i * 3];
          pts[o++] = arr[i * 3 + 1];
          pts[o++] = arr[i * 3 + 2];
        }
      chunks.push(pts);
      total += pts.length;
    }
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function triangleCount(doc) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      t += Math.floor((idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3);
    }
  return t;
}

// ------------------------------------------------------------------ textures

async function shrinkTextures(doc) {
  const textures = doc.getRoot().listTextures();
  const maxSize = textures.length > 6 ? 512 : 1024;
  for (const tex of textures) {
    const img = tex.getImage();
    if (!img) continue;
    let pipeline;
    try {
      pipeline = sharp(Buffer.from(img), { failOn: 'error' });
      const meta = await pipeline.metadata();
      const stats = await sharp(Buffer.from(img)).stats();
      const keepAlpha = meta.hasAlpha && !stats.isOpaque;
      const resized = sharp(Buffer.from(img)).resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
      const out = keepAlpha ? await resized.png({ compressionLevel: 9 }).toBuffer() : await resized.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      tex.setImage(new Uint8Array(out)).setMimeType(keepAlpha ? 'image/png' : 'image/jpeg');
      const uri = tex.getURI();
      if (uri) tex.setURI(uri.replace(/\.[a-z0-9]+$/i, keepAlpha ? '.png' : '.jpg'));
    } catch (e) {
      throw new Error(`texture ${tex.getName() || tex.getURI() || '?'} could not be converted: ${e?.message ?? e}`);
    }
  }
}

// ------------------------------------------------------------------ preview (software silhouettes)

async function writePreview(doc, file, title) {
  const W = 360, H = 260, PAD = 14;
  const views = [
    { name: 'side (nose →)', u: (p) => p[2], v: (p) => p[1], d: (p) => p[0] },
    { name: 'top (nose →, left ↑)', u: (p) => p[2], v: (p) => p[0], d: (p) => p[1] },
    { name: 'front', u: (p) => -p[0], v: (p) => p[1], d: (p) => p[2] },
  ];
  const pts = allPoints(doc);
  const { min, max } = extents(pts);
  const img = Buffer.alloc(W * 3 * H * 3, 0);
  const width = W * 3;
  for (let i = 0; i < img.length; i += 3) {
    img[i] = 24;
    img[i + 1] = 28;
    img[i + 2] = 34;
  }
  views.forEach((view, vi) => {
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const c of [[min[0], max[0]], [min[1], max[1]], [min[2], max[2]]].reduce((acc, [a, b], k) => acc.flatMap((p) => [[...p.slice(0, k), a], [...p.slice(0, k), b]]), [[]])) {
      const uu = view.u(c), vv = view.v(c);
      lo[0] = Math.min(lo[0], uu); hi[0] = Math.max(hi[0], uu); lo[1] = Math.min(lo[1], vv); hi[1] = Math.max(hi[1], vv);
    }
    const s = Math.min((W - 2 * PAD) / (hi[0] - lo[0] || 1), (H - 2 * PAD) / (hi[1] - lo[1] || 1));
    const zbuf = new Float32Array(W * H).fill(-Infinity);
    const sx = (p) => PAD + (view.u(p) - lo[0]) * s;
    const sy = (p) => H - PAD - (view.v(p) - lo[1]) * s;
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        const col = prim.getMaterial()?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1];
        const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
        for (let t = 0; t + 2 < n; t += 3) {
          pos.getElement(idx ? idx.getScalar(t) : t, a);
          pos.getElement(idx ? idx.getScalar(t + 1) : t + 1, b);
          pos.getElement(idx ? idx.getScalar(t + 2) : t + 2, c);
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
          const nl = Math.hypot(nx, ny, nz) || 1;
          const shade = 0.35 + 0.65 * Math.abs((nx * 0.4 + ny * 0.8 + nz * 0.45) / nl);
          const P = [[sx(a), sy(a), view.d(a)], [sx(b), sy(b), view.d(b)], [sx(c), sy(c), view.d(c)]];
          const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
          const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
          const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
          if (Math.abs(area) < 1e-9) continue;
          for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
              const px = x + 0.5, py = y + 0.5;
              const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
              const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
              const w2 = 1 - w0 - w1;
              if (w0 < 0 || w1 < 0 || w2 < 0) continue;
              const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
              if (z <= zbuf[y * W + x]) continue;
              zbuf[y * W + x] = z;
              const o = (y * width + vi * W + x) * 3;
              img[o] = Math.min(255, 255 * col[0] * shade);
              img[o + 1] = Math.min(255, 255 * col[1] * shade);
              img[o + 2] = Math.min(255, 255 * col[2] * shade);
            }
        }
      }
    // Ground / waterline (y = 0) in the side and front views.
    if (vi !== 1) {
      const y = Math.round(sy([0, 0, 0]));
      if (y >= 0 && y < H) for (let x = 0; x < W; x++) { const o = (y * width + vi * W + x) * 3; img[o] = 90; img[o + 1] = 170; img[o + 2] = 230; }
    }
  });
  const label = Buffer.from(`<svg width="${W * 3}" height="${H}"><style>text{font:13px sans-serif;fill:#cfd6dd}</style>
    <text x="8" y="16">${title.replace(/[<&>]/g, '')}</text>${views.map((v, i) => `<text x="${i * W + 8}" y="${H - 4}">${v.name}</text>`).join('')}</svg>`);
  await sharp(img, { raw: { width: W * 3, height: H, channels: 3 } }).composite([{ input: label, top: 0, left: 0 }]).png().toFile(file);
}

// ------------------------------------------------------------------ main

function findModelFile(dir) {
  const stack = [dir];
  const found = [];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(glb|gltf)$/i.test(e.name)) found.push(p);
    }
  }
  return found.sort((a, b) => a.length - b.length)[0] ?? null;
}

async function importOne(io, m) {
  const dir = path.join(rawRoot, m.uid);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const file = findModelFile(dir);
  if (!file) throw new Error('no .gltf or .glb in the download');
  // Every file the model references must be inside its own download folder.
  const doc = await readConfined(io, file, dir);
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const c of root.listCameras()) c.dispose();
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_lights_punctual' || ext.extensionName === 'KHR_materials_variants') ext.dispose();
  const required = root.listExtensionsRequired().map((e) => e.extensionName).filter((n) => !RENDERABLE.has(n));
  if (required.length) throw new Error('needs unsupported extensions: ' + required.join(', '));
  const drop = m.drop ? new RegExp(m.drop, 'i') : null;

  // 1. Bake node transforms; 2. detect orientation; 3. bake the normalising transform.
  const topology = { dropped: 0, converted: 0, collapsed: 0 };
  bakeScene(doc, IDENTITY, drop, topology);
  const pts = allPoints(doc);
  if (pts.length < 9) throw new Error('no geometry');
  // The heuristics only suggest an orientation; a model ships once its shortlist entry confirms forward and up
  // (after checking the preview). Until then it is held for review: not in the app or index.json.
  const upInfo = detectUp(pts, m.kind);
  const guess = detectForward(pts, m.kind, m.up ?? upInfo.up);
  const { up, forward, confidence, review } = orientationDecision(m, upInfo, guess);
  let waterline = 0; // ships: height of the waterline above the model's lowest point (metres)
  let norm = normaliseMatrix(pts, forward, up, m.lengthM);
  if (m.kind === 'ship') {
    // Waterline: measured in metres on the normalised model, then re-normalised with that origin.
    const scaled = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 3) {
      scaled[i] = (norm.rotated[i] - (norm.min[0] + norm.max[0]) / 2) * norm.scale;
      scaled[i + 1] = (norm.rotated[i + 1] - norm.min[1]) * norm.scale;
      scaled[i + 2] = (norm.rotated[i + 2] - (norm.min[2] + norm.max[2]) / 2) * norm.scale;
    }
    const wl = m.waterlineM ?? waterlineAboveBottom(scaled, m.draftM ?? 0);
    waterline = wl;
    norm = normaliseMatrix(pts, forward, up, m.lengthM, norm.min[1] + wl / norm.scale);
  }
  bakeScene(doc, norm.matrix, null);

  await doc.transform(prune(), dedup(), weld(), join({ keepNamed: false }));
  const before = triangleCount(doc);
  if (before > TARGET_TRIS) {
    await MeshoptSimplifier.ready;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIS / before, error: 0.004 }));
    // Hard normal/UV seams can lock most triangles on detailed aircraft exports. Permit edge
    // collapses across those seams on a second pass, retaining each primitive's material and
    // the same spatial error bound used for the first pass.
    const remaining = triangleCount(doc);
    if (remaining > 2 * TARGET_TRIS) {
      const acrossSeams = {
        ...MeshoptSimplifier,
        simplify(indices, positions, stride, target, error, flags) {
          return MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']);
        },
      };
      await doc.transform(simplify({ simplifier: acrossSeams, ratio: TARGET_TRIS / remaining, error: 0.004 }));
    }
  }
  // Lighting needs normals; a few exports leave them out. normals() unwelds the whole document,
  // so it runs only when needed and the geometry is re-indexed afterwards (existing normals are kept).
  if (doc.getRoot().listMeshes().some((mesh) => mesh.listPrimitives().some((p) => !p.getAttribute('NORMAL'))))
    await doc.transform(normals({ overwrite: false }), weld());
  await shrinkTextures(doc);
  await doc.transform(prune(), dedup(), unpartition());
  const tris = triangleCount(doc);
  const finalPts = allPoints(doc);
  const ext = extents(finalPts);
  // The finished model must still stand on its origin: aircraft on their lowest point (y = 0), ships with the
  // bottom at the waterline depth found above (simplification may move the extremes by a few centimetres).
  const wantBottom = m.kind === 'ship' ? -waterline : 0;
  if (!(Math.abs(ext.min[1] - wantBottom) <= 0.5)) throw new Error(`origin check failed: lowest point at ${ext.min[1].toFixed(2)} m, expected ${wantBottom.toFixed(2)} m`);
  assertFiniteVertices(doc);
  const glb = await io.writeBinary(doc);
  fs.mkdirSync(previewDir, { recursive: true });
  if (review) {
    fs.rmSync(path.join(outDir, `${m.id}.glb`), { force: true });
    fs.writeFileSync(path.join(previewDir, `${m.id}.glb`), glb);
  } else fs.writeFileSync(path.join(outDir, `${m.id}.glb`), glb);
  const how = (o, c) => (o ? ' (confirmed)' : ` (guess ${c.toFixed(2)})`);
  await writePreview(doc, path.join(previewDir, `${m.id}.png`), `${review ? 'NEEDS REVIEW  ' : ''}${m.id}: ${meta.name} — forward ${forward}${how(m.forward, guess.confidence)}, up ${up}${how(m.up, upInfo.confidence)}`);
  const entry = {
    id: m.id,
    file: `${m.id}.glb`,
    kind: m.kind,
    ...(m.icao ? { icao: m.icao } : {}),
    ...(m.vessel ? { vessel: m.vessel } : {}),
    military: m.military === true,
    lengthM: round(ext.size[2]),
    widthM: round(ext.size[0]),
    heightM: round(ext.size[1]),
    title: meta.name,
    author: meta.author,
    license: meta.license,
    licenseUrl: meta.licenseUrl,
    sourceUrl: meta.sourceUrl,
    tris,
    bytes: glb.byteLength,
    importKey: importKey(m),
  };
  return { entry, forward, up, confidence, before, review, topology };
}

const round = (v) => Math.round(v * 100) / 100;

/** What an imported file depends on: the importer version and every shortlist field used to make it. */
function importKey(m) {
  return JSON.stringify([IMPORTER_VERSION, m.uid, m.kind, m.lengthM, m.forward ?? null, m.up ?? null, m.drop ?? null, m.waterlineM ?? null, m.draftM ?? null, m.icao ?? null, m.vessel ?? null, m.military === true]);
}

/** Only models whose orientation has been confirmed in the shortlist are published. */
const publishable = (m) => !!(m.forward && m.up);

async function main() {
  // Even with no downloads, existing output is still checked against the shortlist below (and cleaned up).
  const haveRaw = fs.existsSync(rawRoot);
  if (!haveRaw && !fs.existsSync(outDir)) {
    console.error(`Nothing downloaded yet (${rawRoot}). Run scripts/fetch-models.mjs first.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const indexFile = path.join(outDir, 'index.json');
  let previous = [];
  try {
    previous = fs.existsSync(indexFile) ? (JSON.parse(fs.readFileSync(indexFile, 'utf8')).models ?? []) : [];
    if (!Array.isArray(previous)) previous = [];
  } catch {
    console.log('The existing index.json is unreadable: starting a new one (unlisted model files are removed).');
  }
  // Malformed entries are discarded (their files count as unlisted and are removed below).
  const wellFormed = previous.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && /^[a-z0-9_-]{1,32}$/.test(e.id) && e.file === `${e.id}.glb` && typeof e.importKey === 'string');
  if (wellFormed.length !== previous.length) console.log(`Discarded ${previous.length - wellFormed.length} malformed entries from the existing index.json.`);
  previous = wellFormed;
  const entries = new Map(previous.map((e) => [e.id, e]));
  const list = shortlist.models.filter((m) => !only || only.has(m.id));
  const failed = [];
  const held = [];
  for (const m of list) {
    if (!haveRaw || !fs.existsSync(path.join(rawRoot, m.uid, 'meta.json'))) {
      console.log(`${m.id.padEnd(10)} not downloaded`);
      continue;
    }
    try {
      const { entry, forward, up, confidence, before, review, topology } = await importOne(io, m);
      const topo = `${topology.converted ? `  (${topology.converted} strip/fan primitives converted)` : ''}${topology.dropped ? `  (${topology.dropped} line/point primitives dropped)` : ''}${topology.collapsed ? `  (${topology.collapsed} parts scaled to zero skipped)` : ''}`;
      const line = `${before}→${entry.tris} tris  ${(entry.bytes / 1e6).toFixed(1)} MB  ${entry.lengthM}×${entry.widthM}×${entry.heightM} m  forward ${forward}, up ${up} (${confidence.toFixed(2)})${topo}`;
      if (review) {
        entries.delete(m.id);
        held.push(m.id);
        console.log(`${m.id.padEnd(10)} HELD FOR REVIEW  ${line}  → if right: "forward": "${forward}", "up": "${up}"`);
      } else {
        entries.set(m.id, entry);
        console.log(`${m.id.padEnd(10)} ok  ${line}`);
      }
    } catch (e) {
      console.log(`${m.id.padEnd(10)} FAILED  ${String(e?.message ?? e).slice(0, 200)}`);
      entries.delete(m.id);
      fs.rmSync(path.join(outDir, `${m.id}.glb`), { force: true });
      failed.push(m.id);
    }
  }
  // Publish only output that still matches the shortlist: same model (uid), same import settings, orientation
  // confirmed, file present. Earlier output that no longer qualifies (also for models not imported in this run,
  // or whose download is gone) is dropped, and its file removed.
  const byId = new Map(shortlist.models.map((m) => [m.id, m]));
  const models = [...entries.values()]
    .filter((e) => {
      const m = byId.get(e.id);
      return !!m && publishable(m) && e.importKey === importKey(m) && fs.existsSync(path.join(outDir, e.file));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const dropped = [...entries.values()].filter((e) => !models.includes(e)).map((e) => e.id);
  if (dropped.length) console.log(`Removed from the app (no longer matches the shortlist or not confirmed): ${dropped.join(', ')}`);
  for (const f of fs.readdirSync(outDir)) if (f.endsWith('.glb') && !models.some((e) => e.file === f)) fs.rmSync(path.join(outDir, f), { force: true });
  fs.writeFileSync(indexFile, JSON.stringify({ version: 1, models }, null, 1) + '\n');
  const credits = models.map((e) => `${e.title} by ${e.author}, ${e.license} (${e.licenseUrl}), ${e.sourceUrl}. Converted for Atlas Watch: re-oriented, scaled, simplified, textures resized.`).join('\n');
  fs.writeFileSync(path.join(outDir, 'ATTRIBUTION.txt'), `3D vehicle models used by Atlas Watch (from Sketchfab)\n\n${credits}\n`);
  console.log(`\n${models.length} models in ${outDir}  (${(models.reduce((s, e) => s + e.bytes, 0) / 1e6).toFixed(1)} MB)`);
  console.log(`Previews: ${previewDir}`);
  if (failed.length) console.log('Failed: ' + failed.join(', '));
  if (!haveRaw) console.log(`Nothing downloaded (${rawRoot}): run scripts/fetch-models.mjs first. Existing output was checked against the shortlist.`);
  if (held.length)
    console.log(`Held for review (not in the app): ${held.join(', ')}. Every model needs its orientation confirmed once: check its preview, then add "forward" and "up" (as suggested above, or corrected) to its entry in scripts/vehicle-models/shortlist.json and import again.`);
}

await main();
