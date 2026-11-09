// Aircraft/vessel extras for the details panel: symbol classification, an
// identification photograph (opt-in, exact aircraft only), the reported route
// for a callsign, and a legend separating observed track from reported route.

import { useEffect, useState } from 'react';
import type { GeoRecord } from '../../shared/layers';
import type { RouteInfo } from '../../shared/route';
import { classifyAircraft, classifyVessel } from '../../shared/vehicleClass';
import { api, errorText } from '../lib/api';

interface Photo {
  thumb: string;
  link: string;
  photographer: string;
}

const photoCache = new Map<string, Photo | null>();

/** Exact-aircraft photo by ICAO 24-bit address from Planespotters.net (only when the user opted in). */
function useAircraftPhoto(hex: string | null, enabled: boolean): { photo: Photo | null; state: 'off' | 'loading' | 'none' | 'ok' | 'error' | 'refused' } {
  const [state, setState] = useState<'off' | 'loading' | 'none' | 'ok' | 'error' | 'refused'>('off');
  const [photo, setPhoto] = useState<Photo | null>(null);
  useEffect(() => {
    if (!enabled || !hex || !/^[0-9a-f]{6}$/i.test(hex)) {
      setState('off');
      setPhoto(null);
      return;
    }
    if (photoCache.has(hex)) {
      const p = photoCache.get(hex)!;
      setPhoto(p);
      setState(p ? 'ok' : 'none');
      return;
    }
    let cancelled = false;
    setState('loading');
    fetch(`https://api.planespotters.net/pub/photos/hex/${hex.toLowerCase()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { photos?: { thumbnail_large?: { src?: string }; thumbnail?: { src?: string }; link?: string; photographer?: string }[] }) => {
        const p = j.photos?.[0];
        const thumb = p?.thumbnail_large?.src ?? p?.thumbnail?.src;
        const ok = thumb && thumb.startsWith('https://t.plnspttrs.net/') && p?.link?.startsWith('https://www.planespotters.net/');
        const v = ok ? { thumb: thumb!, link: p!.link!, photographer: String(p!.photographer ?? 'Unknown photographer').slice(0, 80) } : null;
        photoCache.set(hex, v);
        if (!cancelled) {
          setPhoto(v);
          setState(v ? 'ok' : 'none');
        }
      })
      .catch((e) => !cancelled && setState(String((e as Error).message) === '403' ? 'refused' : 'error'));
    return () => {
      cancelled = true;
    };
  }, [hex, enabled]);
  return { photo, state };
}

export function VehicleExtras({ layer, r, photosEnabled, onEnablePhotos, onShowRoute }: { layer: string; r: GeoRecord; photosEnabled: boolean; onEnablePhotos(): void; onShowRoute(route: RouteInfo | null): void }) {
  const isAir = layer === 'aircraft' || layer === 'aircraftMil';
  const cls = isAir ? classifyAircraft(r.props.type as string | null, r.props.emitterCategory as string | null) : classifyVessel(typeof r.props.shipType === 'number' ? r.props.shipType : null);
  const { photo, state } = useAircraftPhoto(isAir ? String(r.props.icao24 ?? r.id) : null, photosEnabled);
  const [route, setRoute] = useState<{ state: 'idle' | 'loading' | 'none' | 'ok' | 'error'; info: RouteInfo | null; err?: string }>({ state: 'idle', info: null });
  const callsign = typeof r.props.callsign === 'string' ? r.props.callsign.replace(/\s+/g, '').toUpperCase() : null;
  useEffect(() => {
    setRoute({ state: 'idle', info: null });
    onShowRoute(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  return (
    <section className="veh-extras">
      <p className="muted small">Map symbol: {cls.explain}.</p>
      {isAir ? (
        <figure className="veh-photo">
          {state === 'ok' && photo ? (
            <>
              <a href={photo.link} target="_blank" rel="noreferrer">
                <img src={photo.thumb} alt={`Photograph of aircraft ${String(r.props.registration ?? r.label)}`} />
              </a>
              <figcaption className="small">
                Photo of this aircraft (matched by ICAO address) © {photo.photographer} ·{' '}
                <a href={photo.link} target="_blank" rel="noreferrer">
                  Planespotters.net
                </a>
              </figcaption>
            </>
          ) : state === 'off' ? (
            <div className="veh-nophoto">
              No photo shown.{' '}
              <button className="linkish" onClick={onEnablePhotos}>
                Enable aircraft photos (Planespotters.net)
              </button>
            </div>
          ) : (
            <div className="veh-nophoto">{state === 'loading' ? 'Looking for a photo of this aircraft…' : state === 'none' ? 'No photo of this exact aircraft is published on Planespotters.net.' : state === 'refused' ? 'Planespotters.net refused the request (HTTP 403): it requires apps to identify themselves with a contact URL or email address, which is not configured. No photo is shown.' : 'The photo service could not be reached.'}</div>
          )}
        </figure>
      ) : (
        <div className="veh-nophoto">No authorized vessel photo source is connected. (Ship photos are not shown rather than guessed from the type.)</div>
      )}
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
