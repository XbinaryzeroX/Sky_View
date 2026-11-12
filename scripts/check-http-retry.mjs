// Controlled local integration: real Node HTTP/fetch, no public provider requests or production fixtures.
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const dir = await mkdtemp(join(tmpdir(), 'atlas-http-retry-'));
const output = await build({ entryPoints: ['src/main/feeds/http.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24' });
const bundle = join(dir, 'http.mjs');
await writeFile(bundle, output.outputFiles[0].contents);
const { fetchJson } = await import(pathToFileURL(bundle).href);
const hits = [];
const servers = [];
async function server(name) {
  const service = createServer((request, response) => {
    hits.push(`${name}${request.url}`);
    if (request.url === '/limited') response.writeHead(429, { 'retry-after': '3456000' }).end();
    else if (request.url === '/huge') response.writeHead(503, { 'retry-after': '9'.repeat(400) }).end();
    else if (request.url === '/redirect') response.writeHead(307, { location: '/target', 'retry-after': '7200' }).end();
    else response.writeHead(200, { 'content-type': 'application/json' }).end('{"connected":true}');
  });
  await new Promise((resolve, reject) => { service.once('error', reject); service.listen(0, '127.0.0.1', resolve); });
  servers.push(service);
  return `http://127.0.0.1:${service.address().port}`;
}
const originalNow = Date.now;
let now = originalNow();
try {
  const first = await server('A');
  const second = await server('B');
  const third = await server('C');
  Date.now = () => now;
  await assert.rejects(fetchJson(`${first}/limited`), error => error.status === 429 && error.retryAfterSec === 3456000);
  now += 2 * 86400_000;
  await assert.rejects(fetchJson(`${first}/probe`), /Provider cooldown/);
  assert.deepEqual((await fetchJson(`${second}/probe`)).body, { connected: true });
  assert.equal(hits.filter(hit => hit.startsWith('A')).length, 1);
  now += 38 * 86400_000;
  assert.deepEqual((await fetchJson(`${first}/probe`)).body, { connected: true });
  await assert.rejects(fetchJson(`${second}/huge`), error => Number.isFinite(error.retryAfterSec));
  await assert.rejects(fetchJson(`${second}/probe`), /\+275760-09-13/);
  await assert.rejects(fetchJson(`${third}/redirect`), error => error.status === 307 && error.retryAfterSec === 7200);
  await assert.rejects(fetchJson(`${third}/target`), /Provider cooldown/);
  assert.equal(hits.includes('C/target'), false);
  console.log(JSON.stringify({ result: 'PASS', transport: 'real loopback HTTP + native fetch', publicRequests: 0,
    checks: ['forty-day pause retained', 'same-origin alternate path blocked', 'independent origin usable', 'deadline resumes', 'huge delay serializable', 'redirect target not requested early'], hits }, null, 2));
} finally {
  Date.now = originalNow;
  await Promise.all(servers.map(service => new Promise(resolve => { service.close(resolve); service.closeAllConnections(); })));
}
