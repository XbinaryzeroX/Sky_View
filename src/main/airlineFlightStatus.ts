import { datedFlightUrl, matchDatedFlight, type DatedFlightStatus } from '../shared/flightStatus';
import type { GeoRecord } from '../shared/layers';
import { normalizedPassengerCallsign, publicAirlineCallsign } from '../shared/route';
import { FeedHttpError, type FetchJson } from './feeds/http';
import { createHash } from 'node:crypto';

/** One bounded, explicit paid lookup. All identity fields come from the current main-process layer. */
export function createAirlineStatusLookup(fetchJson: FetchJson, currentRecord: (id: string) => GeoRecord | undefined,
  customerKey: () => string | null, now: () => number = Date.now) {
  let pending: { id: string; result: Promise<DatedFlightStatus | null> } | null = null;
  let recent: { id: string; until: number; result: DatedFlightStatus | null } | null = null;
  return async function lookup(recordId: string, requestedCallsign: string): Promise<DatedFlightStatus | null> {
    const selected = currentRecord(recordId);
    const callsign = selected && publicAirlineCallsign('aircraft', selected);
    const age = now() - Date.parse(selected?.observedAt ?? '');
    if (!selected || !callsign || callsign !== normalizedPassengerCallsign(requestedCallsign)
      || !Number.isFinite(age) || age < -60000 || age > 5 * 60000) {
      throw new Error('Select a current passenger airline aircraft to check its dated flight status.');
    }
    const key = customerKey();
    if (!key) throw new Error('Add your direct AeroDataBox API key in Providers to check dated flight status.');
    const account = createHash('sha256').update(key).digest('hex');
    const id = [account, selected.id, callsign, selected.props.registration ?? '', selected.observedAt?.slice(0, 10)].join('|');
    if (recent?.id === id && recent.until > now()) return recent.result;
    if (pending?.id === id) return pending.result;
    if (pending) throw new Error('A flight status request is already in progress.');
    const result = (async () => {
      try {
        const response = await fetchJson(datedFlightUrl(callsign), { headers: { 'X-Api-Key': key, Accept: 'application/json' },
          timeoutMs: 12000, maxBytes: 256 * 1024, sameOrigin: true, rejectRedirects: true });
        return response.status === 204 ? null : matchDatedFlight(response.body, selected, callsign);
      } catch (e) {
        if (e instanceof FeedHttpError && e.status === 404) return null;
        if (e instanceof FeedHttpError && (e.status === 401 || e.status === 403)) {
          throw new Error('AeroDataBox rejected access. Check your direct API key and subscription in Providers.');
        }
        if (e instanceof FeedHttpError && e.status === 429) throw new Error('AeroDataBox reported a usage limit. Try again later.');
        throw new Error('AeroDataBox could not return a valid flight status. Try again later.');
      }
    })();
    pending = { id, result };
    try {
      const answer = await result;
      recent = { id, until: now() + 60000, result: answer };
      return answer;
    } finally {
      pending = null;
    }
  };
}
