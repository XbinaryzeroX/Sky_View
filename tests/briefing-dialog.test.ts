import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BriefingDialog, briefingPreviewNodes, createBriefingPreviewLoader } from '../src/renderer/components/BriefingDialog';
import { api } from '../src/renderer/lib/api';
import type { BriefingPreview, BriefingRequest } from '../src/shared/briefing';
import { loc } from './helpers';

vi.mock('../src/renderer/lib/api', () => ({
  api: { previewBriefing: vi.fn(), exportBriefing: vi.fn(), openExternal: vi.fn(async () => true) },
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

const preview = (mode: 'locations' | 'visit' = 'visit'): BriefingPreview => ({ mode, previewId: 'token', html: '<body><h1>Title</h1></body>', generatedAt: '2026-11-11T14:02:00.789Z', exportPolicy: 'frozen', locationCount: mode === 'visit' ? 0 : 1, byteLength: 100 });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('briefing preview mode, retry and lifecycle requests', () => {
  it('coalesces rapid mode and selection changes with one request in flight and discards old success', async () => {
    const first = deferred<BriefingPreview>(), latest = deferred<BriefingPreview>();
    let active = 0, max = 0;
    const read = vi.fn(async (request: BriefingRequest) => {
      active++; max = Math.max(max, active);
      try { return await (request.mode === 'locations' ? first.promise : latest.promise); } finally { active--; }
    });
    const ready = vi.fn(), failed = vi.fn(), pending = vi.fn();
    const loader = createBriefingPreviewLoader({ read, ready, failed, pending });
    loader.load({ mode: 'locations', locationIds: ['a'] }, 'one');
    loader.load({ mode: 'locations', locationIds: ['a', 'b'] }, 'two');
    loader.load({ mode: 'visit' }, 'visit');
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve(preview('locations')); await settle();
    expect(read.mock.calls).toEqual([[{ mode: 'locations', locationIds: ['a'] }], [{ mode: 'visit' }]]);
    expect(ready).not.toHaveBeenCalled();
    latest.resolve(preview()); await settle();
    expect(ready).toHaveBeenCalledExactlyOnceWith(preview(), 'visit');
    expect(failed).not.toHaveBeenCalled(); expect(max).toBe(1);
    expect(pending.mock.calls).toEqual([['one'], ['two'], ['visit']]);
  });

  it('discards stale failures, permits identical-key retries and never publishes after closing', async () => {
    const first = deferred<BriefingPreview>(), retry = deferred<BriefingPreview>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const ready = vi.fn(), failed = vi.fn();
    const loader = createBriefingPreviewLoader({ read, ready, failed, pending: vi.fn() });
    loader.load({ mode: 'visit' }, 'same');
    loader.cancel(); loader.load({ mode: 'visit' }, 'same');
    first.reject(new Error('Old failure')); await settle();
    expect(failed).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2);
    loader.dispose(); retry.resolve(preview()); await settle();
    expect(ready).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    loader.load({ mode: 'visit' }, 'closed'); expect(read).toHaveBeenCalledTimes(2);
  });

  it('shows only the current error and a following retry can succeed', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('Current failure')).mockResolvedValueOnce(preview());
    const ready = vi.fn(), failed = vi.fn();
    const loader = createBriefingPreviewLoader({ read, ready, failed, pending: vi.fn() });
    loader.load({ mode: 'visit' }, 'same'); await settle();
    expect(failed.mock.calls[0][0]).toEqual(new Error('Current failure'));
    loader.load({ mode: 'visit' }, 'same'); await settle();
    expect(ready).toHaveBeenCalledExactlyOnceWith(preview(), 'same');
  });

  it('defaults to visit without places, retains location default and honors an explicit Analyst mode', () => {
    const render = (locations: ReturnType<typeof loc>[], initialMode?: 'visit' | 'locations') => renderToStaticMarkup(createElement(BriefingDialog, { locations, initial: [], initialMode, onClose: vi.fn() }));
    expect(render([])).toContain('aria-label="Since last visit briefing"');
    expect(render([loc()])).toContain('aria-label="Location briefing"');
    expect(render([loc()], 'visit')).toContain('aria-label="Since last visit briefing"');
    expect(render([], 'locations')).toContain('aria-label="Location briefing"');
    expect(render([])).toContain('Loading briefing preview…');
    expect(render([])).toContain('disabled="">Export HTML…');
  });
});

function text(value: string): Node { return { nodeType: 3, textContent: value } as Node; }
function element(tagName: string, attributes: Record<string, string> = {}, children: Node[] = []): Node {
  return { nodeType: 1, tagName, getAttribute: (key: string) => attributes[key] ?? null, childNodes: children } as unknown as Node;
}
function parser(nodes: Iterable<Node>) {
  return { parseFromString: vi.fn(() => ({ body: { childNodes: nodes } }) as unknown as Document) };
}

describe('visible briefing document semantics', () => {
  it('copies printable semantics without raw HTML, handlers, styles, arbitrary classes or unsafe URLs', async () => {
    const open = vi.mocked(api.openExternal); open.mockResolvedValue(true);
    const parse = parser([
      element('H1', { onclick: 'steal()', style: 'color:red', class: 'muted arbitrary' }, [text('<script>text only</script>')]),
      element('A', { href: 'javascript:steal()' }, [text('Unsafe destination')]),
      element('A', { href: 'https://api.weather.gov/alerts/source' }, [text('Publisher source')]),
      element('SCRIPT', {}, [text('must not appear')]),
      element('TD', { colspan: '3', rowspan: '200', 'data-secret': 'none' }, [text('Cell')]),
    ]);
    const errors = vi.fn(), result = briefingPreviewNodes('<body><h1>Fixed template</h1></body>', errors, parse);
    const markup = renderToStaticMarkup(createElement('div', {}, result.nodes));
    expect(markup).toContain('&lt;script&gt;text only&lt;/script&gt;');
    expect(markup).toContain('class="muted"'); expect(markup).not.toMatch(/onclick|style=|arbitrary|javascript:|must not appear|rowspan|data-secret/);
    expect(markup).toContain('colSpan="3"');
    expect(markup).toContain('<span>Unsafe destination</span>');
    const anchor = result.nodes[2] as ReactElement<{ onClick(event: { preventDefault(): void }): void }>;
    const preventDefault = vi.fn(); anchor.props.onClick({ preventDefault }); await settle();
    expect(preventDefault).toHaveBeenCalledOnce(); expect(open).toHaveBeenLastCalledWith('https://api.weather.gov/alerts/source');
    open.mockResolvedValueOnce(false); anchor.props.onClick({ preventDefault }); await settle();
    expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('blocked'));
    expect(result.truncated).toBe(false);
    const keys = result.nodes.filter(isValidElement).map(value => value.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects resource elements before invoking the inert parser and never parses the document head', () => {
    const parse = parser([]);
    for (const resource of ['<img src="https://evil.example/x">', '<iframe src="https://evil.example">', '<script>bad()</script>', '<svg><image href="https://evil.example"/></svg>'])
      expect(() => briefingPreviewNodes(`<body>${resource}</body>`, vi.fn(), parse)).toThrow('Unsupported briefing content');
    expect(parse.parseFromString).not.toHaveBeenCalled();
    briefingPreviewNodes('<html><head><style>body{color:blue}</style></head><body><p>Printable body</p></body></html>', vi.fn(), parse);
    expect(parse.parseFromString).toHaveBeenCalledExactlyOnceWith('<p>Printable body</p>', 'text/html');
  });

  it('stops sibling traversal at its node budget and does not silently include the rest', () => {
    let visited = 0;
    const nodes = { *[Symbol.iterator]() { for (let i = 0; i < 100_000; i++) { visited++; yield text(`node${i}`); } } };
    const result = briefingPreviewNodes('<body><p>Template</p></body>', vi.fn(), parser(nodes));
    expect(result.truncated).toBe(true); expect(result.nodes).toHaveLength(20_000);
    expect(visited).toBeLessThanOrEqual(20_001);
  });
});
