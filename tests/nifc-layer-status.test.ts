import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayersPanel } from '../src/renderer/components/LayersPanel';
import type { LayerSnapshot, LayerStatus } from '../src/shared/layers';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';

vi.mock('../src/renderer/lib/api', () => ({ api: { refreshLayer: vi.fn() } }));
afterEach(() => vi.useRealTimers());
const NOW = '2026-11-11T12:00:00.000Z';
function snapshot(patch: Partial<LayerStatus> = {}): LayerSnapshot {
  return { records: [], status: { id: 'firePerimeters', enabled: true, state: 'ok', freshness: 'fresh', recordCount: 0, skippedRecords: 0,
    lastSuccessAt: NOW, sourceUpdatedAt: null, lastAttemptAt: NOW, nextAttemptAt: null, consecutiveFailures: 0, note: null, error: null, ...patch } };
}
function render(source?: LayerSnapshot, enabled = true, playbackActive = false) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
  const html = renderToStaticMarkup(createElement(LayersPanel, { groupsOpen: true, settings: { ...DEFAULT_SETTINGS, layersEnabled: enabled ? ['firePerimeters'] : [] },
    snaps: source ? { firePerimeters: source } : {}, playbackActive, onPatch: vi.fn(),
    imagery: { product: null, date: '', compare: false, compareDate: '', opacity: 1, split: 0.5 }, onImagery: vi.fn() }));
  // The existing row contains both its summary and the expanded source status.
  const row = html.slice(html.indexOf('Wildfire perimeters'), html.indexOf('Fire detections', html.indexOf('Wildfire perimeters')) > 0 ? html.indexOf('Fire detections', html.indexOf('Wildfire perimeters')) : html.indexOf('</details>', html.indexOf('Wildfire perimeters')) + 10);
  return { html: row, text: row.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') };
}

describe('NIFC status in the existing Layers source panel', () => {
  it('does not turn an unqueried, loading or failed first reply into Current or numeric zero', () => {
    for (const source of [undefined, snapshot({ state: 'loading', lastSuccessAt: null }), snapshot({ state: 'error', error: 'HTTP 503', lastSuccessAt: null, freshness: 'fresh' })]) {
      const { text } = render(source);
      expect(text).toContain('Coverage unknown'); expect(text).toContain('coverage is unknown');
      expect(text).not.toContain('0 perimeter'); expect(text).not.toContain('Current ·'); expect(text).not.toContain('Latest successful reply');
    }
    expect(render(snapshot({ state: 'error', error: 'HTTP 503', lastSuccessAt: null })).text).toContain('Last refresh failed: HTTP 503');
  });

  it('shows a legitimate complete empty reply as zero features without asserting no fires', () => {
    const { html, text } = render(snapshot());
    expect(html).toContain('data-nifc-state="current"'); expect(text).toContain('Latest reply: 0 perimeter features');
    expect(text).toContain('complete reply returned no perimeter features'); expect(text).toContain('does not establish no fires');
    expect(html).toContain(`dateTime="${NOW}"`);
  });

  it('labels a failed or stale prior zero and nonzero as last observed, with the original receipt and next check', () => {
    for (const recordCount of [0, 7]) {
      const { html, text } = render(snapshot({ state: 'error', error: 'Publisher unavailable', recordCount, nextAttemptAt: '2026-11-11T12:10:00.000Z' }));
      expect(html).toContain('data-nifc-state="last-observed"'); expect(text).toContain(`Last observed: ${recordCount} perimeter features`);
      expect(text).toContain('current perimeter coverage is unknown'); expect(text).toContain('Next scheduled check');
      expect(html).toContain(`dateTime="${NOW}"`); expect(text).not.toContain('Latest successful reply');
    }
    expect(render(snapshot({ freshness: 'stale' })).text).toContain('Last observed: 0 perimeter features');
    expect(render(snapshot({ state: 'loading' })).text).toContain('Refreshing NIFC');
  });

  it('qualifies skipped records and a zero subset without claiming a complete empty source', () => {
    const { html, text } = render(snapshot({ skippedRecords: 2 }));
    expect(html).toContain('data-nifc-state="partial"'); expect(text).toContain('retrieved subset');
    expect(text).toContain('2 source features were skipped'); expect(text).not.toContain('complete reply returned no');
  });

  it('shows off and Replay status without live counts, reply notes, errors, check times or Refresh', () => {
    const source = snapshot({ recordCount: 4321, note: 'LIVE_NIFC_NOTE', error: 'LIVE_NIFC_ERROR', nextAttemptAt: '2026-11-11T12:10:00.000Z' });
    const replay = render(source, true, true);
    expect(replay.html).toContain('data-nifc-state="replay"'); expect(replay.text).toContain('not recorded in Replay');
    for (const value of ['4,321', 'LIVE_NIFC', NOW, 'Refresh', 'Next scheduled check']) expect(replay.html).not.toContain(value);
    const off = render(source, false);
    expect(off.html).toContain('data-nifc-state="disabled"'); expect(off.text).toContain('are off'); expect(off.text).not.toContain('4,321');
  });
});
