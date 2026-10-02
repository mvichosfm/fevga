// Independent legality audit of src/engine.js: node test/legality.mjs [selfplayGames=60] [synthetic=1500]
//
// A second, from-scratch implementation of the Fevga rules (the REFERENCE below) works on the
// absolute board and a per-player path index, shares no code or numbering with the engine,
// and finds every legal full play by brute force over every die order. For each test position
// and each of the 21 rolls it checks that
//   1. engine.finalPositions (what the computer chooses from) = the reference's legal plays,
//   2. clicking step by step through createTurn / turnSteps / turnPlay (what the human does)
//      reaches exactly the same final positions, every offered step is a legal single move,
//      its drawn from/to squares are right, and no partial turn is a dead end,
//   3. the number of dice the turn must play (T.M) is the reference's maximum.
// Then a set of hand-worked cases checks the reference itself against answers written out
// from the rules, so the two implementations cannot simply share a misreading.
//
// Rules (bkgm.com "Fevga" / Condos; Wikipedia "Fevga"), plus this game's house decisions on the
// six-in-a-row rules (listed in the src/engine.js header, 2026-10-02):
//  - 15 checkers each on the far-right corner point, diagonally opposite; both move counter-
//    clockwise. White: abs 23 -> 0, black: abs 11 -> 0 -> 23 -> 12. Home = last six points.
//  - No hitting: a point holding any opposing checker is closed.
//  - Your first checker must pass the opponent's starting point before any other checker moves.
//  - Play both dice if possible, doubles four times, as many as possible; if only one die can be
//    played, the larger when possible.
//  - Bear off once all 15 are home (or off): exact die, or a higher die from the highest point.
//  - Never end a move holding all six points of your own starting quarter (house: judged at the
//    END of the play; passing over the last open point mid-play is fine).
//  - Six in a row elsewhere is allowed (house), but if every opposing checker on the board is on
//    the one point right behind six of your points in a row, your play must open one of them
//    when a play with the most dice (and larger die) can (house: otherwise the duty lapses).
//  - Win 1 point; 2 (mars) if the loser has borne nothing off.
// FEVGA_ENGINE=<path> runs the audit against another copy of the engine (used to check that the
// audit catches deliberately broken rules).
const E = await import(process.env.FEVGA_ENGINE ? new URL('file:///' + process.env.FEVGA_ENGINE.replace(/\\/g, '/')).href : '../src/engine.js');
const { newGame, viewOf, expandDice, finalPositions, createTurn, turnSteps, turnPlay, turnDone, winner, chooseMove } = E;

// how often each rare rule actually changed the answer (so "0 failed" means "tested", not "never hit")
const bound = { largerDie: 0, unblock: 0, unblockLapsed: 0, quarter: 0, runnerOnly: 0, higherDieOff: 0, noMove: 0, partial: 0 };

let fails = 0, passes = 0;
const failMsgs = new Map();
function ok(cond, msg) {
  if (cond) { passes++; return true; }
  fails++;
  const k = msg.split(':')[0];
  failMsgs.set(k, (failMsgs.get(k) || 0) + 1);
  if (failMsgs.get(k) <= 5) console.log('FAIL:', msg);
  return false;
}

// ================================================================= reference implementation
// state: { c: [Int8Array(24), Int8Array(24)] checkers by path index (0 = start, 18..23 home),
//          off: [n, n] }
const pathAbs = (p, i) => (p === 0 ? 23 - i : (35 - i) % 24);
const idxOf = (p, a) => (p === 0 ? 23 - a : (35 - a) % 24);
const holds = (st, p, a) => st.c[p][idxOf(p, a)] > 0;
const keyRef = (st, p) => Array.from(st.c[p]).join(',') + '|' + st.off[p];
const cloneSt = (st) => ({ c: [Int8Array.from(st.c[0]), Int8Array.from(st.c[1])], off: st.off.slice() });

function hasPassed(st, p) {
  if (st.off[p] > 0) return true;
  for (let i = 13; i < 24; i++) if (st.c[p][i]) return true; // beyond the opponent's start (my index 12)
  return false;
}
// one checker from path index i with die d: returns the target index (24 = off) or -1
const flags = { runner: false, higher: false };
function refStep(st, p, i, d) {
  if (!(st.c[p][i] > 0)) return -1;
  if (!hasPassed(st, p)) {
    let away = 0;
    for (let j = 1; j <= 12; j++) away += st.c[p][j];
    if (away ? i === 0 : i !== 0) { flags.runner = true; return -1; } // only the first checker
  }
  const j = i + d;
  if (j <= 23) return holds(st, 1 - p, pathAbs(p, j)) ? -1 : j;
  for (let k = 0; k < 18; k++) if (st.c[p][k]) return -1; // not all home
  if (j === 24) return 24;
  for (let k = 18; k < i; k++) if (st.c[p][k]) return -1; // a checker on a higher point
  flags.higher = true;
  return 24;
}
function applyRef(st, p, i, j) {
  const n = cloneSt(st);
  n.c[p][i]--;
  if (j === 24) n.off[p]++; else n.c[p][j]++;
  return n;
}
const quarterFullRef = (st, p) => { for (let i = 0; i < 6; i++) if (!st.c[p][i]) return false; return true; };

// the unblocking duty at the start of p's turn: the six abs points p must open one of, or null
function trapAbs(st, p) {
  const q = 1 - p;
  let k = -1;
  for (let i = 0; i < 24; i++) if (st.c[q][i]) { if (k >= 0) return null; k = i; }
  if (k < 0 || k + 6 > 23) return null;
  const six = [];
  for (let m = 1; m <= 6; m++) { const a = pathAbs(q, k + m); if (!holds(st, p, a)) return null; six.push(a); }
  return six;
}

// every legal full play: Map finalKey -> { st, n, firstDie }
function refPlays(st0, p, dice) {
  const orders = dice[0] === dice[1] ? [[dice[0], dice[0], dice[0], dice[0]]] : [[dice[0], dice[1]], [dice[1], dice[0]]];
  const ends = new Map(); // key -> {st, n, dies:Set}
  let quarterBlocked = false;
  flags.runner = flags.higher = false;
  const visit = (st, order, n, first) => {
    if (quarterFullRef(st, p)) quarterBlocked = true;
    else {
      const k = keyRef(st, p);
      const e = ends.get(k) || { st, n, dies: new Set() };
      if (n > e.n) { e.n = n; e.dies = new Set(); }
      if (n === e.n && n > 0) e.dies.add(first);
      ends.set(k, e);
    }
    if (n === order.length) return;
    const d = order[n];
    for (let i = 0; i < 24; i++) {
      const j = refStep(st, p, i, d);
      if (j >= 0) visit(applyRef(st, p, i, j), order, n + 1, n === 0 ? d : first);
    }
  };
  for (const o of orders) visit(st0, o, 0, 0);
  let max = 0;
  for (const e of ends.values()) max = Math.max(max, e.n);
  let plays = [...ends.entries()].filter(([, e]) => e.n === max);
  if (max === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(...dice);
    if (plays.some(([, e]) => e.dies.has(hi))) {
      const n0 = plays.length;
      plays = plays.filter(([, e]) => e.dies.has(hi));
      if (plays.length < n0) bound.largerDie++;
    }
  }
  const six = trapAbs(st0, p);
  if (six && max > 0) {
    const opened = plays.filter(([, e]) => six.some((a) => !holds(e.st, p, a)));
    if (opened.length && opened.length < plays.length) bound.unblock++;
    if (!opened.length) bound.unblockLapsed++;
    if (opened.length) plays = opened;
  }
  if (max === 0) bound.noMove++;
  else if (max < (dice[0] === dice[1] ? 4 : 2)) bound.partial++;
  if (quarterBlocked) bound.quarter++;
  if (flags.runner) bound.runnerOnly++;
  if (flags.higher) bound.higherDieOff++;
  return { max, keys: new Set(plays.map(([k]) => k)) };
}

// ================================================================= engine <-> reference
function toGame(st) {
  const g = { pos: [new Int8Array(25), new Int8Array(25)], off: st.off.slice() };
  for (let p = 0; p < 2; p++) for (let i = 0; i < 24; i++) g.pos[p][24 - i] = st.c[p][i];
  return g;
}
function toSt(g) {
  const st = { c: [new Int8Array(24), new Int8Array(24)], off: g.off.slice() };
  for (let p = 0; p < 2; p++) for (let r = 1; r <= 24; r++) st.c[p][24 - r] = g.pos[p][r];
  return st;
}
const keyEng = (mine, off) => { const a = []; for (let i = 0; i < 24; i++) a.push(mine[24 - i]); return a.join(',') + '|' + off; };

const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b]);
const cloneT = (T) => ({ ...T, dice: T.dice.slice(), v: { mine: Int8Array.from(T.v.mine), opp: Int8Array.from(T.v.opp), myOff: T.v.myOff, oppOff: T.v.oppOff }, rem: T.rem.slice(), played: T.played.slice() });

let checked = 0;
function compare(st, p, dice, label) {
  checked++;
  const tag = `${label} p${p} ${dice}`;
  const ref = refPlays(st, p, dice);
  const g = toGame(st);
  // 1. full-play enumeration (the computer's move list)
  const fin = finalPositions(viewOf(g, p), expandDice(dice));
  const engKeys = new Set(fin.map((f) => keyEng(f.mine, f.myOff)));
  if (ref.max === 0) ok(fin.length === 0, `finalPositions should be empty (no legal move): ${tag} got ${fin.length}`);
  else {
    const missing = [...ref.keys].filter((k) => !engKeys.has(k)), extra = [...engKeys].filter((k) => !ref.keys.has(k));
    ok(!missing.length && !extra.length, `finalPositions differs: ${tag} missing ${missing.length} extra ${extra.length} ${missing[0] || ''} ${extra[0] || ''}`);
    // each enumerated play's step list must itself be a legal sequence that reaches its position
    for (const f of fin) {
      let s = st;
      let good = true;
      for (const step of f.steps) {
        const i = 24 - step.r, j = refStep(s, p, i, step.d);
        if (j < 0 || j !== (step.t ? 24 - step.t : 24)) { good = false; break; }
        s = applyRef(s, p, i, j);
      }
      if (!ok(good && keyRef(s, p) === keyEng(f.mine, f.myOff), `finalPositions step list not a legal path: ${tag} ${JSON.stringify(f.steps)}`)) break;
    }
  }
  // 2./3. interactive turn
  const T0 = createTurn(g, p, dice);
  ok(T0.M === ref.max, `T.M wrong: ${tag} M=${T0.M} ref=${ref.max}`);
  const reached = new Set();
  const seen = new Set();
  let bad = 0;
  const walk = (T, s) => {
    const k = keyRef(s, p) + '#' + T.rem.join('');
    if (seen.has(k)) return;
    seen.add(k);
    const steps = turnSteps(T);
    if (turnDone(T)) {
      if (steps.length) bad++, ok(false, `steps offered after the turn is done: ${tag}`);
      reached.add(keyRef(s, p));
      return;
    }
    if (!steps.length) { bad++; ok(false, `dead end mid-turn: ${tag} after ${JSON.stringify(T.played)}`); return; }
    for (const step of steps) {
      const i = 24 - step.r, j = refStep(s, p, i, step.d);
      const jEng = step.t ? 24 - step.t : 24;
      if (j < 0 || j !== jEng) { bad++; ok(false, `illegal single step offered: ${tag} ${JSON.stringify(step)} after ${JSON.stringify(T.played)}`); continue; }
      const toAbs = j === 24 ? -1 : pathAbs(p, j);
      if (step.from !== pathAbs(p, i) || step.to !== toAbs) { bad++; ok(false, `drawn squares wrong: ${tag} ${JSON.stringify(step)}`); }
      const T2 = cloneT(T);
      turnPlay(T2, step);
      walk(T2, applyRef(s, p, i, j));
    }
  };
  walk(cloneT(T0), st);
  if (ref.max === 0) ok(reached.size === 1 && reached.has(keyRef(st, p)) && T0.M === 0, `no-move turn should pass at once: ${tag}`);
  else {
    const missing = [...ref.keys].filter((k) => !reached.has(k)), extra = [...reached].filter((k) => !ref.keys.has(k));
    ok(!missing.length && !extra.length, `clickable plays differ: ${tag} missing ${missing.length} extra ${extra.length} ${missing[0] || ''} ${extra[0] || ''}`);
  }
  if (!bad) passes++;
  return ref;
}

// ================================================================= position sources
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry(20261003);
const ri = (n) => Math.floor(rnd() * n);

// a state is consistent if no abs point holds both colours and each side has 15
function valid(st) {
  for (let a = 0; a < 24; a++) if (holds(st, 0, a) && holds(st, 1, a)) return false;
  for (let p = 0; p < 2; p++) { let n = st.off[p]; for (const x of st.c[p]) n += x; if (n !== 15) return false; }
  return true;
}
// a state the game can actually reach before p moves: p's start quarter is not full (the previous
// play could not end that way), and a side that has not passed has one runner at most
function reachableFor(st, p) {
  if (quarterFullRef(st, p)) return false;
  for (let q = 0; q < 2; q++) if (!hasPassed(st, q)) {
    let away = 0;
    for (let j = 1; j <= 12; j++) away += st.c[q][j];
    if (away > 1) return false;
  }
  return true;
}

function randomSide(kind) {
  const c = new Int8Array(24);
  let off = 0;
  if (kind === 'runner') { // has not passed yet
    c[0] = 15;
    if (rnd() < 0.8) { c[0] = 14; c[1 + ri(12)] = 1; }
    return { c, off };
  }
  if (kind === 'bear') { // everything home, some off
    off = ri(15);
    const pts = 1 + ri(6);
    const which = Array.from({ length: pts }, () => 18 + ri(6));
    for (let k = 0; k < 15 - off; k++) c[which[ri(pts)]]++;
    return { c, off };
  }
  // mid-game: checkers clustered on a few points, at least one past index 12
  const pts = 1 + ri(9);
  const lo = kind === 'late' ? 10 : 0;
  const which = Array.from({ length: pts }, () => lo + ri(24 - lo));
  which[0] = 13 + ri(11);
  for (let k = 0; k < 15; k++) c[which[ri(pts)]]++;
  if (kind === 'late' && rnd() < 0.5) { off = ri(5); for (let k = 0; k < off; k++) { const i = c.findIndex((x, j) => x > 0 && j >= 13); if (i >= 0) c[i]--; else off = k; } }
  return { c, off };
}
function randomState() {
  const kinds = ['runner', 'mid', 'mid', 'late', 'bear'];
  for (let tries = 0; tries < 200; tries++) {
    const a = randomSide(kinds[ri(kinds.length)]), b = randomSide(kinds[ri(kinds.length)]);
    const st = { c: [a.c, b.c], off: [a.off, b.off] };
    if (valid(st)) return st;
  }
  return null;
}
// opponent's whole army on one point k (his path) with p holding the six points in front of it
function trapState(p) {
  const q = 1 - p;
  for (let tries = 0; tries < 500; tries++) {
    const st = { c: [new Int8Array(24), new Int8Array(24)], off: [0, 0] };
    const k = ri(18);
    st.c[q][k] = 15;
    let left = 15;
    for (let m = 1; m <= 6; m++) { const i = idxOf(p, pathAbs(q, k + m)); st.c[p][i]++; left--; }
    while (left > 0) {
      const i = rnd() < 0.5 ? idxOf(p, pathAbs(q, k + 1 + ri(6))) : ri(24);
      if (holds(st, q, pathAbs(p, i))) continue;
      st.c[p][i]++; left--;
    }
    if (valid(st) && reachableFor(st, p) && trapAbs(st, p)) return st;
  }
  return null;
}

// ================================================================= hand-worked cases
// Each states the expected answer from the rules, independently of both implementations.
const W = 0, B = 1;
function stFrom(white, black, offW = 0, offB = 0) { // keys = own path index (0 = start)
  const st = { c: [new Int8Array(24), new Int8Array(24)], off: [offW, offB] };
  for (const [i, n] of Object.entries(white)) st.c[0][i] = n;
  for (const [i, n] of Object.entries(black)) st.c[1][i] = n;
  if (!valid(st)) throw new Error('bad fixture');
  return st;
}
const key = (p, cs, off = 0) => { const a = new Array(24).fill(0); for (const [i, n] of Object.entries(cs)) a[i] = n; return a.join(',') + '|' + off; };
function expectPlays(st, p, dice, want, label) {
  const ref = compare(st, p, dice, label);
  const wantSet = new Set(want);
  const same = ref.keys.size === wantSet.size && [...wantSet].every((k) => ref.keys.has(k));
  ok(same || (want.length === 0 && ref.max === 0), `hand case: ${label}: expected ${want.length} plays, reference has ${ref.keys.size} (max ${ref.max})`);
}

function handCases() {
  const start = stFrom({ 0: 15 }, { 0: 15 });
  // first checker: 6-5 from the start moves one checker 11 pips; 6-1 likewise (no second checker)
  expectPlays(start, W, [6, 5], [key(W, { 0: 14, 11: 1 })], 'opening 6-5 = runner to 11');
  expectPlays(start, W, [6, 1], [key(W, { 0: 14, 7: 1 })], 'opening 6-1 = runner to 7 only');
  // 6-6: the runner reaches 6, its next 6 lands on black's start (white index 12) -> one die only
  expectPlays(start, W, [6, 6], [key(W, { 0: 14, 6: 1 })], 'opening 6-6 plays one six');
  // 3-3: 3, 6, 9, then 12 = black's start: three dice
  expectPlays(start, W, [3, 3], [key(W, { 0: 14, 9: 1 })], 'opening 3-3 plays three');
  // 4-4: 4, 8, then 12 closed: two dice
  expectPlays(start, W, [4, 4], [key(W, { 0: 14, 8: 1 })], 'opening 4-4 plays two');
  // 5-5: 5, 10, 15 (passed black's start), 20 - or after 15 a second checker 0->5
  expectPlays(start, W, [5, 5], [key(W, { 0: 14, 20: 1 }), key(W, { 0: 13, 15: 1, 5: 1 })], 'opening 5-5 escapes, then any checker');
  // black's opening mirrors white's (its path index 12 = white's start, abs 23)
  expectPlays(start, B, [6, 6], [key(B, { 0: 14, 6: 1 })], 'black opening 6-6 plays one six');

  // runner passes black's start mid-turn with the first die, then another checker may use the second
  {
    const st = stFrom({ 0: 14, 10: 1 }, { 0: 15 });
    expectPlays(st, W, [4, 2], [
      key(W, { 0: 14, 16: 1 }),          // runner 10->14->16 (or 12 closed: 10->12 illegal, so 4 first)
      key(W, { 0: 13, 14: 1, 2: 1 }),    // runner 10->14 passes, then a new checker 0->2
    ], 'runner passes with one die, the other die may start a new checker');
  }

  // no hitting / closed points: white runner on 3 facing black checkers on white 4..9; 1-1 has no move
  {
    const blk = {}; for (let i = 4; i <= 9; i++) blk[idxOf(B, pathAbs(W, i))] = 2;
    blk[idxOf(B, pathAbs(W, 9))] += 3;
    const st = stFrom({ 0: 14, 3: 1 }, blk);
    expectPlays(st, W, [1, 1], [], 'a single opposing checker closes the point: no move');
    expectPlays(st, W, [6, 1], [], 'runner behind a 6-wall with 6-1: no move (and no other checker may start)');
  }

  // larger die: only one die can be played, both are playable alone -> must play the larger.
  // White (passed) has one checker on 13 and 14 at home on 18..; black closes 16, 17, 19.
  {
    const bl = {};
    for (const i of [16, 17, 19]) bl[idxOf(B, pathAbs(W, i))] = 1;
    bl[idxOf(B, pathAbs(W, 2))] = 12;
    const st = stFrom({ 13: 1, 20: 7, 21: 7 }, bl);
    // dice 5-2: 13->18 (5) then nothing can play 2? 18->20 open... make it concrete via the reference
    compare(st, W, [5, 2], 'larger-die probe');
  }
  // the classic larger-die case: one checker left, 13; black on 15, 16 (block 13+2, 13+3) and 21
  // dice 3-2: the 2 (13->15) and 3 (13->16) are closed... use 4-2 instead: 13->17 open, 13->15 closed
  {
    const bl = {};
    for (const i of [15, 21]) bl[idxOf(B, pathAbs(W, i))] = 1;
    bl[idxOf(B, pathAbs(W, 3))] = 13;
    const st = stFrom({ 13: 1, 22: 14 }, bl);
    // 6-2: the 2 first is impossible (13->15 closed; 22->24 would bear off with 13 not home).
    // 13->19 brings the last checker home, so the 2 then bears off exactly from 22.
    expectPlays(st, W, [6, 2], [key(W, { 19: 1, 22: 13 }, 1)], 'last checker home with the 6, the 2 then bears off');
    // 5-1: 13->18->19, 13->14->19 (same end), or 13->18 + 22->23 (= 22->23 + 13->18)
    expectPlays(st, W, [5, 1], [key(W, { 19: 1, 22: 14 }), key(W, { 18: 1, 22: 13, 23: 1 })], '5-1 must play both dice');
  }
  // larger die when either single die is playable but not both: checker on 16, black on 19 and 22
  // dice 6-3: 16->22 closed; 16->19 closed. Other checkers: 20 x14 -> 20+3=23 ok, 20+6 = off? not all home (16).
  // so 3 with a 20 (20->23), then 6? nothing. -> only the 3 plays.
  {
    const bl = {};
    for (const i of [19, 22]) bl[idxOf(B, pathAbs(W, i))] = 1;
    bl[idxOf(B, pathAbs(W, 5))] = 13;
    const st = stFrom({ 16: 1, 20: 14 }, bl);
    expectPlays(st, W, [6, 3], [key(W, { 16: 1, 20: 13, 23: 1 })], 'only the smaller die can play: play it');
  }
  // white 17 x1, 20 x14; black on 21, 22, 23.
  // 4-1: the 4 first cannot play (17->21 closed, 20->24 not all home); 17->18 brings everyone
  // home, then the 4 bears off exactly from 20.
  {
    const bl = {};
    for (const i of [21, 22, 23]) bl[idxOf(B, pathAbs(W, i))] = 1;
    bl[idxOf(B, pathAbs(W, 6))] = 12;
    const st = stFrom({ 17: 1, 20: 14 }, bl);
    expectPlays(st, W, [4, 1], [key(W, { 18: 1, 20: 13 }, 1)], 'the 1 brings the last checker home, the 4 bears off');
    expectPlays(st, W, [6, 1], [key(W, { 20: 14 }, 1)], 'last checker comes home, then bears off with the 6');
    // 6-2: 17->19 (2), then 6 from 19 = off (19+6=25 > 24: higher die from the highest point, 19 is highest)
    // or 20->22 closed. Also 17->23 closed for the 6 first. -> 17->19->off.
    expectPlays(st, W, [6, 2], [key(W, { 20: 14 }, 1)], 'higher die bears off from the highest point');
  }

  // bearing off
  {
    const st = stFrom({ 18: 2, 22: 3, 23: 5 }, { 3: 15 }, 5);
    // 6-6 exactly from 18 twice, then two more sixes: highest is now 22 -> 22 off (higher die), twice
    expectPlays(st, W, [6, 6], [key(W, { 22: 1, 23: 5 }, 9)], 'bear off 6-6: exact, then higher from the highest');
    // 1-1: four ones: 23 off x4, or moves inside; many plays - just compare
    compare(st, W, [1, 1], 'bear off 1-1');
    // 3-2 with a checker on 18: the 3 cannot bear off from 22 (higher point 18 occupied, 22+3=25 > 24)
    // legal: 18->21, 18->20, 22->24(off with 2), 21->24, ...
    const ref = refPlays(st, W, [3, 2]);
    ok(![...ref.keys].includes(key(W, { 18: 2, 22: 2, 23: 4 }, 7)), 'hand case: higher die may not bear off while a higher point is held');
    compare(st, W, [3, 2], 'bear off 3-2');
  }
  {
    // not all home: one checker on 17 -> no bearing off even with checkers on 23
    const st = stFrom({ 17: 1, 23: 14 }, { 3: 15 });
    // 6-6: 17->23, now all home on 23: three higher sixes bear off from the highest point
    expectPlays(st, W, [6, 6], [key(W, { 23: 12 }, 3)], 'last checker home, then 6s bear off');
    // 2-2: 17->19->21->23 or 17->19 then ones from 23 bear off... (2 from 23 = higher die: 19/21 occupied?)
    compare(st, W, [2, 2], 'bear-off after coming home 2-2');
    const ref = refPlays(st, W, [5, 5]);
    // 5-5: 17->22 (all home), then 5s: 22->27 higher die, but 22 is the highest point -> off; then
    // 23+5 higher, 23 highest -> off x2. A play bearing off before 17 moved does not exist.
    ok(ref.keys.size === 1 && ref.keys.has(key(W, { 23: 12 }, 3)), `hand case: 5-5 from 17: ${[...ref.keys]}`);
    compare(st, W, [5, 5], 'bear-off after coming home 5-5');
  }

  // starting quarter: white holds start-quarter indices 0,1,3,4,5 (his points 24,23,21,20,19); 2 open.
  // Black far away. 2-2: 0->2->4 passes over 2 (legal at the end, 2 open again); 0->2 alone and stop
  // would fill the quarter -> only allowed if the next die reopens it.
  {
    const st = stFrom({ 0: 5, 1: 1, 3: 1, 4: 1, 5: 1, 14: 6 }, { 8: 15 });
    const ref = compare(st, W, [2, 2], 'start quarter 2-2');
    for (const k of ref.keys) {
      const c = k.split('|')[0].split(',').map(Number);
      ok(!(c[0] && c[1] && c[2] && c[3] && c[4] && c[5]), 'hand case: no play may end with the start quarter full');
    }
    // 2-1 with only start-quarter checkers able to move? also compare
    compare(st, W, [2, 1], 'start quarter 2-1');
    compare(st, W, [1, 1], 'start quarter 1-1');
  }

  // unblocking: black's 15 all on its index 5; white holds the six points in front of it (black 6..11)
  {
    const wh = {};
    for (let m = 1; m <= 6; m++) wh[idxOf(W, pathAbs(B, 5 + m))] = 2;
    wh[idxOf(W, pathAbs(B, 11))] += 3;
    const st = stFrom(wh, { 5: 15 });
    ok(trapAbs(st, W), 'hand case: trap detected');
    for (const d of ROLLS) {
      const ref = compare(st, W, d, 'unblock');
      // with 2+ checkers on most wall points, opening needs the single... here every wall point has 2+,
      // so a play opens the wall only by moving both checkers off one point
      ok(ref.max === 0 || [...ref.keys].length > 0, 'hand case: unblock has plays');
    }
  }

  // unblocking duty that LAPSES: white all home holding his 1..6 (path 23..18) as 1, 2, 3, 3, 3, 3;
  // black's 15 wait on white's 7 (path 17), right behind that six. A 6-5 cannot empty any point
  // (the 1 leaves only with a 1, the 2 only with a 2 or a 1, the rest hold 3), so the play is free;
  // a 1-1 can empty the 1, so every play must.
  {
    const st = stFrom({ 23: 1, 22: 2, 21: 3, 20: 3, 19: 3, 18: 3 }, { [idxOf(B, pathAbs(W, 17))]: 15 });
    const six = trapAbs(st, W);
    ok(six && six.length === 6, 'hand case: lapse fixture is a trap');
    const r65 = compare(st, W, [6, 5], 'unblock lapses 6-5');
    ok(r65.max === 2 && [...r65.keys].every((k) => { const c = k.split('|')[0].split(',').map(Number); return c.slice(18).every((x) => x > 0); }),
      'hand case: 6-5 cannot open the wall, every play keeps it (duty lapses)');
    ok(r65.keys.has(key(W, { 23: 1, 22: 2, 21: 3, 20: 3, 19: 2, 18: 2 }, 2)), 'hand case: 6-5 bearing off from 6 and 5 is allowed');
    const r11 = compare(st, W, [1, 1], 'unblock binds 1-1');
    ok(r11.max === 4 && [...r11.keys].every((k) => k.split('|')[0].split(',').map(Number).slice(18).some((x) => x === 0)),
      'hand case: 1-1 can open the wall, so every play opens it');
    // a 2-1: the 1 bears the single checker off point 1 -> opens; plays that keep it closed are refused
    const r21 = compare(st, W, [2, 1], 'unblock binds 2-1');
    ok([...r21.keys].every((k) => k.split('|')[0].split(',').map(Number).slice(18).some((x) => x === 0)), 'hand case: 2-1 must open the wall');
  }

  // scoring
  {
    const g = toGame(stFrom({}, { 20: 15 }, 15, 0));
    const w = winner(g);
    ok(w && w.p === 0 && w.points === 2, 'hand case: mars = 2 points');
    const g2 = toGame(stFrom({}, { 20: 14 }, 15, 1));
    ok(winner(g2).points === 1, 'hand case: single win = 1 point');
    ok(winner(toGame(stFrom({ 23: 1 }, { 20: 14 }, 14, 1))) === null, 'hand case: no winner before 15 off');
  }
}

// ================================================================= main
const games = +(process.argv[2] || 60), synth = +(process.argv[3] || 1500);
const t0 = Date.now();
handCases();
const afterHand = checked;

// self-play: every position before a turn, with all 21 rolls (both colours, random and level-4 players)
let gamePositions = 0;
for (let gi = 0; gi < games; gi++) {
  const g = newGame();
  const lv = [1, 4][gi % 2], lv2 = [1, 2, 4][gi % 3];
  let p = gi % 2;
  for (let turn = 0; turn < 400 && !winner(g); turn++) {
    const st = toSt(g);
    if (turn % 3 === 0 || turn < 6) { for (const d of ROLLS) compare(st, p, d, `game${gi} turn${turn}`); gamePositions++; }
    const dice = [1 + ri(6), 1 + ri(6)];
    const steps = chooseMove(g, p, dice, p ? lv : lv2, rnd);
    // the computer's chosen play must be one of the reference's legal plays
    const ref = refPlays(st, p, dice);
    let s = st;
    for (const step of steps) s = applyRef(s, p, 24 - step.r, step.t ? 24 - step.t : 24);
    ok(ref.max === 0 ? steps.length === 0 : ref.keys.has(keyRef(s, p)), `computer play illegal: game${gi} turn${turn} ${dice} ${JSON.stringify(steps)}`);
    for (const step of steps) { g.pos[p][step.r]--; if (step.t) g.pos[p][step.t]++; else g.off[p]++; }
    p = 1 - p;
  }
}

// synthetic positions
let synthN = 0;
for (let k = 0; k < synth; k++) {
  const st = randomState();
  if (!st) continue;
  const p = ri(2);
  if (!reachableFor(st, p)) continue;
  synthN++;
  for (const d of ROLLS) compare(st, p, d, `synth${k}`);
}
let trapN = 0;
for (let k = 0; k < Math.max(40, synth / 20); k++) {
  const p = ri(2), st = trapState(p);
  if (!st) continue;
  trapN++;
  for (const d of ROLLS) compare(st, p, d, `trap${k}`);
}

console.log(`hand-worked: ${afterHand} turn checks; self-play: ${gamePositions} positions; synthetic: ${synthN}; trap: ${trapN}`);
console.log(`${checked} position x roll comparisons, ${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log('rules that changed the answer (turns):', JSON.stringify(bound));
if (failMsgs.size) console.log('failure kinds:', Object.fromEntries(failMsgs));
process.exit(fails ? 1 : 0);
