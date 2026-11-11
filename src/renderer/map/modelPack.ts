// Loads the optional vehicle model pack (index.json next to the app's own files). A missing pack
// is normal (the app-built models are used); a broken one is reported in Map diagnostics.

import { parsePackIndex, type ModelPack, type PackModel } from '../../shared/modelPack';

export const packStats = { state: 'loading' as 'loading' | 'none' | 'ready' | 'error', models: 0, rejected: 0, error: null as string | null };

let current: ModelPack | null = null;
let loading: Promise<ModelPack | null> | null = null;

function packBase(): URL {
  return new URL('vehicle-models/', document.baseURI);
}

export function loadModelPack(): Promise<ModelPack | null> {
  if (!loading)
    loading = (async () => {
      try {
        const res = await fetch(new URL('index.json', packBase()), { cache: 'no-cache' });
        // 404 from the app's file server; the Vite dev server answers missing files with the HTML page instead.
        if (res.status === 404 || (res.ok && !(res.headers.get('content-type') ?? '').includes('json'))) {
          packStats.state = 'none';
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pack = parsePackIndex(await res.json());
        packStats.rejected = pack.rejected;
        if (pack.error) throw new Error(pack.error);
        current = pack;
        packStats.models = pack.models.length;
        // A valid but empty index means no models were imported: the app-built models are used.
        packStats.state = pack.models.length ? 'ready' : 'none';
        return pack;
      } catch (e) {
        packStats.state = 'error';
        packStats.error = String((e as Error)?.message ?? e).slice(0, 200);
        return null;
      }
    })();
  return loading;
}

/** The loaded pack, or null (not loaded yet, missing, or broken). */
export function currentModelPack(): ModelPack | null {
  return current;
}

export function packModelUrl(m: PackModel): string {
  return new URL(m.file, packBase()).href;
}
