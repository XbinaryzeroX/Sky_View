// Capture the actual pre-DWD packaged app. Isolated profile; no source or package mutation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadPlaywrightRuntime } from "./qa-playwright-runtime.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { electron, version } = loadPlaywrightRuntime();
const temporary = await mkdtemp(join(tmpdir(), "atlas-dwd-before-"));
const profile = join(temporary, "profile");
const database = join(temporary, "qa.sqlite");
const output = join(root, "docs/screenshots/dwd");
await mkdir(profile);
await mkdir(output, { recursive: true });
const seed = join(temporary, "seed.cjs");
await build({ stdin: { loader: "ts", resolveDir: root, contents: `
import {AtlasStore} from ${JSON.stringify(join(root, "src/main/store.ts"))};
const store=new AtlasStore(${JSON.stringify(database)});
store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false,nwsPollSeconds:3600,usgsPollSeconds:3600});
store.close();
` }, bundle: true, platform: "node", format: "cjs", target: "node24", outfile: seed, logLevel: "silent" });
execFileSync(process.execPath, [seed], { cwd: root, stdio: "pipe" });
const executable = join(root, "release/win-unpacked/Atlas Watch.exe");
const archive = join(root, "release/win-unpacked/resources/app.asar");
const hash = async () => createHash("sha256").update(await readFile(archive)).digest("hex");
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^ATLAS_WATCH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^ELECTRON_NO_SANDBOX$|^ELECTRON_DISABLE_SANDBOX$/.test(key)) delete environment[key];
environment.ATLAS_WATCH_DB = database;
const report = {
  result: "FAIL",
  startedAt: new Date().toISOString(),
  archiveSha256: await hash(),
  executable,
  temporary,
  database,
  profile,
  framework: "playwright-core " + version,
  syntheticProviderData: false,
  genuineProfileAccessed: false,
  installerExecuted: false,
  screenshots: [],
  errors: []
};
let app, page;
try {
  app = await electron.launch({ executablePath: executable, chromiumSandbox: true, args: ["--user-data-dir=" + profile], cwd: dirname(executable), env: environment, timeout: 45e3 });
  page = await app.firstWindow({ timeout: 3e4 });
  page.setDefaultTimeout(2e4);
  page.on("pageerror", (error) => report.errors.push(error.message));
  report.security = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    isPackaged: electronApp.isPackaged,
    version: electronApp.getVersion(),
    appPath: electronApp.getAppPath(),
    userData: electronApp.getPath("userData"),
    windows: BrowserWindow.getAllWindows().map((browserWindow) => {
      const p = browserWindow.webContents.getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
    })
  }));
  assert.equal(report.security.isPackaged, true);
  assert.equal(resolve(report.security.appPath), resolve(archive));
  assert.equal(resolve(report.security.userData).toLowerCase(), resolve(profile).toLowerCase());
  assert(report.security.windows.every((p) => p.contextIsolation && p.sandbox && !p.nodeIntegration && p.webSecurity));
  const search = page.getByRole("textbox", { name: "Find a layer", exact: true });
  await search.waitFor({ state: "visible" });
  report.layerIds = await page.evaluate(async () => (await window.atlas.getLayers()).map((snapshot) => snapshot.id ?? snapshot.status.id));
  assert(!report.layerIds.some((id) => /dwd|german/i.test(id)), "This package already has a German warning layer");
  const capture = async (name) => {
    const path = join(output, "audit-dwd-before-" + name + ".png");
    await page.screenshot({ path });
    report.screenshots.push(path);
  };
  report.layerSearches = [];
  for (const query of ["DWD", "Germany", "weather"]) {
    await search.fill(query);
    const names = await page.locator(".layer-row .layer-name").allTextContents();
    report.layerSearches.push({ query, names });
    assert(!names.some((name) => /DWD|Deutscher|Germany|German warnings/i.test(name)));
    await capture("layers-" + query.toLowerCase());
  }
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const events = page.locator('.page-panel[aria-label="Events"]');
  await events.waitFor({ state: "visible" });
  report.eventTypeOptions = await events.getByRole("combobox", { name: "Event type", exact: true }).locator("option").allTextContents();
  assert(report.eventTypeOptions.includes("Weather alerts (U.S.)"));
  assert(!report.eventTypeOptions.some((name) => /German|DWD|Deutschland/i.test(name)));
  await events.getByRole("combobox", { name: "Event type", exact: true }).selectOption("alert");
  report.eventsText = (await events.innerText()).slice(0, 7e3);
  await capture("events");
  report.core = await page.evaluate(async () => {
    const snap = await window.atlas.getState();
    return { counts: { nws: snap.alerts.length, usgs: snap.quakes.length }, feeds: snap.feeds, layersEnabled: snap.settings.layersEnabled };
  });
  assert.deepEqual(report.core.layersEnabled, []);
  assert.equal(report.errors.length, 0);
  report.result = "PASS";
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  if (page) {
    try {
      await page.screenshot({ path: join(output, "audit-dwd-before-failure.png") });
    } catch {
    }
  }
} finally {
  if (app) {
    await app.close();
    report.closedByRunner = true;
  }
  report.finishedAt = new Date().toISOString();
  report.archiveStableDuringRun = report.archiveSha256 === await hash();
  if (!report.archiveStableDuringRun || !report.closedByRunner) report.result = "FAIL";
  await writeFile(join(root, "docs/dwd-before-audit.log"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.result === "PASS" ? 0 : 1;
