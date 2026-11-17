// Placement of floating camera cards over the map: which on-screen cameras get a picture card and which get only a
// small tag, and where each card sits so cards do not cover each other. Pure screen geometry; no map or DOM code.

export interface ScreenCamera {
  id: string;
  x: number;
  y: number;
  hasImage: boolean;
  /** Straight-line distance from the viewer to the camera, in metres. */
  distM: number;
}

export interface PlacedCard {
  id: string;
  /** Top-left corner of the card. */
  left: number;
  top: number;
  /** The camera's own screen point the leader lines run to. */
  x: number;
  y: number;
}

export const CARD_W = 216;
export const CARD_H = 150;
/** A camera gets a picture card only when the viewer is this close to it (street scale); tags show out to TAG_MAX_DISTANCE_M. */
export const CARD_MAX_DISTANCE_M = 900;
export const TAG_MAX_DISTANCE_M = 4_000;
export const MAX_CARDS = 3;
export const MAX_TAGS = 30;
/** Shortest wait between two manual "next frame" requests for one camera. */
export const NEXT_FRAME_COOLDOWN_MS = 3_000;
/** Height of the leader line between the card and its camera's point on the street. */
const GAP = 40;
const MARGIN = 8;

/** Short tag shown next to a camera, built from its record id (never from coordinates). */
export function cameraTag(id: string): string {
  const tail = id.replace(/[^A-Za-z0-9]/g, '').slice(-5).toUpperCase();
  return `CAM-${tail || '?'}`;
}

function overlaps(a: { left: number; top: number }, b: { left: number; top: number }): boolean {
  return a.left < b.left + CARD_W + 6 && b.left < a.left + CARD_W + 6 && a.top < b.top + CARD_H + 6 && b.top < a.top + CARD_H + 6;
}

/**
 * The closest cameras (within CARD_MAX_DISTANCE_M) that publish an image get a card, up to `max`. A card always sits
 * directly above its camera's point on the street, joined by a short vertical line, so it moves with the street and
 * never jumps to another side. Cameras that already had a card keep it while they still qualify. A card that would
 * leave the screen, cover another card or cover a panel is not drawn; that camera stays a tag.
 */
export function placeCameraCards(cams: ScreenCamera[], width: number, height: number, max = MAX_CARDS, reserved: { left: number; top: number; right: number; bottom: number }[] = [], previous: ReadonlySet<string> = new Set()): { cards: PlacedCard[]; tags: ScreenCamera[] } {
  const onScreen = cams.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.x >= 0 && c.y >= 0 && c.x <= width && c.y <= height && c.distM <= TAG_MAX_DISTANCE_M);
  const cx = width / 2, cy = height / 2;
  const clearOfPanels = onScreen.filter((c) => !reserved.some((r) => c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom));
  const ordered = [...clearOfPanels].sort((a, b) => a.distM - b.distM || (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2) || (a.id < b.id ? -1 : 1));
  const candidates = [...ordered.filter((c) => previous.has(c.id)), ...ordered.filter((c) => !previous.has(c.id))];
  const cards: PlacedCard[] = [];
  const hitsReserved = (s: { left: number; top: number }) => reserved.some((r) => s.left < r.right && r.left < s.left + CARD_W && s.top < r.bottom && r.top < s.top + CARD_H);
  for (const c of candidates) {
    if (cards.length >= max) break;
    if (!c.hasImage || c.distM > CARD_MAX_DISTANCE_M) continue;
    const spot = { left: c.x - CARD_W / 2, top: c.y - GAP - CARD_H };
    const fits = spot.left >= MARGIN && spot.top >= MARGIN && spot.left + CARD_W <= width - MARGIN && spot.top + CARD_H <= height - MARGIN
      && !cards.some((o) => overlaps(o, spot)) && !hitsReserved(spot);
    if (fits) cards.push({ id: c.id, left: Math.round(spot.left), top: Math.round(spot.top), x: c.x, y: c.y });
  }
  const carded = new Set(cards.map((c) => c.id));
  return { cards, tags: ordered.filter((c) => !carded.has(c.id)).slice(0, MAX_TAGS) };
}
