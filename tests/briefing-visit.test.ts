import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppCore } from '../src/main/core';
import { createHandlers, dispatch, type PlatformServices } from '../src/main/handlers';
import type { AtlasStore } from '../src/main/store';
import { buildVisitBriefing, type BriefingPreview } from '../src/shared/briefing';
import { DEFAULT_SETTINGS, IPC, IpcValidationError, validateIpcArgs } from '../src/shared/ipc';
import type { AppSnapshot, SavedLocation } from '../src/shared/types';
import { VISIT_NOW, VISIT_OLD, visitFixture } from './fixtures/visitBriefing';
import { loc } from './helpers';

afterEach(() => { vi.useRealTimers(); });
const options = { now: new Date(VISIT_NOW), appVersion: 'test', timeZone: 'UTC' };

describe('since last visit printable evidence', () => {
  it('shows endpoint times, scope, distinct-ID totals and source-linked examples without inferring resolution', () => {
    const report = buildVisitBriefing(visitFixture(), options);
    expect(report.locationCount).toBe(0);
    for (const value of ['Since last visit', VISIT_OLD, VISIT_NOW, 'active-us', '2.5_day', 'App observation', 'Source update', 'Reply members', 'distinct source IDs', 'New in current recorded reply', 'Updated since baseline', 'No longer returned in current reply', 'not a complete log', 'does not establish that an event ended']) expect(report.html).toContain(value);
    expect(report.references).toEqual(expect.arrayContaining([{ kind: 'alert', id: 'nws-new', url: 'https://api.weather.gov/alerts/nws-new' }, { kind: 'quake', id: 'usgs-new', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-new' }]));
    expect(report.html).toContain("default-src 'none'");
    expect(report.html).not.toContain('<script');
  });

  it('preserves qualified counts for expired endpoints but unknown is never zero for missing or partial evidence', () => {
    const visit = visitFixture();
    visit.feeds.nws.status = 'limited';
    visit.feeds.nws.baseline.state = 'expired';
    visit.feeds.nws.baseline.reason = 'The last visit frame expired overnight.';
    visit.feeds.nws.limits.push('No continuous coverage across the closed interval.');
    const usgs = visit.feeds.usgs;
    usgs.status = 'unavailable'; usgs.current.state = 'partial'; usgs.current.reason = 'Malformed rows were skipped.';
    for (const group of [usgs.new, usgs.updated, usgs.noLongerReturned]) { group.total = null; group.examples = [{ id: 'must-not-render', label: 'unproved change', url: null }]; }
    const html = buildVisitBriefing(visit, options).html;
    expect(html).toContain('Recorded endpoint evidence — coverage limited');
    expect(html).toContain('expired'); expect(html).toContain('expired overnight');
    expect(html).toContain('No continuous coverage'); expect(html).toContain('Malformed rows were skipped');
    expect(html).toContain('NWS active alerts</td><td>1</td><td>1</td><td>1</td>');
    expect(html).toContain('USGS earthquakes</td><td>Unknown</td><td>Unknown</td><td>Unknown</td>');
    expect(html).not.toContain('must-not-render');
  });

  it('explains first-visit and failed comparisons and safely escapes provider strings and URL destinations', () => {
    const visit = visitFixture();
    visit.previousStartedAt = null; visit.error = '<img src=x onerror=steal()>';
    visit.feeds.nws.current.scope = '<iframe src="https://evil.example">';
    visit.feeds.nws.new.examples = [
      { id: '<script>alert(1)</script>', label: '<b onclick="bad()">untrusted & text</b>', url: 'javascript:alert(1)' },
      { id: 'evil-host', label: 'deceptive host', url: 'https://api.weather.gov.evil.example/alerts/x' },
      { id: 'credentials', label: 'credentials', url: 'https://user:pw@api.weather.gov/alerts/x' },
      { id: 'nonrecord', label: 'not a record', url: 'https://api.weather.gov/gridpoints/x' },
      { id: 'query', label: 'safe query', url: 'https://api.weather.gov/alerts/x?a=1&b=%22' },
    ];
    visit.feeds.nws.new.total = 5;
    const report = buildVisitBriefing(visit, { ...options, organization: '<script>org</script>' });
    expect(report.html).toContain('No previous visit baseline');
    expect(report.html).toContain('Unknown change totals are not zero');
    expect(report.html).toContain('&lt;img src=x'); expect(report.html).toContain('&lt;iframe');
    expect(report.html).toContain('&lt;script&gt;org'); expect(report.html).toContain('untrusted &amp; text');
    expect(report.html).not.toMatch(/<script|<img|<iframe|href="javascript:|href="https:\/\/user/);
    expect(report.html).not.toContain('href="https://api.weather.gov.evil');
    expect(report.html).toContain('href="https://api.weather.gov/alerts/x?a=1&amp;b=%22"');
    expect(report.references.filter(value => value.url)).toHaveLength(2); // safe NWS example plus USGS
  });

  it('bounds each change group to five examples and accurately labels known zero groups', () => {
    const visit = visitFixture();
    visit.feeds.nws.new = { total: 20, truncated: true, examples: Array.from({ length: 20 }, (_, i) => ({ id: `example-${i}`, label: `Example ${i}`, url: null })) };
    visit.feeds.usgs.updated = { total: 0, truncated: false, examples: [] };
    const html = buildVisitBriefing(visit, options).html;
    expect(html).toContain('Source ID: example-4'); expect(html).not.toContain('Source ID: example-5');
    expect(html).toContain('Showing 5 of 20'); expect(html).toContain('USGS earthquakes</td><td>1</td><td>0</td><td>1');
    expect(html).not.toContain('Updated since baseline — 0');
  });
});

function harness() {
  let visit = visitFixture();
  const snap = { settings: DEFAULT_SETTINGS, locations: [loc()], alerts: [], quakes: [], evaluations: {}, feeds: {
    nws: { fromCache: false, error: null, recordCount: 0, lastSuccessAt: null, sourceUpdatedAt: null }, usgs: { fromCache: false, error: null, recordCount: 0, lastSuccessAt: null, sourceUpdatedAt: null },
  }, freshness: { nws: 'unavailable', usgs: 'unavailable' } } as unknown as AppSnapshot;
  const core = { snapshot: () => snap, visitBriefing: () => visit } as unknown as AppCore;
  const clear = vi.fn(() => 7), store = { clearHistory: clear } as unknown as AtlasStore;
  const saveText = vi.fn(async (_name: string, _filters: unknown, _html: string) => 'report.html');
  const savePdf = vi.fn(async (_name: string, _html: string) => 'report.pdf');
  const platform = { appVersion: 'test', saveTextFile: saveText, savePdfFromHtml: savePdf } as unknown as PlatformServices;
  const handlers = createHandlers(core, store, async () => { throw new Error('No network in briefing contract fixtures'); }, platform);
  const preview = (request: unknown) => dispatch(handlers, IPC.briefingPreview, [request]) as Promise<BriefingPreview>;
  const exportTo = (request: unknown, format: 'html' | 'pdf' = 'html') => dispatch(handlers, IPC.briefingExport, [request, format]);
  return { preview, exportTo, snap, clear, handlers, saveText, savePdf, setVisit: (value: typeof visit) => { visit = value; } };
}

describe('frozen briefing IPC and large existing location exports', () => {
  it('exports the exact captured HTML/PDF while new source evidence arrives; refresh captures a new document', async () => {
    const h = harness(), frozen = await h.preview({ mode: 'visit' });
    expect(frozen).toMatchObject({ mode: 'visit', exportPolicy: 'frozen', locationCount: 0 });
    const later = visitFixture(); later.feeds.nws.new.total = 99; h.setVisit(later);
    await h.exportTo({ previewId: frozen.previewId }); await h.exportTo({ previewId: frozen.previewId }, 'pdf');
    expect(h.saveText.mock.calls[0][2]).toBe(frozen.html);
    expect(h.savePdf.mock.calls[0][1]).toBe(frozen.html);
    expect(h.saveText.mock.calls[0][0]).toContain('since-last-visit');
    const fresh = await h.preview({ mode: 'visit' });
    expect(fresh.previewId).not.toBe(frozen.previewId); expect(fresh.html).toContain('NWS active alerts</td><td>99');
  });

  it('keeps legacy array/string preview and fresh export plus smaller location frozen export compatible', async () => {
    const h = harness();
    const old = await dispatch(h.handlers, IPC.briefingPreview, [['loc1']]);
    expect(typeof old).toBe('string');
    const frozen = await h.preview({ mode: 'locations', locationIds: ['loc1'] });
    h.snap.locations[0].notes = 'A later live update';
    await h.exportTo({ previewId: frozen.previewId });
    expect(h.saveText.mock.calls[0][2]).toBe(frozen.html);
    await h.exportTo(['loc1']);
    expect(h.saveText.mock.calls[1][2]).toContain('A later live update');
  });

  it('supports a valid >8 MiB location report through the dialog current-export policy without a huge DOM payload', async () => {
    const h = harness();
    h.snap.locations = largeLocations(900);
    const ids = h.snap.locations.map(value => value.id);
    const preview = await h.preview({ mode: 'locations', locationIds: ids });
    expect(preview).toMatchObject({ exportPolicy: 'current-locations', previewId: null, html: '', locationCount: 900 });
    expect(preview.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    // This is the same legacy-array request deliberately used by the normal dialog fallback.
    h.snap.locations[0].notes = 'Updated at export';
    await h.exportTo(ids); await h.exportTo(ids, 'pdf');
    expect(Buffer.byteLength(h.saveText.mock.calls[0][2])).toBeGreaterThan(8 * 1024 * 1024);
    expect(h.saveText.mock.calls[0][2]).toContain('Updated at export');
    expect(h.savePdf.mock.calls[0][1]).toContain('Updated at export');
  });

  it('bounds retained tokens by count and ten-minute staleness', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(VISIT_NOW));
    const h = harness(), first = await h.preview({ mode: 'visit' });
    let latest = first;
    for (let i = 0; i < 4; i++) latest = await h.preview({ mode: 'visit' });
    await expect(h.exportTo({ previewId: first.previewId })).rejects.toThrow(/expired.*Refresh/);
    await expect(h.exportTo({ previewId: latest.previewId })).resolves.toBe('report.html');
    vi.advanceTimersByTime(10 * 60_000);
    await expect(h.exportTo({ previewId: latest.previewId })).rejects.toThrow(/expired.*Refresh/);
  });

  it('bounds total retained HTML bytes, even before the four-token limit', async () => {
    const h = harness(); h.snap.locations = largeLocations(600);
    const request = { mode: 'locations', locationIds: h.snap.locations.map(value => value.id) };
    const first = await h.preview(request), second = await h.preview(request), third = await h.preview(request);
    expect(first.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(first.byteLength * 3).toBeGreaterThan(16 * 1024 * 1024);
    await expect(h.exportTo({ previewId: first.previewId })).rejects.toThrow(/expired/);
    await expect(h.exportTo({ previewId: second.previewId })).resolves.toBe('report.html');
    await expect(h.exportTo({ previewId: third.previewId })).resolves.toBe('report.html');
  });

  it('invalidates visit tokens only after successful history clear and keeps existing location tokens', async () => {
    const h = harness(), visit = await h.preview({ mode: 'visit' }), location = await h.preview({ mode: 'locations', locationIds: ['loc1'] });
    h.clear.mockImplementationOnce(() => { throw new Error('Storage failed'); });
    await expect(dispatch(h.handlers, IPC.historyClear, [])).rejects.toThrow('Storage failed');
    await expect(h.exportTo({ previewId: visit.previewId })).resolves.toBe('report.html');
    await expect(dispatch(h.handlers, IPC.historyClear, [])).resolves.toBe(7);
    await expect(h.exportTo({ previewId: visit.previewId })).rejects.toThrow(/expired/);
    await expect(h.exportTo({ previewId: location.previewId })).resolves.toBe('report.html');
  });

  it('accepts narrow new request shapes and rejects renderer HTML, extra fields and invalid tokens', () => {
    expect(validateIpcArgs(IPC.briefingPreview, [{ mode: 'visit' }])).toEqual([{ mode: 'visit' }]);
    expect(validateIpcArgs(IPC.briefingExport, [{ previewId: 'valid-id' }, 'pdf'])).toEqual([{ previewId: 'valid-id' }, 'pdf']);
    for (const args of [[{ mode: 'visit', locationIds: [] }], [{ mode: 'visit', html: '<script/>' }], [{ mode: 'locations', locationIds: [], url: 'https://evil.example' }]]) expect(() => validateIpcArgs(IPC.briefingPreview, args)).toThrow(IpcValidationError);
    for (const args of [[{ previewId: 'x', html: 'renderer content' }, 'html'], [{ previewId: '../x' }, 'html'], [{ previewId: null }, 'pdf']]) expect(() => validateIpcArgs(IPC.briefingExport, args)).toThrow(IpcValidationError);
  });
});

function largeLocations(count: number): SavedLocation[] {
  // All fields remain within the existing saved-location input limits. Escaping
  // 2,000 ampersands expands each valid note, exercising actual UTF-8 cache bytes.
  return Array.from({ length: count }, (_, i) => loc({ id: `p${i}`, name: `Place ${i}`, notes: '&'.repeat(2000) }));
}
