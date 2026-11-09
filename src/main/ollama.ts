// Optional local AI via Ollama. Only the IPv4 loopback address is ever
// contacted; the user can change the port but not the host. The model gets
// no tools, no filesystem, and no network access from this app.

import { buildAiPrompt } from '../shared/ai';
import type { AiAnswer, AiStatus, AppSnapshot } from '../shared/types';
import { FeedHttpError, LOOPBACK_HOST, type FetchJson } from './feeds/http';

export function ollamaEndpoint(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Ollama port');
  return `http://${LOOPBACK_HOST}:${port}`;
}

export async function getAiStatus(fetchJson: FetchJson, enabled: boolean, port: number): Promise<AiStatus> {
  const endpoint = ollamaEndpoint(port);
  if (!enabled) return { enabled, reachable: false, models: [], error: null, endpoint };
  try {
    const res = await fetchJson(`${endpoint}/api/tags`, { timeoutMs: 3000, maxBytes: 2 * 1024 * 1024 });
    const models = Array.isArray((res.body as { models?: unknown }).models)
      ? ((res.body as { models: unknown[] }).models
          .map((m) => (m && typeof m === 'object' ? (m as { name?: unknown }).name : null))
          .filter((n): n is string => typeof n === 'string' && n.length < 200) as string[])
      : [];
    return { enabled, reachable: true, models, error: models.length ? null : 'Ollama is running but no models are installed.', endpoint };
  } catch (e) {
    const msg = e instanceof FeedHttpError && (e.kind === 'network' || e.kind === 'timeout') ? 'Ollama is not running on this computer (or is on a different port).' : (e as Error).message;
    return { enabled, reachable: false, models: [], error: msg, endpoint };
  }
}

export async function askOllama(
  fetchJson: FetchJson,
  port: number,
  model: string,
  snap: AppSnapshot,
  question: string,
  locationIds: string[],
  now: Date,
): Promise<AiAnswer> {
  const status = await getAiStatus(fetchJson, true, port);
  if (!status.reachable) throw new Error(status.error ?? 'Ollama unavailable');
  if (!status.models.includes(model)) throw new Error('Selected model is not installed in Ollama. Choose an installed model in Settings.');
  const prompt = buildAiPrompt(snap, locationIds, question, now);
  const res = await fetchJson(`${ollamaEndpoint(port)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.1 },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    timeoutMs: 240_000,
    maxBytes: 4 * 1024 * 1024,
  });
  const content = (res.body as { message?: { content?: unknown } }).message?.content;
  if (typeof content !== 'string') throw new Error('Unexpected response from Ollama');
  return { model, answer: content.slice(0, 20000), generatedAt: new Date().toISOString(), contextRecordIds: prompt.recordIds };
}
