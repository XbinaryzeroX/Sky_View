import { useEffect, useRef, useState } from 'react';
import type { DatedFlightStatus, FlightMovement } from '../../shared/flightStatus';
import { api, errorText } from '../lib/api';

const statusTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const time = (iso: string) => statusTime.format(new Date(iso));

function Movement({ caption, data }: { caption: string; data: FlightMovement }) {
  const diff = data.differenceMinutes;
  const timing = data.revisedKind === 'actual' ? 'Actual' : data.revisedKind === 'estimated' ? 'Estimated' : 'Revised';
  return <section className="flight-movement" aria-label={caption}>
    <h4>{caption} · {data.airport.iata ?? data.airport.icao ?? data.airport.name}</h4>
    <dl className="flight-facts">
      <div><dt>Scheduled</dt><dd>{data.scheduledUtc ? time(data.scheduledUtc) : 'Not reported'}</dd></div>
      {data.revisedUtc && <div><dt>{timing}</dt><dd>{time(data.revisedUtc)}{diff !== null && <small> · {diff === 0 ? 'on schedule' : `${Math.abs(diff)} min ${diff > 0 ? 'late' : 'early'}`}</small>}</dd></div>}
      {data.predictedUtc && data.predictedUtc !== data.revisedUtc && data.revisedKind !== 'actual' && <div><dt>Predicted</dt><dd>{time(data.predictedUtc)}</dd></div>}
      {data.terminal && <div><dt>Terminal</dt><dd>{data.terminal}</dd></div>}
      {data.gate && <div><dt>Gate</dt><dd>{data.gate}</dd></div>}
    </dl>
  </section>;
}

export function FlightSchedule({ recordId, callsign, value, onChange, onSetup }: {
  recordId: string; callsign: string; value: DatedFlightStatus | null; onChange(value: DatedFlightStatus | null): void; onSetup(): void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    let check = 0;
    const readKey = () => {
      const thisCheck = ++check;
      void api.listProviders().then(providers => {
        if (!active || thisCheck !== check) return;
        const hasKey = providers.some(p => p.id === 'aerodatabox' && p.userConfigured);
        setConfigured(hasKey);
        if (!hasKey) { generation.current++; pending.current = false; setBusy(false); onChange(null); }
      }).catch(() => { if (active && thisCheck === check) setMessage('Provider settings are unavailable.'); });
    };
    readKey();
    const changed = (e: Event) => { if ((e as CustomEvent).detail === 'aerodatabox') { setMessage(''); readKey(); } };
    window.addEventListener('atlas-providers-changed', changed);
    return () => { active = false; generation.current++; window.removeEventListener('atlas-providers-changed', changed); };
  }, [onChange]);
  async function lookup() {
    if (!configured || pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    const id = ++generation.current;
    try {
      const status = await api.airlineFlightStatus(recordId, callsign);
      if (generation.current !== id) return;
      onChange(status);
      if (!status) setMessage('No dated passenger flight could be matched to this aircraft and observation.');
    } catch (e) { if (generation.current === id) setMessage(errorText(e)); }
    finally { if (generation.current === id) { pending.current = false; setBusy(false); } }
  }
  return <section className="flight-schedule" aria-label="Dated flight status">
    <h3>Flight status</h3>
    {value && <>
      <p><strong>{value.flightNumber} · {value.status}</strong></p>
      <p className="flight-source">{value.source} · All times UTC{value.asOf ? ` · Updated ${time(value.asOf)} UTC` : ''}</p>
      <Movement caption="Departure" data={value.departure}/><Movement caption="Arrival" data={value.arrival}/>
    </>}
    {configured ? <>
      <p className="flight-source">Each lookup uses your AeroDataBox plan.</p>
      <button className="btn" disabled={busy} onClick={() => void lookup()}>{busy ? 'Checking flight status…' : value ? 'Refresh dated status' : 'Check dated flight status'}</button>
    </> : configured === false && <>
      <p className="flight-source">Connect AeroDataBox to check scheduled and updated times, gates and delays.</p>
      <button className="linkish" onClick={onSetup}>Set up flight status in Providers</button>
    </>}
    {message && <p role="status" className="flight-source">{message}</p>}
  </section>;
}
