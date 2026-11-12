/** Largest serializable JavaScript Date, also bounds extreme publisher delay-seconds. */
export const MAX_DATE_MS = 8_640_000_000_000_000;

/** RFC 9110 §10.2.3: a non-negative decimal integer or one of the three HTTP-date forms. */
export function parseRetryAfter(raw: string | null, nowMs = Date.now()): number | null {
  if (!raw) return null;
  const value = raw.trim();
  // Saturate unbounded integer strings instead of turning an overflow into a short retry.
  if (/^\d+$/.test(value)) return Math.min(Number(value), MAX_DATE_MS / 1000);
  const obsolete = /^[A-Za-z]+, (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(value);
  if (obsolete) {
    // Date.parse uses a fixed 1950/2049 split. HTTP instead uses a moving fifty-year window.
    const cutoff = new Date(nowMs);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() + 50);
    let year = Math.floor(cutoff.getUTCFullYear() / 100) * 100 + Number(obsolete[3]);
    const atYear = () => Date.parse(`${obsolete[1]} ${obsolete[2]} ${year} ${obsolete[4]} GMT`);
    if (atYear() > cutoff.getTime()) year -= 100;
    const date = atYear();
    return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - nowMs) / 1000));
  }
  const httpDate = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  // The obsolete asctime form has no suffix, but HTTP dates are always UTC.
  const date = httpDate.test(value) ? Date.parse(value.endsWith(' GMT') ? value : `${value} GMT`) : NaN;
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - nowMs) / 1000));
}
