// Controlled desktop acceptance, using actual production bundles with isolated fixture profiles.
// No real provider response is replaced in any live/package test; these profiles are synthetic only.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require2 = createRequire(import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), "atlas-location-evidence-ui-"));
const output = join(root, "docs/screenshots/location-evidence");
await mkdir(output, { recursive: true });
const product = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const helper = join(temporary, "fixture.cjs");
await build({ entryPoints: [join(root, "scripts/location-evidence-fixture.ts")], bundle: true, platform: "node", format: "cjs", target: "node24", outfile: helper, logLevel: "silent" });
const html = await readFile(join(root, "dist/renderer/index.html"), "utf8");
const assetPaths = ["dist/main/main.cjs", "dist/preload/preload.cjs", "dist/renderer/index.html", ...Array.from(html.matchAll(/(?:src|href)="\/(assets\/[^\"]+)"/g), (match) => "dist/renderer/" + match[1])];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = async () => Object.fromEntries(await Promise.all(assetPaths.map(async (path) => [path, digest(await readFile(join(root, path)))])));
const initialHashes = await hashes(), startedAt = (/* @__PURE__ */ new Date()).toISOString(), phases = [];
function responses(at, partial = false, empty = false) {
  const alert = (id, polygon) => ({
    type: "Feature",
    id: "https://api.weather.gov/alerts/" + id,
    geometry: polygon ? { type: "Polygon", coordinates: [[[-123, 37], [-121, 37], [-121, 38], [-123, 38], [-123, 37]]] } : null,
    properties: {
      id,
      event: polygon ? "QA SYNTHETIC EVIDENCE polygon alert" : "QA SYNTHETIC EVIDENCE county-only alert",
      headline: "Explicit isolated acceptance fixture",
      description: "Not a real observation",
      senderName: "Explicit QA fixture",
      sent: new Date(at).toISOString(),
      effective: new Date(at).toISOString(),
      onset: new Date(at).toISOString(),
      expires: new Date(Date.now() + 36e5).toISOString(),
      severity: "Moderate",
      urgency: "Expected",
      certainty: "Observed",
      status: "Actual",
      messageType: "Alert",
      affectedZones: polygon ? [] : ["https://api.weather.gov/zones/county/CAC001"],
      references: [],
      geocode: { UGC: [] }
    }
  });
  const quake = {
    type: "Feature",
    id: "qa-location-quake",
    geometry: { type: "Point", coordinates: [-122, 37.5, 8] },
    properties: { mag: 3.2, type: "earthquake", title: "QA SYNTHETIC EVIDENCE earthquake", place: "QA SYNTHETIC EVIDENCE earthquake", time: at - 6e4, updated: at, ids: ",qa-location-quake,", status: "reviewed", url: "https://earthquake.usgs.gov/earthquakes/eventpage/qa-location-quake" }
  };
  return {
    nws: { type: "FeatureCollection", updated: new Date(at).toISOString(), features: [...empty ? [] : [alert("qa-location-polygon", true), alert("qa-location-county", false)], ...partial ? [null] : []] },
    usgs: { type: "FeatureCollection", metadata: { generated: at, count: empty ? 0 : 1 }, features: [...empty ? [] : [quake], ...partial ? [null] : []] }
  };
}
async function run(kind, directory, configuration) {
  const config = { ...configuration, kind };
  const configPath = join(directory, "config-" + kind + ".json");
  await writeFile(configPath, JSON.stringify(config));
  const previewPath = join(directory, "previews-" + kind + ".json");
  const exportPath = join(directory, "exports-" + kind + ".json");
  const bootstrap = join(directory, "bootstrap-" + kind + ".cjs");
  await writeFile(bootstrap, `
const { app, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const config = ${JSON.stringify(config)};
let calls = 0, saveNumber = 0;
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  const feed = url.startsWith("https://api.weather.gov/alerts/active") ? "nws" : url.startsWith("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/") ? "usgs" : null;
  if (!feed) throw new Error("Explicit synthetic profile blocks unrelated requests");
  calls++;
  if (!config.current?.[feed]) throw new Error("Explicit synthetic unavailable " + feed);
  return new Response(JSON.stringify(config.current[feed]), { status: 200, headers: { "Content-Type": "application/json" } });
};
dialog.showErrorBox = (title, message) => {
  console.error("LOCATION_EVIDENCE_STARTUP_ERROR", title, message);
  app.exit(1);
};
dialog.showSaveDialog = async (...args) => {
  const pdf = args.at(-1).filters?.some((filter) => filter.extensions?.includes("pdf"));
  return { canceled: false, filePath: ${JSON.stringify(output)}/location-" + config.kind + "-" + ++saveNumber + (pdf ? ".pdf" : ".html") };
};
const previews = [], savedFiles = [], handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "briefing:preview" && result && typeof result === "object") {
    previews.push(result);
    await fs.writeFile(${JSON.stringify(previewPath)}, JSON.stringify(previews));
  }
  if (channel === "briefing:export" && result) {
    savedFiles.push({ path: result, format: args[1], request: args[0] });
    await fs.writeFile(${JSON.stringify(exportPath)}, JSON.stringify(savedFiles));
  }
  return result;
});
app.on("web-contents-created", (_event, contents) => contents.once("did-finish-load", async () => {
  if (!contents.getURL().startsWith("app://atlas/")) return;
  await contents.executeJavaScript("window.__atlasLocationEvidence=" + JSON.stringify(config));
  let busy = false, last = "", done = false;
  const timer = setInterval(async () => {
    if (busy || contents.isDestroyed()) return;
    busy = true;
    try {
      const label = await contents.executeJavaScript("window.__atlasLocationEvidenceCapture??null");
      if (label && label !== last && /^[a-z-]+$/.test(label)) {
        last = label;
        await new Promise((resolve) => setTimeout(resolve, 300));
        await fs.writeFile(${JSON.stringify(output)}/audit-location-" + config.kind + "-" + label + ".png", (await contents.capturePage()).toPNG());
        await contents.executeJavaScript("window.__atlasLocationEvidenceCaptured=" + JSON.stringify(label));
      }
      if (!done && await contents.executeJavaScript("window.__atlasLocationEvidenceDone===true")) {
        done = true;
        clearInterval(timer);
        await new Promise((resolve) => setTimeout(resolve, 3e3));
        console.log("LOCATION_EVIDENCE_FIXTURE_REQUESTS " + calls);
        app.quit();
      }
    } catch (error) {
      if (!contents.isDestroyed()) console.error("LOCATION_EVIDENCE_ADAPTER_ERROR", error.stack);
    } finally {
      busy = false;
    }
  }, 100);
  app.once("before-quit", () => clearInterval(timer));
}));
require(${JSON.stringify(join(root, "dist/main/main.cjs"))});
`);
  execFileSync(process.execPath, ["--check", bootstrap], { cwd: root, stdio: "pipe" });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: product.name, version: product.version, main: "bootstrap-" + kind + ".cjs" }));
  const child = spawn(require2("electron"), [directory], { cwd: root, env: {
    ...process.env,
    ATLAS_WATCH_DB: join(directory, "qa.sqlite"),
    ATLAS_WATCH_USER_DATA: join(directory, "profile"),
    ATLAS_WATCH_SIMULATE_OFFLINE: "0",
    ATLAS_WATCH_SMOKE: "1",
    ATLAS_WATCH_SMOKE_MS: "90000",
    ATLAS_WATCH_SMOKE_JS: join(root, "scripts/qa-location-evidence.js"),
    ATLAS_WATCH_SMOKE_SHOT: join(output, "audit-location-" + kind + "-final.png")
  }, stdio: ["ignore", "pipe", "pipe"] });
  let rawLog = "";
  const collect = (chunk) => {
    rawLog += chunk;
    if (!String(chunk).includes("SMOKE_SCRIPT ")) process.stdout.write(chunk);
    if (/SMOKE_SCRIPT_ERROR|LOCATION_EVIDENCE_ADAPTER_ERROR/.test(rawLog)) child.kill();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const watchdog = setTimeout(() => child.kill(), 11e4);
  let exitCode;
  try {
    exitCode = await new Promise((resolve2, reject) => {
      child.once("error", reject);
      child.once("exit", resolve2);
    });
  } finally {
    clearTimeout(watchdog);
  }
  await writeFile(join(output, "location-" + kind + ".log"), rawLog);
  assert.equal(exitCode, 0, "Desktop " + kind + " phase failed");
  const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(rawLog)?.[1] ?? "null");
  assert.equal(scenario?.result, "PASS");
  assert.deepEqual(scenario.rendererErrors, []);
  const documents = JSON.parse(await readFile(previewPath, "utf8"));
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  for (const item of exported) {
    const bytes = await readFile(item.path), document = documents.find((preview) => preview.previewId === item.request.previewId);
    assert(document && document.exportPolicy === "frozen");
    if (item.format === "html") assert.equal(bytes.toString("utf8"), document.html, "Export differed from frozen visible report");
    else assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    item.bytes = bytes.length;
    item.sha256 = digest(bytes);
  }
  const value = { kind, explicitSynthetic: true, scenario, exports: exported };
  phases.push(value);
  console.log("LOCATION_EVIDENCE_PHASE " + JSON.stringify({ kind, result: "PASS", summary: scenario.summaryRows }));
  return value;
}
console.log(JSON.stringify({ status: "STARTING", temporary, output, appVersion: product.version, sourceMode: "separate explicit synthetic profiles; no real provider observations" }));
for (const kind of ["missing", "mixed", "complete-empty", "partial-zero", "expired-cache"]) {
  const directory = join(temporary, kind);
  await mkdir(directory);
  const config = {
    kind,
    primaryName: kind === "missing" ? "QA offline saved place \u2014 Washington" : "QA primary saved place \u2014 Bay Area",
    secondaryName: "QA independent control \u2014 Washington",
    seed: responses(Date.now() - 4 * 36e5),
    current: ["missing", "expired-cache"].includes(kind) ? null : responses(Date.now(), kind === "mixed" || kind === "partial-zero", kind === "complete-empty" || kind === "partial-zero"),
    expectedStates: { nws: ["missing", "expired-cache"].includes(kind) ? "error" : "ok", usgs: ["missing", "mixed", "expired-cache"].includes(kind) ? "error" : "ok" }
  };
  if (kind === "mixed") config.current.usgs = null;
  if (kind === "expired-cache") for (const feature of config.seed.nws.features) feature.properties.expires = new Date(Date.now() - 3 * 36e5).toISOString();
  const configPath = join(directory, "config-seed.json");
  await writeFile(configPath, JSON.stringify(config));
  execFileSync(process.execPath, [helper, join(directory, "qa.sqlite"), configPath], { cwd: root, stdio: "pipe" });
  const phase = await run(kind, directory, config);
  if (kind === "mixed") await run("restart", directory, { ...config, current: null, expectedStates: { nws: "error", usgs: "error" }, expectedObservations: Object.fromEntries(["nws", "usgs"].map((feed) => [feed, phase.scenario.feeds[feed].lastSuccessAt])) });
}
assert.deepEqual(await hashes(), initialHashes, "Production bundles changed during acceptance");
const audit = {
  result: "PASS",
  startedAt,
  completedAt: (/* @__PURE__ */ new Date()).toISOString(),
  appVersion: product.version,
  temporary,
  output,
  assetSha256: initialHashes,
  builtAssetsUnchanged: true,
  instrumentation: "Existing QA entry; explicit synthetic HTTP adapters and earlier-clock fixture cache only in TEMP profiles; actual production normalizers/core/persistence/UI/export paths",
  genuineProfileAccessed: false,
  installerExecuted: false,
  nativePickerOperated: false,
  realProviderObservations: false,
  phases
};
await writeFile(join(root, "docs/location-evidence-fixtures.log"), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ result: "PASS", phases: phases.length, temporary, assetSha256: initialHashes }, null, 2));
