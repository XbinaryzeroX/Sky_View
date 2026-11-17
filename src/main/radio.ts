// Radio Browser station search and the audio relay. The renderer may contact only fixed hosts, so a station's stream
// is played through app://atlas/radio-stream/<station id>. The relay accepts only ids returned by an earlier search
// (never a URL from the renderer), connects only to public addresses (checked at every DNS lookup, so a hostname that
// resolves to the local network is refused), follows at most three redirects with the same check, passes through
// audio types only, and ends a stream after four hours. This is the second reviewed direct network path in the main
// process, alongside the Lemmy image loader; it exists because stations stream from thousands of servers.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { isAudioType, isPrivateAddress, mergeStations, normalizeStations, RADIO_API, RADIO_UUID, radioSearchUrls, type RadioQuery, type RadioStation } from '../shared/radio';
import type { FetchJson } from './feeds/http';

const MAX_STREAMS = 600;
const MAX_STREAM_MS = 4 * 3600_000;
const MAX_REDIRECTS = 3;

export function createRadio(fetchJson: FetchJson, userAgent: () => string) {
  const streams = new Map<string, string>();
  const remember = (m: Map<string, string>) => {
    for (const [id, url] of m) { streams.delete(id); streams.set(id, url); }
    while (streams.size > MAX_STREAMS) streams.delete(streams.keys().next().value!);
  };

  async function search(q: RadioQuery): Promise<{ stations: RadioStation[]; note: string | null }> {
    const urls = radioSearchUrls(q);
    const lists: RadioStation[][] = [];
    let failed = 0;
    for (const url of urls) {
      try {
        const res = await fetchJson(url, { headers: { 'User-Agent': userAgent() }, timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
        const n = normalizeStations(res.body);
        remember(n.streams);
        lists.push(n.stations);
      } catch { failed++; }
    }
    if (failed === urls.length) throw new Error('The Radio Browser directory could not be reached. Try again in a moment.');
    const stations = mergeStations(lists, q.kind);
    const note = q.kind === 'atc' && !stations.length
      ? 'No air-traffic streams are listed for this search. The open directory has very few; LiveATC’s own streams can only be opened on its website.'
      : q.kind === 'scanner' && !stations.length ? 'No scanner streams are listed for this search. The open directory has only a few.' : null;
    return { stations, note };
  }

  /** Tells Radio Browser a station was played (its requested etiquette); failures are ignored. */
  function countClick(id: string): void {
    void fetchJson(`${RADIO_API}/json/url/${id}`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 10000, maxBytes: 64 * 1024 }).catch(() => {});
  }

  /** Answers app://atlas/radio-stream/<id>. */
  async function relay(id: string, signal: AbortSignal | null): Promise<Response> {
    if (!RADIO_UUID.test(id)) return new Response('Not found', { status: 404 });
    const start = streams.get(id);
    if (!start) return new Response('Search for the station first.', { status: 404 });
    countClick(id);
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await open(url, signal).catch(() => null);
      if (!res) return new Response('The station could not be reached.', { status: 502 });
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        try { url = new URL(res.headers.location, url).href; } catch { return new Response('Bad redirect', { status: 502 }); }
        if (!/^https?:/.test(url)) return new Response('Bad redirect', { status: 502 });
        continue;
      }
      const type = res.headers['content-type'] ?? null;
      if (status !== 200 || !isAudioType(type)) {
        res.destroy();
        return new Response(status === 200 ? 'The station did not send audio.' : 'The station is not streaming.', { status: 502 });
      }
      const timer = setTimeout(() => res.destroy(), MAX_STREAM_MS);
      res.on('close', () => clearTimeout(timer));
      signal?.addEventListener('abort', () => res.destroy(), { once: true });
      return new Response(Readable.toWeb(res) as ReadableStream, { status: 200, headers: { 'Content-Type': (type ?? 'audio/mpeg').split(';')[0], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return new Response('Too many redirects', { status: 502 });
  }

  function open(url: string, signal: AbortSignal | null): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      if (u.username || u.password) { reject(new Error('credentials in URL')); return; }
      const lookup = (host: string, opts: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
        dnsLookup(host, { ...opts, all: true }, (err, addresses) => {
          if (err) return cb(err, []);
          const list = addresses as LookupAddress[];
          if (!list.length || list.some((a) => isPrivateAddress(a.address))) return cb(Object.assign(new Error('Station resolves to a private address'), { code: 'EACCES' }), []);
          if ((opts as { all?: boolean }).all) cb(null, list);
          else cb(null, list[0].address, list[0].family);
        });
      };
      if (isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ''))) { reject(new Error('private address')); return; }
      const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: 'GET', lookup: lookup as never, headers: { 'User-Agent': userAgent(), 'Icy-MetaData': '0', Accept: 'audio/*' }, timeout: 15000, signal: signal ?? undefined });
      req.on('response', resolve);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  return { search, relay };
}
