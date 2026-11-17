// Fetches the detailed Launch Library 2 record of one launch the user selected, for its event timeline. Anonymous
// access is limited to 15 requests an hour (shared with the launches layer), so answers are cached for six hours,
// concurrent asks for the same launch share one request, and nothing is asked until the user presses the button.

import { launchDetailUrl, normalizeLaunchTimeline, type LaunchTimeline } from '../shared/launchTimeline';
import { FeedHttpError, type FetchJson } from './feeds/http';

const CACHE_MS = 6 * 3600_000;
const CACHE_MAX = 50;

export function createLaunchTimelineLookup(fetchJson: FetchJson, userAgent: () => string, now: () => number = Date.now, token: () => string | null = () => null) {
  const cache = new Map<string, { at: number; timeline: LaunchTimeline }>();
  const inflight = new Map<string, Promise<LaunchTimeline>>();
  return async (id: string): Promise<LaunchTimeline> => {
    const hit = cache.get(id);
    if (hit && now() - hit.at < CACHE_MS) return hit.timeline;
    const pending = inflight.get(id);
    if (pending) return pending;
    const run = (async () => {
      try {
        const t = token();
        const res = await fetchJson(launchDetailUrl(id), { headers: { 'User-Agent': userAgent(), ...(t ? { Authorization: `Token ${t}` } : {}) }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 });
        const timeline = normalizeLaunchTimeline(res.body, id, new Date(now()).toISOString());
        cache.delete(id);
        cache.set(id, { at: now(), timeline });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        return timeline;
      } catch (e) {
        if (e instanceof FeedHttpError && e.status === 404) throw new Error('Launch Library no longer lists this launch.');
        if (e instanceof FeedHttpError && (e.status === 429 || e.status === 503)) throw new Error('Launch Library asked the app to wait (its free allowance is 15 requests an hour). Try again later.');
        throw e;
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, run);
    return run;
  };
}
