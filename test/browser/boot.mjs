// App start-up: normal boot, first run, camera denied / missing / late, corrupt settings, AI fallback.
import { suite, startServer, launch, openApp, waitForReady, canvasStats, assert, assertNoErrors, waitFor, sleep, FAST_TIMING } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const T = suite('boot');
const seeded = { timing: FAST_TIMING };
const ALL = [['idle', null], ['approach', 'kids'], ['near', 'kids'], ['scare', 'kids'], ['goodbye', 'kids'], ['approach', 'adults'], ['near', 'adults'], ['scare', 'adults'], ['goodbye', 'adults']];

const fake = await launch({ camera: 'fake' });

await T.test('BO-01', 'boots with a camera: loading screen gone, AI running, idle scene drawn, no console errors', async () => {
  const srv = await startServer({ port: 8820, settings: seeded });
  const page = await openApp(fake, srv);
  await waitFor(page, () => window.spooky.detector.mode !== 'none', null, 45000, 'detector never started');
  await sleep(1500);
  const st = await page.evaluate(() => ({ mode: window.spooky.detector.mode, stage: window.spooky.director.stage, setup: document.querySelector('#setup').classList.contains('open'), loading: !!document.querySelector('#loading:not(.hide)'), fps: window.spooky.fps }));
  assert(st.mode === 'ai', `detector mode ${st.mode}`);
  assert(st.stage === 'idle', `stage ${st.stage}`);
  assert(!st.setup, 'setup should stay closed when settings exist');
  const c = await canvasStats(page);
  assert(c.lit > 0.05, `idle scene looks blank (${(c.lit * 100).toFixed(1)}% lit)`);
  assertNoErrors(page);
  await page.context().close();
});

await T.test('BO-02', 'first run (no settings.json, no backup): setup opens with the welcome message', async () => {
  const srv = await startServer({ port: 8821 });
  const page = await openApp(fake, srv);
  await waitFor(page, () => document.querySelector('#setup.open'), null, 5000, 'setup not opened on first run');
  const txt = await page.$eval('.welcome', e => getComputedStyle(e).display !== 'none' ? e.textContent : '');
  assert(/first start/i.test(txt), `welcome text: ${txt}`);
  assertNoErrors(page);
  await page.context().close();
});

await T.test('BO-03', '?setup=1 opens setup (no first-run welcome when settings exist)', async () => {
  const srv = await startServer({ port: 8822, settings: seeded });
  const page = await openApp(fake, srv, { query: '?setup=1' });
  await waitFor(page, () => document.querySelector('#setup.open'), null, 5000, 'setup not opened');
  const shown = await page.$eval('.welcome', e => getComputedStyle(e).display !== 'none');
  assert(!shown, 'welcome shown although not first run');
  await page.context().close();
});

for (const [id, camera, label] of [['BO-04', 'denied', 'camera permission DENIED'], ['BO-05', 'none', 'NO camera connected']]) {
  await T.test(id, `${label}: show still runs, message shown, every scene can be previewed, timers keep running`, async () => {
    const b = camera === 'none' ? await launch({ camera: 'none' }) : fake;
    const srv = await startServer({ port: id === 'BO-04' ? 8823 : 8824, settings: { timing: { ...FAST_TIMING, scareMs: 3000, goodbyeMs: 2000 } } });
    const page = await openApp(b, srv, { camera });
    const st = await page.evaluate(() => ({ err: window.spooky.cameraError, toast: document.querySelector('#toast').textContent, mode: window.spooky.detector.mode, stage: window.spooky.director.stage }));
    assert(/camera problem/i.test(st.err), `cameraError: ${st.err}`);
    assert(/press S/i.test(st.toast), `toast: ${st.toast}`);
    assert(st.stage === 'idle');
    await sleep(800);
    assert((await canvasStats(page)).lit > 0.05, 'idle scene not drawn');
    for (const [stage, aud] of ALL) {
      await page.evaluate(([s, a]) => window.spooky.director.force(s, a), [stage, aud]);
      await sleep(300);
      const now = await page.evaluate(() => window.spooky.director.stage + '/' + window.spooky.director.audience);
      assert(now.startsWith(stage), `forced ${stage} but stage is ${now}`);
      // scare scenes start with a deliberate blackout: take the brightest of several samples over 2.5 s
      let best = 0;
      for (let i = 0; i < 10 && best <= 0.003; i++) { best = Math.max(best, (await canvasStats(page)).mean); await sleep(250); }
      assert(best > 0.003, `${stage}/${aud} stayed blank for 2.5 s`);
    }
    // a forced scare continues automatically: scare -> goodbye -> idle, even without detections
    await page.evaluate(() => window.spooky.director.force('scare', 'adults'));
    await waitFor(page, () => window.spooky.director.stage === 'idle', null, 9000, 'scare -> goodbye -> idle did not complete without a camera');
    const expected = camera === 'denied' ? /NotAllowedError|Permission denied/ : /NotFoundError|Requested device not found/;
    page.errors = page.errors.filter(e => !expected.test(e));
    assertNoErrors(page);
    // setup preview explains the problem
    await page.keyboard.press('s');
    await sleep(300);
    assertNoErrors(page, 'after opening setup');
    await page.context().close();
  });
}

await T.test('BO-06', 'camera not ready at start (USB still starting / used by another app): app retries and starts detection', async () => {
  const srv = await startServer({ port: 8825, settings: seeded });
  const page = await openApp(fake, srv, { camera: 'late', lateFailures: 1 });
  const st0 = await page.evaluate(() => window.spooky.cameraError);
  assert(/camera problem/i.test(st0), 'first attempt should fail in this test');
  let ok = false;
  for (let i = 0; i < 25 && !ok; i++) { await sleep(1000); ok = await page.evaluate(() => window.spooky.detector.video.videoWidth > 0 && window.spooky.detector.mode !== 'none'); }
  const calls = await page.evaluate(() => window.__gumCalls);
  assert(ok, `no camera after 25 s: getUserMedia was called ${calls} time(s), no retry; the show never reacts to visitors until someone reloads`);
  await page.context().close();
});

await T.test('BO-07', 'corrupt settings.json on disk: app starts with defaults, no page errors', async () => {
  const srv = await startServer({ port: 8826, settingsRaw: '{"zones": {"nearLine": 0.5,,, oops' });
  const page = await openApp(fake, srv);
  const st = await page.evaluate(() => ({ near: window.spooky.s.zones.nearLine, stage: window.spooky.director.stage }));
  assert(st.near === 0.7, `nearLine ${st.near}`);
  assert(st.stage === 'idle');
  page.errors = page.errors.filter(e => !/Unexpected token|JSON/.test(e));
  assertNoErrors(page);
  await page.context().close();
});

await T.test('BO-08', 'settings.json with a wrong-typed value (calibration.points = {}) still boots', async () => {
  const srv = await startServer({ port: 8827, settings: { timing: FAST_TIMING, calibration: { points: { footY: 0.7 } } } });
  const page = await openApp(fake, srv, { waitReady: false });
  let booted = true;
  try { await waitForReady(page, 15000); } catch (e) { booted = false; }
  const shot = await page.evaluate(() => document.querySelector('#loading-text')?.textContent || '');
  assert(booted, `app never finished loading (stuck on "${shot}"); errors: ${page.errors.join(' | ')}`);
  await page.context().close();
});

await T.test('BO-09', 'launcher API unreachable: settings come from the browser backup and Save reports "browser only"', async () => {
  const srv = await startServer({ port: 8828, settings: seeded });
  const ctx = await fake.newContext({ viewport: { width: 1280, height: 720 } });
  const p0 = await ctx.newPage();
  await p0.goto(srv.url('/api/info'));
  await p0.evaluate(() => localStorage.setItem('spooky-treat-station-settings', JSON.stringify({ zones: { nearLine: 0.61 }, timing: { confirmMs: 500 } })));
  await ctx.route('**/api/settings', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url('/'));
  await waitForReady(page);
  const near = await page.evaluate(() => window.spooky.s.zones.nearLine);
  assert(near === 0.61, `nearLine ${near} (expected the localStorage backup 0.61)`);
  const r = await page.evaluate(() => window.spooky.save());
  assert(r.ok === false && r.where === 'browser only', JSON.stringify(r));
  assert(!errors.length, errors.join(' | '));
  await ctx.close();
});

await T.test('BO-10', 'AI model cannot load: motion fallback starts, toast explains, show still reacts to movement', async () => {
  const b = await launch({ camera: path.resolve('test/approach.y4m') });
  const srv = await startServer({ port: 8829, settings: seeded });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route('**/models/efficientdet_lite0.tflite', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url('/'));
  await waitForReady(page, 90000);
  const st = await page.evaluate(() => ({ mode: window.spooky.detector.mode, toast: document.querySelector('#toast').textContent }));
  assert(st.mode === 'motion', `mode ${st.mode}`);
  assert(/motion detection/i.test(st.toast), `toast: ${st.toast}`);
  await waitFor(page, () => window.spooky.director.stage !== 'idle', null, 30000, 'motion fallback never started the show');
  assert(!errors.length, errors.join(' | '));
  await ctx.close();
});

await T.test('BO-11', 'motion fallback disabled + AI fails: app still runs (mode none), no page errors', async () => {
  const srv = await startServer({ port: 8830, settings: { ...seeded, detection: { motionFallback: false } } });
  const ctx = await fake.newContext();
  await ctx.route('**/models/efficientdet_lite0.tflite', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url('/'));
  await waitForReady(page, 90000);
  assert(await page.evaluate(() => window.spooky.detector.mode) === 'none');
  await sleep(1500);
  assert(!errors.length, errors.join(' | '));
  await ctx.close();
});

await T.test('BO-12', 'nothing written to disk until Save (no settings.json on a plain start)', async () => {
  const srv = await startServer({ port: 8831 });
  const page = await openApp(fake, srv);
  await sleep(1000);
  assert(!existsSync(path.join(srv.dataDir, 'settings.json')), 'settings.json written without Save');
  await page.evaluate(() => window.spooky.save());
  const saved = JSON.parse(readFileSync(path.join(srv.dataDir, 'settings.json'), 'utf8'));
  assert(saved.zones && saved.timing && saved.phrases, 'saved file incomplete');
  await page.context().close();
});

await T.done();
