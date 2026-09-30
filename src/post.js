// Post-processing: bloom for the glowing lamp/TV/candle, then ONE final pass that adds the bloom,
// tone-maps, converts to sRGB and applies the film look (vignette + fine grain, which also hides
// 8-bit banding in the dark gradients). Doing that in one pass instead of three (bloom blend,
// output, film) saves two full-screen passes and two multisample resolves every frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// UnrealBloomPass without its last step (blending the bloom back over the frame at full
// resolution): the final pass adds it instead. Same steps as the parent otherwise.
class BloomPass extends UnrealBloomPass {
  get texture() { return this.renderTargetsHorizontal[0].texture; }

  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    // Bright areas, at half resolution.
    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    // Blur down the mip chain.
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      this.fsQuad.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // Combine the mips into `texture` (half resolution).
    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

// Scene (linear HDR) + bloom → ACES tone mapping → sRGB → vignette + grain.
const finalMaterial = () => new THREE.RawShaderMaterial({
  name: 'FinalShader',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 1 },
    toneMappingExposure: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.55 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uBloom, uTime, uGrain, uVignette;
    uniform vec2 uResolution;
    varying vec2 vUv;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // UnrealBloomPass blends with (SRC_ALPHA, ONE) into a float target, where the factor is not
      // clamped, and its alpha is the sum of the mip weights: the bloom counts rgb * a.
      vec4 bloom = texture2D(tBloom, vUv);
      c.rgb += uBloom * bloom.rgb * bloom.a;
      c.rgb = ACESFilmicToneMapping(c.rgb);
      c = sRGBTransferOETF(c);
      vec2 q = vUv - 0.5;
      q.x *= uResolution.x / uResolution.y;
      float v = smoothstep(1.05, 0.25, length(q) * (0.9 + uVignette * 0.5));
      c.rgb *= mix(1.0, v, uVignette);
      float n = hash(vUv * uResolution + fract(uTime * 13.0) * 100.0) - 0.5;
      c.rgb += n * uGrain * (0.35 + 0.65 * (1.0 - dot(c.rgb, vec3(0.333))));
      gl_FragColor = c;
    }
  `,
});

export class Post {
  constructor(renderer, scene, camera, samples = 4) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    // EffectComposer clones this target for ping-pong, so MSAA costs VRAM twice; keep it modest.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new BloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.65, 0.82);
    this.final = new ShaderPass(finalMaterial());
    this.final.uniforms.tBloom.value = this.bloom.texture;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.final.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  configure({ bloom, grain }) {
    this.bloom.enabled = bloom;
    this.final.uniforms.uBloom.value = bloom ? 1 : 0;
    this.final.uniforms.uGrain.value = grain ? 0.035 : 0.0;
  }

  render(time) {
    this.final.uniforms.uTime.value = time;
    this.final.uniforms.toneMappingExposure.value = this.renderer.toneMappingExposure;
    this.composer.render();
  }
}
