// Static checks on the page shell (index.html): node test/page-check.mjs
// No browser: reads the inline stylesheet and asserts what the layout relies on.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let pass = 0, fails = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fails++; console.log('FAIL', msg); } };

// body of the first CSS rule whose selector is exactly `sel` (the base rule; media overrides come later)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
const rule = (sel) => {
  const m = html.match(new RegExp(`(?:^|[\\s,;{}])${esc(sel)}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no CSS rule for ${sel}`);
  return m[1];
};
const prop = (sel, name) => {
  const m = rule(sel).match(new RegExp(`(?:^|[\\s;])${esc(name)}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : '';
};
const z = (sel) => parseInt(prop(sel, 'z-index'), 10);     // NaN when the rule sets none

// ---------------------------------------------------------------- 1. stacking order
// A toast reports things that happen inside an open sheet (a refused .vbs / .vbg file, storage
// full, the saved-games cap), so it must paint over the sheets and the welcome screen; the
// loading veil and the full-screen strategy sheet stay on top of it.
ok(z('#toast') > z('.modal'), `toast (z-index ${z('#toast')}) must paint over an open sheet (.modal ${z('.modal')})`);
ok(z('#toast') > z('#hero'), `toast (z-index ${z('#toast')}) must paint over the welcome screen (#hero ${z('#hero')})`);
ok(z('#toast') < z('#veil'), `toast (z-index ${z('#toast')}) must stay under the loading veil (#veil ${z('#veil')})`);
ok(z('#toast') < z('#stratSheet'), `toast (z-index ${z('#toast')}) must stay under the strategy sheet (#stratSheet ${z('#stratSheet')})`);
ok(prop('#toast', 'pointer-events') === 'none', 'a toast above the sheets must not take clicks (pointer-events:none)');

// ---------------------------------------------------------------- 2. closed sheets leave the Tab order
// opacity:0 + pointer-events:none alone leave a closed sheet's buttons and checkboxes focusable (Tab
// walks through them unseen, Space toggles them) and readable by a screen reader. visibility:hidden
// takes them out; it is delayed by the length of the fade so the sheet still fades out, and the base
// rule must not transition visibility, so an opening sheet is visible (and focusable) at once.
const declOf = (body, name) => {
  const m = body.match(new RegExp(`(?:^|[\\s;])${esc(name)}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : '';
};
const fade = (transition) => (transition.match(/opacity\s+(\.\d+s)/) || [])[1] || '';
const leavesTabOrder = (what, hiddenBody, baseTransition) => {
  ok(declOf(hiddenBody, 'visibility') === 'hidden', `${what}: hidden with opacity alone stays in the Tab order (needs visibility:hidden)`);
  const t = declOf(hiddenBody, 'transition'), d = fade(baseTransition);
  ok(d !== '' && new RegExp(`opacity\\s+${esc(d)}`).test(t) && new RegExp(`visibility\\s+0s\\s+${esc(d)}`).test(t),
    `${what}: the fade-out must be kept and visibility delayed by it (opacity ${d}, visibility 0s ${d}; got "${t}")`);
  ok(!/visibility/.test(baseTransition), `${what}: the base rule must not transition visibility, or opening is delayed (got "${baseTransition}")`);
};
leavesTabOrder('a closed sheet (.modal.hidden)', rule('.modal.hidden'), prop('.modal', 'transition'));
// the game's own panels behind the welcome screen are hidden the same way
const behindHero = html.match(/body:has\(#hero:not\(\.hidden\)\)\s*:is\(([^)]*)\)\s*\{([^}]*)\}/);
ok(!!behindHero, 'the rule that hides the panels behind the welcome screen exists');
if (behindHero) {
  const first = behindHero[1].split(',')[0].trim();
  leavesTabOrder('the panels behind the welcome screen', behindHero[2], prop(behindHero[1].trim(), 'transition') || prop(first, 'transition'));
}

// ---------------------------------------------------------------- 3. no game keys behind an open sheet
// The page's key handler (src/main.js) must stop at every sheet before it reaches a game key:
// otherwise Space rolls or ends the turn, S slams, H hints and M starts Mr. Makis behind a sheet
// that hides the board. The guards sit between the start of the handler and its first game branch.
const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const keyStart = js.indexOf("window.addEventListener('keydown', (e) => {");
const keyEnd = keyStart < 0 ? -1 : js.indexOf("if (phase === 'replay')", keyStart);
ok(keyStart >= 0 && keyEnd > keyStart, 'the key handler and its first game branch (replay) are found in src/main.js');
const guards = keyEnd > keyStart ? js.slice(keyStart, keyEnd) : '';
for (const id of ['games', 'settings', 'rules', 'puzzles'])
  ok(guards.includes(`'${id}'`), `game keys act behind the open ${id} sheet (no guard for '${id}' before the first game key)`);

console.log(`${pass} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
