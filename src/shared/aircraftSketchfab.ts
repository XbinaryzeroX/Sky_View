import pages from './aircraftSketchfabReferences.json';

/** Public, type-specific Sketchfab model pages checked against their publisher metadata. */
export interface AircraftSketchfabReference {
  title: string;
  author: string;
  url: string;
  publisher: 'aviation organization' | 'community' | 'manufacturer';
}

// Keys are reviewed ICAO type codes, including public pages whose geometry cannot be downloaded.
const references: Readonly<Record<string, { page: string; title: string; author: string }>> = pages;

export function aircraftSketchfabReference(typeCode: string | null | undefined): AircraftSketchfabReference | null {
  const code = typeCode?.trim().toUpperCase();
  const reference = code && Object.hasOwn(references, code) ? references[code] : null;
  if (!reference) return null;
  const { title, author, page } = reference;
  return { title, author, url: `https://sketchfab.com/3d-models/${page}`, publisher: author === 'NATS' ? 'aviation organization' : 'community' };
}

/** A click opens a search for the aircraft type only. */
export function aircraftSketchfabSearchUrl(typeName: string): string {
  const url = new URL('https://sketchfab.com/search');
  url.searchParams.set('type', 'models');
  url.searchParams.set('q', typeName.trim().slice(0, 100));
  return url.href;
}
