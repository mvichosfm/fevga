// Evidence for strategy.html: self-play statistics. node test/strategy-stats.mjs <games> <level>
// The guide quotes `3000 4` (~10 s) and `300 5` (~3 min). Fixed seeds, so reruns reproduce it exactly.
// The "race" table is printed but deliberately not quoted: contact ends so late that it mostly
// measures bear-offs already decided.
import { newGame, chooseMove, viewOf, winner, positionFacts, pips } from '../src/engine.js';

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
const passed = (g, p) => g.off[p] > 0 || [...g.pos[p]].slice(1, 12).some((c) => c > 0);

const N = parseInt(process.argv[2] || '400', 10), L = parseInt(process.argv[3] || '4', 10);
const S = { firstWins: 0, games: 0, mars: 0, turns: 0, escFirstWins: 0, escN: 0,
  race: {}, wall: {}, startLeft: {}, occ: Array(25).fill(0), occN: 0, homeBlocks: {}, stackMax: {}, before: {}, past: {} };
const bump = (o, k, win) => { (o[k] ||= { n: 0, w: 0 }); o[k].n++; if (win) o[k].w++; };

for (let i = 0; i < N; i++) {
  const rnd = mkRng(5000 + i);
  const g = newGame();
  const first = i % 2;
  let p = first, turns = 0, escaper = -1, raceAt = null;
  const maxWall = [0, 0], maxStackTrapped = [0, 0];
  const snap10 = {};
  while (!winner(g) && turns < 3000) {
    const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    apply(g, p, chooseMove(g, p, d, L, rnd));
    if (escaper < 0 && passed(g, p)) escaper = p;
    for (const q of [0, 1]) {
      const f = positionFacts(viewOf(g, q));
      if (f.wall.len > maxWall[q]) maxWall[q] = f.wall.len;
    }
    turns++;
    // each side's 10th own turn: structure snapshot
    if (turns === 20 || turns === 21) {
      const q = p;
      // opponent checkers on its own point >= 12 still have the whole of q's 17-23 (its 5-11) ahead;
      // on its 1-4 or off they are already past q's 17
      const o = g.pos[1 - q];
      let before = 0, past = g.off[1 - q];
      for (let r = 12; r <= 24; r++) before += o[r];
      for (let r = 1; r <= 4; r++) past += o[r];
      snap10[q] = { start: g.pos[q][24], home: [13, 14, 15, 16, 17, 18].filter((r) => g.pos[q][r]).length, mine: Int8Array.from(g.pos[q]), before, past };
    }
    if (!raceAt) {
      const f = positionFacts(viewOf(g, 0));
      if (!f.contact && passed(g, 0) && passed(g, 1)) raceAt = { p0: pips(g, 0) + 15 * 0, p1: pips(g, 1), onRoll: 1 - p, off: g.off.slice() };
    }
    p = 1 - p;
  }
  const w = winner(g);
  if (!w) continue;
  S.games++; S.turns += turns;
  if (w.p === first) S.firstWins++;
  if (w.points === 2) S.mars++;
  if (escaper >= 0) { S.escN++; if (w.p === escaper) S.escFirstWins++; }
  if (raceAt) {
    // lead of the side on roll, minus the usual ~4 pip on-roll adjustment left raw here
    const lead = raceAt.onRoll === 0 ? raceAt.p1 - raceAt.p0 : raceAt.p0 - raceAt.p1;
    const b = Math.max(-30, Math.min(30, Math.round(lead / 5) * 5));
    S.raceN = (S.raceN || 0) + 1;
    bump(S.race, b, w.p === raceAt.onRoll);
  }
  for (const q of [0, 1]) {
    bump(S.wall, maxWall[q], w.p === q);
    if (snap10[q]) {
      bump(S.startLeft, Math.min(snap10[q].start, 8), w.p === q);
      bump(S.homeBlocks, snap10[q].home, w.p === q);
      for (let r = 1; r <= 24; r++) if (snap10[q].mine[r]) S.occ[r]++;
      S.occN++;
      S.before[snap10[q].before] = (S.before[snap10[q].before] || 0) + 1;
      S.past[snap10[q].past] = (S.past[snap10[q].past] || 0) + 1;
    }
  }
}
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
const tbl = (o) => Object.keys(o).map(Number).sort((a, b) => a - b).map((k) => `  ${k}: ${pct(o[k].w, o[k].n)} of ${o[k].n}`).join('\n');
console.log(`level ${L}, ${S.games} games, avg ${(S.turns / S.games).toFixed(1)} turns`);
console.log(`first mover wins ${pct(S.firstWins, S.games)}; mars ${pct(S.mars, S.games)}`);
console.log(`runner escapes first -> wins ${pct(S.escFirstWins, S.escN)}`);
console.log(`race (no contact) lead of side on roll, bucket 10 -> its win%:\n${tbl(S.race)}`);
console.log(`max wall length reached -> win%:\n${tbl(S.wall)}`);
console.log(`checkers still on start after own 10th turn -> win%:\n${tbl(S.startLeft)}`);
console.log(`points held in own 13-18 (opp home) after 10th turn -> win%:\n${tbl(S.homeBlocks)}`);
console.log(`occupancy after 10th turn, own point: ` + S.occ.map((c, r) => r ? `${r}:${Math.round(100 * c / S.occN)}` : '').filter(Boolean).join(' '));
const share = (o) => Object.keys(o).map(Number).sort((a, b) => a - b).map((k) => `${k}:${pct(o[k], S.occN)}`).join(' ');
console.log(`after own 10th turn, opponent checkers with all of own 17-23 still ahead -> share: ${share(S.before)}`);
console.log(`after own 10th turn, opponent checkers already past own 17 -> share: ${share(S.past)}`);
