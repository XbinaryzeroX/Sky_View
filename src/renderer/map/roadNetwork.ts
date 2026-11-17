// Loads the road and path lines between two points from the same OpenFreeMap vector tiles the map draws
// (OpenMapTiles "transportation" layer, zoom 14), for local route options. Nothing is sent to a routing service.
import { clipLineToTile, lonLatToUnits, ROUTE_EXTENT, ROUTE_Z, type RoadLine } from '../../shared/routing';
import { loadVectorTile } from './vectorTiles';

/** Upper bound on tiles per request (about 12 km × 12 km at mid latitudes, with margin). */
export const MAX_ROUTE_TILES = 144;

export interface RoadLoad {
  lines: RoadLine[];
  tiles: number;
  tilesFailed: number;
}

/** Tiles covering the box around two points, with `marginM` on every side. Null when there would be too many. */
export function routeTiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }, marginM = 1200): string[] | null {
  const dLat = marginM / 111_320;
  const midLat = (a.lat + b.lat) / 2;
  const dLon = marginM / (111_320 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)));
  const [x0, y0] = lonLatToUnits(Math.min(a.lon, b.lon) - dLon, Math.max(a.lat, b.lat) + dLat);
  const [x1, y1] = lonLatToUnits(Math.max(a.lon, b.lon) + dLon, Math.min(a.lat, b.lat) - dLat);
  const n = 2 ** ROUTE_Z;
  const tx0 = Math.max(0, Math.floor(x0 / ROUTE_EXTENT));
  const tx1 = Math.min(n - 1, Math.floor(x1 / ROUTE_EXTENT));
  const ty0 = Math.max(0, Math.floor(y0 / ROUTE_EXTENT));
  const ty1 = Math.min(n - 1, Math.floor(y1 / ROUTE_EXTENT));
  if (tx1 < tx0) return null; // spans the 180° meridian: not supported
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_ROUTE_TILES) return null;
  const out: string[] = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) out.push(`${x}/${y}`);
  return out;
}

interface NamedLine {
  name: string;
  pts: [number, number][];
  box: [number, number, number, number];
}
function namedLine(name: string, pts: [number, number][]): NamedLine {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { name, pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}
/**
 * A street name for a road piece whose id has no name entry: the named line that shares at least two of its vertices
 * (within 2 tile units). Names are only attached where the geometry agrees; otherwise the piece stays unnamed.
 */
export function nameByGeometry(pts: readonly [number, number][], named: readonly NamedLine[]): string | null {
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const box = [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2];
  for (const n of named) {
    if (n.box[0] > box[2] || n.box[2] < box[0] || n.box[1] > box[3] || n.box[3] < box[1]) continue;
    let shared = 0;
    for (const p of pts) if (n.pts.some((q) => Math.abs(q[0] - p[0]) <= 2 && Math.abs(q[1] - p[1]) <= 2) && ++shared >= 2) return n.name;
  }
  return null;
}

export async function loadRoadLines(tiles: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<RoadLoad> {
  const lines: RoadLine[] = [];
  let failed = 0;
  let done = 0;
  await Promise.all(
    tiles.map(async (key) => {
      const [tx, ty] = key.split('/').map(Number);
      try {
        const vt = await loadVectorTile(ROUTE_Z, tx, ty);
        if (signal?.aborted) return;
        const layer = vt.layers.transportation;
        const names = new Map<string, string>();
        const named: NamedLine[] = [];
        // Street names come from a separate layer: joined by OSM id where both carry one, otherwise by shared vertices.
        const tn = vt.layers.transportation_name;
        if (tn)
          for (let i = 0; i < tn.length; i++) {
            const f = tn.feature(i);
            const nm = f.properties['name:latin'] ?? f.properties.name;
            if (typeof nm !== 'string') continue;
            if (f.id !== undefined) names.set(String(f.id), nm.slice(0, 80));
            if (f.type === 2) named.push(namedLine(nm.slice(0, 80), f.loadGeometry().flat().map((q) => [q.x * (ROUTE_EXTENT / tn.extent), q.y * (ROUTE_EXTENT / tn.extent)] as [number, number])));
          }
        if (layer)
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            if (f.type !== 2) continue;
            const p = f.properties;
            const cls = String(p.class ?? '');
            const oneway = Number(p.oneway) === 1 ? 1 : Number(p.oneway) === -1 ? -1 : 0;
            const subclass = typeof p.subclass === 'string' ? p.subclass : null;
            const idName = f.id !== undefined ? names.get(String(f.id)) ?? null : null;
            for (const part of f.loadGeometry()) {
              const scale = ROUTE_EXTENT / layer.extent;
              const name = idName ?? nameByGeometry(part.map((q) => [q.x * scale, q.y * scale] as [number, number]), named);
              for (const piece of clipLineToTile(part.map((q) => [q.x * scale, q.y * scale] as [number, number])))
                lines.push({ cls, subclass, oneway, name, pts: piece.map(([x, y]) => [tx * ROUTE_EXTENT + x, ty * ROUTE_EXTENT + y]) });
            }
          }
      } catch {
        failed++;
      } finally {
        onProgress?.(++done, tiles.length);
      }
    }),
  );
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return { lines, tiles: tiles.length, tilesFailed: failed };
}
