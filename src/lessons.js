// The guided lessons (Learn): eight short scripted positions on the real board, each introducing
// one rule. Pure data + goal checks, no DOM - main.js plays them through the normal turn machinery
// (the way puzzles are played) and test/lessons.mjs proves every position, answer and check
// against the engine.
//
// Everything here is written in the numbering a player SEES (records.shown): point 1 is the
// player's start (far right), 12 is the last point before the computer's start 13, home is 19-24,
// bearing off is "after 24". The engine counts the other way (r = 25 - shown) and the computer's
// checkers in the computer's own numbering; boardFrom / lessonSteps convert.
import { S } from './engine.js';

const rOf = (shown) => 25 - shown; // the player's own engine point for a shown point

// { mine: { shown: count }, opp: { shown: count }, myOff, oppOff } -> an engine view (mine / opp
// each in its own numbering, as puzzles.js stores them)
export function boardFrom({ mine, opp, myOff = 0, oppOff = 0 }) {
  const m = new Int8Array(25), o = new Int8Array(25);
  for (const [s, n] of Object.entries(mine)) m[rOf(+s)] += n;
  for (const [s, n] of Object.entries(opp)) o[S(rOf(+s))] += n; // the computer's own point for that board point
  return { mine: m, opp: o, myOff, oppOff };
}

// [{from, to, d}] in shown numbers (to: 'off' bears off) -> engine steps [{r, t, d}]
export const lessonSteps = (answer) => answer.map(({ from, to, d }) => ({ r: rOf(from), t: to === 'off' ? 0 : rOf(to), d }));

export const LESSONS = [
  {
    id: 'direction', title: 'The board and the way round',
    mine: { 1: 15 }, opp: { 13: 15 }, dice: [2, 1], goal: [4],
    teach: `<p>You are the ivory checkers and all fifteen start on <b>point 1</b>, far right. Everyone travels the same way round: <b>1 to 12 along the far rail, then 13 to 24 along the near rail</b>. Your home is <b>19–24</b>. The computer starts on 13 and its home is 7–12. The gold numbers on the rails are the point numbers; they stay on during the lessons.</p>`,
    task: `You rolled <b>2–1</b>. Move one checker 3 points forward, to the glowing point <b>4</b>. Click a glowing checker, then a point — or drag the checker there.`,
    check: (v) => v.mine[rOf(4)] === 1 && v.mine[rOf(1)] === 14,
    answer: [{ from: 1, to: 3, d: 2 }, { from: 3, to: 4, d: 1 }],
    win: `<p>Yes: 1 → 3 with the 2, 3 → 4 with the 1. Each die moves a checker that many points along the way round. You choose how to spend the dice; the dice only say how far.</p>`,
    miss: `<p>Not quite: the goal is one checker on point 4 and the other fourteen still on 1. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'runner', title: 'One runner at a time',
    mine: { 1: 15 }, opp: { 13: 15 }, dice: [6, 5], goal: [12],
    teach: `<p>At the start you may move only <b>one checker</b> — your <b>runner</b>. No other checker may leave point 1 until the runner has passed the computer's starting point, <b>13</b>. (The computer plays under the same rule.)</p>`,
    task: `You rolled <b>6–5</b>. Play both dice with the runner, all the way to <b>12</b>. After the first die, only the runner glows.`,
    check: (v) => v.mine[rOf(12)] === 1 && v.mine[rOf(1)] === 14,
    answer: [{ from: 1, to: 7, d: 6 }, { from: 7, to: 12, d: 5 }],
    win: `<p>Right. The runner stands on 12, one short of the computer's start. Next roll it can pass 13 — and from then on <b>any</b> checker may leave point 1.</p>`,
    miss: `<p>The runner should end on point 12 with both dice. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'blocked', title: 'No hitting: a point is taken',
    mine: { 1: 13, 16: 1, 17: 1 }, opp: { 13: 14, 20: 1 }, dice: [4, 3], goal: [19, 21],
    teach: `<p>There is <b>no hitting</b> in Fevga. A point with even one checker on it belongs to its owner, and nobody else can land there — it simply never lights up. The computer has a single checker on <b>20</b>.</p>`,
    task: `You rolled <b>4–3</b>. A 4 from 16 and a 3 from 17 would both land on 20, which is taken. Play the two moves that are open: <b>16 → 19</b> with the 3 and <b>17 → 21</b> with the 4.`,
    check: (v) => v.mine[rOf(19)] >= 1 && v.mine[rOf(21)] >= 1 && !v.mine[rOf(16)] && !v.mine[rOf(17)],
    answer: [{ from: 16, to: 19, d: 3 }, { from: 17, to: 21, d: 4 }],
    win: `<p>Exactly. Points you hold are walls the computer cannot cross, and a wall of single checkers works as well as a heavy one. Building walls is how Fevga is won — the Strategy guide shows how.</p>`,
    miss: `<p>The glowing points are 19 and 21 — the 3 from 16 and the 4 from 17. The other combinations run into the computer's checker on 20. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'larger', title: 'Both dice — or the larger',
    mine: { 1: 14, 6: 1 }, opp: { 13: 15 }, dice: [5, 2], goal: [11],
    teach: `<p>You must play <b>both dice</b> whenever that is possible (all four on a double). If only <b>one</b> die can be played, it has to be the <b>larger</b> one.</p>`,
    task: `Your runner stands on 6 and you rolled <b>5–2</b>. 6 + 5 + 2 = 13 is the computer's start, which is taken, so you cannot play both. Move the runner and see which die the game lets you use.`,
    check: (v) => v.mine[rOf(11)] === 1 && !v.mine[rOf(6)] && !v.mine[rOf(8)],
    answer: [{ from: 6, to: 11, d: 5 }],
    win: `<p>The 5. The game only offers the larger die here: playing the 2 first would leave the 5 stuck in front of the computer's start, and a lone die must be the larger one.</p>`,
    miss: `<p>The runner should end on 11, played with the 5. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'doubles', title: 'Doubles play four times',
    mine: { 1: 13, 15: 1, 20: 1 }, opp: { 13: 15 }, dice: [3, 3], goal: [24],
    teach: `<p>A double is played <b>four times</b>: a 3–3 gives you four moves of 3, split between your checkers however you like.</p>`,
    task: `You rolled <b>3–3</b>. Bring the checker on 15 all the way home to <b>24</b> (15 → 18 → 21 → 24 uses three of the 3s), then play the fourth 3 anywhere.`,
    check: (v) => v.mine[rOf(24)] >= 1 && !v.mine[rOf(15)],
    answer: [{ from: 15, to: 18, d: 3 }, { from: 18, to: 21, d: 3 }, { from: 21, to: 24, d: 3 }, { from: 20, to: 23, d: 3 }],
    win: `<p>Twelve points in one roll: that is why a double is welcome. Notice the game kept the count for you — it said how many moves were still to play.</p>`,
    miss: `<p>The checker from 15 should reach point 24 in three steps of 3. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'quarter', title: 'Never fill your starting quarter',
    mine: { 1: 3, 2: 3, 4: 3, 5: 3, 6: 1, 15: 2 }, opp: { 13: 15 }, dice: [2, 1], goal: [3],
    teach: `<p>Your <b>starting quarter</b> is points 1–6. You may never <b>end a move</b> holding all six of them at once. Only the finished position counts: a checker may pass over the last gap on its way somewhere else.</p>`,
    task: `You hold 1, 2, 4, 5 and 6; point 3 is the gap. You rolled <b>2–1</b>. Make point <b>3</b> — and see what the game asks of you in return.`,
    check: (v) => v.mine[rOf(3)] >= 1,
    answer: [{ from: 1, to: 3, d: 2 }, { from: 6, to: 7, d: 1 }],
    win: `<p>Right: to hold 3 you had to give up another point of the quarter — here 6, the one with a single checker. The game only offers plays that do not end with all six points held.</p>`,
    miss: `<p>The goal is a checker on point 3. The game won't let you end with all six points taken, so something has to leave point 6. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'bearoff', title: 'Bearing off',
    mine: { 21: 3, 22: 3, 23: 4, 24: 5 }, opp: { 8: 5, 9: 5, 10: 5 }, dice: [5, 2], goal: [],
    teach: `<p>When all fifteen are in your home (19–24) you may <b>bear off</b>. A die takes a checker off the point it counts to: a 1 from 24, a 2 from 23, a 3 from 22, a 4 from 21, a 5 from 20, a 6 from 19. If you have no checker there <b>and none further back</b>, a larger die takes the furthest-back one.</p>`,
    task: `You rolled <b>5–2</b>. Nothing stands on 20 or further back than 21, so the 5 bears off from <b>21</b>; the 2 bears off from <b>23</b>. Bear off two checkers.`,
    check: (v) => v.myOff === 2 && v.mine[rOf(21)] === 2 && v.mine[rOf(23)] === 3,
    answer: [{ from: 21, to: 'off', d: 5 }, { from: 23, to: 'off', d: 2 }],
    win: `<p>Two checkers off: the 2 was exact, the 5 was bigger than needed so it took the furthest-back checker. The first to bear off all fifteen wins.</p>`,
    miss: `<p>Bear off one checker from 21 with the 5 and one from 23 with the 2. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'mars', title: 'Mars: a double win',
    mine: { 24: 3 }, myOff: 12, opp: { 8: 5, 9: 5, 10: 5 }, dice: [1, 1], goal: [],
    teach: `<p>A win scores <b>1 point</b>. If you win before the computer has borne off <b>a single checker</b> it is a <b>mars</b>, and it counts <b>2 points</b>.</p>`,
    task: `You have 12 checkers off, three left on 24, and the computer has none off. You rolled <b>1–1</b>: bear off all three.`,
    check: (v) => v.myOff === 15,
    answer: [{ from: 24, to: 'off', d: 1 }, { from: 24, to: 'off', d: 1 }, { from: 24, to: 'off', d: 1 }],
    win: `<p><b>Mars!</b> Fifteen off while the computer has none: two points. That is every rule. Play a game, try the puzzles, or read the strategy guide to start winning on purpose.</p>`,
    miss: `<p>Bear off all three checkers from 24, one per 1. Press <b>Try again</b>.</p>`,
  },
];

// a lesson's board as an engine puzzle-style record (what puzzleGame / pzView expect)
export const lessonBoard = (L) => ({ ...boardFrom(L), dice: L.dice.slice() });
