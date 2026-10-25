// Talking characters.
//
// Natural voices: Piper (run by the launcher, offline) generates each phrase once; it is saved on disk and
// played through Web Audio with a per-character effect (echo for the ghost, deep + distorted for the demon...).
// Windows voices (speechSynthesis) are the fallback: when Piper isn't installed, or a phrase isn't
// generated yet (the first time on a slow PC), that line is spoken with a Windows voice instead.

const FRIENDLY_HINT = /zira|aria|jenny|hazel|susan|eva|female|samantha|karen|libby|sonia|michelle|ana\b/i;
const SCARY_HINT = /david|mark|guy|george|male|ryan|daniel|christopher|eric|roger|steffan|james/i;

// Windows voices (fallback)
export const CHARACTERS = {
  jack:     { pitch: 1.2, rate: 1.0, style: 'friendly' }, // pumpkin
  ghost:    { pitch: 1.6, rate: 1.05, style: 'friendly' },
  skull:    { pitch: 0.5, rate: 0.85, style: 'scary' },
  demon:    { pitch: 0.3, rate: 0.75, style: 'scary' },
  narrator: { pitch: 0.8, rate: 0.9, style: 'scary' },
};

// Natural voices: pitch = playback-rate shift; tempo = resulting speed (Piper's length scale compensates
// so a lower voice doesn't also become slow); fx = effect chain in audio.js
export const NATURAL_FX = {
  jack:     { pitch: 1.06, tempo: 1.0, fx: 'pumpkin' },
  ghost:    { pitch: 1.18, tempo: 1.0, fx: 'ghost' },
  skull:    { pitch: 0.84, tempo: 0.92, fx: 'skull' },
  demon:    { pitch: 0.66, tempo: 0.85, fx: 'demon' },
  narrator: { pitch: 0.92, tempo: 0.95, fx: 'skull' },
};

// Which character says which phrase list (scare-adults: demon, or the skull in the "mild" scare)
export const PHRASE_VOICES = {
  'idle': ['jack'], 'approach-kids': ['ghost'], 'approach-adults': ['skull'],
  'near-kids': ['jack'], 'near-adults': ['skull'], 'scare-kids': ['ghost'], 'scare-adults': ['demon', 'skull'],
  'goodbye-kids': ['jack'], 'goodbye-adults': ['skull'],
};

const lengthScale = c => Math.round((NATURAL_FX[c] || NATURAL_FX.jack).pitch / (NATURAL_FX[c] || NATURAL_FX.jack).tempo * 100) / 100;

export class Speech {
  constructor(settings, audio) {
    this.s = settings;
    this.audio = audio;
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    this.speaking = false;
    this.level = 0;          // 0..1 mouth openness for animation
    this._target = 0;
    this.onSubtitle = null;  // (text|null) => void
    this.onWarmProgress = null; // (ready, total) => void
    this._fileAudio = null;
    this._playing = null;    // natural voice playback {stop, analyser}
    this._token = 0;         // increases on every say/stop, so an old request can't start talking late
    this._buffers = new Map(); // decoded natural phrases (small in-memory cache)
    this._liveRequests = 0;
    this.natural = { available: false, reason: 'not checked yet', voices: [] };
    this.warm = { ready: 0, total: 0, busy: false };
    this.lastEngine = '';    // 'natural' | 'windows' | 'subtitles' (for tests / status)
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices(); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
    // keep the mouth moving while a Windows voice talks (it gives no sound data to follow)
    setInterval(() => {
      if (this.speaking && !this._playing) this._target = Math.random() < 0.18 ? 0.05 : 0.35 + Math.random() * 0.65;
      else if (!this.speaking) this._target = 0;
    }, 90);
  }

  tick(dt) {
    if (this._playing?.analyser) { // natural voice: mouth follows the actual loudness
      const a = this._playing.analyser, d = this._buf || (this._buf = new Float32Array(a.fftSize));
      a.getFloatTimeDomainData(d);
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      this._target = Math.min(1, Math.sqrt(sum / d.length) * 7);
    }
    this.level += (this._target - this.level) * Math.min(1, dt * 18);
  }

  // ---------------------------------------------------------------- natural voices (Piper)

  async initNatural() {
    try {
      const r = await fetch('/api/tts/status', { cache: 'no-store' });
      this.natural = r.ok ? await r.json() : { available: false, reason: 'launcher has no voice service', voices: [] };
    } catch (e) {
      this.natural = { available: false, reason: 'launcher not reachable', voices: [] };
    }
    return this.natural;
  }

  useNatural() { return this.s.audio.engine !== 'windows' && this.natural.available; }

  // voice model + speaker for a character (narrator borrows the skull's voice)
  naturalVoice(character) {
    const conf = this.s.audio.natural?.[character === 'narrator' ? 'skull' : character] || this.s.audio.natural?.jack || {};
    const models = this.natural.voices || [];
    const model = models.find(v => v.name === conf.voice) || models.find(v => /libritts/i.test(v.name)) || models[0];
    if (!model) return null;
    const speaker = Math.max(0, Math.min(model.speakers - 1, Math.round(conf.speaker || 0)));
    return { voice: model.name, speaker, lengthScale: lengthScale(character) };
  }

  _request(text, character, { checkOnly = false, signal } = {}) {
    const v = this.naturalVoice(character);
    if (!v) return Promise.reject(new Error('no voice'));
    return fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text, ...v, checkOnly }), signal });
  }

  async _naturalBuffer(text, character, waitMs) {
    const v = this.naturalVoice(character);
    if (!v) return null;
    const key = `${v.voice}|${v.speaker}|${v.lengthScale}|${text}`;
    if (this._buffers.has(key)) return this._buffers.get(key);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), waitMs);
    this._liveRequests++;
    try {
      // the launcher keeps generating even if we stop waiting, so next time it's ready
      const r = await this._request(text, character, { signal: ctl.signal });
      if (!r.ok) return null;
      const buf = await this.audio.ctx.decodeAudioData(await r.arrayBuffer());
      this._buffers.set(key, buf);
      if (this._buffers.size > 80) this._buffers.delete(this._buffers.keys().next().value);
      return buf;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
      this._liveRequests--;
    }
  }

  // Generate all phrases in the background (one at a time) so they play instantly during the show.
  // items: [{text, character}]. Already generated phrases are skipped quickly.
  async prewarm(items) {
    const token = (this._warmToken = (this._warmToken || 0) + 1);
    const seen = new Set();
    const list = [];
    for (const it of items) {
      const v = this.naturalVoice(it.character);
      const k = v && `${v.voice}|${v.speaker}|${v.lengthScale}|${it.text}`;
      if (k && !seen.has(k)) { seen.add(k); list.push(it); }
    }
    this.warm = { ready: 0, total: list.length, busy: true };
    this.onWarmProgress?.(0, list.length);
    for (const it of list) {
      if (token !== this._warmToken || !this.useNatural()) return;
      // let live talking go first
      while ((this.speaking || this._liveRequests) && token === this._warmToken) await new Promise(r => setTimeout(r, 300));
      try {
        const check = await (await this._request(it.text, it.character, { checkOnly: true })).json();
        if (!check.ready) await this._request(it.text, it.character);
      } catch (e) { /* skip */ }
      if (token !== this._warmToken) return;
      this.warm.ready++;
      this.onWarmProgress?.(this.warm.ready, this.warm.total);
    }
    this.warm.busy = false;
  }

  // ---------------------------------------------------------------- Windows voices

  availableVoices() {
    const v = this.voices.length ? this.voices : (this.synth ? this.synth.getVoices() : []);
    return this.s.audio.allowOnlineVoices ? v : v.filter(x => x.localService);
  }

  pickVoice(style) {
    const all = this.availableVoices();
    if (!all.length) return null;
    if (this.s.audio.voice) {
      const v = all.find(x => x.name === this.s.audio.voice);
      if (v) return v;
    }
    const en = all.filter(x => /^en/i.test(x.lang));
    const pool = en.length ? en : all;
    const hint = style === 'friendly' ? FRIENDLY_HINT : SCARY_HINT;
    return pool.find(x => hint.test(x.name)) || pool.find(x => x.default) || pool[0];
  }

  // ---------------------------------------------------------------- common

  stop() {
    this._token++;
    if (this.synth) this.synth.cancel();
    if (this._fileAudio) { this._fileAudio.pause(); this._fileAudio = null; }
    if (this._playing) { this._playing.stop(); this._playing = null; }
    this._setSpeaking(false);
  }

  _setSpeaking(v, text) {
    this.speaking = v;
    this.audio?.duck(v);
    if (this.onSubtitle) this.onSubtitle(v && this.s.audio.subtitles ? text : null);
  }

  // Speak text as a character. Returns a promise that resolves when finished.
  async say(text, character = 'jack') {
    if (!text) return;
    if (!this.s.audio.speech || this.audio?.muted || (!this.synth && !this.useNatural())) {
      // still show the subtitle for a while so the screen "talks"
      this.lastEngine = 'subtitles';
      this._setSpeaking(true, text);
      await new Promise(res => setTimeout(res, 900 + text.length * 55));
      this._setSpeaking(false);
      return;
    }
    this.stop();
    const token = this._token;
    if (this.useNatural()) {
      const buf = await this._naturalBuffer(text, character, this.s.audio.naturalWaitMs ?? 2500);
      if (token !== this._token) return; // something else started talking meanwhile
      if (buf) return this._playNatural(buf, text, character, token);
    }
    if (this.synth) return this._sayWindows(text, character);
    this.lastEngine = 'subtitles';
    this._setSpeaking(true, text);
    await new Promise(res => setTimeout(res, 900 + text.length * 55));
    if (token === this._token) this._setSpeaking(false);
  }

  _playNatural(buf, text, character, token) {
    const fx = NATURAL_FX[character] || NATURAL_FX.jack;
    this.lastEngine = 'natural';
    return new Promise(res => {
      const p = this.audio.playVoice(buf, fx.fx, fx.pitch, () => {
        if (this._playing === p) this._playing = null;
        if (token === this._token) this._setSpeaking(false);
        res();
      });
      this._playing = p;
      this._setSpeaking(true, text);
    });
  }

  _sayWindows(text, character) {
    this.lastEngine = 'windows';
    const prof = CHARACTERS[character] || CHARACTERS.jack;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice(prof.style);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.pitch = prof.pitch; u.rate = prof.rate;
    u.volume = Math.min(1, (this.s.audio.volume ?? 0.9) + 0.1);
    return new Promise(res => {
      let done = false;
      const finish = () => { if (done) return; done = true; this._setSpeaking(false); res(); };
      u.onstart = () => this._setSpeaking(true, text);
      u.onend = finish;
      u.onerror = finish;
      // safety: some voices never fire onend
      setTimeout(finish, 2500 + text.length * 120);
      this._setSpeaking(true, text);
      this.synth.speak(u);
    });
  }

  // Play a user's sound file instead of the voice.
  playFile(url) {
    this.stop();
    this._fileAudio = this.audio.playFile(url);
    this._setSpeaking(true, null);
    return new Promise(res => {
      const end = () => { this._setSpeaking(false); this._fileAudio = null; res(); };
      this._fileAudio.onended = end;
      this._fileAudio.onerror = end;
    });
  }
}
