// Cross-checks strategy.html: node test/strategy-check.mjs
// 1. EN/EL parity: every section carries the same numbers in both languages.
// 2. Point claims: the hand-written point numbers (player's numbering, shown = 25 - r) agree with
//    the engine's geometry and with the page's own data tables (HEAT, OPEN).
import { readFileSync } from 'node:fs';
import { S, newGame, viewOf, finalPositions, expandDice } from '../src/engine.js';

const html = readFileSync(new URL('../strategy.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const shown = (r) => 25 - r;

// ---------------------------------------------------------------- 1. parity
const block = (id) => {
  const m = html.match(new RegExp(`<(section|footer)[^>]*id="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
  if (!m) throw new Error(`no block ${id}`);
  return m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ');
};
const nums = (text, lang) => {
  let t = text;
  if (lang === 'en') t = t.replace(/(\d),(\d{3})\b/g, '$1$2');
  else t = t.replace(/(\d)\.(\d{3})\b/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2');
  return (t.match(/\d+(\.\d+)?/g) || []).sort();
};
for (const id of ['thumbs', 'map', 'runner', 'wall', 'trapped', 'end', 'learn', 'method']) {
  const en = nums(block(id), 'en'), el = nums(block(`${id}-el`), 'el');
  const miss = (a, b) => { const r = b.slice(); return a.filter((x) => { const i = r.indexOf(x); if (i < 0) return true; r.splice(i, 1); return false; }); };
  ok(!miss(en, el).length && !miss(el, en).length, `${id}: EN-only ${JSON.stringify(miss(en, el))}, EL-only ${JSON.stringify(miss(el, en))}`);
}
// the script's label table (diagram captions): same numbers in both languages, and the right ones
const tEn = html.match(/\n  en: \{([\s\S]*?)\n  el: \{/)[1], tEl = html.match(/\n  el: \{([\s\S]*?)\n\};/)[1];
const tNums = (s) => (s.match(/\d+/g) || []).join(',');
ok(tNums(tEn) === tNums(tEl), `diagram labels: EN ${tNums(tEn)} vs EL ${tNums(tEl)}`);
ok(tNums(tEn) === '7,12,1,6,13,19,24', `diagram labels: home 7-12, start quarter 1-6, computer start 13, your home 19-24 (got ${tNums(tEn)})`);

// ---------------------------------------------------------------- 2. point claims
const mine = (lo, hi) => { const a = []; for (let n = lo; n <= hi; n++) a.push(25 - n); return a; };       // shown -> engine r
const theirs = (r) => S(r);                                                                              // my r -> computer's r
// quarters
ok(shown(12) === 13 && theirs(12) === 24, "computer's start is your 13");
ok(mine(7, 12).every((r) => theirs(r) >= 1 && theirs(r) <= 6), "your 7-12 = computer's home");
ok(mine(19, 24).every((r) => r <= 6), 'your home = 19-24');
ok(mine(1, 6).every((r) => r >= 19), 'your start quarter = 1-6 (engine 19-24)');
ok(mine(2, 6).every((r) => theirs(r) >= 7 && theirs(r) <= 11), "your 2-6 = last stretch before the computer's home (its 7-11)");
ok(mine(7, 8).every((r) => theirs(r) >= 5 && theirs(r) <= 6), "your 7-8 = computer's two outer home points");
ok(mine(14, 20).map((r) => shown(theirs(r))).sort((a, b) => a - b).join() === '2,3,4,5,6,7,8', 'your 14-20 = its 2-8');
ok(shown(theirs(25 - 24)) === 12, "your 24 = computer's 12");
ok(shown(S(1)) === 12, "computer's deepest home point = your 12");
ok(mine(2, 11).every((r) => theirs(r) >= 2), 'blocks on your 2-11 have the computer\'s point 1 past them');
ok(shown(6) === 19, 'highest home point (bear-off) = your 19');
ok(shown(11) === 14, 'escape = reaching your 14 or higher (engine 11 or lower)');
ok(shown(24) === 1 && 14 - 1 === 13, 'escape needs 13 pips from your 1');

// opening rolls: OPEN[roll] = [win%, engine point where the runner stops]
const OPEN = Function(`return ${html.match(/const OPEN = (\{[\s\S]*?\});/)[1]}`)();
for (const [roll, [, at]] of Object.entries(OPEN)) {
  const dice = roll.split('-').map(Number);
  const finals = finalPositions(viewOf(newGame(), 0), expandDice(dice));
  const runnerAt = finals.map((f) => { for (let r = 1; r <= 23; r++) if (f.mine[r]) return r; return 24; });
  ok(runnerAt.includes(at), `${roll}: runner stops at engine ${at} (got ${runnerAt})`);
}
const diceUsed = (d) => Math.max(...finalPositions(viewOf(newGame(), 0), expandDice(d)).map((f) => f.n));
ok(diceUsed([6, 6]) === 1 && shown(OPEN['6-6'][1]) === 7, '6-6: one six, to 7');
ok(diceUsed([4, 4]) === 2 && shown(OPEN['4-4'][1]) === 9, '4-4: two fours, to 9');
ok(diceUsed([3, 3]) === 3 && shown(OPEN['3-3'][1]) === 10, '3-3: three threes, to 10');
ok(diceUsed([2, 2]) === 4 && diceUsed([5, 5]) === 4, '2-2 and 5-5 play all four');
ok(shown(OPEN['5-5'][1]) === 16, '5-5: 1 -> 6 -> 11 -> 16');
const at = (n) => Object.entries(OPEN).filter(([, v]) => shown(v[1]) === n).map(([, v]) => v[0]);
const range = (ws) => `${Math.round(Math.min(...ws))}-${Math.round(Math.max(...ws))}`;
ok(range([...at(11), ...at(12)]) === '59-62', `reaching 11-12 wins about 60%, 59-62% (got ${range([...at(11), ...at(12)])})`);
ok(range([...at(4), ...at(5), ...at(6)]) === '50-53', `stopping on 4-6 is barely better than a coin toss, 50-53% (got ${range([...at(4), ...at(5), ...at(6)])})`);

// Expert occupancy: HEAT[r], claims quoted in the text in shown numbering
const HEAT = JSON.parse(html.match(/const HEAT = (\[[^\]]*\]);/)[1]);
const heat = (n) => HEAT[25 - n];
ok(heat(4) === 64 && heat(5) === 65 && heat(3) === 58 && heat(7) === 54 && heat(2) === 52, 'heaviest building 4-5 (64-65), 3 (58), 7 (54), 2 (52)');
ok(Math.max(...HEAT.filter((_, r) => r >= 1 && r <= 23 && ![20, 21, 22, 23, 18].includes(r))) < 52, 'no other point (bar the start) is held as often as those five');
ok(heat(24) === 47, 'point 24 held 47%');
ok(heat(1) === 99 && heat(13) === 0, 'start stack 1, computer start 13 never held');
ok([10, 11, 12].map(heat).sort((a, b) => a - b).join() === '11,13,23', "computer's deep home 10-12 held 11-23%");
// six in a row is legal again: the wall table runs to 10+
ok(/const WALL = \[\['≤ 3'[^\n]*\['10\+', [\d.]+, \d+\]\];/.test(html), 'wall table runs to 10+');

// no leftover pre-renumbering phrases (old numbering) in either language
for (const bad of ['17–23', '19–24 (far', '13–18', 'point 12 first', 'θέση 12.', '24 → 1', '(your 13)', 'στο δικό σου 13)']) {
  ok(!html.includes(bad), `leftover old numbering: "${bad}"`);
}
console.log(fails ? `${fails} failed` : 'strategy.html: all checks passed');
process.exit(fails ? 1 : 0);
