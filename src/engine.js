// Fevga (Φεύγα) rules engine and computer opponent. Pure: no DOM, imported by the
// browser, the AI worker and the node tests.
//
// Coordinates. Each player counts his own path 24 -> 1: point 24 is his starting
// point, 1..6 his home board, 0 = borne off. Both players travel counter-clockwise,
// so one player's point r is the other player's point S(r) = ((r + 11) % 24) + 1
// (the map is its own inverse). A game is { pos: [white, black], off: [w, b] } where
// pos[p][r] counts player p's checkers on his own point r.
// Absolute board points 0..23 (used only for drawing): white r -> r - 1,
// black r -> (r + 11) % 24. White starts on 23 and bears off from 0..5; black starts
// on 11 and bears off from 12..17.
//
// Rules implemented (Greek Fevga, as played in tavli):
// - 15 checkers each, all on the starting point; no hitting.
// - A point holding even one checker belongs to its owner: you cannot land on it.
// - Until one of your checkers has passed the opponent's starting point (your point
//   12), you may only move that first checker.
// - Six (or more) points in a row are allowed anywhere, except:
// - You may never end a move holding all six points of your own starting quarter (your 19..24);
//   passing over the last open one mid-move (e.g. one checker playing both dice) is fine.
// - Unblocking: if at the start of your turn every opponent checker on the board stands on
//   the single point right behind six of your points in a row, your play must open one of
//   those six points. Playing the most dice (and the larger die) comes first; if no such
//   play opens it, the obligation lapses for that turn. (Manos 2026-10-02, replacing a
//   same-day "never six in a row with any opponent behind" rule and, before that, the
//   common "six in a row only once an opponent checker is past it".)
// - Play both dice if possible (four moves on doubles); if only one die can be
//   played it must be the larger one when that is possible.
// - Bear off once all 15 are home; a higher die may bear off from the highest point.
// - Win = 1 point, mars (opponent has borne nothing off) = 2 points.

export const WHITE = 0, BLACK = 1;
export const S = (r) => ((r + 11) % 24) + 1;
export const absOf = (p, r) => (p === WHITE ? r - 1 : (r + 11) % 24);

export function newGame() {
  const w = new Int8Array(25), k = new Int8Array(25);
  w[24] = 15; k[24] = 15;
  return { pos: [w, k], off: [0, 0] };
}

export function cloneGame(g) {
  return { pos: [Int8Array.from(g.pos[0]), Int8Array.from(g.pos[1])], off: g.off.slice() };
}

export const expandDice = (d) => (d[0] === d[1] ? [d[0], d[0], d[0], d[0]] : [d[0], d[1]]);

// A view is a game seen from the side to move: mine / opp in their own numbering.
export function viewOf(g, p) {
  return { mine: Int8Array.from(g.pos[p]), opp: Int8Array.from(g.pos[1 - p]), myOff: g.off[p], oppOff: g.off[1 - p] };
}

// ------------------------------------------------------------------ move legality
function passed(v) {
  if (v.myOff) return true;
  for (let r = 1; r <= 11; r++) if (v.mine[r]) return true;
  return false;
}

function canLeave(v, r) {
  if (passed(v)) return true;
  let away = 0;
  for (let q = 12; q <= 23; q++) away += v.mine[q];
  return away ? r !== 24 : r === 24;
}

function allHome(v) {
  for (let r = 7; r <= 24; r++) if (v.mine[r]) return false;
  return true;
}

// Target of moving a checker from r with die d (0 = bear off), or -1. Ignores the prime rule.
function stepTarget(v, r, d) {
  const t = r - d;
  if (t >= 1) return v.opp[S(t)] ? -1 : t;
  if (!allHome(v)) return -1;
  if (t === 0) return 0;
  for (let q = r + 1; q <= 6; q++) if (v.mine[q]) return -1;
  return 0;
}

// Do I hold all six points of my own starting quarter (19..24)? That is the only six-in-a-row
// that is ever illegal. It is judged on the position a move ENDS in, not after each die: a checker
// may pass over the last open point of the quarter on its way somewhere else (Manos 2026-10-02:
// 1->3->5 with two 2s while holding 1, 2, 4, 5, 6).
function quarterFull(v) {
  for (let r = 19; r <= 24; r++) if (!v.mine[r]) return false;
  return true;
}

// Unblocking rule. The opponent is trapped when every one of his checkers on the board stands
// on one point s (his numbering) and I hold the six points right in front of it (his s-1..s-6).
// Returns that s, or 0. Points are counted along HIS path, which is not contiguous with mine
// across my 12/13.
export function trapPoint(v) {
  let s = 0;
  for (let q = 1; q <= 24; q++) {
    if (!v.opp[q]) continue;
    if (s) return 0; // checkers on two points: not all on one
    s = q;
  }
  if (s < 7) return 0;
  for (let k = 1; k <= 6; k++) if (!v.mine[S(s - k)]) return 0;
  return s;
}
// Is one of the six points in front of his point s open (not mine) in view v?
const wallOpen = (v, s) => { for (let k = 1; k <= 6; k++) if (!v.mine[S(s - k)]) return true; return false; };

// Can the remaining dice play exactly `need` more steps and end with the wall in front of s open?
function canEndOpen(v, rem, need, s) {
  if (need === 0) return !quarterFull(v) && wallOpen(v, s);
  for (let i = 0; i < rem.length; i++) {
    const d = rem[i];
    if (rem.indexOf(d) !== i) continue;
    const rest = without(rem, i);
    for (let r = 24; r >= 1; r--) {
      const t = tryStep(v, r, d);
      if (t < 0) continue;
      const ok = canEndOpen(v, rest, need - 1, s);
      undoStep(v, r, t);
      if (ok) return true;
    }
  }
  return false;
}

function undoStep(v, r, t) {
  v.mine[r]++;
  if (t) v.mine[t]--; else v.myOff--;
}

// Applies the step and returns its target, or returns -1 and leaves v untouched.
function tryStep(v, r, d) {
  if (!v.mine[r] || !canLeave(v, r)) return -1;
  const t = stepTarget(v, r, d);
  if (t < 0) return -1;
  v.mine[r]--;
  if (t) v.mine[t]++; else v.myOff++;
  return t;
}

const without = (arr, i) => arr.slice(0, i).concat(arr.slice(i + 1));

// Most dice that can still be played from v, counting only plays that END with the starting
// quarter not full (-Infinity if even stopping here is illegal and no die can fix it).
function maxPlay(v, rem) {
  let best = quarterFull(v) ? -Infinity : 0;
  if (!rem.length) return best;
  for (let i = 0; i < rem.length; i++) {
    const d = rem[i];
    if (rem.indexOf(d) !== i) continue;
    const rest = without(rem, i);
    for (let r = 24; r >= 1; r--) {
      const t = tryStep(v, r, d);
      if (t < 0) continue;
      const n = 1 + maxPlay(v, rest);
      undoStep(v, r, t);
      if (n > best) { best = n; if (best === rem.length) return best; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ interactive turn
// A turn the UI plays one checker step at a time; every step offered keeps the
// maximum number of dice playable, so a finished turn is always a legal play.
// mustOpen = the opponent's trapped point s when the unblocking rule binds this turn (else 0).
export function createTurn(g, p, dice) {
  const v = viewOf(g, p);
  const rem = expandDice(dice);
  const s = trapPoint(v);
  const mustOpen = s && finalPositions(v, rem).some((f) => f.opened) ? s : 0;
  return { p, dice: dice.slice(), v, rem, M: maxPlay(v, rem), played: [], mustOpen };
}

export function turnDone(T) { return T.played.length >= T.M; }

export function turnSteps(T) {
  const need = T.M - T.played.length;
  if (need <= 0) return [];
  const out = [];
  const { v, rem } = T;
  for (let i = 0; i < rem.length; i++) {
    const d = rem[i];
    if (rem.indexOf(d) !== i) continue;
    const rest = without(rem, i);
    for (let r = 24; r >= 1; r--) {
      const t = tryStep(v, r, d);
      if (t < 0) continue;
      const n = 1 + maxPlay(v, rest);
      undoStep(v, r, t);
      if (n >= need) out.push({ r, t, d, from: absOf(T.p, r), to: t ? absOf(T.p, t) : -1 });
    }
  }
  // Only one die playable in total: it must be the larger one if that is possible.
  let res = out;
  if (T.M === 1 && rem.length === 2 && rem[0] !== rem[1]) {
    const hi = Math.max(rem[0], rem[1]);
    if (out.some((s) => s.d === hi)) res = out.filter((s) => s.d === hi);
  }
  // Unblocking rule: only steps after which the play can still end with the wall open.
  if (T.mustOpen) {
    res = res.filter((st) => {
      const i = rem.indexOf(st.d);
      tryStep(v, st.r, st.d);
      const ok = canEndOpen(v, without(rem, i), need - 1, T.mustOpen);
      undoStep(v, st.r, st.t);
      return ok;
    });
  }
  return res;
}

export function turnPlay(T, step) {
  const legal = turnSteps(T).find((s) => s.r === step.r && s.d === step.d);
  if (!legal) throw new Error(`illegal step ${JSON.stringify(step)}`);
  tryStep(T.v, legal.r, legal.d);
  T.rem.splice(T.rem.indexOf(legal.d), 1);
  T.played.push(legal);
  return legal;
}

// Writes a finished (or partial) turn back into the game.
export function commitTurn(g, T) {
  g.pos[T.p] = Int8Array.from(T.v.mine);
  g.off[T.p] = T.v.myOff;
}

// Applies a recorded play ({r, t, d} steps, own numbering; t = 0 bears off) to game g.
// Used to rebuild positions when replaying saved games; the steps were legal when recorded.
export function applySteps(g, p, steps) {
  for (const s of steps) {
    g.pos[p][s.r]--;
    if (s.t) g.pos[p][s.t]++; else g.off[p]++;
  }
  return g;
}

export function winner(g) {
  if (g.off[0] === 15) return { p: 0, points: g.off[1] === 0 ? 2 : 1 };
  if (g.off[1] === 15) return { p: 1, points: g.off[0] === 0 ? 2 : 1 };
  return null;
}

export const pips = (g, p) => { let s = 0; for (let r = 1; r <= 24; r++) s += r * g.pos[p][r]; return s; };

// ------------------------------------------------------------------ full-turn enumeration
const keyOf = (mine, off) => String.fromCharCode.apply(null, mine) + off;

// Every distinct position reachable with a legal full play, with one step list each.
// `trap` = the opponent point the unblocking rule is measured against; it defaults to the
// trap in v, which is right at the start of a turn (callers mid-turn pass the turn's own).
export function finalPositions(v, rem, trap = trapPoint(v)) {
  const leaves = new Map();
  const seen = new Set();
  let maxLen = 0;
  const steps = [];
  const rec = (rest) => {
    const k = keyOf(v.mine, v.myOff) + '|' + rest.join('');
    if (seen.has(k)) return;
    seen.add(k);
    for (let i = 0; i < rest.length; i++) {
      const d = rest[i];
      if (rest.indexOf(d) !== i) continue;
      const after = without(rest, i);
      for (let r = 24; r >= 1; r--) {
        const t = tryStep(v, r, d);
        if (t < 0) continue;
        steps.push({ r, t, d });
        rec(after);
        steps.pop();
        undoStep(v, r, t);
      }
    }
    // Every legal stopping position is a candidate; the longest ones are kept below.
    if (steps.length && !quarterFull(v)) {
      const fk = keyOf(v.mine, v.myOff);
      if (steps.length > maxLen) maxLen = steps.length;
      const prev = leaves.get(fk);
      if (!prev || prev.steps.length < steps.length) {
        leaves.set(fk, { steps: steps.slice(), mine: Int8Array.from(v.mine), myOff: v.myOff, n: steps.length });
      }
    }
  };
  rec(rem);
  let out = [...leaves.values()].filter((l) => l.n === maxLen);
  if (maxLen === 1 && rem.length === 2 && rem[0] !== rem[1]) {
    const hi = Math.max(rem[0], rem[1]);
    if (out.some((l) => l.steps[0].d === hi)) out = out.filter((l) => l.steps[0].d === hi);
  }
  if (trap) {
    for (const l of out) l.opened = wallOpen({ mine: l.mine }, trap);
    if (out.some((l) => l.opened)) out = out.filter((l) => l.opened);
  }
  return out;
}

// ------------------------------------------------------------------ evaluation
// Score of a position for the side whose view it is, in "pips". Antisymmetric:
// evaluate(flip(v)) === -evaluate(v), which the two-ply search relies on.
// Evaluation parameters (tuned by self-play, see test/tune.mjs):
// mobScale/mobExp shape the penalty for k of the six points ahead of a checker being
// blocked (scale * k^exp); mobCnt adds weight per extra checker on that point (cap 8);
// home scales it for checkers already home; far = blocks 7..12 ahead; prime scales the
// bonus for consecutive blocking points; off/stack as named.
export function makeWeights(q) {
  const mob = [0], prime = [0, 0, 0.5, 2, 5, 9, 15].map((x) => x * q.prime);
  for (let k = 1; k <= 6; k++) mob.push(q.mobScale * Math.pow(k, q.mobExp));
  return { mob, prime, mobCnt: q.mobCnt, off: q.off, stack: q.stack, home: q.home, far: q.far };
}
export const PARAMS = {
  basic: { mobScale: 0.4, mobExp: 1.6, mobCnt: 0.15, prime: 0.5, off: 1, stack: 0.2, home: 0.5, far: 0 },
  full: { mobScale: 0.6, mobExp: 1.7, mobCnt: 0.3, prime: 1, off: 1.5, stack: 0.6, home: 0.5, far: 0.2 },
  // test/tune.mjs, 2026-10-01: 3 sweeps x 2000 greedy self-play games; 60.0% of points vs `full`
  tuned: { mobScale: 0.6, mobExp: 1.7, mobCnt: 1.0125, prime: 1.5, off: 1.5, stack: 0.6, home: 0.5, far: 0.2 },
};
export const WEIGHTS = { basic: makeWeights(PARAMS.basic), full: makeWeights(PARAMS.full), tuned: makeWeights(PARAMS.tuned) };

const WIN = 10000;

// Penalty for side A's checkers being hemmed in by side B (each in own numbering),
// plus A's blocking runs (primes) against B and A's wasteful stacks.
function sideTerms(A, B, W) {
  let mob = 0;
  for (let r = 2; r <= 24; r++) {
    const c = A[r];
    if (!c) continue;
    let k = 0, far = 0;
    for (let d = 1; d <= 6 && r - d >= 1; d++) if (B[S(r - d)]) k++;
    for (let d = 7; d <= 12 && r - d >= 1; d++) if (B[S(r - d)]) far++;
    if (!k && !far) continue;
    mob += (W.mob[k] + W.far * far) * (1 + W.mobCnt * (Math.min(c, 8) - 1)) * (r <= 6 ? W.home : 1);
  }
  let rear = 0;
  for (let s = 24; s >= 1; s--) if (B[s]) { rear = s; break; }
  let prime = 0, run = 0;
  for (let s = 1; s <= 25; s++) {
    if (s <= 24 && A[S(s)]) { run++; continue; }
    if (run >= 2 && rear > s - 1) prime += W.prime[Math.min(run, 6)];
    run = 0;
  }
  let stack = 0;
  for (let r = 7; r <= 23; r++) if (A[r] > 3) stack += A[r] - 3;
  return { mob, prime, stack };
}

export function evaluate(v, W = WEIGHTS.full) {
  if (v.myOff === 15) return WIN * (v.oppOff === 0 ? 2 : 1);
  if (v.oppOff === 15) return -WIN * (v.myOff === 0 ? 2 : 1);
  let my = 0, op = 0;
  for (let r = 1; r <= 24; r++) { my += r * v.mine[r]; op += r * v.opp[r]; }
  const a = sideTerms(v.mine, v.opp, W);
  const b = sideTerms(v.opp, v.mine, W);
  return (op - my) + W.off * (v.myOff - v.oppOff)
    + (b.mob - a.mob) + (a.prime - b.prime) - W.stack * (a.stack - b.stack);
}

// ------------------------------------------------------------------ computer player
export const LEVELS = [
  { level: 1, name: 'Beginner', blurb: 'Moves at random' },
  { level: 2, name: 'Novice', blurb: 'Counts pips, often careless' },
  { level: 3, name: 'Intermediate', blurb: 'Blocks and races sensibly' },
  { level: 4, name: 'Advanced', blurb: 'Looks one roll ahead' },
  { level: 5, name: 'Expert', blurb: 'Deep look-ahead, no mistakes' },
];

// What each level does: W = evaluation weights, noise = std-dev (pips) added to every
// score, random = chance of a random move, topN = two-ply search over the N best candidates.
const LEVEL_CONFIG = {
  2: { W: WEIGHTS.basic, noise: 5, random: 0.12 },
  3: { W: WEIGHTS.full, noise: 1.5 },
  4: { W: WEIGHTS.tuned, noise: 0 },
  5: { W: WEIGHTS.tuned, noise: 0, topN: 10 },
};

const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ dice: [a, b], w: a === b ? 1 / 36 : 2 / 36 });

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), w = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

const leafView = (v, f) => ({ mine: f.mine, opp: v.opp, myOff: f.myOff, oppOff: v.oppOff });

// Expected score of my position f after the opponent's best (greedy) reply, averaged over his 21 rolls.
function replyValue(v, f, W) {
  if (f.myOff === 15) return evaluate(leafView(v, f), W);
  const ov = { mine: Int8Array.from(v.opp), opp: f.mine, myOff: v.oppOff, oppOff: f.myOff };
  let exp = 0;
  for (const roll of ROLLS) {
    const replies = finalPositions(ov, expandDice(roll.dice));
    let best;
    if (!replies.length) best = evaluate(ov, W);
    else {
      best = -Infinity;
      for (const rep of replies) {
        const s = evaluate({ mine: rep.mine, opp: f.mine, myOff: rep.myOff, oppOff: f.myOff }, W);
        if (s > best) best = s;
      }
    }
    exp -= roll.w * best;
  }
  return exp;
}

/**
 * Picks a full play for player p. Returns the step list ({r, t, d}, own numbering);
 * empty when no move is possible.
 */
export function chooseMove(g, p, dice, level, rnd = Math.random, opts = {}) {
  const v = viewOf(g, p);
  const finals = finalPositions(v, expandDice(dice));
  if (!finals.length) return [];
  if (finals.length === 1 || level <= 1) return finals[Math.floor(rnd() * finals.length)].steps;

  const cfg = { ...LEVEL_CONFIG[level], ...opts };
  if (cfg.random && rnd() < cfg.random) return finals[Math.floor(rnd() * finals.length)].steps;

  const W = cfg.W;
  const scored = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) + (cfg.noise ? gauss(rnd) * cfg.noise : 0) }));
  scored.sort((a, b) => b.s - a.s);
  if (!cfg.topN) return scored[0].f.steps;

  const top = scored.slice(0, cfg.topN);
  let best = top[0], bestV = -Infinity;
  for (const c of top) {
    const val = replyValue(v, c.f, W);
    if (val > bestV) { bestV = val; best = c; }
  }
  return best.f.steps;
}

// ------------------------------------------------------------------ Mr. Makis (level 10 coach)
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

// Longest run of my points standing in front of opponent checkers, in MY numbering.
function longestWall(v) {
  let rear = 0;
  for (let s = 24; s >= 1; s--) if (v.opp[s]) { rear = s; break; }
  let best = { len: 0, from: 0, to: 0 }, run = 0;
  for (let s = 1; s <= 25; s++) {
    if (s <= 24 && v.mine[S(s)] && s < rear) { run++; continue; }
    if (run > best.len) best = { len: run, from: S(s - 1), to: S(s - run) }; // from = nearer my start
    run = 0;
  }
  return best;
}

// Plain facts about a position (side to move = mine) that the coach's explanations quote.
export function positionFacts(v, W = WEIGHTS.tuned) {
  const a = sideTerms(v.mine, v.opp, W), b = sideTerms(v.opp, v.mine, W);
  let myPips = 0, oppPips = 0, points = 0;
  for (let r = 1; r <= 24; r++) { myPips += r * v.mine[r]; oppPips += r * v.opp[r]; if (v.mine[r]) points++; }
  return {
    myPips, oppPips, off: v.myOff, points, passed: passed(v),
    oppHemmed: b.mob, meHemmed: a.mob, stack: a.stack, wall: longestWall(v),
    contact: a.mob + b.mob > 0, eval: evaluate(v, W),
  };
}

// How many opponent checkers still have to pass my point r, and how many sit 1-6 pips behind it.
export function blockReach(v, r) {
  const s0 = S(r);
  let behind = 0, near = 0;
  for (let s = s0 + 1; s <= 24; s++) { behind += v.opp[s]; if (s - s0 <= 6) near += v.opp[s]; }
  return { behind, near };
}

// Plays the game out from view v (opponent to move) with both sides playing the tuned greedy
// policy; returns points won (+) or lost (-) by "mine".
function rollout(v, rnd) {
  const g = { pos: [Int8Array.from(v.mine), Int8Array.from(v.opp)], off: [v.myOff, v.oppOff] };
  let p = 1;
  for (let turn = 0; turn < 600; turn++) {
    const w = winner(g);
    if (w) return w.p === 0 ? w.points : -w.points;
    const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    applySteps(g, p, chooseMove(g, p, d, 4, rnd));
    p = 1 - p;
  }
  return 0;
}

/**
 * Level-10 analysis of the side to move in view v with remaining dice `rem`: two-ply scores
 * for every legal play, then `rollouts` play-outs each (same dice for every candidate) for the
 * best `top`. Returns candidates best first with win rate, equity and position facts.
 */
// `trap`: the unblocking obligation of the turn in progress (createTurn's mustOpen); omit at turn start.
export function analyzeView(v, rem, { top = 4, rollouts = 40, seed = 1, trap } = {}) {
  const W = WEIGHTS.tuned;
  const finals = finalPositions(v, rem, trap === undefined ? trapPoint(v) : trap);
  const base = positionFacts(v, W);
  if (!finals.length) return { base, cands: [], legal: 0 };
  const pre = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) })).sort((x, y) => y.s - x.s).slice(0, 30);
  for (const c of pre) c.ply2 = replyValue(v, c.f, W);
  pre.sort((x, y) => y.ply2 - x.ply2);
  const cands = pre.slice(0, finals.length === 1 ? 1 : top).map((c) => candidate(v, c.f, c.ply2, finals.length > 1 ? rollouts : 0, seed));
  if (finals.length > 1) cands.sort((x, y) => (y.eq - x.eq) || (y.ply2 - x.ply2));
  return { base, cands, legal: finals.length, rollouts, considered: pre.length };
}

// One analysed play: `rollouts` play-outs (seeded per index, so every candidate of a position
// sees the same dice) plus the facts the coach's explanations quote. rollouts 0 = no play-outs.
function candidate(v, f, ply2, rollouts, seed, W = WEIGHTS.tuned) {
  const lv = leafView(v, f);
  let eq = 0, wins = 0;
  for (let i = 0; i < rollouts; i++) {
    const r = rollout(lv, mulberry(seed * 7919 + i)); // common random numbers across candidates
    eq += r; if (r > 0) wins++;
  }
  const facts = positionFacts(lv, W);
  const newPts = [], vacated = [];
  for (let r = 1; r <= 24; r++) {
    if (!v.mine[r] && f.mine[r]) newPts.push({ r, ...blockReach(lv, r) });
    if (v.mine[r] && !f.mine[r]) vacated.push({ r, ...blockReach(v, r) });
  }
  return { steps: f.steps, ply2, eq: rollouts ? eq / rollouts : null, win: rollouts ? wins / rollouts : null, facts, newPts, vacated };
}

// ------------------------------------------------------------------ mistake review
// Reviews the plays `side` made in a recorded game (turns = [{p, dice, steps}], as in records.js).
// Step 1, screenTurns (fast, ~10 ms a turn): the two-ply loss of every turn that had a choice,
// i.e. how much worse the play made scored than the best play, after the opponent's best reply.
// Step 2, reviewTurn (Mr. Makis's play-outs, ~2 s): for one turn, the played move against the
// best few, so the loss can be quoted as win chance.
function positionsBefore(turns) {
  const g = newGame(), out = [];
  for (const t of turns) { out.push(cloneGame(g)); applySteps(g, t.p, t.steps); }
  return out;
}
const finalKey = (mine, off) => Array.from(mine).join(',') + '|' + off;
function playedFinal(v, steps) {
  const mine = Int8Array.from(v.mine);
  let off = v.myOff;
  for (const s of steps) { mine[s.r]--; if (s.t) mine[s.t]++; else off++; }
  return { steps, mine, myOff: off };
}

// Puzzles: the final-position key a play leads to (the format test/make-puzzles.mjs stores in
// `keys`), and a play described the way the coach's explanations expect (no play-outs).
export const playKey = (v, steps) => { const f = playedFinal(v, steps); return finalKey(f.mine, f.myOff); };
export const describePlay = (v, steps) => candidate(v, playedFinal(v, steps), null, 0, 1);

export function screenTurns(turns, side, W = WEIGHTS.tuned) {
  const before = positionsBefore(turns), out = [];
  turns.forEach((t, i) => {
    if (t.p !== side) return;
    const v = viewOf(before[i], side);
    const finals = finalPositions(v, expandDice(t.dice));
    if (finals.length <= 1) return;
    const played = playedFinal(v, t.steps), pk = finalKey(played.mine, played.myOff);
    const pre = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) })).sort((x, y) => y.s - x.s).slice(0, 10);
    if (!pre.some((c) => finalKey(c.f.mine, c.f.myOff) === pk)) pre.push({ f: played });
    let best = -Infinity, mine = null;
    for (const c of pre) {
      const val = replyValue(v, c.f, W);
      if (val > best) best = val;
      if (finalKey(c.f.mine, c.f.myOff) === pk) mine = val;
    }
    out.push({ i, loss: best - mine, legal: finals.length });
  });
  return out;
}

export function reviewTurn(turns, i, { rollouts = 120, top = 3, seed = 1 } = {}) {
  const t = turns[i], g = positionsBefore(turns.slice(0, i + 1))[i], v = viewOf(g, t.p), W = WEIGHTS.tuned;
  const finals = finalPositions(v, expandDice(t.dice));
  const played = playedFinal(v, t.steps), pk = finalKey(played.mine, played.myOff);
  const pre = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) })).sort((x, y) => y.s - x.s).slice(0, 30);
  for (const c of pre) c.ply2 = replyValue(v, c.f, W);
  pre.sort((x, y) => y.ply2 - x.ply2);
  const picks = pre.slice(0, top);
  const playedPick = picks.find((c) => finalKey(c.f.mine, c.f.myOff) === pk);
  const cands = picks.map((c) => ({ ...candidate(v, c.f, c.ply2, rollouts, seed), mine: c === playedPick }));
  if (!playedPick) cands.push({ ...candidate(v, played, replyValue(v, played, W), rollouts, seed), mine: true });
  cands.sort((x, y) => (y.eq - x.eq) || (y.ply2 - x.ply2));
  return { i, dice: t.dice.slice(), legal: finals.length, rollouts, base: positionFacts(v, W), best: cands[0], played: cands.find((c) => c.mine), cands };
}

export function rollDice(rnd = Math.random) {
  return [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
}
