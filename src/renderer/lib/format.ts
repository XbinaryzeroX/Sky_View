// Display helpers: local-time display of UTC timestamps, severity labels.

import type { AlertSeverity, Freshness } from '../../shared/types';

/** Flight categories as supplied by the AWC station observation. */
export const METAR_COLORS = new Map([
  ['VFR', '#4fc36b'], ['MVFR', '#4f8fe0'], ['IFR', '#e5534b'], ['LIFR', '#c45ad6'],
]);
export const METAR_UNKNOWN_COLOR = '#9aa7b4';

export function localTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function utcTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = now - Date.parse(iso);
  if (Number.isNaN(diff)) return '—';
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  let text: string;
  if (s < 45) text = 'moments';
  else if (s < 90) text = '1 min';
  else if (s < 3600) text = `${Math.round(s / 60)} min`;
  else if (s < 86400) text = `${Math.round(s / 3600)} h`;
  else text = `${Math.round(s / 86400)} d`;
  return future ? `in ${text}` : text === 'moments' ? 'just now' : `${text} ago`;
}

export const SEVERITY_ORDER: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

export const SEVERITY_META: Record<AlertSeverity, { icon: string; cls: string; color: string }> = {
  Extreme: { icon: '▲▲', cls: 'sev-extreme', color: '#e5534b' },
  Severe: { icon: '▲', cls: 'sev-severe', color: '#e8913a' },
  Moderate: { icon: '◆', cls: 'sev-moderate', color: '#d9c04a' },
  Minor: { icon: '●', cls: 'sev-minor', color: '#5fb6c9' },
  Unknown: { icon: '○', cls: 'sev-unknown', color: '#8a9bb0' },
};

export const FRESHNESS_META: Record<Freshness, { label: string; icon: string; cls: string }> = {
  fresh: { label: 'Current', icon: '✓', cls: 'fr-fresh' },
  stale: { label: 'Stale', icon: '!', cls: 'fr-stale' },
  unavailable: { label: 'Unavailable', icon: '✕', cls: 'fr-unavailable' },
};

export function quakeClass(mag: number | null): { cls: string; color: string; label: string } {
  if (mag === null) return { cls: 'mag-low', color: '#c9d3de', label: 'M?' };
  if (mag >= 6) return { cls: 'mag-high', color: '#e5534b', label: `M${mag.toFixed(1)}` };
  if (mag >= 4.5) return { cls: 'mag-mid', color: '#e8a33a', label: `M${mag.toFixed(1)}` };
  return { cls: 'mag-low', color: '#d8dee6', label: `M${mag.toFixed(1)}` };
}

export function prefersReducedMotion(setting: boolean): boolean {
  return setting || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
