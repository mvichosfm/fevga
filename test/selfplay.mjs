// Level-vs-level matches: node test/selfplay.mjs [games] [pairs...]
// e.g. node test/selfplay.mjs 200 1-2 2-3 3-4 4-5
// Each pair "a-b" plays `games` games, alternating who moves first; prints b's win share
// (points share counts mars as 2) and the average think time per move for each level.
import { newGame, chooseMove, viewOf, finalPositions, expandDice, winner, absOf } from '../src/engine.js';

function mkRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function applySteps(g, p, steps) {
  for (const s of steps) {
    g.pos[p][s.r]--;
    if (s.t) g.pos[p][s.t]++; else g.off[p]++;
  }
}

export function playGame(levels, first, seed, stats) {
  const rnd = mkRng(seed);
  const g = newGame();
  let p = first, turns = 0;
  while (!winner(g) && turns < 3000) {
    const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    const t0 = performance.now();
    const steps = chooseMove(g, p, dice, levels[p], rnd);
    const ms = performance.now() - t0;
    const st = stats[levels[p]] ||= { ms: 0, n: 0, max: 0 };
    st.ms += ms; st.n++; st.max = Math.max(st.max, ms);
    applySteps(g, p, steps);
    p = 1 - p; turns++;
  }
  return { w: winner(g), turns };
}

const args = process.argv.slice(2);
const games = parseInt(args[0] || '100', 10);
const pairs = (args.length > 1 ? args.slice(1) : ['1-2', '2-3', '3-4', '4-5']).map((s) => s.split('-').map(Number));
for (const [a, b] of pairs) {
  const stats = {};
  let bWins = 0, bPts = 0, aPts = 0, turns = 0, draws = 0;
  const t0 = performance.now();
  for (let i = 0; i < games; i++) {
    // seat 0 = level a, seat 1 = level b; alternate who starts, same seeds per pair index
    const r = playGame([a, b], i % 2, 1000 + i, stats);
    turns += r.turns;
    if (!r.w) { draws++; continue; }
    if (r.w.p === 1) { bWins++; bPts += r.w.points; } else aPts += r.w.points;
  }
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  const lv = (l) => `L${l} ${(stats[l].ms / stats[l].n).toFixed(1)}ms avg / ${stats[l].max.toFixed(0)}ms max`;
  console.log(`L${a} vs L${b}: L${b} won ${bWins}/${games - draws} (${(100 * bWins / (games - draws)).toFixed(1)}%), points ${bPts}-${aPts}, ` +
    `draws ${draws}, avg ${Math.round(turns / games)} turns, ${sec}s | ${lv(a)} | ${lv(b)}`);
}
