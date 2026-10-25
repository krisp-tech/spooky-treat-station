// Built-in scenes: every scene x audience x scare level renders without exceptions (fast simulation),
// live previews animate, flashing stays within safe limits when the strobe is off, resizing / quality.
import { suite, startServer, launch, openApp, assert, assertNoErrors, sleep, canvasStats, FAST_TIMING } from './lib.mjs';

const T = suite('scenes');
const browser = await launch({ camera: 'fake' });
const srv = await startServer({ port: 8850, settings: { timing: FAST_TIMING } });
const page = await openApp(browser, srv);
await page.keyboard.press('m'); // keep it quiet

// Simulate a scene off-screen for `secs` of scene time at `fps`, in a separate Renderer (same module instance).
const simulate = (stage, audience, opts, secs, fps = 30, flash = false) => page.evaluate(async ([stage, audience, opts, secs, fps, flash]) => {
  const m = await import('/js/scenes.js');
  const app = window.spooky;
  if (!window.__simCanvas) { window.__simCanvas = document.createElement('canvas'); window.__simR = new m.Renderer(window.__simCanvas, app.s); }
  const r = window.__simR;
  r.resize();
  const scene = m.makeScene(stage, audience, opts);
  r.play(scene);
  const env = { audio: app.audio, say: () => Promise.resolve(), talk: 0, look: 0, r, W: r.W, H: r.H };
  const small = document.createElement('canvas'); small.width = 48; small.height = 27;
  const sg = small.getContext('2d', { willReadFrequently: true });
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  let maxParticles = 0, lum = [], litFrames = 0, errors = [];
  const n = Math.round(secs * fps);
  for (let i = 0; i < n; i++) {
    env.talk = (i % 7) / 7; env.look = Math.sin(i / 20);
    try { r.frame(1 / fps, env); } catch (e) { errors.push(`${e.message} @ t=${(i / fps).toFixed(2)}s`); if (errors.length > 3) break; }
    maxParticles = Math.max(maxParticles, r.particles.list.length);
    if (flash || i % 15 === 0) {
      sg.drawImage(r.canvas, 0, 0, 48, 27);
      const d = sg.getImageData(0, 0, 48, 27).data;
      let L = 0, lit = 0;
      for (let k = 0; k < d.length; k += 4) { L += 0.2126 * lin(d[k]) + 0.7152 * lin(d[k + 1]) + 0.0722 * lin(d[k + 2]); if (d[k] + d[k + 1] + d[k + 2] > 60) lit++; }
      lum.push(L / (d.length / 4));
      if (lit > 0.05 * d.length / 4) litFrames++;
    }
  }
  // general flashes (WCAG 2.3.1 style): pairs of opposing luminance changes >= 0.1 where the darker state is < 0.8
  let maxFlashesPerSec = 0;
  if (flash) {
    const ext = []; // alternate extrema
    let dir = 0, lo = lum[0], hi = lum[0], idx = 0;
    const events = [];
    for (let i = 1; i < lum.length; i++) {
      const v = lum[i];
      if (dir >= 0 && v > hi) hi = v;
      if (dir <= 0 && v < lo) lo = v;
      if (dir >= 0 && hi - v >= 0.1 && Math.min(hi, v) < 0.8) { events.push(i); dir = -1; lo = v; hi = v; }
      else if (dir <= 0 && v - lo >= 0.1 && Math.min(lo, v) < 0.8) { events.push(i); dir = 1; hi = v; lo = v; }
    }
    // a flash = 2 opposing transitions; count transitions in each 1 s window / 2
    for (let i = 0; i < events.length; i++) {
      let j = i; while (j < events.length && events[j] - events[i] < fps) j++;
      maxFlashesPerSec = Math.max(maxFlashesPerSec, Math.floor((j - i) / 2));
    }
    void ext; void idx;
  }
  return { errors, maxParticles, litFrames, samples: lum.length, maxFlashesPerSec, W: r.canvas.width, H: r.canvas.height };
}, [stage, audience, opts, secs, fps, flash]);

const SCENES = [['idle', 'kids', 40], ['approach', 'kids', 30], ['near', 'kids', 30], ['scare', 'kids', 10], ['goodbye', 'kids', 10],
  ['approach', 'adults', 30], ['near', 'adults', 30], ['scare', 'adults', 10], ['goodbye', 'adults', 10]];

await T.test('SC-01', 'every scene x audience renders 10-40 s of animation without exceptions, draws something, particles bounded', async () => {
  const problems = [];
  for (const [stage, aud, secs] of SCENES) {
    for (const level of stage === 'scare' && aud === 'adults' ? ['mild', 'medium', 'max'] : ['medium']) {
      for (const strobe of stage === 'scare' && aud === 'adults' && level === 'max' ? [false, true] : [false]) {
        const r = await simulate(stage, aud, { level, strobe }, secs);
        const tag = `${stage}/${aud}/${level}${strobe ? '+strobe' : ''}`;
        if (r.errors.length) problems.push(`${tag}: ${r.errors.join('; ')}`);
        if (r.litFrames < r.samples * 0.3) problems.push(`${tag}: mostly blank (${r.litFrames}/${r.samples} lit samples)`);
        if (r.maxParticles > 1500) problems.push(`${tag}: ${r.maxParticles} particles`);
      }
    }
  }
  assert(!problems.length, problems.join('\n'));
  assertNoErrors(page);
});

await T.test('SC-02', 'unknown stage name falls back to the invite scene (no crash)', async () => {
  const r = await simulate('bogus', 'aliens', {}, 2);
  assert(!r.errors.length, r.errors.join(';'));
});

await T.test('SC-03', 'strobe OFF: no scare level flashes more than 3 times in any second (photosensitive safety)', async () => {
  const out = [];
  for (const level of ['mild', 'medium', 'max']) {
    let worst = 0;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, (await simulate('scare', 'adults', { level, strobe: false }, 6, 60, true)).maxFlashesPerSec);
    out.push(`${level}: ${worst}/s`);
    assert(worst <= 3, `adult scare "${level}" with strobe OFF flashes ${worst} times per second (limit 3)`);
  }
  for (const stage of ['scare', 'approach', 'goodbye']) {
    const r = await simulate(stage, 'kids', {}, 6, 60, true);
    assert(r.maxFlashesPerSec <= 3, `kids ${stage}: ${r.maxFlashesPerSec} flashes/s`);
  }
  console.log('     flashes per second (strobe off): ' + out.join(', '));
});

await T.test('SC-04', 'strobe ON really flashes (so the warning label is accurate)', async () => {
  const r = await simulate('scare', 'adults', { level: 'max', strobe: true }, 4, 60, true);
  assert(r.maxFlashesPerSec > 3, `strobe on: only ${r.maxFlashesPerSec} flashes/s`);
});

await T.test('SC-05', 'live previews of all 9 scenes animate (frames change) with no errors', async () => {
  for (const [stage, aud] of SCENES) {
    await page.evaluate(([s, a]) => window.spooky.director.force(s, a), [stage, aud]);
    await sleep(1600);
    const a = await page.screenshot({ type: 'jpeg', quality: 30 });
    await sleep(400);
    const b = await page.screenshot({ type: 'jpeg', quality: 30 });
    assert(!a.equals(b), `${stage}/${aud} is not animating`);
  }
  await page.keyboard.press('0');
  assertNoErrors(page);
});

await T.test('SC-06', 'window resize (portrait, ultra-wide, tiny, 4K) keeps the canvas matched to the window, no errors', async () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [3840, 1080], [320, 240], [3840, 2160], [1366, 768], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.keyboard.press('7');
    await sleep(400);
    const c = await canvasStats(page);
    const want = { low: 540, medium: 720, high: 1080 }[await page.evaluate(() => window.spooky.s.display.quality)];
    assert(c.h === want, `${w}x${h}: canvas height ${c.h}`);
    assert(Math.abs(c.w / c.h - w / h) < 0.02, `${w}x${h}: canvas aspect ${c.w}/${c.h} vs window ${(w / h).toFixed(3)}`);
    assert(c.lit > 0.01, `${w}x${h}: nothing drawn`);
  }
  await page.keyboard.press('0');
  assertNoErrors(page);
});

await T.test('SC-07', 'drawing quality low/medium/high changes the render resolution', async () => {
  for (const [q, h] of [['low', 540], ['high', 1080], ['medium', 720]]) {
    await page.evaluate(q => { window.spooky.s.display.quality = q; window.spooky.renderer.resize(); }, q);
    await sleep(300);
    const c = await canvasStats(page);
    assert(c.h === h && c.lit > 0.01, `${q}: ${JSON.stringify(c)}`);
  }
});

await T.done();
