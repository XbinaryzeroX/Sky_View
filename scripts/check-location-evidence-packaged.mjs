// Actual packaged application, public network replies and normal validated UI/IPC paths.
// Playwright instrumentation observes replies and adapts only local save-dialog destinations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadPlaywrightRuntime } from "./qa-playwright-runtime.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { electron: _electron, version: frameworkVersion } = loadPlaywrightRuntime();
const executable = join(root, "release/win-unpacked/Atlas Watch.exe");
const archive = join(root, "release/win-unpacked/resources/app.asar");
assert(existsSync(executable) && existsSync(archive), "Actual unpacked package is required");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archiveHash = digest(readFileSync(archive));
const temporary = mkdtempSync(join(tmpdir(), "atlas-location-evidence-package-"));
const profile = join(temporary, "profile"), database = join(temporary, "qa.sqlite");
mkdirSync(profile);
const output = join(root, "docs/screenshots/location-evidence");
mkdirSync(output, { recursive: true });
const seed = join(temporary, "seed.cjs");
await build({ stdin: { loader: "ts", resolveDir: root, contents: `
import { AtlasStore } from ${JSON.stringify(join(root, "src/main/store.ts"))};
const store = new AtlasStore(${JSON.stringify(database)});
store.saveSettings({ ...store.getSettings(), basemap: "neutral", terrainEnabled: false, labelsOverlay: false, buildings3d: false, layersEnabled: [], zoneLookupEnabled: false, quakeWindow: "day", quakeMinMagnitude: -1, nwsPollSeconds: 3600, usgsPollSeconds: 3600 });
store.close();
` }, bundle: true, platform: "node", format: "cjs", target: "node24", outfile: seed, logLevel: "silent" });
execFileSync(process.execPath, [seed], { cwd: root, stdio: "pipe" });
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^ATLAS_WATCH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^ELECTRON_NO_SANDBOX$|^ELECTRON_DISABLE_SANDBOX$|^ELECTRON_EXTRA_LAUNCH_ARGS$/.test(key)) delete environment[key];
environment.ATLAS_WATCH_DB = database;
const report = {
  result: "FAIL",
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  executable,
  archive,
  archiveSha256: archiveHash,
  framework: "playwright-core " + frameworkVersion,
  temporary,
  profile,
  database,
  instrumentedPackagedProcess: true,
  syntheticProviderData: false,
  providerResponsesReplaced: false,
  chromiumSandbox: true,
  genuineProfileAccessed: false,
  installerExecuted: false,
  nativePickerOperated: false,
  defaultBrowserOpened: false,
  phases: []
};
process.on("unhandledRejection", (error) => {
  report.frameworkStartupErrors ??= [];
  if (report.frameworkStartupErrors.length < 5) report.frameworkStartupErrors.push(String(error?.message ?? error).slice(0, 1e3));
});
const waitFor = async (read, timeout = 45e3) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve2) => setTimeout(resolve2, 100));
  }
  throw new Error("Packaged location evidence condition timed out");
};
// Independent planar ray test, used only to choose and verify a manual point inside a real supplied polygon.
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [u, v] = ring[j];
    if (y > point[1] !== v > point[1] && point[0] < (u - x) * (point[1] - y) / (v - y) + x) inside = !inside;
  }
  return inside;
}
function inGeometry(point, geometry) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some((rings) => inRing(point, rings[0]) && !rings.slice(1).some((ring) => inRing(point, ring)));
}
function interiorPoint(alerts, superseded) {
  for (const alert of alerts) {
    if (alert.status !== "Actual" || alert.messageType === "Cancel" || superseded.includes(alert.id) || Date.parse(alert.ends ?? alert.expires) <= Date.now()) continue;
    const polygons = alert.geometry?.type === "Polygon" ? [alert.geometry.coordinates] : alert.geometry?.type === "MultiPolygon" ? alert.geometry.coordinates : [];
    for (const rings of polygons) {
      const xs = rings[0].map((point) => point[0]), ys = rings[0].map((point) => point[1]);
      const [west, east, south, north] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (east - west > 180) continue;
      for (let row = 1; row < 10; row++) for (let column = 1; column < 10; column++) {
        const point = [west + (east - west) * column / 10, south + (north - south) * row / 10];
        if (inGeometry(point, alert.geometry)) return { alertId: alert.id, event: alert.event, point };
      }
    }
  }
  return null;
}
async function launch(phase) {
  let application, page, child;
  const value = { phase, result: "FAIL", startedAt: (/* @__PURE__ */ new Date()).toISOString(), errors: [], screenshots: [] };
  try {
    application = await _electron.launch({ executablePath: executable, chromiumSandbox: true, args: ["--user-data-dir=" + profile], cwd: dirname(executable), env: environment, timeout: 45e3 });
    child = application.process();
    value.pid = child.pid;
    page = await application.firstWindow({ timeout: 3e4 });
    page.setDefaultTimeout(2e4);
    page.on("pageerror", (error) => value.errors.push(error.message.slice(0, 1e3)));
    value.security = await application.evaluate(({ app, BrowserWindow }) => ({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      version: app.getVersion(),
      userData: app.getPath("userData"),
      noSandbox: app.commandLine.hasSwitch("no-sandbox"),
      disableWebSecurity: app.commandLine.hasSwitch("disable-web-security"),
      ignoreCertificateErrors: app.commandLine.hasSwitch("ignore-certificate-errors"),
      windows: BrowserWindow.getAllWindows().map((window2) => {
        const p = window2.webContents.getLastWebPreferences();
        return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
      })
    }));
    assert.equal(value.security.isPackaged, true);
    assert.equal(resolve(value.security.appPath), resolve(archive));
    assert.equal(resolve(value.security.userData).toLowerCase(), resolve(profile).toLowerCase());
    assert.equal(value.security.noSandbox, false);
    assert.equal(value.security.disableWebSecurity, false);
    assert.equal(value.security.ignoreCertificateErrors, false);
    assert(value.security.windows.every((window2) => window2.contextIsolation && window2.sandbox && !window2.nodeIntegration && window2.webSecurity));
    await page.getByRole("button", { name: "Data", exact: true }).waitFor({ state: "visible" });
    await waitFor(async () => {
      const snap = await page.evaluate(() => window.atlas.getState());
      return ["nws", "usgs"].every((feed) => ["ok", "error"].includes(snap.feeds[feed].state)) ? snap : null;
    });
    // Passive response clone only. Production request, response and error behavior are unchanged.
    await application.evaluate(() => {
      globalThis.__locationQaResponses = [];
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (input, options) => {
        const response = await nativeFetch(input, options), url = typeof input === "string" ? input : input.url ?? String(input);
        const feed = url.startsWith("https://api.weather.gov/alerts/active") ? "nws" : url.startsWith("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/") ? "usgs" : null;
        if (feed) {
          try {
            globalThis.__locationQaResponses.push({ feed, url, status: response.status, date: response.headers.get("date"), receivedAt: (/* @__PURE__ */ new Date()).toISOString(), body: await response.clone().json() });
          } catch (error) {
            globalThis.__locationQaResponses.push({ feed, url, status: response.status, inspectionError: String(error) });
          }
        }
        return response;
      };
    });
    await page.evaluate(() => window.atlas.refresh("all"));
    let snapshot = await page.evaluate(() => window.atlas.getState());
    for (const feed of ["nws", "usgs"]) assert.equal(snapshot.feeds[feed].state, "ok", feed + " live source unavailable: " + snapshot.feeds[feed].error);
    const replies = await application.evaluate(() => globalThis.__locationQaResponses);
    assert(replies.every((reply) => new URL(reply.url).protocol === "https:" && ["api.weather.gov", "earthquake.usgs.gov"].includes(new URL(reply.url).hostname)), "A recorded feed request used an unexpected destination");
    writeFileSync(join(temporary, "raw-" + phase + ".json"), JSON.stringify(replies));
    for (const feed of ["nws", "usgs"]) assert(replies.some((reply) => reply.feed === feed && reply.status === 200), "No captured actual HTTP200 " + feed);
    let rawRecordChecks = 0;
    for (const alert of snapshot.alerts) {
      assert(replies.some((reply) => reply.feed === "nws" && reply.body.features.some((feature) => (feature.properties.id === alert.id || feature.id === alert.id) && new Date(feature.properties.sent).toISOString() === alert.sent)), "NWS record not supported by actual captured response");
      rawRecordChecks++;
    }
    for (const quake2 of snapshot.quakes) {
      assert(replies.some((reply) => reply.feed === "usgs" && reply.body.features.some((feature) => (feature.id === quake2.id || String(feature.properties.ids ?? "").split(",").includes(quake2.id)) && feature.properties.mag === quake2.mag && feature.geometry.coordinates[0] === quake2.lon && feature.geometry.coordinates[1] === quake2.lat && new Date(feature.properties.updated).toISOString() === quake2.updated)), "USGS record not supported by actual captured response");
      rawRecordChecks++;
    }
    value.sourceAudit = replies.map((reply) => ({ feed: reply.feed, url: reply.url, status: reply.status, date: reply.date, receivedAt: reply.receivedAt, featureCount: reply.body?.features?.length, sha256: digest(Buffer.from(JSON.stringify(reply.body))) }));
    value.providerCredentialStatus = await page.evaluate(async () => (await window.atlas.listProviders()).map((provider) => ({ id: provider.id, configured: provider.configured, credentialSource: provider.credentialSource ?? null, userConfigured: provider.userConfigured ?? false, credentialError: !!provider.credentialError })));
    assert(value.providerCredentialStatus.filter((provider) => ["nws", "usgs-quakes"].includes(provider.id)).every((provider) => provider.configured && provider.credentialSource === null), "Public NWS/USGS provider unexpectedly depends on credentials");
    value.rawRecordChecks = rawRecordChecks;
    const quake = snapshot.quakes.find((record) => record.mag !== null);
    assert(quake, "Real USGS reply contains no usable event for a positive location check");
    const polygon = interiorPoint(snapshot.alerts, snapshot.supersededAlertIds);
    assert(polygon, "No real active supplied polygon available for an independent positive location check");
    const definitions = phase === "live" ? [{ name: "QA live USGS epicenter place", lat: quake.lat, lon: quake.lon }, { name: "QA live NWS polygon place", lat: polygon.point[1], lon: polygon.point[0] }] : report.phases[0].manualLocations.map((place) => ({ name: place.name, lat: place.lat, lon: place.lon }));
    if (phase === "live") for (const definition of definitions) await page.evaluate((input) => window.atlas.createLocation({ ...input, category: "Manual isolated acceptance location", notes: "Coordinates selected from actual source evidence for this test", radiusKm: 25 }), definition);
    snapshot = await waitFor(async () => {
      const snap = await page.evaluate(() => window.atlas.getState());
      return definitions.every((definition) => snap.locations.some((place) => place.name === definition.name)) ? snap : null;
    });
    const places = Object.fromEntries(definitions.map((definition) => [definition.name, snapshot.locations.find((place) => place.name === definition.name)]));
    if (phase === "live") {
      assert(snapshot.evaluations[places[definitions[0].name].id].quakesNearby.some((match) => match.quakeId === quake.id && match.distanceKm === 0));
      assert(snapshot.evaluations[places[definitions[1].name].id].alertsInside.some((match) => match.alertId === polygon.alertId));
      const rawPolygon = replies.find((reply) => reply.feed === "nws").body.features.find((feature) => feature.properties.id === polygon.alertId || feature.id === polygon.alertId);
      assert(inGeometry(polygon.point, rawPolygon.geometry), "Manual alert point does not lie inside original provider geometry");
    }
    value.manualLocations = snapshot.locations.map((place) => ({ id: place.id, name: place.name, lat: place.lat, lon: place.lon, radiusKm: place.radiusKm }));
    if (phase === "restart") assert.deepEqual(value.manualLocations, report.phases[0].manualLocations, "Restart changed saved-place inputs");
    value.feeds = snapshot.feeds;
    value.positiveControl = phase === "live" ? { quake: { id: quake.id, lat: quake.lat, lon: quake.lon, mag: quake.mag }, polygon } : report.phases[0].positiveControl;
    const shot = async (label) => {
      const path = join(output, "audit-location-packaged-" + phase + "-" + label + ".png");
      await page.screenshot({ path });
      value.screenshots.push(path);
    };
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const openPlace = async (name) => {
      await page.locator("button.loc-item").filter({ hasText: name }).click();
      const details2 = page.locator(".data-panel .details").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await details2.getByRole("heading", { name, exact: true }).waitFor({ state: "visible" });
      return details2;
    };
    const selectedSourceIds = [];
    for (const [index, definition] of definitions.entries()) {
      const details2 = await openPlace(definition.name);
      await details2.scrollIntoViewIfNeeded();
      const source = details2.locator('[data-monitoring-source="' + (index === 0 ? "USGS" : "NWS") + '"]');
      await source.waitFor({ state: "visible" });
      const place = snapshot.locations.find((item) => item.name === definition.name), matches = index === 0 ? snapshot.evaluations[place.id].quakesNearby : snapshot.evaluations[place.id].alertsInside;
      assert(matches.length > 0, "Saved real positive match disappeared");
      const lists = details2.locator("ul.rec-list");
      const list = index === 0 ? lists.last() : lists.first();
      await list.locator("button.rec-item").first().click();
      const label = index === 0 ? "Event id" : "Identifier";
      const selected = await waitFor(() => page.evaluate((label2) => [...document.querySelectorAll(".data-panel .kv")].find((row) => row.querySelector("dt")?.textContent === label2)?.querySelector("dd")?.textContent.trim() ?? null, label));
      assert(matches.some((match) => (index === 0 ? match.quakeId : match.alertId) === selected), "Normal source Details selected an unexpected source ID");
      selectedSourceIds.push({ kind: index === 0 ? "quake" : "alert", id: selected });
      await shot(index === 0 ? "quake-source" : "alert-source");
    }
    value.selectedSourceIds = selectedSourceIds;
    const details = await openPlace(definitions[0].name);
    await details.getByRole("button", { name: "Briefing", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Location briefing", exact: true });
    await modal.getByText(definitions[1].name, { exact: true }).waitFor({ state: "visible" });
    const previous = await modal.locator(".briefing-preview-pane > p time").getAttribute("datetime").catch(() => null);
    await modal.getByRole("button", { name: "All", exact: true }).click();
    await waitFor(async () => {
      const next = await modal.locator(".briefing-preview-pane > p time").getAttribute("datetime").catch(() => null);
      return next && next !== previous;
    });
    const preview = modal.getByRole("document", { name: "Briefing preview", exact: true });
    await preview.locator("h1").waitFor({ state: "visible" });
    value.previewText = await preview.innerText();
    const summary = preview.getByRole("table").nth(1);
    await summary.scrollIntoViewIfNeeded();
    value.summaryRows = await summary.locator("tr").allTextContents();
    await shot("summary");
    // Only the native chooser result is adapted; the real main formatter/frozen document/print path runs.
    await application.evaluate(({ dialog }, config) => {
      let counter = 0;
      dialog.showSaveDialog = async (...args) => ({ canceled: false, filePath: config.output + "/location-packaged-" + config.phase + "-" + ++counter + (args.at(-1).filters?.some((filter) => filter.extensions?.includes("pdf")) ? ".pdf" : ".html") });
    }, { output, phase });
    value.exports = [];
    for (const format of ["HTML", "PDF"]) {
      await modal.getByRole("button", { name: "Export " + format + "\u2026", exact: true }).click();
      await modal.getByRole("status").filter({ hasText: "Saved " + format }).waitFor({ state: "visible" });
      const path = join(output, "location-packaged-" + phase + "-" + (format === "HTML" ? 1 : 2) + "." + format.toLowerCase()), bytes = readFileSync(path);
      if (format === "HTML") {
        const equal = await preview.evaluate((element, html) => {
          const body = new DOMParser().parseFromString(html, "text/html").body;
          return body.textContent.replace(/\s+/g, " ").trim() === element.textContent.replace(/\s+/g, " ").trim();
        }, bytes.toString("utf8"));
        assert(equal, "Actual packaged HTML differs from visible frozen preview");
      } else assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      value.exports.push({ format: format.toLowerCase(), path, bytes: bytes.length, sha256: digest(bytes) });
    }
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Analyst", exact: true }).click();
    await page.getByRole("button", { name: "Which of my saved places intersect an active alert?", exact: true }).click();
    const analyst = page.locator('.page-panel[aria-label="Analyst"]');
    await analyst.locator("h3.sub").waitFor({ state: "visible" });
    value.analystText = await analyst.innerText();
    await shot("analyst");
    assert.equal(value.errors.length, 0);
    value.result = "PASS";
  } catch (error) {
    value.failure = { name: error.name, message: error.message };
    if (page) {
      try {
        await page.screenshot({ path: join(output, "audit-location-packaged-" + phase + "-failure.png") });
      } catch {
      }
    }
  } finally {
    if (application) {
      try {
        await application.close();
        value.closedByRunner = true;
      } catch (error) {
        value.closeError = error.message;
        child?.kill();
      }
    }
    value.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    report.phases.push(value);
    writeFileSync(join(root, "docs/location-evidence-packaged.log"), JSON.stringify(report, null, 2));
  }
  assert.equal(value.result, "PASS", value.failure?.message);
  assert.equal(value.closedByRunner, true);
  console.log("LOCATION_PACKAGED_PHASE " + JSON.stringify({ phase, result: value.result, counts: { nws: value.feeds.nws.recordCount, usgs: value.feeds.usgs.recordCount }, selectedSourceIds: value.selectedSourceIds, exports: value.exports }));
}
try {
  await launch("live");
  await launch("restart");
  assert.equal(digest(readFileSync(archive)), archiveHash, "Packaged application archive changed during acceptance");
  report.archiveStableDuringRun = true;
  report.result = "PASS";
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
}
report.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
writeFileSync(join(root, "docs/location-evidence-packaged.log"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ result: report.result, archiveSha256: archiveHash, temporary, phases: report.phases.length, failure: report.failure }, null, 2));
