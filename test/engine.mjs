import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createAdaptiveLodController,
  createNebulaDustEngine,
  detectGpuProfile,
  estimatePhysicalGrainCount,
  normalizePhysicalGrainCount,
  normalizeSeed,
  resolveDustBudget
} from '../src/index.js';
import {
  createNebulaDustPreset,
  listNebulaDustPresets,
  nebulaDustOptions
} from '../src/presets.js';

const grains = estimatePhysicalGrainCount({
  dustMassKg: 1,
  grainRadiusMicrons: 0.1,
  grainDensityKgM3: 3000
});
assert.ok(grains > 1e15, 'Una masa macroscópica debe representar más de un billón de granos.');

const fallbackProfile = detectGpuProfile(null, { fallbackTier: 3 });
assert.equal(fallbackProfile.tier, 3);
assert.equal(fallbackProfile.sampleBudget, 786432);

const highProfile = detectGpuProfile({
  capabilities: { isWebGL2: true, maxTextureSize: 16384, maxVertexTextures: 16 },
  getContext() {
    return {
      RENDERER: 1,
      MAX_TEXTURE_SIZE: 2,
      MAX_VERTEX_TEXTURE_IMAGE_UNITS: 3,
      getExtension() { return null; },
      getParameter(parameter) {
        if (parameter === 1) return 'GeForce RTX test adapter';
        if (parameter === 2) return 16384;
        if (parameter === 3) return 16;
        return null;
      }
    };
  }
});
assert.equal(highProfile.source, 'webgl-heuristic');
assert.equal(highProfile.tier, 3);

const budget = resolveDustBudget({
  quality: 2,
  sampleCount: 96,
  physicalGrainCount: 1e18
});
assert.equal(budget.sampleCount, 96);
assert.equal(budget.gpuProfile.tier, 2);
assert.equal(budget.physicalGrainCount, 1e18);
assert.equal(budget.grainsPerSample, 1e18 / 96);
assert.equal(budget.isMonteCarloRepresentation, true);
const exactTrillion = normalizePhysicalGrainCount(10n ** 18n);
assert.equal(exactTrillion.approximate, 1e18);
assert.equal(exactTrillion.exact, '1000000000000000000');
const exactBudget = resolveDustBudget({
  quality: 0,
  sampleCount: 16,
  physicalGrainCount: 10n ** 24n
});
assert.equal(exactBudget.physicalGrainCount, 1e24);
assert.equal(exactBudget.physicalGrainCountExact, '1000000000000000000000000');
assert.equal(exactBudget.grainsPerSample, 1e24 / 16);
assert.equal(exactBudget.estimatedAttributeBytes, 16 * 36);
assert.equal(normalizeSeed('orion'), normalizeSeed('orion'));
const unspecifiedBudget = resolveDustBudget({ quality: 0, sampleCount: 8 });
assert.equal(unspecifiedBudget.physicalGrainCount, null);
assert.equal(unspecifiedBudget.physicalGrainCountSource, 'unspecified');
assert.equal(resolveDustBudget({ quality: 4, sampleCount: 1e12 }).sampleCount, 4000000);

const adaptive = createAdaptiveLodController({ targetFrameMs: 16.67, minimumFraction: 0.1 });
for (let index = 0; index < 120; index++) adaptive.update(0.05);
assert.ok(adaptive.snapshot().fraction < 1, 'El LOD adaptativo debe reducir carga con cuadros lentos.');
for (let index = 0; index < 600; index++) adaptive.update(0.008);
assert.ok(adaptive.snapshot().fraction > 0.1, 'El LOD adaptativo debe recuperar detalle con margen de GPU.');

const gpuBound = createAdaptiveLodController({ targetFrameMs: 16.67, minimumFraction: 0.1 });
for (let index = 0; index < 160; index++) gpuBound.update(0.008, 34);
assert.ok(gpuBound.snapshot().fraction < 1, 'El tiempo GPU debe poder reducir el LOD aunque la CPU tenga margen.');
assert.ok(gpuBound.snapshot().averageGpuMs > 30);

const options = {
  morphology: 'orion',
  palette: 'orion',
  radius: 4,
  sampleCount: 96,
  seed: 'deterministic-orion',
  physicalGrainCount: 1e21
};
const first = createNebulaDustEngine(options);
const second = createNebulaDustEngine(options);
const firstPositions = first.points.geometry.getAttribute('position').array;
const secondPositions = second.points.geometry.getAttribute('position').array;
assert.deepEqual(Array.from(firstPositions.slice(0, 30)), Array.from(secondPositions.slice(0, 30)));
assert.equal(first.metadata.sampleCount, 96);
assert.equal(first.metadata.physicalGrainCount, 1e21);
assert.equal(first.material.blending, THREE.NormalBlending);
assert.equal(first.material.depthTest, true);
assert.equal(first.material.depthWrite, false);
assert.equal(first.metadata.volumeProfile, 'balanced');
assert.equal(first.metadata.colorStopCount, 4);

const custom = createNebulaDustEngine({
  sampleCount: 32,
  morphology: 'diffuse',
  volumeProfile: 'dense',
  colorStops: ['#1a0033', [255, 70, 180], new THREE.Color('#8d6cff')]
});
assert.equal(custom.metadata.palette, 'custom');
assert.equal(custom.metadata.colorStopCount, 3);
assert.equal(custom.metadata.volumeProfile, 'dense');
custom.dispose();

const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
camera.position.set(0, 0, 6);
camera.updateMatrixWorld();
first.update(camera, 1 / 60);
assert.ok(first.getStatus().visibleFraction > 0.99);
assert.equal(first.getStatus().visibleSamplesApprox, 96);
assert.equal(first.points.geometry.drawRange.count, 96);
camera.position.set(0, 0, 200);
camera.updateMatrixWorld();
first.update(camera, 1 / 60);
assert.ok(first.getStatus().visibleFraction < 0.5);
assert.ok(first.points.geometry.drawRange.count < 48, 'El LOD debe reducir vértices enviados a la GPU.');
assert.ok(first.getStatus().lodPointScale > 1, 'La agregación LOD debe conservar volumen aparente.');
assert.ok(first.getStatus().lodAlphaScale > 1, 'La agregación LOD debe compensar densidad óptica.');
assert.equal(
  first.getStatus().representedGrainsPerVisibleSample,
  first.metadata.physicalGrainCount / first.getStatus().visibleSamplesApprox
);
assert.equal(first.reportGpuFrameTime(23), true);
assert.equal(first.reportGpuFrameTime(-1), false);

first.setOpacity(0);
first.update(camera, 1 / 60);
assert.equal(first.points.visible, false);
first.dispose();
assert.equal(first.getStatus().disposed, true);
second.libera();
assert.equal(first.points.parent, null);

assert.ok(listNebulaDustPresets().includes('orion'));
assert.equal(nebulaDustOptions('m42').morphology, 'orion');
for (const presetName of listNebulaDustPresets()) {
  const preset = createNebulaDustPreset(presetName, { sampleCount: 64 });
  assert.equal(preset.metadata.sampleCount, 64);
  assert.equal(preset.points.geometry.drawRange.count, 64);
  preset.dispose();
}

console.log('Nebula Dust Engine: OK');
