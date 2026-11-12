import { useMemo } from 'react';
import { dwdStartMs, type DwdWarning } from '../../shared/dwd';
import type { GeoRecord, LayerSnapshot } from '../../shared/layers';
import type { SavedLocation } from '../../shared/types';
import { geometryBbox, pointInGeometry } from '../../shared/geo';
import { Empty, ExternalLink, SeverityTag, Time } from './common';

export function dwdWarningTiming(warning: DwdWarning, at = Date.now()): string {
  if (warning.expires && Date.parse(warning.expires) <= at) return 'Expired since retrieval';
  const start = dwdStartMs(warning.onset, warning.effective);
  if (Number.isFinite(start) && start > at) return 'Upcoming';
  return warning.timing === 'unknown' ? 'Timing not established' : 'In the retrieved status package';
}

export function dwdView(snapshot: LayerSnapshot | undefined, enabled: boolean, replayActive = false) {
  const status = snapshot?.status;
  const warnings = snapshot?.dwdWarnings;
  const loaded = !!status?.lastSuccessAt && Number.isFinite(Date.parse(status.lastSuccessAt)) && Array.isArray(warnings);
  const current = loaded && status?.state === 'ok' && status.freshness === 'fresh' && !status.error;
  const state = replayActive ? 'replay' : !enabled ? 'disabled' : !loaded ? status?.state === 'loading' ? 'loading' : status?.error ? 'error' : 'unavailable' : current ? status!.skippedRecords > 0 ? 'partial' : 'current' : 'last-observed';
  return { state, current, loaded: loaded && enabled && !replayActive, warnings: enabled && !replayActive && loaded ? warnings! : [], status };
}

export function DwdSourceStatus({ snapshot, enabled, replayActive = false, onEnable, compact = false }: {
  snapshot?: LayerSnapshot; enabled: boolean; replayActive?: boolean; onEnable?(): void; compact?: boolean;
}) {
  const view = dwdView(snapshot, enabled, replayActive), status = view.status;
  const mapped = view.loaded ? snapshot!.records.filter(record => !!record.geometry).length : 0;
  const partialGeometry = view.warnings.filter(warning => warning.geometryStatus === 'partial').length;
  const missingAreas = view.warnings.reduce((count, warning) => count + warning.missingAreaCount, 0);
  return <div className="small muted" role="status" aria-label="DWD warning source" data-dwd-state={view.state}>
    {view.state === 'replay' ? <p>DWD warnings are not recorded in Replay. Exit Replay to inspect the optional live source.</p>
      : !enabled ? <p>DWD warnings for Germany are off. {onEnable && <button className="link-btn small" onClick={onEnable}>Enable DWD warnings</button>}</p>
        : !view.loaded ? <p>{view.state === 'loading' ? 'Loading DWD warnings…' : 'DWD warning evidence is unavailable. A missing reply does not mean no warnings.'}</p>
          : <>
            <p><strong>DWD: {view.current ? status!.skippedRecords > 0 ? 'current reply, partial' : 'current reply' : 'last observed reply; current warning coverage is unknown'}</strong>
              {status!.state === 'loading' && ' · refreshing'}. {view.warnings.length} warnings; {mapped} with supplied map geometry; {view.warnings.filter(warning => !warning.geometry).length} without usable geometry.</p>
            <p>Last successful check <Time iso={status!.lastSuccessAt} /> · archive publication <Time iso={status!.sourceUpdatedAt} />. {!compact && status!.note}</p>
            {compact && status!.note && <details><summary>Archive receipt and coverage details</summary><p>{status!.note}</p></details>}
            {(partialGeometry > 0 || missingAreas > 0) && <p>{compact ? 'Unlocated warning areas remain geographically unknown.' : <>Geometry incomplete: {partialGeometry} partially located warning(s); {missingAreas} named area(s) without mapped geometry. Those areas remain geographically unknown.</>}</p>}
            {view.warnings.length === 0 && <p>{view.current && status!.skippedRecords === 0 ? 'The last complete snapshot contains no remaining unexpired German warnings.' : 'No warning records are available in this reply; current warning coverage is unknown.'}</p>}
            {status!.skippedRecords > 0 && <p>{status!.skippedRecords} source entries were skipped. Known matches are a retrieved subset; zero does not establish no warnings.</p>}
          </>}
    {enabled && !replayActive && status?.error && <p className="err-text">DWD refresh failed: {status.error}</p>}
    <p>© Deutscher Wetterdienst · Germany · original German text · <ExternalLink url="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>. CAP polygons converted to GeoJSON. {compact ? 'Separate from NWS/USGS reports and recorded Replay.' : 'DWD is separate from NWS alerts and from NWS/USGS reports, history, Analyst and Replay.'}</p>
  </div>;
}

function NativeTime({ label, value }: { label: string; value: string | null }) {
  return <div className="kv"><dt>{label}</dt><dd>{value ? <><Time iso={value} /><br /><code className="wrap">{value}</code></> : 'Not supplied'}</dd></div>;
}

function metres(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${Math.round(value).toLocaleString()} m` : 'not supplied';
}

export function DwdWarningDetails({ warning, snapshot, enabled, record, onFocus }: {
  warning: DwdWarning | null; snapshot?: LayerSnapshot; enabled: boolean; record: GeoRecord | null; onFocus(lat: number, lon: number, radiusKm?: number): void;
}) {
  if (!enabled) return <><DwdSourceStatus snapshot={snapshot} enabled={false} /><Empty>Enable the DWD Weather layer to inspect this warning.</Empty></>;
  if (!warning) return <Empty>This DWD warning is unavailable in the enabled loaded source. Check the DWD Weather layer.</Empty>;
  return <div className="details" data-dwd-warning-id={warning.id}>
    <header className="details-head"><div className="eyebrow">Germany · Deutscher Wetterdienst</div><h2 lang={warning.language}>{warning.headline ?? warning.event}</h2>
      <div className="tag-row"><SeverityTag severity={warning.severity} /><span className="tag">{warning.messageType}</span><span className="tag">{dwdWarningTiming(warning)}</span></div></header>
    <DwdSourceStatus snapshot={snapshot} enabled={enabled} compact />
    {record?.geometry ? <button className="btn" onClick={() => onFocus(record.lat, record.lon, 100)}>Focus supplied DWD geometry</button>
      : <p className="note">No usable supplied map geometry. Area names and geocodes remain available; no map position is inferred.</p>}
    <dl className="kvs"><div className="kv"><dt>Event · German original</dt><dd lang={warning.language}>{warning.event}</dd></div>
      <div className="kv"><dt>CAP identifier</dt><dd><code className="wrap">{warning.capIdentifier}</code></dd></div>
      <div className="kv"><dt>CAP sender</dt><dd>{warning.sender}</dd></div>
      <NativeTime label="Sent by DWD" value={warning.sent} /><NativeTime label="Effective" value={warning.effective} /><NativeTime label="Onset" value={warning.onset} /><NativeTime label="Message expiry" value={warning.expires} />
      <div className="kv"><dt>Urgency / certainty</dt><dd>{warning.urgency} / {warning.certainty}</dd></div>
      <div className="kv"><dt>Response types</dt><dd>{warning.responseTypes.join(', ') || 'Not supplied'}</dd></div>
      <div className="kv"><dt>Geometry</dt><dd>{warning.geometryStatus} · {warning.missingAreaCount} areas without located geometry · {warning.invalidGeometryCount} invalid geometry items skipped</dd></div>
    </dl>
    {!warning.expires && <p className="note">DWD did not supply an expiry. No end time or continued validity is inferred; check the official source.</p>}
    {warning.geometryNotes.length > 0 && <ul className="small muted">{warning.geometryNotes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
    <h3 className="sub">Original warning text</h3><p className="pre" lang={warning.language}>{warning.description ?? 'Description not supplied.'}</p>
    <h3 className="sub">Publisher instructions</h3><p className="pre" lang={warning.language}>{warning.instruction ?? 'Instructions not supplied.'}</p>
    <h3 className="sub">Named warning areas ({warning.areas.length})</h3>
    <ul className="small">{warning.areas.slice(0, 100).map((area, i) => <li key={i} lang={warning.language}>{area.description || 'Area name not supplied'}
      {area.geocodes.length > 0 && <span className="muted"> · {area.geocodes.map(code => `${code.name}: ${code.value}`).join(' · ')}</span>}
      {!area.geometry && ' · not located on the map'}{(area.altitudeM !== null || area.ceilingM !== null) && ` · altitude ${metres(area.altitudeM)}; ceiling ${metres(area.ceilingM)}`}</li>)}</ul>
    {warning.areas.length > 100 && <p className="small muted">Showing 100 of {warning.areas.length} named areas. Consult the complete official source.</p>}
    <p className="small muted">Map and saved-place tests use supplied horizontal polygons with holes; altitude and ceiling restrictions are not evaluated. Missing geometry is unknown, never evidence that a place is outside a warning.</p>
    <p><ExternalLink url={warning.sourceUrl}>Official DWD warning source</ExternalLink></p>
    <p className="small muted">Source: © {warning.source} · <ExternalLink url="https://creativecommons.org/licenses/by/4.0/">{warning.license}</ExternalLink>. Original German text is preserved; CAP polygons are converted to GeoJSON. This display is not an official warning service.</p>
  </div>;
}

export function dwdPlaceMatches(warnings: DwdWarning[], place: Pick<SavedLocation, 'lat' | 'lon'>) {
  return warnings.map(warning => ({ warning, match: warning.geometry && pointInGeometry(place.lat, place.lon, warning.geometry, geometryBbox(warning.geometry)) ? 'inside' as const
    : !warning.geometry || warning.geometryStatus !== 'complete' || warning.missingAreaCount > 0 ? 'unknown' as const : 'outside' as const }));
}

export function DwdPlaceWarnings({ place, snapshot, enabled, onSelect }: { place: SavedLocation; snapshot?: LayerSnapshot; enabled: boolean; onSelect?(id: string): void }) {
  const view = dwdView(snapshot, enabled);
  const matches = useMemo(() => dwdPlaceMatches(view.warnings, place), [snapshot?.dwdWarnings, enabled, view.loaded, place.lat, place.lon]);
  const inside = matches.filter(value => value.match === 'inside'), unknown = matches.filter(value => value.match === 'unknown');
  return <section aria-label="DWD warnings at this point">
    <h3 className="sub">DWD warnings at this point</h3><DwdSourceStatus snapshot={snapshot} enabled={enabled} compact />
    {view.loaded && <>
      <p className="small muted">Supplied horizontal intersections: {inside.length}{!view.current ? ' last observed; current unknown' : ''}. {unknown.length} warning(s) have unlocated portions that cannot be ruled out here. Altitude/ceiling restrictions are not evaluated.</p>
      {inside.length === 0 && <p className="muted">No supplied polygon intersection was found in this reply. This does not establish that no DWD warning or other hazard applies.</p>}
      <ul className="rec-list">{[...inside, ...unknown].slice(0, 100).map(({ warning, match }) => <li key={warning.id}><button className="rec-item" disabled={!onSelect} onClick={() => onSelect?.(warning.id)}>
        <SeverityTag severity={warning.severity} /><span className="rec-title" lang={warning.language}>{warning.headline ?? warning.event}</span><span className="rec-meta">DWD · {match === 'inside' ? 'Inside supplied horizontal polygon' : 'Unknown — unlocated warning area'} · {dwdWarningTiming(warning)}</span>
      </button></li>)}</ul>
      {inside.length + unknown.length > 100 && <p className="small muted">Showing 100 matching or unlocated warnings. Open Events or the official source for the full loaded list.</p>}
    </>}
    <p className="small muted">The existing briefing and saved-location NWS/USGS counts do not include DWD warnings.</p>
  </section>;
}
