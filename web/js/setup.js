// Setup screen: live camera view with draggable zones, calibration, and all settings.

import { Detector } from './detector.js';
import { folderFor } from './media.js';
import { STAGES } from './settings.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

// the browser's built-in voices are called "Windows voices" on Windows
const SYS_VOICES = /Windows/.test(navigator.userAgent) ? 'Windows voices' : 'system voices';

const LEVEL_COLORS = ['#888', '#ffd33d', '#ff8a1f', '#ff2a2a'];
const LINE_DEFS = [
  ['approachLine', 'APPROACH', '#ffd33d'],
  ['nearLine', 'NEAR (treats)', '#ff8a1f'],
  ['scareLine', 'SCARE', '#ff2a2a'],
];

export class SetupPanel {
  constructor(app) {
    this.app = app;
    this.s = app.s;
    this.isOpen = false;
    this.dirty = false;
    this.drag = null;
    this.root = h('div', { id: 'setup', class: 'setup' });
    document.body.append(this.root);
    this.build();
  }

  get(path) { return path.split('.').reduce((o, k) => o?.[k], this.s); }
  set(path, v) {
    const keys = path.split('.'); const last = keys.pop();
    const o = keys.reduce((o, k) => o[k], this.s);
    o[last] = v;
    this.markDirty();
  }
  markDirty() { this.dirty = true; this.changed = true; this.saveBtn?.classList.add('attention'); this.statusMsg('Unsaved changes'); }
  statusMsg(t) { if (this.msgEl) this.msgEl.textContent = t; }

  // ---------- controls

  row(label, control, help) {
    return h('div', { class: 'row' }, h('label', {}, label), control, help ? h('div', { class: 'help' }, help) : null);
  }
  slider(path, min, max, step, fmt = v => v, after) {
    const val = h('span', { class: 'val' }, fmt(this.get(path)));
    const inp = h('input', { type: 'range', min, max, step, value: this.get(path) });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); this.set(path, v); val.textContent = fmt(v); after?.(v); });
    inp._refresh = () => { inp.value = this.get(path); val.textContent = fmt(this.get(path)); };
    (this.refreshers ||= []).push(inp._refresh);
    return h('div', { class: 'slider' }, inp, val);
  }
  check(path, after) {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = !!this.get(path);
    inp.addEventListener('change', () => { this.set(path, inp.checked); after?.(inp.checked); });
    (this.refreshers ||= []).push(() => { inp.checked = !!this.get(path); });
    return h('label', { class: 'switch' }, inp, h('span'));
  }
  select(path, options, after) {
    const sel = h('select', {}, options.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = this.get(path);
    sel.addEventListener('change', () => { this.set(path, sel.value); after?.(sel.value); });
    (this.refreshers ||= []).push(() => { sel.value = this.get(path); });
    return sel;
  }
  button(label, onclick, cls = '') { return h('button', { class: cls, onclick }, label); }

  // ---------- layout

  build() {
    const app = this.app;
    this.msgEl = h('span', { class: 'msg' }, '');
    this.saveBtn = this.button('Save', () => this.save(), 'primary');
    const head = h('div', { class: 'setup-head' },
      h('div', { class: 'brand' }, '🎃 Spooky Treat Station — Setup'),
      this.msgEl,
      h('div', { class: 'head-buttons' },
        this.saveBtn,
        this.button('Undo changes', () => this.revert()),
        this.button('Close (Esc)', () => this.close()),
      ));

    this.preview = h('canvas', { class: 'preview', width: 640, height: 480 });
    this.preview.addEventListener('pointerdown', e => this.onDown(e));
    this.preview.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    this.liveEl = h('div', { class: 'live' });
    const legend = h('div', { class: 'legend' },
      'Drag the coloured lines and the blue jar box on the camera picture. Lines mark where people\'s ', h('b', {}, 'feet'), ' are. ',
      h('span', { style: 'color:#ffd33d' }, '■ approach'), ' ', h('span', { style: 'color:#ff8a1f' }, '■ near the treats'), ' ',
      h('span', { style: 'color:#ff2a2a' }, '■ scare'), ' ', h('span', { style: 'color:#4cc9f0' }, '■ candy jar'), ' ', h('span', { style: 'color:#aaa' }, '┆ side limits'));
    const previewCol = h('div', { class: 'preview-col' }, this.preview, legend, this.liveEl);

    const tabs = [
      ['Start here', () => this.tabStart()],
      ['Zones', () => this.tabZones()],
      ['Kids vs adults', () => this.tabAudience()],
      ['Scare', () => this.tabScare()],
      ['Timing', () => this.tabTiming()],
      ['Sound & voice', () => this.tabSound()],
      ['My media', () => this.tabContent()],
      ['Phrases', () => this.tabPhrases()],
      ['Test', () => this.tabTest()],
      ['Advanced', () => this.tabAdvanced()],
    ];
    const nav = h('nav', { class: 'tabs' });
    const content = h('div', { class: 'tab-content' });
    this.panes = tabs.map(([name, fn], i) => {
      const pane = h('div', { class: 'pane' }, fn());
      const btn = h('button', { class: 'tab', onclick: () => select(i) }, name);
      nav.append(btn); content.append(pane);
      return { btn, pane };
    });
    const select = i => this.panes.forEach((p, j) => { p.btn.classList.toggle('active', i === j); p.pane.classList.toggle('active', i === j); });
    select(0);
    this.selectTab = select;
    const panelCol = h('div', { class: 'panel-col' }, nav, content);
    this.root.append(head, h('div', { class: 'setup-body' }, previewCol, panelCol));
  }

  tabStart() {
    const camSel = h('select', {}, h('option', { value: '' }, 'Automatic (first camera)'));
    const fill = async () => {
      const cams = await Detector.listCameras();
      camSel.innerHTML = '';
      camSel.append(h('option', { value: '' }, 'Automatic (first camera)'));
      cams.forEach((c, i) => camSel.append(h('option', { value: c.deviceId }, c.label || `Camera ${i + 1}`)));
      camSel.value = this.s.camera.deviceId || '';
    };
    fill();
    this.refreshCameras = fill;
    camSel.addEventListener('change', async () => {
      this.set('camera.deviceId', camSel.value);
      try { await this.app.detector.startCamera(); this.statusMsg('Camera switched'); } catch (e) { this.statusMsg('Camera error: ' + e.message); }
    });
    this.welcome = h('div', { class: 'welcome' });
    return [
      this.welcome,
      h('h3', {}, 'Quick setup (about 5 minutes)'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Choose your camera below. Point it along the driveway so people are seen ', h('b', {}, 'head to toe'), ' while walking up. Don\'t tilt it steeply down (then you only see legs). A narrow webcam like the Logitech C270 works best about 2 m high, 2–3 m behind the screen, tilted 10–15° down; on top of the monitor, tilt it only about 5° down.'),
        h('li', {}, h('b', {}, 'Zones: '), 'drag the yellow line to where visitors start to count (beyond it = sidewalk/street, ignored), the orange line to a step or two before the treats, and the red line right in front of the screen. If the camera can see the candy jar, switch on "Watch the candy jar" and drag the blue box over it.'),
        h('li', {}, h('b', {}, 'Kids vs adults: '), 'have an adult stand far away, then in the middle, then close, and press "Capture" each time. Now the station can tell kids from adults by height.'),
        h('li', {}, h('b', {}, 'Test: '), 'walk up the driveway yourself and watch the stage change in the status box. Use the Test tab to preview every scene.'),
        h('li', {}, 'Press ', h('b', {}, 'Save'), ', then ', h('b', {}, 'Close'), '. The show runs full screen. Press ', h('kbd', {}, 'S'), ' at any time to come back here.'),
      ),
      this.row('Camera', camSel),
      this.row('Camera picture', this.cameraFormatSelect(), 'Logitech C270 / C310: keep Standard (their widescreen mode cuts off the top and bottom). Wide webcams like the C920, C922 or Brio: Widescreen shows more to the sides. Redo the calibration after changing.'),
      this.row('Mirror picture', this.check('camera.mirror'), 'Leave on: the picture behaves like a mirror, and the characters look toward the visitor.'),
      h('h3', {}, 'Keyboard'),
      h('div', { class: 'keys' },
        h('div', {}, h('kbd', {}, 'S'), ' setup on/off'), h('div', {}, h('kbd', {}, 'F'), ' full screen'),
        h('div', {}, h('kbd', {}, 'M'), ' mute'), h('div', {}, h('kbd', {}, 'D'), ' small camera view on the show'),
        h('div', {}, h('kbd', {}, '1'), ' invite scene'), h('div', {}, h('kbd', {}, '2–5'), ' kids: welcome, treats, scare, bye'),
        h('div', {}, h('kbd', {}, '6–9'), ' adults: welcome, treats, scare, bye'), h('div', {}, h('kbd', {}, '0'), ' back to automatic'),
      ),
    ];
  }

  cameraFormatSelect() {
    const formats = [['640x480', 'Standard 4:3 (best for C270 / C310)'], ['1280x720', 'Widescreen 16:9 (C920, C922, Brio...)']];
    const sel = h('select', {}, formats.map(([v, l]) => h('option', { value: v }, l)));
    const current = () => `${this.s.camera.width}x${this.s.camera.height}`;
    sel.value = formats.some(([v]) => v === current()) ? current() : '640x480';
    sel.addEventListener('change', async () => {
      const [w, hgt] = sel.value.split('x').map(Number);
      this.s.camera.width = w; this.s.camera.height = hgt; this.markDirty();
      try { await this.app.detector.startCamera(); } catch (e) { this.statusMsg('Camera error: ' + e.message); return; }
      const v = this.app.detector.video;
      this.statusMsg(`Camera now ${v.videoWidth}×${v.videoHeight} — redo the calibration (Kids vs adults tab)`);
    });
    (this.refreshers ||= []).push(() => { sel.value = formats.some(([v]) => v === current()) ? current() : '640x480'; });
    return sel;
  }

  tabZones() {
    const pct = v => Math.round(v * 100) + '%';
    this.jarMeter = h('div', { class: 'meter' }, h('div'));
    return [
      h('p', { class: 'note' }, 'Lines are measured where a person\'s feet touch the ground. Dragging on the camera picture is the easiest way; the sliders do the same.'),
      this.row('Approach line', this.slider('zones.approachLine', 0, 1, 0.01, pct), 'Feet below this line = visitor is coming. Above it (far away, the street) is ignored.'),
      this.row('Near line', this.slider('zones.nearLine', 0, 1.2, 0.01, pct), 'Feet below this line = they are at the treats.'),
      this.row('Scare line', this.slider('zones.scareLine', 0, 1.5, 0.01, pct), 'Feet below this line = right in front of the screen. Over 100% means "feet below the bottom of the picture" (worked out from their height).'),
      this.row('Left limit', this.slider('zones.left', 0, 1, 0.01, pct), 'People left of this are ignored (e.g. the neighbour\'s yard).'),
      this.row('Right limit', this.slider('zones.right', 0, 1, 0.01, pct)),
      h('h3', {}, 'Candy jar'),
      this.row('Watch the candy jar', this.check('zones.jar.enabled'), 'Off by default. Turn on, then drag the blue box tightly over the jar: a hand reaching in triggers the scare (only while someone is at the treats).'),
      this.row('Jar sensitivity', this.slider('zones.jarSensitivity', 0.02, 0.5, 0.01, v => `${pct(v)} change`), 'Lower = reacts to smaller movements. Watch the live meter below while reaching into the jar.'),
      this.row('Live jar movement', this.jarMeter),
      this.row('Track hands (extra AI)', this.check('detection.handTracking', () => this.app.detector.applySettings()), 'Also detects wrists going into the jar box. More accurate but uses more computer power. Usually not needed.'),
    ];
  }

  tabAudience() {
    const m = v => v.toFixed(2) + ' m';
    this.calList = h('div', { class: 'cal-list' });
    this.modelEl = h('div', { class: 'note' });
    this.renderCal();
    return [
      h('h3', {}, 'Calibrate (recommended)'),
      h('p', { class: 'note' }, 'Ask an adult whose height you know to stand in the driveway with their WHOLE body visible (head to feet). Press Capture. Repeat at 2–3 different distances. Only one person should be in the picture.'),
      this.row('Their height', this.slider('calibration.refHeight', 1.2, 2.1, 0.01, m)),
      h('div', { class: 'btns' },
        this.button('📸 Capture', () => this.capture(), 'primary'),
        this.button('Remove last', () => { this.s.calibration.points.pop(); this.afterCal(); }),
        this.button('Clear all', () => { this.s.calibration.points = []; this.afterCal(); })),
      this.calList, this.modelEl,
      h('h3', {}, 'Who gets which show'),
      this.row('Audience', this.select('audience.mode', [['auto', 'Automatic (by height)'], ['kids', 'Always kids version'], ['adults', 'Always adults version']])),
      this.row('Kids are shorter than', this.slider('audience.childMaxHeight', 0.9, 1.7, 0.01, m), '1.40 m ≈ 4 ft 7 in, a typical 10 year old.'),
      this.row('Kids and adults together', this.select('audience.mixed', [['kids', 'Kids version (gentler)'], ['majority', 'Whoever is the majority']])),
      this.row('If height is unknown', this.select('audience.unsure', [['kids', 'Kids version'], ['adults', 'Adults version']]), 'Happens when someone appears close up without ever being seen head-to-toe.'),
      h('h3', {}, 'Without calibration'),
      h('p', { class: 'note' }, 'These rough values are used until you capture at least one point.'),
      this.row('Camera height', this.slider('calibration.cameraHeight', 0.3, 3, 0.05, m, () => this.afterCal(false))),
      this.row('Horizon in picture', this.slider('calibration.horizon', 0, 0.8, 0.01, v => Math.round(v * 100) + '%', () => this.afterCal(false))),
    ];
  }

  capture() {
    const now = performance.now();
    const ts = this.app.tracker.tracks.filter(t => now - t.lastSeen < 1000 && !t.box.motionOnly);
    if (ts.length !== 1) return this.statusMsg(ts.length ? `Capture needs exactly 1 person (I see ${ts.length})` : 'Nobody detected — stand in view first');
    const t = ts[0];
    if (!t.feetVisible || !t.headVisible) return this.statusMsg('Head and feet must both be visible in the picture');
    this.s.calibration.points.push({ footY: +(t.box.y + t.box.h).toFixed(4), h: +t.box.h.toFixed(4), H: this.s.calibration.refHeight });
    this.afterCal();
    this.statusMsg('Captured! Move to a different distance and capture again.');
  }

  afterCal(dirty = true) {
    this.app.tracker.refreshModel();
    this.app.tracker.tracks.forEach(t => { t.heights = []; });
    this.renderCal();
    if (dirty) this.markDirty();
  }

  renderCal() {
    const pts = this.s.calibration.points;
    this.calList.innerHTML = '';
    if (!pts.length) this.calList.append(h('div', { class: 'note' }, 'No calibration points yet.'));
    pts.forEach((p, i) => this.calList.append(h('div', {}, `#${i + 1}: feet at ${Math.round(p.footY * 100)}%, ${Math.round(p.h * 100)}% of picture tall, person ${p.H.toFixed(2)} m`)));
    this.modelEl.textContent = 'Height model: ' + this.app.tracker.model.source;
  }

  tabScare() {
    const sec = v => (v / 1000).toFixed(1) + ' s';
    return [
      this.row('Scare the kids too', this.check('scare.kidsEnabled'), 'Kids get a friendly cartoon ghost "BOO!" with a candy explosion. Turn off for no scare at all for kids.'),
      this.row('Adult scare level', this.select('scare.adultLevel', [['mild', 'Mild — skull lunges with a growl'], ['medium', 'Medium — blackout, then screaming face'], ['max', 'Maximum — double jump scare + thunder']])),
      this.row('Flashing strobe (max level)', this.check('scare.strobe'), '⚠️ Flashing lights can trigger seizures in people with photosensitive epilepsy. Off by default.'),
      this.row('Scare when very close', this.check('scare.triggerOnClose'), 'When someone crosses the red scare line.'),
      this.row('Scare when grabbing candy', this.check('scare.triggerOnGrab'), 'When movement is seen in the blue jar box.'),
      this.row('Delay before scare', this.slider('timing.scareDelayMs', 0, 3000, 100, sec), 'A short pause lets them reach into the jar first.'),
      this.row('Scare scene length', this.slider('timing.scareMs', 3000, 15000, 500, sec)),
      this.row('Don\'t scare same group again for', this.slider('timing.rearmMs', 5000, 120000, 1000, sec), 'The scare re-arms as soon as the driveway is empty, or after this time.'),
    ];
  }

  tabTiming() {
    const sec = v => (v / 1000).toFixed(1) + ' s';
    const s2 = v => v + ' s';
    return [
      this.row('Person must be seen for', this.slider('timing.confirmMs', 0, 3000, 100, sec), 'Avoids reacting to cars driving by or false detections.'),
      this.row('Wait before adult welcome', this.slider('timing.arrivalMs', 0, 4000, 100, sec), 'When only adults are seen, wait this long in case a child is right behind them (kids are smaller, so they are often spotted a moment later). The invite scene keeps playing meanwhile.'),
      this.row('Driveway empty after', this.slider('timing.emptyMs', 1000, 15000, 500, sec), 'How long nobody must be seen before saying goodbye.'),
      this.row('Shortest stage time', this.slider('timing.minStageMs', 0, 8000, 250, sec)),
      this.row('Goodbye scene length', this.slider('timing.goodbyeMs', 2000, 15000, 500, sec)),
      this.row('Invite: talk every', this.slider('timing.idleTalkSec', 4, 60, 1, s2)),
      this.row('Welcome: talk every', this.slider('timing.approachTalkSec', 3, 30, 1, s2)),
      this.row('Treats: talk every', this.slider('timing.nearTalkSec', 3, 30, 1, s2)),
    ];
  }

  tabSound() {
    const app = this.app;
    const pct = v => Math.round(v * 100) + '%';
    const voiceSel = h('select');
    const fillVoices = () => {
      const vs = app.speech.availableVoices();
      voiceSel.innerHTML = '';
      voiceSel.append(h('option', { value: '' }, 'Automatic (friendly + scary voices)'));
      vs.forEach(v => voiceSel.append(h('option', { value: v.name }, `${v.name} (${v.lang})${v.localService ? '' : ' — online'}`)));
      voiceSel.value = this.s.audio.voice || '';
    };
    fillVoices();
    window.speechSynthesis?.addEventListener?.('voiceschanged', fillVoices);
    voiceSel.addEventListener('change', () => this.set('audio.voice', voiceSel.value));

    // natural (Piper) voices: one row per character with speaker number, Try and "another voice"
    const chars = [['jack', '🎃 Pumpkin', 'Trick or treat! Come on up, I have candy!'], ['ghost', '👻 Ghost', 'Hello there, little monster! I love your costume!'],
      ['skull', '💀 Skull', 'One treat per head. Or I take yours.'], ['demon', '😈 Demon', 'I see you!']];
    this.voiceStatus = h('div', { class: 'note' });
    this.naturalRows = h('div');
    const renderNatural = () => {
      this.naturalRows.innerHTML = '';
      const models = app.speech.natural.voices || [];
      if (!app.speech.natural.available) return;
      for (const [c, label, sample] of chars) {
        const conf = this.s.audio.natural[c];
        const model = () => models.find(v => v.name === conf.voice) || models.find(v => /libritts/i.test(v.name)) || models[0];
        const num = h('input', { type: 'number', min: 0, max: model().speakers - 1, value: conf.speaker, style: 'width:90px' });
        num.addEventListener('change', () => { this.set(`audio.natural.${c}.speaker`, Math.max(0, Math.min(model().speakers - 1, +num.value || 0))); num.value = conf.speaker; });
        const modelSel = models.length > 1 ? h('select', { style: 'width:auto' }, h('option', { value: '' }, 'Automatic'), models.map(m => h('option', { value: m.name }, m.name))) : null;
        if (modelSel) { modelSel.value = conf.voice; modelSel.addEventListener('change', () => { this.set(`audio.natural.${c}.voice`, modelSel.value); renderNatural(); }); }
        const tryIt = () => app.speech.say(sample, c);
        this.naturalRows.append(this.row(label, h('div', { class: 'btns', style: 'margin:0;align-items:center' },
          modelSel, model().speakers > 1 ? [h('span', {}, 'speaker'), num] : null,
          this.button('▶ Try', tryIt, 'small'),
          model().speakers > 1 ? this.button('🎲 Another voice', () => { this.set(`audio.natural.${c}.speaker`, Math.floor(Math.random() * model().speakers)); num.value = conf.speaker; tryIt(); }, 'small') : null)));
      }
    };
    this.renderNatural = renderNatural;
    renderNatural();
    this.updateVoiceStatus();
    return [
      this.row('Volume', this.slider('audio.volume', 0, 1, 0.01, pct, v => app.audio.setVolume(v))),
      this.row('Background music', this.check('audio.music', v => { app.audio.musicEnabled = v; if (!v) app.audio.stopMusic(); else app.replay(); })),
      this.row('Music volume', this.slider('audio.musicVolume', 0, 1, 0.01, pct, v => app.audio.setMusicVolume(v))),
      this.row('Talking voice', this.check('audio.speech')),
      this.row('Subtitles', this.check('audio.subtitles'), 'Shows what is being said — helps when it is noisy outside.'),
      h('h3', {}, 'Voices'),
      this.row('Voice engine', this.select('audio.engine', [['auto', 'Natural voices if installed (recommended)'], ['natural', 'Natural voices (Piper)'], ['windows', SYS_VOICES[0].toUpperCase() + SYS_VOICES.slice(1) + ' only']], () => { this.updateVoiceStatus(); app.warmVoices(); })),
      this.voiceStatus,
      this.naturalRows,
      h('p', { class: 'note' }, 'Natural voices are made on this PC (no internet). Each sentence is generated once and saved, then it plays instantly. On a slow PC the first generation takes a few seconds per sentence, so after changing phrases or voices, leave the show running for a few minutes. Until a sentence is ready, one of the ' + SYS_VOICES + ' says it.'),
      h('div', { class: 'btns' }, this.button('Prepare all voices now', () => app.warmVoices())),
      this.row(SYS_VOICES === 'Windows voices' ? 'Windows voice' : 'System voice', voiceSel, 'Used when natural voices are off or not ready yet. "Automatic" uses a female voice for friendly characters and a male voice for scary ones.'),
      this.row('Allow online voices', this.check('audio.allowOnlineVoices', fillVoices), 'Edge has very natural "Online" voices, but they need internet.'),
      h('h3', {}, 'Try it'),
      h('div', { class: 'btns' },
        chars.map(([c, label, sample]) => this.button(label, () => app.speech.say(sample, c))),
        this.button('😱 Scream', () => app.audio.scream()),
        this.button('😂 Evil laugh', () => app.audio.evilLaugh()),
        this.button('⚡ Thunder', () => app.audio.thunder()),
        this.button('📯 Boo whistle', () => app.audio.slideWhistle())),
    ];
  }

  updateVoiceStatus() {
    if (!this.voiceStatus) return;
    const sp = this.app.speech, n = sp.natural, w = sp.warm;
    let t;
    if (this.s.audio.engine === 'windows') t = 'Using ' + SYS_VOICES + '.';
    else if (!n.available) t = '⚠️ Natural voices not available: ' + n.reason + '. Using ' + SYS_VOICES + '.';
    else {
      const models = n.voices.map(v => `${v.name}${v.speakers > 1 ? ` (${v.speakers} speakers)` : ''}`).join(', ');
      t = `✔ Natural voices: ${models}. ` + (w.total ? (w.ready < w.total ? `Preparing sentences: ${w.ready} / ${w.total}…` : `All ${w.total} sentences ready.`) : '');
    }
    this.voiceStatus.textContent = t;
  }

  tabContent() {
    const app = this.app;
    this.contentRows = h('div');
    this.mediaPath = h('code', {}, 'media');
    const render = () => {
      this.contentRows.innerHTML = '';
      for (const st of STAGES) {
        const counts = (st === 'idle' ? ['idle'] : [folderFor(st, 'kids'), folderFor(st, 'adults')])
          .map(f => { const c = app.media.count(f); return `${f}: ${c.visual} video/picture, ${c.audio} sound`; }).join(' · ');
        this.contentRows.append(this.row(st[0].toUpperCase() + st.slice(1),
          this.select(`content.${st}`, [['builtin', 'Built-in animation'], ['custom', 'My media'], ['mix', 'Mix (random)']]), counts));
      }
    };
    render();
    this.refreshMedia = render;
    fetch('/api/info').then(r => r.json()).then(i => { this.mediaPath.textContent = i.mediaDir; }).catch(() => {});
    return [
      h('p', { class: 'note' }, 'You can use your own Halloween videos, pictures and sound clips. Put them in the folders inside ', this.mediaPath,
        ' (one folder per stage, e.g. scare-adults). Then choose "My media" or "Mix" below. Videos play with their own sound.'),
      this.button('🔄 Re-scan folders', async () => { await app.media.refresh(); render(); this.statusMsg('Media folders scanned'); }),
      this.contentRows,
    ];
  }

  tabPhrases() {
    const app = this.app;
    const keys = Object.keys(this.s.phrases);
    const titles = {
      'idle': 'Invite (nobody there)', 'approach-kids': 'Welcome — kids', 'approach-adults': 'Welcome — adults',
      'near-kids': 'At the treats — kids', 'near-adults': 'At the treats — adults', 'scare-kids': 'Scare — kids (said right after BOO)',
      'scare-adults': 'Scare — adults (said after the scream)', 'goodbye-kids': 'Goodbye — kids', 'goodbye-adults': 'Goodbye — adults',
    };
    const voices = { idle: 'jack', 'approach-kids': 'ghost', 'approach-adults': 'skull', 'near-kids': 'jack', 'near-adults': 'skull', 'scare-kids': 'ghost', 'scare-adults': 'demon', 'goodbye-kids': 'jack', 'goodbye-adults': 'skull' };
    this.phraseAreas = {};
    return [
      h('p', { class: 'note' }, 'One sentence per line. A random line is chosen each time.'),
      keys.map(k => {
        const ta = h('textarea', { rows: 4 });
        ta.value = this.s.phrases[k].join('\n');
        ta.addEventListener('input', () => { this.s.phrases[k] = ta.value.split('\n').map(x => x.trim()).filter(Boolean); this.markDirty(); });
        this.phraseAreas[k] = ta;
        return h('div', { class: 'phrase' },
          h('div', { class: 'phrase-head' }, h('b', {}, titles[k] || k),
            this.button('▶ Try', () => { const list = this.s.phrases[k]; app.speech.say(list[Math.floor(Math.random() * list.length)], voices[k] || 'jack'); }, 'small')),
          ta);
      }),
    ];
  }

  tabTest() {
    const app = this.app;
    const b = (label, stage, aud) => this.button(label, () => app.director.force(stage, aud));
    return [
      h('p', { class: 'note' }, 'Preview any scene. Previews of the welcome/treat scenes stay on until you press "Back to automatic".'),
      h('div', { class: 'btns' }, b('Invite', 'idle', null)),
      h('h3', {}, 'Kids'),
      h('div', { class: 'btns' }, b('Welcome', 'approach', 'kids'), b('Take one', 'near', 'kids'), b('BOO!', 'scare', 'kids'), b('Goodbye', 'goodbye', 'kids')),
      h('h3', {}, 'Adults'),
      h('div', { class: 'btns' }, b('Welcome', 'approach', 'adults'), b('Take one', 'near', 'adults'), b('SCARE!', 'scare', 'adults'), b('Goodbye', 'goodbye', 'adults')),
      h('div', { class: 'btns' }, this.button('↩ Back to automatic', () => app.director.resumeAuto(), 'primary')),
      h('p', { class: 'note' }, 'Tip: close this setup screen to see the scene full size (press S to come back).'),
    ];
  }

  tabAdvanced() {
    const app = this.app;
    const pct = v => Math.round(v * 100) + '%';
    return [
      this.row('Detections per second', this.slider('detection.fps', 1, 15, 1, v => v + ' / s'), 'Lower this if the computer struggles. 4–6 is plenty.'),
      this.row('Detection confidence', this.slider('detection.minScore', 0.2, 0.9, 0.01, pct, () => app.detector.applySettings()), 'Higher = fewer false detections, but may miss people in dark costumes.'),
      this.row('Ignore people smaller than', this.slider('detection.minBoxHeight', 0, 0.4, 0.01, pct), 'Of the picture height. Helps ignore people far away on the street.'),
      this.row('Use graphics card (GPU)', this.check('detection.useGpu', () => app.detector.applySettings()), 'Experimental. Can be faster, but on some graphics drivers nobody gets detected. Switches over within a few seconds; walk in front of the camera to check it still sees you.'),
      this.row('Motion fallback', this.check('detection.motionFallback'), 'If the AI model cannot start, use simple motion detection (cannot tell kids from adults).'),
      this.row('Drawing quality', this.select('display.quality', [['low', 'Low (fastest)'], ['medium', 'Medium'], ['high', 'High (Full HD)']], () => app.renderer.resize()), 'Use Low on a slow computer.'),
      this.row('Small camera view on show', this.check('display.showPip', () => app.applyDisplay()), 'Also toggled with the D key.'),
      this.row('Hide mouse pointer', this.check('display.hideCursor', () => app.applyDisplay()), 'Hidden on the show; always visible while this setup screen is open.'),
      h('h3', {}, 'Other'),
      h('div', { class: 'btns' },
        this.button('Reset everything to defaults', () => { if (confirm('Reset all settings (including zones and calibration) to defaults?')) app.resetDefaults(); }),
        this.button('Reload app', () => location.reload()),
        this.button('Exit app', async () => {
          if (!confirm('Close Spooky Treat Station?')) return;
          try { await fetch('/api/quit', { method: 'POST' }); } catch (e) { /* ignore */ }
          window.close();
          document.body.innerHTML = '<div style="color:#fff;font:24px sans-serif;padding:40px">Stopped. Press Alt+F4 to close this window.</div>';
        }, 'danger')),
      h('p', { class: 'note' }, 'Settings are saved in settings.json next to the program. Copy that file to back up your setup.'),
    ];
  }

  refreshAll() {
    (this.refreshers || []).forEach(f => f());
    if (this.phraseAreas) for (const [k, ta] of Object.entries(this.phraseAreas)) ta.value = (this.s.phrases[k] || []).join('\n');
    this.renderCal();
    this.renderNatural?.();
    this.updateVoiceStatus();
  }

  async save() {
    const r = await this.app.save();
    this.dirty = false;
    this.saveBtn.classList.remove('attention');
    this.statusMsg(r.ok ? 'Saved ✔ — changes are live, no restart needed' : 'Saved in browser only (could not write settings.json)');
  }

  async revert() {
    await this.app.revert();
    this.refreshAll();
    this.dirty = false;
    this.saveBtn.classList.remove('attention');
    this.statusMsg('Changes undone');
  }

  // ---------- open / close

  open(firstRun = false) {
    this.isOpen = true;
    this.changed = false;
    this.root.classList.add('open');
    document.body.classList.remove('hide-cursor');
    this.refreshCameras?.();
    this.app.media.refresh();
    if (firstRun) {
      this.welcome.innerHTML = '<b>Welcome!</b> This is the first start. Follow the quick setup below, then press <b>Save</b>.';
      this.welcome.style.display = 'block';
    } else this.welcome.style.display = 'none';
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('open');
    this.app.applyDisplay();
    // show the changes straight away: restart the current scene with the new settings
    if (this.changed) { this.app.replay(); this.app.warmVoices(); }
    // started with "Setup Mode" (a normal window): go full screen now - no need to restart the program.
    // (Works when closed with the Close button or the S key; browsers don't allow it from Esc.)
    if (new URLSearchParams(location.search).has('setup') && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    if (this.dirty) this.app.toast('Changes are active now but not saved — press S and then Save to keep them for next time', 6000);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  // ---------- live camera preview with zones

  norm(e) {
    const r = this.preview.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, px: r.width, py: r.height };
  }

  hit(p) {
    const z = this.s.zones, j = z.jar, tolY = 12 / p.py, tolX = 12 / p.px;
    if (j.enabled) {
      if (Math.abs(p.x - (j.x + j.w)) < tolX * 1.5 && Math.abs(p.y - (j.y + j.h)) < tolY * 1.5) return { kind: 'jarSize' };
    }
    // lines set below the picture (>100%) are drawn at the bottom edge, so grab them there
    for (const [key] of LINE_DEFS) if (Math.abs(p.y - Math.min(z[key], 0.99)) < tolY) return { kind: 'line', key };
    if (Math.abs(p.x - z.left) < tolX) return { kind: 'side', key: 'left' };
    if (Math.abs(p.x - z.right) < tolX) return { kind: 'side', key: 'right' };
    if (j.enabled && p.x > j.x && p.x < j.x + j.w && p.y > j.y && p.y < j.y + j.h) return { kind: 'jarMove', ox: p.x - j.x, oy: p.y - j.y };
    return null;
  }

  onDown(e) {
    const p = this.norm(e);
    this.drag = this.hit(p);
    if (this.drag) this.preview.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    const p = this.norm(e), z = this.s.zones, j = z.jar;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    if (!this.drag) {
      const hh = this.hit(p);
      this.preview.style.cursor = !hh ? 'default' : hh.kind === 'line' ? 'ns-resize' : hh.kind === 'side' ? 'ew-resize' : hh.kind === 'jarSize' ? 'nwse-resize' : 'move';
      return;
    }
    const d = this.drag;
    if (d.kind === 'line') {
      // keep approach <= near <= scare while dragging
      const i = LINE_DEFS.findIndex(([k]) => k === d.key);
      const lo = i > 0 ? z[LINE_DEFS[i - 1][0]] : 0;
      const hi = i < LINE_DEFS.length - 1 ? Math.min(1, z[LINE_DEFS[i + 1][0]]) : 1;
      z[d.key] = +clamp(p.y, lo, Math.max(lo, hi)).toFixed(3);
    }
    else if (d.kind === 'side') z[d.key] = +clamp(p.x, 0, 1).toFixed(3);
    else if (d.kind === 'jarMove') { j.x = +clamp(p.x - d.ox, 0, 1 - j.w).toFixed(3); j.y = +clamp(p.y - d.oy, 0, 1 - j.h).toFixed(3); }
    else if (d.kind === 'jarSize') { j.w = +clamp(p.x - j.x, 0.03, 1 - j.x).toFixed(3); j.h = +clamp(p.y - j.y, 0.03, 1 - j.y).toFixed(3); }
    this.markDirty();
    (this.refreshers || []).forEach(f => f());
  }

  onUp() { this.drag = null; }

  draw() {
    if (!this.isOpen) return;
    const app = this.app, c = this.preview, g = c.getContext('2d');
    const v = app.detector.video, s = this.s, z = s.zones;
    const W = c.width, H = c.height;
    if (v.videoWidth) {
      const ch = Math.round(W * v.videoHeight / v.videoWidth);
      if (ch !== H) { c.height = ch; return; }
      g.save();
      if (s.camera.mirror) { g.translate(W, 0); g.scale(-1, 1); }
      g.drawImage(v, 0, 0, W, H);
      g.restore();
    } else {
      g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f66'; g.font = '20px sans-serif'; g.textAlign = 'center';
      g.fillText(app.cameraError || 'No camera picture', W / 2, H / 2); g.textAlign = 'left';
    }
    // shade ignored areas
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 0, W, z.approachLine * H);
    g.fillRect(0, 0, z.left * W, H); g.fillRect(z.right * W, 0, W - z.right * W, H);
    // lines
    g.lineWidth = 3; g.font = 'bold 14px sans-serif';
    for (const [key, label, col] of LINE_DEFS) {
      const y = Math.min(z[key], 1) * H - (z[key] >= 1 ? 2 : 0);
      g.strokeStyle = col; g.setLineDash(z[key] > 1 ? [8, 6] : []);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.fillStyle = col; g.fillText(label + (z[key] > 1 ? ' (below picture)' : ''), 8, y - 6);
      g.beginPath(); g.arc(W - 20, y, 7, 0, Math.PI * 2); g.fill();
    }
    g.setLineDash([6, 6]); g.strokeStyle = '#bbb'; g.lineWidth = 2;
    for (const x of [z.left, z.right]) { g.beginPath(); g.moveTo(x * W, 0); g.lineTo(x * W, H); g.stroke(); }
    g.setLineDash([]);
    // jar
    const det = app.detector.lastResult;
    if (z.jar.enabled) {
      const j = z.jar, hot = det.jarMotion >= z.jarSensitivity;
      g.strokeStyle = hot ? '#fff' : '#4cc9f0'; g.lineWidth = hot ? 4 : 3;
      g.strokeRect(j.x * W, j.y * H, j.w * W, j.h * H);
      g.fillStyle = hot ? 'rgba(255,255,255,0.25)' : 'rgba(76,201,240,0.15)'; g.fillRect(j.x * W, j.y * H, j.w * W, j.h * H);
      g.fillStyle = '#4cc9f0'; g.fillRect((j.x + j.w) * W - 7, (j.y + j.h) * H - 7, 14, 14);
      g.fillText(`JAR ${Math.round(det.jarMotion * 100)}%`, j.x * W + 4, j.y * H + 16);
    }
    if (this.jarMeter) {
      const bar = this.jarMeter.firstChild;
      bar.style.width = Math.min(100, det.jarMotion * 100 / Math.max(0.01, z.jarSensitivity) * 50) + '%';
      bar.classList.toggle('hot', det.jarMotion >= z.jarSensitivity);
    }
    // people
    const now = performance.now();
    for (const t of app.tracker.tracks) {
      if (now - t.lastSeen > 1000) continue;
      const b = t.box, col = LEVEL_COLORS[t.level] || '#888';
      g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
      const who = t.isKid == null ? '?' : t.isKid ? 'KID' : 'ADULT';
      const ht = t.height ? ` ${t.height.toFixed(2)}m` : '';
      const label = `#${t.id} ${who}${ht}${t.confirmed ? '' : ' …'}`;
      g.font = 'bold 14px sans-serif';
      const tw = g.measureText(label).width + 8;
      g.fillStyle = col; g.fillRect(b.x * W, b.y * H - 20, tw, 20);
      g.fillStyle = '#000'; g.fillText(label, b.x * W + 4, b.y * H - 5);
      // ground point
      const gx = (b.x + b.w / 2) * W, gy = Math.min(t.groundY, 1) * H;
      g.fillStyle = col; g.beginPath(); g.arc(gx, gy - (t.groundY > 1 ? 8 : 0), 7, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#0f0';
    for (const p of det.hands || []) { g.beginPath(); g.arc(p.x * W, p.y * H, 6, 0, Math.PI * 2); g.fill(); }

    // status text (4x per second is plenty; rebuilding it every frame costs frame rate)
    const nowMs = performance.now();
    const d = app.director, i = d.info;
    const key = d.stage + d.audience + d.hold + d.armed;
    if (key === this._statusKey && nowMs - (this._statusAt || 0) < 250) return;
    this._statusAt = nowMs; this._statusKey = key;
    const mode = (app.cameraError ? `<span style="color:#f66">${app.cameraError}</span> · ` : '') +
      (app.detector.mode === 'ai' ? `AI person detection (${app.detector.delegate})` : app.detector.mode === 'motion' ? 'Motion only (AI failed: ' + app.detector.error + ')' : 'No detection');
    this.liveEl.innerHTML =
      `<div><b>Stage:</b> <span class="stage">${d.stage.toUpperCase()}</span> · <b>Audience:</b> ${d.audience} · <b>Scare:</b> ${d.armed ? 'armed' : 'waiting (cool-down)'}${d.hold ? ' · <b>PREVIEW</b>' : ''}</div>` +
      `<div><b>People:</b> ${i.present} (kids ${i.kids || 0}, adults ${i.adults || 0}, unknown ${i.unknown || 0}) · <b>closest zone:</b> ${['–', 'approach', 'near', 'SCARE'][i.level]} · <b>grab:</b> ${i.grab ? 'YES' : 'no'}</div>` +
      `<div class="dim">${mode} · ${app.detector.fps.toFixed(1)} checks/s · ${app.detector.inferMs.toFixed(0)} ms each · draw ${app.fps.toFixed(0)} fps</div>`;
  }
}
