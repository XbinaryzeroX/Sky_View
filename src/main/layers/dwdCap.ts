// DWD complete German STATUS snapshots only, not a reconstruction of DIFFERENCE messages.
import { createHash } from 'node:crypto';
import { parser as saxParser } from 'sax';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { DWD_CAP_LIMITS as LIMIT, dwdStartMs, type DwdArea, type DwdReference, type DwdStatusContext, type DwdStatusResult, type DwdWarning } from '../../shared/dwd';
import { dwdZipEntries } from './dwdZip';

const CAP = 'urn:oasis:names:tc:emergency:cap:1.2';
const SOURCE = 'https://www.dwd.de/warnungen';
type Point = [number, number];
interface Node { name: string; uri: string; text: string; children: Node[] }
interface Budget { nodes: number; areas: number; coordinates: number; comparisons: number; references: number }
class ResourceLimit extends Error {}
function consume(b: Budget, key: keyof Budget, n: number, max: number): void {
  b[key] += n; if (b[key] > max) throw new ResourceLimit(`DWD CAP ${key} exceeds the supported resource limit.`);
}
function xml(bytes: Uint8Array, budget: Budget): Node {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const p = saxParser(true, { xmlns: true, strictEntities: true, position: false });
  const stack: Node[] = []; let root: Node | null = null;
  p.ondoctype = () => { throw new Error('DWD CAP DTD declarations are forbidden.'); };
  p.onerror = error => { throw error; };
  p.onopentag = tag => {
    consume(budget, 'nodes', 1, LIMIT.xmlNodes);
    if (stack.length >= LIMIT.xmlDepth) throw new ResourceLimit('DWD CAP XML nesting exceeds the resource limit.');
    const node: Node = { name: tag.local, uri: tag.uri, text: '', children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) throw new Error('DWD CAP has multiple XML roots.');
    else root = node;
    stack.push(node);
  };
  const append = (value: string) => {
    const node = stack.at(-1);
    if (!node) { if (value.trim()) throw new Error('DWD CAP has text outside its root.'); return; }
    if (node.text.length + value.length > LIMIT.textCharacters) throw new ResourceLimit('DWD CAP text exceeds its field limit.');
    node.text += value;
  };
  p.ontext = append; p.oncdata = append; p.onclosetag = () => { stack.pop(); };
  for (let at = 0; at < text.length; at += 8192) p.write(text.slice(at, at + 8192));
  p.close();
  if (!root || (root as Node).name !== 'alert' || (root as Node).uri !== CAP) throw new Error('DWD CAP root is not CAP 1.2 alert.');
  return root;
}
function children(node: Node, name: string): Node[] { return node.children.filter(c => c.name === name && c.uri === CAP); }
function string(node: Node, name: string, required = false, maximum = LIMIT.textCharacters): string | null {
  const matches = children(node, name);
  if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`DWD CAP ${name} is missing or duplicated.`);
  const found = matches[0]; if (!found) return null;
  if (found.children.length || found.text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(found.text)) throw new Error(`DWD CAP ${name} is not supported text.`);
  const value = found.text.trim(); if (required && !value) throw new Error(`DWD CAP ${name} is empty.`); return value || null;
}
/** CAP offset date-time, converted to the actual instant, never a guessed local zone. */
function instant(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('DWD CAP date-time has no supported explicit UTC offset.');
  const [, yy, mm, dd, hh, mi, ss, , offset] = match, y = +yy, m = +mm, d = +dd;
  if (y < 1970 || y > 2200 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate() || +hh > 23 || +mi > 59 || +ss > 59 || (offset !== 'Z' && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))))
    throw new Error('DWD CAP date-time is invalid.');
  const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error('DWD CAP date-time is invalid.'); return new Date(time).toISOString();
}
function date(node: Node, name: string): string | null { const value = string(node, name, false, 40); return value === null ? null : instant(value); }
function identity(sender: string, identifier: string, sent: string): string {
  return `dwd:${createHash('sha256').update(`${sender}\0${identifier}\0${sent}`).digest('hex')}`;
}
function references(value: string | null, budget: Budget): DwdReference[] {
  if (!value) return [];
  const parts = value.split(/\s+/); if (parts.length > 2000) throw new ResourceLimit('DWD CAP references exceed the resource limit.');
  consume(budget, 'references', parts.length, LIMIT.references);
  return parts.map(reference => {
    const split = reference.split(',');
    if (split.length !== 3 || split[0].length > 320 || split[1].length > 512 || !split[0] || !split[1]) throw new Error('DWD CAP reference is malformed.');
    const [sender, identifier, raw] = split, sent = instant(raw); return { id: identity(sender, identifier, sent), sender, identifier, sent };
  });
}
function sourceUrl(value: string | null): string {
  if (value && value.length <= 2048) {
    try {
      const u = new URL(value);
      if (u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'dwd.de' || u.hostname === 'www.dwd.de')) return u.href;
    } catch { /* The fixed publisher landing page remains available. */ }
  }
  return SOURCE;
}
function pairs(node: Node): { name: string; value: string }[] {
  return children(node, 'geocode').map(g => ({ name: string(g, 'valueName', true, 256)!, value: string(g, 'value', true)! }));
}
function cross(a: Point, b: Point, p: Point): number { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); }
function signedArea(ring: Point[]): number {
  const [x, y] = ring[0]; let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += (ring[i][0] - x) * (ring[i + 1][1] - y) - (ring[i + 1][0] - x) * (ring[i][1] - y);
  return sum;
}
function intersect(a: Point, b: Point, c: Point, d: Point, budget: Budget): boolean {
  consume(budget, 'comparisons', 1, 1_000_000);
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  const p = cross(a, b, c), q = cross(a, b, d), r = cross(c, d, a), s = cross(c, d, b);
  return (p === 0 || q === 0 || Math.sign(p) !== Math.sign(q)) && (r === 0 || s === 0 || Math.sign(r) !== Math.sign(s));
}
function ring(value: string, budget: Budget): Point[] {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 4 || tokens.length > LIMIT.ringCoordinates) throw new Error('DWD polygon must be a bounded, closed ring.');
  consume(budget, 'coordinates', tokens.length, LIMIT.coordinates);
  const raw: Point[] = tokens.map(token => {
    const pieces = token.split(',');
    if (pieces.length !== 2 || pieces.some(v => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v))) throw new Error('DWD polygon contains an invalid CAP latitude,longitude position.');
    const [lat, lon] = pieces.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('DWD polygon is outside WGS84 bounds.');
    // DWD national polygons do not wrap a pole. Reject these instead of drawing an invented closure.
    if (Math.abs(lat) === 90) throw new Error('DWD polygon pole vertices are unsupported.');
    return [lon === 0 ? 0 : lon, lat === 0 ? 0 : lat];
  });
  if (raw[0][0] !== raw.at(-1)![0] || raw[0][1] !== raw.at(-1)![1]) throw new Error('DWD polygon ring is not closed.');
  // Live DWD STATUS polygons repeat the closing coordinate. Adjacent identical
  // positions add no segment; removing only these preserves the supplied shape.
  const points = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
  const unique = new Set(points.slice(0, -1).map(p => `${p[0] === 180 ? -180 : p[0]},${p[1]}`));
  if (unique.size !== points.length - 1 || unique.size < 3) throw new Error('DWD polygon repeats a vertex or has too few positions.');
  // CAP uses straight latitude/longitude segments. Ambiguous date-line edges are retained as unavailable.
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - points[i - 1][0]) > 180) throw new Error('DWD date-line polygons require unsupported splitting.');
  if (signedArea(points) === 0) throw new Error('DWD polygon has zero area.');
  const segments = points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1], i, min: Math.min(a[0], points[i + 1][0]), max: Math.max(a[0], points[i + 1][0]) })).sort((a, b) => a.min - b.min);
  let active: typeof segments = [];
  for (const segment of segments) {
    active = active.filter(other => other.max >= segment.min);
    for (const other of active) {
      if (Math.abs(other.i - segment.i) === 1 || Math.abs(other.i - segment.i) === points.length - 2) continue;
      if (intersect(segment.a, segment.b, other.a, other.b, budget)) throw new Error('DWD polygon is self-intersecting or touching.');
    }
    active.push(segment);
  }
  return points;
}
function inside(point: Point, ring: Point[]): boolean {
  let result = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (cross(a, b, point) === 0 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return false;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function ringsTouch(a: Point[], b: Point[], budget: Budget): boolean {
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (intersect(a[i], a[i + 1], b[j], b[j + 1], budget)) return true;
  return false;
}
function geometry(polygons: string[], holes: string[], budget: Budget): Polygon | MultiPolygon | null {
  if (!polygons.length) { if (holes.length) throw new Error('DWD exclusion polygon has no exterior.'); return null; }
  const outers = polygons.map(value => ring(value, budget));
  const grouped = outers.map(outer => [signedArea(outer) > 0 ? outer : [...outer].reverse()]);
  for (const value of holes) {
    const hole = ring(value, budget), matches: number[] = [];
    for (let i = 0; i < outers.length; i++) if (inside(hole[0], outers[i]) && !ringsTouch(hole, outers[i], budget)) matches.push(i);
    if (matches.length !== 1) throw new Error('DWD exclusion polygon does not belong to one exterior.');
    const group = grouped[matches[0]];
    for (const previous of group.slice(1)) if (inside(hole[0], previous) || inside(previous[0], hole) || ringsTouch(hole, previous, budget)) throw new Error('DWD exclusion polygons overlap or touch.');
    group.push(signedArea(hole) < 0 ? hole : [...hole].reverse());
  }
  return grouped.length === 1 ? { type: 'Polygon', coordinates: grouped[0] } : { type: 'MultiPolygon', coordinates: grouped };
}
function combine(areas: DwdArea[]): Polygon | MultiPolygon | null {
  const polygons: Position[][][] = [];
  for (const area of areas) if (area.geometry) polygons.push(...(area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates));
  return polygons.length === 0 ? null : polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}
function area(node: Node, budget: Budget): { area: DwdArea; invalid: boolean; note: string | null } {
  consume(budget, 'areas', 1, LIMIT.areas);
  const geocodes = pairs(node), description = string(node, 'areaDesc', true, 4096)!;
  let shape: Polygon | MultiPolygon | null = null, invalid = false, note: string | null = null;
  try {
    const polygons = children(node, 'polygon').map(p => { if (p.children.length) throw new Error('Nested polygon content.'); return p.text; });
    shape = geometry(polygons, geocodes.filter(p => p.name === 'EXCLUDE_POLYGON').map(p => p.value), budget);
    if (children(node, 'circle').length) { invalid = true; note = 'CAP circle areas are not drawn; supplied polygons remain separate horizontal evidence.'; }
  } catch (error) {
    if (error instanceof ResourceLimit) throw error;
    invalid = true; shape = null; note = 'Invalid or unsupported polygon/exclusion geometry was retained as an unlocated area.';
  }
  const metres = (name: string) => { const value = string(node, name); if (value === null) return null; const n = Number(value); if (!value.trim() || !Number.isFinite(n) || Math.abs(n) > 1_000_000) throw new Error('Invalid DWD altitude.'); return n * 0.3048; };
  return { area: { description, geometry: shape, geocodes, altitudeM: metres('altitude'), ceilingM: metres('ceiling') }, invalid, note };
}
interface Message { id: string; sent: string; references: DwdReference[]; kind: 'Alert' | 'Update' | 'Cancel'; warning: DwdWarning | null; allClear: boolean; expired: boolean; digest: string }

/** Pure parser: transport, freshness, conditional requests and cache ownership stay in the DWD service. */
export function parseDwdStatusZip(bytes: Uint8Array, context: DwdStatusContext): DwdStatusResult {
  const observedAt = instant(context.observedAt), now = Date.parse(observedAt), sourceUpdatedAt = context.sourceUpdatedAt ? instant(context.sourceUpdatedAt) : null;
  const entries = dwdZipEntries(bytes), budget: Budget = { nodes: 0, areas: 0, coordinates: 0, comparisons: 0, references: 0 };
  const result: DwdStatusResult = { warnings: [], observedAt, sourceUpdatedAt, completeness: 'complete', totalEntries: entries.length, parsedMessages: 0, skipped: 0,
    filtered: { notActual: 0, notPublic: 0, notGerman: 0, expired: 0, cancel: 0, allClear: 0, superseded: 0, duplicates: 0 }, unlocatedWarnings: 0, partialGeometryWarnings: 0, notes: [] };
  const note = (value: string) => { if (!result.notes.includes(value) && result.notes.length < 12) result.notes.push(value); };
  const messages = new Map<string, Message>(), conflicts = new Set<string>();
  for (const entry of entries) {
    try {
      const root = xml(entry.bytes, budget); result.parsedMessages++;
      if (string(root, 'status', true, 30) !== 'Actual') { result.filtered.notActual++; continue; }
      if (string(root, 'scope', true, 30) !== 'Public') { result.filtered.notPublic++; continue; }
      const sender = string(root, 'sender', true, 320)!, identifier = string(root, 'identifier', true, 512)!, sent = date(root, 'sent');
      if (!sent || Date.parse(sent) > now + 5 * 60_000 || !/^[^\s,@]+@(?:[a-z0-9-]+\.)*dwd\.de$/i.test(sender)) throw new Error('DWD CAP sender or sent time is not supported.');
      const kind = string(root, 'msgType', true, 30);
      if (kind !== 'Alert' && kind !== 'Update' && kind !== 'Cancel') throw new Error('DWD CAP message type is unsupported.');
      const refs = references(string(root, 'references'), budget);
      if ((kind === 'Update' || kind === 'Cancel') && !refs.length) throw new Error('DWD Update/Cancel has no usable references.');
      if (refs.some(r => Date.parse(r.sent) > Date.parse(sent))) throw new Error('DWD CAP references a future message.');
      const id = identity(sender, identifier, sent);
      if (refs.some(r => r.id === id)) throw new Error('DWD CAP message references itself.');
      const infos = children(root, 'info').filter(i => ['de-DE', 'de'].includes(string(i, 'language', false, 30) ?? ''));
      if (kind !== 'Cancel' && infos.length === 0) {
        result.filtered.notGerman++; result.completeness = 'partial'; note('An Actual/Public message had no supported German info block; it was not silently translated.'); continue;
      }
      if (infos.length > 1) throw new Error('DWD CAP has multiple ambiguous German info blocks.');
      const info = infos[0]; let warning: DwdWarning | null = null, allClear = false, expired = false;
      if (info) {
        const responses = children(info, 'responseType').map(r => { if (r.children.length || r.text.length > 128) throw new Error('Invalid CAP response type.'); return r.text.trim(); });
        allClear = responses.includes('AllClear');
        const effective = date(info, 'effective'), onset = date(info, 'onset'), expires = date(info, 'expires');
        expired = expires !== null && Date.parse(expires) <= now;
        if (expires && ((effective && Date.parse(expires) < Date.parse(effective)) || (onset && Date.parse(expires) < Date.parse(onset)))) throw new Error('DWD CAP expires before becoming effective or beginning.');
        if (!allClear && kind !== 'Cancel') {
          const pieces = children(info, 'area').map(n => area(n, budget));
          if (!pieces.length) throw new Error('DWD CAP warning has no area.');
          const areas = pieces.map(p => p.area), shape = combine(areas), missingAreaCount = areas.filter(a => !a.geometry).length, invalidGeometryCount = pieces.filter(p => p.invalid).length;
          const severity = string(info, 'severity', true, 30)!;
          if (!['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'].includes(severity)) throw new Error('Unsupported CAP severity.');
          const start = dwdStartMs(onset, effective), names = areas.slice(0, 3).map(a => a.description);
          warning = { id, capIdentifier: identifier, sender, sent, status: 'Actual', scope: 'Public', messageType: kind,
            references: refs, language: string(info, 'language', true, 30) as 'de-DE' | 'de', event: string(info, 'event', true, 4096)!,
            headline: string(info, 'headline'), description: string(info, 'description'), instruction: string(info, 'instruction'),
            severity: severity as DwdWarning['severity'], urgency: string(info, 'urgency', true, 64)!, certainty: string(info, 'certainty', true, 64)!,
            effective, onset, expires, responseTypes: responses, timing: Number.isFinite(start) ? start > now ? 'upcoming' : 'active' : 'unknown',
            areaDesc: `${names.join('; ')}${areas.length > 3 ? `; +${areas.length - 3} areas (see full list)` : ''}`, areas, geometry: shape,
            geometryStatus: !shape ? 'unavailable' : missingAreaCount || invalidGeometryCount ? 'partial' : 'complete', missingAreaCount, invalidGeometryCount,
            geometryNotes: [...new Set(pieces.flatMap(p => p.note ? [p.note] : []))], source: 'Deutscher Wetterdienst', sourceUrl: sourceUrl(string(info, 'web', false, 2048)), license: 'CC BY 4.0', country: 'DE' };
        }
      }
      const digest = createHash('sha256').update(entry.bytes).digest('hex'), existing = messages.get(id);
      if (existing) {
        result.filtered.duplicates++;
        if (existing.digest !== digest) { conflicts.add(id); result.completeness = 'partial'; note('Conflicting duplicate CAP identities were omitted.'); }
      } else messages.set(id, { id, sent, references: refs, kind, warning, allClear, expired, digest });
    } catch (error) {
      if (error instanceof ResourceLimit) throw error;
      result.skipped++; result.completeness = 'partial'; note('One or more invalid or unsupported CAP messages were skipped; this is not an empty/all-clear assertion.');
    }
  }
  // A malformed equal-time reference cycle must not manufacture a complete empty snapshot.
  const colors = new Map<string, number>();
  for (const message of messages.values()) {
    if (colors.has(message.id)) continue;
    const stack = [{ id: message.id, next: 0 }]; colors.set(message.id, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1], current = messages.get(frame.id)!;
      if (frame.next >= current.references.length) { colors.set(frame.id, 2); stack.pop(); continue; }
      const next = current.references[frame.next++].id;
      if (!messages.has(next)) continue;
      if (colors.get(next) === 1) {
        for (const item of stack) conflicts.add(item.id);
        result.completeness = 'partial'; note('Cyclic CAP references were omitted; they cannot establish a complete warning state.');
      } else if (!colors.has(next)) { colors.set(next, 1); stack.push({ id: next, next: 0 }); }
    }
  }
  // References have permanent supersession semantics within the supplied STATUS snapshot.
  const superseded = new Set<string>();
  for (const message of messages.values()) if (!conflicts.has(message.id) && (message.kind === 'Update' || message.kind === 'Cancel' || message.allClear)) for (const ref of message.references) superseded.add(ref.id);
  for (const message of messages.values()) {
    if (conflicts.has(message.id)) { result.skipped++; continue; }
    if (message.kind === 'Cancel') { result.filtered.cancel++; continue; }
    if (message.allClear) { result.filtered.allClear++; continue; }
    if (message.expired) { result.filtered.expired++; continue; }
    if (superseded.has(message.id)) { result.filtered.superseded++; continue; }
    if (message.warning) result.warnings.push(message.warning);
  }
  result.warnings.sort((a, b) => a.id.localeCompare(b.id));
  result.unlocatedWarnings = result.warnings.filter(w => !w.geometry).length;
  result.partialGeometryWarnings = result.warnings.filter(w => w.geometryStatus === 'partial').length;
  if (result.warnings.some(w => w.invalidGeometryCount)) note('Some geometry was invalid or unsupported; original area text and geocodes remain available. This does not omit warning membership.');
  if (result.unlocatedWarnings || result.partialGeometryWarnings) note('Supplied polygons do not establish coverage for every named/geocoded area; no geometry is inferred from names or WarnCellID.');
  if (result.warnings.some(w => w.expires === null)) note('Some messages omit expires; no expiry or all-clear time is invented.');
  return result;
}
