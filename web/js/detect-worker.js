// Runs the AI models in a background thread so the animation never stutters, even on a slow computer.
// (Classic worker: MediaPipe needs importScripts, which module workers don't have.)

self.exports = {};
self.module = { exports: self.exports };
importScripts('/vendor/mediapipe/vision_bundle.cjs');
const vision = self.module.exports;

const WASM_DIR = '/vendor/mediapipe/wasm';
let fileset = null, detector = null, pose = null, useGpu = false;

async function create(Task, opts) {
  if (useGpu) {
    try { return { task: await Task.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } }), delegate: 'GPU' }; }
    catch (e) { /* fall back to CPU */ }
  }
  return { task: await Task.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } }), delegate: 'CPU' };
}

async function loadPose() {
  if (pose) return;
  try {
    pose = (await create(vision.PoseLandmarker, {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' }, runningMode: 'VIDEO', numPoses: 3,
      minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
    })).task;
  } catch (e) { pose = null; }
}

let lastTs = 0;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      useGpu = m.useGpu;
      fileset = await vision.FilesetResolver.forVisionTasks(WASM_DIR);
      const r = await create(vision.ObjectDetector, {
        baseOptions: { modelAssetPath: '/models/efficientdet_lite0.tflite' }, runningMode: 'VIDEO',
        scoreThreshold: m.minScore, maxResults: 10, categoryAllowlist: ['person'],
      });
      detector = r.task;
      if (m.pose) await loadPose();
      self.postMessage({ type: 'ready', delegate: r.delegate });
    } else if (m.type === 'options') {
      if (detector) await detector.setOptions({ scoreThreshold: m.minScore });
      if (m.pose) await loadPose();
    } else if (m.type === 'detect') {
      const bmp = m.bitmap, W = bmp.width, H = bmp.height;
      let ts = Math.max(lastTs + 1, Math.round(m.ts)); lastTs = ts;
      const t0 = performance.now();
      const res = detector.detectForVideo(bmp, ts);
      const people = (res.detections || []).map(d => ({
        x: d.boundingBox.originX / W, y: d.boundingBox.originY / H,
        w: d.boundingBox.width / W, h: d.boundingBox.height / H,
        score: d.categories?.[0]?.score ?? 0,
      }));
      let poses = [];
      if (m.wantPose && pose) {
        const pr = pose.detectForVideo(bmp, ts);
        poses = (pr.landmarks || []).map(lm => [15, 16, 19, 20].map(i => lm[i]).filter(Boolean).map(p => ({ x: p.x, y: p.y, v: p.visibility ?? 1 })));
      }
      bmp.close();
      self.postMessage({ type: 'result', people, poses, ms: performance.now() - t0 });
    }
  } catch (e) {
    try { m.bitmap?.close(); } catch (_) { /* ignore */ }
    self.postMessage({ type: m.type === 'init' ? 'error' : 'detect-error', error: String(e && e.message || e) });
  }
};
