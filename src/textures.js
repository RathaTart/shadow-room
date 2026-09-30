// Procedural canvas textures, so the project ships with no image assets.
import * as THREE from 'three';

// Small seeded PRNG (mulberry32) so textures look the same on every launch.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = [1, 1], anisotropy = 8, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  return t;
}

// Upscaled random noise; several octaves layered give a cheap fBm.
function noiseLayer(w, h, cell, rand) {
  const sw = Math.max(1, Math.ceil(w / cell));
  const sh = Math.max(1, Math.ceil(h / cell));
  const small = makeCanvas(sw, sh);
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(sw, sh);
  for (let i = 0; i < sw * sh; i++) {
    const v = (rand() * 255) | 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  return small;
}

function fbm(ctx, w, h, rand, { cells = [64, 24, 8, 3], alpha = [0.5, 0.3, 0.2, 0.12] } = {}) {
  ctx.imageSmoothingEnabled = true;
  cells.forEach((cell, i) => {
    ctx.globalAlpha = alpha[i];
    ctx.drawImage(noiseLayer(w, h, cell, rand), 0, 0, w, h);
  });
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- wood floor
// 1024 px = 2 m. Planks run along the texture's v axis (room depth).
export function woodFloor(seed = 11) {
  const S = 1024;
  const rand = rng(seed);
  const color = makeCanvas(S, S);
  const g = color.getContext('2d');
  const rough = makeCanvas(S, S);
  const r = rough.getContext('2d');
  const cols = 11;
  const pw = S / cols;

  g.fillStyle = '#2e2017';
  g.fillRect(0, 0, S, S);
  r.fillStyle = 'rgb(140,140,140)';
  r.fillRect(0, 0, S, S);

  const drawSegment = (x0, y, len, style) => {
    // Draw at y and wrapped copies so the texture tiles seamlessly in v.
    for (const off of [-S, 0, S]) {
      const yy = y + off;
      if (yy > S || yy + len < 0) continue;
      g.fillStyle = style.fill;
      g.fillRect(x0, yy, pw, len);
      for (const line of style.grain) {
        g.strokeStyle = line.stroke;
        g.lineWidth = line.width;
        g.beginPath();
        for (let t = 0; t <= len; t += 6) {
          const px = x0 + line.x + Math.sin((yy + t) * line.freq + line.phase) * line.amp
            + Math.sin((yy + t) * line.freq * 3.1 + line.phase * 2) * line.amp * 0.3;
          if (t === 0) g.moveTo(px, yy + t); else g.lineTo(px, yy + t);
        }
        g.stroke();
      }
      for (const knot of style.knots) {
        const grad = g.createRadialGradient(x0 + knot.x, yy + knot.y, 1, x0 + knot.x, yy + knot.y, knot.r);
        grad.addColorStop(0, 'rgba(18,10,6,0.85)');
        grad.addColorStop(0.5, 'rgba(40,24,14,0.4)');
        grad.addColorStop(1, 'rgba(40,24,14,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(x0 + knot.x, yy + knot.y, knot.r * 0.55, knot.r, 0, 0, Math.PI * 2);
        g.fill();
      }
      r.fillStyle = `rgb(${style.rough},${style.rough},${style.rough})`;
      r.fillRect(x0, yy, pw, len);
      // End joint
      g.fillStyle = 'rgba(6,4,2,0.9)';
      g.fillRect(x0, yy, pw, 2);
      r.fillStyle = 'rgb(235,235,235)';
      r.fillRect(x0, yy, pw, 2);
    }
  };

  for (let c = 0; c < cols; c++) {
    const x0 = c * pw;
    // 1-2 joints per column, the last plank wraps around to the first joint.
    const joints = [rand() * S];
    if (rand() < 0.6) joints.push((joints[0] + S * (0.35 + rand() * 0.3)) % S);
    joints.sort((a, b) => a - b);
    for (let j = 0; j < joints.length; j++) {
      const y = joints[j];
      const next = j + 1 < joints.length ? joints[j + 1] : joints[0] + S;
      const len = next - y;
      const lig = 13 + rand() * 9;
      const grain = [];
      for (let k = 0; k < 22; k++) {
        const dark = rand() < 0.55;
        grain.push({
          x: rand() * pw,
          amp: 0.8 + rand() * 3.5,
          freq: 0.003 + rand() * 0.012,
          phase: rand() * 6.28,
          width: 0.5 + rand() * 1.6,
          stroke: dark ? `rgba(14,8,5,${0.1 + rand() * 0.25})` : `rgba(110,76,52,${0.05 + rand() * 0.14})`,
        });
      }
      const knots = rand() < 0.3 ? [{ x: pw * (0.2 + rand() * 0.6), y: rand() * len, r: 6 + rand() * 10 }] : [];
      drawSegment(x0, y, len, {
        fill: `hsl(${22 + rand() * 9}, ${28 + rand() * 16}%, ${lig}%)`,
        grain,
        knots,
        rough: (120 + rand() * 60) | 0,
      });
    }
    g.fillStyle = 'rgba(6,4,2,0.85)';
    g.fillRect(x0, 0, 2, S);
    r.fillStyle = 'rgb(235,235,235)';
    r.fillRect(x0, 0, 2, S);
  }

  // Subtle wear across planks
  g.globalCompositeOperation = 'overlay';
  fbm(g, S, S, rand, { cells: [256, 64, 16], alpha: [0.25, 0.18, 0.1] });
  g.globalCompositeOperation = 'source-over';

  return {
    map: toTexture(color, { srgb: true }),
    roughnessMap: toTexture(rough, { srgb: false }),
  };
}

// ---------------------------------------------------------------- fabric bump
export function fabricBump(seed = 3) {
  const S = 256;
  const rand = rng(seed);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  // Basket weave
  for (let y = 0; y < S; y += 4) {
    g.fillStyle = `rgba(255,255,255,${0.1 + rand() * 0.12})`;
    g.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 4) {
    g.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.12})`;
    g.fillRect(x, 0, 1, S);
  }
  g.globalCompositeOperation = 'overlay';
  fbm(g, S, S, rand, { cells: [32, 8, 2], alpha: [0.35, 0.3, 0.25] });
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: false, repeat: [3, 3] });
}

// ---------------------------------------------------------------- pillow stripes
export function stripes(seed = 5) {
  const S = 256;
  const rand = rng(seed);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#e9e5dd';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#141414';
  const pattern = [22, 10, 22, 10, 6, 10, 22, 10, 22, 26];
  let y = 0;
  let on = true;
  let i = 0;
  while (y < S) {
    const h = pattern[i % pattern.length];
    if (on) g.fillRect(0, y, S, h);
    y += h;
    on = !on;
    i++;
  }
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.18;
  fbm(g, S, S, rand, { cells: [16, 4, 1], alpha: [0.6, 0.5, 0.4] });
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: true });
}

// ---------------------------------------------------------------- rug
export function rug(seed = 21) {
  const W = 1024;
  const H = 740;
  const rand = rng(seed);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#7d776e';
  g.fillRect(0, 0, W, H);

  // Faded vintage medallion pattern, low contrast
  g.save();
  g.translate(W / 2, H / 2);
  g.strokeStyle = 'rgba(60,56,52,0.55)';
  g.fillStyle = 'rgba(58,54,50,0.35)';
  for (let k = 0; k < 7; k++) {
    const s = 1 - k * 0.12;
    g.lineWidth = 6 - k * 0.5;
    g.beginPath();
    g.moveTo(0, -H * 0.38 * s);
    g.lineTo(W * 0.24 * s, 0);
    g.lineTo(0, H * 0.38 * s);
    g.lineTo(-W * 0.24 * s, 0);
    g.closePath();
    g.stroke();
    if (k % 2 === 1) g.fill();
  }
  for (let a = 0; a < 16; a++) {
    g.save();
    g.rotate((a / 16) * Math.PI * 2);
    g.fillStyle = 'rgba(150,142,130,0.35)';
    g.beginPath();
    g.ellipse(0, -60, 10, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.restore();

  // Border bands
  g.strokeStyle = 'rgba(52,48,45,0.7)';
  g.lineWidth = 22;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.strokeStyle = 'rgba(150,142,132,0.45)';
  g.lineWidth = 6;
  g.strokeRect(62, 62, W - 124, H - 124);
  for (let x = 90; x < W - 90; x += 36) {
    g.fillStyle = 'rgba(60,55,50,0.45)';
    g.fillRect(x, 44, 14, 12);
    g.fillRect(x, H - 56, 14, 12);
  }
  for (let y = 90; y < H - 90; y += 36) {
    g.fillStyle = 'rgba(60,55,50,0.45)';
    g.fillRect(44, y, 12, 14);
    g.fillRect(W - 56, y, 12, 14);
  }

  // Worn / distressed look
  g.globalCompositeOperation = 'soft-light';
  fbm(g, W, H, rand, { cells: [180, 60, 12, 2], alpha: [0.7, 0.5, 0.45, 0.35] });
  g.globalCompositeOperation = 'source-over';
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true, wrap: false });
}

// ---------------------------------------------------------------- paintings
// Dark abstract pieces like the reference photo: dark ground, pale geometric figures.
export function painting(seed = 1, variant = 0) {
  const W = 480;
  const H = 640;
  const rand = rng(seed);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const ground = g.createLinearGradient(0, 0, W, H);
  ground.addColorStop(0, variant ? '#15161c' : '#1a1512');
  ground.addColorStop(1, variant ? '#0b0c10' : '#0d0b09');
  g.fillStyle = ground;
  g.fillRect(0, 0, W, H);

  // Brush texture
  for (let i = 0; i < 900; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const len = 10 + rand() * 60;
    const a = rand() * Math.PI;
    g.strokeStyle = `rgba(${variant ? '70,75,90' : '90,76,60'},${0.03 + rand() * 0.06})`;
    g.lineWidth = 1 + rand() * 5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  const pale = variant ? 'rgba(214,210,200,0.92)' : 'rgba(226,218,200,0.92)';
  const ochre = variant ? 'rgba(170,120,70,0.8)' : 'rgba(186,140,80,0.8)';
  g.fillStyle = pale;
  if (variant === 0) {
    // Tall triangle with a small standing figure
    g.beginPath();
    g.moveTo(W * 0.5, H * 0.16);
    g.lineTo(W * 0.82, H * 0.78);
    g.lineTo(W * 0.18, H * 0.78);
    g.closePath();
    g.fill();
    g.fillStyle = '#0f0d0b';
    g.beginPath();
    g.moveTo(W * 0.5, H * 0.3);
    g.lineTo(W * 0.66, H * 0.7);
    g.lineTo(W * 0.34, H * 0.7);
    g.closePath();
    g.fill();
    g.fillStyle = ochre;
    g.beginPath();
    g.arc(W * 0.5, H * 0.52, W * 0.06, 0, Math.PI * 2);
    g.fill();
    g.fillRect(W * 0.12, H * 0.84, W * 0.76, 3);
  } else {
    // Stacked arcs and a slanted bar
    for (let k = 0; k < 4; k++) {
      g.strokeStyle = k % 2 ? ochre : pale;
      g.lineWidth = 14 - k * 2;
      g.beginPath();
      g.arc(W * 0.5, H * 0.62, W * (0.12 + k * 0.08), Math.PI, 0);
      g.stroke();
    }
    g.save();
    g.translate(W * 0.5, H * 0.3);
    g.rotate(-0.35);
    g.fillStyle = pale;
    g.fillRect(-W * 0.3, -8, W * 0.6, 16);
    g.restore();
    g.fillStyle = ochre;
    g.beginPath();
    g.arc(W * 0.72, H * 0.2, W * 0.05, 0, Math.PI * 2);
    g.fill();
  }

  // Canvas grain + varnish sheen
  g.globalCompositeOperation = 'overlay';
  fbm(g, W, H, rand, { cells: [64, 12, 2], alpha: [0.25, 0.2, 0.25] });
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: true, wrap: false });
}

// ---------------------------------------------------------------- night city
export function cityNight(seed = 99) {
  const W = 2048;
  const H = 900;
  const rand = rng(seed);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#04060f');
  sky.addColorStop(0.45, '#0b1030');
  sky.addColorStop(0.72, '#1d1f3c');
  sky.addColorStop(0.86, '#3a2a36');
  sky.addColorStop(1, '#241a20');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // Stars
  for (let i = 0; i < 260; i++) {
    const a = rand();
    g.fillStyle = `rgba(220,230,255,${a * a * 0.8})`;
    g.fillRect(rand() * W, rand() * H * 0.55, 1.2, 1.2);
  }
  // Moon with halo
  const mx = W * 0.2;
  const my = H * 0.2;
  const halo = g.createRadialGradient(mx, my, 8, mx, my, 150);
  halo.addColorStop(0, 'rgba(220,230,255,0.35)');
  halo.addColorStop(1, 'rgba(220,230,255,0)');
  g.fillStyle = halo;
  g.fillRect(mx - 150, my - 150, 300, 300);
  g.fillStyle = '#e8eefc';
  g.beginPath();
  g.arc(mx, my, 22, 0, Math.PI * 2);
  g.fill();

  // Three layers of buildings, far to near
  const layers = [
    { base: H * 0.82, maxH: 190, color: '#10111c', win: 0.2, glow: 0.35 },
    { base: H * 0.9, maxH: 300, color: '#0a0b12', win: 0.28, glow: 0.6 },
    { base: H * 1.0, maxH: 420, color: '#06070b', win: 0.34, glow: 0.9 },
  ];
  for (const L of layers) {
    let x = -20;
    while (x < W) {
      const bw = 40 + rand() * 120;
      const bh = 60 + rand() * L.maxH;
      g.fillStyle = L.color;
      g.fillRect(x, L.base - bh, bw, bh + 4);
      // Lit windows
      for (let wy = L.base - bh + 10; wy < L.base - 8; wy += 12) {
        for (let wx = x + 6; wx < x + bw - 6; wx += 10) {
          if (rand() < L.win) {
            const warm = rand() < 0.75;
            const a = (0.25 + rand() * 0.75) * L.glow;
            g.fillStyle = warm ? `rgba(255,196,120,${a})` : `rgba(160,200,255,${a})`;
            g.fillRect(wx, wy, 5, 6);
          }
        }
      }
      if (bh > L.maxH * 0.85 && rand() < 0.5) {
        g.fillStyle = 'rgba(255,60,50,0.9)';
        g.fillRect(x + bw / 2 - 2, L.base - bh - 6, 4, 4);
      }
      x += bw + rand() * 14;
    }
  }
  // City glow haze near the horizon
  const haze = g.createLinearGradient(0, H * 0.65, 0, H);
  haze.addColorStop(0, 'rgba(255,150,90,0)');
  haze.addColorStop(1, 'rgba(255,150,90,0.12)');
  g.fillStyle = haze;
  g.fillRect(0, H * 0.65, W, H * 0.35);
  return toTexture(c, { srgb: true, wrap: false });
}

// ---------------------------------------------------------------- monstera leaf
export function leaf(seed = 8) {
  const S = 256;
  const rand = rng(seed);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.translate(S / 2, S);
  // Heart-shaped leaf pointing up; stem at bottom centre
  const grad = g.createLinearGradient(-S * 0.4, 0, S * 0.4, -S);
  grad.addColorStop(0, '#1d3a1e');
  grad.addColorStop(0.6, '#2f5a2a');
  grad.addColorStop(1, '#3d6b33');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, -S * 0.12);
  g.bezierCurveTo(-S * 0.55, -S * 0.05, -S * 0.52, -S * 0.78, 0, -S * 0.96);
  g.bezierCurveTo(S * 0.52, -S * 0.78, S * 0.55, -S * 0.05, 0, -S * 0.12);
  g.fill();
  // Midrib and veins
  g.strokeStyle = 'rgba(160,190,120,0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -S * 0.12);
  g.lineTo(0, -S * 0.92);
  g.stroke();
  g.lineWidth = 1.2;
  for (let k = 1; k < 8; k++) {
    const y = -S * (0.16 + k * 0.1);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, y);
      g.quadraticCurveTo(side * S * 0.18, y - 6, side * S * 0.36 * Math.sin((k / 8) * Math.PI), y - S * 0.08);
      g.stroke();
    }
  }
  // Fenestrations: slits from the edge toward the midrib
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 6; k++) {
    const y = -S * (0.28 + k * 0.1);
    for (const side of [-1, 1]) {
      if (rand() < 0.2) continue;
      g.lineWidth = 5 + rand() * 4;
      g.beginPath();
      g.moveTo(side * S * 0.6, y - S * 0.03);
      g.lineTo(side * S * (0.12 + rand() * 0.06), y + S * 0.02);
      g.stroke();
    }
    if (rand() < 0.5) {
      g.beginPath();
      g.ellipse(-S * 0.08 * (k % 2 ? 1 : -1), y + 4, 4, 7, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: true, wrap: false });
}

// ---------------------------------------------------------------- TV content
// A small canvas repainted a few times per second: abstract "film" footage.
export class TvScreen {
  constructor() {
    this.canvas = makeCanvas(256, 144);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.rand = rng(1234);
    this.scene = 0;
    this.nextCut = 0;
    this.palettes = [
      ['#0b3a5c', '#1f7a8c', '#e0c080'], // ocean + sand
      ['#1b1f3a', '#5a3e8c', '#f08a5d'], // dusk city
      ['#0e2a14', '#3f7a3a', '#d7e0a0'], // forest
      ['#2a1206', '#a3471b', '#ffd28a'], // fire / warm interior
      ['#101820', '#5f7d95', '#e9f0f5'], // snow
    ];
    this.brightness = 0.5;
    this.tint = new THREE.Color('#8fb0ff');
  }

  paint(t) {
    if (t > this.nextCut) {
      this.scene = (this.scene + 1 + Math.floor(this.rand() * 3)) % this.palettes.length;
      this.nextCut = t + 3 + this.rand() * 5;
      this.seedA = this.rand() * 10;
      this.seedB = this.rand() * 10;
    }
    const [a, b, c] = this.palettes[this.scene];
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const bg = g.createLinearGradient(0, 0, W * Math.cos(t * 0.1 + this.seedA), H);
    bg.addColorStop(0, a);
    bg.addColorStop(1, b);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // Drifting light blobs
    for (let i = 0; i < 5; i++) {
      const x = W * (0.5 + 0.45 * Math.sin(t * (0.13 + i * 0.07) + this.seedB + i));
      const y = H * (0.5 + 0.4 * Math.cos(t * (0.11 + i * 0.05) + this.seedA * i));
      const r = 30 + 30 * Math.sin(t * 0.3 + i);
      const blob = g.createRadialGradient(x, y, 1, x, y, Math.abs(r) + 10);
      blob.addColorStop(0, i % 2 ? c : b);
      blob.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.55;
      g.fillStyle = blob;
      g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 1;
    // Letterbox + scanlines
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(0, 0, W, 12);
    g.fillRect(0, H - 12, W, 12);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 12; y < H - 12; y += 2) g.fillRect(0, y, W, 1);
    this.texture.needsUpdate = true;

    // Approximate emitted light: mix of the palette, flickering with the blobs
    this.tint.set(b).lerp(new THREE.Color(c), 0.35 + 0.15 * Math.sin(t * 1.7));
    this.brightness = 0.8 + 0.2 * Math.sin(t * 2.3 + this.seedA) * Math.sin(t * 0.7);
  }
}
