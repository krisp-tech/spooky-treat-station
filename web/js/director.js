// The "director" decides which stage of the show is playing:
//   idle (invite people) -> approach (welcome) -> near (take one treat!) -> scare -> goodbye -> idle

export class Director {
  constructor(settings) {
    this.s = settings;
    this.stage = 'idle';
    this.audience = 'kids';
    this.stageStart = performance.now();
    this.lastPresent = -1e9;
    this.emptySince = performance.now();
    this.armed = true;
    this.lastScareAt = -1e9;
    this.pendingScareAt = null;
    this._audCandidate = null;
    this._audSince = 0;
    this.hold = false;          // when true (preview from setup), automatic changes are paused
    this.onStage = null;        // (stage, audience, reason) => void
    this.onAudience = null;     // (audience) => void
    this.info = { present: 0, level: 0, grab: false, kids: 0, adults: 0, unknown: 0, primary: null };
    this.sceneLength = null;    // custom media can override the scare length
  }

  computeAudience(active) {
    const a = this.s.audience;
    if (a.mode === 'kids' || a.mode === 'adults') return a.mode;
    let kids = 0, adults = 0, unknown = 0;
    for (const t of active) { if (t.isKid === true) kids++; else if (t.isKid === false) adults++; else unknown++; }
    this.info.kids = kids; this.info.adults = adults; this.info.unknown = unknown;
    if (!kids && !adults) return active.length ? a.unsure : this.audience;
    if (a.mixed === 'kids') return kids ? 'kids' : 'adults';
    return kids >= adults ? 'kids' : 'adults';
  }

  scareAllowed(aud) { return aud === 'adults' || this.s.scare.kidsEnabled; }

  // `now` should be the same clock that update() receives (the app uses performance.now() everywhere)
  go(stage, reason = '', now = performance.now()) {
    this.stage = stage;
    this.stageStart = now;
    this.pendingScareAt = null;
    this.sceneLength = null;
    if (stage === 'scare') { this.armed = false; this.lastScareAt = this.stageStart; }
    if (this.onStage) this.onStage(stage, this.audience, reason);
  }

  // Preview a stage from the setup screen.
  force(stage, audience) {
    if (audience) this.audience = audience;
    this.hold = stage !== 'scare' && stage !== 'goodbye';
    this.go(stage, 'preview');
  }

  resumeAuto() { this.hold = false; this.go('idle', 'resume'); }
  update(tracks, det, now) {
    const s = this.s, T = s.timing, z = s.zones;
    const active = tracks.filter(t => t.confirmed && t.fresh && t.level >= 1);
    const present = active.length > 0;
    const level = active.reduce((m, t) => Math.max(m, t.level), 0);
    if (present) { this.lastPresent = now; this.emptySince = null; }
    else if (this.emptySince == null) this.emptySince = now;

    let handInJar = false;
    if (z.jar.enabled) {
      for (const h of det.hands || []) {
        if (h.x >= z.jar.x && h.x <= z.jar.x + z.jar.w && h.y >= z.jar.y && h.y <= z.jar.y + z.jar.h) handInJar = true;
      }
    }
    // only counts while someone is at the treats (otherwise legs walking through the box would count)
    const someoneNear = tracks.some(t => t.fresh && t.inArea && t.level >= 2);
    const grab = s.scare.triggerOnGrab && z.jar.enabled && someoneNear &&
      (det.jarMotion >= z.jarSensitivity || handInJar);

    // the closest person (for the characters' eyes to follow)
    let primary = null;
    for (const t of active) if (!primary || t.groundY > primary.groundY) primary = t;
    this.info = { ...this.info, present: active.length, level, grab, primary };
    if (this.hold) { this.computeAudience(active); return; } // previewing from setup: keep the chosen scene

    // audience (kids / adults), switches only after it has been stable for a moment
    const aud = this.computeAudience(active);
    if (aud !== this.audience) {
      if (this._audCandidate !== aud) { this._audCandidate = aud; this._audSince = now; }
      const stableFor = now - this._audSince;
      const canSwitch = this.stage === 'idle' || this.stage === 'approach' || this.stage === 'near';
      // switching to the gentler kids version happens at once (a child often gets detected a bit later
      // than the adult walking with them); switching to adults waits until it has been stable for a moment
      if (canSwitch && present && (aud === 'kids' || stableFor > 1200)) {
        this._audCandidate = null;
        this.audience = aud;
        if (this.stage !== 'idle' && this.onAudience) this.onAudience(aud);
      }
    } else this._audCandidate = null;

    // re-arm the scare once the scene was empty for a bit, or after the cool-down
    if (!this.armed && ((this.emptySince != null && now - this.emptySince > 2500) || now - this.lastScareAt > T.rearmMs)) {
      this.armed = true;
    }

    const inStage = now - this.stageStart;
    const gone = this.emptySince != null && now - this.emptySince > T.emptyMs;

    switch (this.stage) {
      case 'scare': {
        const len = this.sceneLength || T.scareMs;
        if (inStage >= len) this.go('goodbye', 'scare finished', now);
        break;
      }
      case 'goodbye':
        if (inStage >= T.goodbyeMs) {
          if (present) this.go(level >= 2 ? 'near' : 'approach', 'still here', now);
          else this.go('idle', 'goodbye finished', now);
        }
        break;
      case 'idle': {
        if (!present) { this._arriveAt = null; break; }
        if (this._arriveAt == null) this._arriveAt = now;
        // Kids usually get detected a moment after the adult walking with them (they're smaller), so when
        // only adults are seen, wait briefly before choosing the adult welcome. Kids start at once.
        const arriving = this.computeAudience(active);
        if (arriving === 'kids' || level >= 2 || now - this._arriveAt >= T.arrivalMs) {
          this._arriveAt = null;
          this.audience = arriving;
          this._audCandidate = null;
          this.go(level >= 2 ? 'near' : 'approach', 'visitor arrived', now);
        }
        break;
      }
      case 'approach':
      case 'near': {
        if (gone) { this.go('goodbye', 'visitors left', now); break; }
        const trigger = this.armed && this.scareAllowed(this.audience) &&
          ((s.scare.triggerOnClose && level >= 3) || grab);
        if (trigger && this.pendingScareAt == null) this.pendingScareAt = now;
        // the audience may have changed during the delay (e.g. a child turned up): check again before firing
        if (this.pendingScareAt != null && !this.scareAllowed(this.audience)) this.pendingScareAt = null;
        if (this.pendingScareAt != null) {
          if (now - this.pendingScareAt >= T.scareDelayMs) this.go('scare', grab ? 'grabbed a treat' : 'came very close', now);
          break;
        }
        if (this.stage === 'approach' && level >= 2 && inStage >= T.minStageMs) this.go('near', 'at the treats', now);
        break;
      }
    }
  }
}
