// Mr. Makis (level-10 coach, analyzeView) vs level 5: node test/makis.mjs [games] [rollouts]
// Slow by design (~1 s per Makis move); run in the background.
import { newGame, viewOf, expandDice, analyzeView, chooseMove, applySteps, winner } from '../src/engine.js';

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

const games = parseInt(process.argv[2] || '30', 10), rollouts = parseInt(process.argv[3] || '120', 10);
let makisPts = 0, l5Pts = 0, makisWins = 0;
const t0 = Date.now();
for (let i = 0; i < games; i++) {
  const rnd = mkRng(4242 + i), g = newGame();
  const makisSide = i % 2; // alternate colours; side 0 always moves first
  let p = 0, n = 0;
  while (!winner(g) && n++ < 3000) {
    const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    let steps;
    if (p === makisSide) {
      const a = analyzeView(viewOf(g, p), expandDice(d), { rollouts, seed: i * 1000 + n });
      steps = a.cands.length ? a.cands[0].steps : [];
    } else steps = chooseMove(g, p, d, 5, rnd);
    applySteps(g, p, steps);
    p = 1 - p;
  }
  const w = winner(g);
  if (w.p === makisSide) { makisPts += w.points; makisWins++; } else l5Pts += w.points;
  console.log(`game ${i + 1}: ${w.p === makisSide ? 'Makis' : 'L5'} +${w.points} | Makis ${makisWins}/${i + 1} wins, points ${makisPts}-${l5Pts} | ${Math.round((Date.now() - t0) / 1000)}s`);
}
