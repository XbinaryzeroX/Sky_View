// Development smoke scenario. Uses real catalogs/media; explicitly injects DOM error events to check recovery.
// ATLAS_WATCH_SMOKE_JS=<absolute path to this file> npm.cmd run smoke -- <shot.png> 150000
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = fn(); if (value) return value; await sleep(200); }
    throw new Error('Camera QA condition timed out');
  };
  const button = (text, scope = document) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const selectMedia = async (value) => {
    const select = await waitFor(() => document.querySelector('select[aria-label="Media type"]'));
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
  };
  await window.atlas.updateSettings({ layersEnabled: ['cameras'] });
  window.__atlasDebug.setView(51.5074, -0.1278, 80000);
  window.__atlasDebug.setPage('cameras');
  let catalog;
  const until = Date.now() + 70000;
  do {
    catalog = (await window.atlas.getLayers()).find((s) => s.status.id === 'cameras');
    if (catalog?.status.state !== 'loading' && catalog?.records.length) break;
    await sleep(500);
  } while (Date.now() < until);
  const result = { records: catalog?.records.length ?? 0, catalogState: catalog?.status.state, note: catalog?.status.note, injectedErrors: true };
  if (!result.records) return { ...result, recoveryChecks: 'blocked: no real camera catalogs returned' };

  await selectMedia('viewer');
  const viewerRow = document.querySelector('.page-panel .rec-item');
  result.viewerFilter = !!viewerRow && viewerRow.textContent.includes('VIEWER');
  if (viewerRow) {
    viewerRow.click(); await sleep(300);
    result.viewerPlayer = !!document.querySelector('.cam-player a') && document.querySelector('.cam-badge')?.textContent === 'PUBLISHER VIEWER';
    button('Close', document.querySelector('.cam-open'))?.click(); await sleep(200);
  }
  await selectMedia('still');
  const stillRow = document.querySelector('.page-panel .rec-item');
  if (stillRow) {
    stillRow.click();
    const img = await waitFor(() => document.querySelector('.cam-player img'));
    await sleep(2500);
    result.realStillLoaded = img.complete && img.naturalWidth > 0;
    const firstSrc = img.src;
    img.dispatchEvent(new Event('error'));
    await sleep(100);
    result.stillFailureShown = !!button('Retry image');
    button('Retry image')?.click();
    const retried = await waitFor(() => document.querySelector('.cam-player img'));
    result.stillRetryNewRequest = retried.src !== firstSrc;
    await sleep(1500);
    result.realStillReloaded = retried.complete && retried.naturalWidth > 0;
    button('Close', document.querySelector('.cam-open'))?.click(); await sleep(200);
  }
  await selectMedia('hls');
  const videoRow = document.querySelector('.page-panel .rec-item');
  if (videoRow) {
    videoRow.click();
    const video = await waitFor(() => document.querySelector('.cam-player video'));
    await sleep(15000);
    result.realVideo = { time: video.currentTime, width: video.videoWidth, readyState: video.readyState, badge: document.querySelector('.cam-badge')?.textContent };
    // A deterministic decoder failure tests the existing retry control without inventing a camera record.
    for (let i = 0; i < 35; i++) video.dispatchEvent(new Event('error'));
    await sleep(100);
    result.streamFailureShown = !!button('Retry stream');
    button('Retry stream')?.click(); await sleep(300);
    result.streamRetryMounted = !!document.querySelector('.cam-player video:not([hidden])') && !button('Retry stream');
    await sleep(7000);
    result.afterRetry = { badge: document.querySelector('.cam-badge')?.textContent, time: document.querySelector('.cam-player video')?.currentTime ?? 0 };
  }
  result.rendererErrors = window.__atlasSmoke?.errors ?? [];
  result.publishers = [...new Set(catalog.records.map((r) => r.source))];
  return result;
})();
