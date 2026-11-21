// Ask the planet: answers a question from the records around the view, through the local Ollama model when it is
// turned on, otherwise through OpenAI with the customer's own key (one chat request per question, billed to them).
// No other engine and no built-in key is used.

import { buildAskContext, buildAskMessages, parseAskReply, pickOpenAiModel, type AskAnswer, type AskView, type QuakeLike } from '../shared/askPlanet';
import { LAYERS, type GeoRecord, type LayerId } from '../shared/layers';
import type { Settings } from '../shared/types';
import type { FetchJson } from './feeds/http';
import { getAiStatus, ollamaEndpoint } from './ollama';

export interface AskDeps {
  fetchJson: FetchJson;
  settings: () => Settings;
  openAiKey: () => string | null;
  layers: () => { id: LayerId; records: GeoRecord[] }[];
  quakes: () => QuakeLike[];
  userAgent: () => string;
  now?: () => Date;
}

export function createAskPlanet(d: AskDeps) {
  let openAiModel: { key: string; model: string | null } | null = null;

  async function chooseOpenAiModel(key: string): Promise<string> {
    if (openAiModel?.key === key && openAiModel.model) return openAiModel.model;
    // Listing models is free; it tells which chat model this key may use.
    const res = await d.fetchJson('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}`, 'User-Agent': d.userAgent() }, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024, providerErrors: true });
    const data = (res.body as { data?: { id?: unknown }[] }).data;
    const model = pickOpenAiModel(Array.isArray(data) ? data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean) : []);
    openAiModel = { key, model };
    if (!model) throw new Error('Your OpenAI key has no access to a supported chat model (gpt-5-mini, gpt-4.1-mini or gpt-4o-mini).');
    return model;
  }

  return async function ask(question: string, view: AskView): Promise<AskAnswer> {
    const now = d.now?.() ?? new Date();
    const layers = d.layers();
    const context = buildAskContext(view, layers, d.quakes());
    const layersOn = [...layers.map((l) => LAYERS[l.id]?.name ?? l.id), 'Earthquakes'];
    const msg = buildAskMessages(question, view, context, layersOn, now);
    const s = d.settings();
    let raw: string;
    let engine: string;
    if (s.aiEnabled && s.ollamaModel) {
      const status = await getAiStatus(d.fetchJson, true, s.ollamaPort);
      if (!status.reachable) throw new Error(status.error ?? 'Ollama is not reachable.');
      if (!status.models.includes(s.ollamaModel)) throw new Error('The model chosen in Settings is not installed in Ollama.');
      const res = await d.fetchJson(`${ollamaEndpoint(s.ollamaPort)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: s.ollamaModel, stream: false, format: 'json', options: { temperature: 0.1 }, messages: [{ role: 'system', content: msg.system }, { role: 'user', content: msg.user }] }),
        timeoutMs: 240_000,
        maxBytes: 2 * 1024 * 1024,
      });
      const content = (res.body as { message?: { content?: unknown } }).message?.content;
      if (typeof content !== 'string') throw new Error('Unexpected reply from Ollama.');
      raw = content;
      engine = `${s.ollamaModel} (local, Ollama)`;
    } else {
      const key = d.openAiKey();
      if (!key) throw new Error('Turn on the local AI (Ollama) in Settings, or add your OpenAI key in Providers.');
      const model = await chooseOpenAiModel(key);
      const res = await d.fetchJson('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': d.userAgent() },
        body: JSON.stringify({ model, response_format: { type: 'json_object' }, max_completion_tokens: 1200, messages: [{ role: 'system', content: msg.system }, { role: 'user', content: msg.user }] }),
        timeoutMs: 90_000,
        maxBytes: 1024 * 1024,
        providerErrors: true,
      });
      const content = (res.body as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Unexpected reply from OpenAI.');
      raw = content;
      engine = `${model} (OpenAI, your key)`;
    }
    const parsed = parseAskReply(raw, context);
    return { answer: parsed.answer, marks: parsed.marks, engine, contextCount: context.length, layersSeen: layersOn, generatedAt: now.toISOString() };
  };
}
