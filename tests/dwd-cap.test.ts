import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { parseDwdStatusZip } from '../src/main/layers/dwdCap';
import { dwdZipEntries } from '../src/main/layers/dwdZip';
import { DWD_CAP_LIMITS, dwdStartMs } from '../src/shared/dwd';
import { pointInGeometry } from '../src/shared/geo';

const at = '2026-11-12T01:20:00.000Z';
const sent = '2026-11-12T01:00:00Z';
const exterior = '50,10 50,14 54,14 54,10 50,10';
const hole = '51,11 53,11 53,13 51,13 51,11';
interface Options { id?: string; sent?: string; kind?: string; status?: string; scope?: string; refs?: string; info?: string; root?: string }
function info(extra = '', areas = `<area><areaDesc>Berlin &amp; Umgebung</areaDesc><polygon>${exterior}</polygon></area>`): string {
  return `<info><language>de-DE</language><category>Met</category><event>STARKREGEN</event><urgency>Future</urgency><severity>Moderate</severity><certainty>Likely</certainty><effective>${sent}</effective><onset>${sent}</onset><expires>2026-11-12T05:00:00Z</expires><headline>Amtliche Warnung vor STARKREGEN</headline><description>Starker Regen.\nZweite Zeile mit ä, ß und &lt;Zeichen&gt;.</description><instruction>Bitte beachten.</instruction>${extra}${areas}</info>`;
}
function cap(options: Options = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${options.id ?? 'one.DEU'}</identifier><sender>opendata@dwd.de</sender><sent>${options.sent ?? sent}</sent><status>${options.status ?? 'Actual'}</status><msgType>${options.kind ?? 'Alert'}</msgType><scope>${options.scope ?? 'Public'}</scope>${options.refs ? `<references>${options.refs}</references>` : ''}${options.info ?? info()}${options.root ?? ''}</alert>`;
}
function archive(...texts: string[]): Uint8Array { return zipSync(Object.fromEntries(texts.map((t, i) => [`warning-${i}.xml`, strToU8(t)]))); }
function parse(...texts: string[]) { return parseDwdStatusZip(archive(...texts), { observedAt: at }); }
const ref = (id = 'one.DEU', time = sent) => `opendata@dwd.de,${id},${time}`;

describe('DWD original publisher fixtures', () => {
  it('retains original marine identity/text/reference with no invented expiry or position', () => {
    const raw = readFileSync(new URL('./fixtures/dwd-cap/official-sea.xml', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('d39937936a897d79840eca8538d1cb14447c0479e742f7057c7e80c85ae9df11');
    const result = parseDwdStatusZip(zipSync({ 'source.xml': raw }), { observedAt: at, sourceUpdatedAt: '2026-11-12T01:12:35Z' });
    expect(result).toMatchObject({ completeness: 'complete', parsedMessages: 1, skipped: 0, unlocatedWarnings: 1, sourceUpdatedAt: '2026-11-12T01:12:35.000Z' });
    expect(result.warnings[0]).toMatchObject({ event: 'STARKWIND', sent: '2026-11-11T23:01:00.000Z', headline: 'Amtliche Warnung des Seewetterdienstes Hamburg vor STARKWIND', expires: null, geometry: null, geometryStatus: 'unavailable', sourceUrl: 'https://dwd.de/warnungen', language: 'de-DE', messageType: 'Update' });
    expect(result.warnings[0].capIdentifier).toBe('2.49.0.0.276.0.DWD.PVW.1794438060000.6c67ffea-b992-4fe1-a3aa-c0492d86ede2.DEU');
    expect(result.warnings[0].references[0].identifier).toContain('70d882fc-057a-4c94-bd46-aa2af7c8f343.DEU');
    expect(result.warnings[0].areas[0].geocodes).toContainEqual({ name: 'WARNCELLID', value: '501000001' });
  });
  it('converts supplied latitude/longitude polygons, accepting redundant closing coordinates only', () => {
    const raw = readFileSync(new URL('./fixtures/dwd-cap/official-land.xml', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('be7623a07959a7986dd2b9e8bce9b7485bd5197c8b80f65feb0e898c5bbd9c25');
    const result = parseDwdStatusZip(zipSync({ 'source.xml': raw }), { observedAt: at });
    expect(result).toMatchObject({ completeness: 'complete', skipped: 0, unlocatedWarnings: 0, partialGeometryWarnings: 1 });
    const w = result.warnings[0];
    expect(w).toMatchObject({ event: 'STURMBÖEN', geometryStatus: 'partial', invalidGeometryCount: 0, missingAreaCount: 4 });
    expect(w.areas).toHaveLength(6); expect(w.geometry?.type).toBe('MultiPolygon');
    const coordinates = w.geometry!.type === 'MultiPolygon' ? w.geometry!.coordinates : [w.geometry!.coordinates];
    expect(coordinates).toHaveLength(2);
    expect(coordinates[0][0][0]).toEqual([11.232679, 54.499638]);
    expect(coordinates[0][0].filter(p => p[0] === coordinates[0][0][0][0] && p[1] === coordinates[0][0][0][1])).toHaveLength(2);
  });
});

describe('DWD CAP lifecycle and source provenance', () => {
  it('preserves German source paragraphs and UTC instants, with source time independent from sent', () => {
    const r = parseDwdStatusZip(archive(cap({ sent: '2026-11-12T02:00:00+01:00' })), { observedAt: at, sourceUpdatedAt: '2026-11-12T01:18:00Z' });
    expect(r.warnings[0].sent).toBe('2026-11-12T01:00:00.000Z');
    expect(r.warnings[0].description).toBe('Starker Regen.\nZweite Zeile mit ä, ß und <Zeichen>.');
    expect(r.sourceUpdatedAt).toBe('2026-11-12T01:18:00.000Z');
    expect(parse(cap()).sourceUpdatedAt).toBeNull();
    expect(r.warnings[0].id).toMatch(/^dwd:[a-f0-9]{64}$/);
  });
  it('keeps future onset/effective separate from active and never invents missing expiry', () => {
    expect(dwdStartMs('2026-11-12T02:00:00Z', '2026-11-12T03:00:00Z')).toBe(Date.parse('2026-11-12T03:00:00Z'));
    expect(dwdStartMs(null, null)).toBeNaN();
    const upcoming = info().replace(`<onset>${sent}</onset>`, '<onset>2026-11-12T02:00:00Z</onset>');
    expect(parse(cap({ info: upcoming })).warnings[0].timing).toBe('upcoming');
    const laterEffective = info().replace(`<effective>${sent}</effective>`, '<effective>2026-11-12T02:00:00Z</effective>');
    expect(parse(cap({ info: laterEffective })).warnings[0].timing).toBe('upcoming');
    const unknown = info().replace(/<(effective|onset|expires)>[^<]+<\/(?:effective|onset|expires)>/g, '');
    expect(parse(cap({ info: unknown })).warnings[0]).toMatchObject({ effective: null, onset: null, expires: null, timing: 'unknown' });
  });
  it('supersedes by exact sender/identifier/sent regardless of archive order; language suffixes stay distinct', () => {
    const original = cap(), update = cap({ id: 'two.DEU', sent: '2026-11-12T01:05:00Z', kind: 'Update', refs: ref() });
    const r = parse(update, original, cap({ id: 'one.ENG' }));
    expect(r.warnings.map(w => w.capIdentifier).sort()).toEqual(['one.ENG', 'two.DEU']);
    expect(r.filtered.superseded).toBe(1);
    const otherTime = cap({ id: 'one.DEU', sent: '2026-11-12T00:59:00Z' });
    expect(parse(update, otherTime).warnings).toHaveLength(2);
  });
  it('honors cancellation and explicit AllClear, never interpreting disappearance or Minor as all-clear', () => {
    const cancel = cap({ id: 'cancel.DEU', sent: '2026-11-12T01:05:00Z', kind: 'Cancel', refs: ref(), info: '' });
    expect(parse(cap(), cancel)).toMatchObject({ warnings: [], filtered: { cancel: 1, superseded: 1 } });
    const clear = cap({ id: 'clear.DEU', sent: '2026-11-12T01:05:00Z', kind: 'Update', refs: ref(), info: info('<responseType>AllClear</responseType>') });
    expect(parse(cap(), clear)).toMatchObject({ warnings: [], filtered: { allClear: 1, superseded: 1 } });
    expect(parse(cap({ info: info().replace('Moderate', 'Minor') })).warnings).toHaveLength(1);
    expect(parseDwdStatusZip(archive(), { observedAt: at })).toMatchObject({ completeness: 'complete', warnings: [], totalEntries: 0 });
  });
  it('does not resurrect a prior message when the referenced update is expired', () => {
    const expiredInfo = info().replace('2026-11-12T05:00:00Z', '2026-11-12T01:10:00Z');
    const expiredUpdate = cap({ id: 'two.DEU', sent: '2026-11-12T01:05:00Z', kind: 'Update', refs: ref(), info: expiredInfo });
    expect(parse(cap(), expiredUpdate)).toMatchObject({ warnings: [], filtered: { expired: 1, superseded: 1 } });
  });
  it('never lets Test/Private cancellations suppress Actual/Public warnings', () => {
    const cancel = { id: 'cancel.DEU', sent: '2026-11-12T01:05:00Z', kind: 'Cancel', refs: ref(), info: '' };
    const r = parse(cap(), cap({ ...cancel, status: 'Test' }), cap({ ...cancel, scope: 'Private' }));
    expect(r.warnings).toHaveLength(1); expect(r.filtered).toMatchObject({ notActual: 1, notPublic: 1, cancel: 0 });
  });
  it('omits conflicting duplicate identities and reports incomplete membership, but tolerates identical duplicates', () => {
    expect(parse(cap(), cap())).toMatchObject({ completeness: 'complete', filtered: { duplicates: 1 } });
    expect(parse(cap(), cap({ info: info().replace('STARKREGEN', 'NEBEL') }))).toMatchObject({ completeness: 'partial', warnings: [], skipped: 1 });
  });
  it('rejects self-reference and equal-time cycles instead of asserting an empty current archive', () => {
    expect(parse(cap({ kind: 'Update', refs: ref() }))).toMatchObject({ completeness: 'partial', warnings: [], skipped: 1 });
    const a = cap({ id: 'a.DEU', kind: 'Update', refs: ref('b.DEU') }), b = cap({ id: 'b.DEU', kind: 'Update', refs: ref('a.DEU') });
    expect(parse(a, b)).toMatchObject({ completeness: 'partial', warnings: [], skipped: 2 });
  });
  it('selects original German info from a multilingual message without merging language identifiers', () => {
    const english = info().replace('de-DE', 'en').replace('STARKREGEN', 'HEAVY RAIN');
    const r = parse(cap({ info: english + info() }));
    expect(r).toMatchObject({ completeness: 'complete', skipped: 0 }); expect(r.warnings[0].event).toBe('STARKREGEN');
  });
  it.each([
    cap({ sent: '2026-02-30T00:00:00Z' }), cap({ sent: '2026-11-12T01:26:00Z' }), cap({ sent: '2026-11-12T01:00:00' }),
    cap({ kind: 'Update' }), cap({ kind: 'Update', refs: 'malformed' }), cap({ kind: 'Update', refs: ref('x', '2026-11-12T02:00:00Z') }),
    cap({ info: info().replace('de-DE', 'en') }), cap({ info: info() + info() }),
    cap({ root: '<sent>2026-11-12T01:00:00Z</sent>' }),
  ])('marks unsupported/malformed message membership partial', text => {
    expect(parse(text)).toMatchObject({ completeness: 'partial', warnings: [] });
  });
  it('allowlists only safe DWD website links and never preserves credentials or arbitrary endpoints', () => {
    for (const web of ['http://www.dwd.de/warnungen', 'https://example.com/', 'https://user:secret@dwd.de/', 'https://www.dwd.de:444/', 'javascript:alert(1)'])
      expect(parse(cap({ info: info(`<web>${web}</web>`) })).warnings[0].sourceUrl).toBe('https://www.dwd.de/warnungen');
    expect(parse(cap({ info: info('<web>https://www.dwd.de/DE/wetter/warnungen.html</web>') })).warnings[0].sourceUrl).toBe('https://www.dwd.de/DE/wetter/warnungen.html');
  });
});

describe('DWD supplied horizontal geometry', () => {
  it('retains exclusion holes instead of filling them and converts CAP order correctly', () => {
    const areas = `<area><areaDesc>Polygonal event area</areaDesc><polygon>${exterior}</polygon><geocode><valueName>EXCLUDE_POLYGON</valueName><value>${hole}</value></geocode><altitude>100</altitude><ceiling>200</ceiling></area>`;
    const w = parse(cap({ info: info('', areas) })).warnings[0];
    expect(w.geometryStatus).toBe('complete'); expect(w.geometry?.type).toBe('Polygon');
    expect(w.geometry!.coordinates).toHaveLength(2);
    expect(pointInGeometry(50.5, 10.5, w.geometry!)).toBe(true);
    expect(pointInGeometry(52, 12, w.geometry!)).toBe(false);
    expect(w.areas[0]).toMatchObject({ altitudeM: 30.48, ceilingM: 60.96 });
  });
  it('retains geocode-only names and does not infer coordinates or full geography from another area', () => {
    const areas = `<area><areaDesc>Nordsee</areaDesc><geocode><valueName>WARNCELLID</valueName><value>101000001</value></geocode></area>`;
    expect(parse(cap({ info: info('', areas) })).warnings[0]).toMatchObject({ geometry: null, geometryStatus: 'unavailable', missingAreaCount: 1 });
    const mixed = parse(cap({ info: info('', areas + `<area><areaDesc>Fused supplied polygon</areaDesc><polygon>${exterior}</polygon></area>`) }));
    expect(mixed).toMatchObject({ completeness: 'complete', partialGeometryWarnings: 1 });
    expect(mixed.warnings[0]).toMatchObject({ geometryStatus: 'partial', missingAreaCount: 1 });
  });
  it.each([
    '50,10 50,14 54,14 54,10', // no invented closure
    '50,10 51,11 52,12 50,10', // zero area
    '50,10 54,14 50,14 54,10 50,10', // bow tie
    '50,10 50,14 54,14 50,14 54,10 50,10', // repeated nonadjacent position
    '91,10 50,14 54,14 91,10',
    '50,170 50,-170 54,-170 54,170 50,170', // unsupported date-line split
  ])('retains a warning with unavailable malformed geometry independently of membership completeness', polygon => {
    const r = parse(cap({ info: info('', `<area><areaDesc>Original area</areaDesc><polygon>${polygon}</polygon></area>`) }));
    expect(r).toMatchObject({ completeness: 'complete', skipped: 0, unlocatedWarnings: 1 });
    expect(r.warnings[0]).toMatchObject({ geometry: null, geometryStatus: 'unavailable', invalidGeometryCount: 1, areaDesc: 'Original area' });
  });
  it('rejects bad or crossing holes without drawing a filled exterior as a fallback', () => {
    for (const bad of ['55,15 55,16 56,16 56,15 55,15', '49,9 51,9 51,11 49,11 49,9']) {
      const areas = `<area><areaDesc>Hole unsupported</areaDesc><polygon>${exterior}</polygon><geocode><valueName>EXCLUDE_POLYGON</valueName><value>${bad}</value></geocode></area>`;
      const w = parse(cap({ info: info('', areas) })).warnings[0]; expect(w.geometry).toBeNull(); expect(w.invalidGeometryCount).toBe(1);
    }
  });
  it('leaves circle coverage explicit while retaining independently supplied polygons', () => {
    const w = parse(cap({ info: info('', `<area><areaDesc>Mixed</areaDesc><polygon>${exterior}</polygon><circle>51,12 10</circle></area>`) })).warnings[0];
    expect(w).toMatchObject({ geometryStatus: 'partial', invalidGeometryCount: 1 }); expect(w.geometry).not.toBeNull(); expect(w.geometryNotes[0]).toContain('circle');
  });
});

describe('DWD ZIP and XML resource/security boundaries', () => {
  it('supports stored and compressed entries without filesystem extraction', () => {
    for (const level of [0, 6] as const) expect(parseDwdStatusZip(zipSync({ 'one.xml': strToU8(cap()) }, { level }), { observedAt: at }).warnings).toHaveLength(1);
  });
  it('rejects truncated, CRC-tampered and unsafe-name archives before any warning result', () => {
    const good = archive(cap()); expect(() => dwdZipEntries(good.subarray(0, good.length - 1))).toThrow(/directory/);
    const damaged = zipSync({ 'one.xml': strToU8(cap()) }, { level: 0 }); damaged[40] ^= 1;
    expect(() => dwdZipEntries(damaged)).toThrow(/checksum|match/);
    expect(() => dwdZipEntries(zipSync({ '../escape.xml': strToU8(cap()) }))).toThrow(/name/);
    expect(() => dwdZipEntries(zipSync({ 'nested/one.xml': strToU8(cap()) }))).toThrow(/name/);
    expect(() => dwdZipEntries(new Uint8Array(DWD_CAP_LIMITS.compressedBytes + 1))).toThrow(/size/);
  });
  it('rejects advertised or actual expansion bombs and excessive entry count', () => {
    const tooLarge = zipSync({ 'large.xml': strToU8('x'.repeat(DWD_CAP_LIMITS.entryBytes + 1)) });
    expect(() => dwdZipEntries(tooLarge)).toThrow(/expanded/);
    const deceptive = zipSync({ 'one.xml': strToU8('x'.repeat(10000)) });
    const view = new DataView(deceptive.buffer, deceptive.byteOffset, deceptive.byteLength);
    view.setUint32(22, 1, true); // matching falsely tiny local and central declarations
    for (let p = 0; p < deceptive.length - 46; p++) if (view.getUint32(p, true) === 0x02014b50) { view.setUint32(p + 24, 1, true); break; }
    expect(() => dwdZipEntries(deceptive)).toThrow(/actual expansion/);
    const many = zipSync(Object.fromEntries(Array.from({ length: DWD_CAP_LIMITS.entries + 1 }, (_, i) => [`${i}.xml`, new Uint8Array()])));
    expect(() => dwdZipEntries(many)).toThrow(/bounds/);
  });
  it('does not resolve DTD entities and rejects namespace spoofing, nesting and undefined entities', () => {
    const dtd = cap().replace('<alert ', '<!DOCTYPE alert [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]><alert ').replace('Bitte beachten.', '&xxe;');
    expect(parse(dtd)).toMatchObject({ completeness: 'partial', warnings: [] });
    expect(parse(cap().replace('urn:oasis:names:tc:emergency:cap:1.2', 'https://example.com/'))).toMatchObject({ completeness: 'partial', warnings: [] });
    expect(parse(cap().replace('Bitte beachten.', '&unknown;'))).toMatchObject({ completeness: 'partial', warnings: [] });
    expect(() => parse(cap({ root: '<x>'.repeat(25) + '</x>'.repeat(25) }))).toThrow(/nesting/);
  });
  it('rejects aggregate work/field limits without returning a false complete subset', () => {
    expect(() => parse(cap({ info: info().replace('Bitte beachten.', 'a'.repeat(DWD_CAP_LIMITS.textCharacters + 1)) }))).toThrow(/text/);
    const areas = '<area><areaDesc>Geocoded</areaDesc></area>'.repeat(DWD_CAP_LIMITS.areas + 1);
    expect(() => parse(cap({ info: info('', areas) }))).toThrow(/areas/);
    expect(() => parseDwdStatusZip(archive(cap()), { observedAt: 'not-a-date' })).toThrow(/date-time/);
  });
  it('bounds exclusion/exterior cross checks on individually simple polygons', () => {
    const circle = (count: number, radius: number) => {
      const points = Array.from({ length: count }, (_, i) => `${52 + radius * Math.sin(i * 2 * Math.PI / count)},${12 + radius * Math.cos(i * 2 * Math.PI / count)}`);
      return [...points, points[0]].join(' ');
    };
    const areas = `<area><areaDesc>Bounded geometry</areaDesc><polygon>${circle(1200, 1)}</polygon><geocode><valueName>EXCLUDE_POLYGON</valueName><value>${circle(1200, 0.5)}</value></geocode></area>`;
    expect(() => parse(cap({ info: info('', areas) }))).toThrow(/comparisons/);
  });
});
