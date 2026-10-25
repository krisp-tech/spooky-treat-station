// Long-running stability ("Halloween night in fast-forward"). Runs SOAK_MIN minutes (default 3):
// real detection on the looping test video + random scene previews + custom media, sampling memory/DOM/particles.
//   SOAK_MIN=10 node test/browser/soak.mjs <server-binary>
import { suite, startServer, launch, openApp, assert, sleep, FAST_TIMING, VIDEO } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const MIN = +(process.env.SOAK_MIN || 3);
const T = suite(`soak (${MIN} min)`);
const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const srv = await startServer({
  port: 8870,
  settings: { timing: { ...FAST_TIMING, rearmMs: 8000 }, content: { idle: 'mix', scare: 'mix' }, audio: { subtitles: true } },
  setupData: dir => {
    const m = f => { const p = path.join(dir, 'media', f); mkdirSync(path.dirname(p), { recursive: true }); return p; };
    ff('-f', 'lavfi', '-i', 'sine=frequency=500:duration=1', m('idle/hello.wav'));
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', m('scare-adults/s.mp4'));
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', m('scare-kids/s.mp4'));
  },
});
const browser = await launch({ camera: VIDEO.adult, extraArgs: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const page = await openApp(browser, srv);
const samples = [];
const sample = async label => {
  const s = await page.evaluate(() => {
    if (window.gc) { window.gc(); window.gc(); }
    const a = window.spooky;
    return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), dom: document.getElementsByTagName('*').length, particles: a.renderer.particles.list.length,
      tracks: a.tracker.tracks.length, fps: +a.fps.toFixed(0), det: +a.detector.fps.toFixed(1), music: a.audio._musicNodes.length, stage: a.director.stage, bgCache: Object.keys(a.renderer.bg).length };
  });
  s.label = label; samples.push(s);
  console.log(`     ${label.padEnd(6)} heap ${s.heapMB} MB, DOM ${s.dom}, particles ${s.particles}, tracks ${s.tracks}, draw ${s.fps} fps, det ${s.det}/s, music nodes ${s.music}, stage ${s.stage}`);
};

await T.test('SK-01', `${MIN} minutes of show cycling + real detection: no errors, memory/DOM/particles stay bounded`, async () => {
  await sleep(5000);
  await sample('start');
  const scenes = [['idle', null], ['approach', 'kids'], ['near', 'kids'], ['scare', 'kids'], ['goodbye', 'kids'], ['approach', 'adults'], ['near', 'adults'], ['scare', 'adults'], ['goodbye', 'adults']];
  const end = Date.now() + MIN * 60000;
  let i = 0, nextSample = Date.now() + 30000, forced = 0;
  while (Date.now() < end) {
    // 2/3 of the time preview a random scene, otherwise let real detection drive the show for a while
    if (i % 3 !== 2) { const [s, a] = scenes[Math.floor(Math.random() * scenes.length)]; await page.evaluate(([s, a]) => window.spooky.director.force(s, a), [s, a]); forced++; }
    else await page.evaluate(() => window.spooky.director.resumeAuto());
    if (i % 7 === 0) await page.keyboard.press('s'), await sleep(500), await page.keyboard.press('Escape');
    await sleep(i % 3 === 2 ? 12000 : 2500);
    i++;
    if (Date.now() > nextSample) { await sample(`${Math.round((Date.now() - (end - MIN * 60000)) / 60000 * 10) / 10}m`); nextSample += 30000; }
  }
  await page.evaluate(() => window.spooky.director.resumeAuto());
  await sleep(3000);
  await sample('end');
  const first = samples[0], last = samples.at(-1);
  const minHeap = Math.min(...samples.slice(0, 2).map(s => s.heapMB));
  console.log(`     ${forced} forced scenes, ${page.stages.length} stage changes in total`);
  assert(page.errors.length === 0, `errors: ${page.errors.slice(0, 5).join(' | ')}`);
  assert(last.heapMB - minHeap < 30, `JS heap grew ${(last.heapMB - minHeap).toFixed(1)} MB`);
  assert(last.dom - first.dom < 50, `DOM grew from ${first.dom} to ${last.dom} elements`);
  assert(Math.max(...samples.map(s => s.particles)) < 1500, 'particle explosion');
  assert(Math.max(...samples.map(s => s.tracks)) < 10, 'tracks pile up');
  assert(Math.max(...samples.map(s => s.music)) < 300, 'music nodes pile up');
  assert(Math.min(...samples.map(s => s.fps)) >= 25, `frame rate dropped to ${Math.min(...samples.map(s => s.fps))}`);
});

await T.done();
