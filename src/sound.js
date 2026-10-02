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
  // bone dice hitting wood
  dieHit(v = 0.5) { if (this._ok()) { this.tok(v * 0.6, 1500 + Math.random() * 500); this._noise(0.02, v * 0.25, 5000); } }
  shake() {
    if (!this._ok()) return;
    for (let i = 0; i < 6; i++) setTimeout(() => this._noise(0.025, 0.12, 3500), i * 45);
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
  lose() {
    if (!this._ok()) return;
    [392, 329.63, 261.63].forEach((f, i) => this._tone(f, i * 0.18, 0.7, 0.16, 'triangle'));
  }
  turn() { if (this._ok()) this._tone(880, 0, 0.25, 0.05); }
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
