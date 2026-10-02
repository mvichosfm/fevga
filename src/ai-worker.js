// Runs the computer player, Mr. Makis's analysis and the mistake review off the main thread so
// the 3D scene never stutters while they think.
import { chooseMove, analyzeView, screenTurns, reviewTurn } from './engine.js';

self.onmessage = (e) => {
  const { id, type } = e.data;
  if (type === 'makis') {
    const { view, rem, opts } = e.data;
    const v = { mine: Int8Array.from(view.mine), opp: Int8Array.from(view.opp), myOff: view.myOff, oppOff: view.oppOff };
    self.postMessage({ id, analysis: analyzeView(v, rem, opts) });
    return;
  }
  if (type === 'screen') { self.postMessage({ id, analysis: screenTurns(e.data.turns, e.data.side) }); return; }
  if (type === 'review') { self.postMessage({ id, analysis: reviewTurn(e.data.turns, e.data.i, e.data.opts) }); return; }
  const { g, p, dice, level } = e.data;
  const game = { pos: [Int8Array.from(g.pos[0]), Int8Array.from(g.pos[1])], off: g.off.slice() };
  const steps = chooseMove(game, p, dice, level);
  self.postMessage({ id, steps });
};
