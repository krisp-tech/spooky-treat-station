// Unit tests for web/js/tracker.js (height model, kid/adult, ground position, zones, track matching).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, heightModel } from '../../web/js/tracker.js';
import { makeSettings, personBox } from './helpers.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

// ---------------------------------------------------------------- height model

test('TR-01 heightModel: no calibration points -> estimated model from cameraHeight/horizon', () => {
  const m = heightModel({ points: [], cameraHeight: 1.25, horizon: 0.4 });
  assert.match(m.source, /estimated/);
  close(m.a, 1 / 1.25, 1e-9); close(m.b, -0.4 / 1.25, 1e-9);
});

test('TR-02 heightModel: cameraHeight below 0.2 m is clamped (no divide-by-zero / negative model)', () => {
  for (const ch of [0, -1, 0.05]) {
    const m = heightModel({ points: [], cameraHeight: ch, horizon: 0.4 });
    assert.ok(Number.isFinite(m.a) && m.a > 0, `cameraHeight ${ch} gives a=${m.a}`);
    close(m.a, 1 / 0.2, 1e-9);
  }
});

test('TR-03 heightModel: one point keeps the horizon and solves the camera height', () => {
  // a person of 1.8 m, feet at 0.8, box 0.5 tall, horizon 0.4 -> hc = (0.8-0.4)*1.8/0.5 = 1.44
  const m = heightModel({ points: [{ footY: 0.8, h: 0.5, H: 1.8 }], cameraHeight: 1, horizon: 0.4 });
  assert.match(m.source, /1 point/);
  close(m.a * 0.8 + m.b, 0.5 / 1.8, 1e-9, 'the calibration point must be reproduced exactly');
});

test('TR-04 heightModel: one point above the horizon is rejected -> estimated', () => {
  const m = heightModel({ points: [{ footY: 0.3, h: 0.2, H: 1.7 }], cameraHeight: 1, horizon: 0.4 });
  assert.match(m.source, /estimated/);
});

test('TR-05 heightModel: 2+ points -> least squares recovers the true ground-plane line', () => {
  const truth = { a: 0.9, b: -0.33 };
  const pts = [0.55, 0.7, 0.9].map(f => ({ footY: f, h: 1.75 * (truth.a * f + truth.b), H: 1.75 }));
  const m = heightModel({ points: pts, cameraHeight: 1, horizon: 0.4 });
  assert.match(m.source, /calibrated \(3 points\)/);
  close(m.a, truth.a, 1e-9); close(m.b, truth.b, 1e-9);
});

test('TR-06 heightModel: degenerate points (same footY) fall back to the 1-point model', () => {
  const pts = [{ footY: 0.8, h: 0.5, H: 1.8 }, { footY: 0.8, h: 0.52, H: 1.8 }];
  const m = heightModel({ points: pts, cameraHeight: 1, horizon: 0.4 });
  assert.match(m.source, /1 point/);
});

test('TR-07 heightModel: slope <= 0.05 (people get smaller when closer = bad capture) is rejected', () => {
  const pts = [{ footY: 0.5, h: 0.5, H: 1.8 }, { footY: 0.9, h: 0.3, H: 1.8 }];
  const m = heightModel({ points: pts, cameraHeight: 1, horizon: 0.4 });
  assert.doesNotMatch(m.source, /2 points/);
  assert.ok(m.a > 0, 'fallback model must have a positive slope');
});

test('TR-08 heightModel: points with zero/negative/NaN values are ignored and never produce NaN', () => {
  const bad = [{ footY: 0.8, h: 0, H: 1.8 }, { footY: 0.7, h: 0.4, H: 0 }, { footY: NaN, h: 0.4, H: 1.7 }, { footY: 0.9, h: -1, H: 1.7 }];
  const m = heightModel({ points: bad, cameraHeight: 1.1, horizon: 0.4 });
  assert.ok(Number.isFinite(m.a) && Number.isFinite(m.b), JSON.stringify(m));
});

test('TR-09 heightModel: missing points array is handled', () => {
  const m = heightModel({ cameraHeight: 1, horizon: 0.4 });
  assert.match(m.source, /estimated/);
});

// ---------------------------------------------------------------- height + kid/adult

function calibrated(over = {}) {
  const s = makeSettings(over);
  s.calibration.points = [0.55, 0.75, 0.92].map(f => ({ footY: f, h: 1.7 * (0.9 * f - 0.33), H: 1.7 }));
  return s;
}

test('TR-10 real height is estimated within 3% at different distances (calibrated)', () => {
  const s = calibrated(); const tr = new Tracker(s);
  for (const [H, f] of [[1.2, 0.6], [1.2, 0.85], [1.85, 0.6], [1.85, 0.85], [0.95, 0.75]]) {
    const t = new Tracker(s);
    let now = 0;
    for (let i = 0; i < 5; i++) t.update([personBox(tr.model, H, f)], now += 150);
    close(t.tracks[0].height, H, H * 0.03, `H=${H} footY=${f}`);
  }
});

test('TR-11 kid/adult classification against childMaxHeight (strictly shorter = kid)', () => {
  const s = calibrated(); const m = new Tracker(s).model;
  const classify = H => { const t = new Tracker(s); let now = 0; for (let i = 0; i < 3; i++) t.update([personBox(m, H, 0.7)], now += 150); return t.tracks[0].isKid; };
  assert.equal(classify(1.1), true);
  assert.equal(classify(1.38), true);
  assert.equal(classify(1.45), false);
  assert.equal(classify(1.8), false);
  s.audience.childMaxHeight = 1.0;
  assert.equal(classify(1.1), false, 'childMaxHeight setting must be honoured');
});

test('TR-12 height unknown (never seen head-to-toe) -> isKid null', () => {
  const s = calibrated(); const t = new Tracker(s);
  t.update([{ x: 0.3, y: 0.01, w: 0.4, h: 0.99 }], 0);
  t.update([{ x: 0.3, y: 0.01, w: 0.4, h: 0.99 }], 150);
  assert.equal(t.tracks[0].height, null);
  assert.equal(t.tracks[0].isKid, null);
});

test('TR-13 implausible heights (<0.5 m or >2.4 m) are discarded', () => {
  const s = calibrated(); const t = new Tracker(s); const m = t.model;
  t.update([personBox(m, 3.0, 0.7)], 0);
  t.update([personBox(m, 0.3, 0.7)], 150);
  assert.equal(t.tracks[0].heights.length, 0);
});

test('TR-14 height history is a median over at most 25 samples (robust to an outlier)', () => {
  const s = calibrated(); const t = new Tracker(s); const m = t.model;
  let now = 0;
  for (let i = 0; i < 40; i++) t.update([personBox(m, i === 20 ? 2.2 : 1.7, 0.6 + i * 0.005)], now += 150);
  assert.ok(t.tracks[0].heights.length <= 25);
  close(t.tracks[0].height, 1.7, 0.05);
});

test('TR-15 a missed detection must not add duplicate height samples from the stale box', () => {
  // the person is detected once, then the detector misses them for ~1 s (6 checks at 6/s)
  const s = calibrated(); const t = new Tracker(s); const m = t.model;
  t.update([personBox(m, 1.2, 0.7)], 0);
  for (let i = 1; i <= 6; i++) t.update([], i * 160);
  assert.equal(t.tracks[0].heights.length, 1, `stale box was re-measured: ${t.tracks[0].heights.length} height samples from 1 detection`);
});

// ---------------------------------------------------------------- ground position + zones

test('TR-16 feet visible: groundY is the box bottom; feet at >=0.97 count as out of frame', () => {
  const s = makeSettings(); const t = new Tracker(s);
  t.update([{ x: 0.4, y: 0.3, w: 0.2, h: 0.5 }], 0);
  assert.equal(t.tracks[0].feetVisible, true); close(t.tracks[0].groundY, 0.8, 1e-9);
  const t2 = new Tracker(s);
  t2.update([{ x: 0.4, y: 0.3, w: 0.2, h: 0.68 }], 0);
  assert.equal(t2.tracks[0].feetVisible, false);
  assert.ok(t2.tracks[0].groundY >= 0.98);
});

test('TR-17 feet below the picture: groundY is extrapolated from the known height (camera above head height)', () => {
  // camera at 2.5 m (looking down): den = 1 - H*a > 0, the extrapolation is exact for this geometry
  const s = makeSettings({ calibration: { cameraHeight: 2.5, horizon: 0.2 } });
  const t = new Tracker(s); const m = t.model;
  let now = 0;
  // walk up seen head-to-toe (so the height is learned), then the feet leave the picture
  for (const f of [0.6, 0.7, 0.8, 0.9]) t.update([personBox(m, 1.7, f)], now += 150);
  close(t.tracks[0].height, 1.7, 0.02);
  const trueFoot = 1.15, b = personBox(m, 1.7, trueFoot);
  const cut = { ...b, h: 1 - b.y }; // detector box is clipped at the bottom of the frame
  t.update([cut], now += 150);
  assert.equal(t.tracks[0].feetVisible, false);
  close(t.tracks[0].groundY, trueFoot, 0.02, 'extrapolated feet position');
});

test('TR-18 scare line below the picture (>100%) is reachable via extrapolation', () => {
  const s = makeSettings({ calibration: { cameraHeight: 2.5, horizon: 0.2 }, zones: { scareLine: 1.2 } });
  const t = new Tracker(s); const m = t.model;
  let now = 0;
  for (const f of [0.6, 0.75, 0.9]) t.update([personBox(m, 1.7, f)], now += 150);
  const at = foot => { const b = personBox(m, 1.7, foot); t.update([{ ...b, h: 1 - b.y }], now += 150); return t.tracks[0].level; };
  assert.equal(at(1.1), 2, 'feet at 110% < scare line 120% -> near');
  assert.equal(at(1.3), 3, 'feet at 130% >= scare line 120% -> scare');
});

test('TR-19 head and feet both cut off -> treated as very close (groundY >= 1.1)', () => {
  const s = makeSettings(); const t = new Tracker(s);
  t.update([{ x: 0.2, y: 0, w: 0.6, h: 1 }], 0);
  assert.ok(t.tracks[0].groundY >= 1.1);
  assert.equal(t.tracks[0].level, 3);
});

test('TR-20 level thresholds: 0 above approach, 1/2/3 at or below approach/near/scare lines', () => {
  const s = makeSettings(); const z = s.zones;
  const lvl = foot => { const t = new Tracker(s); t.update([{ x: 0.45, y: foot - 0.2, w: 0.1, h: 0.2 }], 0); return t.tracks[0].level; };
  assert.equal(lvl(z.approachLine - 0.01), 0);
  assert.equal(lvl(z.approachLine), 1);
  assert.equal(lvl(z.nearLine - 0.001), 1);
  assert.equal(lvl(z.nearLine), 2);
  assert.equal(lvl(z.scareLine - 0.001), 2);
  assert.equal(lvl(z.scareLine), 3);
});

test('TR-21 left/right limits: people whose centre is outside are ignored (level 0, inArea false)', () => {
  const s = makeSettings({ zones: { left: 0.3, right: 0.7 } });
  const at = cx => { const t = new Tracker(s); t.update([{ x: cx - 0.05, y: 0.5, w: 0.1, h: 0.3 }], 0); return t.tracks[0]; };
  assert.equal(at(0.2).inArea, false); assert.equal(at(0.2).level, 0);
  assert.equal(at(0.8).inArea, false); assert.equal(at(0.8).level, 0);
  assert.equal(at(0.5).inArea, true); assert.equal(at(0.5).level, 2);
  assert.equal(at(0.3).inArea, true, 'limits are inclusive');
});

test('TR-22 lines in the wrong order (near line above approach line) must not make the ignored street area active', () => {
  // user dragged the orange NEAR line above the yellow APPROACH line; feet above the approach line are "street"
  const s = makeSettings({ zones: { approachLine: 0.6, nearLine: 0.3 } });
  const t = new Tracker(s);
  t.update([{ x: 0.45, y: 0.25, w: 0.1, h: 0.25 }], 0); // feet at 0.50: above the approach line
  assert.equal(t.tracks[0].level, 0, `feet above the approach line got level ${t.tracks[0].level}`);
});

test('TR-23 left limit greater than right limit is handled (nobody can ever be detected otherwise)', () => {
  const s = makeSettings({ zones: { left: 0.8, right: 0.2 } });
  const t = new Tracker(s);
  t.update([{ x: 0.45, y: 0.5, w: 0.1, h: 0.3 }], 0);
  // Either the limits are normalised or ignored; silently ignoring everybody is a defect
  assert.equal(t.tracks[0].inArea, true, 'with swapped limits nobody is ever in the area');
});

// ---------------------------------------------------------------- tracking

test('TR-24 a person walking keeps the same track ID', () => {
  const s = makeSettings(); const t = new Tracker(s);
  let now = 0;
  for (let i = 0; i < 20; i++) t.update([{ x: 0.4 + i * 0.005, y: 0.3 + i * 0.01, w: 0.15, h: 0.3 + i * 0.01 }], now += 166);
  assert.equal(t.tracks.length, 1); assert.equal(t.tracks[0].id, 1); assert.equal(t.tracks[0].seenCount, 20);
});

test('TR-25 two people side by side keep separate, stable IDs even if the detector lists them in a different order', () => {
  const s = makeSettings(); const t = new Tracker(s);
  let now = 0;
  const A = i => ({ x: 0.15, y: 0.3 + i * 0.01, w: 0.15, h: 0.4 }), B = i => ({ x: 0.65, y: 0.35 + i * 0.01, w: 0.12, h: 0.3 });
  for (let i = 0; i < 10; i++) {
    const list = i % 2 ? [A(i), B(i)] : [B(i), A(i)];
    t.update(list, now += 166);
  }
  assert.equal(t.tracks.length, 2);
  const left = t.tracks.find(x => x.box.x < 0.5), right = t.tracks.find(x => x.box.x > 0.5);
  assert.notEqual(left.id, right.id);
  assert.equal(left.seenCount, 10); assert.equal(right.seenCount, 10);
});

test('TR-26 two people crossing paths: IDs follow the right person (no swap)', () => {
  const s = makeSettings(); const t = new Tracker(s);
  let now = 0;
  // A walks left->right (taller), B right->left (shorter), feet at different depths
  const A = i => ({ x: 0.1 + i * 0.04, y: 0.25, w: 0.12, h: 0.5 }), B = i => ({ x: 0.78 - i * 0.04, y: 0.45, w: 0.08, h: 0.3 });
  t.update([A(0), B(0)], now += 166);
  const idA = t.tracks.find(x => x.box.h === 0.5).id;
  for (let i = 1; i <= 17; i++) t.update([B(i), A(i)], now += 166);
  const trA = t.tracks.find(x => x.box.h === 0.5);
  assert.equal(trA.id, idA, 'tall person changed ID while crossing');
  assert.equal(t.tracks.length, 2, `tracks: ${t.tracks.map(x => x.id)}`);
});

test('TR-27 a big jump (different person somewhere else) creates a new track', () => {
  const s = makeSettings(); const t = new Tracker(s);
  t.update([{ x: 0.05, y: 0.5, w: 0.1, h: 0.3 }], 0);
  t.update([{ x: 0.8, y: 0.2, w: 0.1, h: 0.3 }], 166);
  assert.equal(t.tracks.length, 2);
});

test('TR-28 track expiry: kept through gaps < 2 s, fresh only < 1.1 s, removed after 2 s', () => {
  const s = makeSettings(); const t = new Tracker(s);
  t.update([{ x: 0.4, y: 0.5, w: 0.1, h: 0.3 }], 0);
  t.update([], 1000); assert.equal(t.tracks.length, 1); assert.equal(t.tracks[0].fresh, true);
  t.update([], 1150); assert.equal(t.tracks[0].fresh, false);
  t.update([], 1999); assert.equal(t.tracks.length, 1);
  t.update([], 2000); assert.equal(t.tracks.length, 0);
  t.update([{ x: 0.4, y: 0.5, w: 0.1, h: 0.3 }], 2500);
  assert.equal(t.tracks[0].id, 2, 'a person returning after expiry gets a new ID');
});

test('TR-29 confirmation needs confirmMs AND at least 2 detections', () => {
  const s = makeSettings({ timing: { confirmMs: 700 } }); const t = new Tracker(s);
  const b = { x: 0.4, y: 0.5, w: 0.1, h: 0.3 };
  t.update([b], 0); assert.equal(t.tracks[0].confirmed, false);
  t.update([b], 500); assert.equal(t.tracks[0].confirmed, false);
  t.update([b], 700); assert.equal(t.tracks[0].confirmed, true);
  const s0 = makeSettings({ timing: { confirmMs: 0 } }); const t0 = new Tracker(s0);
  t0.update([b], 0); assert.equal(t0.tracks[0].confirmed, false, 'a single detection never confirms');
  t0.update([b], 10); assert.equal(t0.tracks[0].confirmed, true);
});

test('TR-30 motion-only boxes (AI fallback) never get a height -> audience unknown', () => {
  const s = calibrated(); const t = new Tracker(s); const m = t.model;
  const b = { ...personBox(m, 1.8, 0.7), motionOnly: true };
  t.update([b], 0); t.update([b], 150);
  assert.equal(t.tracks[0].height, null); assert.equal(t.tracks[0].isKid, null);
  assert.ok(t.tracks[0].level >= 1);
});

test('TR-31 refreshModel picks up new calibration points', () => {
  const s = makeSettings(); const t = new Tracker(s);
  assert.match(t.model.source, /estimated/);
  s.calibration.points = [{ footY: 0.6, h: 0.3, H: 1.7 }, { footY: 0.9, h: 0.55, H: 1.7 }];
  t.refreshModel();
  assert.match(t.model.source, /2 points/);
});

test('TR-32 empty detection list with no tracks is a no-op', () => {
  const t = new Tracker(makeSettings());
  assert.deepEqual(t.update([], 0), []);
});
