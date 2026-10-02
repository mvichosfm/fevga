// Procedural textures: tileable wood (colour + bump), dice faces, glows and soft shadows.
// Wood generator shared with peg-game (same algorithm).
import * as THREE from 'three';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Periodic value noise so the texture tiles seamlessly.
function makeNoise(seed, period) {
  const rnd = mulberry(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y, px, py) => {
    const fx = x * px, fy = y * py;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const xa = ((x0 % px) + px) % px, xb = (xa + 1) % px;
    const ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
    const g = (i, j) => grid[(j % period) * period + (i % period)];
    const a = g(xa, ya) * (1 - tx) + g(xb, ya) * tx;
    const b = g(xa, yb) * (1 - tx) + g(xb, yb) * tx;
    return a * (1 - ty) + b * ty;
  };
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/**
 * Wood with the grain running along the texture's v axis.
 * @param {object} o {light, dark, size, rings, seed, streak, figure}
 */
export function woodTextures(o) {
  const size = o.size || 1024, rings = o.rings || 7, seed = o.seed || 1;
  const n = makeNoise(seed, 64);
  const light = hex(o.light), dark = hex(o.dark);
  const col = document.createElement('canvas'); col.width = col.height = size;
  const bmp = document.createElement('canvas'); bmp.width = bmp.height = size;
  const cc = col.getContext('2d'), bc = bmp.getContext('2d');
  const ci = cc.createImageData(size, size), bi = bc.createImageData(size, size);
  const streak = o.streak ?? 0.35, figure = o.figure ?? 0, wk = o.warp ?? 1;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // straight-grained boards: rings across u, warped; burl: rings are the closed contours
      // of an isotropic noise field, with small dark "eyes" scattered through it
      const ring = o.burl
        ? (n(u, v, 4, 4) * 0.55 + n(u, v, 9, 9) * 0.3 + n(u, v, 18, 18) * 0.15) * rings
        : u * rings + (n(u, v, 3, 2) * 1.6 + n(u, v, 8, 4) * 0.45 + n(u, v, 16, 8) * 0.12) * wk;
      let t = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2);
      t = Math.pow(t, 1.35);
      const fine = o.burl ? n(u, v, 48, 48) : n(u, v, 64, 3);
      const pore = n(u, v, 64, 64);
      let tone = t * (1 - streak - 0.08) + fine * streak + pore * 0.08;
      if (figure) tone += (n(u, v, 32, 6) - 0.5) * figure; // chatoyant "figure" bands
      if (o.burl) { const e = n(u, v, 40, 40); if (e > 0.82) tone *= 1 - Math.min(1, (e - 0.82) * 5) * 0.75; }
      tone = Math.min(1, Math.max(0, tone));
      const i = (y * size + x) * 4;
      ci.data[i] = dark[0] + (light[0] - dark[0]) * tone;
      ci.data[i + 1] = dark[1] + (light[1] - dark[1]) * tone;
      ci.data[i + 2] = dark[2] + (light[2] - dark[2]) * tone;
      ci.data[i + 3] = 255;
      const b = 255 * (0.35 + 0.65 * (1 - tone) * 0.9 + pore * 0.1);
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = b; bi.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0); bc.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bmp);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, bump };
}

/**
 * Polished marble: clouded base with turbulent veins, tileable.
 * @param {object} o {base, base2, vein, size, seed, dir:[a,b] (integers), turb, sharp, amt,
 *                    dir2, turb2, sharp2, amt2, speck}
 */
export function marbleTextures(o) {
  const size = o.size || 1024, seed = o.seed || 1;
  const n = makeNoise(seed, 64), m = makeNoise(seed + 101, 64);
  const base = hex(o.base), base2 = hex(o.base2 ?? o.base), vein = hex(o.vein);
  const [a1, b1] = o.dir || [2, 1], [a2, b2] = o.dir2 || [1, 3];
  // turbulence well below the vein frequency keeps veins as long streaks; too much turns
  // them into closed contour-line loops (seen in the first Carrara render)
  const turb = o.turb ?? 1.4, turb2 = o.turb2 ?? 1.1, sharp = o.sharp ?? 8, sharp2 = o.sharp2 ?? 18;
  const amt = o.amt ?? 0.6, amt2 = o.amt2 ?? 0.3, speck = o.speck ?? 0.04;
  const fbm = (f, u, v) => (f(u, v, 3, 3) * 0.5 + f(u, v, 6, 6) * 0.25 + f(u, v, 12, 12) * 0.15 + f(u, v, 24, 24) * 0.1);
  const col = document.createElement('canvas'); col.width = col.height = size;
  const bmp = document.createElement('canvas'); bmp.width = bmp.height = size;
  const cc = col.getContext('2d'), bc = bmp.getContext('2d');
  const ci = cc.createImageData(size, size), bi = bc.createImageData(size, size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const t1 = fbm(n, u, v), t2 = fbm(m, u, v);
      const v1 = Math.pow(1 - Math.abs(Math.sin((u * a1 + v * b1 + t1 * turb) * TAU)), sharp);
      const v2 = Math.pow(1 - Math.abs(Math.sin((u * a2 + v * b2 + t2 * turb2) * TAU)), sharp2);
      const cloud = Math.min(1, Math.max(0, (n(u, v, 2, 2) * 0.6 + m(u, v, 5, 5) * 0.4 - 0.2) * 1.6));
      const sp = (n(u, v, 64, 64) - 0.5) * speck;
      const k = Math.min(1, v1 * amt + v2 * amt2);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b = base[c] + (base2[c] - base[c]) * cloud;
        ci.data[i + c] = Math.max(0, Math.min(255, b + (vein[c] - b) * k + sp * 255));
      }
      ci.data[i + 3] = 255;
      const bv = 225 - k * 45 + sp * 120; // veins sit a hair lower than the polished face
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = bv; bi.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0); bc.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bmp);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, bump };
}

// Soft dark disc for contact shadows under checkers.
export function aoTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, s * 0.26, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.3, 'rgba(0,0,0,0.25)');
  gr.addColorStop(0.65, 'rgba(0,0,0,0.06)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// Blurred rounded rectangle: the board's contact shadow on the table.
export function boardShadowTexture() {
  const w = 512, h = 448, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.filter = 'blur(26px)';
  g.fillStyle = 'rgba(0,0,0,0.85)';
  g.beginPath();
  g.roundRect(60, 60, w - 120, h - 120, 30);
  g.fill();
  return new THREE.CanvasTexture(c);
}

// Glowing ring used for movable checkers and landing spots.
export function ringTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, s * 0.14, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  gr.addColorStop(0.72, 'rgba(255,255,255,1)');
  gr.addColorStop(0.82, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// Glow along a point triangle: bright at the base, fading to the tip (v runs base -> tip).
export function triGlowTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)');
  gr.addColorStop(0.15, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.27, 0.5], [0.27, 0.75], [0.73, 0.25], [0.73, 0.5], [0.73, 0.75]],
};

// Ivory dice faces with drilled, painted pips: colour + bump per value.
export function dieTextures() {
  const s = 256, out = {};
  const rnd = mulberry(99);
  for (let v = 1; v <= 6; v++) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(s * 0.45, s * 0.4, s * 0.1, s / 2, s / 2, s * 0.75);
    bg.addColorStop(0, '#fbf6ea'); bg.addColorStop(1, '#ece2cc');
    g.fillStyle = bg; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { // faint speckle so the ivory is not flat plastic
      g.fillStyle = `rgba(120,95,60,${0.02 + rnd() * 0.04})`;
      g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const b = document.createElement('canvas'); b.width = b.height = s;
    const bgc = b.getContext('2d');
    bgc.fillStyle = '#fff'; bgc.fillRect(0, 0, s, s);
    const pr = s * (v === 1 ? 0.12 : 0.085);
    for (const [px, py] of PIPS[v]) {
      const x = px * s, y = py * s;
      const pg = g.createRadialGradient(x - pr * 0.25, y - pr * 0.25, pr * 0.1, x, y, pr);
      pg.addColorStop(0, '#3a3430'); pg.addColorStop(0.75, '#100c0a'); pg.addColorStop(1, '#2a221c');
      g.fillStyle = pg; g.beginPath(); g.arc(x, y, pr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, pr + 0.8, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      const bb = bgc.createRadialGradient(x, y, pr * 0.2, x, y, pr * 1.1);
      bb.addColorStop(0, '#000'); bb.addColorStop(0.85, '#222'); bb.addColorStop(1, '#fff');
      bgc.fillStyle = bb; bgc.beginPath(); bgc.arc(x, y, pr * 1.1, 0, Math.PI * 2); bgc.fill();
    }
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    out[v] = { map, bump: new THREE.CanvasTexture(b) };
  }
  return out;
}
