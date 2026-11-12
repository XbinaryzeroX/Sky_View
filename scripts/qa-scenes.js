// Scenes integration scenario. Real source observations initially; cached local archive on offline restart.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, why) => { if (!ok) throw new Error(why); };
  const waitFor = async (fn, timeout = 18000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error('Scenes desktop QA condition timed out'); };
  const stage = value => { window.__atlasScenesQaStep = value; };
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const scenes = () => document.querySelector('[role="region"][aria-label="Scenes"]');
  const playback = () => document.querySelector('[role="region"][aria-label="Playback"]');
  const map = (kind, id) => window.__atlasDebug.replayMap(kind, id);
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const equal = (actual, expected, why) => check(canonical(actual) === canonical(expected), why + ': ' + canonical(actual));
  const input = async (field, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); await sleep(80); };
  const capture = async label => { window.__atlasScenesQaCapture = label; await waitFor(() => window.__atlasScenesQaCaptured === label); };
  const openScenes = async () => { if (!scenes()) document.querySelector('button[aria-label="Scenes"]').click(); await waitFor(() => scenes()?.querySelector('input[placeholder="Name this view"]')); };
  const cameraMatches = expected => {
    const actual = window.__atlasDebug.camera();
    return actual && Math.abs(actual.lat - expected.lat) < 0.0001 && Math.abs(((actual.lon - expected.lon + 540) % 360) - 180) < 0.0001 && Math.abs(actual.heightM - expected.heightM) < 5;
  };
  const recordedPanelLayout = async () => {
    await sleep(300);
    const panel = scenes(), data = document.querySelector('.data-panel'), bar = playback();
    check(panel && data && bar, 'Recorded Scenes/Data layout is incomplete');
    const a = panel.getBoundingClientRect(), b = data.getBoundingClientRect(), p = bar.getBoundingClientRect();
    check(a.bottom <= p.top + 1 && b.bottom <= p.top + 1, `Replay covers a panel: Scenes bottom=${a.bottom}, Data bottom=${b.bottom}, Playback top=${p.top}`);
    const reachable = element => {
      const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= p.top + 1 && hit && (hit === element || element.contains(hit));
    };
    const field = panel.querySelector('input[placeholder="Name this view"]');
    const saveButton = [...panel.querySelectorAll('button')].find(item => item.textContent.trim() === 'Save view');
    const exportButton = [...panel.querySelectorAll('button')].find(item => item.textContent.trim() === 'Export scene file…');
    const closeData = document.querySelector('button[aria-label="Close Recorded data"]');
    check(reachable(field) && reachable(saveButton) && reachable(closeData), 'Recorded Scenes/Data controls are covered or unreachable');
    exportButton.scrollIntoView({ block: 'nearest' }); await sleep(60);
    check(reachable(exportButton), 'Scene export control cannot be reached above Replay');
    field.scrollIntoView({ block: 'nearest' }); await sleep(60);
    return { scenesBottom: a.bottom, dataBottom: b.bottom, playbackTop: p.top, saveInputAndButtonReachable: true, exportReachableWithPanelScroll: true, dataCloseReachable: true };
  };
  const save = async name => {
    await openScenes();
    await input(scenes().querySelector('input[placeholder="Name this view"]'), name);
    const saveButton = [...scenes().querySelectorAll('button')].find(item => item.textContent.trim() === 'Save view');
    await waitFor(() => !saveButton.disabled); saveButton.click();
    const saved = await waitFor(async () => (await window.atlas.listViews()).find(view => view.name === name));
    await sleep(200); return saved;
  };
  const selectRecorded = async (kind, id) => {
    if (!document.querySelector('.data-panel')) document.querySelector('button[aria-label="Data"]').click();
    const back = [...document.querySelectorAll('.data-panel button')].find(item => item.textContent.includes('Recorded observations'));
    if (back) back.click();
    const find = await waitFor(() => document.querySelector('.data-panel input[type="search"]'));
    await input(find, id);
    const row = await waitFor(() => document.querySelectorAll('.data-panel button.rec-item').length === 1 ? document.querySelector('.data-panel button.rec-item') : null);
    row.click();
    await waitFor(() => document.querySelector('.data-panel')?.textContent.includes(kind === 'quake' ? 'Recorded earthquake' : 'Recorded weather alert') && document.querySelector('.data-panel')?.textContent.includes(id));
  };
  const restore = async view => {
    await openScenes();
    const named = await waitFor(() => [...scenes().querySelectorAll('button')].find(item => item.textContent.trim() === view.name));
    await waitFor(() => !named.disabled); named.click();
    await waitFor(() => !scenes() && cameraMatches(view.camera));
    if (view.investigation?.clock.mode === 'recorded') await waitFor(() => map().active && map().cursor === view.investigation.clock.t && playback()?.dataset.playbackPhase === 'ready');
    else if (view.investigation?.clock.mode === 'live') await waitFor(() => !map().active);
    await sleep(150);
  };
  const checkpoint = async (expected, name) => {
    const saved = await save(name);
    equal(saved.investigation, expected.investigation, 'Restored runtime investigation differs when saved again');
    check(cameraMatches(expected.camera), 'Restored camera differs from saved view');
    const heading = Math.abs(((saved.camera.heading - expected.camera.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    check(heading < 0.0001 && Math.abs(saved.camera.pitch - expected.camera.pitch) < 0.0001, 'Restored camera orientation differs from saved view');
    return saved;
  };
  const context = await waitFor(() => window.__atlasScenesQa && window.__atlasDebug?.replayMap && window.__atlasSmoke?.globeReady ? window.__atlasScenesQa : null);
  const mode = async value => { const target = button(value === '2d' ? '2D' : '3D'); check(target, 'Map mode control missing'); target.click(); await sleep(1200); await waitFor(() => window.__atlasDebug.camera()); };
  const exit = async () => { const target = button('Exit playback'); if (target) target.click(); await waitFor(() => !map().active); };
  const recordedAt = async t => {
    if (!map().active) {
      document.querySelector('button[aria-label="Playback / History"]').click();
      (await waitFor(() => button('Replay recorded data'))).click();
      await waitFor(() => playback()?.dataset.playbackPhase === 'ready');
    }
    const slider = await waitFor(() => document.querySelector('input[aria-label="Playback time"]'));
    await input(slider, String(Date.parse(t)));
    await waitFor(() => map().cursor === t && playback()?.dataset.playbackPhase === 'ready');
  };
  const turnOffImagery = () => window.__atlasDebug.setImagery({ product: null, compare: false, date: '2020-08-01', compareDate: '2020-08-08', opacity: 1, split: 0.5 });
  const assertSelected = (view, expectedKind, expectedId, dataOpen) => {
    check(map().active && map().cursor === view.investigation.clock.t, 'Saved recorded cursor was clamped or replaced by live');
    check(!!document.querySelector('.data-panel') === dataOpen, 'Recorded Data open/closed state was not preserved');
    if (dataOpen) check(document.querySelector('.data-panel').textContent.includes(expectedKind === 'quake' ? 'Recorded earthquake' : 'Recorded weather alert') && document.querySelector('.data-panel').textContent.includes(expectedId), 'Recorded selected source ID/details were not restored');
  };

  if (context.restart) {
    stage('restoring genuine archived investigations after offline restart');
    const baseline = context.baseline;
    await restore(baseline.quakeView); assertSelected(baseline.quakeView, 'quake', baseline.quakeView.investigation.selection.id, true);
    await checkpoint(baseline.quakeView, 'QA restarted quake checkpoint');
    await restore(baseline.alertView); assertSelected(baseline.alertView, 'alert', baseline.alertView.investigation.selection.id, true);
    await checkpoint(baseline.alertView, 'QA restarted alert checkpoint');
    await capture('restart');
    await restore(baseline.closedView); assertSelected(baseline.closedView, 'quake', baseline.closedView.investigation.selection.id, false);
    await checkpoint(baseline.closedView, 'QA restarted closed Data checkpoint');
    stage('retaining the recorded cursor and opaque selection when its local archive has been cleared');
    await window.atlas.clearHistory();
    await restore(baseline.quakeView);
    const unavailable = await window.atlas.timelineFrame(baseline.quakeView.investigation.clock.t);
    check(unavailable.nws.state === 'unknown' && unavailable.usgs.state === 'unknown', 'Cleared archive was reconstructed from current/cache records');
    check(map().active && map().cursor === baseline.quakeView.investigation.clock.t && map().alertCount === 0 && map().quakeCount === 0, 'Unavailable saved investigation silently substituted live data/time');
    await waitFor(() => {
      const text = document.querySelector('.data-panel')?.textContent ?? '';
      return text.includes('There is no valid recorded reply for this source at the selected time.') && text.includes(baseline.quakeView.investigation.selection.id);
    });
    await checkpoint(baseline.quakeView, 'QA unavailable cursor checkpoint');
    await capture('unavailable');
    const places = (await window.atlas.getState()).locations;
    check(places.some(place => place.name === 'QA_PRIVATE_LOCATION_NOT_EXPORTED' && place.notes === 'QA_PRIVATE_NOTES_NOT_EXPORTED'), 'Scene/history workflow changed private saved locations');
    check((window.__atlasSmoke?.errors ?? []).length === 0, 'Renderer errors after restore/restart');
    return { result: 'PASS', restartOffline: true, unavailableMessage: 'There is no valid recorded reply for this source at the selected time.', selectedIdAfterClear: baseline.quakeView.investigation.selection.id,
      checks: { quakeRestore: true, alertRestore: true, exactCameraAndCursor: true, filtersAndImageryRuntimeRoundTrip: true,
      closedDataRemainsClosed: true, archiveClearedOnlyInTempProfile: true, unavailableKeepsClockAndSelection: true, noLiveSubstitution: true, privateLocationPreserved: true }, rendererErrors: window.__atlasSmoke?.errors ?? [] };
  }

  stage('retrieving real NWS and USGS observations in the isolated profile');
  const initial = await waitFor(async () => {
    const snap = await window.atlas.getState();
    for (const feed of ['nws', 'usgs']) if (snap.feeds[feed].state === 'error') throw new Error(`Actual ${feed} unavailable: ${snap.feeds[feed].error}`);
    return ['nws', 'usgs'].every(feed => snap.feeds[feed].state === 'ok' && !snap.feeds[feed].fromCache) ? snap : null;
  }, 45000);
  document.querySelector('button[aria-label="Playback / History"]').click();
  (await waitFor(() => button('Replay recorded data'))).click();
  await waitFor(() => playback()?.dataset.playbackPhase === 'ready');
  const range = await window.atlas.timelineRange(), frame = await window.atlas.timelineFrame(range.newest);
  const slider = document.querySelector('input[aria-label="Playback time"]');
  await input(slider, String(Date.parse(range.newest)));
  await waitFor(() => map().cursor === range.newest && playback()?.dataset.playbackPhase === 'ready'); await sleep(150);
  const quake = frame.usgs.records.filter(record => record.mag !== null && record.mag >= 1 && Math.abs(record.lat) < 70).map(record => ({ record,
    distance: Math.min(...frame.usgs.records.filter(other => other.id !== record.id).map(other => Math.hypot(other.lat - record.lat, Math.abs(((other.lon - record.lon + 540) % 360) - 180) * Math.cos(record.lat * Math.PI / 180)))) })).sort((a, b) => b.distance - a.distance)[0]?.record;
  const alert = frame.nws.records.find(record => record.geometry && map('alert', record.id).positions.length > 0);
  check(quake && alert, 'Actual feeds lack a suitable mapped quake/weather alert for this integration check');
  const queryBefore = { quakeWindow: initial.settings.quakeWindow, quakeMinMagnitude: initial.settings.quakeMinMagnitude };
  const severity = [...new Set(['Severe', alert.severity])];
  const preferences = async (wanted, affecting) => {
    const layersButton = document.querySelector('button[aria-label="Layers"]');
    if (layersButton.getAttribute('aria-expanded') !== 'true') layersButton.click();
    await waitFor(() => document.querySelector('.sev-filter'));
    for (const label of [...document.querySelectorAll('.sev-filter label')]) {
      const name = label.textContent.trim().split(/\s+/).at(-1), field = label.querySelector('input');
      if (field.checked !== wanted.includes(name)) { field.click(); await sleep(35); }
    }
    const toggle = async (text, desired) => {
      const label = [...document.querySelectorAll('label')].find(item => item.textContent.trim().endsWith(text));
      const field = label?.querySelector('input[type="checkbox"]'); check(field, 'Missing existing filter ' + text);
      if (field.checked !== desired) { field.click(); await sleep(80); }
    };
    await toggle('Monitoring radii', false); await toggle('Saved locations', false);
    await toggle('Only alerts affecting saved locations', affecting); await toggle('Airports', false);
  };
  stage('saving an open Recorded Data investigation without leaving Replay');
  await preferences(severity, true); await recordedAt(range.newest); window.__atlasDebug.setImagery(context.imagery);
  window.__atlasDebug.setView(quake.lat, quake.lon, 1_000_000); await sleep(150);
  await selectRecorded('quake', quake.id);
  await openScenes(); check(map().active && document.querySelector('.data-panel')?.textContent.includes(quake.id), 'Opening Scenes discarded Recorded Data or its selected source');
  const quakeView = await save('QA recorded USGS investigation');
  check(quakeView.investigation.clock.mode === 'recorded' && quakeView.investigation.clock.t === range.newest && quakeView.investigation.selection.id === quake.id, 'View did not capture the exact recorded USGS investigation');
  equal(quakeView.investigation.imagery, context.imagery, 'Chosen dated public imagery configuration not saved');
  const recordedSaveLayout = await recordedPanelLayout();
  await capture('recorded-save');
  document.querySelector('button[aria-label="Close Recorded data"]').click();
  const closedView = await save('QA recorded investigation with Data closed');
  check(closedView.investigation.dataOpen === false && closedView.investigation.selection.id === quake.id, 'Closing Data lost the remembered source selection');

  stage('saving a second source selection in actual 2D mode');
  turnOffImagery(); await sleep(100);
  await preferences([alert.severity], false); await recordedAt(range.newest); window.__atlasDebug.setImagery(context.imagery); await mode('2d');
  const geometry = alert.geometry.type === 'Polygon' ? alert.geometry.coordinates[0] : alert.geometry.coordinates[0][0];
  const lat = geometry.reduce((sum, point) => sum + point[1], 0) / geometry.length;
  const lon = geometry.reduce((sum, point) => sum + point[0], 0) / geometry.length;
  window.__atlasDebug.setView(lat, lon, 1_500_000); await sleep(200);
  const hud = document.querySelector('button[aria-label="HUD"]'); if (hud.getAttribute('aria-pressed') === 'true') hud.click();
  await selectRecorded('alert', alert.id);
  const alertView = await save('QA recorded NWS investigation in 2D');
  check(alertView.investigation.sceneMode === '2d' && alertView.investigation.selection.id === alert.id, '2D recorded NWS state not saved');
  const recordedNwsLayout = await recordedPanelLayout();
  await capture('recorded-nws-save');
  (await waitFor(() => button('Export scene file…'))).click();
  await waitFor(() => document.body.textContent.includes('Scene saved to'));

  stage('moving away into a distinct live view and live query');
  turnOffImagery(); await sleep(100); await exit(); await mode('3d');
  await window.atlas.updateSettings({ quakeWindow: 'week', quakeMinMagnitude: 3.5, quakesNearLocationsOnly: false });
  const moved = await waitFor(async () => {
    const snap = await window.atlas.getState();
    return snap.settings.quakeWindow === 'week' && snap.settings.quakeMinMagnitude === 3.5 && snap.feeds.usgs.state === 'ok' && snap.feeds.usgs.lastSuccessAt > range.newest ? snap : null;
  }, 45000);
  const layersControl = document.querySelector('button[aria-label="Layers"]');
  if (layersControl.getAttribute('aria-expanded') !== 'true') layersControl.click();
  await waitFor(() => {
    const fields = document.querySelectorAll('.quake-controls select');
    return fields[0]?.value === 'week' && fields[1]?.value === '3.5';
  });
  window.__atlasDebug.setView(-33.9, 18.4, 2_000_000);
  const liveView = await save('QA separate live investigation'); check(liveView.investigation.clock.mode === 'live', 'Live view captured a historical clock');
  check(liveView.investigation.quakeWindow === 'week' && liveView.investigation.quakeMinMagnitude === 3.5, 'Live view did not capture the displayed live query');

  stage('restoring both recorded views, filters, hidden imagery and closed Data');
  await restore(quakeView); assertSelected(quakeView, 'quake', quake.id, true);
  check(map('quake', quake.id).positions.some(([x, y]) => Math.abs(x - quake.lon) < 1e-7 && Math.abs(y - quake.lat) < 1e-7), 'Restored map selected the wrong quake coordinates');
  await checkpoint(quakeView, 'QA restored quake checkpoint');
  const currentSettings = (await window.atlas.getState()).settings;
  check(currentSettings.quakeWindow === moved.settings.quakeWindow && currentSettings.quakeMinMagnitude === moved.settings.quakeMinMagnitude, 'Recorded restore silently changed the live USGS query');
  await restore(alertView); assertSelected(alertView, 'alert', alert.id, true);
  check(map('alert', alert.id).positions.length > 0, 'Restored weather source is absent from the actual Cesium map');
  await checkpoint(alertView, 'QA restored alert checkpoint'); await capture('restored-recorded');
  await restore(closedView); assertSelected(closedView, 'quake', quake.id, false);
  await checkpoint(closedView, 'QA restored closed Data checkpoint'); await capture('closed-data');

  stage('importing a version-2 file and preserving legacy view/version-1 behavior');
  turnOffImagery(); await sleep(100); await exit(); await mode('3d'); window.__atlasDebug.setView(0, 0, 3_000_000);
  await openScenes(); button('Import scene file…').click();
  await waitFor(() => !scenes() && map().active && map().cursor === alertView.investigation.clock.t && cameraMatches(alertView.camera));
  assertSelected(alertView, 'alert', alert.id, true); await checkpoint(alertView, 'QA imported v2 checkpoint');
  await openScenes(); button('Import scene file…').click();
  await waitFor(() => !scenes() && cameraMatches(context.v1.camera));
  check(map().active && map().cursor === alertView.investigation.clock.t && document.querySelector('.data-panel')?.textContent.includes(alert.id), 'v1 import invented/cleared current investigation state');
  check((await window.atlas.listAnnotations()).some(item => item.id === 'qa-scenes-v1-pin'), 'Legacy v1 annotations were not imported');
  const legacy = (await window.atlas.listViews()).find(view => view.id === context.legacy.id);
  await restore(legacy);
  check(map().active && map().cursor === alertView.investigation.clock.t && document.querySelector('.data-panel')?.textContent.includes(alert.id), 'Legacy saved view did not preserve the current investigation');
  await capture('legacy-compatible');
  await restore(liveView); check(!map().active && !playback(), 'Live saved view restored as historical');
  await capture('restored-live');
  await restore(quakeView); assertSelected(quakeView, 'quake', quake.id, true);
  check((window.__atlasSmoke?.errors ?? []).length === 0, 'Renderer errors in Scenes workflow');
  return { result: 'PASS', checks: { actualSupportedSources: true, saveFromRecordedDataInPlace: true, exactRecordedCursorAndSelection: true, actualMapRestored: true,
    filtersAndPublicImageryRestored: true, liveQueryUnaffectedByRecordedRestore: true, actualMode2dAnd3dRestore: true, closedDataRemainsClosed: true, exportImportV2: true, v1Compatible: true, legacyViewPreservesContext: true, liveDistinctFromRecorded: true, panelsAboveReplayAndControlsReachable: true },
    recordedSaveLayout, recordedNwsLayout,
    actualObservedAt: { nws: frame.nws.observedAt, usgs: frame.usgs.observedAt }, actualSourceUpdatedAt: { nws: frame.nws.sourceUpdatedAt, usgs: frame.usgs.sourceUpdatedAt },
    selectedRecords: [{ kind: 'quake', id: quake.id, mag: quake.mag, lat: quake.lat, lon: quake.lon }, { kind: 'alert', id: alert.id, sent: alert.sent }],
    inactiveRecordedQuery: queryBefore, activeLiveQueryAfterMove: { quakeWindow: moved.settings.quakeWindow, quakeMinMagnitude: moved.settings.quakeMinMagnitude },
    quakeView, alertView, closedView, liveView, rendererErrors: window.__atlasSmoke?.errors ?? [] };
})().then(result => { window.__atlasScenesQaDone = true; return result; }).catch(error => { throw new Error(`[${window.__atlasScenesQaStep ?? 'initializing'}] ${error.stack ?? error.message}`); })
