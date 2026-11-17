import { describe, expect, it } from 'vitest';
import { aircraftClass, DEFAULT_AIRCRAFT_FILTER, isFighterType, passesFilter } from '../src/shared/aircraft';
import type { GeoRecord } from '../src/shared/layers';

describe('label size by zoom', () => {
  it('draws countries largest when zoomed out and cities and towns larger as you approach them', async () => {
    const { zoomScale } = await import('../src/renderer/map/placeLabels');
    expect(zoomScale('country', 2)).toBeGreaterThan(zoomScale('country', 7));
    expect(zoomScale('city', 11)).toBeGreaterThan(zoomScale('city', 5));
    expect(zoomScale('town', 13)).toBeGreaterThan(zoomScale('town', 9));
    expect(zoomScale('state', 6)).toBeGreaterThan(zoomScale('state', 4));
    // Flat beyond the ends of each ramp, and continuous between stops.
    expect(zoomScale('country', 0)).toBe(zoomScale('country', 2));
    expect(zoomScale('road', 30)).toBe(zoomScale('road', 18));
    expect(Math.abs(zoomScale('city', 8.001) - zoomScale('city', 7.999))).toBeLessThan(0.01);
  });

  it('never scales a label above its largest stop (text is drawn at that size and only scaled down)', async () => {
    const { zoomScale, ZOOM_SCALE } = await import('../src/renderer/map/placeLabels');
    for (const [kind, stops] of Object.entries(ZOOM_SCALE)) {
      const max = Math.max(...stops.map((s) => s[1]));
      for (let z = 0; z <= 20; z += 0.5) expect(zoomScale(kind as keyof typeof ZOOM_SCALE, z)).toBeLessThanOrEqual(max + 1e-9);
    }
  });
});

describe('street names', () => {
  it('run along the street and stay upright', async () => {
    const { uprightAngle } = await import('../src/renderer/map/placeLabels');
    expect(uprightAngle(1, 0)).toBeCloseTo(0);
    expect(uprightAngle(-1, 0)).toBeCloseTo(0); // a westbound street still reads left to right
    expect(uprightAngle(1, -1)).toBeCloseTo(Math.PI / 4); // rising to the right on screen (y down)
    expect(uprightAngle(-1, 1)).toBeCloseTo(Math.PI / 4);
    expect(Math.abs(uprightAngle(0, 1))).toBeCloseTo(Math.PI / 2);
  });

  it('places one name on a short street and three on a long one, each with a direction', async () => {
    const { streetLabelPoints } = await import('../src/renderer/map/placeLabels');
    const short = streetLabelPoints([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    expect(short).toHaveLength(1);
    expect(short[0].at).toEqual({ x: 150, y: 0 });
    const long = streetLabelPoints([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }]);
    expect(long).toHaveLength(3);
    expect(long[0].at).toEqual({ x: 400, y: 0 });
    expect(long[2].at.x).toBe(1000);
    expect(long[2].next).toEqual({ x: 1000, y: 1000 });
    expect(streetLabelPoints([{ x: 5, y: 5 }, { x: 5, y: 5 }])).toEqual([]);
  });
});

describe('fighter jets', () => {
  const rec = (props: Record<string, unknown>): GeoRecord => ({ id: 'x', lat: 0, lon: 0, altM: 3000, heading: 0, speedKts: 400, label: 'X', category: null, observedAt: new Date().toISOString(), sourceUrl: null, source: 'test', props: { altitudeFt: 10000, ...props } }) as GeoRecord;

  it('are recognised by their reported type designator, with or without the military flag', () => {
    expect(isFighterType('F16')).toBe(true);
    expect(isFighterType(' eufi ')).toBe(true);
    expect(isFighterType('B738')).toBe(false);
    expect(isFighterType(null)).toBe(false);
    expect(aircraftClass(rec({ type: 'F35', militaryFlag: true }))).toBe('fighter');
    expect(aircraftClass(rec({ type: 'F35', militaryFlag: false }))).toBe('fighter');
    expect(aircraftClass(rec({ type: 'C17', militaryFlag: true }))).toBe('military');
  });

  it('can be shown on their own', () => {
    const onlyFighters = { ...DEFAULT_AIRCRAFT_FILTER, classes: ['fighter' as const] };
    expect(passesFilter(rec({ type: 'RFAL', militaryFlag: true }), onlyFighters)).toBe(true);
    expect(passesFilter(rec({ type: 'K35R', militaryFlag: true }), onlyFighters)).toBe(false);
    expect(passesFilter(rec({ type: 'RFAL' }), DEFAULT_AIRCRAFT_FILTER)).toBe(true);
  });
});
