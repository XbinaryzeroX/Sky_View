// Development smoke scenario; real NASA DescribeDomains responses, no substituted metadata or tiles.
// ATLAS_WATCH_SMOKE_JS=<absolute path> npm.cmd run smoke -- <screenshot.png> 90000
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 25000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = fn(); if (value) return value; await sleep(100); }
    throw new Error('Imagery date QA condition timed out');
  };
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  window.__atlasDebug.setPage('globe');
  await sleep(300);
  let tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith('Imagery'));
  if (!tab) {
    const layers = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Layers');
    layers?.click();
    tab = await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith('Imagery')));
  }
  tab.click();
  const select = await waitFor(() => document.querySelector('.imagery-tab select'));
  const choose = async (id) => {
    const option = [...select.options].find((o) => o.value.endsWith(`|${id}`));
    if (!option) throw new Error(`Missing existing catalog product ${id}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => {
      const panel = document.querySelector('.imagery-tab');
      const status = panel?.querySelector('[role="status"]')?.textContent ?? '';
      const selected = panel?.textContent.includes(`NASA GIBS · ${id}`);
      if (selected && !status.includes('Checking dates') && (status.includes('Keeping the bundled date bounds') || status.includes('Keeping the last checked availability'))) {
        throw new Error(`Imagery source availability failed: ${status}`);
      }
      return selected && status.includes('Availability checked') && !status.includes('Checking dates');
    });
    await sleep(200);
  };
  const values = () => ({
    dates: [...document.querySelectorAll('.imagery-tab input[type="date"]')].map((input) => ({ value: input.value, min: input.min, max: input.max })),
    status: document.querySelector('.imagery-tab [role="status"]')?.textContent,
  });
  await choose('MODIS_Terra_CorrectedReflectance_TrueColor');
  button('Latest')?.click(); await sleep(100);
  const terra = values();
  const input = document.querySelector('.imagery-tab input[type="date"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2025-11-08');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(100);
  button('Next date')?.click(); await sleep(100);
  const gapNavigation = values();
  await choose('GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI');
  button('Latest')?.click(); await sleep(100);
  const historical = values();
  const result = {
    terra, gapNavigation, historical,
    checks: {
      sourceLatestBeyondBundle: terra.dates[0]?.max > '2026-11-10',
      latestMatchesSource: terra.dates[0]?.value === terra.dates[0]?.max,
      historicalClosed: historical.dates[0]?.max < '2023-01-01' && historical.dates[0]?.value === historical.dates[0]?.max,
      skippedSourcePeriodDisclosed: historical.status?.includes('malformed source period'),
      previousNextSkipKnownGap: gapNavigation.dates[0]?.value === '2025-11-10',
    },
    rendererErrors: window.__atlasSmoke?.errors ?? [],
  };
  const failed = Object.entries(result.checks).filter(([, passed]) => passed !== true).map(([name]) => name);
  if (result.rendererErrors.length) failed.push('rendererErrors');
  if (failed.length) throw new Error(`Imagery date QA failed (${failed.join(', ')}): ${JSON.stringify(result)}`);
  // Leave product, checked availability and date controls visible in the final capture.
  const panel = document.querySelector('.imagery-tab');
  panel?.closest('.floating-panel-body')?.scrollTo({ top: 0, behavior: 'instant' });
  window.__atlasDebug.setView(0, 0, 18000000);
  await sleep(2500);
  const health = document.querySelector('[data-imagery-health]');
  const rasterState = () => {
    const section = document.querySelector('[data-imagery-health]');
    return { text: section?.textContent, dates: [...(section?.querySelectorAll('[data-imagery-date]') ?? [])].map((row) => ({ date: row.dataset.imageryDate, loaded: Number(row.dataset.imageryLoaded), failed: Number(row.dataset.imageryFailed) })) };
  };
  await waitFor(() => rasterState().dates.some((row) => row.date === historical.dates[0]?.value && row.failed > 0));
  result.tileAvailability = rasterState();
  if (!health || (result.tileAvailability.dates.some((row) => row.failed > 0) && !health.textContent.includes('may be unavailable'))) {
    throw new Error(`Imagery tile status was not disclosed: ${JSON.stringify(result)}`);
  }
  result.checks.latestTileFailureDisclosed = result.tileAvailability.text.includes('may be unavailable');
  // This is an explicit test selection of an older date, never an automatic production fallback.
  const olderInput = document.querySelector('.imagery-tab input[type="date"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(olderInput, '2022-07-01');
  olderInput.dispatchEvent(new Event('input', { bubbles: true }));
  olderInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => rasterState().dates.some((row) => row.date === '2022-07-01' && row.loaded > 0));
  result.olderDate = values();
  result.olderRaster = rasterState();
  result.checks.olderDateActuallyLoads = result.olderDate.dates[0]?.value === '2022-07-01' && result.olderRaster.dates.some((row) => row.date === '2022-07-01' && row.loaded > 0);
  result.rendererErrors = window.__atlasSmoke?.errors ?? [];
  const finalFailures = Object.entries(result.checks).filter(([, passed]) => passed !== true).map(([name]) => name);
  if (result.rendererErrors.length) finalFailures.push('rendererErrors');
  if (finalFailures.length) throw new Error(`Imagery date/raster QA failed (${finalFailures.join(', ')}): ${JSON.stringify(result)}`);
  document.querySelector('.imagery-tab input[type="date"]')?.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(1000);
  return result;
})();
