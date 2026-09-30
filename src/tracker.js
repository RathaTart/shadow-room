// Webcam + MediaPipe Pose Landmarker (runs fully on this machine; no frame leaves it).
// The model runs in a worker (poseWorker.js) so a detection never stalls a rendered frame; if the
// worker cannot start, the same engine (poseEngine.js) runs on the main thread instead.
// Produces, per person: a soft body mask, the eye position in the mask, the distance to the
// camera (from the pixel distance between the eyes), which way the head is turned, and where
// the webcam frame cuts the body off at the bottom.
import { makeCanvas } from './textures.js';

const WORKER_URL = new URL('./poseWorker.js', import.meta.url);

const stopTracks = (stream) => { for (const t of stream.getTracks()) t.stop(); };
const ema = (prev, x, k = 0.15) => (prev == null ? x : prev + (x - prev) * k);

const IPD = 0.063;          // average adult interpupillary distance, metres
const INPUT_W = 256;        // inference resolution (the mask comes back at this size)
const MAIN_THREAD_FPS = 18; // detection cap when the model has to share the main thread
const AWAY_FPS = 6;         // with nobody in view for AWAY_MS, look this often (full rate once found)
const AWAY_MS = 3000;
const STALL_MS = 10000;     // stop waiting for a frame the worker never answered (the first takes a few s)

// Head orientation. The face (nose, eyes, mouth corners) sits ~9 cm in front of the line through
// the ears, and the ears ~7 cm either side of the head's centre. So, measured against that line:
// - yaw: the face's offset along it, over half the ear distance, is about tan(yaw) / 0.8
// - pitch: its offset across it (up in the image), over the face depth, is about sin(pitch), plus
//   a constant that depends on the face; the rest pose (neutral) takes that out
// - roll: the tilt of the line itself (averaged with the eye line)
const FACE = [0, 2, 5, 9, 10];
const FACE_RATIO = 0.8;
// Landmarks whose movement changes the view or the shadow: face, ears, shoulders, arms.
const MOTION_KEYS = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16];

// Radians: yaw + = face turned toward the image's right, pitch + = looking up, roll + = the side
// of the head on the image's right lower. null if the face is hidden or the ears are too close
// together to tell.
export function headPose(lm, w, h) {
  if ((lm[0].visibility ?? 1) < 0.3) return null;
  const a = lm[7];
  const b = lm[8];
  let ux = (a.x - b.x) * w;
  let uy = (a.y - b.y) * h;
  const span = Math.hypot(ux, uy);
  if (span < 4) return null;
  if (ux < 0) { ux = -ux; uy = -uy; }   // point the ear axis at the image's right, whichever ear is which
  ux /= span;
  uy /= span;
  let fx = 0;
  let fy = 0;
  for (const k of FACE) { fx += lm[k].x; fy += lm[k].y; }
  fx = (fx / FACE.length - (a.x + b.x) / 2) * w;
  fy = (fy / FACE.length - (a.y + b.y) / 2) * h;
  const along = fx * ux + fy * uy;      // toward the image's right
  const up = fx * uy - fy * ux;         // across the axis, toward the top of the image
  const yaw = Math.atan((FACE_RATIO * along) / (span / 2));
  const radius = span / 2 / Math.max(0.5, Math.cos(yaw));   // half the real head width, px
  const pitch = Math.asin(Math.max(-1, Math.min(1, (FACE_RATIO * up) / radius)));
  let ex = (lm[2].x - lm[5].x) * w;
  let ey = (lm[2].y - lm[5].y) * h;
  if (ex < 0) { ex = -ex; ey = -ey; }
  const el = Math.hypot(ex, ey) || 1;
  const roll = Math.atan2(uy + ey / el, ux + ex / el);
  return { yaw, pitch, roll };
}

// Events per second over windows of at least half a second; decays to 0 when events stop.
class Rate {
  constructor() { this.count = 0; this.since = 0; this.value = 0; }
  add(now, n = 1) {
    if (!this.since) { this.since = now; return; }
    this.count += n;
    const dt = now - this.since;
    if (dt >= 500) { this.value = (this.count * 1000) / dt; this.count = 0; this.since = now; }
  }
  read(now) {
    const dt = now - this.since;
    return this.since && dt > 1500 ? (this.count * 1000) / dt : this.value;
  }
}

// PoseEngine inside poseWorker.js. At most one frame is in flight, which keeps latency minimal.
class WorkerEngine {
  constructor() {
    this.mode = 'worker';
    this.delegate = null;
    this.pending = null;
    this.id = 0;
  }

  load(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_URL);   // classic worker, see poseWorker.js
      const fail = (err) => { clearTimeout(timer); worker.terminate(); reject(err); };
      const timer = setTimeout(() => fail(new Error('the tracking worker did not start')), timeoutMs);
      worker.onerror = (e) => {
        e.preventDefault();
        const message = e.message || 'the tracking worker failed';
        if (!this.worker) fail(new Error(message));
        else this.settle({ id: this.pending?.id, error: message });
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          clearTimeout(timer);
          this.worker = worker;
          this.delegate = data.delegate;
          resolve(this);
        } else if (data.type === 'error') {
          fail(new Error(data.message));
        } else if (data.type === 'result') {
          this.settle(data);
        }
      };
    });
  }

  // Resolves with { out, error, bitmap }: the bitmap comes back for the tracking view.
  detect(bitmap, ts, buffers) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending = { id, resolve };
      this.worker.postMessage({ type: 'frame', id, bitmap, ts, buffers }, [bitmap, ...buffers]);
    });
  }

  settle(data) {
    const p = this.pending;
    if (!p || p.id !== data.id) { data.bitmap?.close(); return; }   // a frame we stopped waiting for
    this.pending = null;
    if (data.out) this.delegate = data.out.delegate;
    p.resolve(data);
  }

  drop() {
    const p = this.pending;
    this.pending = null;
    p?.resolve({ out: null, error: 'the tracking worker stopped answering', bitmap: null });
  }
}

// The same engine on the main thread: the fallback when the worker cannot start.
class LocalEngine {
  constructor() { this.mode = 'main'; }
  async load() {
    const { PoseEngine } = await import('./poseEngine.js');
    this.engine = await new PoseEngine().load();
    return this;
  }
  get delegate() { return this.engine.delegate; }
  detect(image, ts) { return this.engine.detect(image, ts); }
  recycle(buffers) { this.engine.recycle(buffers); }
}

export class Tracker {
  constructor() {
    this.status = 'idle';     // idle | starting | running | paused | error
    this.error = null;
    this.lastError = null;    // { message, at }: something went wrong while running
    this.people = [];
    this.seq = 0;             // bumps with every analysed frame, whether or not anybody was in it
    this.motion = 0;          // how far the closest person moved since the previous frame, input px
    this.away = false;        // nobody in view for a while: detecting at AWAY_FPS
    this.resultAt = 0;        // when the frame behind `people` was grabbed (performance.now() ms)
    this.lastResultAt = 0;    // last time anybody was found
    this.lastGrabAt = 0;
    this.masks = [];          // reusable per-slot mask canvases
    this.frame = null;        // the frame the model analysed last (shown by the tracking view)
    this.fov = 62;
    this.mirror = true;
    this.useWorker = true;
    this.gen = 0;             // bumps on stop/pause so an in-flight start() knows to bail out
    this.busy = false;        // a frame is on its way through the worker
    this.flight = 0;
    this.spare = [];          // mask buffers to hand back to the engine for reuse
    this.presented = 0;       // camera frames presented so far (requestVideoFrameCallback)
    this.grabbed = -1;        // `presented` when the last frame was sent to the model
    this.captureTime = null;  // when the newest camera frame was captured, if the browser says
    this.cameraRate = new Rate();
    this.detectRate = new Rate();
    this.stats = { detectMs: null, latencyMs: null, cameraMs: null };
  }

  get mode() { return this.engine ? this.engine.mode : null; }
  get delegate() { return this.engine ? this.engine.delegate : null; }

  // Each start gets a generation number. stop()/pause() bump it, so a start that is still
  // waiting for the camera or the model knows it was cancelled and releases only what it
  // opened itself.
  async start() {
    if (this.status === 'running' || this.status === 'starting') return;
    const gen = ++this.gen;
    this.status = 'starting';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API is not available (needs https or localhost).');
      if (!(await this.openCamera(gen))) return;   // cancelled while opening
      await this.loadEngine();
      if (gen !== this.gen) return;                 // cancelled; pause()/stop() already closed the camera
      this.status = 'running';
    } catch (err) {
      if (gen !== this.gen) return;
      this.status = 'error';
      this.error = err;
      this.closeCamera();
      throw err;
    }
  }

  // One shared engine load, however many start() calls overlap. The engine stays loaded
  // after stop() so turning the webcam back on is instant.
  loadEngine() {
    if (this.engine) return Promise.resolve(this.engine);
    if (!this.loading) {
      const local = () => new LocalEngine().load();
      const engine = this.useWorker && typeof Worker !== 'undefined'
        ? new WorkerEngine().load().catch((err) => { this.workerError = err; return local(); })
        : local();
      this.loading = engine
        .then((e) => { this.engine = e; return e; })
        .finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  // Opens the webcam for generation `gen`. Returns false, releasing the stream it got,
  // if that generation was cancelled in the meantime.
  async openCamera(gen) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
    });
    const release = () => {
      if (this.stream === stream) this.closeCamera();
      else stopTracks(stream);
    };
    if (gen !== this.gen) { stopTracks(stream); return false; }
    if (this.stream && this.stream !== stream) stopTracks(this.stream);
    this.stream = stream;
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.setAttribute('playsinline', '');
    }
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (err) {
      release();
      if (gen !== this.gen) return false;
      throw err;
    }
    if (gen !== this.gen) { release(); return false; }
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    this.w = INPUT_W;
    this.h = Math.round((INPUT_W * vh) / vw);
    this.input = makeCanvas(this.w, this.h);
    this.inputCtx = this.input.getContext('2d', { willReadFrequently: false });
    this.grabbed = -1;
    this.watchFrames();
    return true;
  }

  // Count camera frames as they are presented. A live stream's currentTime moves on every tick,
  // so this is the only way to tell a new frame from one the model has already seen. Also
  // records when each frame was captured, for the latency readout.
  watchFrames() {
    const v = this.video;
    if (this.watching || !v.requestVideoFrameCallback) return;
    this.watching = true;
    const onFrame = (now, meta) => {
      const n = meta.presentedFrames ?? this.presented + 1;
      this.cameraRate.add(now, Math.max(1, n - this.presented));
      this.presented = n;
      this.captureTime = meta.captureTime ?? null;
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }

  closeCamera() {
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  // Release the webcam (LED off) while the wallpaper is paused or hidden.
  pause() {
    if (this.status !== 'running' && this.status !== 'starting') return;
    this.gen++;
    this.closeCamera();
    this.status = 'paused';
    this.people = [];
    this.setFrame(null);
  }

  // Throws if the camera cannot be reopened (e.g. another app took it meanwhile).
  resume() {
    if (this.status !== 'paused') return Promise.resolve();
    this.status = 'idle';
    return this.start();
  }

  stop() {
    this.gen++;
    this.closeCamera();
    this.status = 'idle';
    this.people = [];
    this.setFrame(null);
  }

  setFrame(frame) {
    if (this.frame && this.frame !== frame && typeof this.frame.close === 'function') this.frame.close();
    this.frame = frame;
  }

  // Called on every animation frame. Hands the newest camera frame to the model once the previous
  // one is done and the rate cap allows. Results land in `people`: right away on the main thread,
  // a few milliseconds later from the worker.
  detect(nowMs, maxFps) {
    if (this.status !== 'running' || !this.engine || !this.video || this.video.readyState < 2) return false;
    if (this.busy) {
      if (nowMs - this.busySince > STALL_MS) this.engine.drop();
      return false;
    }
    const main = this.engine.mode === 'main';
    let cap = main ? Math.min(maxFps, MAIN_THREAD_FPS) : maxFps;
    this.away = this.people.length === 0 && nowMs - this.lastResultAt > AWAY_MS;
    if (this.away) cap = Math.min(cap, AWAY_FPS);
    if (nowMs - this.lastGrabAt < 1000 / cap - 1) return false;
    if (this.presented > 0 && this.presented === this.grabbed) return false;   // nothing new from the camera
    this.grabbed = this.presented;
    this.lastGrabAt = nowMs;
    const capturedAt = this.captureTime;
    if (main) {
      this.inputCtx.drawImage(this.video, 0, 0, this.w, this.h);
      try {
        const out = this.engine.detect(this.input, nowMs);
        if (out) this.consume(out, nowMs, capturedAt, this.input);
      } catch (err) {
        this.fail(err);
      }
      this.engine.recycle(this.spare.splice(0));
      return true;
    }
    const gen = this.gen;
    const flight = ++this.flight;
    const engine = this.engine;
    const buffers = this.spare.splice(0);
    this.busy = true;
    this.busySince = nowMs;
    createImageBitmap(this.video, { resizeWidth: this.w, resizeHeight: this.h, resizeQuality: 'medium' })
      .then((bitmap) => engine.detect(bitmap, nowMs, buffers))
      .then(({ out, error, bitmap }) => {
        if (gen !== this.gen) { bitmap?.close(); return; }
        if (error) this.fail(new Error(error));
        if (out) this.consume(out, nowMs, capturedAt, bitmap);
        else bitmap?.close();
      })
      .catch((err) => { if (gen === this.gen) this.fail(err); })
      .finally(() => { if (flight === this.flight) this.busy = false; });
    return true;
  }

  // Largest movement of a well-seen landmark of the closest person since the previous analysed
  // frame, in input px; Infinity when someone arrived or left.
  measureMotion(before, after) {
    if (before.length !== after.length) return Infinity;
    if (!after.length) return 0;
    const a = before[0].lm;
    const b = after[0].lm;
    let most = 0;
    for (const k of MOTION_KEYS) {
      if ((a[k].visibility ?? 1) < 0.5 || (b[k].visibility ?? 1) < 0.5) continue;
      most = Math.max(most, Math.hypot((b[k].x - a[k].x) * this.w, (b[k].y - a[k].y) * this.h));
    }
    return most;
  }

  fail(err) {
    this.error = err;
    this.lastError = { message: String((err && err.message) || err), at: performance.now() };
  }

  slot(i, w, h) {
    let s = this.masks[i];
    if (!s || s.w !== w || s.h !== h) {
      const canvas = makeCanvas(w, h);
      s = { w, h, canvas, ctx: canvas.getContext('2d') };
      this.masks[i] = s;
    }
    return s;
  }

  consume(out, grabbedAt, capturedAt, frame) {
    const now = performance.now();
    const people = [];
    const f = (this.w / 2) / Math.tan(((this.fov * Math.PI) / 180) / 2); // focal length, input px
    const sign = this.mirror ? -1 : 1;
    out.people.forEach((r, i) => {
      const { lm, w: mw, h: mh } = r;
      const s = this.slot(i, mw, mh);
      s.ctx.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), mw, mh), 0, 0);
      this.spare.push(r.rgba);

      // Eyes (pose landmarks 2 and 5) → head position and distance.
      const le = lm[2];
      const re = lm[5];
      const eu = ((le.x + re.x) / 2) * mw;
      const ev = ((le.y + re.y) / 2) * mh;
      // Which way the head points. Yaw + = the user's right and roll + = tilted toward the
      // user's right shoulder (like X below, flipped for a raw image); pitch + = looking up.
      const pose = headPose(lm, this.w, this.h);
      const yaw = pose === null ? null : sign * pose.yaw;
      const pitch = pose === null ? null : pose.pitch;
      const roll = pose === null ? null : sign * pose.roll;
      // A turned head foreshortens the eye distance; undo that before reading distance from it.
      const eyePx = Math.hypot((le.x - re.x) * this.w, (le.y - re.y) * this.h) / Math.max(0.5, Math.cos(yaw ?? 0));
      // Shoulder width as a second opinion when the head is turned (eyes foreshortened).
      const sw = Math.hypot((lm[11].x - lm[12].x) * this.w, (lm[11].y - lm[12].y) * this.h);
      const dEyes = (f * IPD) / Math.max(eyePx, 1);
      const dShoulders = (f * 0.39) / Math.max(sw, 1);
      const shouldersVisible = (lm[11].visibility ?? 1) > 0.5 && (lm[12].visibility ?? 1) > 0.5;
      let d = shouldersVisible ? Math.min(dEyes, dShoulders * 1.15) : dEyes;
      d = Math.min(2.2, Math.max(0.3, d));
      const mpp = (d / f) * (this.w / mw);

      // Physical head offset from the camera axis, metres (x: user's right = +, y: up = +).
      const X = sign * (eu / mw - 0.5) * this.w * (d / f);
      const Y = (0.5 - ev / mh) * this.h * (d / f);

      people.push({ canvas: s.canvas, mw, mh, eu, ev, mpp, d, X, Y, yaw, pitch, roll, eyePx, cut: r.cut, lm });
    });
    // Closest person first.
    people.sort((a, b) => a.d - b.d);
    this.motion = this.measureMotion(this.people, people);
    this.people = people;
    this.seq++;
    this.resultAt = grabbedAt;
    if (people.length) { this.lastResultAt = now; this.away = false; }
    this.setFrame(frame);
    this.detectRate.add(now);
    this.stats.detectMs = ema(this.stats.detectMs, out.ms);
    this.stats.latencyMs = ema(this.stats.latencyMs, now - grabbedAt);
    if (capturedAt != null && capturedAt <= grabbedAt) this.stats.cameraMs = ema(this.stats.cameraMs, grabbedAt - capturedAt);
  }
}
