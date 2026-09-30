// Things in the room react when your shadow touches them (or when you click them).
// "Touching" = a sample point on the object is lit by the hall light but blocked by
// your silhouette, i.e. your shadow is falling on it.
import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

function gridOnPlane(w, h, nx, ny, map) {
  const pts = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u = nx === 1 ? 0 : i / (nx - 1) - 0.5;
      const v = ny === 1 ? 0 : j / (ny - 1) - 0.5;
      pts.push(map(u * w, v * h));
    }
  }
  return pts;
}

export class Interactions {
  constructor({ room, caster, settings, camera }) {
    this.room = room;
    this.caster = caster;
    this.settings = settings;
    this.camera = camera;
    this.items = [];
    this.log = [];
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.roomLevel = settings.get('roomLight') ? 1 : 0;
    this.moving = true;       // something that casts shadows is moving (shadow maps must be redrawn)
    this.busy = true;         // anything is still animating (the renderer should not idle)
    this.build();
  }

  add(item) {
    item.covered = false;
    item.dwell = 0;
    item.lastTrigger = -1e9;
    item.pointState = new Uint8Array(item.points.length);
    item.threshold ??= 0.3;
    item.cooldown ??= 1;
    item.dwellTime ??= 0;
    this.items.push(item);
    return item;
  }

  emit(name, how) {
    this.log.push({ t: +this.time.toFixed(2), name, how });
    if (this.log.length > 50) this.log.shift();
  }

  build() {
    const R = this.room;

    // --- pendant lamp: swats make it swing, which swings every shadow in the room
    const P = R.pendant;
    const lampPts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      lampPts.push(new THREE.Vector3(Math.cos(a) * 0.27, -0.74, Math.sin(a) * 0.27));
    }
    lampPts.push(new THREE.Vector3(0, -0.86, 0), new THREE.Vector3(0, -0.62, 0.27));
    this.add({
      name: 'lamp', object: P.group, points: lampPts, meshes: [P.shade, P.diffuser, P.bulb],
      threshold: 0.18, cooldown: 0.7,
      touch: (info) => {
        const dir = info.dirX || (Math.random() < 0.5 ? -1 : 1);
        P.vz += dir * 0.85 * info.strength;
        P.vx += (Math.random() - 0.5) * 0.5 * info.strength;
        P.flicker = 1;
      },
    });

    // --- light switch: flips the pendant on/off
    const S = R.lightSwitch;
    this.add({
      name: 'switch', object: S.group, points: [new THREE.Vector3(-0.01, 0, 0), new THREE.Vector3(-0.01, 0.045, 0), new THREE.Vector3(-0.01, -0.045, 0)],
      meshes: S.group.children, threshold: 0.34, cooldown: 1.8, dwellTime: 0.3,
      touch: () => this.settings.set('roomLight', !this.settings.get('roomLight'), { save: false }),
    });

    // --- TV: on/off
    const T = R.tv;
    const tvPts = gridOnPlane(1.3, 0.7, 4, 3, (a, b) => new THREE.Vector3(-0.02, b, a));
    this.add({
      name: 'tv', object: T.group, points: tvPts.map((p) => p.add(T.screen.position)), meshes: [T.screen, T.group.children[0]],
      threshold: 0.25, cooldown: 2.4, dwellTime: 0.6,
      touch: () => { T.on = !T.on; T.switchedAt = this.time; },
    });

    // --- pillows: hop
    for (const [i, pl] of R.pillows.entries()) {
      const pts = [new THREE.Vector3(0, 0.2, 0.07), new THREE.Vector3(0.16, 0.34, 0.07), new THREE.Vector3(-0.16, 0.34, 0.07),
        new THREE.Vector3(0.16, 0.06, 0.07), new THREE.Vector3(-0.16, 0.06, 0.07)];
      this.add({
        name: `pillow${i}`, object: pl.pivot, points: pts, meshes: [pl.mesh], threshold: 0.6, cooldown: 2,
        touch: (info) => { pl.hopAt = this.time; pl.hopDir = info.dirX || 1; pl.hopAmp = 0.7 + 0.3 * info.strength; },
      });
    }

    // --- candle: flame gutters
    const C = R.candle;
    this.add({
      name: 'candle', object: C.group, points: [new THREE.Vector3(0, 0.085, 0), new THREE.Vector3(0, 0.12, 0)], meshes: [C.flame, C.wax],
      threshold: 0.5, cooldown: 1.0,
      touch: (info) => { C.disturb = 1; C.leanDir = info.dirX || 1; },
    });

    // --- paintings: knocked crooked (touch again to straighten)
    for (const [i, pt] of R.paintings.entries()) {
      const pts = gridOnPlane(0.6, 0.85, 3, 3, (a, b) => new THREE.Vector3(0.04, b, a));
      this.add({
        name: `painting${i}`, object: pt.art, points: pts, meshes: pt.art.children, threshold: 0.25, cooldown: 1.6,
        touch: (info) => {
          pt.vel += (info.dirX || 1) * 1.4 * info.strength;
          pt.rest = Math.abs(pt.rest) > 0.001 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.04);
        },
      });
    }

    // --- plant: each leaf rustles as the shadow edge passes over it
    for (const [i, lf] of R.leaves.entries()) {
      this.add({
        name: `leaf${i}`, object: lf.tilt, points: [new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 0.33, 0)],
        meshes: lf.tilt.children, threshold: 0.5, cooldown: 0.5, quiet: true,
        touch: (info) => {
          lf.va += (Math.random() - 0.5) * 3 * info.strength;
          lf.vb += (info.dirX || 1) * 2.2 * info.strength;
        },
      });
    }

    // --- curtains: every point the shadow edge sweeps over sends out a ripple
    const curtainItem = (name, curtain, nx, ny) => {
      const pts = gridOnPlane(curtain.width * 0.92, curtain.height * 0.8, nx, ny, (a, b) => new THREE.Vector3(a, b, 0));
      this.add({
        name, object: curtain.mesh, points: pts, meshes: [curtain.mesh], threshold: 2, cooldown: 0, perPoint: true, quiet: true,
        curtain, lastPoke: -1e9,
        pointTouch: (idx, strength) => curtain.poke(pts[idx].x, strength),
        touch: (info) => curtain.poke(info.localX ?? 0, 1.4 * info.strength),
      });
    };
    curtainItem('sheer', R.curtains.sheer, 16, 3);
    curtainItem('drapeL', R.curtains.drapeL, 3, 3);
    curtainItem('drapeR', R.curtains.drapeR, 3, 3);
  }

  // Horizontal direction of a push: away from the body's centre on the body plane.
  pushDir(item) {
    const c = this.caster;
    let sx = 0;
    let n = 0;
    for (let i = 0; i < item.points.length; i++) {
      if (!item.pointState[i]) continue;
      _p.copy(item.points[i]);
      item.object.localToWorld(_p);
      c.projectToPlane(_p, _q);
      sx += _q.x;
      n++;
    }
    if (!n) return 0;
    return Math.sign(sx / n - c.bodyX) || 1;
  }

  checkShadow(dt) {
    if (!this.settings.get('interactions')) return;
    const c = this.caster;
    for (const item of this.items) {
      let lit = 0;
      let hit = 0;
      for (let i = 0; i < item.points.length; i++) {
        _p.copy(item.points[i]);
        item.object.localToWorld(_p);
        const s = c.sample(_p);
        const was = item.pointState[i];
        const now = s > 0.5 ? 1 : 0;
        if (s >= 0) lit++;
        if (now) hit++;
        item.pointState[i] = now;
        if (item.perPoint && now && !was && this.time - item.lastPoke > 0.06) {
          item.pointTouch(i, 0.9);
          item.lastPoke = this.time;
        }
      }
      if (item.perPoint) continue;
      const coverage = lit ? hit / lit : 0;
      const covered = coverage >= item.threshold;
      if (covered) item.dwell += dt; else item.dwell = 0;
      if (covered && !item.covered && item.dwellTime === 0) this.trigger(item, 'shadow');
      else if (covered && item.dwellTime > 0 && item.dwell >= item.dwellTime && item.dwell - dt < item.dwellTime) this.trigger(item, 'shadow');
      item.covered = covered;
    }
  }

  trigger(item, how, strength = 1) {
    if (this.time - item.lastTrigger < item.cooldown) return false;
    item.lastTrigger = this.time;
    item.touch({ strength, dirX: how === 'click' ? 0 : this.pushDir(item) });
    if (!item.quiet || how === 'click') this.emit(item.name, how);
    return true;
  }

  // Mouse click (Lively forwards clicks on the desktop to the wallpaper).
  click(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const meshes = [];
    const owner = new Map();
    for (const item of this.items) for (const m of item.meshes) { meshes.push(m); owner.set(m, item); }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const item = owner.get(hits[0].object);
    if (item.curtain) {
      const local = item.object.worldToLocal(hits[0].point.clone());
      item.curtain.poke(local.x, 1.6);
      this.emit(item.name, 'click');
      return item.name;
    }
    this.trigger(item, 'click', 1.2);
    return item.name;
  }

  // ------------------------------------------------------------------ animation
  update(dt) {
    this.time += dt;
    const t = this.time;
    const R = this.room;
    this.checkShadow(dt);

    // Pendant: damped spherical pendulum (small angles), period ~1.7 s.
    const P = R.pendant;
    const w2 = 9.81 / 0.74;
    P.vx += (-w2 * P.ax - 0.32 * P.vx) * dt;
    P.vz += (-w2 * P.az - 0.32 * P.vz) * dt;
    P.ax += P.vx * dt;
    P.az += P.vz * dt;
    P.group.rotation.set(P.ax, 0, P.az);
    P.flicker = Math.max(0, (P.flicker || 0) - dt * 2.5);
    const target = this.settings.get('roomLight') ? 1 : 0;
    this.roomLevel += (target - this.roomLevel) * Math.min(1, dt * 7);
    const flick = 1 - P.flicker * 0.35 * (0.5 + 0.5 * Math.sin(t * 60));
    const lvl = this.roomLevel * this.settings.get('roomIntensity') * flick;
    P.spot.intensity = 6 * lvl;
    P.up.intensity = 1.8 * lvl;
    P.shadeMat.emissiveIntensity = 1.1 * lvl;
    P.diffuser.material.opacity = 0.12 + 0.73 * this.roomLevel;
    P.bulb.material.color.setRGB(1, 0.94, 0.82).multiplyScalar(0.2 + 0.8 * this.roomLevel * flick);

    // Switch rocker + locator LED (glows when the room light is off).
    const S = R.lightSwitch;
    S.rocker.rotation.z = THREE.MathUtils.lerp(S.rocker.rotation.z, target ? 0.25 : -0.25, Math.min(1, dt * 12));
    S.led.material.color.setRGB(1, 0.62, 0.25).multiplyScalar(0.25 + 0.75 * (1 - this.roomLevel));

    // TV
    const T = R.tv;
    const goal = T.on ? 1 : 0;
    T.level += (goal - T.level) * Math.min(1, dt * (T.on ? 3 : 9));
    if (T.level > 0.003) {
      if (!T.lastPaint || t - T.lastPaint > 1 / 12) { T.content.paint(t); T.lastPaint = t; }
      const flash = T.on && t - (T.switchedAt || 0) < 0.25 ? 1.8 : 1;
      const b = T.content.brightness * T.level * flash;
      T.screenMat.emissiveIntensity = 7 * b;
      T.light.intensity = 40 * b;
      T.light.color.copy(T.content.tint);
    } else {
      T.screenMat.emissiveIntensity = 0;
      T.light.intensity = 0;
    }
    T.led.material.color.setRGB(1, 0.19, 0.12).multiplyScalar(T.on ? 0.15 : 1);

    // Pillows hop and wobble
    for (const pl of R.pillows) {
      const age = t - (pl.hopAt ?? -1e9);
      if (age < 2.5) {
        const e = Math.exp(-age * 3.2) * (pl.hopAmp || 1);
        pl.pivot.position.y = pl.baseY + 0.07 * e * Math.abs(Math.sin(age * 10));
        pl.pivot.rotation.x = pl.baseRot.x + 0.12 * e * Math.sin(age * 13) * (pl.hopDir || 1);
        pl.pivot.rotation.z = pl.baseRot.z + 0.08 * e * Math.sin(age * 11 + 1);
      } else {
        pl.pivot.position.y = pl.baseY;
        pl.pivot.rotation.x = pl.baseRot.x;
        pl.pivot.rotation.z = pl.baseRot.z;
      }
    }

    // Candle flame: flicker, gutter when disturbed
    const C = R.candle;
    C.disturb = Math.max(0, (C.disturb || 0) - dt * 0.6);
    const d = C.disturb;
    const flicker = 0.86 + 0.09 * Math.sin(t * 13.7) * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 31.1);
    const gutter = 1 - d * (0.55 + 0.4 * Math.sin(t * 40) * Math.sin(t * 17));
    C.light.intensity = 0.35 * flicker * gutter;
    C.flame.scale.set(1 + d * 0.3, 2.4 * (0.9 + 0.12 * flicker) * (1 - d * 0.45), 1);
    C.flame.rotation.z = (C.leanDir || 1) * d * 0.6 * (0.7 + 0.3 * Math.sin(t * 23));
    C.core.rotation.z = C.flame.rotation.z;
    C.flame.material.opacity = 0.95 * (0.35 + 0.65 * gutter);

    // Paintings swing on their nail and settle (maybe crooked)
    for (const pt of R.paintings) {
      pt.vel += (-(9.81 / 0.55) * (pt.angle - pt.rest) - 1.6 * pt.vel) * dt;
      pt.angle += pt.vel * dt;
      pt.nail.rotation.x = pt.angle;
    }

    // Leaves: damped springs around their rest pose
    for (const lf of R.leaves) {
      lf.va += (-40 * lf.a - 2.2 * lf.va) * dt;
      lf.vb += (-30 * lf.b - 2.0 * lf.vb) * dt;
      lf.a += lf.va * dt;
      lf.b += lf.vb * dt;
      lf.tilt.rotation.x = lf.baseTilt + lf.a * 0.25;
      lf.pivot.rotation.y = lf.baseYaw + lf.b * 0.2;
    }

    for (const c of Object.values(R.curtains)) c.update(dt);

    // Still in motion? The springs decay forever, so "still" means below what anyone could see.
    const lamp = Math.abs(P.ax) + Math.abs(P.az) + Math.abs(P.vx) + Math.abs(P.vz) > 1e-3;
    const pillows = R.pillows.some((pl) => t - (pl.hopAt ?? -1e9) < 2.5);
    const paintings = R.paintings.some((pt) => Math.abs(pt.vel) > 1e-3 || Math.abs(pt.angle - pt.rest) > 1e-4);
    const leaves = R.leaves.some((lf) => Math.abs(lf.a) + Math.abs(lf.b) + Math.abs(lf.va) + Math.abs(lf.vb) > 1e-3);
    const ripples = Object.values(R.curtains).some((c) => c.ripples.length > 0);
    this.moving = lamp || pillows || paintings || leaves || ripples;
    this.busy = this.moving || P.flicker > 0 || C.disturb > 0
      || Math.abs(target - this.roomLevel) > 1e-3 || Math.abs(goal - T.level) > 1e-3;
  }
}
