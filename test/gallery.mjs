// Screenshots of every built-in scene (for checking visuals).   node test/gallery.mjs <server-binary> [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const bin = process.argv[2], outDir = path.resolve(process.argv[3] || 'test/gallery');
mkdirSync(outDir, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpdir(), 'sts-'));
const port = 8796;
const server = spawn(bin, ['-no-browser', '-port', String(port), '-data', dataDir], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'POST', body: JSON.stringify({ audio: { subtitles: true } }) });

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.querySelector('#loading') === null, null, { timeout: 60000 });

const shots = [
  ['idle', null, [2.5]],
  ['approach', 'kids', [1.5]], ['near', 'kids', [2.5]], ['scare', 'kids', [0.55, 2.2]], ['goodbye', 'kids', [1.5]],
  ['approach', 'adults', [2.5]], ['near', 'adults', [2]], ['scare', 'adults', [1.1, 4.2]], ['goodbye', 'adults', [1.5]],
];
for (const [stage, aud, times] of shots) {
  await page.evaluate(([s, a]) => { window.spooky.s.scare.adultLevel = 'medium'; window.spooky.director.force(s, a); }, [stage, aud]);
  let waited = 0;
  for (const t of times) {
    await page.waitForTimeout((t - waited) * 1000); waited = t;
    await page.screenshot({ path: path.join(outDir, `${stage}-${aud || 'all'}-${t}s.png`) });
  }
}
console.log('errors:', errors.filter(e => !e.includes('XNNPACK')));
await browser.close(); server.kill();
