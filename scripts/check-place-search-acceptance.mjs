// Sequential independent profiles: a controlled-fixture failure cannot skip actual Census evidence.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archive = join(root, 'release/win-unpacked/resources/app.asar');
const hash = async () => createHash('sha256').update(await readFile(archive)).digest('hex');
const report = { result: 'FAIL', startedAt: new Date().toISOString(), archiveSha256: await hash(), phases: [] };
for (const scenario of ['full', 'live-census']) {
  if (scenario === 'live-census') {
    try {
      const path = join(root, 'docs/place-search-live-census-audit.log');
      const previous = JSON.parse(await readFile(path, 'utf8'));
      if (previous.result === 'PASS' && previous.archiveSha256 === report.archiveSha256
          && previous.closedByRunner && previous.archiveStableDuringRun) {
        report.phases.push({ scenario, exit: { code: 0 }, result: 'PASS', reportPath: path,
          temporary: previous.temporary, explicitlyReusedPriorIndependentLiveCheck: true,
          observedAt: previous.liveCensus.response.receivedAt, reason: 'Same exact ASAR already passed one real bounded public-address lookup; no second real request was sent.' });
        console.log('PLACE_SEARCH_ACCEPTANCE_REUSED_LIVE ' + previous.liveCensus.response.receivedAt);
        continue;
      }
    } catch { /* A missing or incompatible live check requires its own fresh process. */ }
  }
  console.log('PLACE_SEARCH_ACCEPTANCE_BEGIN ' + scenario);
  const args = [join(root, 'scripts/check-place-search-packaged.mjs'), 'after'];
  if (scenario === 'live-census') args.push('live-census');
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes.toString(); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-10000); });
  const exit = await new Promise(resolveExit => {
    child.once('error', error => resolveExit({ code: null, error: error.message }));
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let outcome;
  try { outcome = JSON.parse(stdout); } catch { outcome = { result: 'FAIL', failure: 'Child produced no parseable terminal report', stdoutTail: stdout.slice(-2000) }; }
  report.phases.push({ scenario, exit, ...outcome, stderr });
  console.log('PLACE_SEARCH_ACCEPTANCE_END ' + JSON.stringify({ scenario, exit, result: outcome.result, reportPath: outcome.reportPath, failure: outcome.failure }));
  await writeFile(join(root, 'docs/place-search-acceptance-audit.log'), JSON.stringify(report, null, 2));
}
report.archiveStableDuringRun = await hash() === report.archiveSha256;
report.finishedAt = new Date().toISOString();
report.result = report.archiveStableDuringRun && report.phases.every(phase => phase.exit.code === 0 && phase.result === 'PASS') ? 'PASS' : 'FAIL';
await writeFile(join(root, 'docs/place-search-acceptance-audit.log'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ result: report.result, archiveSha256: report.archiveSha256, archiveStableDuringRun: report.archiveStableDuringRun,
  phases: report.phases.map(phase => ({ scenario: phase.scenario, result: phase.result, reportPath: phase.reportPath, temporary: phase.temporary })) }, null, 2));
process.exitCode = report.result === 'PASS' ? 0 : 1;
