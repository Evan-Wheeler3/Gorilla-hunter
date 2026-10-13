/**
 * Every sound in the game is synthesised with Web Audio: no files to download. Sounds are placed
 * in the world (quieter with distance, panned left/right of the listener). Browsers only allow
 * audio after a tap or key press, so the context starts on the first input.
 */
type V = { x: number; y: number; z: number };

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private ambience: { stop(): void } | null = null;
  private nextBird = 0;
  muted = false;

  constructor() {
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { passive: true });
  }

  private start(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    // A gentle limiter so pile-ups of gore do not clip.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambience = this.startAmbience();
  }

  dispose(): void {
    this.ambience?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, yaw };
  }

  /** Called every frame: occasional bird calls and monkey whoops in the jungle. */
  update(): void {
    const c = this.ctx;
    if (!c || this.muted) return;
    if (c.currentTime > this.nextBird) {
      this.nextBird = c.currentTime + 1.5 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 30;
      const at = { x: this.listener.x + Math.cos(a) * r, y: this.listener.y + 8, z: this.listener.z + Math.sin(a) * r };
      if (Math.random() < 0.75) this.bird(at);
      else this.whoop(at);
    }
  }

  // ------------------------------------------------------------------ building blocks

  /** Gain + pan for a sound at `at` (or none, for UI sounds). Returns null when silent or too far. */
  private out(at: V | null, volume: number, range = 60): AudioNode | null {
    const c = this.ctx;
    if (!c || !this.master || this.muted) return null;
    const g = c.createGain();
    let vol = volume;
    let pan = 0;
    if (at) {
      const dx = at.x - this.listener.x, dz = at.z - this.listener.z;
      const d = Math.hypot(dx, at.y - this.listener.y, dz);
      if (d > range) return null;
      vol *= 1 / (1 + (d / 8) ** 1.6);
      // Right of the listener is (-cos yaw, sin yaw).
      const rx = -Math.cos(this.listener.yaw), rz = Math.sin(this.listener.yaw);
      pan = d > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / d)) : 0;
    }
    g.gain.value = vol;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  private noise(dest: AudioNode, t0: number, dur: number, opts: { type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; attack?: number; gain?: number } = {}): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 2000, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
    f.Q.value = opts.q ?? 0.7;
    const g = c.createGain();
    const peak = opts.gain ?? 1;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, opts: { type?: OscillatorType; freq: number; freqEnd?: number; gain?: number; attack?: number; vibrato?: number; vibratoRate?: number }): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
    if (opts.vibrato) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = opts.vibratoRate ?? 7;
      lg.gain.value = opts.vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.5, t0 + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime + 0.005 : 0;
  }

  // ------------------------------------------------------------------ game sounds

  /** Tranquilliser rifle: a compressed-air "pff-chk". */
  shot(at: V | null): void {
    const o = this.out(at, 0.7, 90);
    if (!o) return;
    const t = this.now();
    this.noise(o, t, 0.12, { type: 'bandpass', freq: 2500, freqEnd: 900, q: 1.2, gain: 0.9 });
    this.tone(o, t, 0.06, { type: 'square', freq: 180, freqEnd: 90, gain: 0.25 });
  }

  /** Dart lands: a wooden tok, or a meaty thwip in fur. */
  dartHit(at: V, flesh: boolean): void {
    const o = this.out(at, 0.6);
    if (!o) return;
    const t = this.now();
    if (flesh) {
      this.noise(o, t, 0.08, { type: 'bandpass', freq: 1200, q: 2, gain: 0.8 });
      this.tone(o, t, 0.12, { type: 'triangle', freq: 300, freqEnd: 120, gain: 0.5 });
    } else this.tone(o, t, 0.07, { type: 'square', freq: 900, freqEnd: 400, gain: 0.2 });
  }

  /** A gorilla goes down: a woozy falling whistle and a thud. */
  knockout(at: V): void {
    const o = this.out(at, 0.7);
    if (!o) return;
    const t = this.now();
    this.tone(o, t, 0.7, { type: 'sine', freq: 900, freqEnd: 180, gain: 0.35, vibrato: 25, vibratoRate: 9 });
    this.noise(o, t + 0.5, 0.25, { freq: 300, gain: 1 });
  }

  swipe(at: V): void {
    const o = this.out(at, 0.5);
    if (!o) return;
    this.noise(o, this.now(), 0.22, { type: 'bandpass', freq: 600, freqEnd: 3000, q: 1.5, attack: 0.06, gain: 0.8 });
  }

  dash(at: V): void {
    const o = this.out(at, 0.6);
    if (!o) return;
    const t = this.now();
    this.noise(o, t, 0.35, { type: 'bandpass', freq: 300, freqEnd: 1600, q: 1, attack: 0.04, gain: 0.9 });
    this.tone(o, t, 0.25, { type: 'sawtooth', freq: 70, freqEnd: 50, gain: 0.25 });
  }

  /** Big chest roar: two detuned saws through a growling filter. */
  roar(at: V, big = false): void {
    const o = this.out(at, big ? 0.9 : 0.6, 90);
    if (!o) return;
    const c = this.ctx!, t = this.now(), dur = big ? 1.1 : 0.7;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.linearRampToValueAtTime(1400, t + 0.15);
    f.frequency.exponentialRampToValueAtTime(300, t + dur);
    f.Q.value = 4;
    f.connect(o);
    for (const det of [0, 7]) this.tone(f, t, dur, { type: 'sawtooth', freq: 110 + det, freqEnd: 70, gain: 0.35, attack: 0.05, vibrato: 12, vibratoRate: 23 });
    this.noise(f, t, dur, { type: 'lowpass', freq: 1500, gain: 0.6, attack: 0.05 });
  }

  /** Wet, crunchy gore. */
  splat(at: V, big = false): void {
    const o = this.out(at, big ? 1 : 0.6);
    if (!o) return;
    const t = this.now();
    this.noise(o, t, big ? 0.45 : 0.25, { type: 'lowpass', freq: big ? 1800 : 1200, freqEnd: 200, gain: 1 });
    this.tone(o, t, 0.15, { type: 'sine', freq: big ? 90 : 140, freqEnd: 40, gain: 0.7 });
    // Crunch.
    for (let i = 0; i < (big ? 4 : 2); i++) this.noise(o, t + 0.02 + i * 0.03 + Math.random() * 0.02, 0.03, { type: 'highpass', freq: 2500, gain: 0.5 });
  }

  /** The hunter's scream: a rising then cracking voice. */
  scream(at: V): void {
    const o = this.out(at, 0.45, 70);
    if (!o) return;
    const t = this.now(), base = 420 + Math.random() * 120;
    const c = this.ctx!;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 1.2;
    f.connect(o);
    this.tone(f, t, 0.9, { type: 'sawtooth', freq: base, freqEnd: base * 1.6, gain: 0.5, attack: 0.04, vibrato: 30, vibratoRate: 11 });
    this.tone(f, t + 0.9, 0.3, { type: 'sawtooth', freq: base * 1.6, freqEnd: base * 0.7, gain: 0.3 });
  }

  slap(at: V): void {
    const o = this.out(at, 0.7);
    if (!o) return;
    this.noise(o, this.now(), 0.06, { type: 'highpass', freq: 1500, gain: 1 });
  }

  /** Gorilla turned into a hunter at the boat. */
  convert(at: V): void {
    const o = this.out(at, 0.5, 90);
    if (!o) return;
    const t = this.now();
    [523, 659, 784, 1047].forEach((f, i) => this.tone(o, t + i * 0.08, 0.25, { type: 'triangle', freq: f, gain: 0.3 }));
  }

  reloaded(): void {
    const o = this.out(null, 0.35);
    if (!o) return;
    const t = this.now();
    this.tone(o, t, 0.04, { type: 'square', freq: 1400, gain: 0.25 });
    this.tone(o, t + 0.09, 0.05, { type: 'square', freq: 1000, gain: 0.25 });
  }

  /** Short beep for the last seconds and phase changes. */
  beep(high = false): void {
    const o = this.out(null, 0.3);
    if (!o) return;
    this.tone(o, this.now(), 0.12, { type: 'sine', freq: high ? 1320 : 880, gain: 0.4 });
  }

  jingle(win: boolean): void {
    const o = this.out(null, 0.5);
    if (!o) return;
    const t = this.now();
    const notes = win ? [523, 659, 784, 1047, 1319] : [523, 466, 392, 311];
    notes.forEach((f, i) => this.tone(o, t + i * 0.14, 0.3, { type: 'triangle', freq: f, gain: 0.35 }));
  }

  footstep(at: V, heavy: boolean): void {
    const o = this.out(at, heavy ? 0.22 : 0.1, 30);
    if (!o) return;
    this.noise(o, this.now(), heavy ? 0.09 : 0.05, { type: 'lowpass', freq: heavy ? 500 : 900, gain: 1 });
  }

  private bird(at: V): void {
    const o = this.out(at, 0.12, 80);
    if (!o) return;
    const t = this.now(), f = 1800 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(o, t + i * 0.12, 0.08, { type: 'sine', freq: f, freqEnd: f * (Math.random() < 0.5 ? 1.4 : 0.7), gain: 0.4 });
  }

  private whoop(at: V): void {
    const o = this.out(at, 0.1, 80);
    if (!o) return;
    const t = this.now();
    for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.22, 0.2, { type: 'triangle', freq: 500, freqEnd: 900, gain: 0.4 });
  }

  /** A soft bed of wind and insects under everything. */
  private startAmbience(): { stop(): void } {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.4;
    const g = c.createGain();
    g.gain.value = 0.04;
    // Slow swell like wind in the leaves.
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.08;
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master!);
    // Insects: a faint high buzz that pulses.
    const ins = c.createOscillator();
    ins.type = 'sawtooth';
    ins.frequency.value = 4200;
    const ig = c.createGain();
    ig.gain.value = 0.004;
    const il = c.createOscillator(), ilg = c.createGain();
    il.frequency.value = 13;
    ilg.gain.value = 0.004;
    il.connect(ilg).connect(ig.gain);
    const ihp = c.createBiquadFilter();
    ihp.type = 'highpass';
    ihp.frequency.value = 3000;
    ins.connect(ihp).connect(ig).connect(this.master!);
    for (const n of [src, lfo, ins, il]) n.start();
    return { stop: () => [src, lfo, ins, il].forEach((n) => n.stop()) };
  }
}

/** The one audio engine for the page (browsers allow a single unlocked context to be reused). */
export const sound = new Sound();
