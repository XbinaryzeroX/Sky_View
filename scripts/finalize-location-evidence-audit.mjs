// Summarize completed acceptance evidence without duplicating provider payloads or credential values.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const before = await readJson('docs/location-evidence-before.log');
const fixtures = await readJson('docs/location-evidence-fixtures.log');
const packaged = await readJson('docs/location-evidence-packaged.log');
const inspection = await readJson('docs/screenshots/location-evidence/location-pdf-inspection.json');
const visual = await readJson('docs/screenshots/location-evidence/location-pdf-visual-review.json');
for (const report of [before, fixtures, packaged, inspection]) assert.equal(report.result, 'PASS');
assert.equal(visual.result, 'PASS', 'Independent PDF visual review has not passed');
assert.equal(fixtures.phases.length, 6);
assert.equal(packaged.phases.length, 2);
assert.equal(before.builtAssetsUnchanged, true);
assert.equal(fixtures.builtAssetsUnchanged, true);
assert.equal(packaged.archiveStableDuringRun, true);
assert.equal(sha256(await readFile(join(root, 'release/win-unpacked/resources/app.asar'))), packaged.archiveSha256);
for (const [path, digest] of Object.entries(fixtures.assetSha256)) assert.equal(sha256(await readFile(join(root, path))), digest);
for (const phase of [...fixtures.phases, ...packaged.phases]) {
  for (const item of phase.exports) {
    const bytes = await readFile(item.path);
    assert.equal(bytes.length, item.bytes);
    assert.equal(sha256(bytes), item.sha256);
  }
}
const artifact = path => path.replaceAll('\\', '/');
const audit = {
  result: 'PASS',
  completedAt: new Date().toISOString(),
  appVersion: '0.7.0',
  before: {
    log: 'docs/location-evidence-before.log', inputHashes: before.assetsSha256,
    providerRequests: 0, summaryDisplayedZeroDespiteUnavailable: before.scenario.missingFeedsDisplayedAsZeroInSummary,
    summary: before.scenario.summaryCells,
    screenshot: 'docs/screenshots/location-evidence/audit-location-before-summary.png',
  },
  fixtures: {
    log: 'docs/location-evidence-fixtures.log', earlierLog: 'docs/location-evidence-fixtures-pre-overview-fix.log',
    explicitSynthetic: true, builtAssetsUnchanged: true, inputHashes: fixtures.assetSha256,
    phases: fixtures.phases.map(phase => ({
      kind: phase.kind, result: phase.scenario.result, summaryRows: phase.scenario.summaryRows,
      observationTimes: Object.fromEntries(Object.entries(phase.scenario.feeds).map(([feed, status]) => [feed, status.lastSuccessAt])),
      coverage: Object.fromEntries(Object.entries(phase.scenario.feeds).map(([feed, status]) => [feed, status.coverage])),
      summaryBounds: phase.scenario.summaryBounds, rendererErrors: phase.scenario.rendererErrors,
      exports: phase.exports, screenshot: `docs/screenshots/location-evidence/audit-location-${phase.kind}-summary.png`,
    })),
  },
  actualPackaged: {
    log: 'docs/location-evidence-packaged.log', archiveSha256: packaged.archiveSha256,
    framework: packaged.framework,
    archiveStableDuringRun: true, sourceResponsesReplaced: false, profileIsolated: true,
    phases: packaged.phases.map(phase => ({
      phase: phase.phase, startedAt: phase.startedAt, finishedAt: phase.finishedAt,
      appVersion: phase.security.version, security: phase.security,
      sourceAudit: phase.sourceAudit, realRecordChecks: phase.rawRecordChecks,
      sourceCounts: Object.fromEntries(Object.entries(phase.feeds).map(([feed, status]) => [feed, status.recordCount])),
      observationTimes: Object.fromEntries(Object.entries(phase.feeds).map(([feed, status]) => [feed, status.lastSuccessAt])),
      manualLocations: phase.manualLocations, selectedSourceIds: phase.selectedSourceIds,
      summaryRows: phase.summaryRows, rendererErrors: phase.errors,
      credentialStatusOnly: phase.providerCredentialStatus,
      configuredCredentialProviderIds: phase.providerCredentialStatus.filter(provider => provider.credentialSource !== null || provider.userConfigured).map(provider => provider.id),
      exports: phase.exports.map(item => ({ ...item, path: artifact(item.path) })), screenshots: phase.screenshots,
    })),
  },
  documents: {
    inspection: 'docs/screenshots/location-evidence/location-pdf-inspection.json',
    visualReview: 'docs/screenshots/location-evidence/location-pdf-visual-review.json',
    pdfCountIncludingHistoricalBaseline: inspection.files.length,
    pageCountIncludingHistoricalBaseline: inspection.files.reduce((count, file) => count + file.pages, 0),
    fullBodyTextPreserved: true,
    allTextWithinPrintSafeBounds: true,
    independentVisualReview: visual,
  },
  limits: {
    nativeSavePickerOperated: false,
    installerExecuted: false,
    genuineUserProfileAccessed: false,
    optionalPaidOrCredentialedLayersActivated: false,
    syntheticProviderAdapters: 'Fixture TEMP profiles only; actual packaged HTTPS replies were observed without replacement.',
    trafficBoundary: 'Packaged launches used existing public NWS/USGS adapters and ordinary validated refresh; no provider account or billing action.',
  },
};
await writeFile(join(root, 'docs/location-evidence-audit.log'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ result:audit.result, fixturePhases:fixtures.phases.length, packagedLaunches:packaged.phases.length,
  archiveSha256:packaged.archiveSha256, pdfs:inspection.files.length, pages:audit.documents.pageCountIncludingHistoricalBaseline }));
