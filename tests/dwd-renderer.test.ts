import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataSourceCollection, Event, JulianDate, type CesiumWidget } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DwdPlaceWarnings, DwdSourceStatus, DwdWarningDetails, dwdPlaceMatches, dwdView, dwdWarningTiming } from '../src/renderer/components/DwdWarnings';
import { PageView, type PageCtx } from '../src/renderer/components/Pages';
import { RecordDetails } from '../src/renderer/components/RecordDetails';
import { Hud } from '../src/renderer/components/Hud';
import { LayersPanel } from '../src/renderer/components/LayersPanel';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import { warningMapRecords, warningPickId } from '../src/renderer/map/warningGeometry';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { AppSnapshot } from '../src/shared/types';
import { DWD_AT, dwdFixture, dwdRecord, dwdSnapshot } from './fixtures/dwdWarning';
import { loc } from './helpers';

vi.mock('../src/renderer/lib/api', () => ({ api: { openExternal: vi.fn(), refreshLayer: vi.fn() }, errorText: String }));
afterEach(() => vi.useRealTimers());
const htmlText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const geocodeOnly = () => dwdFixture({ id: 'geocode-only', headline: 'Nur namentlich verortete Testwarnung', geometry: null, geometryStatus: 'unavailable', missingAreaCount: 1,
  areas: [{ description: 'Unbekanntes Testgebiet', geometry: null, geocodes: [{ name: 'WARNCELLID', value: '999999' }], altitudeM: null, ceilingM: null }], geometryNotes: ['No polygon supplied for this named area.'] });

describe('DWD source and original warning display', () => {
  it('distinguishes off, loading, missing, current empty, partial and failed previous replies, including zero', () => {
    const render = (snapshot = dwdSnapshot(), enabled = true, replayActive = false) => htmlText(renderToStaticMarkup(createElement(DwdSourceStatus, { snapshot, enabled, replayActive })));
    expect(dwdView(undefined, false).state).toBe('disabled');
    expect(render(dwdSnapshot(), false)).toContain('are off');
    const loading = { ...dwdSnapshot([], { state: 'loading', lastSuccessAt: null }), dwdWarnings: undefined };
    expect(render(loading)).toContain('Loading DWD warnings');
    expect(render({ ...loading, status: { ...loading.status, state: 'error', error: 'Unavailable' } })).toContain('does not mean no warnings');
    expect(render(dwdSnapshot([]))).toContain('no remaining unexpired German warnings');
    const previous = render(dwdSnapshot([], { state: 'error', error: 'Publisher timeout', freshness: 'stale' }));
    expect(previous).toContain('last observed reply; current warning coverage is unknown'); expect(previous).not.toContain('no remaining unexpired German warnings');
    expect(render(dwdSnapshot([], { skippedRecords: 2 }))).toContain('zero does not establish no warnings');
    expect(render(dwdSnapshot(), true, true)).toContain('not recorded in Replay');
  });

  it('opens a geocode-only warning in existing RecordDetails without a fake map location or Focus button', () => {
    const warning = geocodeOnly(), snapshot = dwdSnapshot([warning]);
    const html = renderToStaticMarkup(createElement(RecordDetails, { layer: 'dwd', record: null, dwdWarning: warning, layerEnabled: true, snaps: { dwd: snapshot }, tracked: false, orbitShown: false, onTrack: vi.fn(), onOrbit: vi.fn(), onSelect: vi.fn(), onFocus: vi.fn() }));
    expect(html).toContain(warning.headline!); expect(html).toContain('No usable supplied map geometry'); expect(html).toContain('999999');
    expect(html).not.toContain('Focus supplied DWD geometry'); expect(html).not.toContain('Position</dt>');
    expect(html).toContain('Original warning text'); expect(html).toContain('CC BY 4.0'); expect(html).toContain(warning.sourceUrl);
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
  });

  it('preserves German text and source clock values, explicitly missing expiry, geometry limitations and safe text rendering', () => {
    const warning = dwdFixture({ expires: null, description: '<script>untrusted</script> & original text', geometryStatus: 'partial', missingAreaCount: 1, invalidGeometryCount: 2, geometryNotes: ['Unsupported area shape was omitted.'] });
    const html = renderToStaticMarkup(createElement(DwdWarningDetails, { warning, snapshot: dwdSnapshot([warning]), enabled: true, record: dwdRecord(warning), onFocus: vi.fn() }));
    expect(html).toContain(DWD_AT); expect(html).toContain('DWD did not supply an expiry'); expect(html).toContain('2 invalid geometry items skipped');
    expect(html).toContain('Unsupported area shape'); expect(html).toContain('lang="de-DE"'); expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt; &amp;');
    expect(html).not.toContain('<script>'); expect(html).toContain('altitude and ceiling restrictions are not evaluated');
    expect(dwdWarningTiming(warning, Date.parse(DWD_AT))).toContain('retrieved');
    expect(dwdWarningTiming(dwdFixture(), Date.parse(DWD_AT) + 2 * 3600_000)).toContain('Expired');
    expect(dwdWarningTiming(dwdFixture({ onset: '2026-11-11T11:00:00.000Z', effective: '2026-11-11T12:30:00.000Z' }), Date.parse(DWD_AT))).toBe('Upcoming');
  });

  it('rounds converted altitude and ceiling values without losing the original warning text', () => {
    const warning = dwdFixture();
    warning.areas[0] = { ...warning.areas[0], altitudeM: 3000.0000045600004, ceilingM: 3499.999995 };
    const html = htmlText(renderToStaticMarkup(createElement(DwdWarningDetails, { warning, snapshot: dwdSnapshot([warning]), enabled: true, record: dwdRecord(warning), onFocus: vi.fn() })));
    expect(html).toContain('altitude 3,000 m; ceiling 3,500 m');
    expect(html).not.toContain('3000.000004'); expect(html).toContain('Originaler deutscher Warntext.');
  });

  it('shows mapped versus total warnings in HUD, including geocode-only records, and hides counts in Replay', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(DWD_AT));
    const snapshot = dwdSnapshot(Array.from({ length: 21 }, (_, i) => i < 16 ? dwdFixture({ id: `mapped-${i}` }) : { ...geocodeOnly(), id: `unmapped-${i}` }));
    const render = (playbackActive: boolean) => htmlText(renderToStaticMarkup(createElement(Hud, { get: () => null, snaps: { dwd: snapshot }, layersOn: ['dwd'], mode: 'normal', playbackTime: null, playbackActive })));
    expect(render(false)).toContain('DWD 16 mapped / 21 total');
    expect(render(true)).not.toContain('DWD 16');
  });

  it('hides live DWD source totals and notes when the expanded Weather layer stays open during Replay', () => {
    const snapshot = dwdSnapshot([dwdFixture()], { note: 'LIVE_DWD_COUNTS_SENTINEL' });
    const render = (playbackActive: boolean) => renderToStaticMarkup(createElement(LayersPanel, { settings: { ...DEFAULT_SETTINGS, layersEnabled: ['dwd'] }, snaps: { dwd: snapshot }, playbackActive,
      onPatch: vi.fn(), imagery: { product: null, date: '', compare: false, compareDate: '', opacity: 1, split: 0.5 }, onImagery: vi.fn() }));
    expect(render(false)).toContain('LIVE_DWD_COUNTS_SENTINEL');
    expect(render(true)).not.toContain('LIVE_DWD_COUNTS_SENTINEL');
    expect(render(true)).toContain('DWD warnings are not recorded in Replay');
  });
});

describe('supplied horizontal DWD area matching and existing navigation', () => {
  it('respects holes, multipart areas and boundaries, retaining unknown unlocated portions', () => {
    const complete = dwdFixture(), partial = dwdFixture({ geometryStatus: 'partial', missingAreaCount: 1 });
    expect(dwdPlaceMatches([complete], { lat: 52.2, lon: 13.2 })[0].match).toBe('inside');
    expect(dwdPlaceMatches([complete], { lat: 52.5, lon: 13.5 })[0].match).toBe('outside');
    expect(dwdPlaceMatches([complete], { lat: 53.5, lon: 10.5 })[0].match).toBe('inside');
    expect(dwdPlaceMatches([complete], { lat: 52.5, lon: 13 })[0].match).toBe('inside');
    expect(dwdPlaceMatches([partial, geocodeOnly()], { lat: 40, lon: 0 }).map(value => value.match)).toEqual(['unknown', 'unknown']);
    const html = htmlText(renderToStaticMarkup(createElement(DwdPlaceWarnings, { place: loc({ lat: 52.2, lon: 13.2 }), snapshot: dwdSnapshot([complete, geocodeOnly()]), enabled: true, onSelect: vi.fn() })));
    expect(html).toContain('Supplied horizontal intersections: 1'); expect(html).toContain('1 warning(s) have unlocated portions');
    expect(html).toContain('briefing and saved-location NWS/USGS counts do not include DWD');
  });

  it('puts all warnings, including non-mappable ones, in Events and Official bulletins and suppresses them during Replay', () => {
    const warnings = [dwdFixture(), geocodeOnly()], snapshot = dwdSnapshot(warnings);
    const ctx = { snap: { alerts: [], quakes: [], supersededAlertIds: [], settings: { ...DEFAULT_SETTINGS, layersEnabled: ['dwd'] } } as unknown as AppSnapshot, layerSnaps: { dwd: snapshot }, enableLayers: vi.fn(), selectRecord: vi.fn(), selectEvent: vi.fn(), openPlayback: vi.fn() } as unknown as PageCtx;
    for (const page of ['events', 'bulletins'] as const) {
      const html = renderToStaticMarkup(createElement(PageView, { page, ctx, airport: null }));
      expect(html).toContain('data-dwd-warning-id="geocode-only"'); expect(html).toContain(geocodeOnly().headline!);
      const replay = renderToStaticMarkup(createElement(PageView, { page, ctx: { ...ctx, playbackActive: true }, airport: null }));
      expect(replay).not.toContain('data-dwd-warning-id='); expect(replay).toContain('DWD warnings are not recorded in Replay');
    }
    const off = renderToStaticMarkup(createElement(PageView, { page: 'events', ctx: { ...ctx, snap: { ...ctx.snap, settings: { ...ctx.snap.settings, layersEnabled: [] } } }, airport: null }));
    expect(off).not.toContain('aria-label="DWD warning source"');
  });
});

it('renders and replaces every supplied DWD polygon/hole under the same warning pick ID, hiding all during Replay', async () => {
  const dataSources = new DataSourceCollection();
  const widget = { dataSources, camera: { positionCartographic: { height: 100_000 } }, scene: { preRender: new Event(), morphComplete: new Event(), requestRender() {} } };
  const renderer = new LayerRenderer(widget as unknown as CesiumWidget), warning = dwdFixture();
  const opts = { selectedId: warning.id, selectedLayer: 'dwd' as const, trackedId: null };
  try {
    const record = dwdRecord(warning);
    renderer.update('dwd', [record], opts); await Promise.resolve();
    const source = dataSources.get(0);
    expect(source.entities.values).toHaveLength(2);
    for (const entity of source.entities.values) expect(warningPickId(entity.id)).toBe(warning.id);
    const first = source.entities.getById(`dwd|${warning.id}|0`)!;
    expect(first.polygon?.hierarchy?.getValue(JulianDate.now()).holes).toHaveLength(1);
    renderer.update('metar', [{ ...record, id: 'other-station', geometry: null }], opts);
    renderer.update('dwd', [record], opts);
    expect(source.entities.getById(first.id)).toBe(first); // unrelated provider tick preserves geometry objects
    renderer.update('dwd', [record], { ...opts, selectedId: null, selectedLayer: null });
    expect(source.entities.getById(first.id)).not.toBe(first); // selection styling still updates
    const changed = dwdFixture({ geometry: { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] } });
    renderer.update('dwd', [dwdRecord(changed)], opts);
    expect(source.entities.values).toHaveLength(1); expect(source.entities.getById(first.id)).not.toBe(first);
    expect(source.entities.getById(`dwd|${warning.id}|1`)).toBeUndefined();
    renderer.setVisible('dwd', false); expect(source.show).toBe(false);
    renderer.update('dwd', [dwdRecord(warning)], opts); expect(source.show).toBe(false); // updates while hidden cannot leak shapes
    renderer.setVisible('dwd', true); expect(source.show).toBe(true);
    renderer.update('dwd', [], opts); expect(source.entities.values).toHaveLength(0);
  } finally { renderer.destroy(); }
});

it('never invents a marker for absent/expired geometry, or an expiry for a message without one', () => {
  const warning = dwdFixture(), missingExpiry = dwdFixture({ id: 'no-expiry', expires: null });
  expect(warningMapRecords(dwdSnapshot([warning, missingExpiry, geocodeOnly()]), Date.parse(DWD_AT) + 2 * 3600_000).map(record => record.id)).toEqual(['no-expiry']);
  expect(warningPickId('dwd|publisher|original|1')).toBe('publisher|original');
  expect(warningPickId('rec|dwd|warning')).toBeNull();
});
