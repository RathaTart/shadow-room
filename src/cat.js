// The cat. Sleeps on the sofa, chases the shadow of your hand like a laser dot and pounces on it,
// and bolts when your shadow looms over it. Idle, it paws at the curtain, watches the TV when it
// is on, and tilts its head when you tilt yours. Built from primitives, animated procedurally;
// it finds its way around the furniture on a coarse floor grid (A*).
import * as THREE from 'three';
import { makeCanvas, rng } from './textures.js';

const SCALE = 1.3;               // larger than life, so it reads from across the room
const FLOOR = { xMin: -2.4, xMax: 2.4, zMin: -6.7, zMax: -0.7 };
const CELL = 0.1;
const CLEAR = 0.18;              // distance kept from furniture and walls, metres
// Furniture footprints on the floor: [x0, z0, x1, z1] boxes and [x, z, r] circles.
const FURNITURE = [
  [-2.6, -5.8, -1.65, -3.05],    // sofa along the left wall
  [-2.6, -6.74, -0.35, -5.8],    // sofa under the window
  [-0.8, -4.45, 0.5],            // coffee table
  [2.17, -6.2, 2.6, -2.95],      // TV console
  [2.18, -6.55, 0.21],           // plant pot
  [-2.6, -2.95, -2.05, -1.2],    // cabinet
];
const SOFA = { seat: new THREE.Vector3(-1.4, 0.455, -6.1), floor: new THREE.Vector3(-1.4, 0, -5.42) };
const CURTAIN = { at: new THREE.Vector3(0.45, 0, -6.5), look: new THREE.Vector3(0.45, 0.3, -6.9) };
const TV = { at: new THREE.Vector3(1.3, 0, -5.15), look: new THREE.Vector3(2.57, 1.32, -5.15) };
const HIDEOUTS = [[-1.0, -1.1], [1.5, -1.2], [1.75, -6.55], [-0.8, -3.7]];
const WANDER = [[-0.4, -3.9], [1.5, -4.1], [0.1, -4.9], [-0.2, -6.2], [1.2, -3.4]];
const SPEED = { stalk: 0.22, walk: 0.45, trot: 1.1, run: 2.3 };

// Body shapes the animation blends between (metres, radians). Legs: + swings the paw forward.
const POSES = {
  stand:   { y: 0.2, pitch: 0, fLeg: 0, fKnee: 0, bLeg: 0, bKnee: 0, tailUp: 0.9, tailSide: 0, ears: 0, eyes: 1, headDown: 0, tuck: 0 },
  sit:     { y: 0.15, pitch: -0.62, fLeg: -0.62, fKnee: 0, bLeg: 1.35, bKnee: 2.2, tailUp: -0.9, tailSide: 1.3, ears: 0, eyes: 1, headDown: 0, tuck: 0 },
  crouch:  { y: 0.11, pitch: -0.06, fLeg: 0.75, fKnee: 1.25, bLeg: -0.2, bKnee: 1.7, tailUp: -0.1, tailSide: 0, ears: 0.15, eyes: 1, headDown: 0.25, tuck: 0 },
  loaf:    { y: 0.085, pitch: 0, fLeg: 1.45, fKnee: 2.5, bLeg: -1.45, bKnee: 2.5, tailUp: -0.4, tailSide: 1.6, ears: 0.25, eyes: 0, headDown: 0.3, tuck: 1 },
  hide:    { y: 0.095, pitch: 0.02, fLeg: 0.9, fKnee: 1.6, bLeg: -0.5, bKnee: 1.9, tailUp: -0.6, tailSide: 1.2, ears: 1, eyes: 1, headDown: 0.2, tuck: 0.5 },
  stretch: { y: 0.15, pitch: 0.28, fLeg: 0.95, fKnee: 0, bLeg: -0.1, bKnee: 0, tailUp: 1.2, tailSide: 0, ears: 0.3, eyes: 0.4, headDown: -0.2, tuck: 0 },
  leap:    { y: 0.2, pitch: 0, fLeg: 1.0, fKnee: 0.2, bLeg: -1.0, bKnee: 0.2, tailUp: 0.2, tailSide: 0, ears: 0.4, eyes: 1, headDown: -0.1, tuck: 0 },
};
const KEYS = Object.keys(POSES.stand);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const smooth = (dt, tau) => 1 - Math.exp(-dt / tau);
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ walking around the furniture
class FloorGrid {
  constructor() {
    this.nx = Math.round((FLOOR.xMax - FLOOR.xMin) / CELL) + 1;
    this.nz = Math.round((FLOOR.zMax - FLOOR.zMin) / CELL) + 1;
    this.free = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) this.free[j * this.nx + i] = this.blocked(this.x(i), this.z(j)) ? 0 : 1;
    }
    this.cost = new Float32Array(this.nx * this.nz);
    this.from = new Int32Array(this.nx * this.nz);
    this.heap = [];
  }

  x(i) { return FLOOR.xMin + i * CELL; }
  z(j) { return FLOOR.zMin + j * CELL; }

  blocked(x, z) {
    if (x < FLOOR.xMin || x > FLOOR.xMax || z < FLOOR.zMin || z > FLOOR.zMax) return true;
    for (const f of FURNITURE) {
      if (f.length === 3) {
        if (Math.hypot(x - f[0], z - f[1]) < f[2] + CLEAR) return true;
      } else if (x > f[0] - CLEAR && x < f[2] + CLEAR && z > f[1] - CLEAR && z < f[3] + CLEAR) {
        return true;
      }
    }
    return false;
  }

  index(x, z) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.round((x - FLOOR.xMin) / CELL)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.round((z - FLOOR.zMin) / CELL)));
    return j * this.nx + i;
  }

  // Nearest walkable cell to a point (rings outward).
  nearestFree(x, z) {
    const k = this.index(x, z);
    if (this.free[k]) return k;
    const ci = k % this.nx;
    const cj = (k - ci) / this.nx;
    for (let r = 1; r < 40; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz || !this.free[j * this.nx + i]) continue;
          const d = di * di + dj * dj;
          if (d < bestD) { bestD = d; best = j * this.nx + i; }
        }
      }
      if (best >= 0) return best;
    }
    return k;
  }

  clearLine(ax, az, bx, bz) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      if (!this.free[this.index(ax + (bx - ax) * t, az + (bz - az) * t)]) return false;
    }
    return true;
  }

  // A* over 8-connected cells, then straightened to as few legs as the walls allow.
  path(ax, az, bx, bz) {
    const start = this.nearestFree(ax, az);
    const goal = this.nearestFree(bx, bz);
    const { nx, cost, from } = this;
    cost.fill(Infinity);
    from.fill(-1);
    const heap = this.heap;
    heap.length = 0;
    const gi = goal % nx;
    const gj = (goal - gi) / nx;
    const h = (k) => {
      const di = Math.abs((k % nx) - gi);
      const dj = Math.abs(Math.floor(k / nx) - gj);
      return Math.max(di, dj) + 0.414 * Math.min(di, dj);
    };
    const push = (k, f) => {
      heap.push([f, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    cost[start] = 0;
    push(start, h(start));
    let found = start === goal;
    while (heap.length && !found) {
      const [, k] = pop();
      const ki = k % nx;
      const kj = (k - ki) / nx;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ki + di;
          const j = kj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= this.nz) continue;
          const n = j * nx + i;
          if (!this.free[n]) continue;
          if (di && dj && (!this.free[kj * nx + i] || !this.free[j * nx + ki])) continue;   // no corner cutting
          const c = cost[k] + (di && dj ? 1.414 : 1);
          if (c >= cost[n]) continue;
          cost[n] = c;
          from[n] = k;
          if (n === goal) { found = true; break; }
          push(n, c + h(n));
        }
        if (found) break;
      }
    }
    if (!found) return [];
    const cells = [];
    for (let k = goal; k !== -1 && k !== start; k = from[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => new THREE.Vector3(this.x(k % nx), 0, this.z(Math.floor(k / nx))));
    // Keep only the corners: from each point, jump to the farthest one in plain sight.
    const out = [];
    let cx = ax;
    let cz = az;
    let i = 0;
    while (i < pts.length) {
      let far = i;
      for (let j = pts.length - 1; j > i; j--) {
        if (this.clearLine(cx, cz, pts[j].x, pts[j].z)) { far = j; break; }
      }
      out.push(pts[far]);
      cx = pts[far].x;
      cz = pts[far].z;
      i = far + 1;
    }
    if (out.length && this.free[this.index(bx, bz)]) out[out.length - 1].set(bx, 0, bz);   // end exactly there if it can
    return out;
  }
}

// ------------------------------------------------------------------ fur
function tabby() {
  const c = makeCanvas(256, 128);
  const x = c.getContext('2d');
  x.fillStyle = '#c67c3b';
  x.fillRect(0, 0, 256, 128);
  const r = rng(5);
  x.strokeStyle = '#8a4a1e';
  x.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const u0 = (i / 16) * 256 + r() * 6;
    x.lineWidth = 5 + r() * 5;
    x.beginPath();
    for (let v = 6; v <= 100; v += 4) {
      const u = u0 + Math.sin(v * 0.09 + i * 1.7) * 6;
      if (v === 6) x.moveTo(u, v); else x.lineTo(u, v);
    }
    x.stroke();
  }
  const belly = x.createLinearGradient(0, 88, 0, 128);   // lighter underside (bottom of the sphere)
  belly.addColorStop(0, 'rgba(236, 206, 164, 0)');
  belly.addColorStop(1, 'rgba(236, 206, 164, 1)');
  x.fillStyle = belly;
  x.fillRect(0, 88, 256, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Cat {
  constructor(scene, { room, interactions }) {
    this.room = room;
    this.interactions = interactions;
    this.grid = new FloorGrid();
    this.time = 0;
    this.pos = SOFA.seat.clone();
    this.heading = 0.4;                     // on the sofa, turned toward the room (+z)
    this.speed = 0;
    this.phase = 0;
    this.path = [];
    this.pathTo = new THREE.Vector3(1e9, 0, 0);
    this.pathAt = -1e9;
    this.goal = null;                       // where 'goto' walks to
    this.after = null;                      // what to do on arrival
    this.jumpState = null;
    this.onSofa = true;
    this.mode = 'sleep';
    this.modeTime = 0;
    this.dot = new THREE.Vector3();
    this.reach = new THREE.Vector3();
    this.dotLast = -1e9;
    this.dotSeen = 0;
    this.dotOnFloor = true;
    this.dotHeight = 0;
    this.loom = 0;
    this.bored = 0;
    this.poked = false;
    this.pawAt = 0;
    this.pose = { ...POSES.loaf };
    this.headYaw = 0.9;
    this.headPitch = 0;
    this.headRoll = 0;
    this.moving = false;
    this.busy = false;
    this.random = rng(42);
    this.build(scene);
  }

  // ---------------------------------------------------------------- body
  build(scene) {
    const fur = new THREE.MeshStandardMaterial({ map: tabby(), roughness: 0.92 });
    const plain = new THREE.MeshStandardMaterial({ color: 0xbd7337, roughness: 0.92 });
    const light = new THREE.MeshStandardMaterial({ color: 0xe9cfa7, roughness: 0.9 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x1a2408, emissive: 0xc4ea52, emissiveIntensity: 1.8, roughness: 0.2 });
    const nose = new THREE.MeshStandardMaterial({ color: 0xc98a86, roughness: 0.6 });
    this.meshes = [];
    const part = (geometry, material, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    const group = (parent, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const sphere = new THREE.SphereGeometry(1, 20, 14);

    this.root = new THREE.Group();
    this.root.name = 'cat';
    this.root.scale.setScalar(SCALE);
    scene.add(this.root);
    this.body = group(this.root);
    const torso = part(sphere, fur, this.body);
    torso.scale.set(0.085, 0.082, 0.19);
    this.chest = part(sphere, light, this.body, 0, -0.03, 0.1);
    this.chest.scale.set(0.06, 0.06, 0.08);

    // Head on a neck, so it can look around and tilt.
    this.neck = group(this.body, 0, 0.055, 0.16);
    this.head = group(this.neck, 0, 0.03, 0.03);
    this.head.rotation.order = 'YXZ';
    part(sphere, fur, this.head, 0, 0, 0).scale.set(0.066, 0.058, 0.06);
    part(sphere, light, this.head, 0, -0.018, 0.045).scale.set(0.034, 0.024, 0.026);
    part(sphere, nose, this.head, 0, -0.004, 0.07).scale.set(0.008, 0.006, 0.005);
    this.ears = [];
    for (const s of [-1, 1]) {
      const pivot = group(this.head, s * 0.034, 0.042, 0.005);
      const ear = part(new THREE.ConeGeometry(0.023, 0.05, 4), plain, pivot, 0, 0.022, 0);
      ear.rotation.y = Math.PI / 4;
      pivot.userData.side = s;
      this.ears.push(pivot);
    }
    this.eyes = [];
    for (const s of [-1, 1]) {
      const e = part(sphere, eye, this.head, s * 0.024, 0.012, 0.048);
      e.scale.set(0.012, 0.011, 0.008);
      e.castShadow = false;
      this.eyes.push(e);
    }

    // Legs: hip → thigh → knee → shin → paw. Front pair at +z.
    const thigh = new THREE.CapsuleGeometry(0.019, 0.06, 3, 8);
    const shin = new THREE.CapsuleGeometry(0.015, 0.06, 3, 8);
    this.legs = [];
    for (const [side, front] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const hip = group(this.body, side * 0.05, -0.02, front * 0.125);
      part(thigh, plain, hip, 0, -0.042, 0);
      const knee = group(hip, 0, -0.085, 0);
      part(shin, plain, knee, 0, -0.04, 0);
      part(sphere, light, knee, 0, -0.085, 0.008).scale.set(0.019, 0.013, 0.024);
      this.legs.push({ hip, knee, side, front: front > 0 });
    }

    // Tail: a chain of segments that curls, lifts and swishes.
    this.tail = [];
    let parent = group(this.body, 0, 0.035, -0.18);
    for (let i = 0; i < 8; i++) {
      const seg = group(parent, 0, 0, i ? 0.042 : 0);
      seg.rotation.order = 'YXZ';
      const r = 0.016 - i * 0.0008;
      const m = part(new THREE.CapsuleGeometry(r, 0.03, 3, 8), i > 5 ? fur : plain, seg, 0, 0, 0.021);
      m.rotation.x = Math.PI / 2;
      this.tail.push(seg);
      parent = seg;
    }
    // Segments point backward (-z): flip the first so the chain grows away from the body.
    this.tail[0].rotation.y = Math.PI;
  }

  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }

  // ---------------------------------------------------------------- behaviour
  setMode(mode, after = null) {
    this.mode = mode;
    this.modeTime = 0;
    if (after !== null) this.after = after;
    this.duration = { rest: 8 + this.random() * 10, sit: 5 + this.random() * 8, hide: 3 + this.random() * 2.5, paw: 3 + this.random() * 3, watch: 12 + this.random() * 12, stretch: 1.3 }[mode] ?? 0;
  }

  // Walk (or run) somewhere on the floor, then do `after`.
  goTo(x, z, speed, after) {
    this.goal = new THREE.Vector3(x, 0, z);
    this.goalSpeed = speed;
    this.path = this.grid.path(this.pos.x, this.pos.z, x, z);
    this.pathTo.copy(this.goal);
    this.setMode('goto', after);
  }

  jump(to, duration, height, then) {
    this.jumpState = { from: this.pos.clone(), to: to.clone(), t: 0, duration, height, then };
    this.heading = Math.atan2(to.x - this.pos.x, to.z - this.pos.z);
    this.setMode('jump');
  }

  leaveSofa(then) {
    this.onSofa = false;
    this.jump(SOFA.floor, 0.45, 0.18, then);
  }

  wake(then) {
    this.setMode('stretch', then);
  }

  startle() {
    // Off the sofa and away, fast.
    if (this.onSofa) { this.leaveSofa('flee'); return; }
    this.flee();
  }

  flee() {
    // Away from wherever the shadow is: the hideout farthest from here that is not in shadow.
    let best = null;
    let bestScore = -Infinity;
    for (const [x, z] of HIDEOUTS) {
      _v.set(x, 0.2, z);
      const shade = this.shadowAt ? Math.max(0, this.shadowAt(_v)) : 0;
      const score = Math.hypot(x - this.pos.x, z - this.pos.z) - shade * 4;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    this.goTo(best[0], best[1], SPEED.run, 'hide');
    this.mode = 'flee';
  }

  // The user clicked it.
  poke() {
    this.poked = true;
    this.bored = 0;
  }

  click(raycaster) {
    if (!this.root.visible) return false;
    const hit = raycaster.intersectObjects(this.meshes, false).length > 0;
    if (hit) this.poke();
    return hit;
  }

  bodyPoint(out = _w) {
    return out.set(this.pos.x, this.pos.y + 0.2 * SCALE, this.pos.z);
  }

  // Share of the points on and around the cat that are in your shadow (those the hall light reaches).
  loomCoverage() {
    let lit = 0;
    let dark = 0;
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i === 8 ? 0 : 0.42;
      _w.set(this.pos.x + Math.cos(a) * r, this.pos.y + 0.2 * SCALE, this.pos.z + Math.sin(a) * r);
      const s = this.shadowAt(_w);
      if (s < 0) continue;
      lit++;
      if (s > 0.5) dark++;
    }
    return lit ? dark / lit : 0;
  }

  // The dot itself if the cat can stand there, else the nearest spot it can (by the furniture).
  reachable(p) {
    const g = this.grid;
    if (g.free[g.index(p.x, p.z)]) return this.reach.set(p.x, 0, p.z);
    const k = g.nearestFree(p.x, p.z);
    return this.reach.set(g.x(k % g.nx), 0, g.z(Math.floor(k / g.nx)));
  }

  think(dt, env) {
    const dot = env.dot;
    if (dot) {
      this.dotSeen += dt;
      this.dotLast = this.time;
      this.dot.copy(dot.floor);
      this.dotOnFloor = dot.onFloor;
      this.dotHeight = dot.height;
      this.bored = 0;
    } else {
      this.dotSeen = 0;
    }
    const fresh = this.time - this.dotLast < 1.2;
    // Looming: a big shadow (your body, not the thin shadow of the hand it plays with) moving
    // over it. A shadow that just sits there, or that the cat walks into, is not scary: the
    // baseline follows the cat while it moves and catches up with a shadow that stays put.
    const cover = this.loomCoverage();
    if (this.speed > 0.1 || this.jumpState || this.coverBase === undefined) this.coverBase = cover;
    else this.coverBase += (cover - this.coverBase) * smooth(dt, 0.8);
    const covered = cover >= 0.65 && cover - this.coverBase > 0.3;
    const playing = fresh && distXZ(this.pos, this.dot) < 0.45;
    this.loom = covered && !playing ? this.loom + dt : 0;
    const poked = this.poked;
    this.poked = false;
    this.bored += dt;

    switch (this.mode) {
      case 'sleep':
        if (this.loom > 0.15) return this.startle();
        if (dot && this.dotSeen > 0.5) return this.wake('chase');
        if (poked) return this.wake('rest');
        return;
      case 'rest':
        if (this.loom > 0.2) return this.startle();
        if (dot && this.dotSeen > 0.3) return this.leaveSofa('chase');
        if (poked) { this.bored = 0; this.modeTime = 0; return; }
        if (this.modeTime > this.duration) return this.setMode('sleep');
        return;
      case 'stretch':
        if (this.modeTime < this.duration) return;
        if (this.after === 'chase') return this.onSofa ? this.leaveSofa('chase') : this.setMode('chase');
        return this.setMode(this.onSofa ? 'rest' : 'sit');
      case 'jump':
        return;
      case 'chase': {
        if (this.loom > 0.25) return this.flee();
        if (!fresh) return this.setMode('sit');
        const reach = this.reachable(this.dot);
        const far = distXZ(this.pos, reach);
        // Re-plan when the dot has moved on.
        if (distXZ(this.pathTo, reach) > 0.2 || this.time - this.pathAt > 0.5) {
          this.path = this.grid.path(this.pos.x, this.pos.z, reach.x, reach.z);
          this.pathTo.copy(reach);
          this.pathAt = this.time;
        }
        this.goalSpeed = far > 1.2 ? SPEED.run : far > 0.55 ? SPEED.trot : SPEED.stalk;
        if (this.dotOnFloor && far < 0.18) return this.setMode('play');   // got it
        if (this.dotOnFloor && far < 0.42 && this.modeTime > 0.4) return this.setMode('crouch');
        if (!this.dotOnFloor && far < 0.3) {
          // Below a dot on the wall: reach up at it, batting the curtain if it is in the way.
          this.goalSpeed = 0;
          this.path = [];
          const c = this.room.curtains.sheer;
          const lx = this.dot.x - c.mesh.position.x;
          if (Math.abs(lx) < c.width / 2 && this.dotHeight < 1.4 && this.modeTime - this.pawAt > 0.8) {
            this.pawAt = this.modeTime;
            c.poke(lx, 0.6);
          }
        }
        return;
      }
      case 'play':
        // Caught the dot (or got as close as the furniture allows): sit and bat at it until it
        // gets away.
        if (this.loom > 0.25) return this.flee();
        if (!fresh) return this.setMode('sit');
        if (distXZ(this.pos, this.reachable(this.dot)) > 0.32) return this.setMode('chase');
        return;
      case 'crouch':
        if (this.loom > 0.25) return this.flee();
        if (!fresh) return this.setMode('sit');
        if (distXZ(this.pos, this.reachable(this.dot)) > 0.7) return this.setMode('chase');
        if (this.modeTime > 0.75) return this.jump(this.reachable(this.dot).clone(), 0.36, 0.14, 'chase');   // pounce
        return;
      case 'goto':
      case 'flee':
        if (this.mode === 'goto' && this.loom > 0.25) return this.flee();
        if (this.mode === 'goto' && dot && this.dotSeen > 0.3) return this.setMode('chase');
        if (distXZ(this.pos, this.goal) < 0.12 || (!this.path.length && this.speed < 0.02 && this.modeTime > 0.5)) {
          const next = this.after;
          this.after = null;
          if (next === 'sofa') return this.jump(SOFA.seat, 0.5, 0.28, 'rest-sofa');
          return this.setMode(next || 'sit');
        }
        return;
      case 'hide':
        if (this.modeTime > this.duration && this.loom === 0) return this.setMode('sit');
        return;
      case 'paw':
        if (this.loom > 0.25) return this.flee();
        if (dot && this.dotSeen > 0.3) return this.setMode('chase');
        if (this.modeTime - this.pawAt > 0.7) {
          this.pawAt = this.modeTime;
          const c = this.room.curtains.sheer;
          c.poke(this.pos.x - c.mesh.position.x, 0.7);
        }
        if (this.modeTime > this.duration) return this.setMode('sit');
        return;
      case 'watch':
        if (this.loom > 0.25) return this.flee();
        if (dot && this.dotSeen > 0.3) return this.setMode('chase');
        if (!env.tvOn || this.modeTime > this.duration) return this.setMode('sit');
        return;
      case 'sit':
      default:
        if (this.loom > 0.25) return this.flee();
        if (dot && this.dotSeen > 0.3) return this.setMode('chase');
        if (poked) { this.modeTime = 0; return; }
        if (this.modeTime < this.duration) return;
        if (this.bored > 30) return this.goTo(SOFA.floor.x, SOFA.floor.z, SPEED.walk, 'sofa');
        if (env.tvOn && this.random() < 0.6) return this.goTo(TV.at.x, TV.at.z, SPEED.walk, 'watch');
        if (this.random() < 0.35) return this.goTo(CURTAIN.at.x, CURTAIN.at.z, SPEED.walk, 'paw');
        {
          const [x, z] = WANDER[Math.floor(this.random() * WANDER.length)];
          return this.goTo(x, z, SPEED.walk, 'sit');
        }
    }
  }

  // ---------------------------------------------------------------- moving
  move(dt) {
    if (this.jumpState) {
      const j = this.jumpState;
      j.t += dt;
      const s = Math.min(1, j.t / j.duration);
      this.pos.lerpVectors(j.from, j.to, s);
      this.pos.y += j.height * 4 * s * (1 - s);
      this.speed = 0;
      if (s >= 1) {
        this.jumpState = null;
        this.onSofa = j.to.y > 0.2;
        if (j.then === 'rest-sofa') {
          const pl = this.nearestPillow();
          if (pl) { pl.hopAt = this.interactions.time; pl.hopDir = 1; pl.hopAmp = 0.45; }
          this.setMode('rest');
        } else if (j.then === 'flee') {
          this.flee();
        } else {
          this.setMode(j.then || 'sit');
        }
      }
      return;
    }
    const moving = this.mode === 'goto' || this.mode === 'flee' || this.mode === 'chase';
    let want = moving ? this.goalSpeed : 0;
    if (moving && this.path.length) {
      let next = this.path[0];
      while (this.path.length > 1 && distXZ(this.pos, next) < 0.14) { this.path.shift(); next = this.path[0]; }
      const d = distXZ(this.pos, next);
      if (this.path.length === 1 && d < 0.06) { this.path.shift(); want = 0; }
      const turn = angleTo(this.heading, Math.atan2(next.x - this.pos.x, next.z - this.pos.z));
      const rate = this.speed > 1 ? 9 : 5;
      this.heading += Math.max(-rate * dt, Math.min(rate * dt, turn));
      // Slow down for sharp turns and at the end of the path.
      want *= Math.max(0.15, Math.cos(Math.min(Math.abs(turn), 1.4)));
      if (this.path.length === 1) want = Math.min(want, 0.4 + d * 3);
    } else {
      want = 0;
    }
    this.speed += (want - this.speed) * smooth(dt, want > this.speed ? 0.25 : 0.12);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.pos.y = this.onSofa ? SOFA.seat.y : 0;
    // Sitting still: face whatever it is doing (on the sofa: the room).
    if (!moving || this.speed < 0.05) {
      const face = this.mode === 'paw' ? CURTAIN.look : this.mode === 'watch' ? TV.look
        : (this.mode === 'chase' || this.mode === 'crouch') ? this.dot : null;   // (playing: it sits on the dot)
      if (face) this.heading += angleTo(this.heading, Math.atan2(face.x - this.pos.x, face.z - this.pos.z)) * smooth(dt, 0.25);
      else if (this.onSofa && this.mode === 'rest') this.heading += angleTo(this.heading, 0.3) * smooth(dt, 0.6);
    }
    this.phase += dt * this.speed / (this.speed > 1 ? 0.55 : 0.32);
  }

  nearestPillow() {
    let best = null;
    let bestD = 0.8;
    for (const pl of this.room.pillows) {
      pl.pivot.getWorldPosition(_v);
      const d = distXZ(_v, this.pos);
      if (d < bestD) { bestD = d; best = pl; }
    }
    return best;
  }

  // ---------------------------------------------------------------- animating
  animate(dt, env) {
    const m = this.mode;
    const target = m === 'sleep' ? 'loaf' : m === 'crouch' || m === 'play' ? 'crouch' : m === 'hide' ? 'hide' : m === 'stretch' ? 'stretch'
      : m === 'jump' ? 'leap' : this.speed > 0.08 ? 'stand' : m === 'chase' ? (this.dotOnFloor ? 'crouch' : 'sit') : m === 'goto' || m === 'flee' ? 'stand' : 'sit';
    const k = smooth(dt, m === 'jump' ? 0.06 : m === 'sleep' ? 0.6 : 0.18);
    const goal = POSES[target];
    for (const key of KEYS) this.pose[key] += (goal[key] - this.pose[key]) * k;
    const p = this.pose;
    const t = this.time;

    // Root: where it is and which way it faces.
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    // Gait: diagonal pairs swing opposite; the body bobs a little.
    const moving = this.speed > 0.03 && m !== 'jump';
    const swing = moving ? Math.min(0.75, 0.25 + this.speed * 0.3) : 0;
    const bob = moving ? Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.008 * Math.min(1, this.speed) : 0;
    const breathe = Math.sin(t * (m === 'sleep' ? 1.6 : 2.6)) * (m === 'sleep' ? 0.004 : 0.002);
    let wiggle = 0;
    if (m === 'crouch') wiggle = Math.sin(t * 22) * 0.012 * Math.min(1, this.modeTime * 3);   // the butt wiggle
    this.body.position.y = p.y + bob + breathe;
    this.body.rotation.x = p.pitch + (m === 'jump' && this.jumpState ? (this.jumpState.t / this.jumpState.duration - 0.5) * 0.6 : 0);
    this.body.rotation.z = wiggle;
    this.body.scale.set(1, 1 - p.tuck * 0.05, 1);

    for (const leg of this.legs) {
      const diagonal = (leg.front ? 0 : 0.5) + (leg.side > 0 ? 0.5 : 0);
      const s = Math.sin((this.phase + diagonal) * Math.PI * 2);
      const base = leg.front ? p.fLeg : p.bLeg;
      const knee = leg.front ? p.fKnee : p.bKnee;
      let reach = 0;
      if (m === 'paw' && leg.front && leg.side < 0) reach = Math.max(0, Math.sin(this.modeTime * 9)) * 1.4;   // batting at the curtain
      if (m === 'play' && leg.front) reach = Math.max(0, Math.sin(this.modeTime * 8 + leg.side * 1.6)) * 0.8;   // batting at the dot
      if (m === 'chase' && !this.dotOnFloor && leg.front && this.speed < 0.05) reach = Math.max(0, Math.sin(t * 5 + leg.side)) * 0.9;
      leg.hip.rotation.x = -(base + s * swing + reach);
      leg.knee.rotation.x = knee + Math.max(0, -s) * swing * 0.9;   // the paw lifts on the forward swing
      leg.hip.visible = p.tuck < 0.92;   // fully tucked under it while sleeping
    }

    // Tail: lifted and curled by the pose, swishing more when it is excited.
    const excited = m === 'chase' || m === 'crouch' || m === 'play' ? 1 : m === 'hide' || m === 'flee' ? 0.6 : m === 'sleep' ? 0.05 : 0.25;
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      const f = i / (this.tail.length - 1);
      const sway = Math.sin(t * (2 + excited * 5) - i * 0.6) * (0.06 + excited * 0.22) * f;
      const x = -(p.tailUp / this.tail.length) * (1.4 - f) + (i > 5 ? 0.18 : 0);
      if (i === 0) {
        seg.rotation.set(-p.tailUp * 0.35, Math.PI + p.tailSide * 0.1, 0);
      } else {
        seg.rotation.set(x, (p.tailSide / this.tail.length) + sway, 0);
      }
    }

    // Ears: back when scared or asleep, twitching now and then.
    const twitch = Math.max(0, Math.sin(t * 0.9 + 1.3) - 0.97) * 25;
    for (const ear of this.ears) {
      ear.rotation.set(-p.ears * 0.9 - twitch * 0.3, 0, -ear.userData.side * (0.25 + p.ears * 0.6));   // tipped outward
    }
    // Eyes: shut (no glow) asleep, blinking otherwise.
    const blink = m === 'sleep' ? 0 : (Math.sin(t * 0.7) > 0.985 ? 0.1 : 1);
    const open = p.eyes * blink;
    for (const e of this.eyes) {
      e.scale.y = 0.011 * Math.max(0.08, open);
      e.visible = open > 0.15;
    }
    // Curled up, the white chest and the head sink in.
    this.chest.scale.set(0.06, 0.06, 0.08).multiplyScalar(1 - 0.55 * p.tuck);
    this.chest.position.y = -0.03 + 0.02 * p.tuck;

    // Head: look at whatever has its attention; tilt it when you tilt yours.
    let look = null;
    if (m === 'chase' || m === 'crouch' || m === 'play') look = _v.set(this.dot.x, this.dotOnFloor ? 0.02 : this.dotHeight, this.dot.z);
    else if (m === 'paw') look = CURTAIN.look;
    else if (m === 'watch') look = TV.look;
    else if (m === 'sit' || m === 'rest' || m === 'hide' || m === 'stretch') look = env.lampSwinging ? env.lampPos : env.viewer;
    let yaw = 0;
    let pitch = p.headDown;
    let roll = 0;
    if (look && m !== 'sleep') {
      this.head.getWorldPosition(_w);
      const dx = look.x - _w.x;
      const dz = look.z - _w.z;
      const facing = angleTo(this.heading, Math.atan2(dx, dz));
      yaw = Math.max(-1.3, Math.min(1.3, facing));
      pitch = -Math.atan2(look.y - _w.y, Math.hypot(dx, dz)) - this.body.rotation.x + p.headDown * 0.3;
      pitch = Math.max(-0.9, Math.min(0.8, pitch));
      if (look === env.viewer) roll = Math.max(-0.45, Math.min(0.45, env.headRoll || 0));
    } else if (m === 'sleep') {
      yaw = 0.55;       // head down on its paws, turned a little
      pitch = 0.5;
    }
    const hk = smooth(dt, m === 'chase' ? 0.08 : 0.2);
    this.headYaw += (yaw - this.headYaw) * hk;
    this.headPitch += (pitch - this.headPitch) * hk;
    this.headRoll += (roll - this.headRoll) * smooth(dt, 0.25);
    this.head.rotation.set(this.headPitch, this.headYaw, -this.headRoll);
    this.neck.position.y = 0.055 - p.tuck * 0.05;
    this.neck.position.z = 0.16 + p.tuck * 0.02;
  }

  // env: { dot, shadowAt(p), viewer, lampPos, lampSwinging, tvOn, headRoll }
  update(dt, env) {
    if (!this.root.visible || dt <= 0) return;
    this.time += dt;
    this.modeTime += dt;
    this.shadowAt = env.shadowAt;
    this.think(dt, env);
    this.move(dt);
    this.animate(dt, env);
    const still = this.mode === 'sleep' || ((this.mode === 'sit' || this.mode === 'rest' || this.mode === 'watch' || this.mode === 'hide') && this.speed < 0.02 && this.modeTime > 1);
    this.moving = !still;
    this.busy = this.moving;
  }
}
