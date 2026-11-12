import { useEffect, useRef, useState } from 'react';
import type { BundledSuggestion } from './placeSearchWorker';

interface Reply { query: string; matches: BundledSuggestion[]; error?: string }

/** Load and index the local multilingual catalog off the UI thread on the first place search. */
export function useBundledPlaces(query: string, enabled: boolean) {
  const worker = useRef<Worker | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const fail = () => {
      worker.current?.terminate();
      worker.current = null;
      if (active) setReply({ query, matches: [], error: 'The bundled place catalog could not open. Reopen search to retry.' });
    };
    try {
      worker.current ??= new Worker(new URL('./placeSearchWorker.ts', import.meta.url), { type: 'module' });
      worker.current.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (active && data.query === query) setReply(data);
      };
      worker.current.onerror = fail;
      worker.current.postMessage(query);
    } catch { fail(); }
    return () => { active = false; };
  }, [enabled, query]);
  return enabled && reply?.query === query ? reply : null;
}
