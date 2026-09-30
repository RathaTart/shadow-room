// Cloth panel with static folds plus ripples that travel from wherever it gets poked.
import * as THREE from 'three';

export class Curtain {
  constructor({ width, height, segX, segY, amp, wavelength, material, seed = 1, castShadow = false }) {
    this.width = width;
    this.height = height;
    this.geometry = new THREE.PlaneGeometry(width, height, segX, segY);
    const pos = this.geometry.attributes.position;
    this.base = new Float32Array(pos.count);
    this.u = new Float32Array(pos.count);
    this.v = new Float32Array(pos.count);
    const p1 = seed * 1.7;
    const p2 = seed * 3.1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = (x + width / 2) / width;
      const v = (y + height / 2) / height; // 0 at hem, 1 at rod
      const k = (Math.PI * 2) / wavelength;
      const fold = 0.72 * Math.sin(x * k + p1) + 0.28 * Math.sin(x * k * 2.3 + p2) + 0.12 * Math.sin(x * k * 0.37 + p2);
      // Folds open up slightly toward the hem.
      const z = amp * fold * (0.8 + 0.35 * (1 - v));
      this.base[i] = z;
      this.u[i] = u;
      this.v[i] = v;
      pos.setZ(i, z);
    }
    this.geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.ripples = [];
    this.time = 0;
    this.breeze = 0.0035;
    this.dirty = true;
  }

  // localX in metres across the panel (0 = centre).
  poke(localX, strength = 1) {
    this.ripples.push({ x0: localX, t0: this.time, amp: 0.05 * strength });
    if (this.ripples.length > 10) this.ripples.shift();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.ripples = this.ripples.filter((r) => t - r.t0 < 5);
    const pos = this.geometry.attributes.position;
    const w = this.width;
    for (let i = 0; i < pos.count; i++) {
      const x = this.u[i] * w - w / 2;
      const hem = Math.pow(1 - this.v[i], 0.9); // top is pinned to the rod
      let dz = this.breeze * Math.sin(t * 0.6 + this.u[i] * 7.0) * hem;
      for (const r of this.ripples) {
        const age = t - r.t0;
        const dx = x - r.x0;
        const env = Math.exp(-age * 0.9) * Math.exp(-(dx * dx) / 0.35);
        dz += r.amp * env * Math.sin(age * 6.5 - Math.abs(dx) * 8) * hem;
      }
      pos.setZ(i, this.base[i] + dz);
    }
    pos.needsUpdate = true;
    // Normals only matter visibly while something is moving.
    if (this.ripples.length || this.dirty) {
      this.geometry.computeVertexNormals();
      this.dirty = this.ripples.length > 0;
    }
  }
}
