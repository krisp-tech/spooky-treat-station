// Performance sanity (NOT representative of an Intel Celeron; thresholds are generous smoke limits):
// per-scene drawing cost, live frame rate with detection running, detector inference time, long tasks.
import { suite, startServer, launch, openApp, assert, sleep, FAST_TIMING, VIDEO } from './lib.mjs';

const T = suite('perf');
const browser = await launch({ camera: VIDEO.adult });
const srv = await startServer({ port: 8865, settings: { timing: FAST_TIMING } });
const page = await openApp(browser, srv, { viewport: { width: 1920, height: 1080 } });
await page.keyboard.press('m');
const report = [];

await T.test('PF-01', 'drawing cost per frame for every scene (medium quality, 1920x1080 window) is below 16 ms on average', async () => {
  const res = await page.evaluate(async () => {
    const m = await import('/js/scenes.js');
    const app = window.spooky;
    const c = document.createElement('canvas'), r = new m.Renderer(c, app.s);
    const out = {};
    for (const [st, a] of [['idle', 'kids'], ['approach', 'kids'], ['near', 'kids'], ['scare', 'kids'], ['goodbye', 'kids'], ['approach', 'adults'], ['near', 'adults'], ['scare', 'adults'], ['goodbye', 'adults']]) {
      const scene = m.makeScene(st, a, { level: 'max' }); r.play(scene);
      const env = { audio: app.audio, say: () => Promise.resolve(), talk: 0.5, look: 0, r, W: r.W, H: r.H };
      for (let i = 0; i < 10; i++) r.frame(1 / 30, env); // warm up (background caches)
      const times = [];
      for (let i = 0; i < 150; i++) { const t0 = performance.now(); r.frame(1 / 30, env); c.getContext('2d').getImageData(0, 0, 1, 1); times.push(performance.now() - t0); }
      times.sort((x, y) => x - y);
      out[`${st}/${a}`] = { avg: +(times.reduce((s, x) => s + x, 0) / times.length).toFixed(2), p95: +times[Math.floor(times.length * 0.95)].toFixed(2) };
    }
    return out;
  });
  for (const [k, v] of Object.entries(res)) report.push(`${k.padEnd(16)} avg ${v.avg} ms  p95 ${v.p95} ms`);
  const slow = Object.entries(res).filter(([, v]) => v.avg > 16);
  assert(!slow.length, `slow scenes: ${JSON.stringify(slow)}`);
});

await T.test('PF-02', 'live: draw frame rate >= 30 fps and detector >= 3 checks/s while a visitor is detected', async () => {
  await page.waitForFunction(() => window.spooky.director.stage !== 'idle', null, { timeout: 30000 });
  await page.evaluate(() => { window.__long = 0; new PerformanceObserver(l => { window.__long += l.getEntries().length; }).observe({ type: 'longtask', buffered: false }); });
  const samples = [];
  for (let i = 0; i < 8; i++) { await sleep(1000); samples.push(await page.evaluate(() => ({ fps: window.spooky.fps, det: window.spooky.detector.fps, ms: window.spooky.detector.inferMs }))); }
  const avg = k => samples.reduce((s, x) => s + x[k], 0) / samples.length;
  const long = await page.evaluate(() => window.__long);
  report.push(`live: draw ${avg('fps').toFixed(0)} fps, detection ${avg('det').toFixed(1)}/s, inference ${avg('ms').toFixed(0)} ms, long tasks (>50ms) in 8 s: ${long}`);
  assert(avg('fps') >= 30, `draw fps ${avg('fps').toFixed(1)}`);
  assert(avg('det') >= 3, `detections/s ${avg('det').toFixed(1)}`);
});

await T.test('PF-03', 'setup screen open (live preview + status) keeps >= 30 fps', async () => {
  await page.keyboard.press('s');
  await sleep(3000);
  const fps = await page.evaluate(() => window.spooky.fps);
  await page.keyboard.press('Escape');
  report.push(`setup open: draw ${fps.toFixed(0)} fps`);
  assert(fps >= 30, `fps with setup open ${fps.toFixed(1)}`);
});

console.log('     ' + report.join('\n     '));
await T.done();
