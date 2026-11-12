import type { DwdWarning } from '../../src/shared/dwd';
import type { GeoRecord, LayerSnapshot } from '../../src/shared/layers';

export const DWD_AT = '2026-11-11T12:00:00.000Z';
export function dwdFixture(overrides: Partial<DwdWarning> = {}): DwdWarning {
  const geometry: DwdWarning['geometry'] = { type: 'MultiPolygon', coordinates: [
    [[[13, 52], [14, 52], [14, 53], [13, 53], [13, 52]], [[13.4, 52.4], [13.6, 52.4], [13.6, 52.6], [13.4, 52.6], [13.4, 52.4]]],
    [[[10, 53], [11, 53], [11, 54], [10, 54], [10, 53]]],
  ] };
  return { id: 'dwd-explicit-fixture', capIdentifier: 'EXPLICIT-QA-DWD-123', sender: 'fixture@dwd.example', sent: DWD_AT, status: 'Actual', scope: 'Public', messageType: 'Update', references: [], language: 'de-DE',
    event: 'QA SYNTHETISCHER STURM', headline: 'Explizite Testwarnung — keine reale Warnung', description: 'Originaler deutscher Warntext.\nNur ein Test.', instruction: 'Dies ist eine ausdrücklich synthetische Prüfanweisung.', severity: 'Moderate', urgency: 'Expected', certainty: 'Likely',
    effective: DWD_AT, onset: DWD_AT, expires: '2026-11-11T13:00:00.000Z', responseTypes: ['Monitor'], timing: 'active', areaDesc: 'Testgebiet Berlin; Testgebiet Hamburg',
    areas: [{ description: 'Testgebiet Berlin und Hamburg', geometry, geocodes: [{ name: 'WARNCELLID', value: 'explicit-fixture' }], altitudeM: null, ceilingM: null }], geometry, geometryStatus: 'complete', missingAreaCount: 0, invalidGeometryCount: 0, geometryNotes: [], source: 'Deutscher Wetterdienst', sourceUrl: 'https://www.dwd.de/warnungen', license: 'CC BY 4.0', country: 'DE', ...overrides };
}
export function dwdRecord(warning: DwdWarning): GeoRecord {
  return { id: warning.id, lat: 52.2, lon: 13.2, altM: null, heading: null, speedKts: null, label: warning.headline ?? warning.event, category: warning.severity, observedAt: warning.sent, sourceUrl: warning.sourceUrl, source: warning.source, props: {}, geometry: warning.geometry };
}
export function dwdSnapshot(warnings: DwdWarning[] = [dwdFixture()], overrides: Partial<LayerSnapshot['status']> = {}): LayerSnapshot {
  return { dwdWarnings: warnings, records: warnings.filter(warning => warning.geometry).map(dwdRecord), status: { id: 'dwd', enabled: true, state: 'ok', lastAttemptAt: DWD_AT, lastSuccessAt: DWD_AT, sourceUpdatedAt: DWD_AT, error: null, consecutiveFailures: 0, nextAttemptAt: null, recordCount: warnings.length, skippedRecords: 0, freshness: 'fresh', note: 'Explicit synthetic renderer fixture', ...overrides } };
}
