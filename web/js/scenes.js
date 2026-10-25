// Built-in animated scenes, drawn live on a canvas (no video files needed).
// Virtual coordinate system: height is always 1080, width follows the screen's aspect ratio.

const TAU = Math.PI * 2;
const FUN_FONT = '"Luckiest Guy", "Comic Sans MS", Impact, sans-serif';
const SCARY_FONT = 'Creepster, "Chiller", Impact, serif';

function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
const easeInCubic = x => x * x * x;

function ellipse(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }

// ------------------------------------------------------------------ backgrounds

const PALETTES = {
  fun: {
    sky: [[0, '#0d0420'], [0.45, '#2a0f4a'], [0.75, '#61206f'], [1, '#d4521a']],
    moon: '#fff1bf', moonGlow: 'rgba(255,214,120,0.32)', far: '#2a1240', near: '#12071d', ground: '#0b0414',
    window: '#ffc43d', fog: 'rgba(200,170,255,', stars: 1,
  },
  dark: {
    sky: [[0, '#000000'], [0.5, '#06080b'], [0.8, '#130909'], [1, '#2b0707']],
    moon: '#d8d2c6', moonGlow: 'rgba(190,40,30,0.16)', far: '#0a0808', near: '#030303', ground: '#020202',
    window: '#8a1010', fog: 'rgba(170,150,150,', stars: 0.4,
  },
};

function drawTree(g, x, y, len, ang, w, depth, r) {
  if (depth === 0 || len < 4) return;
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
  g.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * len * 0.3, (y + y2) / 2 + (r() - 0.5) * len * 0.3, x2, y2); g.stroke();
  const n = depth > 4 ? 2 : 2 + (r() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) drawTree(g, x2, y2, len * (0.62 + r() * 0.2), ang + (r() - 0.5) * 1.3, w * 0.62, depth - 1, r);
}

function buildBackground(W, H, scale, pal) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * scale); c.height = Math.ceil(H * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const r = rng(1031);
  const horizon = H * 0.8;
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  pal.sky.forEach(([o, col]) => sky.addColorStop(o, col));
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 260; i++) {
    const a = (0.2 + r() * 0.8) * pal.stars;
    g.fillStyle = `rgba(255,255,240,${a})`;
    g.fillRect(r() * W, r() * horizon * 0.85, r() < 0.1 ? 3 : 1.6, r() < 0.1 ? 3 : 1.6);
  }
  // moon
  const mx = W * 0.8, my = H * 0.24, mr = H * 0.13;
  const glow = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
  glow.addColorStop(0, pal.moonGlow); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  const mg = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
  mg.addColorStop(0, '#ffffff'); mg.addColorStop(1, pal.moon);
  g.fillStyle = mg; ellipse(g, mx, my, mr, mr); g.fill();
  g.fillStyle = 'rgba(120,110,90,0.18)';
  [[-0.3, -0.2, 0.18], [0.25, 0.1, 0.24], [-0.1, 0.4, 0.12], [0.4, -0.35, 0.1]].forEach(([dx, dy, rr]) => { ellipse(g, mx + dx * mr, my + dy * mr, rr * mr, rr * mr); g.fill(); });
  // far hills
  g.fillStyle = pal.far; g.beginPath(); g.moveTo(0, horizon);
  for (let x = 0; x <= W; x += 40) g.lineTo(x, horizon - 60 - Math.sin(x * 0.004) * 50 - Math.sin(x * 0.011 + 2) * 25);
  g.lineTo(W, H); g.lineTo(0, H); g.fill();
  // haunted house
  g.fillStyle = pal.near;
  const hx = W * 0.07, hy = horizon - 30;
  g.beginPath();
  g.moveTo(hx, hy); g.lineTo(hx, hy - 210); g.lineTo(hx + 30, hy - 210); g.lineTo(hx + 120, hy - 330); g.lineTo(hx + 210, hy - 210);
  g.lineTo(hx + 250, hy - 210); g.lineTo(hx + 250, hy - 300); g.lineTo(hx + 290, hy - 420); g.lineTo(hx + 330, hy - 300); g.lineTo(hx + 330, hy - 160);
  g.lineTo(hx + 380, hy - 160); g.lineTo(hx + 380, hy); g.closePath(); g.fill();
  g.fillStyle = pal.window;
  [[hx + 60, hy - 170, 34, 46], [hx + 150, hy - 170, 34, 46], [hx + 105, hy - 260, 26, 32], [hx + 275, hy - 270, 28, 40], [hx + 340, hy - 120, 24, 30]].forEach(([x, y, w, h]) => {
    g.globalAlpha = 0.75 + r() * 0.25; g.fillRect(x, y, w, h); g.globalAlpha = 1;
    g.fillStyle = pal.near; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h / 2 - 2, w, 4); g.fillStyle = pal.window;
  });
  // ground
  g.fillStyle = pal.ground; g.beginPath(); g.moveTo(0, horizon + 10);
  for (let x = 0; x <= W; x += 30) g.lineTo(x, horizon + 10 - Math.sin(x * 0.006 + 1) * 18);
  g.lineTo(W, H); g.lineTo(0, H); g.fill();
  // trees
  g.strokeStyle = pal.near; g.lineCap = 'round';
  drawTree(g, W * 0.93, horizon + 20, 150, -Math.PI / 2 - 0.08, 26, 7, r);
  drawTree(g, W * 0.3, horizon + 15, 95, -Math.PI / 2 + 0.1, 16, 6, r);
  // tombstones + fence
  g.fillStyle = pal.near;
  for (let i = 0; i < 9; i++) {
    const tx = W * (0.36 + i * 0.07) + (r() - 0.5) * 40, ty = horizon + 25 + r() * 30, tw = 44 + r() * 30, th = 60 + r() * 50;
    g.save(); g.translate(tx, ty); g.rotate((r() - 0.5) * 0.25);
    if (r() < 0.3) { g.fillRect(-6, -th - 20, 12, th + 20); g.fillRect(-26, -th, 52, 12); }
    else { g.beginPath(); g.moveTo(-tw / 2, 0); g.lineTo(-tw / 2, -th + tw / 2); g.arc(0, -th + tw / 2, tw / 2, Math.PI, 0); g.lineTo(tw / 2, 0); g.fill(); }
    g.restore();
  }
  for (let x = W * 0.48; x < W * 0.86; x += 26) {
    g.beginPath(); g.moveTo(x, horizon + 70); g.lineTo(x, horizon - 10); g.lineTo(x + 6, horizon - 22); g.lineTo(x + 12, horizon - 10); g.lineTo(x + 12, horizon + 70); g.fill();
  }
  g.fillRect(W * 0.48, horizon + 5, W * 0.38, 8); g.fillRect(W * 0.48, horizon + 40, W * 0.38, 8);
  return c;
}

function buildGrain() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.random() < 0.5 ? 40 : 0;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function buildFog() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'), r = rng(77);
  for (let i = 0; i < 70; i++) {
    const x = r() * 1024, y = 90 + r() * 140, rad = 50 + r() * 110;
    for (const dx of [0, -1024, 1024]) { // wrap around so the strip tiles seamlessly
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.13)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    }
  }
  return c;
}

// ------------------------------------------------------------------ characters

export function drawPumpkin(g, cx, cy, r, o = {}) {
  const t = o.time || 0, talk = o.talk || 0, look = clamp(o.look || 0, -1, 1);
  const flick = 0.78 + 0.22 * Math.sin(t * 13) * Math.sin(t * 7.3 + 1);
  const glow = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.9);
  glow.addColorStop(0, `rgba(255,140,0,${0.33 * flick})`); glow.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = glow; g.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
  g.fillStyle = 'rgba(0,0,0,0.45)'; ellipse(g, cx, cy + r * 0.9, r * 1.1, r * 0.16); g.fill();
  // stem
  g.save(); g.translate(cx + look * r * 0.05, cy - r * 0.78); g.rotate(-0.15 + look * 0.06);
  g.fillStyle = '#4a6a1f'; g.beginPath();
  g.moveTo(-r * 0.09, 0); g.quadraticCurveTo(-r * 0.12, -r * 0.3, r * 0.02, -r * 0.38); g.lineTo(r * 0.15, -r * 0.33);
  g.quadraticCurveTo(r * 0.03, -r * 0.24, r * 0.1, 0); g.closePath(); g.fill(); g.restore();
  // lobes
  const lobes = [[-0.5, 0.52, 0.86], [0.5, 0.52, 0.86], [-0.25, 0.55, 0.93], [0.25, 0.55, 0.93], [0, 0.5, 0.95]];
  for (const [ox, wf, hf] of lobes) {
    const lx = cx + ox * r + look * r * 0.03 * (1 - Math.abs(ox));
    const gr = g.createRadialGradient(lx - r * 0.12, cy - r * 0.3, r * 0.05, lx, cy, r * hf);
    gr.addColorStop(0, '#ffb347'); gr.addColorStop(0.55, '#f07c12'); gr.addColorStop(1, '#a34200');
    g.fillStyle = gr; ellipse(g, lx, cy, r * wf, r * hf); g.fill();
    g.strokeStyle = 'rgba(110,40,0,0.55)'; g.lineWidth = r * 0.02; g.stroke();
  }
  // carved face (shifts towards the visitor)
  const fx = cx + look * r * 0.13, fy = cy - r * 0.05;
  const hole = g.createRadialGradient(fx, fy, r * 0.05, fx, fy, r * 0.8);
  hole.addColorStop(0, `rgba(255,250,190,${flick})`); hole.addColorStop(0.6, '#ffb000'); hole.addColorStop(1, '#ff6a00');
  g.fillStyle = hole; g.strokeStyle = '#6b2700'; g.lineWidth = r * 0.025; g.lineJoin = 'round';
  const scary = o.scary;
  for (const side of [-1, 1]) {
    g.beginPath();
    if (scary) {
      g.moveTo(fx + side * r * 0.12, fy - r * 0.08); g.lineTo(fx + side * r * 0.5, fy - r * 0.28); g.lineTo(fx + side * r * 0.36, fy + r * 0.02);
    } else {
      const blink = o.blink ? 0.25 : 1;
      g.moveTo(fx + side * r * 0.15, fy - r * 0.02); g.lineTo(fx + side * r * 0.5, fy - r * 0.02);
      g.lineTo(fx + side * r * 0.33, fy - r * 0.02 - r * 0.34 * blink);
    }
    g.closePath(); g.fill(); g.stroke();
  }
  // nose
  g.beginPath(); g.moveTo(fx - r * 0.07, fy + r * 0.14); g.lineTo(fx + r * 0.07, fy + r * 0.14); g.lineTo(fx, fy + r * 0.03); g.closePath(); g.fill(); g.stroke();
  // mouth
  const open = talk * r * 0.22;
  g.beginPath();
  if (scary) {
    const n = 7, x0 = fx - r * 0.55, x1 = fx + r * 0.55;
    g.moveTo(x0, fy + r * 0.22);
    for (let i = 1; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; g.lineTo(x - (x1 - x0) / n / 2, fy + r * (i % 2 ? 0.34 : 0.26)); g.lineTo(x, fy + r * 0.22 + Math.sin(i / n * Math.PI) * r * 0.08); }
    for (let i = n; i >= 0; i--) { const x = x0 + (x1 - x0) * i / n; g.lineTo(x, fy + r * 0.36 + Math.sin(i / n * Math.PI) * (r * 0.2 + open) - (i % 2 ? r * 0.08 : 0)); }
  } else {
    g.moveTo(fx - r * 0.56, fy + r * 0.2);
    g.quadraticCurveTo(fx, fy + r * 0.42, fx + r * 0.56, fy + r * 0.2);
    g.quadraticCurveTo(fx + r * 0.3, fy + r * 0.62 + open, fx, fy + r * 0.62 + open);
    g.quadraticCurveTo(fx - r * 0.3, fy + r * 0.62 + open, fx - r * 0.56, fy + r * 0.2);
  }
  g.closePath(); g.fill(); g.stroke();
  if (!scary) { // two cute teeth
    g.fillStyle = '#f07c12';
    g.fillRect(fx - r * 0.2, fy + r * 0.29, r * 0.1, r * 0.09);
    g.fillRect(fx + r * 0.1, fy + r * 0.29, r * 0.1, r * 0.09);
  }
  if (o.hat) drawWitchHat(g, cx, cy - r * 0.78, r);
}

function drawWitchHat(g, cx, cy, r) {
  g.fillStyle = '#1d0b2e';
  ellipse(g, cx, cy + r * 0.02, r * 0.75, r * 0.13, -0.08); g.fill();
  g.beginPath(); g.moveTo(cx - r * 0.4, cy); g.quadraticCurveTo(cx - r * 0.1, cy - r * 0.6, cx + r * 0.25, cy - r * 0.95);
  g.quadraticCurveTo(cx + r * 0.1, cy - r * 0.5, cx + r * 0.38, cy - r * 0.02); g.closePath(); g.fill();
  g.fillStyle = '#7b2fbe'; g.fillRect(cx - r * 0.38, cy - r * 0.16, r * 0.76, r * 0.1);
}

export function drawGhost(g, cx, cy, s, o = {}) {
  const t = o.time || 0, talk = o.talk || 0, look = clamp(o.look || 0, -1, 1), alpha = o.alpha ?? 1;
  g.save(); g.globalAlpha *= alpha;
  const glow = g.createRadialGradient(cx, cy, s * 0.2, cx, cy, s * 1.2);
  glow.addColorStop(0, 'rgba(190,210,255,0.35)'); glow.addColorStop(1, 'rgba(190,210,255,0)');
  g.fillStyle = glow; g.fillRect(cx - s * 1.3, cy - s * 1.3, s * 2.6, s * 2.6);
  // arms
  g.fillStyle = '#eef2ff';
  const wave = o.wave ? Math.sin(t * 9) * 0.5 : 0;
  g.save(); g.translate(cx + s * 0.5, cy + s * 0.05); g.rotate(-0.6 + wave); ellipse(g, s * 0.12, 0, s * 0.2, s * 0.09); g.fill(); g.restore();
  g.save(); g.translate(cx - s * 0.5, cy + s * 0.05); g.rotate(0.6 + (o.boo ? -1.2 : 0)); ellipse(g, -s * 0.12, 0, s * 0.2, s * 0.09); g.fill(); g.restore();
  // body
  const body = g.createLinearGradient(cx, cy - s * 0.8, cx, cy + s * 0.7);
  body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#c9d3ff');
  g.fillStyle = body;
  g.beginPath(); g.arc(cx, cy - s * 0.2, s * 0.55, Math.PI, 0); g.lineTo(cx + s * 0.55, cy + s * 0.5);
  const n = 5, w = s * 1.1;
  for (let i = 0; i < n; i++) {
    const x0 = cx + s * 0.55 - (w / n) * i, x1 = x0 - w / n;
    g.quadraticCurveTo((x0 + x1) / 2, cy + s * (0.7 + Math.sin(t * 5 + i * 1.7) * 0.06), x1, cy + s * 0.5);
  }
  g.closePath(); g.fill();
  // face
  const fx = cx + look * s * 0.1, ey = cy - s * 0.22;
  const blink = (Math.sin(t * 1.3) > 0.985) ? 0.15 : 1;
  const er = o.boo ? 1.35 : 1;
  g.fillStyle = '#1a1030';
  for (const side of [-1, 1]) { ellipse(g, fx + side * s * 0.18, ey, s * 0.085 * er, s * 0.125 * er * blink); g.fill(); }
  g.fillStyle = '#fff';
  for (const side of [-1, 1]) { ellipse(g, fx + side * s * 0.18 + s * 0.025, ey - s * 0.05, s * 0.028, s * 0.035 * blink); g.fill(); }
  g.fillStyle = 'rgba(255,120,170,0.45)';
  for (const side of [-1, 1]) { ellipse(g, fx + side * s * 0.3, ey + s * 0.14, s * 0.07, s * 0.04); g.fill(); }
  g.fillStyle = '#1a1030';
  if (o.boo) { ellipse(g, fx, cy + s * 0.12, s * 0.14, s * 0.2); g.fill(); }
  else if (talk > 0.05) { ellipse(g, fx, cy + s * 0.05, s * 0.07, s * (0.03 + talk * 0.09)); g.fill(); }
  else { g.lineWidth = s * 0.03; g.strokeStyle = '#1a1030'; g.beginPath(); g.arc(fx, cy + s * 0.0, s * 0.08, 0.2, Math.PI - 0.2); g.stroke(); }
  g.restore();
}

export function drawSkull(g, cx, cy, s, o = {}) {
  const t = o.time || 0, talk = o.talk || 0, look = clamp(o.look || 0, -1, 1), alpha = o.alpha ?? 1, eyeGlow = o.eyeGlow ?? 1;
  g.save(); g.globalAlpha *= alpha;
  const glow = g.createRadialGradient(cx, cy, s * 0.3, cx, cy, s * 1.4);
  glow.addColorStop(0, `rgba(160,0,0,${0.35 * eyeGlow})`); glow.addColorStop(1, 'rgba(120,0,0,0)');
  g.fillStyle = glow; g.fillRect(cx - s * 1.5, cy - s * 1.5, s * 3, s * 3);
  const bone = g.createRadialGradient(cx - s * 0.15, cy - s * 0.35, s * 0.05, cx, cy, s * 0.8);
  bone.addColorStop(0, '#f4ecd6'); bone.addColorStop(0.7, '#c9bc9a'); bone.addColorStop(1, '#7d7258');
  const open = talk * s * 0.17;
  // mouth darkness
  g.fillStyle = '#050000'; g.fillRect(cx - s * 0.24, cy + s * 0.3, s * 0.48, s * 0.1 + open);
  // jaw
  g.fillStyle = bone;
  g.beginPath();
  g.moveTo(cx - s * 0.3, cy + s * 0.36 + open);
  g.quadraticCurveTo(cx - s * 0.3, cy + s * 0.62 + open, cx, cy + s * 0.64 + open);
  g.quadraticCurveTo(cx + s * 0.3, cy + s * 0.62 + open, cx + s * 0.3, cy + s * 0.36 + open);
  g.closePath(); g.fill();
  g.fillStyle = '#efe6cc'; g.strokeStyle = '#4b412d'; g.lineWidth = s * 0.008;
  for (let i = 0; i < 6; i++) { const x = cx - s * 0.21 + i * s * 0.07; g.beginPath(); g.roundRect(x, cy + s * 0.34 + open, s * 0.06, s * 0.08, s * 0.015); g.fill(); g.stroke(); }
  // cranium
  g.fillStyle = bone;
  g.beginPath();
  g.arc(cx, cy - s * 0.12, s * 0.5, Math.PI * 0.82, Math.PI * 0.18);
  g.quadraticCurveTo(cx + s * 0.36, cy + s * 0.2, cx + s * 0.28, cy + s * 0.34);
  g.lineTo(cx - s * 0.28, cy + s * 0.34);
  g.quadraticCurveTo(cx - s * 0.36, cy + s * 0.2, cx - s * 0.47, cy + s * 0.11);
  g.closePath(); g.fill();
  // upper teeth
  g.fillStyle = '#efe6cc';
  for (let i = 0; i < 6; i++) { const x = cx - s * 0.21 + i * s * 0.07; g.beginPath(); g.roundRect(x, cy + s * 0.26, s * 0.06, s * 0.09, s * 0.015); g.fill(); g.stroke(); }
  // eye sockets
  for (const side of [-1, 1]) {
    const ex = cx + side * s * 0.2, ey = cy - s * 0.06;
    const sock = g.createRadialGradient(ex, ey, s * 0.02, ex, ey, s * 0.16);
    sock.addColorStop(0, '#000'); sock.addColorStop(0.8, '#120404'); sock.addColorStop(1, '#3d2a1a');
    g.fillStyle = sock; ellipse(g, ex, ey, s * 0.145, s * 0.125, side * 0.15); g.fill();
    const px = ex + look * s * 0.06, py = ey + s * 0.01;
    const flick = 0.85 + Math.sin(t * 17 + side) * 0.15;
    const pg = g.createRadialGradient(px, py, 0, px, py, s * 0.09);
    pg.addColorStop(0, `rgba(255,230,180,${eyeGlow * flick})`); pg.addColorStop(0.25, `rgba(255,30,0,${eyeGlow * flick})`); pg.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = pg; g.fillRect(px - s * 0.1, py - s * 0.1, s * 0.2, s * 0.2);
  }
  // nose
  g.fillStyle = '#0a0302';
  g.beginPath(); g.moveTo(cx, cy + s * 0.06); g.lineTo(cx - s * 0.06, cy + s * 0.19); g.quadraticCurveTo(cx, cy + s * 0.22, cx + s * 0.06, cy + s * 0.19); g.closePath(); g.fill();
  // cracks
  g.strokeStyle = 'rgba(60,40,20,0.7)'; g.lineWidth = s * 0.01;
  g.beginPath(); g.moveTo(cx + s * 0.1, cy - s * 0.6); g.lineTo(cx + s * 0.16, cy - s * 0.48); g.lineTo(cx + s * 0.12, cy - s * 0.4); g.lineTo(cx + s * 0.2, cy - s * 0.3); g.stroke();
  g.restore();
}

function makeDemon() {
  const W = 600, H = 760;
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const g = base.getContext('2d');
  const r = rng(666);
  // gaunt head: wide skull, hollow cheeks, long jaw
  const head = new Path2D();
  head.moveTo(300, 20);
  head.bezierCurveTo(470, 20, 545, 150, 530, 300);
  head.bezierCurveTo(520, 390, 470, 430, 455, 500);
  head.bezierCurveTo(440, 610, 390, 740, 300, 750);
  head.bezierCurveTo(210, 740, 160, 610, 145, 500);
  head.bezierCurveTo(130, 430, 80, 390, 70, 300);
  head.bezierCurveTo(55, 150, 130, 20, 300, 20);
  const skin = g.createRadialGradient(300, 260, 30, 300, 380, 400);
  skin.addColorStop(0, '#a9a091'); skin.addColorStop(0.45, '#6d655a'); skin.addColorStop(0.8, '#2b2520'); skin.addColorStop(1, '#0d0a08');
  g.fillStyle = skin; g.fill(head);
  g.save(); g.clip(head);
  // blotchy, uneven skin
  for (let i = 0; i < 160; i++) {
    const x = r() * 600, y = r() * 760, rad = 8 + r() * 40, dark = r() < 0.6;
    const bl = g.createRadialGradient(x, y, 0, x, y, rad);
    bl.addColorStop(0, dark ? 'rgba(20,10,8,0.22)' : 'rgba(200,190,170,0.12)'); bl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bl; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // sunken cheeks + temples
  for (const [x, y, rad] of [[165, 500, 110], [435, 500, 110], [95, 270, 70], [505, 270, 70]]) {
    const sh = g.createRadialGradient(x, y, 5, x, y, rad); sh.addColorStop(0, 'rgba(10,5,5,0.75)'); sh.addColorStop(1, 'rgba(10,5,5,0)');
    g.fillStyle = sh; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // veins + cracks
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let x = r() * 600, y = r() * 300 + 40;
    g.strokeStyle = r() < 0.5 ? 'rgba(90,10,10,0.55)' : 'rgba(20,10,10,0.6)'; g.lineWidth = 1.5 + r() * 2.5;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 50; y += r() * 35; g.lineTo(x, y); }
    g.stroke();
  }
  g.restore();
  // deep hollow eye sockets
  for (const s of [-1, 1]) {
    const ex = 300 + s * 105, ey = 285;
    const eg = g.createRadialGradient(ex, ey, 4, ex, ey, 110);
    eg.addColorStop(0, '#000'); eg.addColorStop(0.55, '#000'); eg.addColorStop(0.8, 'rgba(15,5,5,0.7)'); eg.addColorStop(1, 'rgba(20,10,10,0)');
    g.fillStyle = eg; ellipse(g, ex, ey, 105, 80, s * 0.32); g.fill();
    // black streaks running down
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    for (let k = 0; k < 3; k++) {
      g.lineWidth = 6 + r() * 8;
      const sx = ex + (k - 1) * 22;
      g.beginPath(); g.moveTo(sx, ey + 45); g.bezierCurveTo(sx + (r() - 0.5) * 30, ey + 120, sx + (r() - 0.5) * 30, ey + 180, sx + (r() - 0.5) * 20, ey + 200 + r() * 120); g.stroke();
    }
    // tiny glowing pinpoint pupils
    const px = ex + s * 6, py = ey + 6;
    const pg = g.createRadialGradient(px, py, 0, px, py, 26);
    pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.2, '#fff2c0'); pg.addColorStop(0.5, 'rgba(255,90,0,0.5)'); pg.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = pg; g.fillRect(px - 26, py - 26, 52, 52);
  }
  // nose cavity
  g.fillStyle = '#050202';
  g.beginPath(); g.moveTo(300, 360); g.quadraticCurveTo(270, 420, 278, 440); g.quadraticCurveTo(300, 430, 322, 440); g.quadraticCurveTo(330, 420, 300, 360); g.fill();
  // long screaming mouth
  const mouth = new Path2D();
  mouth.moveTo(300, 480);
  mouth.bezierCurveTo(390, 480, 405, 560, 395, 640);
  mouth.bezierCurveTo(385, 715, 345, 735, 300, 735);
  mouth.bezierCurveTo(255, 735, 215, 715, 205, 640);
  mouth.bezierCurveTo(195, 560, 210, 480, 300, 480);
  const mg = g.createRadialGradient(300, 640, 10, 300, 610, 140);
  mg.addColorStop(0, '#000'); mg.addColorStop(0.7, '#0a0000'); mg.addColorStop(1, '#3a0505');
  g.fillStyle = mg; g.fill(mouth);
  g.strokeStyle = 'rgba(60,0,0,0.9)'; g.lineWidth = 8; g.stroke(mouth);
  // irregular yellowed teeth around the rim
  g.save(); g.clip(mouth);
  for (let i = 0; i < 11; i++) {
    const x = 215 + i * 17 + (r() - 0.5) * 6, w = 12 + r() * 6, len = 22 + r() * 38;
    const tg = g.createLinearGradient(0, 480, 0, 480 + len);
    tg.addColorStop(0, '#c9b98a'); tg.addColorStop(1, '#6e5f3a');
    g.fillStyle = tg;
    g.beginPath(); g.moveTo(x - w / 2, 470); g.lineTo(x + w / 2, 470); g.lineTo(x + w * 0.15, 488 + len); g.lineTo(x - w * 0.1, 490 + len); g.closePath(); g.fill();
  }
  for (let i = 0; i < 9; i++) {
    const x = 232 + i * 17 + (r() - 0.5) * 6, w = 11 + r() * 5, len = 18 + r() * 26;
    g.fillStyle = '#8a7a52';
    g.beginPath(); g.moveTo(x - w / 2, 745); g.lineTo(x + w / 2, 745); g.lineTo(x + w * 0.1, 725 - len); g.closePath(); g.fill();
  }
  g.restore();
  const tint = col => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cg = c.getContext('2d'); cg.drawImage(base, 0, 0); cg.globalCompositeOperation = 'source-in'; cg.fillStyle = col; cg.fillRect(0, 0, W, H);
    return c;
  };
  return { base, red: tint('#ff0000'), cyan: tint('#00ffff'), W, H };
}

function drawBat(g, x, y, s, t, alpha = 1) {
  const flap = Math.sin(t * 18) * 0.6;
  g.save(); g.translate(x, y); g.globalAlpha *= alpha; g.fillStyle = '#05010a';
  ellipse(g, 0, 0, s * 0.18, s * 0.26); g.fill();
  for (const side of [-1, 1]) {
    g.beginPath(); g.moveTo(side * s * 0.1, -s * 0.05);
    g.quadraticCurveTo(side * s * 0.5, -s * (0.45 + flap * 0.5), side * s * 1.0, -s * (0.1 + flap * 0.6));
    g.quadraticCurveTo(side * s * 0.75, s * 0.05, side * s * 0.62, s * 0.18 - flap * s * 0.2);
    g.quadraticCurveTo(side * s * 0.45, s * 0.05, side * s * 0.32, s * 0.2);
    g.quadraticCurveTo(side * s * 0.2, s * 0.05, side * s * 0.1, s * 0.12);
    g.closePath(); g.fill();
    g.beginPath(); g.moveTo(side * s * 0.05, -s * 0.2); g.lineTo(side * s * 0.14, -s * 0.38); g.lineTo(side * s * 0.15, -s * 0.15); g.fill();
  }
  g.restore();
}

function drawSpider(g, x, topY, y, s, t, look) {
  g.strokeStyle = 'rgba(230,230,255,0.7)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, topY); g.lineTo(x, y - s * 0.3); g.stroke();
  g.strokeStyle = '#120818'; g.lineWidth = s * 0.07; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    const wig = Math.sin(t * 8 + i + side) * 0.15;
    const a = -0.7 + i * 0.45 + wig;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + side * s * 0.6, y + Math.sin(a) * s * 0.5 - s * 0.35, x + side * s * 0.95, y + Math.sin(a) * s * 0.7 + s * 0.2); g.stroke();
  }
  g.fillStyle = '#1b0d24'; ellipse(g, x, y, s * 0.42, s * 0.38); g.fill();
  g.fillStyle = '#fff';
  for (const side of [-1, 1]) { ellipse(g, x + side * s * 0.15, y - s * 0.05, s * 0.13, s * 0.15); g.fill(); }
  g.fillStyle = '#000';
  for (const side of [-1, 1]) { ellipse(g, x + side * s * 0.15 + look * s * 0.05, y - s * 0.02, s * 0.06, s * 0.08); g.fill(); }
  g.strokeStyle = '#ff9ad5'; g.lineWidth = s * 0.03; g.beginPath(); g.arc(x, y + s * 0.13, s * 0.08, 0.3, Math.PI - 0.3); g.stroke();
}

function drawWitch(g, x, y, s) {
  g.save(); g.translate(x, y); g.fillStyle = '#000';
  g.fillRect(-s * 0.9, -s * 0.02, s * 1.8, s * 0.06);
  g.beginPath(); g.moveTo(-s * 0.9, 0); g.lineTo(-s * 1.2, -s * 0.12); g.lineTo(-s * 1.25, s * 0.15); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-s * 0.2, 0); g.quadraticCurveTo(-s * 0.4, -s * 0.5, s * 0.05, -s * 0.55); g.lineTo(s * 0.2, 0); g.fill();
  ellipse(g, s * 0.05, -s * 0.62, s * 0.12, s * 0.12); g.fill();
  g.beginPath(); g.moveTo(-s * 0.15, -s * 0.68); g.lineTo(s * 0.25, -s * 0.68); g.lineTo(s * 0.0, -s * 1.1); g.closePath(); g.fill();
  g.restore();
}

function drawCandle(g, x, y, s, t) {
  g.fillStyle = '#e8e0c8'; g.fillRect(x - s * 0.12, y, s * 0.24, s * 0.9);
  g.fillStyle = 'rgba(200,0,0,0.8)'; g.fillRect(x - s * 0.12, y, s * 0.24, s * 0.05);
  const fl = Math.sin(t * 20) * 0.1 + Math.sin(t * 7) * 0.1;
  const gl = g.createRadialGradient(x, y - s * 0.2, 0, x, y - s * 0.2, s * 1.4);
  gl.addColorStop(0, 'rgba(255,170,60,0.4)'); gl.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = gl; g.fillRect(x - s * 1.4, y - s * 1.6, s * 2.8, s * 2.8);
  g.fillStyle = '#ffd36b'; g.beginPath(); g.moveTo(x - s * 0.07, y - s * 0.02);
  g.quadraticCurveTo(x - s * 0.08, y - s * 0.2, x + fl * s, y - s * 0.38); g.quadraticCurveTo(x + s * 0.08, y - s * 0.2, x + s * 0.07, y - s * 0.02); g.fill();
}

// ------------------------------------------------------------------ text

// Text is rendered once into small canvases and reused: drawing glowing text every frame is slow on weak PCs.
const textCache = new Map();
const measureCtx = document.createElement('canvas').getContext('2d');
document.fonts?.addEventListener?.('loadingdone', () => textCache.clear());
function cached(key, w, h, paint) {
  let c = textCache.get(key);
  if (!c) {
    if (textCache.size > 300) textCache.clear();
    c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
    paint(c.getContext('2d'));
    textCache.set(key, c);
  }
  return c;
}

function drawTitle(g, text, x, y, size, style, t = 0, o = {}) {
  g.save();
  // cache at the real pixel size so it stays sharp
  const px = Math.max(8, Math.round(size * g.getTransform().d));
  const k = size / px;
  if (style === 'fun') {
    measureCtx.font = `${px}px ${FUN_FONT}`;
    const chars = [...text];
    const widths = chars.map(c => measureCtx.measureText(c).width);
    let cx = x - widths.reduce((a, b) => a + b, 0) * k / 2;
    chars.forEach((ch, i) => {
      const w = widths[i], pad = px * 0.2;
      const img = cached(`f|${ch}|${px}|${o.c1}|${o.c2}`, w + pad * 2, px * 1.5, cg => {
        cg.font = `${px}px ${FUN_FONT}`; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.lineJoin = 'round';
        const mx = w / 2 + pad, my = px * 0.72;
        cg.lineWidth = px * 0.16; cg.strokeStyle = '#2a0b45'; cg.strokeText(ch, mx, my + px * 0.05);
        const gr = cg.createLinearGradient(0, my - px / 2, 0, my + px / 2);
        gr.addColorStop(0, o.c1 || '#ffe066'); gr.addColorStop(1, o.c2 || '#ff7b00');
        cg.fillStyle = gr; cg.fillText(ch, mx, my);
      });
      const bob = o.still ? 0 : Math.sin(t * 5 + i * 0.6) * size * 0.06;
      g.drawImage(img, cx - pad * k, y + bob - px * 0.72 * k, img.width * k, img.height * k);
      cx += w * k;
    });
  } else {
    measureCtx.font = `${px}px ${SCARY_FONT}`;
    const tw = measureCtx.measureText(text).width, pad = px * 0.4;
    const color = o.color || '#c80000';
    const img = cached(`s|${text}|${px}|${color}|${o.glow}`, tw + pad * 2, px * 1.8, cg => {
      cg.font = `${px}px ${SCARY_FONT}`; cg.textAlign = 'center'; cg.textBaseline = 'middle';
      cg.shadowColor = o.glow || 'rgba(255,0,0,0.8)'; cg.shadowBlur = px * 0.25;
      cg.fillStyle = color; cg.fillText(text, tw / 2 + pad, px * 0.9);
    });
    const jitter = o.jitter ? (Math.random() - 0.5) * size * 0.03 : 0;
    g.drawImage(img, x - (tw / 2 + pad) * k + jitter, y - px * 0.9 * k, img.width * k, img.height * k);
    if (o.drip !== false) {
      // dripping blood under the letters
      const w = tw * k, r = rng(text.length * 13 + 7);
      for (let i = 0; i < Math.max(4, text.length / 1.5); i++) {
        const dx = x - w / 2 + r() * w, len = (0.15 + r() * 0.5) * size * clamp(t * 0.5 + r() * 0.2, 0, 1);
        g.fillStyle = o.color || '#c80000';
        g.fillRect(dx - size * 0.018, y + size * 0.25, size * 0.036, len);
        ellipse(g, dx, y + size * 0.25 + len, size * 0.032, size * 0.04); g.fill();
      }
    }
  }
  g.restore();
}

function drawArrows(g, W, H, t, color = '#ffcc33', label = 'TAKE ONE!', style = 'fun') {
  const y0 = H * 0.86;
  for (let i = 0; i < 3; i++) {
    const bob = (t * 2 + i * 0.33) % 1;
    g.save(); g.globalAlpha = 1 - bob;
    g.strokeStyle = color; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const x of [W * 0.2, W * 0.8]) {
      g.beginPath(); g.moveTo(x - 40, y0 - 30 + bob * 70); g.lineTo(x, y0 + 10 + bob * 70); g.lineTo(x + 40, y0 - 30 + bob * 70); g.stroke();
    }
    g.restore();
  }
  if (label) drawTitle(g, label, W / 2, H * 0.92, 70, style, t, style === 'fun' ? { still: true } : { drip: false, color });
}

// ------------------------------------------------------------------ particles

class Particles {
  constructor() { this.list = []; }
  candy(x, y, n, speed = 900, up = true) {
    const cols = ['#ff4d6d', '#ffd23f', '#3bceac', '#7b2fbe', '#ff8c42', '#4cc9f0', '#f72585'];
    for (let i = 0; i < n; i++) {
      const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 2.4 : Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.list.push({ kind: pick(['wrap', 'wrap', 'corn', 'lolly']), x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rand(TAU), vr: rand(-8, 8), s: rand(26, 48), c: pick(cols), life: rand(3, 5), age: 0 });
    }
  }
  rain(W, n) { for (let i = 0; i < n; i++) this.candy(rand(W), -60 - rand(400), 1, 60, false); }
  sparkle(x, y, n, r = 200) {
    for (let i = 0; i < n; i++) this.list.push({ kind: 'spark', x: x + rand(-r, r), y: y + rand(-r, r), vx: rand(-40, 40), vy: rand(-60, 10), rot: 0, vr: 0, s: rand(6, 16), c: pick(['#fff6a8', '#ffffff', '#ffd1f2']), life: rand(0.6, 1.4), age: 0 });
  }
  update(dt, H) {
    for (const p of this.list) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.kind !== 'spark') { p.vy += 900 * dt; p.vx *= 0.995; if (p.y > H + 80) p.age = p.life; }
    }
    this.list = this.list.filter(p => p.age < p.life);
  }
  draw(g) {
    for (const p of this.list) {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      const fade = clamp((p.life - p.age) / 0.5, 0, 1); g.globalAlpha = fade;
      const s = p.s;
      if (p.kind === 'wrap') {
        g.fillStyle = p.c;
        g.beginPath(); g.moveTo(-s * 0.35, 0); g.lineTo(-s * 0.7, -s * 0.28); g.lineTo(-s * 0.7, s * 0.28); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(s * 0.35, 0); g.lineTo(s * 0.7, -s * 0.28); g.lineTo(s * 0.7, s * 0.28); g.closePath(); g.fill();
        ellipse(g, 0, 0, s * 0.42, s * 0.3); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)'; ellipse(g, -s * 0.1, -s * 0.1, s * 0.15, s * 0.07); g.fill();
      } else if (p.kind === 'corn') {
        g.fillStyle = '#fff4d6'; g.beginPath(); g.moveTo(0, -s * 0.5); g.lineTo(-s * 0.32, s * 0.4); g.lineTo(s * 0.32, s * 0.4); g.closePath(); g.fill();
        g.fillStyle = '#ffb000'; g.beginPath(); g.moveTo(-s * 0.21, s * 0.1); g.lineTo(s * 0.21, s * 0.1); g.lineTo(s * 0.32, s * 0.4); g.lineTo(-s * 0.32, s * 0.4); g.fill();
        g.fillStyle = '#ff6a00'; g.fillRect(-s * 0.32, s * 0.28, s * 0.64, s * 0.12);
      } else if (p.kind === 'lolly') {
        g.fillStyle = '#eee'; g.fillRect(-s * 0.04, 0, s * 0.08, s * 0.8);
        g.fillStyle = p.c; ellipse(g, 0, 0, s * 0.36, s * 0.36); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = s * 0.07; g.beginPath(); g.arc(0, 0, s * 0.2, 0, Math.PI * 1.5); g.stroke();
      } else {
        g.fillStyle = p.c; g.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? s * 0.25 : s; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.fill();
      }
      g.restore();
    }
  }
}

// ------------------------------------------------------------------ renderer + scenes

export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.s = settings;
    this.H = 1080; this.W = 1920;
    this.scale = 1;
    this.bg = {};
    this.fog = buildFog();
    this.demon = makeDemon();
    this.grain = buildGrain();
    this.scene = null;
    this.fade = 0;
    this.particles = new Particles();
    this.bats = Array.from({ length: 7 }, (_, i) => ({ x: rand(), y: rand(0.08, 0.45), sp: rand(0.03, 0.08) * (i % 2 ? 1 : -1), ph: rand(TAU), s: rand(30, 60) }));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    // quality = drawing resolution (height in pixels); the browser scales it up to fill the screen
    const qh = { low: 540, medium: 720, high: 1080 }[this.s.display.quality] || 720;
    const aspect = Math.max(0.5, window.innerWidth / Math.max(1, window.innerHeight));
    this.W = Math.round(1080 * aspect);
    this.canvas.height = qh;
    this.canvas.width = Math.round(qh * aspect);
    this.scale = qh / this.H;
    this.bg = {};
  }

  background(name) {
    if (!this.bg[name]) this.bg[name] = buildBackground(this.W, this.H, this.scale, PALETTES[name]);
    return this.bg[name];
  }

  play(scene) {
    this.scene = scene;
    this.fade = scene.cut ? 0 : 1;
    this.particles = new Particles();
  }

  frame(dt, env) {
    const g = this.g;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    env.W = this.W; env.H = this.H; env.r = this;
    if (this.scene) {
      this.scene.step(dt, env);
      this.scene.draw(g, env);
    } else { g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H); }
    this.particles.update(dt, this.H);
    this.particles.draw(g);
    if (this.fade > 0) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = `rgba(0,0,0,${this.fade})`; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.fade = Math.max(0, this.fade - dt * 3);
    }
  }

  // shared drawing helpers for scenes
  drawSky(g, name, t) {
    g.drawImage(this.background(name), 0, 0, this.W, this.H);
    const W = this.W, H = this.H;
    // drifting clouds over the moon
    g.fillStyle = name === 'dark' ? 'rgba(20,10,10,0.5)' : 'rgba(40,20,60,0.45)';
    for (let i = 0; i < 3; i++) {
      const x = ((t * (12 + i * 6) + i * 700) % (W + 800)) - 400, y = H * (0.18 + i * 0.07);
      ellipse(g, x, y, 260, 34); g.fill(); ellipse(g, x + 120, y - 18, 160, 30); g.fill();
    }
  }
  drawFog(g, t, alpha = 0.7, y = 0.66, tint = 'rgba(255,255,255,') {
    const W = this.W, H = this.H, fw = W * 1.2, fh = H * 0.42;
    g.save(); g.globalAlpha = alpha;
    for (let layer = 0; layer < 2; layer++) {
      const off = ((t * (25 + layer * 30)) % fw);
      for (let x = -off - (layer ? fw * 0.4 : 0); x < W; x += fw) g.drawImage(this.fog, x, H * (y + layer * 0.06), fw, fh);
    }
    g.restore();
  }
  drawBats(g, t, alpha = 1) {
    for (const b of this.bats) {
      const x = ((b.x + t * b.sp) % 1 + 1) % 1 * (this.W + 200) - 100;
      const y = (b.y + Math.sin(t * 1.5 + b.ph) * 0.03) * this.H;
      drawBat(g, x, y, b.s, t + b.ph, alpha);
    }
  }
}

class Scene {
  constructor(opts = {}) { this.t = 0; this.events = []; this.opts = opts; this.cut = false; }
  at(time, fn) { this.events.push({ time, fn, done: false }); }
  step(dt, env) {
    this.t += dt;
    for (const e of this.events) if (!e.done && this.t >= e.time) { e.done = true; e.fn(env); }
    this.update?.(dt, env);
  }
}

// ---------- IDLE: invite people in

class IdleScene extends Scene {
  constructor(o) {
    super(o); this.music = 'fun'; this.voice = 'jack'; this.talkKey = 'idle';
    this.titles = ['TRICK OR TREAT!', 'FREE CANDY!', 'COME ON UP!', 'HAPPY HALLOWEEN!'];
    this.witchAt = rand(6, 14);
  }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'fun', t);
    if (t > this.witchAt) {
      const p = (t - this.witchAt) / 7;
      if (p > 1) this.witchAt = t + rand(15, 25);
      else drawWitch(g, W * (1.1 - p * 1.3), H * (0.3 - Math.sin(p * Math.PI) * 0.1), 70);
    }
    r.drawBats(g, t);
    r.drawFog(g, t, 0.55);
    drawPumpkin(g, W * 0.13, H * 0.9, 70, { time: t + 3 });
    drawPumpkin(g, W * 0.87, H * 0.9, 60, { time: t + 5, scary: true });
    drawPumpkin(g, W / 2, H * 0.6 + Math.sin(t * 2) * 8, H * 0.24, { time: t, talk: env.talk, look: env.look, hat: true, blink: Math.sin(t * 0.9) > 0.99 });
    const title = this.titles[Math.floor(t / 5) % this.titles.length];
    drawTitle(g, title, W / 2, H * 0.15, 140, 'fun', t);
    drawArrows(g, W, H, t, '#ffcc33', 'TREATS HERE!');
  }
}

// ---------- APPROACH

class ApproachKids extends Scene {
  constructor(o) { super(o); this.music = 'fun'; this.voice = 'ghost'; this.talkKey = 'approach-kids'; this.firstTalk = 0.6; this.titles = ['HELLO THERE!', 'COME CLOSER!', 'NICE COSTUME!']; }
  update(dt, env) { if (Math.random() < dt * 3) env.r.particles.sparkle(env.W * 0.68, env.H * 0.45, 2, 260); }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'fun', t); r.drawBats(g, t); r.drawFog(g, t, 0.5);
    drawPumpkin(g, W * 0.3, H * 0.72, H * 0.17, { time: t, look: env.look, hat: true });
    const enter = easeOutBack(clamp(t / 1.2, 0, 1));
    drawGhost(g, W * (1.2 - enter * 0.5), H * 0.45 + Math.sin(t * 2.2) * 25, H * 0.32, { time: t, talk: env.talk, look: env.look, wave: true });
    drawTitle(g, this.titles[Math.floor(t / 4) % this.titles.length], W / 2, H * 0.13, 130, 'fun', t);
  }
}

class ApproachAdults extends Scene {
  constructor(o) {
    super(o); this.music = 'creepy'; this.voice = 'skull'; this.talkKey = 'approach-adults'; this.firstTalk = 0.9;
    this.eyes = Array.from({ length: 10 }, () => ({ x: rand(0.05, 0.95), y: rand(0.2, 0.75), s: rand(14, 34), c: pick(['255,30,0', '255,200,0', '120,255,60']), ph: rand(TAU), on: rand(0.5, 4) }));
    this.nextBolt = rand(2, 5); this.bolt = null; this.nextBeat = 1;
  }
  update(dt, env) {
    if (this.t > this.nextBeat) { env.audio.heartbeat(undefined, 0.45); this.nextBeat = this.t + 1.15; }
    if (this.t > this.nextBolt) {
      this.nextBolt = this.t + rand(6, 11);
      const pts = []; let x = rand(env.W * 0.2, env.W * 0.8), y = 0;
      while (y < env.H * 0.7) { pts.push([x, y]); x += rand(-70, 70); y += rand(40, 90); }
      this.bolt = { pts, until: this.t + 0.25 };
      env.audio.thunder(env.audio.now() + 0.15, 0.7);
    }
  }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'dark', t);
    if (this.bolt && t < this.bolt.until) {
      g.fillStyle = `rgba(200,210,255,${0.35 * Math.random()})`; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#e8ecff'; g.lineWidth = 5; g.shadowColor = '#99a'; g.shadowBlur = 20;
      g.beginPath(); this.bolt.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); g.shadowBlur = 0;
    }
    for (const e of this.eyes) {
      if (t < e.on) continue;
      const blink = Math.sin(t * 0.7 + e.ph) > 0.93 ? 0.1 : 1;
      const fade = clamp((t - e.on) * 2, 0, 1);
      for (const side of [-1, 1]) {
        const x = e.x * W + side * e.s * 1.4 + env.look * 10, y = e.y * H;
        const gr = g.createRadialGradient(x, y, 0, x, y, e.s * 1.6);
        gr.addColorStop(0, `rgba(${e.c},${0.9 * fade})`); gr.addColorStop(1, `rgba(${e.c},0)`);
        g.fillStyle = gr; ellipse(g, x, y, e.s * 1.6, e.s * 1.6 * blink); g.fill();
        g.fillStyle = `rgba(255,255,220,${fade})`; ellipse(g, x, y, e.s * 0.5, e.s * 0.32 * blink, side * 0.3); g.fill();
      }
    }
    drawSkull(g, W / 2, H * 0.5, H * 0.3, { time: t, talk: env.talk, look: env.look, alpha: clamp(t / 2, 0, 1) * (0.45 + 0.15 * Math.sin(t * 2)) });
    r.drawFog(g, t, 0.85, 0.6);
    drawTitle(g, 'COME... CLOSER...', W / 2, H * 0.14, 130, 'scary', t);
  }
}

// ---------- NEAR: take one treat!

class NearKids extends Scene {
  constructor(o) { super(o); this.music = 'fun'; this.voice = 'jack'; this.talkKey = 'near-kids'; this.firstTalk = 0.3; this.spiderY = 0; }
  update(dt, env) { if (Math.random() < dt * 1.2) env.r.particles.candy(rand(env.W), -40, 1, 50, false); }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'fun', t); r.drawBats(g, t, 0.6); r.drawFog(g, t, 0.45);
    const peek = clamp((t - 1) / 0.8, 0, 1);
    drawGhost(g, W * 0.06 + peek * W * 0.08, H * 0.55 + Math.sin(t * 3) * 15, H * 0.22, { time: t, look: 1 });
    const sy = H * (0.15 + easeOutCubic(clamp((t - 0.5) / 2, 0, 1)) * 0.25) + Math.sin(t * 2) * 20;
    drawSpider(g, W * 0.86, 0, sy, 70, t, env.look);
    drawPumpkin(g, W / 2, H * 0.58, H * 0.25, { time: t, talk: env.talk, look: env.look, hat: true });
    drawTitle(g, 'TAKE ONE!', W / 2, H * 0.13, 150, 'fun', t, { c1: '#b8ff6b', c2: '#18a058' });
    drawArrows(g, W, H, t, '#b8ff6b', 'ONE PER TRICK-OR-TREATER');
  }
}

class NearAdults extends Scene {
  constructor(o) { super(o); this.music = 'creepy'; this.voice = 'skull'; this.talkKey = 'near-adults'; this.firstTalk = 0.3; this.nextBeat = 0.5; }
  update(dt, env) { if (this.t > this.nextBeat) { env.audio.heartbeat(undefined, 0.6); this.nextBeat = this.t + 0.85; } }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'dark', t);
    g.fillStyle = 'rgba(80,0,0,0.25)'; g.fillRect(0, 0, W, H);
    drawCandle(g, W * 0.15, H * 0.62, 90, t); drawCandle(g, W * 0.85, H * 0.6, 100, t + 1);
    const lean = clamp(t / 3, 0, 1);
    drawSkull(g, W / 2, H * 0.5, H * (0.36 + lean * 0.04), { time: t, talk: env.talk, look: env.look, eyeGlow: 0.8 + 0.2 * Math.sin(t * 3) });
    r.drawFog(g, t, 0.75, 0.68);
    drawTitle(g, 'ONE PER HEAD', W / 2, H * 0.13, 140, 'scary', t);
    drawArrows(g, W, H, t, '#b00000', 'TAKE ONE... IF YOU DARE', 'scary');
  }
}

// ---------- SCARE

class ScareKids extends Scene {
  constructor(o) {
    super(o); this.music = null; this.voice = 'ghost'; this.cut = true;
    this.at(0, env => env.audio.whoosh(undefined, true, 0.5));
    this.at(0.35, env => { env.audio.slideWhistle(); env.audio.pop(env.audio.now() + 0.42); });
    this.at(0.6, env => env.say('scare-kids', 'ghost'));
    this.at(1.3, env => { env.r.particles.candy(env.W / 2, env.H * 0.55, 90, 1300); env.audio.sparkle(); env.audio.boing(env.audio.now() + 0.1); });
    this.at(1.6, env => env.audio.playMusic('fun'));
  }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'fun', t); r.drawFog(g, t, 0.5);
    let scale, y;
    if (t < 0.35) { scale = 0.6; y = H * (1.3 - easeOutCubic(t / 0.35) * 0.75); }
    else if (t < 1.3) { const p = clamp((t - 0.35) / 0.35, 0, 1); scale = 0.6 + easeOutBack(p) * 1.9; y = H * (0.55 + p * 0.12); }
    else { const p = clamp((t - 1.3) / 0.6, 0, 1); scale = 2.5 - easeOutCubic(p) * 1.6; y = H * (0.67 - p * 0.12) + Math.abs(Math.sin(t * 6)) * -40 * (t > 1.9 ? 1 : 0); }
    const shake = t > 0.35 && t < 1.0 ? 14 : 0;
    g.save(); g.translate(rand(-shake, shake), rand(-shake, shake));
    drawGhost(g, W / 2, y, H * 0.3 * scale, { time: t, boo: t > 0.35 && t < 1.4, talk: env.talk, wave: t > 1.6, look: env.look });
    g.restore();
    if (t > 0.35 && t < 1.6) {
      const p = clamp((t - 0.35) / 0.25, 0, 1);
      drawTitle(g, 'BOO!', W / 2, H * 0.2, 120 + easeOutBack(p) * 180, 'fun', t * 3, { c1: '#ffffff', c2: '#b9c6ff' });
    }
    if (t > 1.8) drawTitle(g, t < 3.6 ? 'GOTCHA!' : 'HAPPY HALLOWEEN!', W / 2, H * 0.15, 140, 'fun', t);
  }
}

class ScareAdults extends Scene {
  constructor(o) {
    super(o); this.music = null; this.voice = 'demon'; this.cut = true;
    this.level = o.level || 'medium'; this.strobe = !!o.strobe;
    this.tb = this.level === 'mild' ? 0.6 : rand(0.4, 0.9); // the moment of the scare
    const tb = this.tb;
    if (this.level === 'mild') {
      this.at(tb, env => { env.audio.sting(undefined, 0.5); env.audio.growl(undefined, 1.0, 0.5); });
      this.at(tb + 1.3, env => env.say('scare-adults', 'skull'));
      this.at(tb + 2.8, env => env.audio.evilLaugh(undefined, 95, 6, 0.45));
    } else {
      this.at(tb, env => { env.audio.scream(undefined, 1.3, 0.85); env.audio.sting(undefined, 0.75); env.audio.growl(undefined, 1.2, 0.5); });
      this.at(tb + 1.7, env => env.say('scare-adults', 'demon'));
      this.at(tb + 3.0, env => env.audio.evilLaugh(undefined, 90, 7, 0.5));
      if (this.level === 'max') this.at(tb + 2.3, env => { env.audio.scream(undefined, 0.9, 0.9); env.audio.thunder(undefined, 1); });
    }
    this.at(tb + 3.4, env => env.audio.playMusic('creepy'));
  }
  draw(g, env) {
    const { W, H, r } = env, t = this.t, tb = this.tb;
    if (this.level === 'mild') return this.drawMild(g, env);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const dt = t - tb;
    const second = this.level === 'max' && dt > 2.3 && dt < 3.1;
    if ((dt >= 0 && dt < 1.4) || second) {
      const d = second ? dt - 2.3 : dt;
      const intensity = 1 - clamp(d / 1.4, 0, 0.7);
      const sh = 40 * intensity;
      const zoom = (second ? 1.9 : 1.35) + d * 0.25;
      const dh = H * zoom, dw = dh * this.demon(env).W / this.demon(env).H;
      const x = W / 2 - dw / 2 + rand(-sh, sh), y = H / 2 - dh / 2 + rand(-sh, sh) + H * 0.05;
      const dm = this.demon(env);
      g.fillStyle = '#1a0000'; g.fillRect(0, 0, W, H);
      g.drawImage(dm.base, x, y, dw, dh);
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 * intensity;
      g.drawImage(dm.red, x - 18 * intensity, y, dw, dh); g.drawImage(dm.cyan, x + 18 * intensity, y, dw, dh);
      g.restore();
      // glitch: re-draw horizontal strips of the face shifted sideways
      // (cut from the face image itself - copying the canvas onto itself is very slow)
      for (let i = 0; i < 7 * intensity; i++) {
        const sy = rand(y, y + dh - 70), shh = rand(10, 70), dx = rand(-90, 90) * intensity;
        const srcY = (sy - y) / dh * dm.H, srcH = shh / dh * dm.H;
        g.drawImage(dm.base, 0, srcY, dm.W, srcH, x + dx, sy, dw, shh);
      }
      const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(120,0,0,0.75)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
      // film grain + flicker
      const gr = r.grain, ox = rand(256), oy = rand(256);
      for (let gx = -ox; gx < W; gx += 1024) for (let gy = -oy; gy < H; gy += 1024) g.drawImage(gr, gx, gy, 1024, 1024);
      if (Math.random() < 0.15) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, W, H); }
      if (d < 0.12) { g.fillStyle = `rgba(255,255,255,${1 - d / 0.12})`; g.fillRect(0, 0, W, H); }
      if (this.strobe && d < 1.0 && Math.floor(d / 0.07) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 0, W, H); }
    } else if (dt >= 1.4) {
      const p = clamp((dt - 1.4) / 1.5, 0, 1);
      r.drawSky(g, 'dark', t);
      g.fillStyle = `rgba(0,0,0,${1 - p * 0.6})`; g.fillRect(0, 0, W, H);
      const dm = this.demon(env), dh = H * 0.8, dw = dh * dm.W / dm.H;
      g.save(); g.globalAlpha = 0.18 + 0.08 * Math.sin(t * 3); g.drawImage(dm.base, W / 2 - dw / 2, H * 0.12, dw, dh); g.restore();
      r.drawFog(g, t, 0.8, 0.6);
      if (dt > 2.6) drawTitle(g, 'HAPPY HALLOWEEN...', W / 2, H * 0.16, 130, 'scary', dt - 2.6, { jitter: true });
    }
  }
  demon(env) { return env.r.demon; }
  drawMild(g, env) {
    const { W, H, r } = env, t = this.t, tb = this.tb;
    r.drawSky(g, 'dark', t);
    const dt = t - tb;
    if (dt < 0 && Math.random() < 0.35) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    let sc = 1;
    if (dt >= 0) sc = dt < 0.25 ? 1 + easeOutBack(dt / 0.25) * 1.6 : 2.6 - easeOutCubic(clamp((dt - 0.6) / 0.8, 0, 1)) * 1.1;
    const sh = dt >= 0 && dt < 0.8 ? 25 : 0;
    g.save(); g.translate(rand(-sh, sh), rand(-sh, sh));
    drawSkull(g, W / 2, H * 0.52, H * 0.3 * sc, { time: t, talk: dt >= 0 && dt < 0.8 ? 1 : env.talk, look: env.look, eyeGlow: dt >= 0 ? 1.4 : 0.6 });
    g.restore();
    if (dt >= 0 && dt < 0.15) { g.fillStyle = `rgba(200,0,0,${0.6 * (1 - dt / 0.15)})`; g.fillRect(0, 0, W, H); }
    r.drawFog(g, t, 0.7, 0.66);
    if (dt > 2.2) drawTitle(g, 'HAPPY HALLOWEEN...', W / 2, H * 0.13, 130, 'scary', dt - 2.2);
  }
}

// ---------- GOODBYE

class GoodbyeKids extends Scene {
  constructor(o) { super(o); this.music = 'fun'; this.voice = 'jack'; this.talkKey = 'goodbye-kids'; this.firstTalk = 0.4; this.once = true; }
  update(dt, env) { if (Math.random() < dt * 6) env.r.particles.candy(rand(env.W), -40, 1, 80, false); }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'fun', t); r.drawBats(g, t * 2.5); r.drawFog(g, t, 0.5);
    drawPumpkin(g, W * 0.35, H * 0.66, H * 0.2, { time: t, talk: env.talk, look: env.look, hat: true });
    drawGhost(g, W * 0.66, H * 0.48 + Math.sin(t * 2.5) * 20, H * 0.26, { time: t, wave: true, look: env.look });
    drawTitle(g, 'HAPPY HALLOWEEN!', W / 2, H * 0.14, 140, 'fun', t);
    drawTitle(g, 'STAY SPOOKY!', W / 2, H * 0.9, 80, 'fun', t + 1, { c1: '#ffd1f2', c2: '#c86bff' });
  }
}

class GoodbyeAdults extends Scene {
  constructor(o) { super(o); this.music = 'creepy'; this.voice = 'skull'; this.talkKey = 'goodbye-adults'; this.firstTalk = 0.4; this.once = true; }
  draw(g, env) {
    const { W, H, r } = env, t = this.t;
    r.drawSky(g, 'dark', t); r.drawBats(g, t * 2, 0.8);
    drawSkull(g, W / 2, H * 0.5, H * 0.3 * (1 - clamp(t / 6, 0, 0.4)), { time: t, talk: env.talk, look: env.look, alpha: 1 - clamp((t - 3) / 3, 0, 0.7) });
    r.drawFog(g, t, 0.85, 0.6);
    drawTitle(g, 'HAPPY HALLOWEEN', W / 2, H * 0.14, 130, 'scary', t);
    drawTitle(g, 'come back next year...', W / 2, H * 0.9, 60, 'scary', t, { drip: false, color: '#8a0000' });
  }
}

export function makeScene(stage, audience, opts = {}) {
  const kids = audience === 'kids';
  switch (stage) {
    case 'idle': return new IdleScene(opts);
    case 'approach': return kids ? new ApproachKids(opts) : new ApproachAdults(opts);
    case 'near': return kids ? new NearKids(opts) : new NearAdults(opts);
    case 'scare': return kids ? new ScareKids(opts) : new ScareAdults(opts);
    case 'goodbye': return kids ? new GoodbyeKids(opts) : new GoodbyeAdults(opts);
  }
  return new IdleScene(opts);
}
