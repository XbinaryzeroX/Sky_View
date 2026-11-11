// Input checks for the model download and import scripts (unit-tested).
// Everything downloaded is untrusted data: archive entry names, glTF resource URIs and sizes.
import fs from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';

/**
 * Hosts Sketchfab's signed download links point to: its own domain and its own S3 bucket
 * (virtual-hosted style, any region). Other AWS customers' buckets are not accepted.
 */
export function allowedDownloadHost(host) {
  const h = String(host).toLowerCase();
  return h === 'sketchfab.com' || h.endsWith('.sketchfab.com') || /^sketchfab-prod-media\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(h);
}

/** https, default port, no credentials, allowed host. */
export function allowedDownloadUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && allowedDownloadHost(u.hostname);
  } catch {
    return false;
  }
}

/** Host of a URL for error messages (never the path or the signed query). */
export const hostOf = (raw) => {
  try {
    return new URL(raw).hostname;
  } catch {
    return '?';
  }
};

/**
 * Downloads a signed Sketchfab link: no credentials sent, every redirect hop checked against the allowed hosts,
 * and the body counted as it streams (Content-Length is not trusted).
 */
export async function downloadCapped(url, { maxBytes, userAgent = 'AtlasWatch', fetchImpl = fetch, maxHops = 4 }) {
  // No Authorization header here: the link is already signed, and the token must not leave api.sketchfab.com.
  // Redirects are followed by hand so every hop is checked against the allowed storage hosts.
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    if (!allowedDownloadUrl(current)) throw new Error(`download link points to an unexpected host (${hostOf(current)})`);
    const res = await fetchImpl(current, { headers: { 'User-Agent': userAgent }, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) throw new Error(`download failed: HTTP ${res.status} without a location`);
      current = new URL(next, current).href;
      continue;
    }
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error(`download too large (${Math.round(len / 1e6)} MB)`);
    // Count the bytes as they arrive: Content-Length may be missing or wrong.
    const chunks = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`download too large (over ${Math.round(maxBytes / 1e6)} MB)`);
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error('download failed: too many redirects');
}

/** Zip entry names are untrusted: returns the output path inside `dir`, or null for anything that escapes it. */
export function safeEntryPath(dir, name) {
  const norm = String(name).replace(/\\/g, '/');
  if (!norm || norm.startsWith('/') || /^[a-z]:/i.test(norm) || norm.split('/').some((p) => p === '..')) return null;
  const root = path.resolve(dir);
  const out = path.resolve(root, norm);
  return out.startsWith(root + path.sep) ? out : null;
}

export const ZIP_LIMITS = { maxEntries: 2000, maxEntryBytes: 200 * 1024 * 1024, maxTotalBytes: 500 * 1024 * 1024 };

/**
 * Compressed bytes fed to the decoder per step. Deflate expands at most ~1032:1, so one step inflates
 * at most ~17 MB before the limits below are checked again.
 */
const ZIP_CHUNK = 16 * 1024;

/**
 * Extracts a zip archive into `dir`. Entries whose declared size is over the limit are refused up front;
 * the bytes actually inflated are counted as well (headers can lie), with the archive fed to the decoder in
 * small chunks so a highly compressed entry can't allocate much before it is stopped. Limits: entry count,
 * bytes per entry, total bytes. `stats.inflated` (optional) receives the number of bytes inflated.
 * Returns the number of files written; nothing is written if any limit is hit.
 */
export function extractZip(bytes, dir, limits = ZIP_LIMITS, stats = {}) {
  let total = 0;
  let count = 0;
  let error = null;
  const files = [];
  stats.inflated = 0;
  const unzip = new Unzip((file) => {
    if (error || file.name.endsWith('/')) return;
    if (++count > limits.maxEntries) {
      error = new Error(`archive has more than ${limits.maxEntries} files`);
      return;
    }
    const out = safeEntryPath(dir, file.name);
    if (!out) {
      error = new Error(`unsafe path in archive: ${String(file.name).slice(0, 60)}`);
      return;
    }
    if (typeof file.originalSize === 'number' && (file.originalSize > limits.maxEntryBytes || total + file.originalSize > limits.maxTotalBytes)) {
      error = new Error('archive expands beyond the size limit');
      return;
    }
    const chunks = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (error) return;
      if (err) {
        error = err;
        return;
      }
      size += data.length;
      total += data.length;
      stats.inflated = total;
      if (size > limits.maxEntryBytes || total > limits.maxTotalBytes) {
        error = new Error('archive expands beyond the size limit');
        file.terminate();
        return;
      }
      chunks.push(data);
      if (final) files.push({ out, chunks });
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small chunks, stopping as soon as a limit is hit (the decoder is synchronous).
  for (let i = 0; i < bytes.length && !error; i += ZIP_CHUNK) unzip.push(bytes.subarray(i, i + ZIP_CHUNK), i + ZIP_CHUNK >= bytes.length);
  if (!bytes.length) unzip.push(new Uint8Array(0), true);
  if (error) throw error;
  for (const f of files) {
    fs.mkdirSync(path.dirname(f.out), { recursive: true });
    fs.writeFileSync(f.out, Buffer.concat(f.chunks));
  }
  return files.length;
}

/**
 * Resolves a glTF resource URI (buffer or image) to a file inside `dir`, or throws. Rejects URLs with a
 * scheme, absolute paths, drive letters, `..` segments (also when percent-encoded), and anything whose real
 * path (after symlinks) is outside `dir`.
 */
export function resourcePath(dir, uri) {
  if (typeof uri !== 'string' || !uri) throw new Error('empty resource URI');
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) throw new Error(`resource URI with a scheme is not allowed: ${uri.slice(0, 40)}`);
  let decoded;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error('malformed resource URI');
  }
  const norm = decoded.replace(/\\/g, '/');
  if (norm.includes('\0') || norm.startsWith('/') || /^[a-z]:/i.test(norm) || norm.split('/').some((p) => p === '..'))
    throw new Error(`resource outside the model folder: ${uri.slice(0, 60)}`);
  const root = fs.realpathSync(path.resolve(dir));
  const real = fs.realpathSync(path.resolve(root, norm));
  if (!real.startsWith(root + path.sep)) throw new Error(`resource outside the model folder: ${uri.slice(0, 60)}`);
  if (!fs.statSync(real).isFile()) throw new Error(`resource is not a file: ${uri.slice(0, 60)}`);
  return real;
}

/**
 * Reads a downloaded .gltf or .glb with every external resource confined to `dir` (gltf-transform's own
 * reader would follow any relative or absolute path). Returns a Document.
 */
export async function readConfined(io, file, dir, maxBytes = ZIP_LIMITS.maxTotalBytes) {
  const real = resourcePath(dir, path.relative(dir, file).split(path.sep).join('/'));
  const bytes = fs.readFileSync(real);
  const isGlb = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x46546c67;
  // binaryToJSON refuses GLBs that reference external files (Sketchfab's are self-contained).
  if (isGlb) return io.readJSON(await io.binaryToJSON(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  const json = JSON.parse(bytes.toString('utf8'));
  const resources = {};
  let total = bytes.length;
  for (const r of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!r || typeof r.uri !== 'string' || r.uri.startsWith('data:') || r.uri in resources) continue;
    const p = resourcePath(path.dirname(real), r.uri);
    // The folder the .gltf sits in must itself be inside the model folder (checked above via `real`).
    total += fs.statSync(p).size;
    if (total > maxBytes) throw new Error('model files exceed the size limit');
    const data = fs.readFileSync(p);
    resources[r.uri] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return io.readJSON({ json, resources });
}

/** Credit name: display name, or the account name when the display name contains an e-mail address. */
export function cleanAuthor(user) {
  const name = String(user?.displayName || user?.username || 'unknown').trim();
  return /@/.test(name) && user?.username ? String(user.username).slice(0, 80) : name.slice(0, 80);
}

/** Canonical Sketchfab page for a model: the API's viewerUrl when it is a sketchfab.com page for this uid. */
export function sourceUrlFor(uid, viewerUrl) {
  if (typeof viewerUrl === 'string' && viewerUrl.length < 300) {
    try {
      const u = new URL(viewerUrl);
      if (u.protocol === 'https:' && u.hostname === 'sketchfab.com' && /^\/3d-models\/[a-z0-9_-]{0,160}[0-9a-f]{32}$/i.test(u.pathname) && u.pathname.endsWith(uid)) return `https://sketchfab.com${u.pathname}`;
    } catch {
      // fall through
    }
  }
  return `https://sketchfab.com/3d-models/${uid}`;
}

/**
 * The owner's Sketchfab API token as saved (file or environment), or null when it isn't a single token:
 * letters, digits, '-' or '_' only (Sketchfab's are 32 hex characters). Anything else (several lines,
 * spaces, a pasted label) is refused before it is put in a request header, so it can't end up in an error.
 */
export function validToken(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(t) ? t : null;
}

/** Removes a secret (and its URL-encoded form) from text that is about to be printed. */
export function redactSecret(text, secret) {
  let out = String(text);
  if (secret) for (const s of [secret, encodeURIComponent(secret)]) out = out.split(s).join('[token]');
  return out;
}
