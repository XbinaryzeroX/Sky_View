import { MAX_DATE_MS } from '../../shared/retryAfter';
export { MAX_DATE_MS } from '../../shared/retryAfter';
/** Node's non-overflowing timeout range. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** Keep publisher delays finite and serializable, including very large delay-seconds. */
export function deadlineAfter(nowMs: number, delayMs: number): number {
  return Math.min(MAX_DATE_MS, nowMs + (Number.isNaN(delayMs) ? 0 : Math.max(0, delayMs)));
}

/** Long deadlines are reached through bounded hops; never pass an overflowing delay to setTimeout. */
export function timerDelayUntil(deadlineMs: number, nowMs: number): number {
  return Math.min(MAX_TIMEOUT_MS, Math.max(0, Math.ceil(deadlineMs - nowMs)));
}
