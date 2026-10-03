// Rule tests for src/engine.js: node test/rules.mjs
import {
  newGame, createTurn, turnSteps, turnPlay, turnDone, commitTurn, finalPositions, viewOf,
  expandDice, evaluate, S, absOf, chooseMove, winner, cloneGame, applySteps, trapPoint,
} from '../src/engine.js';

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) passes++;
  else { fails++; console.log('FAIL:', msg); }
}
const fmt = (steps) => steps.map((s) => `${s.r}>${s.t}/${s.d}`).sort().join(' ');

function game(white, black, offW = 0, offB = 0) {
  const g = { pos: [new Int8Array(25), new Int8Array(25)], off: [offW, offB] };
  for (const [r, n] of Object.entries(white)) g.pos[0][r] = n;
  for (const [r, n] of Object.entries(black)) g.pos[1][r] = n;
  const tw = g.pos[0].reduce((a, b) => a + b, 0) + offW, tb = g.pos[1].reduce((a, b) => a + b, 0) + offB;
  if (tw !== 15 || tb !== 15) throw new Error(`bad fixture ${tw}/${tb}`);
  return g;
}

// coordinate maps
ok(S(S(7)) === 7 && S(24) === 12 && S(12) === 24, 'S is an involution with 24<->12');
ok(absOf(0, 24) === 23 && absOf(1, 24) === 11 && absOf(1, 13) === 0 && absOf(1, 12) === 23 && absOf(1, 1) === 12, 'abs mapping');

// 1. Opening 6-5: only the starting checker moves, and then only that runner.
{
  const T = createTurn(newGame(), 0, [6, 5]);
  ok(T.M === 2, 'opening 6-5 plays both dice');
  ok(fmt(turnSteps(T)) === '24>18/6 24>19/5', `opening first steps: ${fmt(turnSteps(T))}`);
  turnPlay(T, { r: 24, d: 6 });
  ok(fmt(turnSteps(T)) === '18>13/5', `after 24>18 only the runner moves: ${fmt(turnSteps(T))}`);
  turnPlay(T, { r: 18, d: 5 });
  ok(turnDone(T), 'turn done');
  const f = finalPositions(viewOf(newGame(), 0), expandDice([6, 5]));
  ok(f.length === 1, 'opening 6-5 has one distinct result');
}

// 2. Once the runner passes the opponent's start (point 12), other checkers may leave.
{
  const g = game({ 24: 14, 13: 1 }, { 24: 15 });
  const T = createTurn(g, 0, [6, 6]);
  ok(T.M === 4, 'double 6 fully playable');
  ok(fmt(turnSteps(T)) === '13>7/6', `before passing only the runner: ${fmt(turnSteps(T))}`);
  turnPlay(T, { r: 13, d: 6 });
  ok(turnSteps(T).some((s) => s.r === 24), 'after passing, the start point is free to move');
}

// 3. Cannot land on a point held by a single opponent checker.
{
  // black checker on white's point 18 (black's own S(18) = 6)
  const g = game({ 24: 15 }, { 24: 14, [S(18)]: 1 });
  const T = createTurn(g, 0, [6, 5]);
  ok(!turnSteps(T).some((s) => s.t === 18), 'blocked by a lone opponent checker');
  ok(fmt(turnSteps(T)) === '24>19/5', `only the 5 can start: ${fmt(turnSteps(T))}`);
}

// 4. Six in a row is allowed outside the starting quarter, opponents behind it or not.
{
  const white = { 24: 9, 20: 1, 19: 1, 18: 1, 17: 1, 16: 1, 5: 1 };
  const T = createTurn(game(white, { 24: 15 }), 0, [3, 1]);
  ok(turnSteps(T).some((s) => s.r === 24 && s.t === 21), `sixth point allowed with black all behind: ${fmt(turnSteps(T))}`);
  const T2 = createTurn(game(white, { 24: 14, 2: 1 }), 0, [3, 1]);
  ok(turnSteps(T2).some((s) => s.r === 24 && s.t === 21), 'sixth point allowed with one black checker in front');
  ok(T.mustOpen === 0, 'black is behind the wall but not on the point right behind it: no obligation');
}

// 4c. Unblocking: every opponent checker on the single point right behind six in a row.
{
  // white holds 16..21 = black's 9..4; all 15 black checkers on black's 10 (white's 22)
  const white = { 24: 8, 21: 1, 20: 1, 19: 1, 18: 1, 17: 1, 16: 1, 5: 1 };
  const g4 = game(white, { 10: 15 });
  const opened = (mine) => [16, 17, 18, 19, 20, 21].some((r) => !mine[r]);
  ok(trapPoint(viewOf(g4, 0)) === 10, 'trap detected: black stuck on its 10');
  for (const dice of [[3, 1], [6, 5], [2, 2], [6, 6]]) {
    const T = createTurn(g4, 0, dice);
    const finals = finalPositions(viewOf(g4, 0), expandDice(dice));
    ok(T.mustOpen === 10 && finals.length && finals.every((f) => opened(f.mine)), `${dice}: every legal play opens the wall`);
    // every way of clicking the turn through ends opened, and reaches exactly the enumerated finals
    const ends = new Set(), shut = [];
    let plays = 0;
    const walk = (steps) => {
      const t = createTurn(g4, 0, dice);
      for (const s of steps) turnPlay(t, s);
      if (turnDone(t)) { plays++; if (!opened(t.v.mine)) shut.push(steps.map((s) => `${s.r}>${s.t}`).join(' ')); ends.add(t.v.mine.join()); return; }
      for (const s of turnSteps(t)) walk([...steps, s]);
    };
    walk([]);
    ok(plays > 0 && !shut.length, `${dice}: all ${plays} clicked plays open the wall ${shut.slice(0, 3).join(' | ')}`);
    ok(ends.size === finals.length && finals.every((f) => ends.has(f.mine.join())), `${dice}: interactive plays = enumerated plays (${ends.size} vs ${finals.length})`);
    const cm = chooseMove(g4, 0, dice, 5, () => 0.3);
    ok(opened(applySteps(cloneGame(g4), 0, cm).pos[0]), `${dice}: the Expert opens it too`);
  }
  // not all on one point, or a gap right in front: no obligation
  ok(trapPoint(viewOf(game(white, { 10: 14, 2: 1 }), 0)) === 0, 'one black checker elsewhere: no trap');
  ok(trapPoint(viewOf(game(white, { 11: 15 }), 0)) === 0, 'black one point further back: no trap');
}

// 4b. Never all six points of your own starting quarter, even with no opponent behind.
{
  // white holds 24, 23, 22, 21, 20; every black checker is past them (its points 2..3);
  // the starting-quarter rule must still refuse 19
  const white = { 24: 9, 23: 1, 22: 1, 21: 1, 20: 1, 5: 2 };
  const g4b = game(white, { 3: 5, 2: 10 });
  const T = createTurn(g4b, 0, [5, 1]);
  const all = turnSteps(T);
  ok(all.some((s) => s.r === 20 && s.t === 19), 'shifting 20>19 keeps a gap and is legal');
  // the rule is about where a move ENDS: 24>19 is fine only because the 1 can reopen a gap
  turnPlay(T, { r: 24, d: 5 });
  ok(fmt(turnSteps(T)) === '19>18/1 20>19/1 21>20/1 22>21/1 23>22/1', `after 24>19 only a gap-opening 1 is offered: ${fmt(turnSteps(T))}`);
  const T1 = createTurn(g4b, 0, [5, 5]);
  ok(!turnSteps(T1).some((s) => s.r === 24 && s.t === 19) || T1.M === 4, 'double 5 cannot be left closed');
  // every clicked play of several rolls ends with the quarter open, and matches the enumeration
  for (const dice of [[5, 1], [5, 5], [1, 1], [4, 2], [3, 1]]) {
    const ends = new Set(); let bad = 0, plays = 0;
    const walk = (steps) => {
      const t = createTurn(g4b, 0, dice);
      for (const s of steps) turnPlay(t, s);
      if (turnDone(t)) { plays++; if ([19, 20, 21, 22, 23, 24].every((r) => t.v.mine[r])) bad++; ends.add(t.v.mine.join()); return; }
      const nxt = turnSteps(t);
      if (!nxt.length) bad++;
      for (const s of nxt) walk([...steps, s]);
    };
    walk([]);
    const finals = finalPositions(viewOf(g4b, 0), expandDice(dice));
    ok(plays > 0 && !bad, `${dice}: no clicked play ends with the quarter closed or stuck (${plays} plays, ${bad} bad)`);
    ok(finals.length === ends.size && finals.every((f) => ends.has(f.mine.join()) && !f.mine.slice(19, 25).every((x) => x)), `${dice}: interactive = enumerated, none closed`);
  }
}

// 4d. One checker may pass over the last open point of the starting quarter (Manos 2026-10-02):
// holding shown 1, 2, 4, 5, 6 (= 24, 23, 21, 20, 19), 1>3>5 with two 2s ends with 3 still open.
{
  const g = game({ 24: 3, 23: 1, 21: 1, 20: 1, 19: 1, 5: 8 }, { 24: 15 });
  const T = createTurn(g, 0, [2, 2]);
  ok(T.M === 4, `double 2 is fully playable (M=${T.M})`);
  ok(turnSteps(T).some((s) => s.r === 24 && s.t === 22), 'the checker on 1 may step to 3 ...');
  turnPlay(T, { r: 24, d: 2 });
  ok(turnSteps(T).some((s) => s.r === 22 && s.t === 20), '... and carry on to 5');
  turnPlay(T, { r: 22, d: 2 });
  ok(T.v.mine[22] === 0 && T.v.mine[24] === 2 && T.v.mine[20] === 2, 'ends with 3 open, two left on 1, two on 5');
  // two different dice: 2 then 2 by one checker is also offered as a single landing spot
  const T2 = createTurn(g, 0, [2, 1]);
  const end = new Set();
  for (const s of turnSteps(T2)) {
    const t = createTurn(g, 0, [2, 1]); turnPlay(t, s);
    for (const s2 of turnSteps(t)) { const t2 = createTurn(g, 0, [2, 1]); turnPlay(t2, s); turnPlay(t2, s2); end.add(t2.v.mine.slice(19, 25).every((x) => x)); }
  }
  ok(end.size === 1 && end.has(false), 'a 2-1 can never end with the quarter closed');
}

// 5. Bearing off: exact, higher die from the highest point, and not before all are home.
{
  const T = createTurn(game({ 4: 1, 2: 1 }, { 24: 15 }, 13), 0, [6, 1]);
  ok(T.M === 2, 'bear-off 6-1 plays both');
  ok(turnSteps(T).some((s) => s.r === 4 && s.d === 6 && s.t === 0), '6 bears off from the highest point 4');
  ok(!turnSteps(T).some((s) => s.r === 2 && s.d === 6), '6 cannot bear off from 2 while 4 is occupied');
  const T2 = createTurn(game({ 8: 1, 2: 1 }, { 24: 15 }, 13), 0, [2, 1]);
  ok(!turnSteps(T2).some((s) => s.t === 0), 'no bear-off with a checker outside home');
  const g = game({ 3: 2 }, { 24: 15 }, 13);
  const T3 = createTurn(g, 0, [5, 5]);
  ok(T3.M === 2, 'two checkers, double 5 plays two');
  turnPlay(T3, { r: 3, d: 5 }); turnPlay(T3, { r: 3, d: 5 });
  commitTurn(g, T3);
  ok(winner(g)?.p === 0 && winner(g).points === 2, 'win with mars when the opponent has none off');
}

// 6. Only one die playable: it must be the larger.
{
  // runner on 13 (not yet past 12); white points 6, 19 and 22 are held by black
  const g = game({ 24: 14, 13: 1 }, { 24: 12, [S(6)]: 1, [S(19)]: 1, [S(22)]: 1 });
  const T = createTurn(g, 0, [2, 5]);
  ok(T.M === 1, `only one die playable (M=${T.M})`);
  ok(fmt(turnSteps(T)) === '13>8/5', `must play the larger die: ${fmt(turnSteps(T))}`);
  const f = finalPositions(viewOf(g, 0), [2, 5]);
  ok(f.length === 1 && f[0].steps[0].d === 5, 'enumeration agrees on the larger die');
}

// 7. No legal move at all.
{
  // runner on 13: 13-1 = 12 is black's starting point, 13-2 = 11 is held by black
  const g = game({ 24: 14, 13: 1 }, { 24: 14, [S(11)]: 1 });
  const T = createTurn(g, 0, [1, 2]);
  ok(T.M === 0 && turnSteps(T).length === 0, 'no move when the runner is blocked');
  ok(chooseMove(g, 0, [1, 2], 5).length === 0, 'AI passes too');
}

// 8. Evaluation is antisymmetric (two-ply search depends on it).
{
  const g = game({ 24: 6, 20: 2, 15: 3, 9: 2, 3: 2 }, { 24: 5, 19: 3, 16: 2, 10: 3, 4: 2 });
  const a = evaluate(viewOf(g, 0)), b = evaluate(viewOf(g, 1));
  ok(Math.abs(a + b) < 1e-9, `evaluate antisymmetric (${a} vs ${b})`);
}

// 9. Random playouts never break invariants, and the interactive turn agrees with the enumeration.
{
  let rs = 12345;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  let games = 0, mismatch = 0;
  for (let n = 0; n < 40; n++) {
    let g = newGame(), p = n % 2, turns = 0;
    while (!winner(g) && turns < 2000) {
      const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
      const finals = finalPositions(viewOf(g, p), expandDice(dice));
      const T = createTurn(g, p, dice);
      const len = finals.length ? finals[0].steps.length : 0;
      if (len !== T.M) mismatch++;
      // play random interactive steps until done
      while (!turnDone(T)) {
        const st = turnSteps(T);
        if (!st.length) { mismatch++; break; }
        turnPlay(T, st[Math.floor(rnd() * st.length)]);
      }
      commitTurn(g, T);
      for (let q = 0; q < 2; q++) {
        let tot = g.off[q];
        for (let r = 1; r <= 24; r++) { if (g.pos[q][r] < 0) mismatch++; tot += g.pos[q][r]; }
        if (tot !== 15) mismatch++;
      }
      for (let r = 1; r <= 24; r++) if (g.pos[0][r] && g.pos[1][S(r)]) mismatch++;
      p = 1 - p; turns++;
    }
    if (winner(g)) games++;
  }
  ok(mismatch === 0, `random playouts consistent (mismatches: ${mismatch})`);
  ok(games === 40, `random games all finish (${games}/40)`);
}

// 10. A recorded game (dice + steps per turn) replays to the identical final position,
//     including through JSON (that is how saved games are stored).
{
  let rs = 777;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const g = newGame(); const turns = []; let p = 0, n = 0;
  while (!winner(g) && n++ < 2000) {
    const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    const steps = chooseMove(g, p, dice, 3, rnd);
    turns.push({ p, dice, steps: steps.map(({ r, t, d }) => ({ r, t, d })) });
    applySteps(g, p, steps);
    p = 1 - p;
  }
  const rec = JSON.parse(JSON.stringify({ turns }));
  const r = newGame();
  for (const t of rec.turns) applySteps(r, t.p, t.steps);
  const same = r.off.join() === g.off.join() && [0, 1].every((q) => Array.from(r.pos[q]).join() === Array.from(g.pos[q]).join());
  ok(same && !!winner(r), `recorded game replays to the same final position (${rec.turns.length} turns)`);
}

// 11. .vbg files: export -> import round-trips; damaged or tampered files are refused.
{
  const { toVbg, parseVbg, vbgFileName } = await import('../src/records.js');
  let rs = 99;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const g = newGame(); const turns = []; let p = 0;
  while (!winner(g)) {
    const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    const st = chooseMove(g, p, d, 3, rnd);
    turns.push({ p, dice: d, steps: st.map(({ r, t, d: die }) => ({ r, t, d: die })) });
    applySteps(g, p, st); p = 1 - p;
  }
  const rec = { name: 'Lesson / test', date: 1790000000000, level: 4, human: 0, opening: [5, 3], turns, result: { winner: 'cpu', points: 9 } };
  const text = toVbg(rec), back = parseVbg(text);
  ok(back.rec && back.rec.turns.length === turns.length && back.rec.imported, '.vbg round-trips');
  const w = winner(g);
  ok(back.rec.result.points === w.points && back.rec.result.winner === (w.p === 0 ? 'you' : 'cpu'), 'result recomputed from the moves, not taken from the file');
  ok(vbgFileName(rec) === 'Lesson test.vbg', `safe file name (${vbgFileName(rec)})`);
  const tamper = (f) => { const d = JSON.parse(text); f(d.game); return parseVbg(JSON.stringify(d)).error; };
  ok(!!tamper((x) => { x.turns[10].steps[0].t = 0; }), 'illegal move refused');
  ok(!!tamper((x) => { x.turns[5].dice = [6, 6]; }), 'changed dice refused');
  ok(!!tamper((x) => { x.turns.splice(3, 1); }), 'removed move refused');
  ok(!!tamper((x) => { x.turns.push(x.turns[0]); }), 'moves after the end refused');
  ok(!!parseVbg('not json').error && !!parseVbg('{"a":1}').error, 'non-game files refused');
  // a conceded game: the board shows no winner, so the file's flag carries the result
  const short = { ...rec, turns: turns.slice(0, 20), resigned: true };
  const r2 = parseVbg(toVbg(short)).rec;
  ok(r2.result && r2.result.resigned && r2.result.winner === 'cpu' && r2.result.points === 2, 'resigned game keeps its double win');
  const single = { ...short, result: { winner: 'cpu', points: 1, resigned: true } };
  const r3 = parseVbg(toVbg(single)).rec;
  ok(r3.result && r3.result.resigned && r3.result.points === 1, 'single-loss concession keeps its 1 point');
  const old = JSON.parse(toVbg(short)); delete old.game.resignPoints;
  ok(parseVbg(JSON.stringify(old)).rec.result.points === 2, 'older resigned files (no resignPoints) read as double');
  const odd = JSON.parse(toVbg(short)); odd.game.resignPoints = 7;
  ok(parseVbg(JSON.stringify(odd)).rec.result.points === 2, 'hostile resignPoints clamped to double');
  ok(parseVbg(toVbg({ ...rec, resigned: true })).rec.result.resigned === undefined, 'a resigned flag cannot override a finished board');
}

// 11a. Mistake review: an Expert's own plays screen at zero loss; a random player's do not;
//      reviewTurn measures the move actually played.
{
  const { screenTurns, reviewTurn } = await import('../src/engine.js');
  const playGame = (lv0, seed) => {
    let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    const g = newGame(), turns = []; let p = 0;
    while (!winner(g) && turns.length < 600) {
      const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
      const steps = chooseMove(g, p, d, p === 0 ? lv0 : 4, rnd);
      turns.push({ p, dice: d, steps: steps.map(({ r, t, d: die }) => ({ r, t, d: die })) });
      applySteps(g, p, steps); p = 1 - p;
    }
    return turns;
  };
  const expert = screenTurns(playGame(5, 11), 0);
  ok(expert.length > 5 && expert.every((x) => Math.abs(x.loss) < 1e-9), `Expert's plays screen at zero loss (${expert.length} turns)`);
  ok(expert.every((x) => x.legal > 1), 'only turns with a choice are screened');
  const turns = playGame(1, 7), rand = screenTurns(turns, 0);
  ok(rand.some((x) => x.loss > 1) && rand.every((x) => x.loss >= -1e-9), 'a random player shows clear losses, never negative');
  const worst = rand.sort((a, b) => b.loss - a.loss)[0];
  const r = reviewTurn(turns, worst.i, { rollouts: 30, top: 2, seed: 1 });
  const g0 = newGame(); for (let k = 0; k < worst.i; k++) applySteps(g0, turns[k].p, turns[k].steps);
  const after = applySteps(cloneGame(g0), 0, turns[worst.i].steps);
  const pAfter = applySteps(cloneGame(g0), 0, r.played.steps);
  ok(after.pos[0].join() === pAfter.pos[0].join(), 'reviewTurn reports the move actually played');
  ok(r.best.eq >= r.played.eq && r.cands[0] === r.best, 'reviewTurn ranks the best candidate first');
}

// 11c. Puzzles (src/puzzles.js, generated): every stored answer is legal through the interactive
//      turn API, lands on its stored key, is among the accepted keys; the best wrong move is not
//      accepted; the legal-play count and the >= 10-point gap hold; ids run 1..N.
{
  const { PUZZLES } = await import('../src/puzzles.js');
  const { playKey } = await import('../src/engine.js');
  const bad = [];
  PUZZLES.forEach((q, n) => {
    if (!q || q.id !== n + 1) { bad.push(`#${n + 1}: missing or misnumbered`); return; }
    const g = { pos: [Int8Array.from(q.mine), Int8Array.from(q.opp)], off: [q.myOff, q.oppOff] };
    const v = viewOf(g, 0);
    try {
      const T = createTurn(g, 0, q.dice);
      for (const s of q.best) turnPlay(T, { r: s.r, d: s.d });
      if (!turnDone(T)) bad.push(`#${q.id}: answer does not use every playable die`);
      const key = Array.from(T.v.mine).join(',') + '|' + T.v.myOff;
      if (key !== q.key || playKey(v, q.best) !== q.key) bad.push(`#${q.id}: answer lands elsewhere`);
    } catch (e) { bad.push(`#${q.id}: answer is not legal (${e.message})`); }
    if (!q.keys.includes(q.key)) bad.push(`#${q.id}: answer not among the accepted keys`);
    if (q.keys.includes(playKey(v, q.second))) bad.push(`#${q.id}: the wrong move is accepted`);
    if (finalPositions(v, expandDice(q.dice)).length !== q.legal) bad.push(`#${q.id}: legal count`);
    if (q.win[0] - q.win[1] < 0.1 - 1e-9) bad.push(`#${q.id}: gap below 10 points`);
    if (![1, 2, 3, 4].includes(q.tier)) bad.push(`#${q.id}: tier`);
  });
  ok(PUZZLES.length >= 12 && !bad.length, `${PUZZLES.length} puzzles valid${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
}

// 11b. .vbs settings files: round-trip, clamping of hostile values, refusal of other files
{
  const { toVbs, parseVbs } = await import('../src/records.js');
  const setup = { level: 4, color: 1, light: 0.6, lamp: true, freeCam: false, view: [40, 60, 100], theme: 'olive', numbers: false, trails: false, round: true, total: true, muted: true, autoEnd: true, openingPlay: true, match: true };
  const back = parseVbs(toVbs(setup, [{ name: 'Night', s: setup }]));
  ok(JSON.stringify(back.setup) === JSON.stringify(setup) && back.favourites.length === 1 && back.favourites[0].name === 'Night', '.vbs round-trips');
  const evil = parseVbs(JSON.stringify({ format: 'fevga-vbs', version: 1, setup: { level: 99, color: 'x', light: 1e9, view: [1e9, 0, 0], theme: { a: 1 }, lamp: 'yes', extra: '<script>' }, favourites: [{ name: 42, s: null }, 'junk'] }));
  ok(evil.setup.level === 3 && evil.setup.color === 0 && evil.setup.light === 1.6 && evil.setup.view === null && evil.setup.theme === 'walnut' && evil.setup.lamp === false && !('extra' in evil.setup), 'hostile values clamped or dropped');
  ok(evil.favourites.length === 0, 'unreadable favourites dropped');
  ok(evil.setup.total === false && parseVbs(JSON.stringify({ format: 'fevga-vbs', version: 1, setup: { total: 'yes' } })).setup.total === false, 'dice-sum setting is off unless exactly true (older files lack it)');
  ok(evil.setup.trails === true && parseVbs(JSON.stringify({ format: 'fevga-vbs', version: 1, setup: { trails: false } })).setup.trails === false, 'last-move markers are on unless exactly false (older files lack the field)');
  ok(!!parseVbs('{"format":"fevga-vbg","version":1}').error && !!parseVbs('nope').error, 'non-settings files refused');
}

// 12. records: resigned games read as conceded
{
  const { resultText } = await import('../src/records.js');
  ok(resultText({ result: { winner: 'cpu', points: 2, resigned: true } }) === 'you admitted the loss, computer +2', 'resigned result text');
  ok(resultText({ result: { winner: 'cpu', points: 1, resigned: true } }) === 'you admitted the loss, computer +1', 'single resigned result text');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
