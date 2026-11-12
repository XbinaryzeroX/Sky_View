// Explicit test-only geocoding replies. Never reaches a paid service or adds an in-app provider.
import assert from 'node:assert/strict';

export async function checkControlledGeocoding({ app, page, input, until, settle, capture, onProgress }) {
  const result = {
    evidenceKind: 'controlled UI/async fixtures; not real Census or Google observations',
    syntheticCredentialInTemporaryProfileOnly: true, realPaidRequests: 0,
    controls: [], blockedImagery: [],
  };
  onProgress?.(result);
  await page.route(/https:\/\/[^/]*googleapis\.com\//, async route => {
    const url = new URL(route.request().url());
    result.blockedImagery.push({ host: url.hostname, path: url.pathname });
    await route.abort('blockedbyclient');
  });
  await app.evaluate(() => {
    const nativeFetch = globalThis.fetch;
    globalThis.__placeQaRestoreFetch = () => { globalThis.fetch = nativeFetch; };
    globalThis.__placeQaControlled = { requests: [], pending: [], defer: false, blockedTiles: 0 };
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      const census = url.hostname === 'geocoding.geo.census.gov';
      const google = url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/geocode/json';
      const state = globalThis.__placeQaControlled;
      if (url.hostname === 'tile.googleapis.com') {
        state.blockedTiles++;
        return new Response('Explicit QA block: no real Google tile request sent', { status: 403 });
      }
      if (!census && !google) return nativeFetch(input, options);
      const entry = { provider: census ? 'Census' : 'Google', query: url.searchParams.get('address'), at: new Date().toISOString(), deferred: state.defer };
      state.requests.push(entry);
      if (state.defer) await new Promise(release => state.pending.push(release));
      const label = `CONTROLLED QA ${entry.provider} match — not a provider observation`;
      const body = census
        ? { result: { addressMatches: [{ matchedAddress: label, coordinates: { x: -77.0365, y: 38.8977 } }] } }
        : { status: 'OK', results: [{ formatted_address: label, geometry: { location: { lat: 25.2048, lng: 55.2708 } } }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });

  const optionButtons = page.locator('#search-results > li[role="option"] > button');
  async function fill(text) {
    await input.fill(text);
    await settle();
  }
  async function requestCount() {
    return app.evaluate(() => globalThis.__placeQaControlled.requests.length);
  }
  async function triggerCensus(text) {
    await fill(text);
    await optionButtons.filter({ hasText: 'Search U.S. address' }).click();
  }
  async function setDeferred(value) {
    const observed = await app.evaluate((_electron, value) => {
      if (typeof value !== 'boolean') throw new Error('QA deferred flag must be boolean');
      globalThis.__placeQaControlled.defer = value;
      return globalThis.__placeQaControlled.defer;
    }, value);
    assert.equal(observed, value);
  }
  async function releaseDeferred() {
    await app.evaluate(() => { for (const release of globalThis.__placeQaControlled.pending.splice(0)) release(); });
    await settle();
  }
  async function fastSwitchAndType(text, expectedGoogleMode) {
    // One renderer turn models typing immediately after the real control, before its IPC settles.
    const initial = await page.evaluate(text => {
      const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Satellite');
      const field = document.querySelector('input[role="combobox"][aria-controls="search-results"]');
      if (!button || !field) throw new Error('Normal Satellite/search controls are unavailable');
      window.__placeQaTransitionInput = field;
      const previousPressed = button.getAttribute('aria-pressed');
      button.click();
      field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, text);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return { previousPressed, typedBeforeRendererCommit: button.getAttribute('aria-pressed') === previousPressed };
    }, text);
    assert(initial.typedBeforeRendererCommit, 'Fast typing was not exercised before the imagery commit');
    await until(async () => await page.getByRole('button', { name: 'Satellite', exact: true }).getAttribute('aria-pressed') === String(expectedGoogleMode), 'fast provider mode committed');
    await until(async () => {
      const field = await input.evaluate(node => ({ sameInput: node === window.__placeQaTransitionInput,
        focused: document.activeElement === node, value: node.value, expanded: node.getAttribute('aria-expanded') }));
      return field.sameInput && field.focused && field.value === text && field.expanded === 'true' ? field : null;
    }, 'fast-typed input identity/focus/popup survive transition');
    const state = await input.evaluate(node => ({ sameInput: node === window.__placeQaTransitionInput,
      focused: document.activeElement === node, value: node.value, expanded: node.getAttribute('aria-expanded') }));
    result.controls.push({ name: expectedGoogleMode ? 'fast typing while entering Google mode' : 'focused query while leaving Google mode', ...initial, ...state });
  }
  async function waitCamera(lat, lon, heightM) {
    const camera = await until(async () => {
      const camera = await page.evaluate(() => window.__atlasDebug.camera());
      return camera && Math.abs(camera.lat - lat) < 0.0001 && Math.abs(camera.lon - lon) < 0.0001
        && Math.abs(camera.heightM - heightM) < 2 ? camera : null;
    }, 'controlled geocoding camera');
    assert(Math.abs(camera.heightM - heightM) < 2);
    return camera;
  }
  async function providersGoogle() {
    await input.press('Escape');
    await page.getByRole('button', { name: 'Providers', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Provider settings', exact: true });
    await dialog.waitFor({ state: 'visible' });
    return dialog.locator('section.provider').filter({ hasText: 'Google Maps Platform (Photoreal 3D + Satellite)' });
  }
  async function closeProviders() {
    // Saving/removing the browser key may reload this renderer to update its CSP.
    const dialog = page.getByRole('dialog', { name: 'Provider settings', exact: true });
    if (await dialog.isVisible()) {
      try { await dialog.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 3000 }); }
      catch (error) { if (await dialog.isVisible()) throw error; }
    }
    await input.waitFor({ state: 'visible' });
    await until(() => page.evaluate(() => !!window.__atlasDebug?.camera()), 'renderer ready after credential CSP update');
  }

  // No lookup per keystroke; only the explicit Census action starts a request.
  await fill('1600 Pennsylvania Ave NW Washington DC 20500');
  assert.equal(await requestCount(), 0);
  await optionButtons.filter({ hasText: 'Search U.S. address' }).click();
  const censusMatch = optionButtons.filter({ hasText: 'CONTROLLED QA Census match' });
  await censusMatch.waitFor({ state: 'visible' });
  assert.equal(await requestCount(), 1);
  await censusMatch.click();
  result.controls.push({ name: 'explicit Census lookup', camera: await waitCamera(38.8977, -77.0365, 2000) });
  await capture('controlled-census-flight');

  // A late reply may not replace a newer local query or reopen an escaped popup.
  await setDeferred(true);
  await triggerCensus('123 QA Deferred Street');
  await until(() => app.evaluate(() => globalThis.__placeQaControlled.pending.length), 'Census fixture pending');
  await fill('Tokyo');
  await releaseDeferred();
  assert.equal(await optionButtons.filter({ hasText: 'CONTROLLED QA Census match' }).count(), 0);
  await until(() => optionButtons.filter({ hasText: 'Tokyo' }).count(), 'newer local query displayed');
  result.controls.push({ name: 'late Census reply after changed query', staleResultsDiscarded: true });
  await fill('123 QA Deferred Street');
  assert.equal(await optionButtons.filter({ hasText: 'CONTROLLED QA Census match' }).count(), 0);
  result.controls.at(-1).returningToOriginalQueryDidNotResurrectReply = true;
  await triggerCensus('124 QA Escape Street');
  await until(() => app.evaluate(() => globalThis.__placeQaControlled.pending.length), 'escaped Census fixture pending');
  await input.press('Escape');
  await releaseDeferred();
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  result.controls.push({ name: 'late Census reply after Escape', remainedClosed: true });
  await setDeferred(false);

  // A saved synthetic key alone must not change an active neutral basemap's search provider.
  const provider = await providersGoogle();
  await provider.locator('input.cred-input').fill('QA_ONLY_NOT_A_REAL_GOOGLE_ACCOUNT_KEY_20261111');
  const keySavedReload = page.waitForEvent('domcontentloaded', { timeout: 12000 }).then(() => true, () => false);
  await provider.getByRole('button', { name: 'Save', exact: true }).click();
  assert(await keySavedReload, 'Expected credential CSP reload did not complete');
  await closeProviders();
  await until(async () => (await page.evaluate(() => window.atlas.listProviders())).some(provider => provider.id === 'google3d' && provider.userConfigured), 'synthetic credential saved in TEMP profile');
  await fill('Tokyo');
  assert.equal(await optionButtons.filter({ hasText: 'with Google' }).count(), 0);
  await until(() => optionButtons.filter({ hasText: 'Tokyo' }).count(), 'saved key keeps neutral imagery offline');
  result.controls.push({ name: 'neutral basemap with saved key', provider: 'bundled local catalog' });

  // Preserve a fast user's text/focus across the asynchronous provider transition.
  await fastSwitchAndType('CONTROLLED Google fast typing', true);
  const beforeGoogle = await requestCount();
  const googleAction = optionButtons.filter({ hasText: 'with Google' });
  await googleAction.waitFor({ state: 'visible' });
  assert.equal(await requestCount(), beforeGoogle);
  await capture('fast-google-transition');
  await googleAction.click();
  const googleMatch = optionButtons.filter({ hasText: 'CONTROLLED QA Google match' });
  await googleMatch.waitFor({ state: 'visible' });
  assert.equal(await requestCount(), beforeGoogle + 1);
  await googleMatch.click();
  result.controls.push({ name: 'explicit Google lookup under Google imagery', camera: await waitCamera(25.2048, 55.2708, 2000) });
  await capture('controlled-google-flight');

  // In-flight Google results become stale when the ordinary imagery control returns to local mode.
  await setDeferred(true);
  await fill('CONTROLLED delayed Google fixture');
  await optionButtons.filter({ hasText: 'with Google' }).click();
  await until(() => app.evaluate(() => globalThis.__placeQaControlled.pending.length), 'Google fixture pending');
  await fastSwitchAndType('CONTROLLED delayed Google fixture', false);
  await releaseDeferred();
  assert.equal(await optionButtons.filter({ hasText: 'CONTROLLED QA Google match' }).count(), 0);
  assert.equal(await optionButtons.filter({ hasText: 'with Google' }).count(), 0);
  result.controls.push({ name: 'late Google reply after imagery/query change', staleResultsDiscarded: true });
  await capture('stale-google-reply-excluded');

  await input.press('Escape');
  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
  await until(async () => (await page.evaluate(() => window.atlas.getState())).settings.basemap === 'google2d', 'Google imagery selected for no-key state');
  await until(async () => await page.getByRole('button', { name: 'Satellite', exact: true }).getAttribute('aria-pressed') === 'true', 'Google imagery renderer committed before key removal');
  const configured = await providersGoogle();
  const keyRemovedReload = page.waitForEvent('domcontentloaded', { timeout: 12000 }).then(() => true, () => false);
  await configured.getByRole('button', { name: 'Remove', exact: true }).click();
  assert(await keyRemovedReload, 'Expected key-removal CSP reload did not complete');
  await closeProviders();
  await until(async () => !(await page.evaluate(() => window.atlas.listProviders())).some(provider => provider.id === 'google3d' && provider.userConfigured), 'synthetic credential removed');
  await fill('Tokyo');
  await until(async () => (await page.locator('#search-results').innerText()).includes('Add your Google Maps key'), 'Google imagery without own key explains setup');
  assert.equal(await optionButtons.filter({ hasText: 'with Google' }).count(), 0);
  result.controls.push({ name: 'Google imagery without own key', lookupWithheldAndSetupExplained: true });
  await capture('google-needs-key');
  await input.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('combobox', { name: /^Globe surface/ }).selectOption('neutral');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await until(async () => (await page.evaluate(() => window.atlas.getState())).settings.basemap === 'neutral', 'neutral surface restored through Settings');
  const state = await app.evaluate(() => ({ requests: globalThis.__placeQaControlled.requests, pending: globalThis.__placeQaControlled.pending.length,
    mainGoogleTileRequestsBlocked: globalThis.__placeQaControlled.blockedTiles }));
  assert.equal(state.pending, 0);
  result.requests = state.requests;
  result.mainGoogleTileRequestsBlocked = state.mainGoogleTileRequestsBlocked;
  result.syntheticCredentialRemoved = true;
  await app.evaluate(() => globalThis.__placeQaRestoreFetch());
  result.result = 'PASS';
  return result;
}

/** One actual bounded public Census lookup, separate from all controlled replies above. */
export async function checkLiveCensus({ app, page, input, until, settle, capture, retainRaw }) {
  const result = { result: 'FAIL', provider: 'U.S. Census Geocoder',
    evidenceKind: 'actual official HTTPS response, passively observed and never replaced',
    query: '1600 Pennsylvania Ave NW, Washington, DC 20500', startedAt: new Date().toISOString() };
  try {
    assert.equal((await page.evaluate(() => window.atlas.getState())).settings.basemap, 'neutral');
    const before = await app.evaluate(() => globalThis.__placeQaGeocodingRequests.length);
    await input.fill(result.query);
    await settle();
    assert.equal(await app.evaluate(() => globalThis.__placeQaGeocodingRequests.length), before, 'Typing sent Census request');
    await page.locator('#search-results > li[role="option"] > button').filter({ hasText: 'Search U.S. address' }).click();
    const reply = await until(async () => {
      const replies = await app.evaluate(() => globalThis.__placeQaGeocodingRequests);
      const latest = replies.at(-1);
      if (latest?.error) throw new Error('Actual Census request failed: ' + latest.error);
      return replies.length > before && latest?.responseText ? latest : null;
    }, 'actual bounded Census reply', 25000);
    result.requestCount = await app.evaluate(() => globalThis.__placeQaGeocodingRequests.length) - before;
    assert.equal(result.requestCount, 1);
    assert.equal(reply.status, 200, 'Actual Census did not return HTTP200');
    result.rawReply = await retainRaw(reply.responseText);
    result.response = { host: reply.host, path: reply.path, status: reply.status, at: reply.at, receivedAt: reply.receivedAt };
    const rawMatches = JSON.parse(reply.responseText).result?.addressMatches;
    assert(Array.isArray(rawMatches) && rawMatches.length, 'Actual Census returned no usable public-address match');
    const first = rawMatches[0];
    assert(typeof first.matchedAddress === 'string' && Number.isFinite(first.coordinates?.x) && Number.isFinite(first.coordinates?.y));
    result.publisherMatch = { label: first.matchedAddress.trim(), lat: first.coordinates.y, lon: first.coordinates.x };
    const option = page.locator('#search-results > li[role="option"] > button').filter({ hasText: result.publisherMatch.label });
    await option.waitFor({ state: 'visible' });
    await capture('live-census-result');
    await option.click();
    result.camera = await until(async () => {
      const camera = await page.evaluate(() => window.__atlasDebug.camera());
      return camera && Math.abs(camera.lat - result.publisherMatch.lat) < 0.0001
        && Math.abs(camera.lon - result.publisherMatch.lon) < 0.0001 && Math.abs(camera.heightM - 2000) < 2 ? camera : null;
    }, 'real Census destination camera');
    assert(Math.abs(result.camera.heightM - 2000) < 2);
    await until(async () => (await page.locator('.hud').innerText()).includes(result.publisherMatch.lat.toFixed(4)), 'Census destination visible readout');
    await capture('live-census-flight');
    result.result = 'PASS';
  } catch (error) {
    result.failure = error.message;
  }
  result.finishedAt = new Date().toISOString();
  return result;
}

/** Actual Providers diagnostic controls against three explicitly simulated Census replies. */
export async function checkCensusDiagnostics({ app, page, input, until, capture, onProgress }) {
  const result = { result: 'FAIL', evidenceKind: 'controlled Census diagnostic responses; not publisher observations', cases: [] };
  onProgress?.(result);
  await app.evaluate(() => {
    const previous = globalThis.fetch;
    globalThis.__placeQaDiagnostic = { variant: 'nonzero', requests: 0, replies: [] };
    globalThis.__placeQaRestoreDiagnostic = () => { globalThis.fetch = previous; };
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      if (url.hostname !== 'geocoding.geo.census.gov') return previous(input, options);
      const state = globalThis.__placeQaDiagnostic;
      state.requests++;
      const addressMatches = state.variant === 'empty' ? [] : [{
        matchedAddress: 'CONTROLLED QA diagnostic fixture, not a real address',
        coordinates: state.variant === 'malformed' ? { x: null, y: null } : { x: -77.0365, y: 38.8977 },
      }];
      state.replies.push({ variant: state.variant, addressMatches });
      return new Response(JSON.stringify({ result: { addressMatches } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  await input.press('Escape');
  await page.getByRole('button', { name: 'Providers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Provider settings', exact: true });
  const census = dialog.locator('section.provider').filter({ hasText: 'U.S. Census Geocoder' });
  let lastTestAt = null;
  for (const variant of ['nonzero', 'malformed', 'empty']) {
    const selected = await app.evaluate((_electron, variant) => {
      if (!['nonzero', 'malformed', 'empty'].includes(variant)) throw new Error('QA Census fixture variant is invalid');
      globalThis.__placeQaDiagnostic.variant = variant;
      return globalThis.__placeQaDiagnostic.variant;
    }, variant);
    assert.equal(selected, variant);
    await census.getByRole('button', { name: 'Test connection', exact: true }).click();
    const test = await until(async () => {
      const provider = (await page.evaluate(() => window.atlas.listProviders())).find(provider => provider.id === 'census-geocoder');
      return provider?.lastTest && provider.lastTest.at !== lastTestAt ? provider.lastTest : null;
    }, 'Census diagnostic ' + variant);
    lastTestAt = test.at;
    assert.equal(test.ok, variant !== 'malformed');
    if (variant === 'nonzero') assert(/1 usable.*WGS84/i.test(test.message));
    if (variant === 'malformed') assert(/without a usable|incomplete/i.test(test.message));
    if (variant === 'empty') assert(/valid empty.*no navigation position/i.test(test.message));
    await until(async () => (await census.innerText()).includes(test.message), 'diagnostic result actually visible');
    result.cases.push({ variant, ...test });
    await capture('census-diagnostic-' + variant);
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  result.requests = await app.evaluate(() => globalThis.__placeQaDiagnostic.requests);
  assert.equal(result.requests, 3);
  await app.evaluate(() => globalThis.__placeQaRestoreDiagnostic());
  result.result = 'PASS';
  return result;
}
