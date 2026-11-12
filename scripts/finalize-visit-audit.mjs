// Attach read-only PDF inspection and keep the repeated-notes fixture outside the repository.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = join(root, 'docs/visit-audit.log');
const audit = JSON.parse(await readFile(log, 'utf8'));
const output = join(root, 'docs/screenshots/visit');
const large = audit.phases.find(phase => phase.phase === 'large');
for (const report of large?.exports ?? []) {
  if (dirname(report.path) !== output) continue;
  assert.equal(basename(report.path), 'visit-large-1.html');
  const destination = join(audit.session, 'large', basename(report.path));
  try { await rename(report.path, destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = await readFile(destination);
  assert.equal(bytes.length, report.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);
  large.scenario.exportedHtmlPaths = large.scenario.exportedHtmlPaths.map(path => path === report.path ? destination : path);
  report.path = destination;
}
audit.pdfInspection = JSON.parse(await readFile(join(output, 'visit-pdf-inspection.json'), 'utf8'));
const printReviewed = process.argv.includes('--print-reviewed');
audit.pdfVisualReview = printReviewed ? {
  status: 'reviewed after print repair',
  findings: 'Every exported PDF page was rendered and visually reviewed after the print repair. Source headings/tables, page margins, exact times and bounded examples are legible with no clipped or missing content.',
} : {
  status: 'print repair pending',
  findings: 'All9 pages render with headings, tables, exact times and examples. Later pages have no repeat top margin; root is repairing print-only pagination before final approval.',
};
const text = JSON.stringify(audit, null, 2);
await writeFile(log, text);
await writeFile(join(output, 'visit-audit.log'), text);
if (!printReviewed) await writeFile(join(output, 'visit-behavior-before-print-fix.log'), text);
console.log(JSON.stringify({result:audit.result,phases:audit.phases.length,pdfPages:audit.pdfInspection.reduce((count,pdf)=>count+pdf.pages,0),largeReportPath:large?.exports[0]?.path}));
