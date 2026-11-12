import { useEffect, useMemo, useState } from 'react';
import type { GeoRecord } from '../../shared/layers';
import { publicAirlineCallsign, type RouteInfo } from '../../shared/route';
import { api, errorText } from './api';
import { bundledAirlineRoute } from './passengerRoutes';

type Selection = { id: string; callsign: string | null };
type JourneyResult = { selection: Selection; state: 'ready' | 'none' | 'error'; route: RouteInfo | null; error: string | null };
type Attempt = { selection: Selection; position: { lat: number; lon: number } | null };

export function useAirlineJourney(layer: string, record: GeoRecord) {
  const callsign = publicAirlineCallsign(layer, record);
  const selection = useMemo(() => ({ id: record.id, callsign }), [record.id, callsign]);
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);

  useEffect(() => {
    let current = true;
    setResult(null);
    if (callsign) {
      // The bundled lookup needs only a callsign. A coordinate is supplied solely by the manual action.
      const position = attempt?.selection === selection ? attempt.position : null;
      const lookup = position ? api.aircraftRoute(callsign, position.lat, position.lon)
        : bundledAirlineRoute(callsign);
      lookup.then(route => {
        if (!current) return;
        setResult({ selection, state: route ? 'ready' : 'none', route, error: null });
      }).catch(error => {
        if (current) setResult({ selection, state: 'error', route: null, error: errorText(error) });
      });
    }
    return () => { current = false; };
  }, [selection, callsign, attempt]);

  const visible = result?.selection === selection ? result : null;
  return {
    state: visible?.state ?? (callsign ? 'loading' as const : 'unavailable' as const),
    route: visible?.route ?? null,
    error: visible?.error ?? null,
    retry: () => setAttempt({ selection, position: attempt?.selection === selection ? attempt.position : null }),
    lookupReportedRoute: () => {
      if (callsign) setAttempt({ selection, position: { lat: record.lat, lon: record.lon } });
    },
  };
}
