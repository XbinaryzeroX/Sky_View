import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DWD_STATUS_URL, FeedHttpError, assertAllowedUrl, fetchDwdArchive, type DwdArchiveResponse, type FetchDwdArchive } from '../src/main/feeds/http';
import { DwdSource, dwdFreshness } from '../src/main/layers/dwdSource';
import { LayerManager } from '../src/main/layers/manager';
import { AtlasStore } from '../src/main/store';
import { DWD_CAP_LIMITS } from '../src/shared/dwd';
import { DEFAULT_SETTINGS, IPC, validateIpcArgs } from '../src/shared/ipc';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { tempDbPath } from './helpers';

const at = Date.parse('2026-11-11T12:02:00Z');
const date = (ms: number) => new Date(ms);
const named = readFileSync(join(__dirname, 'fixtures/dwd-source/named.xml'));
const area = readFileSync(join(__dirname, 'fixtures/dwd-source/area.xml'));
const zip = zipSync({ 'named.xml': named, 'area.xml': area });
const full: DwdArchiveResponse = { status: 200, bytes: zip, lastModified: date(at - 60_000).toUTCString(), etag: '"test"' };
const unchanged: DwdArchiveResponse = { status: 304, bytes: null, lastModified: null, etag: null };
const stores: AtlasStore[] = [];
function harness(download = vi.fn<FetchDwdArchive>(), path = tempDbPath()) {
  let time = at;
  const store = new AtlasStore(path);
  stores.push(store);
  const now = () => date(time);
  const source = new DwdSource(store, download, () => 'AtlasWatch/test', now);
  return { source, store, now, download, path, advance: (seconds: number) => { time += seconds * 1000; } };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('DWD complete snapshot service', () => {
  it('shares in-flight checks across callers and retains issue, receipt and publisher clocks on a conditional hit', async () => {
    const h = harness();
    h.download.mockResolvedValueOnce(full).mockResolvedValueOnce(unchanged);
    const [first, duplicate] = await Promise.all([h.source.refresh(), h.source.refresh()]);
    expect(first).toBe(duplicate);
    expect(first.warnings).toHaveLength(2);
    expect(first.warnings.find(w => w.geometry)?.timing).toBe('upcoming');
    expect(first.records).toHaveLength(1);
    expect(first.records[0].id).toBe(first.warnings.find(w => w.geometry)?.id);
    expect(h.download).toHaveBeenCalledTimes(1);
    h.advance(65);
    expect((await h.source.refresh()).warnings.find(w => w.geometry)?.timing).toBe('active');
    expect(h.download).toHaveBeenCalledTimes(1);
    h.advance(240);
    const second = await h.source.refresh();
    expect(h.download.mock.calls[1][0]).toMatchObject({ 'If-None-Match': '"test"', 'If-Modified-Since': full.lastModified });
    expect(second.sourceUpdatedAt).toBe(first.sourceUpdatedAt);
    expect(second.checkedAt).toBe(h.now().toISOString());
    expect(second.note).toContain(first.checkedAt);
    expect(second.records[0].observedAt).toBe(first.records[0].observedAt);
    h.advance(700);
    expect(dwdFreshness(h.source.current()!, h.now().getTime())).toBe('stale');
    expect(h.source.current()!.warnings.map(w => w.capIdentifier)).toEqual(['atlas-test-named.DEU']);
    expect(h.source.current()!.records).toEqual([]);
  });

  it('restores the original archive from SQLite and retains its clock and members on an incomplete refresh', async () => {
    const h = harness();
    h.download.mockResolvedValueOnce(full);
    const original = await h.source.refresh();
    const reopened = harness(vi.fn<FetchDwdArchive>(), h.path);
    reopened.advance(301);
    expect(reopened.source.current()!.warnings.map(w => w.id)).toEqual(original.warnings.map(w => w.id));
    reopened.download.mockResolvedValueOnce({ ...full, bytes: zipSync({ 'valid.xml': named, 'incomplete.xml': Buffer.from('<other/>') }) });
    await expect(reopened.source.refresh()).rejects.toThrow(/incomplete/i);
    expect(reopened.source.current()!.checkedAt).toBe(original.checkedAt);
    expect(reopened.source.current()!.warnings).toHaveLength(2);
    reopened.advance(31);
    reopened.download.mockResolvedValueOnce({ ...full, etag: '"empty"', bytes: zipSync({}) });
    expect((await reopened.source.refresh()).warnings).toEqual([]);
  });

  it('rejects unmatched conditional replies and retries without validators', async () => {
    const h = harness();
    h.download.mockResolvedValueOnce(unchanged).mockResolvedValueOnce(full)
      .mockResolvedValueOnce({ ...unchanged, etag: '"mismatch"' }).mockResolvedValueOnce(full);
    await expect(h.source.refresh()).rejects.toThrow(/304/);
    expect(h.source.current()).toBeNull();
    h.advance(31);
    await h.source.refresh();
    h.advance(301);
    await expect(h.source.refresh()).rejects.toThrow(/304/);
    expect(h.source.current()!.warnings).toHaveLength(2);
    h.advance(31);
    await h.source.refresh();
    expect(h.download.mock.calls[3][0]['If-None-Match']).toBeUndefined();
    expect(h.download.mock.calls[3][0]['If-Modified-Since']).toBeUndefined();
  });

  it('keeps a publisher pause across restart and does not date a fresh download from its newest warning', async () => {
    const h = harness();
    h.download.mockResolvedValueOnce({ ...full, lastModified: null }).mockRejectedValueOnce(new FeedHttpError('DWD busy', 503, 600, 'http'));
    const result = await h.source.refresh();
    expect(result.sourceUpdatedAt).toBeNull();
    expect(dwdFreshness(result, at)).toBe('unavailable');
    h.advance(300);
    await expect(h.source.refresh()).rejects.toThrow(/DWD busy/);
    const reopened = harness(vi.fn<FetchDwdArchive>(), h.path);
    reopened.advance(301);
    await expect(reopened.source.refresh()).rejects.toThrow(/pause/);
    expect(reopened.download).not.toHaveBeenCalled();
    expect(reopened.source.current()!.checkedAt).toBe(result.checkedAt);
  });

  it('uses the layer count for all warnings, preserves a last-observed outage and hides cached data after disabling', async () => {
    const h = harness();
    const settings = { ...DEFAULT_SETTINGS, layersEnabled: ['dwd'] };
    const layer = new LayerManager({ store: h.store, dwd: h.source, fetchJson: vi.fn(), fetchText: vi.fn(), getSettings: () => settings,
      userAgent: () => '', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: vi.fn(), now: h.now });
    h.download.mockResolvedValueOnce(full).mockRejectedValueOnce(new FeedHttpError('offline', null, null, 'network'));
    await layer.refresh('dwd');
    expect(layer.snapshot('dwd').status).toMatchObject({ recordCount: 2, state: 'ok', freshness: 'fresh' });
    expect(layer.snapshot('dwd').records).toHaveLength(1);
    h.advance(301);
    await layer.refresh('dwd');
    expect(layer.snapshot('dwd').status).toMatchObject({ state: 'error', recordCount: 2, lastSuccessAt: date(at).toISOString() });
    h.advance(65);
    expect(layer.snapshot('dwd').status.recordCount).toBe(1);
    settings.layersEnabled = [];
    layer.syncEnabled();
    await layer.refresh('dwd');
    expect(layer.snapshot('dwd').dwdWarnings).toBeUndefined();
    expect(layer.snapshot('dwd').records).toHaveLength(0);
    expect(h.download).toHaveBeenCalledTimes(2);
  });

  it('keeps the display empty if a previously enabled request finishes after the switch is turned off', async () => {
    const h = harness();
    const settings = { ...DEFAULT_SETTINGS, layersEnabled: ['dwd'] };
    const layer = new LayerManager({ store: h.store, dwd: h.source, fetchJson: vi.fn(), fetchText: vi.fn(), getSettings: () => settings,
      userAgent: () => '', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: vi.fn(), now: h.now });
    let finish!: (response: DwdArchiveResponse) => void;
    h.download.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = layer.refresh('dwd');
    settings.layersEnabled = [];
    layer.syncEnabled();
    finish(full);
    await pending;
    expect(layer.snapshot('dwd')).toMatchObject({ status: { state: 'idle', enabled: false, recordCount: 0 }, records: [] });
    expect(layer.snapshot('dwd').dwdWarnings).toBeUndefined();
  });
});

describe('DWD main-process destination and transport', () => {
  it('accepts only the configured data path and opens official web and licence links', () => {
    expect(assertAllowedUrl(DWD_STATUS_URL).href).toBe(DWD_STATUS_URL);
    expect(() => assertAllowedUrl(DWD_STATUS_URL + '?extra=true')).toThrow();
    expect(isAllowedExternalUrl('https://www.dwd.de/warnungen')).toBe(true);
    expect(isAllowedExternalUrl('https://www.dwd.de.example.org/warnungen')).toBe(false);
    expect(isAllowedExternalUrl('https://www.dwd.de:8080/warnungen')).toBe(false);
    expect(validateIpcArgs(IPC.providersTest, ['dwd'])).toEqual(['dwd']);
  });
  it('reads bounded binary bytes and validators, accepts 304, and rejects redirected or partial archives', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(Buffer.from(zip), { headers: { etag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://api.weather.gov/' } }))
      .mockResolvedValueOnce(new Response('part', { status: 206 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchDwdArchive({})).toMatchObject({ bytes: Buffer.from(zip), etag: '"one"' });
    expect(await fetchDwdArchive({})).toMatchObject({ bytes: null, status: 304 });
    await expect(fetchDwdArchive({})).rejects.toThrow(/redirect/i);
    await expect(fetchDwdArchive({})).rejects.toThrow(/complete/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('counts streamed body bytes even without a content length', async () => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(DWD_CAP_LIMITS.compressedBytes));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(fetchDwdArchive({})).rejects.toThrow(/download limit/);
  });
});
