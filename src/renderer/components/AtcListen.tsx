// "Listen to ATC" for a selected aircraft: nearest airports with their published frequencies and a button that
// opens the airport's LiveATC.net page (their own player) in the system browser, plus an in-app search of the open radio
// directory for air-traffic relays near the airport. The app never streams LiveATC audio.
import { useMemo } from 'react';
import { Radio } from 'lucide-react';
import freqData from '../data/airportFrequencies.json';
import { AIRPORTS } from '../data/airports';
import { atcTypeLabel, likelyAtcTypes, LIVEATC_HOME, nearestAtc, type AtcFrequency } from '../../shared/atc';
import type { GeoRecord } from '../../shared/layers';
import { api } from '../lib/api';
import { ExternalLink } from './common';
import { setRadioIntent } from '../lib/radioPlayer';

const FREQS = (freqData as unknown as { frequencies: Record<string, AtcFrequency[]> }).frequencies;
const ELEVATION = new Map(AIRPORTS.map((a) => [a[0], a[5]]));

function open(url: string) {
  void api.openExternal(url).then((ok) => {
    if (!ok) window.dispatchEvent(new CustomEvent('atlas-link-error', { detail: 'This link was blocked by external URL validation.' }));
  });
}

export function AtcListen({ record }: { record: GeoRecord }) {
  // Re-run only when the aircraft has moved about a kilometre, not on every position update.
  const latKey = Math.round(record.lat * 100);
  const lonKey = Math.round(record.lon * 100);
  const near = useMemo(() => nearestAtc(latKey / 100, lonKey / 100, AIRPORTS, FREQS), [latKey, lonKey]);
  const onGround = record.props.onGround === true;
  if (!near.length) {
    return (
      <section className="atc-listen" aria-label="Air traffic control radio">
        <h3 className="sub">Air traffic control radio</h3>
        <p className="small muted">No airport with published tower or approach frequencies within 80 km. En-route and oceanic frequencies are not in the bundled list.</p>
      </section>
    );
  }
  const first = near[0];
  const likely = new Set(likelyAtcTypes(record.altM, onGround, ELEVATION.get(first.icao) ?? null, first.distanceKm));
  return (
    <section className="atc-listen" aria-label="Air traffic control radio">
      <h3 className="sub">Air traffic control radio</h3>
      {first.liveAtcUrl ? (
        <button className="btn primary atc-listen-main" onClick={() => open(first.liveAtcUrl!)}>
          <Radio size={16} strokeWidth={1.75} aria-hidden="true" /> Listen to {first.icao} on LiveATC
        </button>
      ) : null}
      <button className="btn atc-listen-main" onClick={() => setRadioIntent({ query: '', kind: 'atc', near: { lat: record.lat, lon: record.lon } })}>
        <Radio size={16} strokeWidth={1.75} aria-hidden="true" /> Find ATC streams near {first.icao} in the app
      </button>
      <p className="small muted">
        In the app: searches the open Radio Browser directory, which lists only a few air-traffic relays, so it often finds none. LiveATC opens in your browser, where volunteers stream some airports’ radio. Aircraft do not broadcast which frequency they use,
        so this is the nearest airport’s radio, not a confirmed link to this flight, and LiveATC may not cover it. Audio for personal listening only (LiveATC terms).
      </p>
      {near.map((s, i) => (
        <details key={s.icao} className="atc-airport" open={i === 0}>
          <summary>
            <span className="atc-icao">{s.icao}</span> {s.name} <span className="muted">· {s.distanceKm.toFixed(0)} km</span>
          </summary>
          <table className="atc-freqs">
            <caption className="sr-only">Published frequencies for {s.name}</caption>
            <thead><tr><th scope="col">Service</th><th scope="col">Name as published</th><th scope="col">MHz</th></tr></thead>
            <tbody>
              {s.frequencies.map(([type, desc, mhz]) => {
                const hint = i === 0 && likely.has(type);
                return (
                  <tr key={`${type}-${mhz}-${desc}`} className={hint ? 'likely' : ''}>
                    <td>{atcTypeLabel(type)}{hint && <span className="tag atc-likely">likely now</span>}</td>
                    <td>{desc || '—'}</td>
                    <td className="mono">{mhz.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {i > 0 && s.liveAtcUrl && <button className="btn" onClick={() => open(s.liveAtcUrl!)}><Radio size={16} strokeWidth={1.75} aria-hidden="true" /> Listen to {s.icao} on LiveATC</button>}
        </details>
      ))}
      <p className="small muted">
        “Likely now” is a guess from this aircraft’s height and distance, not from the radio. Frequencies: OurAirports (public domain), may be out of date.
        Audio: <ExternalLink url={LIVEATC_HOME}>LiveATC.net</ExternalLink>.
      </p>
    </section>
  );
}
