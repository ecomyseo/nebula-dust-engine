/**
 * The demo's image pipeline: the dust is drawn into a HalfFloat target, then
 * an optional bloom and one grade pass (exposure, ACES or linear tone
 * mapping, vignette, grain, sRGB) put it on the 8-bit canvas.
 *
 * Why a HalfFloat target: the canvas is 8 bits and linear light, so a sample
 * with an alpha of 0.004 adds less than half a level, rounds to 0, and four
 * million of them painted nothing (the "black in production" of 28/9/2026).
 * A ShaderMaterial does not tone map nor encode sRGB by itself either, so the
 * grade pass does both, with the same ACES curve as three.js.
 *
 * Bloom: a soft-knee bright pass at half resolution and four levels, each one
 * blurred (9-tap Gaussian in two passes) and halved again, mixed in the grade
 * pass. With bloom at 0 none of its passes run.
 */
import * as THREE from 'three';

const VERTEX = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}'
].join('\n');

const BRIGHT = [
  'uniform sampler2D tInput;',
  'uniform float uExposure;',
  'uniform float uThreshold;',
  'varying vec2 vUv;',
  'void main() {',
  '  vec3 c = texture2D(tInput, vUv).rgb * uExposure;',
  '  float peak = max(c.r, max(c.g, c.b));',
  '  float knee = max(uThreshold * 0.5, 1e-3);',
  '  float soft = clamp(peak - uThreshold + knee, 0.0, 2.0 * knee);',
  '  soft = soft * soft * (0.25 / knee);',
  '  gl_FragColor = vec4(c * (max(soft, peak - uThreshold) / max(peak, 1e-5)), 1.0);',
  '}'
].join('\n');

const BLUR = [
  'uniform sampler2D tInput;',
  'uniform vec2 uDirection;',
  'varying vec2 vUv;',
  'void main() {',
  '  vec3 c = texture2D(tInput, vUv).rgb * 0.2270270270;',
  '  c += texture2D(tInput, vUv + uDirection * 1.3846153846).rgb * 0.3162162162;',
  '  c += texture2D(tInput, vUv - uDirection * 1.3846153846).rgb * 0.3162162162;',
  '  c += texture2D(tInput, vUv + uDirection * 3.2307692308).rgb * 0.0702702703;',
  '  c += texture2D(tInput, vUv - uDirection * 3.2307692308).rgb * 0.0702702703;',
  '  gl_FragColor = vec4(c, 1.0);',
  '}'
].join('\n');

const COPY = [
  'uniform sampler2D tInput;',
  'varying vec2 vUv;',
  'void main() {',
  '  gl_FragColor = vec4(texture2D(tInput, vUv).rgb, 1.0);',
  '}'
].join('\n');

/* ACES filmic: the fit three.js uses (ACESFilmicToneMapping, MIT), exposure / 0.6 included. */
const GRADE = [
  'uniform sampler2D tScene;',
  'uniform sampler2D tBloom0;',
  'uniform sampler2D tBloom1;',
  'uniform sampler2D tBloom2;',
  'uniform sampler2D tBloom3;',
  'uniform float uBloom;',
  'uniform vec4 uBloomWeights;',
  'uniform float uExposure;',
  'uniform float uAces;',
  'uniform float uGrain;',
  'uniform float uVignette;',
  'uniform float uAspect;',
  'uniform float uSeed;',
  'varying vec2 vUv;',
  '',
  'vec3 rrtAndOdtFit(vec3 v) {',
  '  vec3 a = v * (v + 0.0245786) - 0.000090537;',
  '  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;',
  '  return a / b;',
  '}',
  'vec3 acesFilmic(vec3 color) {',
  '  const mat3 inputMat = mat3(',
  '    vec3(0.59719, 0.07600, 0.02840),',
  '    vec3(0.35458, 0.90834, 0.13383),',
  '    vec3(0.04823, 0.01566, 0.83777));',
  '  const mat3 outputMat = mat3(',
  '    vec3(1.60475, -0.10208, -0.00327),',
  '    vec3(-0.53108, 1.10813, -0.07276),',
  '    vec3(-0.07367, -0.00605, 1.07602));',
  '  color = inputMat * (color / 0.6);',
  '  color = rrtAndOdtFit(color);',
  '  return clamp(outputMat * color, 0.0, 1.0);',
  '}',
  'vec3 toSrgb(vec3 c) {',
  '  vec3 lo = c * 12.92;',
  '  vec3 hi = pow(max(c, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055);',
  '  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));',
  '}',
  'float grainNoise(vec2 p) {',
  '  vec3 q = fract(vec3(p.xyx) * 0.1031);',
  '  q += dot(q, q.yzx + 33.33);',
  '  return fract((q.x + q.y) * q.z);',
  '}',
  '',
  'void main() {',
  '  vec3 c = texture2D(tScene, vUv).rgb * uExposure;',
  '  if (uBloom > 0.0) {',
  '    vec3 b = texture2D(tBloom0, vUv).rgb * uBloomWeights.x',
  '      + texture2D(tBloom1, vUv).rgb * uBloomWeights.y',
  '      + texture2D(tBloom2, vUv).rgb * uBloomWeights.z',
  '      + texture2D(tBloom3, vUv).rgb * uBloomWeights.w;',
  '    c += b * uBloom;',
  '  }',
  '  c = uAces > 0.5 ? acesFilmic(c) : clamp(c, 0.0, 1.0);',
  '  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);',
  '  float r = length(d) / length(vec2(uAspect, 1.0) * 0.5);',
  '  c *= 1.0 - uVignette * smoothstep(0.3, 1.0, r);',
  '  vec3 o = toSrgb(c);',
  '  o += (grainNoise(gl_FragCoord.xy + uSeed) - 0.5) * uGrain;',
  '  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);',
  '}'
].join('\n');

/** The default look; `settings` is live, the next render uses whatever it holds. */
export const POST_DEFAULTS = Object.freeze({
  exposure: 8,
  aces: true,
  bloom: 0.35,
  bloomRadius: 0.5,
  bloomThreshold: 1,
  grain: 0.012,
  vignette: 0.2
});
export const BLOOM_LEVELS = 4;

function material(name, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false
  });
}

/** Weights of the four bloom levels for a radius in [0, 1] (wider with more radius), summing to 1. */
export function bloomWeights(radius) {
  const r = Math.min(1, Math.max(0, Number(radius) || 0));
  const w = [1, 0.8, 0.6, 0.4].map((f) => f + (1.2 - 2 * f) * r);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

export function createPost(renderer, options = {}) {
  const settings = { ...POST_DEFAULTS, ...(options.settings || {}) };
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const rt = () => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  const levels = Array.from({ length: BLOOM_LEVELS }, rt);
  const temps = Array.from({ length: BLOOM_LEVELS }, rt);

  const bright = material('Dust bloom: bright pass', BRIGHT, {
    tInput: { value: target.texture }, uExposure: { value: settings.exposure }, uThreshold: { value: settings.bloomThreshold }
  });
  const blur = material('Dust bloom: blur', BLUR, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });
  const copy = material('Dust bloom: downsample', COPY, { tInput: { value: null } });
  const grade = material('Dust grade', GRADE, {
    tScene: { value: target.texture },
    tBloom0: { value: levels[0].texture },
    tBloom1: { value: levels[1].texture },
    tBloom2: { value: levels[2].texture },
    tBloom3: { value: levels[3].texture },
    uBloom: { value: 0 },
    uBloomWeights: { value: new THREE.Vector4(...bloomWeights(settings.bloomRadius)) },
    uExposure: { value: settings.exposure },
    uAces: { value: 1 },
    uGrain: { value: settings.grain },
    uVignette: { value: settings.vignette },
    uAspect: { value: 1 },
    uSeed: { value: 0 }
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), grade);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  let width = 1;
  let height = 1;
  let frame = 0;
  const stats = { passes: 0, bloomPasses: 0 };

  function setSize(w, h) {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    target.setSize(width, height);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const lw = Math.max(1, Math.floor(width / 2 ** (i + 1)));
      const lh = Math.max(1, Math.floor(height / 2 ** (i + 1)));
      levels[i].setSize(lw, lh);
      temps[i].setSize(lw, lh);
    }
  }

  /** Follows the renderer's drawing buffer (after setSize or setPixelRatio). */
  function resize() {
    renderer.getDrawingBufferSize(size);
    setSize(size.x, size.y);
  }

  function pass(mat, into) {
    quad.material = mat;
    renderer.setRenderTarget(into);
    renderer.render(quadScene, quadCamera);
    stats.passes++;
    if (into) stats.bloomPasses++;
  }

  function renderBloom() {
    bright.uniforms.uExposure.value = settings.exposure;
    bright.uniforms.uThreshold.value = settings.bloomThreshold;
    pass(bright, levels[0]);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      if (i > 0) {
        copy.uniforms.tInput.value = levels[i - 1].texture;
        pass(copy, levels[i]);
      }
      const lw = Math.max(1, Math.floor(width / 2 ** (i + 1)));
      const lh = Math.max(1, Math.floor(height / 2 ** (i + 1)));
      blur.uniforms.tInput.value = levels[i].texture;
      blur.uniforms.uDirection.value.set(1 / lw, 0);
      pass(blur, temps[i]);
      blur.uniforms.tInput.value = temps[i].texture;
      blur.uniforms.uDirection.value.set(0, 1 / lh);
      pass(blur, levels[i]);
    }
  }

  /** The scene into the HalfFloat target (the caller draws it), then bloom and grade to the canvas. */
  function begin() {
    stats.passes = 0;
    stats.bloomPasses = 0;
    renderer.setRenderTarget(target);
  }

  function finish() {
    const bloomOn = settings.bloom > 0;
    if (bloomOn) renderBloom();
    const u = grade.uniforms;
    u.uBloom.value = bloomOn ? settings.bloom : 0;
    const w = bloomWeights(settings.bloomRadius);
    u.uBloomWeights.value.set(w[0], w[1], w[2], w[3]);
    u.uExposure.value = settings.exposure;
    u.uAces.value = settings.aces ? 1 : 0;
    u.uGrain.value = settings.grain;
    u.uVignette.value = settings.vignette;
    u.uAspect.value = width / height;
    u.uSeed.value = (frame++ % 997) * 17.13;
    pass(grade, null);
  }

  /** Everything at once: scene into the target, then the post passes. */
  function render(scene, camera) {
    begin();
    renderer.render(scene, camera);
    finish();
  }

  function dispose() {
    target.dispose();
    for (const t of [...levels, ...temps]) t.dispose();
    for (const m of [bright, blur, copy, grade]) m.dispose();
    quad.geometry.dispose();
  }

  resize();
  return {
    settings,
    target,
    materials: { bright, blur, copy, grade },
    stats,
    setSize,
    resize,
    begin,
    finish,
    render,
    dispose
  };
}
