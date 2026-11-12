// Actual packaged DWD acceptance. Public replies are cloned for inspection, never replaced.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadPlaywrightRuntime } from "./qa-playwright-runtime.mjs";
import { boundedCapEntries, readCapFacts, verifyDwdWarnings, expectedDwdMembers, mappedInterior, containsPoint } from "./qa-dwd-source.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { electron, version } = loadPlaywrightRuntime();
const temporary = await mkdtemp(join(tmpdir(), "atlas-dwd-package-"));
const profile = join(temporary, "profile");
const database = join(temporary, "qa.sqlite");
const output = join(root, "docs/screenshots/dwd");
await mkdir(profile);
await mkdir(output, { recursive: true });
const executable = join(root, "release/win-unpacked/Atlas Watch.exe");
const archive = join(root, "release/win-unpacked/resources/app.asar");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archiveHash = digest(await readFile(archive));
const seed = join(temporary, "seed.cjs");
await build({ stdin: { loader: "ts", resolveDir: root, contents: `
import {AtlasStore} from ${JSON.stringify(join(root, "src/main/store.ts"))};
const store=new AtlasStore(${JSON.stringify(database)});
store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false,nwsPollSeconds:3600,usgsPollSeconds:3600});
store.close();
` }, bundle: true, platform: "node", format: "cjs", target: "node24", outfile: seed, logLevel: "silent" });
execFileSync(process.execPath, [seed], { cwd: root, stdio: "pipe" });
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^ATLAS_WATCH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^ELECTRON_NO_SANDBOX$|^ELECTRON_DISABLE_SANDBOX$/.test(key)) delete environment[key];
environment.ATLAS_WATCH_DB = database;
const report = {
  result: "FAIL",
  startedAt: new Date().toISOString(),
  executable,
  archive,
  archiveSha256: archiveHash,
  temporary,
  profile,
  database,
  framework: "playwright-core " + version,
  instrumentedPackagedProcess: true,
  providerResponsesReplaced: false,
  syntheticProviderData: false,
  genuineProfileAccessed: false,
  installerExecuted: false,
  defaultBrowserOpened: false,
  phases: []
};
let lastZip = null;
let lastFacts = null;
let lastModified = null;
const waitFor = async (read, timeout = 45e3) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    await new Promise((resume) => setTimeout(resume, 100));
  }
  throw new Error("Packaged DWD acceptance condition timed out");
};
const identity = (value) => JSON.stringify([value.sender, value.identifier ?? value.capIdentifier, value.sent]);
async function run(phase) {
  let app, page, child;
  const result = { phase, result: "FAIL", startedAt: new Date().toISOString(), errors: [], screenshots: [] };
  try {
    app = await electron.launch({ executablePath: executable, chromiumSandbox: true, args: ["--user-data-dir=" + profile], cwd: dirname(executable), env: environment, timeout: 45e3 });
    child = app.process();
    result.pid = child.pid;
    // DWD is deliberately off at each launch; install this passive observer before the normal enable action.
    await app.evaluate(() => {
      globalThis.__dwdQaReplies = [];
      const native = globalThis.fetch;
      globalThis.fetch = async (input, options) => {
        const response = await native(input, options), url = typeof input === "string" ? input : input.url ?? String(input);
        if (url.startsWith("https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/")) {
          const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
          const record = {
            url,
            status: response.status,
            receivedAt: new Date().toISOString(),
            etag: response.headers.get("etag"),
            lastModified: response.headers.get("last-modified"),
            requestValidators: { etag: headers.get("if-none-match"), modifiedSince: headers.get("if-modified-since") }
          };
          try {
            const body = await response.clone().arrayBuffer();
            if (body.byteLength > 2 * 1024 * 1024) record.inspectionError = "Above independent QA compressed bound";
            else {
              record.bytes = body.byteLength;
              record.base64 = Buffer.from(body).toString("base64");
            }
          } catch (error) {
            record.inspectionError = String(error);
          }
          globalThis.__dwdQaReplies.push(record);
        }
        return response;
      };
    });
    page = await app.firstWindow({ timeout: 3e4 });
    page.setDefaultTimeout(2e4);
    page.on("pageerror", (error) => result.errors.push(error.message));
    result.security = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
      isPackaged: electronApp.isPackaged,
      version: electronApp.getVersion(),
      appPath: electronApp.getAppPath(),
      userData: electronApp.getPath("userData"),
      noSandbox: electronApp.commandLine.hasSwitch("no-sandbox"),
      disableWebSecurity: electronApp.commandLine.hasSwitch("disable-web-security"),
      ignoreCertificateErrors: electronApp.commandLine.hasSwitch("ignore-certificate-errors"),
      windows: BrowserWindow.getAllWindows().map((browserWindow) => {
        const p = browserWindow.webContents.getLastWebPreferences();
        return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
      })
    }));
    assert(result.security.isPackaged);
    assert.equal(resolve(result.security.appPath), resolve(archive));
    assert.equal(resolve(result.security.userData).toLowerCase(), resolve(profile).toLowerCase());
    assert(!result.security.noSandbox && !result.security.disableWebSecurity && !result.security.ignoreCertificateErrors);
    assert(result.security.windows.every((p) => p.contextIsolation && p.sandbox && !p.nodeIntegration && p.webSecurity));
    await page.getByRole("button", { name: "Globe", exact: true }).waitFor({ state: "visible" });
    const before = await waitFor(async () => {
      const snapshot2 = await page.evaluate(() => window.atlas.getState());
      return ["nws", "usgs"].every((feed) => ["ok", "error"].includes(snapshot2.feeds[feed].state)) ? snapshot2 : null;
    });
    assert.deepEqual(before.settings.layersEnabled, [], "DWD preference did not remain off across restart");
    const beforeNws = before.alerts.map((alert) => alert.id).sort();
    const beforeRange = await page.evaluate(() => window.atlas.timelineRange());
    const openLayers = async () => {
      await page.getByRole("button", { name: "Globe", exact: true }).click();
      const search = page.getByRole("textbox", { name: "Find a layer", exact: true });
      if (!await search.isVisible()) await page.getByRole("button", { name: "Layers", exact: true }).click();
      await search.fill("DWD");
      return page.locator(".layer-row").filter({ hasText: "Weather warnings (Germany · DWD)" });
    };
    const layer = await openLayers();
    await layer.getByRole("switch").click();
    await waitFor(() => layer.getByRole("switch").isChecked());
    const snapshot = await waitFor(async () => {
      const all = await page.evaluate(() => window.atlas.getLayers());
      const dwd = all.find((snapshot2) => snapshot2.status.id === "dwd");
      if (dwd?.status.state === "error") throw new Error("Actual DWD source unavailable: " + dwd.status.error);
      return dwd?.status.enabled && dwd.status.state === "ok" && Array.isArray(dwd.dwdWarnings) ? dwd : null;
    });
    const responses = await app.evaluate(() => globalThis.__dwdQaReplies);
    assert(responses.length > 0, "No actual DWD response was observed after normal enable");
    for (const response of responses) {
      assert.equal(new URL(response.url).protocol, "https:");
      assert.equal(new URL(response.url).hostname, "opendata.dwd.de");
      assert([200, 304].includes(response.status));
      if (response.status === 200) {
        assert(response.base64 && !response.inspectionError);
        lastZip = Buffer.from(response.base64, "base64");
        await writeFile(join(temporary, "actual-" + phase + ".zip"), lastZip);
        lastFacts = await page.evaluate(readCapFacts, boundedCapEntries(lastZip));
        lastModified = response.lastModified ? new Date(response.lastModified).toISOString() : null;
      } else {
        assert(lastZip && lastFacts, "A conditional response has no independently captured prior ZIP");
        assert(response.requestValidators.etag || response.requestValidators.modifiedSince, "Conditional validator missing");
      }
    }
    assert(lastFacts);
    const at = new Date().toISOString();
    const expected = expectedDwdMembers(lastFacts, at).map(identity).sort();
    assert.deepEqual(snapshot.dwdWarnings.map(identity).sort(), expected, "Actual warning membership differs from independent CAP lifecycle calculation");
    result.sourceVerification = verifyDwdWarnings(snapshot.dwdWarnings, lastFacts);
    assert.equal(snapshot.status.recordCount, snapshot.dwdWarnings.length);
    assert.equal(snapshot.records.length, snapshot.dwdWarnings.filter((warning) => warning.geometry).length);
    assert.equal(snapshot.status.sourceUpdatedAt, lastModified, "Archive publication time was replaced by a message/fetch clock");
    result.sourceResponses = responses.map(({ base64, ...response }) => ({ ...response, sha256: base64 ? digest(Buffer.from(base64, "base64")) : null }));
    result.snapshot = {
      status: snapshot.status,
      warningCount: snapshot.dwdWarnings.length,
      mapped: snapshot.records.length,
      unmapped: snapshot.dwdWarnings.filter((warning) => !warning.geometry).length
    };
    await waitFor(() => page.locator(".hud").innerText().then(text => text.includes(`DWD ${snapshot.records.length} mapped / ${snapshot.dwdWarnings.length} total`)));
    await page.getByRole("button", { name: "Providers", exact: true }).click();
    const providers = page.getByRole("dialog", { name: "Provider settings", exact: true });
    const provider = providers.locator("section.provider").filter({ hasText: "Deutscher Wetterdienst (DWD)" });
    await provider.getByRole("button", { name: "Test connection", exact: true }).click();
    const connection = await waitFor(() => page.evaluate(async () => (await window.atlas.listProviders()).find(provider => provider.id === "dwd")?.lastTest ?? null));
    assert(connection.ok && connection.message.includes(snapshot.status.lastSuccessAt), "Provider test did not report the same committed DWD check");
    const providerTestRequests = await app.evaluate(() => globalThis.__dwdQaReplies.length);
    assert.equal(providerTestRequests, responses.length, "Provider test duplicated a current DWD download");
    result.connectionTest = { ...connection, requestCountBefore: responses.length, requestCountAfter: providerTestRequests };
    await providers.getByRole("button", { name: "Close", exact: true }).click();
    await writeFile(join(temporary, "facts-" + phase + ".json"), JSON.stringify(lastFacts));
    await writeFile(join(temporary, "snapshot-" + phase + ".json"), JSON.stringify(snapshot));
    const capture = async (label) => {
      const path = join(output, "audit-dwd-" + phase + "-" + label + ".png");
      await page.screenshot({ path });
      result.screenshots.push(path);
    };
    await layer.locator(".layer-info > summary").click();
    await capture("layer");
    await page.getByRole("button", { name: "Events", exact: true }).click();
    const events = page.locator('.page-panel[aria-label="Events"]');
    await events.getByRole("combobox", { name: "Event type", exact: true }).selectOption("dwd");
    await waitFor(() => events.locator("li[data-dwd-warning-id]").count().then((count) => count === snapshot.dwdWarnings.length));
    result.eventIds = await events.locator("li[data-dwd-warning-id]").evaluateAll((rows) => rows.map((row) => row.dataset.dwdWarningId));
    assert.deepEqual([...result.eventIds].sort(), snapshot.dwdWarnings.map((warning) => warning.id).sort());
    result.sourceState = await events.getByRole("status", { name: "DWD warning source", exact: true }).getAttribute("data-dwd-state");
    await capture("events");
    const mapped = mappedInterior(snapshot.dwdWarnings, phase === "restart" ? before.locations.map(place => [place.lon, place.lat]) : []);
    const unmapped = snapshot.dwdWarnings.find((warning) => !warning.geometry);
    result.availability = { mapped: !!mapped, unmapped: !!unmapped };
    const headlineBounds = [];
    const openWarning = async (id) => {
      await page.getByRole("button", { name: "Events", exact: true }).click();
      const panel = page.locator('.page-panel[aria-label="Events"]');
      await panel.getByRole("combobox", { name: "Event type", exact: true }).selectOption("dwd");
      await panel.locator('li[data-dwd-warning-id="' + id + '"]').getByRole("button").click();
      const detail = page.locator('.data-panel .details[data-dwd-warning-id="' + id + '"]');
      await detail.waitFor({ state: "visible" });
      const bounds = await detail.locator("header h2").evaluate(node => new Promise(resolve => requestAnimationFrame(() => {
        const headline = node.getBoundingClientRect();
        const pane = node.closest(".floating-panel-body");
        const body = pane.getBoundingClientRect();
        const hit = document.elementFromPoint(headline.left + headline.width / 2, headline.top + headline.height / 2);
        resolve({text:node.textContent,scrollTop:pane.scrollTop,headline:{x:headline.x,y:headline.y,width:headline.width,height:headline.height},body:{x:body.x,y:body.y,width:body.width,height:body.height},
          visible:headline.width>0&&headline.height>0&&headline.top>=Math.max(0,body.top)-1&&headline.bottom<=Math.min(innerHeight,body.bottom)+1&&headline.left>=body.left-1&&headline.right<=body.right+1,
          reachable:hit===node||node.contains(hit)});
      })));
      assert(bounds.visible && bounds.reachable, "Selected original DWD headline is not immediately visible/reachable without scrolling");
      assert(bounds.scrollTop <= 1, "Selecting a DWD warning retained an earlier scroll offset");
      const warning = snapshot.dwdWarnings.find(warning => warning.id === id);
      assert.equal(bounds.text, warning.headline ?? warning.event);
      headlineBounds.push({id,...bounds});
      return detail;
    };
    if (unmapped) {
      const detail = await openWarning(unmapped.id);
      assert.equal(await detail.getByRole("button", { name: "Focus supplied DWD geometry", exact: true }).count(), 0);
      assert((await detail.innerText()).includes("no map position is inferred"));
      assert((await detail.innerText()).includes(unmapped.capIdentifier));
      result.unmappedDetail = { id: unmapped.id, capIdentifier: unmapped.capIdentifier, text: (await detail.innerText()).slice(0, 1e4) };
      await capture("unmapped");
      const pane = page.locator(".data-panel > .floating-panel-body");
      const deepScroll = async () => {
        await pane.hover(); await page.mouse.wheel(0, 4000);
        return waitFor(() => pane.evaluate(node => node.scrollTop > 0 ? node.scrollTop : null));
      };
      const sameOffset = await deepScroll();
      await openWarning(unmapped.id);
      result.sameWarningReselect = { priorScrollTop: sameOffset, resetToTop: true };
      if (mapped) {
        const differentOffset = await deepScroll();
        await openWarning(mapped.id);
        result.differentWarningReselect = { priorScrollTop: differentOffset, resetToTop: true };
      }
    }
    if (mapped) {
      const warning = snapshot.dwdWarnings.find((warning2) => warning2.id === mapped.id);
      const detail = await openWarning(mapped.id);
      assert((await detail.innerText()).includes(warning.capIdentifier));
      assert.equal(await detail.locator("h2").getAttribute("lang"), warning.language);
      const paragraphs = await detail.locator("p.pre[lang]").allTextContents();
      assert.equal(paragraphs[0], warning.description ?? "Description not supplied.");
      assert.equal(paragraphs[1], warning.instruction ?? "Instructions not supplied.");
      assert((await detail.innerText()).includes("CC BY 4.0"));
      await capture("mapped-selected-headline");
      await detail.getByRole("button", { name: "Focus supplied DWD geometry", exact: true }).click();
      result.mappedDetail = { id: warning.id, capIdentifier: warning.capIdentifier, language: warning.language, headline: warning.headline, point: mapped.point };
      await capture("mapped-detail");
      // Use the normal numeric coordinate search to put a known CAP interior under the actual canvas center.
      const search = page.getByRole("combobox", { name: "Search places, coordinates, U.S. addresses, saved locations and history", exact: true });
      await search.fill(mapped.point[1].toFixed(7) + ", " + mapped.point[0].toFixed(7));
      await search.press("Enter");
      await waitFor(() => page.locator(".hud").innerText().then((text) => text.includes(mapped.point[1].toFixed(4)) && text.includes(mapped.point[0].toFixed(4))));
      const back = page.locator(".data-panel").getByRole("button", { name: "← Overview", exact: true });
      await back.click();
      await waitFor(() => page.locator(".data-panel .details[data-dwd-warning-id]").count().then((count) => count === 0));
      const canvas = await page.locator(".cesium-widget canvas").boundingBox();
      assert(canvas);
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      const picked = await waitFor(() => page.locator(".data-panel .details[data-dwd-warning-id]").getAttribute("data-dwd-warning-id").catch(() => null));
      const pickedWarning = snapshot.dwdWarnings.find((warning2) => warning2.id === picked);
      assert(pickedWarning && containsPoint(pickedWarning.geometry, mapped.point), "Actual map pick does not contain the independently selected source point");
      result.actualMapPick = { id: picked, point: mapped.point, canvasCenter: { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 } };
      await capture("map-pick");
      if (phase === "live") {
        const place = await page.evaluate((point) => window.atlas.createLocation({ name: "QA DWD supplied polygon test point", category: "Manual isolated test point", notes: "Point chosen independently inside the current supplied CAP polygon", lat: point[1], lon: point[0], radiusKm: 25 }), mapped.point);
        await search.fill("");
        await page.getByRole("button", { name: "Places", exact: true }).click();
        await page.locator("button.loc-item").filter({ hasText: place.name }).click();
        const supplied = page.locator('section[aria-label="DWD warnings at this point"]');
        await supplied.waitFor({ state: "visible" });
        const expectedInside = snapshot.dwdWarnings.filter(warning => containsPoint(warning.geometry, [place.lon, place.lat]));
        const insideTitles = await supplied.locator("button.rec-item").evaluateAll(buttons => buttons
          .filter(button => button.querySelector(".rec-meta")?.textContent.includes("Inside supplied horizontal polygon"))
          .map(button => button.querySelector(".rec-title").textContent));
        assert.deepEqual([...insideTitles].sort(), expectedInside.map(warning => warning.headline ?? warning.event).sort(), "Saved-place inside rows differ from independent source-polygon intersections");
        const summaryText = await supplied.locator("p").filter({ hasText: "Supplied horizontal intersections:" }).innerText();
        assert(summaryText.includes("Supplied horizontal intersections: " + expectedInside.length));
        await supplied.locator("h3").evaluate(node => node.scrollIntoView({ block: "start" }));
        result.savedPlace = { id: place.id, lat: place.lat, lon: place.lon, expectedInsideIds: expectedInside.map(warning => warning.id), renderedInsideTitles: insideTitles, summaryText,
          text: (await supplied.innerText()).slice(0, 9e3) };
        await capture("saved-place");
        const html = await page.evaluate((id) => window.atlas.previewBriefing([id]), place.id);
        assert(!snapshot.dwdWarnings.some((warning2) => html.includes(warning2.capIdentifier)), "DWD data entered the existing NWS/USGS briefing");
        result.existingBriefingExcludesDwd = true;
        result.coreSelectionsAfterDwd = [];
        for (const kind of ["quake", "alert"]) {
          await openWarning(mapped.id);
          await page.getByRole("button", { name: "Events", exact: true }).click();
          const coreEvents = page.locator('.page-panel[aria-label="Events"]');
          await coreEvents.getByRole("combobox", { name: "Event type", exact: true }).selectOption(kind);
          const rows = coreEvents.locator("ul.rec-list button.rec-item");
          if (await rows.count() === 0) { result.coreSelectionsAfterDwd.push({kind,available:false}); continue; }
          await rows.first().click();
          const label = kind === "quake" ? "Event id" : "Identifier";
          const selected = await waitFor(() => page.evaluate(label => [...document.querySelectorAll(".data-panel .kv")].find(row => row.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent.trim() ?? null, label));
          assert((kind === "quake" ? before.quakes : before.alerts).some(record => record.id === selected));
          assert.equal(await page.locator(".data-panel .details[data-dwd-warning-id]").count(), 0, "A core source selection retained DWD detail priority");
          result.coreSelectionsAfterDwd.push({kind,id:selected,available:true});
          await capture("core-" + kind);
        }
      }
    }
    await page.getByRole("button", { name: "Events", exact: true }).click();
    const finalEvents = page.locator('.page-panel[aria-label="Events"]');
    await finalEvents.getByRole("combobox", { name: "Event type", exact: true }).selectOption("alert");
    assert.equal(await finalEvents.locator("li[data-dwd-warning-id]").count(), 0, "German warnings entered the NWS Events filter");
    const after = await page.evaluate(() => window.atlas.getState());
    assert.deepEqual(after.alerts.map((alert) => alert.id).sort(), beforeNws, "DWD refresh changed NWS membership");
    const afterRange = await page.evaluate(() => window.atlas.timelineRange());
    assert.equal(afterRange.nwsFrames, beforeRange.nwsFrames);
    assert.equal(afterRange.usgsFrames, beforeRange.usgsFrames);
    result.nwsAndArchiveSeparation = true;
    if (phase === "live" && beforeRange.nwsFrames + beforeRange.usgsFrames > 0) {
      const replayPoint = mappedInterior(snapshot.dwdWarnings, after.locations.map(place => [place.lon, place.lat]));
      if (replayPoint) {
        const search = page.getByRole("combobox", { name: "Search places, coordinates, U.S. addresses, saved locations and history", exact: true });
        await search.fill(replayPoint.point[1].toFixed(7) + ", " + replayPoint.point[0].toFixed(7)); await search.press("Enter");
        await waitFor(() => page.locator(".hud").innerText().then(text => text.includes(replayPoint.point[1].toFixed(4)) && text.includes(replayPoint.point[0].toFixed(4))));
      }
      await finalEvents.getByRole("button", { name: "Replay recorded alerts and earthquakes", exact: true }).click();
      const playback = page.getByRole("region", { name: "Playback", exact: true });
      await waitFor(() => playback.getAttribute("data-playback-phase").then(value => value === "ready"));
      assert(!(await page.locator(".hud").innerText()).includes("DWD"), "Replay HUD retained live DWD totals");
      await page.getByRole("button", { name: "Data", exact: true }).click();
      const canvas = await page.locator(".cesium-widget canvas").boundingBox();
      if (mapped && canvas) await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      assert.equal(await page.locator(".data-panel .details[data-dwd-warning-id]").count(), 0);
      await capture("replay-excluded");
      await playback.getByRole("button", { name: "Exit playback", exact: true }).click();
      await waitFor(() => playback.count().then(count => count === 0));
      result.replayExcludesLiveDwd = true;
      result.replayEntry = "Events → Replay recorded alerts and earthquakes; remains on Globe (page navigation intentionally exits Replay).";
    }
    await page.getByRole("button", { name: "Official bulletins", exact: true }).click();
    const bulletin = page.locator('.page-panel[aria-label="Official bulletins"]');
    await bulletin.getByRole("heading", { name: "DWD warnings — Germany", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await bulletin.locator("li[data-dwd-warning-id]").count(), snapshot.dwdWarnings.length);
    await capture("bulletins");
    const off = await openLayers();
    await off.getByRole("switch").click();
    await waitFor(() => off.getByRole("switch").isChecked().then(value => !value));
    await waitFor(async () => !(await page.evaluate(() => window.atlas.getState())).settings.layersEnabled.includes("dwd"));
    const disabled = (await page.evaluate(() => window.atlas.getLayers())).find((snapshot2) => snapshot2.status.id === "dwd");
    assert.equal(disabled.status.enabled, false);
    assert.equal(disabled.records.length, 0);
    await page.getByRole("button", { name: "Events", exact: true }).click();
    const disabledEvents = page.locator('.page-panel[aria-label="Events"]');
    await disabledEvents.getByRole("combobox", { name: "Event type", exact: true }).selectOption("dwd");
    assert.equal(await disabledEvents.locator("li[data-dwd-warning-id]").count(), 0);
    assert.equal(await disabledEvents.getByRole("status", { name: "DWD warning source", exact: true }).getAttribute("data-dwd-state"), "disabled");
    await capture("off");
    result.offHidesWarnings = true;
    result.selectedHeadlineBounds = headlineBounds;
    assert.equal(result.errors.length, 0);
    result.result = "PASS";
  } catch (error) {
    result.failure = { name: error.name, message: error.message, stack: error.stack };
    if (page) {
      try {
        result.failureScreenshot = join(temporary, "failure-" + phase + ".png");
        await page.screenshot({ path: result.failureScreenshot });
      } catch {
      }
    }
  } finally {
    if (app) {
      try {
        await app.close();
        result.closedByRunner = true;
      } catch (error) {
        result.closeError = error.message;
        child?.kill();
      }
    }
    result.finishedAt = new Date().toISOString();
    report.phases.push(result);
    await writeFile(join(temporary, "dwd-packaged-progress.log"), JSON.stringify(report, null, 2));
  }
  assert.equal(result.result, "PASS", result.failure?.message);
  assert(result.closedByRunner);
  console.log("DWD_PACKAGED_PHASE " + JSON.stringify({ phase, result: result.result, snapshot: result.snapshot, sourceVerification: { ...result.sourceVerification, records: undefined }, actualMapPick: result.actualMapPick }));
}
try {
  await run("live");
  await run("restart");
  assert.equal(digest(await readFile(archive)), archiveHash, "Package changed during acceptance");
  report.archiveStableDuringRun = true;
  report.result = "PASS";
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
const reportPath = report.result === "PASS" ? join(root, "docs/dwd-packaged-audit.log") : join(temporary, "dwd-packaged-failure.log");
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ result: report.result, archiveSha256: archiveHash, temporary, reportPath, failure: report.failure }, null, 2));
