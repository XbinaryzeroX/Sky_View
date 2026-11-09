// Development runner: builds main/preload (watch), starts Vite, then Electron.
// Refuses to start if a previous dev server still holds the port, so a new
// window never attaches to a stale server from an earlier session.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
const PORT = 5173;
const DEV_URL = `http://127.0.0.1:${PORT}`;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => srv.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

if (!(await portFree(PORT))) {
  console.error(`\nPort ${PORT} is already in use, probably by an earlier "npm run dev" that is still running.`);
  console.error('Close the old Atlas Watch window and press Ctrl+C in the terminal that started it, then try again.');
  console.error(`To find the process:  Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object OwningProcess\n`);
  process.exit(1);
}

const children = [];
function run(cmd, args, env = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(p);
  return p;
}
function shutdown(code) {
  for (const c of children) c.kill();
  process.exit(code);
}

const buildOnce = run(process.execPath, ['scripts/build-main.mjs']);
buildOnce.on('exit', async (code) => {
  if (code !== 0) shutdown(code ?? 1);
  run(process.execPath, ['scripts/build-main.mjs', '--watch']);
  const vite = run(process.execPath, ['node_modules/vite/bin/vite.js']);
  vite.on('exit', (c) => {
    console.error(`Vite dev server exited (code ${c}).`);
    shutdown(c || 1);
  });
  const waitOn = require('wait-on');
  try {
    await waitOn({ resources: [`${DEV_URL}/index.html`], timeout: 60000 });
  } catch {
    console.error('Vite dev server did not start within 60 seconds.');
    shutdown(1);
  }
  const electronPath = require('electron');
  const el = run(electronPath, ['.'], { VITE_DEV_SERVER_URL: DEV_URL });
  el.on('exit', () => shutdown(0));
});

process.on('SIGINT', () => shutdown(0));
