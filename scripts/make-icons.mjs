#!/usr/bin/env node
/**
 * Generates the PWA icons (and nothing else) with no external dependencies:
 * a minimal PNG encoder + a supersampled rasteriser of a simple music-glyph
 * design. Outputs are committed under public/icons/. Run: npm run icons
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'icons');

// --- design -------------------------------------------------------------

const BG = [0x12, 0x12, 0x16];
const INK = [0xef, 0xe9, 0xdd];
const GOLD = [0xd8, 0xa4, 0x5e];

// Geometry in a 512-unit space.
const SHAPES = {
  heads: [
    { kind: 'circle', cx: 186, cy: 356, r: 44 },
    { kind: 'circle', cx: 342, cy: 330, r: 44 },
  ],
  stems: [
    { kind: 'rect', x0: 218, y0: 150, x1: 234, y1: 404 },
    { kind: 'rect', x0: 340, y0: 150, x1: 356, y1: 380 },
  ],
  beam: { kind: 'rect', x0: 200, y0: 122, x1: 396, y1: 168 },
  accentDot: { kind: 'circle', cx: 426, cy: 330, r: 12 },
};

function inside(unitX, unitY, shape) {
  if (shape.kind === 'circle') {
    const dx = unitX - shape.cx;
    const dy = unitY - shape.cy;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  return unitX >= shape.x0 && unitX <= shape.x1 && unitY >= shape.y0 && unitY <= shape.y1;
}

function colorAt(unitX, unitY) {
  for (const s of SHAPES.stems) if (inside(unitX, unitY, s)) return INK;
  if (inside(unitX, unitY, SHAPES.beam)) return GOLD;
  for (const s of SHAPES.heads) if (inside(unitX, unitY, s)) return INK;
  if (inside(unitX, unitY, SHAPES.accentDot)) return GOLD;
  return null;
}

function roundedCorner(unitX, unitY, size, radius) {
  const r = radius;
  const min = r;
  const max = size - r;
  if (unitX < min && unitY < min) return (unitX - min) ** 2 + (unitY - min) ** 2 <= r * r;
  if (unitX > max && unitY < min) return (unitX - max) ** 2 + (unitY - min) ** 2 <= r * r;
  if (unitX < min && unitY > max) return (unitX - min) ** 2 + (unitY - max) ** 2 <= r * r;
  if (unitX > max && unitY > max) return (unitX - max) ** 2 + (unitY - max) ** 2 <= r * r;
  return true;
}

/**
 * Renders one icon. `pad` is the fraction of the canvas kept clear around the
 * glyph (maskable icons need more breathing room).
 */
function render(size, { rounded = true, pad = 0 } = {}) {
  const px = new Uint8Array(size * size * 4);
  const radius = rounded ? Math.round(size * 0.21) : 0;
  // Inside the (rounded) canvas every pixel starts as the background colour;
  // outside it stays transparent.
  const insideCanvas = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let pxI = 0; pxI < size; pxI++) {
      const cx = pxI + 0.5;
      const cy = py + 0.5;
      if (rounded && !roundedCorner(cx, cy, size, radius)) continue;
      const idx = (py * size + pxI) * 4;
      px[idx] = BG[0];
      px[idx + 1] = BG[1];
      px[idx + 2] = BG[2];
      px[idx + 3] = 255;
      insideCanvas[py * size + pxI] = 1;
    }
  }
  const sub = 3; // 3x3 supersampling for glyph edges
  // The glyph lives in 512-unit space; `pad` shrinks it symmetrically.
  const glyphScale = 1 - 2 * pad;
  for (let py = 0; py < size; py++) {
    for (let pxI = 0; pxI < size; pxI++) {
      if (!insideCanvas[py * size + pxI]) continue;
      let gold = 0;
      let ink = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const tx = (pxI + (sx + 0.5) / sub) / size;
          const ty = (py + (sy + 0.5) / sub) / size;
          const ux = (tx - 0.5) * 512 * glyphScale + 256;
          const uy = (ty - 0.5) * 512 * glyphScale + 256;
          const c = colorAt(ux, uy);
          if (c === GOLD) gold++;
          else if (c === INK) ink++;
        }
      }
      if (gold + ink === 0) continue;
      const total = sub * sub;
      const useGold = gold > ink;
      const base = useGold ? GOLD : INK;
      const coverage = (useGold ? gold : ink) / total;
      const idx = (py * size + pxI) * 4;
      // Blend the glyph colour over the opaque background by coverage.
      px[idx] = Math.round(base[0] * coverage + BG[0] * (1 - coverage));
      px[idx + 1] = Math.round(base[1] * coverage + BG[1] * (1 - coverage));
      px[idx + 2] = Math.round(base[2] * coverage + BG[2] * (1 - coverage));
      px[idx + 3] = 255;
    }
  }
  return encodePng(size, size, px);
}

// --- minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.subarray(y * stride, (y + 1) * stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  // Self-check: re-parse chunk CRCs and inflate back to the expected size.
  const check = parsePng(png);
  if (check.width !== width || check.height !== height || check.pixelBytes !== rgba.length) {
    throw new Error(`PNG self-check failed for ${width}x${height}`);
  }
  return png;
}

function parsePng(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('bad signature');
  let off = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    const expectedCrc = png.readUInt32BE(off + 8 + len);
    const actualCrc = crc32(png.subarray(off + 4, off + 8 + len));
    if (expectedCrc !== actualCrc) throw new Error(`CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const pixelBytes = inflated.length - height; // one filter byte per row
  if (inflated.length !== (width * 4 + 1) * height) throw new Error('inflated size mismatch');
  return { width, height, pixelBytes };
}

// --- outputs ----------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const jobs = [
  ['icon-192.png', 192, { rounded: true, pad: 0.06 }],
  ['icon-512.png', 512, { rounded: true, pad: 0.06 }],
  ['icon-512-maskable.png', 512, { rounded: false, pad: 0.18 }],
  ['apple-touch-icon.png', 180, { rounded: false, pad: 0.1 }],
];

for (const [name, size, options] of jobs) {
  const png = render(size, options);
  writeFileSync(join(OUT, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
