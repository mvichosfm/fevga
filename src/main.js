import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import {
  newGame, cloneGame, createTurn, turnSteps, turnPlay, turnDone, commitTurn, winner,
  absOf, LEVELS, chooseMove, rollDice, applySteps, analyzeView, S, screenTurns, reviewTurn, playKey, describePlay, positionFacts,
} from './engine.js';
import { PUZZLES } from './puzzles.js';
import { aoTexture, ringTexture, triGlowTexture, dieTextures, boardShadowTexture } from './textures.js';
import { THEMES, themeById, SURFACES, SURFACE_SIZE, makeSurface } from './themes.js';
import { loadGames, storeGames, upsertRecent, saveNamed, renameSaved, deleteSaved, newId, stepsText, shown, resultText, fmtDate, MAX_SAVED, toVbg, parseVbg, vbgFileName, VBG_MAX_BYTES, toVbs, parseVbs, vbsFileName, VBS_MAX_BYTES } from './records.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
// Running inside the Android app (Capacitor injects window.Capacitor into its WebView). The app has
// no new tabs and no file downloads, so the strategy guide opens as an in-page sheet and the file
// exports are hidden there (imports still work through the system file picker).
const IS_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (IS_APP) document.body.classList.add('app');
// Engine side 0 = white (ivory), 1 = black. The human picks a colour per game; when he
// plays black the whole stage turns 180 degrees so his home is always near right.
let HUMAN = 0, CPU = 1;

// ================================================================ dimensions (cm-ish)
const PW = 3.9;            // point width
const R = 1.74;            // checker radius
const CT = 0.74;           // checker thickness
const BAR = 3.8;           // centre bar
const HALF = 6 * PW;
const FX = HALF + BAR / 2; // field half-width
const FZ = 22;             // field half-depth
const PL = 18.2;           // point length
const RAIL = 2.7;          // frame rail width
const RAIL_H = 1.45;       // rail height above the field
const BASE = 1.5;          // board thickness below the field
const TABLE_Y = -BASE;
// die size: on phones the whole board is a few hundred pixels wide and real-size dice read as
// specks (Manos, S24 Ultra), so a phone-sized screen gets dice 1.6x larger; DSP spaces the pair
const PHONE = Math.min(window.innerWidth, window.innerHeight) <= 500;
const DS = PHONE ? 2.8 : 1.75;
const DSP = DS / 1.75;
const OFF_X = FX + RAIL + 4.6;

const pointX = (a) => {
  if (a < 6) return BAR / 2 + (5 - a) * PW + PW / 2;
  if (a < 12) return -(BAR / 2 + (a - 6) * PW + PW / 2);
  const j = a - 12;
  if (j < 6) return -(BAR / 2 + (5 - j) * PW + PW / 2);
  return BAR / 2 + (j - 6) * PW + PW / 2;
};
const nearSide = (a) => a < 12;
const LAYERS = [5, 4, 3, 2, 1];
function slotPos(a, k) {
  let L = 0, i = k;
  while (L < 4 && i >= LAYERS[L]) { i -= LAYERS[L]; L++; }
  const along = R + 0.08 + (i + L * 0.5) * (2 * R + 0.03);
  return new THREE.Vector3(pointX(a), L * CT, nearSide(a) ? FZ - along : -FZ + along);
}
// borne-off checkers: neat towers of five on the table beside each home board
function offPos(p, k) {
  const tower = Math.floor(k / 5), lv = k % 5;
  const x = p === 0 ? OFF_X : -OFF_X; // stage coordinates: beside each colour's home board
  const z = p === 0 ? 16 - tower * 4.1 : -16 + tower * 4.1;
  return new THREE.Vector3(x, TABLE_Y + lv * CT, z);
}

// ================================================================ renderer / scene
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0807);
scene.fog = new THREE.Fog(0x0b0807, 120, 230);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(34, 1, 1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = 1.2;
controls.enablePan = false;
controls.target.set(0, 0, 2.5);

const key = new THREE.DirectionalLight(0xfff0db, 3.0);
key.position.set(-34, 80, 40);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.04;
Object.assign(key.shadow.camera, { left: -48, right: 48, top: 40, bottom: -40, near: 20, far: 200 });
key.shadow.camera.updateProjectionMatrix();
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xc6d6ff, 0.5);
fill.position.set(40, 30, 50);
scene.add(fill);
const hemi = new THREE.HemisphereLight(0xffeedd, 0x2a1d12, 0.3);
scene.add(hemi);

// Room dimmer (on-screen slider, [ and ] keys): scales every light and the environment
// together, so the board dims like a real room rather than just getting murkier.
const LIGHT_BASE = { key: 3.0, fill: 0.5, hemi: 0.3, env: 0.5 };
// Retro hanging lamp (Settings): a warm spot from a pendant shade over the board while the
// room lights drop to a glow, so the board sits in a pool of light and the room goes dark.
// The lamp hangs straight over the board's centre at a real pendant height. The camera always
// looks down at the board from above that height, so - as at a real table - only its light
// shows; there is deliberately no lamp model (it could never be in frame).
const LAMP = { spot: 4.2, room: 0.12, env: 0.3, y: 70, z: 0 };
const lampSpot = new THREE.SpotLight(0xffd29a, 0, 0, 0.6, 0.6, 0);
lampSpot.position.set(0, LAMP.y - 5.4, LAMP.z); // from the bulb
lampSpot.target.position.set(0, 0, 0);
lampSpot.shadow.mapSize.set(2048, 2048);
lampSpot.shadow.bias = -0.0003;
lampSpot.shadow.normalBias = 0.04;
lampSpot.shadow.camera.near = 20; lampSpot.shadow.camera.far = 140;
scene.add(lampSpot, lampSpot.target);
let lampOn = false; // set from saved settings before the first applyLighting call
// Two levels so switching can look like a real bulb: lampMix (0 room light .. 1 lamp) fades the
// room, background and fog smoothly; lampGlow is the bulb itself, which stutters on and cools off.
let lampMix = 0, lampGlow = 0;
const LAMP_WARM = new THREE.Color(0xffd29a), LAMP_COLD = new THREE.Color(0xff7a2c);
const BG_ROOM = new THREE.Color(0x0b0807), BG_LAMP = new THREE.Color(0x040302);
function applyLighting(f) {
  const m = lampMix;
  const room = 1 + (LAMP.room - 1) * m;
  key.intensity = LIGHT_BASE.key * f * room;
  fill.intensity = LIGHT_BASE.fill * f * room;
  hemi.intensity = LIGHT_BASE.hemi * f * (1 - 0.65 * m);
  scene.environmentIntensity = LIGHT_BASE.env * f * (1 + (LAMP.env - 1) * m);
  lampSpot.intensity = LAMP.spot * f * lampGlow;
  scene.background.copy(BG_ROOM).lerp(BG_LAMP, m);
  scene.fog.color.copy(scene.background);
}

// Snaps to the current lampOn with no animation (start-up, favourites, .vbs settings).
function applyLamp() {
  lampMix = lampGlow = lampOn ? 1 : 0;
  lampSpot.color.copy(LAMP_WARM);
  key.castShadow = !lampOn;       // one shadow pass at a time: the lamp's, or the room light's
  lampSpot.castShadow = lampOn;
  document.getElementById('vignette').classList.toggle('lamp', lampOn);
  syncBulb();
  applyLighting(lightLevel);
}

// Bulb brightness over time (seconds -> 0..1), linear between keys: switching on stutters twice
// like a cold filament catching (two dips in half a second: the lamp lights most of the screen, so
// it stays under the three-flashes-a-second limit for large flashing areas); switching off drops at
// once, then a short afterglow as it cools. The on-screen bulb's CSS keyframes (bulb-warm, 0.5 s)
// follow the same first half second. Reduced motion: a smooth warm-up and fade, no flicker.
const GLOW_ON = [[0, 0], [0.05, 0.6], [0.12, 0.15], [0.22, 0.85], [0.3, 0.45], [0.5, 1], [1.0, 1]];
const GLOW_OFF = [[0, 1], [0.06, 0.22], [0.25, 0.08], [0.7, 0]];
const GLOW_ON_SOFT = [[0, 0], [0.6, 1]], GLOW_OFF_SOFT = [[0, 1], [0.15, 0.35], [0.6, 0]];
const curve = (keys, t) => {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * ((t - t0) / (t1 - t0)); }
  }
  return keys[keys.length - 1][1];
};
let lampRun = 0;
function setLamp(on) {
  if (on === lampOn) return;
  lampOn = on;
  store.save();
  const btn = document.getElementById('bulbBtn');
  if (btn) { btn.classList.remove('pull', 'warming', 'cooling'); void btn.offsetWidth; btn.classList.add('pull', on ? 'warming' : 'cooling'); }
  syncBulb();
  sound.unlock(); sound.chain(on);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // shadows and the vignette change at the pull; the light itself follows the curve
  key.castShadow = !on; lampSpot.castShadow = on;
  document.getElementById('vignette').classList.toggle('lamp', on);
  const keys = reduce ? (on ? GLOW_ON_SOFT : GLOW_OFF_SOFT) : (on ? GLOW_ON : GLOW_OFF);
  const run = ++lampRun, dur = keys[keys.length - 1][0];
  const mix0 = lampMix;
  animateFn(dur, (k) => {
    if (run !== lampRun) return;
    const t = k * dur;
    lampGlow = curve(keys, t);
    const e = k * k * (3 - 2 * k);
    lampMix = mix0 + ((on ? 1 : 0) - mix0) * e;
    // a cold filament glows orange first and warms to its yellow-white; cooling goes the other way
    lampSpot.color.copy(LAMP_COLD).lerp(LAMP_WARM, on ? Math.min(1, t / (0.8 * dur)) : Math.max(0, 1 - t / (0.35 * dur)));
    applyLighting(lightLevel);
  });
  // the CSS pull/sway runs 1.4 s, longer than either light curve
  setTimeout(() => { if (run === lampRun && btn) btn.classList.remove('pull', 'warming', 'cooling'); }, 1500);
}
function syncBulb() {
  const btn = document.getElementById('bulbBtn');
  if (!btn) return;
  btn.classList.toggle('on', lampOn);
  btn.setAttribute('aria-pressed', String(lampOn));
  const opt = document.getElementById('optLamp');
  if (opt) opt.checked = lampOn;
}

// ================================================================ materials
// Planar UVs chosen per face from its normal, so wood grain runs along `grain` ('x' or 'z')
// at a constant scale, whatever the box proportions.
function planarUV(geo, grain, scale, ou = 0, ov = 0) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) [u, v] = grain === 'x' ? [z, x] : [x, z];
    else if (ax >= az) [u, v] = grain === 'z' ? [y, z] : [y, x];
    else [u, v] = grain === 'x' ? [y, x] : [x, y];
    uv.setXY(i, u / scale + ou, v / scale + ov);
  }
  uv.needsUpdate = true;
  return geo;
}

const aoTex = aoTexture();
const ringTex = ringTexture();
const glowTex = triGlowTexture();

// Surface materials are created once and re-skinned in place by applyTheme(), so the
// meshes never need rebuilding when the board style changes.
let mats = null;
let theme = THEMES[0];
function buildMaterials() {
  const surf = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff });
  return {
    frame: surf(), field: surf(), pa: surf(), pb: surf(), white: surf(), black: surf(), table: surf(),
    line: new THREE.MeshPhysicalMaterial({ color: 0xf0dcb0, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    metal: new THREE.MeshPhysicalMaterial({ color: 0xc89b4a, metalness: 1, roughness: 0.28, clearcoat: 0.3 }),
    ao: new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    halo: new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb940, toneMapped: false }),
    dest: new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff6dc, toneMapped: false }),
    selHalo: new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffe08a, toneMapped: false }),
    hint: new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x6dffa6, toneMapped: false }),
    tri: new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd27a, opacity: 0.5, toneMapped: false }),
    hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
  };
}

const SURF_DEFAULT = { roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.22, bumpScale: 0.6, sheen: 0 };
function setSurface(m, spec, t) {
  m.map = t.map; m.bumpMap = t.bump;
  const props = { ...SURF_DEFAULT, ...spec.mat };
  for (const [k, v] of Object.entries(props)) {
    if (k === 'sheenColor') m.sheenColor.set(v); else m[k] = v;
  }
  m.needsUpdate = true;
}

const themeTex = new Map(); // theme id -> generated full-size textures (kept: switching back is instant)
async function applyTheme(id) {
  const th = themeById(id);
  let tex = themeTex.get(th.id);
  if (!tex) {
    tex = {};
    for (const k of SURFACES) {
      tex[k] = makeSurface(th[k].tex, SURFACE_SIZE[k]);
      await new Promise((r) => setTimeout(r, 0)); // keep the page breathing between textures
    }
    tex.table.map.repeat.set(10, 10); tex.table.bump.repeat.set(10, 10); // one tile per ~40 units
    themeTex.set(th.id, tex);
  }
  theme = th;
  for (const k of SURFACES) setSurface(mats[k], th[k], tex[k]);
  mats.line.color.set(th.line);
  mats.metal.color.set(th.metal.color); mats.metal.roughness = th.metal.roughness;
  // checkers carry their own material clones (per-piece tint), so re-clone them
  allCheckers.forEach((mesh, i) => { mesh.material.dispose(); mesh.material = checkerMaterial(mesh.userData.p, i); });
  if (railPlanes.length) buildRailNumbers();
}

// ================================================================ geometry builders
function triGeometry(a, w, len, y) {
  const x = pointX(a), z0 = nearSide(a) ? FZ : -FZ, dir = nearSide(a) ? -1 : 1;
  const p = [x - w / 2, y, z0, x + w / 2, y, z0, x, y, z0 + dir * len];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // uv: u across, v = 0 at the base -> 1 at the tip (used by the glow); wood uses world coords
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  g.setIndex(dir === -1 ? [0, 1, 2] : [0, 2, 1]); // counter-clockwise seen from above
  return g;
}
function woodTri(a, w, len, y, seed) {
  const g = triGeometry(a, w, len, y);
  const pos = g.attributes.position, uv = new Float32Array(6);
  for (let i = 0; i < 3; i++) { uv[i * 2] = pos.getX(i) / 22 + seed * 0.37; uv[i * 2 + 1] = pos.getZ(i) / 22 + seed * 0.11; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Turned checker profile (radius, height): bevelled rim, two decorative grooves on top.
const checkerGeo = (() => {
  const T = CT;
  const prof = [
    [0, 0], [R - 0.14, 0], [R - 0.04, 0.035], [R, 0.13], [R, T - 0.13], [R - 0.04, T - 0.035], [R - 0.14, T],
    [R * 0.80, T], [R * 0.78, T - 0.045], [R * 0.74, T - 0.045], [R * 0.72, T - 0.012],
    [R * 0.48, T - 0.012], [R * 0.46, T - 0.04], [R * 0.42, T - 0.04], [R * 0.40, T - 0.02], [0, T - 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 72);
  g.computeVertexNormals();
  planarUV(g, 'z', 3.2);
  return g;
})();

// ================================================================ world
// stage = everything fixed to the board (rotates when the human plays black); the dice,
// table and lights stay in world space so throws always come from the human's side
const stage = new THREE.Group();
scene.add(stage);
const world = new THREE.Group();
stage.add(world);
const checkerGroup = new THREE.Group();
stage.add(checkerGroup);

const table = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), null);
table.position.y = TABLE_Y;
table.receiveShadow = true;

let haloMeshes = [], destMeshes = [], triMeshes = [], hitMeshes = [], offHit = null, offDest = null;

function buildBoard() {
  const add = (geo, mat, o = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = o.cast ?? true; m.receiveShadow = true;
    if (o.pos) m.position.copy(o.pos);
    world.add(m);
    return m;
  };
  table.material = mats.table;
  scene.add(table);
  // contact shadow of the whole board on the table
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2 * (FX + RAIL) * 1.25, 2 * (FZ + RAIL) * 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: boardShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
  sh.position.y = TABLE_Y + 0.02;
  sh.userData.boardShadow = true; // slam() shrinks it onto the right half while the board is shut
  world.add(sh);

  // fields (left / right trays)
  for (const sx of [-1, 1]) {
    const w = HALF, cx = sx * (BAR / 2 + HALF / 2);
    const geo = planarUV(new THREE.BoxGeometry(w, BASE, 2 * FZ), 'x', 30, sx * 0.31, 0.2);
    add(geo, mats.field, { pos: new THREE.Vector3(cx, -BASE / 2, 0), cast: false });
    // inlaid border line around each tray
    const inset = 0.55, lw = 0.16;
    const lines = [
      [w - 2 * inset, lw, cx, FZ - inset], [w - 2 * inset, lw, cx, -FZ + inset],
      [lw, 2 * FZ - 2 * inset, cx - w / 2 + inset, 0], [lw, 2 * FZ - 2 * inset, cx + w / 2 - inset, 0],
    ];
    for (const [lx, lz, px, pz] of lines) add(new THREE.PlaneGeometry(lx, lz).rotateX(-Math.PI / 2), mats.line, { pos: new THREE.Vector3(px, 0.002, pz), cast: false });
  }
  // rails: front/back run along x, sides along z. The front/back rails are split at the hinge,
  // one piece per half, like a real folding board (and so a half can fold: slam()).
  const H = BASE + RAIL_H, yc = -BASE + H / 2, rr = 0.42;
  const halfW = FX + RAIL;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const geo = planarUV(new RoundedBoxGeometry(halfW, H, RAIL, 4, rr), 'x', 30, sz * 0.23 + sx * 0.11, 0.5);
      add(geo, mats.frame, { pos: new THREE.Vector3(sx * halfW / 2, yc, sz * (FZ + RAIL / 2)) });
    }
  }
  for (const sx of [-1, 1]) {
    const geo = planarUV(new RoundedBoxGeometry(RAIL, H, 2 * FZ + 0.6, 4, rr), 'z', 30, sx * 0.41, 0.1);
    add(geo, mats.frame, { pos: new THREE.Vector3(sx * (FX + RAIL / 2), yc, 0) });
  }
  // centre bar: two rails meeting at the hinge
  for (const sx of [-1, 1]) {
    const geo = planarUV(new RoundedBoxGeometry(BAR / 2, H, 2 * FZ + 0.6, 4, rr * 0.8), 'z', 30, sx * 0.17, 0.3);
    add(geo, mats.frame, { pos: new THREE.Vector3(sx * BAR / 4, yc, 0) });
  }
  // brass hinges across the seam
  const brass = mats.metal;
  for (const sz of [-1, 1]) {
    const plate = new RoundedBoxGeometry(2.2, 0.12, 3.6, 2, 0.05);
    add(plate, brass, { pos: new THREE.Vector3(0, RAIL_H + 0.05, sz * (FZ - 7)) });
    const pin = new THREE.CylinderGeometry(0.26, 0.26, 3.6, 20).rotateX(Math.PI / 2);
    add(pin, brass, { pos: new THREE.Vector3(0, RAIL_H + 0.12, sz * (FZ - 7)) });
  }

  buildRailNumbers();

  // points, glows, highlights, hit boxes
  const ringGeo = new THREE.PlaneGeometry(2 * R * 1.55, 2 * R * 1.55).rotateX(-Math.PI / 2);
  for (let a = 0; a < 24; a++) {
    // colours alternate all the way round, so facing points (a, 23 - a: e.g. 12 and 13) always differ
    add(woodTri(a, PW * 0.94, PL, 0.004, a), a % 2 ? mats.pb : mats.pa, { cast: false });
    const tri = new THREE.Mesh(triGeometry(a, PW * 0.98, PL + 0.3, 0.01), mats.tri);
    tri.visible = false; tri.renderOrder = 2; world.add(tri); triMeshes[a] = tri;
    const halo = new THREE.Mesh(ringGeo, mats.halo);
    halo.visible = false; halo.renderOrder = 4; world.add(halo); haloMeshes[a] = halo;
    const dest = new THREE.Mesh(ringGeo, mats.dest);
    dest.visible = false; dest.renderOrder = 4; world.add(dest); destMeshes[a] = dest;
    // flat pick area over the point; checkers themselves are picked first (see pickPoint)
    const hit = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.4, PL + 2), mats.hit);
    hit.position.set(pointX(a), 0.2, nearSide(a) ? FZ - (PL + 2) / 2 : -FZ + (PL + 2) / 2);
    hit.userData.point = a; world.add(hit); hitMeshes.push(hit);
  }
  // bear-off area: the right rail and the table beside it
  offHit = new THREE.Mesh(new THREE.BoxGeometry(RAIL + 9, 3.6, 2 * FZ + 2 * RAIL), mats.hit);
  offHit.position.set(FX + (RAIL + 9) / 2, 0, 0);
  offHit.userData.point = -1; world.add(offHit); hitMeshes.push(offHit);
  offDest = new THREE.Mesh(ringGeo, mats.dest);
  offDest.visible = false; offDest.renderOrder = 4; world.add(offDest);
}

// Gold-leaf point numbers on the rails in the human's numbering as shown (start = 1 far right,
// home 19-24 near right; records.shown), readable from his seat (the planes counter-rotate when
// the stage is turned for black). humanPoint is the engine's own numbering (start = 24).
const humanPoint = (a) => (HUMAN === 0 ? a + 1 : ((a + 12) % 24) + 1);
let railPlanes = [];
function buildRailNumbers() {
  for (const p of railPlanes) { world.remove(p); p.material.map.dispose(); p.material.dispose(); }
  railPlanes = [];
  const flip = HUMAN === 1;
  for (const near of [true, false]) {
    const cw = 2048, ch = 64, c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x2 = c.getContext('2d');
    x2.font = 'bold 38px Georgia, "Times New Roman", serif';
    x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.fillStyle = '#fff';
    for (let a = near ? 0 : 12; a < (near ? 12 : 24); a++) {
      const u = (flip ? -pointX(a) : pointX(a)) / (2 * FX) + 0.5;
      x2.fillText(String(shown(humanPoint(a))), u * cw, ch / 2 + 2);
    }
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ color: theme.leaf, metalness: 0.85, roughness: 0.35, transparent: true, depthWrite: false, map: tex });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * FX, 2 * FX * ch / cw).rotateX(-Math.PI / 2), m);
    plane.position.set(0, RAIL_H + 0.006, near ? FZ + RAIL / 2 : -FZ - RAIL / 2);
    if (flip) plane.rotation.y = Math.PI;
    plane.visible = showNumbers;
    plane.renderOrder = 3; world.add(plane); railPlanes.push(plane);
  }
}

// Seats the human on `color`: turns the stage and re-labels everything colour-dependent.
function applySeat(color) {
  HUMAN = color; CPU = 1 - color;
  stage.rotation.y = color === 1 ? Math.PI : 0;
  if (offHit) offHit.position.x = (color === 0 ? 1 : -1) * (FX + (RAIL + 9) / 2);
  if (mats) buildRailNumbers();
  $('dotYou').className = 'dot ' + (color === 0 ? 'w' : 'b');
  $('dotCpu').className = 'dot ' + (color === 0 ? 'b' : 'w');
  for (const b of document.querySelectorAll('#seat button')) b.classList.toggle('on', +b.dataset.color === color);
}

// ================================================================ checkers
const aoGeo = new THREE.PlaneGeometry(2 * R * 1.5, 2 * R * 1.5).rotateX(-Math.PI / 2);
const stacks = Array.from({ length: 24 }, () => []);
const offStacks = [[], []];
let allCheckers = [];

// Per-checker clone of its colour's material with a tiny tint, like real turned pieces.
function checkerMaterial(p, i) {
  const m = (p === 0 ? mats.white : mats.black).clone();
  m.color.setScalar(1 + (Math.sin(i * 12.9898 + p * 78.233) * 0.5) * 0.06);
  return m;
}

function makeChecker(p, i) {
  const mesh = new THREE.Mesh(checkerGeo, checkerMaterial(p, allCheckers.length));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.rotation.y = Math.random() * Math.PI * 2;
  const ao = new THREE.Mesh(aoGeo, mats.ao);
  ao.position.y = 0.006; ao.renderOrder = 1;
  mesh.add(ao);
  mesh.userData = { p, rest: new THREE.Vector3(), lift: 0, anim: 0, ao };
  checkerGroup.add(mesh);
  return mesh;
}

function setRest(mesh, v) {
  mesh.userData.rest.copy(v);
  mesh.userData.ao.visible = v.y < 0.05 || (v.y <= TABLE_Y + 0.05);
}

// Puts the 30 checkers where game g says, dropping them in from above.
function layoutCheckers(g, animate) {
  for (const s of stacks) s.length = 0;
  offStacks[0].length = 0; offStacks[1].length = 0;
  const pool = [allCheckers.filter((c) => c.userData.p === 0), allCheckers.filter((c) => c.userData.p === 1)];
  let n = 0;
  for (let p = 0; p < 2; p++) {
    let idx = 0;
    for (let r = 24; r >= 1; r--) {
      for (let c = 0; c < g.pos[p][r]; c++) {
        const a = absOf(p, r), mesh = pool[p][idx++];
        const to = slotPos(a, stacks[a].length);
        stacks[a].push(mesh);
        place(mesh, to, animate, n++);
      }
    }
    for (let c = 0; c < g.off[p]; c++) {
      const mesh = pool[p][idx++];
      place(mesh, offPos(p, offStacks[p].length), animate, n++);
      offStacks[p].push(mesh);
    }
  }
}
function place(mesh, to, animate, n) {
  setRest(mesh, to);
  if (!animate) { mesh.position.copy(to); return; }
  const from = to.clone(); from.y += 14 + Math.random() * 4;
  mesh.position.copy(from);
  mesh.visible = false;
  mesh.userData.anim++;
  animateFn(0.55, (k) => {
    mesh.visible = true;
    mesh.position.lerpVectors(from, to, easeOutBounce(k));
  }, 0.25 + n * 0.035).then(() => {
    mesh.userData.anim--;
    if (n % 3 === 0) sound.tok(0.3, 600);
  });
}

const topY = (a) => (stacks[a].length ? stacks[a][stacks[a].length - 1].userData.rest.y + CT : 0);

// Moves the top checker from point `from` (-1 = off tray) to point `to` (-1 = off).
async function moveChecker(p, from, to) {
  const src = from === -1 ? offStacks[p] : stacks[from];
  const mesh = src.pop();
  if (!mesh) return;
  const dst = to === -1 ? offStacks[p] : stacks[to];
  const target = to === -1 ? offPos(p, dst.length) : slotPos(to, dst.length);
  dst.push(mesh);
  const start = mesh.position.clone();
  const dist = start.distanceTo(target);
  const dur = 0.32 + Math.min(0.45, dist * 0.009);
  const arc = 1.6 + dist * 0.05;
  mesh.userData.anim++;
  mesh.userData.ao.visible = false;
  mesh.userData.lift = 0;
  sound.click();
  await animateFn(dur, (k) => {
    const e = easeInOut(k);
    mesh.position.lerpVectors(start, target, e);
    mesh.position.y += arc * 4 * k * (1 - k);
  });
  setRest(mesh, target);
  mesh.position.copy(target);
  mesh.userData.anim--;
  sound.place();
}

// ================================================================ dice
let dieTex = null;
const dice = [];
const FACE_N = { 1: [0, 1, 0], 6: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, 0, 1], 5: [0, 0, -1] };
function buildDice() {
  dieTex = dieTextures();
  const geo = new RoundedBoxGeometry(DS, DS, DS, 4, DS * 0.17);
  const order = [3, 4, 1, 6, 2, 5]; // BoxGeometry groups: +x -x +y -y +z -z
  for (let i = 0; i < 2; i++) {
    const ms = order.map((v) => new THREE.MeshPhysicalMaterial({
      map: dieTex[v].map, bumpMap: dieTex[v].bump, bumpScale: 1.2, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.12,
    }));
    const d = new THREE.Mesh(geo, ms);
    d.castShadow = true; d.receiveShadow = true;
    d.position.set(OFF_X - 1 + i * 2.2 * DSP, TABLE_Y + DS / 2, -12); // resting beside the board at start
    scene.add(d);
    dice.push(d);
  }
}
const UP = new THREE.Vector3(0, 1, 0);
function faceUpQuat(v) {
  const n = new THREE.Vector3(...FACE_N[v]);
  const q = new THREE.Quaternion().setFromUnitVectors(n, UP);
  const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (Math.random() - 0.5) * 1.1);
  return yaw.multiply(q);
}
function dimDie(i, dimmed) {
  for (const m of dice[i].material) m.color.setScalar(dimmed ? 0.42 : 1);
}

// Throws die i so it lands showing `value` in the thrower's right-hand half.
function throwDie(i, value, side, slot, delay = 0) {
  const d = dice[i];
  dimDie(i, false);
  const sx = side === HUMAN ? 1 : -1;
  const end = new THREE.Vector3(
    sx * (BAR / 2 + HALF / 2 + (slot - 0.5) * 3.4 * DSP + (Math.random() - 0.5) * 1.2),
    DS / 2,
    (Math.random() - 0.5) * 3.2 + (slot - 0.5) * 0.8,
  );
  const start = new THREE.Vector3(sx * (BAR / 2 + HALF * 0.7) + (Math.random() - 0.5) * 3, 7, side === HUMAN ? FZ + 10 : -FZ - 10);
  const qEnd = faceUpQuat(value);
  const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  const spin = (3 + Math.random() * 2) * Math.PI * 2;
  const dur = 1.05 + Math.random() * 0.2;
  const bounces = 3.15;
  let lastB = 0;
  const qa = new THREE.Quaternion();
  return animateFn(dur, (k) => {
    const e = 1 - Math.pow(1 - k, 3);
    d.position.lerpVectors(start, end, e);
    const b = Math.floor(k * bounces);
    if (b > lastB && b <= 3) { lastB = b; sound.dieHit(0.7 / b); }
    d.position.y = DS / 2 + 5.2 * Math.pow(1 - k, 2) * Math.abs(Math.sin(k * Math.PI * bounces)) + (1 - e) * 3;
    qa.setFromAxisAngle(axis, spin * (1 - e));
    d.quaternion.copy(qEnd).multiply(qa);
  }, delay);
}

// ================================================================ animation helpers
const anims = [];
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBounce = (t) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
function animateFn(dur, fn, delay = 0) {
  return new Promise((res) => anims.push({ t: -delay, dur, fn, res }));
}
function flushAnims() { // finish everything instantly (new game)
  for (const a of anims.splice(0)) { try { a.fn(1); } catch { /* ignore */ } a.res(); }
}
let timeScale = 1; // tests shrink the pauses between moves
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000 * timeScale));

// ================================================================ AI (worker with main-thread fallback)
let worker = null, reqId = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const r = pending.get(e.data.id); if (r) { pending.delete(e.data.id); r(e.data.analysis ?? e.data.steps); } };
  worker.onerror = () => { worker = null; for (const [, r] of pending) r(null); pending.clear(); };
} catch { worker = null; }
function think(g, p, d, level) {
  return new Promise((res) => {
    const local = () => res(chooseMove(cloneGame(g), p, d, level));
    if (!worker) return local();
    const id = ++reqId;
    pending.set(id, (steps) => (steps ? res(steps) : local()));
    worker.postMessage({ id, g: { pos: [Array.from(g.pos[0]), Array.from(g.pos[1])], off: g.off.slice() }, p, dice: d, level });
  });
}
// Mr. Makis: level-10 analysis of the human's position with the dice still to play.
const MAKIS_OPTS = { top: 4, rollouts: 120 };
function askMakis(view, rem, trap) {
  return new Promise((res) => {
    const opts = { ...MAKIS_OPTS, seed: (Date.now() & 0xffff) + 1, trap };
    const local = () => res(analyzeView(view, rem, opts));
    if (!worker) return local();
    const id = ++reqId;
    pending.set(id, (a) => (a ? res(a) : local()));
    worker.postMessage({ id, type: 'makis', view: { mine: Array.from(view.mine), opp: Array.from(view.opp), myOff: view.myOff, oppOff: view.oppOff }, rem, opts });
  });
}

// Mistake review jobs (screenTurns / reviewTurn) on the worker, main thread as a fallback.
function askReview(type, payload) {
  return new Promise((res) => {
    const local = () => res(type === 'screen' ? screenTurns(payload.turns, payload.side) : reviewTurn(payload.turns, payload.i, payload.opts));
    if (!worker) return local();
    const id = ++reqId;
    pending.set(id, (a) => (a ? res(a) : local()));
    worker.postMessage({ id, type, ...payload });
  });
}

// ================================================================ game state
const sound = new Sound();
const store = {
  load() { try { return JSON.parse(localStorage.getItem('fevga.v1')) || {}; } catch { return {}; } },
  save() { try { localStorage.setItem('fevga.v1', JSON.stringify({ level, score, muted: sound.muted, color: seatColor, theme: themeId, numbers: showNumbers, freeCam, autoEnd, openingPlay, light: lightLevel, match: matchOn, matchScore, view: savedView, lamp: lampOn, round: showRound, total: showTotal })); } catch { /* private mode */ } },
};
const saved = store.load();
let level = saved.level >= 1 && saved.level <= 5 ? saved.level : 3;
let score = Array.isArray(saved.score) ? saved.score : [0, 0]; // [human, computer]
let seatColor = saved.color === 1 ? 1 : 0;                     // white unless chosen otherwise
let themeId = themeById(saved.theme).id;                        // board style (Settings)
let showNumbers = saved.numbers !== false;                      // rail point numbers (Settings)
let showRound = saved.round === true;                           // round counter at the top (Settings)
let showTotal = saved.total === true;                           // sum of the two dice in the move message (Settings)
// "6–5 (sum 11)": the dice for status messages; the sum only when the setting is on
const diceLabel = (d) => `<b>${d[0]}–${d[1]}</b>${showTotal ? ` <span class="tot">(sum ${d[0] + d[1]})</span>` : ''}`;
// Camera is locked by default: a click with a little drag used to orbit the board (and the
// damping kept it drifting) while Manos was moving checkers. Settings > Free camera unlocks.
let freeCam = saved.freeCam === true;
let savedView = Array.isArray(saved.view) && saved.view.length === 3 ? saved.view : null; // custom camera spot; null = home view
let autoEnd = saved.autoEnd === true;                          // end the turn without Done (Settings)
let openingPlay = saved.openingPlay === true;                  // winner plays the opening dice (Settings)
let lightLevel = saved.light >= 0.25 && saved.light <= 1.6 ? saved.light : 1; // room dimmer
lampOn = saved.lamp === true;                                   // retro hanging lamp (Settings)
// Match play (Settings > Play): first to MATCH_TO points, mars counts 2; kept across reloads.
const MATCH_TO = 5;
let matchOn = saved.match === true;
let matchScore = Array.isArray(saved.matchScore) && saved.matchScore.length === 2 ? saved.matchScore : [0, 0];
sound.setMuted(!!saved.muted);

let g = null;            // committed game state
let phase = 'loading';   // opening | human-roll | human-move | cpu | over
let gid = 0;             // bumps on new game; stale async work checks it
let T = null;            // current turn (either side)
let turnStart = null;    // game snapshot at the start of the human turn
let curDice = null;
let selected = -1;
let legal = [];
let dests = new Map();   // abs (or -1) -> step path for the selected checker
let hintPath = null;
let record = null;       // the game being played, as a replayable record (records.js)
let replay = null;       // replay viewer state while watching a recorded game
const gamesDb = loadGames();

// Recent games are saved after every turn, so the five newest survive a closed tab.
function recordTurn(p, d, steps) {
  if (!record) return;
  record.turns.push({ p, dice: d.slice(), steps: steps.map(({ r, t, d: die }) => ({ r, t, d: die })) });
  record.level = level;
  upsertRecent(gamesDb, record);
  storeGames(gamesDb);
  updateRound();
}
let busy = false;

const forcedDice = [];
const nextDice = () => (forcedDice.length ? forcedDice.shift() : rollDice());

function setStatus(html) { $('status').innerHTML = html; }

function legalSources() { return new Set(legal.map((s) => s.from)); }

// Copies every field of the turn (mustOpen included - the unblocking duty; dropping it once let
// computeDests offer destinations the engine then refused, freezing the turn) and gives the copy
// its own board, dice and history so exploring it never touches the live turn.
function cloneTurn(t) {
  return { ...t, v: { ...t.v, mine: Int8Array.from(t.v.mine) }, rem: t.rem.slice(), played: t.played.slice() };
}

// Every landing spot of the selected checker, including several dice in a row.
function computeDests(from) {
  const out = new Map();
  const walk = (t, at, path) => {
    for (const s of turnSteps(t)) {
      if (s.from !== at) continue;
      const p2 = path.concat([s]);
      if (!out.has(s.to) || out.get(s.to).length > p2.length) out.set(s.to, p2);
      if (s.to !== -1) { const t2 = cloneTurn(t); turnPlay(t2, s); walk(t2, s.to, p2); }
    }
  };
  walk(cloneTurn(T), from, []);
  return out;
}

function clearMarks() {
  for (let a = 0; a < 24; a++) { haloMeshes[a].visible = false; destMeshes[a].visible = false; triMeshes[a].visible = false; }
  offDest.visible = false;
}

function refreshMarks() {
  clearMarks();
  if (phase !== 'human-move' || busy) return;
  if (selected < 0) {
    for (const a of legalSources()) {
      const h = haloMeshes[a];
      h.position.set(pointX(a), topY(a) + 0.03, stacks[a][stacks[a].length - 1].userData.rest.z);
      h.material = mats.halo; h.visible = true;
    }
    return;
  }
  haloMeshes[selected].material = mats.selHalo; haloMeshes[selected].visible = true;
  const hintEnd = hintPath && hintPath[0].from === selected ? chainEnd(hintPath) : null;
  for (const to of dests.keys()) {
    const mat = to === hintEnd ? mats.hint : mats.dest;
    if (to === -1) {
      offDest.position.copy(offPos(HUMAN, offStacks[HUMAN].length)); offDest.position.y += 0.05;
      offDest.material = mat; offDest.visible = true;
    } else {
      const sp = slotPos(to, stacks[to].length);
      destMeshes[to].position.set(sp.x, sp.y + 0.05, sp.z);
      destMeshes[to].material = mat; destMeshes[to].visible = true;
      triMeshes[to].visible = true;
    }
  }
}
// the end point of the first checker's run in a hint path
function chainEnd(path) {
  let at = path[0].from, end = null;
  for (const s of path) { if (s.from === at) { end = s.to; at = s.to; } }
  return end;
}

function select(a) {
  selected = a;
  dests = a >= 0 ? computeDests(a) : new Map();
  if (a >= 0) sound.click();
  refreshMarks();
}

function remainingDice() {
  if (!T) return [];
  return T.rem.slice();
}

function updateHud() {
  const live = T && (phase === 'human-move' || phase === 'cpu') ? T : null;
  const shown = replay ? replay.pos : g; // a replay shows its own position, not the live game
  const pip = (p) => {
    let s = 0;
    const arr = live && live.p === p ? live.v.mine : shown.pos[p];
    for (let r = 1; r <= 24; r++) s += r * arr[r];
    return s;
  };
  const off = (p) => (live && live.p === p ? live.v.myOff : shown.off[p]);
  $('pipYou').textContent = pip(HUMAN); $('pipCpu').textContent = pip(CPU);
  $('offYou').textContent = off(HUMAN); $('offCpu').textContent = off(CPU);
  const sc = matchOn ? matchScore : score; // during a match the big numbers are the match score
  $('scoreYou').textContent = sc[0]; $('scoreCpu').textContent = sc[1];
  $('levelName').textContent = LEVELS[level - 1].name;
  $('matchInfo').hidden = !matchOn;
  $('matchInfo').textContent = `Match to ${MATCH_TO}`;
  // dice chips
  const chips = $('chips');
  chips.innerHTML = '';
  if (curDice && (phase === 'human-move' || phase === 'cpu')) {
    const all = curDice[0] === curDice[1] ? [curDice[0], curDice[0], curDice[0], curDice[0]] : curDice.slice();
    const rem = remainingDice().slice();
    for (const v of all) {
      const i = rem.indexOf(v);
      const used = i < 0;
      if (!used) rem.splice(i, 1);
      const el = document.createElement('span');
      el.className = 'chip' + (used ? ' used' : '');
      el.textContent = '⚀⚁⚂⚃⚄⚅'[v - 1];
      chips.appendChild(el);
    }
  }
  const humanMove = phase === 'human-move';
  const canRoll = phase === 'opening' || phase === 'human-roll';
  $('rollBtn').hidden = !canRoll;
  $('rollBtn').disabled = busy;
  $('doneBtn').hidden = !humanMove;
  $('doneBtn').disabled = busy || !T || !turnDone(T);
  $('doneBtn').classList.toggle('ready', humanMove && !busy && T && turnDone(T));
  $('undoBtn').hidden = !humanMove;
  $('undoBtn').disabled = busy || !T || !T.played.length;
  $('hintBtn').hidden = !humanMove || !!puzzle; // a puzzle is solved without help
  $('hintBtn').disabled = busy || !T || turnDone(T);
  $('makisBtn').hidden = !humanMove || !!puzzle;
  $('makisBtn').disabled = busy || !T || turnDone(T) || !!makis;
  const resignOk = canResign();
  if (!resignOk) $('resignAsk').hidden = true;
  $('resignBtn').hidden = !resignOk || !$('resignAsk').hidden;
  $('slamBtn').hidden = !!puzzle || !(phase === 'human-roll' || phase === 'human-move' || phase === 'opening' || phase === 'over');
  $('slamBtn').disabled = !canSlam();
  $('ovSlam').disabled = !canSlam();
  const noDouble = humanBorneOff();
  $('resignDouble').disabled = noDouble;
  $('resignDouble').title = noDouble ? 'You have borne off a checker, so the computer can no longer win double' : '';
  $('turnYou').classList.toggle('on', phase === 'human-roll' || phase === 'human-move');
  $('turnCpu').classList.toggle('on', phase === 'cpu');
  updateRound();
  // dim used dice in the scene
  if (curDice && T && (phase === 'human-move' || phase === 'cpu')) {
    const used = T.played.length;
    if (curDice[0] === curDice[1]) { dimDie(1, used >= 2); dimDie(0, used >= 4); }
    else {
      const playedVals = T.played.map((s) => s.d);
      dimDie(0, playedVals.includes(curDice[0])); dimDie(1, playedVals.includes(curDice[1]));
    }
  }
  positionHud(); // the bottom bar's height changes with its content
}

// ================================================================ flow
function startGame() {
  gid++;
  flushAnims();
  busy = false; T = null; curDice = null; selected = -1; legal = []; dests = new Map(); hintPath = null;
  if (replay) closeReplayUi();
  if (puzzle) { puzzle = null; $('puzzle').hidden = true; } // a new game replaces the borrowed one too
  closeMakis();
  if (matchOn && Math.max(...matchScore) >= MATCH_TO) { matchScore = [0, 0]; store.save(); } // finished match -> new one
  applySeat(seatColor);
  record = { id: newId(), date: Date.now(), level, human: HUMAN, opening: null, openingPlay, turns: [], result: null };
  g = newGame();
  layoutCheckers(g, true);
  dice.forEach((d, i) => { d.position.set(OFF_X - 1 + i * 2.2 * DSP, TABLE_Y + DS / 2, -12); d.quaternion.copy(faceUpQuat(i ? 5 : 6)); dimDie(i, false); });
  phase = 'opening';
  $('overlay').classList.add('hidden');
  setStatus('Roll to see who starts');
  clearMarks();
  updateHud();
}

async function roll() {
  if (busy) return;
  sound.unlock();
  if (phase === 'opening') return openingRoll();
  if (phase !== 'human-roll') return;
  const my = gid;
  busy = true; updateHud();
  curDice = nextDice();
  sound.shake();
  setStatus('Rolling…');
  await Promise.all([throwDie(0, curDice[0], HUMAN, 0), throwDie(1, curDice[1], HUMAN, 1, 0.06)]);
  if (my !== gid) return;
  return startHumanTurn(curDice);
}

// Begins the human's move with dice already on the table (a roll, or the opening throw).
async function startHumanTurn(d) {
  const my = gid;
  curDice = d.slice();
  turnStart = cloneGame(g);
  T = createTurn(g, HUMAN, curDice);
  busy = false;
  if (T.M === 0) {
    // the turn passes by itself after a pause; busy keeps Done / Enter from ending it a second
    // time meanwhile (that recorded the turn twice and then crashed on T = null)
    const myT = T;
    legal = []; selected = -1; dests = new Map(); // nothing to pick (and no leftovers from the last turn)
    phase = 'human-move'; busy = true; updateHud();
    setStatus(`You rolled ${diceLabel(curDice)} — no legal move`);
    await wait(1.6);
    if (my !== gid || T !== myT || phase !== 'human-move') return;
    busy = false;
    return endHumanTurn();
  }
  phase = 'human-move';
  beginHumanStep();
  if (T.mustOpen) toast(mustOpenText(T));
}

async function openingRoll() {
  const my = gid;
  busy = true; updateHud();
  const [a, b] = nextDice(); // a = human's die, b = computer's
  sound.shake();
  setStatus('Rolling for the first move…');
  await Promise.all([throwDie(0, a, HUMAN, 0.5), throwDie(1, b, CPU, 0.5, 0.1)]);
  if (my !== gid) return;
  busy = false;
  if (a === b) { setStatus(`Both rolled <b>${a}</b> — roll again`); updateHud(); return; }
  if (record) record.opening = [a, b];
  // Settings > Play: the winner either rolls again (default) or plays these two dice
  // keep [human die, computer die] order: curDice[i] must match the die mesh i that shows it
  const first = openingPlay ? [a, b] : null;
  if (a > b) {
    if (first) {
      setStatus(`You rolled <b>${a}</b>, computer <b>${b}</b> — you start with <b>${a}–${b}</b>`);
      await wait(1.0);
      if (my !== gid) return;
      return startHumanTurn(first);
    }
    phase = 'human-roll';
    setStatus(`You rolled <b>${a}</b>, computer <b>${b}</b> — you start. Roll the dice`);
    updateHud();
  } else {
    setStatus(`You rolled <b>${a}</b>, computer <b>${b}</b> — computer starts${first ? ` with <b>${b}–${a}</b>` : ''}`);
    phase = 'cpu'; updateHud();
    await wait(1.2);
    if (my !== gid) return;
    cpuTurn(first);
  }
}

function beginHumanStep() {
  legal = turnSteps(T);
  selected = -1; dests = new Map();
  if (turnDone(T) && autoEnd && T.played.length && !makis) { // never auto-end under Mr. Makis's demo
    // Settings > End my turn automatically: a short pause to see the last move; Undo in that
    // window replaces T, which cancels the auto-end
    setStatus('Move complete — ending your turn… <span style="opacity:.7">(Undo to take it back)</span>');
    const myT = T, my = gid;
    wait(0.6).then(() => { if (gid === my && T === myT && phase === 'human-move' && !busy && turnDone(T)) done(); });
  } else if (turnDone(T)) {
    setStatus(T.M < (curDice[0] === curDice[1] ? 4 : 2)
      ? 'No further move possible — press <b>Done</b>'
      : 'Move complete — press <b>Done</b> (or Undo)');
  } else {
    const n = T.M - T.played.length;
    const partial = T.M < (curDice[0] === curDice[1] ? 4 : 2) && !T.played.length ? ` (only ${T.M} playable)` : '';
    setStatus(`Your move: ${diceLabel(curDice)}${partial} · ${n} to play — pick a glowing checker`);
  }
  updateHud();
  refreshMarks();
}

async function playPath(path) {
  if (busy) return;
  const my = gid;
  busy = true; selected = -1; hintPath = null; clearMarks(); updateHud();
  for (const s of path) {
    turnPlay(T, s);
    updateHud();
    await moveChecker(HUMAN, s.from, s.to);
    if (my !== gid) return;
  }
  busy = false;
  beginHumanStep();
}

async function undo() {
  if (busy || phase !== 'human-move' || !T || !T.played.length) return;
  if (makis) closeMakis(); // undoing by hand ends Mr. Makis's demonstration
  const my = gid;
  busy = true; selected = -1; hintPath = null; clearMarks();
  const last = T.played[T.played.length - 1];
  const keep = T.played.slice(0, -1);
  const t2 = createTurn(turnStart, HUMAN, curDice);
  for (const s of keep) turnPlay(t2, s);
  T = t2;
  updateHud();
  await moveChecker(HUMAN, last.to, last.from);
  if (my !== gid) return;
  busy = false;
  beginHumanStep();
}

async function done() {
  if (busy || phase !== 'human-move' || !T || !turnDone(T)) return;
  if (puzzle) return puzzleCheck(); // a puzzle's Done checks the answer instead of ending a turn
  endHumanTurn();
}

function endHumanTurn() {
  closeMakis();
  recordTurn(HUMAN, curDice, T.played);
  commitTurn(g, T);
  T = null; selected = -1; legal = []; clearMarks();
  if (checkWin()) return;
  phase = 'cpu';
  updateHud();
  cpuTurn();
}

async function cpuTurn(preset = null) {
  const my = gid;
  phase = 'cpu'; busy = true;
  updateHud();
  if (preset) curDice = preset.slice(); // opening throw already on the table
  else {
    setStatus('Computer is rolling…');
    await wait(0.5);
    if (my !== gid) return;
    curDice = nextDice();
    sound.shake();
    await Promise.all([throwDie(0, curDice[0], CPU, 0), throwDie(1, curDice[1], CPU, 1, 0.06)]);
    if (my !== gid) return;
  }
  T = createTurn(g, CPU, curDice);
  if (T.mustOpen) toast('All your checkers are stuck right behind the computer\'s six in a row, so it must open one of those points this turn');
  updateHud();
  setStatus(`Computer rolled ${diceLabel(curDice)} · thinking<span class="dots"></span>`);
  const t0 = performance.now();
  const steps = await think(g, CPU, curDice, level);
  const minThink = 0.35 + level * 0.12;
  const el = (performance.now() - t0) / 1000;
  if (el < minThink) await wait(minThink - el);
  if (my !== gid) return;
  if (!steps.length) {
    setStatus(`Computer rolled ${diceLabel(curDice)} — no legal move`);
    await wait(1.4);
  } else {
    setStatus(`Computer plays ${diceLabel(curDice)}`);
    for (const st of steps) {
      const s = turnPlay(T, st);
      updateHud();
      await moveChecker(CPU, s.from, s.to);
      if (my !== gid) return;
      await wait(0.12);
    }
  }
  recordTurn(CPU, curDice, T.played);
  commitTurn(g, T);
  T = null; busy = false;
  if (checkWin()) return;
  phase = 'human-roll';
  sound.turn();
  setStatus('Your turn — <b>roll the dice</b>');
  updateHud();
}

function checkWin() {
  const w = winner(g);
  if (!w) return false;
  finishGame(w.p === HUMAN ? 0 : 1, w.points);
  return true;
}

// Ends the game for `side` (0 human, 1 computer) with `points`; shared by a real finish and by
// admitting the loss, so both count the same way in the score, the match and the game record.
function finishGame(side, points, resigned = false) {
  phase = 'over'; busy = false;
  score[side] += points;
  if (matchOn) matchScore[side] += points;
  const matchWon = matchOn && matchScore[side] >= MATCH_TO;
  if (record) {
    record.result = { winner: side === 0 ? 'you' : 'cpu', points, ...(resigned ? { resigned: true } : {}) };
    if (resigned) record.resigned = true;
    if (matchOn) record.match = { to: MATCH_TO, after: matchScore.slice() };
    upsertRecent(gamesDb, record); storeGames(gamesDb);
  }
  store.save();
  updateHud();
  clearMarks();
  const you = side === 0;
  const how = resigned
    ? `You admitted the loss — the computer takes a ${points === 2 ? 'double' : 'single'} win. +${points} point${points > 1 ? 's' : ''}.`
    : `${you ? 'You' : 'The computer'} bore off all fifteen checkers${points === 2 ? ' before the other side bore off a single one' : ''}. +${points} point${points > 1 ? 's' : ''}.`;
  if (matchWon) {
    $('ovTitle').textContent = you ? 'You win the match!' : 'The computer wins the match';
    $('ovText').textContent = `${how} Final score ${matchScore[0]}–${matchScore[1]} in a match to ${MATCH_TO} vs ${LEVELS[level - 1].name}.`;
    $('ovNew').textContent = 'New match';
  } else {
    $('ovTitle').textContent = resigned ? 'You admitted the loss' : you ? (points === 2 ? 'Mars! You win double' : 'You win!') : (points === 2 ? 'Mars — the computer wins double' : 'The computer wins');
    $('ovText').textContent = matchOn
      ? `${how} Match: you ${matchScore[0]} – ${matchScore[1]} computer, first to ${MATCH_TO}.`
      : `${how} Score ${score[0]}–${score[1]} vs ${LEVELS[level - 1].name}.`;
    $('ovNew').textContent = matchOn ? 'Next game' : 'Play again';
  }
  setStatus(matchWon ? (you ? 'You win the match!' : 'The computer wins the match') : resigned ? 'You admitted the loss' : (you ? 'You win!' : 'The computer wins'));
  if (you) sound.win(); else sound.lose();
  setTimeout(() => $('overlay').classList.remove('hidden'), resigned ? 300 : 900);
}

// ---------------------------------------------------------------- admit loss
// Main-screen button: the human concedes, choosing a single (1 point) or double (2 points) loss.
// Allowed whenever it is the human's turn (or before the first roll); confirmed inline.
const canResign = () => !busy && !puzzle && (phase === 'human-roll' || phase === 'human-move' || phase === 'opening');
// Once the human has a checker off (committed, or earlier in the turn being played) a mars is
// impossible, so a double loss is no longer offered.
const humanBorneOff = () => !!g && (g.off[HUMAN] > 0 || (!!T && T.p === HUMAN && T.v.myOff > 0));
function resign(points) {
  if (!canResign() || (points === 2 && humanBorneOff())) return;
  gid++;            // drops any pending timers of this game (auto-end, opening pause)
  flushAnims();
  closeMakis();
  selected = -1; hintPath = null; T = null;
  $('resignAsk').hidden = true;
  finishGame(1, points, true);
}
$('resignBtn').onclick = () => { if (canResign()) { $('resignAsk').hidden = false; updateHud(); } };
$('resignNo').onclick = () => { $('resignAsk').hidden = true; updateHud(); };
$('resignSingle').onclick = () => resign(1);
$('resignDouble').onclick = () => resign(2);

// ---------------------------------------------------------------- slam the board (just for fun)
// The left half of the board (stage coordinates) folds shut over the right with a bang: its
// checkers are flung off, the camera shakes, the dice and the borne-off checkers jump. Then the
// board reopens and every checker and die flies back to exactly where it was. The game itself is
// never touched: no state changes, no record entry. Allowed on the human's turn and at game over.
let slamming = false, shakeT = 0;
const SHAKE = 0.55;
const canSlam = () => !slamming && !busy && !puzzle && (phase === 'human-roll' || phase === 'human-move' || phase === 'opening' || phase === 'over');
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Where something falling at stage (x, z) comes to rest once the board is shut: on the closed
// board's back over the right half, on the table where the left half used to be or off the board.
const LID_TOP = 2 * RAIL_H + BASE;
function slamFloor(x, z, closed) {
  if (Math.abs(x) > FX + RAIL || Math.abs(z) > FZ + RAIL) return TABLE_Y;
  if (x >= 0) return closed ? LID_TOP : 0;
  return closed ? TABLE_Y : 0;
}

async function slam() {
  if (!canSlam()) return;
  sound.unlock();
  const my = gid;
  slamming = true; busy = true;
  clearMarks(); updateHud();
  const overlayWasUp = !$('overlay').classList.contains('hidden');
  $('overlay').classList.add('hidden');
  for (const p of railPlanes) p.visible = false;

  // the folding half: every board piece whose centre lies left of the hinge, on a pivot at the hinge
  const lid = new THREE.Group();
  lid.position.set(0, RAIL_H, 0);
  stage.add(lid); stage.updateMatrixWorld(true);
  const box = new THREE.Box3(), c = new THREE.Vector3(), moved = [];
  // the board's contact shadow follows the fold: f = 0 open, 1 shut (covers the right half only)
  const shadow = world.children.find((m) => m.userData.boardShadow);
  const fold = (f) => { if (shadow) { shadow.scale.x = 1 - 0.5 * f; shadow.position.x = f * (FX + RAIL) / 2; } };
  for (const m of [...world.children]) {
    if (railPlanes.includes(m) || m === shadow) continue;
    box.setFromObject(m); box.getCenter(c); stage.worldToLocal(c);
    if (c.x < -0.05) { lid.attach(m); moved.push(m); }
  }

  // everything that may fly is put back exactly as it was
  const snap = [...allCheckers, ...dice].map((o) => ({ o, p: o.position.clone(), q: o.quaternion.clone() }));
  for (const m of allCheckers) { m.userData.anim++; m.userData.ao.visible = false; }

  const bodies = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fling = (o, v, spin, off, inWorld) => bodies.push({
    o, v, off, inWorld, spin, axis: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), rest: false, flat: null,
  });
  const onBoard = new Set(stacks.flat());
  for (const m of allCheckers) {
    if (onBoard.has(m) && m.position.x < 0) fling(m, new THREE.Vector3(rnd(2, 34), rnd(30, 42), rnd(-9, 9)), rnd(6, 16), 0, false);
  }
  // dice lying on the folding half go flying with its checkers; the rest jump at the impact
  const flownDice = new Set();
  for (const d of dice) {
    const l = stage.worldToLocal(d.position.clone());
    if (l.x < 0 && Math.abs(l.x) <= FX + RAIL && Math.abs(l.z) <= FZ + RAIL) {
      flownDice.add(d);
      fling(d, new THREE.Vector3(rnd(-4, 18), rnd(28, 38), rnd(-8, 8)), rnd(8, 16), DS / 2, true);
    }
  }

  let closed = false;
  const qd = new THREE.Quaternion(), lp = new THREE.Vector3();
  const physics = (dt) => {
    for (const b of bodies) {
      const o = b.o;
      if (b.rest) { o.quaternion.slerp(b.flat, Math.min(1, dt * 10)); continue; }
      b.v.y -= 75 * dt;
      o.position.addScaledVector(b.v, dt);
      qd.setFromAxisAngle(b.axis, b.spin * dt); o.quaternion.premultiply(qd);
      lp.copy(o.position);
      if (b.inWorld) stage.worldToLocal(lp);
      const floor = slamFloor(lp.x, lp.z, closed) + b.off;
      if (o.position.y < floor) {
        o.position.y = floor;
        if (b.v.y < -4) sound.tok(Math.min(0.7, -b.v.y / 45), b.inWorld ? 1500 : 560);
        b.v.y = -b.v.y * 0.3; b.v.x *= 0.5; b.v.z *= 0.5; b.spin *= 0.45;
        if (b.v.y < 4) { // settles, lying flat (dice: on the face nearest to up)
          b.rest = true; b.v.set(0, 0, 0);
          const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ');
          const snapTo = (a) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
          b.flat = b.inWorld ? new THREE.Quaternion().setFromEuler(new THREE.Euler(snapTo(e.x), e.y, snapTo(e.z), 'YXZ'))
            : new THREE.Quaternion().setFromAxisAngle(UP, e.y);
        }
      }
    }
  };
  // physics runs in its own animation from the first lift until the board reopens
  let lastK = 0;
  const PHYS = 2.5;
  const physDone = animateFn(PHYS, (k) => { physics((k - lastK) * PHYS); lastK = k; });

  const aborted = () => my !== gid;
  const cleanup = () => {
    lid.rotation.set(0, 0, 0); lid.updateMatrixWorld(true); fold(0);
    for (const m of moved) world.attach(m);
    stage.remove(lid);
    for (const p of railPlanes) p.visible = showNumbers;
    for (const s of snap) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); }
    for (const m of allCheckers) { m.userData.anim = Math.max(0, m.userData.anim - 1); setRest(m, m.userData.rest); }
    shakeT = 0; slamming = false;
  };

  // 1. wind-up: the half lifts a little; 2. it swings over, accelerating, and slams shut
  sound.whoosh(0.5);
  await animateFn(0.2, (k) => { lid.rotation.z = -0.25 * (1 - (1 - k) * (1 - k)); });
  if (aborted()) return cleanup();
  await animateFn(0.3, (k) => { lid.rotation.z = -0.25 - (Math.PI - 0.25) * Math.pow(k, 2.4); fold(Math.pow(k, 2.4)); });
  if (aborted()) return cleanup();

  // 3. impact
  closed = true;
  sound.slam();
  if (!reducedMotion()) shakeT = SHAKE;
  toast('SLAM! 💥');
  for (const d of dice) if (!flownDice.has(d)) fling(d, new THREE.Vector3(rnd(-3, 3), rnd(12, 18), rnd(-3, 3)), rnd(8, 14), DS / 2, true);
  for (const m of allCheckers) if (!onBoard.has(m)) fling(m, new THREE.Vector3(rnd(-2, 2), rnd(6, 11), rnd(-2, 2)), rnd(2, 6), 0, false);
  await animateFn(0.2, (k) => { lid.rotation.z = -Math.PI + 0.07 * Math.sin(Math.PI * k); });
  if (aborted()) return cleanup();
  await physDone; // the board stays shut while everything settles
  if (aborted()) return cleanup();

  // 4. the board reopens; everything flies back along a high arc and lands where it was
  const from = snap.map((s) => ({ p: s.o.position.clone(), q: s.o.quaternion.clone() }));
  const BACK = 1.4;
  await animateFn(BACK, (k) => {
    const lk = Math.max(0, Math.min(1, (k * BACK - 0.15) / 0.8));
    lid.rotation.z = -Math.PI * (1 - easeInOut(lk));
    fold(1 - easeInOut(lk));
    const e = easeInOut(k);
    snap.forEach((s, i) => {
      if (from[i].p.equals(s.p)) return; // never moved (the right half's checkers stayed inside)
      s.o.position.lerpVectors(from[i].p, s.p, e);
      s.o.position.y += 14 * 4 * e * (1 - e);
      s.o.quaternion.slerpQuaternions(from[i].q, s.q, e);
    });
  });
  if (aborted()) return cleanup();
  sound.place();
  cleanup();
  busy = false;
  if (overlayWasUp && phase === 'over') $('overlay').classList.remove('hidden');
  updateHud(); refreshMarks();
  // an auto-end that fell inside the slam was skipped (busy): end the finished move now
  if (autoEnd && phase === 'human-move' && T && turnDone(T) && T.played.length && !makis) beginHumanStep();
}
$('slamBtn').onclick = slam;
$('ovSlam').onclick = slam;

async function hint() {
  if (puzzle) return; // a puzzle is solved without help
  if (busy || phase !== 'human-move' || !T || turnDone(T) || T.played.length) {
    if (T && T.played.length && !turnDone(T)) toast('Hints are available at the start of your move — undo first');
    return;
  }
  const my = gid;
  busy = true; updateHud();
  setStatus('Thinking about your move…');
  const steps = await think(g, HUMAN, curDice, 5);
  if (my !== gid) return;
  busy = false;
  if (!steps.length) { beginHumanStep(); return; }
  hintPath = steps.map((s) => ({ ...s, from: absOf(HUMAN, s.r), to: s.t ? absOf(HUMAN, s.t) : -1 }));
  beginHumanStep();
  select(hintPath[0].from);
  const n = steps.length;
  toast(`Suggested play: ${steps.map((s) => `${shown(s.r)}→${s.t ? shown(s.t) : 'off'}`).join(', ')}${n > 1 ? ' · first checker raised, its landing spot in green' : ''}`);
}

// ================================================================ Mr. Makis (level 10 coach)
// On the human's turn he plays the strongest move on the board as a demonstration and
// explains it from computed facts (engine.analyzeView); the human keeps it or takes it back.
let makis = null; // { n: steps he played, a: analysis } while his demonstration is on the board
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function makisReasons(a, best) {
  const b = a.base, f = best.facts, out = [];
  if (!b.passed && f.passed) out.push('Gets your first checker past the computer’s starting point — from now on your other checkers may leave the start.');
  const blocks = best.newPts.filter((p) => p.behind > 0).sort((x, y) => (y.near - x.near) || (y.behind - x.behind));
  for (const p of blocks.slice(0, 2)) {
    out.push(p.near
      ? `Takes your point ${shown(p.r)}: ${plural(p.near, 'computer checker')} ${p.near === 1 ? 'sits' : 'sit'} 1–6 pips behind it and can no longer land there.`
      : `Takes your point ${shown(p.r)} — a road block for the ${plural(p.behind, 'computer checker')} still to pass it.`);
  }
  if (f.wall.len >= 3 && f.wall.len > b.wall.len) {
    out.push(`Builds a ${f.wall.len}-point wall (your points ${shown(f.wall.from)}–${shown(f.wall.to)})${f.wall.len >= 6 ? ', six or more in a row that no checker behind it can jump' : ''}: checkers behind it struggle to get past.`);
  }
  if (!blocks.length && f.oppHemmed > b.oppHemmed + 1) out.push('Takes landing spots away from the computer’s checkers.');
  if (f.meHemmed < b.meHemmed - 1) out.push('Frees your own checkers: fewer of their landing spots are blocked.');
  if (f.stack < b.stack) out.push('Spreads out a heavy stack — piled-up checkers only ever block one point.');
  if (f.off > b.off) out.push(`Bears off ${plural(f.off - b.off, 'checker')}.`);
  const gave = best.vacated.filter((p) => p.near > 0);
  if (gave.length && out.length) out.push(`It does give up your point ${shown(gave[0].r)}, but what it gains is worth more.`);
  const lead = f.oppPips - f.myPips;
  const race = lead >= 0 ? `lead by ${lead}` : `trail by ${-lead}`;
  out.push(f.contact ? `Race count after the move: you ${race} pips.` : `The checkers have passed each other — it is a pure race now, and you ${race} pips.`);
  return out;
}

function makisWhyWorse(best, alt) {
  const B = best.facts, A = alt.facts, r = [];
  if (B.passed && !A.passed) r.push('leaves your first checker short of the computer’s start');
  if (alt.newPts.filter((p) => p.near).length < best.newPts.filter((p) => p.near).length) r.push('makes fewer blocks in front of the computer');
  if (A.wall.len < B.wall.len) r.push(`builds a shorter wall (${A.wall.len} vs ${B.wall.len})`);
  const gave = alt.vacated.filter((p) => p.near > 0);
  if (gave.length && !best.vacated.some((p) => p.r === gave[0].r)) r.push(`gives up your point ${shown(gave[0].r)}`);
  if (A.meHemmed > B.meHemmed + 1) r.push('leaves your checkers more hemmed in');
  if (A.oppHemmed < B.oppHemmed - 1) r.push('lets the computer move more freely');
  if (A.stack > B.stack) r.push('piles checkers onto one point');
  return r.length ? r.slice(0, 2).join(' and ') : 'a slightly weaker position overall';
}

// " (17/20 instead of 3/6)": what an alternative does differently from his move
function stepDiff(bestSteps, altSteps) {
  const key = (s) => stepsText([s]);
  const bLeft = bestSteps.map(key), aOnly = [];
  for (const k of altSteps.map(key)) { const i = bLeft.indexOf(k); if (i >= 0) bLeft.splice(i, 1); else aOnly.push(k); }
  return aOnly.length && bLeft.length && aOnly.length < altSteps.length ? ` (${aOnly.join(' ')} instead of ${bLeft.join(' ')})` : '';
}

function renderMakis(a, diceText) {
  const best = a.cands[0];
  let h = `<p class="mk-move">He plays <b>${stepsText(best.steps)}</b> with ${diceText}.</p>`;
  if (a.legal === 1) {
    h += `<p>That is the only legal play here — no choice to make.</p>`;
  } else {
    h += `<div class="mk-h">Why</div><ul>${makisReasons(a, best).map((s) => `<li>${s}</li>`).join('')}</ul>`;
    h += `<div class="mk-h">The numbers</div><p>From here he wins <b>${Math.round(best.win * 100)}%</b> of ${a.rollouts} play-outs (average ${best.eq >= 0 ? '+' : ''}${best.eq.toFixed(2)} points a game).</p>`;
    const alts = a.cands.slice(1, 3);
    if (alts.length) {
      h += `<div class="mk-h">What else he considered</div><ul>${alts.map((c) => `<li><b>${stepsText(c.steps)}</b>${stepDiff(best.steps, c.steps)} — wins ${Math.round(c.win * 100)}%: ${makisWhyWorse(best, c)}.</li>`).join('')}</ul>`;
    }
    h += `<p class="mk-foot">Level 10: he scored all ${a.legal} legal plays two rolls deep, then played the best ${a.cands.length} to the end of the game ${a.rollouts} times each with the same dice.</p>`;
  }
  $('makisBody').innerHTML = h;
  $('makis').hidden = false;
}

function closeMakis() { makis = null; $('makis').hidden = true; }

async function makisDemo() {
  if (busy || phase !== 'human-move' || !T || turnDone(T) || makis || puzzle) return;
  const my = gid;
  busy = true; selected = -1; hintPath = null; clearMarks(); updateHud();
  setStatus('Mr. Makis is studying the position<span class="dots"></span>');
  const view = { mine: Int8Array.from(T.v.mine), opp: Int8Array.from(T.v.opp), myOff: T.v.myOff, oppOff: T.v.oppOff };
  const remBefore = T.rem.slice();
  const a = await askMakis(view, remBefore, T.mustOpen);
  if (my !== gid || phase !== 'human-move') return;
  busy = false;
  if (!a.cands.length) { beginHumanStep(); return; }
  const best = a.cands[0];
  makis = { n: best.steps.length, a };
  const diceText = remBefore.length === 4 ? `double ${remBefore[0]}s` : remBefore.join('–');
  await playPath(best.steps.map((s) => ({ ...s, from: absOf(HUMAN, s.r), to: s.t ? absOf(HUMAN, s.t) : -1 })));
  if (my !== gid || !makis) return;
  renderMakis(a, diceText);
  setStatus('Mr. Makis has shown his move — <b>keep it</b> or <b>take it back</b>');
  updateHud();
}

async function makisTakeBack() {
  if (!makis || busy) return;
  const n = makis.n;
  closeMakis();
  for (let i = 0; i < n; i++) await undo();
}

$('makisBtn').onclick = makisDemo;
$('makisKeep').onclick = () => { closeMakis(); beginHumanStep(); };
$('makisBack').onclick = makisTakeBack;
$('makisClose').onclick = () => { closeMakis(); beginHumanStep(); };

let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

// ================================================================ input
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function setRay(ev) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
}
// the point (0..23, -1 = bear off) under the pointer; `skip` = a checker being carried
function pickPoint(ev, skip = null) {
  setRay(ev);
  const h = ray.intersectObjects([...checkerGroup.children, ...hitMeshes], false).find((x) => x.object !== skip);
  if (!h) return null;
  if (h.object.userData.point !== undefined) return h.object.userData.point;
  return pointOfChecker(h.object);
}
function pointOfChecker(mesh) {
  for (let a = 0; a < 24; a++) if (stacks[a].includes(mesh)) return a;
  if (offStacks[HUMAN].includes(mesh)) return -1;
  return null;
}
let down = null, hoverPt = null;
// Drag to move (finger or mouse; Manos 2026-10-03): press a glowing checker, slide it, and it goes
// where the finger leaves the screen if that is a legal landing spot (one die or several);
// anywhere else it glides back and stays picked up. A press that moves less than DRAG_PX is
// still a tap, so tap-checker-then-tap-point works as before. While a checker is carried the
// free camera does not turn.
let drag = null; // { a, id, active, mesh }
const DRAG_PX = 10;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -3.2); // carried just above the stacks
const dragHit = new THREE.Vector3();
function endDragControls() { controls.enabled = true; canvas.style.cursor = ''; }
function markHover(a) { // the landing spot under the finger grows a little
  for (const to of dests.keys()) (to === -1 ? offDest : destMeshes[to]).scale.setScalar(to === a ? 1.45 : 1);
}
function returnCarried(d) {
  const m = d.mesh, from = m.position.clone();
  const to = m.userData.rest.clone();
  m.userData.lift = selected === d.a ? 1.9 : 0;
  to.y += m.userData.lift;
  animateFn(0.2, (k) => m.position.lerpVectors(from, to, easeInOut(k))).then(() => { m.userData.anim--; });
}
function dropCarried(d, e) {
  const a = pickPoint(e, d.mesh);
  hoverPt = null; markHover(null);
  if (a !== null && a !== d.a && dests.has(a) && phase === 'human-move' && !busy && selected === d.a) {
    d.mesh.userData.anim--; // moveChecker takes over from where the finger let go
    playPath(dests.get(a));
    return;
  }
  if (a !== null && a !== d.a) sound.nope();
  returnCarried(d); // keeps its anim count until it is back
}
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY }; sound.unlock();
  drag = null;
  if (phase !== 'human-move' || busy || !T || turnDone(T)) return;
  const a = pickPoint(e);
  if (a === null || a < 0 || !legalSources().has(a)) return;
  drag = { a, id: e.pointerId, active: false, mesh: null };
  controls.enabled = false; // this press may carry a checker: the board must not turn under it
});
canvas.addEventListener('pointercancel', () => {
  const d = drag; drag = null; down = null; endDragControls();
  if (d && d.active) { hoverPt = null; markHover(null); returnCarried(d); }
});
canvas.addEventListener('pointerup', (e) => {
  if (drag) {
    const d = drag; drag = null; endDragControls();
    if (d.active) { down = null; dropCarried(d, e); return; }
  }
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
  if (moved > (freeCam ? 6 : 16)) return; // locked camera: forgive a shaky click
  if (phase === 'opening' || phase === 'human-roll') { roll(); return; }
  if (phase !== 'human-move' || busy) return;
  if (turnDone(T)) return;
  const a = pickPoint(e);
  if (a === null) { select(-1); return; }
  if (selected >= 0 && dests.has(a)) { playPath(dests.get(a)); return; }
  if (a >= 0 && legalSources().has(a)) { select(a === selected ? -1 : a); return; }
  if (a >= 0 && stacks[a].length && stacks[a][0].userData.p === HUMAN) { sound.nope(); toast(blockedReason(a)); }
  select(-1);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id) {
    if (!drag.active) {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_PX) return;
      const st = stacks[drag.a];
      if (busy || phase !== 'human-move' || !st.length) { drag = null; endDragControls(); return; }
      if (selected !== drag.a) select(drag.a);
      drag.mesh = st[st.length - 1];
      drag.mesh.userData.anim++; // the per-frame lift leaves it alone while carried
      drag.mesh.userData.ao.visible = false;
      drag.active = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not supported: moves still arrive */ }
    }
    setRay(e);
    if (ray.ray.intersectPlane(dragPlane, dragHit)) {
      stage.worldToLocal(dragHit); // playing black turns the stage
      dragHit.x = THREE.MathUtils.clamp(dragHit.x, -OFF_X - 3, OFF_X + 3);
      dragHit.z = THREE.MathUtils.clamp(dragHit.z, -FZ - RAIL - 4, FZ + RAIL + 4);
      drag.mesh.position.copy(dragHit);
    }
    hoverPt = pickPoint(e, drag.mesh);
    markHover(dests.has(hoverPt) ? hoverPt : null);
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.buttons || phase !== 'human-move' || busy) { canvas.style.cursor = ''; hoverPt = null; return; }
  const a = pickPoint(e);
  hoverPt = a;
  const clickable = a !== null && ((selected >= 0 && dests.has(a)) || (a >= 0 && legalSources().has(a)));
  canvas.style.cursor = clickable ? 'pointer' : '';
});

function blockedReason(a) {
  const r = humanPoint(a);
  const passedStart = (() => { for (let q = 1; q <= 11; q++) if (T.v.mine[q]) return true; return T.v.myOff > 0; })();
  if (!passedStart && r === 24 && T.v.mine.slice(12, 24).some((x) => x > 0)) return 'Your first checker must pass the computer\'s starting point before another may leave';
  const quarterOpen = [19, 20, 21, 22, 23, 24].filter((q) => !T.v.mine[q]);
  if (r >= 20 && quarterOpen.length === 1 && T.rem.some((d) => r - d === quarterOpen[0]))
    return 'You may not end your move holding all six points of your starting quarter (1–6)';
  if (T.mustOpen) return `${mustOpenText(T)} — that checker cannot help with these dice`;
  return 'That checker has no legal move with these dice';
}

// Unblocking rule, in the player's words: "your points 3, 4, 5, 6, 7, 8" (shown numbering).
function mustOpenText(T) {
  const pts = [1, 2, 3, 4, 5, 6].map((k) => shown(S(T.mustOpen - k))).sort((a, b) => a - b);
  return `Every computer checker is stuck right behind your six in a row (${pts.join(', ')}): this move must open one of those points`;
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (!$('games').classList.contains('hidden')) { if (e.key === 'Escape') { editing = null; $('games').classList.add('hidden'); } return; }
  if (!$('settings').classList.contains('hidden') && e.key !== 'Escape') return; // no game keys behind the sheet
  if (phase === 'replay') {
    if (e.key === 'ArrowRight') replayStep();
    else if (e.key === 'ArrowLeft') replayJump(replay.idx - 1);
    else if (e.key === 'Home') replayJump(0);
    else if (e.key === 'End') replayJump(replay.rec.turns.length);
    else if (e.key === ' ') { e.preventDefault(); replayPlay(); }
    else if (e.key === 'Escape') exitReplay();
    else if (e.key === '[') setLight(lightLevel - 0.1);
    else if (e.key === ']') setLight(lightLevel + 0.1);
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (phase === 'opening' || phase === 'human-roll') roll();
    else if (phase === 'human-move' && T && turnDone(T)) done();
  } else if (e.key === 'u' || e.key === 'U' || e.key === 'Backspace') undo();
  else if (e.key === 'h' || e.key === 'H') hint();
  else if (e.key === 'm' || e.key === 'M') makisDemo();
  else if (e.key === 'c' || e.key === 'C') homeView();
  else if (e.key === 'v' || e.key === 'V') setFreeCam(!freeCam);
  else if (e.key === 's' || e.key === 'S') slam();
  else if (e.key === 'l' || e.key === 'L') setLamp(!lampOn);
  else if (e.key === '[') setLight(lightLevel - 0.1);
  else if (e.key === ']') setLight(lightLevel + 0.1);
  else if (e.key === 'Escape' && puzzle && $('rules').classList.contains('hidden') && $('settings').classList.contains('hidden')) exitPuzzle();
  else if (e.key === 'Escape') { select(-1); $('rules').classList.add('hidden'); $('settings').classList.add('hidden'); }
});

$('rollBtn').onclick = roll;
$('doneBtn').onclick = done;
$('undoBtn').onclick = undo;
$('hintBtn').onclick = hint;
$('newBtn').onclick = () => { startGame(); };
// Phones: colour and the brand buttons live in a ☰ dropdown (CSS shows it only there). It drops
// over the scoreboard and closes after any choice, an outside tap or Esc.
function setMenu(open) {
  $('brand').classList.toggle('open', open);
  $('menuBtn').setAttribute('aria-expanded', String(open));
}
$('menuBtn').onclick = () => setMenu(!$('brand').classList.contains('open'));
$('brandMenu').addEventListener('click', (e) => { if (e.target.closest('button')) setMenu(false); });
document.addEventListener('pointerdown', (e) => { if (!$('brand').contains(e.target)) setMenu(false); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
for (const b of document.querySelectorAll('#seat button')) {
  b.onclick = () => {
    const c = +b.dataset.color;
    if (c === seatColor) return;
    seatColor = c; store.save();
    startGame();
    toast(`New game — you play ${c === 0 ? 'white (ivory)' : 'black'}`);
  };
}
$('ovNew').onclick = () => {
  if (matchOn && Math.max(...matchScore) >= MATCH_TO) { matchScore = [0, 0]; store.save(); } // the match is over: start a new one
  startGame();
};
$('rulesBtn').onclick = () => $('rules').classList.remove('hidden');
$('closeRules').onclick = () => $('rules').classList.add('hidden');
// Strategy guide: its own page in a new tab so the game in progress stays put (its Back button closes the tab).
// In the Android app it is a full-screen sheet over the game instead (no tabs there); its Back
// link posts 'fevga:close-strategy', and the phone's back button closes it via a history entry.
function openStrategy() {
  if (!IS_APP) { if (!window.open('strategy.html', 'fevga-strategy')) location.href = 'strategy.html'; return; }
  const f = $('stratFrame');
  if (!f.getAttribute('src')) f.setAttribute('src', 'strategy.html');
  $('stratSheet').hidden = false;
  history.pushState({ strategy: true }, '');
}
function closeStrategy(fromBack) {
  if ($('stratSheet').hidden) return;
  $('stratSheet').hidden = true;
  if (!fromBack && history.state && history.state.strategy) history.back();
}
window.addEventListener('message', (e) => { if (e.data === 'fevga:close-strategy' && e.origin === location.origin) closeStrategy(false); });
window.addEventListener('popstate', () => closeStrategy(true));
$('strategyBtn').onclick = openStrategy;
$('rulesStrategy').onclick = openStrategy;
$('resetScore').onclick = () => {
  score = [0, 0];
  if (matchOn) matchScore = [0, 0];
  store.save(); updateHud(); toast(matchOn ? 'Match score reset to 0–0' : 'Score reset');
};
$('muteBtn').onclick = () => { sound.setMuted(!sound.muted); $('muteBtn').textContent = sound.muted ? '🔇' : '🔊'; store.save(); };
$('muteBtn').textContent = sound.muted ? '🔇' : '🔊';
function setLight(f, save = true) {
  lightLevel = Math.round(Math.min(1.6, Math.max(0.25, f)) * 100) / 100;
  applyLighting(lightLevel);
  $('dimmer').value = Math.round(lightLevel * 100);
  $('dimmerVal').textContent = `${Math.round(lightLevel * 100)}%`;
  if (save) store.save();
}
$('dimmer').oninput = (e) => setLight(e.target.value / 100);
setLight(lightLevel, false);
const sel = $('levelSel');
LEVELS.forEach((L) => {
  const o = document.createElement('option');
  o.value = L.level; o.textContent = `${L.level} · ${L.name}`;
  sel.appendChild(o);
});
sel.value = level;
sel.onchange = () => {
  level = parseInt(sel.value, 10); store.save(); updateHud();
  toast(`Computer: ${LEVELS[level - 1].name} — ${LEVELS[level - 1].blurb}`);
  sel.blur();
};

// ================================================================ replay viewer
const replayPosition = (rec, n) => {
  const r = newGame();
  for (let i = 0; i < n; i++) applySteps(r, rec.turns[i].p, rec.turns[i].steps);
  return r;
};
// dice resting where `side` throws them, showing `d` (no animation)
function placeDice(d, side) {
  const sx = side === HUMAN ? 1 : -1;
  dice.forEach((m, i) => {
    m.position.set(sx * (BAR / 2 + HALF / 2 + (i - 0.5) * 3.4 * DSP), DS / 2, 0);
    m.quaternion.copy(faceUpQuat(d[i])); dimDie(i, false);
  });
}
function restDice() {
  dice.forEach((m, i) => { m.position.set(OFF_X - 1 + i * 2.2 * DSP, TABLE_Y + DS / 2, -12); m.quaternion.copy(faceUpQuat(i ? 5 : 6)); dimDie(i, false); });
}

function enterReplay(rec) {
  if (busy || phase === 'cpu' || phase === 'loading') { toast('Wait for the computer to finish its move, then try again'); return; }
  if (replay) exitReplay();
  if (puzzle) exitPuzzle(); // give the live game back first, so replay borrows the real one
  $('games').classList.add('hidden');
  closeMakis();
  gid++;            // aborts any pending live timers (auto-end, opening pause); state is restored on exit
  flushAnims();
  replay = { rec, idx: 0, pos: newGame(), playing: false, busy: false, live: snapshotLive() };
  phase = 'replay'; selected = -1; hintPath = null; clearMarks();
  applySeat(rec.human);
  $('bar').hidden = true; $('replayBar').hidden = false; $('overlay').classList.add('hidden');
  $('replayTitle').textContent = rec.name || `${fmtDate(rec.date)} · vs ${LEVELS[(rec.level || 3) - 1].name}`;
  $('replaySlider').max = rec.turns.length;
  replayJump(0);
}

function replayJump(n) {
  if (!replay || replay.busy) return;
  const rec = replay.rec;
  n = Math.max(0, Math.min(rec.turns.length, n));
  replay.idx = n; replay.whatIf = false;
  replay.pos = replayPosition(rec, n);
  layoutCheckers(replay.pos, false);
  if (n > 0) placeDice(rec.turns[n - 1].dice, rec.turns[n - 1].p); else restDice();
  updateReplayUi();
}

async function replayStep() {
  if (!replay || replay.busy || replay.idx >= replay.rec.turns.length) return;
  const R = replay, turn = R.rec.turns[R.idx];
  if (R.whatIf) { R.whatIf = false; layoutCheckers(R.pos, false); } // a review what-if is on the board: put the record back
  R.busy = true; updateReplayUi();
  sound.shake();
  await Promise.all([throwDie(0, turn.dice[0], turn.p, 0), throwDie(1, turn.dice[1], turn.p, 1, 0.06)]);
  for (const s of turn.steps) {
    if (replay !== R) return;
    await moveChecker(turn.p, absOf(turn.p, s.r), s.t ? absOf(turn.p, s.t) : -1);
    await wait(0.06);
  }
  if (replay !== R) return;
  applySteps(R.pos, turn.p, turn.steps);
  R.idx++; R.busy = false;
  updateReplayUi();
}

async function replayPlay() {
  if (!replay) return;
  const R = replay;
  R.playing = !R.playing;
  if (R.playing && R.idx >= R.rec.turns.length) replayJump(0);
  updateReplayUi();
  while (replay === R && R.playing && R.idx < R.rec.turns.length) {
    await replayStep();
    if (replay !== R || !R.playing) break;
    await wait(0.7);
  }
  if (replay === R) { R.playing = false; updateReplayUi(); }
}

function describeTurn(rec, i) {
  const t = rec.turns[i];
  const who = t.p === rec.human ? (rec.imported ? 'Player' : 'You') : 'Computer';
  return `${who} ${t.dice[0]}–${t.dice[1]}: ${stepsText(t.steps)}`;
}

// Round counter (Settings > Display). Round n = each side's n-th turn, so "Round 10" is the moment
// the strategy guide's "after ten turns" figures describe. Live: the round in progress (the one
// the game ended in, at game over). Replay: the round of the last move shown.
function updateRound() {
  const el = $('round');
  if (el.hidden !== !showRound) { el.hidden = !showRound; positionHud(); }
  if (!showRound) return;
  let n, sub;
  if (puzzle) {
    n = puzzle.q.round; sub = `puzzle ${puzzle.q.id}`;
  } else if (replay) {
    const k = replay.idx, N = replay.rec.turns.length;
    n = Math.max(1, Math.ceil(k / 2));
    sub = `replay · move ${k} of ${N}`;
  } else {
    const k = record ? record.turns.length : 0;
    n = phase === 'over' ? Math.max(1, Math.ceil(k / 2)) : Math.floor(k / 2) + 1;
    sub = phase === 'over' ? 'game over' : phase === 'cpu' ? "computer's turn" : phase === 'opening' ? 'opening throw' : 'your turn';
  }
  $('roundNum').textContent = n;
  $('roundSub').textContent = sub;
}

function updateReplayUi() {
  if (!replay) return;
  updateRound();
  const { rec, idx, busy: b, playing } = replay, N = rec.turns.length;
  $('replayTurn').textContent = `Turn ${idx} / ${N}`;
  let msg;
  if (idx === 0) msg = rec.opening ? `Start · opening throw: ${rec.imported ? 'player' : 'you'} ${rec.opening[0]}, computer ${rec.opening[1]}` : 'Start position';
  else msg = describeTurn(rec, idx - 1);
  if (idx === N) msg += ` · end: ${resultText(rec)}`;
  $('replayMove').textContent = msg;
  $('replaySlider').value = idx;
  $('rpStart').disabled = $('rpPrev').disabled = b || idx === 0;
  $('rpNext').disabled = $('rpEnd').disabled = b || idx === N;
  $('rpPlay').textContent = playing ? '❚❚ Pause' : '▶ Play';
  $('replaySlider').disabled = b;
  replay.confirmContinue = false; // moving through the game cancels a pending "replace?" question
  const cont = continueState();
  $('rpContinue').disabled = b || !cont.ok;
  $('rpContinue').textContent = 'Continue from here';
  $('rpContinue').title = cont.ok ? 'Play on from the position shown' : cont.why;
  updateHud();
}

// Can the position shown in the replay become a live game? Not before the first move, and not once
// somebody has won (nothing left to play).
function continueState() {
  const { rec, idx, pos } = replay;
  if (idx === 0) return { ok: false, why: 'Step past the first move to continue from a position' };
  if (winner(pos) || (idx === rec.turns.length && rec.resigned)) return { ok: false, why: 'This game is over — there is nothing left to play' };
  return { ok: true };
}

// Replay -> live: play on from the position shown. You keep the colour you had in that game, the
// computer plays the other side (and moves first if it was its turn), and the moves up to here become
// the start of a new game record. The game you had in progress is replaced, so that asks first.
function continueFromHere() {
  const R = replay;
  if (!R || R.busy || phase !== 'replay' || !continueState().ok) return;
  const inProgress = !!record && record.turns.length > 0 && R.live.phase !== 'over';
  if (inProgress && !R.confirmContinue) {
    R.confirmContinue = true;
    $('rpContinue').textContent = 'Replace my current game?';
    $('rpContinue').title = 'Click again to replace the game you were playing (it stays in Recent games until pushed out)';
    return;
  }
  const rec = R.rec, n = R.idx;
  const turns = rec.turns.slice(0, n).map((t) => ({ p: t.p, dice: t.dice.slice(), steps: t.steps.map(({ r, t: to, d }) => ({ r, t: to, d })) }));
  const next = 1 - turns[n - 1].p; // sides alternate; passes are recorded
  gid++; flushAnims();
  closeReplayUi(); closeMakis();
  busy = false; T = null; curDice = null; turnStart = null; selected = -1; legal = []; dests = new Map(); hintPath = null;
  seatColor = rec.human === 1 ? 1 : 0; store.save();
  applySeat(seatColor);
  record = { id: newId(), date: Date.now(), level, human: HUMAN, opening: rec.opening ? rec.opening.slice() : null, openingPlay: !!rec.openingPlay, turns, result: null };
  g = replayPosition(rec, n);
  layoutCheckers(g, false);
  restDice();
  $('overlay').classList.add('hidden');
  clearMarks();
  toast(`Playing on from move ${n} — you are ${HUMAN === 0 ? 'white' : 'black'}, the computer is ${LEVELS[level - 1].name}`);
  if (next === HUMAN) {
    phase = 'human-roll';
    sound.turn();
    setStatus('Your turn — <b>roll the dice</b>');
    updateHud();
  } else {
    phase = 'cpu';
    updateHud();
    cpuTurn();
  }
}

function closeReplayUi() {
  if (replay) replay.playing = false;
  replay = null;
  reviewRun++; $('review').hidden = true; // a review belongs to its replay
  $('replayBar').hidden = true; $('bar').hidden = false;
}

// The live game, mid-move included, so replay and puzzles can borrow the board and give it back.
function snapshotLive() {
  return { g: cloneGame(g), phase, curDice: curDice && curDice.slice(), turnStart: turnStart && cloneGame(turnStart),
    played: T && phase === 'human-move' ? T.played.slice() : null, status: $('status').innerHTML };
}

// Leaves the replay and puts the live game back exactly as it was, mid-move included.
function exitReplay() {
  if (!replay) return;
  const L = replay.live;
  gid++; flushAnims();
  closeReplayUi();
  restoreLive(L);
}
function restoreLive(L) {
  applySeat(seatColor);
  g = L.g; phase = L.phase; curDice = L.curDice; turnStart = L.turnStart; T = null; busy = false;
  if (phase === 'human-move' && L.played && turnStart) {
    T = createTurn(turnStart, HUMAN, curDice);
    for (const s of L.played) turnPlay(T, s);
    const shown = cloneGame(g);
    shown.pos[HUMAN] = Int8Array.from(T.v.mine); shown.off[HUMAN] = T.v.myOff;
    layoutCheckers(shown, false);
    placeDice(curDice, HUMAN);
    beginHumanStep();
  } else {
    layoutCheckers(g, false);
    restDice();
    setStatus(L.status);
    updateHud();
  }
}

// ================================================================ mistake review
// Mr. Makis reviews a recorded game for the human's costliest plays. Stage 1 screens every turn
// with a choice two-ply (engine.screenTurns, ~1 s a game); stage 2 plays the worst REVIEW.check
// of them out REVIEW.rollouts times against his best two plays with the same dice
// (engine.reviewTurn, ~2 s each); the REVIEW.show that cost most are listed, each one click from
// the position in replay. Two-ply alone misjudged some plays in testing (a "0.10 worse" move lost
// 17 points of win chance in play-outs), so the ranking is always by play-outs. The result is
// kept on the stored record (rec.review), so a second look is instant.
const REVIEW = { check: 6, rollouts: 120, top: 2, show: 3, minScreen: 0.25, minWin: 0.03 };
let reviewRun = 0; // bumps to abandon a review in progress (exit replay, a new one)

const findStored = (id) => gamesDb.recent.find((r) => r.id === id) || gamesDb.saved.find((r) => r.id === id);
const roundOf = (i) => Math.floor(i / 2) + 1;
const pct = (x) => `${Math.round(x * 100)}%`;

// On phones the panel sits above the replay bar, whose height depends on how its title wraps.
function placeReview() {
  const el = $('review');
  el.style.bottom = '';
  if (el.hidden || window.innerWidth > 700 || $('replayBar').hidden) return;
  el.style.bottom = `${Math.round(window.innerHeight - $('replayBar').getBoundingClientRect().top + 8)}px`;
}
window.addEventListener('resize', placeReview);

async function startReview(rec) {
  if (!replay || replay.rec !== rec) return;
  const run = ++reviewRun;
  $('review').hidden = false;
  placeReview();
  if (rec.review && rec.review.v === 1) { renderReview(rec); return; }
  const side = rec.human;
  const body = (h) => { if (run === reviewRun) $('reviewBody').innerHTML = h; };
  body(`<p>Mr. Makis is going through the game<span class="dots"></span></p><p class="mk-foot">Scoring every move with a choice, two rolls deep…</p>`);
  const screened = await askReview('screen', { turns: rec.turns, side });
  if (run !== reviewRun) return;
  const worst = screened.filter((x) => x.loss >= REVIEW.minScreen).sort((a, b) => b.loss - a.loss).slice(0, REVIEW.check);
  const found = [];
  for (let k = 0; k < worst.length; k++) {
    body(`<p>Mr. Makis is going through the game<span class="dots"></span></p>
      <p class="mk-foot">${screened.length} moves had a choice. Playing out the ${worst.length} most doubtful ones to the end — ${k + 1} of ${worst.length}…</p>`);
    const r = await askReview('review', { turns: rec.turns, i: worst[k].i, opts: { rollouts: REVIEW.rollouts, top: REVIEW.top, seed: 1 } });
    if (run !== reviewRun) return;
    if (r.best.win - r.played.win >= REVIEW.minWin && r.best.eq > r.played.eq) found.push(r);
  }
  // ranked by the number each card shows (win chance lost); points lost (mars risk) breaks ties
  found.sort((a, b) => ((b.best.win - b.played.win) - (a.best.win - a.played.win)) || ((b.best.eq - b.played.eq) - (a.best.eq - a.played.eq)));
  rec.review = {
    v: 1, at: Date.now(), checked: screened.length, played: worst.length, rollouts: REVIEW.rollouts,
    mistakes: found.slice(0, REVIEW.show).map((r) => ({
      i: r.i, dice: r.dice, played: r.played.steps, best: r.best.steps,
      winPlayed: r.played.win, winBest: r.best.win, eqPlayed: r.played.eq, eqBest: r.best.eq,
      why: makisWhyWorse(r.best, r.played),
      plus: makisReasons({ base: r.base }, r.best).find((s) => !/^Race count|^The checkers have passed/.test(s)) || '',
    })),
  };
  storeGames(gamesDb);
  if (run === reviewRun) renderReview(rec);
}

function renderReview(rec) {
  const R = rec.review, who = rec.imported ? 'The player' : 'You', your = rec.imported ? 'The player’s' : 'Your';
  let h;
  if (!R.mistakes.length) {
    h = `<p class="mk-move">No clear mistakes.</p><p>Every move ${who === 'You' ? 'you' : 'the player'} made was within ${pct(REVIEW.minWin)} win chance of Mr. Makis's best — well played.</p>`;
  } else {
    h = `<p>${R.mistakes.length === 1 ? 'The move' : `The ${R.mistakes.length} moves`} that cost most:</p>`;
    R.mistakes.forEach((m, k) => {
      const lost = m.winBest - m.winPlayed, dice = m.dice[0] === m.dice[1] ? `double ${m.dice[0]}s` : `${m.dice[0]}–${m.dice[1]}`;
      h += `<div class="rv-card" data-k="${k}">
        <div class="rv-top"><b>Round ${roundOf(m.i)}</b> · ${dice}<span class="rv-loss">−${Math.round(lost * 100)}% win chance</span></div>
        <div>${who} played <b>${stepsText(m.played)}</b> → wins ${pct(m.winPlayed)}</div>
        <div>Mr. Makis: <b>${stepsText(m.best)}</b> → wins ${pct(m.winBest)}</div>
        <div class="rv-why">${your} move ${m.why}.${m.plus ? ` His: ${m.plus.charAt(0).toLowerCase()}${m.plus.slice(1)}` : ''}</div>
        <div class="rv-btns"><button data-act="pos">Position</button><button data-act="mine">${rec.imported ? 'Their' : 'Your'} move</button><button data-act="best" class="primary">His move</button></div>
      </div>`;
    });
  }
  h += `<p class="mk-foot">${R.checked} moves had a choice; he scored them all two rolls deep and played the ${R.played} most doubtful to the end ${R.rollouts} times each with the same dice. Win chances are estimates (about ±5%).</p>`;
  $('reviewBody').innerHTML = h;
}

// Position before mistake k, with that turn's dice on the table.
function reviewShow(k) {
  const m = replay && replay.rec.review && replay.rec.review.mistakes[k];
  if (!m || replay.busy) return null;
  replay.playing = false;
  replayJump(m.i);
  const t = replay.rec.turns[m.i];
  placeDice(t.dice, t.p);
  $('replayMove').textContent = `Round ${roundOf(m.i)} · ${t.dice[0]}–${t.dice[1]} to play`;
  return m;
}
async function reviewPlay(k, which) {
  const m = reviewShow(k);
  if (!m) return;
  if (which === 'mine') { await replayStep(); return; }
  // Mr. Makis's move: a what-if on the replay board; any replay control puts the record back
  const R = replay, t = R.rec.turns[m.i];
  R.busy = true; updateReplayUi();
  $('replayMove').textContent = `What if: Mr. Makis plays ${stepsText(m.best)}`;
  for (const s of m.best) {
    if (replay !== R) return;
    await moveChecker(t.p, absOf(t.p, s.r), s.t ? absOf(t.p, s.t) : -1);
    await wait(0.06);
  }
  if (replay !== R) return;
  R.busy = false; R.whatIf = true; updateReplayUi();
  $('replayMove').textContent = `What if: Mr. Makis plays ${stepsText(m.best)} (wins ${pct(m.winBest)} instead of ${pct(m.winPlayed)})`;
}
function closeReview() { reviewRun++; $('review').hidden = true; }

$('reviewBody').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'), card = e.target.closest('.rv-card');
  if (!b || !card) return;
  const k = +card.dataset.k;
  // phones: the panel covers the board, so step aside (Mistakes reopens it instantly from the cache)
  if (window.innerWidth <= 700) $('review').hidden = true;
  if (b.dataset.act === 'pos') reviewShow(k);
  else reviewPlay(k, b.dataset.act);
});
$('reviewClose').onclick = closeReview;
$('rpReview').onclick = () => { if (!replay) return; if ($('review').hidden) startReview(replay.rec); else closeReview(); };
// game-over card: open the finished game in replay with the review running
$('ovReview').onclick = () => {
  const rec = record && findStored(record.id);
  if (!rec) return;
  enterReplay(rec);
  startReview(rec);
};

// ================================================================ puzzles
// "Find the best move" positions from src/puzzles.js (generated by test/make-puzzles.mjs: every
// answer confirmed by Mr. Makis's play-outs to beat the best wrong move by >= 10 points of win
// chance; moves within 3 points of his are all accepted). The live game is borrowed like replay
// borrows it: snapshotLive() on the way in, restoreLive() on the way out. During a puzzle the
// normal turn machinery runs (phase 'human-move', T, undo), Done checks the answer instead of
// ending a turn, and phase 'puzzle' freezes the board between attempts.
const TIERS = {
  1: { name: 'Easy', note: 'The Intermediate computer already finds these.' },
  2: { name: 'Medium', note: 'Only the Advanced computer finds these.' },
  3: { name: 'Hard', note: 'Only the Expert, looking two rolls ahead, finds these.' },
  4: { name: 'Master', note: 'Every computer level misses these; only Mr. Makis\'s play-outs show the answer.' },
};
const PZ_KEY = 'fevga.puzzles.v1';
let pzProgress = (() => { try { const p = JSON.parse(localStorage.getItem(PZ_KEY)); return p && typeof p === 'object' ? p : {}; } catch { return {}; } })();
const savePz = () => { try { localStorage.setItem(PZ_KEY, JSON.stringify(pzProgress)); } catch { /* private mode */ } };
let puzzle = null; // { q, live, tries }

// the puzzle's position with the human's seat on the side to move (its view is in its own numbering)
function puzzleGame(q) {
  const mine = Int8Array.from(q.mine), opp = Int8Array.from(q.opp);
  return { pos: HUMAN === 0 ? [mine, opp] : [opp, mine], off: HUMAN === 0 ? [q.myOff, q.oppOff] : [q.oppOff, q.myOff] };
}
const pzView = (q) => ({ mine: Int8Array.from(q.mine), opp: Int8Array.from(q.opp), myOff: q.myOff, oppOff: q.oppOff });
const pzPath = (steps) => steps.map((s) => ({ ...s, from: absOf(HUMAN, s.r), to: s.t ? absOf(HUMAN, s.t) : -1 }));
const diceWords = (d) => (d[0] === d[1] ? `double ${d[0]}s` : `${d[0]}–${d[1]}`);

function enterPuzzle(q) {
  if (!puzzle && (busy || phase === 'cpu' || phase === 'loading')) { toast('Wait for the computer to finish its move, then try again'); return; }
  if (replay) exitReplay();
  $('puzzles').classList.add('hidden'); $('games').classList.add('hidden');
  closeMakis();
  const live = puzzle ? puzzle.live : snapshotLive();
  gid++; flushAnims();
  puzzle = { q, live, tries: 0 };
  $('puzzle').hidden = false;
  $('pzTitle').textContent = `Puzzle ${q.id}`;
  $('pzSub').textContent = `${TIERS[q.tier].name} · ${q.theme}`;
  puzzleStart(true);
}

// (Re)sets the puzzle position and hands the move to the player.
function puzzleStart(drop) {
  const q = puzzle.q;
  g = puzzleGame(q); turnStart = cloneGame(g); curDice = q.dice.slice();
  T = createTurn(g, HUMAN, curDice);
  phase = 'human-move'; busy = false; selected = -1; hintPath = null;
  layoutCheckers(g, drop);
  placeDice(curDice, HUMAN);
  $('pzBody').innerHTML = `<p>Round ${q.round}. You rolled <b>${diceWords(q.dice)}</b>. Find the best of the ${q.legal} legal plays.</p>
    <p class="mk-foot">Play it on the board, then press <b>Done</b>. Undo works as usual.</p>`;
  $('pzBtns').innerHTML = `<button data-act="next">Skip</button>`;
  beginHumanStep();
}

function puzzleCheck() {
  const q = puzzle.q, v = pzView(q);
  const played = T.played.map(({ r, t, d }) => ({ r, t, d }));
  const key = playKey(v, played), right = q.keys.includes(key);
  puzzle.tries++;
  const prev = pzProgress[q.id] || {};
  pzProgress[q.id] = { solved: prev.solved || right, first: prev.first ?? (right && puzzle.tries === 1), tries: (prev.tries || 0) + 1 };
  savePz();
  phase = 'puzzle'; selected = -1; clearMarks();
  const best = describePlay(v, q.best), mine = describePlay(v, played);
  const why = makisReasons({ base: positionFacts(v) }, best).filter((s) => !/^Race count|^The checkers have passed/.test(s)).slice(0, 2);
  let h;
  if (right) {
    const same = key === q.key;
    h = `<p class="pz-ok">✓ Correct${puzzle.tries === 1 ? ' — first try' : ''}.</p>
      <p>${same ? 'That is Mr. Makis\'s move' : `Equally good as Mr. Makis's own <b>${stepsText(q.best)}</b>`}: it wins about <b>${pct(q.win[0])}</b> of his play-outs. The best move outside the right answers, <b>${stepsText(q.second)}</b>, wins only ${pct(q.win[1])}.</p>`;
  } else {
    const isSecond = key === playKey(v, q.second);
    h = `<p class="pz-no">Not the best.</p>
      <p>Your <b>${stepsText(played)}</b> ${makisWhyWorse(best, mine)}${isSecond ? ` — it wins about ${pct(q.win[1])}` : ''}. Mr. Makis plays <b>${stepsText(q.best)}</b> and wins about <b>${pct(q.win[0])}</b>.</p>`;
  }
  if (why.length) h += `<div class="mk-h">Why his move</div><ul>${why.map((s) => `<li>${s}</li>`).join('')}</ul>`;
  h += `<p class="mk-foot">Win chances from ${q.rollouts} play-outs per move with the same dice (about ±3%).</p>`;
  $('pzBody').innerHTML = h;
  $('pzBtns').innerHTML = `${right ? '' : '<button data-act="retry">Try again</button>'}<button data-act="show">${right ? 'See his move' : 'Show his move'}</button><button data-act="next" class="primary">Next puzzle</button>`;
  setStatus(right ? 'Puzzle solved' : 'Not quite — try again, or see Mr. Makis\'s move');
  sound[right ? 'win' : 'nope']();
  updateHud();
}

async function puzzleShow() {
  const p = puzzle;
  puzzleStart(false);
  $('pzBtns').innerHTML = '';
  await playPath(pzPath(p.q.best));
  if (puzzle !== p) return;
  phase = 'puzzle'; clearMarks();
  setStatus(`Mr. Makis plays <b>${stepsText(p.q.best)}</b>`);
  $('pzBtns').innerHTML = `<button data-act="retry">Try it yourself</button><button data-act="next" class="primary">Next puzzle</button>`;
  updateHud();
}

// next unsolved puzzle after the current one (wrapping), else simply the next one
function nextPuzzle() {
  const i = PUZZLES.findIndex((q) => q === puzzle.q);
  const order = [...PUZZLES.slice(i + 1), ...PUZZLES.slice(0, i + 1)];
  enterPuzzle(order.find((q) => !(pzProgress[q.id] || {}).solved) || order[0]);
}

function exitPuzzle() {
  if (!puzzle) return;
  const L = puzzle.live;
  puzzle = null;
  $('puzzle').hidden = true;
  gid++; flushAnims();
  restoreLive(L);
}

$('pzBtns').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !puzzle || busy) return;
  if (b.dataset.act === 'retry') puzzleStart(false);
  else if (b.dataset.act === 'show') puzzleShow();
  else if (b.dataset.act === 'next') nextPuzzle();
});
$('pzExit').onclick = exitPuzzle;

function renderPuzzles() {
  const solved = PUZZLES.filter((q) => (pzProgress[q.id] || {}).solved).length;
  let h = `<p>Positions from computer games where one move is clearly best — confirmed by Mr. Makis playing each candidate to the end hundreds of times. <b>${solved} of ${PUZZLES.length}</b> solved.</p>`;
  for (const t of [1, 2, 3, 4]) {
    const qs = PUZZLES.filter((q) => q.tier === t);
    if (!qs.length) continue;
    h += `<h3>${TIERS[t].name}</h3><p class="tier-note">${TIERS[t].note}</p><div class="pz-grid">`;
    for (const q of qs) {
      const p = pzProgress[q.id] || {};
      const cls = p.solved ? 'solved' : p.tries ? 'missed' : '';
      h += `<button class="pz-tile ${cls}" data-id="${q.id}">${p.solved ? '✓ ' : ''}Puzzle ${q.id}<small>${q.theme} · ${diceWords(q.dice)}</small></button>`;
    }
    h += '</div>';
  }
  $('puzzlesBody').innerHTML = h;
}
$('puzzlesBody').addEventListener('click', (e) => {
  const b = e.target.closest('.pz-tile');
  if (b) enterPuzzle(PUZZLES.find((q) => q.id === +b.dataset.id));
});
$('puzzlesBtn').onclick = () => { renderPuzzles(); $('puzzles').classList.remove('hidden'); };
$('closePuzzles').onclick = () => $('puzzles').classList.add('hidden');

// ================================================================ games sheet (recent + saved)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const metaLine = (r) => `${r.imported ? 'loaded from a .vbg file · ' : ''}${fmtDate(r.date)} · vs ${LEVELS[(r.level || 3) - 1].name} · ${r.imported ? 'player' : 'you'} ${r.human === 1 ? 'black' : 'white'} · ${resultText(r)}${r.match ? ` (match ${r.match.after[0]}–${r.match.after[1]} of ${r.match.to})` : ''} · ${r.turns.length} turns`;
const defaultName = (r) => `${r.result ? (r.result.winner === 'you' ? 'Win' : 'Loss') : 'Game'} vs ${LEVELS[(r.level || 3) - 1].name} · ${fmtDate(r.date)}`;
let editing = null; // { kind: 'save-recent' | 'save-current' | 'rename' | 'delete', id }

function renderGames() {
  const full = gamesDb.saved.length >= MAX_SAVED;
  // current game
  const cur = record && record.turns.length ? record : null;
  let html = `<div class="vbgbar"><button data-act="import">Load a .vbg game…</button><span>${IS_APP
    ? 'Load a <b>.vbg</b> game file to review it move by move. Exporting games is in the web version, fevga.vichos.org.'
    : 'Export a saved game as a <b>.vbg</b> file to share it — anyone can load it here and review it move by move.'}</span></div>`;
  html += `<h3>Current game</h3>`;
  if (!cur) html += `<p class="empty">Nothing to save yet — play at least one move.</p>`;
  else if (editing?.kind === 'save-current') html += nameEditor(defaultName(cur));
  else html += `<div class="grow"><div class="gi"><div class="gn">This game so far</div><div class="gm">${esc(metaLine(cur))}</div></div>
    <div class="ga"><button data-act="save-current" ${full ? 'disabled title="Delete a saved game first"' : ''}>Save…</button></div></div>`;
  html += `<h3>Recent games <span class="cnt">last 5, saved automatically</span></h3>`;
  if (!gamesDb.recent.length) html += `<p class="empty">No games yet.</p>`;
  for (const r of gamesDb.recent) {
    if (editing?.kind === 'save-recent' && editing.id === r.id) { html += nameEditor(defaultName(r)); continue; }
    const live = record && r.id === record.id && !r.result;
    html += `<div class="grow"><div class="gi"><div class="gn">${live ? 'In progress' : esc(fmtDate(r.date))}</div><div class="gm">${esc(metaLine(r))}</div></div>
      <div class="ga"><button data-act="replay-recent" data-id="${r.id}" class="primary">Replay</button>
      <button data-act="save-recent" data-id="${r.id}" ${full ? 'disabled title="Delete a saved game first"' : ''}>Save…</button></div></div>`;
  }
  html += `<h3>Saved games <span class="cnt">${gamesDb.saved.length} / ${MAX_SAVED}</span></h3>`;
  if (!gamesDb.saved.length) html += `<p class="empty">Save a game to keep it for study — up to ${MAX_SAVED}.</p>`;
  for (const r of gamesDb.saved) {
    if (editing?.kind === 'rename' && editing.id === r.id) { html += nameEditor(r.name); continue; }
    const confirming = editing?.kind === 'delete' && editing.id === r.id;
    html += `<div class="grow"><div class="gi"><div class="gn">${esc(r.name)}</div><div class="gm">${esc(metaLine(r))}</div></div>
      <div class="ga">${confirming
        ? `<span class="warn">Delete this game?</span><button data-act="delete-yes" data-id="${r.id}" class="danger">Delete</button><button data-act="cancel">Keep</button>`
        : `<button data-act="replay-saved" data-id="${r.id}" class="primary">Replay</button>
           <button data-act="export" data-id="${r.id}" class="web-only" title="Download as a .vbg file to share">Export</button>
           <button data-act="rename" data-id="${r.id}">Rename</button>
           <button data-act="delete" data-id="${r.id}">Delete</button>`}</div></div>`;
  }
  $('gamesBody').innerHTML = html;
  const inp = $('gamesBody').querySelector('input.nameInput');
  if (inp) { inp.focus(); inp.select(); }
}
function nameEditor(value) {
  return `<div class="grow editing"><input class="nameInput" maxlength="60" value="${esc(value)}" aria-label="Game name">
    <div class="ga"><button data-act="name-ok" class="primary">${editing.kind === 'rename' ? 'Rename' : 'Save'}</button><button data-act="cancel">Cancel</button></div></div>`;
}
function commitName() {
  const name = $('gamesBody').querySelector('input.nameInput')?.value || '';
  if (editing.kind === 'rename') { renameSaved(gamesDb, editing.id, name); toast('Renamed'); }
  else {
    const src = editing.kind === 'save-current' ? record : gamesDb.recent.find((r) => r.id === editing.id);
    if (src && saveNamed(gamesDb, src, name)) toast(`Saved as “${name.trim() || 'Untitled game'}”`);
    else toast(`You can keep ${MAX_SAVED} saved games — delete one first`);
  }
  if (!storeGames(gamesDb)) toast('Could not save — browser storage is full or blocked');
  editing = null; renderGames();
}
$('gamesBody').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'replay-recent') enterReplay(gamesDb.recent.find((r) => r.id === id));
  else if (act === 'replay-saved') enterReplay(gamesDb.saved.find((r) => r.id === id));
  else if (act === 'save-current' || act === 'save-recent' || act === 'rename' || act === 'delete') { editing = { kind: act, id }; renderGames(); }
  else if (act === 'name-ok') commitName();
  else if (act === 'delete-yes') { deleteSaved(gamesDb, id); storeGames(gamesDb); editing = null; renderGames(); toast('Deleted'); }
  else if (act === 'cancel') { editing = null; renderGames(); }
  else if (act === 'export') exportGame(gamesDb.saved.find((r) => r.id === id));
  else if (act === 'import') { $('vbgInput').value = ''; $('vbgInput').click(); }
});

// .vbg export: a download of the record as a small JSON text file (records.js documents the format).
function exportGame(rec) {
  if (!rec) return;
  const url = URL.createObjectURL(new Blob([toVbg(rec)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = vbgFileName(rec);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Exported “${a.download}”`);
}

// .vbg import: validated move by move (parseVbg), kept as a saved game when there is room,
// and opened straight into the replay viewer.
async function importGame(file) {
  if (!file) return;
  if (!/\.vbg$/i.test(file.name)) { toast('Choose a .vbg game file'); return; }
  if (file.size > VBG_MAX_BYTES) { toast('That file is too large to be a Fevga game'); return; }
  const { rec, error } = parseVbg(await file.text());
  if (error) { toast(error); return; }
  if (rec.name === 'Imported game') rec.name = file.name.replace(/\.vbg$/i, '').slice(0, 60);
  let kept = false;
  if (gamesDb.saved.length < MAX_SAVED) { kept = saveNamed(gamesDb, rec, rec.name) && storeGames(gamesDb); }
  renderGames();
  toast(kept ? `Loaded “${rec.name}” into your saved games` : `Loaded “${rec.name}” for review — saved games are full, so it is not kept`);
  enterReplay(kept ? gamesDb.saved[0] : { ...rec, id: newId() });
}
$('vbgInput').addEventListener('change', (e) => importGame(e.target.files[0]));
$('gamesBody').addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('nameInput')) return;
  if (e.key === 'Enter') { e.preventDefault(); commitName(); }
  else if (e.key === 'Escape') { e.stopPropagation(); editing = null; renderGames(); }
});
$('gamesBtn').onclick = () => { editing = null; renderGames(); $('games').classList.remove('hidden'); };
$('closeGames').onclick = () => { editing = null; $('games').classList.add('hidden'); };
$('rpStart').onclick = () => replayJump(0);
$('rpPrev').onclick = () => replayJump(replay.idx - 1);
$('rpNext').onclick = () => replayStep();
$('rpEnd').onclick = () => replayJump(replay.rec.turns.length);
$('rpPlay').onclick = () => replayPlay();
$('rpExit').onclick = () => exitReplay();
$('rpContinue').onclick = () => continueFromHere();
$('replaySlider').oninput = (e) => { if (replay) { replay.playing = false; replayJump(+e.target.value); } };

// ================================================================ settings
const previewTex = new Map(); // theme id -> small texture canvases for the cards
function drawPreview(cv, th) {
  let t = previewTex.get(th.id);
  if (!t) { t = {}; for (const k of SURFACES) t[k] = makeSurface(th[k].tex, 96).map.image; previewTex.set(th.id, t); }
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const pat = (k) => c.createPattern(t[k], 'repeat');
  c.fillStyle = pat('table'); c.fillRect(0, 0, W, H);
  const fx = W * 0.05, fy = H * 0.07, fw = W - 2 * fx, fh = H - 2 * fy;
  c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
  c.fillStyle = pat('frame'); c.beginPath(); c.roundRect(fx, fy, fw, fh, 6); c.fill(); c.restore();
  const inset = fw * 0.045, bar = fw * 0.05;
  const hw = (fw - 2 * inset - bar) / 2, y0 = fy + inset, fH = fh - 2 * inset, len = fH * 0.42, pw = hw / 6;
  for (let h = 0; h < 2; h++) {
    const x0 = fx + inset + h * (hw + bar);
    c.fillStyle = pat('field'); c.fillRect(x0, y0, hw, fH);
    for (let i = 0; i < 6; i++) {
      for (const top of [true, false]) {
        c.fillStyle = pat((i + (top ? 0 : 1)) % 2 ? 'pb' : 'pa');
        const bx = x0 + i * pw, by = top ? y0 : y0 + fH, ty = top ? y0 + len : y0 + fH - len;
        c.beginPath(); c.moveTo(bx + 1, by); c.lineTo(bx + pw - 1, by); c.lineTo(bx + pw / 2, ty); c.closePath(); c.fill();
      }
    }
  }
  const disc = (k, x, y) => {
    const r = pw * 0.46;
    c.fillStyle = pat(k); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
  };
  const rx = fx + inset + hw + bar + 5.5 * pw, lx = fx + inset + 0.5 * pw;
  for (let i = 0; i < 4; i++) { disc('white', rx, y0 + pw * 0.5 + i * pw * 0.95); disc('black', lx, y0 + fH - pw * 0.5 - i * pw * 0.95); }
  const sh = c.createRadialGradient(W * 0.35, H * 0.3, W * 0.1, W * 0.5, H * 0.5, W * 0.75); // studio light
  sh.addColorStop(0, 'rgba(255,240,220,.12)'); sh.addColorStop(1, 'rgba(0,0,0,.35)');
  c.fillStyle = sh; c.fillRect(0, 0, W, H);
}

let themeBusy = false;
function renderSettings() {
  const grid = $('themeGrid');
  if (!grid.children.length) {
    for (const th of THEMES) {
      const card = document.createElement('button');
      card.className = 'card'; card.dataset.theme = th.id;
      card.innerHTML = `<canvas width="240" height="160"></canvas><div class="cn">${th.name}<span class="tag">${th.kind}</span></div><div class="cs">${th.sub}</div>`;
      card.onclick = () => chooseTheme(th.id);
      grid.appendChild(card);
      drawPreview(card.querySelector('canvas'), th);
    }
  }
  for (const card of grid.children) card.classList.toggle('current', card.dataset.theme === themeId);
  $('optNumbers').checked = showNumbers;
  $('optRound').checked = showRound;
  $('optTotal').checked = showTotal;
  $('optSound').checked = !sound.muted;
  $('optFreeCam').checked = freeCam;
  $('optAutoEnd').checked = autoEnd;
  $('optOpening').checked = openingPlay;
  $('optMatch').checked = matchOn;
  $('optLamp').checked = lampOn;
  renderFavs();
}
async function chooseTheme(id) {
  if (themeBusy || id === themeId) return;
  themeBusy = true;
  const card = $('themeGrid').querySelector(`[data-theme="${id}"]`); // absent until Settings first opens
  card?.classList.add('loading');
  try {
    await applyTheme(id);
    themeId = id; store.save();
  } finally {
    card?.classList.remove('loading');
    themeBusy = false;
  }
  if (card) renderSettings();
}
$('settingsBtn').onclick = () => { $('settings').classList.remove('hidden'); favEdit = null; renderSettings(); };

// ---------------------------------------------------------------- favourite setups
// A favourite is a named snapshot of the whole setup: level, colour, lighting (dimmer + lamp),
// the view (locked/free + camera spot) and every Settings choice. Stored in fevga.favs.v1.
const FAV_KEY = 'fevga.favs.v1', MAX_FAVS = 8;
let favs = (() => { try { const f = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(f) ? f : []; } catch { return []; } })();
let favEdit = null; // { kind: 'save' | 'rename' | 'delete' | 'confirm-colour', id }
const storeFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); return true; } catch { return false; } };

function snapshotSetup() {
  return {
    level, color: seatColor, light: lightLevel, lamp: lampOn, freeCam, view: freeCam ? null : savedView,
    theme: themeId, numbers: showNumbers, round: showRound, total: showTotal, muted: sound.muted, autoEnd, openingPlay, match: matchOn,
  };
}
function favSummary(s) {
  return [themeById(s.theme).name, LEVELS[s.level - 1].name, `plays ${s.color === 1 ? 'black' : 'white'}`,
    `light ${Math.round(s.light * 100)}%${s.lamp ? ' + retro lamp' : ''}`, s.freeCam ? 'free view' : (s.view ? 'view locked (own angle)' : 'view locked'),
    ...(s.match ? ['match to 5'] : []), ...(s.autoEnd ? ['auto-end turn'] : []), ...(s.openingPlay ? ['plays opening dice'] : []),
    ...(s.numbers ? [] : ['no point numbers']), ...(s.round ? ['round counter'] : []), ...(s.total ? ['dice sum'] : []), ...(s.muted ? ['sound off'] : [])].join(' · ');
}

async function applyFavourite(f) {
  const s = f.s;
  if (themeById(s.theme).id !== themeId) { await applyTheme(s.theme); themeId = themeById(s.theme).id; }
  showNumbers = s.numbers !== false; for (const p of railPlanes) p.visible = showNumbers;
  showRound = !!s.round; showTotal = !!s.total;
  sound.setMuted(!!s.muted); $('muteBtn').textContent = sound.muted ? '🔇' : '🔊';
  autoEnd = !!s.autoEnd; openingPlay = !!s.openingPlay;
  if (!!s.match !== matchOn) { matchOn = !!s.match; matchScore = [0, 0]; } // same rule as the switch
  lightLevel = s.light; lampOn = !!s.lamp; applyLamp(); setLight(s.light, false);
  level = s.level; sel.value = level;
  freeCam = !!s.freeCam; savedView = s.view || null; applyCamLock();
  camAnim = { from: camera.position.clone(), to: savedView ? new THREE.Vector3(...savedView) : viewPosition(), t: 0, dur: 0.9 };
  const colourChange = s.color !== seatColor;
  seatColor = s.color;
  store.save(); updateHud();
  if (colourChange) startGame(); // a colour change always means a new game
  toast(`Favourite “${f.name}” applied${colourChange ? ` — new game, you play ${seatColor === 1 ? 'black' : 'white'}` : ''}`);
}

function renderFavs() {
  const full = favs.length >= MAX_FAVS;
  let h = '';
  if (favEdit?.kind === 'save') h += favNameEditor(`Favourite ${favs.length + 1}`, 'Save');
  else h += `<div class="frow"><button data-fav="save" ${full ? `disabled title="Delete a favourite first"` : ''}>Save current setup as a favourite…</button><span class="cnt">${favs.length} / ${MAX_FAVS}</span></div>`;
  if (!favs.length) h += `<p class="empty">Save your favourite combination of level, colour, lighting, view and board style to switch back to it in one click.</p>`;
  for (const f of favs) {
    if (favEdit?.kind === 'rename' && favEdit.id === f.id) { h += favNameEditor(f.name, 'Rename'); continue; }
    let actions;
    if (favEdit?.kind === 'delete' && favEdit.id === f.id) actions = `<span class="warn">Delete this favourite?</span><button data-fav="delete-yes" data-id="${f.id}" class="danger">Delete</button><button data-fav="cancel">Keep</button>`;
    else if (favEdit?.kind === 'confirm-colour' && favEdit.id === f.id) actions = `<span class="warn">Plays ${f.s.color === 1 ? 'black' : 'white'} — this starts a new game.</span><button data-fav="apply-yes" data-id="${f.id}" class="primary">Apply</button><button data-fav="cancel">Cancel</button>`;
    else actions = `<button data-fav="apply" data-id="${f.id}" class="primary">Apply</button><button data-fav="rename" data-id="${f.id}">Rename</button><button data-fav="delete" data-id="${f.id}">Delete</button>`;
    h += `<div class="grow"><div class="gi"><div class="gn">${esc(f.name)}</div><div class="gm">${esc(favSummary(f.s))}</div></div><div class="ga">${actions}</div></div>`;
  }
  $('favList').innerHTML = h;
  const inp = $('favList').querySelector('input.nameInput');
  if (inp) { inp.focus(); inp.select(); }
}
function favNameEditor(value, label) {
  return `<div class="grow editing"><input class="nameInput" maxlength="40" value="${esc(value)}" aria-label="Favourite name">
    <div class="ga"><button data-fav="name-ok" class="primary">${label}</button><button data-fav="cancel">Cancel</button></div></div>`;
}
function commitFavName() {
  const name = ($('favList').querySelector('input.nameInput')?.value || '').trim().slice(0, 40) || 'Favourite';
  if (favEdit.kind === 'save') { if (favs.length < MAX_FAVS) favs.push({ id: newId(), name, s: snapshotSetup(), created: Date.now() }); toast(`Saved favourite “${name}”`); }
  else { const f = favs.find((x) => x.id === favEdit.id); if (f) f.name = name; }
  if (!storeFavs()) toast('Could not save — browser storage is full or blocked');
  favEdit = null; renderFavs();
}
$('favList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-fav]');
  if (!b) return;
  const act = b.dataset.fav, f = favs.find((x) => x.id === b.dataset.id);
  if (act === 'save') { favEdit = { kind: 'save' }; renderFavs(); }
  else if (act === 'rename' || act === 'delete') { favEdit = { kind: act, id: f.id }; renderFavs(); }
  else if (act === 'name-ok') commitFavName();
  else if (act === 'cancel') { favEdit = null; renderFavs(); }
  else if (act === 'delete-yes') { favs = favs.filter((x) => x !== f); storeFavs(); favEdit = null; renderFavs(); toast('Favourite deleted'); }
  else if (act === 'apply' || act === 'apply-yes') {
    // a colour change ends the game in progress: ask first, unless nothing has been played yet
    const inProgress = record && record.turns.length && phase !== 'over';
    if (act === 'apply' && f.s.color !== seatColor && inProgress) { favEdit = { kind: 'confirm-colour', id: f.id }; renderFavs(); return; }
    favEdit = null;
    await applyFavourite(f);
    renderSettings();
  }
});
// ---------------------------------------------------------------- .vbs settings files
function exportSettings() {
  const name = vbsFileName();
  const url = URL.createObjectURL(new Blob([toVbs(snapshotSetup(), favs)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Exported “${name}” — your setup${favs.length ? ` and ${favs.length} favourite${favs.length > 1 ? 's' : ''}` : ''}`);
}
let pendingVbs = null; // a loaded setup waiting for "this starts a new game" confirmation
async function loadSettingsFile(file) {
  if (!file) return;
  if (!/\.vbs$/i.test(file.name)) { toast('Choose a .vbs settings file'); return; }
  if (file.size > VBS_MAX_BYTES) { toast('That file is too large to be Fevga settings'); return; }
  const { setup, favourites, error } = parseVbs(await file.text());
  if (error) { toast(error); return; }
  // favourites are added next to the ones already here (same name + same setup = skipped)
  let added = 0;
  for (const f of favourites) {
    if (favs.length >= MAX_FAVS) break;
    if (favs.some((x) => x.name === f.name && JSON.stringify(x.s) === JSON.stringify(f.s))) continue;
    favs.push({ id: newId(), name: f.name, s: f.s, created: Date.now() }); added++;
  }
  if (added) storeFavs();
  const skippedFull = favourites.length - added > 0 && favs.length >= MAX_FAVS;
  const note = `${added ? ` + ${added} favourite${added > 1 ? 's' : ''}` : ''}${skippedFull ? ' (favourites full, some skipped)' : ''}`;
  const inProgress = record && record.turns.length && phase !== 'over';
  if (setup.color !== seatColor && inProgress) {
    pendingVbs = { setup, note };
    $('vbsAskText').textContent = `These settings play ${setup.color === 1 ? 'black' : 'white'} — applying them starts a new game.`;
    $('vbsAsk').hidden = false; renderFavs();
    return;
  }
  await applyFavourite({ name: file.name, s: setup });
  renderSettings();
  toast(`Settings loaded from “${file.name}”${note}`);
}
$('vbsExport').onclick = exportSettings;
$('vbsLoad').onclick = () => { $('vbsInput').value = ''; $('vbsInput').click(); };
$('vbsInput').addEventListener('change', (e) => loadSettingsFile(e.target.files[0]));
$('vbsYes').onclick = async () => {
  const p = pendingVbs; pendingVbs = null; $('vbsAsk').hidden = true;
  if (!p) return;
  await applyFavourite({ name: 'loaded settings', s: p.setup });
  renderSettings(); toast(`Settings loaded${p.note}`);
};
$('vbsNo').onclick = () => { pendingVbs = null; $('vbsAsk').hidden = true; renderFavs(); toast('Settings not applied (any favourites in the file were kept)'); };

$('favList').addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('nameInput')) return;
  if (e.key === 'Enter') { e.preventDefault(); commitFavName(); }
  else if (e.key === 'Escape') { e.stopPropagation(); favEdit = null; renderFavs(); }
});
$('closeSettings').onclick = () => $('settings').classList.add('hidden');
$('optNumbers').onchange = (e) => { showNumbers = e.target.checked; for (const p of railPlanes) p.visible = showNumbers; store.save(); };
$('optRound').onchange = (e) => { showRound = e.target.checked; updateRound(); store.save(); };
$('optTotal').onchange = (e) => {
  showTotal = e.target.checked; store.save();
  if (phase === 'human-move' && T && !busy) beginHumanStep(); // the message in view picks the change up now
};
$('optSound').onchange = (e) => { sound.setMuted(!e.target.checked); $('muteBtn').textContent = sound.muted ? '🔇' : '🔊'; store.save(); };
$('settingsView').onclick = () => { homeView(); $('settings').classList.add('hidden'); };
$('optFreeCam').onchange = (e) => setFreeCam(e.target.checked);
$('camBtn').onclick = () => setFreeCam(!freeCam);
// A moved view survives reloads. Saved once the camera has come to rest: damping keeps it
// gliding after the mouse is released, so saving on 'end' stored a stale spot.
let viewSaveTimer = null;
controls.addEventListener('change', () => {
  if (!freeCam) return;
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => { if (freeCam) { rememberView(); store.save(); } }, 400);
});
$('optOpening').onchange = (e) => { openingPlay = e.target.checked; store.save(); };
$('optLamp').onchange = (e) => setLamp(e.target.checked);
$('bulbBtn').onclick = () => setLamp(!lampOn);
// Switching match play on or off starts the count at 0-0; the game in progress counts toward it.
$('optMatch').onchange = (e) => {
  matchOn = e.target.checked; matchScore = [0, 0]; store.save(); updateHud();
  toast(matchOn ? `Match to ${MATCH_TO} points — this game counts as game 1` : 'Back to single games');
};
$('optAutoEnd').onchange = (e) => {
  autoEnd = e.target.checked; store.save();
  if (autoEnd && phase === 'human-move' && T && turnDone(T) && T.played.length) beginHumanStep(); // a finished move is waiting: end it
};

// View lock (on-screen 🔒/🔓 button, Settings > Free camera, V key). Locking freezes the board
// exactly where it is now - it no longer snaps home - and that view is remembered across
// reloads; the home view is only restored by Reset camera / C.
function applyCamLock() {
  controls.enableRotate = freeCam;
  controls.enableZoom = freeCam;
  $('help').innerHTML = freeCam
    ? 'Click a glowing checker, then a highlighted point — or drag it there.<br>Drag the table to turn · scroll to zoom · 🔒 locks the view here.'
    : 'Click a glowing checker, then a highlighted point — or drag it there.<br>View locked · 🔓 to move it, <b>C</b> for the home view.';
  $('camBtn').innerHTML = freeCam ? '<span class="ic">🔓</span><span class="tx"> Free view</span>' : '<span class="ic">🔒</span><span class="tx"> View locked</span>';
  $('camBtn').title = freeCam ? 'Lock the board where it is now (V)' : 'Allow turning and zooming the board (V)';
  $('camBtn').classList.toggle('on', !freeCam);
  $('optFreeCam').checked = freeCam;
}
function rememberView() {
  const home = viewPosition();
  savedView = camera.position.distanceTo(home) < 0.5 ? null : camera.position.toArray().map((x) => Math.round(x * 100) / 100);
}
function setFreeCam(on) {
  freeCam = on;
  if (camAnim) { camera.position.copy(camAnim.to); camAnim = null; } // lock where it is heading
  if (!on) { // stop any leftover glide so "locked here" means exactly here
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;
  }
  rememberView();
  applyCamLock(); store.save();
  toast(on ? 'Free view — drag to turn the board, scroll to zoom' : 'View locked here');
}
function homeView() { savedView = null; store.save(); resetView(true); }

// ================================================================ camera / resize / loop
let camAnim = null;
// Portrait phones stack the HUD above and below the board (brand row + scoreboard on top, lamp /
// lock / dimmer row + move bar below), so the home view frames the board in the band between
// them instead of the whole screen. The bar is reserved at its two-row height so the board does
// not jump when buttons come and go. Returns null where the panels sit in the corners.
// What the phone framing must keep in view (world x, z): the board frame, the human's borne-off
// towers (near right, whichever colour - black turns the stage), the computer's (far left) and
// the idle dice (far right, world space).
const FOOTPRINT = [
  [-(FX + RAIL), -(FZ + RAIL)], [FX + RAIL, -(FZ + RAIL)], [-(FX + RAIL), FZ + RAIL], [FX + RAIL, FZ + RAIL],
  [OFF_X + R, 16 + R], [OFF_X + R, 7.8 - R], [-OFF_X - R, -16 - R], [-OFF_X - R, -7.8 + R],
  [OFF_X - 1 + 2.2 * DSP + DS / 2, -12 - DS / 2], [OFF_X - 1 + 2.2 * DSP + DS / 2, -12 + DS / 2],
];
// Which HUD layout the CSS is using: 'land' = phone on its side (max-height 500: left and right
// rails), 'portrait' = narrow screen (panels above and below), 'desk' = panels in the corners.
// Kept in step with the media queries in index.html.
function hudMode() {
  if (window.matchMedia('(max-height: 500px)').matches) return 'land';
  if (window.matchMedia('(max-width: 700px)').matches) return 'portrait';
  return 'desk';
}
// Phones frame the home view in the screen rectangle the HUD leaves free:
//  portrait - between the scoreboard and the lamp row + a bar reserved at its two-row height
//    (140 px, so the board does not jump as buttons come and go);
//  landscape - between the left rail (brand, score, lamp) and the move bar on the right.
// Returns null on desktop layouts, where the panels sit in the corners.
function viewBand() {
  const w = window.innerWidth, h = window.innerHeight, mode = hudMode();
  const rect = (id) => $(id).getBoundingClientRect();
  if (mode === 'portrait' && h > w) {
    const bar = rect('bar'), tools = rect('viewTools');
    const top = rect('board').bottom + 4;
    const bottom = bar.bottom - Math.max(bar.height, 140) - tools.height - 12;
    return bottom - top > h * 0.3 ? { left: 0, right: w, top, bottom } : null;
  }
  if (mode === 'land') {
    const left = Math.max(rect('brand').right, rect('board').right, rect('viewTools').right) + 4;
    const right = rect('bar').left - 4;
    return right - left > w * 0.3 ? { left, right, top: 4, bottom: h - 4 } : null;
  }
  return null;
}
// the camera's view of the FOOTPRINT from direction dir at distance d: its pixel bounding box
function footprintBox(c, dir, d, w, h) {
  c.position.copy(controls.target).addScaledVector(dir, d); c.lookAt(controls.target); c.updateMatrixWorld();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const v = new THREE.Vector3();
  for (const [x, z] of FOOTPRINT) for (const y of [0, 4]) {
    v.set(x, y, z).project(c); // FOOTPRINT is in world coordinates
    const px = (v.x + 1) / 2 * w, py = (1 - v.y) / 2 * h;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { x0, x1, y0, y1 };
}
// the closest distance at which the footprint fits the band (bisection)
function fitDistance(c, dir, band, w, h) {
  const fits = (b) => b.x1 - b.x0 <= band.right - band.left - 12 && b.y1 - b.y0 <= band.bottom - band.top;
  let lo = 30, hi = 600;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(footprintBox(c, dir, mid, w, h))) hi = mid; else lo = mid; }
  return hi;
}
function viewPosition() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  const band = viewBand();
  // portrait phones look down more steeply (~66 deg instead of ~53): the width is what limits the
  // board there, and a steeper view spends the spare height on longer points and closer checkers.
  // Landscape phones take whichever of the two angles shows the board larger in their band.
  let dir = new THREE.Vector3(0, band ? 2.2 : 1.32, 1).normalize();
  let dist;
  if (band) {
    // fit exactly: the closest distance at which the board plus the borne-off towers beside it
    // project inside the band, then shift the picture so that box is centred in the band
    // (picking follows: the raycaster uses the same projection)
    const c = camera.clone(); c.clearViewOffset();
    dist = fitDistance(c, dir, band, w, h);
    if (hudMode() === 'land') {
      const flat = new THREE.Vector3(0, 1.32, 1).normalize(), dFlat = fitDistance(c, flat, band, w, h);
      const span = (dv, dd) => { const b = footprintBox(c, dv, dd, w, h); return b.x1 - b.x0; };
      if (span(flat, dFlat) > span(dir, dist)) { dir = flat; dist = dFlat; }
    }
    const b = footprintBox(c, dir, dist, w, h);
    camera.setViewOffset(w, h, Math.round((b.x0 + b.x1) / 2 - (band.left + band.right) / 2), Math.round((b.y0 + b.y1) / 2 - (band.top + band.bottom) / 2), w, h);
  } else {
    camera.clearViewOffset();
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const needW = (OFF_X + 3.2) / Math.tan(hf / 2);
    const needH = (FZ + RAIL + 3) / Math.tan(vf / 2) * 1.05;
    dist = Math.max(needW, needH) * 1.04 + 14;
  }
  // fog only darkens the far table: it must start beyond the board however far the camera
  // sits (portrait phones back the camera off to ~280, past a fixed fog wall)
  fogBase = dist; // update() keeps the fog beyond the board even when a free view zooms out further
  camera.far = dist + 260; camera.updateProjectionMatrix();
  return controls.target.clone().add(dir.multiplyScalar(dist));
}
function resetView(animate) {
  const to = viewPosition();
  if (animate) camAnim = { from: camera.position.clone(), to, t: 0, dur: 0.9 };
  else camera.position.copy(to);
  controls.minDistance = 30; controls.maxDistance = to.length() * 1.5;
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
// On phones the scoreboard sits under the brand panel, whose height depends on wrapping.
function positionHud() {
  const b = $('board');
  b.style.top = hudMode() !== 'desk' ? `${Math.round($('brand').getBoundingClientRect().bottom + 8)}px` : '';
  // the view tools (lock + dimmer) sit bottom-right; lift them above the bottom bar wherever they would overlap
  const d = $('viewTools'), bar = $('bar').getBoundingClientRect();
  d.style.bottom = '';
  const r = d.getBoundingClientRect();
  if (r.left < bar.right && r.right > bar.left && r.bottom > bar.top) d.style.bottom = `${Math.round(window.innerHeight - bar.top + 8)}px`;
  // the round counter sits top centre; where the brand panel or the scoreboard is in the way
  // (narrow windows, phones) it moves into the scoreboard's footer as a compact "Round 8", since
  // anywhere below the panels it would cover the far rail of the board
  const rd = $('round');
  if (rd.classList.contains('inline')) { rd.classList.remove('inline'); document.body.insertBefore(rd, $('board')); }
  if (!rd.hidden) {
    const rr = rd.getBoundingClientRect(), br = $('brand').getBoundingClientRect(), bo = $('board').getBoundingClientRect();
    const hit = (o) => rr.left < o.right && rr.right > o.left && rr.top < o.bottom && rr.bottom > o.top;
    if (hit(br) || hit(bo)) { rd.classList.add('inline'); $('board').querySelector('.foot').insertBefore(rd, $('resetScore')); }
  }
}
// a custom view stays put on resize; only the home view re-fits the window
// (HUD first: on phones the home view is framed between the panels)
// Turning a phone (portrait <-> landscape) changes the HUD layout; a view saved for one layout does
// not frame the board in the other, so a layout change returns to the home view.
let lastHudMode = hudMode();
window.addEventListener('resize', () => {
  setMenu(false); resize(); positionHud();
  const mode = hudMode();
  if (mode !== lastHudMode && savedView) { savedView = null; store.save(); }
  lastHudMode = mode;
  if (savedView) viewPosition(); else resetView(false);
});
positionHud();

const clock = new THREE.Clock();
let elapsed = 0, frameMs = 16, frameN = 0;
function loop() {
  const real = clock.getDelta();
  update(Math.min(real, 0.05));
  controls.update();
  // slam shake: offset the camera for this frame only (OrbitControls would otherwise keep it)
  let shake = null;
  if (shakeT > 0) {
    const a = 1.5 * Math.pow(shakeT / SHAKE, 2);
    shake = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(a);
    camera.position.add(shake);
  }
  renderer.render(scene, camera);
  if (shake) camera.position.sub(shake);

  frameMs = frameMs * 0.9 + real * 1000 * 0.1; frameN++;
  if (frameN > 40 && frameN % 30 === 0) {
    const cap = Math.min(window.devicePixelRatio, 1.5);
    if (frameMs > 34 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    else if (frameMs < 18 && pixelRatio < cap) { pixelRatio = Math.min(cap, pixelRatio + 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
  }
}

let fogBase = 100;
function update(dt) {
  elapsed += dt;
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  const camDist = camera.position.distanceTo(controls.target);
  scene.fog.near = Math.max(fogBase, camDist) + 25; scene.fog.far = scene.fog.near + 115;
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.t < 0) continue;
    const k = Math.min(1, a.t / a.dur);
    a.fn(k);
    if (k >= 1) { anims.splice(i, 1); a.res(); }
  }
  if (camAnim) {
    camAnim.t += dt;
    camera.position.lerpVectors(camAnim.from, camAnim.to, easeInOut(Math.min(1, camAnim.t / camAnim.dur)));
    if (camAnim.t >= camAnim.dur) camAnim = null;
  }
  // selected checker floats; hovered movable checker nudges up
  for (let a = 0; a < 24; a++) {
    const st = stacks[a];
    for (let i = 0; i < st.length; i++) {
      const m = st[i], u = m.userData;
      if (u.anim) continue;
      const top = i === st.length - 1;
      let want = 0;
      if (top && phase === 'human-move' && !busy) {
        if (a === selected) want = 1.9 + Math.sin(elapsed * 4) * 0.12;
        else if (a === hoverPt && legalSources().has(a) && selected < 0) want = 0.35;
      }
      u.lift += (want - u.lift) * Math.min(1, dt * 12);
      m.position.set(u.rest.x, u.rest.y + u.lift, u.rest.z);
      u.ao.visible = u.rest.y < 0.05 && u.lift < 0.2;
    }
  }
  const pulse = 0.72 + 0.28 * Math.sin(elapsed * 4.5);
  if (mats) {
    mats.halo.opacity = pulse; mats.dest.opacity = pulse; mats.hint.opacity = pulse;
    mats.tri.opacity = 0.42 + 0.18 * Math.sin(elapsed * 4.5);
    mats.selHalo.opacity = 0.85 + 0.15 * Math.sin(elapsed * 6);
    if (selected >= 0 && stacks[selected].length) { // halo rides on the lifted checker
      const top = stacks[selected][stacks[selected].length - 1];
      haloMeshes[selected].position.set(top.position.x, top.position.y + CT + 0.03, top.position.z);
    }
  }
}

// ================================================================ boot
async function boot() {
  resize();
  resetView(false);
  renderer.render(scene, camera);
  await wait(0.05); // let the loading veil paint before the texture work
  applyCamLock();
  mats = buildMaterials();
  await applyTheme(themeId);
  buildBoard();
  applyLamp();
  buildDice();
  for (let p = 0; p < 2; p++) for (let i = 0; i < 15; i++) allCheckers.push(makeChecker(p, i));
  const start = viewPosition();
  camera.position.copy(start.clone().multiplyScalar(1.35).add(new THREE.Vector3(30, 10, 0)));
  camAnim = { from: camera.position.clone(), to: savedView ? new THREE.Vector3(...savedView) : start, t: 0, dur: 2.0 };
  controls.minDistance = 30; controls.maxDistance = start.length() * 1.5;
  renderer.setAnimationLoop(loop);
  $('veil').classList.add('hidden');
  startGame();
}
boot();

// console / test hook
window.__fevga = {
  get g() { return g; }, get T() { return T; }, get phase() { return phase; }, get busy() { return busy; },
  get legal() { return legal; }, get dests() { return dests; }, get level() { return level; },
  roll, done, undo, hint, select, playPath, startGame, computeDests,
  three: { camera, scene, renderer, controls },
  pickAt(clientX, clientY) { return pickPoint({ clientX, clientY }); },
  setTimeScale(s) { timeScale = s; },
  slam, get slamming() { return slamming; },
  engine: { chooseMove, absOf, cloneGame },
  get curDice() { return curDice; },
  get stacks() { return stacks.map((s) => s.length); },
  get offStacks() { return offStacks.map((s) => s.length); },
  get selected() { return selected; },
  get human() { return HUMAN; },
  get themeId() { return themeId; },
  chooseTheme,
  // advance animations by `sec` of game time and render (the hidden preview pane throttles rAF)
  advance(sec = 1) { for (let t = 0; t < sec; t += 1 / 30) update(1 / 30); controls.update(); renderer.render(scene, camera); },
  setLevel(l) { level = l; sel.value = l; updateHud(); },
  get replay() { return replay; }, get record() { return record; }, gamesDb, enterReplay, exitReplay, replayStep, replayJump,
  // jump to a position (testing): pos arrays in own numbering
  setGame(pos, off, ph = 'human-roll') { gid++; flushAnims(); record = null; g ={ pos: pos.map((a) => Int8Array.from(a)), off: off.slice() }; layoutCheckers(g, false); T = null; busy = false; phase = ph; updateHud(); clearMarks(); setStatus('Your turn — <b>roll the dice</b>'); },
  // queue dice for the next rolls (testing), e.g. forceDice([6,5],[3,3])
  forceDice(...ds) { forcedDice.push(...ds); },
};
