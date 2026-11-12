// Normal production executable launch; no bootstrap, remote debugger or test hooks.
// Read-only Computer Use inspection writes --ui-evidence while this runner waits.
// node scripts/check-packaged-launch.mjs [--log path] [--ui-evidence path]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  if (!['--log', '--ui-evidence'].includes(process.argv[index]) || !process.argv[index + 1]) throw new Error('Expected --log or --ui-evidence followed by a local path.');
  options[process.argv[index].slice(2)] = resolve(process.argv[index + 1]);
}
const logPath = options.log ?? join(root, 'docs', 'packaged-launch-audit.log');
const uiPath = options['ui-evidence'] ?? join(root, 'docs', 'packaged-launch-ui.json');
const executable = join(root, 'release', 'win-unpacked', 'Atlas Watch.exe');
const archive = join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
if (!existsSync(executable) || !existsSync(archive)) throw new Error('Package the production executable first.');
const startedAt = new Date().toISOString(), startedMs = Date.now();
const temporary = mkdtempSync(join(tmpdir(), 'atlas-packaged-launch-'));
const profile = join(temporary, 'profile'), dbPath = join(temporary, 'live.sqlite');
mkdirSync(profile);
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^ATLAS_WATCH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$/.test(key)) delete environment[key];
environment.ATLAS_WATCH_DB = dbPath;
const hash = () => createHash('sha256').update(readFileSync(archive)).digest('hex').toUpperCase();
const archiveHash = hash();
const child = spawn(executable, [`--user-data-dir=${profile}`], { cwd: dirname(executable), env: environment,
  windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
const report = { result: 'FAIL', startedAt, executable, archiveSha256: archiveHash, spawnedPid: child.pid,
  profile, database: dbPath, normalPackagedStartup: true, testHooksEnabled: false, remoteDebuggerEnabled: false,
  genuineProfileAccessed: false, installerExecuted: false };
console.log(`PACKAGED_LAUNCH_STARTED ${JSON.stringify({ pid: child.pid, executable, profile, database: dbPath, uiEvidence: uiPath })}`);
let logs = '', database = null, feedReady = false, finished = false;
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-100_000); };
child.stdout.on('data', capture); child.stderr.on('data', capture);
function inspectDatabase() {
  if (!existsSync(dbPath)) return null;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const caches = db.prepare('SELECT feed, fetched_at, source_updated_at FROM feed_cache ORDER BY feed').all();
    const epochs = db.prepare(`SELECT feed, observed_at, source_updated_at, scope, state, reason, expected_count
      FROM timeline_epochs WHERE id IN (SELECT MAX(id) FROM timeline_epochs GROUP BY feed) ORDER BY feed`).all();
    const secretRows = Number(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'secret:%'").get().n);
    return { caches, epochs, encryptedCredentialRows: secretRows };
  } catch { return null; }
  finally { db?.close(); }
}
const inspect = () => {
  database = inspectDatabase() ?? database;
  const ready = database && ['nws', 'usgs'].every(feed => database.caches.some(cache => cache.feed === feed && Date.parse(cache.fetched_at) >= startedMs)
    && database.epochs.some(epoch => epoch.feed === feed && ['recorded', 'partial'].includes(epoch.state) && Date.parse(epoch.observed_at) >= startedMs));
  if (ready && !feedReady) { feedReady = true; console.log(`PACKAGED_LIVE_FEEDS_READY ${JSON.stringify(database)}`); }
};
const poll = setInterval(inspect, 1000);
const timeout = setTimeout(() => {
  if (!finished) { report.timeout = true; child.kill(); }
}, 150_000);
const exit = await new Promise(resolveExit => {
  child.once('error', error => resolveExit({ code: null, error: error.message }));
  child.once('exit', (code, signal) => resolveExit({ code, signal }));
});
finished = true; clearInterval(poll); clearTimeout(timeout); inspect();
let ui = null;
if (existsSync(uiPath) && statSync(uiPath).mtimeMs >= startedMs) {
  try { ui = JSON.parse(readFileSync(uiPath, 'utf8')); } catch { /* A malformed/stale UI record cannot establish verification. */ }
}
Object.assign(report, { finishedAt: new Date().toISOString(), exit, databaseState: database, liveFeedsRecorded: feedReady,
  isolatedProfileCreated: existsSync(join(profile, 'Local State')) || existsSync(join(profile, 'Preferences')),
  uiEvidence: uiPath, uiVerified: ui?.verified === true, uiWindow: ui?.window ?? null,
  archiveStableDuringRun: archiveHash === hash(),
  diagnostics: logs.split(/\r?\n/).filter(line => /^\[feeds\]|^\[timeline\]|^\[security\]|Uncaught|did-fail-load|could not start/i.test(line)).slice(-30) });
report.result = report.liveFeedsRecorded && report.isolatedProfileCreated && report.uiVerified && report.archiveStableDuringRun && exit.code === 0 && !report.timeout ? 'PASS'
  : report.liveFeedsRecorded && report.isolatedProfileCreated && report.archiveStableDuringRun ? 'PARTIAL' : 'FAIL';
if (!report.uiVerified) report.verificationLimit = 'Normal startup and local live-feed recording can be established independently; rendered GUI remains unverified without successful window inspection.';
writeFileSync(logPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`PACKAGED_LAUNCH_RESULT ${JSON.stringify(report)}`);
process.exitCode = report.result === 'PASS' ? 0 : report.result === 'PARTIAL' ? 2 : 1;
