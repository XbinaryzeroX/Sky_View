// Isolated desktop QA of local user-import annotations. Native chooser/save dialogs are operated by UI automation.
// Select tests/fixtures/geojson-annotations.json, inspect the preview, then acknowledge the skips.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 120000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await fn(); if (value) return value; await sleep(150); }
    throw new Error('GeoJSON desktop QA condition timed out');
  };
  const check = (value, why) => { if (!value) throw new Error(why); return true; };
  const findButton = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
  await window.atlas.updateSettings({ layersEnabled: [] });
  window.__atlasDebug.setPage('globe');
  await window.atlas.putAnnotation({ id: 'qa-existing-annotation', kind: 'pin', name: 'Existing annotation — keep',
    color: '#ffd166', points: [[-74, 40]], visible: true, createdAt: '2026-11-11T00:00:00.000Z' });
  await waitFor(() => window.__atlasSmoke?.globeReady);
  document.querySelector('button[aria-label="Map tools"]').click();
  (await waitFor(() => findButton('Import GeoJSON…'))).click();
  const modal = await waitFor(() => document.querySelector('[role="dialog"][aria-label="Import GeoJSON annotations"]'));
  const preview = modal.textContent;
  const before = await window.atlas.listAnnotations();
  check(before.length === 1, 'File selection saved records before approval');
  check(/3 ready/.test(preview) && /1 exact duplicate/.test(preview) && /5 rejected/.test(preview), 'Unexpected mixed-file preview counts');
  const commit = [...modal.querySelectorAll('button')].find(button => /^Import 3 valid/.test(button.textContent));
  check(commit?.disabled, 'Mixed import is not gated by acknowledgement');
  const acknowledgement = modal.querySelector('input[type="checkbox"]');
  // Stop here for actual desktop preview inspection. UI automation explicitly checks the visible acknowledgement.
  await waitFor(() => acknowledgement.checked);
  await waitFor(() => !commit.disabled);
  commit.click();
  await waitFor(() => !document.contains(modal));
  const all = await window.atlas.listAnnotations();
  check(all.length === 4 && all.some(item => item.id === 'qa-existing-annotation'), 'Atomic import did not preserve the existing annotation');
  check(all.some(item => item.name === 'ケープタウン / Кейптаун'), 'Unicode name was not retained');
  check(all.some(item => item.points.some(point => point[0] === -180)), 'Antimeridian coordinate was changed');
  check(!/source-secret|private-source-note|apiKey|token|existing-id/.test(JSON.stringify(all)), 'Source ID or foreign fields persisted');
  check(document.querySelectorAll('.anno-list > li').length === 4, 'Imported rows did not reach the existing Tools UI');
  const imported = all.filter(item => item.id !== 'qa-existing-annotation');
  const repeatText = JSON.stringify({ type: 'FeatureCollection', features: imported.map(item => ({ type: 'Feature',
    properties: { name: item.name, color: item.color, visible: item.visible },
    geometry: item.kind === 'pin' ? { type: 'Point', coordinates: item.points[0] } : item.kind === 'line' ? { type: 'LineString', coordinates: item.points } : { type: 'Polygon', coordinates: [[...item.points, item.points[0]]] } })) });
  const repeated = await window.atlas.importAnnotationsGeoJson(repeatText);
  check(repeated.imported === 0 && repeated.duplicates === 3 && repeated.annotations.length === 4, 'A repeat import duplicated annotations');
  check(!!findButton('Street View in Google Maps ↗'), 'Existing map tools did not expose the external Street View action');
  window.__atlasDebug.setView(51.5, -0.12, 2000, -35);
  await sleep(1200);
  const tiltedCenter = window.__atlasDebug.viewCenter();
  const tiltedCamera = window.__atlasDebug.camera();
  check(tiltedCenter && Math.abs(tiltedCenter.lat - tiltedCamera.lat) > 0.001, 'Street View target used the camera subpoint instead of the visible center');
  if (window.__atlasQaAdapter?.browserHandoff) {
    findButton('Street View in Google Maps ↗').click();
    await waitFor(() => /Sent to your browser/.test(document.querySelector('.street-view-action')?.textContent));
  }
  window.__atlasDebug.setView(51.5, -0.12, 2000, 10);
  await sleep(500);
  check(window.__atlasDebug.viewCenter() === null, 'Looking past the globe silently substituted a location');
  window.__atlasDebug.setSceneMode('2d');
  await sleep(2500);
  check(window.__atlasDebug.viewCenter() !== null, '2D map center could not be picked');
  window.__atlasDebug.setSceneMode('3d');
  await sleep(2500);
  window.__atlasDebug.setView(-33.9249, 18.4241, 350000);
  findButton('Export annotations…').click();
  await waitFor(() => /Annotations exported to/.test(document.querySelector('.geojson-tools')?.textContent));
  await sleep(1200);
  const errors = window.__atlasSmoke?.errors ?? [];
  check(errors.length === 0, `Renderer errors: ${JSON.stringify(errors)}`);
  return { result: 'PASS', data: 'local import fixture, no synthetic provider records', previewOnly: true,
    previewCounts: { ready: 3, duplicate: 1, rejected: 5 }, explicitAcknowledgement: true, originalPreserved: true,
    annotationCount: all.length, duplicateReimport: { imported: repeated.imported, duplicates: repeated.duplicates },
    streetViewTarget: { tiltedCenter, tiltedCamera: { lat: tiltedCamera.lat, lon: tiltedCamera.lon }, noHitRefused: true, mode2d: true,
      handoffExercised: window.__atlasQaAdapter?.browserHandoff === true, browserOpened: false },
    exportStatus: document.querySelector('.geojson-tools [role="status"]')?.textContent, rendererErrors: errors };
})()
