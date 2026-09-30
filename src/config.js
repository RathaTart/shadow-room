// Settings: defaults, persistence (localStorage), URL overrides and change listeners.

const STORAGE_KEY = 'shadowRoom.settings.v1';

export const DEFAULTS = {
  quality: 'medium',     // low | medium | high
  fpsCap: 30,            // wallpaper-friendly default
  camera: true,          // try the webcam; falls back to demo mode
  demo: false,           // force demo figure even when a camera is available
  roomLight: true,       // pendant lamp on/off
  roomIntensity: 1.0,
  hallIntensity: 1.0,    // the light behind you that casts your shadow
  hallHeight: 1.75,      // metres
  hallDistance: 2.6,     // metres behind the doorway
  shadowSoftness: 1.0,
  parallax: 1.0,
  headTurn: 1.5,         // head-turn sensitivity; 0 = off (with lookAll: 22.5°/this of turn looks behind you)
  lookAll: true,         // look all around (up to straight behind you) and up/down; off = ±40° left/right
  calibrated: false,     // "Center" was used: the head angles below are your normal head position
  centerYaw: 0,          // radians, as the tracker reads them
  centerPitch: 0,
  centerRoll: 0,
  cat: true,             // the cat that lives in the room
  shadowReach: 1.0,      // how far your shadow travels when you move sideways
  autoCenter: true,
  interactions: true,
  dust: true,
  bloom: true,
  grain: true,
  moon: true,
  exposure: 0.85,
  screenWidthCm: 60,     // physical monitor width, used for head-tracked parallax
  webcamFov: 62,         // horizontal field of view of the webcam, degrees
  mirror: true,
  showPreview: false,
  // Tracking view (top right): what the webcam and the tracker see, and timings. On in the
  // browser; Lively's own setting (off by default) keeps the webcam picture off the desktop.
  showTracking: true,
  showHud: true,
};

// Keys that make sense to override from the URL (handy for testing and for Lively URLs).
const URL_KEYS = Object.keys(DEFAULTS);

function coerce(value, like) {
  if (typeof like === 'boolean') return value === true || value === 'true' || value === '1' || value === 1;
  if (typeof like === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : like;
  }
  return String(value);
}

class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    this.params = new URLSearchParams(location.search);
    this.persist = this.params.get('persist') !== '0';

    // Only choices the user made are written back: not URL overrides, not temporary
    // values such as the light switch being flipped by a shadow.
    this.stored = {};
    if (this.persist) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        for (const [k, v] of Object.entries(saved)) {
          if (k in DEFAULTS) this.stored[k] = this.values[k] = coerce(v, DEFAULTS[k]);
        }
      } catch { /* storage unavailable or corrupt: keep defaults */ }
    }

    for (const k of URL_KEYS) {
      if (this.params.has(k)) this.values[k] = coerce(this.params.get(k), DEFAULTS[k]);
    }
  }

  get(key) { return this.values[key]; }

  set(key, value, { save = true } = {}) {
    if (!(key in DEFAULTS)) return;
    const v = coerce(value, DEFAULTS[key]);
    if (save) { this.stored[key] = v; this.save(); }
    if (this.values[key] === v) return;
    this.values[key] = v;
    for (const fn of this.listeners) fn(key, v);
  }

  save() {
    if (!this.persist) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored)); } catch { /* ignore */ }
  }

  reset() {
    this.stored = {};
    for (const k of Object.keys(DEFAULTS)) this.set(k, DEFAULTS[k], { save: false });
    this.save();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // Test/debug parameters that are not user settings.
  param(name, fallback = null) {
    return this.params.has(name) ? this.params.get(name) : fallback;
  }
}

export const settings = new Settings();

// detectFps: pose detections per second at most (the webcam delivers up to 30 frames/s). Detection
// runs in a worker; if it has to fall back to the main thread, the tracker caps it lower.
export const QUALITY = {
  low:    { pixelRatio: 0.75, hallShadow: 1024, lampShadow: 512,  moonShadow: 1024, composer: false, dust: 220, detectFps: 15, cookie: 512 },
  medium: { pixelRatio: 1.0,  hallShadow: 2048, lampShadow: 1024, moonShadow: 1024, composer: true,  samples: 2, dust: 520, detectFps: 24, cookie: 1024 },
  high:   { pixelRatio: 1.5,  hallShadow: 2048, lampShadow: 2048, moonShadow: 2048, composer: true,  samples: 4, dust: 900, detectFps: 30, cookie: 1024 },
};

export function qualityProfile() {
  return QUALITY[settings.get('quality')] || QUALITY.medium;
}
