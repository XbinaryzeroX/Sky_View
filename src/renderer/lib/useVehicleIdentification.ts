import { useEffect, useState } from 'react';
import type { GeoRecord } from '../../shared/layers';
import type { VehicleInfo } from '../../shared/vehicleInfo';
import { api, errorText } from './api';

type Lookup = { key: string; info: VehicleInfo | null; error: string | null };

/** Identification and airframe photos share the existing opt-in and one request per selection. */
export function useVehicleIdentification(r: GeoRecord, aircraft: boolean, enabled: boolean) {
  const address = String(r.props.icao24 ?? r.id).trim().toLowerCase();
  const tail = typeof r.props.registration === 'string' ? r.props.registration.trim().toUpperCase() : '';
  const hex = aircraft && /^[a-f0-9]{6}$/.test(address) ? address : undefined;
  const registration = aircraft && /^[A-Z0-9-]{1,12}$/.test(tail) ? tail : undefined;
  const imo = !aircraft && typeof r.props.imo === 'number' && r.props.imo >= 1000000 && r.props.imo <= 9999999 ? r.props.imo : undefined;
  const key = enabled && (hex || registration || imo) ? JSON.stringify([hex, registration, imo]) : null;
  const [lookup, setLookup] = useState<Lookup | null>(null);
  useEffect(() => {
    setLookup(null);
    if (!key) return;
    let active = true;
    const query = aircraft ? { kind: 'aircraft' as const, hex, registration } : { kind: 'vessel' as const, imo };
    api.vehicleInfo(query).then(info => {
      if (active) setLookup({ key, info, error: null });
    }).catch(e => {
      if (active) setLookup({ key, info: null, error: errorText(e) });
    });
    return () => { active = false; };
  }, [key, aircraft, hex, registration, imo]);
  const result = key && lookup?.key === key ? lookup : null;
  const state = !key ? 'off' : !result ? 'loading' : result.error ? 'error' : 'done';
  return { info: result?.info ?? null, state, err: result?.error ?? null };
}
