import { z } from 'zod';
import { availableImageryDate, type ImageryDates } from './imageryDates';

export const imageryYearSchema = z.number().int().min(2000)
  .refine(year => year <= new Date().getUTCFullYear(), 'Choose an imagery year that has already started.').nullable();

export interface ArchiveImage { year: number; date: string | null; sentinelYear: 2020 | 2021 | null }

// Actual acquisitions nearest July 1, verified in the Terra/MODIS DescribeDomains response
// on 2026-11-12. June 16 through July 2 of 2001 are absent. Live domains supersede this snapshot.
const verifiedDates = Array.from({ length: 27 }, (_, index) => {
  const year = 2000 + index;
  const date = year === 2001 ? '2001-07-03' : year + '-07-01';
  return { start: date, end: date, step: 1, unit: 'D' as const };
});
const bundled: ImageryDates = { ranges: verifiedDates, skipped: 0 };

export function archiveImage(year: number, live: ImageryDates | null, today = new Date().toISOString().slice(0, 10)): ArchiveImage {
  if (year === 2020 || year === 2021) return { year, date: null, sentinelYear: year };
  const data = live ?? bundled;
  const target = year + '-07-01';
  const end = year + '-12-31' < today ? year + '-12-31' : today;
  const nearest = availableImageryDate(data, target, 'nearest', end);
  const date = nearest?.startsWith(year + '-') ? nearest : availableImageryDate(data, year + '-01-01', 'after', end);
  return { year, date: date?.startsWith(year + '-') ? date : null, sentinelYear: null };
}

export function archiveYears(live: ImageryDates | null, today = new Date().toISOString().slice(0, 10)): number[] {
  const years: number[] = [];
  for (let year = Number(today.slice(0, 4)); year >= 2000; year--) {
    const image = archiveImage(year, live, today);
    if (image.date || image.sentinelYear) years.push(year);
  }
  return years;
}
