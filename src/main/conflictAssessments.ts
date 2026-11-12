import { cfrOverviewUrl, validateAssessments, type ConflictAssessment } from '../shared/conflictAssessments';
import { CFR_TRACKER_URL } from '../shared/conflictReports';
import { registerFeedLinks } from '../shared/sanitize';
import type { FetchText } from './feeds/http';
import type { AtlasStore } from './store';
import { createBulletinReader } from './publishedBulletins';

const maxBytes = 2 * 1024 * 1024;

function cellText(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Read the published overview table. The embedded map, story text, coordinates and external images are omitted. */
export function parseConflictAssessments(html: string): ConflictAssessment[] {
  if (html.length > maxBytes) throw new Error('CFR dashboard exceeds its size limit.');
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const table = Array.from(markup.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi), m => m[1])
    .find(contents => /<caption\b[^>]*>\s*Tracked conflicts\s*<\/caption>/i.test(contents));
  const body = table?.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  const expected = Number(markup.match(/>\s*(\d{1,3})\s+Results?\s*</i)?.[1]);
  if (!body || !expected || expected > 150) throw new Error('CFR dashboard could not be verified.');
  const rows = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), row => {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), m => m[1]);
    if (cells.length !== 5) throw new Error('CFR assessment columns changed.');
    const id = cells[0].match(/\bhref="\/global-conflict-tracker\/conflict\/([a-z0-9-]+)"/i)?.[1];
    const field = (index: number, label: string) => {
      const span = /^\s*<span\b[^>]*>([^<]+)<\/span>/i.exec(cells[index]);
      if (!span || cellText(span[1]) !== label) throw new Error('CFR assessment labels changed.');
      return cellText(cells[index].slice(span[0].length));
    };
    return { id, title: cellText(cells[0]), region: field(1, 'Region'), types: field(2, 'Type').split(/,\s*/), status: field(4, 'Status') };
  });
  const valid = validateAssessments(rows);
  if (!valid || valid.length !== expected) throw new Error('CFR returned an incomplete or unrecognized assessment table.');
  return valid;
}

export function createConflictAssessmentLookup(fetchText: FetchText, store: Pick<AtlasStore, 'getMeta' | 'setMeta'>) {
  const read = createBulletinReader({
    store, key: 'conflicts:cfr-assessments:v1', validate: validateAssessments, refreshMs: 6 * 60 * 60_000,
    load: async () => {
      const response = await fetchText(CFR_TRACKER_URL, { headers: { Accept: 'text/html' }, timeoutMs: 15000, maxBytes, rejectRedirects: true });
      if (response.status !== 200) throw new Error('CFR did not return a complete dashboard.');
      return parseConflictAssessments(response.text);
    },
  });
  return async () => {
    const snapshot = await read();
    registerFeedLinks(snapshot.items.map(row => cfrOverviewUrl(row.id)).filter((url): url is string => url !== null));
    return snapshot;
  };
}
