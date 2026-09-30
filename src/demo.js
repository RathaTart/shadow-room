// Demo figure used when there is no webcam: a choreographed silhouette that walks around
// the doorway and "touches" things with its shadow. The mouse can take over the figure.

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Arm angles: [shoulder, elbow]; shoulder 0 = hanging down, PI = straight up.
// Positive x = the viewer's right (the shadow is seen from behind, so it is not mirrored).
const KEYS = [
  { t: 0,  x: 0.0,   L: [0.18, 0.15], R: [0.18, 0.15], wave: 0 },
  { t: 3,  x: 0.0,   L: [0.2, 0.2],   R: [0.2, 0.2],   wave: 0 },
  { t: 5,  x: -0.05, L: [2.95, 0.05], R: [0.25, 0.2],  wave: 0 },   // reach up: swat the pendant lamp
  { t: 7,  x: -0.05, L: [2.7, 0.35],  R: [0.25, 0.2],  wave: 1 },
  { t: 9,  x: -0.05, L: [2.8, 0.2],   R: [0.25, 0.2],  wave: 1 },
  { t: 10.5, x: 0.0, L: [0.2, 0.2],   R: [0.2, 0.2],   wave: 0 },
  { t: 13, x: -0.6,  L: [0.35, 0.2],  R: [0.2, 0.25],  wave: 0 },   // step left: shadow over the sofa
  { t: 15, x: -0.6,  L: [2.39, 0.05], R: [0.2, 0.25],  wave: 0 },   // reach up-left: knock a painting
  { t: 17, x: -0.62, L: [2.45, 0.1],  R: [0.2, 0.25],  wave: 0 },
  { t: 19, x: -0.05, L: [0.25, 0.2],  R: [0.25, 0.2],  wave: 0 },
  { t: 21, x: 0.0,   L: [2.45, 0.1],  R: [2.45, 0.1],  wave: 0.6 }, // both arms up: sweep the curtains
  { t: 23, x: 0.05,  L: [2.3, 0.2],   R: [2.3, 0.2],   wave: 0.6 },
  { t: 25, x: 0.2,   L: [0.2, 0.2],   R: [0.25, 0.2],  wave: 0 },
  { t: 27, x: 0.96,  L: [0.2, 0.2],   R: [0.25, 0.2],  wave: 0 },   // head's shadow on the TV: it turns on
  { t: 30, x: 0.96,  L: [0.2, 0.2],   R: [0.3, 0.2],   wave: 0 },
  { t: 31.5, x: 1.22, L: [0.2, 0.2],  R: [0.3, 0.2],   wave: 0 },   // ...and on the switch: lights off
  { t: 33, x: 1.22,  L: [0.2, 0.2],   R: [0.3, 0.2],   wave: 0 },
  { t: 35.5, x: 0.0, L: [0.2, 0.2],   R: [0.2, 0.2],   wave: 0 },   // dark room lit by the TV
  { t: 40, x: 0.0,   L: [0.2, 0.2],   R: [0.2, 0.2],   wave: 0 },
  { t: 41.5, x: 1.22, L: [0.2, 0.2],  R: [0.3, 0.2],   wave: 0 },   // lights back on
  { t: 43, x: 1.22,  L: [0.2, 0.2],   R: [0.3, 0.2],   wave: 0 },
  { t: 44, x: 0.96,  L: [0.2, 0.2],   R: [0.3, 0.2],   wave: 0 },   // TV off
  { t: 46, x: 0.96,  L: [0.2, 0.2],   R: [0.3, 0.2],   wave: 0 },
  { t: 49, x: 0.0,   L: [0.18, 0.15], R: [0.18, 0.15], wave: 0 },
];
export const DEMO_LOOP = KEYS[KEYS.length - 1].t;

function sampleKeys(t) {
  t %= DEMO_LOOP;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
  return {
    x: lerp(a.x, b.x, f),
    L: [lerp(a.L[0], b.L[0], f), lerp(a.L[1], b.L[1], f)],
    R: [lerp(a.R[0], b.R[0], f), lerp(a.R[1], b.R[1], f)],
    wave: lerp(a.wave, b.wave, f),
  };
}

export class DemoFigure {
  constructor() {
    this.time = 0;
    this.eyeHeight = 1.52;
    this.mouse = null;           // {x: -1..1, y: -1..1}
    this.mouseAt = -1e9;
    this.mouseBlend = 0;
    this.pose = null;
    this.x = 0;
  }

  setMouse(nx, ny, now) {
    this.mouse = { x: nx, y: ny };
    this.mouseAt = now;
  }

  update(dt, now) {
    this.time += dt;
    const k = sampleKeys(this.time);
    const mouseActive = this.mouse && now - this.mouseAt < 4000;
    this.mouseBlend += ((mouseActive ? 1 : 0) - this.mouseBlend) * Math.min(1, dt * 3);
    if (this.mouseBlend > 0.001 && this.mouse) {
      const m = this.mouse;
      const raise = Math.max(0, m.y) * 2.8;           // mouse near the top: arms up
      const mx = m.x * 0.75;
      const reachR = m.x > 0.15 ? 1.2 + m.x : 0.25;
      const reachL = m.x < -0.15 ? 1.2 - m.x : 0.25;
      const b = this.mouseBlend;
      k.x = lerp(k.x, mx, b);
      k.L = [lerp(k.L[0], Math.max(reachL, raise), b), lerp(k.L[1], 0.15, b)];
      k.R = [lerp(k.R[0], Math.max(reachR, raise), b), lerp(k.R[1], 0.15, b)];
      k.wave *= 1 - b;
    }
    this.x = k.x;
    this.pose = this.buildPose(k, this.time);
    return this.pose;
  }

  buildPose(k, t) {
    const breathe = Math.sin(t * 1.6) * 0.006;
    const sway = Math.sin(t * 0.7) * 0.012;
    const x = k.x + sway;
    const eyeY = this.eyeHeight + breathe;
    const head = { x: x + Math.sin(t * 0.9) * 0.006, y: eyeY + 0.035, rx: 0.095, ry: 0.122 };
    const shoulderY = eyeY - 0.13 + breathe;
    const sL = { x: x - 0.19, y: shoulderY };
    const sR = { x: x + 0.19, y: shoulderY };
    const upper = 0.29;
    const fore = 0.27;
    const arm = (s, [a, e], side, waveAmp, phase) => {
      const w = waveAmp * Math.sin(t * 7 + phase) * 0.45;
      const a1 = a;
      const a2 = a + e + w;
      const elbow = { x: s.x + side * Math.sin(a1) * upper, y: s.y - Math.cos(a1) * upper };
      const hand = { x: elbow.x + side * Math.sin(a2) * fore, y: elbow.y - Math.cos(a2) * fore };
      return { elbow, hand };
    };
    const armL = arm(sL, k.L, -1, k.wave, 0);
    const armR = arm(sR, k.R, 1, k.wave, 1.3);
    const hipY = 0.93;
    return { x, eyeY, head, sL, sR, armL, armR, hipY };
  }

  // Draw into the ShadowCaster context (world metres, y up).
  draw(ctx, pose) {
    const p = pose;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Head + neck
    ctx.beginPath();
    ctx.ellipse(p.head.x, p.head.y, p.head.rx, p.head.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(p.x - 0.05, p.sL.y - 0.02, 0.1, p.head.y - p.sL.y);
    // Torso
    ctx.beginPath();
    ctx.moveTo(p.sL.x - 0.03, p.sL.y + 0.02);
    ctx.quadraticCurveTo(p.x, p.sL.y + 0.07, p.sR.x + 0.03, p.sR.y + 0.02);
    ctx.bezierCurveTo(p.sR.x + 0.05, p.sR.y - 0.2, p.x + 0.17, p.hipY + 0.2, p.x + 0.175, p.hipY);
    ctx.lineTo(p.x - 0.175, p.hipY);
    ctx.bezierCurveTo(p.x - 0.17, p.hipY + 0.2, p.sL.x - 0.05, p.sL.y - 0.2, p.sL.x - 0.03, p.sL.y + 0.02);
    ctx.fill();
    // Arms
    for (const [s, a] of [[p.sL, p.armL], [p.sR, p.armR]]) {
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(a.elbow.x, a.elbow.y);
      ctx.stroke();
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(a.elbow.x, a.elbow.y);
      ctx.lineTo(a.hand.x, a.hand.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.hand.x, a.hand.y, 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
