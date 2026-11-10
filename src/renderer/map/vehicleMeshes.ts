// App-built 3D models for aircraft and ships (pure geometry; textures are supplied by
// the caller as PNG bytes). Representative shapes with generic paint: they show the
// kind, size, proportions and engine layout of the vehicle, not its actual livery.
//
// Axes (glTF): +Z forward, +Y up, +X left; units metres. Aircraft are built at their
// class's default size and ships at their class's default length and beam; each
// instance is scaled to the vehicle's own dimensions (see vehicleModels.ts).

import { CLASS_DEFAULTS, VESSEL_DEFAULTS, type AircraftShape } from '../../shared/vehicleDims';
import type { VesselSymbol } from '../../shared/vehicleClass';
import { box, boxAll, disc, lathe, loft, merge, mirrorX, slab, translate, triangle, zToUp, type Geometry, type GlbMaterial } from './glb';

/** Texture slots the caller must provide, in this order. */
export type TextureSlot = 'fuselage' | 'windows';

export interface VehicleModelSpec {
  parts: { geometry: Geometry; material: number }[];
  materials: GlbMaterial[];
  /** Which generated texture each image index is. */
  textures: { slot: TextureSlot; key: string }[];
}

const rgb = (hex: string, a = 1): [number, number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  // glTF base colours are linear; convert from sRGB so the paint looks as specified.
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), a];
};

class Builder {
  materials: GlbMaterial[] = [];
  textures: { slot: TextureSlot; key: string }[] = [];
  private byMat = new Map<number, Geometry[]>();
  private names = new Map<string, number>();

  mat(name: string, m: Omit<GlbMaterial, 'name'>): number {
    const hit = this.names.get(name);
    if (hit !== undefined) return hit;
    this.materials.push({ name, ...m });
    this.names.set(name, this.materials.length - 1);
    return this.materials.length - 1;
  }

  texture(slot: TextureSlot, key: string): number {
    const i = this.textures.findIndex((t) => t.slot === slot && t.key === key);
    if (i >= 0) return i;
    this.textures.push({ slot, key });
    return this.textures.length - 1;
  }

  add(material: number, ...g: Geometry[]): void {
    const list = this.byMat.get(material) ?? [];
    list.push(...g);
    this.byMat.set(material, list);
  }

  done(): VehicleModelSpec {
    const parts = [...this.byMat].map(([material, gs]) => ({ material, geometry: merge(...gs) }));
    return { parts, materials: this.materials, textures: this.textures };
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const both = (g: Geometry) => [g, mirrorX(g)];

// Fuselage diameter as a fraction of length, by class.
const DIAMETER: Record<string, number> = { widebody: 0.093, narrowbody: 0.103, regional: 0.098, turboprop: 0.105, bizjet: 0.12, light: 0.14, glider: 0.09, drone: 0.2, unknown: 0.103 };

/** Builds an aircraft model at its class's default size, with its lowest point at y = 0 (ground contact). */
export function buildAircraft(s: AircraftShape): VehicleModelSpec {
  const spec = buildAircraftCentred(s);
  let minY = Infinity;
  for (const p of spec.parts) for (let i = 1; i < p.geometry.positions.length; i += 3) minY = Math.min(minY, p.geometry.positions[i]);
  if (!Number.isFinite(minY)) return spec;
  return { ...spec, parts: spec.parts.map((p) => ({ ...p, geometry: translate(p.geometry, 0, -minY, 0) })) };
}

function buildAircraftCentred(s: AircraftShape): VehicleModelSpec {
  const b = new Builder();
  const { lengthM: L, spanM: S } = CLASS_DEFAULTS[s.cls];
  const mil = s.military;
  const paint = mil ? '#7b858f' : '#f3f5f7';
  const fus = mil
    ? b.mat('fuselage-mil', { color: rgb(paint), metallic: 0.2, roughness: 0.75 })
    : b.mat('fuselage', { color: [1, 1, 1, 1], metallic: 0.02, roughness: 0.5, texture: b.texture('fuselage', s.cls) });
  const wingM = b.mat('wing', { color: rgb(mil ? '#727c86' : '#c7ccd2'), metallic: 0.1, roughness: 0.55 });
  const engM = b.mat('engine', { color: rgb(mil ? '#5d666f' : '#aeb4bb'), metallic: 0.3, roughness: 0.4 });
  const tailM = b.mat('tail', { color: rgb(mil ? '#727c86' : '#f3f5f7'), metallic: 0.02, roughness: 0.5 });
  const propM = b.mat('prop', { color: rgb('#202428', 0.45), metallic: 0, roughness: 0.8, blend: true });

  if (s.cls === 'helicopter') return helicopter(b, L, S, fus, tailM, propM, engM);
  if (s.cls === 'balloon') return balloon(b, L, S, mil);

  const R = (L * (DIAMETER[s.cls] ?? 0.103)) / 2;
  // Fuselage: nose at +L/2, tail cone rising at -L/2. u runs nose → tail for the window texture.
  b.add(
    fus,
    lathe(
      [
        { z: L / 2, r: R * 0.02, y: -R * 0.15 },
        { z: L / 2 - 0.035 * L, r: R * 0.62, y: -R * 0.08 },
        { z: L / 2 - 0.09 * L, r: R * 0.93, y: 0 },
        { z: L / 2 - 0.15 * L, r: R, y: 0 },
        { z: -L / 2 + 0.3 * L, r: R, y: 0 },
        { z: -L / 2 + 0.13 * L, r: R * 0.62, y: R * 0.25 },
        { z: -L / 2 + 0.03 * L, r: R * 0.22, y: R * 0.45 },
        { z: -L / 2, r: R * 0.06, y: R * 0.5 },
      ],
      20,
    ),
  );

  // Wings.
  const airliner = ['widebody', 'narrowbody', 'regional', 'unknown'].includes(s.cls);
  const sweep = rad(s.prop ? 3 : airliner ? 27 : s.cls === 'bizjet' ? 24 : s.cls === 'glider' ? 0 : 5);
  const rootChord = L * (s.prop ? (s.cls === 'light' || s.cls === 'drone' ? 0.17 : 0.1) : s.cls === 'glider' ? 0.1 : s.cls === 'bizjet' ? 0.13 : 0.17);
  const taper = s.prop ? (s.cls === 'light' ? 0.9 : 0.6) : s.cls === 'glider' ? 0.4 : 0.3;
  const wingY = s.highWing ? R * 0.92 : -R * 0.55;
  const dihedral = rad(s.highWing ? 1.5 : 5);
  const rootX = R * 0.7;
  const rootZ = (s.cls === 'light' || s.cls === 'glider' || s.cls === 'drone' ? 0.16 : s.mount === 'tail' ? 0.06 : 0.12) * L + rootChord / 2;
  const tipX = S / 2;
  const reach = tipX - rootX;
  const wingAt = (x: number) => ({ y: wingY + (x - rootX) * Math.tan(dihedral), zLE: rootZ - (x - rootX) * Math.tan(sweep), chord: rootChord * (1 - (1 - taper) * ((x - rootX) / reach)) });
  const tip = wingAt(tipX);
  b.add(wingM, ...both(slab([rootX, wingY, rootZ], rootChord, [tipX, tip.y, tip.zLE], tip.chord, rootChord * 0.12)));

  // Tail: vertical fin and horizontal stabiliser (conventional or T-tail).
  const finH = L * (s.cls === 'widebody' ? 0.15 : s.cls === 'light' ? 0.17 : 0.18);
  const finRoot = L * (s.cls === 'light' ? 0.14 : 0.16);
  const finSweep = rad(s.prop && !s.tTail ? 20 : 38);
  const finZ = -L / 2 + 0.03 * L + finRoot;
  const finY0 = R * 0.35;
  const finTipZ = finZ - finH * Math.tan(finSweep);
  b.add(tailM, slab([0, finY0, finZ], finRoot, [0, finY0 + finH, finTipZ], finRoot * 0.4, finRoot * 0.12, true));
  const hsSpan = S * (s.cls === 'light' ? 0.34 : s.cls === 'glider' ? 0.18 : 0.32);
  const hsRoot = L * (s.cls === 'light' ? 0.1 : 0.09);
  const hsSweep = rad(s.prop ? 6 : 30);
  const hsY = s.tTail ? finY0 + finH * 0.97 : R * 0.3;
  const hsZ = s.tTail ? finTipZ + 0.01 * L : -L / 2 + 0.05 * L + hsRoot;
  const hsTipZ = hsZ - (hsSpan / 2) * Math.tan(hsSweep);
  b.add(s.tTail ? tailM : wingM, ...both(slab([s.tTail ? 0 : R * 0.3, hsY, hsZ], hsRoot, [hsSpan / 2, hsY + hsSpan * 0.03, hsTipZ], hsRoot * 0.45, hsRoot * 0.1)));

  // Engines.
  const nacelle = (len: number, r: number) =>
    lathe([{ z: len / 2, r: r * 0.92 }, { z: len * 0.38, r }, { z: -len * 0.3, r: r * 0.95 }, { z: -len / 2, r: r * 0.55 }], 14);
  if (s.mount === 'wing' && s.engines >= 2) {
    const jetLen = L * (s.cls === 'widebody' ? 0.1 : 0.12);
    const jetR = L * (s.cls === 'widebody' ? 0.034 : 0.03);
    const fractions = s.engines >= 4 ? [0.36, 0.64] : [s.prop ? 0.3 : 0.34];
    for (const f of fractions) {
      const x = rootX + f * reach;
      const w = wingAt(x);
      if (s.prop) {
        const len = L * 0.14;
        const r = L * 0.024;
        const y = s.highWing ? w.y - r * 0.4 : w.y + r * 0.5;
        const z = w.zLE + len * 0.35;
        b.add(engM, ...both(translate(nacelle(len, r), x, y, z)));
        b.add(propM, ...both(disc([x, y, z + len / 2 + 0.01 * L], L * 0.075, 'z')));
      } else {
        const y = w.y - jetR * 1.15;
        const z = w.zLE + jetLen * 0.3;
        b.add(engM, ...both(translate(nacelle(jetLen, jetR), x, y, z)));
      }
    }
  } else if (s.mount === 'tail' && s.engines >= 1) {
    const len = L * 0.15;
    const r = L * (s.cls === 'bizjet' ? 0.035 : 0.032);
    const z = -L / 2 + 0.24 * L;
    if (s.engines === 1) b.add(engM, translate(nacelle(len, r), 0, R * 1.05, z));
    else b.add(engM, ...both(translate(nacelle(len, r), R + r * 1.1, R * 0.35, z)));
  } else if (s.mount === 'nose') {
    b.add(engM, lathe([{ z: L / 2 + L * 0.05, r: R * 0.05 }, { z: L / 2, r: R * 0.35 }], 10));
    b.add(propM, disc([0, 0, L / 2 + L * 0.035], L * 0.11, 'z'));
  }
  if (s.trijet) b.add(engM, translate(nacelle(L * 0.12, L * 0.03), 0, finY0 + L * 0.02, -L / 2 + 0.14 * L));
  return b.done();
}

function helicopter(b: Builder, L: number, rotorD: number, fus: number, tailM: number, rotorM: number, engM: number): VehicleModelSpec {
  const R = L * 0.115;
  b.add(fus, lathe([{ z: L * 0.42, r: R * 0.1, y: -R * 0.2 }, { z: L * 0.36, r: R * 0.75, y: -R * 0.05 }, { z: L * 0.22, r: R }, { z: L * 0.02, r: R * 0.95, y: R * 0.05 }, { z: -L * 0.08, r: R * 0.45, y: R * 0.3 }], 18));
  b.add(tailM, lathe([{ z: -L * 0.06, r: L * 0.035, y: R * 0.35 }, { z: -L * 0.5, r: L * 0.018, y: R * 0.55 }], 10));
  b.add(tailM, slab([0, R * 0.55, -L * 0.42], L * 0.07, [0, R * 0.55 + L * 0.11, -L * 0.47], L * 0.04, L * 0.008, true));
  b.add(tailM, ...both(slab([L * 0.01, R * 0.5, -L * 0.36], L * 0.05, [L * 0.07, R * 0.5, -L * 0.37], L * 0.035, L * 0.006)));
  b.add(engM, boxAll(0, R * 1.1, L * 0.08, R * 0.9, R * 0.4, L * 0.22));
  b.add(engM, boxAll(0, R * 1.45, L * 0.1, L * 0.02, R * 0.4, L * 0.02)); // rotor mast
  b.add(rotorM, disc([0, R * 1.65, L * 0.1], rotorD / 2, 'y', 28));
  b.add(rotorM, disc([L * 0.03, R * 0.6 + L * 0.05, -L * 0.48], L * 0.08, 'x', 14));
  // Skids.
  for (const x of [R * 0.65, -R * 0.65]) {
    b.add(engM, boxAll(x, -R * 1.25, L * 0.1, L * 0.012, L * 0.012, L * 0.42));
    b.add(engM, boxAll(x * 0.85, -R * 1.05, L * 0.2, L * 0.01, R * 0.4, L * 0.012), boxAll(x * 0.85, -R * 1.05, -L * 0.02, L * 0.01, R * 0.4, L * 0.012));
  }
  return b.done();
}

function balloon(b: Builder, H: number, D: number, military: boolean): VehicleModelSpec {
  const env = b.mat('envelope', { color: rgb(military ? '#7b858f' : '#d9534f'), metallic: 0, roughness: 0.8 });
  const basket = b.mat('basket', { color: rgb(military ? '#5d666f' : '#8a6a43'), metallic: 0, roughness: 0.9 });
  const r = D / 2;
  b.add(env, zToUp(lathe([{ z: H * 0.25, r: r * 0.25 }, { z: H * 0.45, r: r * 0.8 }, { z: H * 0.62, r }, { z: H * 0.8, r: r * 0.85 }, { z: H * 0.95, r: r * 0.35 }, { z: H, r: r * 0.02 }], 20)));
  b.add(basket, boxAll(0, H * 0.06, 0, r * 0.3, H * 0.08, r * 0.3));
  return b.done();
}

/** Hull outline in the XZ plane (bow at +Z), convex. */
function hullOutline(L: number, B: number, bow: number, stern: number): [number, number][] {
  const w = B / 2;
  return [
    [-w * stern, -L / 2],
    [w * stern, -L / 2],
    [w, -L / 2 + 0.12 * L],
    [w, L / 2 - bow * 1.6 * L],
    [w * 0.62, L / 2 - bow * 0.6 * L],
    [0, L / 2],
    [-w * 0.62, L / 2 - bow * 0.6 * L],
    [-w, L / 2 - bow * 1.6 * L],
    [-w, -L / 2 + 0.12 * L],
  ];
}

const HULL: Record<VesselSymbol, { upper: string; deck: string; bow: number; stern: number; freeboard: number }> = {
  cargo: { upper: '#233344', deck: '#5b6167', bow: 0.1, stern: 0.92, freeboard: 0.045 },
  tanker: { upper: '#1f2226', deck: '#7a3d2f', bow: 0.1, stern: 0.92, freeboard: 0.04 },
  passenger: { upper: '#f2f3f4', deck: '#c9cdd0', bow: 0.14, stern: 0.85, freeboard: 0.06 },
  highspeed: { upper: '#f2f3f4', deck: '#8b9298', bow: 0.18, stern: 0.88, freeboard: 0.07 },
  fishing: { upper: '#2d5d8a', deck: '#6d6a63', bow: 0.2, stern: 0.82, freeboard: 0.09 },
  tug: { upper: '#8b1f1f', deck: '#4b4d50', bow: 0.2, stern: 0.9, freeboard: 0.08 },
  sailing: { upper: '#f4f5f6', deck: '#a5845c', bow: 0.3, stern: 0.7, freeboard: 0.08 },
  pleasure: { upper: '#f4f5f6', deck: '#a5845c', bow: 0.28, stern: 0.8, freeboard: 0.1 },
  service: { upper: '#d4571c', deck: '#4b4d50', bow: 0.22, stern: 0.85, freeboard: 0.09 },
  military: { upper: '#6d7883', deck: '#59626b', bow: 0.16, stern: 0.85, freeboard: 0.07 },
  unknown: { upper: '#4a5560', deck: '#5b6167', bow: 0.14, stern: 0.88, freeboard: 0.06 },
};

const CONTAINER_COLOURS = ['#b5392f', '#2f6db5', '#d1a23a', '#3c8c5a', '#7d7f82', '#dedede', '#8a3fa0', '#c2662d'];

/** Builds a ship model at its class's default length and beam; waterline at y = 0. */
export function buildVessel(cls: VesselSymbol): VehicleModelSpec {
  const b = new Builder();
  const { lengthM: L, beamM: B } = VESSEL_DEFAULTS[cls];
  const h = HULL[cls];
  const fb = Math.max(0.8, h.freeboard * L);
  const draft = Math.max(0.5, 0.035 * L);
  const top = hullOutline(L, B, h.bow, h.stern);
  const keel = top.map(([x, z]) => [x * 0.72, z * 0.94] as [number, number]);
  const anti = b.mat('antifouling', { color: rgb('#8c2a22'), metallic: 0.1, roughness: 0.7 });
  const upper = b.mat('hull', { color: rgb(h.upper), metallic: 0.1, roughness: 0.6 });
  const deck = b.mat('deck', { color: rgb(h.deck), metallic: 0.1, roughness: 0.8 });
  const windows = b.mat('superstructure', { color: [1, 1, 1, 1], metallic: 0.1, roughness: 0.6, texture: b.texture('windows', 'ship') });
  const white = b.mat('white', { color: rgb('#eceeef'), metallic: 0.1, roughness: 0.6 });
  const dark = b.mat('dark', { color: rgb('#24292e'), metallic: 0.3, roughness: 0.5 });
  const glass = b.mat('glass', { color: rgb('#1b2631'), metallic: 0.6, roughness: 0.15 });
  const lower = loft(keel, -draft, top, 0, false, true);
  b.add(anti, lower.sides, lower.bottom);
  const hull = loft(top, 0, top, fb, true, false);
  b.add(upper, hull.sides);
  b.add(deck, hull.top);
  const block = (cx: number, y: number, cz: number, sx: number, sy: number, sz: number, mat = windows, caps = white) => {
    const bx = box(cx, y + sy / 2, cz, sx, sy, sz, mat === windows ? 3 : 0);
    b.add(mat, bx.sides);
    b.add(caps, bx.caps);
  };
  const bridgeAft = (height: number, len: number) => {
    const z = -L / 2 + 0.06 * L + len / 2;
    block(0, fb, z, B * 0.92, height, len);
    block(0, fb + height, z + len * 0.1, B * 1.04, Math.max(0.6, height * 0.08), len * 0.5); // bridge wings
    block(0, fb, -L / 2 + 0.035 * L, B * 0.22, height * 1.05, Math.max(1, 0.03 * L), dark, dark); // funnel
  };

  switch (cls) {
    case 'cargo': {
      bridgeAft(0.11 * L, 0.06 * L);
      // Container bays from just ahead of the bridge to the forecastle; 2–4 tiers, deterministic colours.
      const tier = Math.max(1.2, 0.0145 * L);
      const bay = 0.05 * L;
      let i = 0;
      for (let z = -L / 2 + 0.15 * L + bay / 2; z < L / 2 - 0.16 * L; z += bay * 1.08, i++) {
        const tiers = 2 + ((i * 7 + 3) % 3);
        for (let t = 0; t < tiers; t++) {
          const c = b.mat('container-' + ((i * 3 + t * 5) % CONTAINER_COLOURS.length), { color: rgb(CONTAINER_COLOURS[(i * 3 + t * 5) % CONTAINER_COLOURS.length]), metallic: 0.2, roughness: 0.7 });
          b.add(c, boxAll(0, fb + tier * (t + 0.5), z, B * 0.86, tier * 0.96, bay));
        }
      }
      block(0, fb, L / 2 - 0.1 * L, B * 0.7, 0.02 * L, 0.06 * L, white, white); // forecastle
      break;
    }
    case 'tanker': {
      bridgeAft(0.1 * L, 0.06 * L);
      const pipeY = fb + 0.012 * L;
      b.add(dark, lathe([{ z: -L / 2 + 0.14 * L, r: 0.011 * L, y: pipeY }, { z: L / 2 - 0.12 * L, r: 0.011 * L, y: pipeY }], 10));
      block(0, fb, 0, B * 0.5, 0.025 * L, 0.03 * L, dark, dark); // manifold
      break;
    }
    case 'passenger':
    case 'highspeed': {
      const decks = cls === 'passenger' ? 5 : 2;
      const deckH = Math.max(1.8, (cls === 'passenger' ? 0.018 : 0.04) * L);
      for (let d = 0; d < decks; d++) {
        const front = L / 2 - (0.24 + d * 0.035) * L;
        const back = -L / 2 + (0.08 + d * 0.02) * L;
        block(0, fb + d * deckH, (front + back) / 2, B * (0.92 - d * 0.03), deckH, front - back);
      }
      block(0, fb + decks * deckH, -0.22 * L, B * 0.18, deckH * 2.2, 0.05 * L, b.mat('funnel', { color: rgb('#24547f'), metallic: 0.2, roughness: 0.6 }), dark);
      break;
    }
    case 'fishing': {
      block(0, fb, 0.14 * L, B * 0.56, 0.1 * L, 0.16 * L);
      b.add(dark, boxAll(0, fb + 0.2 * L, -0.06 * L, 0.012 * L, 0.4 * L, 0.012 * L));
      b.add(dark, slab([0, fb + 0.38 * L, -0.06 * L], 0.012 * L, [0, fb + 0.06 * L, -0.42 * L], 0.012 * L, 0.012 * L, true));
      block(0, fb, -0.44 * L, B * 0.8, 0.12 * L, 0.02 * L, dark, dark); // stern gantry
      break;
    }
    case 'tug':
    case 'service': {
      block(0, fb, 0.05 * L, B * 0.6, 0.09 * L, 0.24 * L);
      block(0, fb + 0.09 * L, 0.1 * L, B * 0.5, 0.07 * L, 0.12 * L);
      b.add(dark, boxAll(0, fb + 0.28 * L, 0.06 * L, 0.012 * L, 0.2 * L, 0.012 * L));
      break;
    }
    case 'sailing': {
      block(0, fb, -0.05 * L, B * 0.5, 0.06 * L, 0.3 * L, glass, white);
      const mastZ = 0.08 * L;
      const mastH = 1.15 * L;
      b.add(dark, boxAll(0, fb + mastH / 2, mastZ, 0.012 * L, mastH, 0.012 * L));
      b.add(dark, boxAll(0, fb + 0.09 * L, mastZ - 0.22 * L, 0.01 * L, 0.01 * L, 0.44 * L)); // boom
      const sail = b.mat('sail', { color: rgb('#f3efe6'), metallic: 0, roughness: 0.9 });
      b.add(sail, triangle([0, fb + 0.1 * L, mastZ - 0.01 * L], [0, fb + mastH * 0.97, mastZ - 0.01 * L], [0, fb + 0.1 * L, mastZ - 0.43 * L]));
      b.add(sail, triangle([0, fb + mastH * 0.85, mastZ + 0.01 * L], [0, fb + 0.06 * L, L / 2 - 0.01 * L], [0, fb + 0.08 * L, mastZ + 0.02 * L]));
      break;
    }
    case 'pleasure': {
      block(0, fb, 0.02 * L, B * 0.66, 0.09 * L, 0.36 * L, glass, white);
      block(0, fb + 0.09 * L, -0.02 * L, B * 0.5, 0.05 * L, 0.18 * L, white, white);
      break;
    }
    case 'military': {
      block(0, fb, -0.02 * L, B * 0.6, 0.08 * L, 0.3 * L, b.mat('grey', { color: rgb('#7b858e'), metallic: 0.2, roughness: 0.7 }), b.mat('grey', { color: rgb('#7b858e') }));
      b.add(dark, boxAll(0, fb + 0.16 * L, 0.03 * L, 0.02 * L, 0.18 * L, 0.02 * L));
      b.add(dark, boxAll(0, fb + 0.02 * L, 0.3 * L, B * 0.25, 0.03 * L, 0.06 * L));
      break;
    }
    default: {
      bridgeAft(0.1 * L, 0.08 * L);
      break;
    }
  }
  return b.done();
}
