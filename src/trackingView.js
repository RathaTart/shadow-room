// Tracking view (top right; key V or the "Show tracking view" setting). Shows the frame the pose
// model analysed and what it found in it, where it puts your head, and how long every stage
// takes, so lag can be pinned on the webcam, the tracker or the renderer.
import { rendererName, isSoftware, gpuName } from './gpu.js';

const W = 256;            // CSS px; the model analyses 256 px wide frames, so they show 1:1
const CAM_H = 192;
const MAP = 96;
const GRAPH_H = 60;
const SPAN = 4000;        // ms of history in the graph

const C = {
  bg: '#0b0a09',
  masks: ['#4fd1c5', '#b794f4'],
  bone: 'rgba(255, 236, 210, 0.6)',
  face: '#9ad7ff',
  ears: '#ffb86b',
  head: '#ffb86b',
  x: '#6cb6ff',
  yaw: '#7bd88f',
  frame: 'rgba(234, 227, 216, 0.4)',
  late: '#ff7a6b',
  idle: 'rgba(120, 150, 190, 0.45)',
  grid: 'rgba(255, 236, 210, 0.16)',
  text: '#eae3d8',
  muted: '#a79d90',
};
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
const FACE = [0, 2, 5, 9, 10];
const ROWS = ['render', 'camera', 'track', 'lag', 'head', 'turn', 'view', 'cat'];
const CAT = {
  sleep: 'asleep', rest: 'awake on sofa', stretch: 'stretching', jump: 'jumping', chase: 'chasing the dot',
  crouch: 'about to pounce', play: 'got it!', goto: 'walking', flee: 'running away!', hide: 'hiding',
  sit: 'sitting', paw: 'pawing curtain', watch: 'watching TV', off: 'off',
};
const DEG = 180 / Math.PI;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}`;
const grade = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'bad');

// Fixed-size history of timestamped samples.
class Ring {
  constructor(size, fields) {
    this.size = size;
    this.count = 0;
    this.next = 0;
    this.t = new Float64Array(size);
    this.fields = fields;
    for (const f of fields) this[f] = new Float32Array(size);
  }
  push(t, ...values) {
    const i = this.next;
    this.t[i] = t;
    this.fields.forEach((f, k) => { this[f][i] = values[k]; });
    this.next = (i + 1) % this.size;
    this.count = Math.min(this.size, this.count + 1);
  }
  // Oldest first, only samples newer than `since`.
  each(since, fn) {
    for (let n = 0; n < this.count; n++) {
      const i = (this.next - this.count + n + this.size) % this.size;
      if (this.t[i] >= since) fn(i);
    }
  }
}

export class TrackingView {
  constructor(root, { renderer, tracker, settings, profile, pose }) {
    this.renderer = renderer;
    this.tracker = tracker;
    this.settings = settings;
    this.profile = profile;
    this.pose = pose;         // () => { source, paused, head, neutral, follow, look }
    this.el = document.createElement('div');
    this.el.className = 'tracking';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <canvas class="cam"></canvas>
      <div class="row"><canvas class="map"></canvas><div class="stats"></div></div>
      <canvas class="graph"></canvas>
      <div class="hint"></div>
      <div class="foot"></div>`;
    root.appendChild(this.el);
    this.cam = this.panel('.cam', W, CAM_H);
    this.map = this.panel('.map', MAP, MAP);
    this.graph = this.panel('.graph', W, GRAPH_H);
    this.hintEl = this.el.querySelector('.hint');
    this.footEl = this.el.querySelector('.foot');
    this.rows = {};
    const stats = this.el.querySelector('.stats');
    for (const k of ROWS) {
      const row = document.createElement('div');
      const key = document.createElement('span');
      key.className = 'k';
      key.textContent = k;
      const value = document.createElement('span');
      row.append(key, value);
      stats.appendChild(row);
      this.rows[k] = value;
    }
    // target: the frame time aimed for (the cap, or the idle rate while nothing moves)
    this.frames = new Ring(512, ['interval', 'target', 'cpu', 'x', 'yaw']);
    this.samples = new Ring(256, ['x', 'yaw']);
    this.fps = 0;             // over the last second (not a long average: start-up would linger)
    this.cpu = 0;
    this.late = 0;            // frames that came late in the graph's span
    this.onPace = 1;
    this.awake = true;        // full frame rate on (false: idling because nothing moves)
    this.aimFps = 0;
    this.tints = [];
    this.lastText = 0;
    const raw = rendererName(renderer.getContext());
    this.gpu = gpuName(raw);
    this.software = isSoftware(raw);   // graphics acceleration off: rendering on the CPU
    this.shown = false;
  }

  panel(selector, w, h) {
    const canvas = this.el.querySelector(selector);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    return { canvas, ctx: canvas.getContext('2d'), w, h, dpr: 0 };
  }

  get visible() { return this.shown; }
  set visible(v) {
    this.shown = !!v;
    this.el.classList.toggle('show', this.shown);
    this.lastText = 0;
  }

  // A newly analysed frame: the raw head offset and turn (relative to rest), for the graph.
  sample(now, x, yaw) {
    this.samples.push(now, x, yaw);
  }

  // Every rendered frame: record timings, and redraw when shown. `fps` is the rate aimed for
  // (lower while idle), `awake` whether the full rate was on.
  frame(now, interval, cpu, fps, awake) {
    const pose = this.pose();
    this.awake = awake;
    this.aimFps = fps;
    if (interval > 0 && interval < 1000) this.frames.push(now, interval, 1000 / fps, cpu, pose.follow.x, pose.follow.yaw);
    if (!this.shown) return;
    this.drawCamera(pose);
    this.drawMap(pose);
    this.drawGraph(now);
    if (now - this.lastText > 250) {
      this.lastText = now;
      this.drawText(now, pose);
    }
  }

  begin(p) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (p.dpr !== dpr) {
      p.dpr = dpr;
      p.canvas.width = Math.round(p.w * dpr);
      p.canvas.height = Math.round(p.h * dpr);
    }
    const ctx = p.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, p.w, p.h);
    return ctx;
  }

  // ------------------------------------------------------------------ what the camera sees
  drawCamera(pose) {
    const ctx = this.begin(this.cam);
    const t = this.tracker;
    const frame = pose.source === 'camera' && !pose.paused ? t.frame : null;
    if (!frame) { this.message(ctx, this.idleMessage(pose)); return; }
    const fh = Math.min(CAM_H, (W * frame.height) / frame.width);
    const y0 = (CAM_H - fh) / 2;
    // Shown like a mirror: your right is on the right, the way the room moves with you.
    const mirror = this.settings.get('mirror');
    const px = (u) => (mirror ? 1 - u : u) * W;
    const py = (v) => y0 + v * fh;
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.globalAlpha = 0.85;
    ctx.drawImage(frame, 0, y0, W, fh);
    ctx.globalAlpha = 0.4;
    t.people.forEach((p, i) => ctx.drawImage(this.tint(p, i), 0, y0, W, fh));   // becomes your shadow
    ctx.restore();

    t.people.forEach((p, i) => this.drawPerson(ctx, p, i, px, py));
    if (t.people.length && pose.neutral.set) {
      // Where "centred" is (the rest position) and how far the head is from it.
      const p = t.people[0];
      const tan = Math.tan((t.fov * Math.PI) / 360);
      const d = pose.head.d;
      const nx = (0.5 + pose.neutral.X / (2 * d * tan)) * W;
      const ny = py(0.5 - (pose.neutral.Y * (t.w / t.h)) / (2 * d * tan));
      const hx = (px(p.lm[2].x) + px(p.lm[5].x)) / 2;
      const hy = (py(p.lm[2].y) + py(p.lm[5].y)) / 2;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = C.text;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(nx, ny, 7, 0, Math.PI * 2);
      ctx.moveTo(nx, ny);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.restore();
    }
    if (!t.people.length) this.message(ctx, 'Nobody detected', true);
  }

  idleMessage(pose) {
    const t = this.tracker;
    if (pose.paused) return 'Paused';
    if (pose.source === 'camera') return 'Warming up the pose model…';
    if (t.status === 'starting') return 'Starting the webcam…';
    if (t.status === 'error') return 'Webcam unavailable (demo)';
    return 'Demo figure · webcam off';
  }

  message(ctx, text, banner = false) {
    ctx.save();
    ctx.font = '12px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (banner) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, CAM_H - 24, W, 24);
      ctx.fillStyle = C.text;
      ctx.fillText(text, W / 2, CAM_H - 12);
    } else {
      ctx.fillStyle = C.muted;
      ctx.fillText(text, W / 2, CAM_H / 2);
    }
    ctx.restore();
  }

  // The person's mask in a flat colour (cached per analysed frame).
  tint(p, i) {
    const seq = this.tracker.seq;
    let t = this.tints[i];
    if (!t) t = this.tints[i] = { canvas: document.createElement('canvas'), seq: -1 };
    if (t.seq !== seq) {
      t.seq = seq;
      const c = t.canvas;
      if (c.width !== p.mw || c.height !== p.mh) { c.width = p.mw; c.height = p.mh; }
      const x = c.getContext('2d');
      x.globalCompositeOperation = 'copy';
      x.drawImage(p.canvas, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = C.masks[i % C.masks.length];
      x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-over';
    }
    return t.canvas;
  }

  drawPerson(ctx, p, i, px, py) {
    const lm = p.lm;
    const seen = (k) => (lm[k].visibility ?? 1) >= 0.3;
    const dot = (k, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px(lm[k].x), py(lm[k].y), r, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.save();
    ctx.globalAlpha = i === 0 ? 1 : 0.55;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.bone;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      if (!seen(a) || !seen(b)) continue;
      ctx.moveTo(px(lm[a].x), py(lm[a].y));
      ctx.lineTo(px(lm[b].x), py(lm[b].y));
    }
    ctx.stroke();
    // Ear-to-ear axis: head turn is read from where the face sits along it.
    ctx.strokeStyle = C.ears;
    ctx.beginPath();
    ctx.moveTo(px(lm[7].x), py(lm[7].y));
    ctx.lineTo(px(lm[8].x), py(lm[8].y));
    ctx.stroke();
    dot(7, 2.5, C.ears);
    dot(8, 2.5, C.ears);
    for (const k of FACE) dot(k, k === 0 ? 2.5 : 1.8, C.face);

    // Head position for the 3D window: midway between the eyes.
    const hx = (px(lm[2].x) + px(lm[5].x)) / 2;
    const hy = (py(lm[2].y) + py(lm[5].y)) / 2;
    ctx.strokeStyle = C.head;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.moveTo(hx - 9, hy); ctx.lineTo(hx - 3, hy);
    ctx.moveTo(hx + 3, hy); ctx.lineTo(hx + 9, hy);
    ctx.moveTo(hx, hy - 9); ctx.lineTo(hx, hy - 3);
    ctx.stroke();

    // Where the head points, as an arrow from the nose (your right is on the right here; up is up).
    if (p.yaw !== null) {
      const nx = px(lm[0].x);
      const ny = py(lm[0].y);
      const dx = 40 * Math.sin(p.yaw);
      const dy = -40 * Math.sin(p.pitch - (i === 0 && this.restPitch !== undefined ? this.restPitch : 0));
      ctx.strokeStyle = C.yaw;
      ctx.fillStyle = C.yaw;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(nx + dx, ny + dy);
      ctx.stroke();
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const ux = dx / len;
        const uy = dy / len;
        ctx.beginPath();
        ctx.moveTo(nx + dx + ux * 4, ny + dy + uy * 4);
        ctx.lineTo(nx + dx - ux * 2 - uy * 3.5, ny + dy - uy * 2 + ux * 3.5);
        ctx.lineTo(nx + dx - ux * 2 + uy * 3.5, ny + dy - uy * 2 - ux * 3.5);
        ctx.fill();
      }
    }
    ctx.font = '10px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = C.text;
    ctx.fillText(`${i === 0 ? 'you' : `#${i + 1}`} ${Math.round(p.d * 100)} cm`, hx, Math.max(10, hy - 26));
    ctx.restore();
  }

  // ------------------------------------------------------------------ where you are (top down)
  drawMap(pose) {
    const ctx = this.begin(this.map);
    const t = this.tracker;
    const ox = MAP / 2;
    const oy = 9;
    const ppm = 52;          // px per metre
    const half = (t.fov * Math.PI) / 360;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Webcam field of view, and rings every half metre from the webcam.
    ctx.moveTo(ox, oy); ctx.lineTo(ox - Math.tan(half) * 120, oy + 120);
    ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.tan(half) * 120, oy + 120);
    ctx.stroke();
    for (const r of [0.5, 1, 1.5]) {
      ctx.beginPath();
      ctx.arc(ox, oy, r * ppm, 0, Math.PI);
      ctx.stroke();
    }
    ctx.font = '9px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.fillStyle = C.muted;
    ctx.fillText('0.5', ox + 0.5 * ppm - 14, oy + 9);
    ctx.fillText('1 m', ox + ppm - 18, oy + 9);
    // The screen, with the webcam on top of it.
    const sw = (this.settings.get('screenWidthCm') / 100) * ppm;
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox - sw / 2, oy - 4);
    ctx.lineTo(ox + sw / 2, oy - 4);
    ctx.stroke();
    ctx.fillStyle = C.face;
    ctx.beginPath();
    ctx.arc(ox, oy - 4, 2, 0, Math.PI * 2);
    ctx.fill();

    if (pose.source !== 'camera' || pose.paused || !t.people.length) return;
    const at = (X, d) => [ox + X * ppm, oy + d * ppm];
    for (const p of t.people.slice(1)) this.head(ctx, ...at(p.X, p.d), p.yaw ?? 0, ox, oy, C.muted, true);
    if (pose.neutral.set) this.head(ctx, ...at(pose.neutral.X, pose.neutral.d), pose.neutral.yaw, ox, oy, C.text, true);
    this.head(ctx, ...at(pose.head.X, pose.head.d), pose.head.yaw, ox, oy, C.head, false);
  }

  // A head seen from above, facing the webcam turned by `yaw` (+ = the user's right).
  head(ctx, x, y, yaw, cx, cy, color, ghost) {
    let fx = cx - x;
    let fy = cy - y;
    const n = Math.hypot(fx, fy) || 1;
    fx /= n;
    fy /= n;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dx = fx * c - fy * s;
    const dy = fx * s + fy * c;
    ctx.save();
    ctx.globalAlpha = ghost ? 0.5 : 1;
    if (ghost) ctx.setLineDash([2, 2]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.moveTo(x + dx * 5, y + dy * 5);
    ctx.lineTo(x + dx * 13, y + dy * 13);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ the last few seconds
  drawGraph(now) {
    const ctx = this.begin(this.graph);
    const since = now - SPAN;
    const tx = (t) => W - ((now - t) / SPAN) * W;
    // Top lane: head offset (x, ±10 cm) and turn (±25°), both relative to rest. Dots are what
    // the tracker measured; lines are what the view followed. The gap between them is smoothing lag.
    const mid = 21;
    const kx = 17 / 0.1;
    const ky = 17 / (25 / DEG);
    const yx = (v) => clamp(mid - v * kx, 2, 40);
    const yy = (v) => clamp(mid - v * ky, 2, 40);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(W, mid + 0.5);
    ctx.stroke();
    for (const [field, color, y] of [['x', C.x, yx], ['yaw', C.yaw, yy]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      this.frames.each(since, (i) => {
        const X = tx(this.frames.t[i]);
        const Y = y(this.frames[field][i]);
        if (first) { ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.fillStyle = color;
      this.samples.each(since, (i) => ctx.fillRect(tx(this.samples.t[i]) - 1, y(this.samples[field][i]) - 1, 2, 2));
    }
    // Bottom lane: time between rendered frames; red when a frame came late, blue while idling
    // on purpose (nothing moving, so fewer frames).
    const base = GRAPH_H - 1;
    const lane = 16;
    const cap = 1000 / Math.max(10, this.settings.get('fpsCap'));
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(0, base - lane / 2 + 0.5);
    ctx.lineTo(W, base - lane / 2 + 0.5);
    ctx.stroke();
    let late = 0;
    this.frames.each(since, (i) => {
      const iv = this.frames.interval[i];
      const target = this.frames.target[i];
      const h = Math.min(lane, (iv / (2 * cap)) * lane);
      const isLate = iv > target * 1.5;
      if (isLate) late++;
      ctx.fillStyle = isLate ? C.late : target > cap * 1.2 ? C.idle : C.frame;
      ctx.fillRect(tx(this.frames.t[i]) - 0.5, base - h, 1, h);
    });
    this.late = late;
    ctx.font = '9px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.fillStyle = C.x;
    ctx.fillText('x', 3, 9);
    ctx.fillStyle = C.yaw;
    ctx.fillText('turn', 11, 9);
    ctx.fillStyle = late ? C.late : C.muted;
    ctx.fillText(late ? `frame time · ${late} late in ${SPAN / 1000} s` : 'frame time', 3, base - lane - 1);
  }

  // ------------------------------------------------------------------ numbers + diagnosis
  drawText(now, pose) {
    const t = this.tracker;
    const s = this.settings;
    const cap = Math.max(10, s.get('fpsCap'));
    let n = 0;
    let span = 0;
    let aimed = 0;
    let cpu = 0;
    this.frames.each(now - 1000, (i) => { n++; span += this.frames.interval[i]; aimed += this.frames.target[i]; cpu += this.frames.cpu[i]; });
    const fps = span ? (n * 1000) / span : 0;
    this.fps = fps;
    this.cpu = n ? cpu / n : 0;
    // How close to the rate aimed for (the cap, or the idle rate): 1 = on target.
    const onPace = span ? aimed / span : 1;
    this.onPace = onPace;
    const late = this.late || 0;
    // 80%: a cap that does not divide the display's refresh rate lands a little under it (75 Hz → 25 fps).
    this.set('render', `${fps.toFixed(0)}fps${this.awake ? '' : ' idle'} ${this.cpu.toFixed(1)}ms`,
      grade(onPace >= 0.8, onPace >= 0.6));

    const live = pose.source === 'camera' && !pose.paused && t.status === 'running';
    const camFps = t.cameraRate.read(now);
    const detFps = t.detectRate.read(now);
    const { detectMs, latencyMs, cameraMs } = t.stats;
    const lag = (latencyMs ?? 0) + (cameraMs ?? 0);
    const turnOn = s.get('headTurn') > 0;
    if (live) {
      const v = t.video;
      this.set('camera', `${camFps.toFixed(0)}fps ${v.videoWidth}×${v.videoHeight}`, grade(camFps >= 24, camFps >= 15));
      // While nobody is in view (away) detections are rare, the GPU clocks down and each one takes
      // longer; that is not a problem, so only the delegate is graded then.
      this.set('track', `${detFps.toFixed(0)}/s ${(detectMs ?? 0).toFixed(0)}ms ${t.delegate}`,
        t.away ? grade(t.delegate === 'GPU', true) : grade(t.delegate === 'GPU' && (detectMs ?? 0) <= 25, (detectMs ?? 0) <= 50));
      // tracker (frame grabbed → result) · camera (frame captured → grabbed)
      this.set('lag', `${(latencyMs ?? 0).toFixed(0)}ms${cameraMs != null ? ` · cam ${cameraMs.toFixed(0)}ms` : ''}`, grade(lag <= 80, lag <= 150));
    } else {
      this.set('camera', t.status === 'starting' ? 'starting…' : 'off', '');
      this.set('track', t.mode ? `idle · ${t.delegate}` : '—', '');
      this.set('lag', '—', '');
    }
    const person = live && t.people.length > 0 && pose.neutral.set;
    const deg = (r) => `${signed(Math.round(r * DEG))}°`;
    this.restPitch = pose.neutral.set ? pose.neutral.pitch : undefined;
    if (person) {
      const cm = (m) => signed(Math.round(m * 100));
      this.set('head', `x${cm(pose.head.X)} y${cm(pose.head.Y)} z${Math.round(pose.head.d * 100)}cm`, '');
      // Your head's turn/nod from rest, and where that points the view (left-right/up-down).
      this.set('turn', `${deg(pose.head.yaw - pose.neutral.yaw)} ${deg(pose.head.pitch - pose.neutral.pitch)} r${deg(pose.head.roll - pose.neutral.roll)}`, '');
      this.set('view', turnOn ? `${deg(pose.look)} ${deg(pose.lookPitch)}${s.get('lookAll') ? '' : ' (±40°)'}` : 'fixed (turn off)', '');
    } else {
      this.set('head', '—', '');
      this.set('turn', '—', '');
      this.set('view', turnOn ? '—' : 'fixed (turn off)', '');
    }
    this.set('cat', CAT[pose.catMode] || pose.catMode, pose.catMode === 'flee' ? 'warn' : pose.catMode === 'play' ? 'ok' : '');

    const [hint, cls] = this.diagnose(now, { live, fps, onPace, cap, late, camFps, lag, person });
    if (this.hintEl.textContent !== hint) this.hintEl.textContent = hint;
    this.hintEl.className = `hint ${cls}`;
    const buf = this.renderer.domElement;
    const foot = `${buf.width}×${buf.height} ${s.get('quality')} · ${t.mode === 'main' ? 'main thread' : t.mode || 'no tracker'} · ${this.software ? 'NO GPU: ' : ''}${this.gpu}`;
    if (this.footEl.textContent !== foot) this.footEl.textContent = foot;
    this.footEl.classList.toggle('bad', this.software);
  }

  // The most likely culprit, worst first.
  diagnose(now, { live, fps, onPace, cap, late, camFps, lag, person }) {
    const t = this.tracker;
    const frameMs = 1000 / cap;
    // Worst of all, and the page cannot fix it: no GPU, so everything renders on the CPU.
    if (this.software) return ['NO GPU: graphics acceleration is off in this browser. Turn it on (Settings → System) and relaunch', 'bad'];
    if (t.lastError && now - t.lastError.at < 10000) return [`Tracker error: ${t.lastError.message}`, 'bad'];
    if (fps > 0 && onPace < 0.6) {
      // Main-thread detection is not part of `cpu` (it runs outside the render step).
      if (live && t.mode === 'main') return ['Tracking on the main thread slows rendering', 'bad'];
      return this.cpu > frameMs * 0.7
        ? [`Main thread busy (${this.cpu.toFixed(0)} ms/frame): lower Quality`, 'bad']
        : ['GPU can’t keep up: try Quality Low or a lower FPS cap', 'bad'];
    }
    if (!live) return [fps ? 'Rendering OK · webcam not in use' : '', ''];
    if (t.seq === 0) return ['Pose model warming up (first frame takes a few s)', 'warn'];
    // Structural problems first (the camera row already shows a slow webcam in amber).
    if (t.mode === 'main') {
      return [t.workerError ? `Worker failed (${t.workerError.message}): tracking shares the main thread`
        : 'Tracking shares the main thread (?worker=0)', 'warn'];
    }
    if (t.delegate === 'CPU') return ['Pose model fell back to the CPU: slower tracking', 'warn'];
    if (camFps > 0 && camFps < 20) return [`Webcam gives only ${camFps.toFixed(0)} fps (usually too little light on you)`, 'warn'];
    if (lag > 150) return ['Tracking is slow: see lag', 'warn'];
    if (late >= 4) return ['Some frames came late: another app busy?', 'warn'];
    if (!person) return [t.away ? 'Nobody in view: checking 6×/s until someone shows up' : 'Nobody detected: face the webcam, light on you', ''];
    return [this.awake ? 'All stages OK' : `All OK · idling at ${Math.round(this.aimFps)} fps until you move`, 'ok'];
  }

  set(row, text, cls) {
    const el = this.rows[row];
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
  }
}
