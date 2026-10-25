// Unit tests for web/js/settings.js (defaults, deepMerge, load/save with the localStorage fallback).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../web/js/settings.js';
import { Tracker } from '../../web/js/tracker.js';
import { Director } from '../../web/js/director.js';
import { installClock, track } from './helpers.mjs';

const { DEFAULTS, DEFAULT_PHRASES, deepMerge, clone, replaceSettings, loadSettings, saveSettings } = S;
const LS_KEY = 'spooky-treat-station-settings';

// ---- browser API stubs
let store, posted, apiGet, apiPost;
function memoryStorage() {
  return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
}
beforeEach(() => {
  store = {}; posted = [];
  apiGet = () => ({ ok: true, json: async () => ({}) });
  apiPost = () => ({ ok: true, text: async () => '' });
  globalThis.localStorage = memoryStorage();
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') return apiGet(url);
    posted.push(JSON.parse(opts.body));
    return apiPost(url, opts);
  };
});
afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch; });

const jsonResp = v => () => ({ ok: true, json: async () => v });

// ---------------------------------------------------------------- deepMerge

test('SE-01 deepMerge: partial saved settings keep every other default', () => {
  const s = deepMerge(clone(DEFAULTS), { zones: { nearLine: 0.6 } });
  assert.equal(s.zones.nearLine, 0.6);
  assert.equal(s.zones.approachLine, DEFAULTS.zones.approachLine);
  assert.deepEqual(s.zones.jar, DEFAULTS.zones.jar);
  assert.deepEqual(s.timing, DEFAULTS.timing);
});

test('SE-02 deepMerge: settings from an older version (missing sections/keys) are filled in', () => {
  const old = { version: 0, camera: { deviceId: 'abc' }, zones: { approachLine: 0.3, nearLine: 0.6, scareLine: 0.9 } };
  const s = deepMerge(clone(DEFAULTS), old);
  assert.equal(s.camera.deviceId, 'abc'); assert.equal(s.camera.mirror, true);
  assert.deepEqual(s.zones.jar, DEFAULTS.zones.jar);
  assert.deepEqual(s.scare, DEFAULTS.scare);
});

test('SE-03 deepMerge: unknown extra keys are preserved (forward compatibility)', () => {
  const s = deepMerge(clone(DEFAULTS), { future: { x: 1 }, zones: { newThing: 5 } });
  assert.deepEqual(s.future, { x: 1 }); assert.equal(s.zones.newThing, 5);
});

test('SE-04 deepMerge: arrays are replaced, not merged', () => {
  const pts = [{ footY: 0.6, h: 0.3, H: 1.7 }];
  const s = deepMerge(clone(DEFAULTS), { calibration: { points: pts } });
  assert.deepEqual(s.calibration.points, pts);
});

test('SE-05 deepMerge: garbage top-level values (null, array, string, number) give the defaults', () => {
  for (const g of [null, [], 'x', 42, true]) assert.deepEqual(deepMerge(clone(DEFAULTS), g), DEFAULTS, JSON.stringify(g));
});

test('SE-06 deepMerge: a section that is null/array/string is replaced by its defaults', () => {
  const s = deepMerge(clone(DEFAULTS), { zones: null, timing: [], scare: 'boo' });
  assert.deepEqual(s.zones, DEFAULTS.zones); assert.deepEqual(s.timing, DEFAULTS.timing); assert.deepEqual(s.scare, DEFAULTS.scare);
});

test('SE-07 deepMerge: a value of the wrong type falls back to the default (no NaN timers / stuck show)', () => {
  const s = deepMerge(clone(DEFAULTS), { timing: { scareMs: 'long', emptyMs: null }, zones: { nearLine: '0.7' }, audio: { volume: {} } });
  assert.equal(typeof s.timing.scareMs, 'number', `scareMs = ${JSON.stringify(s.timing.scareMs)}`);
  assert.equal(typeof s.timing.emptyMs, 'number', `emptyMs = ${JSON.stringify(s.timing.emptyMs)}`);
  assert.equal(typeof s.zones.nearLine, 'number', `nearLine = ${JSON.stringify(s.zones.nearLine)}`);
  assert.equal(typeof s.audio.volume, 'number', `volume = ${JSON.stringify(s.audio.volume)}`);
});

test('SE-08 deepMerge does not mutate DEFAULTS', () => {
  const before = JSON.stringify(DEFAULTS);
  const s = deepMerge(clone(DEFAULTS), { zones: { jar: { x: 0.1 } } });
  s.zones.jar.y = 0.01; s.phrases.idle.push('x'); s.calibration.points.push({});
  assert.equal(JSON.stringify(DEFAULTS), before);
});

// ---------------------------------------------------------------- defaults sanity

test('SE-09 defaults are consistent: lines ordered, jar inside the picture, sliders in range', () => {
  const z = DEFAULTS.zones;
  assert.ok(z.approachLine < z.nearLine && z.nearLine < z.scareLine);
  assert.ok(z.left < z.right);
  assert.ok(z.jar.x >= 0 && z.jar.x + z.jar.w <= 1 && z.jar.y >= 0 && z.jar.y + z.jar.h <= 1.0000001);
  assert.ok(DEFAULTS.timing.scareMs >= 3000 && DEFAULTS.timing.scareMs <= 15000);
  assert.equal(DEFAULTS.scare.strobe, false, 'strobe must be off by default (photosensitive epilepsy)');
});

test('SE-10 there is a default phrase list for every stage/audience', () => {
  for (const k of ['idle', 'approach-kids', 'approach-adults', 'near-kids', 'near-adults', 'scare-kids', 'scare-adults', 'goodbye-kids', 'goodbye-adults']) {
    assert.ok(Array.isArray(DEFAULT_PHRASES[k]) && DEFAULT_PHRASES[k].length > 0, k);
  }
});

// ---------------------------------------------------------------- loadSettings

test('SE-11 load: no settings anywhere -> defaults and firstRun = true', async () => {
  const s = await loadSettings();
  assert.deepEqual(s, deepMerge(clone(DEFAULTS), {}));
  assert.equal(S.firstRun, true);
});

test('SE-12 load: settings.json from the launcher wins; firstRun = false', async () => {
  apiGet = jsonResp({ zones: { nearLine: 0.66 } });
  store[LS_KEY] = JSON.stringify({ zones: { nearLine: 0.11 } });
  const s = await loadSettings();
  assert.equal(s.zones.nearLine, 0.66); assert.equal(S.firstRun, false);
});

test('SE-13 load: launcher returns {} (no settings.json) -> localStorage backup is used', async () => {
  store[LS_KEY] = JSON.stringify({ zones: { nearLine: 0.11 } });
  const s = await loadSettings();
  assert.equal(s.zones.nearLine, 0.11); assert.equal(S.firstRun, false);
});

test('SE-14 load: launcher not reachable (fetch throws) -> localStorage backup is used', async () => {
  apiGet = () => { throw new TypeError('Failed to fetch'); };
  store[LS_KEY] = JSON.stringify({ timing: { scareMs: 9000 } });
  const s = await loadSettings();
  assert.equal(s.timing.scareMs, 9000);
});

test('SE-15 load: launcher HTTP 500 -> localStorage backup is used', async () => {
  apiGet = () => ({ ok: false, json: async () => ({ zones: { nearLine: 0.99 } }) });
  store[LS_KEY] = JSON.stringify({ zones: { nearLine: 0.12 } });
  const s = await loadSettings();
  assert.equal(s.zones.nearLine, 0.12);
});

test('SE-16 load: corrupt settings.json (invalid JSON body) -> falls back, does not throw', async () => {
  apiGet = () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } });
  const s = await loadSettings();
  assert.deepEqual(s.zones, DEFAULTS.zones);
});

test('SE-17 load: corrupt localStorage value -> defaults, does not throw', async () => {
  store[LS_KEY] = '{oops';
  const s = await loadSettings();
  assert.deepEqual(s.timing, DEFAULTS.timing); assert.equal(S.firstRun, true);
});

test('SE-18 load: localStorage throws (blocked storage) -> defaults, does not throw', async () => {
  globalThis.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  const s = await loadSettings();
  assert.deepEqual(s.zones, DEFAULTS.zones);
});

test('SE-19 load: missing / non-array phrase lists are filled from the defaults; user lists kept', async () => {
  apiGet = jsonResp({ phrases: { idle: ['Hi!'], 'near-kids': 'not a list', 'scare-adults': null } });
  const s = await loadSettings();
  assert.deepEqual(s.phrases.idle, ['Hi!']);
  assert.deepEqual(s.phrases['near-kids'], DEFAULT_PHRASES['near-kids']);
  assert.deepEqual(s.phrases['scare-adults'], DEFAULT_PHRASES['scare-adults']);
  assert.deepEqual(s.phrases['goodbye-kids'], DEFAULT_PHRASES['goodbye-kids']);
});

test('SE-20 load: a phrase list the user deliberately emptied stays empty after a restart', async () => {
  // In Setup > Phrases, clearing a text box makes that character silent right away (phrase() returns '').
  // After saving and restarting, the list must still be empty, otherwise behaviour changes on reboot.
  apiGet = jsonResp({ phrases: { 'scare-adults': [] } });
  const s = await loadSettings();
  assert.deepEqual(s.phrases['scare-adults'], [], `emptied list came back as ${JSON.stringify(s.phrases['scare-adults'])}`);
});

test('SE-21 load: filled-in phrase lists are copies (editing them does not change DEFAULT_PHRASES)', async () => {
  const s = await loadSettings();
  s.phrases.idle.push('changed');
  assert.ok(!DEFAULT_PHRASES.idle.includes('changed'));
});

test('SE-22 load: huge phrase lists are kept as-is', async () => {
  const big = Array.from({ length: 20000 }, (_, i) => `Phrase number ${i} `.repeat(3));
  apiGet = jsonResp({ phrases: { idle: big } });
  const s = await loadSettings();
  assert.equal(s.phrases.idle.length, 20000);
});

test('SE-23 load: saved settings of the wrong type for calibration.points must not crash the app start', async () => {
  // main.js does `new Tracker(s)` right after loadSettings(); an exception there leaves the loading screen forever
  apiGet = jsonResp({ calibration: { points: { footY: 0.7 } } });
  const s = await loadSettings();
  assert.doesNotThrow(() => new Tracker(s));
});

test('SE-24 load: wrong-type timing values must not stop the show (scare that never ends)', async () => {
  const clock = installClock();
  apiGet = jsonResp({ timing: { scareMs: '6.5 s', scareDelayMs: 0 } });
  const s = await loadSettings();
  const d = new Director(s);
  d.force('scare', 'adults');
  for (let i = 0; i < 300; i++) { clock.t += 100; d.update([], { jarMotion: 0, hands: [] }, clock.t); }
  assert.notEqual(d.stage, 'scare', 'scare scene still running after 30 s (scareMs was the string "6.5 s")');
});

// ---------------------------------------------------------------- saveSettings

test('SE-25 save: posts the full settings and keeps a localStorage backup', async () => {
  const s = deepMerge(clone(DEFAULTS), { zones: { nearLine: 0.5 } });
  const r = await saveSettings(s);
  // since v1.0.3 the result also carries the new settings revision (undefined here: the mock has no body)
  assert.deepEqual(r, { ok: true, where: 'settings.json', rev: undefined });
  assert.equal(posted.length, 1); assert.equal(posted[0].zones.nearLine, 0.5);
  assert.equal(JSON.parse(store[LS_KEY]).zones.nearLine, 0.5);
});

test('SE-26 save: launcher error -> ok:false "browser only", backup still written', async () => {
  apiPost = () => ({ ok: false, text: async () => 'disk full' });
  const r = await saveSettings(clone(DEFAULTS));
  assert.equal(r.ok, false); assert.equal(r.where, 'browser only'); assert.match(r.error, /disk full/);
  assert.ok(store[LS_KEY]);
});

test('SE-27 save: localStorage quota error does not prevent writing settings.json', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  const r = await saveSettings(clone(DEFAULTS));
  assert.equal(r.ok, true); assert.equal(posted.length, 1);
});

test('SE-28 save then load round-trips every setting', async () => {
  const s = deepMerge(clone(DEFAULTS), { zones: { left: 0.2, jar: { enabled: false } }, calibration: { points: [{ footY: 0.6, h: 0.3, H: 1.7 }] }, phrases: { idle: ['a', 'b'] } });
  await saveSettings(s);
  apiGet = jsonResp(posted[0]);
  assert.deepEqual(await loadSettings(), s);
});

// ---------------------------------------------------------------- replaceSettings

test('SE-29 replaceSettings replaces in place (shared object identity kept) with a deep copy', () => {
  const s = deepMerge(clone(DEFAULTS), { zones: { nearLine: 0.5 } });
  const ref = s, zonesBefore = s.zones;
  replaceSettings(s, DEFAULTS);
  assert.equal(ref, s); assert.equal(s.zones.nearLine, DEFAULTS.zones.nearLine);
  assert.notEqual(s.zones, DEFAULTS.zones, 'must be a copy');
  assert.notEqual(s.zones, zonesBefore);
  s.phrases.idle.push('x'); assert.ok(!DEFAULTS.phrases.idle.includes('x'));
});

test('SE-30 a Tracker/Director built on the shared object sees replaced settings', () => {
  installClock();
  const s = deepMerge(clone(DEFAULTS), { audience: { mode: 'adults' } });
  const d = new Director(s);
  replaceSettings(s, deepMerge(clone(DEFAULTS), { audience: { mode: 'kids' } }));
  assert.equal(d.computeAudience([track({ isKid: false })]), 'kids');
});
