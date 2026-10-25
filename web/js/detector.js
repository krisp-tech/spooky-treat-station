// Camera + on-device person detection (MediaPipe, runs fully offline) + jar motion detection.
// The AI runs in a background worker (detect-worker.js); if workers fail it runs on the page instead.

const VISION_URL = '/vendor/mediapipe/vision_bundle.mjs';
const WASM_DIR = '/vendor/mediapipe/wasm';
const DETECTOR_MODEL = '/models/efficientdet_lite0.tflite';
const POSE_MODEL = '/models/pose_landmarker_lite.task';

export class Detector {
  constructor(settings) {
    this.s = settings;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.stream = null;
    this.worker = null;
    this.inline = null;      // { vision, fileset, detector, pose } when running on the page
    this.delegate = '';
    this.status = 'starting';
    this.error = '';
    this.mode = 'none';      // ai | motion | none
    this.lastResult = { people: [], hands: [], jarMotion: 0, motion: 0, time: 0 };
    this.fps = 0;
    this.inferMs = 0;
    this._running = false;
    this._timer = null;
    this._busy = false;
    this._busySince = 0;
    this._lastTs = 0;
    this._jarMax = 0;
    this._motionBox = null;
    this._motion = 0;
    this._motionCanvas = document.createElement('canvas');
    this._motionCanvas.width = 160; this._motionCanvas.height = 120;
    this._mctx = this._motionCanvas.getContext('2d', { willReadFrequently: true });
    this._prevGray = null;
    this._wantPose = false;
    this.onResult = null;
  }

  static async listCameras() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'videoinput');
    } catch (e) { return []; }
  }

  async startCamera() {
    this.stopCamera();
    const c = this.s.camera;
    const video = { width: { ideal: c.width }, height: { ideal: c.height }, frameRate: { ideal: 15, max: 30 } };
    if (c.deviceId) video.deviceId = { exact: c.deviceId };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      if (!c.deviceId) throw e;
      // Saved camera not found (unplugged / different USB port): fall back to any camera.
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: c.width }, height: { ideal: c.height } }, audio: false });
    }
    // notice when the camera is unplugged or taken away by another app
    for (const t of this.stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        console.warn('camera track ended');
        this.onCameraLost?.();
      });
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    if (!this.video.videoWidth) await new Promise(res => { this.video.onloadedmetadata = () => res(); });
    this._prevGray = null;
    return this.stream;
  }

  cameraOk() {
    return !!this.stream && this.stream.getVideoTracks().some(t => t.readyState === 'live');
  }

  stopCamera() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  async loadModels(onStatus = () => {}) {
    onStatus('Loading person detector...');
    try {
      await this._startWorker();
      this.mode = 'ai';
    } catch (e) {
      console.warn('Worker detection failed, trying on the page:', e);
      try {
        await this._startInline();
        this.mode = 'ai';
      } catch (e2) {
        console.error(e2);
        this.error = String(e2 && e2.message || e2);
        this.mode = this.s.detection.motionFallback ? 'motion' : 'none';
      }
    }
    this.status = this.mode === 'ai' ? 'ready' : 'fallback';
    return this.mode;
  }

  _startWorker() {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('js/detect-worker.js'); } catch (e) { return reject(e); }
      const timeout = setTimeout(() => { w.terminate(); reject(new Error('worker start timed out')); }, 45000);
      w.onerror = e => { clearTimeout(timeout); w.terminate(); reject(new Error(e.message || 'worker error')); };
      w.onmessage = ({ data: m }) => {
        if (m.type === 'ready') {
          clearTimeout(timeout);
          this.worker = w; this.delegate = m.delegate; this._gpuInUse = this.s.detection.useGpu;
          w.onmessage = ({ data }) => this._onWorkerMessage(data);
          w.onerror = e => { console.error('worker error', e); this._busy = false; };
          resolve();
        } else if (m.type === 'error') { clearTimeout(timeout); w.terminate(); reject(new Error(m.error)); }
      };
      w.postMessage({ type: 'init', useGpu: this.s.detection.useGpu, minScore: this.s.detection.minScore, pose: this.s.detection.handTracking });
    });
  }

  async _startInline() {
    const vision = await import(VISION_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_DIR);
    const make = async (Task, opts) => {
      if (this.s.detection.useGpu) {
        try { return await Task.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } }); } catch (e) { /* CPU below */ }
      }
      return Task.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } });
    };
    const detector = await make(vision.ObjectDetector, {
      baseOptions: { modelAssetPath: DETECTOR_MODEL }, runningMode: 'VIDEO',
      scoreThreshold: this.s.detection.minScore, maxResults: 10, categoryAllowlist: ['person'],
    });
    this.inline = { vision, fileset, detector, pose: null, make };
    this.delegate = 'page';
    if (this.s.detection.handTracking) await this._inlinePose();
  }

  async _inlinePose() {
    if (!this.inline || this.inline.pose) return;
    try {
      this.inline.pose = await this.inline.make(this.inline.vision.PoseLandmarker, {
        baseOptions: { modelAssetPath: POSE_MODEL }, runningMode: 'VIDEO', numPoses: 3,
        minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
      });
    } catch (e) { console.warn('Pose model failed', e); }
  }

  async applySettings() {
    const d = this.s.detection;
    if (this.worker && this._gpuInUse !== d.useGpu) { // GPU on/off: start a fresh worker with the new setting
      this.restarts = 0;
      return this._restartWorker();
    }
    if (this.worker) this.worker.postMessage({ type: 'options', minScore: d.minScore, pose: d.handTracking });
    if (this.inline) {
      try { await this.inline.detector.setOptions({ scoreThreshold: d.minScore }); } catch (e) { /* ignore */ }
      if (d.handTracking) await this._inlinePose();
    }
  }

  setWantPose(v) { this._wantPose = v; }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      const t0 = performance.now();
      try { this._tick(t0); } catch (e) { console.error(e); }
      const interval = 1000 / Math.max(1, this.s.detection.fps);
      this._timer = setTimeout(loop, Math.max(15, interval - (performance.now() - t0)));
    };
    loop();
  }

  stop() { this._running = false; clearTimeout(this._timer); }

  _tick(now) {
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) return;
    this._updateMotion(v);
    if (this._restarting) return; // switching/restarting the AI: report nothing rather than "nobody there"
    if (this.mode === 'ai' && this.worker) {
      if (this._busy && now - this._busySince < 6000) return;
      if (this._busy) { this._restartWorker(); return; } // no answer for 6 s: the worker hung or crashed
      this._busy = true; this._busySince = now;
      const wantPose = this.s.detection.handTracking && this._wantPose;
      createImageBitmap(v).then(bitmap => {
        this.worker.postMessage({ type: 'detect', bitmap, ts: performance.now(), wantPose }, [bitmap]);
      }).catch(e => { this._busy = false; console.warn(e); });
    } else if (this.mode === 'ai' && this.inline) {
      let ts = Math.max(this._lastTs + 1, Math.round(now)); this._lastTs = ts;
      const t0 = performance.now();
      const res = this.inline.detector.detectForVideo(v, ts);
      const W = v.videoWidth, H = v.videoHeight;
      const people = (res.detections || []).map(d => ({ x: d.boundingBox.originX / W, y: d.boundingBox.originY / H, w: d.boundingBox.width / W, h: d.boundingBox.height / H, score: d.categories?.[0]?.score ?? 0 }));
      let poses = [];
      if (this.inline.pose && this.s.detection.handTracking && this._wantPose) {
        const pr = this.inline.pose.detectForVideo(v, ts);
        poses = (pr.landmarks || []).map(lm => [15, 16, 19, 20].map(i => lm[i]).filter(Boolean).map(p => ({ x: p.x, y: p.y, v: p.visibility ?? 1 })));
      }
      this._emit(people, poses, performance.now() - t0);
    } else if (this.mode === 'motion') {
      const people = this._motionBox ? [{ ...this._motionBox, score: 0.5, motionOnly: true }] : [];
      this._emit(people, [], 0, true);
    } else {
      this._emit([], [], 0, true);
    }
  }

  async _restartWorker() {
    if (this._restarting) return;
    this._restarting = true;
    this.restarts = (this.restarts || 0) + 1;
    console.warn('restarting the detection worker, attempt', this.restarts);
    try { this.worker?.terminate(); } catch (e) { /* ignore */ }
    this.worker = null;
    this._busy = false;
    try {
      if (this.restarts > 3) throw new Error('detector keeps failing');
      await this._startWorker();
    } catch (e) {
      this.error = 'AI detection stopped (' + (e.message || e) + ')';
      this.mode = this.s.detection.motionFallback ? 'motion' : 'none';
    }
    this._restarting = false;
  }

  _onWorkerMessage(m) {
    if (m.type === 'result') { this._busy = false; this.restarts = 0; this._emit(m.people, m.poses, m.ms); }
    else if (m.type === 'detect-error') { this._busy = false; this.error = m.error; console.warn('detect error', m.error); }
  }

  // people come in camera coordinates; convert to "display" coordinates (mirrored if needed)
  _emit(rawPeople, poses, ms, already) {
    const mirror = this.s.camera.mirror;
    const people = [];
    for (const p of rawPeople) {
      const x = mirror && !already ? 1 - p.x - p.w : p.x;
      if (p.h < this.s.detection.minBoxHeight) continue;
      people.push({ ...p, x });
    }
    const hands = [];
    for (const lm of poses) for (const p of lm) if (p.v >= 0.3) hands.push({ x: mirror ? 1 - p.x : p.x, y: p.y });
    if (ms) this.inferMs = this.inferMs ? this.inferMs * 0.8 + ms * 0.2 : ms;
    const now = performance.now();
    const dt = now - (this.lastResult.time || now);
    if (dt > 0) this.fps = this.fps * 0.8 + (1000 / dt) * 0.2;
    this.lastResult = { people, hands, jarMotion: this._jarMax, motion: this._motion, time: now };
    this._jarMax = 0;
    if (this.onResult) this.onResult(this.lastResult);
  }

  // Frame differencing on a tiny copy of the camera image. Cheap, and works even if the AI model fails.
  _updateMotion(v) {
    const c = this._mctx, W = 160, H = 120, mirror = this.s.camera.mirror;
    c.save();
    if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
    c.drawImage(v, 0, 0, W, H);
    c.restore();
    const data = c.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    const prev = this._prevGray;
    this._prevGray = gray;
    if (!prev) return;

    const z = this.s.zones, jar = z.jar;
    const jx0 = Math.floor(jar.x * W), jy0 = Math.floor(jar.y * H);
    const jx1 = Math.ceil((jar.x + jar.w) * W), jy1 = Math.ceil((jar.y + jar.h) * H);
    const ax0 = Math.floor(z.left * W), ax1 = Math.ceil(z.right * W);
    let jarCount = 0, jarTotal = 0, count = 0, total = 0;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const changed = Math.abs(gray[i] - prev[i]) > 28;
        if (jar.enabled && x >= jx0 && x < jx1 && y >= jy0 && y < jy1) { jarTotal++; if (changed) jarCount++; }
        if (x >= ax0 && x < ax1) {
          total++;
          if (changed) {
            count++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
    }
    this._motion = total ? count / total : 0;
    this._jarMax = Math.max(this._jarMax, jarTotal ? jarCount / jarTotal : 0);
    this._motionBox = (this._motion > 0.01 && maxX > minX && maxY > minY)
      ? { x: minX / W, y: minY / H, w: (maxX - minX) / W, h: (maxY - minY) / H } : null;
  }
}
