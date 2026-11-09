// Dated NASA GIBS imagery products drawn over the globe, with optional
// two-date swipe comparison (Cesium split-screen imagery layers).
//
// Every product, tile level, format, time range and legend comes from
// gibsCatalog.json, built from GIBS' own WMTS capabilities
// (scripts/build-gibs-catalog.mjs). Daily products are composites of swaths
// acquired during that UTC day: clouds, night-side gaps and missing swaths
// appear as published, and a date with no observation simply shows nothing.

import { Credit, ImageryLayer, SplitDirection, UrlTemplateImageryProvider, WebMercatorTilingScheme } from 'cesium';
import catalog from '../data/gibsCatalog.json';

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

/** Last date a product can be shown for: its last listed date, but not later than yesterday (UTC). */
export function latestDate(p: GibsProduct, now = new Date()): string {
  const y = new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);
  const last = (p.lastDate ?? p.defaultDate ?? y).slice(0, 10);
  return last < y ? last : y;
}

export function clampDate(p: GibsProduct, d: string): string {
  const lo = (p.firstDate ?? '2000-01-01').slice(0, 10);
  const hi = latestDate(p);
  if (p.period === 'P1Y') d = `${d.slice(0, 4)}-01-01`;
  return d < lo ? lo : d > hi ? hi : d;
}

export function shiftDate(d: string, days: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

const MERC = new WebMercatorTilingScheme();

function layerFor(p: GibsProduct, date: string, opacity: number, split: SplitDirection): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${p.id}/default/${date}/${p.tileMatrixSet}/{z}/{y}/{x}.${p.ext}`,
    tilingScheme: MERC,
    maximumLevel: p.maxLevel,
    credit: new Credit(`${p.title}, ${date} (NASA GIBS)`),
  });
  const layer = new ImageryLayer(provider, { alpha: opacity });
  layer.splitDirection = split;
  return layer;
}

/** Builds the overlay layers for the current state (one, or two for a comparison). */
export function buildImageryLayers(s: ImageryState): ImageryLayer[] {
  const p = gibsProduct(s.product);
  if (!p) return [];
  if (!s.compare) return [layerFor(p, clampDate(p, s.date), s.opacity, SplitDirection.NONE)];
  return [layerFor(p, clampDate(p, s.date), s.opacity, SplitDirection.LEFT), layerFor(p, clampDate(p, s.compareDate), s.opacity, SplitDirection.RIGHT)];
}
