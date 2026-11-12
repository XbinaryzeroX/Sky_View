// Browser scenario used only by check-area-watch-ui.mjs in its isolated TEMP profile.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const waitFor = async (fn, timeout = 40000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(150); }
    throw new Error('Area watch desktop QA condition timed out');
  };
  const state = () => window.atlas.getState();
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const capture = async label => {
    window.__atlasAreaWatchQaCapture = label;
    await waitFor(() => window.__atlasAreaWatchQaCaptured === label, 10000);
  };
  const context = await waitFor(() => window.__atlasAreaWatchQa);
  window.__atlasAreaWatchQaStep = 'waiting for the real provider/local evaluation';
  const loaded = await waitFor(async () => {
    const snap = await state();
    if (snap.feeds.usgs.state === 'error') throw new Error(`USGS ${context.mode} source unavailable: ${snap.feeds.usgs.error}`);
    if (snap.areaWatches.error) throw new Error(`Local watch evaluation failed: ${snap.areaWatches.error}`);
    return snap.feeds.usgs.state === 'ok' && !snap.feeds.usgs.fromCache && snap.areaWatches.lastEvaluatedAt ? snap : null;
  });
  check(!loaded.areaWatches.error, `Local evaluation failed: ${loaded.areaWatches.error}`);
  check(loaded.areaWatches.rules.length === (context.restart ? 4 : 3), 'Unexpected isolated seeded rule count');
  check(context.seed.providerRecordsSeeded === 0, 'Seed operation introduced provider data');
  const sourceUpdatedAt = loaded.feeds.usgs.sourceUpdatedAt;
  const sourceClockDifferenceMs = sourceUpdatedAt ? Date.parse(loaded.generatedAt) - Date.parse(sourceUpdatedAt) : null;
  const clockNote = sourceClockDifferenceMs !== null && Math.abs(sourceClockDifferenceMs) > 6 * 3600_000
    ? 'Publisher generation timestamp differs from environment by more than six hours; this is a real retrieved response, not proof of current-world freshness.'
    : 'Publisher and environment timestamps are recorded independently.';
  window.__atlasDebug.setPage('globe');
  await waitFor(() => window.__atlasSmoke?.globeReady);

  if (context.restart) {
    const baseline = context.baseline;
    for (const before of baseline.finalEvents) {
      const after = loaded.areaWatches.events.find(event => event.id === before.id);
      check(after && after.read === before.read, 'Event identity/read state was not preserved across restart');
      check(loaded.areaWatches.events.filter(event => event.areaId === before.areaId && event.quakeId === before.quakeId).length === 1, 'Restart duplicated an already saved quake match');
    }
    check(loaded.areaWatches.rules.find(rule => rule.areaId === 'qa-watch-created-in-ui')?.minMagnitude === 3.25, 'Edited rule was not preserved');
    const uniquePairs = new Set(loaded.areaWatches.events.map(event => event.areaId + '\0' + event.quakeId));
    check(uniquePairs.size === loaded.areaWatches.events.length, 'Duplicate area/event pairs after restart');
    document.querySelector('button[title="Notifications"]').click();
    await capture('restart');
    check((window.__atlasSmoke?.errors ?? []).length === 0, 'Renderer errors after restart');
    return { result: 'PASS', mode: context.mode, restartPersistentDedup: true, readStatePreserved: true,
      preservedEvidence: baseline.finalEvents.length, currentEvidence: loaded.areaWatches.events.length,
      sourceUpdatedAt, environmentNow: loaded.generatedAt, sourceClockDifferenceMs, clockNote, rendererErrors: window.__atlasSmoke?.errors ?? [] };
  }

  const initialEvents = loaded.areaWatches.events;
  check(initialEvents.every(event => event.quakeTime > context.seed.activationClock && event.quakeTime <= loaded.generatedAt), 'Evidence admitted events outside the seeded activation/environment time bounds');
  if (context.mode === 'fixture') check(initialEvents.length === 3, 'Explicit fixture adapter should produce exactly three initial matches');
  // Create a fourth watch through the real existing map-tools form, at the actual clock.
  window.__atlasAreaWatchQaStep = 'opening existing map tools and adding a new watch';
  document.querySelector('button[aria-label="Map tools"]').click();
  const newWatchToggle = await waitFor(() => document.querySelector('button[aria-label="USGS epicenter watch for QA new watch — no backfill"]'));
  newWatchToggle.click();
  const control = newWatchToggle.closest('.area-watch-control');
  const threshold = await waitFor(() => control.querySelector('input[type="number"]'));
  const setThreshold = async value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(threshold, value);
    threshold.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100);
  };
  const submit = () => control.querySelector('button[type="submit"]').click();
  await setThreshold('-2'); submit();
  const created = await waitFor(async () => (await state()).areaWatches.rules.find(rule => rule.areaId === 'qa-watch-created-in-ui'));
  await sleep(350);
  check(created.armedAt > context.seed.activationClock, 'UI created a watch at the seeded prior clock');
  check(!(await state()).areaWatches.events.some(event => event.areaId === created.areaId), 'Creating a new rule backfilled prior quakes');
  window.__atlasAreaWatchQaStep = 'refreshing after activation and checking no backlog';
  await window.atlas.refresh('usgs');
  const refreshed = await state();
  check(refreshed.feeds.usgs.state === 'ok', `Post-activation USGS refresh failed: ${refreshed.feeds.usgs.error}`);
  check(!refreshed.areaWatches.error, `Post-activation local check failed: ${refreshed.areaWatches.error}`);
  // Any legitimately new event after activation is allowed; old-window backfill is not.
  check(refreshed.areaWatches.events.filter(event => event.areaId === created.areaId).every(event => event.quakeTime > created.armedAt), 'A refreshed source backfilled an occurrence preceding activation');
  const checkbox = control.querySelector('input[type="checkbox"]');
  window.__atlasAreaWatchQaStep = 'pausing, editing and re-enabling the watch';
  checkbox.click(); await sleep(100); submit();
  const paused = await waitFor(async () => {
    const value = (await state()).areaWatches.rules.find(rule => rule.areaId === created.areaId);
    return value && !value.enabled ? value : null;
  });
  await sleep(350);
  check(paused.armedAt === created.armedAt, 'Pausing changed the prior activation baseline');
  await setThreshold('3.25'); submit();
  const edited = await waitFor(async () => {
    const value = (await state()).areaWatches.rules.find(rule => rule.areaId === created.areaId);
    return value?.minMagnitude === 3.25 && !value.enabled ? value : null;
  });
  await sleep(350);
  checkbox.click(); await sleep(100); submit();
  const reenabled = await waitFor(async () => {
    const value = (await state()).areaWatches.rules.find(rule => rule.areaId === created.areaId);
    return value?.enabled && value.armedAt >= edited.armedAt ? value : null;
  });
  check(reenabled.armedAt > created.armedAt, 'Re-enabling did not start a new watch baseline');
  control.scrollIntoView({ block: 'center' });
  await capture('controls');
  // Bell/details/focus are conditional on genuine observed evidence, never fabricated in live mode.
  let detail = null;
  if (initialEvents.length) {
    window.__atlasAreaWatchQaStep = 'opening saved evidence in the bell';
    document.querySelector('button[aria-label="Map tools"]').click();
    document.querySelector('button[title="Notifications"]').click();
    const target = await waitFor(() => [...document.querySelectorAll('.bell-pop button.rec-item')].find(item => item.textContent.includes(initialEvents[0].quakeId)));
    await capture('bell');
    target.click();
    await waitFor(() => document.body.textContent.includes('Saved earthquake match') && document.body.textContent.includes(initialEvents[0].quakeId));
    check(document.body.textContent.includes('Rule at detection'), 'Saved evidence details lost the threshold');
    window.__atlasDebug.setView(0, 0, 400000);
    await sleep(600);
    (await waitFor(() => button('Focus on recorded epicenter'))).click();
    window.__atlasAreaWatchQaStep = 'checking actual camera focus on the recorded epicenter';
    const focused = await waitFor(() => {
      const center = window.__atlasDebug.viewCenter();
      if (!center) return null;
      const deltaLon = Math.abs(((center.lon - initialEvents[0].lon + 540) % 360) - 180);
      return Math.abs(center.lat - initialEvents[0].lat) < 0.05 && deltaLon < 0.05 ? center : null;
    }, 12000);
    await capture('details');
    detail = { savedEvidenceOpened: true, focused, quakeId: initialEvents[0].quakeId };
    document.querySelector('button[title="Notifications"]').click();
    window.__atlasAreaWatchQaStep = 'marking all saved evidence read';
    await sleep(350);
    const markRead = button('Mark all area matches read');
    if (markRead) markRead.click();
    await waitFor(async () => (await state()).areaWatches.events.every(event => event.read));
    await capture('read');
  }
  const final = await state();
  const errors = window.__atlasSmoke?.errors ?? [];
  check(errors.length === 0, `Renderer errors: ${JSON.stringify(errors)}`);
  return { result: initialEvents.length ? 'PASS' : 'LIVE_NO_QUALIFYING_MATCHES', mode: context.mode,
    providerData: context.mode === 'live' ? 'actual USGS response' : 'explicit controlled desktop QA fixture',
    simulatedPriorActivation: context.seed.activationClock, providerRecordsSeeded: 0,
    sourceUpdatedAt, environmentNow: final.generatedAt, sourceClockDifferenceMs, clockNote,
    sourceCount: loaded.feeds.usgs.recordCount, initialEvents, finalEvents: final.areaWatches.events,
    uiCreation: true, noPriorOccurrenceBackfill: true, pause: true, thresholdEdit: 3.25, reenable: true,
    detail, markAllRead: initialEvents.length > 0, rendererErrors: errors };
})().catch(error => { throw new Error(`[${window.__atlasAreaWatchQaStep ?? 'initializing'}] ${error.stack ?? error.message}`); })
