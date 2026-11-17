// Plain-language reasons for a failed Google Map Tiles request, from the HTTP status (or its absence). The key is never
// part of the text: callers pass error objects whose messages are redacted before display.

export function googleStatus(e: unknown): number | null {
  const direct = (e as { statusCode?: unknown } | null)?.statusCode;
  if (typeof direct === 'number' && direct > 0) return direct;
  const msg = e instanceof Error ? e.message : String(e);
  const m = /\b(?:status(?: code)?:?\s*)?(400|401|403|404|429|5\d\d)\b/i.exec(msg);
  return m ? Number(m[1]) : null;
}

export function googleRefusal(what: string, e: unknown): string {
  const code = googleStatus(e);
  const why =
    code === 400 || code === 401 || code === 403
      ? `Google refused the key (HTTP ${code}). Check that Map Tiles API is enabled in the key's project, billing is attached, and the key's restrictions allow Map Tiles API with no website (HTTP referrer) restriction. A new key can take a few minutes to start working.`
      : code === 404
        ? 'Google answered "not found" (HTTP 404). Map Tiles API may not be enabled for this key’s project.'
        : code === 429
          ? 'Google quota reached (HTTP 429): your daily cap or the included allowance is used up.'
          : code !== null && code >= 500
            ? `Google had a server error (HTTP ${code}). Try again later.`
            : 'No answer from Google: the computer may be offline, or a firewall, proxy or antivirus is blocking tile.googleapis.com.';
  return `Google ${what} unavailable: ${why} Showing keyless imagery.`;
}
