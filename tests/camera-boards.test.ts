import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AtlasStore } from '../src/main/store';
import { boardCameraIds, CAMERA_BOARD_LIMITS, cameraBoardPage, pinBoardCameras, type BoardDocument } from '../src/shared/cameraBoards';
import type { GeoRecord } from '../src/shared/layers';
import { tempDbPath } from './helpers';

const fixture = (): BoardDocument => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'camera-board.json'), 'utf8'));
const camera = (i: number, mediaType = 'hls'): GeoRecord => ({ id: `camera-${i}`, label: `Camera ${i}`, lat: 0, lon: 179,
  altM: null, speedKts: null, heading: null, category: null, observedAt: null, source: 'test fixture', sourceUrl: 'https://camera.example/',
  imageUrl: mediaType === 'viewer' ? null : 'https://camera.example/image.jpg', props: { mediaType, streamUrl: mediaType === 'hls' ? 'https://camera.example/stream.m3u8' : null } });

describe('camera references on existing local boards', () => {
  it('preserves notes and watchlist pins, deduplicates only camera references, and stores no media URLs', () => {
    const before = fixture();
    const result = pinBoardCameras(before, [camera(1), camera(1), camera(2)]);
    expect(result.notes).toBe(before.notes);
    expect(result.items.slice(0, 2)).toEqual(before.items);
    expect(boardCameraIds(result)).toEqual(['camera-1', 'camera-2']);
    expect(result.items.filter((i) => i.kind === 'camera')).toEqual([
      { kind: 'camera', id: 'camera-1', label: 'Camera 1' }, { kind: 'camera', id: 'camera-2', label: 'Camera 2' },
    ]);
    expect(JSON.stringify(result)).not.toContain('https://');
    expect(before.items).toHaveLength(2);
  });

  it('bounds a large group without dropping unrelated saved items', () => {
    const result = pinBoardCameras(fixture(), Array.from({ length: 500 }, (_, i) => camera(i)));
    expect(boardCameraIds(result)).toHaveLength(CAMERA_BOARD_LIMITS.cameras);
    expect(result.items.filter((i) => i.kind !== 'camera')).toEqual(fixture().items);
  });

  it('persists mixed camera/watchlist boards and Unicode names through the existing SQLite documents', () => {
    const path = tempDbPath();
    const first = new AtlasStore(path);
    const board = pinBoardCameras(fixture(), [camera(1), camera(2, 'viewer')]);
    first.putDoc('boards', board.id, board, board.createdAt);
    first.close();
    const reopened = new AtlasStore(path);
    expect(reopened.listDocs<BoardDocument>('boards')).toEqual([board]);
    reopened.close();
  });
});

describe('camera board resource allocation', () => {
  it('never allocates more than four cards or two video streams, even with duplicates and a huge favorites list', () => {
    const records = Array.from({ length: 500 }, (_, i) => camera(i));
    const ids = records.flatMap((r) => [r.id, r.id]);
    for (let page = 0; page < 50; page++) {
      const plan = cameraBoardPage(ids, records, page);
      expect(plan.ids.length).toBeLessThanOrEqual(4);
      expect(plan.videoIds.length).toBeLessThanOrEqual(2);
      expect(new Set(plan.ids).size).toBe(plan.ids.length);
      expect(plan.videoIds.every((id) => plan.ids.includes(id))).toBe(true);
      expect(plan.pages).toBe(8);
    }
  });

  it('lets a user promote a video within the page without allocating a third stream', () => {
    const records = [0, 1, 2, 3].map((i) => camera(i));
    const plan = cameraBoardPage(records.map((r) => r.id), records, 0, ['camera-3', 'camera-2', 'camera-1']);
    expect(plan.videoIds).toEqual(['camera-3', 'camera-2']);
  });

  it('keeps official viewer links and missing cameras in the board without treating them as video', () => {
    const records = [camera(1, 'still'), camera(2, 'viewer'), camera(3)];
    const plan = cameraBoardPage(['camera-1', 'camera-2', 'missing', 'camera-3'], records, 0, ['missing', 'camera-2']);
    expect(plan.ids).toEqual(['camera-1', 'camera-2', 'missing', 'camera-3']);
    expect(plan.videoIds).toEqual(['camera-3']);
  });
});
