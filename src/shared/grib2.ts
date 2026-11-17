// Minimal GRIB2 reader for one message: a regular latitude/longitude grid (template 3.0) packed with complex packing
// and spatial differencing (template 5.3), as NOAA GFS publishes 10 m wind. Anything else is refused, not guessed.
// Spec: WMO Manual on Codes, FM 92 GRIB edition 2 (sections 3, 5, 7; templates 3.0 and 5.3).

export interface Grib2Field {
  /** Points along a parallel (columns) and along a meridian (rows). */
  ni: number;
  nj: number;
  /** First grid point and increments, degrees. Rows run from la1 in steps of `dj` (negative when north to south). */
  la1: number;
  lo1: number;
  di: number;
  dj: number;
  /** Row-major values, row 0 at la1. */
  values: Float32Array;
  /** Reference time of the run (UTC ISO) and forecast offset in hours (section 4 template 4.0). */
  refTime: string;
  forecastHours: number | null;
  /** Discipline, parameter category and number (0, 2, 2 = u wind; 0, 2, 3 = v wind). */
  discipline: number;
  category: number | null;
  parameter: number | null;
}

/** Grids larger than this are refused (GFS 0.25° is about 1.04 million points). */
export const GRIB2_MAX_POINTS = 1_100_000;

/** Sign-magnitude integer of `n` bytes (GRIB2 stores negative numbers with the top bit as sign). */
function sm(b: Uint8Array, at: number, n: number): number {
  let v = b[at] & 0x7f;
  for (let i = 1; i < n; i++) v = v * 256 + b[at + i];
  return b[at] & 0x80 ? -v : v;
}
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

class BitReader {
  private pos = 0; // bit position
  constructor(private readonly b: Uint8Array, private readonly start: number, private readonly end: number) {}
  read(bits: number): number {
    if (bits === 0) return 0;
    if (bits > 32) throw new Error('GRIB2 field wider than 32 bits');
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.start + (this.pos >> 3);
      if (byte >= this.end) throw new Error('GRIB2 data section is shorter than its description');
      v = v * 2 + ((this.b[byte] >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  align(): void { this.pos = (this.pos + 7) & ~7; }
}

export function decodeGrib2(bytes: Uint8Array): Grib2Field {
  if (bytes.length < 16 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'GRIB') throw new Error('Not a GRIB message');
  if (bytes[7] !== 2) throw new Error('Only GRIB edition 2 is supported');
  const discipline = bytes[6];
  let p = 16;
  let grid: { ni: number; nj: number; la1: number; lo1: number; di: number; dj: number; scan: number } | null = null;
  let refTime = '';
  let forecastHours: number | null = null;
  let category: number | null = null;
  let parameter: number | null = null;
  let s5: { n: number; at: number; tmpl: number } | null = null;
  let bitmap = 255;
  let s7: { at: number; len: number } | null = null;
  while (p + 5 <= bytes.length) {
    if (bytes[p] === 0x37 && bytes[p + 1] === 0x37 && bytes[p + 2] === 0x37 && bytes[p + 3] === 0x37) break; // "7777"
    const len = u32(bytes, p);
    const sec = bytes[p + 4];
    if (len < 5 || p + len > bytes.length) throw new Error('GRIB2 section runs past the message');
    if (sec === 1) {
      const y = u16(bytes, p + 12);
      refTime = new Date(Date.UTC(y, bytes[p + 14] - 1, bytes[p + 15], bytes[p + 16], bytes[p + 17], bytes[p + 18])).toISOString();
    } else if (sec === 3) {
      if (u16(bytes, p + 12) !== 0) throw new Error('Only regular latitude/longitude grids are supported');
      const t = p + 14; // template 3.0 starts at octet 15
      // Octets (1-based, section-relative): Ni 31–34, Nj 35–38, La1 47–50, Lo1 51–54, Di 64–67, Dj 68–71, scan 72.
      const ni = u32(bytes, p + 30);
      const nj = u32(bytes, p + 34);
      const la1 = sm(bytes, p + 46, 4) / 1e6;
      const lo1 = sm(bytes, p + 50, 4) / 1e6;
      const di = u32(bytes, p + 63) / 1e6;
      const dj = u32(bytes, p + 67) / 1e6;
      const scan = bytes[p + 71];
      void t;
      if (!ni || !nj || ni * nj > GRIB2_MAX_POINTS) throw new Error('GRIB2 grid size is out of range');
      if (scan & 0x20 || scan & 0x80) throw new Error('Unsupported GRIB2 scanning mode');
      // Bit 0x40 set: rows run south to north.
      grid = { ni, nj, la1, lo1, di, dj: scan & 0x40 ? dj : -dj, scan };
    } else if (sec === 4) {
      category = bytes[p + 9];
      parameter = bytes[p + 10];
      if (u16(bytes, p + 7) === 0) {
        const unit = bytes[p + 17];
        const value = u32(bytes, p + 18);
        forecastHours = unit === 1 ? value : unit === 0 ? value / 60 : unit === 2 ? value * 24 : null;
      }
    } else if (sec === 5) {
      s5 = { n: u32(bytes, p + 5), at: p, tmpl: u16(bytes, p + 9) };
    } else if (sec === 6) {
      bitmap = bytes[p + 5];
    } else if (sec === 7) {
      s7 = { at: p + 5, len: len - 5 };
    }
    p += len;
  }
  if (!grid || !s5 || !s7) throw new Error('GRIB2 message is missing its grid, packing or data section');
  if (s5.tmpl !== 3) throw new Error(`GRIB2 packing template 5.${s5.tmpl} is not supported`);
  if (bitmap !== 255) throw new Error('GRIB2 bitmaps are not supported');
  const n = grid.ni * grid.nj;
  if (s5.n !== n) throw new Error('GRIB2 value count does not match the grid');
  const values = unpackComplex(bytes, s5.at, s7.at, s7.at + s7.len, n);
  return { ni: grid.ni, nj: grid.nj, la1: grid.la1, lo1: grid.lo1, di: grid.di, dj: grid.dj, values, refTime, forecastHours, discipline, category, parameter };
}

/** Template 5.3: groups of bit-packed integers, then first- or second-order spatial differencing. */
function unpackComplex(b: Uint8Array, s: number, dataStart: number, dataEnd: number, n: number): Float32Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const R = view.getFloat32(s + 11);
  const E = sm(b, s + 15, 2);
  const D = sm(b, s + 17, 2);
  const nbits = b[s + 19];
  const missingMgmt = b[s + 22];
  const NG = u32(b, s + 31);
  const widthRef = b[s + 35];
  const widthBits = b[s + 36];
  const lenRef = u32(b, s + 37);
  const lenInc = b[s + 41];
  const lastLen = u32(b, s + 42);
  const lenBits = b[s + 46];
  const order = b[s + 47];
  const extraOctets = b[s + 48];
  if (missingMgmt !== 0) throw new Error('GRIB2 missing-value management is not supported');
  if (order !== 1 && order !== 2) throw new Error('GRIB2 spatial differencing order must be 1 or 2');
  if (!extraOctets || extraOctets > 6) throw new Error('GRIB2 extra descriptor size is out of range');
  if (NG < 1 || NG > n) throw new Error('GRIB2 group count is out of range');
  let q = dataStart;
  const first = sm(b, q, extraOctets); q += extraOctets;
  const second = order === 2 ? sm(b, q, extraOctets) : 0; if (order === 2) q += extraOctets;
  const minimum = sm(b, q, extraOctets); q += extraOctets;
  const refs = new Float64Array(NG);
  const widths = new Uint8Array(NG);
  const lens = new Uint32Array(NG);
  let r = new BitReader(b, q, dataEnd);
  for (let g = 0; g < NG; g++) refs[g] = r.read(nbits);
  r.align();
  // Each section of group descriptors starts on a byte boundary.
  const after = (bits: number, count: number) => Math.ceil((bits * count) / 8);
  q += after(nbits, NG);
  r = new BitReader(b, q, dataEnd);
  for (let g = 0; g < NG; g++) widths[g] = r.read(widthBits) + widthRef;
  q += after(widthBits, NG);
  r = new BitReader(b, q, dataEnd);
  let total = 0;
  for (let g = 0; g < NG; g++) {
    lens[g] = g === NG - 1 ? lastLen : lenRef + r.read(lenBits) * lenInc;
    total += lens[g];
  }
  if (total !== n) throw new Error('GRIB2 group lengths do not add up to the grid');
  q += after(lenBits, NG);
  r = new BitReader(b, q, dataEnd);
  const ints = new Float64Array(n);
  let k = 0;
  for (let g = 0; g < NG; g++) {
    const w = widths[g];
    if (w > 32) throw new Error('GRIB2 group width is out of range');
    for (let i = 0; i < lens[g]; i++) ints[k++] = refs[g] + (w ? r.read(w) : 0);
  }
  // Undo spatial differencing: the first `order` values are given directly.
  ints[0] = first;
  if (order === 1) {
    for (let i = 1; i < n; i++) ints[i] = ints[i] + minimum + ints[i - 1];
  } else {
    if (n > 1) ints[1] = second;
    for (let i = 2; i < n; i++) ints[i] = ints[i] + minimum + 2 * ints[i - 1] - ints[i - 2];
  }
  const out = new Float32Array(n);
  const bs = 2 ** E;
  const ds = 10 ** D;
  for (let i = 0; i < n; i++) out[i] = (R + ints[i] * bs) / ds;
  return out;
}
