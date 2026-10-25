// Setup screen: open/close, every tab, sliders, drag zones, Save/Undo/Reset, phrases, calibration capture, exit.
import { suite, startServer, launch, openApp, assert, assertNoErrors, waitFor, sleep, FAST_TIMING, VIDEO } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const T = suite('setup');
const browser = await launch({ camera: 'fake' });
const srv = await startServer({ port: 8835, settings: { timing: FAST_TIMING } });
const page = await openApp(browser, srv);
const isOpen = () => page.evaluate(() => document.querySelector('#setup').classList.contains('open') && window.spooky && true);
const clickButton = text => page.locator('#setup button', { hasText: text }).first().click();
const tab = name => page.locator('#setup .tabs .tab', { hasText: name }).first().click();
// set a slider (found by its row label) like a user dragging it
const setSlider = (label, value) => page.evaluate(([label, value]) => {
  const row = [...document.querySelectorAll('#setup .row')].find(r => r.querySelector('label')?.textContent.trim() === label);
  if (!row) throw new Error('no row ' + label);
  const inp = row.querySelector('input[type=range]');
  inp.value = value; inp.dispatchEvent(new Event('input', { bubbles: true }));
  return { value: +inp.value, shown: row.querySelector('.val').textContent };
}, [label, value]);
const settingsFile = () => JSON.parse(readFileSync(path.join(srv.dataDir, 'settings.json'), 'utf8'));

await T.test('SU-01', 'S opens setup, S closes it, Esc closes it', async () => {
  assert(!(await isOpen()), 'setup open at start');
  await page.keyboard.press('s'); assert(await isOpen(), 'S did not open');
  await page.keyboard.press('s'); assert(!(await isOpen()), 'S did not close');
  await page.keyboard.press('S'); assert(await isOpen(), 'Shift+S did not open');
  await page.keyboard.press('Escape'); assert(!(await isOpen()), 'Esc did not close');
  await page.keyboard.press('s');
  await clickButton('Close (Esc)'); assert(!(await isOpen()), 'Close button did not close');
});

await T.test('SU-02', 'every tab renders content without errors', async () => {
  await page.keyboard.press('s');
  const names = await page.$$eval('#setup .tabs .tab', b => b.map(x => x.textContent));
  assert(names.length === 10, `tabs: ${names}`);
  const bad = [];
  for (const n of names) {
    await tab(n);
    await sleep(150);
    const r = await page.evaluate(() => { const p = document.querySelector('#setup .pane.active'); return { n: document.querySelectorAll('#setup .pane.active').length, kids: p.children.length, h: p.getBoundingClientRect().height, text: p.textContent.length, junk: /\[object |undefined|NaN/.test(p.textContent) }; });
    assert(r.n === 1 && r.kids > 0 && r.h > 50 && r.text > 20, `tab ${n}: ${JSON.stringify(r)}`);
    if (r.junk) bad.push(n);
  }
  assertNoErrors(page);
  assert(!bad.length, `tab(s) show junk text like "[object ...]"/undefined/NaN: ${bad.join(', ')}`);
});

await T.test('SU-03', 'live status box shows stage, audience, detection mode', async () => {
  await sleep(500);
  const txt = await page.$eval('#setup .live', e => e.textContent);
  assert(/Stage:\s*IDLE/.test(txt) && /Audience:/.test(txt) && /AI person detection/.test(txt), txt);
});

await T.test('SU-04', 'sliders change the live settings and show the value; marks unsaved', async () => {
  await tab('Zones');
  const r = await setSlider('Approach line', 0.33);
  assert(r.shown === '33%', `shown ${r.shown}`);
  assert(await page.evaluate(() => window.spooky.s.zones.approachLine) === 0.33);
  assert(/Unsaved/.test(await page.$eval('#setup .msg', e => e.textContent)), 'not marked unsaved');
  await tab('Scare');
  await setSlider('Scare scene length', 9000);
  assert(await page.evaluate(() => window.spooky.s.timing.scareMs) === 9000);
  await tab('Advanced');
  await setSlider('Detections per second', 3);
  assert(await page.evaluate(() => window.spooky.s.detection.fps) === 3);
});

await T.test('SU-05', 'Save writes settings.json with the changed values', async () => {
  await clickButton('Save');
  await waitFor(page, () => /Saved/.test(document.querySelector('#setup .msg').textContent), null, 5000, 'no "Saved" message');
  const f = settingsFile();
  assert(f.zones.approachLine === 0.33 && f.timing.scareMs === 9000 && f.detection.fps === 3, JSON.stringify(f.zones));
});

await T.test('SU-06', 'Undo changes reverts to the last saved values (settings and slider UI)', async () => {
  await tab('Zones');
  await setSlider('Approach line', 0.12);
  await clickButton('Undo changes');
  // since v1.0.3 Undo reloads the saved settings from disk (they may have been saved in another window)
  await page.waitForFunction(() => /undone/i.test(document.querySelector('#setup .msg').textContent), null, { timeout: 5000 }).catch(() => {});
  const st = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#setup .row')].find(r => r.querySelector('label')?.textContent.trim() === 'Approach line');
    return { v: window.spooky.s.zones.approachLine, ui: row.querySelector('input').value, msg: document.querySelector('#setup .msg').textContent };
  });
  assert(st.v === 0.33 && +st.ui === 0.33, JSON.stringify(st));
  assert(/undone/i.test(st.msg), st.msg);
});

await T.test('SU-07', 'dragging the NEAR line and the jar box on the camera picture moves them', async () => {
  await tab('Zones');
  // the jar box is off by default (since v1.0.2) and only draggable when on: switch it on via its toggle
  const jarToggle = page.locator('#setup .row', { hasText: 'Watch the candy jar' }).locator('label.switch');
  if (!(await page.evaluate(() => window.spooky.s.zones.jar.enabled))) await jarToggle.click();
  assert(await page.evaluate(() => window.spooky.s.zones.jar.enabled), 'jar toggle did not switch it on');
  const box = await page.locator('#setup canvas.preview').boundingBox();
  const s0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.spooky.s.zones)));
  const X = f => box.x + box.width * f, Y = f => box.y + box.height * f;
  await page.mouse.move(X(0.2), Y(s0.nearLine)); await page.mouse.down();
  await page.mouse.move(X(0.2), Y(0.55), { steps: 5 }); await page.mouse.up();
  const near = await page.evaluate(() => window.spooky.s.zones.nearLine);
  assert(Math.abs(near - 0.55) < 0.02, `nearLine after drag ${near}`);
  // jar box: grab its middle, move left/up
  const j = s0.jar;
  await page.mouse.move(X(j.x + j.w / 2), Y(j.y + j.h * 0.4)); await page.mouse.down();
  await page.mouse.move(X(j.x + j.w / 2 - 0.2), Y(j.y + j.h * 0.4 - 0.1), { steps: 5 }); await page.mouse.up();
  const j2 = await page.evaluate(() => window.spooky.s.zones.jar);
  assert(Math.abs(j2.x - (j.x - 0.2)) < 0.02 && Math.abs(j2.y - (j.y - 0.1)) < 0.02, `jar after drag ${JSON.stringify(j2)}`);
  // slider follows the drag
  const ui = await page.evaluate(() => [...document.querySelectorAll('#setup .row')].find(r => r.querySelector('label')?.textContent.trim() === 'Near line').querySelector('input').value);
  assert(Math.abs(+ui - near) < 0.011, `slider ${ui} vs ${near}`);
});

await T.test('SU-08', 'Reset everything to defaults (confirm) restores defaults; Save writes them', async () => {
  await tab('Advanced');
  page.once('dialog', d => d.accept());
  await clickButton('Reset everything to defaults');
  await sleep(200);
  const z = await page.evaluate(() => window.spooky.s.zones);
  assert(z.approachLine === 0.42 && z.nearLine === 0.7 && z.jar.x === 0.36, JSON.stringify(z));
  assert(/Unsaved/.test(await page.$eval('#setup .msg', e => e.textContent)), 'reset not marked unsaved');
  await clickButton('Save');
  await sleep(500);
  assert(settingsFile().zones.approachLine === 0.42, 'defaults not saved');
});

await T.test('SU-09', 'Reset cancelled in the confirm dialog changes nothing', async () => {
  await tab('Zones'); await setSlider('Approach line', 0.2);
  await tab('Advanced');
  page.once('dialog', d => d.dismiss());
  await clickButton('Reset everything to defaults');
  await sleep(200);
  assert(await page.evaluate(() => window.spooky.s.zones.approachLine) === 0.2);
  await clickButton('Undo changes');
});

await T.test('SU-10', 'Phrases tab shows one editable text box per phrase list; editing updates the lines', async () => {
  await tab('Phrases');
  const info = await page.evaluate(() => { const e = document.querySelector('#setup .pane.active'); return { n: e.querySelectorAll('textarea').length, text: e.textContent.slice(0, 120) }; });
  assert(info.n === 9, `Phrases tab has ${info.n} text boxes (expected 9); it shows: "${info.text}..."`);
  const ta = page.locator('#setup .pane.active textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.type('Smile 1 2 for the camera, dude\nSecond line M');
  const st = await page.evaluate(() => ({ idle: window.spooky.s.phrases.idle, open: document.querySelector('#setup').classList.contains('open'), hold: window.spooky.director.hold, muted: window.spooky.audio.muted, pip: window.spooky.s.display.showPip }));
  assert(JSON.stringify(st.idle) === JSON.stringify(['Smile 1 2 for the camera, dude', 'Second line M']), JSON.stringify(st.idle));
  assert(st.open && !st.hold && !st.muted && !st.pip, `typing triggered a shortcut: ${JSON.stringify(st)}`);
  await clickButton('Undo changes');
});

await T.test('SU-10b', 'keys pressed while a setup control has focus do not trigger show shortcuts; Esc still closes', async () => {
  await tab('Zones');
  await page.locator('#setup .pane.active input[type=range]').first().focus();
  for (const k of ['s', 'm', 'd', '2', '7']) await page.keyboard.press(k);
  const st = await page.evaluate(() => ({ open: document.querySelector('#setup').classList.contains('open'), hold: window.spooky.director.hold, muted: window.spooky.audio.muted, pip: window.spooky.s.display.showPip }));
  assert(st.open && !st.hold && !st.muted && !st.pip, JSON.stringify(st));
  await page.keyboard.press('Escape');
  assert(!(await isOpen()), 'Esc with focus on a control should close setup');
  await sleep(300); // the browser moves focus off the now-hidden slider at the next frame (a person never presses S within 16 ms)
  await page.keyboard.press('s');
  await clickButton('Undo changes');
});

await T.test('SU-11', 'closing with unsaved changes warns with a toast', async () => {
  await tab('Zones'); await setSlider('Left limit', 0.05);
  await page.keyboard.press('Escape');
  const t = await page.$eval('#toast', e => e.classList.contains('show') ? e.textContent : '');
  assert(/not saved/i.test(t), `toast: "${t}"`);
  await page.keyboard.press('s'); await clickButton('Undo changes');
});

await T.test('SU-12', 'Test tab buttons preview scenes; "Back to automatic" resumes', async () => {
  await tab('Test');
  await page.locator('#setup .pane.active button', { hasText: 'Take one' }).nth(1).click();
  let st = await page.evaluate(() => [window.spooky.director.stage, window.spooky.director.audience, window.spooky.director.hold]);
  assert(st[0] === 'near' && st[1] === 'adults' && st[2] === true, JSON.stringify(st));
  assert(/PREVIEW/.test(await page.$eval('#setup .live', e => e.textContent)), 'no PREVIEW marker in status');
  await clickButton('Back to automatic');
  st = await page.evaluate(() => [window.spooky.director.stage, window.spooky.director.hold]);
  assert(st[0] === 'idle' && st[1] === false, JSON.stringify(st));
});

await T.test('SU-13', 'Sound & voice test buttons and toggles work without errors', async () => {
  await tab('Sound & voice');
  for (const b of ['Pumpkin', 'Ghost', 'Skull', 'Demon', 'Scream', 'Evil laugh', 'Thunder', 'Boo whistle']) await clickButton(b);
  await sleep(500);
  assertNoErrors(page);
});

await T.test('SU-14', 'My media tab shows folder counts and Re-scan works', async () => {
  await tab('My media');
  await clickButton('Re-scan folders');
  await sleep(300);
  const txt = await page.$eval('#setup .pane.active', e => e.textContent);
  assert(/scare-adults: 0 video\/picture, 0 sound/.test(txt), txt.slice(0, 200));
  assert(txt.includes(srv.dataDir), 'media folder path not shown');
});

await T.test('SU-17', 'a scare line set below the picture (slider > 100%) can still be grabbed and dragged on the camera picture', async () => {
  if (!(await isOpen())) await page.keyboard.press('s');
  await tab('Zones');
  await setSlider('Scare line', 1.2);
  const box = await page.locator('#setup canvas.preview').boundingBox();
  // the line is drawn (dashed) at the very bottom edge of the picture
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height - 3); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.9, { steps: 5 }); await page.mouse.up();
  const v = await page.evaluate(() => window.spooky.s.zones.scareLine);
  await clickButton('Undo changes');
  assert(Math.abs(v - 0.9) < 0.03, `scare line drawn at the bottom edge cannot be dragged (still ${v})`);
});

await page.keyboard.press('Escape');
await page.context().close();

await T.test('SU-15', 'calibration: Capture with one person head-to-toe adds points and switches the height model', async () => {
  const b = await launch({ camera: VIDEO.adult });
  const s2 = await startServer({ port: 8836, settings: { timing: FAST_TIMING } });
  const p = await openApp(b, s2);
  await p.keyboard.press('s');
  await p.locator('#setup .tabs .tab', { hasText: 'Kids vs adults' }).click();
  const capture = async () => {
    await waitFor(p, () => { const now = performance.now(); const t = window.spooky.tracker.tracks.filter(t => now - t.lastSeen < 600); return t.length === 1 && t[0].feetVisible && t[0].headVisible; }, null, 30000, 'no single head-to-toe person');
    await p.locator('#setup button', { hasText: 'Capture' }).click();
  };
  await capture();
  let n = await p.evaluate(() => window.spooky.s.calibration.points.length);
  assert(n === 1, `points after 1st capture: ${n} (${await p.$eval('#setup .msg', e => e.textContent)})`);
  assert(/1 point/.test(await p.$eval('#setup .pane.active', e => e.textContent)), 'model text not updated');
  await sleep(2500);
  await capture();
  n = await p.evaluate(() => window.spooky.s.calibration.points.length);
  assert(n === 2, `points after 2nd capture: ${n}`);
  const src = await p.evaluate(() => window.spooky.tracker.model.source);
  assert(/calibrated/.test(src), src);
  await p.locator('#setup button', { hasText: 'Remove last' }).click();
  assert(await p.evaluate(() => window.spooky.s.calibration.points.length) === 1, 'Remove last');
  await p.locator('#setup button', { hasText: 'Clear all' }).click();
  assert(await p.evaluate(() => window.spooky.tracker.model.source) === 'estimated (not calibrated)', 'Clear all');
  assertNoErrors(p);
  await p.context().close();
});

await T.test('SU-16', 'Advanced > Exit app (confirm) stops the launcher', async () => {
  const s3 = await startServer({ port: 8837, settings: { timing: FAST_TIMING } });
  const p = await openApp(browser, s3);
  await p.keyboard.press('s');
  await p.locator('#setup .tabs .tab', { hasText: 'Advanced' }).click();
  p.once('dialog', d => d.accept());
  await p.locator('#setup button', { hasText: 'Exit app' }).click();
  const code = await Promise.race([s3.exited, sleep(4000).then(() => 'still running')]);
  assert(code === 0, `launcher exit: ${code}`);
  assert(/Stopped/.test(await p.textContent('body')), 'stopped message not shown');
  await p.context().close();
});

await T.done();
