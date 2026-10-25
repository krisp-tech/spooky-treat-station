// Unit tests for web/js/media.js (choosing built-in vs custom media) + consistency with the Go launcher.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MediaLayer, folderFor } from '../../web/js/media.js';
import { STAGES, DEFAULT_PHRASES } from '../../web/js/settings.js';
import { makeSettings } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// minimal DOM stand-ins (MediaLayer only needs createElement/append/style)
function fakeEl(tag) {
  return { tag, style: {}, classList: { add() {}, remove() {} }, offsetWidth: 0, pause() {}, load() {}, play: async () => {}, removeAttribute(k) { delete this[k]; } };
}
beforeEach(() => { globalThis.document = { createElement: fakeEl }; });
afterEach(() => { delete globalThis.document; delete globalThis.fetch; });

function layer(content, files) {
  const s = makeSettings({ content });
  const m = new MediaLayer(s, { ...fakeEl('div'), append() {} });
  m.files = files;
  return m;
}
function withRandom(values, fn) {
  const orig = Math.random; let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

test('ME-01 folderFor maps stage + audience to the media folder names', () => {
  assert.equal(folderFor('idle', 'kids'), 'idle');
  assert.equal(folderFor('idle', 'adults'), 'idle');
  assert.equal(folderFor('scare', 'adults'), 'scare-adults');
  assert.equal(folderFor('approach', 'kids'), 'approach-kids');
});

test('ME-02 every folder the web app asks for is created/listed by the Go launcher (and vice versa)', () => {
  const go = readFileSync(path.join(root, 'main.go'), 'utf8');
  const block = /var mediaFolders = \[\]string\{([\s\S]*?)\}/.exec(go)[1];
  const goFolders = [...block.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort();
  const jsFolders = [...new Set(STAGES.flatMap(st => ['kids', 'adults'].map(a => folderFor(st, a))))].sort();
  assert.deepEqual(jsFolders, goFolders);
  assert.deepEqual(Object.keys(DEFAULT_PHRASES).sort(), goFolders, 'one phrase list per media folder');
});

test('ME-03 the launcher lists exactly the extensions the web app can classify (video/image/audio)', () => {
  const go = readFileSync(path.join(root, 'main.go'), 'utf8');
  const block = /var mediaExts = map\[string\]bool\{([\s\S]*?)\n\}/.exec(go)[1];
  const goExts = [...block.matchAll(/"\.(\w+)"/g)].map(m => m[1]).sort();
  const m = layer({}, { idle: goExts.map(e => `/media/idle/f.${e}`) });
  const c = m.count('idle');
  assert.equal(c.visual + c.audio, goExts.length, 'some listed file types are neither video, image nor audio in media.js');
  const m2 = layer({}, { idle: goExts.map(e => `/media/idle/F.${e.toUpperCase()}`) });
  const c2 = m2.count('idle');
  assert.equal(c2.visual + c2.audio, goExts.length, 'upper-case extensions');
});

test('ME-04 builtin mode never uses files', () => {
  const m = layer({ scare: 'builtin' }, { 'scare-adults': ['/media/scare-adults/a.mp4'] });
  assert.deepEqual(m.choose('scare', 'adults'), { visual: null, audio: null });
});

test('ME-05 custom mode with an empty folder falls back to the built-in scene', () => {
  const m = layer({ scare: 'custom' }, { 'scare-adults': [] });
  assert.deepEqual(m.choose('scare', 'adults'), { visual: null, audio: null });
  const m2 = layer({ scare: 'custom' }, {});
  assert.deepEqual(m2.choose('scare', 'adults'), { visual: null, audio: null }, 'folder missing from listing');
});

test('ME-06 custom mode picks one visual and one audio file, from the right audience folder only', () => {
  const files = { 'near-kids': ['/media/near-kids/k.png', '/media/near-kids/k.mp3'], 'near-adults': ['/media/near-adults/a.mp4'] };
  const m = layer({ near: 'custom' }, files);
  assert.deepEqual(m.choose('near', 'kids'), { visual: '/media/near-kids/k.png', audio: '/media/near-kids/k.mp3' });
  assert.deepEqual(m.choose('near', 'adults'), { visual: '/media/near-adults/a.mp4', audio: null });
});

test('ME-07 custom folder with only sounds: built-in animation + the sound replaces the voice', () => {
  const m = layer({ idle: 'custom' }, { idle: ['/media/idle/hello.wav'] });
  assert.deepEqual(m.choose('idle', 'kids'), { visual: null, audio: '/media/idle/hello.wav' });
});

test('ME-08 random choice covers every file', () => {
  const list = ['/media/idle/a.mp4', '/media/idle/b.webm', '/media/idle/c.jpg'];
  const m = layer({ idle: 'custom' }, { idle: list });
  const seen = new Set(withRandom([0, 0.34, 0.67, 0.99], () => [0, 1, 2, 3].map(() => m.choose('idle', 'kids').visual)));
  assert.equal(seen.size, 3);
});

test('ME-09 mix mode: about half built-in, half custom', () => {
  const m = layer({ idle: 'mix' }, { idle: ['/media/idle/a.mp4'] });
  assert.equal(withRandom([0.2], () => m.choose('idle', 'kids').visual), null);
  assert.equal(withRandom([0.7, 0], () => m.choose('idle', 'kids').visual), '/media/idle/a.mp4');
  let custom = 0; for (let i = 0; i < 2000; i++) if (m.choose('idle', 'kids').visual) custom++;
  assert.ok(custom > 800 && custom < 1200, `${custom}/2000 custom`);
});

test('ME-10 unknown/missing content mode behaves like built-in', () => {
  const m = layer({}, { idle: ['/media/idle/a.mp4'] });
  delete m.s.content.idle;
  assert.deepEqual(m.choose('idle', 'kids'), { visual: null, audio: null });
});

test('ME-11 count() separates visual and audio files; escaped names still classify', () => {
  const m = layer({}, { 'scare-adults': ['/media/scare-adults/a%20b.MP4', '/media/scare-adults/x%23.jpeg', '/media/scare-adults/s.m4a', '/media/scare-adults/s.ogg'] });
  assert.deepEqual(m.count('scare-adults'), { visual: 2, audio: 2 });
  assert.deepEqual(m.count('nope'), { visual: 0, audio: 0 });
});

test('ME-12 refresh(): network error leaves an empty listing (no throw)', async () => {
  const m = layer({}, { idle: ['/media/idle/a.mp4'] });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await m.refresh(), {});
});
