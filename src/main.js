// Shadow Room: entry point. Builds the scene, runs the simulation and render loop.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { settings, qualityProfile } from './config.js';
import { buildRoom, ROOM } from './room.js';
import { Cat } from './cat.js';
import { createLights, placeHallLight } from './lighting.js';
import { WindowCamera } from './parallax.js';
import { ShadowCaster } from './silhouette.js';
import { DemoFigure } from './demo.js';
import { Post } from './post.js';
import { Interactions } from './interactions.js';
import { Tracker } from './tracker.js';
import { OneEuro } from './oneEuro.js';
import { Dust } from './dust.js';
import { UI } from './ui.js';
import { TrackingView } from './trackingView.js';
import { rendererName, isSoftware, gpuName } from './gpu.js';

const debug = (window.__shadowRoom = { frames: 0, errors: [], ready: false });
window.addEventListener('error', (e) => debug.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String((e.reason && e.reason.message) || e.reason)));

const canvas = document.getElementById('scene');
const profile = qualityProfile();

// How far the virtual eye / the shadow move per metre of real head movement.
const PARALLAX_GAIN = 1.2;
const SHADOW_GAIN = 2.2;
const EYE_HEIGHT = 1.52;
// Turning your head turns the view, with a soft dead zone so small unintended turns do nothing.
// "Look all around" (lookAll): a small head turn turns the room a lot, because your eyes have to
// stay on the monitor. FULL_TURN / headTurn of head turn looks straight behind you (15° at the
// default sensitivity 1.5); a nod of FULL_PITCH / headTurn looks at the ceiling or the floor.
// Without lookAll: a gentle ±TURN_MAX, left/right only, headTurn degrees per degree.
const TURN_DEADZONE = THREE.MathUtils.degToRad(2);
const TURN_MAX = THREE.MathUtils.degToRad(40);
const FULL_TURN = THREE.MathUtils.degToRad(22.5);
const PITCH_DEADZONE = THREE.MathUtils.degToRad(2);
const PITCH_MAX = THREE.MathUtils.degToRad(70);
const FULL_PITCH = THREE.MathUtils.degToRad(15);
// Centering: after CENTER_COUNTDOWN ms (time to look at the screen instead of the button), this
// long of tracking is averaged into your normal head position. It needs CENTER_MIN_SAMPLES
// analysed frames; a slow tracker gets up to CENTER_EXTRA_MS more to deliver them.
const CENTER_COUNTDOWN = 3000;
const CENTER_SAMPLE_MS = 600;
const CENTER_MIN_SAMPLES = 3;
const CENTER_EXTRA_MS = 1200;
// Between detections the view eases toward the newest estimate over FOLLOW_TIME (s); with
// nobody in view it drifts back to rest over RETURN_TIME.
const FOLLOW_TIME = 0.03;
const RETURN_TIME = 1.0;
// While nothing in view moves, render at IDLE_FPS instead of the cap (dust, grain, candle and
// curtains still drift); any movement wakes it for at least WAKE_MS. Thresholds are set just
// above what can be seen: a still head jitters by about a millimetre.
const IDLE_FPS = 15;
const WAKE_MS = 500;
const MOTION_PX = 2;          // landmark movement between analysed frames, px of the 256 px input
const VIEW_GAP = 0.002;       // m of virtual eye movement still to catch up
const LOOK_GAP = THREE.MathUtils.degToRad(0.1);
const HIT_TEST_HZ = 15;       // shadow hit tests read the silhouette back from the GPU; 15/s is plenty
const SHADOW_REFRESH_S = 0.5; // shadow maps are reused while nothing moves; refresh this often anyway

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !profile.composer, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Three full scene renders per frame just for shadow maps, of a room that is mostly still:
// redraw them only when something that casts shadows moves (see render()).
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = settings.get('exposure');
renderer.outputColorSpace = THREE.SRGBColorSpace;
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);

// A dim, room-coloured reflection probe (warm lamp, cool window, warm doorway)
// instead of a bright studio environment, so glossy surfaces reflect the right mood.
function makeEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.8, 7), new THREE.MeshBasicMaterial({ color: 0x0b0908, side: THREE.BackSide })));
  const add = (geo, color, pos, rotX = 0) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.rotation.x = rotX;
    env.add(m);
  };
  add(new THREE.PlaneGeometry(3.3, 1.9), new THREE.Color(0x1d2a4a), new THREE.Vector3(0, -0.05, -3.45));
  add(new THREE.CircleGeometry(0.35, 24), new THREE.Color(0xffb070).multiplyScalar(3), new THREE.Vector3(-0.8, 0.5, -0.9), Math.PI / 2);
  add(new THREE.PlaneGeometry(3.2, 2.3), new THREE.Color(0xffd29a).multiplyScalar(1.2), new THREE.Vector3(0, -0.3, 3.45));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = makeEnvironment();

// ------------------------------------------------------------------ world
const view = new WindowCamera({
  hfov: 76,
  windowCenter: new THREE.Vector3(0, 1.36, -1.3),
  eye: new THREE.Vector3(0, EYE_HEIGHT, -0.3),
});
const room = buildRoom(scene);
const lights = createLights(scene, profile);
room.pendant.spot.shadow.mapSize.set(profile.lampShadow, profile.lampShadow);
const caster = new ShadowCaster(renderer, lights.hall, profile.cookie);
const demo = new DemoFigure();
const post = profile.composer ? new Post(renderer, scene, view.camera, profile.samples) : null;
const interactions = new Interactions({ room, caster, settings, camera: view.camera });
const dust = new Dust(scene, lights.hall, caster.rt.texture, profile.dust);
const tracker = new Tracker();
tracker.useWorker = settings.param('worker') !== '0';   // ?worker=0 runs the model on the main thread
const cat = new Cat(scene, { room, interactions });

const state = {
  time: 0,
  source: 'demo',                 // 'demo' | 'camera'
  presence: 0,
  eyeOffset: new THREE.Vector3(),
  look: 0,                        // radians the view is turned to the right (head turn)
  lookPitch: 0,                   // radians the view looks up
  catDot: null,                   // where the shadow of a raised hand lands (the cat chases it)
  mouse: { x: 0, y: 0, at: -1e9 },
  paused: false,
  cameraFailed: false,
  lastSeen: -1e9,
  wallpaper: false,               // set when Lively talks to us
  awakeUntil: 0,                  // render at the full frame rate until then (performance.now() ms)
  hitAt: -1,                      // state.time of the last shadow hit-test readback
  shadowsAt: -1e9,                // state.time the shadow maps were last redrawn
  shadowsDirty: true,
};
const idleEnabled = settings.param('idle') !== '0';   // ?idle=0 always renders at the cap
function wake(ms = WAKE_MS) {
  state.awakeUntil = Math.max(state.awakeUntil, performance.now() + ms);
}
const neutral = { X: 0, Y: 0, d: 0.6, yaw: 0, pitch: 0, roll: 0, set: false };
// One Euro filters, fed once per analysed camera frame. minCutoff in Hz; beta in Hz per metre/s
// (per radian/s for the angles), so they hold still when you do and catch up as soon as you move.
// The angles are held a little steadier: looking all around magnifies them.
const filters = {
  x: new OneEuro(1.2, 20, 2),
  y: new OneEuro(1.2, 20, 2),
  d: new OneEuro(0.5, 3, 1),
  yaw: new OneEuro(0.8, 3, 1),
  pitch: new OneEuro(0.8, 3, 1),
  roll: new OneEuro(1.0, 2, 1),
};
const head = { X: 0, Y: 0, d: 0.6, yaw: 0, pitch: 0, roll: 0, seq: -1 };   // filtered, newest analysed frame
const goal = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };              // head relative to its rest pose
const follow = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };            // what the view actually follows

// ------------------------------------------------------------------ UI
const ui = new UI(document.getElementById('ui'), settings, {
  previewSource: () => caster.blurCanvas,
  onAction: (a) => {
    if (a === 'recenter' || a === 'key:c') startCentering();
    else if (a === 'reload') setTimeout(() => location.reload(), 150);
    else if (a === 'key:d') settings.set('demo', !settings.get('demo'));
    else if (a === 'key:l') settings.set('roomLight', !settings.get('roomLight'), { save: false });
    else if (a === 'key:t') { room.tv.on = !room.tv.on; room.tv.switchedAt = interactions.time; }
    else if (a === 'key:p') settings.set('showPreview', !settings.get('showPreview'));
    else if (a === 'key:v') settings.set('showTracking', !settings.get('showTracking'));
  },
});
if (settings.param('ui') === '0') ui.root.style.display = 'none';
const trackingView = new TrackingView(ui.root, {
  renderer, tracker, settings, profile,
  pose: () => ({
    source: state.source, paused: state.paused, head, neutral, follow, look: state.look, lookPitch: state.lookPitch,
    catMode: cat.visible ? cat.mode : 'off',
  }),
});
// Graphics acceleration off (or a broken driver): WebGL runs on a software rasteriser and
// everything crawls. Nothing on the page can fix that, so say so clearly.
const gpuRenderer = rendererName(renderer.getContext());
if (isSoftware(gpuRenderer)) {
  debug.errors.push(`no GPU: WebGL runs on ${gpuName(gpuRenderer)}`);
  ui.toast(`No GPU: the browser draws this on the CPU (${gpuName(gpuRenderer)}), so it lags. `
    + 'Turn on "Use graphics acceleration when available" in the browser settings (System) and relaunch it.', 20000, 2);
}

// ------------------------------------------------------------------ settings → scene
function applySettings() {
  renderer.toneMappingExposure = settings.get('exposure');
  placeHallLight(lights, settings.get('hallHeight'), settings.get('hallDistance'), settings.get('hallIntensity'));
  cat.visible = settings.get('cat');
  lights.hall.intensity = 430 * settings.get('hallIntensity');
  lights.moon.visible = settings.get('moon');
  lights.windowFill.intensity = settings.get('moon') ? 0.6 : 0.2;
  caster.blurMeters = 0.028 * settings.get('shadowSoftness');
  dust.points.visible = settings.get('dust');
  tracker.fov = settings.get('webcamFov');
  tracker.mirror = settings.get('mirror');
  trackingView.visible = settings.get('showTracking');
  if (post) post.configure({ bloom: settings.get('bloom'), grain: settings.get('grain') });
}
settings.onChange((key) => {
  applySettings();
  state.shadowsDirty = true;   // lights may have moved or been switched
  wake();
  if (key === 'camera' || key === 'demo') chooseSource();
  if (key === 'mirror') {
    // Left and right just swapped: the rest pose (and a saved one) no longer fits.
    neutral.set = false;
    settings.set('calibrated', false);
  }
});
applySettings();

// Compile every material now, for the target the room is actually drawn into, so the first look
// behind you (hallway, lamp) or at the cat does not stall on shader compiles.
renderer.setRenderTarget(post ? post.composer.readBuffer : null);
renderer.compile(scene, view.camera);
renderer.setRenderTarget(null);

// ------------------------------------------------------------------ camera / demo source
async function chooseSource() {
  const wantCamera = settings.get('camera') && !settings.get('demo');
  if (!wantCamera) {
    if (tracker.status !== 'idle') tracker.stop();
    state.source = 'demo';
    return;
  }
  if (tracker.status === 'running' || tracker.status === 'starting') return;
  if (state.paused) return;          // opened on unpause instead (setPaused)
  try {
    ui.setStatus('Starting camera…', 'demo');
    await tracker.start();
    if (tracker.status !== 'running') return;   // cancelled (setting changed or paused meanwhile)
    enterCamera();
    state.cameraFailed = false;
    neutral.set = false;
    ui.toast('Camera on: step into the light. Nothing leaves this PC.');
  } catch (err) {
    cameraFailed(err);
  }
}

// Hand the view over from the demo figure to the webcam without a jump.
function enterCamera() {
  if (state.source === 'camera') return;
  state.source = 'camera';
  const g = PARALLAX_GAIN * settings.get('parallax');
  if (g > 0) Object.assign(follow, { x: state.eyeOffset.x / g, y: state.eyeOffset.y / g, z: state.eyeOffset.z / g });
  Object.assign(follow, { yaw: 0, pitch: 0, roll: 0 });
}

// ------------------------------------------------------------------ centering
// "This is my normal head position." A countdown first, with a target in the middle of the
// screen: whoever clicks a button in a corner is looking at that corner. Then CENTER_SAMPLE_MS
// of tracking is averaged into the rest pose. The angles are saved and used from then on,
// instead of whatever pose you happened to have when the webcam opened.
const centering = { active: false, captureAt: 0, until: 0, shown: 0, samples: [] };

function startCentering() {
  if (state.source !== 'camera' || tracker.status !== 'running') {
    ui.toast('Centering needs the webcam: turn it on first.', 3500, 1);
    return;
  }
  Object.assign(centering, { active: true, captureAt: performance.now() + CENTER_COUNTDOWN, until: 0, shown: 0, samples: [] });
  ui.showAim(true);
  updateCentering(performance.now());   // the countdown shows at once, not on the next frame
}

// Every animation tick while centering (the full frame rate stays on meanwhile).
function updateCentering(now) {
  if (!centering.active) return;
  wake();
  if (now < centering.captureAt) {
    const n = Math.ceil((centering.captureAt - now) / 1000);
    if (n !== centering.shown) {
      centering.shown = n;
      ui.toast(`Sit as you normally do and look at the middle of the screen… ${n}`, 1300, 1);
    }
    return;
  }
  if (!centering.until) centering.until = now + CENTER_SAMPLE_MS;
  const s = centering.samples;
  // Too few frames analysed yet (a slow machine) but you are in view: give it a little longer.
  const inView = tracker.people.length > 0 && now - tracker.lastResultAt < 900;
  const waitMore = s.length < CENTER_MIN_SAMPLES && inView && now < centering.until + CENTER_EXTRA_MS;
  if (now < centering.until || waitMore) return;
  centering.active = false;
  ui.showAim(false);
  if (s.length < CENTER_MIN_SAMPLES) {
    ui.toast("Couldn't see you. Face the webcam and try again.", 3500, 1);
    return;
  }
  const avg = (k) => s.reduce((sum, x) => sum + x[k], 0) / s.length;
  Object.assign(neutral, { X: avg('X'), Y: avg('Y'), d: avg('d'), yaw: avg('yaw'), pitch: avg('pitch'), roll: avg('roll'), set: true });
  settings.set('centerYaw', neutral.yaw);
  settings.set('centerPitch', neutral.pitch);
  settings.set('centerRoll', neutral.roll);
  settings.set('calibrated', true);
  ui.toast('Centered: this is your normal head position now.', 3000, 1);
}

function cameraFailed(err) {
  state.source = 'demo';
  state.cameraFailed = true;
  const name = err && err.name;
  const why = name === 'NotAllowedError' ? 'camera permission was denied'
    : name === 'NotFoundError' ? 'no camera was found'
    : name === 'NotReadableError' ? 'the camera is busy in another app'
    : (err && err.message) || 'the camera could not start';
  ui.toast(`Demo mode: ${why}.`, 6000);
  debug.errors.push(`camera: ${why}`);
}

// ------------------------------------------------------------------ input
const clickRay = new THREE.Raycaster();
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target !== canvas) return;
  wake();
  const ndc = { x: (e.clientX / window.innerWidth) * 2 - 1, y: -((e.clientY / window.innerHeight) * 2 - 1) };
  clickRay.setFromCamera(ndc, view.camera);
  if (cat.click(clickRay)) { debug.lastClick = 'cat'; return; }
  const hit = interactions.click(ndc.x, ndc.y);
  if (hit) debug.lastClick = hit;
});
window.addEventListener('pointermove', (e) => {
  state.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  state.mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
  state.mouse.at = performance.now();
  if (state.source === 'demo') demo.setMouse(state.mouse.x, state.mouse.y, state.mouse.at);
});

// ------------------------------------------------------------------ simulation
const _offset = new THREE.Vector3();
const noShadow = settings.param('noshadow') === '1';

// A head angle past a soft dead zone → view angle, reaching `max` at `full` of head angle (dead
// zone included): it starts at 70% of that average rate and speeds up a little toward the end.
function expand(angle, dead, full, max) {
  const free = angle - dead * Math.tanh(angle / dead);
  const span = Math.max(1e-3, full - dead);
  const x = Math.min(Math.abs(free), span);
  const rate = (0.7 * max) / span;
  const v = rate * x + (max - rate * span) * (x / span) ** 3;
  return Math.sign(free) * Math.min(max, v);
}

// Head yaw relative to rest (+ = the user's right) → how far the view turns.
function viewTurn(yaw) {
  const s = settings.get('headTurn');
  if (!(s > 0)) return 0;
  if (settings.get('lookAll')) return expand(yaw, TURN_DEADZONE, Math.max(FULL_TURN / s, TURN_DEADZONE * 2), Math.PI);
  const free = yaw - TURN_DEADZONE * Math.tanh(yaw / TURN_DEADZONE);
  return TURN_MAX * Math.tanh((s * free) / TURN_MAX);
}

// Head pitch relative to rest (+ = looking up) → how far the view looks up (lookAll only).
function viewPitch(pitch) {
  const s = settings.get('headTurn');
  if (!(s > 0) || !settings.get('lookAll')) return 0;
  return expand(pitch, PITCH_DEADZONE, Math.max(FULL_PITCH / s, PITCH_DEADZONE * 2), PITCH_MAX);
}

// Magnified this much, a held head turn would carry the tracker's jitter into the view: smooth
// the view angles once more, adaptively (steady when you hold still, quick when you turn).
const viewFilters = { yaw: new OneEuro(0.4, 1.0, 1), pitch: new OneEuro(0.4, 1.0, 1) };

// ------------------------------------------------------------------ the cat's laser dot
// Where the shadow of a raised hand lands: the first surface the hall light's ray through the
// hand (on the body plane) hits — the floor, the back wall or a side wall. On a wall, the cat
// waits on the floor below it, looking up.
const _hand = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _dot = { floor: new THREE.Vector3(), onFloor: true, height: 0 };
function shadowDot(hand) {
  if (!hand) return null;
  const L = caster.lightPos;
  _ray.copy(hand).sub(L);
  let t = Infinity;
  let wall = null;
  if (_ray.y < -1e-3) t = -L.y / _ray.y;
  if (_ray.z < -1e-3) {
    const tb = (ROOM.zBack - L.z) / _ray.z;
    if (tb < t) { t = tb; wall = 'back'; }
  }
  if (Math.abs(_ray.x) > 1e-3) {
    const ts = ((_ray.x > 0 ? ROOM.xMax : ROOM.xMin) - L.x) / _ray.x;
    if (ts > 0 && ts < t) { t = ts; wall = 'side'; }
  }
  if (!Number.isFinite(t)) return null;
  _probe.copy(_ray).multiplyScalar(t).add(L);
  if (_probe.y > ROOM.height || _probe.z > ROOM.zFront - 0.1) return null;   // on the ceiling, or behind you
  // Nudge the probe off the surface, and check the hall light actually reaches it.
  const px = _probe.x;
  const py = _probe.y;
  const pz = _probe.z;
  if (!wall) _probe.y = 0.02;
  else if (wall === 'back') _probe.z = ROOM.zBack + 0.02;
  else _probe.x = Math.sign(px) * (ROOM.xMax - 0.02);
  if (caster.sample(_probe) < 0) return null;
  _dot.onFloor = !wall;
  _dot.height = wall ? py : 0;
  if (!wall) _dot.floor.set(px, 0, pz);
  else if (wall === 'back') _dot.floor.set(px, 0, ROOM.zBack + 0.35);
  else _dot.floor.set(Math.sign(px) * (ROOM.xMax - 0.35), 0, pz);
  return _dot;
}

// A raised (or outstretched) hand of a tracked person, placed on the body plane like the mask.
function raisedHand(p, bodyX, eyeY, mirror) {
  const lm = p.lm;
  let best = null;
  for (const [wrist, tip, elbow] of [[15, 19, 13], [16, 20, 14]]) {
    const h = (lm[tip].visibility ?? 0) > 0.6 ? lm[tip] : lm[wrist];
    if ((h.visibility ?? 0) < 0.6 || h.x < 0 || h.x > 1 || h.y < 0 || h.y > 1) continue;
    const raised = h.y < lm[elbow].y - 0.02;
    const out = Math.abs(h.x - (lm[11].x + lm[12].x) / 2) > Math.abs(lm[11].x - lm[12].x) * 0.9;
    if ((raised || out) && (!best || h.y < best.y)) best = h;
  }
  if (!best) return null;
  const sgn = mirror ? -1 : 1;
  return _hand.set(bodyX + sgn * (best.x * p.mw - p.eu) * p.mpp, eyeY - (best.y * p.mh - p.ev) * p.mpp, caster.planeZ);
}

// The demo figure's raised hand (its pose is already in body-plane metres).
function demoHand(pose) {
  let best = null;
  for (const a of [pose.armL, pose.armR]) {
    const up = a.hand.y > pose.sL.y - 0.05 || Math.abs(a.hand.x - pose.x) > 0.4;
    if (up && (!best || a.hand.y > best.y)) best = a.hand;
  }
  return best ? _hand.set(best.x, best.y, caster.planeZ) : null;
}

// Webcam: turn tracked people into eye offset, view turn + silhouettes on the body plane.
function simulateCamera(dt, now) {
  const people = tracker.people;
  const seen = people.length > 0 && now - tracker.lastResultAt < 900;
  if (seen) {
    state.lastSeen = now;
    if (!state.hinted && !state.wallpaper) {
      state.hinted = true;
      ui.toast("That shadow is you. Raise a hand to swat the lamp; hold your head's shadow on the TV or the light switch.", 8000);
    }
    const p = people[0];
    if (head.seq !== tracker.seq) {
      // A newly analysed frame: filter it once, stamped with when it was grabbed.
      head.seq = tracker.seq;
      const ts = tracker.resultAt / 1000;
      head.X = filters.x.filter(p.X, ts);
      head.Y = filters.y.filter(p.Y, ts);
      head.d = filters.d.filter(p.d, ts);
      if (p.yaw !== null) {
        head.yaw = filters.yaw.filter(p.yaw, ts);
        head.pitch = filters.pitch.filter(p.pitch, ts);
        head.roll = filters.roll.filter(p.roll, ts);
      }
      if (neutral.set) trackingView.sample(now, p.X - neutral.X, (p.yaw ?? head.yaw) - neutral.yaw);
      if (centering.active && now >= centering.captureAt) {
        centering.samples.push({ X: head.X, Y: head.Y, d: head.d, yaw: head.yaw, pitch: head.pitch, roll: head.roll });
      }
    }
    if (!neutral.set) {
      // Rest pose: where you are now; your saved normal head angles if you have centered before.
      Object.assign(neutral, { X: head.X, Y: head.Y, d: head.d, yaw: head.yaw, pitch: head.pitch, roll: head.roll, set: true });
      if (settings.get('calibrated')) {
        Object.assign(neutral, { yaw: settings.get('centerYaw'), pitch: settings.get('centerPitch'), roll: settings.get('centerRoll') });
      }
    } else if (settings.get('autoCenter')) {
      // Drift the resting position over ~30 s (you shift in your chair). Not the angles: a head
      // held turned to look around must not slowly become the new straight ahead.
      const k = Math.min(1, dt / 30);
      for (const key of ['X', 'Y', 'd']) neutral[key] += (head[key] - neutral[key]) * k;
    }
    Object.assign(goal, {
      x: head.X - neutral.X, y: head.Y - neutral.Y, z: head.d - neutral.d,
      yaw: head.yaw - neutral.yaw, pitch: head.pitch - neutral.pitch, roll: head.roll - neutral.roll,
    });
  } else {
    Object.assign(goal, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
  }
  const k = 1 - Math.exp(-dt / (seen ? FOLLOW_TIME : RETURN_TIME));
  for (const key in follow) follow[key] += (goal[key] - follow[key]) * k;
  const g = PARALLAX_GAIN * settings.get('parallax');
  state.eyeOffset.set(follow.x * g, follow.y * g, follow.z * g);
  if (settings.get('headTurn') > 0) {
    state.look = viewFilters.yaw.filter(viewTurn(follow.yaw), state.time);
    state.lookPitch = viewFilters.pitch.filter(viewPitch(follow.pitch), state.time);
  } else {
    state.look = state.lookPitch = 0;   // off means off, not a slow glide back
  }
  view.update(state.eyeOffset, state.look, state.lookPitch);
  const target = seen && !noShadow ? 1 : 0;
  state.presence += (target - state.presence) * Math.min(1, dt * (seen ? 4 : 1.2));
  // Still catching up with the head, or the shadow still fading: keep the full frame rate.
  const gap = Math.hypot(goal.x - follow.x, goal.y - follow.y, goal.z - follow.z) * g;
  const turning = Math.abs(viewTurn(goal.yaw) - state.look) > LOOK_GAP || Math.abs(viewPitch(goal.pitch) - state.lookPitch) > LOOK_GAP;
  if (gap > VIEW_GAP || turning || Math.abs(target - state.presence) > 0.01) wake();

  caster.syncLight();
  caster.setPlane(view.eye.x, view.eye.z);
  caster.presence = state.presence;
  caster.begin();
  const reach = SHADOW_GAIN * settings.get('shadowReach');
  const mirror = settings.get('mirror');
  let primaryX = 0;
  state.catDot = null;
  people.slice(0, 2).forEach((p, i) => {
    const sx = i === 0 ? head.X : p.X;
    const sy = i === 0 ? head.Y : p.Y;
    const bodyX = (sx - neutral.X) * reach;
    const eyeY = THREE.MathUtils.clamp(EYE_HEIGHT + (sy - neutral.Y), 1.15, 1.95);
    if (i === 0) primaryX = bodyX;
    if (!state.catDot && seen) state.catDot = shadowDot(raisedHand(p, bodyX, eyeY, mirror));
    caster.drawMask(p.canvas, { eyeU: p.eu, eyeV: p.ev, mpp: p.mpp, mirror, eyeX: bodyX, eyeY });
    if (p.cut) {
      const sgn = mirror ? -1 : 1;
      const xa = bodyX + sgn * (p.cut.uL - p.eu) * p.mpp;
      const xb = bodyX + sgn * (p.cut.uR - p.eu) * p.mpp;
      const yCut = eyeY - (p.cut.v - p.ev) * p.mpp;
      if (yCut > 0.1) caster.drawLowerBody(Math.min(xa, xb), Math.max(xa, xb), yCut);
    }
  });
  caster.bodyX = primaryX;
  updateHit();
}

// The CPU copy of the silhouette for "is this object in my shadow?" means a GPU readback.
function updateHit() {
  if (state.time - state.hitAt < 1 / HIT_TEST_HZ - 1e-6) return;
  state.hitAt = state.time;
  caster.updateHit();
}

function simulateDemo(dt, now, t) {
  const pose = demo.update(dt, now);
  _offset.set(pose.x * 0.25, (pose.eyeY - demo.eyeHeight) * 0.6, 0);
  _offset.x += Math.sin(t * 0.13) * 0.035;
  _offset.y += Math.sin(t * 0.09) * 0.02;
  state.eyeOffset.lerp(_offset, Math.min(1, dt * 4));
  state.look *= Math.exp(-dt / 0.5);
  state.lookPitch *= Math.exp(-dt / 0.5);
  view.update(state.eyeOffset, state.look, state.lookPitch);
  state.presence += ((noShadow ? 0 : 1) - state.presence) * Math.min(1, dt * 2);

  caster.syncLight();
  caster.setPlane(view.eye.x, view.eye.z);
  caster.bodyX = pose.x;
  caster.presence = state.presence;
  caster.begin();
  demo.draw(caster.ctx, pose);
  caster.drawLowerBody(pose.x - 0.175, pose.x + 0.175, pose.hipY + 0.02);
  updateHit();
  state.catDot = noShadow ? null : shadowDot(demoHand(pose));
}

// What the cat can see: the dot, your shadow, you, the lamp, the TV, the tilt of your head.
const catEnv = {
  dot: null,
  shadowAt: (p) => caster.sample(p),
  viewer: view.camera.position,
  lampPos: new THREE.Vector3(),
  lampSwinging: false,
  tvOn: false,
  headRoll: 0,
};
function simulateCat(dt) {
  if (!cat.visible) return;
  catEnv.dot = state.catDot;
  catEnv.lampSwinging = Math.abs(room.pendant.vx) + Math.abs(room.pendant.vz) > 0.05;
  if (catEnv.lampSwinging) room.pendant.bulb.getWorldPosition(catEnv.lampPos);
  catEnv.tvOn = room.tv.on;
  catEnv.headRoll = state.source === 'camera' ? follow.roll : 0;
  cat.update(dt, catEnv);
}

function simulate(dt, now) {
  state.time += dt;
  scene.updateMatrixWorld();
  // While the camera (re)starts, the camera path simply shows no shadow.
  if (state.source === 'camera') simulateCamera(dt, now);
  else simulateDemo(dt, now, state.time);
  interactions.update(dt);
  simulateCat(dt);
}

function render() {
  // Bounce light comes mostly from the lamp: dim it with the lamp.
  lights.hemi.intensity = 0.1 + 0.1 * interactions.roomLevel;
  // Shadow maps: redraw when something that casts shadows moved or a light changed, and every
  // SHADOW_REFRESH_S anyway (the curtains sway a few millimetres). Your own shadow is not in
  // them: it is the hall light's cookie, redrawn every frame.
  if (state.shadowsDirty || interactions.moving || cat.moving || state.time - state.shadowsAt >= SHADOW_REFRESH_S) {
    renderer.shadowMap.needsUpdate = true;
    state.shadowsAt = state.time;
    state.shadowsDirty = false;
  }
  caster.updateTexture();
  caster.renderCookie();
  if (dust.points.visible) {
    dust.update(state.time, {
      caster, camera: view.camera, lampPos: room.pendant.bulb.getWorldPosition(new THREE.Vector3()),
      lampLevel: interactions.roomLevel, bufferHeight: renderer.domElement.height, intensity: 1,
    });
  }
  if (post) post.render(state.time);
  else renderer.render(scene, view.camera);
  debug.frames++;
}

function updateStatus(now) {
  if (state.paused) return ui.setStatus('Paused', 'away');
  if (state.source === 'camera') {
    const n = tracker.people.length;
    if (n > 0) ui.setStatus(n > 1 ? `Camera · ${n} people` : 'Camera · tracking you', 'ok');
    else ui.setStatus(now - state.lastSeen > 3000 ? 'Camera · nobody in view' : 'Camera · looking…', 'away');
  } else {
    ui.setStatus(state.cameraFailed ? 'Demo · camera unavailable' : 'Demo figure', 'demo');
  }
}

// ------------------------------------------------------------------ sizing
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  view.setAspect(w / h);
  if (post) post.setSize(w, h, renderer.getPixelRatio());
  wake();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ pause / visibility / Lively
// Paused if the page is hidden OR Lively says so (e.g. a fullscreen app covers the desktop).
const pauseReasons = new Set();
function setPaused(reason, on) {
  if (on) pauseReasons.add(reason); else pauseReasons.delete(reason);
  const paused = pauseReasons.size > 0;
  if (state.paused === paused) return;
  state.paused = paused;
  if (!paused) wake();
  if (paused) {
    tracker.pause();
  } else if (tracker.status === 'paused') {
    tracker.resume()
      .then(() => { if (tracker.status === 'running') enterCamera(); })
      .catch(cameraFailed);
  } else {
    chooseSource();   // e.g. paused while the camera was still starting
  }
}
document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden));

const LIVELY_DROPDOWNS = { quality: ['low', 'medium', 'high'], fpsCap: [24, 30, 60] };
function livelyProperty(name, val) {
  if (!state.wallpaper) {
    state.wallpaper = true;
    ui.hidden = true;           // no HUD popping up on every mouse move over the desktop
    ui.applyVisibility();
  }
  if (name === 'recenter') { startCentering(); return; }
  if (name in LIVELY_DROPDOWNS) {
    const v = LIVELY_DROPDOWNS[name][Number(val)];
    if (v === undefined) return;
    if (name === 'quality' && v !== settings.get('quality')) { settings.set(name, v); setTimeout(() => location.reload(), 200); return; }
    settings.set(name, v);
    return;
  }
  settings.set(name, val);
}
function livelyPlayback(data) {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    setPaused('lively', !!(obj && (obj.IsPaused ?? obj.isPaused)));
  } catch { /* ignore malformed payloads */ }
}
window.livelyPropertyListener = livelyProperty;
window.livelyWallpaperPlaybackChanged = livelyPlayback;
for (const [kind, a, b] of window.__livelyQueue || []) {
  if (kind === 'prop') livelyProperty(a, b);
  else livelyPlayback(a);
}
window.__livelyQueue = [];

// ------------------------------------------------------------------ loop
const freeze = settings.param('freeze') === '1';
const startAt = Number(settings.param('t', '0')) || 0;
if (startAt > 0) {
  // Fast-forward the demo deterministically (used for screenshots/tests).
  const steps = Math.round(startAt * 60);
  for (let i = 0; i < steps; i++) simulate(1 / 60, i * (1000 / 60));
}

let last = performance.now();
let lastFrame = 0;
let motionSeq = -1;
function frame(now) {
  requestAnimationFrame(frame);
  if (state.paused) { last = now; return; }
  if (state.source === 'camera') {
    // Offer new webcam frames to the tracker on every tick, not only on rendered ones, and wake
    // up the moment an analysed frame shows you moving.
    tracker.detect(now, profile.detectFps);
    if (tracker.seq !== motionSeq) {
      motionSeq = tracker.seq;
      if (tracker.motion > MOTION_PX) wake();
    }
  }
  updateCentering(now);
  // Full frame rate while anything moves (always in demo mode), IDLE_FPS while all is still.
  const cap = Math.max(10, settings.get('fpsCap'));
  const awake = !idleEnabled || state.source !== 'camera' || now < state.awakeUntil;
  const fps = awake ? cap : Math.min(IDLE_FPS, cap);
  if (now - lastFrame < 1000 / fps - 2) return;
  const interval = lastFrame ? now - lastFrame : 0;
  lastFrame = now;
  const dt = freeze ? 0 : Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  simulate(dt, now);
  if (interactions.busy || (cat.visible && cat.busy)) wake();
  render();
  trackingView.frame(now, interval, performance.now() - t0, fps, awake);
  ui.update(now);
  if (debug.frames % 10 === 0) updateStatus(now);
}
requestAnimationFrame(frame);
if (document.hidden) setPaused('hidden', true);
chooseSource();

// Test hook: advance the simulation deterministically and render one frame.
function advance(seconds, fps = 60) {
  const steps = Math.max(1, Math.round(seconds * fps));
  for (let i = 0; i < steps; i++) simulate(1 / fps, performance.now());
  render();
}

Object.assign(debug, {
  advance,
  ready: true, renderer, post, dust, state, scene, room, lights, view, caster, interactions, tracker, settings, trackingView, head, neutral, follow, cat, demo,
  report: () => ({
    log: interactions.log,
    eye: view.eye.toArray().map((v) => +v.toFixed(3)),
    look: +state.look.toFixed(3),
    lookPitch: +state.lookPitch.toFixed(3),
    cat: { mode: cat.mode, pos: cat.pos.toArray().map((v) => +v.toFixed(2)) },
    tv: room.tv.on,
    roomLight: settings.get('roomLight'),
    source: state.source,
    tracker: tracker.status,
    mode: tracker.mode,
    delegate: tracker.delegate,
    people: tracker.people.map((p) => ({
      d: +p.d.toFixed(2), X: +p.X.toFixed(3), Y: +p.Y.toFixed(3), yaw: p.yaw === null ? null : +p.yaw.toFixed(3), cut: !!p.cut,
    })),
    presence: +state.presence.toFixed(2),
  }),
});
