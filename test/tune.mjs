// Self-play tuner for the evaluation parameters: node test/tune.mjs [games] [sweeps]
// Greedy (one-ply, no noise) player with candidate parameters vs the current best,
// paired dice seeds with seats swapped, accept a change when it scores > 52% of points.
import { newGame, chooseMove, winner, makeWeights, PARAMS } from '../src/engine.js';

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

function game(Ws, first, seed) {
  const rnd = mkRng(seed);
  const g = newGame();
  let p = first, turns = 0;
  while (!winner(g) && turns < 3000) {
    const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    const steps = chooseMove(g, p, dice, 3, rnd, { W: Ws[p], noise: 0 });
    for (const s of steps) { g.pos[p][s.r]--; if (s.t) g.pos[p][s.t]++; else g.off[p]++; }
    p = 1 - p; turns++;
  }
  return winner(g);
}

// share of points won by candidate params `cand` against `base`
export function match(cand, base, games, seed0 = 5000) {
  const Wc = makeWeights(cand), Wb = makeWeights(base);
  let c = 0, b = 0;
  for (let i = 0; i < games; i++) {
    const seat = i % 2; // candidate sits in seat `seat`; the same seed is played from both seats
    const Ws = seat === 0 ? [Wc, Wb] : [Wb, Wc];
    const w = game(Ws, Math.floor(i / 2) % 2, seed0 + Math.floor(i / 2));
    if (!w) continue;
    if (w.p === seat) c += w.points; else b += w.points;
  }
  return c / (c + b);
}

const isMain = process.argv[1] && process.argv[1].endsWith('tune.mjs');
if (isMain) {
  const games = parseInt(process.argv[2] || '2000', 10);
  const sweeps = parseInt(process.argv[3] || '2', 10);
  // optional 4th arg: name of a PARAMS entry to start from (default full)
  let best = { ...PARAMS[process.argv[4] || 'full'] };
  const keys = Object.keys(best);
  for (let sw = 0; sw < sweeps; sw++) {
    let changed = false;
    for (const k of keys) {
      for (const f of [1.4, 0.7]) {
        const cand = { ...best, [k]: +(best[k] * f).toFixed(4) };
        if (k === 'far' && best[k] === 0) cand[k] = 0.2;
        const t0 = Date.now();
        const share = match(cand, best, games, 5000 + sw * 100000);
        console.log(`sweep ${sw} ${k} x${f} -> ${cand[k]}: ${(share * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        if (share > 0.52) { best = cand; changed = true; console.log('  accepted', JSON.stringify(best)); break; }
      }
    }
    if (!changed) break;
  }
  console.log('BEST', JSON.stringify(best));
  console.log(`vs original full: ${(match(best, PARAMS.full, games, 900000) * 100).toFixed(1)}%`);
}
