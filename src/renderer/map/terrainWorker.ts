/// <reference lib="webworker" />
// Off-main-thread decoding for terrain:
//   'height' – fetch a Terrarium PNG and decode it to metres (Float32Array, 256×256)
//   'alpha'  – read the alpha channel of an ocean-mask bitmap (Uint8Array, 256×256)
// Results are transferred (zero-copy) back to the main thread.

type Req = { id: number; kind: 'height'; url: string; strict?: boolean } | { id: number; kind: 'alpha'; bitmap: ImageBitmap };

const canvas = new OffscreenCanvas(256, 256);
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

self.onmessage = async (e: MessageEvent<Req>) => {
  const r = e.data;
  try {
    if (r.kind === 'height') {
      const res = await fetch(r.url, { signal: AbortSignal.timeout(20000) });
      if (res.status === 404) {
        // Strict (height sampling): no data is a failure, not a 0 m height.
        if (r.strict) throw new Error('no terrain data for this tile');
        const z = new Float32Array(256 * 256);
        (self as unknown as Worker).postMessage({ id: r.id, ok: true, data: z }, [z.buffer]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      (self as unknown as Worker).postMessage({ id: r.id, ok: true, data: out }, [out.buffer]);
    } else {
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(r.bitmap, 0, 0, 256, 256);
      r.bitmap.close();
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const a = new Uint8Array(256 * 256);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      (self as unknown as Worker).postMessage({ id: r.id, ok: true, data: a }, [a.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: r.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
