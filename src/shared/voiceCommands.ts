// Voice commands: a spoken sentence (already transcribed) becomes one of a few fixed app actions. Matching is local
// and deterministic; nothing the speaker says is run as code or sent anywhere else, and an unrecognised sentence does
// nothing but say so.

import { LAYER_IDS, LAYERS, type LayerId } from './layers';

export type VoiceAction =
  | { kind: 'layer'; layer: LayerId; on: boolean }
  | { kind: 'go'; place: string }
  | { kind: 'surface'; basemap: 'atlas' | 'google3d' | 'google2d' | 'streets' | 'ionBing' }
  | { kind: 'unknown'; heard: string };

/** Extra spoken names for layers, beyond each layer's own name. */
const LAYER_WORDS: Partial<Record<LayerId, string[]>> = {
  aircraft: ['aircraft', 'planes', 'airplanes', 'flights', 'air traffic'],
  aircraftMil: ['military aircraft', 'military planes', 'military jets'],
  vessels: ['ships', 'vessels', 'boats', 'ais'],
  satellites: ['satellites'],
  fires: ['fires', 'fire detections', 'wildfires'],
  firePerimeters: ['fire perimeters'],
  cameras: ['cameras', 'traffic cameras', 'cctv', 'webcams'],
  transit: ['buses', 'transit', 'trams', 'ferries'],
  rail: ['trains', 'rail'],
  launches: ['launches', 'rocket launches'],
  cyclones: ['hurricanes', 'cyclones', 'typhoons'],
  metar: ['metar', 'weather observations'],
  trafficFlow: ['traffic flow', 'traffic'],
  cables: ['cables', 'internet cables', 'undersea cables'],
  landslides: ['landslides'],
  datacenters: ['data centers', 'data centres'],
  dams: ['dams'],
  incidents: ['disasters', 'incidents'],
  airspace: ['airspace', 'restricted airspace'],
  bikeshare: ['bike share', 'bikes'],
  wildlife: ['wildlife', 'animals'],
  milSites: ['military sites', 'military bases', 'bases'],
};

const SURFACES: [RegExp, Extract<VoiceAction, { kind: 'surface' }>['basemap']][] = [
  [/\b(photo ?real(istic)?|3d (map|city|cities)|google 3d)\b/, 'google3d'],
  [/\bgoogle (satellite|imagery)\b/, 'google2d'],
  [/\bbing\b/, 'ionBing'],
  [/\bstreet ?map|streets\b/, 'streets'],
  [/\b(default|atlas|normal) (map|imagery|surface)\b/, 'atlas'],
];

export function normalizeSpeech(text: string): string {
  return text.toLowerCase().replace(/[\u0000-\u001f]/g, ' ').replace(/[.,!?;:"“”]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function findLayer(s: string): LayerId | null {
  let best: { id: LayerId; len: number } | null = null;
  for (const id of LAYER_IDS) {
    const words = [...(LAYER_WORDS[id] ?? []), LAYERS[id].name.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').trim()];
    for (const w of words) {
      if (w && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(s) && (!best || w.length > best.len)) best = { id, len: w.length };
    }
  }
  return best?.id ?? null;
}

export function parseVoiceCommand(text: string): VoiceAction {
  const s = normalizeSpeech(text);
  if (!s) return { kind: 'unknown', heard: '' };
  const off = /\b(hide|turn off|switch off|disable|remove|stop showing)\b/.test(s);
  const on = /\b(show|turn on|switch on|enable|display|add)\b/.test(s);
  if (on || off) {
    const layer = findLayer(s);
    if (layer) return { kind: 'layer', layer, on: !off };
  }
  if (/\b(switch|change|use|show)\b/.test(s)) {
    for (const [re, basemap] of SURFACES) if (re.test(s)) return { kind: 'surface', basemap };
  }
  const go = s.match(/^(?:please )?(?:go to|fly to|take me to|zoom (?:in )?to|show me|find|navigate to|search for)\s+(.{2,80})$/);
  if (go) return { kind: 'go', place: go[1].replace(/^the /, '').trim() };
  return { kind: 'unknown', heard: s };
}
