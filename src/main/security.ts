// Electron hardening: custom app:// protocol, CSP, renderer network
// allow-list, navigation and permission lockdown.

import { app, protocol, session, shell, type WebContents } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { buildCsp, isAllowedRendererUrl, type RemoteOptions } from '../shared/remoteHosts';
import { isAllowedExternalUrl } from '../shared/sanitize';

export const APP_SCHEME = 'app';
export const APP_HOST = 'atlas';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? '';

let remoteOpts: RemoteOptions = { google3d: false };
/** Enables optional renderer destinations (e.g. Google 3D Tiles) once the user configures them. Takes effect on reload. */
export function setRendererRemoteOptions(opts: RemoteOptions): void {
  remoteOpts = { ...opts };
}
export function currentCsp(): string {
  return buildCsp({ ...remoteOpts, devOrigin: DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null });
}

export interface HostNetStats {
  host: string;
  requests: number;
  ok: number;
  failed: number;
  cancelled: number;
  lastStatus: number | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}
const netStats = new Map<string, HostNetStats>();
function statFor(url: string): HostNetStats | null {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  let s = netStats.get(host);
  if (!s) {
    s = { host, requests: 0, ok: 0, failed: 0, cancelled: 0, lastStatus: null, lastError: null, lastSuccessAt: null, lastFailureAt: null };
    netStats.set(host, s);
  }
  return s;
}
export function getNetStats(): HostNetStats[] {
  return [...netStats.values()];
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Must run before app 'ready'. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

/** Resolves a request path inside the renderer root; returns null on traversal attempts. */
export function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = normalize(join(root, rel));
  const rootNorm = normalize(root.endsWith(sep) ? root : root + sep);
  return full.startsWith(rootNorm) ? full : null;
}

export function serveAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    const file = resolveInside(rendererRoot, url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const st = await stat(file);
      if (!st.isFile()) return new Response('Not found', { status: 404 });
      const body = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
      if (type.startsWith('text/html')) headers['Content-Security-Policy'] = currentCsp();
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Blocks every renderer request except the app's own origin (and the Vite dev server in development). */
export function lockDownSession(log: (m: string) => void): void {
  const ses = session.defaultSession;
  const devOrigin = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null;
  const devWs = devOrigin ? devOrigin.replace(/^http/, 'ws') : null;
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    const allowed =
      u.startsWith(`${APP_ORIGIN}/`) ||
      u.startsWith('data:') ||
      u.startsWith('blob:') ||
      u.startsWith('devtools://') ||
      u === 'about:blank' ||
      u === 'about:srcdoc' ||
      (devOrigin !== null && (u.startsWith(`${devOrigin}/`) || u.startsWith(`${devWs}/`)));
    const remote = !allowed && isAllowedRendererUrl(u, remoteOpts);
    if (remote) statFor(u)!.requests++;
    if (!allowed && !remote) {
      let host = 'unknown';
      try {
        host = new URL(u).host;
      } catch {
        // ignore
      }
      log(`[security] blocked renderer request to ${host}`);
    }
    callback({ cancel: !allowed && !remote });
  });
  const filter = { urls: ['https://*/*'] };
  ses.webRequest.onCompleted(filter, (d) => {
    if (!isAllowedRendererUrl(d.url, remoteOpts)) return;
    const s = statFor(d.url)!;
    s.lastStatus = d.statusCode;
    if (d.statusCode >= 200 && d.statusCode < 400) {
      s.ok++;
      s.lastSuccessAt = new Date().toISOString();
    } else if (d.statusCode !== 404) {
      // 404 = tile outside provider coverage, counted as ok-but-empty below
      s.failed++;
      s.lastError = `HTTP ${d.statusCode}`;
      s.lastFailureAt = new Date().toISOString();
    } else {
      s.ok++;
    }
  });
  ses.webRequest.onErrorOccurred(filter, (d) => {
    if (!isAllowedRendererUrl(d.url, remoteOpts)) return;
    const s = statFor(d.url)!;
    if (d.error === 'net::ERR_ABORTED') s.cancelled++;
    else {
      s.failed++;
      s.lastError = d.error;
      s.lastFailureAt = new Date().toISOString();
    }
  });
  if (devOrigin) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (details.url.startsWith(devOrigin) && details.resourceType === 'mainFrame') headers['Content-Security-Policy'] = [currentCsp()];
      callback({ responseHeaders: headers });
    });
  }
  // Everything is denied except HTML fullscreen (camera player Fullscreen button), and only for the app's own page.
  const ownPage = (url: string | undefined) => !!url && (url.startsWith(`${APP_ORIGIN}/`) || (devOrigin !== null && url.startsWith(`${devOrigin}/`)));
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(permission === 'fullscreen' && ownPage(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === 'fullscreen' && ownPage(`${origin}/`));
}

export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(`${APP_ORIGIN}/`) || (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL));
    if (!allowed) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

export function openExternalSafely(url: string): boolean {
  if (!isAllowedExternalUrl(url)) return false;
  void shell.openExternal(url);
  return true;
}

export function rendererEntryUrl(): string {
  return DEV_SERVER_URL || `${APP_ORIGIN}/index.html`;
}

export function isPackaged(): boolean {
  return app.isPackaged;
}
