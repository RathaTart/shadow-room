// The user's shadow. A 2D "body plane" canvas (world-aligned, metres) holds the silhouette;
// it is rendered from the hall light's point of view into a render target that the light
// uses as its cookie (SpotLight.map). The result is a soft shadow that wraps over every
// surface the hall light reaches. A small CPU copy is kept for "is this object in my
// shadow?" tests.
import * as THREE from 'three';
import { DOOR } from './room.js';
import { makeCanvas } from './textures.js';

export const BODY = { W: 3.2, H: 2.6, PPM: 160 };

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class ShadowCaster {
  constructor(renderer, light, cookieSize = 1024) {
    this.renderer = renderer;
    this.light = light;
    const w = Math.round(BODY.W * BODY.PPM);
    const h = Math.round(BODY.H * BODY.PPM);
    this.canvas = makeCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.blurCanvas = makeCanvas(w, h);
    this.blurCtx = this.blurCanvas.getContext('2d');
    this.hitPPM = 50;
    this.hitW = Math.round(BODY.W * this.hitPPM);
    this.hitH = Math.round(BODY.H * this.hitPPM);
    this.hitCanvas = makeCanvas(this.hitW, this.hitH);
    this.hitCtx = this.hitCanvas.getContext('2d', { willReadFrequently: true });
    this.hitData = new Uint8ClampedArray(this.hitW * this.hitH * 4);

    this.texture = new THREE.CanvasTexture(this.blurCanvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: this.texture, transparent: true, opacity: 1,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(BODY.W, BODY.H), this.material);
    this.cookieScene = new THREE.Scene();
    this.cookieScene.add(this.quad);

    this.rt = new THREE.WebGLRenderTarget(cookieSize, cookieSize, {
      depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    light.map = this.rt.texture;

    this.centerX = 0;
    this.planeZ = -0.3;
    this.presence = 0;      // 0..1, fades the whole shadow in/out
    this.blurMeters = 0.03;
    this._clear = new THREE.Color();
    this.lightPos = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.cosAngle = 0.5;
  }

  setPlane(centerX, planeZ) {
    this.centerX = centerX;
    this.planeZ = planeZ;
    this.quad.position.set(centerX, BODY.H / 2, planeZ);
    this.quad.updateMatrixWorld();
  }

  // Start a frame: clear and switch the context to world metres (y up).
  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.useWorldTransform();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
  }

  useWorldTransform() {
    const x0 = this.centerX - BODY.W / 2;
    this.ctx.setTransform(BODY.PPM, 0, 0, -BODY.PPM, -x0 * BODY.PPM, BODY.H * BODY.PPM);
  }

  // Draw a MediaPipe mask (white person on transparent) so that mask pixel (eyeU, eyeV)
  // lands on the eye position in the world and one mask pixel is `mpp` metres.
  drawMask(maskCanvas, { eyeU, eyeV, mpp, mirror, eyeX, eyeY }) {
    const ctx = this.ctx;
    const x0 = this.centerX - BODY.W / 2;
    const cx = (eyeX - x0) * BODY.PPM;
    const cy = (BODY.H - eyeY) * BODY.PPM;
    const s = mpp * BODY.PPM;
    const sign = mirror ? -1 : 1;
    ctx.save();
    ctx.setTransform(sign * s, 0, 0, s, cx - sign * s * eyeU, cy - s * eyeV);
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();
  }

  // Webcam frames usually cut the body at the chest; continue it down to the floor
  // so the shadow looks like a standing person in the doorway.
  drawLowerBody(xa, xb, yCut) {
    const ctx = this.ctx;
    const cx = (xa + xb) / 2;
    const half = Math.min(Math.max((xb - xa) / 2, 0.12), 0.27);
    const hipY = Math.min(yCut - 0.04, 0.96);
    const hip = 0.175;
    ctx.beginPath();
    if (yCut > hipY + 0.02) {
      ctx.moveTo(cx - half, yCut + 0.03);
      ctx.bezierCurveTo(cx - half, yCut - 0.12, cx - hip - 0.01, hipY + 0.18, cx - hip, hipY);
      ctx.lineTo(cx + hip, hipY);
      ctx.bezierCurveTo(cx + hip + 0.01, hipY + 0.18, cx + half, yCut - 0.12, cx + half, yCut + 0.03);
      ctx.closePath();
      ctx.fill();
    }
    const top = Math.min(hipY + 0.01, yCut + 0.03);
    for (const side of [-1, 1]) {
      const outer = cx + side * hip;
      const inner = cx + side * 0.025;
      ctx.beginPath();
      ctx.moveTo(outer, top);
      ctx.bezierCurveTo(outer + side * 0.01, 0.62, cx + side * 0.14, 0.5, cx + side * 0.125, 0.1);
      ctx.lineTo(cx + side * 0.2, 0.03);
      ctx.lineTo(cx + side * 0.2, 0.0);
      ctx.lineTo(cx + side * 0.055, 0.0);
      ctx.lineTo(cx + side * 0.06, 0.1);
      ctx.bezierCurveTo(cx + side * 0.05, 0.45, inner, 0.6, inner, top);
      ctx.closePath();
      ctx.fill();
    }
  }

  // After drawing (every simulation step): refresh the small CPU copy used for hit tests.
  updateHit() {
    this.hitCtx.clearRect(0, 0, this.hitW, this.hitH);
    this.hitCtx.drawImage(this.canvas, 0, 0, this.hitW, this.hitH);
    this.hitData = this.hitCtx.getImageData(0, 0, this.hitW, this.hitH).data;
  }

  // Before rendering: blur for a soft penumbra and upload. Skipped while nobody is there.
  updateTexture() {
    if (this.presence < 0.002) return;
    const px = Math.max(0, this.blurMeters * BODY.PPM);
    const b = this.blurCtx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, this.blurCanvas.width, this.blurCanvas.height);
    b.filter = px > 0.3 ? `blur(${px.toFixed(2)}px)` : 'none';
    b.drawImage(this.canvas, 0, 0);
    b.filter = 'none';
    this.texture.needsUpdate = true;
  }

  syncLight() {
    const L = this.light;
    L.updateMatrixWorld();
    L.target.updateMatrixWorld();
    L.shadow.updateMatrices(L);
    this.lightPos.setFromMatrixPosition(L.matrixWorld);
    this.lightDir.setFromMatrixPosition(L.target.matrixWorld).sub(this.lightPos).normalize();
    this.cosAngle = Math.cos(L.angle);
  }

  renderCookie() {
    this.syncLight();
    this.material.opacity = this.presence;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.getClearColor(this._clear);
    const prevAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.setClearColor(0xffffff, 1);
    r.clear(true, false, false);
    if (this.presence > 0.001) r.render(this.cookieScene, this.light.shadow.camera);
    r.setRenderTarget(prevTarget);
    r.setClearColor(this._clear, prevAlpha);
    r.autoClear = prevAutoClear;
  }

  // Returns -1 if the hall light does not reach p, otherwise how much of it is shadowed (0..1).
  sample(p) {
    const L = this.lightPos;
    if (p.z >= this.planeZ - 0.02) return -1;
    // Must pass through the doorway...
    const td = (DOOR.z - L.z) / (p.z - L.z);
    const dx = L.x + (p.x - L.x) * td;
    const dy = L.y + (p.y - L.y) * td;
    if (dx < DOOR.xMin || dx > DOOR.xMax || dy < 0 || dy > DOOR.height) return -1;
    // ...and lie inside the spotlight cone.
    _dir.copy(p).sub(L).normalize();
    if (_dir.dot(this.lightDir) < this.cosAngle) return -1;
    // Where does the light ray cross the body plane?
    const t = (this.planeZ - L.z) / (p.z - L.z);
    const qx = L.x + (p.x - L.x) * t;
    const qy = L.y + (p.y - L.y) * t;
    const hx = Math.floor((qx - (this.centerX - BODY.W / 2)) * this.hitPPM);
    const hy = Math.floor((BODY.H - qy) * this.hitPPM);
    if (hx < 0 || hy < 0 || hx >= this.hitW || hy >= this.hitH) return 0;
    return (this.hitData[(hy * this.hitW + hx) * 4 + 1] / 255) * this.presence;
  }

  // Where on the body plane does a world point's light ray land? (for debugging / demo aiming)
  projectToPlane(p, out = _v) {
    const L = this.lightPos;
    const t = (this.planeZ - L.z) / (p.z - L.z);
    return out.set(L.x + (p.x - L.x) * t, L.y + (p.y - L.y) * t, this.planeZ);
  }
}
