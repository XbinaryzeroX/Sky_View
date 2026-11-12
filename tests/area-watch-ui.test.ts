import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AreaWatchEvent, AreaWatchRule, AreaWatchState } from '../src/shared/areaWatch';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { FeedStatus } from '../src/shared/types';
import { AreaWatchControl, AreaWatchStatus, type AreaWatchControls } from '../src/renderer/components/AreaWatchControl';
import { ToolsPanel } from '../src/renderer/components/ToolsPanel';
import type { Annotation } from '../src/renderer/lib/api';

vi.mock('../src/renderer/lib/api', () => ({
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

const at = '2026-11-11T16:00:00.000Z';
const area: Annotation = { id: 'tokyo_area', kind: 'area', name: 'Tokyo area', color: '#ffd166', points: [[139, 35], [140, 35], [140, 36], [139, 36]], visible: false, createdAt: at };
const rule: AreaWatchRule = { areaId: area.id, minMagnitude: 1, enabled: true, createdAt: at, updatedAt: at, armedAt: at };
const event: AreaWatchEvent = { id: 'local_match', areaId: area.id, areaName: area.name, quakeId: 'us_fixture', quakeTime: at, magnitude: 4, minMagnitude: 1, lat: 35.5, lon: 139.5, detectedAt: at, read: false, url: null };
const feed: FeedStatus = { feed: 'usgs', state: 'ok', lastAttemptAt: at, lastSuccessAt: at, sourceUpdatedAt: at, fromCache: false, error: null, consecutiveFailures: 0, nextAttemptAt: null, recordCount: 5, skippedRecords: 0 };
function controls(state: Partial<AreaWatchState> = {}, source: Partial<FeedStatus> = {}): AreaWatchControls {
  return {
    state: { rules: [], events: [], lastEvaluatedAt: null, error: null, ...state },
    usgsStatus: { ...feed, ...source }, freshness: 'fresh',
    onSave: vi.fn(async () => {}), onRemove: vi.fn(async () => {}),
  };
}
const text = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('area watches in existing Map tools', () => {
  it('shows the real USGS magnitude bucket instead of the display filter and distinguishes local failure', () => {
    const value = controls({ lastEvaluatedAt: at, error: 'Local storage write failed' }, { state: 'error', error: 'Publisher unavailable', fromCache: true });
    value.freshness = 'stale';
    const rendered = text(renderToStaticMarkup(createElement(AreaWatchStatus, { controls: value, quakeWindow: 'week', quakeMinMagnitude: 4.3 })));
    expect(rendered).toContain('past week · M 2.5 and above · stale · cached');
    expect(rendered).toContain('Cached data does not create new notifications');
    expect(rendered).toContain('USGS: Publisher unavailable');
    expect(rendered).toContain('Local watch check failed: Local storage write failed');
    expect(rendered).toContain('not official warnings or estimates of shaking or damage');
    expect(rendered).toContain('no backfill');
    expect(rendered).toContain('Hiding an area outline does not pause its watch');
    expect(value.onSave).not.toHaveBeenCalled();
    expect(value.onRemove).not.toHaveBeenCalled();
  });

  it('reports an unavailable source and pending evaluation without implying a successful check', () => {
    const value = controls({}, { lastSuccessAt: null, state: 'loading' });
    value.freshness = 'unavailable';
    const rendered = text(renderToStaticMarkup(createElement(AreaWatchStatus, { controls: value, quakeWindow: 'hour', quakeMinMagnitude: -1 })));
    expect(rendered).toContain('past hour · all reported magnitudes · unavailable');
    expect(rendered).toContain('Refreshing…');
    expect(rendered).toContain('Waiting for the first successful local watch check');
    expect(rendered).not.toContain('Last local check:');
  });

  it('displays the selected area count and a below-source rule even when collapsed', () => {
    const value = controls({ rules: [rule], events: [event, { ...event, id: 'other_match', areaId: 'other_area' }] });
    const rendered = text(renderToStaticMarkup(createElement(AreaWatchControl, { area, controls: value, rule, matchCount: 1, quakeMinMagnitude: 4.3 })));
    expect(rendered).toContain('USGS epicenter watch · Enabled · M ≥ 1');
    expect(rendered).toContain('1 saved match');
    expect(rendered).not.toContain('2 saved matches');
    expect(rendered).toContain('Source limited to M 2.5 and above');
    expect(value.onSave).not.toHaveBeenCalled();
    expect(value.onRemove).not.toHaveBeenCalled();
  });

  it('keeps an existing paused rule distinct from an area without a rule', () => {
    expect(text(renderToStaticMarkup(createElement(AreaWatchControl, { area, controls: controls(), rule: { ...rule, enabled: false }, matchCount: 0, quakeMinMagnitude: 0 }))))
      .toContain('USGS epicenter watch · Paused');
    const rendered = text(renderToStaticMarkup(createElement(AreaWatchControl, { area, controls: controls(), matchCount: 0, quakeMinMagnitude: 0 })));
    expect(rendered).toContain('Watch USGS epicenters…');
    expect(rendered).not.toContain('Enabled');
  });

  it('adds one inline watch control only to area annotations and preserves the existing annotation actions', () => {
    const noop = () => {};
    const rendered = renderToStaticMarkup(createElement(ToolsPanel, {
      tool: 'none', draft: [], onTool: noop, onUndo: noop, onFinish: noop, onClear: noop,
      annotations: [area, { ...area, id: 'pin', kind: 'pin', name: 'Pin', points: [[139, 35]] }, { ...area, id: 'line', kind: 'line', name: 'Line', points: [[139, 35], [140, 36]] }],
      onAnnotationChange: noop, onAnnotationDelete: noop, onFlyTo: noop, views: [], onSaveView: noop, onRestoreView: noop, onDeleteView: noop,
      onExportScene: noop, onImportScene: noop, settings: DEFAULT_SETTINGS, onPatch: noop, onClose: noop, onPlayback: noop, playbackActive: false,
      areaWatch: controls({ rules: [rule], events: [event, { ...event, id: 'other_match', areaId: 'other_area' }] }),
    }));
    expect(rendered.match(/class="area-watch-control"/g)).toHaveLength(1);
    expect(rendered).toContain('aria-label="USGS epicenter watch for Tokyo area"');
    expect(rendered.match(/aria-label="Annotation name"/g)).toHaveLength(3);
    expect(rendered.match(/>Delete<\/button>/g)).toHaveLength(3);
    expect(rendered).toContain('Import GeoJSON…');
    expect(text(rendered)).toContain('1 saved match');
  });
});
