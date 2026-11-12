// Actual renderer scenario for check-timeline-ui.mjs; synthetic historical and live evidence are separate.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, why) => { if (!ok) throw new Error(why); };
  const waitFor = async (fn, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
    throw new Error('Timeline desktop QA condition timed out');
  };
  const stage = value => { window.__atlasTimelineQaStep = value; };
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const region = () => document.querySelector('[role="region"][aria-label="Playback"]');
  const map = (kind, id) => window.__atlasDebug.replayMap(kind, id);
  const capture = async label => {
    window.__atlasTimelineQaCapture = label;
    await waitFor(() => window.__atlasTimelineQaCaptured === label, 10000);
  };
  let controlId = 0, clickId = 0;
  const fault = async value => {
    window.__atlasTimelineQaControl = { id: ++controlId, fault: value };
    await waitFor(() => window.__atlasTimelineQaControlled === controlId);
  };
  const seek = async (t, settle = true) => {
    const slider = await waitFor(() => document.querySelector('input[aria-label="Playback time"]'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(Date.parse(t)));
    check(Number(slider.value) === Date.parse(t), 'Native time slider rounded away a recorded millisecond boundary');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    if (settle) {
      await waitFor(() => region()?.dataset.playbackCursor === t && region()?.dataset.playbackPhase === 'ready' && map().cursor === t);
      await sleep(80); // Inspect actual Cesium entities after the renderer's committed effects.
    }
  };
  const pickQuake = async (id, expected, detailLabel) => {
    window.__atlasDebug.setView(expected.lat, expected.lon, 1_000_000);
    await sleep(450);
    const projected = await waitFor(() => {
      const value = map('quake', id);
      return value.screen && value.screen.x > 70 && value.screen.x < innerWidth - 400 && value.screen.y > 90 && value.screen.y < innerHeight - 150 ? value : null;
    });
    check(projected.positions.some(([lon, lat]) => Math.abs(lon - expected.lon) < 1e-7 && Math.abs(lat - expected.lat) < 1e-7), 'Actual Cesium quake entity has the wrong historical position');
    window.__atlasTimelineQaClick = { id: ++clickId, ...projected.screen };
    await waitFor(() => window.__atlasTimelineQaClicked === clickId);
    try { await waitFor(() => document.querySelector('.data-panel')?.textContent.includes(detailLabel) && document.querySelector('.data-panel')?.textContent.includes(id)); }
    catch (error) { await capture('native-pick-failure'); throw new Error(`Native canvas pick expected ${id}; details=${document.querySelector('.data-panel')?.textContent.slice(0, 700)}; ${error.message}`); }
    return projected;
  };
  const closeReplay = async () => {
    (await waitFor(() => button('Exit playback'))).click();
    await waitFor(() => !region() && map().active === false);
  };
  const openRecordedAlert = async (id, title, at) => {
    (await waitFor(() => [...document.querySelectorAll('.data-panel button')].find(item => item.textContent.includes('Recorded observations')))).click();
    (await waitFor(() => [...document.querySelectorAll('.data-panel button.rec-item')].find(item => item.textContent.includes(title)))).click();
    const detail = await waitFor(() => {
      const pane = document.querySelector('.data-panel');
      return pane?.textContent.includes('Recorded weather alert') && pane.textContent.includes(id) ? pane : null;
    });
    const fieldTime = label => [...detail.querySelectorAll('.kv')].find(item => item.querySelector('dt')?.textContent === label)?.querySelector('time')?.dateTime;
    check(fieldTime('Recorded by Atlas Watch') === at && fieldTime('Sent') === at, 'Recorded weather source/observation time was replaced by the live clock or a later revision');
    check(detail.textContent.includes('QA synthetic historical fixture'), 'Historical source issuer missing or replaced by live data');
  };
  const openReplay = async () => {
    document.querySelector('button[aria-label="Playback / History"]').click();
    (await waitFor(() => button('Replay recorded data'))).click();
    await waitFor(() => region()?.dataset.playbackPhase === 'ready');
  };
  const context = await waitFor(() => window.__atlasTimelineQa);
  const f = context.fixture;
  stage('waiting for actual NWS and USGS observations');
  const live = await waitFor(async () => {
    const snap = await window.atlas.getState();
    for (const feed of ['nws', 'usgs']) if (snap.feeds[feed].state === 'error') throw new Error(`Actual ${feed} unavailable: ${snap.feeds[feed].error}`);
    return ['nws', 'usgs'].every(feed => snap.feeds[feed].state === 'ok' && !snap.feeds[feed].fromCache) ? snap : null;
  }, 45000);
  check(!live.alerts.some(record => record.id.includes('qa-replay-fixture')) && !live.quakes.some(record => record.id.includes('qa-replay-fixture')), 'Synthetic historical fixtures leaked into live provider state');
  await waitFor(() => window.__atlasSmoke?.globeReady && typeof window.__atlasDebug.replayMap === 'function');
  window.__atlasDebug.setPage('globe');
  const range = await window.atlas.timelineRange();
  check(range.points === 0 && range.nwsFrames >= 4 && range.usgsFrames >= 3, 'Hazard-only archive has no usable shared range');

  stage('proving unrecorded is distinct from a successful empty observation');
  const first = await window.atlas.timelineFrame(f.firstNwsAt);
  check(first.nws.state === 'recorded' && first.nws.records.length === 1, 'First NWS observation was not retained');
  check(first.usgs.state === 'unknown' && first.usgs.records.length === 0, 'USGS before its first observation was represented as empty or live');
  await openReplay();
  await seek(f.firstNwsAt);
  check(map().active && map().quakeCount === 0 && map().alertCount === 1, 'Unknown historical USGS coverage leaked live quake markers or erased the old active alert');
  check(/unrecorded/i.test(region().textContent), 'Unknown source coverage has no explicit UI label');
  await capture('unrecorded');

  stage('selecting a historical Cesium quake and preserving the old revision geometry');
  await seek(f.firstBothAt);
  const oldFrame = await window.atlas.timelineFrame(f.firstBothAt);
  check(oldFrame.usgs.records[0]?.id === f.quakeId && oldFrame.usgs.records[0]?.mag === f.oldQuake.mag, 'The older earthquake payload was overwritten by its newer revision');
  const oldPolygon = map('alert', f.oldAlertId);
  check(f.oldAlertRing.slice(0, 4).every(([lon, lat]) => oldPolygon.positions.some(point => Math.abs(point[0] - lon) < 1e-7 && Math.abs(point[1] - lat) < 1e-7)), 'Historical map used the current/revised weather polygon');
  const oldPick = await pickQuake(f.quakeId, f.oldQuake, 'Recorded earthquake');
  check(document.querySelector('.data-panel').textContent.includes('3.2'), 'Historical details showed the current magnitude');
  await openRecordedAlert(f.oldAlertId, 'QA REPLAY FIXTURE alert revision 1', f.firstNwsAt);
  await capture('old-revision');
  // A genuine new poll while holding an old cursor must not replace its map or details.
  await window.atlas.refresh('usgs');
  check(map().cursor === f.firstBothAt && map('quake', f.quakeId).positions.some(([lon, lat]) => Math.abs(lon - f.oldQuake.lon) < 1e-7 && Math.abs(lat - f.oldQuake.lat) < 1e-7), 'A real live refresh overwrote the held historical frame');
  check(document.querySelector('.data-panel')?.textContent.includes('QA REPLAY FIXTURE alert revision 1'), 'A real live refresh overwrote historical source details');

  stage('selecting the distinct later historical revision');
  await seek(f.revisedAt);
  const revised = await window.atlas.timelineFrame(f.revisedAt);
  check(revised.usgs.records[0]?.mag === f.newQuake.mag, 'Later quake revision missing');
  check(map('alert', f.oldAlertId).positions.length === 0, 'Superseded historical alert still appears as active');
  const newPolygon = map('alert', f.newAlertId);
  check(f.newAlertRing.slice(0, 4).every(([lon, lat]) => newPolygon.positions.some(point => Math.abs(point[0] - lon) < 1e-7 && Math.abs(point[1] - lat) < 1e-7)), 'Later historical weather polygon not drawn');
  const newPick = await pickQuake(f.quakeId, f.newQuake, 'Recorded earthquake');
  check(document.querySelector('.data-panel').textContent.includes('5.6'), 'Revised historical details kept the old magnitude');
  await openRecordedAlert(f.newAlertId, 'QA REPLAY FIXTURE alert revision 2', f.revisedAt);
  await capture('new-revision');

  stage('checking recorded empty, expired gap, partial observation and explicit failure');
  await seek(f.emptyAt);
  const empty = await window.atlas.timelineFrame(f.emptyAt);
  check(empty.nws.state === 'recorded' && empty.usgs.state === 'recorded' && !empty.nws.records.length && !empty.usgs.records.length, 'Successful empty observation became unknown or reused old records');
  check(map().alertCount === 0 && map().quakeCount === 0, 'Recorded-empty cursor retained stale/live hazard markers');
  check(/recorded empty/i.test(region().textContent), 'Recorded-empty label missing');
  await capture('recorded-empty');
  await seek(f.expiredAt);
  const gap = await window.atlas.timelineFrame(f.expiredAt);
  check(gap.nws.state === 'gap' && gap.usgs.state === 'gap' && map().alertCount === 0 && map().quakeCount === 0, 'Expired coverage was presented as known or live');
  await capture('gap');
  await seek(f.partialAt);
  const partial = await window.atlas.timelineFrame(f.partialAt);
  check(partial.nws.state === 'partial' && partial.nws.reason && /partial/i.test(region().textContent), 'Skipped source records were presented as complete');
  await seek(f.failureAt);
  const failure = await window.atlas.timelineFrame(f.failureAt);
  check(failure.usgs.state === 'gap' && failure.usgs.records.length === 0, 'Failed refresh was represented as a successful empty observation');

  stage('checking genuine archived observations and actual map selection separately from fixtures');
  await closeReplay(); await openReplay();
  const latestRange = await window.atlas.timelineRange();
  await seek(latestRange.newest);
  const actual = await window.atlas.timelineFrame(latestRange.newest);
  check(['recorded', 'partial'].includes(actual.nws.state) && ['recorded', 'partial'].includes(actual.usgs.state), 'Actual successful source observations were not archived');
  check(!actual.nws.records.some(record => record.id.includes('qa-replay-fixture')) && !actual.usgs.records.some(record => record.id.includes('qa-replay-fixture')), 'Historical QA fixtures contaminated the actual archived source frame');
  const candidates = actual.usgs.records.filter(record => record.mag !== null && record.mag >= 1 && Math.abs(record.lat) < 70);
  const separation = (a, b) => {
    const deltaLon = Math.abs(((a.lon - b.lon + 540) % 360) - 180);
    return Math.hypot(a.lat - b.lat, deltaLon * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
  };
  const isolated = candidates.map(record => ({ record, nearest: Math.min(...actual.usgs.records.filter(other => other.id !== record.id).map(other => separation(record, other))) })).sort((a, b) => b.nearest - a.nearest)[0];
  const actualQuake = isolated?.record;
  check(actualQuake, 'Actual live feed has no suitable quake for native map selection');
  check(isolated.nearest > 0.25, 'Actual feed has no sufficiently separated quake marker for an unambiguous pixel pick');
  const actualPick = await pickQuake(actualQuake.id, actualQuake, 'Recorded earthquake');
  await capture('actual-observation');

  stage('checking delayed stale results and latest-cursor coalescing');
  await seek(f.emptyAt);
  await fault({ t: f.firstBothAt, delayMs: 1800 });
  await seek(f.firstBothAt, false);
  await waitFor(() => region()?.dataset.playbackPhase === 'loading' && map().alertCount === 0 && map().quakeCount === 0);
  check(map().active && map().alertCount === 0 && map().quakeCount === 0, 'Pending Replay showed live or previous hazards');
  await seek(f.firstNwsAt, false); await sleep(100); await seek(f.revisedAt, false);
  await waitFor(() => region()?.dataset.playbackPhase === 'ready' && map().cursor === f.revisedAt);
  check(map('quake', f.quakeId).positions.some(([lon, lat]) => Math.abs(lon - f.newQuake.lon) < 1e-7 && Math.abs(lat - f.newQuake.lat) < 1e-7), 'Late old response replaced the latest scrub');
  stage('checking an explicit timeline IPC failure and retry');
  await fault({ t: f.firstBothAt, error: true });
  await seek(f.firstBothAt, false);
  await waitFor(() => region()?.dataset.playbackPhase === 'error');
  check(map().active && map().alertCount === 0 && map().quakeCount === 0, 'Replay error revealed live or stale hazards');
  await capture('ipc-error');
  const retry = [...region().querySelectorAll('button')].find(item => /retry/i.test(item.textContent));
  check(retry, 'No retry action for a failed timeline query'); retry.click();
  await waitFor(() => region()?.dataset.playbackPhase === 'ready' && map().cursor === f.firstBothAt);
  stage('checking Exit with an outstanding historical response');
  await fault({ t: f.revisedAt, delayMs: 1800 });
  await seek(f.revisedAt, false);
  await waitFor(() => region()?.dataset.playbackPhase === 'loading');
  await closeReplay(); await sleep(2100);
  check(!map().active && !region() && map('quake', f.quakeId).positions.length === 0, 'A late result republished recorded hazards after Exit');

  stage('jumping from a real History row to its exact last-observed cursor');
  document.querySelector('button[aria-label="Playback / History"]').click();
  (await waitFor(() => button('Event history'))).click();
  const search = document.querySelector('input[aria-label="Search places, coordinates, U.S. addresses, saved locations and history"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'QA REPLAY FIXTURE earthquake revision 2');
  search.dispatchEvent(new Event('input', { bubbles: true }));
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const row = await waitFor(() => [...document.querySelectorAll('.history-table tbody tr')].find(item => item.textContent.includes('QA REPLAY FIXTURE earthquake revision 2')));
  const jump = [...row.querySelectorAll('button')].find(item => item.textContent.trim() === 'Replay at last observation');
  check(jump, 'History record has no shared Replay cursor action'); jump.click();
  await waitFor(() => region()?.dataset.playbackCursor === f.revisedAt && region()?.dataset.playbackPhase === 'ready' && map().cursor === f.revisedAt);
  await capture('history-jump');
  await pickQuake(f.quakeId, f.newQuake, 'Recorded earthquake');
  await closeReplay();
  const finalLive = await window.atlas.getState();
  await waitFor(() => map().quakeCount === finalLive.quakes.length && !map().active);
  check(!document.querySelector('.data-panel')?.textContent.includes('QA REPLAY FIXTURE'), 'Exit retained synthetic historical details as if live');
  await capture('restored-live');
  const errors = window.__atlasSmoke?.errors ?? [];
  check(errors.length === 0, `Renderer errors: ${JSON.stringify(errors)}`);
  const metadata = feed => ({ state: feed.state, observedAt: feed.observedAt, sourceUpdatedAt: feed.sourceUpdatedAt, scope: feed.scope, validUntil: feed.validUntil, reason: feed.reason, records: feed.records.length });
  return { result: 'PASS', historicalFixtures: context.fixture.label, historicalFixtureCacheClearedBeforeLaunch: true,
    hazardOnlyRange: range, checks: { retainedRevisions: true, unknownNotEmpty: true, recordedEmptyNotUnknown: true, expiredGap: true, partialDisclosed: true, failureGap: true,
      actualCesiumSelection: true, genuineLivePollDidNotReplaceHistoricalFrame: true, nativeMillisecondSliderBoundary: true, latestSeekWins: true, queryErrorKeepsReplayIsolated: true, retry: true, delayedResponseAfterExitDiscarded: true, exactHistoryJump: true, liveRestored: true },
    historical: { firstNwsAt: f.firstNwsAt, firstBothAt: f.firstBothAt, revisedAt: f.revisedAt, emptyAt: f.emptyAt, oldPick, newPick },
    actual: { cursor: actual.t, nws: metadata(actual.nws), usgs: metadata(actual.usgs), selectedQuake: actualQuake.id, selectedQuakeNearestAngularDegrees: isolated.nearest, actualPick },
    liveVerificationRecords: { nws: actual.nws.records.map(({ id, sent }) => ({ id, sent })), usgs: actual.usgs.records.map(({ id, mag, lat, lon, updated }) => ({ id, mag, lat, lon, updated })) },
    finalLiveCounts: { alerts: finalLive.alerts.length, quakes: finalLive.quakes.length }, rendererErrors: errors };
})().catch(error => { throw new Error(`[${window.__atlasTimelineQaStep ?? 'initializing'}] ${error.stack ?? error.message}`); })
