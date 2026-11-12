// Read-only package verification. Never executes an installer or downloads tools.
// Usage: node scripts/check-package.mjs [--installer path] [--unpacked path]
//        [--seven-zip path] [--log docs/package-audit-YYYY-MM-DD.log]
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (!['--installer', '--unpacked', '--seven-zip', '--log'].includes(name) || !process.argv[i + 1])
    throw new Error('Expected --installer, --unpacked, --seven-zip or --log followed by a local path.');
  options[name.slice(2)] = resolve(process.argv[i + 1]);
}
const installer = options.installer ?? join(root, 'release', `Atlas-Watch-Setup-${pkg.version}.exe`);
const unpacked = options.unpacked ?? join(root, 'release', 'win-unpacked');
const archive = join(unpacked, 'resources', 'app.asar');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const slash = (path) => path.split(sep).join('/').replaceAll('\\', '/').replace(/^\/+/, '');
const readPacked = (path) => asar.extractFile(archive, path.replaceAll('/', sep));
const report = {
  result: 'FAIL', at: new Date().toISOString(), installer, unpacked,
  boundary: 'Current dist bytes and extra resources versus unpacked ASAR/resources and the installer-embedded app payload. No installer execution, installation or upgrade verification.',
  installedOrUpgraded: false,
};
const problems = [];
let temporary = null;

function filesBelow(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...filesBelow(join(directory, entry.name), name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported link or special file in build output: ${name}`);
  }
  return files.sort();
}
function archiveFiles(nodes, prefix = '') {
  const files = [];
  for (const [name, node] of Object.entries(nodes)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (node.files) files.push(...archiveFiles(node.files, path));
    else if (node.link) throw new Error(`Unexpected ASAR link: ${path}`);
    else files.push(path);
  }
  return files.sort();
}
function buildManifest(paths, read) {
  const manifest = createHash('sha256');
  let bytes = 0;
  for (const path of paths) {
    const buffer = read(path);
    bytes += buffer.length;
    manifest.update(`${path}\0${sha(buffer)}\n`);
  }
  return { files: paths.length, bytes, manifestSha256: manifest.digest('hex').toUpperCase() };
}
function toolRun(tool, args, binary = false) {
  const result = spawnSync(tool, args, { windowsHide: true, maxBuffer: 512 * 1024 * 1024,
    encoding: binary ? null : 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0)
    throw new Error(`Archive tool failed (${result.error?.code ?? result.status ?? 'no status'}).`);
  return result.stdout;
}
function listing(tool, path) {
  const output = toolRun(tool, ['l', '-slt', '-bd', path]);
  const entries = output.split(/\r?\n\r?\n/).map((block) => {
    const values = {};
    for (const line of block.split(/\r?\n/)) {
      const match = /^([^=]+?) = (.*)$/.exec(line);
      if (match) values[match[1]] = match[2];
    }
    return values;
  });
  const metadata = entries.find((entry) => entry.Type);
  const files = entries.filter((entry) => entry.Path && entry.Size !== undefined && !entry.Attributes?.includes('D'));
  return { type: metadata?.Type ?? null, offset: metadata?.Offset ? Number(metadata.Offset) : 0,
    physicalBytes: metadata?.['Physical Size'] ? Number(metadata['Physical Size']) : null,
    tailBytes: metadata?.['Tail Size'] ? Number(metadata['Tail Size']) : 0, files };
}
function installedTools() {
  if (options['seven-zip']) return [options['seven-zip']];
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:/Program Files', '7-Zip', '7z.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', '7-Zip', '7z.exe'),
  ];
  const cache = join(homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
  function scan(directory, depth) {
    if (!existsSync(directory) || depth < 0) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path, depth - 1);
      else if (/^7z(?:a|z)?\.exe$/i.test(entry.name)) candidates.push(path);
    }
  }
  if (existsSync(cache)) for (const entry of readdirSync(cache, { withFileTypes: true }))
    if (entry.isDirectory() && /^7zip/i.test(entry.name)) scan(join(cache, entry.name), 4);
  candidates.push(join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    join(root, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe'));
  return [...new Set(candidates)].filter(existsSync);
}
function signatureStatus(path) {
  if (process.platform !== 'win32') return 'NotChecked';
  const script = `(Get-AuthenticodeSignature -LiteralPath '${path.replaceAll("'", "''")}').Status.ToString()`;
  for (const command of ['pwsh.exe', 'powershell.exe']) {
    const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 20_000 });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return 'NotChecked';
}

try {
  const installerBefore = sha(readFileSync(installer));
  const archiveBefore = sha(readFileSync(archive));
  report.bytes = statSync(installer).size;
  report.sha256 = installerBefore;
  report.signatureStatus = signatureStatus(installer);
  report.signed = report.signatureStatus === 'NotSigned' ? false : report.signatureStatus === 'Valid' ? true : null;
  const allDist = filesBelow(join(root, 'dist'));
  const dist = allDist.filter((path) => !path.endsWith('.map')).map((path) => `dist/${path}`);
  report.excludedSourceMaps = allDist.length - dist.length;
  const sourceManifest = buildManifest(dist, (path) => readFileSync(join(root, path)));
  const header = asar.getRawHeader(archive).header;
  const packed = archiveFiles(header.files);
  const packedDist = packed.filter((path) => path.startsWith('dist/'));
  report.archiveEntries = asar.listPackage(archive).length;
  report.archiveFiles = packed.length;
  report.unpackedAsar = { bytes: statSync(archive).size, sha256: archiveBefore };
  const expected = new Set([...dist, 'package.json']);
  const missing = [...expected].filter((path) => !packed.includes(path));
  const unexpected = packed.filter((path) => !expected.has(path));
  const mismatched = [];
  for (const path of dist) if (!missing.includes(path) && !readFileSync(join(root, path)).equals(readPacked(path))) mismatched.push(path);
  const packedManifest = buildManifest(packedDist, readPacked);
  report.dist = { source: sourceManifest, packed: packedManifest, missing, unexpected, mismatched,
    allBytesMatch: !missing.length && !unexpected.length && !mismatched.length && sourceManifest.manifestSha256 === packedManifest.manifestSha256 };
  if (!report.dist.allBytesMatch) problems.push('Current dist inventory or bytes differ from unpacked ASAR.');
  const packedPackage = JSON.parse(readPacked('package.json').toString('utf8'));
  report.packageMetadata = { versionMatches: packedPackage.version === pkg.version, mainMatches: packedPackage.main === pkg.main };
  if (!report.packageMetadata.versionMatches || !report.packageMetadata.mainMatches) problems.push('Packaged version/main metadata differs.');
  const qaPattern = /(?:^|\/)(?:src|tests|scripts|docs)(?:\/|$)|(?:^|\/)(?:qa[-_]|check[-_])[^/]*\.(?:[cm]?js|tsx?)$/i;
  const qaFiles = packed.filter((path) => qaPattern.test(path) || path.endsWith('.map'));
  report.excludedQaSource = qaFiles.length === 0;
  report.unexpectedQaPaths = qaFiles;
  if (qaFiles.length) problems.push('QA/source/source-map files are included in ASAR.');

  let tool = null, outer = null;
  for (const candidate of installedTools()) {
    try {
      const value = listing(candidate, installer);
      if (value.files.some((entry) => /(?:^|[\\/])app(?:-64)?\.(?:asar|7z)$/.test(entry.Path))) { tool = candidate; outer = value; break; }
    } catch { /* Try only another tool already installed on this machine. */ }
  }
  if (!tool) throw new Error('No installed archive tool could inspect the installer payload.');
  report.archiveTool = tool;
  report.installerArchive = { type: outer.type, offset: outer.offset, physicalBytes: outer.physicalBytes, tailBytes: outer.tailBytes, entries: outer.files.length };
  let payloadPath = installer, payload = outer;
  let embedded = payload.files.find((entry) => slash(entry.Path) === 'resources/app.asar');
  if (!embedded) {
    const container = outer.files.find((entry) => /(?:^|[\\/])app-64\.7z$/.test(entry.Path));
    if (!container) throw new Error('The installer listing did not expose resources/app.asar or app-64.7z.');
    const compressed = toolRun(tool, ['x', '-so', '-bd', installer, container.Path], true);
    const parent = resolve(tmpdir());
    temporary = mkdtempSync(join(parent, 'atlas-watch-package-'));
    payloadPath = join(temporary, 'app-64.7z');
    writeFileSync(payloadPath, compressed);
    payload = listing(tool, payloadPath);
    report.installerArchive.container = { path: slash(container.Path), bytes: compressed.length, sha256: sha(compressed) };
    embedded = payload.files.find((entry) => slash(entry.Path) === 'resources/app.asar');
  }
  if (!embedded) throw new Error('The embedded application archive does not contain resources/app.asar.');
  const installerAsar = toolRun(tool, ['x', '-so', '-bd', payloadPath, embedded.Path], true);
  report.installerAsar = { bytes: installerAsar.length, sha256: sha(installerAsar), matchesUnpacked: installerAsar.equals(readFileSync(archive)) };
  if (!report.installerAsar.matchesUnpacked) problems.push('Installer embedded ASAR differs from unpacked ASAR.');
  const extraPaths = ['THIRD_PARTY_NOTICES.md', 'samples/sample-locations.csv', 'samples/README.md'];
  report.extraResources = extraPaths.map((path) => {
    const original = readFileSync(join(root, path));
    const unpackedBytes = readFileSync(join(unpacked, 'resources', path));
    const entry = payload.files.find((item) => slash(item.Path) === `resources/${path}`);
    const embeddedBytes = entry ? toolRun(tool, ['x', '-so', '-bd', payloadPath, entry.Path], true) : null;
    return { file: path, bytes: original.length, sha256: sha(original), matchesUnpacked: original.equals(unpackedBytes),
      matchesInstaller: embeddedBytes !== null && original.equals(embeddedBytes) };
  });
  if (report.extraResources.some((item) => !item.matchesUnpacked || !item.matchesInstaller)) problems.push('Sample or notices bytes differ in unpacked/installer resources.');
  const payloadQa = payload.files.map((entry) => slash(entry.Path)).filter((path) => qaPattern.test(path));
  report.installerExcludedQaSource = payloadQa.length === 0;
  if (payloadQa.length) problems.push('QA/source files are included outside installer ASAR.');
  const sourceAfter = buildManifest(filesBelow(join(root, 'dist')).filter((path) => !path.endsWith('.map')).map((path) => `dist/${path}`), (path) => readFileSync(join(root, path)));
  report.inputsStableDuringAudit = installerBefore === sha(readFileSync(installer)) && archiveBefore === sha(readFileSync(archive)) && sourceManifest.manifestSha256 === sourceAfter.manifestSha256;
  if (!report.inputsStableDuringAudit) problems.push('Build or package input changed during the audit; rerun when packaging finishes.');
  report.result = problems.length ? 'FAIL' : 'PASS';
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
} finally {
  if (temporary) {
    const target = resolve(temporary), parent = resolve(tmpdir());
    if (dirname(target) !== parent || !basename(target).startsWith('atlas-watch-package-')) throw new Error('Refusing to remove an unexpected audit temporary path.');
    rmSync(target, { recursive: true, force: true });
  }
  asar.uncacheAll();
}
report.problems = problems;
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.log) writeFileSync(options.log, output);
process.stdout.write(output);
process.exitCode = report.result === 'PASS' ? 0 : 1;
