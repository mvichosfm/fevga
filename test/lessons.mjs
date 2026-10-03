// Proves the guided lessons against the real engine: every position is a valid Fevga position,
// the scripted answer is a legal play that satisfies the goal, the goal is not met by every play
// (so it tests something), and the claims the lesson text makes about the rules actually hold.
// Run: node test/lessons.mjs
import { createTurn, turnPlay, turnSteps, turnDone, finalPositions, S } from '../src/engine.js';
import { LESSONS, lessonBoard, lessonSteps, boardFrom } from '../src/lessons.js';

let passes = 0, fails = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('FAIL: ' + msg); } };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const L = Object.fromEntries(LESSONS.map((l) => [l.id, l]));
const game = (q) => ({ pos: [q.mine, q.opp], off: [q.myOff, q.oppOff] });
const turnOf = (l) => { const q = lessonBoard(l); return createTurn(game(q), 0, q.dice); };

ok(LESSONS.length === 8, 'eight lessons');
ok(new Set(LESSONS.map((l) => l.id)).size === LESSONS.length, 'lesson ids are unique');

for (const l of LESSONS) {
  const q = lessonBoard(l);
  // a valid position: fifteen checkers a side, nobody on a point the other holds
  ok(sum(q.mine) + q.myOff === 15, `${l.id}: 15 of mine`);
  ok(sum(q.opp) + q.oppOff === 15, `${l.id}: 15 of the computer's`);
  let clash = 0;
  for (let r = 1; r <= 24; r++) if (q.mine[r] && q.opp[S(r)]) clash++;
  ok(clash === 0, `${l.id}: no point held by both sides`);
  ok(q.dice.length === 2 && q.dice.every((d) => d >= 1 && d <= 6), `${l.id}: dice`);
  ok(l.goal.every((s) => s >= 1 && s <= 24), `${l.id}: goal points are real`);
  ok(typeof l.teach === 'string' && typeof l.task === 'string' && typeof l.win === 'string' && typeof l.miss === 'string', `${l.id}: all texts present`);

  // the scripted answer is legal, step by step, completes the turn and meets the goal
  const T = turnOf(l);
  let legalAnswer = true;
  try { for (const st of lessonSteps(l.answer)) turnPlay(T, st); } catch { legalAnswer = false; }
  ok(legalAnswer && turnDone(T), `${l.id}: the answer is a legal complete play`);
  ok(l.check(T.v), `${l.id}: the answer meets the goal`);

  // the goal is a real test: some legal complete play misses it (where more than one play exists)
  const v0 = lessonBoard(l);
  const finals = finalPositions({ mine: Int8Array.from(v0.mine), opp: v0.opp, myOff: v0.myOff, oppOff: v0.oppOff }, v0.dice[0] === v0.dice[1] ? Array(4).fill(v0.dice[0]) : v0.dice.slice());
  const good = finals.filter((f) => l.check({ mine: f.mine, opp: v0.opp, myOff: f.myOff, oppOff: v0.oppOff }));
  ok(finals.length >= 1 && good.length >= 1, `${l.id}: ${good.length}/${finals.length} legal plays meet the goal`);
  if (l.id !== 'direction' && l.id !== 'runner' && l.id !== 'larger' && l.id !== 'mars') ok(good.length < finals.length, `${l.id}: the goal is not met by every play (${good.length}/${finals.length})`);
}

// --- the claims the texts make
{ // direction / runner: only one checker can move at first, and after the first die only the runner
  for (const id of ['direction', 'runner']) {
    const T = turnOf(L[id]);
    ok(new Set(turnSteps(T).map((s) => s.r)).size === 1, `${id}: at the start only checkers from point 1 move`);
    turnPlay(T, turnSteps(T)[0]);
    const after = turnSteps(T);
    ok(after.length > 0 && after.every((s) => s.r !== 24), `${id}: after the first die only the runner may move`);
  }
}
{ // blocked: 4 from 16 and 3 from 17 are not offered (both land on the computer's 20)
  const T = turnOf(L.blocked), steps = turnSteps(T);
  const has = (from, d) => steps.some((s) => s.r === 25 - from && s.d === d);
  ok(!has(16, 4) && !has(17, 3), 'blocked: nothing may land on the computer\'s checker on 20');
  ok(has(16, 3) && has(17, 4), 'blocked: 16 -> 19 and 17 -> 21 are open');
}
{ // larger: only one die is playable, and it is the 5
  const T = turnOf(L.larger), steps = turnSteps(T);
  ok(T.M === 1, 'larger: only one die can be played');
  ok(steps.length >= 1 && steps.every((s) => s.d === 5), 'larger: the only die offered is the larger');
}
{ // doubles: four moves
  ok(turnOf(L.doubles).M === 4, 'doubles: four moves to play');
}
{ // quarter: after 1 -> 3 with the 2, the only 1s offered leave a gap in 1-6 (never fill the quarter)
  const T = turnOf(L.quarter);
  turnPlay(T, lessonSteps([{ from: 1, to: 3, d: 2 }])[0]);
  const next = turnSteps(T);
  ok(next.length > 0, 'quarter: a move is still available after 1 -> 3');
  for (const s of next) {
    const m = Int8Array.from(T.v.mine); m[s.r]--; if (s.t) m[s.t]++;
    let full = true; for (let r = 19; r <= 24; r++) if (!m[r]) full = false;
    ok(!full, `quarter: offered step ${25 - s.r} -> ${s.t ? 25 - s.t : 'off'} does not fill the quarter`);
  }
  ok(next.some((s) => s.r === 25 - 6), 'quarter: giving up point 6 is among the offered plays');
}
{ // bearoff: the 5 bears off only from 21, the 2 from 23
  const T = turnOf(L.bearoff), steps = turnSteps(T);
  const offs = (d) => steps.filter((s) => s.d === d && s.t === 0).map((s) => 25 - s.r);
  ok(JSON.stringify(offs(5)) === '[21]', `bearoff: a 5 bears off only from 21 (got ${offs(5)})`);
  ok(JSON.stringify(offs(2)) === '[23]', `bearoff: a 2 bears off only from 23 (got ${offs(2)})`);
}
{ // mars: three checkers left, the computer has none off, so bearing them off is a mars
  const q = lessonBoard(L.mars);
  ok(q.oppOff === 0 && q.myOff === 12 && turnOf(L.mars).M === 3, 'mars: three to bear off, the computer has none off');
}
{ // boardFrom puts the computer's checkers where the player sees them
  const b = boardFrom({ mine: { 1: 15 }, opp: { 13: 15 } });
  ok(b.mine[24] === 15 && b.opp[24] === 15, 'boardFrom: starts are each side\'s own point 24');
  const c = boardFrom({ mine: {}, opp: { 7: 2, 12: 1 } });
  ok(c.opp[6] === 2 && c.opp[1] === 1, 'boardFrom: shown 7-12 is the computer\'s home 6..1');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
