// Custom media (videos / pictures / sounds), subtitles, speech, mute.
import { suite, startServer, launch, openApp, assert, assertNoErrors, sleep, waitFor, FAST_TIMING } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const T = suite('media');
const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const ODD = 'my vid #1 100% ünï.webm';

const srv = await startServer({
  port: 8845, settings: { timing: { ...FAST_TIMING, scareMs: 15000 }, audio: { subtitles: true } },
  setupData: dir => {
    const m = f => { const p = path.join(dir, 'media', f); mkdirSync(path.dirname(p), { recursive: true }); return p; };
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', m('scare-adults/scare clip.mp4'));
    ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=3', '-c:v', 'libvpx', '-b:v', '300k', m('approach-adults/' + ODD));
    ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-c:v', 'libvpx', '-b:v', '300k', m('approach-kids/loop.webm'));
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x240', '-frames:v', '1', m('near-kids/picture.png'));
    ff('-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', m('idle/hello.wav'));
    ff('-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=20', '-c:v', 'libvpx', '-b:v', '100k', m('goodbye-adults/long.webm'));
    writeFileSync(m('goodbye-kids/broken.mp4'), randomBytes(50000));
  },
});
const browser = await launch({ camera: 'fake' });
const page = await openApp(browser, srv);
await page.evaluate(() => {
  window.__files = []; window.__subs = [];
  const sp = window.spooky.speech, orig = sp.playFile.bind(sp);
  sp.playFile = url => { window.__files.push(url); return orig(url); };
  const os = sp.onSubtitle;
  sp.onSubtitle = t => { if (t) window.__subs.push(t); os(t); };
});
const set = (path, v) => page.evaluate(([p, v]) => { const k = p.split('.'); let o = window.spooky.s; while (k.length > 1) o = o[k.shift()]; o[k[0]] = v; }, [path, v]);
const force = (s, a) => page.evaluate(([s, a]) => window.spooky.director.force(s, a), [s, a]);
const mediaState = () => page.evaluate(() => {
  const m = window.spooky.media, v = m.video;
  return { visible: m.visible, vDisp: v.style.display, src: decodeURIComponent(v.currentSrc || v.src || ''), t: v.currentTime, err: v.error && v.error.code, paused: v.paused, muted: v.muted, vol: v.volume,
    img: m.img.style.display === 'block' ? decodeURIComponent(m.img.src) : '', imgOk: m.img.complete && m.img.naturalWidth > 0, len: window.spooky.director.sceneLength, stage: window.spooky.director.stage };
});

await T.test('MD-01', 'media folders are listed (odd file name escaped) and counted in Setup', async () => {
  const list = await (await fetch(srv.url('/api/media'))).json();
  assert(list['scare-adults'][0] === '/media/scare-adults/scare%20clip.mp4', list['scare-adults'][0]);
  assert(list['approach-adults'].length === 1 && list['approach-adults'][0].includes('%23') && list['approach-adults'][0].includes('%25'), list['approach-adults'][0]);
  const c = await page.evaluate(() => window.spooky.media.count('scare-adults'));
  assert(c.visual === 1 && c.audio === 0, JSON.stringify(c));
});

await T.test('MD-02', 'custom video for the adult scare plays, and the scare lasts as long as the video', async () => {
  await set('content.scare', 'custom');
  await force('scare', 'adults');
  await sleep(1500);
  const m = await mediaState();
  assert(m.visible && m.vDisp === 'block' && m.src.endsWith('scare clip.mp4'), JSON.stringify(m));
  assert(!m.err && m.t > 0.5 && !m.paused, `video not playing: ${JSON.stringify(m)}`);
  assert(m.len >= 4200 && m.len <= 4600, `sceneLength ${m.len} (video is 4 s; expected ~4300)`);
  assert(await page.evaluate(() => window.spooky.audio.theme) === null, 'built-in music still playing over the video');
  await waitFor(page, () => window.spooky.director.stage === 'goodbye', null, 5000, 'scare did not end with the video (scareMs is 15 s)');
  await set('content.scare', 'builtin');
});

await T.test('MD-03', 'video with spaces/#/%/unicode in the name plays', async () => {
  await set('content.approach', 'custom');
  await force('approach', 'adults');
  await sleep(1500);
  const m = await mediaState();
  await set('content.approach', 'builtin');
  assert(m.visible && m.src.endsWith(ODD) && !m.err && m.t > 0.3, JSON.stringify(m));
});

await T.test('MD-04', 'custom picture for kids "take one" is shown full screen', async () => {
  await set('content.near', 'custom');
  await force('near', 'kids');
  await sleep(800);
  const m = await mediaState();
  assert(m.visible && m.vDisp === 'none' && m.img.endsWith('picture.png') && m.imgOk, JSON.stringify(m));
});

await T.test('MD-05', 'stage set to custom but its folder is empty -> built-in scene', async () => {
  await force('near', 'adults');
  await sleep(300);
  const m = await mediaState();
  assert(!m.visible, JSON.stringify(m));
  await set('content.near', 'builtin');
});

await T.test('MD-06', 'custom sound replaces the talking voice on the built-in invite scene', async () => {
  await set('content.idle', 'custom');
  const spokenBefore = await page.evaluate(() => window.__spoken.length);
  await force('idle', null);
  await sleep(2600);
  const r = await page.evaluate(() => ({ files: window.__files, spoken: window.__spoken.length, visible: window.spooky.media.visible }));
  assert(!r.visible, 'only a sound in the folder: the built-in animation should stay');
  assert(r.files.some(f => f.endsWith('hello.wav')), `sound not played: ${JSON.stringify(r.files)}`);
  assert(r.spoken === spokenBefore, 'speech synthesis talked although a custom sound was chosen');
  await set('content.idle', 'builtin');
});

await T.test('MD-07', 'subtitles show what the character says (built-in scene)', async () => {
  await page.evaluate(() => { window.__subs = []; });
  await force('approach', 'kids');
  await sleep(1500);
  const subs = await page.evaluate(() => window.__subs);
  const phrases = await page.evaluate(() => window.spooky.s.phrases['approach-kids']);
  assert(subs.length && phrases.includes(subs[0]), `subtitles ${JSON.stringify(subs)}`);
});

await T.test('MD-08', 'subtitles off -> no subtitle shown', async () => {
  await set('audio.subtitles', false);
  await page.evaluate(() => { window.__subs = []; });
  await force('near', 'adults');
  await sleep(1300);
  const shown = await page.$eval('#subtitle', e => e.classList.contains('show'));
  assert(!shown, 'subtitle visible');
  await set('audio.subtitles', true);
});

await T.test('MD-09', 'built-in mode ignores files; mix mode uses files about half of the time', async () => {
  await set('content.scare', 'builtin');
  await force('scare', 'adults');
  await sleep(200);
  assert(!(await mediaState()).visible, 'builtin used a file');
  await set('content.near', 'mix');
  let custom = 0;
  for (let i = 0; i < 24; i++) { await force('near', 'kids'); await sleep(60); if ((await mediaState()).visible) custom++; }
  assert(custom >= 4 && custom <= 20, `${custom}/24 custom`);
  await set('content.near', 'builtin');
});

await T.test('MD-10', 'a broken/unsupported video file falls back to the built-in scene (no black screen)', async () => {
  await set('content.goodbye', 'custom');
  await force('goodbye', 'kids');
  await sleep(2500);
  const m = await mediaState();
  assert(!m.visible, `video error ${m.err} but the media layer is still covering the screen (black) during ${m.stage}`);
  await set('content.goodbye', 'builtin');
});

await T.test('MD-11', 'a long custom goodbye video does not block the show: goodbye still ends after goodbyeMs', async () => {
  await set('content.goodbye', 'custom');
  await force('goodbye', 'adults');
  await sleep(1000);
  const m = await mediaState();
  assert(m.visible && m.src.endsWith('long.webm'), JSON.stringify(m));
  await waitFor(page, () => window.spooky.director.stage === 'idle', null, 4000, 'goodbye with a 20 s video did not end after goodbyeMs (3 s)');
  assert(!(await mediaState()).visible, 'video still covering the idle scene');
  await set('content.goodbye', 'builtin');
});

await T.test('MD-12', 'M (mute) also silences the talking voice', async () => {
  await page.keyboard.press('0');
  await page.keyboard.press('m');
  await page.evaluate(() => { window.__spoken = []; });
  await force('approach', 'adults');
  await sleep(1300);
  const sp = await page.evaluate(() => window.__spoken);
  const subs = await page.evaluate(() => window.__subs.length);
  await page.keyboard.press('m');
  assert(subs > 0, 'test precondition: the scene should have started talking');
  assert(sp.length === 0 || sp.every(u => u.volume === 0), `muted, but speech was spoken at volume ${sp.map(u => u.volume)}`);
});

await T.test('MD-13', 'M (mute) also silences custom videos', async () => {
  await set('content.scare', 'custom');
  await page.keyboard.press('m');
  await force('scare', 'adults');
  await sleep(800);
  const m = await mediaState();
  await page.keyboard.press('m');
  await set('content.scare', 'builtin');
  assert(m.muted || m.vol === 0, `muted, but the custom video plays with sound (muted=${m.muted}, volume=${m.vol})`);
});

await T.test('MD-14', 'built-in particles do not pile up while a custom video covers the scene', async () => {
  await set('content.approach', 'custom');
  await force('approach', 'kids');
  await sleep(10000);
  const n = await page.evaluate(() => window.spooky.renderer.particles.list.length);
  await set('content.approach', 'builtin');
  await page.keyboard.press('0');
  assert(n < 30, `${n} particles accumulated in 10 s behind the video (they are never updated/removed)`);
});

await T.test('MD-15', 'no console errors from media handling (except the deliberately broken file)', async () => {
  page.errors = page.errors.filter(e => !/broken\.mp4|MEDIA_ERR|DEMUXER|Failed to load resource/i.test(e));
  assertNoErrors(page);
});

await T.done();
