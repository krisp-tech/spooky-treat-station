// Unit tests for web/js/director.js (the show's state machine), driven with a fake clock.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../../web/js/director.js';
import { Tracker } from '../../web/js/tracker.js';
import { makeSettings, installClock, track, run, personBox } from './helpers.mjs';

let clock;
beforeEach(() => { clock = installClock(); });

// arrivalMs (the short wait before an ADULT welcome, in case a child follows) is 0 here so each test
// checks its own behaviour; DI-38/DI-38b/DI-38c test the arrival wait itself.
function make(over = {}) {
  const s = makeSettings({ ...over, timing: { arrivalMs: 0, ...(over.timing || {}) } });
  const d = new Director(s);
  const log = [];
  d.onStage = (stage, aud, reason) => log.push({ stage, aud, reason, t: clock.t });
  return { s, d, log };
}
const adult = (level, o = {}) => track({ level, isKid: false, ...o });
const kid = (level, o = {}) => track({ level, isKid: true, id: 2, ...o });

// ---------------------------------------------------------------- basic flow

test('DI-01 starts idle (kids audience, armed, not holding)', () => {
  const { d } = make();
  assert.equal(d.stage, 'idle'); assert.equal(d.audience, 'kids'); assert.equal(d.armed, true); assert.equal(d.hold, false);
});

test('DI-02 idle stays idle with nobody / unconfirmed / stale / out-of-area / beyond-approach-line people', () => {
  const { d } = make();
  for (const t of [[], [adult(1, { confirmed: false })], [adult(1, { fresh: false })], [adult(0, { inArea: false })], [adult(0)]]) {
    run(d, clock, 2000, t);
    assert.equal(d.stage, 'idle', JSON.stringify(t));
  }
});

test('DI-03 idle -> approach when a confirmed visitor crosses the approach line', () => {
  const { d, log } = make();
  run(d, clock, 300, [adult(1)]);
  assert.equal(d.stage, 'approach');
  assert.equal(log[0].reason, 'visitor arrived');
  assert.equal(d.audience, 'adults', 'audience is decided on arrival');
});

test('DI-04 idle -> near directly when the first sighting is already at the treats', () => {
  const { d } = make();
  run(d, clock, 200, [adult(2)]);
  assert.equal(d.stage, 'near');
});

test('DI-05 approach -> near only after minStageMs', () => {
  const { d, s } = make({ timing: { minStageMs: 2500 } });
  run(d, clock, 200, [adult(1)]);
  run(d, clock, 1000, [adult(2)]);
  assert.equal(d.stage, 'approach', 'too early');
  run(d, clock, 1500, [adult(2)]);
  assert.equal(d.stage, 'near');
  assert.ok(s.timing.minStageMs === 2500);
});

test('DI-06 near -> scare after crossing the scare line, with scareDelayMs pause', () => {
  const { d, log } = make({ timing: { scareDelayMs: 500 } });
  run(d, clock, 200, [adult(2)]);
  run(d, clock, 100, [adult(3)]);
  assert.equal(d.stage, 'near', 'pending, not yet');
  run(d, clock, 300, [adult(3)]);
  assert.equal(d.stage, 'near');
  run(d, clock, 200, [adult(3)]);
  assert.equal(d.stage, 'scare');
  assert.equal(log.at(-1).reason, 'came very close');
  assert.equal(d.armed, false);
});

test('DI-07 scareDelayMs = 0 scares in the same update', () => {
  const { d } = make({ timing: { scareDelayMs: 0 } });
  run(d, clock, 200, [adult(2)]);
  run(d, clock, 100, [adult(3)]);
  assert.equal(d.stage, 'scare');
});

test('DI-08 approach -> scare is possible directly (very fast walker), skipping near', () => {
  const { d } = make({ timing: { scareDelayMs: 0 } });
  run(d, clock, 200, [adult(1)]);
  run(d, clock, 100, [adult(3)]);
  assert.equal(d.stage, 'scare');
});

test('DI-09 scare lasts scareMs, then goodbye', () => {
  const { d } = make({ timing: { scareDelayMs: 0, scareMs: 6500 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  const t0 = clock.t;
  run(d, clock, 6300, [adult(3)]);
  assert.equal(d.stage, 'scare');
  run(d, clock, 300, [adult(3)]);
  assert.equal(d.stage, 'goodbye');
  assert.ok(clock.t - t0 >= 6500);
});

test('DI-10 custom media sceneLength overrides scareMs, and is reset on the next stage', () => {
  const { d } = make({ timing: { scareDelayMs: 0, scareMs: 4000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  assert.equal(d.stage, 'scare');
  d.sceneLength = 9000;
  run(d, clock, 8800, [adult(3)]);
  assert.equal(d.stage, 'scare', 'custom video still playing');
  run(d, clock, 300, [adult(3)]);
  assert.equal(d.stage, 'goodbye');
  assert.equal(d.sceneLength, null);
});

test('DI-11 goodbye -> idle after goodbyeMs when nobody is left', () => {
  const { d } = make({ timing: { scareDelayMs: 0, scareMs: 3000, goodbyeMs: 5000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  run(d, clock, 3100, []);
  assert.equal(d.stage, 'goodbye');
  run(d, clock, 4800, []);
  assert.equal(d.stage, 'goodbye');
  run(d, clock, 300, []);
  assert.equal(d.stage, 'idle');
});

test('DI-12 goodbye -> near/approach when visitors are still there', () => {
  const { d, log } = make({ timing: { scareDelayMs: 0, scareMs: 3000, goodbyeMs: 2000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  run(d, clock, 3100, [adult(3)]);
  run(d, clock, 2100, [adult(2)]);
  assert.equal(d.stage, 'near'); assert.equal(log.at(-1).reason, 'still here');
  const b = make({ timing: { scareDelayMs: 0, scareMs: 3000, goodbyeMs: 2000 } });
  run(b.d, clock, 200, [adult(2)]); run(b.d, clock, 100, [adult(3)]);
  run(b.d, clock, 3100, [adult(1)]); run(b.d, clock, 2100, [adult(1)]);
  assert.equal(b.d.stage, 'approach');
});

test('DI-13 approach/near -> goodbye when empty for emptyMs (not before)', () => {
  const { d, log } = make({ timing: { emptyMs: 3500 } });
  run(d, clock, 200, [adult(2)]);
  run(d, clock, 3400, []);
  assert.equal(d.stage, 'near');
  run(d, clock, 300, []);
  assert.equal(d.stage, 'goodbye'); assert.equal(log.at(-1).reason, 'visitors left');
});

test('DI-14 short detection gaps (< emptyMs) do not end the visit', () => {
  const { d } = make({ timing: { emptyMs: 3500 } });
  run(d, clock, 200, [adult(1)]);
  for (let i = 0; i < 5; i++) { run(d, clock, 2000, []); run(d, clock, 300, [adult(1)]); }
  assert.equal(d.stage, 'approach');
});

test('DI-15 multiple visitors: the visit continues while anyone is left; level = closest person', () => {
  const { d } = make({ scare: { triggerOnClose: false } });
  run(d, clock, 200, [adult(1), adult(2, { id: 5 })]);
  assert.equal(d.stage, 'near'); assert.equal(d.info.level, 2); assert.equal(d.info.present, 2);
  run(d, clock, 6000, [adult(1)]);
  assert.equal(d.stage, 'near');
  assert.equal(d.info.present, 1);
});

test('DI-16 primary (eyes target) is the closest person', () => {
  const { d } = make({ scare: { triggerOnClose: false } });
  const far = adult(1, { id: 1, groundY: 0.5 }), nearP = adult(2, { id: 2, groundY: 0.8 });
  run(d, clock, 200, [far, nearP]);
  assert.equal(d.info.primary.id, 2);
});

// ---------------------------------------------------------------- triggers

test('DI-17 triggerOnClose = false: crossing the scare line does not scare', () => {
  const { d } = make({ scare: { triggerOnClose: false }, timing: { scareDelayMs: 0 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 3000, [adult(3)]);
  assert.equal(d.stage, 'near');
});

test('DI-18 grab (jar motion) scares; reason "grabbed a treat"', () => {
  const { d, log } = make({ timing: { scareDelayMs: 0 }, zones: { jar: { enabled: true } } });
  run(d, clock, 200, [adult(2)]);
  run(d, clock, 100, [adult(2)], { jarMotion: 0.5 });
  assert.equal(d.stage, 'scare'); assert.equal(log.at(-1).reason, 'grabbed a treat');
});

test('DI-19 jar motion below jarSensitivity does not count', () => {
  const { d } = make({ timing: { scareDelayMs: 0 }, zones: { jarSensitivity: 0.1 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 1000, [adult(2)], { jarMotion: 0.09 });
  assert.equal(d.stage, 'near');
});

test('DI-20 hand (pose) inside the jar box scares; outside does not', () => {
  const { d, s } = make({ timing: { scareDelayMs: 0 }, zones: { jar: { enabled: true } } });
  const j = s.zones.jar;
  run(d, clock, 200, [adult(2)]);
  run(d, clock, 500, [adult(2)], { hands: [{ x: j.x - 0.05, y: j.y + 0.01 }] });
  assert.equal(d.stage, 'near');
  run(d, clock, 100, [adult(2)], { hands: [{ x: j.x + j.w / 2, y: j.y + j.h / 2 }] });
  assert.equal(d.stage, 'scare');
});

test('DI-21 triggerOnGrab = false: jar motion and hands are ignored', () => {
  const { d, s } = make({ scare: { triggerOnGrab: false }, timing: { scareDelayMs: 0 } });
  const j = s.zones.jar;
  run(d, clock, 200, [adult(2)]); run(d, clock, 2000, [adult(2)], { jarMotion: 1, hands: [{ x: j.x + 0.01, y: j.y + 0.01 }] });
  assert.equal(d.stage, 'near'); assert.equal(d.info.grab, false);
});

test('DI-22 jar disabled: jar motion and hands are ignored', () => {
  const { d, s } = make({ zones: { jar: { enabled: false } }, timing: { scareDelayMs: 0 } });
  const j = s.zones.jar;
  run(d, clock, 200, [adult(2)]); run(d, clock, 2000, [adult(2)], { jarMotion: 1, hands: [{ x: j.x + 0.01, y: j.y + 0.01 }] });
  assert.equal(d.stage, 'near');
});

test('DI-23 jar motion with nobody around (e.g. wind, a cat) is not a grab', () => {
  const { d } = make();
  run(d, clock, 6000, [], { jarMotion: 1 });
  assert.equal(d.info.grab, false); assert.equal(d.stage, 'idle');
});

test('DI-24 kids scare disabled: kids never get scared (close or grab), visit ends with goodbye', () => {
  const { d } = make({ scare: { kidsEnabled: false }, timing: { scareDelayMs: 0 } });
  run(d, clock, 200, [kid(2)]);
  assert.equal(d.audience, 'kids');
  run(d, clock, 5000, [kid(3)], { jarMotion: 1 });
  assert.equal(d.stage, 'near');
  run(d, clock, 4000, []);
  assert.equal(d.stage, 'goodbye');
});

test('DI-25 kids scare disabled: adults are still scared', () => {
  const { d } = make({ scare: { kidsEnabled: false }, timing: { scareDelayMs: 0 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  assert.equal(d.stage, 'scare'); assert.equal(d.audience, 'adults');
});

test('DI-26 kids scare disabled: a kid joining during the scare delay must cancel the pending scare', () => {
  // adults at the treats; a kid walks up behind them. An adult crosses the scare line while the kid is
  // being confirmed; the audience switches to kids during the scare delay.
  const { d, log } = make({ scare: { kidsEnabled: false }, timing: { scareDelayMs: 1000 } });
  run(d, clock, 1500, [adult(2)]);
  run(d, clock, 900, [adult(2), kid(2)]);   // kid seen: audience candidate = kids (switches after 1.2 s)
  run(d, clock, 200, [adult(3), kid(2)]);   // adult crosses scare line -> scare pending (adults)
  run(d, clock, 1200, [adult(3), kid(2)]);  // audience switches to kids, then the delay expires
  const scare = log.find(l => l.stage === 'scare');
  assert.equal(scare, undefined, `scare played for audience "${scare?.aud}" although kids scare is disabled`);
});

// ---------------------------------------------------------------- arming

test('DI-27 no second scare while not armed (same group stays after goodbye)', () => {
  const { d, log } = make({ timing: { scareDelayMs: 0, scareMs: 3000, goodbyeMs: 2000, rearmMs: 25000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  run(d, clock, 5200, [adult(3)]);
  assert.equal(d.stage, 'near'); assert.equal(d.armed, false);
  run(d, clock, 10000, [adult(3)], { jarMotion: 1 });
  assert.equal(log.filter(l => l.stage === 'scare').length, 1);
});

test('DI-28 re-arm after the cool-down (rearmMs) even if the group is still there', () => {
  const { d, log } = make({ timing: { scareDelayMs: 0, scareMs: 3000, goodbyeMs: 2000, rearmMs: 12000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  run(d, clock, 12500, [adult(3)]);
  assert.equal(log.filter(l => l.stage === 'scare').length, 2);
});

test('DI-29 re-arm once the driveway was empty for 2.5 s; next group can be scared right away', () => {
  const { d, log } = make({ timing: { scareDelayMs: 0, scareMs: 3000, goodbyeMs: 2000, rearmMs: 120000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  run(d, clock, 3000, []);
  run(d, clock, 3000, []);
  assert.equal(d.armed, true);
  assert.equal(d.stage, 'idle');
  run(d, clock, 200, [adult(2, { id: 9 })]); run(d, clock, 100, [adult(3, { id: 9 })]);
  assert.equal(log.filter(l => l.stage === 'scare').length, 2);
});

// ---------------------------------------------------------------- audience

test('DI-30 audience mode kids/adults overrides the measured heights', () => {
  const a = make({ audience: { mode: 'adults' } });
  run(a.d, clock, 200, [kid(1)]); assert.equal(a.d.audience, 'adults');
  const k = make({ audience: { mode: 'kids' } });
  run(k.d, clock, 200, [adult(1)]); assert.equal(k.d.audience, 'kids');
});

test('DI-31 mixed group, rule "kids": any kid -> kids version', () => {
  const { d } = make({ audience: { mixed: 'kids' } });
  run(d, clock, 200, [adult(1), adult(1, { id: 3 }), kid(1)]);
  assert.equal(d.audience, 'kids');
});

test('DI-32 mixed group, rule "majority": 2 adults + 1 kid -> adults; tie -> kids', () => {
  const a = make({ audience: { mixed: 'majority' } });
  run(a.d, clock, 200, [adult(1), adult(1, { id: 3 }), kid(1)]); assert.equal(a.d.audience, 'adults');
  const b = make({ audience: { mixed: 'majority' } });
  run(b.d, clock, 200, [adult(1), kid(1)]); assert.equal(b.d.audience, 'kids');
});

test('DI-33 unknown heights -> audience.unsure (kids or adults)', () => {
  const k = make({ audience: { unsure: 'kids' } });
  run(k.d, clock, 200, [track({ level: 1, isKid: null })]); assert.equal(k.d.audience, 'kids');
  const a = make({ audience: { unsure: 'adults' } });
  run(a.d, clock, 200, [track({ level: 1, isKid: null })]); assert.equal(a.d.audience, 'adults');
});

test('DI-34 unknowns are ignored when at least one height is known', () => {
  const { d } = make({ audience: { unsure: 'kids' } });
  run(d, clock, 200, [adult(1), track({ id: 7, level: 1, isKid: null })]);
  assert.equal(d.audience, 'adults');
});

test('DI-35 switch to kids is immediate; switch back to adults needs 1.2 s of stability; both replay via onAudience', () => {
  const { d } = make({ scare: { triggerOnClose: false } });
  const switches = [];
  d.onAudience = a => switches.push(a);
  run(d, clock, 200, [adult(1)]);
  assert.equal(d.audience, 'adults');
  run(d, clock, 100, [kid(1, { id: 1 })]);
  assert.equal(d.audience, 'kids', 'kids version must start at once');
  run(d, clock, 1000, [adult(1)]);
  assert.equal(d.audience, 'kids', 'not stable long enough to go back to adults');
  run(d, clock, 400, [adult(1)]);
  assert.equal(d.audience, 'adults');
  assert.deepEqual(switches, ['kids', 'adults']);
});

test('DI-36 flickering kid/adult classification settles on kids (the safe side) and does not ping-pong', () => {
  const { d } = make({ scare: { triggerOnClose: false } });
  const switches = [];
  d.onAudience = a => switches.push(a);
  run(d, clock, 200, [adult(1)]);
  run(d, clock, 10000, t => [(Math.floor(t / 500) % 2) ? kid(1, { id: 1 }) : adult(1)]);
  assert.ok(switches.length <= 1, `switched ${switches.length} times: ${switches}`);
  assert.equal(d.audience, 'kids');
});

test('DI-37 audience does not switch during scare/goodbye', () => {
  const { d } = make({ timing: { scareDelayMs: 0, scareMs: 5000 } });
  run(d, clock, 200, [adult(2)]); run(d, clock, 100, [adult(3)]);
  assert.equal(d.stage, 'scare');
  run(d, clock, 3000, [kid(3, { id: 1 })]);
  assert.equal(d.audience, 'adults');
});

test('DI-38 mixed group (rule "kids"): adult detected a moment before the child must not get the adult welcome', () => {
  // kids are smaller, so the detector often finds them a few frames after the adult walking next to them
  const { d, log } = make({ audience: { mixed: 'kids' }, timing: { arrivalMs: 600 } });
  run(d, clock, 200, [adult(1)]);
  run(d, clock, 2000, [adult(1), kid(1)]);
  const advAdult = log.filter(l => l.stage !== 'idle' && l.aud === 'adults');
  assert.equal(advAdult.length, 0, `played for adults first: ${log.map(l => `${l.stage}(${l.aud})`).join(', ')}`);
});

test('DI-38b an adult alone gets the adult welcome after arrivalMs (not before)', () => {
  const { d, log } = make({ timing: { arrivalMs: 600 } });
  run(d, clock, 400, [adult(1)]);
  assert.equal(d.stage, 'idle', 'still checking for a child');
  run(d, clock, 400, [adult(1)]);
  assert.equal(d.stage, 'approach'); assert.equal(log.at(-1).aud, 'adults');
});

test('DI-38c a child arriving gets the kids welcome immediately (no arrival wait)', () => {
  const { d, log } = make({ timing: { arrivalMs: 600 } });
  run(d, clock, 100, [kid(1)]);
  assert.equal(d.stage, 'approach'); assert.equal(log.at(-1).aud, 'kids');
});

// ---------------------------------------------------------------- preview / hold

test('DI-39 force(approach/near) holds the scene: no automatic changes, no scare', () => {
  const { d } = make({ timing: { scareDelayMs: 0 } });
  d.force('near', 'adults');
  assert.equal(d.hold, true); assert.equal(d.stage, 'near'); assert.equal(d.audience, 'adults');
  run(d, clock, 10000, [kid(3)], { jarMotion: 1 });
  assert.equal(d.stage, 'near'); assert.equal(d.audience, 'adults');
  run(d, clock, 10000, []);
  assert.equal(d.stage, 'near', 'empty driveway must not end a preview');
});

test('DI-40 force(idle) holds idle even when visitors arrive (until resumeAuto)', () => {
  const { d } = make();
  d.force('idle', null);
  run(d, clock, 3000, [adult(2)]);
  assert.equal(d.stage, 'idle');
  d.resumeAuto();
  assert.equal(d.hold, false);
  run(d, clock, 200, [adult(2)]);
  assert.equal(d.stage, 'near');
});

test('DI-41 force(scare) plays the scare once, then continues automatically (goodbye -> idle)', () => {
  const { d } = make({ timing: { scareMs: 3000, goodbyeMs: 2000 } });
  d.force('scare', 'kids');
  assert.equal(d.hold, false); assert.equal(d.audience, 'kids');
  run(d, clock, 3100, []);
  assert.equal(d.stage, 'goodbye');
  run(d, clock, 2100, []);
  assert.equal(d.stage, 'idle');
});

test('DI-42 force with audience null keeps the current audience', () => {
  const { d } = make();
  d.force('approach', 'adults'); d.force('near', null);
  assert.equal(d.audience, 'adults');
});

test('DI-43 resumeAuto goes to idle and the show reacts again', () => {
  const { d, log } = make();
  d.force('approach', 'kids');
  d.resumeAuto();
  assert.equal(d.stage, 'idle'); assert.equal(log.at(-1).reason, 'resume');
});

test('DI-44 info is still updated while holding (setup status box)', () => {
  const { d } = make();
  d.force('near', 'kids');
  run(d, clock, 300, [adult(2), kid(1)]);
  assert.equal(d.info.present, 2); assert.equal(d.info.kids, 1); assert.equal(d.info.adults, 1);
});

// ---------------------------------------------------------------- timing extremes / clocks

test('DI-45 a forced scare with a custom scene length is not cut short by scareMs', () => {
  const { d } = make({ timing: { scareMs: 3000 } });
  d.force('scare', 'adults');
  d.sceneLength = 7000;
  run(d, clock, 6800, []);
  assert.equal(d.stage, 'scare');
});

test('DI-46 extreme timings (all zero) do not loop or throw', () => {
  const { d, log } = make({ timing: { confirmMs: 0, emptyMs: 0, minStageMs: 0, scareDelayMs: 0, scareMs: 0, goodbyeMs: 0, rearmMs: 0 } });
  run(d, clock, 2000, t => (t % 1000 < 500 ? [adult(3)] : []));
  assert.ok(log.length < 200, `${log.length} stage changes in 2 s`);
});

test('DI-47 [testability] update(now) and go() must use the same clock', () => {
  // director.js stamps stageStart with performance.now() inside go(), but compares it against the `now`
  // passed to update(). If a caller passes a different time base (e.g. a frame timestamp), stage timing breaks.
  const s = makeSettings({ timing: { scareDelayMs: 0, scareMs: 3000, arrivalMs: 0 } });
  const d = new Director(s);
  const offset = 60000; // caller's clock is 60 s ahead of performance.now()
  const upd = (tr) => d.update(tr, { jarMotion: 0, hands: [] }, clock.t + offset);
  upd([adult(2)]); clock.t += 100; upd([adult(3)]);
  assert.equal(d.stage, 'scare');
  clock.t += 100; upd([adult(3)]);
  assert.equal(d.stage, 'scare', 'scare ended immediately because go() and update() use different clocks');
});

test('DI-48 integration with Tracker: a calibrated child walking up gets the kids show', () => {
  const s = makeSettings({ timing: { scareDelayMs: 0 } });
  s.calibration.points = [0.55, 0.75, 0.92].map(f => ({ footY: f, h: 1.7 * (0.9 * f - 0.33), H: 1.7 }));
  const tr = new Tracker(s); const d = new Director(s); const log = [];
  d.onStage = (st, a) => log.push(`${st}(${a})`);
  for (let f = 0.35; f < 1.0; f += 0.01) {
    clock.t += 166;
    const tracks = tr.update([personBox(tr.model, 1.15, f)], clock.t);
    d.update(tracks, { jarMotion: 0, hands: [] }, clock.t);
  }
  assert.ok(log.includes('approach(kids)'), log.join(','));
  assert.ok(log.includes('scare(kids)'), log.join(','));
  assert.ok(!log.some(l => l.endsWith('(adults)')), log.join(','));
});
