// Visual effects layered over the board (no game logic, no DOM):
//  - createTrails: glowing arcs + rings showing where the computer's last checkers came from and
//    went; they hold for a few seconds after the turn, then fade;
//  - createConfetti: the win celebration (paper confetti shot over the board from both sides; a
//    calm, slow, spin-free fall when the system asks for reduced motion).
// Both draw into the scene they are given and are advanced by update(dt) from the render loop.
import * as THREE from 'three';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- last-move trails
// A trail is a tube along a lifted arc (the same shape the checker flew) whose brightness ramps
// up towards the landing spot, a gold ring where the checker landed and a dim ring where it left.
export function createTrails(parent, ringTexture) {
  const group = new THREE.Group();
  parent.add(group);
  // 1-D brightness ramp along the tube (TubeGeometry's u runs along its length)
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 2;
  const cx = cv.getContext('2d');
  const grad = cx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#5a4216'); grad.addColorStop(0.5, '#b8862e'); grad.addColorStop(1, '#ffe4a6');
  cx.fillStyle = grad; cx.fillRect(0, 0, 64, 2);
  const ramp = new THREE.CanvasTexture(cv);
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
  const tubeMat = new THREE.MeshBasicMaterial({ map: ramp, ...additive });
  const toMat = new THREE.MeshBasicMaterial({ map: ringTexture, color: 0xffd27a, ...additive });
  const fromMat = new THREE.MeshBasicMaterial({ map: ringTexture, color: 0x9fb8d8, ...additive });
  const ringGeo = new THREE.PlaneGeometry(2 * 1.74 * 1.55, 2 * 1.74 * 1.55).rotateX(-Math.PI / 2);
  const FADE = 1.6;
  let items = [], age = 0, hold = Infinity, enabled = true;

  function setOpacity(o) { tubeMat.opacity = 0.95 * o; toMat.opacity = 0.9 * o; fromMat.opacity = 0.65 * o; }
  setOpacity(1);

  return {
    get count() { return items.length; },
    setEnabled(on) { enabled = on; group.visible = on; if (!on) this.clear(); },
    // start / end: checker positions in the parent's coordinates
    add(start, end) {
      if (!enabled) return;
      const dist = start.distanceTo(end);
      const mid = start.clone().lerp(end, 0.5);
      mid.y += 1.6 + dist * 0.05 + 1.2;
      const s = start.clone(); s.y += 0.2;
      const e = end.clone(); e.y += 0.2;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(s, mid, e), 28, 0.3, 8, false), tubeMat);
      tube.renderOrder = 5;
      const to = new THREE.Mesh(ringGeo, toMat); to.position.set(end.x, 0.07, end.z); to.scale.setScalar(1.2); to.renderOrder = 4;
      const from = new THREE.Mesh(ringGeo, fromMat); from.position.set(start.x, 0.065, start.z); from.renderOrder = 4;
      group.add(tube, to, from);
      items.push(tube, to, from);
      hold = Infinity; age = 0; setOpacity(1);
    },
    // the turn is over: stay for `seconds`, then fade out
    release(seconds = 4) { if (items.length) { hold = seconds; age = 0; } },
    clear() {
      for (const m of items) { group.remove(m); if (m.geometry !== ringGeo) m.geometry.dispose(); }
      items = []; hold = Infinity; age = 0; setOpacity(1);
    },
    update(dt) {
      if (!items.length || hold === Infinity) return;
      age += dt;
      if (age <= hold) return;
      const o = 1 - (age - hold) / FADE;
      if (o <= 0) this.clear(); else setOpacity(o * o);
    },
  };
}

// ---------------------------------------------------------------- win confetti
const PALETTE = [0xf0c46e, 0xfff2d6, 0xc2402e, 0x3fa58a, 0x4a78c8, 0xe8a0b8];
const MAX = 320;

export function createConfetti(scene, { tableY = 0, fx = 20, fz = 22 } = {}) {
  const geo = new THREE.PlaneGeometry(1.1, 0.66);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 6;
  scene.add(mesh);
  const col = new THREE.Color();
  const P = Array.from({ length: MAX }, () => ({ on: false, delay: 0, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, s: 1, landed: false, calm: false }));
  const dummy = new THREE.Object3D();
  let active = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function free() { return P.find((p) => !p.on); }
  function spawn(p, init) {
    Object.assign(p, { on: true, age: 0, landed: false, s: rnd(0.8, 1.25), rx: rnd(0, 6.28), ry: rnd(0, 6.28), rz: rnd(0, 6.28) }, init);
    const i = P.indexOf(p);
    mesh.setColorAt(i, col.setHex(PALETTE[(Math.random() * PALETTE.length) | 0]));
    mesh.instanceColor.needsUpdate = true;
    mesh.visible = true;
  }

  // a volley from a cannon at one side of the board, aimed across and up
  function volley(sx, n, delay) {
    for (let k = 0; k < n; k++) {
      const p = free(); if (!p) return;
      spawn(p, {
        delay: delay + Math.random() * 0.25, life: rnd(4.6, 6.4), calm: false,
        x: sx * (fx + 6), y: tableY + rnd(1, 3), z: rnd(fz - 2, fz + 6),
        vx: -sx * rnd(14, 44), vy: rnd(26, 44), vz: -rnd(8, 30),
        wx: rnd(-9, 9), wy: rnd(-9, 9), wz: rnd(-9, 9),
      });
    }
  }
  // reduced motion: a slow fall over the board, no spin, fewer pieces
  function drizzle(n) {
    for (let k = 0; k < n; k++) {
      const p = free(); if (!p) return;
      spawn(p, {
        delay: Math.random() * 1.6, life: rnd(6, 8), calm: true,
        x: rnd(-fx, fx), y: tableY + rnd(20, 32), z: rnd(-fz, fz),
        vx: rnd(-0.6, 0.6), vy: -rnd(3.5, 5.5), vz: rnd(-0.6, 0.6), wx: 0, wy: 0, wz: 0,
      });
    }
  }

  return {
    get active() { return active > 0; },
    // kind: 'win' | 'mars' | 'match'. Returns the number of pieces launched (for tests).
    burst(kind = 'win') {
      const before = P.filter((p) => p.on).length;
      if (reducedMotion()) drizzle(kind === 'win' ? 110 : 170);
      else if (kind === 'win') { volley(-1, 80, 0); volley(1, 80, 0.05); }
      else if (kind === 'mars') { volley(-1, 90, 0); volley(1, 90, 0.05); volley(-1, 50, 0.7); volley(1, 50, 0.75); }
      else { volley(-1, 90, 0); volley(1, 90, 0.05); volley(-1, 70, 0.8); volley(1, 70, 0.85); }
      return P.filter((p) => p.on).length - before;
    },
    clear() { for (const p of P) p.on = false; active = 0; mesh.visible = false; },
    update(dt) {
      if (!mesh.visible) return;
      active = 0;
      const g = 34;
      for (let i = 0; i < MAX; i++) {
        const p = P[i];
        if (!p.on) { dummy.scale.setScalar(0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); continue; }
        active++;
        if (p.delay > 0) { p.delay -= dt; dummy.scale.setScalar(0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); continue; }
        p.age += dt;
        if (p.age >= p.life) { p.on = false; dummy.scale.setScalar(0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); continue; }
        if (!p.landed) {
          // paper: gravity against heavy air drag, so it hangs and drifts instead of dropping
          const drag = p.calm ? 0.6 : 1.3;
          p.vy -= (p.calm ? 4 : g) * dt;
          const k = Math.exp(-drag * dt);
          p.vx *= k; p.vz *= k;
          if (p.vy < -(p.calm ? 5.5 : 9)) p.vy += (-(p.calm ? 5.5 : 9) - p.vy) * Math.min(1, 6 * dt); // terminal speed
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
          if (p.y <= tableY + 0.05) { p.y = tableY + 0.05; p.landed = true; p.rx = -Math.PI / 2; p.ry = 0; }
        }
        // shrink away over the last second
        const left = p.life - p.age, sc = p.s * (left < 1 ? left : 1);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx, p.ry, p.rz);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (!active) mesh.visible = false;
    },
  };
}
