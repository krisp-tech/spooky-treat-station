// Shared helpers for the Node unit tests (node --test test/unit/).
import { DEFAULTS, clone, deepMerge } from '../../web/js/settings.js';

// A fresh settings object (defaults + overrides), like loadSettings() would return.
export function makeSettings(over = {}) {
  return deepMerge(clone(DEFAULTS), clone(over));
}

// Controllable clock. director.js calls performance.now() inside go()/constructor while update() gets `now`
// as an argument, so tests must keep both on the same clock (see TEST_PLAN.md, testability notes).
export function installClock(start = 100000) {
  const clock = { t: start };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.t }, configurable: true, writable: true });
  return clock;
}

// A track as produced by Tracker._analyse, for driving the Director directly.
export function track(o = {}) {
  return {
    id: o.id ?? 1, confirmed: o.confirmed ?? true, fresh: o.fresh ?? true, inArea: o.inArea ?? true,
    level: o.level ?? 1, isKid: o.isKid === undefined ? false : o.isKid, groundY: o.groundY ?? (0.4 + (o.level ?? 1) * 0.2),
    box: o.box ?? { x: 0.4, y: 0.3, w: 0.2, h: 0.5 }, height: o.height ?? null,
  };
}

// Synthetic person box for a height model {a, b}: real height H metres, feet at footY.
export function personBox(model, H, footY, cx = 0.5) {
  const h = H * (model.a * footY + model.b);
  return { x: cx - h * 0.18, y: footY - h, w: h * 0.36, h, score: 0.9 };
}

// Drive a Director for `ms` milliseconds in `tick` steps with the given tracks/detection (functions allowed).
export function run(director, clock, ms, tracks = [], det = {}, tick = 100) {
  const end = clock.t + ms;
  const seen = [];
  while (clock.t < end) {
    clock.t += tick;
    const tr = typeof tracks === 'function' ? tracks(clock.t) : tracks;
    const d = typeof det === 'function' ? det(clock.t) : det;
    director.update(tr, { jarMotion: 0, hands: [], ...d }, clock.t);
    if (seen[seen.length - 1] !== director.stage) seen.push(director.stage);
  }
  return seen;
}
