/** Natural Earth row: the original six fields remain unchanged; aliases are optional. */
export type SearchPlace = readonly [name: string, admin1: string, country: string, lat: number, lon: number, population: number, aliases?: readonly string[]];

interface Entry { key: string; index: number; names: string[] }
export interface PlaceSearchIndex {
  readonly places: readonly SearchPlace[];
  readonly entries: readonly Entry[];
  readonly regions: readonly (readonly [string, string])[];
}
export interface PlaceSearchMatch {
  /** Original publisher row and spelling, never a folded display name or new position. */
  place: SearchPlace;
  index: number;
  matchedName: string;
  match: 'exact' | 'prefix';
}

const MARK = /\p{Mark}/u;
const LATIN = /\p{Script=Latin}/u;
const LATIN_LETTERS: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', þ: 'th', æ: 'ae', œ: 'oe', ß: 'ss', ı: 'i' };
const literal = (value: string) => value.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ');

/** Fold Latin accents only. Arabic, Indic and other scripts keep meaningful marks. */
export function placeSearchKey(value: string): string {
  let key = '', latinBase = false;
  for (const character of value.normalize('NFD').toLowerCase()) {
    if (MARK.test(character)) {
      if (!latinBase) key += character;
    } else {
      latinBase = LATIN.test(character);
      key += latinBase ? LATIN_LETTERS[character] ?? character : character;
    }
  }
  return key.trim().replace(/\s+/gu, ' ').replace(/\s*,\s*/gu, ', ');
}

/** Build once per bundled catalog, rather than normalizing every city on each keystroke. */
export function createPlaceSearchIndex(places: readonly SearchPlace[]): PlaceSearchIndex {
  const entries: Entry[] = [];
  const regions = places.map(place => [placeSearchKey(place[1]), placeSearchKey(place[2])] as const);
  places.forEach((place, index) => {
    const byKey = new Map<string, Entry>(), seen = new Set<string>();
    for (const name of [place[0], ...(place[6] ?? [])]) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const spelling = literal(name);
      if (seen.has(spelling)) continue;
      seen.add(spelling);
      const key = placeSearchKey(name);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) existing.names.push(name);
      else byKey.set(key, { key, index, names: [name] });
    }
    entries.push(...byKey.values());
  });
  entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index);
  return { places, entries, regions };
}

function lowerBound(entries: readonly Entry[], key: string): number {
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].key < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

interface Candidate extends PlaceSearchMatch { spellingRank: number }

/** Exact names/aliases precede prefixes; population then publisher row order break ties. */
export function searchPlaces(index: PlaceSearchIndex, query: string, limit = 8): PlaceSearchMatch[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const maximum = Math.min(50, Math.floor(limit));
  const parts = query.split(',').map(part => part.trim());
  if (!parts[0] || parts.some(part => !part)) return [];
  // Also try the complete name: some publisher names contain a comma themselves.
  const plans = [{ name: parts.join(', '), regions: [] as string[] }];
  for (let split = Math.max(1, parts.length - 2); split < parts.length; split++)
    plans.push({ name: parts.slice(0, split).join(', '), regions: parts.slice(split).map(placeSearchKey) });
  const candidates = new Map<number, Candidate>();
  for (const plan of plans) {
    const key = placeSearchKey(plan.name), nameLiteral = literal(plan.name);
    if (!key) continue;
    for (let at = lowerBound(index.entries, key); at < index.entries.length && index.entries[at].key.startsWith(key); at++) {
      const entry = index.entries[at];
      if (!plan.regions.every(region => index.regions[entry.index].some(value => value.startsWith(region)))) continue;
      const match = entry.key === key ? 'exact' : 'prefix';
      // Prefer the spelling the user actually typed when several originals share
      // one Latin-folded key, then the canonical name before equivalent aliases.
      const ranked = entry.names.map((name, order) => ({ name, order, rank: literal(name) === nameLiteral ? 0 : literal(name).startsWith(nameLiteral) ? 1 : 2 }));
      ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
      const best = ranked[0];
      const candidate: Candidate = { place: index.places[entry.index], index: entry.index, matchedName: best.name, match, spellingRank: best.rank };
      const previous = candidates.get(entry.index);
      if (!previous || (previous.match === 'prefix' && match === 'exact') || (previous.match === match && best.rank < previous.spellingRank)) candidates.set(entry.index, candidate);
    }
  }
  const population = (place: SearchPlace) => Number.isFinite(place[5]) ? place[5] : -Infinity;
  return [...candidates.values()].sort((a, b) => Number(a.match === 'prefix') - Number(b.match === 'prefix') || population(b.place) - population(a.place) || a.index - b.index)
    .slice(0, maximum).map(({ spellingRank: _rank, ...match }) => match);
}
