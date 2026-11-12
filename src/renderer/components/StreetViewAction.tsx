import { useRef, useState } from 'react';
import { streetViewUrl } from '../../shared/streetView';
import { api } from '../lib/api';

interface Props {
  getCenter(): { lat: number; lon: number } | null;
}

/** Explicit external viewer action; no imagery is fetched or embedded by Atlas Watch. */
export function StreetViewAction({ getCenter }: Props) {
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (opening.current) return;
    setStatus(null); setError(null);
    try {
      const center = getCenter();
      const url = center && streetViewUrl(center.lat, center.lon);
      if (!url) {
        setError('Map center is unavailable. Move the map to a location, then try again.');
        return;
      }
      opening.current = true; setBusy(true);
      if (await api.openExternal(url)) {
        setStatus('Sent to your browser. If no window appears, check your default browser and try again.');
      } else {
        setError('The Google Maps link was blocked. Try again; if this continues, check the app diagnostics.');
      }
    } catch {
      setError('Google Maps could not be opened. Check your default browser, then try again.');
    } finally {
      opening.current = false; setBusy(false);
    }
  }

  return <div className="street-view-action">
    <button type="button" className="btn small-btn" disabled={busy} onClick={() => void open()}>
      {busy ? 'Opening Google Maps…' : 'Street View in Google Maps ↗'}
    </button>
    <p className="muted small">External viewer at the current map center. Historical imagery; Google chooses the closest panorama. Availability varies.</p>
    {status && <p className="small" role="status">{status}</p>}
    {error && <p className="error-line small" role="alert">{error}</p>}
  </div>;
}
