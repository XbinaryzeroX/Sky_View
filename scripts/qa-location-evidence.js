// Real renderer workflow; provider observations are explicitly synthetic in this fixture profile.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const waitFor = async (read) => {
    const end = Date.now() + 18e3;
    while (Date.now() < end) {
      const value = await read();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Location evidence QA timed out at " + window.__atlasLocationStep);
  };
  const stage = (value) => {
    window.__atlasLocationStep = value;
  };
  const capture = async (label) => {
    window.__atlasLocationEvidenceCapture = label;
    await waitFor(() => window.__atlasLocationEvidenceCaptured === label);
  };
  const context = await waitFor(() => window.__atlasLocationEvidence && window.__atlasSmoke?.globeReady ? window.__atlasLocationEvidence : null);
  stage("waiting for committed feed states");
  const snapshot = await waitFor(async () => {
    const snap = await window.atlas.getState();
    return ["nws", "usgs"].every((feed) => snap.feeds[feed].state === context.expectedStates[feed]) ? snap : null;
  });
  const primary = snapshot.locations.find((place) => place.name === context.primaryName);
  const evaluation = snapshot.evaluations[primary.id];
  if (context.kind === "mixed") {
    check(snapshot.feeds.nws.coverage.completeness === "partial" && !snapshot.feeds.nws.fromCache, "Current partial NWS reply was not established");
    check(snapshot.feeds.usgs.fromCache && snapshot.freshness.usgs === "stale", "Expected stale genuine fixture cache");
    check(evaluation.alertsInside.length === 1 && evaluation.alertsUnknown.length === 1 && evaluation.quakesNearby.length === 1, "Positive polygon, unknown county type or cached quake was lost");
  }
  if (context.kind === "restart") {
    check(snapshot.feeds.nws.coverage.completeness === "partial" && snapshot.feeds.nws.fromCache, "Partial coverage was not persisted across restart");
    for (const feed of ["nws", "usgs"]) check(snapshot.feeds[feed].lastSuccessAt === context.expectedObservations[feed], "Restart relabeled the observation time");
    check(evaluation.alertsInside.length === 1 && evaluation.quakesNearby.length === 1, "Restart discarded observed positive matches");
  }
  if (context.kind === "expired-cache") {
    check(snapshot.feeds.nws.fromCache && snapshot.freshness.nws === "stale", "Expired fixture did not restore stale NWS cache");
    check(evaluation.nwsHistorical && evaluation.nwsLifecycleAt === snapshot.feeds.nws.lastSuccessAt, "Historical match did not use core receipt time");
    check(evaluation.alertsInside.length === 1, "A previously valid positive was erased at wall-clock expiry");
  }
  if (context.kind === "partial-zero") for (const feed of ["nws", "usgs"]) check(snapshot.feeds[feed].coverage.completeness === "partial", "Invalid omitted feature did not mark partial");
  document.querySelector('button[aria-label="Data"]').click();
  const data = await waitFor(() => document.querySelector(".data-panel"));
  const dataText = data.textContent;
  if (context.kind === "expired-cache") check(dataText.includes("2 last observed; current unknown"), "Global NWS overview erased valid-at-retrieval cached records");
  if (context.kind !== "complete-empty") check(!dataText.includes("None of your saved locations are inside an active alert."), "Incomplete or absent evidence produced a blanket negative in Data");
  await capture("data");
  document.querySelector('button[aria-label="Places"]').click();
  const selectPrimary = async () => {
    (await waitFor(() => [...document.querySelectorAll(".loc-item")].find((item) => item.textContent.includes(primary.name)))).click();
    return waitFor(() => [...document.querySelectorAll(".data-panel .details")].find((item) => item.querySelector("header h2")?.textContent === primary.name));
  };
  let details = await selectPrimary();
  const detailText = details.textContent;
  const evidence = [...details.querySelectorAll("[data-monitoring-source]")].map((item) => ({ source: item.dataset.monitoringSource, state: item.dataset.monitoringState, text: item.textContent }));
  check(evidence.length === 2, "Selected Details lacks independent feed evidence");
  if (["mixed", "restart", "expired-cache"].includes(context.kind)) {
    check(detailText.includes("QA SYNTHETIC EVIDENCE polygon alert") && detailText.includes("QA SYNTHETIC EVIDENCE earthquake"), "Observed positive lists were hidden");
    check(/last.observed/i.test(detailText) && /current.*unknown/i.test(detailText), "Historical matches are presented as current counts");
    if (context.kind === "mixed") check(detailText.includes("\u22651"), "Partial current positive lacks a lower-bound label");
    stage("opening actual fixture source Details through normal selected-place lists");
    [...details.querySelectorAll("button.rec-item")].find((item) => item.textContent.includes("QA SYNTHETIC EVIDENCE polygon alert")).click();
    await waitFor(() => document.querySelector(".data-panel").textContent.includes("qa-location-polygon"));
    await capture("alert-source");
    details = await selectPrimary();
    [...details.querySelectorAll("button.rec-item")].find((item) => item.textContent.includes("QA SYNTHETIC EVIDENCE earthquake")).click();
    await waitFor(() => document.querySelector(".data-panel").textContent.includes("qa-location-quake"));
    await capture("quake-source");
    details = await selectPrimary();
  } else if (context.kind === "complete-empty") {
    check(details.querySelector('[data-monitoring-source="NWS"]').dataset.monitoringState === "current", "Complete empty reply is not current");
    check(/No active alerts confirmed/.test(detailText) && /None in the current feed window/.test(detailText), "Complete current zero was lost");
  } else check(/Unknown/.test(detailText) && !/No active alerts confirmed|None in the current feed window/.test(detailText), "Unknown evidence is displayed as an assured zero");
  details.scrollIntoView({ block: "start" });
  await capture("details");
  [...details.querySelectorAll("button")].find((item) => item.textContent.trim() === "Briefing").click();
  const modal = await waitFor(() => document.querySelector('[role="dialog"][aria-label="Location briefing"]'));
  // Include the independent outside-coverage/zero control using the ordinary All action.
  await waitFor(() => modal.textContent.includes(context.secondaryName));
  const previousCaptured = modal.querySelector(".briefing-preview-pane > p time")?.dateTime ?? null;
  [...modal.querySelectorAll("button")].find((item) => item.textContent.trim() === "All").click();
  const preview = await waitFor(() => {
    const document2 = modal.querySelector('[data-briefing-state="ready"] [role="document"]');
    const captured = modal.querySelector(".briefing-preview-pane > p time")?.dateTime ?? null;
    return document2 && captured && captured !== previousCaptured ? document2 : null;
  });
  const summary = preview.querySelectorAll("table")[1];
  const rows = [...summary.querySelectorAll("tr")].slice(1).map((row2) => [...row2.querySelectorAll("td")].map((cell) => cell.textContent.trim()));
  check(rows.length === 2, "Both saved-place summary rows were not rendered");
  const row = rows.find((item) => item[0] === primary.name), other = rows.find((item) => item[0] === context.secondaryName);
  if (context.kind === "mixed") check(row[1].includes("\u22651") && /1 last observed.*current unknown/.test(row[3]), "Mixed summary lost lower-bound/current-unknown distinction");
  else if (["restart", "expired-cache"].includes(context.kind)) check(/≥1.*current unknown/.test(row[1]) && /1 last observed.*current unknown/.test(row[3]), "Historical summary promoted cached evidence to current");
  else if (context.kind === "complete-empty") {
    check(row[1] === "0" && row[3].startsWith("0"), "Complete current zero should remain an exact zero");
    check(other[1].includes("Unknown"), "Outside NWS coverage asserted no alerts");
  } else check(row[1].includes("Unknown") && row[2].includes("Unknown") && row[3].includes("Unknown"), "Missing/partial-zero summary is not unknown");
  const briefingText = preview.textContent;
  summary.scrollIntoView({ block: "center" });
  await capture("summary");
  const summaryBounds = summary.getBoundingClientRect(), previewBounds = preview.getBoundingClientRect();
  check(summaryBounds.left >= previewBounds.left && summaryBounds.right <= previewBounds.right && summaryBounds.top >= previewBounds.top && summaryBounds.bottom <= previewBounds.bottom, "The complete saved-place summary is clipped");
  stage("saving real frozen HTML and PDF bytes");
  for (const format of ["HTML", "PDF"]) {
    [...modal.querySelectorAll("button")].find((item) => item.textContent.trim() === "Export " + format + "\u2026").click();
    await waitFor(() => [...modal.querySelectorAll('[role="status"]')].some((item) => item.textContent.includes("Saved " + format)));
  }
  modal.querySelector('button[aria-label="Close"]').click();
  stage("checking existing saved-place Analyst question and epicenter/radius query");
  document.querySelector('button[aria-label="Analyst"]').click();
  (await waitFor(() => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "Which of my saved places intersect an active alert?"))).click();
  const analyst = await waitFor(() => document.querySelector('.page-panel[aria-label="Analyst"]'));
  await waitFor(() => analyst.querySelector("h3.sub"));
  const analystAlertText = analyst.textContent;
  if (["missing", "partial-zero"].includes(context.kind)) check(/unknown/i.test(analystAlertText) && !/0 saved places inside/.test(analystAlertText), "Analyst advertised zero from unknown evidence");
  if (["mixed", "restart", "expired-cache"].includes(context.kind)) check(analystAlertText.includes("qa-location-polygon"), "Analyst discarded observed polygon match");
  await capture("analyst-alerts");
  const field = analyst.querySelector('input[placeholder="Ask about loaded data\u2026"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, "Earthquakes near my saved places");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => ![...analyst.querySelectorAll("button")].find((item) => item.textContent.trim() === "Ask").disabled);
  [...analyst.querySelectorAll("button")].find((item) => item.textContent.trim() === "Ask").click();
  await waitFor(() => analyst.querySelector("h3.sub")?.textContent.includes("earthquakes"));
  const analystQuakeText = analyst.textContent;
  if (["mixed", "restart", "expired-cache"].includes(context.kind)) check(analystQuakeText.includes("qa-location-quake") && /last observed|current conditions are unknown/i.test(analystQuakeText), "Analyst quake query lost observed ID or current-unknown qualifier");
  await capture("analyst-quakes");
  check((window.__atlasSmoke?.errors ?? []).length === 0, "Renderer error");
  return {
    result: "PASS",
    kind: context.kind,
    explicitSyntheticProfile: true,
    feeds: snapshot.feeds,
    freshness: snapshot.freshness,
    evaluation,
    evidence,
    summaryRows: rows,
    summaryBounds: { x: summaryBounds.x, y: summaryBounds.y, width: summaryBounds.width, height: summaryBounds.height, preview: { x: previewBounds.x, y: previewBounds.y, width: previewBounds.width, height: previewBounds.height } },
    dataText: dataText.slice(0, 7e3),
    detailText: detailText.slice(0, 9e3),
    briefingText: briefingText.slice(0, 18e3),
    analystAlertText: analystAlertText.slice(-9e3),
    analystQuakeText: analystQuakeText.slice(-9e3),
    rendererErrors: window.__atlasSmoke?.errors ?? []
  };
})().then((result) => {
  window.__atlasLocationEvidenceDone = true;
  return result;
}).catch((error) => {
  throw new Error("[" + window.__atlasLocationStep + "] " + error.stack);
});
