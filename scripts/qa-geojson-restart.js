// Run with the same isolated profile/database as qa-geojson.js, after that app has exited.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const all = await window.atlas.listAnnotations();
  if (all.length !== 4 || !all.some(item => item.id === 'qa-existing-annotation') || !all.some(item => item.name === 'ケープタウン / Кейптаун')) throw new Error('Imported annotations did not survive restart');
  document.querySelector('button[aria-label="Map tools"]').click();
  await sleep(1500);
  if (document.querySelectorAll('.anno-list > li').length !== 4) throw new Error('Restarted Tools did not render persisted annotations');
  const errors = window.__atlasSmoke?.errors ?? [];
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { result: 'PASS', restartPersisted: true, annotationCount: all.length, rendererErrors: errors };
})()
