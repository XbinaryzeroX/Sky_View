import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Box, Camera, Plane } from 'lucide-react';
import type { GeoRecord } from '../../shared/layers';
import { icaoTypeName } from '../../shared/icaoTypes';
import { airframeAgeLabel, airlinerProfile } from '../../shared/airlinerProfile';
import { aircraftSketchfabReference, aircraftSketchfabSearchUrl } from '../../shared/aircraftSketchfab';
import { modelLine, type VehiclePhoto } from '../../shared/vehicleInfo';
import { aircraftSymbolName, classifyAircraft } from '../../shared/vehicleClass';
import { publicAirlineCallsign, routeMapSegments, type RouteAirport, type RouteInfo } from '../../shared/route';
import type { DatedFlightStatus } from '../../shared/flightStatus';
import { geodesicDistanceKm } from '../../shared/geo';
import { airlineStatusPages } from '../../shared/airlineStatusPages';
import { useVehiclePreview } from '../lib/useVehiclePreview';
import { useAirlineJourney } from '../lib/useAirlineJourney';
import { resolvedRouteAirport } from '../lib/passengerRoutes';
import { useVehicleIdentification } from '../lib/useVehicleIdentification';
import { VehicleModelPreview } from './VehicleModelPreview';
import { ExternalLink } from './common';
import { ReportedJourney } from './VehicleExtras';
import { FlightSchedule } from './FlightSchedule';

const examples: Record<string, { image: string; source: string; author: string; label: string }> = {
  CRJX: { image: new URL('../assets/aircraft/crjx.webp', import.meta.url).href, author: 'Bene Riobó',
    source: 'https://commons.wikimedia.org/wiki/File:EC-MJQ_CRJ1000_Air_Nostrum_MAD.jpg', label: 'Air Nostrum CRJ1000, EC-MJQ' },
  A20N: { image: new URL('../assets/aircraft/a20n.webp', import.meta.url).href, author: 'Paul Schmid',
    source: 'https://commons.wikimedia.org/wiki/File:Lufthansa_Airbus_A320neo.jpg', label: 'Lufthansa A320neo' },
};

function AircraftVisual({ code, category, name, photo }: { code: string; category: string | null; name: string; photo: VehiclePhoto | null }) {
  const { model, onError } = useVehiclePreview('aircraft', code, category, false);
  const [preferPhoto, setPreferPhoto] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const matched = photo && !failedPhotos.includes(photo.url) ? photo : null;
  const example = examples[code];
  const photoUrl = matched?.url ?? (example && !failedPhotos.includes(example.image) ? example.image : null);
  const showModel = !!model && (!preferPhoto || !photoUrl);
  const shapeLabel = aircraftSymbolName(classifyAircraft(code, category).symbol);
  const reference = aircraftSketchfabReference(code);
  const searchType = icaoTypeName(code) ?? (/^[A-Z0-9]{2,4}$/.test(code) ? code : null);
  return <div className="flight-visual">
    {model && photoUrl && <div className="flight-view-options" aria-label="Aircraft view">
      <button type="button" aria-pressed={showModel} onClick={() => setPreferPhoto(false)}><Box size={13}/> 3D</button>
      <button type="button" aria-pressed={!showModel} onClick={() => setPreferPhoto(true)}><Camera size={13}/> Photo</button>
    </div>}
    {showModel && model ? <>
      <VehicleModelPreview key={model.variant} model={model} title={model.pack?.title ?? shapeLabel} onError={onError}/>
      {model.pack ? <p className="flight-credit">Type model · <ExternalLink url={model.pack.sourceUrl}>{model.pack.author} on Sketchfab</ExternalLink> · <ExternalLink url={model.pack.licenseUrl}>{model.pack.license}</ExternalLink></p>
        : <p className="flight-credit">Representative 3D shape · {shapeLabel}</p>}
    </> : photoUrl ? <figure>
      <img src={photoUrl} alt={matched ? `Matched airframe photo of ${name}` : example.label}
        onError={() => setFailedPhotos(urls => urls.includes(photoUrl) ? urls : [...urls, photoUrl])} referrerPolicy="no-referrer"/>
      <figcaption className="flight-credit">{matched ? <>
        This airframe · {matched.matchedBy}{matched.year ? ` · photographed ${matched.year}` : ''} · <ExternalLink url={matched.link}>{matched.author}</ExternalLink>{matched.license && ` · ${matched.license}`}
      </> : <>Type example · {example.label} · <ExternalLink url={example.source}>{example.author}</ExternalLink> · <ExternalLink url="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</ExternalLink></>}</figcaption>
    </figure> : null}
    {!model && <p className="small muted">The local 3D preview could not be displayed.</p>}
    {(!showModel || !model?.pack) && reference && <p className="flight-credit"><ExternalLink url={reference.url}>View {reference.title} on Sketchfab</ExternalLink> · {reference.author} ({reference.publisher})</p>}
    {!model?.pack && !reference && searchType && <p className="flight-credit"><ExternalLink url={aircraftSketchfabSearchUrl(searchType)}>Find {searchType} models on Sketchfab</ExternalLink></p>}
  </div>;
}

const nonblank = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const airportName = (airport: RouteAirport) => airport.city ?? airport.name ?? airport.iata ?? airport.icao ?? 'Unknown airport';
const airportCode = (airport: RouteAirport) => airport.iata ?? airport.icao ?? '—';
const number = (v: number, digits = 0) => v.toLocaleString(undefined, { maximumFractionDigits: digits });
const observedDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });


export function FlightCard({ record: r, actions, photosEnabled, onEnablePhotos, onShowRoute, onViewRoute, onOpenProviders }: {
  record: GeoRecord; actions: ReactNode; photosEnabled: boolean; onEnablePhotos(): void; onShowRoute(route: RouteInfo | null): void; onViewRoute?(route: RouteInfo): void; onOpenProviders(): void;
}) {
  const { info, state: idState, err } = useVehicleIdentification(r, true, photosEnabled);
  const journey = useAirlineJourney('aircraft', r);
  const [dated, setDated] = useState<DatedFlightStatus | null>(null);
  const callsign = publicAirlineCallsign('aircraft', r);
  const datedRoute = useMemo<RouteInfo | null>(() => dated ? {
    callsign: dated.callsign, airports: [resolvedRouteAirport(dated.departure.airport), resolvedRouteAirport(dated.arrival.airport)], source: dated.source,
    airline: dated.airline, flightNumber: dated.flightNumber, plausible: null,
  } : null, [dated]);
  const route = datedRoute ?? journey.route;
  const interrupted = !!dated && ['Diverted', 'Canceled', 'Possible cancellation'].includes(dated.status);
  const mapRoute = interrupted || route?.plausible === false ? null : route;
  useEffect(() => {
    onShowRoute(mapRoute);
    return () => onShowRoute(null);
  }, [mapRoute, onShowRoute]);
  const reportedRegistration = nonblank(r.props.registration);
  const reportedCode = nonblank(r.props.type)?.toUpperCase();
  const registry = info?.model;
  const sameTail = !reportedRegistration || !registry?.registration || reportedRegistration.toUpperCase() === registry.registration.toUpperCase();
  const sameType = !reportedCode || !registry?.icaoType || reportedCode === registry.icaoType.toUpperCase();
  const matched = sameTail && sameType ? registry : null;
  const code = reportedCode ?? matched?.icaoType?.toUpperCase() ?? '';
  const profile = airlinerProfile(code);
  const description = nonblank(r.props.description);
  const registeredModel = matched?.model ? modelLine({ ...matched, icaoType: null }, null) : null;
  const name = registeredModel ?? description ?? profile?.name ?? icaoTypeName(code) ?? (code || 'Aircraft type unavailable');
  const airline = route?.airline;
  const title = nonblank(r.props.callsign) ?? reportedRegistration ?? r.label;
  const airports = route?.plausible === false ? [] : route?.airports ?? [];
  const statusPage = journey.state !== 'unavailable' ? airlineStatusPages[title.slice(0, 3).toUpperCase()] : null;
  const first = airports[0], last = airports[airports.length - 1];
  const segments = routeMapSegments(mapRoute);
  const completePath = segments.length === 1 && segments[0].length === airports.length;
  const distance = completePath ? segments[0].slice(1).reduce((km, next, index) => {
    const previous = segments[0][index];
    return km + geodesicDistanceKm(previous[1], previous[0], next[1], next[0]);
  }, 0) : null;
  const observation = r.observedAt ? new Date(r.observedAt) : null;
  const year = airframeAgeLabel(r.props.airframeYear, observation ?? undefined);
  const reg = reportedRegistration ?? matched?.registration;
  const ownerOperator = nonblank(r.props.ownerOperator);
  const sameOwner = !!matched?.owner && matched.owner.toLowerCase() === ownerOperator?.toLowerCase();
  const flightPhase = r.props.onGround === true ? 'On ground' : r.altM !== null && r.altM > 0 ? 'Airborne' : null;
  const facts = [
    { label: 'Registration', value: reg ?? 'Not reported' },
    { label: 'Build year / age', value: year ?? 'Not reported' },
    ...(matched?.owner ? [{ label: sameOwner ? 'Registered owner / reported operator' : 'Registered owner', value: matched.owner }] : []),
    ...(ownerOperator && !sameOwner ? [{ label: 'Reported owner / operator', value: ownerOperator }] : []),
    ...(code ? [{ label: 'ICAO type', value: code }] : []),
  ];
  return <article className="flight-card" aria-label="Selected flight">
    <header className="flight-heading">
      <div className="flight-kicker"><Plane size={15}/><strong>{route?.flightNumber ?? title}</strong>
        {observation && Number.isFinite(observation.getTime()) && <time dateTime={r.observedAt!} title="UTC date of the last position report"> · {observedDay.format(observation)} UTC</time>}</div>
      <h2>{interrupted ? dated?.status : first && last ? <>{airportName(first)} <span>to</span> {airportName(last)}</> : name}</h2>
      <p>{first && last ? [airline, dated ? `Dated flight status · ${dated.status}` : 'Usual airline route'].filter(Boolean).join(' · ') : [flightPhase, r.source].filter(Boolean).join(' · ')}</p>
      {typeof r.props.emergency === 'string' && r.props.emergency !== 'none' && <span className="tag sev-extreme">Reported emergency: {r.props.emergency}</span>}
    </header>
    {actions}
    {first && last && <div className="flight-airports" aria-label={dated ? 'Airports listed by the flight-status provider' : 'Usual airline route'}>
      {airports.map((a, i) => <div key={i}><span>{i === 0 ? 'From' : i === airports.length - 1 ? 'To' : 'Via'}</span><strong>{airportCode(a)}</strong><small>{a.name ?? airportName(a)}</small>{i < airports.length - 1 && <ArrowRight className="flight-airport-arrow" size={14}/>}</div>)}
    </div>}
    <section className="flight-identity" aria-label="Aircraft identification">
      {first && last && <h3>{name}</h3>}
      <p className="flight-source">{registeredModel ? 'Airframe registry · adsbdb.com' : description ? `Reported description · ${r.source}` : code ? 'Model family from ICAO type' : 'The position report has no model identification.'}</p>
      <AircraftVisual key={code} code={code} category={nonblank(r.props.emitterCategory)} name={name} photo={sameTail && sameType ? info?.photo ?? null : null}/>
      <dl className="flight-facts">{facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      {!sameTail || !sameType ? <p className="small muted">The registry disagrees with this report’s registration or type.</p> : null}
      {!photosEnabled ? <><button type="button" className="linkish flight-lookup" onClick={onEnablePhotos}>Enable airframe registry and photo lookup</button>
        <p className="flight-source">Uses the aircraft identifier with adsbdb, Wikimedia Commons and airport-data.com.</p></>
        : idState === 'loading' ? <p className="small muted" role="status">Checking the airframe registry and photo sources…</p>
        : idState === 'error' ? <p className="small muted">Identification lookup failed. {err}</p>
        : !registeredModel && <p className="small muted">Exact variant unavailable from the connected sources.</p>}
    </section>
    <section className="flight-observation" aria-label="Last flight observation">
      <h3>Last observation</h3>
      <dl className="flight-readings">
        <div><dt>Altitude</dt><dd>{r.altM === null ? '—' : <>{number(r.altM / 0.3048)} <small>ft</small></>}</dd></div>
        <div><dt>Ground speed</dt><dd>{r.speedKts === null ? '—' : <>{number(r.speedKts)} <small>kt</small></>}</dd></div>
        <div><dt>Vertical rate</dt><dd>{typeof r.props.verticalRateFpm !== 'number' ? '—' : <>{r.props.verticalRateFpm > 0 ? '+' : ''}{number(r.props.verticalRateFpm)} <small>ft/min</small></>}</dd></div>
      </dl>
      {observation && Number.isFinite(observation.getTime()) && <p className="flight-source">{r.source} · {observation.toISOString().slice(11, 19)} UTC{r.props.snapshot === true ? ' · snapshot' : ''}</p>}
    </section>
    <section className="flight-journey" aria-label="Journey and flight path">
      <h3>Journey &amp; flight path</h3>
      {route ? <>
        <p>{segments.length > 0 && <i className="flight-line-key"/>} {interrupted ? 'The provider lists a disruption. The route projection is hidden.' : route.plausible === false ? 'The source flags this route as implausible for this flight.' : distance !== null ? `Airport-to-airport estimate · ${number(distance)} km along the dashed line.` : segments.length ? 'The dashed line shows only legs with known airport coordinates.' : 'Airport coordinates are unavailable for drawing this route.'}</p>
        <p className="flight-source">{route.source} · {dated ? 'Airports from the dated flight record. The actual clearance and waypoints are unavailable.' : 'Usual callsign route. Today’s clearance, diversion, arrival time and delay are unconfirmed.'}</p>
        {segments.length > 0 && onViewRoute && <button className="btn" onClick={() => onViewRoute(route)}>View route on map</button>}
      </> : journey.state === 'unavailable' && r.props.snapshot !== true && nonblank(r.props.callsign) ? <ReportedJourney layer="aircraft" r={r} onShowRoute={onShowRoute}/>
        : <><p role="status">{journey.state === 'loading' ? 'Looking up the airline route…' : journey.state === 'error' ? journey.error : 'No published destination matched this flight.'}</p>
        {journey.state === 'none' && <button className="btn" onClick={journey.lookupReportedRoute}>Check reported route</button>}
        {journey.state === 'error' && <button className="btn" onClick={journey.retry}>Retry route lookup</button>}</>}
      {statusPage && <p className="flight-source"><ExternalLink url={statusPage[1]}>Check today’s status with {statusPage[0]}</ExternalLink></p>}
    </section>
    {callsign && <FlightSchedule recordId={r.id} callsign={callsign} value={dated} onChange={setDated} onSetup={onOpenProviders}/>}
    {profile && <section className="flight-spec" aria-label="Aircraft type specifications">
      <h3>Aircraft specifications</h3>
      <dl className="flight-facts">{profile.facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      <div className="flight-spec-sources">{profile.sources.map(s => <ExternalLink key={s.url} url={s.url}>{s.label}</ExternalLink>)}</div>
    </section>}
  </article>;
}
