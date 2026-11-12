import type { GeoRecord } from './layers';

export const CAMERA_BOARD_LIMITS = { cameras: 32, visible: 4, video: 2 } as const;

/** Existing local board document. Camera groups use the same SQLite documents as notes/watchlist boards. */
export interface BoardDocument {
  id: string;
  name: string;
  notes: string;
  items: { kind: string; id: string; label: string }[];
  createdAt: string;
}

export function boardCameraIds(board: BoardDocument): string[] {
  return [...new Set(board.items.filter((i) => i.kind === 'camera').map((i) => i.id))].slice(0, CAMERA_BOARD_LIMITS.cameras);
}

/** Pin references only. Catalog URLs and credentials are never copied into a board. */
export function pinBoardCameras(board: BoardDocument, cameras: Pick<GeoRecord, 'id' | 'label'>[]): BoardDocument {
  const known = new Set(boardCameraIds(board));
  const items = [...board.items];
  for (const camera of cameras) {
    if (known.size >= CAMERA_BOARD_LIMITS.cameras) break;
    if (!known.has(camera.id)) {
      known.add(camera.id);
      items.push({ kind: 'camera', id: camera.id, label: camera.label.slice(0, 80) });
    }
  }
  return { ...board, items };
}

/** Deterministic page/resource allocation. Non-video slots use publisher stills or an official-link/paused state. */
export function cameraBoardPage(ids: string[], records: GeoRecord[], page: number, preferredVideo: string[] = []): { ids: string[]; videoIds: string[]; pages: number } {
  const unique = [...new Set(ids)].slice(0, CAMERA_BOARD_LIMITS.cameras);
  const pages = Math.max(1, Math.ceil(unique.length / CAMERA_BOARD_LIMITS.visible));
  const index = Math.max(0, Math.min(pages - 1, Number.isFinite(page) ? Math.floor(page) : 0));
  const shown = unique.slice(index * CAMERA_BOARD_LIMITS.visible, (index + 1) * CAMERA_BOARD_LIMITS.visible);
  const byId = new Map(records.map((r) => [r.id, r]));
  const capable = shown.filter((id) => byId.get(id)?.props.mediaType === 'hls' && typeof byId.get(id)?.props.streamUrl === 'string' && !!byId.get(id)?.props.streamUrl);
  const videoIds = [...new Set([...preferredVideo.filter((id) => capable.includes(id)), ...capable])].slice(0, CAMERA_BOARD_LIMITS.video);
  return { ids: shown, videoIds, pages };
}
