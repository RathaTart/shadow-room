// MediaPipe Pose Landmarker, shared by the tracking worker (poseWorker.js) and the main-thread
// fallback. Turns one frame into, per person, the 33 pose landmarks, a soft white RGBA body mask
// and where the frame cuts the body off at the bottom. No DOM access, so it runs in either place.
import { webglIsSoftware } from './gpu.js';

const VISION_URL = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href;
const WASM_URL = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_URL = new URL('../vendor/models/pose_landmarker_lite.task', import.meta.url).href;

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.lastTs = 0;
    this.prev = [];           // per-slot temporal smoothing state
    this.pool = [];           // RGBA buffers the consumer handed back for reuse
  }

  options(delegate) {
    return {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 2,
      outputSegmentationMasks: true,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
  }

  async load() {
    this.vision = await import(VISION_URL);
    this.fileset = await this.vision.FilesetResolver.forVisionTasks(WASM_URL);
    // On a software WebGL (graphics acceleration off) the "GPU" model is emulated on the CPU and
    // takes most of a second per frame; MediaPipe's real CPU path is many times faster there.
    this.softwareGL = webglIsSoftware();
    if (!this.softwareGL) {
      try {
        this.landmarker = await this.vision.PoseLandmarker.createFromOptions(this.fileset, this.options('GPU'));
        this.delegate = 'GPU';
        return this;
      } catch { /* no usable WebGL2 here: CPU below */ }
    }
    this.landmarker = await this.vision.PoseLandmarker.createFromOptions(this.fileset, this.options('CPU'));
    this.delegate = 'CPU';
    return this;
  }

  // Analyse one frame. Returns null while the engine is switching delegates.
  detect(image, tsMs) {
    if (!this.landmarker || this.switching) return null;
    const ts = Math.max(this.lastTs + 1, Math.round(tsMs));
    this.lastTs = ts;
    const t0 = performance.now();
    let people = [];
    // The callback runs synchronously; the masks are only valid inside it.
    this.landmarker.detectForVideo(image, ts, (result) => { people = this.consume(result); });
    return { people, ms: performance.now() - t0, delegate: this.delegate };
  }

  recycle(buffers) {
    for (const b of buffers) if (b && b.byteLength && this.pool.length < 4) this.pool.push(b);
  }

  takeBuffer(bytes) {
    const i = this.pool.findIndex((b) => b.byteLength === bytes);
    if (i >= 0) return new Uint8ClampedArray(this.pool.splice(i, 1)[0]);
    return new Uint8ClampedArray(bytes).fill(255);   // RGB stays white; only alpha is rewritten
  }

  consume(result) {
    const people = [];
    const n = result.landmarks ? result.landmarks.length : 0;
    for (let i = 0; i < n; i++) {
      const lm = result.landmarks[i];
      const mask = result.segmentationMasks && result.segmentationMasks[i];
      if (!lm || !mask) continue;
      const w = mask.width;
      const h = mask.height;
      const data = this.readMask(mask, lm);
      if (!data) continue;
      if (!this.prev[i] || this.prev[i].length !== w * h) this.prev[i] = new Float32Array(w * h);
      const prev = this.prev[i];
      const px = this.takeBuffer(w * h * 4);
      // Temporal smoothing + contrast curve for a clean edge.
      for (let k = 0; k < data.length; k++) {
        const v = prev[k] * 0.3 + data[k] * 0.7;
        prev[k] = v;
        px[k * 4 + 3] = v <= 0.3 ? 0 : v >= 0.7 ? 255 : ((v - 0.3) * 637.5) | 0;
      }
      people.push({
        lm: lm.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
        w, h, rgba: px.buffer, cut: findCut(data, w, h),
      });
    }
    return people;
  }

  // Mask → Float32Array (one value per pixel, top row first).
  // With the GPU delegate the mask only lives in a WebGL texture. On ANGLE/Direct3D
  // (Chrome, Edge and WebView2 on Windows) that texture is RGBA8, so MediaPipe's own
  // float readback fails with INVALID_OPERATION and returns zeros. Read it ourselves in
  // whatever format the implementation says it supports.
  readMask(mask, lm) {
    let data = null;
    if (mask.hasFloat32Array() || !mask.hasWebGLTexture()) data = mask.getAsFloat32Array();
    else data = this.readMaskTexture(mask) || mask.getAsFloat32Array();
    const w = mask.width;
    const h = mask.height;
    // Sanity check against the landmarks: the eyes and shoulders should be inside the mask.
    const probe = (flip) => {
      let sum = 0;
      for (const k of [0, 11, 12]) {
        const x = Math.min(w - 1, Math.max(0, Math.round(lm[k].x * w)));
        let y = Math.min(h - 1, Math.max(0, Math.round(lm[k].y * h)));
        if (flip) y = h - 1 - y;
        sum += data[y * w + x];
      }
      return sum / 3;
    };
    const direct = probe(false);
    if (this.flipY === undefined) {
      const flipped = probe(true);
      if (Math.abs(direct - flipped) > 0.25) {
        this.flipVotes = (this.flipVotes || 0) + (flipped > direct ? 1 : -1);
        if (Math.abs(this.flipVotes) >= 3) this.flipY = this.flipVotes > 0;
      }
    }
    if (this.flipY) data = this.flipRows(data, w, h);
    // Masks that stay empty while a person is tracked mean the GPU path is broken here.
    const best = Math.max(direct, this.flipY ? probe(false) : 0);
    this.emptyMasks = best < 0.05 ? (this.emptyMasks || 0) + 1 : 0;
    if (this.emptyMasks > 12 && this.delegate === 'GPU' && !this.switching) this.switchToCpu();
    return data;
  }

  readMaskTexture(mask) {
    const canvas = mask.canvas;
    const gl = canvas && canvas.getContext('webgl2');
    if (!gl) return null;
    const tex = mask.getAsWebGLTexture();
    const w = mask.width;
    const h = mask.height;
    if (!this.gl || this.gl.ctx !== gl) {
      gl.getExtension('EXT_color_buffer_float');
      this.gl = { ctx: gl, fb: gl.createFramebuffer() };
    }
    while (gl.getError() !== gl.NO_ERROR) { /* clear stale errors from other users of the context */ }
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gl.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    const n = w * h;
    if (!this.single || this.single.length !== n) this.single = new Float32Array(n);
    if (ok) {
      const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
      if (type === gl.FLOAT) {
        if (!this.rgbaF || this.rgbaF.length !== n * 4) this.rgbaF = new Float32Array(n * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, this.rgbaF);
        ok = gl.getError() === gl.NO_ERROR;
        if (ok) for (let i = 0; i < n; i++) this.single[i] = this.rgbaF[i * 4];
      } else {
        if (!this.rgba8 || this.rgba8.length !== n * 4) this.rgba8 = new Uint8Array(n * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba8);
        ok = gl.getError() === gl.NO_ERROR;
        if (ok) for (let i = 0; i < n; i++) this.single[i] = this.rgba8[i * 4] / 255;
      }
    }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    return ok ? this.single : null;
  }

  flipRows(data, w, h) {
    if (!this.flipped || this.flipped.length !== w * h) this.flipped = new Float32Array(w * h);
    for (let y = 0; y < h; y++) this.flipped.set(data.subarray((h - 1 - y) * w, (h - y) * w), y * w);
    return this.flipped;
  }

  async switchToCpu() {
    this.switching = true;
    try {
      const next = await this.vision.PoseLandmarker.createFromOptions(this.fileset, this.options('CPU'));
      this.landmarker?.close();
      this.landmarker = next;
      this.delegate = 'CPU';
      this.flipY = undefined;
      this.flipVotes = 0;
      this.lastTs = 0;
    } catch (err) {
      this.error = err;
    } finally {
      this.switching = false;
      this.emptyMasks = 0;
    }
  }
}

// Where does the frame cut the body? Longest run of mask pixels on the bottom rows.
function findCut(data, w, h) {
  const row = (h - 2) * w;
  let bestL = -1;
  let bestR = -1;
  let runL = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && data[row + x] > 0.5;
    if (on && runL < 0) runL = x;
    if (!on && runL >= 0) {
      if (x - runL > bestR - bestL) { bestL = runL; bestR = x; }
      runL = -1;
    }
  }
  return bestR - bestL > 3 ? { uL: bestL, uR: bestR, v: h - 1 } : null;
}
