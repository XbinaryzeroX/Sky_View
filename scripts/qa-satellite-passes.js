// Development smoke scenario. Run only through scripts/smoke.mjs's temporary profile/database.
// Uses the real connected CelesTrak catalog, never the historic orbital fixtures used by unit tests.
// ATLAS_WATCH_SMOKE_JS=<absolute path> npm.cmd run smoke -- <screenshot.png> 120000
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await fn(); if (value) return value; await sleep(100); }
    throw new Error('Satellite pass QA condition timed out');
  };
  const input = async (label, value) => {
    const field = await waitFor(() => document.querySelector(`input[aria-label="${label}"]`));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
  };
  const section = () => document.querySelector('section[aria-labelledby="satellite-passes-title"]');
  const calculate = async () => {
    const b = [...section().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Calculate passes');
    if (!b || b.disabled) throw new Error('Satellite pass calculate control is unavailable');
    b.click();
    await sleep(50); // let React clear any previous observer's result before checking this request
    const status = await waitFor(() => section()?.querySelector('[role="status"]'));
    const text = status.textContent;
    if (/could not|timed out|unavailable|invalid|malformed|decayed/i.test(text)) throw new Error(text);
    if (/more than 14 days/.test(text)) return { status: 'blocked', reason: text };
    if (!/Calculated/.test(text)) throw new Error(`Unexpected pass result: ${text}`);
    return { status: 'calculated', passCount: status.querySelectorAll('ol.rec-list > li').length, noPass: /No predicted passes/.test(text), text: text.slice(0, 700) };
  };
  await window.atlas.updateSettings({ layersEnabled: ['satellites'] });
  window.__atlasDebug.setPage('globe');
  const catalog = await waitFor(async () => {
    const layer = (await window.atlas.getLayers()).find((s) => s.status.id === 'satellites');
    if (layer?.records.some((r) => r.tle)) return layer;
    if (layer?.status.state === 'error') throw new Error(`CelesTrak unavailable: ${layer.status.error}`);
    return null;
  }, 60000);
  const now = Date.now();
  const fresh = catalog.records.filter((r) => r.tle && Math.abs(now - Date.parse(r.observedAt)) < 12 * 86400_000);
  const record = fresh.find((r) => r.id === '25544') ?? fresh[0] ?? catalog.records.find((r) => r.tle);
  window.__atlasDebug.select('satellites', record.id);
  await waitFor(section);
  await input('Observer latitude', '40.7128');
  await input('Observer longitude', '-74.0060');
  const manual = await calculate();
  const state = await window.atlas.getState();
  const place = state.locations.find((p) => p.name === '観測地点 · Antimeridian' && p.lat === -17 && p.lon === 180) ??
    await window.atlas.createLocation({ name: '観測地点 · Antimeridian', category: 'QA observer', notes: 'Temporary smoke database only', lat: -17, lon: 180, radiusKm: 10 });
  const observer = await waitFor(() => {
    const select = section()?.querySelector('select[aria-label="Pass observer"]');
    return select && [...select.options].some((option) => option.value === place.id) ? select : null;
  });
  observer.value = place.id;
  observer.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);
  const savedPlace = await calculate();
  section().scrollIntoView({ block: 'start' });
  await sleep(300);
  return { source: record.source, satellite: record.label, id: record.id, elementEpoch: record.observedAt, manual, savedPlace, savedNameShown: observer.options[observer.selectedIndex].textContent === place.name, rendererErrors: window.__atlasSmoke?.errors ?? [] };
})();
