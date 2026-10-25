// Shared helpers for the Playwright browser tests in test/browser/.
// Each test file:  node test/browser/<file>.mjs <server-binary>     (or STS_BIN=<binary>)
// prints PASS/FAIL per case and a summary line, and exits non-zero if anything failed.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BIN = process.argv[2] || process.env.STS_BIN;
if (!BIN) { console.error('usage: node test/browser/<test>.mjs <server-binary>  (or set STS_BIN)'); process.exit(2); }
// Linux Piper + voices from scripts/fetch-voices.sh linux (natural voice tests)
export const PIPER_ARGS = ['-piper', path.join(ROOT, '.cache/piper/linux/piper/piper'), '-voices', path.join(ROOT, '.cache/piper/voices')];
export const VIDEO = { adult: path.join(ROOT, 'test/approach.y4m'), child: path.join(ROOT, 'test/child.y4m'), group: path.join(ROOT, 'test/group.y4m') };

export const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanups = [];
export function onCleanup(fn) { cleanups.push(fn); }
async function runCleanups() { while (cleanups.length) { try { await cleanups.pop()(); } catch (e) { /* ignore */ } } }

// Test-friendly timings so the show moves quickly (same as test/e2e.mjs).
export const FAST_TIMING = { confirmMs: 500, emptyMs: 2500, minStageMs: 1500, scareMs: 5000, goodbyeMs: 3000 };

// ---------------------------------------------------------------- server

export async function startServer({ port, settings, settingsRaw, setupData, args = [] } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sts-bt-'));
  if (settingsRaw !== undefined) writeFileSync(path.join(dataDir, 'settings.json'), settingsRaw);
  else if (settings) writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settings));
  if (setupData) { mkdirSync(path.join(dataDir, 'media'), { recursive: true }); await setupData(dataDir); }
  const proc = spawn(BIN, ['-no-browser', '-port', String(port), '-data', dataDir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
  const exited = new Promise(r => proc.on('exit', code => r(code)));
  const srv = { port, dataDir, proc, exited, url: p => `http://127.0.0.1:${port}${p}`, output: () => out };
  onCleanup(async () => { proc.kill(); await Promise.race([exited, sleep(1000)]); rmSync(dataDir, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(srv.url('/api/info')); if (r.ok) return srv; } catch (e) { /* not yet */ }
    await sleep(50);
  }
  throw new Error(`server on ${port} did not start:\n${out}`);
}

// ---------------------------------------------------------------- browser

// camera: 'fake' (moving test pattern), a .y4m path, 'none' (no device), 'denied' (permission refused),
//         'late' (first getUserMedia calls fail as if the USB camera is not ready yet, later calls work)
export async function launch({ camera = 'fake', extraArgs = [] } = {}) {
  const args = ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extraArgs];
  if (camera !== 'none') args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
  if (camera.endsWith?.('.y4m')) args.push(`--use-file-for-fake-video-capture=${camera}`);
  const browser = await chromium.launch({ args });
  onCleanup(() => browser.close());
  return browser;
}

const IGNORED = [/XNNPACK/, /Created TensorFlow Lite/];

export async function openApp(browser, srv, { camera = 'fake', query = '', viewport = { width: 1280, height: 720 }, initScript, waitReady = true, lateFailures = 2 } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.errors = []; page.stages = []; page.logs = [];
  page.on('console', m => {
    const t = m.text();
    page.logs.push(t);
    if (m.type() === 'error' && !IGNORED.some(r => r.test(t))) page.errors.push(t);
    if (t.startsWith('[stage]')) page.stages.push(t);
  });
  page.on('pageerror', e => page.errors.push('PAGEERROR ' + e.message));
  // record speech + camera calls for assertions
  await page.addInitScript(({ camera, lateFailures }) => {
    window.__spoken = [];
    window.__gumCalls = 0;
    if (window.speechSynthesis) {
      const orig = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = u => { window.__spoken.push({ text: u.text, volume: u.volume, t: performance.now() }); try { orig(u); } catch (e) { /* ignore */ } };
    }
    const md = navigator.mediaDevices;
    if (md) {
      const gum = md.getUserMedia.bind(md);
      md.getUserMedia = c => {
        window.__gumCalls++;
        if (camera === 'denied') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        if (camera === 'late' && window.__gumCalls <= lateFailures) return Promise.reject(new DOMException('Could not start video source', 'NotReadableError'));
        return gum(c);
      };
    }
  }, { camera, lateFailures });
  if (initScript) await page.addInitScript(initScript);
  await page.goto(srv.url('/' + query));
  if (waitReady) await waitForReady(page);
  return page;
}

export async function waitForReady(page, timeout = 60000) {
  await page.waitForFunction(() => window.spooky && !document.querySelector('#loading:not(.hide)'), null, { timeout });
}

// Fraction of non-dark pixels on the main stage canvas (is something drawn?)
export function canvasStats(page, sel = '#stage') {
  return page.evaluate(sel => {
    const c = document.querySelector(sel);
    const t = document.createElement('canvas'); t.width = 64; t.height = 36;
    const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; if (v > 60) lit++; }
    return { lit: lit / (d.length / 4), mean: sum / (d.length / 4) / 765, w: c.width, h: c.height };
  }, sel);
}

// ---------------------------------------------------------------- tiny test runner

export function suite(name) {
  const results = [];
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  return {
    async test(id, desc, fn) {
      if (only && !only.test(id)) return;
      const t0 = Date.now();
      try {
        await fn();
        results.push({ id, desc, ok: true });
        console.log(`PASS ${id} ${desc} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (e) {
        results.push({ id, desc, ok: false, err: e });
        console.log(`FAIL ${id} ${desc} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n     ${String(e && e.message || e).split('\n').join('\n     ')}`);
      }
    },
    async done() {
      await runCleanups();
      const failed = results.filter(r => !r.ok);
      console.log(`\nSUMMARY ${name}: ${results.length - failed.length} passed, ${failed.length} failed` + (failed.length ? ` (${failed.map(f => f.id).join(', ')})` : ''));
      process.exit(failed.length ? 1 : 0);
    },
  };
}

export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function assertNoErrors(page, what = '') {
  assert(page.errors.length === 0, `console/page errors${what ? ' ' + what : ''}: ${page.errors.slice(0, 5).join(' | ')}`);
}

export async function waitFor(page, fn, arg, timeout = 10000, msg) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); } catch (e) { throw new Error(msg || `timed out waiting for ${fn}`); }
}

process.on('unhandledRejection', async e => { console.log('FAIL (unhandled) ' + (e && e.stack || e)); await runCleanups(); process.exit(1); });
export { existsSync };
