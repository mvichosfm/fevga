// Evidence for strategy.html: how far the runner gets and the first mover's win share per
// opening roll (L4 v L4). The guide quotes `node test/opening-stats.mjs 1500` (~3 min).
import { newGame, chooseMove, viewOf, finalPositions, expandDice, winner } from '../src/engine.js';

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
const apply = (g, p, steps) => { for (const s of steps) { g.pos[p][s.r]--; if (s.t) g.pos[p][s.t]++; else g.off[p]++; } };
const N = parseInt(process.argv[2] || '400', 10);
const rows = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) {
  const finals = finalPositions(viewOf(newGame(), 0), expandDice([a, b]));
  const where = finals.map((f) => { const r = []; for (let q = 1; q <= 24; q++) if (f.mine[q] && q !== 24) r.push(q); return r.join('+') + ` (${f.steps.length} dice)`; });
  let w = 0, pts = 0, opp = 0;
  for (let i = 0; i < N; i++) {
    const rnd = mkRng(90000 + i * 31 + a * 7 + b);
    const g = newGame();
    apply(g, 0, chooseMove(g, 0, [a, b], 4, rnd));
    let p = 1, t = 0;
    while (!winner(g) && t < 3000) { apply(g, p, chooseMove(g, p, [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)], 4, rnd)); p = 1 - p; t++; }
    const r = winner(g);
    if (r.p === 0) { w++; pts += r.points; } else opp += r.points;
  }
  rows.push({ roll: `${a}-${b}`, where: where.join(' | '), win: w / N, pts: pts / (pts + opp) });
}
rows.sort((x, y) => y.win - x.win);
for (const r of rows) console.log(`${r.roll}\t${(100 * r.win).toFixed(1)}%\tpts ${(100 * r.pts).toFixed(1)}%\t${r.where}`);
