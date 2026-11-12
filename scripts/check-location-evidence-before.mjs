// Offline before-state acceptance against untouched current production bundles.
// TEMP profile and saved place only. This is an instrumented Electron run, not an installer test.
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
const temporary = await mkdtemp(join(tmpdir(), "atlas-location-evidence-before-"));
const output = join(root, "docs/screenshots/location-evidence");
await mkdir(output, { recursive: true });
const database = join(temporary, "qa.sqlite");
const seed = join(temporary, "seed.cjs");
const placeName = "QA offline saved place \u2014 Washington";
await build({ stdin: { loader: "ts", resolveDir: root, contents: `
import { AtlasStore } from ${JSON.stringify(join(root, "src/main/store.ts"))};
const store = new AtlasStore(${JSON.stringify(database)});
store.saveSettings({ ...store.getSettings(), basemap: "neutral", terrainEnabled: false, labelsOverlay: false, buildings3d: false, layersEnabled: [], zoneLookupEnabled: false, nwsPollSeconds: 3600, usgsPollSeconds: 3600 });
store.createLocation({ name: ${JSON.stringify(placeName)}, category: "Isolated QA setup", notes: "Manual saved place; no provider observations", lat: 38.9, lon: -77.03, radiusKm: 25 }, (/* @__PURE__ */ new Date()).toISOString(), { status: "disabled", zones: [], checkedAt: null, error: null });
store.close();
` }, bundle: true, platform: "node", format: "cjs", target: "node24", outfile: seed, logLevel: "silent" });
execFileSync(process.execPath, [seed], { cwd: root, stdio: "pipe" });
const product = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await writeFile(join(temporary, "package.json"), JSON.stringify({ name: product.name, version: product.version, main: "bootstrap.cjs" }));
const html = await readFile(join(root, "dist/renderer/index.html"), "utf8");
const assets = ["dist/main/main.cjs", "dist/preload/preload.cjs", "dist/renderer/index.html", ...Array.from(html.matchAll(/(?:src|href)="\/(assets\/[^\"]+)"/g), (match) => "dist/renderer/" + match[1])];
const hashes = async () => Object.fromEntries(await Promise.all(assets.map(async (path) => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
const beforeHashes = await hashes();
const bootstrap = join(temporary, "bootstrap.cjs");
await writeFile(bootstrap, `
const { app, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
let providerFetches = 0, saveCount = 0;
globalThis.fetch = async () => {
  providerFetches++;
  throw new Error("Explicit offline baseline: provider fetch prohibited");
};
dialog.showErrorBox = (title, message) => {
  console.error("LOCATION_BASELINE_STARTUP_ERROR", title, message);
  app.exit(1);
};
dialog.showSaveDialog = async (...args) => {
  const pdf = args.at(-1).filters?.some((filter) => filter.extensions?.includes("pdf"));
  return { canceled: false, filePath: ${JSON.stringify(output)}/location-before-" + ++saveCount + (pdf ? ".pdf" : ".html") };
};
const savedFiles = [], handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "briefing:export" && result) {
    savedFiles.push({ path: result, format: args[1] });
    await fs.writeFile(${JSON.stringify(join(temporary, "saved-files.json"))}, JSON.stringify(savedFiles));
  }
  return result;
});
app.on("web-contents-created", (_event, contents) => contents.once("did-finish-load", async () => {
  if (!contents.getURL().startsWith("app://atlas/")) return;
  await contents.executeJavaScript("window.__atlasLocationEvidence=" + JSON.stringify({ placeName: ${JSON.stringify(placeName)} }));
  let busy = false, lastCapture = "", done = false;
  const poll = setInterval(async () => {
    if (busy || contents.isDestroyed()) return;
    busy = true;
    try {
      const label = await contents.executeJavaScript("window.__atlasLocationEvidenceCapture??null");
      if (label && label !== lastCapture && /^[a-z-]+$/.test(label)) {
        lastCapture = label;
        await new Promise((resolve) => setTimeout(resolve, 300));
        await fs.writeFile(${JSON.stringify(output)}/audit-location-before-" + label + ".png", (await contents.capturePage()).toPNG());
        await contents.executeJavaScript("window.__atlasLocationEvidenceCaptured=" + JSON.stringify(label));
      }
      if (!done && await contents.executeJavaScript("window.__atlasLocationEvidenceDone===true")) {
        done = true;
        clearInterval(poll);
        await new Promise((resolve) => setTimeout(resolve, 3e3));
        console.log("LOCATION_BASELINE_PROVIDER_FETCHES " + providerFetches);
        app.quit();
      }
    } catch (error) {
      if (!contents.isDestroyed()) console.error("LOCATION_BASELINE_ADAPTER_ERROR", error.stack);
    } finally {
      busy = false;
    }
  }, 100);
  app.once("before-quit", () => clearInterval(poll));
}));
require(${JSON.stringify(join(root, "dist/main/main.cjs"))});
`);
execFileSync(process.execPath, ["--check", bootstrap], { cwd: root, stdio: "pipe" });
const startedAt = (/* @__PURE__ */ new Date()).toISOString();
const child = spawn(require2("electron"), [temporary], { cwd: root, env: {
  ...process.env,
  ATLAS_WATCH_DB: database,
  ATLAS_WATCH_USER_DATA: join(temporary, "profile"),
  ATLAS_WATCH_SIMULATE_OFFLINE: "1",
  ATLAS_WATCH_SMOKE: "1",
  ATLAS_WATCH_SMOKE_MS: "60000",
  ATLAS_WATCH_SMOKE_JS: join(root, "scripts/qa-location-evidence-before.js"),
  ATLAS_WATCH_SMOKE_SHOT: join(output, "audit-location-before-final.png")
}, stdio: ["ignore", "pipe", "pipe"] });
let rawLog = "";
const collect = (chunk) => {
  rawLog += chunk;
  process.stdout.write(chunk);
  if (/SMOKE_SCRIPT_ERROR|LOCATION_BASELINE_ADAPTER_ERROR/.test(rawLog)) child.kill();
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);
const timeout = setTimeout(() => child.kill(), 75e3);
let exitCode;
try {
  exitCode = await new Promise((resolve2, reject) => {
    child.once("error", reject);
    child.once("exit", resolve2);
  });
} finally {
  clearTimeout(timeout);
}
const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(rawLog)?.[1] ?? "null");
const saved = JSON.parse(await readFile(join(temporary, "saved-files.json"), "utf8").catch(() => "[]"));
for (const item of saved) {
  const bytes = await readFile(item.path);
  item.bytes = bytes.length;
  item.sha256 = createHash("sha256").update(bytes).digest("hex");
}
const report = {
  result: exitCode === 0 && scenario?.result === "PASS" ? "PASS" : "FAIL",
  phase: "before",
  startedAt,
  finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
  appVersion: product.version,
  temporary,
  database,
  instrumentation: "Existing isolated app QA entry; forced offline, zero provider observations, adapted save-picker results",
  genuineProfileAccessed: false,
  installerExecuted: false,
  assetsSha256: beforeHashes,
  builtAssetsUnchanged: JSON.stringify(beforeHashes) === JSON.stringify(await hashes()),
  scenario,
  saved,
  rawLog
};
await writeFile(join(root, "docs/location-evidence-before.log"), JSON.stringify(report, null, 2));
assert.equal(exitCode, 0);
assert.equal(report.result, "PASS");
assert.equal(report.builtAssetsUnchanged, true);
assert(rawLog.includes("LOCATION_BASELINE_PROVIDER_FETCHES 0"));
console.log(JSON.stringify({ result: report.result, temporary, saved, scenario }, null, 2));
