/**
 * Rotating outflow (src/outflow.js): kinematics, relativistic Doppler, the
 * light-conserving LOD, index-hashed samples without buffers and the shaders.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createDustOutflow,
  relativisticDoppler,
  kerrHorizonOmega,
  outflowRadial,
  OUTFLOW_MAX_SAMPLES,
  OUTFLOW_COMPONENTS,
  DEFAULT_OUTFLOW_MIX
} from '../src/outflow.js';
import { HAY_VALIDADOR, validaMaterial } from './glsl.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/* ---------------------------------------------------------------- Doppler */
close(relativisticDoppler(0, 1), 1, 1e-12, 'D at rest');
for (const b of [0.1, 0.5, 0.9]) {
  close(relativisticDoppler(b, 1), Math.sqrt((1 + b) / (1 - b)), 1e-12, 'D head-on, beta ' + b);
  close(relativisticDoppler(b, -1), Math.sqrt((1 - b) / (1 + b)), 1e-12, 'D receding, beta ' + b);
  close(relativisticDoppler(b, 0), Math.sqrt(1 - b * b), 1e-12, 'transverse Doppler, beta ' + b);
}
assert.ok(Number.isFinite(relativisticDoppler(5, 1)), 'beta is clamped below 1');
assert.ok(relativisticDoppler(5, 1, 0.97) <= relativisticDoppler(0.97, 1) + 1e-12, 'betaMax caps D');

/* ---------------------------------------------------------------- Kerr and kinematics */
assert.equal(kerrHorizonOmega(0), 0);
close(kerrHorizonOmega(0.9), 0.9 / (1 + Math.sqrt(1 - 0.81)), 1e-12, 'Omega_H(0.9)');
assert.ok(kerrHorizonOmega(-0.5) < 0, 'the sign of the spin is kept');
const start = outflowRadial(0, 0.03, 0.2, 0.6, 0.5);
close(start.r, 0.03, 1e-12, 'r(0) = r0');
close(start.betaR, 0.2, 1e-12, 'beta(0) = beta0');
const late = outflowRadial(40, 0.03, 0.2, 0.6, 0.5);
close(late.betaR, 0.6, 1e-9, 'beta tends to beta_inf');
let prev = -Infinity;
for (let t = 0; t <= 5; t += 0.25) {
  const { r } = outflowRadial(t, 0.03, 0.2, 0.6, 0.5);
  assert.ok(r > prev, 'r grows monotonically');
  prev = r;
}

/* ---------------------------------------------------------------- the object */
assert.ok(OUTFLOW_MAX_SAMPLES >= 1 << 24);
assert.deepEqual([...OUTFLOW_COMPONENTS], Object.keys(DEFAULT_OUTFLOW_MIX));

const flow = createDustOutflow({
  radius: 10, sampleCount: 200000, maximumSamples: 1 << 22, lightReferenceSamples: 200000,
  omega: 0.4, adaptive: false, cloud: { radius: 0.6, intensity: 1, dust: 1 }
});
assert.ok(flow.object3d instanceof THREE.Object3D);
assert.equal(flow.metadata.bytesPerSample, 0, 'samples come from a hash of the index');
for (const g of [flow.geometry, flow.dustGeometry]) {
  for (const [name, attr] of Object.entries(g.attributes)) {
    assert.ok(attr.count <= 4, `attribute ${name} scales with the sample count (${attr.count})`);
  }
}
assert.ok(flow.cloud instanceof THREE.Mesh, 'cloud: {} adds the volumetric cloud');

/* LOD: drawn samples x per-sample light = constant */
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1e5);
const light = [];
for (const d of [15, 60, 400, 4000]) {
  camera.position.set(0, 0, d);
  camera.updateMatrixWorld();
  flow.update(camera, 1 / 60);
  const st = flow.getStatus();
  assert.ok(st.visibleSamples >= 1 && st.visibleSamples <= 200000);
  light.push(st.visibleSamples * flow.uniforms.uLodAlphaScale.value);
}
for (const l of light) close(l, light[0], light[0] * 1e-9, 'total light is conserved by the LOD');
flow.setMaxVisibleSamples(5000);
flow.update(camera, 1 / 60);
assert.ok(flow.getStatus().visibleSamples <= 5000, 'maxVisibleSamples caps what is drawn');
close(flow.getStatus().visibleSamples * flow.uniforms.uLodAlphaScale.value, light[0], light[0] * 1e-9,
  'the cap keeps the light too');

/* the clock wraps without a jump */
flow.setTime(1023.99);
flow.update(null, 0, 0.02);
assert.ok(flow.uniforms.uTime.value >= 0 && flow.uniforms.uTime.value < 1, 'the clock wraps at 1024');

/* ---------------------------------------------------------------- shaders */
if (HAY_VALIDADOR) {
  const errors = [
    ...validaMaterial('outflow', flow.material),
    ...validaMaterial('outflow.dust', flow.dustMaterial),
    ...validaMaterial('outflow.cloud', flow.cloudMaterial)
  ];
  assert.deepEqual(errors, [], errors.join('\n'));
} else {
  console.log('outflow GLSL: no glslangValidator, shaders not compiled');
}

flow.dispose();
console.log('outflow: ok');
