// Inspect the unchanged build's offline saved-place counts; do not substitute observations.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const waitFor = async (read) => {
    const end = Date.now() + 18e3;
    while (Date.now() < end) {
      const result = await read();
      if (result) return result;
      await sleep(100);
    }
    throw new Error("Location baseline timed out");
  };
  const button = (text) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
  const capture = async (label) => {
    window.__atlasLocationEvidenceCapture = label;
    await waitFor(() => window.__atlasLocationEvidenceCaptured === label);
  };
  const context = await waitFor(() => window.__atlasLocationEvidence && window.__atlasSmoke?.globeReady ? window.__atlasLocationEvidence : null);
  const snapshot = await waitFor(async () => {
    const snap = await window.atlas.getState();
    return ["nws", "usgs"].every((feed) => snap.feeds[feed].state === "error") ? snap : null;
  });
  const place = snapshot.locations.find((item) => item.name === context.placeName), evaluation = snapshot.evaluations[place.id];
  check(evaluation.nwsFreshness === "unavailable" && evaluation.usgsFreshness === "unavailable", "Expected no successful observations in either feed");
  document.querySelector('button[aria-label="Data"]').click();
  const data = await waitFor(() => document.querySelector(".data-panel"));
  const dataText = data.textContent;
  check(dataText.includes("Unavailable") && dataText.includes("None of your saved locations are inside an active alert."), "Before overview behavior has changed");
  await capture("data");
  document.querySelector('button[aria-label="Places"]').click();
  (await waitFor(() => [...document.querySelectorAll(".loc-item")].find((item) => item.textContent.includes(place.name)))).click();
  const details = await waitFor(() => [...document.querySelectorAll(".data-panel .details")].find((item) => item.querySelector("header h2")?.textContent === place.name));
  const detailText = details.textContent;
  check(detailText.includes("Unknown \u2014 weather alert data is unavailable.") && detailText.includes("Unknown \u2014 earthquake data is unavailable."), "Existing Details unknown state missing");
  details.scrollIntoView({ block: "start" });
  await capture("details");
  [...details.querySelectorAll("button")].find((item) => item.textContent.trim() === "Briefing").click();
  const modal = await waitFor(() => document.querySelector('[role="dialog"][aria-label="Location briefing"]'));
  const preview = await waitFor(() => modal.querySelector('[role="document"][aria-label="Briefing preview"]'));
  const summary = [...preview.querySelectorAll("table")][1];
  const summaryCells = [...summary.querySelectorAll("tr")][1].textContent;
  check([...summary.querySelectorAll("tr")][1].querySelectorAll("td")[1].textContent === "0", "Expected before weather zero in unavailable summary");
  check([...summary.querySelectorAll("tr")][1].querySelectorAll("td")[3].textContent.startsWith("0"), "Expected before earthquake zero in unavailable summary");
  const briefingText = preview.textContent;
  await capture("briefing");
  summary.scrollIntoView({ block: "center" });
  await capture("summary");
  for (const format of ["HTML", "PDF"]) {
    [...modal.querySelectorAll("button")].find((item) => item.textContent.trim() === "Export " + format + "\u2026").click();
    await waitFor(() => [...modal.querySelectorAll('[role="status"]')].some((item) => item.textContent.includes("Saved " + format)));
  }
  modal.querySelector('button[aria-label="Close"]').click();
  document.querySelector('button[aria-label="Analyst"]').click();
  (await waitFor(() => button("Which of my saved places intersect an active alert?"))).click();
  const analyst = await waitFor(() => document.querySelector('.page-panel[aria-label="Analyst"]'));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const analystText = analyst.textContent;
  await capture("analyst");
  check((window.__atlasSmoke?.errors ?? []).length === 0, "Renderer errors");
  return {
    result: "PASS",
    beforeState: true,
    savedPlace: { id: place.id, name: place.name },
    evaluation,
    summaryCells,
    missingFeedsDisplayedAsZeroInSummary: true,
    dataText: dataText.slice(0, 5e3),
    detailText: detailText.slice(0, 5e3),
    briefingText: briefingText.slice(0, 1e4),
    analystText: analystText.slice(-6e3),
    rendererErrors: window.__atlasSmoke?.errors ?? []
  };
})().then((result) => {
  window.__atlasLocationEvidenceDone = true;
  return result;
});
