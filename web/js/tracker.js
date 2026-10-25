// Tracks people between frames, estimates their real height (kid vs adult) and how close they are.
//
// Height idea: on flat ground, a person's height in the picture is proportional to their real height
// and depends (almost linearly) on where their feet are in the picture. Calibration measures that line:
//     pixelsPerMetre(footY) = a * footY + b
// so   realHeight = boxHeight / (a * footY + b)

export function heightModel(cal) {
  const pts = (Array.isArray(cal.points) ? cal.points : []).filter(p => p && p.H > 0 && p.h > 0 && Number.isFinite(p.footY));
  if (pts.length >= 2) {
    // least squares fit of r = h/H against footY
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { const r = p.h / p.H; sx += p.footY; sy += r; sxx += p.footY * p.footY; sxy += p.footY * r; }
    const n = pts.length, den = n * sxx - sx * sx;
    if (Math.abs(den) > 1e-6) {
      const a = (n * sxy - sx * sy) / den;
      const b = (sy - a * sx) / n;
      if (a > 0.05) return { a, b, source: `calibrated (${n} points)` };
    }
  }
  if (pts.length >= 1) {
    // one point: keep the horizon, solve the camera height
    const p = pts[pts.length - 1];
    const hc = (p.footY - cal.horizon) * p.H / p.h;
    if (hc > 0.1) return { a: 1 / hc, b: -cal.horizon / hc, source: 'calibrated (1 point)' };
  }
  const hc = Math.max(0.2, cal.cameraHeight);
  return { a: 1 / hc, b: -cal.horizon / hc, source: 'estimated (not calibrated)' };
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}

function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

export class Tracker {
  constructor(settings) {
    this.s = settings;
    this.tracks = [];
    this.nextId = 1;
    this.model = heightModel(settings.calibration);
  }

  refreshModel() { this.model = heightModel(this.s.calibration); }

  update(people, now) {
    const used = new Set();
    // greedy match by overlap, then by distance
    for (const t of this.tracks) {
      let best = -1, bestScore = 0;
      people.forEach((p, i) => {
        if (used.has(i)) return;
        let sc = iou(t.box, p);
        if (sc < 0.1) {
          const dx = (t.box.x + t.box.w / 2) - (p.x + p.w / 2), dy = (t.box.y + t.box.h) - (p.y + p.h);
          const d = Math.hypot(dx, dy);
          sc = d < 0.15 ? 0.1 - d * 0.5 : 0;
        }
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      if (best >= 0) {
        used.add(best);
        t.box = people[best];
        t.lastSeen = now;
        t.seenCount++;
        t.measuredAt = -1; // new detection: may be measured again
      }
    }
    people.forEach((p, i) => {
      if (used.has(i)) return;
      this.tracks.push({ id: this.nextId++, box: p, firstSeen: now, lastSeen: now, seenCount: 1, heights: [] });
    });
    // keep tracks through short gaps (slow PCs may only check 1-2 times per second)
    this.tracks = this.tracks.filter(t => now - t.lastSeen < 2000);

    for (const t of this.tracks) this._analyse(t, now);
    return this.tracks;
  }

  _analyse(t, now) {
    const b = t.box, z = this.s.zones, m = this.model;
    const top = b.y, bottom = b.y + b.h;
    t.feetVisible = bottom < 0.97;
    t.headVisible = top > 0.02;
    t.fresh = now - t.lastSeen < 1100;
    // measure height once per real detection (not again from a stale box)
    if (t.lastSeen === now && t.measuredAt !== now && t.feetVisible && t.headVisible && !b.motionOnly) {
      t.measuredAt = now;
      const ppm = m.a * bottom + m.b;
      if (ppm > 0.03) {
        const H = b.h / ppm;
        if (H > 0.5 && H < 2.4) { t.heights.push(H); if (t.heights.length > 25) t.heights.shift(); }
      }
    }
    t.height = median(t.heights);
    const assumeH = t.height || 1.55;
    if (t.feetVisible) {
      t.groundY = bottom;
    } else {
      // feet are below the picture: work out where they would be from the person's height
      const den = 1 - assumeH * m.a;
      t.groundY = den > 0.05 ? Math.max(bottom, (top + assumeH * m.b) / den) : 1.2;
      if (!t.headVisible) t.groundY = Math.max(t.groundY, 1.1);
    }
    const cx = b.x + b.w / 2;
    // tolerate lines/limits dragged into the wrong order: the approach line always stays the boundary
    // with the ignored street; near/scare lines can't be above it (or above each other)
    const approachLine = z.approachLine, nearLine = Math.max(z.nearLine, approachLine), scareLine = Math.max(z.scareLine, nearLine);
    t.inArea = cx >= Math.min(z.left, z.right) && cx <= Math.max(z.left, z.right);
    if (t.height == null) t.isKid = null;
    else t.isKid = t.height < this.s.audience.childMaxHeight;
    t.level = !t.inArea ? 0
      : t.groundY >= scareLine ? 3
      : t.groundY >= nearLine ? 2
      : t.groundY >= approachLine ? 1 : 0;
    t.confirmed = now - t.firstSeen >= this.s.timing.confirmMs && t.seenCount >= 2;
  }
}
