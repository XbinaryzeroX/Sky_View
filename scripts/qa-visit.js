// Renderer scenario for the isolated visit-briefing desktop runner.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (condition, timeout = 18000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await condition();
      if (value) return value;
      await sleep(100);
    }
    throw new Error('Visit briefing desktop QA condition timed out');
  };
  const stage = value => { window.__atlasVisitQaStep = value; };
  const modal = () => document.querySelector('[role="dialog"][aria-modal="true"][aria-label$="briefing"]');
  const preview = () => modal()?.querySelector('[role="document"][aria-label="Briefing preview"]');
  const state = () => modal()?.querySelector('[data-briefing-state]')?.dataset.briefingState;
  const button = text => [...(modal() ?? document).querySelectorAll('button')].find(item => item.textContent.trim() === text);
  const plain = value => value.replace(/\s+/g, ' ').trim();
  const capture = async label => {
    window.__atlasVisitQaCapture = label;
    await waitFor(() => window.__atlasVisitQaCaptured === label);
  };
  const fill = async (field, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
  };
  const capturedAt = () => modal()?.querySelector('.briefing-preview-pane > p time')?.dateTime ?? null;
  const ready = async (mode, previousCaptured = null) => {
    await waitFor(async () => {
      const document = preview();
      if (state() !== 'ready' || !document?.querySelector('h1') || (previousCaptured && capturedAt() === previousCaptured)) return false;
      await sleep(100);
      return state() === 'ready' && preview() === document;
    });
    check(button(mode === 'visit' ? 'Since last visit' : 'Location briefing').getAttribute('aria-pressed') === 'true', 'Wrong briefing mode selected');
    const heading = preview().querySelector('h1');
    check(mode === 'visit' ? /since last visit/i.test(heading.textContent) : /location briefing/i.test(heading.textContent), 'Visible heading does not match mode');
    const rect = heading.getBoundingClientRect();
    check(rect.width > 0 && rect.height > 0 && getComputedStyle(heading).visibility !== 'hidden', 'Preview content exists but is not visibly rendered');
    check(preview().querySelectorAll('table').length >= 1, 'Briefing has no actual visible source/summary table');
    check(preview().dataset.briefingTruncated === 'false', 'Small test preview was unexpectedly truncated');
  };
  const clickForPreview = async (label, mode) => {
    const previousCaptured = capturedAt();
    button(label).click();
    await ready(mode, previousCaptured);
  };
  const choose = async mode => {
    const previousCaptured = capturedAt();
    button(mode === 'visit' ? 'Since last visit' : 'Location briefing').click();
    if (mode === 'locations' && (await window.atlas.getState()).locations.length === 0) {
      await waitFor(() => state() === 'empty');
    } else await ready(mode, previousCaptured);
  };
  let faultId = 0;
  const fault = async value => {
    window.__atlasVisitQaControl = { id: ++faultId, fault: value };
    await waitFor(() => window.__atlasVisitQaControlled === faultId);
  };
  const exported = [];
  const exportFile = async format => {
    const prior = window.__atlasVisitQaSavedHtml?.path;
    const target = button(format === 'html' ? 'Export HTML…' : 'Export PDF…');
    check(target && !target.disabled, 'Normal frozen export is unavailable');
    target.click();
    await waitFor(() => [...modal().querySelectorAll('[role="status"]')].some(item => item.textContent.includes('Saved ' + format.toUpperCase())), 35000);
    if (format === 'html') {
      const saved = await waitFor(() => window.__atlasVisitQaSavedHtml?.path !== prior ? window.__atlasVisitQaSavedHtml : null);
      const document = new DOMParser().parseFromString(saved.html, 'text/html');
      check(plain(document.body.textContent) === plain(preview().textContent), 'Saved HTML content differs from the actual visible preview');
      exported.push(saved.path);
    }
  };
  const context = await waitFor(() => window.__atlasVisitQa && window.__atlasSmoke?.globeReady ? window.__atlasVisitQa : null);
  if (context.large) {
    stage('checking explicit large-location regeneration without a huge preview DOM');
    document.querySelector('button[aria-label="Data"]').click();
    (await waitFor(() => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Briefing'))).click();
    await waitFor(() => state() === 'ready' && preview()?.dataset.briefingPolicy === 'current-locations');
    check(preview().textContent.includes('Large location briefing') && /regenerates.*when you export/.test(preview().textContent), 'Large-report regeneration limitation is hidden');
    check(preview().querySelectorAll('*').length < 20 && preview().textContent.length < 1200, 'Large report expanded into a huge preview DOM');
    await capture('large-fallback');
    const prior = window.__atlasVisitQaSavedHtml?.path;
    button('Export current HTML…').click();
    await waitFor(() => [...modal().querySelectorAll('[role="status"]')].some(item => item.textContent.includes('Saved HTML')), 35000);
    const saved = await waitFor(() => window.__atlasVisitQaSavedHtml?.path !== prior ? window.__atlasVisitQaSavedHtml : null);
    check(saved.html.length > 8 * 1024 * 1024 && saved.html.includes('QA large location 899'), 'Large HTML export was incomplete');
    return {result:'PASS',phase:context.phase,sourceMode:'900 explicitly synthetic locations; offline',largeReportHonestRegeneration:true,largePreviewBounded:true,exportedHtmlPaths:[saved.path],rendererErrors:window.__atlasSmoke?.errors??[]};
  }
  stage('opening a visit briefing with no saved places');
  if (context.phase !== 'offline') check((await window.atlas.getState()).locations.length === 0, 'Test must begin without saved places');
  document.querySelector('button[aria-label="Data"]').click();
  (await waitFor(() => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Briefing'))).click();
  await waitFor(() => button('Since last visit'));
  if (context.phase === 'offline') await choose('visit');
  await ready('visit');
  let pendingProviderObserved = false;
  if (context.phase === 'first') {
    const firstState = await window.atlas.getState();
    pendingProviderObserved = ['nws', 'usgs'].some(feed => firstState.feeds[feed].state === 'loading');
    check(pendingProviderObserved && preview().textContent.includes('Unknown'), 'Startup pending comparison was presented as known zero changes');
    await capture('startup-pending');
  }
  if (context.phase === 'offline') {
    stage('checking cached observations cannot masquerade as a new successful visit reply');
    const snapshot = await waitFor(async () => {
      const value = await window.atlas.getState();
      return ['nws', 'usgs'].every(feed => value.feeds[feed].state === 'error') ? value : null;
    });
    check(['nws', 'usgs'].some(feed => snapshot.feeds[feed].fromCache), 'Offline scenario did not restore genuine cached data');
    check(preview().textContent.includes('Unknown') && /unavailable|not recorded|failed/i.test(preview().textContent), 'Offline preview falsely suggests a complete comparison');
    await capture('offline');
    await exportFile('html');
  } else {
    const snapshot = await waitFor(async () => {
      const value = await window.atlas.getState();
      for (const feed of ['nws', 'usgs']) if (value.feeds[feed].state === 'error') throw new Error(feed + ' source unavailable: ' + value.feeds[feed].error);
      return ['nws', 'usgs'].every(feed => value.feeds[feed].state === 'ok' && !value.feeds[feed].fromCache) ? value : null;
    }, 60000);
    await clickForPreview('Refresh preview', 'visit');
    const headers = [...preview().querySelectorAll('th')].map(item => item.textContent.trim());
    for (const label of ['New', 'Updated', 'No longer returned']) check(headers.includes(label), 'Required visit change semantics missing: ' + label);
    await capture('ready');
    await exportFile('html');
    if (context.phase === 'first' || context.phase === 'second' || context.fixture === 'positive') await exportFile('pdf');

    if (context.phase === 'first') {
      stage('checking pending, mode switching, stale completion, failure and retry');
      await fault({ mode: 'visit', delayMs: 1200 });
      button('Refresh preview').click();
      await waitFor(() => state() === 'loading');
      check(!preview() && button('Export HTML…').disabled && button('Export PDF…').disabled, 'Pending preview retained stale content or enabled exports');
      await capture('pending-preview');
      await choose('locations');
      await sleep(1400);
      check(state() === 'empty' && button('Location briefing').getAttribute('aria-pressed') === 'true' && !preview(), 'A late visit result replaced the empty location mode');
      button('None').click();
      await waitFor(() => state() === 'empty');
      await choose('visit');
      await clickForPreview('Since last visit', 'visit');
      await fault({ mode: 'visit', error: true });
      button('Refresh preview').click();
      await waitFor(() => state() === 'error');
      check(!preview() && button('Export HTML…').disabled && /Briefing preview failed:.*Explicit visit QA/.test(modal().textContent), 'Preview error is not explicit or retained stale data');
      await capture('preview-error');
      button('Retry preview').click();
      await ready('visit');
    }

    if (context.phase === 'second') {
      stage('preserving the existing saved-location briefing and repeat controls');
      const place = await window.atlas.createLocation({ name: 'QA original location briefing', category: 'QA fixture place', notes: 'QA selected location notes', lat: 40.7128, lon: -74.006, radiusKm: 25 });
      await waitFor(async () => (await window.atlas.getState()).locations.some(item => item.id === place.id));
      button('Location briefing').click();
      await waitFor(() => state() === 'empty' && modal().textContent.includes(place.name));
      await clickForPreview('All', 'locations');
      check(preview().textContent.includes(place.name) && preview().textContent.includes('QA selected location notes'), 'Original location briefing content disappeared');
      await clickForPreview('Location briefing', 'locations');
      await clickForPreview('All', 'locations');
      button('None').click();
      await waitFor(() => state() === 'empty');
      button('None').click();
      await waitFor(() => state() === 'empty');
      await clickForPreview('All', 'locations');
      await capture('location-briefing');
      await exportFile('html');
      await exportFile('pdf');
      const legacy = await window.atlas.previewBriefing([place.id]);
      check(typeof legacy === 'string' && legacy.includes('Atlas Watch location briefing') && legacy.includes(place.name), 'Legacy location-preview overload failed');
      modal().querySelector('button[aria-label="Close"]').click();

      stage('routing an exact last-visit Analyst question to this briefing');
      document.querySelector('button[aria-label="Analyst"]').click();
      const question = await waitFor(() => document.querySelector('input[placeholder="Ask about loaded data…"]'));
      await fill(question, 'What changed since my last visit?');
      [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Ask').click();
      (await waitFor(() => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Open visit briefing'))).click();
      await ready('visit');
      check(!preview().textContent.includes('QA selected location notes'), 'Visit briefing leaked saved-place notes');
      await capture('analyst-route');
    }
    check(snapshot.locations.length === 0, 'Initial ordinary no-place comparison unexpectedly needed a saved place');
  }
  const errors = window.__atlasSmoke?.errors ?? [];
  check(errors.length === 0, 'Renderer errors: ' + JSON.stringify(errors));
  return { result: 'PASS', phase: context.phase, sourceMode: context.fixture ? context.fixtureLabel : 'real public NWS/USGS; offline phase uses genuine prior cache',
    noSavedPlacesRequired: true, actualPreviewHeadingsAndTablesVisible: true, frozenHtmlMatchesVisiblePreview: true, exportedHtmlPaths: exported,
    pendingProviderObserved, controlledPreviewRaceAndRetry: context.phase === 'first', originalLocationBriefingAndIdempotentControls: context.phase === 'second',
    analystLastVisitRoute: context.phase === 'second', rendererErrors: errors };
})().then(result => { window.__atlasVisitQaDone = true; return result; }).catch(async error => {
  console.error('VISIT_QA_FAILURE_DOM', [...document.querySelectorAll('[role="dialog"]')].map(item=>item.outerHTML.slice(0,12000)).join('\n') || document.body.textContent.slice(0,4000));
  window.__atlasVisitQaCapture = 'failure';
  const deadline=Date.now()+3000;while(window.__atlasVisitQaCaptured!=='failure'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  throw new Error(`[${window.__atlasVisitQaStep ?? 'initializing'}] ${error.stack ?? error.message}`);
});
