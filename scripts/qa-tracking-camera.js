// Isolated development smoke only. Uses a real, recent adsb.lol record and the existing tracking UI.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await fn(); if (value) return value; await sleep(200); }
    throw new Error('Tracking camera QA timed out');
  };
  const check = (value, message) => { if (!value) throw new Error(message); return true; };
  const button = (text) => [...document.querySelectorAll('.tracking-controls button')].find((b) => b.textContent.trim() === text);
  await window.atlas.updateSettings({ layersEnabled: ['aircraft'], worldAircraft: false });
  window.__atlasDebug.setView(40.7128, -74.006, 100000);
  const selected = await waitFor(async () => {
    const layer = (await window.atlas.getLayers()).find((s) => s.status.id === 'aircraft');
    return layer?.records.find((r) => r.lat > 30 && r.lat < 50 && r.lon > -90 && r.lon < -60 && r.props.snapshot !== true && r.props.onGround !== true && r.altM > 1000 && Number.isFinite(r.heading) && Date.now() - Date.parse(r.observedAt) < 45000);
  }, 70000);
  window.__atlasDebug.track('aircraft', selected.id);
  await waitFor(() => document.querySelector('.tracking-controls'));
  await sleep(2500);
  const before = window.__atlasDebug.diag();
  check(before.cameraHeightM < 50000, 'Follow camera did not move to the real aircraft');
  const cockpit = button('Cockpit');
  check(cockpit && !cockpit.disabled, 'Fresh airborne aircraft cannot enter cockpit perspective');
  cockpit.click();
  await waitFor(() => document.querySelector('.tracking-controls strong')?.textContent.includes('Cockpit perspective'));
  await sleep(1500);
  const diag = window.__atlasDebug.diag();
  check(Math.abs(diag.cameraHeightM - selected.altM) < 150, 'Cockpit camera is not at the reported aircraft altitude');
  const result = { aircraft: { id: selected.id, label: selected.label, source: selected.source, observedAt: selected.observedAt, altitudeM: selected.altM, groundTrack: selected.heading }, followHeightM: before.cameraHeightM, cockpitHeightM: diag.cameraHeightM, cockpitEntered: true };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => document.querySelector('.tracking-controls strong')?.textContent.includes('Following'));
  result.escapeReturnsToFollow = true;
  button('Stop tracking').click();
  await waitFor(() => !document.querySelector('.tracking-controls'));
  result.stopCleanedControls = true;
  // Exercise the real Cesium morph while the forward camera is active, not a mocked scene mode.
  window.__atlasDebug.track('aircraft', selected.id);
  await waitFor(() => button('Cockpit') && !button('Cockpit').disabled);
  button('Cockpit').click(); await sleep(400);
  window.__atlasDebug.setSceneMode('2d');
  await sleep(1800);
  check(!document.querySelector('.tracking-controls strong')?.textContent.includes('Cockpit perspective'), 'Cockpit camera survived a 2D mode switch');
  result.sceneModeExit = true;
  window.__atlasDebug.setSceneMode('3d'); await sleep(1800);
  window.__atlasDebug.track('aircraft', selected.id);
  await waitFor(() => button('Cockpit') && !button('Cockpit').disabled);
  button('Cockpit').click();
  await sleep(1200);
  result.rendererErrors = window.__atlasSmoke?.errors ?? [];
  check(result.rendererErrors.length === 0, 'Tracking produced renderer errors');
  return result;
})();
