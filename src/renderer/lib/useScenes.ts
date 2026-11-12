import { useRef, useState } from 'react';
import { needsSurfaceChoice, type Investigation } from '../../shared/investigation';
import { sceneSchema } from '../../shared/ipc';
import type { Settings } from '../../shared/types';
import { api, errorText, type Annotation, type Camera, type SavedView, type Scene } from './api';

type Capture = Pick<Scene, 'camera' | 'basemap' | 'terrainEnabled' | 'layersEnabled' | 'visualMode'> & { investigation: Investigation };
type Restore = { kind: 'view'; view: SavedView } | { kind: 'file'; scene: Scene };

export function useScenes(p: {
  basemap: Settings['basemap'] | undefined;
  capture(): Capture;
  restore(camera: Camera, investigation?: Investigation): Promise<boolean>;
  setViews: React.Dispatch<React.SetStateAction<SavedView[]>>;
  setAnnotations(annotations: Annotation[]): void;
  notify(message: string): void;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [surfaceChoice, setSurfaceChoice] = useState<Restore | null>(null);

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try { await action(); return true; }
    catch (error) { p.notify(errorText(error)); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function apply(request: Restore, allowMetered: boolean) {
    let camera: Camera;
    let investigation: Investigation | undefined;
    let label: string;
    let warnings: string[];
    if (request.kind === 'file') {
      const result = await api.applyScene(request.scene, allowMetered);
      p.setViews(result.views);
      p.setAnnotations(result.annotations);
      camera = request.scene.camera;
      investigation = request.scene.version === 2 ? request.scene.investigation : undefined;
      label = 'Scene imported';
      warnings = result.warnings;
    } else {
      const result = await api.restoreView(request.view.id, allowMetered);
      camera = result.view.camera;
      investigation = result.view.investigation;
      label = `Restored “${result.view.name}”`;
      warnings = result.warnings;
    }
    const placed = await p.restore(camera, investigation);
    p.notify([label, ...warnings, ...(placed ? [] : ['The saved camera position could not be applied.'])].join(' · '));
  }

  async function requestRestore(request: Restore) {
    const surface = request.kind === 'file' ? request.scene.basemap : request.view.basemap;
    const investigation = request.kind === 'view' ? request.view.investigation : request.scene.version === 2 ? request.scene.investigation : undefined;
    if (investigation?.imageryYear == null && p.basemap && needsSurfaceChoice(p.basemap, surface)) setSurfaceChoice(request);
    else await apply(request, false);
  }

  return {
    busy,
    surface: surfaceChoice?.kind === 'view' ? surfaceChoice.view.basemap : surfaceChoice?.scene.basemap,
    cancelSurface: () => setSurfaceChoice(null),
    chooseSurface: (allowMetered: boolean) => {
      if (!surfaceChoice) return;
      const request = surfaceChoice;
      setSurfaceChoice(null);
      void run(() => apply(request, allowMetered));
    },
    saveView: (name: string) => run(async () => {
      const view: SavedView = { ...p.capture(), name, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      await api.putView(view);
      p.setViews(current => [...current, view]);
      p.notify(`Saved “${name}”`);
    }),
    restoreView: (view: SavedView) => run(() => requestRestore({ kind: 'view', view })),
    deleteView: (id: string) => run(async () => {
      await api.deleteView(id);
      p.setViews(current => current.filter(view => view.id !== id));
    }),
    exportScene: () => run(async () => {
      const display = p.capture();
      const [annotations, views] = await Promise.all([api.listAnnotations(), api.listViews()]);
      const scene = sceneSchema.parse({ format: 'atlas-watch-scene', version: 2, createdAt: new Date().toISOString(),
        ...display, annotations, views });
      const path = await api.exportScene(scene);
      if (path) p.notify('Scene saved to ' + path);
    }),
    importScene: () => run(async () => {
      const scene = await api.importScene();
      if (scene) await requestRestore({ kind: 'file', scene });
    }),
  };
}
