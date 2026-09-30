// Head-coupled perspective: the screen is treated as a window into the room.
// Moving the eye skews the frustum (off-axis projection), so the scene shifts exactly like the
// view through a real window. Turning your head additionally turns the view about the eye,
// like looking around (0 when head turn is off).
import * as THREE from 'three';

const _look = new THREE.Euler(0, 0, 0, 'YXZ');   // turn first, then look up/down: stays level

export class WindowCamera {
  constructor({ hfov = 76, windowCenter, eye, near = 0.03, far = 60 }) {
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, near, far);
    this.windowCenter = windowCenter.clone();
    this.baseEye = eye.clone();
    this.eye = eye.clone();
    this.near = near;
    this.far = far;
    this.aspect = 16 / 9;
    this.D0 = this.baseEye.z - this.windowCenter.z;
    // Reference frame: hfov at 16:9. Wider screens show more width, taller screens more height.
    this.refW = 2 * this.D0 * Math.tan(THREE.MathUtils.degToRad(hfov) / 2);
    this.refH = this.refW / (16 / 9);
    this.limits = {
      min: new THREE.Vector3(-0.9, 0.95, -1.0),
      max: new THREE.Vector3(0.9, 2.05, 0.35),
    };
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  windowSize() {
    if (this.aspect >= 16 / 9) return { w: this.refH * this.aspect, h: this.refH };
    return { w: this.refW, h: this.refW / this.aspect };
  }

  // offset: virtual metres relative to the resting eye position.
  // yaw: radians the view turns to the right; pitch: radians it looks up. Both about the eye.
  update(offset, yaw = 0, pitch = 0) {
    this.eye.copy(this.baseEye).add(offset).clamp(this.limits.min, this.limits.max);
    const { w, h } = this.windowSize();
    const D = Math.max(0.25, this.eye.z - this.windowCenter.z);
    const ex = this.eye.x - this.windowCenter.x;
    const ey = this.eye.y - this.windowCenter.y;
    const n = this.near;
    const left = ((-w / 2 - ex) * n) / D;
    const right = ((w / 2 - ex) * n) / D;
    const top = ((h / 2 - ey) * n) / D;
    const bottom = ((-h / 2 - ey) * n) / D;
    const cam = this.camera;
    cam.position.copy(this.eye);
    cam.quaternion.setFromEuler(_look.set(pitch, -yaw, 0));
    cam.updateMatrixWorld(true);
    cam.projectionMatrix.makePerspective(left, right, top, bottom, n, this.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }
}
