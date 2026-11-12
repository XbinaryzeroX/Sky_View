import { describe, expect, it } from 'vitest';
import { CLASS_DEFAULTS, VESSEL_DEFAULTS, aircraftShape, aircraftVariant, pitchFromRates, vesselShape } from '../src/shared/vehicleDims';
import { buildAircraft, buildVessel, type VehicleModelSpec } from '../src/renderer/map/vehicleMeshes';
import { writeGlb, type Geometry } from '../src/renderer/map/glb';
import { classifyAircraft, classifyVessel, type AircraftSymbol, type VesselSymbol } from '../src/shared/vehicleClass';
import aircraftTypeShapes from '../src/shared/aircraftTypeShapes.json';
import { Axis, Cartesian3, Matrix4 } from 'cesium';
import { placementMatrix } from '../src/renderer/map/vehicleModels';

/** Parses a GLB and checks it is structurally valid; returns the JSON and the position bounds. */
function inspectGlb(buf: ArrayBuffer, imageCount: number) {
  const view = new DataView(buf);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(buf.byteLength);
  const jsonLen = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binLen = view.getUint32(20 + jsonLen, true);
  expect(view.getUint32(24 + jsonLen, true)).toBe(0x004e4942);
  const binStart = 28 + jsonLen;
  expect(json.buffers[0].byteLength).toBeLessThanOrEqual(binLen);
  for (const bv of json.bufferViews) {
    expect(bv.byteOffset % 4).toBe(0);
    expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of json.meshes[0].primitives) {
    expect(prim.material).toBeLessThan(json.materials.length);
    const pos = json.accessors[prim.attributes.POSITION];
    const idx = json.accessors[prim.indices];
    expect(json.accessors[prim.attributes.NORMAL].count).toBe(pos.count);
    expect(idx.count % 3).toBe(0);
    const ibv = json.bufferViews[idx.bufferView];
    const ia = idx.componentType === 5125 ? new Uint32Array(buf, binStart + ibv.byteOffset, idx.count) : new Uint16Array(buf, binStart + ibv.byteOffset, idx.count);
    expect(Math.max(...ia)).toBeLessThan(pos.count);
    const pbv = json.bufferViews[pos.bufferView];
    const pa = new Float32Array(buf, binStart + pbv.byteOffset, pos.count * 3);
    expect(pa.every(Number.isFinite)).toBe(true);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos.min[k]);
      max[k] = Math.max(max[k], pos.max[k]);
    }
  }
  for (const m of json.materials) {
    const t = m.pbrMetallicRoughness.baseColorTexture;
    if (t) expect(t.index).toBeLessThan(imageCount);
    expect(m.doubleSided).toBe(true);
  }
  expect((json.images ?? []).length).toBe(imageCount);
  return { json, min, max };
}

/** Every triangle's winding must agree with its stored normals (double-sided materials flip normals on back faces). */
function windingAgrees(g: Geometry): number {
  let bad = 0;
  const P = (i: number) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
  const N = (i: number) => [g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]];
  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-9) continue;
    const m = [N(a), N(b), N(c)].reduce((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2]], [0, 0, 0]);
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) bad++;
  }
  return bad;
}

const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const glbOf = (spec: VehicleModelSpec) => inspectGlb(writeGlb(spec.parts, spec.materials, spec.textures.map(() => fakePng)), spec.textures.length);

describe('vehicle shapes', () => {
  it('uses real dimensions and layout for common ICAO types', () => {
    const a320 = aircraftShape('A320', 'A3');
    expect(a320).toMatchObject({ cls: 'narrowbody', lengthM: 37.6, spanM: 35.8, engines: 2, mount: 'wing', highWing: false, prop: false });
    expect(aircraftShape('CRJ9', null)).toMatchObject({ cls: 'regional', mount: 'tail', tTail: true });
    expect(aircraftShape('B744', null)).toMatchObject({ cls: 'widebody', engines: 4 });
    expect(aircraftShape('MD11', null)).toMatchObject({ trijet: true, engines: 3 });
    expect(aircraftShape('AT76', null)).toMatchObject({ cls: 'turboprop', highWing: true, tTail: true, prop: true });
    expect(aircraftShape('C172', null)).toMatchObject({ cls: 'light', mount: 'nose', highWing: true });
    expect(aircraftShape('EC35', null)).toMatchObject({ cls: 'helicopter', lengthM: 12.2, spanM: 10.2 });
  });
  it('falls back to the class defaults (type unknown, category known) and marks military paint', () => {
    expect(aircraftShape('ZZZZ', 'A5')).toMatchObject({ cls: 'widebody', ...CLASS_DEFAULTS.widebody });
    expect(aircraftShape(null, null).cls).toBe('unknown');
    const mil = aircraftShape('B738', null, true);
    expect(mil.military).toBe(true);
    expect(aircraftVariant(mil)).not.toBe(aircraftVariant(aircraftShape('B738', null)));
  });
  it('assigns every bundled FAA designator a model, including rotary and water-based aircraft with no emitter category', () => {
    const missing: string[] = [];
    for (const code of Object.keys(aircraftTypeShapes)) {
      const shape = aircraftShape(code, null);
      if (shape.cls === 'unknown' || !CLASS_DEFAULTS[shape.cls] || !Number.isInteger(shape.engines) || shape.lengthM <= 0 || shape.spanM <= 0) missing.push(code);
    }
    expect(missing).toEqual([]);
    expect(Object.keys(aircraftTypeShapes).length).toBeGreaterThan(2500);
    for (const code of ['B212', 'MD52', 'H269']) expect(classifyAircraft(code, 'A1')).toMatchObject({ symbol: 'helicopter', basis: 'type' });
    expect(aircraftShape('A002', null).cls).toBe('gyroplane');
    expect(aircraftShape('CL2T', null)).toMatchObject({ cls: 'seaplane', engines: 2, mount: 'wing', prop: true });
    expect(aircraftShape('B461', null)).toMatchObject({ cls: 'regional', engines: 4, mount: 'wing' });
    expect(aircraftShape('SHIP', null).cls).toBe('airship');
    expect(aircraftShape(null, 'B3').cls).toBe('parachute');
    expect(aircraftShape(null, 'A7').cls).toBe('helicopter');
  });
  it('keeps all AIS code ranges renderable, with distinct pilot, workboat, cargo and tanker models', () => {
    const classes = Array.from({ length: 100 }, (_, code) => classifyVessel(code).symbol);
    expect(classes.every(cls => !!VESSEL_DEFAULTS[cls])).toBe(true);
    expect(new Set(classes.slice(70, 80))).toEqual(new Set(['cargo']));
    expect(new Set(classes.slice(80, 90))).toEqual(new Set(['tanker']));
    expect(new Set(classes.slice(20, 30))).toEqual(new Set(['wingInGround']));
    expect(classes[50]).toBe('pilot');
    expect(classes[51]).toBe('service');
    expect(classes[53]).toBe('workboat');
    expect(classes[99]).toBe('unknown');
    for (const invalid of [-1, 34.5, NaN, 100]) expect(classifyVessel(invalid).basis).toBe('unknown');
  });
  it('uses separately cacheable geometry for civil rotor configurations', () => {
    const r44 = aircraftShape('R44', null), md = aircraftShape('MD52', null), h135 = aircraftShape('EC35', null);
    expect(r44.rotorBlades).toBe(2);
    expect(md).toMatchObject({ rotorBlades: 5, tailRotor: 'none' });
    expect(h135).toMatchObject({ rotorBlades: 4, tailRotor: 'ducted' });
    expect(new Set([r44, md, h135].map(aircraftVariant)).size).toBe(3);
    for (const shape of [r44, md, h135]) {
      const spec = buildAircraft(shape);
      const blades = spec.parts.find(p => spec.materials[p.material].name === 'rotor-blades');
      expect(blades?.geometry.indices.length).toBe(shape.rotorBlades! * 6);
      expect(spec.parts.some(p => spec.materials[p.material].name === 'prop')).toBe(shape.tailRotor !== 'none');
      expect(spec.parts.every(p => windingAgrees(p.geometry) === 0)).toBe(true);
      glbOf(spec);
    }
  });
  it('sizes ships from AIS length and beam, with plausibility checks', () => {
    expect(vesselShape(71, 300, 48)).toEqual({ cls: 'cargo', lengthM: 300, beamM: 48, reported: true });
    const odd = vesselShape(80, 250, 1.5); // beam implausible for the length: class proportion
    expect(odd.beamM).toBeCloseTo(250 * (VESSEL_DEFAULTS.tanker.beamM / VESSEL_DEFAULTS.tanker.lengthM), 5);
    expect(vesselShape(30, null, null)).toEqual({ cls: 'fishing', ...VESSEL_DEFAULTS.fishing, reported: false });
    expect(vesselShape(null, 900, 20).reported).toBe(false); // outside the AIS range
    expect(vesselShape(71, 100, 5).beamM).toBe(5); // 5 % of length: inclusive lower bound
    expect(vesselShape(71, 100, 60).beamM).toBe(60); // 60 %: inclusive upper bound
    expect(vesselShape(71, 200, 80).beamM).not.toBe(80); // over 70 m absolute: class proportion instead
    // The proportional fallback obeys the same limits.
    expect(vesselShape(30, 460, null).beamM).toBeLessThanOrEqual(70);
    expect(vesselShape(71, 3, null).beamM).toBeGreaterThanOrEqual(1);
    expect(vesselShape(71, 3, null).beamM).toBeLessThanOrEqual(1.8);
  });
  it('derives a limited climb angle from vertical rate and ground speed', () => {
    expect((pitchFromRates(2000, 250) * 180) / Math.PI).toBeCloseTo(4.5, 0);
    expect((pitchFromRates(-30000, 200) * 180) / Math.PI).toBeCloseTo(-15, 5);
    expect(pitchFromRates(1500, 20)).toBe(0); // taxiing or hovering
    expect(pitchFromRates(null, 300)).toBe(0);
  });
});

describe('app-built 3D models', () => {
  const aircraftClasses = Object.keys(CLASS_DEFAULTS) as AircraftSymbol[];
  it.each(aircraftClasses)('builds a valid %s model with the class proportions', (cls) => {
    const shape = { cls, ...CLASS_DEFAULTS[cls], military: false };
    const spec = buildAircraft(shape);
    for (const p of spec.parts) expect(windingAgrees(p.geometry)).toBe(0);
    const { min, max, json } = glbOf(spec);
    expect(json.meshes[0].primitives.length).toBeGreaterThan(0);
    const length = max[2] - min[2];
    const span = max[0] - min[0];
    expect(min[1]).toBeCloseTo(0, 6); // rests on its lowest point (ground contact at the origin)
    if (cls === 'balloon') {
      expect(max[1] - min[1]).toBeCloseTo(CLASS_DEFAULTS.balloon.lengthM, 0);
    } else {
      // Length along +Z (nose forward), span (or rotor diameter) along X.
      const longitudinalExtent = cls === 'gyroplane' ? Math.max(shape.lengthM, shape.spanM) : shape.lengthM;
      expect(length).toBeGreaterThan(longitudinalExtent * 0.85);
      expect(length).toBeLessThan(longitudinalExtent * 1.3);
      expect(span).toBeGreaterThan(CLASS_DEFAULTS[cls].spanM * 0.9);
      expect(span).toBeLessThan(CLASS_DEFAULTS[cls].spanM * 1.1);
    }
  });
  it.each([
    ['B744', 'four wing engines'], ['MD11', 'trijet'], ['CRJ9', 'tail engines, T-tail'], ['AT76', 'high-wing turboprop'], ['C172', 'nose propeller'],
  ])('builds %s (%s)', (type) => {
    const shape = aircraftShape(type, null);
    expect(glbOf(buildAircraft(shape)).json.meshes[0].primitives.length).toBeGreaterThan(3);
    expect(glbOf(buildAircraft({ ...shape, military: true })).json.images ?? []).toHaveLength(0); // military paint is untextured
  });
  const vesselClasses = Object.keys(VESSEL_DEFAULTS) as VesselSymbol[];
  it.each(vesselClasses)('builds a valid %s ship sitting in the water', (cls) => {
    const spec = buildVessel(cls);
    for (const p of spec.parts) expect(windingAgrees(p.geometry)).toBe(0);
    const { min, max } = glbOf(spec);
    const d = VESSEL_DEFAULTS[cls];
    expect(max[2] - min[2]).toBeCloseTo(d.lengthM, 0);
    expect(max[0] - min[0]).toBeGreaterThan(d.beamM * 0.95);
    expect(max[0] - min[0]).toBeLessThan(d.beamM * 1.1);
    expect(min[1]).toBeLessThan(0); // hull below the waterline
    expect(max[1]).toBeGreaterThan(0);
  });
});


describe('model placement', () => {
  // Cesium converts glTF (+Z forward, +Y up, +X left) with Y_UP_TO_Z_UP · Z_UP_TO_X_UP (Model forwardAxis Z).
  // These constants exist at runtime but are not in Cesium's type declarations.
  const axes = Axis as unknown as { Y_UP_TO_Z_UP: Matrix4; Z_UP_TO_X_UP: Matrix4 };
  const corr = Matrix4.multiplyTransformation(axes.Y_UP_TO_Z_UP, axes.Z_UP_TO_X_UP, new Matrix4());
  const toWorld = (m: Matrix4, v: [number, number, number]) => {
    const local = Matrix4.multiplyByPointAsVector(corr, new Cartesian3(...v), new Cartesian3());
    return Cartesian3.normalize(Matrix4.multiplyByPointAsVector(m, local, new Cartesian3()), new Cartesian3());
  };
  it('points the nose along the heading and keeps the top up', () => {
    // At lat 0, lon 0: east = +Y, north = +Z, up = +X in Earth-fixed coordinates.
    const at = Cartesian3.fromDegrees(0, 0, 0);
    const east = placementMatrix(at, Math.PI / 2, 0, [1, 1, 1]);
    expect(toWorld(east, [0, 0, 1]).y).toBeCloseTo(1, 6); // glTF forward → east
    expect(toWorld(east, [0, 1, 0]).x).toBeCloseTo(1, 6); // glTF up → up
    expect(toWorld(east, [1, 0, 0]).z).toBeCloseTo(1, 6); // glTF left → north when heading east
    const north = placementMatrix(at, 0, 0, [1, 1, 1]);
    expect(toWorld(north, [0, 0, 1]).z).toBeCloseTo(1, 6);
    const climbing = placementMatrix(at, 0, Math.PI / 12, [1, 1, 1]);
    expect(toWorld(climbing, [0, 0, 1]).x).toBeCloseTo(Math.sin(Math.PI / 12), 6); // nose up 15°
  });
  it('applies per-instance length, width and height scale', () => {
    const m = placementMatrix(Cartesian3.fromDegrees(0, 0, 0), 0, 0, [2, 3, 4]);
    const len = (v: [number, number, number]) => Cartesian3.magnitude(Matrix4.multiplyByPointAsVector(m, Matrix4.multiplyByPointAsVector(corr, new Cartesian3(...v), new Cartesian3()), new Cartesian3()));
    expect(len([0, 0, 1])).toBeCloseTo(2, 6);
    expect(len([1, 0, 0])).toBeCloseTo(3, 6);
    expect(len([0, 1, 0])).toBeCloseTo(4, 6);
  });
  it('banks right while keeping the nose along its direction of travel', () => {
    const at = Cartesian3.fromDegrees(0, 0, 0);
    const banked = placementMatrix(at, 0, 0, [1, 1, 1], undefined, Math.PI / 6);
    expect(toWorld(banked, [0, 0, 1]).z).toBeCloseTo(1, 6);
    expect(toWorld(banked, [1, 0, 0]).x).toBeCloseTo(0.5, 6); // left wing rises
    expect(toWorld(banked, [0, 1, 0]).x).toBeCloseTo(Math.cos(Math.PI / 6), 6);
  });
});
