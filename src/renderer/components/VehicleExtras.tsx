// Aircraft/vessel extras for the details panel: symbol classification, an
// exact model and identification photograph (opt-in, exact aircraft or ship only), the reported route
// for a callsign, and a legend separating observed track from reported route.

import { useEffect, useState } from 'react';
import type { GeoRecord } from '../../shared/layers';
import type { RouteInfo } from '../../shared/route';
import { classifyAircraft, classifyVessel } from '../../shared/vehicleClass';
import { api, errorText } from '../lib/api';
import { modelLine, type VehicleInfo } from '../../shared/vehicleInfo';
import { icaoTypeName } from '../../shared/icaoTypes';
import { shipTypeLabel } from '../../shared/layerNormalize';

type InfoState = 'off' | 'loading' | 'done' | 'error';

/** Exact model and a credited photo of this airframe / ship (only when the user opted in; see shared/vehicleInfo.ts). */
function useVehicleInfo(q: { kind: 'aircraft' | 'vessel'; hex?: string; registration?: string; imo?: number } | null, enabled: boolean): { info: VehicleInfo | null; state: InfoState; err: string | null } {
  const [state, setState] = useState<InfoState>('off');
  const [info, setInfo] = useState<VehicleInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = q ? JSON.stringify(q) : null;
  useEffect(() => {
    setInfo(null);
    setErr(null);
    if (!enabled || !q || (!q.hex && !q.imo && !q.registration)) {
      setState('off');
      return;
    }
    let cancelled = false;
    setState('loading');
    api
      .vehicleInfo(q)
      .then((v) => {
        if (cancelled) return;
        setInfo(v);
        setState('done');
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(errorText(e));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { info, state, err };
}

export function VehicleExtras({ layer, r, photosEnabled, onEnablePhotos, onShowRoute }: { layer: string; r: GeoRecord; photosEnabled: boolean; onEnablePhotos(): void; onShowRoute(route: RouteInfo | null): void }) {
  const isAir = layer === 'aircraft' || layer === 'aircraftMil';
  const cls = isAir ? classifyAircraft(r.props.type as string | null, r.props.emitterCategory as string | null) : classifyVessel(typeof r.props.shipType === 'number' ? r.props.shipType : null);
  const hex = String(r.props.icao24 ?? r.id).toLowerCase();
  const reg = typeof r.props.registration === 'string' ? r.props.registration.toUpperCase() : undefined;
  const imo = typeof r.props.imo === 'number' && r.props.imo >= 1000000 && r.props.imo <= 9999999 ? r.props.imo : undefined;
  const { info, state, err } = useVehicleInfo(isAir ? { kind: 'aircraft', ...(/^[0-9a-f]{6}$/.test(hex) ? { hex } : {}), ...(reg && /^[A-Z0-9-]+$/.test(reg) ? { registration: reg } : {}) } : { kind: 'vessel', ...(imo ? { imo } : {}) }, photosEnabled);
  const photo = info?.photo ?? null;
  const m = info?.model ?? null;
  const typeCode = typeof r.props.type === 'string' ? r.props.type : null;
  const desc = typeof r.props.description === 'string' ? r.props.description : null;
  const family = icaoTypeName(typeCode ?? m?.icaoType);
  const airModel = modelLine(m, null) ?? desc ?? (typeCode ? (family ? `${family} (ICAO ${typeCode})` : `ICAO type ${typeCode}`) : null);
  const modelFromFamily = !modelLine(m, null) && !desc && !!family;
  const shipKind = shipTypeLabel(typeof r.props.shipType === 'number' ? r.props.shipType : null);
  const dims = typeof r.props.lengthM === 'number' ? `${r.props.lengthM} m long${typeof r.props.beamM === 'number' ? ` × ${r.props.beamM} m beam` : ''}` : null;
  const [route, setRoute] = useState<{ state: 'idle' | 'loading' | 'none' | 'ok' | 'error'; info: RouteInfo | null; err?: string }>({ state: 'idle', info: null });
  const callsign = typeof r.props.callsign === 'string' ? r.props.callsign.replace(/\s+/g, '').toUpperCase() : null;
  useEffect(() => {
    setRoute({ state: 'idle', info: null });
    onShowRoute(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  return (
    <section className="veh-extras">
      <div className="veh-id">
        {isAir ? (
          <>
            <div className="veh-model">{airModel ?? 'Type not reported'}</div>
            {m && (
              <div className="small muted">
                {[m.registration ? `Registration ${m.registration}` : null, m.owner ? `Registered to ${m.owner}${m.ownerCountry ? ` (${m.ownerCountry})` : ''}` : null].filter(Boolean).join(' · ')}
                {' · '}source {m.source}
              </div>
            )}
            {modelFromFamily && <div className="small muted">Model family from the ICAO type code{state === 'done' ? '; the airframe registry (adsbdb.com) has no record of the exact variant' : ''}.</div>}
            {!m && !photosEnabled && <div className="small muted">Turn on aircraft and ship photos for the exact variant, operator and a photo.</div>}
          </>
        ) : (
          <>
            <div className="veh-model">{[shipKind ? `${shipKind} vessel` : 'Vessel (type not reported)', dims].filter(Boolean).join(' · ')}</div>
            <div className="small muted">AIS reports the ship category and size, not the make or class of the ship.{imo ? ` IMO ${imo}.` : ''}</div>
          </>
        )}
      </div>
      <p className="muted small">Map symbol: {cls.explain}.</p>
      <figure className="veh-photo">
        {photo ? (
          <>
            <a href={photo.link} target="_blank" rel="noreferrer">
              <img src={photo.url} alt={`Photograph of ${isAir ? 'aircraft' : 'vessel'} ${String(reg ?? r.label)}`} referrerPolicy="no-referrer" />
            </a>
            <figcaption className="small">
              Photo of this {isAir ? 'aircraft' : 'ship'} (matched by {photo.matchedBy}){photo.year ? `, taken ${photo.year}; paint and operator may have changed since` : ''} · © {photo.author}
              {photo.license ? ` · ${photo.license}` : ''} ·{' '}
              <a href={photo.link} target="_blank" rel="noreferrer">
                {photo.source}
              </a>
            </figcaption>
          </>
        ) : state === 'off' ? (
          <div className="veh-nophoto">
            {!photosEnabled ? (
              <>
                No photo shown.{' '}
                <button className="linkish" onClick={onEnablePhotos}>
                  Turn on aircraft and ship photos
                </button>
              </>
            ) : isAir ? (
              'This aircraft reports no ICAO address or registration, so no photo can be matched.'
            ) : (
              'This vessel reports no IMO number, so no photo can be matched to it.'
            )}
          </div>
        ) : (
          <div className="veh-nophoto">
            {state === 'loading'
              ? `Looking up this ${isAir ? 'aircraft' : 'ship'}…`
              : state === 'error'
                ? `Lookup failed: ${err}`
                : `No photo of this exact ${isAir ? 'aircraft' : 'ship'} was found${isAir ? ' on Wikimedia Commons or airport-data.com' : ' on Wikimedia Commons'}.${info?.notes.length ? ` (${info.notes.join(' ')})` : ''} No look-alike photo is substituted.`}
          </div>
        )}
      </figure>
      {isAir && (
        <div className="veh-route">
          <h3 className="sub">Journey</h3>
          {route.state === 'ok' && route.info ? (
            <>
              <ol className="route-list">
                {route.info.airports.map((a, i) => (
                  <li key={i}>
                    <strong>{a.iata ?? a.icao ?? '—'}</strong> {a.name ?? ''} {a.city ? `· ${a.city}` : ''} {a.country ? `(${a.country})` : ''}
                  </li>
                ))}
              </ol>
              <p className="muted small">
                Reported route usually flown as {route.info.callsign} ({route.info.source}{route.info.plausible === false ? '; adsb.lol flags it as not plausible for the current position' : ''}). This is not today’s filed flight plan or schedule: callsigns can be reused, and diversions or cancellations are not reflected. The dashed line on the map joins the airports and is not the flown path.
              </p>
            </>
          ) : (
            <p className="muted small">
              {route.state === 'none'
                ? 'Origin and destination: not provided by connected sources for this callsign.'
                : route.state === 'error'
                  ? `Route lookup failed: ${route.err}`
                  : 'Origin and destination are not part of ADS-B position data.'}
            </p>
          )}
          {callsign && route.state !== 'ok' && (
            <button
              className="btn"
              disabled={route.state === 'loading'}
              onClick={() => {
                setRoute({ state: 'loading', info: null });
                api
                  .aircraftRoute(callsign, r.lat, r.lon)
                  .then((info) => {
                    setRoute({ state: info ? 'ok' : 'none', info });
                    onShowRoute(info);
                  })
                  .catch((e) => setRoute({ state: 'error', info: null, err: errorText(e) }));
              }}
            >
              {route.state === 'loading' ? 'Looking up…' : 'Look up reported route'}
            </button>
          )}
          <ul className="journey-legend small">
            <li>
              <span className="jl jl-obs" /> Observed track: positions recorded by this app (use Track)
            </li>
            <li>
              <span className="jl jl-rep" /> Reported route: airports from the route database (dashed)
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
