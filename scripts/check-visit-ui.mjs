// Since-last-visit desktop QA, using only isolated temporary app directories.
// Real provider passes never replace data; fixture profiles are explicitly separate.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), require2 = createRequire(import.meta.url);
const productPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const startedAt = new Date().toISOString();
const session = await mkdtemp(join(tmpdir(), "atlas-visit-ui-")), output = join(root, "docs/screenshots/visit");
await mkdir(output, { recursive: true });
const helper = join(session, "store-helper.cjs");
await build({ stdin: { loader: "ts", resolveDir: root, contents: `
import { AtlasStore } from ${JSON.stringify(join(root, "src/main/store.ts"))};
import { AppCore } from ${JSON.stringify(join(root, "src/main/core.ts"))};
import { normalizeNwsAlerts, normalizeUsgsFeed } from ${JSON.stringify(join(root, "src/shared/normalize.ts"))};
import { readFileSync } from "node:fs";
void (async () => {
  const [action, path, configPath] = process.argv.slice(2), config = JSON.parse(readFileSync(configPath, "utf8"));
  const store = new AtlasStore(path);
  if (action === "seed") {
    store.saveSettings({
      ...store.getSettings(),
      basemap: "neutral",
      terrainEnabled: false,
      labelsOverlay: false,
      buildings3d: false,
      layersEnabled: [],
      zoneLookupEnabled: false,
      quakeWindow: "day",
      quakeMinMagnitude: -1,
      nwsPollSeconds: 3600,
      usgsPollSeconds: 3600
    });
    if (config.large) {
      for (let i = 0; i < 900; i++) store.createLocation({ name: "QA large location " + i, category: "Explicit large-report QA fixture", notes: "&".repeat(2e3), lat: 40, lon: -74, radiusKm: 25 }, (/* @__PURE__ */ new Date()).toISOString(), { status: "disabled", zones: [], checkedAt: null, error: null });
    }
    if (config.fixture) {
      let clock = new Date(Date.parse(config.fixture.baselineAt) - 1e3);
      const core = new AppCore({
        store,
        now: () => clock,
        alertSource: { name: "explicit synthetic visit fixture seed", fetchActiveAlerts: async () => normalizeNwsAlerts(config.fixture.baseline.nws), fetchPointZones: async () => ({ status: "disabled", zones: [], checkedAt: null, error: null }) },
        quakeSource: { name: "explicit synthetic visit fixture seed", fetchRecent: async () => ({ ...normalizeUsgsFeed(config.fixture.baseline.usgs), feedKey: "all_day" }) }
      });
      core.init();
      clock = new Date(config.fixture.baselineAt);
      await core.refresh("nws");
      await core.refresh("usgs");
      core.stop();
      if (config.fixture.kind === "scope") store.saveSettings({ ...store.getSettings(), quakeWindow: "week", quakeMinMagnitude: 3.5 });
    }
    console.log(JSON.stringify({ seeded: true, fixture: !!config.fixture, locations: store.listLocations().length }));
  } else {
    const marker = store.getMeta("timeline_visit_v1");
    if (marker) store["timeline"]["visit"] = JSON.parse(marker);
    const report = store.visitBriefing(config.at), comparisons = {}, endpointRecords = [];
    const signature = (value) => JSON.stringify(value, (_k, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
    for (const feed of ["nws", "usgs"]) {
      const value = report.feeds[feed];
      for (const endpoint of [value.baseline, value.current]) if (endpoint.observedAt) {
        for (const record of store.timelineFrame(endpoint.observedAt)[feed].records) endpointRecords.push(feed === "nws" ? { feed, id: record.id, sent: record.sent } : { feed, id: record.id, mag: record.mag, lat: record.lat, lon: record.lon, updated: record.updated });
      }
      if (value.new.total !== null) {
        const baseline = store.timelineFrame(value.baseline.observedAt)[feed].records, current = store.timelineFrame(value.current.observedAt)[feed].records;
        const before = new Map(baseline.map((record) => [record.id, signature(record)])), after = new Map(current.map((record) => [record.id, signature(record)]));
        comparisons[feed] = { new: [...after.keys()].filter((id) => !before.has(id)), updated: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)), noLongerReturned: [...before.keys()].filter((id) => !after.has(id)) };
        for (const key of ["new", "updated", "noLongerReturned"]) if (value[key].total !== comparisons[feed][key].length) throw new Error(feed + " independent " + key + " count mismatch");
      }
    }
    console.log(JSON.stringify({ report, comparisons, endpointRecords }));
  }
  store.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
` }, bundle: true, platform: "node", format: "cjs", target: "node24", outfile: helper, logLevel: "silent" });
function fixture(kind) {
  const currentMs = Date.now(), baselineMs = currentMs - 5 * 6e4, baselineAt = new Date(baselineMs).toISOString();
  const alert = (id, label, updated = false) => ({ type: "Feature", id: "https://api.weather.gov/alerts/" + id, geometry: { type: "Polygon", coordinates: [[[-123, 37], [-121, 37], [-121, 39], [-123, 39], [-123, 37]]] }, properties: {
    id,
    event: "QA SYNTHETIC VISIT warning",
    headline: "QA SYNTHETIC VISIT " + label,
    description: "Explicit fixture, not an actual weather observation.",
    senderName: "QA synthetic fixture",
    sent: new Date(updated ? currentMs : baselineMs).toISOString(),
    effective: new Date(baselineMs).toISOString(),
    onset: new Date(baselineMs).toISOString(),
    expires: new Date(currentMs + 36e5).toISOString(),
    status: "Actual",
    messageType: "Alert",
    severity: updated ? "Severe" : "Moderate",
    urgency: "Immediate",
    certainty: "Observed",
    affectedZones: [],
    references: [],
    geocode: { UGC: [] }
  } });
  const quake = (id, label, updated = false) => ({ type: "Feature", id, geometry: { type: "Point", coordinates: [-122, 37.5, 8] }, properties: {
    title: "QA SYNTHETIC VISIT " + label,
    place: "Explicit synthetic visit fixture",
    mag: updated ? 4.1 : 3.2,
    type: "earthquake",
    time: baselineMs - 6e4,
    updated: updated ? currentMs : baselineMs,
    ids: "," + id + ",",
    status: "reviewed",
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/" + id
  } });
  const buildFeed = (feed, current) => {
    const make = feed === "nws" ? alert : quake, prefix = "qa-visit-" + feed + "-", features = [
      make(prefix + "keep", "unchanged"),
      make(prefix + "updated", current ? "changed magnitude/headline" : "previous revision", current),
      ...Array.from({ length: 6 }, (_, i) => make(prefix + (current ? "new-" : "old-") + i, (current ? "new reply source ID " : "no longer returned source ID ") + i))
    ];
    if (current && kind === "partial") features.push(null);
    return feed === "nws" ? { type: "FeatureCollection", updated: new Date(current ? currentMs : baselineMs).toISOString(), features } : { type: "FeatureCollection", metadata: { generated: current ? currentMs : baselineMs }, features };
  };
  return { kind, baselineAt, label: "EXPLICIT SYNTHETIC QA PROVIDER RESPONSES \u2014 never live observations", baseline: { nws: buildFeed("nws", false), usgs: buildFeed("usgs", false) }, current: { nws: buildFeed("nws", true), usgs: buildFeed("usgs", true) } };
}
const liveDir = join(session, "live");
await mkdir(liveDir);
const liveConfig = {};
const liveConfigPath = join(liveDir, "config.json");
await writeFile(liveConfigPath, JSON.stringify(liveConfig));
execFileSync(process.execPath, [helper, "seed", join(liveDir, "qa.sqlite"), liveConfigPath], { cwd: root, stdio: "pipe" });
const html = await readFile(join(root, "dist/renderer/index.html"), "utf8");
const assets = ["dist/main/main.cjs", "dist/preload/preload.cjs", "dist/renderer/index.html", ...Array.from(html.matchAll(/(?:src|href)="\/(assets\/[^\"]+)"/g), (m) => "dist/renderer/" + m[1])];
const hashes = async () => Object.fromEntries(await Promise.all(assets.map(async (p) => [p, createHash("sha256").update(await readFile(join(root, p))).digest("hex")])));
const beforeHashes = await hashes(), allSources = [], phases = [];
async function run(phase, dir, config = {}) {
  const configPath = join(dir, "config.json");
  await writeFile(configPath, JSON.stringify(config));
  const bootstrap = join(dir, "bootstrap-" + phase + ".cjs"), sources = join(dir, "sources-" + phase + ".json"), documents = join(dir, "documents-" + phase + ".json"), saves = join(dir, "saves-" + phase + ".json");
  await writeFile(bootstrap, `
const { app, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
dialog.showErrorBox = (title, content) => {
  console.error("VISIT_QA_STARTUP_ERROR", title, content);
  app.exit(1);
};
const config = ${JSON.stringify(config)}, phase = ${JSON.stringify(phase)}, responses = [], docs = [], savedReports = [], nativeFetch = globalThis.fetch;
let nextFault = null, saveCount = 0;
globalThis.fetch = async (input, options) => {
  const raw = typeof input === "string" ? input : input.url ?? String(input), feed = raw.startsWith("https://api.weather.gov/alerts/active") ? "nws" : raw.startsWith("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/") ? "usgs" : null;
  let response;
  if (config.fixture) {
    if (!feed) throw new Error("Explicit fixture profile blocks unrelated main provider fetches");
    response = new Response(JSON.stringify(config.fixture.current[feed]), { status: 200, headers: { "Content-Type": "application/json" } });
  } else response = await nativeFetch(input, options);
  if (feed) {
    const body = await response.clone().json();
    responses.push({ feed, transport: config.fixture ? "explicit synthetic HTTP adapter" : "actual network", requestUrl: raw, httpStatus: response.status, responseDate: response.headers.get("date"), receivedAt: (/* @__PURE__ */ new Date()).toISOString(), body });
    await fs.writeFile(${JSON.stringify(sources)}, JSON.stringify(responses));
    if (phase === "first") await new Promise((resolve) => setTimeout(resolve, 5e3));
  }
  return response;
};
dialog.showSaveDialog = async (...args) => {
  const options = args.at(-1), pdf = options.filters?.some((f) => f.extensions?.includes("pdf")), file = path.join(${JSON.stringify(config.large ? dir : output)}, "visit-" + phase + "-" + ++saveCount + (pdf ? ".pdf" : ".html"));
  return { canceled: false, filePath: file };
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "briefing:preview") {
    if (result && typeof result === "object") {
      docs.push(result);
      await fs.writeFile(${JSON.stringify(documents)}, JSON.stringify(docs));
    }
    const mode = Array.isArray(args[0]) ? "locations" : args[0]?.mode;
    if (nextFault && nextFault.mode === mode) {
      const value = nextFault;
      nextFault = null;
      if (value.delayMs) await new Promise((resolve) => setTimeout(resolve, value.delayMs));
      if (value.error) throw new Error("Explicit visit QA preview failure (not a provider failure)");
    }
  }
  if (channel === "briefing:export" && result) {
    const request = args[0], format = args[1];
    savedReports.push({ request, format, path: result });
    await fs.writeFile(${JSON.stringify(saves)}, JSON.stringify(savedReports));
    if (format === "html") await event.sender.executeJavaScript("window.__atlasVisitQaSavedHtml=" + JSON.stringify({ path: result, html: await fs.readFile(result, "utf8") }));
  }
  return result;
});
app.on("web-contents-created", (_event, contents) => contents.once("did-finish-load", async () => {
  if (!contents.getURL().startsWith("app://atlas/")) return;
  await contents.executeJavaScript("window.__atlasVisitQa=" + JSON.stringify({ phase, large: !!config.large, fixture: config.fixture?.kind ?? null, fixtureLabel: config.fixture?.label ?? null }));
  let busy = false, lastCapture = "", lastControl = 0, done = false;
  const poll = setInterval(async () => {
    if (busy || contents.isDestroyed()) return;
    busy = true;
    try {
      const control = await contents.executeJavaScript("window.__atlasVisitQaControl??null");
      if (control && control.id !== lastControl) {
        lastControl = control.id;
        nextFault = control.fault;
        await contents.executeJavaScript("window.__atlasVisitQaControlled=" + JSON.stringify(control.id));
      }
      const capture = await contents.executeJavaScript("window.__atlasVisitQaCapture??null");
      if (capture && capture !== lastCapture && /^[a-z-]+$/.test(capture)) {
        lastCapture = capture;
        await new Promise((resolve) => setTimeout(resolve, 300));
        await fs.writeFile(path.join(${JSON.stringify(output)}, "audit-visit-" + phase + "-" + capture + ".png"), (await contents.capturePage()).toPNG());
        await contents.executeJavaScript("window.__atlasVisitQaCaptured=" + JSON.stringify(capture));
      }
      if (!done && await contents.executeJavaScript("window.__atlasVisitQaDone===true")) {
        done = true;
        clearInterval(poll);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        console.log("SMOKE_RESULT " + await contents.executeJavaScript("JSON.stringify(window.__atlasSmoke??null)"));
        app.quit();
      }
    } catch (error) {
      if (!contents.isDestroyed()) console.error("VISIT_QA_ADAPTER_ERROR", error.stack);
    } finally {
      busy = false;
    }
  }, 100);
  app.once("before-quit", () => clearInterval(poll));
}));
require(${JSON.stringify(join(root, "dist/main/main.cjs"))});
`);
  execFileSync(process.execPath, ["--check", bootstrap], { cwd: root, stdio: "pipe" });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: productPackage.name, version: productPackage.version, main: "bootstrap-" + phase + ".cjs" }));
  const child = spawn(require2("electron"), [dir], { cwd: root, env: { ...process.env, ATLAS_WATCH_DB: join(dir, "qa.sqlite"), ATLAS_WATCH_USER_DATA: join(dir, "profile"), ATLAS_WATCH_SIMULATE_OFFLINE: phase === "offline" || config.large ? "1" : "0", ATLAS_WATCH_SMOKE: "1", ATLAS_WATCH_SMOKE_MS: "120000", ATLAS_WATCH_SMOKE_JS: join(root, "scripts/qa-visit.js"), ATLAS_WATCH_SMOKE_SHOT: join(output, "audit-visit-" + phase + "-final.png") }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const collect = (chunk) => {
    log += chunk;
    process.stdout.write(chunk);
    if (log.includes("SMOKE_SCRIPT_ERROR") || log.includes("VISIT_QA_ADAPTER_ERROR")) child.kill();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const timer = setTimeout(() => child.kill(), 14e4);
  let code;
  try {
    code = await new Promise((resolve2, reject) => {
      child.once("error", reject);
      child.once("exit", resolve2);
    });
  } finally {
    clearTimeout(timer);
  }
  await writeFile(join(output, "visit-" + phase + ".log"), log);
  console.log(log.split(/\r?\n/).filter((line) => /SMOKE_|VISIT_QA/.test(line) && !/^SMOKE_SCRIPT /.test(line)).join("\n"));
  assert.equal(code, 0, "Visit " + phase + " desktop phase failed");
  assert(!log.includes("SMOKE_SCRIPT_ERROR") && !log.includes("VISIT_QA_ADAPTER_ERROR"));
  const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1] ?? "null"), renderer = JSON.parse(/^SMOKE_RESULT (.+)$/m.exec(log)?.[1] ?? "null");
  assert.equal(scenario?.result, "PASS");
  assert.deepEqual(renderer?.errors, []);
  assert.equal(renderer?.globeReady, true);
  const observedDocs = JSON.parse(await readFile(documents, "utf8")), exported = JSON.parse(await readFile(saves, "utf8"));
  for (const item of exported) {
    const bytes = await readFile(item.path);
    if (item.format === "html") {
      if (config.large) {
        assert(Array.isArray(item.request) && item.request.length === 900, "Large export must explicitly regenerate selected locations");
        assert(bytes.length > 8 * 1024 * 1024 && bytes.toString("utf8").includes("QA large location 899"), "Large export omitted selected locations");
      } else {
        const document = observedDocs.find((doc) => doc.previewId === item.request.previewId);
        assert(document, "Export did not use an observed frozen preview");
        assert.equal(bytes.toString("utf8"), document.html, "HTML differs from the exact main-frozen preview");
      }
    } else {
      assert(bytes.subarray(0, 5).toString() === "%PDF-");
      assert(bytes.subarray(-1024).toString().includes("%%EOF"));
      assert(bytes.length > 1e3);
    }
    item.bytes = bytes.length;
    item.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  const visitDoc = [...observedDocs].reverse().find((doc) => doc.mode === "visit");
  if (config.large) {
    const document = observedDocs.find((doc) => doc.exportPolicy === "current-locations");
    assert(document && document.previewId === null && document.html === "" && document.locationCount === 900 && document.byteLength > 8 * 1024 * 1024);
    const value2 = { phase, scenario, exports: exported, largeReport: { locationCount: document.locationCount, byteLength: document.byteLength, exportPolicy: document.exportPolicy, previewId: document.previewId }, sourceAudit: [] };
    phases.push(value2);
    console.log("VISIT_PHASE " + JSON.stringify({ phase, result: "PASS", largeReport: value2.largeReport }));
    return value2;
  }
  assert(visitDoc, "No visit preview observed");
  const probePath = join(dir, "probe-" + phase + ".json");
  await writeFile(probePath, JSON.stringify({ at: visitDoc.generatedAt }));
  const probe = JSON.parse(execFileSync(process.execPath, [helper, "probe", join(dir, "qa.sqlite"), probePath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 }));
  if (phase === "first") {
    assert.equal(probe.report.previousStartedAt, null);
    for (const feed of Object.values(probe.report.feeds)) assert.equal(feed.new.total, null);
  }
  if (phase === "second") for (const feed of Object.values(probe.report.feeds)) {
    assert.equal(feed.status, "ready");
    assert.notEqual(feed.new.total, null);
  }
  if (phase === "offline") for (const feed of Object.values(probe.report.feeds)) {
    assert.equal(feed.new.total, null);
    assert.equal(feed.noLongerReturned.total, null);
  }
  if (config.fixture) for (const [name, feed] of Object.entries(probe.report.feeds)) {
    const unavailable = config.fixture.kind === "partial" || config.fixture.kind === "scope" && name === "usgs";
    if (unavailable) {
      assert.equal(feed.new.total, null);
      assert.equal(feed.updated.total, null);
      assert.equal(feed.noLongerReturned.total, null);
    } else {
      assert.equal(feed.new.total, 6);
      assert.equal(feed.updated.total, 1);
      assert.equal(feed.noLongerReturned.total, 6);
      assert.equal(feed.new.examples.length, 5);
      assert.equal(feed.new.truncated, true);
    }
  }
  for (const feed of Object.values(probe.report.feeds)) for (const kind of ["new", "updated", "noLongerReturned"]) assert(feed[kind].examples.length <= 5);
  let upstream = [];
  try {
    upstream = JSON.parse(await readFile(sources, "utf8"));
    allSources.push(...upstream);
  } catch {
    assert.equal(phase, "offline");
  }
  if (!config.fixture) for (const record of probe.endpointRecords) {
    const matches = allSources.some((source) => source.transport === "actual network" && source.feed === record.feed && source.httpStatus === 200 && source.body.features?.some((feature) => record.feed === "nws" ? (feature.properties?.id === record.id || feature.id === record.id) && (record.sent === null ? feature.properties?.sent == null : new Date(feature.properties.sent).toISOString() === record.sent) : (feature.id === record.id || String(feature.properties?.ids ?? "").split(",").includes(record.id)) && feature.properties?.mag === record.mag && feature.geometry?.coordinates?.[0] === record.lon && feature.geometry?.coordinates?.[1] === record.lat && new Date(feature.properties.updated).toISOString() === record.updated));
    assert(matches, "Archived visit endpoint value absent from captured real source: " + record.id);
  }
  const value = { phase, scenario, report: probe.report, independentCounts: probe.comparisons, actualEndpointRecordsChecked: config.fixture ? 0 : probe.endpointRecords.length, exports: exported, sourceAudit: upstream.map((source) => ({ feed: source.feed, transport: source.transport, requestUrl: source.requestUrl, httpStatus: source.httpStatus, responseDate: source.responseDate, receivedAt: source.receivedAt, featureCount: source.body.features?.length ?? null, payloadSha256: createHash("sha256").update(JSON.stringify(source.body)).digest("hex") })) };
  phases.push(value);
  console.log("VISIT_PHASE " + JSON.stringify({ phase, result: "PASS", status: Object.fromEntries(Object.entries(probe.report.feeds).map(([feed, value2]) => [feed, value2.status])), exports: exported.map((item) => ({ format: item.format, bytes: item.bytes })) }));
  return value;
}
console.log(JSON.stringify({ status: "STARTING", session, output, live: "real two launches plus offline third launch", fixtures: "separate explicitly synthetic profiles" }));
await run("first", liveDir);
await run("second", liveDir);
await run("offline", liveDir);
for (const kind of ["positive", "scope", "partial"]) {
  const dir = join(session, kind);
  await mkdir(dir);
  const config = { fixture: fixture(kind) }, configPath = join(dir, "config.json");
  await writeFile(configPath, JSON.stringify(config));
  execFileSync(process.execPath, [helper, "seed", join(dir, "qa.sqlite"), configPath], { cwd: root, stdio: "pipe" });
  await run("fixture-" + kind, dir, config);
}
const largeDir = join(session, "large"), largeConfig = { large: true };
await mkdir(largeDir);
await writeFile(join(largeDir, "config.json"), JSON.stringify(largeConfig));
execFileSync(process.execPath, [helper, "seed", join(largeDir, "qa.sqlite"), join(largeDir, "config.json")], { cwd: root, stdio: "pipe" });
await run("large", largeDir, largeConfig);
assert.deepEqual(await hashes(), beforeHashes, "Built assets changed during visit QA");
const audit = { result: "PASS", appVersion:productPackage.version, startedAt, completedAt:new Date().toISOString(), phases, builtAssetsUnchanged: true, assetSha256: beforeHashes, adapters: "TEMP picker results, preview timing/failure injection; explicit fixture-only HTTP adapters in separate profiles. Real phases never replace source data.", nativePickerInteractionVerified: false, installerExecuted: false, largeReportPdfPrinted:false, session, output };
await writeFile(join(root, "docs/visit-audit.log"), JSON.stringify(audit, null, 2));
await writeFile(join(output, "visit-audit.log"), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ result: "PASS", phases: phases.length, assetSha256: beforeHashes, session, output }, null, 2));
