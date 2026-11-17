// ATC listening suggestions (nearest airports, LiveATC links) and the simulated-traffic plan for traffic-flow roads.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { likelyAtcTypes, liveAtcUrl, nearestAtc, type AtcAirport, type AtcFrequency } from '../src/shared/atc';
import { initialOffsets, lineLengthM, segmentAt, simPlan, simRoad } from '../src/shared/trafficSim';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import type { GeoRecord } from '../src/shared/layers';
import freqData from '../src/renderer/data/airportFrequencies.json';
import { AIRPORTS } from '../src/renderer/data/airports';

vi.mock('../src/renderer/lib/api', () => ({ api: { openExternal: vi.fn(async () => true) } }));

const FREQS = (freqData as unknown as { frequencies: Record<string, AtcFrequency[]> }).frequencies;

describe('ATC radio suggestions', () => {
  it('suggests JFK first for an aircraft on approach, with its published tower frequency', () => {
    const near = nearestAtc(40.66, -73.70, AIRPORTS, FREQS);
    expect(near[0].icao).toBe('KJFK');
    expect(near[0].frequencies.some(([t, , mhz]) => t === 'TWR' && mhz === 119.1)).toBe(true);
    expect(near[0].liveAtcUrl).toBe('https://www.liveatc.net/search/?icao=KJFK');
    expect(near.length).toBeLessThanOrEqual(3);
  });
  it('builds LiveATC links only for four-letter ICAO codes', () => {
    expect(liveAtcUrl('EGLL')).toBe('https://www.liveatc.net/search/?icao=EGLL');
    expect(liveAtcUrl('00CA')).toBeNull();
    expect(liveAtcUrl('KJFK&x=1')).toBeNull();
    expect(isAllowedExternalUrl(liveAtcUrl('KJFK')!)).toBe(true);
  });
  it('finds airports across the date line and returns nothing for an impossible position or open ocean', () => {
    const airports: AtcAirport[] = [['NZXX', '', 'East side', -16.5, 179.95, 10, 'FJ', '', 'M'], ['NZYY', '', 'Far', -16.5, 170, 10, 'FJ', '', 'M']];
    const f = { NZXX: [['TWR', 'TWR', 118.1]] as AtcFrequency[], NZYY: [['TWR', 'TWR', 118.2]] as AtcFrequency[] };
    expect(nearestAtc(-16.5, -179.95, airports, f).map((s) => s.icao)).toEqual(['NZXX']);
    expect(nearestAtc(Number.NaN, 0, airports, f)).toEqual([]);
    expect(nearestAtc(89.9, 0, airports, f)).toEqual([]);
    expect(nearestAtc(0, -30, AIRPORTS, FREQS)).toEqual([]);
  });
  it('only hints at likely frequencies from height, and gives none for cruise or unknown altitude', () => {
    expect(likelyAtcTypes(null, true, 13, 2)).toContain('GND');
    expect(likelyAtcTypes(600, false, 13, 8)).toContain('TWR');
    expect(likelyAtcTypes(3000, false, 13, 40)).toEqual(['APP', 'DEP']);
    expect(likelyAtcTypes(11000, false, 13, 40)).toEqual([]);
    expect(likelyAtcTypes(null, false, 13, 5)).toEqual([]);
  });
  it('keeps only VHF air-traffic frequencies in the generated catalog', () => {
    const all = Object.values(FREQS).flat();
    expect(all.length).toBeGreaterThan(5000);
    expect(all.every(([t, , mhz]) => ['TWR', 'GND', 'APP', 'DEP', 'CLD', 'ATIS', 'CTAF', 'A/D', 'AFIS'].includes(t) && mhz >= 108 && mhz <= 137)).toBe(true);
  });
  it('renders a listen button and the "not confirmed" wording in aircraft details', async () => {
    const { AtcListen } = await import('../src/renderer/components/AtcListen');
    const rec: GeoRecord = { id: 'a1b2c3', lat: 40.66, lon: -73.7, altM: 600, heading: 220, speedKts: 150, label: 'DAL123', category: null, observedAt: null, sourceUrl: null, source: 'adsb.lol', props: {}, geometry: null };
    const html = renderToStaticMarkup(createElement(AtcListen, { record: rec }));
    expect(html).toContain('Listen to KJFK on LiveATC');
    expect(html).toContain('not a confirmed link to this flight');
    expect(html).toContain('likely now');
    expect(html).not.toMatch(/<audio|<video|\.mp3|\.pls/);
  });
});

const road = (id: string, category: string, coords: [number, number][], props: GeoRecord['props']): GeoRecord => ({
  id, lat: coords[0][1], lon: coords[0][0], altM: null, heading: null, speedKts: null, label: id, category, observedAt: null, sourceUrl: null, source: 'test', props,
  geometry: { type: 'LineString', coordinates: coords },
});
// About 1.11 km due north.
const KM: [number, number][] = [[2.35, 48.85], [2.35, 48.86]];

describe('simulated traffic plan', () => {
  it('uses the measured speed, and an assumed density when no flow count is published (New York)', () => {
    const r = simRoad(road('nyc:1', 'heavy', KM, { speedKmh: 30 }))!;
    expect(r.speedMps).toBeCloseTo(30 / 3.6, 5);
    expect(r.speedBasis).toBe('measured');
    expect(r.densityBasis).toBe('assumed for the state');
    expect(r.vehicles).toBe(Math.round(60 * lineLengthM(KM) / 1000));
  });
  it('derives density from the published flow and an assumed speed for the state (Paris)', () => {
    const r = simRoad(road('paris:1', 'free', KM, { vehiclesPerHour: 700 }))!;
    expect(r.speedBasis).toBe('assumed from published state');
    expect(r.densityBasis).toBe('from measured flow');
    expect(r.vehicles).toBe(Math.round((700 / 35) * lineLengthM(KM) / 1000)); // 20 per km
  });
  it('adds no dots to roads with unknown state or without a road shape', () => {
    expect(simRoad(road('nyc:2', 'unknown', KM, { speedKmh: null }))).toBeNull();
    expect(simRoad({ ...road('fi:1', 'free', KM, {}), geometry: null })).toBeNull();
  });
  it('keeps a stopped road with a measured speed of zero still, without dividing by zero', () => {
    const r = simRoad(road('nyc:3', 'stopped', KM, { speedKmh: 0, vehiclesPerHour: 400 }))!;
    expect(r.speedMps).toBe(0);
    expect(Number.isFinite(r.vehicles)).toBe(true);
    expect(r.vehicles).toBeLessThanOrEqual(Math.round(150 * lineLengthM(KM) / 1000));
  });
  it('thins evenly past the dot budget and says how many vehicles each dot stands for', () => {
    const roads = Array.from({ length: 50 }, (_, i) => road(`r${i}`, 'stopped', KM, { speedKmh: 5 }));
    const plan = simPlan(roads, 1000);
    expect(plan.vehicles).toBeGreaterThan(1000);
    expect(plan.dots).toBeLessThanOrEqual(1050);
    expect(plan.vehiclesPerDot).toBeGreaterThan(1);
    expect(simPlan(roads.slice(0, 1), 1000).vehiclesPerDot).toBe(1);
  });
  it('measures lengths across the date line and places stable starting offsets', () => {
    expect(lineLengthM([[179.99, 0], [-179.99, 0]])).toBeLessThan(3000);
    const a = initialOffsets('nyc:9', 10, 1000);
    expect(a).toEqual(initialOffsets('nyc:9', 10, 1000));
    expect(a.every((s, i) => s >= 0 && s < 1000 && (i === 0 || s > a[i - 1]))).toBe(true);
    expect(segmentAt([0, 10, 25, 40], 12)).toBe(1);
    expect(segmentAt([0, 10, 25, 40], 0)).toBe(0);
    expect(segmentAt([0, 10, 25, 40], 39.9)).toBe(2);
  });
});
