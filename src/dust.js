// Dust motes floating in the room. Each mote is lit only where the hall light actually
// reaches it (cone + doorway + your silhouette cookie), so the beam shows up as a shaft
// of sparkling dust with a person-shaped hole in it.
import * as THREE from 'three';
import { DOOR } from './room.js';

const vertexShader = /* glsl */`
  attribute float aSeed;
  uniform float uTime, uSize, uScale, uCosOuter, uCosInner, uIntensity, uLampLevel;
  uniform mat4 uLightMatrix;
  uniform sampler2D uCookie;
  uniform vec3 uLightPos, uLightDir, uLampPos;
  uniform vec4 uDoor;
  varying float vBright;
  void main() {
    vec3 p = position;
    float s = aSeed;
    float t = uTime * (0.25 + 0.35 * s);
    p.x += sin(t * 0.31 + s * 40.0) * 0.22 + sin(uTime * 0.07 + s * 9.0) * 0.1;
    p.z += cos(t * 0.23 + s * 17.0) * 0.22;
    p.y = mod(p.y - uTime * (0.006 + 0.012 * s) + sin(t * 0.5 + s * 6.0) * 0.05 - 0.1, 2.55) + 0.1;
    vec4 world = modelMatrix * vec4(p, 1.0);

    vec3 L = world.xyz - uLightPos;
    float dist = length(L);
    float cone = smoothstep(uCosOuter, uCosInner, dot(L / dist, uLightDir));
    float td = (uDoor.w - uLightPos.z) / (world.z - uLightPos.z);
    vec2 dp = uLightPos.xy + (world.xy - uLightPos.xy) * td;
    float door = step(uDoor.x, dp.x) * step(dp.x, uDoor.y) * step(0.0, dp.y) * step(dp.y, uDoor.z);
    vec4 sc = uLightMatrix * world;
    vec2 uv = sc.xy / sc.w;
    float inMap = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float cookie = mix(1.0, texture2D(uCookie, clamp(uv, 0.0, 1.0)).r, inMap);
    float hall = cone * door * cookie * 30.0 / (dist * dist);

    float ld = distance(world.xyz, uLampPos);
    float lamp = uLampLevel * 0.25 / (0.08 + ld * ld);

    float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + s * 2.5) + s * 50.0);
    vBright = (hall + lamp) * uIntensity * twinkle;

    vec4 mv = viewMatrix * world;
    gl_PointSize = max(1.0, uSize * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uColor;
  varying float vBright;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.05, r);
    gl_FragColor = vec4(uColor * vBright * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Dust {
  constructor(scene, light, cookieTexture, count) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = -2.4 + Math.random() * 4.8;
      pos[i * 3 + 1] = 0.1 + Math.random() * 2.5;
      pos[i * 3 + 2] = -6.8 + Math.random() * 6.2;
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.light = light;
    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: 0.0065 },
      uScale: { value: 600 },
      uCosOuter: { value: 0.7 },
      uCosInner: { value: 0.8 },
      uIntensity: { value: 1 },
      uLampLevel: { value: 1 },
      uLightMatrix: { value: new THREE.Matrix4() },
      uCookie: { value: cookieTexture },
      uLightPos: { value: new THREE.Vector3() },
      uLightDir: { value: new THREE.Vector3() },
      uLampPos: { value: new THREE.Vector3() },
      uDoor: { value: new THREE.Vector4(DOOR.xMin, DOOR.xMax, DOOR.height, DOOR.z) },
      uColor: { value: new THREE.Color(0xffe0b8) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  update(t, { caster, camera, lampPos, lampLevel, bufferHeight, intensity }) {
    const u = this.uniforms;
    const L = this.light;
    u.uTime.value = t;
    u.uLightMatrix.value.copy(L.shadow.matrix);
    u.uLightPos.value.copy(caster.lightPos);
    u.uLightDir.value.copy(caster.lightDir);
    u.uCosOuter.value = Math.cos(L.angle);
    u.uCosInner.value = Math.cos(L.angle * (1 - L.penumbra));
    u.uLampPos.value.copy(lampPos);
    u.uLampLevel.value = lampLevel;
    u.uScale.value = camera.projectionMatrix.elements[5] * bufferHeight * 0.5;
    u.uIntensity.value = intensity;
  }
}
