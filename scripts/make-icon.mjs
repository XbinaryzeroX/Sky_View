// Generates the original Atlas Watch app icon (build/icon.png, 512x512) with
// no external tools: a stylized globe ring with an amber marker.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 512;
const px = new Float32Array(S * S * 4);

function blend(i, r, g, b, a) {
  const o = i * 4;
  const ia = 1 - a;
  px[o] = r * a + px[o] * ia;
  px[o + 1] = g * a + px[o + 1] * ia;
  px[o + 2] = b * a + px[o + 2] * ia;
  px[o + 3] = a + px[o + 3] * ia;
}

// Shape coverage with 4x4 supersampling.
function draw(test, color) {
  const [r, g, b, alpha = 1] = color;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (test(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++;
      if (hit) blend(y * S + x, r, g, b, (hit / 16) * alpha);
    }
  }
}

const c = S / 2;
const R = 200;
const dist = (x, y, cx = c, cy = c) => Math.hypot(x - cx, y - cy);

// Rounded-square background
draw((x, y) => {
  const m = 24, rad = 96;
  const qx = Math.max(m + rad - x, 0, x - (S - m - rad));
  const qy = Math.max(m + rad - y, 0, y - (S - m - rad));
  return Math.hypot(qx, qy) <= rad && x >= m && x <= S - m && y >= m && y <= S - m;
}, [13 / 255, 22 / 255, 32 / 255]);
// Globe fill
draw((x, y) => dist(x, y) <= R, [22 / 255, 40 / 255, 54 / 255]);
const cyan = [95 / 255, 195 / 255, 214 / 255];
// Outer ring
draw((x, y) => Math.abs(dist(x, y) - R) <= 9, cyan);
// Meridian ellipse
draw((x, y) => {
  const e = Math.hypot((x - c) / 88, (y - c) / R);
  return Math.abs(e - 1) * 88 <= 6 && dist(x, y) <= R;
}, [...cyan, 0.85]);
// Central meridian and latitude lines
draw((x, y) => Math.abs(x - c) <= 4 && dist(x, y) <= R, [...cyan, 0.6]);
for (const ly of [-95, 0, 95]) {
  draw((x, y) => Math.abs(y - (c + ly)) <= 5 && dist(x, y) <= R - 2, [...cyan, 0.75]);
}
// Amber location marker with dark outline
draw((x, y) => dist(x, y, c + 92, c - 78) <= 48, [13 / 255, 22 / 255, 32 / 255]);
draw((x, y) => dist(x, y, c + 92, c - 78) <= 36, [232 / 255, 163 / 255, 58 / 255]);

// Encode PNG
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4;
    const a = px[o + 3];
    const d = y * (S * 4 + 1) + 1 + x * 4;
    raw[d] = Math.round((a ? px[o] / a : 0) * 255);
    raw[d + 1] = Math.round((a ? px[o + 1] / a : 0) * 255);
    raw[d + 2] = Math.round((a ? px[o + 2] / a : 0) * 255);
    raw[d + 3] = Math.round(a * 255);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let k = n;
  for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
  return k >>> 0;
});
const crc = (buf) => {
  let v = 0xffffffff;
  for (const b of buf) v = crcTable[(v ^ b) & 0xff] ^ (v >>> 8);
  return (v ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c32 = Buffer.alloc(4);
  c32.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c32]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log(`wrote build/icon.png (${png.length} bytes)`);
