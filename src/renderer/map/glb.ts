// Minimal glTF 2.0 (GLB) writer and mesh helpers for the app-built vehicle models
// (see vehicleMeshes.ts). Pure code: no DOM, no Cesium, so it is unit-tested in Node.
//
// Conventions (glTF): +Y up, +Z forward (nose / bow), +X left. Cesium converts these
// to its model frame (+X forward, +Y left, +Z up). Units are metres.

export interface Geometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export interface GlbMaterial {
  name: string;
  color: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  /** Index into the images passed to writeGlb. */
  texture?: number;
  blend?: boolean;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function emptyGeometry(): Geometry {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/** Appends a flat quad or triangle (corners in order) with one face normal. */
function face(g: Geometry, corners: V3[], uv: [number, number][]): void {
  const n = norm(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
  const base = g.positions.length / 3;
  corners.forEach((c, i) => {
    g.positions.push(...c);
    g.normals.push(...n);
    g.uvs.push(...uv[i]);
  });
  g.indices.push(base, base + 1, base + 2);
  if (corners.length === 4) g.indices.push(base, base + 2, base + 3);
}

/**
 * Solid of revolution along Z. Each station: z, radius, optional vertical centre offset y.
 * UV: u runs 0→1 from the first to the last station, v runs 0→1 around (0 = top).
 */
export function lathe(stations: { z: number; r: number; y?: number }[], segments = 16, rx = 1): Geometry {
  const g = emptyGeometry();
  const z0 = stations[0].z;
  const z1 = stations[stations.length - 1].z;
  stations.forEach((s, i) => {
    const prev = stations[Math.max(0, i - 1)];
    const next = stations[Math.min(stations.length - 1, i + 1)];
    const slope = next.z === prev.z ? 0 : (next.r - prev.r) / (next.z - prev.z);
    for (let k = 0; k <= segments; k++) {
      const t = (k / segments) * Math.PI * 2;
      const sx = Math.sin(t);
      const cy = Math.cos(t);
      g.positions.push(s.r * sx * rx, (s.y ?? 0) + s.r * cy, s.z);
      const n = norm([sx, cy, -slope]);
      g.normals.push(...n);
      g.uvs.push((s.z - z0) / (z1 - z0 || 1), k / segments);
    }
  });
  const ring = segments + 1;
  for (let i = 0; i < stations.length - 1; i++) {
    // Counter-clockwise seen from outside, matching the outward normals (double-sided materials light
    // back faces with flipped normals, so winding must agree). Order depends on the segment's direction.
    const backward = stations[i + 1].z < stations[i].z;
    for (let k = 0; k < segments; k++) {
      const a = i * ring + k;
      const b = a + ring;
      if (backward) g.indices.push(a, a + 1, b, a + 1, b + 1, b);
      else g.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return g;
}

/** Axis-aligned box; top and bottom faces come back separately so they can use a plain material. */
/** `module` > 0 repeats the side texture every `module` metres horizontally and per 2.8 m deck vertically; 0 maps each face to 0–1. */
export function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, module = 0): { sides: Geometry; caps: Geometry } {
  const [x0, x1, y0, y1, z0, z1] = [cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2];
  const sides = emptyGeometry();
  const caps = emptyGeometry();
  const uv: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  // Window bays every `module` m horizontally and one deck (2.8 m) vertically.
  const rows = module > 0 ? Math.max(1, Math.round(sy / 2.8)) : 1;
  const su = (w: number): [number, number][] => {
    const u = module > 0 ? Math.max(1, Math.round(w / module)) : 1;
    return [[0, rows], [u, rows], [u, 0], [0, 0]];
  };
  // Sides (u along the face, v down from the top edge), outward winding.
  face(sides, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], su(sx)); // +Z front
  face(sides, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], su(sx)); // -Z back
  face(sides, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], su(sz)); // +X
  face(sides, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], su(sz)); // -X
  face(caps, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], uv); // top
  face(caps, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uv); // bottom
  return { sides, caps };
}

export function boxAll(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Geometry {
  const b = box(cx, cy, cz, sx, sy, sz, 0);
  return merge(b.sides, b.caps);
}

/**
 * A tapered slab (wing, stabiliser, fin). Root and tip are given as leading-edge points plus
 * chord (along -Z) and thickness (along the slab normal).
 */
export function slab(rootLE: V3, rootChord: number, tipLE: V3, tipChord: number, thickness: number, vertical = false): Geometry {
  const g = emptyGeometry();
  const t = (p: V3, d: number): V3 => (vertical ? [p[0] + d, p[1], p[2]] : [p[0], p[1] + d, p[2]]);
  const rt = thickness / 2;
  const tt = (thickness * tipChord) / rootChord / 2;
  const rLE: V3 = rootLE;
  const rTE: V3 = [rootLE[0], rootLE[1], rootLE[2] - rootChord];
  const tLE: V3 = tipLE;
  const tTE: V3 = [tipLE[0], tipLE[1], tipLE[2] - tipChord];
  const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  face(g, [t(rLE, rt), t(tLE, tt), t(tTE, tt), t(rTE, rt)], uv); // upper / one side
  face(g, [t(rTE, -rt), t(tTE, -tt), t(tLE, -tt), t(rLE, -rt)], uv); // lower / other side
  face(g, [t(rLE, -rt), t(tLE, -tt), t(tLE, tt), t(rLE, rt)], uv); // leading edge
  face(g, [t(rTE, rt), t(tTE, tt), t(tTE, -tt), t(rTE, -rt)], uv); // trailing edge
  face(g, [t(tLE, tt), t(tLE, -tt), t(tTE, -tt), t(tTE, tt)], uv); // tip
  return g;
}

/** Flat disc (propeller / rotor). axis 'z' = facing forward, 'y' = horizontal, 'x' = sideways. */
export function disc(c: V3, r: number, axis: 'x' | 'y' | 'z', segments = 20): Geometry {
  const g = emptyGeometry();
  const base = 0;
  const n: V3 = axis === 'z' ? [0, 0, 1] : axis === 'y' ? [0, 1, 0] : [1, 0, 0];
  g.positions.push(...c);
  g.normals.push(...n);
  g.uvs.push(0.5, 0.5);
  for (let k = 0; k <= segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    const [u, v] = [Math.cos(a) * r, Math.sin(a) * r];
    const p: V3 = axis === 'z' ? [c[0] + u, c[1] + v, c[2]] : axis === 'y' ? [c[0] + u, c[1], c[2] + v] : [c[0], c[1] + v, c[2] + u];
    g.positions.push(...p);
    g.normals.push(...n);
    g.uvs.push(0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2);
    // Counter-clockwise about the normal (the parametrisation turns the other way for the y and x axes).
    if (k > 0) g.indices.push(...(axis === 'z' ? [base, base + k, base + k + 1] : [base, base + k + 1, base + k]));
  }
  return g;
}

/** Thin triangle (sail). Double-sided materials render both faces. */
export function triangle(a: V3, b: V3, c: V3): Geometry {
  const g = emptyGeometry();
  face(g, [a, b, c], [[0, 0], [1, 0], [0, 1]]);
  return g;
}

/**
 * Loft between two outlines in the XZ plane (same point count, convex, any winding) at heights
 * y0 and y1. Adds side walls and, optionally, top and bottom caps (fan triangulation).
 */
export function loft(bottom: [number, number][], y0: number, top: [number, number][], y1: number, capTop = true, capBottom = true): { sides: Geometry; top: Geometry; bottom: Geometry } {
  const sides = emptyGeometry();
  const n = top.length;
  const cx = top.reduce((s, p) => s + p[0], 0) / n;
  const cz = top.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const quad: V3[] = [[bottom[i][0], y0, bottom[i][1]], [bottom[j][0], y0, bottom[j][1]], [top[j][0], y1, top[j][1]], [top[i][0], y1, top[i][1]]];
    // Orient outward: the face normal must point away from the outline centre.
    const nrm = cross(sub(quad[1], quad[0]), sub(quad[2], quad[0]));
    const mid = [(quad[0][0] + quad[1][0]) / 2 - cx, (quad[0][2] + quad[1][2]) / 2 - cz];
    if (nrm[0] * mid[0] + nrm[2] * mid[1] < 0) quad.reverse();
    const len = Math.hypot(top[j][0] - top[i][0], top[j][1] - top[i][1]);
    face(sides, quad, [[0, 0], [len, 0], [len, 1], [0, 1]]);
  }
  const cap = (pts: [number, number][], y: number, up: boolean): Geometry => {
    const g = emptyGeometry();
    const ccx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const ccz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const tri: V3[] = [[ccx, y, ccz], [pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]]];
      const nrm = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
      if ((nrm[1] > 0) !== up) tri.reverse();
      face(g, tri, [[0.5, 0.5], [0, 0], [1, 0]]);
    }
    return g;
  };
  return { sides, top: capTop ? cap(top, y1, true) : emptyGeometry(), bottom: capBottom ? cap(bottom, y0, false) : emptyGeometry() };
}

export function merge(...parts: Geometry[]): Geometry {
  const out = emptyGeometry();
  for (const p of parts) {
    const base = out.positions.length / 3;
    out.positions.push(...p.positions);
    out.normals.push(...p.normals);
    out.uvs.push(...p.uvs);
    for (const i of p.indices) out.indices.push(base + i);
  }
  return out;
}

/** Mirror across the X = 0 plane (left/right), flipping winding. */
export function mirrorX(g: Geometry): Geometry {
  const out = emptyGeometry();
  for (let i = 0; i < g.positions.length; i += 3) {
    out.positions.push(-g.positions[i], g.positions[i + 1], g.positions[i + 2]);
    out.normals.push(-g.normals[i], g.normals[i + 1], g.normals[i + 2]);
  }
  out.uvs = [...g.uvs];
  for (let i = 0; i < g.indices.length; i += 3) out.indices.push(g.indices[i], g.indices[i + 2], g.indices[i + 1]);
  return out;
}

export function translate(g: Geometry, dx: number, dy: number, dz: number): Geometry {
  const out = { ...g, positions: [...g.positions] };
  for (let i = 0; i < out.positions.length; i += 3) {
    out.positions[i] += dx;
    out.positions[i + 1] += dy;
    out.positions[i + 2] += dz;
  }
  return out;
}

/**
 * Writes a binary glTF with one mesh (one primitive per material that has geometry).
 * `images` are PNG bytes referenced by GlbMaterial.texture.
 */
export function writeGlb(parts: { geometry: Geometry; material: number }[], materials: GlbMaterial[], images: Uint8Array[] = []): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const push = (bytes: Uint8Array, target?: number): number => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    offset += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const primitives: Record<string, unknown>[] = [];
  for (const part of parts) {
    const g = part.geometry;
    if (!g.indices.length) continue;
    const count = g.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], g.positions[i]);
      max[i % 3] = Math.max(max[i % 3], g.positions[i]);
    }
    const pos = push(new Uint8Array(new Float32Array(g.positions).buffer), 34962);
    accessors.push({ bufferView: pos, componentType: 5126, count, type: 'VEC3', min, max });
    const posA = accessors.length - 1;
    const nor = push(new Uint8Array(new Float32Array(g.normals).buffer), 34962);
    accessors.push({ bufferView: nor, componentType: 5126, count, type: 'VEC3' });
    const norA = accessors.length - 1;
    const attributes: Record<string, number> = { POSITION: posA, NORMAL: norA };
    if (g.uvs.length === count * 2) {
      const uv = push(new Uint8Array(new Float32Array(g.uvs).buffer), 34962);
      accessors.push({ bufferView: uv, componentType: 5126, count, type: 'VEC2' });
      attributes.TEXCOORD_0 = accessors.length - 1;
    }
    const big = count > 65535;
    const idx = push(new Uint8Array((big ? new Uint32Array(g.indices) : new Uint16Array(g.indices)).buffer), 34963);
    accessors.push({ bufferView: idx, componentType: big ? 5125 : 5123, count: g.indices.length, type: 'SCALAR' });
    primitives.push({ attributes, indices: accessors.length - 1, material: part.material });
  }
  const imageViews = images.map((png) => push(png));
  const json = {
    asset: { version: '2.0', generator: 'Atlas Watch vehicle models' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    materials: materials.map((m) => ({
      name: m.name,
      doubleSided: true,
      ...(m.blend ? { alphaMode: 'BLEND' } : {}),
      pbrMetallicRoughness: {
        baseColorFactor: m.color,
        metallicFactor: m.metallic ?? 0.1,
        roughnessFactor: m.roughness ?? 0.6,
        ...(m.texture !== undefined ? { baseColorTexture: { index: m.texture } } : {}),
      },
    })),
    ...(images.length
      ? {
          images: imageViews.map((bufferView) => ({ bufferView, mimeType: 'image/png' })),
          samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
          textures: images.map((_, i) => ({ sampler: 0, source: i })),
        }
      : {}),
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const pad4 = (n: number) => (4 - (n % 4)) % 4;
  let jsonText = JSON.stringify(json);
  jsonText += ' '.repeat(pad4(new TextEncoder().encode(jsonText).byteLength));
  const jsonBytes = new TextEncoder().encode(jsonText);
  const binLength = offset + pad4(offset);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  let p = 20 + jsonBytes.byteLength;
  view.setUint32(p, binLength, true);
  view.setUint32(p + 4, 0x004e4942, true); // 'BIN\0'
  p += 8;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out.buffer;
}

/** Rotates geometry so its +Z axis points up (+Y): used for vertical solids built with lathe(). */
export function zToUp(g: Geometry): Geometry {
  const out = { ...g, positions: [...g.positions], normals: [...g.normals] };
  for (let i = 0; i < out.positions.length; i += 3) {
    const [y, z] = [g.positions[i + 1], g.positions[i + 2]];
    out.positions[i + 1] = z;
    out.positions[i + 2] = -y;
    const [ny, nz] = [g.normals[i + 1], g.normals[i + 2]];
    out.normals[i + 1] = nz;
    out.normals[i + 2] = -ny;
  }
  return out;
}
