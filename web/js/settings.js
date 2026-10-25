// Settings: defaults, loading/saving (to settings.json via the launcher, localStorage as a backup).

export const STAGES = ['idle', 'approach', 'near', 'scare', 'goodbye'];

export const DEFAULT_PHRASES = {
  'idle': [
    'Trick or treat! Come on up, I have candy!',
    'Psst! Yes, you! Free treats over here!',
    "Don't be shy. The candy doesn't bite. But I might!",
    "Ooooh, who's brave enough to visit me tonight?",
    'Happy Halloween! Come and grab a treat!',
    'Treats! Sweet, sweet treats! Come and get them!',
  ],
  'approach-kids': [
    'Well hello there, little monster! I love your costume!',
    'Ooh, a brave trick or treater! Come closer!',
    'Welcome, welcome! The candy is right down here!',
    'Look at you! That is the best costume I have seen all night!',
  ],
  'approach-adults': [
    "Welcome, mortal. We've been expecting you.",
    'Come closer. The treats are waiting. And so are we.',
    'Ah, fresh visitors. Step right up, if you dare.',
    'Nobody leaves this house without a treat. Nobody leaves at all.',
  ],
  'near-kids': [
    "Take one treat each, okay? I'm watching! Hee hee!",
    'One per trick or treater, please! Go ahead, pick your favorite!',
    'Ooh, good choice! Just one, okay?',
    'Reach in and grab one. If you dare!',
  ],
  'near-adults': [
    'One treat per head. Or I take yours.',
    'Go on. Reach into the jar. I dare you.',
    "Only one. I'm counting.",
    'Take a treat. Then run.',
  ],
  'scare-kids': [
    'Boo! Hee hee, gotcha! Happy Halloween!',
    'Boo! Did I scare you? Ha ha! Enjoy your treat!',
    'Boo! Ha ha ha! You are so brave!',
  ],
  'scare-adults': [
    'I see you!',
    'Too many!',
    'Get out!',
  ],
  'goodbye-kids': [
    'Bye bye! Happy Halloween! Stay spooky!',
    'Happy Halloween! Have fun trick or treating!',
  ],
  'goodbye-adults': [
    'Leave, while you still can. Happy Halloween!',
    'Run along now. Happy Halloween. Mwa ha ha ha!',
  ],
};

export const DEFAULTS = {
  version: 2,
  camera: { deviceId: '', mirror: true, width: 640, height: 480 },
  detection: {
    fps: 6,               // detections per second (lower = less CPU)
    minScore: 0.45,       // detector confidence
    useGpu: false,        // CPU is reliable everywhere; GPU can be faster but returns nothing on some drivers
    minBoxHeight: 0.06,   // ignore tiny people (fraction of frame height)
    handTracking: false,  // pose model for hands reaching into the jar (uses more CPU)
    motionFallback: true, // if the AI model can't load, use plain motion detection
  },
  zones: {
    // Lines are where a person's FEET are, as a fraction of the camera image height (0 = top, 1 = bottom).
    approachLine: 0.42,  // feet below this line = someone is coming up the driveway
    nearLine: 0.70,      // feet below this line = at the treat table
    scareLine: 0.95,     // feet below this line (or out of the bottom of the picture) = right in front
    left: 0.0, right: 1.0, // people outside these side limits are ignored (e.g. the sidewalk next door)
    // Off until you place it over the jar: at a random spot, walking legs would count as "grabbing".
    jar: { enabled: false, x: 0.36, y: 0.78, w: 0.28, h: 0.22 },
    jarSensitivity: 0.10, // fraction of the jar box that must change to count as a grab
  },
  calibration: {
    points: [],          // [{footY, h, H}] captured with a person of known height
    cameraHeight: 1.0,   // metres (used until you calibrate)
    horizon: 0.40,       // where the horizon is in the picture (used until you calibrate)
    refHeight: 1.70,     // height of the person used for calibration, in metres
  },
  audience: {
    mode: 'auto',        // auto | kids | adults
    mixed: 'kids',       // if kids and adults come together: kids (gentler) | majority
    childMaxHeight: 1.40, // people shorter than this (metres) are treated as kids
    unsure: 'kids',      // when height can't be measured
  },
  timing: {
    confirmMs: 700,      // someone must be seen this long before the show reacts
    arrivalMs: 2000,     // extra wait before the ADULT welcome, in case a smaller child is right behind them
    emptyMs: 3500,       // nobody seen this long = they left
    minStageMs: 2500,    // shortest time on a stage (avoids flicker)
    scareDelayMs: 500,   // pause before the scare after the trigger
    scareMs: 6500,       // length of the scare scene
    goodbyeMs: 5000,     // length of the goodbye scene
    rearmMs: 25000,      // the same group won't be scared again for this long
    idleTalkSec: 11,
    approachTalkSec: 7,
    nearTalkSec: 6,
  },
  scare: {
    kidsEnabled: true,
    adultLevel: 'medium', // mild | medium | max
    strobe: false,        // flashing lights in the max scare (can affect people with photosensitive epilepsy)
    triggerOnClose: true, // scare when someone crosses the scare line
    triggerOnGrab: true,  // scare when someone reaches into the jar box
  },
  audio: {
    volume: 0.9,
    music: true,
    musicVolume: 0.45,
    speech: true,
    engine: 'auto',       // auto (natural Piper voices if installed, else Windows) | natural | windows
    // natural (Piper) voice per character: voice model ('' = automatic) and speaker number in that model
    natural: {
      jack: { voice: '', speaker: 624 },
      ghost: { voice: '', speaker: 60 },
      skull: { voice: '', speaker: 42 },
      demon: { voice: '', speaker: 288 },
    },
    naturalWaitMs: 2500,  // max wait for a phrase that isn't generated yet, then use a Windows voice for it
    voice: '',            // Windows voice name, empty = automatic
    allowOnlineVoices: false,
    subtitles: true,
  },
  content: { idle: 'builtin', approach: 'builtin', near: 'builtin', scare: 'builtin', goodbye: 'builtin' },
  phrases: DEFAULT_PHRASES,
  display: { quality: 'medium', showPip: false, hideCursor: true },
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// Merge saved settings over the defaults. A saved value is only used if it has the same type as the
// default (so a hand-edited or damaged settings.json can't break the app); unknown keys are kept.
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (typeof base === 'number') return typeof over === 'number' && Number.isFinite(over) ? over : base;
  if (typeof base === 'string' || typeof base === 'boolean') return typeof over === typeof base ? over : base;
  if (!isObj(base)) return over;
  const out = {};
  for (const k of Object.keys(base)) out[k] = deepMerge(base[k], isObj(over) ? over[k] : undefined);
  if (isObj(over)) for (const k of Object.keys(over)) if (!(k in base)) out[k] = over[k];
  return out;
}

export function clone(v) { return JSON.parse(JSON.stringify(v)); }

const LS_KEY = 'spooky-treat-station-settings';

export let firstRun = false;

// Replace the contents of `target` in place (all modules share the same settings object).
export function replaceSettings(target, src) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, clone(src));
}

export async function loadSettings() {
  let saved = null;
  try {
    const r = await fetch('/api/settings', { cache: 'no-store' });
    if (r.ok) saved = await r.json();
  } catch (e) { /* launcher not available */ }
  if (!saved || !Object.keys(saved).length) {
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
  }
  if (!isObj(saved)) saved = null;
  firstRun = !saved || !Object.keys(saved).length;
  const s = deepMerge(clone(DEFAULTS), saved || {});
  return migrate(s, saved || {});
}

export function migrate(s, saved) {
  // Phrase lists: keep the user's lists (an emptied list means "say nothing"), drop anything that isn't text.
  for (const k of Object.keys(DEFAULT_PHRASES)) {
    s.phrases[k] = Array.isArray(s.phrases[k]) ? s.phrases[k].filter(x => typeof x === 'string' && x.trim()) : DEFAULT_PHRASES[k].slice();
  }
  s.calibration.points = s.calibration.points.filter(p => isObj(p) && [p.footY, p.h, p.H].every(Number.isFinite) && p.h > 0 && p.H > 0);
  // v1 had the jar box switched on at a default spot, where walking legs counted as grabbing a treat.
  // If the user never moved it, switch it off.
  const j = s.zones.jar;
  if ((saved.version ?? 1) < 2 && j.x === 0.36 && j.y === 0.78 && j.w === 0.28 && j.h === 0.22) j.enabled = false;
  s.version = DEFAULTS.version;
  return s;
}

export async function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  try {
    const r = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
    return { ok: true, where: 'settings.json', rev: j.rev };
  } catch (e) {
    return { ok: false, where: 'browser only', error: String(e) };
  }
}
