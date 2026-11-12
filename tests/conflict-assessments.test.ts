import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createConflictAssessmentLookup, parseConflictAssessments } from '../src/main/conflictAssessments';
import { HumanitarianReports, SituationAssessments } from '../src/renderer/components/ConflictUpdates';
import { CFR_TRACKER_URL, type ConflictSnapshot } from '../src/shared/conflictReports';
import { cfrOverviewUrl } from '../src/shared/conflictAssessments';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

vi.mock('../src/renderer/lib/api', () => ({ api: {}, errorText: String }));
const table = (count: number, row: string) => `<p>${count} Results</p><table><caption>Tracked conflicts</caption><tbody>${row}</tbody></table>`;
const cell = (label: string, value: string) => `<td><span>${label}</span><span>${value}</span></td>`;
const row = `<tr><td><span><a href="/global-conflict-tracker/conflict/fixture"><span>A &amp; B</span><svg><path /></svg></a></span></td>${cell('Region', 'Asia')}${cell('Type', 'Civil War, Political Instability')}${cell('Impact on U.S.', 'Low')}${cell('Status', '<span>Improving</span>')}</tr>`;
const checkedAt = '2026-03-01T19:00:00Z', nextCheckAt = '2026-03-02T01:00:00Z';

describe('CFR public overview', () => {
  it('takes only named table facts and rejects truncated tables, duplicate cases and changed labels', () => {
    const rows = parseConflictAssessments('<script>' + table(9, row) + '</script>' + table(1, row));
    expect(rows).toEqual([{ id: 'fixture', title: 'A & B', region: 'Asia', types: ['Civil War', 'Political Instability'], status: 'Improving' }]);
    for (const raw of [table(2, row), table(2, row + row), table(1, row.replace('>Status<', '>Unknown<')),
      table(1, row.replace('Improving', 'Changed labels')), table(0, ''), '<p>Unavailable</p>']) {
      expect(() => parseConflictAssessments(raw)).toThrow();
    }
  });

  it('shows the source, scope, retrieval time and status even on a retained response', () => {
    const html = renderToStaticMarkup(createElement(SituationAssessments, { reportCountries: new Set<string>(), onReports: vi.fn(), feed: {
      data: { items: parseConflictAssessments(table(1, row)), checkedAt, nextCheckAt, error: 'Offline' },
      failure: 'Offline', loading: false,
    } }));
    expect(html).toContain('Showing the last successful check');
    expect(html).toContain(CFR_TRACKER_URL); expect(html).toContain('potential crises');
    expect(html).toContain(checkedAt); expect(html).toContain('Improving');
  });
  it('registers exact observed case URLs and keeps Sudan, South Sudan and unrelated cases distinct', async () => {
    const slug = 'power-struggle-sudan';
    const read = createConflictAssessmentLookup(async () => ({ status: 200, text: table(1, row.replace('/fixture"', '/' + slug + '"')) }),
      { getMeta: () => null, setMeta: vi.fn() });
    const snapshot = await read();
    expect(isAllowedExternalUrl(cfrOverviewUrl(slug))).toBe(true);
    expect(isAllowedExternalUrl(cfrOverviewUrl('never-registered-test-case'))).toBe(false);
    expect(cfrOverviewUrl('../bad')).toBeNull();
    const markup = renderToStaticMarkup(createElement(SituationAssessments, { feed: { data: snapshot, failure: null, loading: false },
      reportCountries: new Set(['Sudan', 'South Sudan']), onReports: vi.fn() }));
    expect(markup).toContain(cfrOverviewUrl(slug)); expect(markup).toContain('Humanitarian reports for Sudan');
    expect(markup).not.toContain('Humanitarian reports for South Sudan');
  });
});

describe('humanitarian report coverage', () => {
  const empty: ConflictSnapshot = { checkedAt, nextCheckAt, source: 'Test publisher', coverage: 'Test publisher coverage', error: null, reports: [] };
  it('distinguishes a successful empty response, outage, loading, and previously observed reports', () => {
    const render = (data: ConflictSnapshot | null, failure: string | null, loading = false) =>
      renderToStaticMarkup(createElement(HumanitarianReports, { country: '', onCountry: vi.fn(), feed: { data, failure, loading } }));
    expect(render(null, null, true)).toContain('Checking the publisher');
    expect(render(null, 'Offline')).toContain('Current coverage is unknown');
    expect(render(empty, null)).toContain('No matching reports in the latest publisher reply');
    const staleEmpty = render(empty, 'Timeout');
    expect(staleEmpty).toContain('last successful check'); expect(staleEmpty).not.toContain('No matching reports');
    const report = { id: 'a', title: 'Food assistance bulletin', summary: 'Food distribution resumed.', country: 'Example country', publishedAt: checkedAt,
      source: 'Publishing agency', url: 'https://reliefweb.int/report/example-country/food-assistance' };
    const html = render({ ...empty, reports: [report, { ...report, id: 'b', title: 'Earlier bulletin', publishedAt: '2026-03-01T08:10:00Z' }] }, 'Timeout');
    expect(html).toContain('Earlier reports (1)'); expect(html).toContain(report.url);
    expect(html).toContain('Publishing agency'); expect(html).toContain(report.summary);
    expect(html).toContain('Posted'); expect(html).toContain('2026'); expect(html).toContain('Example country');
  });
});
