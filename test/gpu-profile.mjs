import assert from 'node:assert/strict';
import {
  DUST_SAMPLE_BUDGETS,
  createGpuTimerQuery,
  detectGpuProfile,
  resolveDustBudget
} from '../src/index.js';

function rendererStub({
  name,
  isWebGL2 = true,
  maxTextureSize = 8192,
  maxVertexTextures = 16,
  maxAttributes = 16
}) {
  const gl = {
    RENDERER: 1,
    MAX_TEXTURE_SIZE: 2,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 3,
    getExtension() {
      return null;
    },
    getParameter(parameter) {
      if (parameter === 1) return name;
      if (parameter === 2) return maxTextureSize;
      if (parameter === 3) return maxVertexTextures;
      return null;
    }
  };
  return {
    capabilities: { isWebGL2, maxTextureSize, maxVertexTextures, maxAttributes },
    getContext() {
      return gl;
    }
  };
}

assert.deepEqual(DUST_SAMPLE_BUDGETS, [16384, 65536, 262144, 786432, 2000000]);
assert.equal(Object.isFrozen(DUST_SAMPLE_BUDGETS), true);

const invalidFallback = detectGpuProfile(null, {
  fallbackTier: Number.NaN,
  userAgent: 'Mozilla/5.0 (Linux; Android 15)'
});
assert.equal(invalidFallback.tier, 1);
assert.equal(invalidFallback.mobile, true);
assert.equal(invalidFallback.maxVertexTextures, null);

const manual = detectGpuProfile(null, {
  overrideTier: 99,
  userAgent: 'Mozilla/5.0 (iPhone)'
});
assert.equal(manual.tier, 4);
assert.equal(manual.source, 'manual');
assert.equal(manual.mobile, true);

const software = detectGpuProfile(rendererStub({
  name: 'Google SwiftShader',
  maxTextureSize: 2048,
  maxVertexTextures: 0
}), { deviceMemoryGB: 2 });
assert.equal(software.tier, 0);

const high = detectGpuProfile(rendererStub({
  name: 'NVIDIA GeForce RTX 4090'
}), { deviceMemoryGB: 16 });
assert.equal(high.tier, 4);
assert.equal(high.source, 'webgl-heuristic');

const mobileBudget = resolveDustBudget({
  quality: 4,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'
});
assert.equal(mobileBudget.gpuProfile.mobile, true);
assert.equal(mobileBudget.quality, 1, 'La detección móvil debe impedir el nivel alto por defecto.');
assert.equal(mobileBudget.sampleCount, 65536);

const allowedMobileBudget = resolveDustBudget({
  quality: 4,
  userAgent: 'Mozilla/5.0 (iPhone)',
  allowHighOnMobile: true
});
assert.equal(allowedMobileBudget.quality, 4);

const webgl1Budget = resolveDustBudget({
  renderer: rendererStub({
    name: 'Generic WebGL 1',
    isWebGL2: false
  }),
  quality: 3
});
assert.equal(webgl1Budget.quality, 1);

const attributeLimitedBudget = resolveDustBudget({
  renderer: rendererStub({
    name: 'Attribute-limited adapter',
    maxAttributes: 4
  }),
  quality: 3
});
assert.equal(attributeLimitedBudget.quality, 0);

const timerExtension = {
  TIME_ELAPSED_EXT: 10,
  GPU_DISJOINT_EXT: 11
};
let queryDeleted = false;
const timerContext = {
  RENDERER: 1,
  MAX_TEXTURE_SIZE: 2,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 3,
  QUERY_RESULT_AVAILABLE: 12,
  QUERY_RESULT: 13,
  getExtension(name) {
    if (name === 'EXT_disjoint_timer_query_webgl2') return timerExtension;
    return null;
  },
  getParameter(parameter) {
    if (parameter === 11) return false;
    if (parameter === 1) return 'GPU timer test';
    if (parameter === 2) return 8192;
    if (parameter === 3) return 16;
    return null;
  },
  createQuery() {
    return { id: 1 };
  },
  beginQuery() {},
  endQuery() {},
  getQueryParameter(query, parameter) {
    if (parameter === 12) return true;
    if (parameter === 13) return 4250000;
    return null;
  },
  deleteQuery() {
    queryDeleted = true;
  }
};
const timedRenderer = {
  capabilities: { isWebGL2: true, maxTextureSize: 8192, maxVertexTextures: 16 },
  getContext() {
    return timerContext;
  }
};
const timedProfile = detectGpuProfile(timedRenderer);
assert.equal(timedProfile.timerQuerySupported, true);
const timer = createGpuTimerQuery(timedRenderer);
assert.ok(timer);
assert.equal(timer.begin(), true);
assert.equal(timer.begin(), false);
assert.equal(timer.end(), true);
assert.equal(timer.poll(), 4.25);
assert.equal(queryDeleted, true);
assert.equal(timer.snapshot().pending, 0);
timer.dispose();

console.log('Perfiles GPU: OK');
