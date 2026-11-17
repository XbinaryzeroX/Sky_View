// Speech-to-text for voice commands with the customer's own OpenAI key. One recording per command, sent only when the
// user holds the microphone button. The key stays in this process and never appears in errors or logs.

import { FeedHttpError, type FetchJson } from './feeds/http';

export const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
/** OpenAI's long-standing speech-to-text model. */
export const TRANSCRIBE_MODEL = 'whisper-1';
export const VOICE_MAX_BYTES = 1_000_000;
export const VOICE_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
export type VoiceMime = (typeof VOICE_MIME)[number];

const EXT: Record<VoiceMime, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

/** A multipart/form-data body with the model, the language hint and one audio file. */
export function transcriptionBody(audio: Uint8Array, mime: VoiceMime, boundary: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const field = (name: string, value: string) => enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="command.${EXT[mime]}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const parts = [field('model', TRANSCRIBE_MODEL), field('response_format', 'json'), head, audio, tail];
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function createVoiceTranscriber(fetchJson: FetchJson, key: () => string | null, userAgent: () => string) {
  return async (audio: Uint8Array, mime: VoiceMime): Promise<{ text: string }> => {
    const secret = key();
    if (!secret) throw new Error('Add your OpenAI API key in Providers to use voice commands.');
    if (audio.length < 200) throw new Error('The recording was too short. Hold the microphone button while you speak.');
    const boundary = `atlas${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    try {
      const res = await fetchJson(OPENAI_TRANSCRIBE_URL, {
        method: 'POST',
        bytes: transcriptionBody(audio, mime, boundary),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'User-Agent': userAgent() },
        timeoutMs: 30000, maxBytes: 64 * 1024, rejectRedirects: true,
      });
      const text = (res.body as { text?: unknown })?.text;
      if (typeof text !== 'string') throw new Error('OpenAI returned no transcript.');
      return { text: text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) };
    } catch (e) {
      if (e instanceof FeedHttpError && e.status === 401) throw new Error('OpenAI rejected the key. Check it in Providers.');
      if (e instanceof FeedHttpError && e.status === 429) throw new Error('OpenAI asked the app to wait (rate limit or no credit left on your account).');
      throw new Error('Voice command failed: OpenAI could not be reached or refused the recording.');
    }
  };
}
