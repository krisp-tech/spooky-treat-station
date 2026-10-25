// Keyboard shortcuts on the show screen: 0-9, M, D, F (S/Esc are covered in setup.mjs).
import { suite, startServer, launch, openApp, assert, assertNoErrors, sleep, FAST_TIMING } from './lib.mjs';

const T = suite('keys');
const browser = await launch({ camera: 'fake' });
const srv = await startServer({ port: 8840, settings: { timing: FAST_TIMING } });
const page = await openApp(browser, srv);
const st = () => page.evaluate(() => ({ stage: window.spooky.director.stage, aud: window.spooky.director.audience, hold: window.spooky.director.hold }));

await T.test('KE-01', 'keys 1-9 preview the right scene and audience', async () => {
  const want = { 1: ['idle', null, true], 2: ['approach', 'kids', true], 3: ['near', 'kids', true], 4: ['scare', 'kids', false], 5: ['goodbye', 'kids', false],
    6: ['approach', 'adults', true], 7: ['near', 'adults', true], 8: ['scare', 'adults', false], 9: ['goodbye', 'adults', false] };
  for (const [k, [stage, aud, hold]] of Object.entries(want)) {
    await page.keyboard.press(k);
    await sleep(150);
    const s = await st();
    assert(s.stage === stage && (aud === null || s.aud === aud) && s.hold === hold, `key ${k}: ${JSON.stringify(s)}`);
  }
  assertNoErrors(page);
});

await T.test('KE-02', 'key 1 keeps the current audience; key 0 returns to automatic (idle, hold off, toast)', async () => {
  await page.keyboard.press('7'); await page.keyboard.press('1');
  let s = await st();
  assert(s.stage === 'idle' && s.aud === 'adults' && s.hold, JSON.stringify(s));
  await page.keyboard.press('0');
  s = await st();
  assert(s.stage === 'idle' && !s.hold, JSON.stringify(s));
  assert(/Automatic/.test(await page.$eval('#toast', e => e.textContent)), 'no toast');
});

await T.test('KE-03', 'M toggles mute (master gain to 0 and back) with a toast', async () => {
  await page.keyboard.press('m');
  await sleep(400);
  let a = await page.evaluate(() => ({ muted: window.spooky.audio.muted, gain: window.spooky.audio.master.gain.value, toast: document.querySelector('#toast').textContent }));
  assert(a.muted && a.gain < 0.01 && /Muted/.test(a.toast), JSON.stringify(a));
  await page.keyboard.press('M');
  await sleep(400);
  a = await page.evaluate(() => ({ muted: window.spooky.audio.muted, gain: window.spooky.audio.master.gain.value }));
  assert(!a.muted && a.gain > 0.5, JSON.stringify(a));
});

await T.test('KE-04', 'D toggles the small camera view with detection boxes', async () => {
  const vis = () => page.$eval('#pip', e => getComputedStyle(e).display);
  assert(await vis() === 'none');
  await page.keyboard.press('d');
  await sleep(300);
  assert(await vis() === 'block', 'pip not shown');
  const drawn = await page.evaluate(() => { const c = document.querySelector('#pip'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n; });
  assert(drawn > 100, 'pip is empty');
  await page.keyboard.press('d');
  assert(await vis() === 'none', 'pip not hidden');
});

await T.test('KE-05', 'F requests full screen without errors (and toggles back)', async () => {
  await page.keyboard.press('f'); await sleep(300);
  await page.keyboard.press('f'); await sleep(300);
  assertNoErrors(page);
});

await T.test('KE-06', 'other keys (arrows, space, letters, Enter) do nothing', async () => {
  await page.keyboard.press('0');
  const before = await st();
  for (const k of ['ArrowUp', 'Space', 'Enter', 'a', 'x', 'Tab', 'F5x'.slice(0, 1)]) { try { await page.keyboard.press(k); } catch (e) { /* ignore */ } }
  const after = await st();
  assert(JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  assertNoErrors(page);
});

await T.test('KE-07', 'during a preview hold there is a visible hint on the show screen (otherwise the show silently ignores visitors)', async () => {
  await page.keyboard.press('3');
  await sleep(300);
  const hint = await page.evaluate(() => {
    // checkVisibility() (not offsetParent, which is always null for position:fixed elements)
    const vis = [...document.querySelectorAll('body *')].filter(e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !e.closest('#setup'));
    return vis.map(e => e.textContent).join(' ');
  });
  await page.keyboard.press('0');
  assert(/preview|automatic|press 0/i.test(hint), 'no on-screen indication that automatic mode is paused');
});

await T.done();
