// Existing Scenes behavior before investigation-state restoration; TEMP fixture only.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, why) => { if (!value) throw new Error(why); };
  const waitFor = async fn => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error('Scenes before-state QA timed out'); };
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const capture = async label => { window.__atlasScenesBeforeCapture = label; await waitFor(() => window.__atlasScenesBeforeCaptured === label); };
  window.__atlasScenesBeforeStep = 'opening recorded fixture';
  await waitFor(() => window.__atlasScenesBefore && window.__atlasSmoke?.globeReady);
  window.__atlasDebug.setPage('globe'); window.__atlasDebug.setView(37.5, -122, 1_000_000);
  document.querySelector('button[aria-label="Playback / History"]').click();
  (await waitFor(() => button('Replay recorded data'))).click();
  await waitFor(() => document.querySelector('[aria-label="Playback"]')?.dataset.playbackPhase === 'ready');
  document.querySelector('button[aria-label="Data"]').click();
  (await waitFor(() => [...document.querySelectorAll('.data-panel button.rec-item')].find(item => item.textContent.includes('QA SCENES BEFORE')))).click();
  await waitFor(() => document.querySelector('.data-panel')?.textContent.includes('Recorded earthquake'));
  window.__atlasScenesBeforeStep = 'saving a view from recorded Data';
  document.querySelector('button[aria-label="Scenes"]').click();
  const name = await waitFor(() => document.querySelector('[aria-label="Scenes"] input[placeholder="Name this view"]'));
  const scenesOpeningExitedReplay = !window.__atlasDebug.replayMap().active;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'QA BEFORE investigation');
  name.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100); button('Save view').click();
  const saved = await waitFor(async () => (await window.atlas.listViews()).find(view => view.name === 'QA BEFORE investigation'));
  await capture('recorded-save');
  window.__atlasScenesBeforeStep = 'leaving recorded mode and restoring the legacy view';
  const exit = button('Exit playback');
  if (exit) exit.click();
  await waitFor(() => !window.__atlasDebug.replayMap().active);
  window.__atlasDebug.setView(-33.9, 18.4, 2_000_000); await sleep(200);
  (await waitFor(() => button(saved.name))).click();
  const camera = await waitFor(() => {
    const value = window.__atlasDebug.camera();
    return Math.abs(value.lat - saved.camera.lat) < 0.0001 && Math.abs(value.lon - saved.camera.lon) < 0.0001 ? value : null;
  });
  check(camera, 'Legacy camera restore failed');
  const restoredReplay = window.__atlasDebug.replayMap().active;
  const savedHasInvestigation = Object.keys(saved).some(key => /investigation|context|cursor|selection|imagery|filter/i.test(key));
  check(!restoredReplay && !savedHasInvestigation, 'This build already restores investigation state; before evidence is stale');
  await capture('restored');
  return { result: 'PASS', beforeState: true, providerTraffic: 'forced offline', fixture: 'explicit synthetic historical quake',
    savedFields: Object.keys(saved), savedHasInvestigation, cameraRestored: true, restoredReplay, scenesOpeningExitedReplay,
    recordedCursorBeforeSave: window.__atlasScenesBefore.at, selectedBeforeSave: 'qa-scenes-before-quake', rendererErrors: window.__atlasSmoke?.errors ?? [] };
})().catch(error => { throw new Error(`[${window.__atlasScenesBeforeStep ?? 'initializing'}] ${error.stack ?? error.message}`); })
