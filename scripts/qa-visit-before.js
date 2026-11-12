// Run only against the previous location-only build with an empty, temporary profile.
(async () => {
  async function waitFor(read) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = read();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Previous location briefing did not reach the expected state.');
  }

  await waitFor(() => window.__atlasSmoke?.globeReady);
  if ((await window.atlas.getState()).locations.length) throw new Error('Expected a fresh profile without saved places.');
  document.querySelector('button[aria-label="Data"]').click();
  const briefingButton = await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Briefing'));
  briefingButton.click();
  const modal = await waitFor(() => document.querySelector('[role="dialog"][aria-label="Location briefing"]'));
  const preview = await waitFor(() => {
    const frame = modal.querySelector('iframe[title="Briefing preview"]');
    return frame?.srcdoc.includes('Atlas Watch location briefing') && frame;
  });
  const exports = [...modal.querySelectorAll('button')].filter(button => /Export HTML|Export PDF/.test(button.textContent));
  if (exports.length !== 2 || exports.some(button => !button.disabled)) throw new Error('Unexpected location export availability.');
  if (!modal.textContent.includes('Add locations') || /Since last visit/i.test(modal.textContent)) throw new Error('Expected the previous location-only dialog.');
  return {
    result: 'PASS', beforeState: true, savedPlaces: 0, locationOnly: true, visitModePresent: false,
    exportsDisabled: true, previewHasLocationHeading: preview.srcdoc.includes('Atlas Watch location briefing'),
    rendererErrors: window.__atlasSmoke?.errors ?? [],
  };
})();
