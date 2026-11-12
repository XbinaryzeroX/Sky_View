import { describe, expect, it } from 'vitest';
import { createPlaceSearchIndex, placeSearchKey, searchPlaces, type SearchPlace } from '../src/renderer/lib/placeSearch';
import placesData from '../src/renderer/data/places.json';

const city = (name: string, admin: string, country: string, population: number, aliases: string[] = []): SearchPlace => [name, admin, country, 10, 180, population, aliases];
const fixture: SearchPlace[] = [
  city('Tokyo', 'Tokyo', 'Japan', 35_676_000, ['東京', 'Tōkyō', 'Tokyo']),
  city('São Paulo', 'São Paulo', 'Brazil', 18_845_000, ['Sao Paulo']),
  city('Ōsaka', 'Osaka', 'Japan', 11_294_000, ['Osaka', '大阪']),
  city('Osakarovka', 'Qaraghandy', 'Kazakhstan', 7_302),
  city('Montréal', 'Québec', 'Canada', 3_678_000, ['Montreal']),
  city('Dubai', 'Dubay', 'United Arab Emirates', 2_069_000, ['دبي', 'دُبي']),
  city('Paris', 'Île-de-France', 'France', 9_904_000),
  city('Paris', 'Texas', 'United States of America', 25_000),
  city('Washington,  D.C.', 'District of Columbia', 'United States of America', 4_338_000, ['Washington']),
  city('Springfield', 'Illinois', 'United States of America', 100_000),
  city('Springfield', 'Massachusetts', 'United States of America', 150_000),
];

describe('existing bundled place search index', () => {
  const index = createPlaceSearchIndex(fixture);
  it('matches case, Latin accents and canonical Unicode equivalence without changing displayed names or coordinates', () => {
    for (const query of ['São Paulo', 'Sa\u0303o Paulo', 'sao paulo', 'SÃO PAULO']) {
      const result = searchPlaces(index, query);
      expect(result).toHaveLength(1); expect(result[0].place).toBe(fixture[1]);
      expect(result[0].place.slice(0, 6)).toEqual(['São Paulo', 'São Paulo', 'Brazil', 10, 180, 18_845_000]);
    }
    expect(searchPlaces(index, 'Montre\u0301al')[0].place[0]).toBe('Montréal');
    expect(placeSearchKey('Łódź')).toBe('lodz');
  });

  it('preserves meaningful non-Latin marks and original matching publisher aliases, deduplicating each city', () => {
    expect(searchPlaces(index, '東京')).toMatchObject([{ place: fixture[0], matchedName: '東京', match: 'exact' }]);
    expect(searchPlaces(index, 'Tōkyō')).toHaveLength(1);
    expect(searchPlaces(index, 'دبي')[0].matchedName).toBe('دبي');
    expect(searchPlaces(index, 'دُبي')[0].matchedName).toBe('دُبي');
    expect(placeSearchKey('دُبي')).not.toBe(placeSearchKey('دبي'));
    expect(placeSearchKey('कि')).not.toBe(placeSearchKey('क'));
    expect(placeSearchKey('ά')).not.toBe(placeSearchKey('α'));
    expect(searchPlaces(index, 'to')).toHaveLength(1);
  });

  it('puts exact aliases before larger prefix matches and uses credible population with stable ties', () => {
    const exact = searchPlaces(index, 'Osaka');
    expect(exact.map(result => result.place[0])).toEqual(['Ōsaka', 'Osakarovka']);
    expect(exact[0].matchedName).toBe('Osaka'); expect(exact[0].match).toBe('exact');
    expect(searchPlaces(index, 'Paris').map(result => result.place[1])).toEqual(['Île-de-France', 'Texas']);
    const tied = createPlaceSearchIndex([city('Port Blue', 'A', 'A', 10), city('Port Green', 'B', 'B', 10)]);
    expect(searchPlaces(tied, 'Port').map(result => result.index)).toEqual([0, 1]);
  });

  it('uses comma-separated country/admin qualifiers, including publisher names containing a comma', () => {
    expect(searchPlaces(index, 'Paris, France').map(result => result.place[1])).toEqual(['Île-de-France']);
    expect(searchPlaces(index, 'paris, teXas, united states').map(result => result.place[1])).toEqual(['Texas']);
    expect(searchPlaces(index, 'Montréal, Quebec, Canada')[0].place[0]).toBe('Montréal');
    expect(searchPlaces(index, 'Washington, D.C.')[0].place[0]).toBe('Washington,  D.C.');
    expect(searchPlaces(index, 'Washington, D.C., United States')[0].place[0]).toBe('Washington,  D.C.');
    expect(searchPlaces(index, 'Springfield, Mass')[0].place[1]).toBe('Massachusetts');
    expect(searchPlaces(index, 'Paris, Japan')).toEqual([]);
    expect(searchPlaces(index, 'Paris,,France')).toEqual([]);
  });

  it('bounds output and tolerates an older catalog without aliases, preserving all original row identities', () => {
    const legacy = fixture.map(place => place.slice(0, 6) as unknown as SearchPlace);
    const oldIndex = createPlaceSearchIndex(legacy);
    expect(searchPlaces(oldIndex, 'Osaka')[0].place).toBe(legacy[2]);
    expect(searchPlaces(index, 's', 1)).toHaveLength(1);
    expect(searchPlaces(index, 's', 0)).toEqual([]);
    expect(searchPlaces(index, '')).toEqual([]);
    expect(searchPlaces(index, ',')).toEqual([]);
    expect(searchPlaces(index, 'not a catalog city')).toEqual([]);
  });

  it('repairs actual bundled São Paulo/Montréal normalization and Osaka prefix priority without an alias refresh', () => {
    const actual = createPlaceSearchIndex(placesData.places.map(place => place.slice(0, 6)) as unknown as SearchPlace[]);
    expect(searchPlaces(actual, 'Sa\u0303o Paulo')[0].place[0]).toBe('São Paulo');
    expect(searchPlaces(actual, 'Montre\u0301al')[0].place[0]).toBe('Montréal');
    expect(searchPlaces(actual, 'Osaka')[0].place[0]).toBe('Ōsaka');
    expect(searchPlaces(actual, 'Tokyo, Japan')[0].place[2]).toBe('Japan');
  });

  it('uses final publisher-native aliases and distinguishes actual duplicate cities using country/admin qualifiers', () => {
    const actual = createPlaceSearchIndex(placesData.places as unknown as SearchPlace[]);
    for (const [query, name, country] of [['東京', 'Tokyo', 'Japan'], ['دبي', 'Dubai', 'United Arab Emirates'], ['北京', 'Beijing', 'China'], ['Москва', 'Moscow', 'Russia'], ['München', 'Munich', 'Germany'], ['Bombay', 'Mumbai', 'India']]) {
      const match = searchPlaces(actual, query)[0];
      expect(match.place[0]).toBe(name); expect(match.place[2]).toBe(country); expect(match.matchedName).toBe(query);
    }
    expect(searchPlaces(actual, 'London, Ontario, Canada')[0].place.slice(0, 3)).toEqual(['London', 'Ontario', 'Canada']);
    expect(searchPlaces(actual, 'Springfield, Illinois')[0].place.slice(0, 3)).toEqual(['Springfield', 'Illinois', 'United States of America']);
    expect(searchPlaces(actual, 'Victoria, Seychelles')[0].place[2]).toBe('Seychelles');
    // The catalog does not include every city; qualifiers must not invent one.
    expect(searchPlaces(actual, 'Paris, Texas')).toEqual([]);
  });
});
