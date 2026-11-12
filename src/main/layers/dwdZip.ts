import { Inflate } from 'fflate';
import { DWD_CAP_LIMITS as LIMIT } from '../../shared/dwd';

/** No filesystem extraction. Validate the central directory before bounded inflation. */
export function dwdZipEntries(bytes: Uint8Array): { name: string; bytes: Uint8Array }[] {
  if (bytes.length > LIMIT.compressedBytes || bytes.length < 22) throw new Error('DWD ZIP size is outside the supported bounds.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true), u32 = (p: number) => view.getUint32(p, true);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== u16(end + 10))
    throw new Error('DWD ZIP has no valid single-disk directory.');
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (count > LIMIT.entries || count === 65535 || start + size !== end) throw new Error('DWD ZIP directory exceeds supported bounds.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const directory: { name: string; local: number; at: number; end: number; compressed: number; expanded: number; method: number; crc: number }[] = [];
  const names = new Set<string>(); let p = start, expandedTotal = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) throw new Error('DWD ZIP central directory is malformed.');
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), compressed = u32(p + 20), expanded = u32(p + 24);
    const n = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32), local = u32(p + 42);
    if (p + 46 + n + extra + comment > end || n > 240 || u16(p + 34) !== 0 || flags & ~0x0808 || (method !== 0 && method !== 8))
      throw new Error('DWD ZIP uses an unsupported entry format.');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + n));
    if (!/^[A-Za-z0-9_.-]+\.(?:xml|cap)$/i.test(name) || names.has(name)) throw new Error('DWD ZIP entry name is unsafe or duplicated.');
    names.add(name); expandedTotal += expanded;
    if (expanded > LIMIT.entryBytes || expandedTotal > LIMIT.expandedBytes || compressed > LIMIT.compressedBytes)
      throw new Error('DWD ZIP expanded data exceeds its resource limits.');
    if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method)
      throw new Error('DWD ZIP local header does not match its directory.');
    const ln = u16(local + 26), le = u16(local + 28), at = local + 30 + ln + le;
    if (at > start || decoder.decode(bytes.subarray(local + 30, local + 30 + ln)) !== name || at + compressed > start)
      throw new Error('DWD ZIP entry data is outside its directory bounds.');
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== expanded))
      throw new Error('DWD ZIP local entry size or checksum does not match.');
    directory.push({ name, local, at, end: at + compressed, compressed, expanded, method, crc });
    p += 46 + n + extra + comment;
  }
  if (p !== end || (count === 0 && start !== 0)) throw new Error('DWD ZIP directory length is invalid.');
  const ranges = directory.map(e => [e.local, e.end]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw new Error('DWD ZIP entries overlap.');
  return directory.map(entry => {
    const compressed = bytes.subarray(entry.at, entry.end); let output: Uint8Array;
    if (entry.method === 0) output = compressed.slice();
    else {
      output = new Uint8Array(entry.expanded); let written = 0, finished = false;
      const inflater = new Inflate((chunk, final) => {
        if (written + chunk.length > output.length) throw new Error('DWD ZIP actual expansion exceeds its declared size.');
        output.set(chunk, written); written += chunk.length; finished = final;
      });
      // Bound each inflater push as well as the declared and actual total expansion.
      for (let at = 0; at < compressed.length; at += 1024) inflater.push(compressed.subarray(at, at + 1024), at + 1024 >= compressed.length);
      if (!finished || written !== entry.expanded) throw new Error('DWD ZIP entry is truncated.');
    }
    if (output.length !== entry.expanded || crc32(output) !== entry.crc) throw new Error('DWD ZIP entry checksum or length is invalid.');
    return { name: entry.name, bytes: output };
  });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff; for (const value of data) crc = CRC_TABLE[(crc ^ value) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0;
}
