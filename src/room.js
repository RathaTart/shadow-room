// The living room: shell, furniture and props. Metres, y up, the room extends toward -z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';
import { Curtain } from './curtain.js';

export const ROOM = { xMin: -2.6, xMax: 2.6, zBack: -7.0, zFront: 0, height: 2.8 };
// Wide opening in the front wall (behind the viewer). The hall light shines through it.
export const DOOR = { xMin: -1.6, xMax: 1.6, height: 2.3, z: 0 };
// The hallway behind that opening, where the hall light stands (seen when you look behind you).
export const HALL = { halfWidth: 1.9, zEnd: 4.8 };
export const WINDOW = { xMin: -1.75, xMax: 1.55, yMin: 0.42, yMax: 2.3 };

function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function box(w, h, d, material, x, y, z, opts) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material, opts);
  m.position.set(x, y, z);
  return m;
}

function rbox(w, h, d, r, material, x, y, z, opts) {
  const m = mesh(new RoundedBoxGeometry(w, h, d, 3, r), material, opts);
  m.position.set(x, y, z);
  return m;
}

function cyl(rTop, rBottom, h, material, x, y, z, { segments = 32, open = false, ...opts } = {}) {
  const m = mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open), material, opts);
  m.position.set(x, y, z);
  return m;
}

export function buildRoom(scene) {
  const R = ROOM;
  const refs = { interactive: {} };
  const group = new THREE.Group();
  group.name = 'room';
  scene.add(group);

  // ------------------------------------------------------------ materials
  const wood = TX.woodFloor();
  wood.map.repeat.set(2.6, 3.9);
  wood.roughnessMap.repeat.copy(wood.map.repeat);
  const fabricBump = TX.fabricBump();

  const M = {
    wall: new THREE.MeshStandardMaterial({ color: 0x9d8f7e, roughness: 0.96 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xb9b2a7, roughness: 0.97 }),
    floor: new THREE.MeshStandardMaterial({
      map: wood.map, roughnessMap: wood.roughnessMap, roughness: 0.9, metalness: 0, envMapIntensity: 0.35,
    }),
    baseboard: new THREE.MeshStandardMaterial({ color: 0xc9c2b6, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.42, metalness: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.32, metalness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0b1222, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false,
    }),
    sofa: new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.97, bumpMap: fabricBump, bumpScale: 1.2 }),
    sofaDark: new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.8 }),
    pillowStripe: new THREE.MeshStandardMaterial({ map: TX.stripes(), roughness: 0.95 }),
    pillowGrey: new THREE.MeshStandardMaterial({ color: 0x8b8783, roughness: 0.97, bumpMap: fabricBump, bumpScale: 1 }),
    pillowCream: new THREE.MeshStandardMaterial({ color: 0xd4ccbf, roughness: 0.97, bumpMap: fabricBump, bumpScale: 1 }),
    table: new THREE.MeshStandardMaterial({ color: 0xc4bdb2, roughness: 0.4, envMapIntensity: 0.6 }),
    console: new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.34, envMapIntensity: 0.5 }),
    groove: new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.8 }),
    tvBody: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.28, metalness: 0.3 }),
    cabinet: new THREE.MeshStandardMaterial({
      map: wood.map.clone(), color: 0x8a7563, roughness: 0.5, envMapIntensity: 0.4,
    }),
    frame: new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.55, metalness: 0.2 }),
    sheer: new THREE.MeshStandardMaterial({
      color: 0xb3ab9f, roughness: 1, transparent: true, opacity: 0.86, side: THREE.DoubleSide,
      depthWrite: false, emissive: new THREE.Color(0x2c3552), emissiveIntensity: 0.1,
    }),
    drape: new THREE.MeshStandardMaterial({ color: 0x4d443b, roughness: 1, side: THREE.DoubleSide, bumpMap: fabricBump, bumpScale: 0.6 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0x35302c, roughness: 0.5 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x1c1510, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({
      map: TX.leaf(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, color: 0xa0b890,
    }),
    stem: new THREE.MeshStandardMaterial({ color: 0x3c4a2a, roughness: 0.7 }),
    branch: new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0xe4e1db, roughness: 0.45 }),
  };
  M.cabinet.map.repeat.set(0.6, 0.6);
  M.cabinet.map.rotation = Math.PI / 2;
  refs.materials = M;

  // ------------------------------------------------------------ shell
  const W = R.xMax - R.xMin;
  const depth = R.zFront - R.zBack;
  const extra = 0.9; // walls continue a little behind the viewer
  // Floor and ceiling run on through the doorway to the end of the hallway (one plane each, so
  // the floorboards continue without a seam; the parts outside the hallway are hidden by walls).
  const length = HALL.zEnd - R.zBack;
  M.floor.map.repeat.y = wood.map.repeat.y * (length / (depth + extra));   // same board size as before
  M.floor.roughnessMap.repeat.copy(M.floor.map.repeat);
  const floor = mesh(new THREE.PlaneGeometry(W, length), M.floor, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (R.zBack + HALL.zEnd) / 2);
  group.add(floor);

  const ceiling = mesh(new THREE.PlaneGeometry(W, length), M.ceiling, { cast: false });
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, R.height, (R.zBack + HALL.zEnd) / 2);
  group.add(ceiling);

  const t = 0.2; // wall thickness
  const bbH = 0.085; // baseboards
  const bbT = 0.014;
  const sideLen = depth + extra + t;
  const sideZ = (R.zBack - t + R.zFront + extra) / 2;
  group.add(box(t, R.height, sideLen, M.wall, R.xMin - t / 2, R.height / 2, sideZ));
  group.add(box(t, R.height, sideLen, M.wall, R.xMax + t / 2, R.height / 2, sideZ));

  // Back wall in four pieces around the window opening
  const Wn = WINDOW;
  const bz = R.zBack - t / 2;
  const bw = W + 2 * t;
  group.add(box(Wn.xMin - (R.xMin - t), R.height, t, M.wall, (R.xMin - t + Wn.xMin) / 2, R.height / 2, bz));
  group.add(box(R.xMax + t - Wn.xMax, R.height, t, M.wall, (Wn.xMax + R.xMax + t) / 2, R.height / 2, bz));
  group.add(box(Wn.xMax - Wn.xMin, Wn.yMin, t, M.wall, (Wn.xMin + Wn.xMax) / 2, Wn.yMin / 2, bz));
  group.add(box(Wn.xMax - Wn.xMin, R.height - Wn.yMax, t, M.wall, (Wn.xMin + Wn.xMax) / 2, (Wn.yMax + R.height) / 2, bz));
  void bw;

  // Front wall with the doorway, behind the viewer. It casts shadows, so the hall light arrives
  // as a door-shaped patch; you see it when you turn around.
  const D = DOOR;
  const fz = D.z + t / 2;
  group.add(box(D.xMin - (R.xMin - t), R.height, t, M.wall, (R.xMin - t + D.xMin) / 2, R.height / 2, fz));
  group.add(box(R.xMax + t - D.xMax, R.height, t, M.wall, (D.xMax + R.xMax + t) / 2, R.height / 2, fz));
  group.add(box(D.xMax - D.xMin, R.height - D.height, t, M.wall, 0, (D.height + R.height) / 2, fz));
  // Door casing on the room side.
  const trim = 0.07;
  for (const x of [D.xMin - trim / 2, D.xMax + trim / 2]) group.add(box(trim, D.height + trim, 0.02, M.baseboard, x, (D.height + trim) / 2, D.z - 0.01, { cast: false }));
  group.add(box(D.xMax - D.xMin + 2 * trim, trim, 0.02, M.baseboard, 0, D.height + trim / 2, D.z - 0.01, { cast: false }));

  // ------------------------------------------------------------ hallway (behind you)
  // Lit by the hall light at its near end and the lamp's own glow; it casts no shadows into
  // the room (the doorway already frames the light).
  const H = HALL;
  const hallOpts = { cast: false, receive: true };
  const hallLen = H.zEnd - (D.z + t);
  const hallZ = (D.z + t + H.zEnd) / 2;
  for (const s of [-1, 1]) {
    group.add(box(t, R.height, hallLen, M.wall, s * (H.halfWidth + t / 2), R.height / 2, hallZ, hallOpts));
    group.add(box(bbT, bbH, hallLen, M.baseboard, s * (H.halfWidth - bbT / 2), bbH / 2, hallZ, hallOpts));
  }
  group.add(box(2 * (H.halfWidth + t), R.height, t, M.wall, 0, R.height / 2, H.zEnd + t / 2, hallOpts));
  group.add(box(2 * H.halfWidth, bbH, bbT, M.baseboard, 0, bbH / 2, H.zEnd - bbT / 2, hallOpts));
  // Front door at the far end, with a runner rug leading to it.
  const door = new THREE.Group();
  door.position.set(0.35, 0, H.zEnd - 0.012);
  group.add(door);
  door.add(box(0.96, 2.1, 0.04, M.frame, 0, 1.05, 0, hallOpts));
  door.add(box(0.86, 2.02, 0.03, new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.6 }), 0, 1.03, -0.02, hallOpts));
  for (const y of [0.55, 1.45]) door.add(box(0.62, 0.62, 0.012, M.groove, 0, y, -0.04, hallOpts));
  const knob = mesh(new THREE.SphereGeometry(0.03, 16, 10), M.brass, hallOpts);
  knob.position.set(-0.34, 1.0, -0.06);
  door.add(knob);
  const runner = mesh(new THREE.BoxGeometry(1.1, 0.01, 3.2), new THREE.MeshStandardMaterial({ map: TX.rug(33), roughness: 1 }), hallOpts);
  runner.position.set(0, 0.005, (D.z + t + H.zEnd) / 2 + 0.2);
  group.add(runner);
  // Coat hooks with a jacket, on the left wall.
  const hooks = new THREE.Group();
  hooks.position.set(-H.halfWidth + 0.01, 1.7, 2.9);
  group.add(hooks);
  hooks.add(box(0.02, 0.06, 0.7, M.frame, 0, 0, 0, hallOpts));
  const coat = mesh(new THREE.CapsuleGeometry(0.16, 0.55, 4, 10), new THREE.MeshStandardMaterial({ color: 0x3b4450, roughness: 0.95, bumpMap: fabricBump, bumpScale: 0.6 }), hallOpts);
  coat.scale.set(0.55, 1, 1);
  coat.position.set(0.1, -0.42, -0.12);
  hooks.add(coat);

  // Baseboards
  group.add(box(bbT, bbH, depth + extra, M.baseboard, R.xMin + bbT / 2, bbH / 2, sideZ + t / 2, { cast: false }));
  group.add(box(bbT, bbH, depth + extra, M.baseboard, R.xMax - bbT / 2, bbH / 2, sideZ + t / 2, { cast: false }));
  group.add(box(W, bbH, bbT, M.baseboard, 0, bbH / 2, R.zBack + bbT / 2, { cast: false }));

  // ------------------------------------------------------------ window
  const fzw = R.zBack - t / 2;
  const fw = 0.055;
  const fd = 0.07;
  const wcx = (Wn.xMin + Wn.xMax) / 2;
  const wcy = (Wn.yMin + Wn.yMax) / 2;
  const wW = Wn.xMax - Wn.xMin;
  const wH = Wn.yMax - Wn.yMin;
  const frameOpts = { cast: true, receive: true };
  group.add(box(wW, fw, fd, M.metal, wcx, Wn.yMin + fw / 2, fzw, frameOpts));
  group.add(box(wW, fw, fd, M.metal, wcx, Wn.yMax - fw / 2, fzw, frameOpts));
  group.add(box(fw, wH, fd, M.metal, Wn.xMin + fw / 2, wcy, fzw, frameOpts));
  group.add(box(fw, wH, fd, M.metal, Wn.xMax - fw / 2, wcy, fzw, frameOpts));
  for (const mx of [Wn.xMin + wW / 3, Wn.xMin + (2 * wW) / 3]) group.add(box(0.04, wH, fd, M.metal, mx, wcy, fzw, frameOpts));
  group.add(box(wW, 0.04, fd, M.metal, wcx, Wn.yMin + wH * 0.78, fzw, frameOpts));
  const glass = mesh(new THREE.PlaneGeometry(wW, wH), M.glass, { cast: false, receive: false });
  glass.position.set(wcx, wcy, fzw - 0.01);
  group.add(glass);
  // Window sill
  group.add(box(wW + 0.12, 0.03, 0.26, M.baseboard, wcx, Wn.yMin - 0.015, R.zBack + 0.07));

  // City at night outside
  const city = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 13),
    new THREE.MeshBasicMaterial({ map: TX.cityNight(), color: 0x9aa3b8 }),
  );
  city.position.set(-1.5, 2.2, -17);
  group.add(city);

  // Air conditioner above the window, like the reference room
  const ac = rbox(0.92, 0.26, 0.21, 0.035, M.plastic, 0.55, 2.6, R.zBack + 0.105);
  group.add(ac);
  group.add(box(0.8, 0.012, 0.02, M.groove, 0.55, 2.49, R.zBack + 0.2, { cast: false }));

  // ------------------------------------------------------------ curtains
  const rodY = 2.47;
  group.add(cyl(0.012, 0.012, 5.0, M.metal, -0.05, rodY, R.zBack + 0.18, { segments: 12 }));
  group.children[group.children.length - 1].rotation.z = Math.PI / 2;
  for (const x of [-2.55, 2.45]) {
    const finial = mesh(new THREE.SphereGeometry(0.022, 12, 8), M.metal);
    finial.position.set(x, rodY, R.zBack + 0.18);
    group.add(finial);
  }

  const sheer = new Curtain({ width: 3.6, height: 2.42, segX: 150, segY: 14, amp: 0.022, wavelength: 0.12, material: M.sheer, seed: 2 });
  sheer.mesh.position.set(-0.13, 0.04 + 2.42 / 2, R.zBack + 0.13);
  group.add(sheer.mesh);
  const drapeL = new Curtain({ width: 0.78, height: 2.42, segX: 44, segY: 14, amp: 0.045, wavelength: 0.2, material: M.drape, seed: 5, castShadow: true });
  drapeL.mesh.position.set(-2.16, 0.04 + 2.42 / 2, R.zBack + 0.2);
  const drapeR = new Curtain({ width: 0.8, height: 2.42, segX: 44, segY: 14, amp: 0.045, wavelength: 0.2, material: M.drape, seed: 9, castShadow: true });
  drapeR.mesh.position.set(1.98, 0.04 + 2.42 / 2, R.zBack + 0.2);
  group.add(drapeL.mesh, drapeR.mesh);
  refs.curtains = { sheer, drapeL, drapeR };

  // ------------------------------------------------------------ sofa (L-shape)
  const sofa = new THREE.Group();
  sofa.name = 'sofa';
  group.add(sofa);
  const seatTop = 0.46;
  // Section A along the left wall, section B along the back wall under the window.
  const A = { x0: R.xMin, x1: R.xMin + 0.95, z0: -5.8, z1: -3.05 };
  const B = { x0: R.xMin, x1: -0.35, z0: -6.74, z1: -5.8 };
  // Plinths
  sofa.add(box(A.x1 - A.x0 - 0.06, 0.08, A.z1 - A.z0 - 0.06, M.sofaDark, (A.x0 + A.x1) / 2, 0.04, (A.z0 + A.z1) / 2));
  sofa.add(box(B.x1 - B.x0 - 0.06, 0.08, B.z1 - B.z0 - 0.06, M.sofaDark, (B.x0 + B.x1) / 2, 0.04, (B.z0 + B.z1) / 2));
  // Bases
  sofa.add(rbox(A.x1 - A.x0, 0.22, A.z1 - A.z0, 0.03, M.sofa, (A.x0 + A.x1) / 2, 0.19, (A.z0 + A.z1) / 2));
  sofa.add(rbox(B.x1 - B.x0, 0.22, B.z1 - B.z0, 0.03, M.sofa, (B.x0 + B.x1) / 2, 0.19, (B.z0 + B.z1) / 2));
  // Back cushions (leaning)
  const backT = 0.25;
  const addBack = (x, z, len, alongZ) => {
    const cushion = rbox(alongZ ? backT : len, 0.5, alongZ ? len : backT, 0.09, M.sofa, x, seatTop + 0.22, z);
    if (alongZ) cushion.rotation.z = -0.1; else cushion.rotation.x = 0.1;
    sofa.add(cushion);
  };
  addBack(A.x0 + backT / 2 + 0.02, -5.0, 1.52, true);
  addBack(A.x0 + backT / 2 + 0.02, -3.95, 1.4, true);
  addBack(-2.0, B.z0 + backT / 2 + 0.02, 1.12, false);
  addBack(-0.99, B.z0 + backT / 2 + 0.02, 1.12, false);
  // Seat cushions
  const seatH = 0.15;
  sofa.add(rbox(0.72, seatH, 1.3, 0.06, M.sofa, A.x0 + 0.6, 0.3 + seatH / 2, -4.63));
  sofa.add(rbox(0.72, seatH, 1.3, 0.06, M.sofa, A.x0 + 0.6, 0.3 + seatH / 2, -3.9 + 0.4 - 0.25));
  sofa.add(rbox(1.0, seatH, 0.72, 0.06, M.sofa, -2.1, 0.3 + seatH / 2, B.z0 + 0.6));
  sofa.add(rbox(1.1, seatH, 0.72, 0.06, M.sofa, -1.07, 0.3 + seatH / 2, B.z0 + 0.6));
  // Armrests
  sofa.add(rbox(0.95, 0.62, 0.2, 0.07, M.sofa, (A.x0 + A.x1) / 2, 0.31, A.z1 - 0.1));
  sofa.add(rbox(0.2, 0.62, 0.94, 0.07, M.sofa, B.x1 - 0.1, 0.31, (B.z0 + B.z1) / 2));

  // Pillows: each is its own pivot group so it can hop when touched.
  const pillowGeo = new RoundedBoxGeometry(0.46, 0.44, 0.14, 4, 0.065);
  const makePillow = (material, x, y, z, rotY, lean) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y - 0.2, z);
    pivot.rotation.y = rotY;
    const p = mesh(pillowGeo, material);
    p.position.y = 0.2;
    p.rotation.x = -lean;
    p.scale.set(1, 1, 0.9);
    pivot.add(p);
    sofa.add(pivot);
    return { pivot, mesh: p, baseY: pivot.position.y, baseRot: pivot.rotation.clone() };
  };
  refs.pillows = [
    makePillow(M.pillowStripe, -2.23, 0.7, -5.28, Math.PI / 2, 0.28),
    makePillow(M.pillowGrey, -2.24, 0.69, -4.45, Math.PI / 2, 0.3),
    makePillow(M.pillowStripe, -1.82, 0.7, -6.4, 0.05, 0.28),
    makePillow(M.pillowCream, -0.98, 0.69, -6.42, -0.08, 0.3),
  ];

  // ------------------------------------------------------------ rug + coffee table
  const rugMesh = mesh(new THREE.BoxGeometry(2.9, 0.012, 2.1), new THREE.MeshStandardMaterial({ map: TX.rug(), roughness: 1 }), { cast: false });
  rugMesh.position.set(-0.95, 0.006, -4.45);
  group.add(rugMesh);

  const table = new THREE.Group();
  table.position.set(-0.8, 0, -4.45);
  group.add(table);
  table.add(cyl(0.5, 0.5, 0.035, M.table, 0, 0.415, 0, { segments: 64 }));
  table.add(cyl(0.48, 0.47, 0.02, M.table, 0, 0.388, 0, { segments: 64 }));
  table.add(cyl(0.055, 0.075, 0.37, M.table, 0, 0.2, 0, { segments: 24 }));
  table.add(cyl(0.26, 0.28, 0.025, M.table, 0, 0.0125, 0, { segments: 48 }));
  const tableTop = 0.4325;

  // Books
  const bookColors = [0x5b4636, 0x2f3b44, 0x8c7b62];
  bookColors.forEach((c, i) => {
    const b = box(0.25 - i * 0.02, 0.028, 0.18 - i * 0.01, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
      -0.2, tableTop + 0.014 + i * 0.028, -0.14);
    b.rotation.y = 0.3 + i * 0.12;
    table.add(b);
  });
  // Small ceramic bowl
  const bowl = mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.ceramic);
  bowl.material = M.ceramic.clone();
  bowl.material.side = THREE.DoubleSide;
  bowl.position.set(0.05, tableTop + 0.07, -0.26);
  bowl.scale.y = 0.55;
  table.add(bowl);

  // Candle in a glass jar
  const candle = new THREE.Group();
  candle.position.set(0.2, tableTop, 0.12);
  table.add(candle);
  const jar = mesh(new THREE.CylinderGeometry(0.048, 0.045, 0.1, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.05, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    { cast: false });
  jar.position.y = 0.05;
  candle.add(jar);
  const wax = cyl(0.041, 0.041, 0.055, new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.6, emissive: 0xff9a4a, emissiveIntensity: 0.25 }), 0, 0.03, 0, { segments: 20 });
  candle.add(wax);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.scale.set(1, 2.4, 1);
  flame.position.y = 0.083;
  candle.add(flame);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 10, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  core.scale.set(1, 2, 1);
  core.position.y = 0.078;
  candle.add(core);
  const candleLight = new THREE.PointLight(0xff8a3c, 0.35, 3.0, 2);
  candleLight.position.y = 0.11;
  candle.add(candleLight);
  refs.candle = { group: candle, flame, core, light: candleLight, wax };

  // ------------------------------------------------------------ TV wall (right)
  const consoleG = new THREE.Group();
  group.add(consoleG);
  const C = { x0: 2.17, x1: R.xMax, z0: -6.2, z1: -2.95, y0: 0.1, y1: 0.52 };
  consoleG.add(box(C.x1 - C.x0 - 0.05, C.y0, C.z1 - C.z0 - 0.06, M.groove, (C.x0 + C.x1) / 2 + 0.02, C.y0 / 2, (C.z0 + C.z1) / 2));
  consoleG.add(box(C.x1 - C.x0, C.y1 - C.y0, C.z1 - C.z0, M.console, (C.x0 + C.x1) / 2, (C.y0 + C.y1) / 2, (C.z0 + C.z1) / 2));
  const drawers = 4;
  for (let i = 1; i < drawers; i++) {
    const z = C.z0 + ((C.z1 - C.z0) * i) / drawers;
    consoleG.add(box(0.004, C.y1 - C.y0 - 0.02, 0.006, M.groove, C.x0 - 0.001, (C.y0 + C.y1) / 2, z, { cast: false }));
  }
  consoleG.add(box(0.004, 0.006, C.z1 - C.z0 - 0.02, M.groove, C.x0 - 0.001, C.y1 - 0.07, (C.z0 + C.z1) / 2, { cast: false }));

  // Soundbar
  consoleG.add(rbox(0.09, 0.07, 0.96, 0.02, M.tvBody, 2.44, C.y1 + 0.035, -5.15));

  // TV
  const tvG = new THREE.Group();
  group.add(tvG);
  const tvC = new THREE.Vector3(R.xMax - 0.025, 1.32, -5.15);
  tvG.add(box(0.04, 0.84, 1.47, M.tvBody, tvC.x, tvC.y, tvC.z));
  const tvScreen = new TX.TvScreen();
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x040506, roughness: 0.12, metalness: 0.0, emissive: 0xffffff, emissiveMap: tvScreen.texture, emissiveIntensity: 0,
    envMapIntensity: 0.6,
  });
  const screen = mesh(new THREE.PlaneGeometry(1.43, 0.8), screenMat, { cast: false, receive: true });
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(tvC.x - 0.0205, tvC.y, tvC.z);
  tvG.add(screen);
  // Standby LED
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  led.position.set(tvC.x - 0.022, tvC.y - 0.41, tvC.z + 0.6);
  tvG.add(led);
  const tvLight = new THREE.RectAreaLight(0x9fc4ff, 0, 1.43, 0.8);
  tvLight.position.set(tvC.x - 0.03, tvC.y, tvC.z);
  tvLight.lookAt(tvC.x - 5, tvC.y, tvC.z);
  group.add(tvLight);
  refs.tv = { group: tvG, screen, screenMat, light: tvLight, led, content: tvScreen, on: false, level: 0 };

  // Vase with dry branches (spindly shadows)
  const vase = new THREE.Group();
  vase.position.set(2.42, C.y1, -3.9);
  consoleG.add(vase);
  const vaseBody = mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 0), new THREE.Vector2(0.06, 0.005), new THREE.Vector2(0.085, 0.08),
    new THREE.Vector2(0.075, 0.2), new THREE.Vector2(0.035, 0.29), new THREE.Vector2(0.04, 0.32),
  ], 28), M.ceramic);
  vase.add(vaseBody);
  const rnd = TX.rng(77);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const lean = 0.15 + rnd() * 0.35;
    const len = 0.55 + rnd() * 0.45;
    const end = new THREE.Vector3(Math.cos(a) * Math.sin(lean) * len, 0.3 + Math.cos(lean) * len, Math.sin(a) * Math.sin(lean) * len * 0.6);
    const mid = new THREE.Vector3(end.x * 0.4 + (rnd() - 0.5) * 0.08, 0.3 + (end.y - 0.3) * 0.55, end.z * 0.4);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.3, 0), mid, end);
    vase.add(mesh(new THREE.TubeGeometry(curve, 10, 0.004, 5, false), M.branch));
    for (let k = 0; k < 3; k++) {
      const p = curve.getPoint(0.45 + k * 0.18);
      const twig = new THREE.QuadraticBezierCurve3(p, p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.1, 0.06, (rnd() - 0.5) * 0.06)),
        p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.22, 0.1 + rnd() * 0.1, (rnd() - 0.5) * 0.1)));
      vase.add(mesh(new THREE.TubeGeometry(twig, 5, 0.0025, 4, false), M.branch));
    }
  }
  // Books + sphere at the front end of the console
  consoleG.add(box(0.2, 0.035, 0.26, new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.8 }), 2.4, C.y1 + 0.0175, -3.3));
  consoleG.add(box(0.18, 0.03, 0.23, new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.8 }), 2.4, C.y1 + 0.05, -3.3));
  const orb = mesh(new THREE.SphereGeometry(0.06, 24, 16), M.brass);
  orb.position.set(2.4, C.y1 + 0.065 + 0.06, -3.3);
  consoleG.add(orb);

  // Light switch on the right wall (your shadow can flip it)
  const sw = new THREE.Group();
  sw.position.set(R.xMax - 0.006, 1.15, -3.6);
  group.add(sw);
  sw.add(box(0.012, 0.12, 0.08, M.plastic, 0, 0, 0));
  const rocker = box(0.01, 0.055, 0.03, M.plastic, -0.008, 0, 0);
  sw.add(rocker);
  const swLed = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
  swLed.position.set(-0.012, -0.035, 0);
  sw.add(swLed);
  refs.lightSwitch = { group: sw, rocker, led: swLed };

  // ------------------------------------------------------------ cabinet (front left)
  const cab = new THREE.Group();
  group.add(cab);
  const K = { x0: R.xMin, x1: R.xMin + 0.55, z0: -2.95, z1: -1.2, h: 2.25 };
  cab.add(box(K.x1 - K.x0, K.h, K.z1 - K.z0, M.cabinet, (K.x0 + K.x1) / 2, K.h / 2, (K.z0 + K.z1) / 2));
  for (let i = 1; i < 3; i++) {
    const z = K.z0 + ((K.z1 - K.z0) * i) / 3;
    cab.add(box(0.004, K.h - 0.08, 0.005, M.groove, K.x1 + 0.001, K.h / 2, z, { cast: false }));
  }
  for (const z of [K.z0 + 0.52, K.z0 + 0.64, K.z1 - 0.52]) cab.add(box(0.02, 0.3, 0.012, M.brass, K.x1 + 0.012, 1.05, z));

  // ------------------------------------------------------------ paintings (left wall)
  refs.paintings = [];
  const makePainting = (z, tex) => {
    const w = 0.78;
    const h = 1.02;
    const nail = new THREE.Group();
    nail.position.set(R.xMin + 0.005, 1.55 + h / 2 + 0.04, z);
    group.add(nail);
    const art = new THREE.Group();
    art.position.set(0.02, -h / 2 - 0.04, 0);
    nail.add(art);
    art.add(box(0.035, h, w, M.frame, 0, 0, 0));
    const canvasMesh = mesh(new THREE.PlaneGeometry(w - 0.07, h - 0.07), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }), { cast: false });
    canvasMesh.rotation.y = Math.PI / 2;
    canvasMesh.position.x = 0.0185;
    art.add(canvasMesh);
    const p = { nail, art, angle: 0, vel: 0, rest: 0 };
    refs.paintings.push(p);
    return p;
  };
  makePainting(-3.95, TX.painting(4, 0));
  makePainting(-5.0, TX.painting(9, 1));

  // ------------------------------------------------------------ plant (back right corner)
  const plant = new THREE.Group();
  plant.position.set(2.18, 0, -6.55);
  group.add(plant);
  const pot = mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.15, 0), new THREE.Vector2(0.2, 0.36), new THREE.Vector2(0.21, 0.4), new THREE.Vector2(0.19, 0.4),
  ], 32), M.ceramic);
  plant.add(pot);
  const soil = cyl(0.19, 0.19, 0.01, M.soil, 0, 0.38, 0, { segments: 24 });
  plant.add(soil);
  const leafGeo = new THREE.PlaneGeometry(0.4, 0.4, 6, 6);
  leafGeo.translate(0, 0.2, 0);
  const lp = leafGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    const y = lp.getY(i);
    lp.setZ(i, 0.55 * x * x + 0.08 * Math.sin(y * 6)); // cupped, slightly wavy
  }
  leafGeo.computeVertexNormals();
  refs.leaves = [];
  const prnd = TX.rng(31);
  for (let i = 0; i < 12; i++) {
    const az = (i / 12) * Math.PI * 2 + prnd() * 0.4;
    const out = 0.12 + prnd() * 0.3;
    const h = 0.72 + prnd() * 0.85;
    const base = new THREE.Vector3(Math.cos(az) * out, h, Math.sin(az) * out);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0.38, 0),
      new THREE.Vector3(base.x * 0.3, h * 0.7, base.z * 0.3),
      base,
    );
    plant.add(mesh(new THREE.TubeGeometry(curve, 12, 0.007, 5, false), M.stem));
    const pivot = new THREE.Group();
    pivot.position.copy(base);
    pivot.rotation.set(0, -az + Math.PI / 2, 0, 'YXZ');
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.6 - prnd() * 0.7;
    pivot.add(tilt);
    const l = mesh(leafGeo, M.leaf);
    l.scale.setScalar(0.75 + prnd() * 0.55);
    l.rotation.z = (prnd() - 0.5) * 0.5;
    tilt.add(l);
    plant.add(pivot);
    refs.leaves.push({ pivot, tilt, baseTilt: tilt.rotation.x, baseYaw: pivot.rotation.y, a: 0, va: 0, b: 0, vb: 0 });
  }
  refs.plant = plant;

  // ------------------------------------------------------------ pendant lamp (dim light at the top)
  const pendant = new THREE.Group();
  pendant.position.set(-0.8, R.height, -4.45);
  group.add(pendant);
  pendant.add(cyl(0.065, 0.065, 0.025, M.metal, 0, -0.0125, 0, { segments: 24 }));
  const cord = cyl(0.0045, 0.0045, 0.6, M.metal, 0, -0.32, 0, { segments: 8 });
  pendant.add(cord);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x7f7262, roughness: 1, side: THREE.DoubleSide, emissive: 0xffa55a, emissiveIntensity: 1.1,
  });
  const shade = cyl(0.27, 0.27, 0.26, shadeMat, 0, -0.74, 0, { segments: 48, open: true });
  pendant.add(shade);
  const ring = mesh(new THREE.TorusGeometry(0.27, 0.004, 6, 48), M.brass, { cast: false });
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.61;
  pendant.add(ring);
  const ring2 = ring.clone();
  ring2.position.y = -0.87;
  pendant.add(ring2);
  const diffuser = mesh(new THREE.CircleGeometry(0.265, 48), new THREE.MeshBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), { cast: false, receive: false });
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = -0.865;
  pendant.add(diffuser);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 12), new THREE.MeshBasicMaterial({ color: 0xfff0d0 }));
  bulb.position.y = -0.76;
  pendant.add(bulb);

  const lampSpot = new THREE.SpotLight(0xffb36b, 14, 0, THREE.MathUtils.degToRad(54), 0.85, 2);
  lampSpot.position.set(0, -0.8, 0);
  lampSpot.target.position.set(0, -3.0, 0);
  lampSpot.castShadow = true;
  lampSpot.shadow.camera.near = 0.06;
  lampSpot.shadow.camera.far = 7;
  lampSpot.shadow.bias = -0.0006;
  lampSpot.shadow.normalBias = 0.025;
  pendant.add(lampSpot, lampSpot.target);

  // Light escaping from the top of the shade washes the ceiling.
  const lampUp = new THREE.SpotLight(0xffa860, 2.5, 3.2, THREE.MathUtils.degToRad(78), 1, 2);
  lampUp.position.set(0, -0.63, 0);
  lampUp.target.position.set(0, 2, 0);
  pendant.add(lampUp, lampUp.target);

  refs.pendant = { group: pendant, shade, shadeMat, diffuser, bulb, spot: lampSpot, up: lampUp, ax: 0, az: 0, vx: 0, vz: 0, level: 1 };

  return refs;
}
