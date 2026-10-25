// Natural voices (Piper) in the app, plus the camera picture format option (v1.0.3).
// Needs the Linux Piper build: scripts/fetch-voices.sh linux
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { suite, startServer, launch, openApp, assert, assertNoErrors, sleep, waitFor, FAST_TIMING, PIPER_ARGS } from './lib.mjs';

const T = suite('voices');
const browser = await launch({ camera: 'fake' });
// one short phrase per list keeps background generation quick in the test
const PHRASES = { idle: ['Trick or treat!'], 'approach-kids': ['Hello little monster!'], 'approach-adults': ['Welcome, mortal.'],
  'near-kids': ['Take one, okay?'], 'near-adults': ['One per head.'], 'scare-kids': ['Boo! Gotcha!'], 'scare-adults': ['I see you!'],
  'goodbye-kids': ['Bye bye!'], 'goodbye-adults': ['Leave now.'] };
const srv = await startServer({ port: 8880, args: PIPER_ARGS, settings: { timing: FAST_TIMING, phrases: PHRASES } });
const page = await openApp(browser, srv);
const ttsRequests = [];
page.on('request', r => { if (r.url().endsWith('/api/tts')) ttsRequests.push(JSON.parse(r.postData() || '{}')); });
const cacheFiles = () => existsSync(path.join(srv.dataDir, 'voice-cache')) ? readdirSync(path.join(srv.dataDir, 'voice-cache')).filter(f => f.endsWith('.wav') && !f.includes('.tmp')) : [];

await T.test('VO-01', 'natural voices are detected and every phrase is prepared in the background at start', async () => {
  const n = await page.evaluate(() => window.spooky.speech.natural);
  assert(n.available && n.voices[0].name === 'en-us-libritts-high' && n.voices[0].speakers === 904, JSON.stringify(n));
  // 9 lists x 1 phrase, scare-adults twice (demon + skull) = 10
  await waitFor(page, () => { const w = window.spooky.speech.warm; return w.total === 10 && w.ready === 10; }, null, 120000, 'background preparation did not finish');
  assert(cacheFiles().length === 10, `voice-cache has ${cacheFiles().length} files`);
});

// the scenes talk on their own timer and would interrupt the test phrases: silence them
await page.evaluate(() => { for (const k of Object.keys(window.spooky.s.phrases)) window.spooky.s.phrases[k] = []; });

await T.test('VO-02', 'characters speak with the natural voice: subtitles, mouth follows the sound, finishes', async () => {
  const r = await page.evaluate(async () => {
    const sp = window.spooky.speech;
    const p = sp.say('Trick or treat!', 'jack');
    let maxLevel = 0, sub = '';
    const t0 = performance.now();
    while (performance.now() - t0 < 600) {
      await new Promise(r => setTimeout(r, 30));
      maxLevel = Math.max(maxLevel, sp.level);
      if (document.querySelector('#subtitle').classList.contains('show')) sub = document.querySelector('#subtitle').textContent;
    }
    await p;
    return { engine: sp.lastEngine, maxLevel, sub, speaking: sp.speaking };
  });
  assert(r.engine === 'natural', 'engine ' + r.engine);
  assert(r.sub === 'Trick or treat!', 'subtitle ' + r.sub);
  assert(r.maxLevel > 0.05, 'mouth did not move with the sound: ' + r.maxLevel);
  assert(r.speaking === false, 'still speaking after the phrase ended');
});

await T.test('VO-03', 'all four character effects play without errors (pumpkin, ghost+echo, skull, demon+growl)', async () => {
  const engines = await page.evaluate(async () => {
    const sp = window.spooky.speech, out = [];
    for (const [t, c] of [['Bye bye!', 'jack'], ['Boo! Gotcha!', 'ghost'], ['One per head.', 'skull'], ['I see you!', 'demon']]) { await sp.say(t, c); out.push(sp.lastEngine); }
    return out;
  });
  assert(engines.every(e => e === 'natural'), engines.join(','));
  assertNoErrors(page);
});

await T.test('VO-04', 'a phrase that is not generated yet falls back to the Windows voice for that line (no silent gap)', async () => {
  const r = await page.evaluate(async () => {
    const sp = window.spooky.speech;
    window.spooky.s.audio.naturalWaitMs = 1; // pretend the PC is very slow
    await sp.say('A brand new sentence nobody has heard before.', 'skull');
    const first = sp.lastEngine;
    window.spooky.s.audio.naturalWaitMs = 2500;
    return first;
  });
  assert(r === 'windows', 'engine ' + r);
  // ...and the launcher finishes generating it anyway, so next time it is natural
  await sleep(4000);
  const second = await page.evaluate(async () => { await window.spooky.speech.say('A brand new sentence nobody has heard before.', 'skull'); return window.spooky.speech.lastEngine; });
  assert(second === 'natural', 'second time: ' + second);
});

await T.test('VO-05', 'setup "Sound & voice" shows the status, a row per character with speaker number, Try and Another voice', async () => {
  await page.keyboard.press('s');
  await page.locator('#setup .tab', { hasText: 'Sound & voice' }).click();
  const pane = page.locator('#setup .pane.active');
  const txt = await pane.textContent();
  assert(/Natural voices: en-us-libritts-high \(904 speakers\)/.test(txt), txt.slice(0, 300));
  assert(/All 1[01] sentences ready/.test(txt), 'progress not shown as ready');
  for (const name of ['Pumpkin', 'Ghost', 'Skull', 'Demon']) assert(await pane.locator('.row', { hasText: name }).locator('input[type=number]').count() === 1, 'no speaker field for ' + name);
  const before = await page.evaluate(() => window.spooky.s.audio.natural.ghost.speaker);
  ttsRequests.length = 0;
  await pane.locator('.row', { hasText: '👻 Ghost' }).getByRole('button', { name: /Another voice/ }).click();
  await waitFor(page, () => window.spooky.speech.speaking || window.spooky.speech.lastEngine, null, 15000);
  const after = await page.evaluate(() => window.spooky.s.audio.natural.ghost.speaker);
  assert(after !== before || ttsRequests.length > 0, 'speaker not changed / nothing requested');
  assert(ttsRequests.some(q => q.speaker === after), 'Try did not use the new speaker: ' + JSON.stringify(ttsRequests));
  await page.evaluate(p => { Object.assign(window.spooky.s.phrases, p); }, PHRASES); // back from the silenced lists
  await page.keyboard.press('Escape'); // closing with changes re-prepares the phrases for the new ghost voice
  await waitFor(page, () => { const w = window.spooky.speech.warm; return !w.busy && w.ready === w.total; }, null, 120000, 'phrases not re-prepared for the new voice');
  assert(ttsRequests.some(q => q.speaker === after && !q.checkOnly), 'ghost phrases not regenerated with the new speaker');
});

await T.test('VO-06', '"Windows voices only" never asks for natural voices', async () => {
  await page.evaluate(() => { window.spooky.s.audio.engine = 'windows'; });
  ttsRequests.length = 0;
  const e = await page.evaluate(async () => { await window.spooky.speech.say('Trick or treat!', 'jack'); return window.spooky.speech.lastEngine; });
  assert(e === 'windows' && ttsRequests.length === 0, `${e}, ${ttsRequests.length} requests`);
  await page.evaluate(() => { window.spooky.s.audio.engine = 'auto'; });
});

await T.test('VO-07', 'mute silences natural voices (subtitles only); stop() cuts a phrase off', async () => {
  await page.keyboard.press('m');
  const e = await page.evaluate(async () => { await window.spooky.speech.say('Trick or treat!', 'jack'); return window.spooky.speech.lastEngine; });
  await page.keyboard.press('m');
  assert(e === 'subtitles', 'muted engine ' + e);
  const r = await page.evaluate(async () => {
    const sp = window.spooky.speech;
    const p = sp.say('Welcome, mortal.', 'skull');
    await new Promise(r => setTimeout(r, 300));
    const was = sp.speaking; sp.stop();
    await Promise.race([p, new Promise(r => setTimeout(r, 2000))]);
    return { was, now: sp.speaking, playing: !!sp._playing };
  });
  assert(r.was && !r.now && !r.playing, JSON.stringify(r));
});

await T.test('VO-08', 'the show itself uses natural voices during a visit (forced scenes)', async () => {
  await page.evaluate(() => { window.__eng = []; const sp = window.spooky.speech, orig = sp._playNatural.bind(sp); sp._playNatural = (...a) => { window.__eng.push(a[2]); return orig(...a); }; });
  await page.keyboard.press('3'); // near, kids -> pumpkin talks
  await waitFor(page, () => window.__eng.length > 0, null, 8000, 'no natural voice in the scene');
  await page.keyboard.press('0');
  assertNoErrors(page);
});

await T.test('VO-09', 'camera picture: Widescreen switches the camera to 16:9, Standard back to 4:3', async () => {
  await page.keyboard.press('s');
  await page.locator('#setup .tab', { hasText: 'Start here' }).click();
  const sel = page.locator('#setup .pane.active .row', { hasText: 'Camera picture' }).locator('select');
  assert(await sel.inputValue() === '640x480', 'default should be Standard 4:3');
  await sel.selectOption('1280x720');
  await waitFor(page, () => window.spooky.detector.video.videoWidth === 1280, null, 8000, 'camera not switched to 1280x720');
  assert(/calibration/i.test(await page.locator('#setup .msg').textContent()), 'no recalibration reminder');
  await sel.selectOption('640x480');
  await waitFor(page, () => window.spooky.detector.video.videoWidth === 640, null, 8000, 'camera not switched back');
  await page.keyboard.press('Escape');
  assertNoErrors(page);
});

// without Piper: everything still works with Windows voices
const srv2 = await startServer({ port: 8881, settings: { timing: FAST_TIMING } });
const page2 = await openApp(browser, srv2);
await T.test('VO-10', 'without Piper installed: setup explains it, phrases use Windows voices, no errors', async () => {
  const r = await page2.evaluate(async () => { await window.spooky.speech.say('Trick or treat!', 'jack'); return { e: window.spooky.speech.lastEngine, n: window.spooky.speech.natural }; });
  assert(r.e === 'windows' && r.n.available === false && /Piper not found/.test(r.n.reason), JSON.stringify(r));
  await page2.keyboard.press('s');
  await page2.locator('#setup .tab', { hasText: 'Sound & voice' }).click();
  assert(/Natural voices not available/.test(await page2.locator('#setup .pane.active').textContent()), 'no explanation in setup');
  assertNoErrors(page2);
});

await T.done();
