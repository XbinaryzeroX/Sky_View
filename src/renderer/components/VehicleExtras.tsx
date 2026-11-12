// Aircraft/vessel extras for the details panel: symbol classification, an
// exact model and identification photograph (opt-in, exact aircraft or ship only), the reported route
// for a callsign, and a legend separating observed track from reported route.

import { currentModelPack } from '../map/modelPack';
import { packIdOf, shownModelVariant, subscribeShownModels } from '../map/shownModels';
import { packCredit } from '../../shared/modelPack';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GeoRecord } from '../../shared/layers';
import type { RouteInfo } from '../../shared/route';
import { aircraftSymbolName, classifyAircraft, classifyVessel, vesselSymbolName } from '../../shared/vehicleClass';
import { api, errorText } from '../lib/api';
import { modelLine } from '../../shared/vehicleInfo';
import { useVehicleIdentification } from '../lib/useVehicleIdentification';
import { icaoTypeName } from '../../shared/icaoTypes';
import { shipTypeLabel } from '../../shared/layerNormalize';
import { VehicleModelPreview } from './VehicleModelPreview';
import { useVehiclePreview } from '../lib/useVehiclePreview';
import { ExternalLink } from './common';

export function VehicleExtras({ layer, r, photosEnabled, onEnablePhotos, onShowRoute }: { layer: string; r: GeoRecord; photosEnabled: boolean; onEnablePhotos(): void; onShowRoute(route: RouteInfo | null): void }) {
  const isAir = layer === 'aircraft' || layer === 'aircraftMil';
  const cls = isAir ? classifyAircraft(r.props.type as string | null, r.props.emitterCategory as string | null) : classifyVessel(typeof r.props.shipType === 'number' ? r.props.shipType : null);
  const reg = typeof r.props.registration === 'string' ? r.props.registration.toUpperCase() : undefined;
  const imo = typeof r.props.imo === 'number' && r.props.imo >= 1000000 && r.props.imo <= 9999999 ? r.props.imo : undefined;
  const { info, state, err } = useVehicleIdentification(r, isAir, photosEnabled);
  const photo = info?.photo ?? null;
  const m = info?.model ?? null;
  const typeCode = typeof r.props.type === 'string' ? r.props.type : null;
  const category = typeof r.props.emitterCategory === 'string' ? r.props.emitterCategory : null;
  const shipType = typeof r.props.shipType === 'number' ? r.props.shipType : null;
  const { model: preview, onError } = useVehiclePreview(isAir ? 'aircraft' : 'ship', typeCode, category,
    layer === 'aircraftMil' || r.props.militaryFlag === true, shipType, r.props.lengthM, r.props.beamM);
  const previewLabel = isAir ? aircraftSymbolName(classifyAircraft(typeCode, category).symbol)
    : vesselSymbolName(classifyVessel(shipType).symbol);
  const desc = typeof r.props.description === 'string' ? r.props.description : null;
  const family = icaoTypeName(typeCode ?? m?.icaoType);
  const airModel = modelLine(m, null) ?? desc ?? (typeCode ? (family ? `${family} (ICAO ${typeCode})` : `ICAO type ${typeCode}`) : null);
  const modelFromFamily = !modelLine(m, null) && !desc && !!family;
  // Credit the model the map is actually showing for this vehicle (none while it is an icon or uses an app-built model).
  const shownVariant = useSyncExternalStore(subscribeShownModels, () => shownModelVariant(`rec|${layer}|${r.id}`));
  const shownPackId = packIdOf(shownVariant);
  const packModel = shownPackId ? (currentModelPack()?.models.find((m) => m.id === shownPackId) ?? null) : null;
  const shipKind = shipTypeLabel(shipType);
  const dims = typeof r.props.lengthM === 'number' ? `${r.props.lengthM} m long${typeof r.props.beamM === 'number' ? ` × ${r.props.beamM} m beam` : ''}` : null;

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
      {preview ? <div className="flight-visual">
        <VehicleModelPreview key={preview.variant} model={preview} title={preview.pack?.title ?? previewLabel} onError={onError}/>
        {preview.pack ? <p className="flight-credit">{isAir ? 'Type model' : 'Representative vessel model'} · <ExternalLink url={preview.pack.sourceUrl}>{preview.pack.author} on Sketchfab</ExternalLink> · <ExternalLink url={preview.pack.licenseUrl}>{preview.pack.license}</ExternalLink></p>
          : <p className="flight-credit">Representative 3D shape · {previewLabel}</p>}
      </div> : <p className="small muted">The local 3D preview could not be displayed.</p>}
      {packModel && packModel.id !== preview?.pack?.id && (
        <p className="muted small">
          {packCredit(packModel)} ·{' '}
          <a href={packModel.sourceUrl} target="_blank" rel="noreferrer">
            source
          </a>{' '}
          ·{' '}
          <a href={packModel.licenseUrl} target="_blank" rel="noreferrer">
            licence
          </a>
          . A generic model of the type, not this {isAir ? 'aircraft' : 'ship'}: paint may differ.
        </p>
      )}
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
        <ReportedJourney layer={layer} r={r} onShowRoute={onShowRoute} />
      )}
    </section>
  );
}

export function ReportedJourney({ layer, r, onShowRoute }: { layer: string; r: GeoRecord; onShowRoute(route: RouteInfo | null): void }) {
  const [route, setRoute] = useState<{ state: 'idle' | 'loading' | 'none' | 'ok' | 'error'; info: RouteInfo | null; err?: string }>({ state: 'idle', info: null });
  const callsign = typeof r.props.callsign === 'string' ? r.props.callsign.replace(/\s+/g, '').toUpperCase() : null;
  const routeRequest = useRef(0);
  useEffect(() => {
    setRoute({ state: 'idle', info: null });
    onShowRoute(null);
    return () => { routeRequest.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, r.id, callsign]);

  return (
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
                const request = ++routeRequest.current;
                setRoute({ state: 'loading', info: null });
                api
                  .aircraftRoute(callsign, r.lat, r.lon)
                  .then((info) => {
                    if (request !== routeRequest.current) return;
                    setRoute({ state: info ? 'ok' : 'none', info });
                    onShowRoute(info);
                  })
                  .catch((e) => {
                    if (request === routeRequest.current) setRoute({ state: 'error', info: null, err: errorText(e) });
                  });
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
  );
}
