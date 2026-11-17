// Versioned civil investigation state, without source URLs, secrets or private place references.
import { z } from 'zod';
import catalog from '../renderer/data/gibsCatalog.json';
import { validImageryDate } from './imageryDates';
import type { Settings } from './types';
import { imageryYearSchema } from './satelliteYears';

export const surfaceSchema = z.enum(['atlas', 'streets', 'usgsImageryTopo', 'usgsTopo', 'gibsDaily', 'esri', 'mapbox', 'eox', 'naturalEarth', 'neutral', 'google3d', 'google2d', 'ionBing']);
export const visualModeSchema = z.enum(['normal', 'crt', 'nvg', 'thermal', 'anime', 'noir', 'snow']);
export const investigationQuakeWindowSchema = z.enum(['hour', 'day', 'week', 'month']);
export const investigationQuakeMagnitudeSchema = z.number().finite().min(-1).max(10);
const utcMillis = z.string().datetime({ precision: 3 }).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Expected canonical UTC milliseconds.');
const sourceId = z.string().min(1).max(300).regex(/^[A-Za-z0-9_.:~-]+$/, 'Expected an opaque civil source identifier, not a URL.');
const products = new Set(catalog.products.map(product => `${product.category}|${product.id}`));
const date = z.string().refine(value => value === '' || validImageryDate(value), 'Expected an actual YYYY-MM-DD date or an unavailable empty date.');

export const investigationImagerySchema = z.object({
  product: z.string().max(240).refine(value => products.has(value), 'Unsupported dated imagery product.').nullable(),
  date, compare: z.boolean(), compareDate: date,
  opacity: z.number().finite().min(0).max(1), split: z.number().finite().min(0).max(1),
}).strict();

export const investigationSchema = z.object({
  version: z.literal(1),
  imageryYear: imageryYearSchema.optional(),
  clock: z.discriminatedUnion('mode', [z.object({ mode: z.literal('live') }).strict(), z.object({ mode: z.literal('recorded'), t: utcMillis }).strict()]),
  selection: z.object({ kind: z.enum(['alert', 'quake']), id: sourceId }).strict().nullable(),
  severityFilter: z.array(z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'])).max(5).refine(values => new Set(values).size === values.length, 'Severity filters must be unique.'),
  alertsAffectingOnly: z.boolean(), quakesNearLocationsOnly: z.boolean(),
  /** Saved live query; a recorded restore does not change it. */
  quakeWindow: investigationQuakeWindowSchema, quakeMinMagnitude: investigationQuakeMagnitudeSchema,
  layers: z.object({ alerts: z.boolean(), quakes: z.boolean(), locations: z.boolean(), radii: z.boolean(), boundaries: z.boolean() }).strict(),
  sceneMode: z.enum(['2d', '3d']), dataOpen: z.boolean(), hudOn: z.boolean(), showAirports: z.boolean(),
  imagery: investigationImagerySchema.optional(),
}).strict();
export type Investigation = z.infer<typeof investigationSchema>;

const explicitSurfaces = new Set<string>(['google3d', 'google2d', 'esri', 'mapbox', 'eox', 'ionBing']);
export function needsSurfaceChoice(current: Settings['basemap'], requested: string): boolean {
  return current !== requested && explicitSurfaces.has(requested);
}
