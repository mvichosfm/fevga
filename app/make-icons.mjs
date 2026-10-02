// Draws the Fevga app icon and launch splash procedurally (no image files, no dependencies)
// and writes them over Capacitor's placeholder images in android/app/src/main/res.
// Run after `npx cap add android` / `npx cap sync android`:  node make-icons.mjs
//
// The picture: an ivory checker lying over a dark one, on walnut. Adaptive icons (Android 8+)
// get a transparent foreground layer (kept inside the 66/108 safe zone) and a colour
// background; older launchers get the full composition in a rounded square / circle.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const RES = join(here, 'android', 'app', 'src', 'main', 'res');
if (!existsSync(RES)) { console.error(`no ${RES} - run "npx cap add android" first`); process.exit(1); }

// ------------------------------------------------------------------ PNG encoding
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

// ------------------------------------------------------------------ drawing
// Every layer is a function (x, y) -> [r, g, b, a] (0..1) over the unit square; render()
// supersamples 4x4 per pixel and composites back to front.
const over = (dst, src) => {
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a <= 0) return [0, 0, 0, 0];
  return [0, 1, 2].map((i) => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a).concat(a);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

const WALNUT_TOP = hex('#5a3820'), WALNUT_BOT = hex('#2a190d'), BG = '#3a2414';
function walnut(x, y) {
  const grain = 0.04 * Math.sin(y * 40 + Math.sin(x * 9) * 2.2) + 0.02 * Math.sin(y * 130 + x * 7);
  return mix(WALNUT_TOP, WALNUT_BOT, clamp(y * 0.9 + 0.05)).map((v) => clamp(v + grain)).concat(1);
}
// a turned checker seen from above: base colour, darker rim, an inner groove, top-left highlight
function checker(cx, cy, R, base, rimC, grooveC, hi) {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy) / R;
    if (d > 1.02) return [0, 0, 0, 0];
    const edge = 1 - smooth(0.985, 1.02, d);
    let c = base.slice();
    c = mix(c, rimC, smooth(0.86, 0.97, d));
    const g = Math.abs(d - 0.64);
    c = mix(c, grooveC, 0.55 * (1 - smooth(0.015, 0.045, g)));
    const h = Math.hypot(x - (cx - R * 0.38), y - (cy - R * 0.42)) / R;
    c = mix(c, [1, 1, 1], hi * (1 - smooth(0, 0.95, h)));
    return c.concat(edge);
  };
}
const shadow = (cx, cy, R, alpha) => (x, y) => {
  const d = Math.hypot(x - cx, y - cy) / R;
  return [0.05, 0.03, 0.02, alpha * (1 - smooth(0.82, 1.18, d))];
};
// the two checkers, in foreground-canvas units (unit square, safe zone r = 0.3056 around 0.5)
const darkChk = checker(0.43, 0.43, 0.2, hex('#3b2618'), hex('#1a0f08'), hex('#0e0805'), 0.22);
const ivoryChk = checker(0.575, 0.575, 0.2, hex('#f4ead8'), hex('#c9b796'), hex('#a8936f'), 0.55);
const FG_LAYERS = [shadow(0.445, 0.455, 0.2, 0.45), darkChk, shadow(0.59, 0.6, 0.2, 0.55), ivoryChk];
const fg = (x, y) => FG_LAYERS.reduce((acc, L) => over(acc, L(x, y)), [0, 0, 0, 0]);

function render(w, h, pixel) {
  const out = Buffer.alloc(w * h * 4), N = 4;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const c = pixel((px + (sx + 0.5) / N) / w, (py + (sy + 0.5) / N) / h);
      acc = [acc[0] + c[0] * c[3], acc[1] + c[1] * c[3], acc[2] + c[2] * c[3], acc[3] + c[3]];
    }
    const a = acc[3] / (N * N), o = (py * w + px) * 4;
    out[o] = a ? Math.round((acc[0] / acc[3]) * 255) : 0;
    out[o + 1] = a ? Math.round((acc[1] / acc[3]) * 255) : 0;
    out[o + 2] = a ? Math.round((acc[2] / acc[3]) * 255) : 0;
    out[o + 3] = Math.round(a * 255);
  }
  return out;
}

// legacy launcher icon: walnut + the checkers, zoomed so they fill the tile, inside a mask
const ZOOM = 0.74;
const legacy = (mask) => (x, y) => {
  if (!mask(x, y)) return [0, 0, 0, 0];
  return over(walnut(x, y), fg(0.5 + (x - 0.5) * ZOOM, 0.5 + (y - 0.5) * ZOOM));
};
const roundedSquare = (x, y) => { const r = 0.18, qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0); return Math.hypot(qx, qy) <= r; };
const circle = (x, y) => Math.hypot(x - 0.5, y - 0.5) <= 0.5;

// ------------------------------------------------------------------ write
let n = 0;
const write = (file, w, h, pixel) => { writeFileSync(file, png(w, h, render(w, h, pixel))); n++; };
for (const dir of readdirSync(RES)) {
  const d = join(RES, dir);
  if (!statSync(d).isDirectory()) continue;
  for (const name of readdirSync(d)) {
    const f = join(d, name);
    if (dir.startsWith('mipmap') && name === 'ic_launcher.png') { const [w, h] = pngSize(f); write(f, w, h, legacy(roundedSquare)); }
    else if (dir.startsWith('mipmap') && name === 'ic_launcher_round.png') { const [w, h] = pngSize(f); write(f, w, h, legacy(circle)); }
    else if (dir.startsWith('mipmap') && name === 'ic_launcher_foreground.png') { const [w, h] = pngSize(f); write(f, w, h, fg); }
    else if (dir.startsWith('drawable') && name === 'splash.png') {
      // launch splash: the night-table colour with the checkers in the middle
      const [w, h] = pngSize(f), s = Math.min(w, h) * 0.42, dark = hex('#0b0807').concat(1);
      write(f, w, h, (x, y) => over(dark, fg(0.5 + ((x - 0.5) * w) / s, 0.5 + ((y - 0.5) * h) / s)));
    }
  }
}
// adaptive icon background colour
const bgFile = join(RES, 'values', 'ic_launcher_background.xml');
if (existsSync(bgFile)) {
  writeFileSync(bgFile, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
}
console.log(`wrote ${n} icon/splash images and the adaptive background colour (${BG})`);
