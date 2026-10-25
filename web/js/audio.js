// All music and sound effects are synthesized live with the Web Audio API - no sound files needed.

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.comp.connect(this.master).connect(c.destination);

    this.music = c.createGain(); this.music.gain.value = 0.45;
    this.duckGain = c.createGain(); this.duckGain.gain.value = 1;
    this.music.connect(this.duckGain).connect(this.comp);
    this.sfx = c.createGain(); this.sfx.gain.value = 1;
    this.sfx.connect(this.comp);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.2);
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(this.comp);

    this.noiseBuf = this._noise(2);
    this.theme = null;
    this._musicNodes = [];
    this._sched = null;
    this._nextTime = 0;
    this._step = 0;
    this.muted = false;
  }

  get running() { return this.ctx.state === 'running'; }
  async resume() { try { await this.ctx.resume(); } catch (e) { /* ignore */ } return this.running; }

  setVolume(v) { this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); this._vol = v; }
  setMusicVolume(v) { this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  toggleMute() { this.muted = !this.muted; this.setVolume(this._vol ?? 0.9); return this.muted; }
  duck(on) { this.duckGain.gain.setTargetAtTime(on ? 0.35 : 1, this.ctx.currentTime, on ? 0.08 : 0.4); }

  _impulse(seconds, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  _noise(seconds) {
    const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _env(g, t, a, peak, hold, rel) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }

  _osc(type, freq, t, dur, out, peak = 0.2, a = 0.01, rel = 0.2) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    this._env(g, t, a, peak, Math.max(0, dur - a), rel);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + rel + 0.05);
    return { o, g };
  }

  _noiseSrc(t, dur, out, peak = 0.3, filterType = 'bandpass', freq = 1000, q = 1, a = 0.01, rel = 0.3) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    this._env(g, t, a, peak, Math.max(0, dur - a), rel);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random()); s.stop(t + dur + rel + 0.05);
    return { s, f, g };
  }

  // ---------------- MUSIC ----------------

  playMusic(theme) {
    if (theme === this.theme) return;
    this.stopMusic();
    this.theme = theme;
    if (!theme) return;
    const c = this.ctx;
    this._nextTime = c.currentTime + 0.1;
    this._step = 0;
    if (theme === 'creepy') this._startDrone();
    this._sched = setInterval(() => this._schedule(), 30);
  }

  stopMusic(fade = 0.6) {
    clearInterval(this._sched); this._sched = null;
    const t = this.ctx.currentTime;
    for (const n of this._musicNodes) {
      try { n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0.0001, t, fade / 4); n.stop(t + fade + 0.1); } catch (e) { /* ignore */ }
    }
    this._musicNodes = [];
    this.theme = null;
  }

  _startDrone() {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 2);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 6;
    const lfo = c.createOscillator(), lfoG = c.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(f.frequency);
    const oscs = [NOTE(38), NOTE(38) * 1.006, NOTE(45) * 0.997, NOTE(26)].map((fr, i) => {
      const o = c.createOscillator(); o.type = i === 3 ? 'sine' : 'sawtooth'; o.frequency.value = fr; o.connect(f); return o;
    });
    f.connect(g); g.connect(this.music); g.connect(this.reverbSend);
    const all = [lfo, ...oscs];
    all.forEach(o => o.start(t));
    this._musicNodes.push({ g, stop: (when) => all.forEach(o => o.stop(when)) });
  }

  _schedule() {
    const c = this.ctx;
    while (this._nextTime < c.currentTime + 0.15) {
      if (this.theme === 'fun') this._funStep(this._step, this._nextTime);
      else if (this.theme === 'creepy') this._creepyStep(this._step, this._nextTime);
      const bpm = this.theme === 'fun' ? 132 : 60;
      this._nextTime += 60 / bpm / 2; // eighth notes
      this._step++;
    }
  }

  // Bouncy "monster party" tune (original), D minor.
  _funStep(step, t) {
    const bar = Math.floor(step / 8) % 8, s = step % 8;
    const roots = [50, 50, 46, 46, 43, 43, 45, 45]; // D D Bb Bb G G A A
    const root = roots[bar];
    // bass: root on 1, fifth on 3/5, chromatic walk on 7
    const bassPat = [0, null, 7, null, 0, null, 7, 6];
    if (bassPat[s] !== null) this._pluck(NOTE(root - 12 + bassPat[s]), t, 0.22, 'triangle', 0.32);
    // melody
    const mel = [
      [62, null, 65, 64, 62, null, 57, null], [62, null, 65, 64, 69, null, null, 68],
      [70, null, 69, 67, 65, null, 62, null], [65, 64, 62, null, 61, null, null, null],
      [67, null, 70, 69, 67, null, 62, null], [67, 69, 70, 72, 74, null, 70, null],
      [69, null, 67, 65, 64, null, 61, null], [62, null, 61, 62, 64, null, 57, null],
    ][bar][s];
    if (mel != null) this._pluck(NOTE(mel), t, 0.18, 'square', 0.07, true);
    // percussion
    if (s % 4 === 0) this._kick(t, 0.5);
    if (s % 4 === 2) this._noiseSrc(t, 0.03, this.music, 0.12, 'highpass', 6000, 0.7, 0.002, 0.05);
    if (s === 4 || s === 0) { /* on-beat clap every other bar for groove */ if (bar % 2 === 1 && s === 4) this._noiseSrc(t, 0.05, this.music, 0.18, 'bandpass', 1800, 1.2, 0.002, 0.12); }
  }

  // Sparse creepy music box notes + occasional wind.
  _creepyStep(step, t) {
    if (step % 2 === 0) {
      const seq = [74, null, 77, 76, null, 73, null, null, 74, 70, null, 69, null, null, 65, null];
      const n = seq[(step / 2) % seq.length];
      if (n != null && Math.random() < 0.85) {
        const f = NOTE(n) * (1 + (Math.random() - 0.5) * 0.006); // slightly out of tune
        const { o, g } = this._osc('sine', f, t, 0.05, this.music, 0.06, 0.003, 1.4);
        g.connect(this.reverbSend);
        this._osc('sine', f * 3.01, t, 0.03, this.reverbSend, 0.015, 0.003, 0.8);
      }
    }
    if (step % 24 === 0 && Math.random() < 0.6) {
      const n = this._noiseSrc(t, 3.5, this.music, 0.05, 'bandpass', 500, 4, 1.5, 2);
      n.f.frequency.linearRampToValueAtTime(900, t + 2.5);
      n.g.connect(this.reverbSend);
    }
    if (step % 32 === 16 && Math.random() < 0.4) this.creak(t);
  }

  _pluck(freq, t, dur, type, peak, bright = false) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass'; f.frequency.setValueAtTime(bright ? 3500 : 1400, t); f.frequency.exponentialRampToValueAtTime(400, t + dur);
    this._env(g, t, 0.005, peak, dur * 0.3, dur);
    o.connect(f).connect(g).connect(this.music);
    if (bright) g.connect(this.reverbSend);
    o.start(t); o.stop(t + dur * 1.5 + 0.1);
  }

  _kick(t, peak) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    this._env(g, t, 0.002, peak, 0.02, 0.18);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.3);
  }

  // ---------------- SOUND EFFECTS ----------------

  now() { return this.ctx.currentTime; }

  heartbeat(t = this.now(), peak = 0.8) {
    for (const [dt, p] of [[0, peak], [0.22, peak * 0.7]]) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
      this._env(g, t + dt, 0.005, p, 0.03, 0.15);
      o.connect(g).connect(this.sfx); o.start(t + dt); o.stop(t + dt + 0.3);
    }
  }

  thunder(t = this.now(), peak = 0.9) {
    const n = this._noiseSrc(t, 0.4, this.sfx, peak, 'lowpass', 900, 0.5, 0.01, 2.8);
    n.f.frequency.exponentialRampToValueAtTime(120, t + 2.5);
    n.g.connect(this.reverbSend);
    const r = this._noiseSrc(t + 0.15, 1.2, this.sfx, peak * 0.6, 'lowpass', 200, 0.8, 0.3, 2);
    r.g.connect(this.reverbSend);
  }

  whoosh(t = this.now(), up = true, peak = 0.5) {
    const n = this._noiseSrc(t, 0.35, this.sfx, peak, 'bandpass', up ? 300 : 3000, 2, 0.15, 0.25);
    n.f.frequency.exponentialRampToValueAtTime(up ? 3000 : 300, t + 0.5);
  }

  creak(t = this.now()) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    for (let i = 0; i < 12; i++) o.frequency.setValueAtTime(70 + Math.random() * 60, t + i * 0.07);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 8;
    this._env(g, t, 0.1, 0.12, 0.7, 0.2);
    o.connect(f).connect(g).connect(this.music); g.connect(this.reverbSend);
    o.start(t); o.stop(t + 1.2);
  }

  slideWhistle(t = this.now(), up = true) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 500 : 1500, t);
    o.frequency.exponentialRampToValueAtTime(up ? 1600 : 400, t + 0.45);
    lfo.frequency.value = 9; lg.gain.value = 18; lfo.connect(lg).connect(o.frequency);
    this._env(g, t, 0.03, 0.35, 0.38, 0.08);
    o.connect(g).connect(this.sfx);
    o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
  }

  pop(t = this.now()) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    this._env(g, t, 0.002, 0.6, 0.01, 0.08);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.2);
    this._noiseSrc(t, 0.02, this.sfx, 0.3, 'highpass', 2000, 0.5, 0.001, 0.05);
  }

  sparkle(t = this.now()) {
    const notes = [86, 89, 93, 98, 93, 98, 101];
    notes.forEach((n, i) => {
      const { g } = this._osc('sine', NOTE(n), t + i * 0.055, 0.03, this.sfx, 0.08, 0.002, 0.5);
      g.connect(this.reverbSend);
    });
  }

  boing(t = this.now()) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.5);
    lfo.frequency.setValueAtTime(14, t); lfo.frequency.linearRampToValueAtTime(5, t + 0.6); lg.gain.value = 60;
    lfo.connect(lg).connect(o.frequency);
    this._env(g, t, 0.005, 0.4, 0.2, 0.4);
    o.connect(g).connect(this.sfx); o.start(t); lfo.start(t); o.stop(t + 0.8); lfo.stop(t + 0.8);
  }

  // Dissonant orchestral-style hit for scares.
  sting(t = this.now(), peak = 0.6) {
    [48, 49, 55, 60, 61, 66, 72, 73].forEach((n, i) => {
      const { g } = this._osc('sawtooth', NOTE(n), t, 0.6, this.sfx, peak / 6, 0.005, 1.2);
      g.connect(this.reverbSend);
    });
    const n = this._noiseSrc(t, 0.1, this.sfx, peak, 'lowpass', 3000, 0.5, 0.002, 0.6);
    n.g.connect(this.reverbSend);
  }

  growl(t = this.now(), dur = 1.2, peak = 0.6) {
    const c = this.ctx, ws = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    ws.curve = curve;
    const g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    this._env(g, t, 0.05, peak, dur, 0.4);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 23; lg.gain.value = 18; lfo.start(t); lfo.stop(t + dur + 0.6);
    [55, 58.5, 82].forEach(fr => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(fr, t);
      o.frequency.linearRampToValueAtTime(fr * 0.8, t + dur);
      lfo.connect(lg).connect(o.frequency);
      o.connect(ws); o.start(t); o.stop(t + dur + 0.6);
    });
    ws.connect(f).connect(g).connect(this.sfx); g.connect(this.reverbSend);
  }

  // Synthesized scream: detuned saws with vibrato through vocal formants + breath noise.
  scream(t = this.now(), dur = 1.4, peak = 0.75) {
    const c = this.ctx, out = c.createGain();
    this._env(out, t, 0.03, peak, dur, 0.5);
    out.connect(this.sfx); out.connect(this.reverbSend);
    const formants = [[900, 6], [1400, 7], [2700, 8]].map(([fr, q]) => {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = q; f.connect(out); return f;
    });
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 7; lg.gain.value = 35; lfo.connect(lg); lfo.start(t); lfo.stop(t + dur + 0.6);
    [880, 1046, 1180, 700].forEach((f0, i) => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.75, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.05, t + 0.12);
      o.frequency.linearRampToValueAtTime(f0 * 0.95, t + dur * 0.7);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + dur + 0.4);
      lg.connect(o.frequency);
      const g = c.createGain(); g.gain.value = 0.5;
      o.connect(g); formants.forEach(f => g.connect(f));
      o.start(t); o.stop(t + dur + 0.6);
    });
    const n = this._noiseSrc(t, dur, out, 0.5, 'bandpass', 2500, 1, 0.02, 0.4);
  }

  // Low "mwa ha ha ha" made of formant bursts.
  evilLaugh(t = this.now(), pitch = 105, count = 6, peak = 0.5) {
    const c = this.ctx;
    for (let i = 0; i < count; i++) {
      const st = t + i * 0.2;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      const f0 = pitch * (1.25 - i * 0.05);
      o.frequency.setValueAtTime(f0 * 1.1, st); o.frequency.linearRampToValueAtTime(f0 * 0.9, st + 0.15);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 750; f1.Q.value = 5;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 6;
      this._env(g, st, 0.015, peak, 0.08, 0.08);
      o.connect(f1).connect(g); o.connect(f2).connect(g);
      g.connect(this.sfx); g.connect(this.reverbSend);
      o.start(st); o.stop(st + 0.3);
      this._noiseSrc(st, 0.03, g, 0.3, 'bandpass', 1500, 1, 0.005, 0.03);
    }
  }

  // Play a natural (Piper) voice phrase with a character effect. Returns {stop, analyser}.
  //   pumpkin: a touch of room   ghost: airy, echo + wobble   skull: deep, cavernous
  //   demon: distorted, with an octave-lower copy underneath (growl)
  playVoice(buffer, fx, rate, onEnd) {
    const c = this.ctx, t = c.currentTime;
    const nodes = [];
    const node = n => { nodes.push(n); return n; };
    const input = node(c.createGain());
    const analyser = node(c.createAnalyser()); analyser.fftSize = 512;
    const out = node(c.createGain()); out.gain.value = 0.85; // Piper output is already close to full scale
    input.connect(analyser);
    out.connect(this.sfx);
    const send = amount => { const g = node(c.createGain()); g.gain.value = amount; out.connect(g).connect(this.reverbSend); };
    const sources = [];
    const source = (r, gain) => {
      const s = node(c.createBufferSource()); s.buffer = buffer; s.playbackRate.value = r;
      const g = node(c.createGain()); g.gain.value = gain;
      s.connect(g).connect(input); sources.push(s); return s;
    };
    source(rate, 1);

    if (fx === 'ghost') {
      const hp = node(c.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 220;
      const trem = node(c.createGain()); trem.gain.value = 0.85;
      const lfo = node(c.createOscillator()), lfoG = node(c.createGain()); lfo.frequency.value = 5.5; lfoG.gain.value = 0.15;
      lfo.connect(lfoG).connect(trem.gain); // started/stopped together with the voice (below)
      const delay = node(c.createDelay(1)), fb = node(c.createGain()), wet = node(c.createGain()), lp = node(c.createBiquadFilter());
      delay.delayTime.value = 0.21; fb.gain.value = 0.35; wet.gain.value = 0.4; lp.type = 'lowpass'; lp.frequency.value = 3200;
      input.connect(hp).connect(trem).connect(out);
      out.gain.value = 0.75;
      trem.connect(delay); delay.connect(lp).connect(fb).connect(delay); lp.connect(wet).connect(out);
      send(0.45);
      sources.push(lfo);
    } else if (fx === 'skull') {
      const shelf = node(c.createBiquadFilter()); shelf.type = 'lowshelf'; shelf.frequency.value = 220; shelf.gain.value = 5;
      const lp = node(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 4800;
      input.connect(shelf).connect(lp).connect(out);
      out.gain.value = 0.75;
      send(0.4);
    } else if (fx === 'demon') {
      source(rate * 0.5, 0.32); // octave-down growl layer
      const ws = node(c.createWaveShaper());
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
      ws.curve = curve;
      const shelf = node(c.createBiquadFilter()); shelf.type = 'lowshelf'; shelf.frequency.value = 180; shelf.gain.value = 4;
      const lp = node(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 3000;
      input.connect(ws).connect(shelf).connect(lp).connect(out);
      out.gain.value = 0.38;
      send(0.5);
    } else { // pumpkin / default
      input.connect(out);
      send(0.12);
    }

    let ended = false;
    const finish = () => {
      if (ended) return; ended = true;
      setTimeout(() => nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } }), 1500); // let echoes ring out
      onEnd?.();
    };
    const main = sources[0];
    main.onended = finish;
    sources.forEach(s => s.start(t));
    // the growl layer is twice as long; stop everything with the main voice
    const dur = buffer.duration / rate;
    sources.slice(1).forEach(s => { try { s.stop(t + dur + 0.05); } catch (e) { /* ignore */ } });
    return {
      analyser,
      stop: () => { sources.forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } }); finish(); },
    };
  }

  // Play a user audio file through the same volume controls.
  playFile(url) {
    const a = new Audio(url);
    let src = null;
    try {
      src = this.ctx.createMediaElementSource(a);
      src.connect(this.sfx);
    } catch (e) { /* fall back to direct output */ }
    // release the audio graph node when done (one is created per played file)
    const release = () => { try { src?.disconnect(); } catch (e) { /* ignore */ } a.removeAttribute('src'); };
    a.addEventListener('ended', release, { once: true });
    a.addEventListener('error', release, { once: true });
    a.addEventListener('pause', () => { if (!a.ended) release(); }, { once: true });
    a.play().catch(() => {});
    return a;
  }
}
