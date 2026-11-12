import catalog from '../data/places.json';
import { createPlaceSearchIndex, searchPlaces, type SearchPlace } from './placeSearch';

export interface BundledSuggestion {
  key: string;
  label: string;
  detail: string;
  lat: number;
  lon: number;
  exact: boolean;
}

const index = createPlaceSearchIndex(catalog.places as unknown as SearchPlace[]);
self.onmessage = ({ data: query }: MessageEvent<string>) => {
  const matches: BundledSuggestion[] = searchPlaces(index, query).map(({ place, index, matchedName, match }) => {
    const [name, region, country, lat, lon] = place;
    const displayName = matchedName === name ? name : `${matchedName} (${name})`;
    return { key: `p-${index}`, label: displayName, detail: [region, country].filter(Boolean).join(', '), lat, lon, exact: match === 'exact' };
  });
  self.postMessage({ query, matches });
};
