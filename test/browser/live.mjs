// Live updates: saved settings, media files and display options apply WITHOUT restarting the app.
// Covers the "after saving I have to restart" report (v1.0.3).
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { suite, startServer, launch, openApp, assert, assertNoErrors, sleep, waitFor, BIN, ROOT, FAST_TIMING } from './lib.mjs';

const T = suite('live');
const browser = await launch({ camera: 'fake' });
const srv = await startServer({ port: 8870, settings: { timing: FAST_TIMING } });
const page = await openApp(browser, srv);
const toastText = () => page.evaluate(() => document.querySelector('#toast').classList.contains('show') ? document.querySelector('#toast').textContent : '');
const postSettings = async patch => {
  const cur = await (await fetch(srv.url('/api/settings'))).json();
  const next = { ...cur, ...patch };
  for (const k of Object.keys(patch)) if (typeof patch[k] === 'object' && !Array.isArray(patch[k])) next[k] = { ...(cur[k] || {}), ...patch[k] };
  const r = await fetch(srv.url('/api/settings'), { method: 'POST', body: JSON.stringify(next) });
  assert(r.ok, 'save failed ' + r.status);
};

await T.test('LV-01', 'settings saved from ANOTHER window (or by hand) apply to the running show within a few seconds', async () => {
  await postSettings({ scare: { adultLevel: 'max' }, zones: { nearLine: 0.66 }, phrases: { idle: ['Hello from the other window!'] } });
  await waitFor(page, () => window.spooky.s.scare.adultLevel === 'max', null, 6000, 'scare level not applied without restart');
  const s = await page.evaluate(() => ({ near: window.spooky.s.zones.nearLine, idle: window.spooky.s.phrases.idle }));
  assert(s.near === 0.66 && s.idle[0] === 'Hello from the other window!', JSON.stringify(s));
  assert(/applied/i.test(await toastText()), 'no "settings applied" message');
  assertNoErrors(page);
});

await T.test('LV-02', 'a settings.json edited by hand is picked up too', async () => {
  const p = path.join(srv.dataDir, 'settings.json');
  const j = JSON.parse(readFileSync(p, 'utf8')); j.timing.goodbyeMs = 7777;
  writeFileSync(p, JSON.stringify(j));
  await waitFor(page, () => window.spooky.s.timing.goodbyeMs === 7777, null, 6000, 'hand edit not applied');
});

await T.test('LV-03', 'saving in THIS window applies at once and does not re-load/replay itself', async () => {
  await page.keyboard.press('s');
  await page.evaluate(() => { window.spooky.s.audio.musicVolume = 0.33; });
  const sceneBefore = await page.evaluate(() => (window.__sceneMark = window.spooky.renderer.scene, 1));
  await page.locator('#setup button', { hasText: 'Save' }).first().click();
  await sleep(4500); // two polls
  const r = await page.evaluate(() => ({ same: window.spooky.renderer.scene === window.__sceneMark, vol: window.spooky.s.audio.musicVolume, msg: document.querySelector('#setup .msg').textContent }));
  assert(r.vol === 0.33, 'value lost');
  assert(r.same, 'own save caused a reload/replay of the scene');
  assert(/no restart/i.test(r.msg), r.msg);
  await page.keyboard.press('Escape');
});

await T.test('LV-04', 'closing setup after changes restarts the current scene with the new settings (no restart needed)', async () => {
  await page.keyboard.press('s');
  await page.evaluate(() => { window.__sceneMark = window.spooky.renderer.scene; });
  await page.locator('#setup .tab', { hasText: 'Scare' }).click();
  await page.locator('#setup .pane.active select').first().selectOption('mild');
  await page.locator('#setup button', { hasText: 'Close' }).click();
  await sleep(300);
  const replayed = await page.evaluate(() => window.spooky.renderer.scene !== window.__sceneMark);
  assert(replayed, 'scene not restarted after closing setup with changes');
  assert(/not saved/i.test(await toastText()), 'no reminder that the change is not saved yet');
  // closing without changes must NOT restart the scene
  await page.keyboard.press('s');
  await page.evaluate(() => { window.__sceneMark = window.spooky.renderer.scene; });
  await page.keyboard.press('s');
  assert(await page.evaluate(() => window.spooky.renderer.scene === window.__sceneMark), 'scene restarted although nothing changed');
});

await T.test('LV-05', '"Small camera view" and "Hide mouse pointer" apply immediately', async () => {
  await page.keyboard.press('s');
  await page.locator('#setup .tab', { hasText: 'Advanced' }).click();
  const row = name => page.locator('#setup .pane.active .row', { hasText: name }).locator('label.switch');
  const pipBefore = await page.evaluate(() => getComputedStyle(document.querySelector('#pip')).display);
  await row('Small camera view on show').click();
  const pipAfter = await page.evaluate(() => getComputedStyle(document.querySelector('#pip')).display);
  assert(pipBefore === 'none' && pipAfter === 'block', `pip ${pipBefore} -> ${pipAfter}`);
  await row('Small camera view on show').click();
  await row('Hide mouse pointer').click(); // off
  await page.keyboard.press('Escape');
  assert(!(await page.evaluate(() => document.body.classList.contains('hide-cursor'))), 'pointer still hidden after turning the option off');
  await page.keyboard.press('s');
  await row('Hide mouse pointer').click(); // on again
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => document.body.classList.contains('hide-cursor')), 'pointer not hidden after turning the option on');
});

await T.test('LV-06', 'an external save while setup has UNSAVED edits does not overwrite them', async () => {
  await page.keyboard.press('s');
  await page.locator('#setup .tab', { hasText: 'Zones' }).click();
  // move the "Approach line" slider (an unsaved edit)
  await page.locator('#setup .pane.active .row', { hasText: 'Approach line' }).locator('input[type=range]')
    .evaluate(el => { el.value = 0.31; el.dispatchEvent(new Event('input')); });
  await postSettings({ timing: { goodbyeMs: 4321 } });
  await sleep(4500);
  const r = await page.evaluate(() => ({ a: window.spooky.s.zones.approachLine, g: window.spooky.s.timing.goodbyeMs }));
  assert(r.a === 0.31, `unsaved edit lost: ${JSON.stringify(r)}`);
  assert(/another window/i.test(await toastText()), 'no notice about the other save');
  // "Undo changes" now loads what is saved on disk
  await page.locator('#setup button', { hasText: 'Undo changes' }).click();
  await sleep(300);
  const r2 = await page.evaluate(() => window.spooky.s.timing.goodbyeMs);
  assert(r2 === 4321, 'Undo did not load the settings saved on disk: ' + r2);
  await page.keyboard.press('Escape');
});

await T.test('LV-07', 'a video dropped into a media folder is found without restarting or pressing Re-scan', async () => {
  copyFileSync(path.join(ROOT, 'test/pose.jpg'), path.join(srv.dataDir, 'media', 'idle', 'new-picture.jpg'));
  await waitFor(page, () => (window.spooky.media.files.idle || []).some(f => f.includes('new-picture.jpg')), null, 6000, 'new media file not noticed');
});

await T.test('LV-08', 'switching the GPU option restarts detection live (no reload) and detection keeps running', async () => {
  const before = await page.evaluate(() => window.spooky.detector.worker);
  await page.evaluate(() => { window.__w = window.spooky.detector.worker; window.spooky.s.detection.useGpu = true; window.spooky.detector.applySettings(); });
  await waitFor(page, () => window.spooky.detector.worker && window.spooky.detector.worker !== window.__w && window.spooky.detector._gpuInUse === true, null, 30000, 'worker not restarted with GPU setting');
  await page.evaluate(() => { window.__w = window.spooky.detector.worker; window.spooky.s.detection.useGpu = false; window.spooky.detector.applySettings(); });
  await waitFor(page, () => window.spooky.detector.worker && window.spooky.detector.worker !== window.__w && window.spooky.detector._gpuInUse === false, null, 30000, 'worker not restarted back to CPU');
  const t0 = await page.evaluate(() => window.spooky.detector.lastResult.time);
  await waitFor(page, t0 => window.spooky.detector.lastResult.time > t0 + 500, t0, 10000, 'no detections after switching back');
  assert(before !== undefined, 'no worker at start');
  assertNoErrors(page);
});

// ---- second launch of the program while the show is running

const fakeBrowser = path.join(srv.dataDir, 'fake-browser.sh');
const marker = path.join(srv.dataDir, 'browser-was-opened');
writeFileSync(fakeBrowser, `#!/bin/sh\necho "$@" > "${marker}"\n`); chmodSync(fakeBrowser, 0o755);
const relaunch = (...args) => new Promise(res => {
  const p = spawn(BIN, ['-port', '8870', '-data', srv.dataDir, '-browser', fakeBrowser, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('exit', code => res({ code, out }));
});

await T.test('LV-09', 'starting the program again while the show is showing does NOT open a second show', async () => {
  const r = await relaunch();
  assert(/already running and showing/i.test(r.out), r.out);
  assert(!existsSync(marker), 'a second browser window was opened');
});

await T.test('LV-10', '"Setup Mode" while the show is running opens the setup screen ON the running show', async () => {
  if (await page.evaluate(() => window.spooky && document.querySelector('#setup').classList.contains('open'))) await page.keyboard.press('Escape');
  const r = await relaunch('-setup');
  assert(/opening its setup screen/i.test(r.out), r.out);
  assert(!existsSync(marker), 'a second browser window was opened');
  await waitFor(page, () => document.querySelector('#setup').classList.contains('open'), null, 6000, 'setup did not open on the running show');
  await page.keyboard.press('Escape');
});

await T.test('LV-11', 'when the server runs but no show page is open, a second start opens the browser', async () => {
  await page.context().close();
  await sleep(6500); // page considered gone after 6 s without polling
  const r = await relaunch();
  assert(existsSync(marker), 'browser not opened: ' + r.out);
  assert(readFileSync(marker, 'utf8').includes('http://127.0.0.1:8870/'), readFileSync(marker, 'utf8'));
});

await T.done();
