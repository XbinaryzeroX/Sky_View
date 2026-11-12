// Before-state evidence from the existing built desktop, in a temporary smoke profile.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async fn => {
    const end = Date.now() + 12000;
    while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
    throw new Error('Before-timeline QA condition timed out');
  };
  await window.atlas.updateSettings({ basemap: 'neutral', terrainEnabled: false, labelsOverlay: false, buildings3d: false, layersEnabled: [] });
  window.__atlasDebug.setPage('globe');
  await waitFor(() => window.__atlasSmoke?.globeReady);
  (await waitFor(() => document.querySelector('button[aria-label="Playback / History"]'))).click();
  const movement = await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Replay recorded movement'));
  const hasSeparateHistory = [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Event history');
  movement.click();
  await waitFor(() => document.querySelector('.playback')?.textContent.includes('No recorded movement yet'));
  return { result: 'PASS', beforeState: true, movementOnlyReplay: true, separateEventHistory: hasSeparateHistory,
    text: document.querySelector('.playback').textContent.trim(),
    timelineRangeBridgePresent: typeof window.atlas.timelineRange === 'function', rendererErrors: window.__atlasSmoke?.errors ?? [] };
})()
