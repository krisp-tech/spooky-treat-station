// End-to-end smoke test: runs the app in headless Chromium with a fake camera video of a person
// walking up, and checks that the show goes idle -> approach/near -> scare -> goodbye -> idle.
//
//   node test/e2e.mjs <path-to-server-binary> [video.y4m] [outDir] [--expect adults|kids|none] [--port N] [--seconds N]
//
// With --expect it ASSERTS the stage sequence and audience and exits non-zero on failure
// (used by test/run-all.sh). Without --expect it only prints (the original behaviour).
// Generate the test videos first with:  bash test/make-test-videos.sh
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const expect = opt('--expect', null);
const port = +opt('--port', 8799);
const seconds = +opt('--seconds', 40);
const bin = argv[0];
const video = path.resolve(argv[1] || 'test/approach.y4m');
const outDir = path.resolve(argv[2] || 'test/out');
mkdirSync(outDir, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpdir(), 'sts-'));

const server = spawn(bin, ['-no-browser', '-port', String(port), '-data', dataDir], { stdio: expect ? 'ignore' : 'inherit' });
let browser;
const serverExited = new Promise(r => server.on('exit', r));
const cleanup = async () => {
  try { await browser?.close(); } catch (e) { /* ignore */ }
  server.kill();
  await Promise.race([serverExited, new Promise(r => setTimeout(r, 3000))]); // Windows keeps files locked until exit
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { console.log('note: could not remove', dataDir); }
};
process.on('uncaughtException', async e => { console.error('FAIL e2e crashed:', e); await cleanup(); process.exit(2); });

for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/info`); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }

browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`,
    '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], stages = [];
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/XNNPACK/.test(t)) errors.push(t);
  if (t.startsWith('[stage]')) { stages.push(t); console.log('  ' + t); }
});
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

// Pre-seed settings so the first-run setup screen doesn't open, with test-friendly timings.
await fetch(`http://127.0.0.1:${port}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ timing: { confirmMs: 500, emptyMs: 2500, minStageMs: 1500, scareMs: 5000, goodbyeMs: 3000 }, scare: { adultLevel: 'medium' } }),
});

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.spooky && document.querySelector('#loading') === null || document.querySelector('#loading.hide'), null, { timeout: 60000 });
const t0 = Date.now();
const snap = async name => page.screenshot({ path: path.join(outDir, name + '.png') });
const status = () => page.evaluate(() => {
  const a = window.spooky; const tr = a.tracker.tracks.filter(t => t.fresh);
  return { stage: a.director.stage, audience: a.director.audience, mode: a.detector.mode + "/" + a.detector.delegate, err: a.detector.error, fps: +a.detector.fps.toFixed(1), ms: +a.detector.inferMs.toFixed(0), draw: +a.fps.toFixed(0),
    people: tr.map(t => ({ id: t.id, lvl: t.level, kid: t.isKid, h: t.height && +t.height.toFixed(2), gy: +t.groundY.toFixed(2) })) };
});

const shots = new Set();
let mode = '';
while (Date.now() - t0 < seconds * 1000) {
  const st = await status();
  mode = st.mode;
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`t=${sec}s`, JSON.stringify(st));
  const key = st.stage + '-' + st.audience;
  if (!shots.has(key)) { shots.add(key); await snap(`${String(sec).padStart(2, '0')}-${key}`); }
  await new Promise(r => setTimeout(r, 1000));
}

// open setup and screenshot it
await page.keyboard.press('s');
await new Promise(r => setTimeout(r, 800));
await snap('setup');

console.log('\nStages seen:\n' + stages.join('\n'));
console.log('\nErrors:', errors.length ? errors : 'none');
await cleanup();

if (expect && expect !== 'none') {
  const parsed = stages.map(s => { const m = /^\[stage\] (\w+) \((\w+)\) - (.*)$/.exec(s); return m ? { stage: m[1], aud: m[2], reason: m[3] } : null; }).filter(Boolean);
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
  check('AI detection running', mode.startsWith('ai/'), mode);
  // first visit: approach/near -> scare -> goodbye ... -> idle, in that order
  const seq = ['approach|near', 'scare', 'goodbye', 'idle'];
  let i = 0;
  for (const p of parsed) if (i < seq.length && new RegExp(`^(${seq[i]})$`).test(p.stage)) i++;
  check('stage sequence approach/near -> scare -> goodbye -> idle', i === seq.length, parsed.map(p => p.stage).join(','));
  const first = parsed.find(p => p.stage === 'approach' || p.stage === 'near');
  check(`first welcome is for ${expect}`, first?.aud === expect, first ? `${first.stage} (${first.aud})` : 'no welcome');
  const firstScare = parsed.find(p => p.stage === 'scare');
  check(`scare is the ${expect} version`, firstScare?.aud === expect, firstScare ? firstScare.aud : 'no scare');
  check('near (take one) stage reached', parsed.some(p => p.stage === 'near'));
  const wrong = parsed.filter(p => p.stage !== 'idle' && p.aud !== expect);
  check(`no ${expect === 'kids' ? 'adult' : 'kids'} scenes during the visit`, wrong.length === 0, wrong.map(p => `${p.stage}(${p.aud})`).join(','));
  check('no console errors / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nE2E ${path.basename(video)} expect=${expect}: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
