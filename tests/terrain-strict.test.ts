import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerrariumTerrain } from '../src/renderer/map/terrain';

describe('terrain height sampling with missing source tiles', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fills a missing tile with sea level for the globe, but fails it in strict mode (used for ground heights)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const display = createTerrariumTerrain().provider;
    const strict = createTerrariumTerrain({ strict: true }).provider;
    // Somewhere inland and high (Denver area, level 13 geographic tile).
    const x = 2725, y = 1450, level = 13;
    const shown = await display.requestTileGeometry(x, y, level);
    expect(shown).toBeDefined();
    await expect(strict.requestTileGeometry(x, y, level)!).rejects.toThrow(/no terrain data/);
  });
});

describe('terrain height sampling below sea level', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a valid elevation of −100 m in strict mode while the globe flattens it (ocean data unavailable)', async () => {
    // Every request returns some bytes: terrain decodes (faked below) to −100 m; the ocean mask cannot be read.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close() {} })));
    // Terrarium encoding: h = R·256 + G + B/256 − 32768 → −100 m = (127, 156, 0).
    const px = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < 256 * 256; i++) px.set([127, 156, 0, 255], i * 4);
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { drawImage() {}, clearRect() {}, getImageData: () => ({ data: px }) };
        }
      },
    );
    const x = 2725, y = 1450, level = 13;
    const strict = (await createTerrariumTerrain({ strict: true }).provider.requestTileGeometry(x, y, level)) as unknown as { _buffer: Float32Array };
    const display = (await createTerrariumTerrain().provider.requestTileGeometry(x, y, level)) as unknown as { _buffer: Float32Array };
    expect(Array.from(strict._buffer).every((h) => Math.abs(h + 100) < 1e-6)).toBe(true);
    expect(Array.from(display._buffer).every((h) => h === 0)).toBe(true);
  });
});
