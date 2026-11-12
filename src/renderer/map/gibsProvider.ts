import { UrlTemplateImageryProvider, type Request } from 'cesium';
import { repairRightEdge } from '../../shared/tilePixels';

// The bundled 1024 px zoom-3 imagery also contains the native zoom-4 and zoom-5 samples.
// Clip every NASA tile before it can enter a frame: the lower optical layer supplies water.
const OVERVIEW_LEVEL = 3;
const cache = new Map<string, Promise<ImageBitmap>>();

function bitmap(url: string): Promise<ImageBitmap> {
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = fetch(url, { signal: AbortSignal.timeout(20000) }).then(response => {
    if (!response.ok) throw new Error(`Imagery tile HTTP ${response.status}`);
    return response.blob();
  }).then(blob => createImageBitmap(blob));
  cache.set(url, pending);
  void pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  return pending;
}

function drawTile(ctx: OffscreenCanvasRenderingContext2D, source: ImageBitmap, x: number, y: number, factor: number, size: number) {
  const span = source.width / factor;
  ctx.drawImage(source, (x % factor) * span, (y % factor) * span, span, span, 0, 0, size, size);
}

export class GibsBaseProvider extends UrlTemplateImageryProvider {
  private readonly template: string;

  constructor(options: ConstructorParameters<typeof UrlTemplateImageryProvider>[0] & { url: string }) {
    super(options);
    this.template = options.url;
  }

  override async requestImage(x: number, y: number, level: number, _request?: Request): Promise<ImageBitmap> {
    const parentLevel = Math.min(OVERVIEW_LEVEL, level);
    const factor = 2 ** (level - parentLevel);
    const xyz = `${parentLevel}/${Math.floor(y / factor)}/${Math.floor(x / factor)}`;
    const bundled = level <= 5;
    const sourceUrl = bundled ? `/basemap-overview/${xyz}.jpg` :
      this.template.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y));
    const mask = await bitmap(`/optical-water/land/${xyz}.png`);
    // Uniform ocean mask tiles are encoded as a single transparent pixel by the generator.
    if (mask.width === 1) return createImageBitmap(new ImageData(1, 1));
    const source = await bitmap(sourceUrl);
    const size = level <= OVERVIEW_LEVEL ? 1024 : 256;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;
    drawTile(ctx, source, x, y, bundled ? factor : 1, size);
    if (!bundled && x === 2 ** level - 1) {
      const image = ctx.getImageData(0, 0, size, size);
      if (repairRightEdge(image.data, size, size)) ctx.putImageData(image, 0, 0);
    }
    ctx.globalCompositeOperation = 'destination-in';
    drawTile(ctx, mask, x, y, factor, size);
    return createImageBitmap(canvas, { imageOrientation: 'flipY' });
  }
}
