import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTerrariumTerrain } from '../src/renderer/map/terrain';
import { overviewTerrainTile } from '../src/renderer/map/terrainOverview';

describe('bundled terrain at continent scale', () => {
  const bytes = readFileSync(new URL('../public/terrain/overview-z2.bin', import.meta.url));
  const grid = new Int16Array(bytes.buffer, bytes.byteOffset + 8, 1024 * 1024);
  afterEach(() => vi.unstubAllGlobals());

  it('reads one local asset for all overview tiles while local zoom and strict sampling still use source elevation', async () => {
    const read = vi.fn(async (url: string | URL) => String(url) === 'app://atlas/terrain/overview-z2.bin'
      ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 }));
    vi.stubGlobal('document', { baseURI: 'app://atlas/' });
    vi.stubGlobal('fetch', read);
    const { provider, stats } = createTerrariumTerrain();
    await Promise.all([provider.requestTileGeometry(0, 0, 0), provider.requestTileGeometry(8, 6, 4), provider.requestTileGeometry(16, 12, 5)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ overviewTiles: 3, requested: 0 });
    await provider.requestTileGeometry(32, 24, 6);
    expect(stats.requested).toBeGreaterThan(0);
    const strict = createTerrariumTerrain({ strict: true });
    await expect(strict.provider.requestTileGeometry(0, 0, 0)!).rejects.toThrow(/no terrain data/);
    expect(strict.stats.overviewTiles).toBe(0);
  });

  it('retains measured broad-scale relief, smooths adjacent boundaries and draws the open ocean at sea level', () => {
    const tibet = overviewTerrainTile(grid, 82, 85, 33, 31, 65);
    expect(Math.min(...tibet.heights)).toBeGreaterThan(3500);
    const ocean = overviewTerrainTile(grid, -148, -145, 6, 4, 65);
    expect(Math.max(...ocean.heights)).toBe(0);
    expect([...ocean.water]).toEqual([255]);
    const east = overviewTerrainTile(grid, 176, 180, 72, 62, 65);
    const west = overviewTerrainTile(grid, -180, -176, 72, 62, 65);
    for (let row = 0; row < 65; row++) expect(east.heights[row * 65 + 64]).toBe(west.heights[row * 65]);
    expect(Array.from(overviewTerrainTile(grid, -30, 0, 90, 75, 65).heights).every(Number.isFinite)).toBe(true);
  });
});

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

describe('remote terrain tile borders', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('interpolates the same edge on both flanks of a steep source-tile boundary and across the date line', async () => {
    vi.stubGlobal('fetch', vi.fn(async (raw: string | URL) => {
      const match = /terrarium\/\d+\/(\d+)\/\d+\.png$/.exec(String(raw));
      return match ? new Response(new Uint8Array([Number(match[1]) % 2])) : new Response(null, { status: 404 });
    }));
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => ({ value: new Uint8Array(await blob.arrayBuffer())[0], close() {} })));
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() {
        let source = 0;
        return { drawImage(bitmap: { value: number }) { source = bitmap.value; }, getImageData() {
          const px = new Uint8ClampedArray(256 * 256 * 4);
          const height = 32768 + (source ? 1200 : 200);
          for (let i = 0; i < px.length; i += 4) { px[i] = height >> 8; px[i + 1] = height & 255; px[i + 3] = 255; }
          return { data: px };
        } };
      }
    });
    const display = createTerrariumTerrain().provider;
    const read = async (x: number) => (await display.requestTileGeometry(x, 1963, 13)) as unknown as { _buffer: Float32Array };
    // At Rainier this longitude rounds to 339199.99999999994. The old western mesh omitted its eastern contributor.
    for (const [west, east] of [[2649, 2650], [16383, 0]]) {
      const [a, b] = await Promise.all([read(west), read(east)]);
      for (let row = 0; row < 65; row++) {
        expect(a._buffer[row * 65 + 64]).toBeCloseTo(700, 3);
        expect(b._buffer[row * 65]).toBe(a._buffer[row * 65 + 64]);
      }
    }
  });
});
