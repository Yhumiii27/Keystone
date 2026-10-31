// Draws Keystone.ico for the Windows application (R-210): the mark of the Mac icon (desktop/make-icon.swift) — the Phosphor
// "polygon" glyph (four nodes joined by edges) in the Nocturne accent, glowing on the dark rounded tile — at the Windows
// icon sizes (16 to 256 px, PNG frames). Plain Node (no dependency): shapes are drawn from distance fields, 4×4 samples
// per pixel. The .ico is committed; run again only to change the drawing: node desktop/windows/make-icon.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const OUT = fileURLToPath(new URL('./Keystone/Keystone.ico', import.meta.url));

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const GROUND = rgb(0x161826);
const GROUND_LIGHT = rgb(0x2b2741);
const ACCENT = rgb(0x9184d9);
const ACCENT_LIGHT = rgb(0xb5abfc);
const EDGE = rgb(0xe9e9ed);

// Drawing on a 1024 grid (y down). Windows icons fill their square more than macOS ones: tile 40 → 984.
const TILE = { x0: 40, y0: 40, x1: 984, y1: 984, r: 190 };
// Phosphor "polygon" on its 256 grid: nodes, radius 16, stroke 16; scaled and centred like the Mac icon (×2.9 here).
const NODES = [[120, 48], [40, 120], [160, 208], [208, 72]];
const UNIT = 2.9;
const minX = Math.min(...NODES.map((n) => n[0])) - 16, maxX = Math.max(...NODES.map((n) => n[0])) + 16;
const minY = Math.min(...NODES.map((n) => n[1])) - 16, maxY = Math.max(...NODES.map((n) => n[1])) + 16;
const P = NODES.map(([x, y]) => [512 + (x - (minX + maxX) / 2) * UNIT, 512 + (y - (minY + maxY) / 2) * UNIT]);
const R = 16 * UNIT;
const HALF = 8 * UNIT;
const SEGMENTS = P.map((a, i) => {
  const b = P[(i + 1) % P.length];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  return [a[0] + ux * R, a[1] + uy * R, b[0] - ux * R, b[1] - uy * R];
});

function segmentDistance(px, py, [ax, ay, bx, by]) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

/** Distance to the centre line of the glyph's strokes (rings and edges). */
function glyphDistance(x, y) {
  let d = Infinity;
  for (const [cx, cy] of P) d = Math.min(d, Math.abs(Math.hypot(x - cx, y - cy) - R));
  for (const s of SEGMENTS) d = Math.min(d, segmentDistance(x, y, s));
  return d;
}

/** Signed distance to the rounded tile (negative inside). */
function tileDistance(x, y) {
  const { x0, y0, x1, y1, r } = TILE;
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Colour (premultiplied-free RGB) and alpha of one sample of the 1024 grid. */
function sample(x, y, px) {
  const inside = Math.min(1, Math.max(0, 0.5 - tileDistance(x, y) / px));
  if (inside === 0) return [[0, 0, 0], 0];
  // Ground: radial gradient from the upper right, as on the Mac icon.
  const t = Math.min(1, Math.hypot(x - 700, y - 124) / 820);
  let color = mix(GROUND_LIGHT, GROUND, t);
  // Hairline border.
  const border = Math.max(0, 1 - Math.abs(tileDistance(x, y) + 2) / Math.max(px, 3)) * 0.1;
  color = mix(color, EDGE, border);
  const d = glyphDistance(x, y) - HALF;
  // Glow (gaussian falloff outside the stroke), then the stroke itself.
  const glow = d > 0 ? 0.8 * Math.exp(-(d * d) / (2 * 34 * 34)) : 0.8;
  color = mix(color, ACCENT, glow * 0.75);
  const stroke = Math.min(1, Math.max(0, 0.5 - d / px));
  color = mix(color, ACCENT_LIGHT, stroke);
  return [color, inside];
}

function render(size) {
  const px = 1024 / size; // one output pixel, in grid units
  const N = 4;
  const data = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < N; sj++) {
        for (let si = 0; si < N; si++) {
          const [c, alpha] = sample((i + (si + 0.5) / N) * px, (j + (sj + 0.5) / N) * px, px);
          r += c[0] * alpha; g += c[1] * alpha; b += c[2] * alpha; a += alpha;
        }
      }
      const o = (j * size + i) * 4;
      data[o] = a ? Math.round(r / a) : 0;
      data[o + 1] = a ? Math.round(g / a) : 0;
      data[o + 2] = a ? Math.round(b / a) : 0;
      data[o + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return png(size, data);
}

// PNG and ICO containers ---------------------------------------------------------------------------------------------------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const frames = SIZES.map(render);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(frames.length, 4);
let offset = 6 + 16 * frames.length;
const entries = frames.map((f, i) => {
  const e = Buffer.alloc(16);
  e[0] = SIZES[i] >= 256 ? 0 : SIZES[i];
  e[1] = SIZES[i] >= 256 ? 0 : SIZES[i];
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(f.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += f.length;
  return e;
});
writeFileSync(OUT, Buffer.concat([header, ...entries, ...frames]));
console.log(`${OUT} (${SIZES.join(', ')} px)`);
