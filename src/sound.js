// Synthesized sound (no audio files): wooden checker clicks, dice rattle, chimes.
// Based on peg-game's Sound.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 0.6;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setMuted(m) { this.muted = m; if (this.out) this.out.gain.value = m ? 0 : 0.6; return m; }
  _ok() { return this.ctx && !this.muted; }

  // short decaying noise + resonant body = a wooden "tok"
  tok(vol = 0.7, freq = 620) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime, c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * (0.9 + Math.random() * 0.2), t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.09);
    g.gain.setValueAtTime(vol * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.14);
    this._noise(0.03, vol * 0.35, 2500);
  }
  _noise(dur, vol, cutoff) {
    const c = this.ctx, t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f).connect(g).connect(this.out); s.start(t);
  }
  place() { this.tok(0.75, 540); }
  click() { this.tok(0.3, 1100); }
  nope() { this.tok(0.3, 240); }
  // One filtered burst of noise, `at` seconds from now: instant attack, exponential decay.
  // Scheduled on the audio clock (not setTimeout), so a run of them keeps its rhythm.
  _burst(at, dur, vol, type, freq, q = 1) {
    const c = this.ctx, t = c.currentTime + at;
    if (!this._nb) { // one second of white noise, shared; every burst reads a random slice of it
      this._nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this._nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource(); s.buffer = this._nb;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 0.9, dur + 0.02);
  }
  // A small hard die on a wooden board. Three parts, as on a real board: the die's own click
  // (a few milliseconds, bright, no pitch), the board answering with a short hollow knock that
  // grows with the force of the blow, and - on the last, softest touch - the die rocking to rest
  // on its edges in a quickening run of ticks.
  dieHit(v = 0.5) {
    if (!this._ok()) return;
    const r = Math.random;
    this._burst(0, 0.012, v * 1.5, 'bandpass', 3000 + r() * 1800, 1.2);  // the die
    this._burst(0, 0.005, v * 0.5, 'highpass', 6000);                    // its edge: the "tick"
    this._burst(0, 0.13 + 0.12 * v, v * v * 3.2,'bandpass', 230 + r() * 110, 2.5); // the board's knock
    this._burst(0, 0.025, v * 0.5, 'lowpass', 900);                      // wood under the die
    if (v <= 0.2) {
      let t = 0.035, gap = 0.05;
      for (let i = 0; i < 4; i++) {
        this._burst(t, 0.006, v * 1.1 * Math.pow(0.7, i), 'bandpass', 3800 + r() * 1600, 1.5);
        t += gap; gap *= 0.68;
      }
    }
  }
  // two dice knocking against each other in a closed hand: bright clacks at uneven intervals,
  // a little muffled, over before the dice reach the board (~0.3 s after the throw starts)
  shake() {
    if (!this._ok()) return;
    const r = Math.random, n = 4 + Math.floor(r() * 2);
    let t = 0;
    for (let i = 0; i < n && t < 0.27; i++) {
      const v = 0.2 + r() * 0.2;
      this._burst(t, 0.009, v * 1.4, 'bandpass', 3400 + r() * 2200, 2);
      this._burst(t, 0.018, v * 0.35, 'lowpass', 1100);
      t += 0.035 + r() * 0.045;
    }
  }
  _tone(freq, at, dur, vol, type = 'sine') {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
  }
  win() {
    if (!this._ok()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { this._tone(f, i * 0.13, 0.9, 0.18); this._tone(f * 2, i * 0.13, 0.6, 0.05); });
  }
  // party-popper: a low thump with a burst of air, then a shower of tiny paper ticks
  pop() {
    if (!this._ok()) return;
    this.tok(0.5, 180);
    this._noise(0.16, 0.4, 4500);
    for (let i = 0; i < 9; i++) setTimeout(() => this._noise(0.012, 0.07 + Math.random() * 0.05, 6500), 120 + i * 85 + Math.random() * 60);
  }
  lose() {
    if (!this._ok()) return;
    [392, 329.63, 261.63].forEach((f, i) => this._tone(f, i * 0.18, 0.7, 0.16, 'triangle'));
  }
  turn() { if (this._ok()) this._tone(880, 0, 0.25, 0.05); }
  // pull-chain switch: the bead chain's metallic click-clack, and on a switch-on the faint
  // ping of a cold filament catching
  chain(on) {
    if (!this._ok()) return;
    this.tok(0.45, 2300);
    setTimeout(() => this.tok(0.3, 1600), 70);
    if (on) setTimeout(() => this._tone(1320, 0, 0.35, 0.025, 'sine'), 90);
  }
  // the half of the board swinging over: a rising rush of air
  whoosh(dur = 0.45) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(1800, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t);
  }
  // the board slammed shut: a deep thump, the crack of wood on wood, checkers rattling inside
  slam() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.4);
    g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.7);
    this._noise(0.2, 0.8, 1300);
    this.tok(0.9, 260);
    for (let i = 0; i < 10; i++) setTimeout(() => this.tok(0.2 + Math.random() * 0.3, 480 + Math.random() * 600), 50 + i * 32 + Math.random() * 40);
  }
}
