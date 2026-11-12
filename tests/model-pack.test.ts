import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { Document, NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { MODE, applyRotation, detectForward, detectUp, extents, normaliseMatrix, orientationDecision, rotationFor, triangleList, waterlineAboveBottom, type Axis } from '../scripts/vehicle-models/orient.mjs';
import { allowedDownloadHost, allowedDownloadUrl, cleanAuthor, downloadCapped, extractZip, readConfined, redactSecret, resourcePath, safeEntryPath, sourceUrlFor, validToken } from '../scripts/vehicle-models/safety.mjs';
import { packCredit, packForAircraft, packForVessel, packScale, parsePackIndex } from '../src/shared/modelPack';
import { clearShownModels, packIdOf, setShownModel, shownModelVariant, subscribeShownModels } from '../src/renderer/map/shownModels';
import shortlist from '../scripts/vehicle-models/shortlist.json';

// ------------------------------------------------------------------ synthetic models (glTF axes: +Z forward, +Y up, +X left)

/** Airliner-like point cloud: fuselage along Z (nose at +Z), wings along X, fin at the tail reaching highest. */
function aircraftPoints(): number[] {
  const p: number[] = [];
  for (let z = -20; z <= 20; z += 0.5)
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      p.push(2 * Math.cos(t), 3 + 2 * Math.sin(t), z);
    }
  for (let x = -17; x <= 17; x += 0.5) for (let z = -3; z <= 3; z += 1) p.push(x, 2.2, z); // wings
  for (let y = 5; y <= 11; y += 0.25) for (let z = -20; z <= -15; z += 0.5) p.push(0, y, z); // fin at the tail
  for (let x = -6; x <= 6; x += 0.5) p.push(x, 5.5, -18); // tailplane
  return p;
}

/** Ship-like point cloud: hull along Z, bow (+Z) tapering to a point, broad transom stern. */
function shipPoints(fullHull: boolean): number[] {
  const p: number[] = [];
  for (let z = -50; z <= 50; z += 1) {
    const half = z > 30 ? 8 * (1 - (z - 30) / 20) : 8; // taper over the last 20 m
    for (let y = fullHull ? -6 : 0; y <= 6; y += 1) {
      const w = fullHull && y < 0 ? half * (1 + y / 7) : half; // V-shaped below the waterline
      p.push(-w, y, z, w, y, z);
    }
  }
  for (let x = -5; x <= 5; x += 1) for (let y = 6; y <= 14; y += 1) p.push(x, y, -38); // bridge aft
  return p;
}

/** Applies the inverse of rotationFor(forward, up): produces a model exported with those axes. */
function exportAs(points: number[], forward: Axis, up: Axis): number[] {
  const R = rotationFor(forward, up);
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const [x, y, z] = [points[i], points[i + 1], points[i + 2]];
    // R maps source → glTF; Rᵀ maps glTF → source.
    out.push(R[0][0] * x + R[1][0] * y + R[2][0] * z, R[0][1] * x + R[1][1] * y + R[2][1] * z, R[0][2] * x + R[1][2] * y + R[2][2] * z);
  }
  return out;
}

const ORIENTATIONS: [Axis, Axis][] = [
  ['+Z', '+Y'], ['-Z', '+Y'], ['+X', '+Y'], ['-X', '+Y'],
  ['+Y', '+Z'], ['-Y', '+Z'], ['+X', '+Z'], ['-X', '+Z'],
];

describe('model orientation heuristics', () => {
  it('rotationFor is a proper rotation taking forward to +Z and up to +Y', () => {
    for (const [f, u] of ORIENTATIONS) {
      const R = rotationFor(f, u);
      const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
      expect(det).toBeCloseTo(1);
      const fv = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[f[1] as 'X' | 'Y' | 'Z'].map((v) => (f[0] === '-' ? -v : v));
      expect(applyRotation(R, fv).map((v) => Math.round(v) + 0)).toEqual([0, 0, 1]);
    }
    expect(() => rotationFor('+Y', '+Y')).toThrow();
  });

  it('finds the nose of an aircraft exported in any of 8 orientations', () => {
    const base = aircraftPoints();
    for (const [f, u] of ORIENTATIONS) {
      const pts = exportAs(base, f, u);
      const up = detectUp(pts, 'aircraft');
      expect(up.up).toBe(u);
      // glTF is +Y up: anything else is held for review.
      if (u === '+Y') expect(up.confidence).toBeGreaterThan(0.8);
      else expect(up.confidence).toBeLessThan(0.4);
      const g = detectForward(pts, 'aircraft', up.up);
      expect(g.forward, `exported forward ${f} up ${u}`).toBe(f);
      expect(g.confidence).toBeGreaterThan(0.8);
    }
  });

  it('finds the bow of a ship (pointed bow, broad stern)', () => {
    for (const full of [false, true])
      for (const [f, u] of ORIENTATIONS.filter(([, up]) => up === '+Y')) {
        const pts = exportAs(shipPoints(full), f, u);
        const up = detectUp(pts, 'ship');
        expect(up.up).toBe('+Y');
        expect(up.confidence).toBeGreaterThan(0.6);
        const g = detectForward(pts, 'ship', u);
        expect(g.forward).toBe(f);
        expect(g.confidence).toBeGreaterThan(0.5);
      }
  });

  it('finds the up axis of a Z-up ship even when it is taller than it is wide, but holds it for review', () => {
    for (const full of [false, true])
      for (const f of ['+X', '-X', '+Y', '-Y'] as Axis[]) {
        // e.g. length along X, beam along Y, height along Z: Y is not the longest axis, so size alone would pick +Y.
        const pts = exportAs(shipPoints(full), f, '+Z');
        const up = detectUp(pts, 'ship');
        expect(up.up, `forward ${f}`).toBe('+Z');
        expect(up.confidence).toBeLessThan(0.4);
        expect(detectForward(pts, 'ship', up.up).forward).toBe(f);
      }
  });

  it('cannot tell an upside-down ship from an upright one, so no model ships without confirmed axes', () => {
    const pts = exportAs(shipPoints(true), '+Z', '-Y'); // rotated 180° about the length axis
    const up = detectUp(pts, 'ship');
    expect(up.up).toBe('+Y'); // the sign is not established from geometry
    const fwd = detectForward(pts, 'ship', up.up);
    const unconfirmed = orientationDecision({}, up, fwd);
    expect(unconfirmed.review).toBe(true);
    // Even a confident guess is only a suggestion.
    expect(orientationDecision({}, { up: '+Y', confidence: 1 }, { forward: '+Z', confidence: 1 })).toMatchObject({ review: true, confirmed: false, up: '+Y', forward: '+Z' });
    expect(orientationDecision({ forward: '+Z' }, up, fwd).review).toBe(true);
    // Confirmed in the shortlist after checking the preview: that wins and the model ships.
    expect(orientationDecision({ forward: '+Z', up: '-Y' }, up, fwd)).toMatchObject({ review: false, confirmed: true, up: '-Y', forward: '+Z', confidence: 1 });
  });

  it('converts triangle strips and fans with glTF winding, and skips points and lines', () => {
    const id = (k: number) => k;
    expect([...triangleList(MODE.TRIANGLE_STRIP, id, 4)!]).toEqual([0, 1, 2, 1, 3, 2]);
    expect([...triangleList(MODE.TRIANGLE_FAN, id, 4)!]).toEqual([1, 2, 0, 2, 3, 0]);
    expect([...triangleList(MODE.TRIANGLES, id, 7)!]).toEqual([0, 1, 2, 3, 4, 5]);
    const idx = [5, 6, 7, 7, 8];
    expect([...triangleList(MODE.TRIANGLE_STRIP, (k) => idx[k], idx.length)!]).toEqual([5, 6, 7, 7, 8, 7].slice(0, 3)); // repeated-vertex triangles skipped
    for (const m of [MODE.POINTS, MODE.LINES, MODE.LINE_LOOP, MODE.LINE_STRIP]) expect(triangleList(m, id, 6)).toBeNull();
    // A zig-zag strip in the XY plane: every triangle must face the same way.
    const P: [number, number][] = [];
    for (let i = 0; i < 12; i++) P.push([Math.floor(i / 2), i % 2]);
    const tri = triangleList(MODE.TRIANGLE_STRIP, id, P.length)!;
    const signs = new Set<number>();
    for (let t = 0; t < tri.length; t += 3) {
      const [a, b, c] = [P[tri[t]], P[tri[t + 1]], P[tri[t + 2]]];
      signs.add(Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])));
    }
    expect(signs.size).toBe(1);
    const fan = triangleList(MODE.TRIANGLE_FAN, id, 6)!;
    const ring: [number, number][] = [[0, 0], ...Array.from({ length: 5 }, (_, i) => [Math.cos(i * 0.6), Math.sin(i * 0.6)] as [number, number])];
    const fanSigns = new Set<number>();
    for (let t = 0; t < fan.length; t += 3) {
      const [a, b, c] = [ring[fan[t]], ring[fan[t + 1]], ring[fan[t + 2]]];
      fanSigns.add(Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])));
    }
    expect(fanSigns.size).toBe(1);
  });

  it('reports low confidence for a symmetric shape', () => {
    const p: number[] = [];
    for (let z = -10; z <= 10; z += 1) for (let x = -2; x <= 2; x += 1) p.push(x, 0, z, x, 1, z);
    expect(detectForward(p, 'ship').confidence).toBeLessThan(0.2);
  });

  it('normalises to the real length with the origin at the lowest point, centred', () => {
    const pts = exportAs(aircraftPoints(), '-X', '+Z').map((v) => v * 0.01); // centimetre-ish export, wrong axes
    const n = normaliseMatrix(pts, '-X', '+Z', 37.6);
    const m = n.matrix;
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 3) {
      const [x, y, z] = [pts[i], pts[i + 1], pts[i + 2]];
      out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    }
    const e = extents(out);
    expect(e.size[2]).toBeCloseTo(37.6, 5);
    expect(e.min[1]).toBeCloseTo(0, 5);
    expect(e.min[2] + e.max[2]).toBeCloseTo(0, 5);
    expect(e.min[0] + e.max[0]).toBeCloseTo(0, 5);
    // The fin (highest points) ends up at the tail (−Z).
    let finZ = 0, count = 0;
    for (let i = 0; i < out.length; i += 3) if (out[i + 1] > e.max[1] * 0.9) { finZ += out[i + 2]; count++; }
    expect(finZ / count).toBeLessThan(-10);
  });

  it('sinks full-hull ships by their draft and floats waterline-cut models as they are', () => {
    const lift = (p: number[]) => p.map((v, i) => (i % 3 === 1 ? v + 6 : v)); // lowest point at y = 0
    expect(waterlineAboveBottom(lift(shipPoints(false)), 5)).toBe(0);
    expect(waterlineAboveBottom(lift(shipPoints(true)), 5)).toBe(5);
    // Draft is capped at 45 % of the model height.
    expect(waterlineAboveBottom(lift(shipPoints(true)), 100)).toBeCloseTo(20 * 0.45);
  });
});

describe('model download safety', () => {
  const dir = path.resolve('some-download-dir');
  it('keeps archive entries inside the target folder', () => {
    expect(safeEntryPath(dir, 'scene.gltf')).toBe(path.join(dir, 'scene.gltf'));
    expect(safeEntryPath(dir, 'textures/body_baseColor.png')).toBe(path.join(dir, 'textures', 'body_baseColor.png'));
    for (const bad of ['../evil.js', 'textures/../../x', '/etc/passwd', 'C:/Windows/x.dll', 'c:\\x', '..\\x', ''])
      expect(safeEntryPath(dir, bad), bad).toBeNull();
  });

  it('downloads only over https from Sketchfab storage hosts (not other AWS buckets)', () => {
    expect(allowedDownloadUrl('https://sketchfab-prod-media.s3.amazonaws.com/archives/x.zip?sig=1')).toBe(true);
    expect(allowedDownloadUrl('https://media.sketchfab.com/x.zip')).toBe(true);
    for (const h of ['sketchfab-prod-media.s3.us-east-1.amazonaws.com', 'sketchfab-prod-media.s3-us-west-2.amazonaws.com']) expect(allowedDownloadHost(h), h).toBe(true);
    for (const h of ['evil.s3.amazonaws.com', 's3.amazonaws.com', 'sketchfab-prod-media.s3.amazonaws.com.evil.io', 'notsketchfab.com', 'sketchfab.com.evil.io']) expect(allowedDownloadHost(h), h).toBe(false);
    for (const bad of ['http://sketchfab-prod-media.s3.amazonaws.com/x.zip', 'https://evil.example.com/x.zip', 'https://amazonaws.com.evil.io/x', 'https://u:p@media.sketchfab.com/x', 'https://media.sketchfab.com:8443/x', 'file:///c:/x', 'not a url'])
      expect(allowedDownloadUrl(bad), bad).toBe(false);
  });

  const fakeFetch = (routes: Record<string, () => Response>) => {
    const seen: { url: string; init: { headers?: Record<string, string> } }[] = [];
    const impl = async (url: string, init: unknown) => {
      seen.push({ url, init: init as { headers?: Record<string, string> } });
      const r = routes[url];
      if (!r) throw new Error('unexpected request to ' + url);
      return r();
    };
    return { impl, seen };
  };
  const OK = 'https://sketchfab-prod-media.s3.amazonaws.com/a.zip';

  it('checks every redirect hop and never sends credentials', async () => {
    const good = fakeFetch({
      'https://media.sketchfab.com/x': () => new Response(null, { status: 302, headers: { location: OK } }),
      [OK]: () => new Response(new Uint8Array([1, 2, 3])),
    });
    expect([...(await downloadCapped('https://media.sketchfab.com/x', { maxBytes: 10, fetchImpl: good.impl }))]).toEqual([1, 2, 3]);
    expect(good.seen.every((s) => !JSON.stringify(s.init.headers ?? {}).toLowerCase().includes('authorization'))).toBe(true);
    const evil = fakeFetch({ [OK]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } }) });
    await expect(downloadCapped(OK, { maxBytes: 10, fetchImpl: evil.impl })).rejects.toThrow(/unexpected host \(evil\.example\.com\)/);
    expect(evil.seen.map((s) => s.url)).toEqual([OK]); // the bad hop is never requested
    const http = fakeFetch({ [OK]: () => new Response(null, { status: 301, headers: { location: 'http://sketchfab-prod-media.s3.amazonaws.com/a.zip' } }) });
    await expect(downloadCapped(OK, { maxBytes: 10, fetchImpl: http.impl })).rejects.toThrow(/unexpected host/);
    const loop = fakeFetch({ [OK]: () => new Response(null, { status: 302, headers: { location: OK } }) });
    await expect(downloadCapped(OK, { maxBytes: 10, fetchImpl: loop.impl })).rejects.toThrow(/too many redirects/);
  });

  it('stops a download at the byte limit even without (or with a lying) Content-Length', async () => {
    const body = () =>
      new ReadableStream({
        start(c) {
          for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(4));
          c.close();
        },
      });
    const noLen = fakeFetch({ [OK]: () => new Response(body()) });
    await expect(downloadCapped(OK, { maxBytes: 10, fetchImpl: noLen.impl })).rejects.toThrow(/too large/);
    const lying = fakeFetch({ [OK]: () => new Response(body(), { headers: { 'content-length': '4' } }) });
    await expect(downloadCapped(OK, { maxBytes: 10, fetchImpl: lying.impl })).rejects.toThrow(/too large/);
  });

  it('extracts archives within entry-count and inflated-size limits', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-zip-'));
    try {
      const zip = zipSync({ 'scene.gltf': new TextEncoder().encode('{}'), 'textures/a.png': new Uint8Array(10) });
      expect(extractZip(zip, path.join(dir, 'ok'))).toBe(2);
      expect(fs.existsSync(path.join(dir, 'ok', 'textures', 'a.png'))).toBe(true);
      // 5 MB of zeros compresses to a few kB: the inflated bytes are what count.
      const bomb = zipSync({ 'big.bin': new Uint8Array(5 * 1024 * 1024) }, { level: 9 });
      expect(bomb.length).toBeLessThan(100_000);
      expect(() => extractZip(bomb, path.join(dir, 'bomb'), { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 })).toThrow(/size limit/);
      expect(fs.existsSync(path.join(dir, 'bomb', 'big.bin'))).toBe(false);
      const many = zipSync(Object.fromEntries(Array.from({ length: 6 }, (_, i) => ['f' + i + '.txt', new Uint8Array(1)])));
      expect(() => extractZip(many, path.join(dir, 'many'), { maxEntries: 5, maxEntryBytes: 100, maxTotalBytes: 100 })).toThrow(/more than 5 files/);
      // A header that understates the size: the inflated bytes are counted and inflation stops
      // within one small chunk of the limit (a single-shot inflate would expand all 32 MB first).
      const big = zipSync({ 'lie.bin': new Uint8Array(32 * 1024 * 1024) }, { level: 9 });
      expect(new DataView(big.buffer, big.byteOffset).getUint32(22, true)).toBe(32 * 1024 * 1024); // local header size field
      new DataView(big.buffer, big.byteOffset).setUint32(22, 100, true);
      const stats: { inflated?: number } = {};
      expect(() => extractZip(big, path.join(dir, 'lie'), { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 }, stats)).toThrow(/size limit/);
      expect(stats.inflated).toBeGreaterThan(1024 * 1024);
      expect(stats.inflated).toBeLessThan(1024 * 1024 + 18 * 1024 * 1024);
      // An honest header over the limit is refused before anything is inflated.
      const honest: { inflated?: number } = {};
      expect(() => extractZip(bomb, path.join(dir, 'bomb2'), { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 }, honest)).toThrow(/size limit/);
      expect(honest.inflated).toBe(0);
      const slip = zipSync({ '../escape.txt': new Uint8Array(1) });
      expect(() => extractZip(slip, path.join(dir, 'slip'))).toThrow(/unsafe path/);
      expect(fs.existsSync(path.join(dir, 'escape.txt'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads glTF resources only from inside the model folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gltf-'));
    const dir = path.join(root, 'model');
    try {
      fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
      fs.writeFileSync(path.join(root, 'secret.txt'), 'TOKEN-123');
      fs.writeFileSync(path.join(dir, 'textures', 'a.png'), 'x');
      const inside = fs.realpathSync(path.join(dir, 'textures', 'a.png'));
      expect(resourcePath(dir, 'textures/a.png')).toBe(inside);
      expect(resourcePath(dir, 'textures%2Fa.png')).toBe(inside);
      for (const bad of ['../secret.txt', '%2e%2e/secret.txt', '..%5csecret.txt', 'textures/../../secret.txt', path.join(root, 'secret.txt'), '/etc/passwd', 'C:/Windows/win.ini', 'file:///c:/x', 'https://example.com/a.bin', '%E0%A4%A', ''])
        expect(() => resourcePath(dir, bad), bad).toThrow();
      // A directory junction (symlink) inside the folder that points outside it.
      fs.symlinkSync(root, path.join(dir, 'link'), 'junction');
      expect(() => resourcePath(dir, 'link/secret.txt')).toThrow(/outside the model folder/);

      // A real glTF loads with its buffer inside the folder; pointing the buffer or an image outside is refused.
      const doc = new Document();
      const buffer = doc.createBuffer('main').setURI('scene.bin');
      const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
      doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos))));
      const io = new NodeIO();
      await io.write(path.join(dir, 'scene.gltf'), doc);
      const loaded = (await readConfined(io, path.join(dir, 'scene.gltf'), dir)) as Document;
      expect(loaded.getRoot().listAccessors().length).toBe(1);
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'scene.gltf'), 'utf8'));
      json.buffers[0].uri = '../secret.txt';
      fs.writeFileSync(path.join(dir, 'evil.gltf'), JSON.stringify(json));
      await expect(readConfined(io, path.join(dir, 'evil.gltf'), dir)).rejects.toThrow(/outside the model folder/);
      json.buffers[0].uri = 'scene.bin';
      json.images = [{ uri: 'link/secret.txt' }];
      fs.writeFileSync(path.join(dir, 'evil2.gltf'), JSON.stringify(json));
      await expect(readConfined(io, path.join(dir, 'evil2.gltf'), dir)).rejects.toThrow(/outside the model folder/);

      // A GLB whose JSON references an external file is refused too.
      const glbJson = JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: '../secret.txt', mimeType: 'image/png' }] });
      const text = new TextEncoder().encode(glbJson.padEnd(Math.ceil(glbJson.length / 4) * 4, ' '));
      const glb = new Uint8Array(20 + text.length);
      const dv = new DataView(glb.buffer);
      dv.setUint32(0, 0x46546c67, true);
      dv.setUint32(4, 2, true);
      dv.setUint32(8, glb.length, true);
      dv.setUint32(12, text.length, true);
      dv.setUint32(16, 0x4e4f534a, true);
      glb.set(text, 20);
      fs.writeFileSync(path.join(dir, 'evil.glb'), glb);
      await expect(readConfined(io, path.join(dir, 'evil.glb'), dir)).rejects.toThrow(/external/i);
      // The model file itself must be inside the folder.
      await expect(readConfined(io, path.join(root, 'secret.txt'), dir)).rejects.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the canonical Sketchfab page when the API gives one for this model', () => {
    const uid = '259de41be0c7410e86b7e79be33d6b3a';
    expect(sourceUrlFor(uid, 'https://sketchfab.com/3d-models/boeing737-' + uid)).toBe('https://sketchfab.com/3d-models/boeing737-' + uid);
    expect(sourceUrlFor(uid, 'https://evil.example.com/3d-models/x-' + uid)).toBe('https://sketchfab.com/3d-models/' + uid);
    expect(sourceUrlFor(uid, 'https://sketchfab.com/3d-models/other-' + '0'.repeat(32))).toBe('https://sketchfab.com/3d-models/' + uid);
    expect(sourceUrlFor(uid, null)).toBe('https://sketchfab.com/3d-models/' + uid);
  });

  it('credits the account name when a display name contains an e-mail address', () => {
    expect(cleanAuthor({ displayName: 'Configcars : someone@example.com', username: 'configcars' })).toBe('configcars');
    expect(cleanAuthor({ displayName: 'Luca Martina', username: 'lm' })).toBe('Luca Martina');
    expect(cleanAuthor(null)).toBe('unknown');
  });

  it('the shortlist has unique ids and uids and sane entries', () => {
    const ids = new Set<string>();
    const uids = new Set<string>();
    for (const m of shortlist.models as { id: string; uid: string; kind: string; lengthM: number; icao?: string[]; vessel?: string }[]) {
      expect(m.id).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(m.uid).toMatch(/^[0-9a-f]{32}$/);
      expect(ids.has(m.id) || uids.has(m.uid)).toBe(false);
      ids.add(m.id);
      uids.add(m.uid);
      expect(m.lengthM).toBeGreaterThan(2);
      if (m.kind === 'aircraft') expect(m.icao?.length).toBeGreaterThan(0);
      else expect(m.vessel).toBeTruthy();
    }
    // A type code maps to at most one model.
    const codes = (shortlist.models as { icao?: string[] }[]).flatMap((m) => m.icao ?? []);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('model pack index', () => {
  const good = {
    id: 'a320', file: 'a320.glb', kind: 'aircraft', icao: ['A320', 'A20N'], military: false, lengthM: 37.6, widthM: 35.8, heightM: 11.8,
    title: 'A320neo', author: 'someone', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://sketchfab.com/3d-models/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', tris: 30000,
  };
  const ship = { ...good, id: 'tug', file: 'tug.glb', kind: 'ship', icao: undefined, vessel: 'tug', lengthM: 30, widthM: 10, heightM: 12, title: 'Tug' };
  const heli = { ...good, id: 'sh60', file: 'sh60.glb', icao: ['H60'], military: true, lengthM: 19.8, widthM: 16.4, heightM: 5.2, title: 'Seahawk' };

  it('keeps valid entries and drops invalid ones', () => {
    const pack = parsePackIndex({
      version: 1,
      models: [
        good, ship, heli,
        { ...good, id: 'x1', file: 'other.glb' },
        { ...good, id: '../x', file: '../x.glb' },
        { ...good, id: 'x2', file: 'x2.glb', license: 'CC BY-NC 4.0' },
        { ...good, id: 'x3', file: 'x3.glb', sourceUrl: 'https://evil.example.com/3d-models/x' },
        { ...good, id: 'x4', file: 'x4.glb', sourceUrl: 'http://sketchfab.com/3d-models/x' },
        { ...good, id: 'x5', file: 'x5.glb', lengthM: Number.NaN },
        { ...good, id: 'x6', file: 'x6.glb', icao: [] },
        { ...ship, id: 'x7', file: 'x7.glb', vessel: 'submarine' },
        { ...good, id: 'x8', file: 'x8.glb', title: '\u0000' },
        null, 'junk',
      ],
    });
    expect(pack.models.map((m) => m.id)).toEqual(['a320', 'tug', 'sh60']);
    expect(pack.rejected).toBe(11);
    expect(pack.error).toBeNull();
    expect(pack.models[0].licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
  });

  it('reports an unusable index instead of treating it as no pack', () => {
    const v2 = parsePackIndex({ version: 2, models: [good] });
    expect(v2.models).toEqual([]);
    expect(v2.error).toMatch(/unsupported model index version \(2\)/);
    expect(parsePackIndex({ error: 'broken' }).error).toMatch(/version/);
    expect(parsePackIndex({ version: 1 }).error).toMatch(/no model list/);
    expect(parsePackIndex([good]).error).toMatch(/not a model index/);
    expect(parsePackIndex(null).error).toMatch(/not a model index/);
    expect(parsePackIndex({ version: 1, models: [{ id: 'bad' }, {}] })).toMatchObject({ rejected: 2, error: 'all 2 model entries are invalid' });
    // A valid, empty index is not an error (nothing imported yet).
    expect(parsePackIndex({ version: 1, models: [] })).toMatchObject({ models: [], rejected: 0, error: null });
  });

  it('matches aircraft by type (paint must match military/civil) and ships by category', () => {
    const pack = parsePackIndex({ version: 1, models: [good, ship, heli] });
    expect(packForAircraft(pack, 'a20n ', false)?.id).toBe('a320');
    expect(packForAircraft(pack, 'A320', true)).toBeNull(); // military A320 keeps the grey built model
    expect(packForAircraft(pack, 'H60', true)?.id).toBe('sh60');
    expect(packForAircraft(pack, 'H60', false)).toBeNull();
    expect(packForAircraft(pack, 'B738', false)).toBeNull();
    expect(packForAircraft(pack, null, false)).toBeNull();
    expect(packForAircraft(null, 'A320', false)).toBeNull();
    expect(packForVessel(pack, 'tug')?.id).toBe('tug');
    expect(packForVessel(pack, 'military')).toBeNull();
    expect(packForVessel(pack, 'unknown')).toBeNull();
    expect(packForVessel(pack, 'cargo')).toBeNull();
    expect(packCredit(pack.models[0])).toContain('by someone (CC BY 4.0)');
  });

  it('uses a legacy CRJ-900 pack only for the CRJ-900, even when its old index also listed the CRJ-1000', () => {
    const crj = { ...good, icao: ['CRJ9', 'CRJX'], sourceUrl: 'https://sketchfab.com/3d-models/airplane-crj-900-cityjet-02c4fa44604243c2bb48db64506a39af' };
    const pack = parsePackIndex({ version: 1, models: [crj] });
    expect(packForAircraft(pack, 'CRJ9', false)).toBeTruthy();
    expect(packForAircraft(pack, 'CRJX', false)).toBeNull();
  });

  it('rejects a second entry with the same id (one id = one model file and credit)', () => {
    const dupMil = { ...good, military: true, title: 'A320 grey', lengthM: 44 };
    const pack = parsePackIndex({ version: 1, models: [good, dupMil] });
    expect(pack.models).toHaveLength(1);
    expect(pack.models[0].title).toBe('A320neo');
    expect(pack.rejected).toBe(1);
    expect(packForAircraft(pack, 'A320', true)).toBeNull();
  });

  it('keeps a civil and a military model of the same type both reachable', () => {
    const milA320 = { ...good, id: 'a320mil', file: 'a320mil.glb', military: true, title: 'A320 grey' };
    const pack = parsePackIndex({ version: 1, models: [good, milA320] });
    expect(packForAircraft(pack, 'A320', false)?.id).toBe('a320');
    expect(packForAircraft(pack, 'A320', true)?.id).toBe('a320mil');
    const milShip = { ...ship, id: 'tugmil', file: 'tugmil.glb', military: true };
    expect(packForVessel(parsePackIndex({ version: 1, models: [milShip, ship] }), 'tug')?.id).toBe('tug');
  });

  it('scales to the vehicle, keeping width within ±25 % of the length scale', () => {
    const m = parsePackIndex({ version: 1, models: [good] }).models[0];
    expect(packScale(m, 37.6, 35.8)).toEqual([1, 1, 1]);
    const [sx, sy, sz] = packScale(m, 44.5, 35.8); // A321: longer, same span
    expect(sx).toBeCloseTo(44.5 / 37.6);
    expect(sy).toBeCloseTo(1);
    expect(sz).toBeCloseTo(Math.sqrt(sx * sy));
    expect(packScale(m, 37.6, 1)[1]).toBeCloseTo(0.75);
    expect(packScale(m, 37.6, 500)[1]).toBeCloseTo(1.25);
    expect(packScale(m, 37.6, Number.NaN)[1]).toBeCloseTo(1);
  });
});

describe('shown-model registry (details-panel credit follows the drawn model)', () => {
  it('tracks the ready variant per vehicle and notifies only on changes', () => {
    const events: number[] = [];
    const off = subscribeShownModels(() => events.push(1));
    const k = 'rec|aircraft|abc123';
    expect(shownModelVariant(k)).toBeNull();
    setShownModel(k, 'pack:a320');
    setShownModel(k, 'pack:a320'); // unchanged: no event
    expect(shownModelVariant(k)).toBe('pack:a320');
    expect(packIdOf(shownModelVariant(k))).toBe('a320');
    setShownModel(k, 'air:narrowbody:2:wing:lo:c:j::civ'); // fell back to the built model
    expect(packIdOf(shownModelVariant(k))).toBeNull();
    setShownModel(k, null); // back to an icon
    expect(shownModelVariant(k)).toBeNull();
    setShownModel('rec|vessels|1', 'pack:tug');
    clearShownModels(['rec|vessels|1', 'rec|vessels|nope']);
    expect(shownModelVariant('rec|vessels|1')).toBeNull();
    expect(events.length).toBe(5);
    off();
    setShownModel(k, 'pack:a320');
    expect(events.length).toBe(5);
    setShownModel(k, null);
  });
});

describe('Sketchfab token handling', () => {
  it('accepts one token and refuses anything that could carry extra text into a header', () => {
    const t = '0123456789abcdef0123456789abcdef';
    expect(validToken(t)).toBe(t);
    expect(validToken(`  ${t}\r\n`)).toBe(t);
    for (const bad of [`${t}\nextra line`, `token: ${t}`, `${t} ${t}`, 'short', '', null, 42, `${t}\u0000`]) expect(validToken(bad), String(bad)).toBeNull();
  });

  it('redacts the token (and its URL-encoded form) from printed messages', () => {
    const t = 'abc_DEF-123456789012345';
    expect(redactSecret(`Authorization: Token ${t} rejected`, t)).toBe('Authorization: Token [token] rejected');
    expect(redactSecret('nothing here', t)).toBe('nothing here');
    expect(redactSecret('x', null)).toBe('x');
  });
});
