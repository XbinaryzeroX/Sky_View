import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecordDetails } from '../src/renderer/components/RecordDetails';
import { PageView, type PageCtx } from '../src/renderer/components/Pages';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { GeoRecord, LayerSnapshot } from '../src/shared/layers';
import type { AppSnapshot } from '../src/shared/types';

vi.mock('../src/renderer/lib/api', () => ({ api: {}, errorText: String }));

const captured = '2026-11-10T09:00:00.000Z';
const edited = '2026-11-10T10:00:00.000Z';
const fetched = '2026-11-10T11:00:00.000Z';
const record: GeoRecord = {
  id: 'sample', label: 'Island perimeter', category: 'Fire perimeter', lat: 52, lon: 179.25,
  altM: null, speedKts: null, heading: null, source: 'NIFC WFIGS', sourceUrl: null, observedAt: edited,
  props: { incidentAcres: 400, gisAcres: 0, acres: 400, polygonDateTime: captured, dateCurrent: edited },
  geometry: { type: 'MultiPolygon', coordinates: [
    [[[179, 51], [179.5, 51], [179.5, 52], [179, 51]]],
    [[[-179.5, 51], [-179, 51], [-179, 52], [-179.5, 51]]],
  ] },
};
const snap: LayerSnapshot = {
  records: [record],
  status: { id: 'firePerimeters', enabled: true, state: 'ok', lastSuccessAt: fetched, lastAttemptAt: fetched,
    nextAttemptAt: null, error: null, sourceUpdatedAt: edited, consecutiveFailures: 0, skippedRecords: 0,
    recordCount: 1, freshness: 'fresh', note: null },
};
function details(r: GeoRecord, snapshot = snap, enabled = true) {
  return renderToStaticMarkup(createElement(RecordDetails, { layer: 'firePerimeters', record: r, layerEnabled: enabled,
    snaps: { firePerimeters: snapshot }, tracked: false, orbitShown: false,
    onFocus: vi.fn(), onSelect: vi.fn(), onOrbit: vi.fn(), onTrack: vi.fn() }));
}
function discover(snapshot: LayerSnapshot, enabled = true, playbackActive = false) {
  const ctx = { snap: { settings: { ...DEFAULT_SETTINGS, layersEnabled: enabled ? ['firePerimeters'] : [] }, quakes: [] } as unknown as AppSnapshot,
    layerSnaps: { firePerimeters: snapshot }, playbackActive } as PageCtx;
  return renderToStaticMarkup(createElement(PageView, { page: 'discover', ctx, airport: null }));
}

describe('published NIFC perimeter details', () => {
  it('keeps mapped area, incident acreage, capture, edit and fetch times separate', () => {
    const html = details(record);
    expect(html).toContain('Mapped perimeter area</dt><dd>0 acres');
    expect(html).toContain('Reported incident size</dt><dd>400 acres');
    expect(html).toContain('Polygon captured</dt><dd><time dateTime="' + captured);
    expect(html).toContain('Polygon record last edited</dt><dd><time dateTime="' + edited);
    expect(html).toContain('Fetched</dt><dd><time dateTime="' + fetched);
    expect(html).toContain('2 polygon parts · 0 interior rings');
    expect(html).toContain('51.5000, -180.0000');
    expect(html).not.toContain('Size (acres)');
  });
  it('keeps unreported acreage unknown and identifies retained and disabled records', () => {
    expect(details({ ...record, props: { acres: 999, incidentAcres: null } }).match(/Not provided by NIFC/g)).toHaveLength(2);
    expect(details(record, { ...snap, status: { ...snap.status, state: 'error', error: 'Reply interrupted' } })).toContain('Last observed perimeter');
    expect(details(record, snap, false)).not.toContain(record.label);
  });
  it('ranks measured map area only and excludes disabled and Replay records', () => {
    const withArea = { ...record, label: 'Larger mapped area', props: { gisAcres: 2, incidentAcres: 1 } };
    const records = [record, { ...record, label: 'Unknown area', props: { acres: 20000 } }, withArea];
    const snapshot = { ...snap, records };
    expect(discover(snapshot)).toContain('Larger mapped area · 2 acres');
    expect(discover(snap)).toContain('Island perimeter · 0 acres');
    expect(discover({ ...snap, records: [records[1]] })).not.toContain('loaded NIFC perimeters');
    expect(discover({ ...snap, status: { ...snap.status, state: 'error' } })).toContain('last successful refresh');
    expect(discover(snapshot, false)).not.toContain(withArea.label);
    expect(discover(snapshot, true, true)).not.toContain(withArea.label);
  });
});
