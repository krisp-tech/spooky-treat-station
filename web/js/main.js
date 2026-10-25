// Spooky Treat Station - wires camera, detection, the director, scenes, sound and the setup screen together.

import { loadSettings, saveSettings, replaceSettings, DEFAULTS, clone, firstRun } from './settings.js';
import { Detector } from './detector.js';
import { Tracker } from './tracker.js';
import { Director } from './director.js';
import { Renderer, makeScene } from './scenes.js';
import { AudioEngine } from './audio.js';
import { Speech, PHRASE_VOICES } from './speech.js';
import { MediaLayer, folderFor } from './media.js';
import { SetupPanel } from './setup.js';

const $ = sel => document.querySelector(sel);
const loading = $('#loading'), loadingText = $('#loading-text');
const setLoading = t => { loadingText.textContent = t; };

const s = await loadSettings();
let savedCopy = clone(s);

const audio = new AudioEngine();
audio.musicEnabled = s.audio.music;
const _playMusic = audio.playMusic.bind(audio);
audio.playMusic = theme => _playMusic(audio.musicEnabled ? theme : null);
audio.setVolume(s.audio.volume);
audio.setMusicVolume(s.audio.musicVolume);

const speech = new Speech(s, audio);
const renderer = new Renderer($('#stage'), s);
const detector = new Detector(s);
const tracker = new Tracker(s);
const director = new Director(s);
const media = new MediaLayer(s, $('#media'));

const subtitle = $('#subtitle');
speech.onSubtitle = text => {
  if (text) { subtitle.textContent = text; subtitle.classList.add('show'); }
  else subtitle.classList.remove('show');
};

// A do-nothing audio stand-in, used while a custom video plays (so built-in sounds don't overlap it).
const silentAudio = new Proxy({}, { get: (_, k) => k === 'now' ? () => 0 : () => {} });

const app = {
  s, detector, tracker, director, audio, speech, media, renderer,
  fps: 60,
  cameraError: '',
  save: async () => {
    const r = await saveSettings(s);
    savedCopy = clone(s);
    if (r.rev && known) known.settingsRev = r.rev; // our own save: nothing to re-apply
    return r;
  },
  // back to what is saved on disk (which may have been saved from another window)
  revert: async () => { replaceSettings(s, await loadSettings()); savedCopy = clone(s); afterSettingsReplaced(); },
  resetDefaults: () => { replaceSettings(s, DEFAULTS); afterSettingsReplaced(); setup.refreshAll(); setup.markDirty(); },
  // restart the current scene so changed settings (scare level, my media, music, phrases) show at once;
  // a running scare is left to finish
  replay: () => { if (director.stage !== 'scare') playStage(director.stage, director.audience); },
  applyDisplay,
  warmVoices,
  toast,
};

// Generate every phrase with the natural voices in the background, so they play instantly in the show.
// Cheap when nothing changed: already generated phrases are only checked, not regenerated.
function warmVoices() {
  setup?.updateVoiceStatus();
  if (!speech.useNatural()) return;
  const items = [];
  for (const [key, chars] of Object.entries(PHRASE_VOICES)) {
    for (const text of s.phrases[key] || []) for (const character of chars) items.push({ text, character });
  }
  speech.prewarm(items);
}

function afterSettingsReplaced() {
  tracker.refreshModel();
  audio.setVolume(s.audio.volume); audio.setMusicVolume(s.audio.musicVolume);
  audio.musicEnabled = s.audio.music;
  renderer.resize();
  detector.applySettings();
  applyDisplay();
  warmVoices();
}

// ---------------------------------------------------------------- live updates (no restart needed)
// Every 2 s ask the launcher whether settings.json or the media folders changed - e.g. saved from the
// Setup Mode window while this show runs, or edited by hand - and apply the changes right away.
let known = null;
async function pollState() {
  let st;
  try { st = await (await fetch('/api/state', { cache: 'no-store' })).json(); } catch (e) { return; }
  if (known) {
    if (st.settingsRev !== known.settingsRev) await applySavedSettings();
    if (st.mediaRev !== known.mediaRev) { await media.refresh(); setup.refreshMedia?.(); }
    if (st.openSetup !== known.openSetup && !setup.isOpen) setup.open();
  }
  known = st;
}

async function applySavedSettings() {
  if (setup.isOpen && setup.dirty) {
    toast('Settings were saved from another window — press "Undo changes" here to load them', 6000);
    return;
  }
  const fresh = await loadSettings();
  replaceSettings(s, fresh);
  savedCopy = clone(s);
  afterSettingsReplaced();
  setup.refreshAll();
  app.replay();
  toast('✔ New settings applied', 2500);
}

const setup = new SetupPanel(app);

// ---------------------------------------------------------------- stages

const lastPhrase = {};
function phrase(key) {
  const list = s.phrases[key] || [];
  if (!list.length) return '';
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastPhrase[key]) i = (i + 1) % list.length;
  lastPhrase[key] = i;
  return list[i];
}

let current = { scene: null, choice: null, talkTimer: null, custom: false };

function playStage(stage, audience, { builtinOnly = false } = {}) {
  clearTimeout(current.talkTimer);
  speech.stop();
  const scene = makeScene(stage, audience, { level: s.scare.adultLevel, strobe: s.scare.strobe });
  const choice = builtinOnly ? { visual: null, audio: null } : media.choose(stage, audience);
  const custom = !!choice.visual;
  current = { scene, choice, talkTimer: null, custom };

  if (custom) {
    audio.stopMusic(0.3);
    media.show(choice.visual, {
      loop: stage !== 'scare' && stage !== 'goodbye',
      muted: audio.muted,
      onDuration: d => { if (stage === 'scare' && director.stage === 'scare') director.sceneLength = Math.max(1500, d * 1000 + 300); },
      // unplayable file: show the built-in scene for this stage instead of a black screen
      onError: () => { if (current.scene === scene) { toast('Could not play ' + decodeURIComponent(choice.visual.split('/').pop()) + ' — using the built-in scene', 5000); playStage(stage, audience, { builtinOnly: true }); } },
    });
  } else {
    media.hide();
    if (scene.music) audio.playMusic(scene.music); else audio.stopMusic(0.15);
  }
  renderer.play(scene);

  // talking: say something when the stage starts, then repeat every few seconds
  const talkEvery = { idle: s.timing.idleTalkSec, approach: s.timing.approachTalkSec, near: s.timing.nearTalkSec }[stage];
  const key = stage === 'idle' ? 'idle' : folderFor(stage, audience);
  if (scene.talkKey && (!custom || choice.audio)) {
    const talk = () => {
      if (current.scene !== scene) return;
      sayKey(key, scene.voice).then(() => {
        if (current.scene !== scene || !talkEvery || scene.once) return;
        current.talkTimer = setTimeout(talk, talkEvery * 1000);
      });
    };
    current.talkTimer = setTimeout(talk, (scene.firstTalk ?? 1.5) * 1000);
  }
}

function sayKey(key, character) {
  if (current.choice?.audio) return speech.playFile(current.choice.audio);
  return speech.say(phrase(key), character);
}

director.onStage = (stage, audience, reason) => {
  console.log(`[stage] ${stage} (${audience}) - ${reason}`);
  playStage(stage, audience);
};
director.onAudience = audience => playStage(director.stage, audience);

// ---------------------------------------------------------------- detection

let lastDetection = 0;
detector.onCameraLost = () => {
  cameraWasLost = true;
  app.cameraError = 'Camera disconnected — trying to reconnect...';
  toast('📷 ' + app.cameraError, 6000);
};
detector.onResult = res => {
  lastDetection = res.time;
  const tracks = tracker.update(res.people, res.time);
  director.update(tracks, res, res.time);
  detector.setWantPose(director.info.level >= 1);
};
// Keep the show's timers running when no detections arrive (no camera, camera lost, detector stalled):
// feeding "nobody seen" lets old tracks expire so the show returns to inviting people instead of freezing.
setInterval(() => {
  const now = performance.now();
  if (now - lastDetection > 600) {
    const tracks = tracker.update([], now);
    director.update(tracks, { jarMotion: 0, hands: [] }, now);
  }
}, 250);

// ---------------------------------------------------------------- render loop

const env = {
  audio,
  say: (key, character) => current.custom && !current.choice?.audio ? Promise.resolve() : sayKey(key, character),
  talk: 0, look: 0,
  r: renderer, W: renderer.W, H: renderer.H,
};
const pip = $('#pip'), pipCtx = pip.getContext('2d');
const previewBadge = $('#preview-badge');
let lastFrame = performance.now(), fpsAcc = 0, fpsN = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { app.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  speech.tick(dt);
  env.talk = speech.level;
  const p = director.info.primary;
  const target = p ? clamp(((p.box.x + p.box.w / 2) - 0.5) * 2.2, -1, 1) * (s.camera.mirror ? 1 : -1) : Math.sin(now / 2500) * 0.5;
  env.look += (target - env.look) * Math.min(1, dt * 4);
  env.audio = current.custom ? silentAudio : audio;
  if (!media.visible) renderer.frame(dt, env);
  else if (current.scene) { current.scene.step(dt, env); renderer.particles.list.length = 0; } // hidden: don't pile up particles
  if (s.display.showPip) drawPip();
  previewBadge.classList.toggle('show', director.hold && !setup.isOpen);
  setup.draw();
  requestAnimationFrame(frame);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function drawPip() {
  const v = detector.video;
  if (!v.videoWidth) return;
  const W = pip.width, H = Math.round(W * v.videoHeight / v.videoWidth);
  if (pip.height !== H) pip.height = H;
  pipCtx.save();
  if (s.camera.mirror) { pipCtx.translate(W, 0); pipCtx.scale(-1, 1); }
  pipCtx.drawImage(v, 0, 0, W, H);
  pipCtx.restore();
  for (const t of tracker.tracks) {
    if (!t.fresh) continue;
    pipCtx.strokeStyle = ['#888', '#ffd33d', '#ff8a1f', '#ff2a2a'][t.level]; pipCtx.lineWidth = 2;
    pipCtx.strokeRect(t.box.x * W, t.box.y * H, t.box.w * W, t.box.h * H);
  }
  pipCtx.fillStyle = '#fff'; pipCtx.font = '12px sans-serif';
  pipCtx.fillText(`${director.stage} / ${director.audience}`, 6, 14);
}

// ---------------------------------------------------------------- UI helpers

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function applyPip() { pip.style.display = s.display.showPip ? 'block' : 'none'; }
function applyDisplay() {
  applyPip();
  document.body.classList.toggle('hide-cursor', !!s.display.hideCursor && !setup.isOpen);
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select') && e.key !== 'Escape') return;
  const k = e.key.toLowerCase();
  if (k === 's') setup.toggle();
  else if (k === 'escape') { if (setup.isOpen) setup.close(); }
  else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  else if (k === 'm') {
    const muted = audio.toggleMute();
    media.setMuted(muted);
    if (muted) speech.stop();
    toast(muted ? '🔇 Muted' : '🔊 Sound on', 1500);
  }
  else if (k === 'd') { s.display.showPip = !s.display.showPip; applyPip(); }
  else if (k === '0') { director.resumeAuto(); toast('Automatic mode', 1500); }
  else if (k === '1') director.force('idle', null);
  else if ('2345'.includes(k)) director.force(['approach', 'near', 'scare', 'goodbye'][+k - 2], 'kids');
  else if ('6789'.includes(k)) director.force(['approach', 'near', 'scare', 'goodbye'][+k - 6], 'adults');
});

async function unlockAudio() {
  await audio.resume();
  if (audio.running) {
    $('#click-to-start').classList.remove('show');
    if (!audio.theme && !current.custom && current.scene?.music) audio.playMusic(current.scene.music);
  }
}
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);

async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', keepAwake);

// ---------------------------------------------------------------- start up

async function start() {
  applyDisplay();
  setLoading('Loading fonts...');
  try { await Promise.race([Promise.all([document.fonts.load('100px Creepster'), document.fonts.load('100px "Luckiest Guy"')]), new Promise(r => setTimeout(r, 3000))]); } catch (e) { /* ignore */ }

  await media.refresh();
  await speech.initNatural(); // know which voices exist before the show starts talking

  setLoading('Starting camera...');
  await connectCamera();

  setLoading('Loading the AI (first start can take a moment)...');
  const mode = await detector.loadModels(setLoading);
  detector.start();
  if (mode !== 'ai') toast('AI detection could not start - using motion detection. See Setup > Advanced.', 8000);

  // Keep trying the camera: it may be busy at Windows sign-in, or get unplugged during the evening.
  setInterval(() => { if (!detector.cameraOk()) connectCamera(); }, 5000);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (!detector.cameraOk()) setTimeout(connectCamera, 1000); });

  loading.classList.add('hide');
  setTimeout(() => loading.remove(), 1200);
  speech.onWarmProgress = () => setup.updateVoiceStatus();
  setup.renderNatural?.();
  playStage('idle', director.audience);
  warmVoices();
  requestAnimationFrame(frame);
  keepAwake();
  pollState();
  setInterval(pollState, 2000);

  await audio.resume();
  if (!audio.running) $('#click-to-start').classList.add('show');

  if (app.cameraError) toast(app.cameraError + ' — retrying every few seconds. Press S to open Setup', 10000);
  const params = new URLSearchParams(location.search);
  if (params.has('setup') || firstRun) setup.open(firstRun);
}

let connecting = false, cameraWasLost = false;
async function connectCamera() {
  if (connecting) return;
  connecting = true;
  try {
    await detector.startCamera();
    if (app.cameraError || cameraWasLost) toast('📷 Camera connected', 3000);
    app.cameraError = '';
    cameraWasLost = false;
  } catch (e) {
    if (!app.cameraError) console.error(e);
    app.cameraError = 'Camera problem: ' + (e.message || e.name || e);
    cameraWasLost = true;
  } finally {
    connecting = false;
  }
}

start();

// for debugging / automated tests
window.spooky = app;
