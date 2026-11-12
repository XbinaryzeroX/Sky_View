// Dated NASA GIBS imagery products drawn over the globe, with optional
// two-date swipe comparison (Cesium split-screen imagery layers).
//
// Products, tile levels, formats and legends come from gibsCatalog.json, built
// from GIBS' WMTS capabilities (scripts/build-gibs-catalog.mjs). Date availability
// refreshes through per-product DescribeDomains; the catalog remains a disclosed
// offline snapshot. Daily products are composites of swaths
// acquired during that UTC day: clouds, night-side gaps and missing swaths
// appear as published, and a date with no observation simply shows nothing.

import { Credit, ImageryLayer, SplitDirection, UrlTemplateImageryProvider, WebMercatorTilingScheme } from 'cesium';
import catalog from '../data/gibsCatalog.json';
import { adjacentImageryDate, availableImageryDate, ImageryDatesClient, validImageryDate } from '../../shared/imageryDates';

export interface GibsProduct {
  id: string;
  category: string;
  title: string;
  note: string;
  tileMatrixSet: string;
  maxLevel: number;
  ext: string;
  defaultDate: string | null;
  firstDate: string | null;
  lastDate: string | null;
  period: string;
  legend: string | null;
}

export const GIBS_PRODUCTS = (catalog as { products: GibsProduct[] }).products;
export const GIBS_CATALOG_BUILT_AT = catalog.builtAt;
export const imageryDates = new ImageryDatesClient();
export const GIBS_CATEGORIES = [...new Set(GIBS_PRODUCTS.map((p) => p.category))];
export const gibsProduct = (key: string | null) => GIBS_PRODUCTS.find((p) => `${p.category}|${p.id}` === key) ?? null;
export const productKey = (p: GibsProduct) => `${p.category}|${p.id}`;

export interface ImageryState {
  /** `${category}|${id}` of the selected product, or null for none. */
  product: string | null;
  date: string;
  compare: boolean;
  compareDate: string;
  opacity: number;
  split: number;
}

/** Approximate ground pixel size at the equator for a GoogleMapsCompatible level. */
export function levelResolution(level: number): string {
  const m = 40075016.686 / (256 * 2 ** level);
  return m >= 1000 ? `≈${(m / 1000).toFixed(1)} km` : `≈${Math.round(m)} m`;
}

/** Newest date actually listed by GIBS; the bundled snapshot stays a disclosed offline fallback. */
export function latestDate(p: GibsProduct, now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  const known = imageryDates.snapshot(p).data;
  if (known) return availableImageryDate(known, today, 'before', today) ?? '';
  const last = (p.lastDate ?? p.defaultDate ?? '').slice(0, 10);
  return validImageryDate(last) && last <= today ? last : '';
}

export function firstDate(p: GibsProduct): string {
  const known = imageryDates.snapshot(p).data;
  if (known) return availableImageryDate(known, '1900-01-01', 'after') ?? '';
  return p.firstDate?.slice(0, 10) ?? '';
}

export function clampDate(p: GibsProduct, d: string): string {
  const known = imageryDates.snapshot(p).data;
  if (known) return availableImageryDate(known, validImageryDate(d) ? d : latestDate(p)) ?? '';
  const lo = firstDate(p);
  const hi = latestDate(p);
  if (!lo || !hi) return '';
  if (!validImageryDate(d)) return hi;
  if (p.period === 'P1Y') d = `${d.slice(0, 4)}-01-01`;
  return d < lo ? lo : d > hi ? hi : d;
}

/** Previous/next actual source date; when offline, only the bundled cadence is known. */
export function nextDate(p: GibsProduct, current: string, direction: -1 | 1): string {
  const known = imageryDates.snapshot(p).data;
  if (known) return adjacentImageryDate(known, current, direction) ?? current;
  if (!validImageryDate(current)) return latestDate(p);
  const step = /^P([1-9]\d*)([DMY])$/.exec(p.period);
  if (!step) return current;
  const value = new Date(`${current}T00:00:00Z`);
  if (step[2] === 'Y') value.setUTCFullYear(value.getUTCFullYear() + direction * Number(step[1]));
  else if (step[2] === 'M') value.setUTCMonth(value.getUTCMonth() + direction * Number(step[1]));
  else value.setUTCDate(value.getUTCDate() + direction * Number(step[1]));
  return clampDate(p, value.toISOString().slice(0, 10));
}

/** At most fourteen real source dates for playback, including gaps rather than inventing frames in them. */
export function playbackDates(p: GibsProduct, count = 14): string[] {
  let cursor = latestDate(p);
  if (!cursor) return [];
  const dates = [cursor];
  for (let i = 1; i < Math.min(14, Math.max(1, count)); i++) {
    const prior = nextDate(p, cursor, -1);
    if (!prior || prior >= cursor) break;
    dates.unshift(prior);
    cursor = prior;
  }
  return dates;
}

export function shiftDate(d: string, days: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

const MERC = new WebMercatorTilingScheme();

export function gibsImageryProvider(p: GibsProduct, date: string): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${p.id}/default/${date}/${p.tileMatrixSet}/{z}/{y}/{x}.${p.ext}`,
    tilingScheme: MERC,
    maximumLevel: p.maxLevel,
    credit: new Credit(`${p.title}, ${date} (NASA GIBS)`),
  });
}

function layerFor(p: GibsProduct, date: string, opacity: number, split: SplitDirection): ImageryLayer {
  const layer = new ImageryLayer(gibsImageryProvider(p, date), { alpha: opacity });
  layer.splitDirection = split;
  return layer;
}

/** Builds the overlay layers for the current state (one, or two for a comparison). */
export function buildImageryLayers(s: ImageryState): ImageryLayer[] {
  const p = gibsProduct(s.product);
  if (!p) return [];
  if (!clampDate(p, s.date)) return []; // A valid empty source domain must not draw old bundled dates.
  if (!s.compare) return [layerFor(p, clampDate(p, s.date), s.opacity, SplitDirection.NONE)];
  return [layerFor(p, clampDate(p, s.date), s.opacity, SplitDirection.LEFT), layerFor(p, clampDate(p, s.compareDate), s.opacity, SplitDirection.RIGHT)];
}
