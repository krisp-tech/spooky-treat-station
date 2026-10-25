// Robustness: detector stalls, camera unplugged, extreme settings, huge/empty phrase lists, jar false triggers.
import { suite, startServer, launch, openApp, assert, assertNoErrors, sleep, waitFor, FAST_TIMING, VIDEO } from './lib.mjs';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const T = suite('robustness');
// A fresh browser per video test: the fake camera file then starts at frame 0 (person far away, walking up).
const adultCamFresh = () => launch({ camera: VIDEO.adult });
const stageNames = page => page.stages.map(s => /^\[stage\] (\w+) \((\w+)\) - (.*)$/.exec(s)).filter(Boolean).map(m => ({ stage: m[1], aud: m[2], reason: m[3] }));
const waitPresent = page => waitFor(page, () => ['approach', 'near'].includes(window.spooky.director.stage), null, 30000, 'visitor never detected');

await T.test('RB-01', 'detector stops delivering results while a visitor is present (worker hang/crash): show must not freeze on "near"', async () => {
  const srv = await startServer({ port: 8855, settings: { timing: FAST_TIMING, scare: { triggerOnClose: false, triggerOnGrab: false } } });
  const page = await openApp(await adultCamFresh(), srv);
  await waitPresent(page);
  await page.evaluate(() => window.spooky.detector.stop());
  await sleep(FAST_TIMING.emptyMs + FAST_TIMING.goodbyeMs + 6000);
  const st = await page.evaluate(() => ({ stage: window.spooky.director.stage, present: window.spooky.director.info.present, tracks: window.spooky.tracker.tracks.map(t => ({ fresh: t.fresh, age: Math.round(performance.now() - t.lastSeen) })) }));
  assert(st.stage === 'idle' || st.stage === 'goodbye', `still "${st.stage}" ${Math.round((FAST_TIMING.emptyMs + FAST_TIMING.goodbyeMs + 6000) / 1000)} s after the last detection; tracks ${JSON.stringify(st.tracks)} still count as present`);
  await page.context().close();
});

await T.test('RB-02', 'detection worker terminated (crash): detector reports it / restarts, show does not freeze', async () => {
  const srv = await startServer({ port: 8856, settings: { timing: FAST_TIMING, scare: { triggerOnClose: false, triggerOnGrab: false } } });
  const page = await openApp(await adultCamFresh(), srv);
  await waitPresent(page);
  await page.evaluate(() => window.spooky.detector.worker.terminate());
  await sleep(12000);
  const st = await page.evaluate(() => ({ stage: window.spooky.director.stage, err: window.spooky.detector.error, status: window.spooky.detector.status, mode: window.spooky.detector.mode, last: Math.round(performance.now() - window.spooky.detector.lastResult.time) }));
  // OK if detection recovered (results flowing again: the visitor really is still there, so "near" is right),
  // or if the show moved on instead of freezing
  const recovered = st.last < 2000;
  assert(recovered || (st.stage !== 'near' && st.stage !== 'approach'), `frozen in "${st.stage}"; last detection ${st.last} ms ago, detector.status=${st.status}, mode=${st.mode}, error="${st.err}"`);
  console.log(`     after worker crash: ${recovered ? 'detector recovered' : 'show moved on'}, stage=${st.stage}, mode=${st.mode}`);
  await page.context().close();
});

await T.test('RB-03', 'camera unplugged during the show: the app notices (message / reconnect attempt)', async () => {
  const srv = await startServer({ port: 8857, settings: { timing: FAST_TIMING } });
  const page = await openApp(await adultCamFresh(), srv);
  await sleep(2000);
  const calls0 = await page.evaluate(() => window.__gumCalls);
  await page.evaluate(() => window.spooky.detector.stream.getTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); }));
  await sleep(10000);
  const st = await page.evaluate(() => ({ calls: window.__gumCalls, err: window.spooky.cameraError + window.spooky.detector.error, toast: document.querySelector('#toast').classList.contains('show') ? document.querySelector('#toast').textContent : '' }));
  assert(st.calls > calls0 || /camera/i.test(st.err + st.toast), `no reaction 10 s after the camera disappeared: ${JSON.stringify(st)}`);
  await page.context().close();
});

await T.test('RB-04', 'detections per second = 1 (slowest setting): visitor still detected, kids/adults decided, show runs', async () => {
  const srv = await startServer({ port: 8858, settings: { timing: FAST_TIMING, detection: { fps: 1 } } });
  const page = await openApp(await adultCamFresh(), srv);
  await waitFor(page, () => window.spooky.director.stage === 'scare', null, 40000, 'no scare within 40 s at 1 detection/s');
  const seq = stageNames(page);
  assert(seq.some(s => s.stage === 'approach' || s.stage === 'near'), JSON.stringify(seq));
  assert(seq.find(s => s.stage === 'scare').aud === 'adults', JSON.stringify(seq));
  assertNoErrors(page);
  await page.context().close();
});

await T.test('RB-05', 'all timing sliders at their minimum: no stage flicker storm, no errors', async () => {
  const srv = await startServer({ port: 8859, settings: { timing: { confirmMs: 0, emptyMs: 1000, minStageMs: 0, scareDelayMs: 0, scareMs: 3000, goodbyeMs: 2000, rearmMs: 5000, idleTalkSec: 4, approachTalkSec: 3, nearTalkSec: 3 }, detection: { fps: 15 } } });
  const page = await openApp(await adultCamFresh(), srv);
  await sleep(30000);
  const n = page.stages.length;
  assert(n > 3 && n < 40, `${n} stage changes in 30 s`);
  assertNoErrors(page);
  await page.context().close();
});

await T.test('RB-06', 'huge phrase lists (~3 MB): app boots, Save works, file written', async () => {
  const big = Array.from({ length: 4500 }, (_, i) => `This is spooky phrase number ${i}, with some extra words for length.`);
  const phrases = Object.fromEntries(['idle', 'approach-kids', 'approach-adults', 'near-kids', 'near-adults', 'scare-kids', 'scare-adults', 'goodbye-kids', 'goodbye-adults'].map(k => [k, big]));
  const srv = await startServer({ port: 8860, settings: { timing: FAST_TIMING, phrases } });
  const b = await launch({ camera: 'fake' });
  const page = await openApp(b, srv);
  await page.keyboard.press('2'); await sleep(1500);
  const t0 = Date.now();
  const r = await page.evaluate(() => window.spooky.save());
  const ms = Date.now() - t0;
  assert(r.ok, JSON.stringify(r));
  const size = statSync(path.join(srv.dataDir, 'settings.json')).size;
  assert(JSON.parse(readFileSync(path.join(srv.dataDir, 'settings.json'), 'utf8')).phrases.idle.length === 4500, 'phrases lost');
  assert(ms < 5000, `save took ${ms} ms`);
  console.log(`     settings.json ${(size / 1e6).toFixed(1)} MB saved in ${ms} ms`);
  assertNoErrors(page);
  await page.context().close();
});

await T.test('RB-07', 'all phrase lists emptied at runtime: every scene still runs, nothing says "undefined"', async () => {
  const srv = await startServer({ port: 8861, settings: { timing: FAST_TIMING } });
  const b = await launch({ camera: 'fake' });
  const page = await openApp(b, srv);
  await page.evaluate(() => { for (const k of Object.keys(window.spooky.s.phrases)) window.spooky.s.phrases[k] = []; window.__spoken = []; });
  for (const k of ['1', '2', '3', '4', '6', '7', '8']) { await page.keyboard.press(k); await sleep(1800); }
  const r = await page.evaluate(() => ({ spoken: window.__spoken.map(u => u.text), sub: document.querySelector('#subtitle').textContent }));
  assert(!r.spoken.some(t => !t || /undefined/.test(t)) && !/undefined/.test(r.sub), JSON.stringify(r));
  assertNoErrors(page);
  await page.context().close();
});

await T.test('RB-08', 'walking up past the default jar box (no hand reaching in) must not count as "grabbed a treat"', async () => {
  // scare line far below the picture so that only the jar can trigger; the test video has no hand/jar at all
  const srv = await startServer({ port: 8862, settings: { timing: FAST_TIMING, zones: { scareLine: 1.5 } } });
  const page = await openApp(await adultCamFresh(), srv);
  await sleep(16000);
  const grab = stageNames(page).find(s => s.stage === 'scare');
  const z = await page.evaluate(() => window.spooky.s.zones.jar);
  assert(!grab, `scare "${grab?.reason}" fired by a person merely walking up (default jar box x=${z.x} y=${z.y} w=${z.w} h=${z.h} is where visitors' legs are)`);
  await page.context().close();
});

await T.test('RB-09', 'left/right limits exclude a visitor walking up outside them', async () => {
  const srv = await startServer({ port: 8863, settings: { timing: FAST_TIMING, zones: { left: 0.0, right: 0.3 } } });
  const page = await openApp(await adultCamFresh(), srv);
  await sleep(12000);
  const st = stageNames(page);
  assert(!st.length, `show reacted to a person outside the side limits: ${JSON.stringify(st)}`);
  await page.context().close();
});

await T.done();
