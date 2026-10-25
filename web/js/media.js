// Your own videos / pictures / sounds from the media/ folder next to the program.

const VIDEO = /\.(mp4|webm|ogv|mov|m4v)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp)$/i;
const AUDIO = /\.(mp3|wav|ogg|m4a)$/i;

export function folderFor(stage, audience) { return stage === 'idle' ? 'idle' : `${stage}-${audience}`; }

export class MediaLayer {
  constructor(settings, container) {
    this.s = settings;
    this.files = {};
    this.el = container;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.img = document.createElement('img');
    this.el.append(this.video, this.img);
    this.hide();
  }

  async refresh() {
    try {
      const r = await fetch('/api/media', { cache: 'no-store' });
      if (r.ok) this.files = await r.json();
    } catch (e) { this.files = {}; }
    return this.files;
  }

  count(folder) {
    const f = this.files[folder] || [];
    return { visual: f.filter(x => VIDEO.test(x) || IMAGE.test(x)).length, audio: f.filter(x => AUDIO.test(x)).length };
  }

  // Decide what to use for this stage: built-in scene, or a random file from the folder.
  choose(stage, audience) {
    const mode = this.s.content[stage] || 'builtin';
    const out = { visual: null, audio: null };
    if (mode === 'builtin') return out;
    const files = this.files[folderFor(stage, audience)] || [];
    if (!files.length) return out;
    if (mode === 'mix' && Math.random() < 0.5) return out;
    const visuals = files.filter(x => VIDEO.test(x) || IMAGE.test(x));
    const audios = files.filter(x => AUDIO.test(x));
    if (visuals.length) out.visual = visuals[Math.floor(Math.random() * visuals.length)];
    if (audios.length) out.audio = audios[Math.floor(Math.random() * audios.length)];
    return out;
  }

  show(url, { loop = true, onDuration, onError, muted = false } = {}) {
    this.el.style.display = 'block';
    if (VIDEO.test(url)) {
      this.img.style.display = 'none';
      const v = this.video;
      v.style.display = 'block';
      v.loop = loop;
      v.muted = muted;
      v.volume = Math.min(1, this.s.audio.volume);
      // a file the browser can't play (e.g. HEVC .mov) must not leave a black screen
      v.onerror = () => { console.warn('cannot play', url); onError?.(); };
      v.src = url;
      v.onloadedmetadata = () => { if (onDuration && isFinite(v.duration)) onDuration(v.duration); };
      v.play().catch(e => {
        if (e && e.name === 'NotSupportedError') return; // onerror handles it
        v.muted = true; v.play().catch(() => {});
      });
    } else {
      this.video.pause(); this.video.style.display = 'none';
      this.img.style.display = 'block';
      this.img.onerror = () => { console.warn('cannot show', url); onError?.(); };
      this.img.src = url;
      this.img.classList.remove('kenburns'); void this.img.offsetWidth; this.img.classList.add('kenburns');
    }
  }

  hide() {
    this.el.style.display = 'none';
    this.video.onerror = null;
    this.img.onerror = null;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.img.removeAttribute('src');
  }

  setMuted(m) { this.video.muted = m; }

  get visible() { return this.el.style.display !== 'none'; }
}
