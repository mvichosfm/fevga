// Game records: the last few games kept automatically plus a handful of named saves, for
// replaying move by move. A record is
//   { id, date, level, human (0 white / 1 black), opening: [humanDie, cpuDie] | null,
//     openingPlay, turns: [{ p, dice: [a, b], steps: [{ r, t, d }] }], result: null |
//     { winner: 'you' | 'cpu', points } }  (+ name, savedAt for named saves)
// Positions are rebuilt by replaying `turns` from the start (engine.applySteps).
import { newGame, createTurn, turnPlay, commitTurn, winner } from './engine.js';

const KEY = 'fevga.games.v1';
export const MAX_RECENT = 5, MAX_SAVED = 10;

export function loadGames() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    return { recent: Array.isArray(d?.recent) ? d.recent : [], saved: Array.isArray(d?.saved) ? d.saved : [] };
  } catch { return { recent: [], saved: [] }; }
}

export function storeGames(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch { return false; }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const copy = (o) => JSON.parse(JSON.stringify(o));

// The game in progress is upserted after every turn, so it survives a closed tab.
export function upsertRecent(db, rec) {
  db.recent = [copy(rec), ...db.recent.filter((r) => r.id !== rec.id)].slice(0, MAX_RECENT);
}

export function saveNamed(db, rec, name) {
  if (db.saved.length >= MAX_SAVED) return false;
  db.saved.unshift({ ...copy(rec), id: newId(), name: cleanName(name) || 'Untitled game', savedAt: Date.now() });
  return true;
}

export function renameSaved(db, id, name) {
  const r = db.saved.find((s) => s.id === id);
  if (r && cleanName(name)) r.name = cleanName(name);
}

export function deleteSaved(db, id) { db.saved = db.saved.filter((s) => s.id !== id); }

const cleanName = (s) => String(s || '').trim().slice(0, 60);

// Points as the player sees them: each side counts its own path from its start = 1 to the
// last home point = 24 (Manos's choice, 2026-10-02). The engine and saved files keep the
// engine's own numbering r (start = 24, home 1-6); only text shown to people goes through this.
export const shown = (r) => 25 - r;

// "1/7 7/12" in the mover's own (shown) numbering; bearing off is "/off".
export const stepsText = (steps) => (steps.length ? steps.map((s) => `${shown(s.r)}/${s.t ? shown(s.t) : 'off'}`).join(' ') : 'no legal move');

export function resultText(rec) {
  if (!rec.result) return 'unfinished';
  if (rec.result.resigned) return `${rec.imported ? 'player' : 'you'} admitted the loss, computer +${rec.result.points}`;
  const pts = `+${rec.result.points}${rec.result.points === 2 ? ' (mars)' : ''}`;
  // an imported game's "you" is whoever played it, not the person reviewing it
  return rec.result.winner === 'you' ? `${rec.imported ? 'player' : 'you'} won ${pts}` : `computer won ${pts}`;
}

// ---------------------------------------------------------------- .vbg game files
// A .vbg file is UTF-8 JSON: { format: "fevga-vbg", version: 1, app, exportedAt, game } where
// game = { name, date, level, human, opening, openingPlay, turns: [{ p, dice, steps:[{r,t,d}] }] }.
// Imports are untrusted: every move is replayed through the rules engine and the result is
// recomputed from the final position, never taken from the file.
export const VBG_FORMAT = 'fevga-vbg', VBG_VERSION = 1, VBG_MAX_BYTES = 512 * 1024;

export function toVbg(rec) {
  const { name, date, level, human, opening, openingPlay, turns, match, resigned } = rec;
  return JSON.stringify({
    format: VBG_FORMAT, version: VBG_VERSION, app: 'Fevga · https://fevga.vichos.org',
    exportedAt: new Date().toISOString(),
    // resigned: the player conceded; resignPoints = 1 (single) or 2 (double). Both optional and
    // v1-compatible: a file with resigned but no resignPoints (older exports) is a double.
    game: { name, date, level, human, opening, openingPlay: !!openingPlay, turns, ...(match ? { match } : {}), ...(resigned ? { resigned: true, resignPoints: rec.result?.points === 1 ? 1 : 2 } : {}) },
  }, null, 1);
}

export const vbgFileName = (rec) => `${(rec.name || 'fevga-game').replace(/[^\p{L}\p{N} _.-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'fevga-game'}.vbg`;

const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

// Returns { rec } or { error } (a sentence fit to show the user).
export function parseVbg(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { error: 'This file is not a Fevga game (.vbg).' }; }
  if (!doc || doc.format !== VBG_FORMAT) return { error: 'This file is not a Fevga game (.vbg).' };
  if (!isInt(doc.version, 1, 999)) return { error: 'This .vbg file has no valid version.' };
  if (doc.version > VBG_VERSION) return { error: 'This game was saved by a newer version of Fevga.' };
  const g = doc.game;
  if (!g || !Array.isArray(g.turns) || g.turns.length > 3000) return { error: 'This .vbg file has no readable moves.' };
  const human = g.human === 1 ? 1 : 0;
  const level = isInt(g.level, 1, 5) ? g.level : 3;
  const opening = Array.isArray(g.opening) && g.opening.length === 2 && g.opening.every((d) => isInt(d, 1, 6)) ? g.opening.slice() : null;
  const pos = newGame(), turns = [];
  let prev = null;
  for (let i = 0; i < g.turns.length; i++) {
    const t = g.turns[i], bad = { error: `Move ${i + 1} in this file is damaged or not legal — the game cannot be replayed.` };
    if (!t || !isInt(t.p, 0, 1) || !Array.isArray(t.dice) || t.dice.length !== 2 || !t.dice.every((d) => isInt(d, 1, 6)) || !Array.isArray(t.steps) || t.steps.length > 4) return bad;
    if (prev !== null && t.p === prev) return { error: `Move ${i + 1}: the same side plays twice in a row — the file is damaged.` };
    if (winner(pos)) return { error: `The file has moves after the game was already over (move ${i + 1}).` };
    const T = createTurn(pos, t.p, t.dice);
    try {
      for (const s of t.steps) {
        if (!s || !isInt(s.r, 1, 24) || !isInt(s.d, 1, 6)) return bad;
        const done = turnPlay(T, { r: s.r, d: s.d });
        if (done.t !== s.t) return bad;
      }
    } catch { return bad; }
    if (T.played.length !== T.M) return bad; // a recorded turn always plays every die it can
    commitTurn(pos, T);
    turns.push({ p: t.p, dice: t.dice.slice(), steps: t.steps.map(({ r, t: to, d }) => ({ r, t: to, d })) });
    prev = t.p;
  }
  const w = winner(pos);
  // a concession is the only result not visible on the board; it only counts while the game was still open
  const resigned = !w && g.resigned === true;
  const resignPoints = g.resignPoints === 1 ? 1 : 2;
  return {
    rec: {
      name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 60) : 'Imported game',
      date: Number.isFinite(g.date) ? g.date : Date.now(),
      level, human, opening, openingPlay: !!g.openingPlay, turns, imported: true,
      ...(resigned ? { resigned: true } : {}),
      result: w ? { winner: w.p === human ? 'you' : 'cpu', points: w.points } : resigned ? { winner: 'cpu', points: resignPoints, resigned: true } : null,
    },
  };
}

// ---------------------------------------------------------------- .vbs settings files
// UTF-8 JSON: { format: "fevga-vbs", version: 1, app, exportedAt, setup, favourites: [{ name, s }] }
// where setup / s = { level, color, light, lamp, freeCam, view, theme, numbers, trails, round, total, muted, autoEnd,
// openingPlay, match }. (.vbs was Manos's choice; it is also the Windows VBScript extension, so
// mail filters may block it - the content is plain JSON and never executed by the game.)
// Imports are untrusted: every field is type-checked and clamped; unknown fields are dropped.
export const VBS_FORMAT = 'fevga-vbs', VBS_VERSION = 1, VBS_MAX_BYTES = 64 * 1024;

export function toVbs(setup, favourites) {
  return JSON.stringify({
    format: VBS_FORMAT, version: VBS_VERSION, app: 'Fevga · https://fevga.vichos.org',
    exportedAt: new Date().toISOString(),
    setup, favourites: favourites.map((f) => ({ name: f.name, s: f.s })),
  }, null, 1);
}

// A clean setup object from untrusted input (theme ids are re-checked by the caller).
export function cleanSetup(s) {
  if (!s || typeof s !== 'object') return null;
  const b = (x) => x === true;
  const view = Array.isArray(s.view) && s.view.length === 3 && s.view.every((x) => Number.isFinite(x) && Math.abs(x) < 1000) ? s.view.slice() : null;
  return {
    level: isInt(s.level, 1, 5) ? s.level : 3,
    color: s.color === 1 ? 1 : 0,
    light: Number.isFinite(s.light) ? Math.min(1.6, Math.max(0.25, s.light)) : 1,
    lamp: b(s.lamp), freeCam: b(s.freeCam), view: b(s.freeCam) ? null : view,
    theme: typeof s.theme === 'string' ? s.theme.slice(0, 40) : 'walnut',
    numbers: s.numbers !== false, trails: s.trails !== false, round: b(s.round), total: b(s.total), muted: b(s.muted), autoEnd: b(s.autoEnd), openingPlay: b(s.openingPlay), match: b(s.match),
  };
}

// Returns { setup, favourites } or { error }.
export function parseVbs(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { error: 'This file is not a Fevga settings file (.vbs).' }; }
  if (!doc || doc.format !== VBS_FORMAT) return { error: 'This file is not a Fevga settings file (.vbs).' };
  if (!isInt(doc.version, 1, 999)) return { error: 'This .vbs file has no valid version.' };
  if (doc.version > VBS_VERSION) return { error: 'These settings were saved by a newer version of Fevga.' };
  const setup = cleanSetup(doc.setup);
  if (!setup) return { error: 'This .vbs file has no readable settings.' };
  const favourites = (Array.isArray(doc.favourites) ? doc.favourites : []).slice(0, 50)
    .map((f) => ({ name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 40) : 'Favourite', s: cleanSetup(f?.s) }))
    .filter((f) => f.s);
  return { setup, favourites };
}

export const vbsFileName = () => `fevga-settings-${new Date().toISOString().slice(0, 10)}.vbs`;

export function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `Today ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}
