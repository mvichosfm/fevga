// Runs the computer player and Mr. Makis's analysis off the main thread so the 3D scene never
// stutters while they think.
import { chooseMove, analyzeView } from './engine.js';

self.onmessage = (e) => {
  const { id, type } = e.data;
  if (type === 'makis') {
    const { view, rem, opts } = e.data;
    const v = { mine: Int8Array.from(view.mine), opp: Int8Array.from(view.opp), myOff: view.myOff, oppOff: view.oppOff };
    self.postMessage({ id, analysis: analyzeView(v, rem, opts) });
    return;
  }
  const { g, p, dice, level } = e.data;
  const game = { pos: [Int8Array.from(g.pos[0]), Int8Array.from(g.pos[1])], off: g.off.slice() };
  const steps = chooseMove(game, p, dice, level);
  self.postMessage({ id, steps });
};
