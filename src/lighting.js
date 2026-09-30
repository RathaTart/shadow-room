// Scene lights that are not attached to a prop: the hall light behind the viewer
// (it casts the user's shadow), moonlight through the window and soft bounce light.
import * as THREE from 'three';
import { ROOM, WINDOW } from './room.js';

export function createLights(scene, profile) {
  const L = {};

  // Faint bounce / ambient so shadows are not pitch black.
  L.hemi = new THREE.HemisphereLight(0x39445e, 0x2c2119, 0.2);
  scene.add(L.hemi);

  // Hall light behind the viewer. Its cookie (spot map) carries the user's silhouette.
  L.hall = new THREE.SpotLight(0xffd7a3, 375, 0, THREE.MathUtils.degToRad(40), 0.4, 2);
  L.hall.castShadow = true;
  L.hall.shadow.mapSize.set(profile.hallShadow, profile.hallShadow);
  L.hall.shadow.camera.near = 0.25;
  L.hall.shadow.camera.far = 16;
  L.hall.shadow.bias = -0.00035;
  L.hall.shadow.normalBias = 0.02;
  scene.add(L.hall, L.hall.target);
  L.lamp = buildHallLamp();
  scene.add(L.lamp.group);

  // Moonlight through the window.
  L.moon = new THREE.DirectionalLight(0xa8b9e0, 0.8);
  // Steep enough to clear the window head, shallow enough to reach the rug.
  L.moon.target.position.set(0.35, 0, -5.3);
  L.moon.position.copy(L.moon.target.position).addScaledVector(new THREE.Vector3(-0.25, 0.92, -1).normalize(), 14);
  L.moon.castShadow = true;
  L.moon.shadow.mapSize.set(profile.moonShadow, profile.moonShadow);
  const sc = L.moon.shadow.camera;
  sc.left = -4.5; sc.right = 4.5; sc.top = 4.5; sc.bottom = -4.5; sc.near = 1; sc.far = 24;
  L.moon.shadow.bias = -0.0006;
  L.moon.shadow.normalBias = 0.03;
  scene.add(L.moon, L.moon.target);

  // Soft sky light coming through the sheer curtain.
  L.windowFill = new THREE.RectAreaLight(0x7f95c8, 0.6, WINDOW.xMax - WINDOW.xMin, WINDOW.yMax - WINDOW.yMin);
  L.windowFill.position.set((WINDOW.xMin + WINDOW.xMax) / 2, (WINDOW.yMin + WINDOW.yMax) / 2, ROOM.zBack + 0.05);
  L.windowFill.lookAt(L.windowFill.position.x, L.windowFill.position.y - 0.4, 0);
  scene.add(L.windowFill);

  return L;
}

export function placeHallLight(L, height, distance, intensity = 1) {
  L.hall.position.set(0, height, distance);
  // Aim through the doorway at the lower back wall.
  L.hall.target.position.set(0, 0.95, ROOM.zBack + 0.5);
  L.hall.updateMatrixWorld();
  L.hall.target.updateMatrixWorld();
  // The lamp stands where the light is and points the same way.
  const { group, head, pole, lens } = L.lamp;
  group.position.set(0, 0, distance);
  head.position.set(0, height, 0);
  pole.scale.y = Math.max(0.05, height - LAMP_TRIPOD_TOP);
  pole.position.y = LAMP_TRIPOD_TOP + pole.scale.y / 2;
  group.updateMatrixWorld(true);
  head.lookAt(L.hall.target.position);
  lens.material.color.setHex(0xffe6c4).multiplyScalar(6 * intensity);
}

const LAMP_TRIPOD_TOP = 0.55;

// The hall light's lamp, in the hallway behind you: a floor spotlight on a tripod, facing the
// room. You only see it when you turn around. It casts no shadow (the light sits inside it).
function buildHallLamp() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.42, metalness: 0.65 });
  const group = new THREE.Group();
  const part = (geometry, material = metal) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  };
  // Head, built facing +z so lookAt() aims it.
  const head = new THREE.Group();
  group.add(head);
  const can = part(new THREE.CylinderGeometry(0.1, 0.125, 0.26, 28, 1, true));
  can.material = metal.clone();
  can.material.side = THREE.DoubleSide;
  can.rotation.x = Math.PI / 2;
  head.add(can);
  const back = part(new THREE.CircleGeometry(0.125, 28));
  back.position.z = -0.13;
  back.rotation.y = Math.PI;
  head.add(back);
  const lens = part(new THREE.CircleGeometry(0.098, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  lens.position.z = 0.1;
  head.add(lens);
  const rim = part(new THREE.TorusGeometry(0.1, 0.008, 8, 32));
  rim.position.z = 0.13;
  head.add(rim);
  for (const s of [-1, 1]) {
    const arm = part(new THREE.BoxGeometry(0.015, 0.2, 0.03));
    arm.position.set(s * 0.135, -0.07, 0);
    head.add(arm);
  }
  // Pole (unit height, scaled to the light height) on a tripod.
  const pole = part(new THREE.CylinderGeometry(0.012, 0.014, 1, 10));
  group.add(pole);
  const hub = part(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 12));
  hub.position.y = LAMP_TRIPOD_TOP;
  group.add(hub);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = new THREE.Vector3(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38);
    const top = new THREE.Vector3(0, LAMP_TRIPOD_TOP, 0);
    const leg = part(new THREE.CylinderGeometry(0.009, 0.011, foot.distanceTo(top), 8));
    leg.position.copy(foot).add(top).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    group.add(leg);
  }
  // A cable across the floor, for the lived-in look.
  const cable = part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.15, 0.01, 0.2), new THREE.Vector3(0.9, 0.01, 0.6), new THREE.Vector3(1.85, 0.02, 0.9),
  ]), 24, 0.005, 5, false));
  group.add(cable);
  return { group, head, pole, lens };
}
