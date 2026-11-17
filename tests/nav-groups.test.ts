import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/renderer/lib/api', () => ({ api: {}, errorText: (e: unknown) => String(e) }));

describe('navigation groups', () => {
  it('every page sits in one feature group or the settings-and-help cluster, in group order', async () => {
    const { NAV, NAV_GROUPS, NAV_UTILITY_GROUP } = await import('../src/renderer/components/Pages');
    const groups: string[] = [...NAV_GROUPS, NAV_UTILITY_GROUP];
    for (const n of NAV) expect(groups, n.id).toContain(n.group);
    // Items of a group are contiguous and groups appear in priority order.
    const order = NAV.map((n) => groups.indexOf(n.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(NAV[0].id).toBe('globe');
    expect(new Set(NAV.map((n) => n.id)).size).toBe(NAV.length);
    // Settings-type entries are not mixed into the feature groups.
    expect(NAV.filter((n) => n.group === NAV_UTILITY_GROUP).map((n) => n.id)).toEqual(['help']);
  });
});
