import { useEffect, useMemo, useState } from 'react';
import { cfrOverviewUrl, type ConflictAssessments } from '../../shared/conflictAssessments';
import { CFR_TRACKER_URL, type ConflictReport, type ConflictSnapshot } from '../../shared/conflictReports';
import { api, errorText } from '../lib/api';
import { Empty, ExternalLink, Time } from './common';
import './conflictUpdates.css';

interface Check { checkedAt: string | null; nextCheckAt: string; error: string | null }
type Feed<T extends Check> = { data: T | null; failure: string | null; loading: boolean };

/** Each publisher supplies its own next-check time. Leaving the view stops the timer. */
function usePublication<T extends Check>(read: () => Promise<T>): Feed<T> {
  const [feed, setFeed] = useState<Feed<T>>({ data: null, failure: null, loading: true });
  useEffect(() => {
    let active = true, busy = false, deadline = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      clearTimeout(timer);
      if (!active || busy || document.hidden) return;
      if (deadline > Date.now()) {
        timer = setTimeout(check, Math.min(2_147_483_647, deadline - Date.now()));
        return;
      }
      busy = true;
      setFeed(prev => ({ ...prev, loading: true }));
      try {
        const data = await read();
        deadline = Math.max(Date.now() + 1000, Date.parse(data.nextCheckAt));
        if (active) setFeed({ data, loading: false, failure: data.error });
      } catch (e) {
        deadline = Date.now() + 60_000;
        if (active) setFeed(prev => ({ data: prev.data, loading: false, failure: errorText(e) }));
      } finally {
        busy = false;
        if (active && !document.hidden) timer = setTimeout(check, Math.min(2_147_483_647, Math.max(1000, deadline - Date.now())));
      }
    }
    void check();
    document.addEventListener('visibilitychange', check);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', check); };
  }, [read]);
  return feed;
}

function SourceCheck({ feed }: { feed: Feed<Check> }) {
  const checked = feed.data?.checkedAt;
  return <div className="conflict-check" role="status">
    {feed.loading && <p>Checking the publisher…</p>}
    {feed.failure && <p className="conflict-error">{checked ? 'Refresh failed. Showing the last successful check.' : 'Publisher unavailable. Current coverage is unknown.'} {feed.failure}</p>}
    {checked && <p>Last successful check <Time iso={checked} /></p>}
    {feed.data?.nextCheckAt && <p>Next check <Time iso={feed.data.nextCheckAt} /></p>}
  </div>;
}

const publicationTime = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

function Report({ report }: { report: ConflictReport }) {
  return <article className="conflict-report">
    <h4><ExternalLink url={report.url}>{report.title}</ExternalLink></h4>
    <p className="conflict-byline">{report.source} · Posted <time dateTime={report.publishedAt}>{publicationTime.format(Date.parse(report.publishedAt))}</time></p>
    {report.summary && report.summary !== report.title && <p>{report.summary}</p>}
  </article>;
}

export function HumanitarianReports({ feed, country, onCountry }: { feed: Feed<ConflictSnapshot>; country: string; onCountry(value: string): void }) {
  const { data } = feed;
  const groups = useMemo(() => {
    const byCountry = new Map<string, ConflictReport[]>();
    for (const report of [...(data?.reports ?? [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
      const group = byCountry.get(report.country);
      if (group) group.push(report);
      else byCountry.set(report.country, [report]);
    }
    return byCountry;
  }, [data?.reports]);
  const selected = groups.has(country) ? country : '';
  return <section aria-label="Humanitarian reports">
    <h3>{data?.source ?? 'Humanitarian reports'}</h3>
    {data && <p className="conflict-caption">{data.coverage}</p>}
    <SourceCheck feed={feed} />
    {data?.checkedAt && !data.reports.length && !feed.failure && <Empty>No matching reports in the latest publisher reply. Conflict conditions elsewhere are unknown.</Empty>}
    {groups.size > 0 && <>
      <label className="conflict-filter">Country or territory
        <select value={selected} onChange={event => onCountry(event.target.value)}>
          <option value="">All reported areas ({groups.size})</option>
          {[...groups.keys()].sort((a, b) => a.localeCompare(b)).map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      {[...groups].filter(([name]) => !selected || selected === name).map(([name, [latest, ...earlier]]) =>
        <section className="conflict-country" key={name} aria-label={name}>
          <h3>{name}</h3>
          <Report report={latest} />
          {!!earlier.length && <details><summary>Earlier reports ({earlier.length})</summary>
            {earlier.map(report => <Report key={report.id} report={report} />)}
          </details>}
        </section>)}
    </>}
  </section>;
}

// Match reviewed CFR cases to exact filing-area names used by humanitarian publishers.
// Regional disputes with no unambiguous country match retain the original case overview.
const caseCountries = new Map<string, readonly string[]>(Object.entries({
  'instability-haiti': ['Haiti'], 'criminal-violence-mexico': ['Mexico'], 'instability-venezuela': ['Venezuela', 'Venezuela (Bolivarian Republic of)'],
  'rohingya-crisis-myanmar': ['Myanmar'], 'war-afghanistan': ['Afghanistan', 'Pakistan'], 'conflict-between-india-and-pakistan': ['India', 'Pakistan'],
  'confrontation-over-taiwan': ['Taiwan'], 'north-korea-crisis': ["Democratic People's Republic of Korea", 'North Korea'],
  'nagorno-karabakh-conflict': ['Armenia', 'Azerbaijan'], 'conflict-ukraine': ['Ukraine'],
  'conflict-between-turkey-and-armed-kurdish-groups': ['Türkiye', 'Turkey'], 'war-yemen': ['Yemen'],
  'political-instability-lebanon': ['Lebanon'], 'confrontation-between-united-states-and-iran': ['Iran', 'Iran (Islamic Republic of)'],
  'political-instability-iraq': ['Iraq'], 'civil-war-libya': ['Libya'], 'conflict-syria': ['Syria', 'Syrian Arab Republic'],
  'israeli-palestinian-conflict': ['Israel', 'occupied Palestinian territory', 'State of Palestine'],
  'power-struggle-sudan': ['Sudan'], 'conflict-ethiopia': ['Ethiopia'], 'violence-central-african-republic': ['Central African Republic'],
  'violence-democratic-republic-congo': ['Democratic Republic of the Congo', 'Democratic Republic of Congo'],
  'al-shabab-somalia': ['Somalia'], 'civil-war-south-sudan': ['South Sudan'],
}));

export function SituationAssessments({ feed, reportCountries, onReports }: {
  feed: Feed<ConflictAssessments>; reportCountries: ReadonlySet<string>; onReports(country: string): void;
}) {
  const [region, setRegion] = useState('');
  const rows = feed.data?.items ?? [];
  const regions = [...new Set(rows.map(r => r.region))].sort();
  const selected = regions.includes(region) ? region : '';
  return <section aria-label="Conflict assessments">
    <h3>Conflict assessments</h3>
    <p className="conflict-caption">The Council on Foreign Relations tracks selected conflicts and potential crises of concern to the United States. Its status describes the trend across each situation.</p>
    <ExternalLink url={CFR_TRACKER_URL}>CFR Global Conflict Tracker</ExternalLink>
    <SourceCheck feed={feed} />
    {!!rows.length && <>
      <label className="conflict-filter">Region
        <select value={selected} onChange={e => setRegion(e.target.value)}>
          <option value="">All regions ({rows.length} situations)</option>
          {regions.map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      <ul className="conflict-assessments">{rows.filter(r => !selected || r.region === selected).map(item =>
        <li key={item.id}>
          <span className="conflict-area">{item.region}</span>
          <h4><ExternalLink url={cfrOverviewUrl(item.id)}>{item.title}</ExternalLink></h4>
          <p>{item.types.join(' · ')}</p>
          <span className={`tag conflict-trend trend-${item.status.toLowerCase()}`}>{item.status}</span>
          {(caseCountries.get(item.id) ?? []).filter(name => reportCountries.has(name)).map(name =>
            <button key={name} className="link-btn conflict-read-reports" onClick={() => onReports(name)}>Humanitarian reports for {name}</button>)}
        </li>)}</ul>
    </>}
  </section>;
}

export function ConflictUpdates() {
  const [view, setView] = useState<'reports' | 'assessments'>('reports');
  const [country, setCountry] = useState('');
  const reports = usePublication(api.conflictReports);
  const reportCountries = useMemo(() => new Set(reports.data?.reports.map(r => r.country)), [reports.data?.reports]);
  return <div className="conflict-updates">
    <div className="conflict-view" role="group" aria-label="Conflict sources">
      <button type="button" aria-pressed={view === 'reports'} onClick={() => setView('reports')}>Humanitarian reports</button>
      <button type="button" aria-pressed={view === 'assessments'} onClick={() => setView('assessments')}>CFR assessments</button>
    </div>
    {view === 'reports' ? <HumanitarianReports feed={reports} country={country} onCountry={setCountry} /> :
      <AssessmentsView reportCountries={reportCountries} onReports={name => { setCountry(name); setView('reports'); }} />}
  </div>;
}

function AssessmentsView(props: { reportCountries: ReadonlySet<string>; onReports(country: string): void }) {
  return <SituationAssessments feed={usePublication(api.conflictAssessments)} {...props} />;
}
