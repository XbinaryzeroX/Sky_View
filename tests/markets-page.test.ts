import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArticlePreviews, MarketsPage } from '../src/renderer/components/MarketsPage';
import type { PageCtx } from '../src/renderer/components/Pages';
import type { Headline } from '../src/shared/markets';

vi.mock('../src/renderer/lib/api', () => ({ api: {}, errorText: String }));

const seenAt = '2026-11-11T12:00:00Z';
const story: Headline = { title: 'First quarter results', url: 'https://news.example/story', domain: 'news.example', seenAt,
  summary: 'The publisher reports a <strong>rise</strong> in revenue.' };
const render = (articles: Headline[]) => renderToStaticMarkup(createElement(ArticlePreviews, {
  news: { articles, fetchedAt: seenAt, source: 'Example news feed' },
}));

describe('Markets page and article previews', () => {
  it('opens the public ranking first without a saved symbol or quote-provider setup', () => {
    const html = renderToStaticMarkup(createElement(MarketsPage, { ctx: {} as PageCtx }));
    expect(html).toContain('Most active U.S. stocks');
    expect(html).toContain('Ranked by shares traded');
    expect(html).not.toContain('Search symbols');
    expect(html).not.toContain('Open Providers');
  });

  it('shows the publisher preview as plain text before the external link, with source and timestamp', () => {
    const html = render([story]);
    expect(html).toContain('Example news feed');
    expect(html).toContain('news.example');
    expect(html).toContain(seenAt);
    const preview = html.indexOf('a &lt;strong&gt;rise&lt;/strong&gt; in revenue');
    expect(preview).toBeGreaterThan(0);
    expect(html.indexOf('href="https://news.example/story"')).toBeGreaterThan(preview);
  });

  it('distinguishes a headline-only feed item from a feed with no stories', () => {
    expect(render([{ ...story, summary: null }])).toContain('The source supplied a headline only.');
    expect(render([])).toContain('No recent stories returned');
    expect(render([])).not.toContain('Read article');
  });
});
