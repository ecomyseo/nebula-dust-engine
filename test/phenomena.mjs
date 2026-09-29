import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createNebulaDustEngine,
  listDustMorphologies,
  listDustPalettes,
  normalizeDustMorphology
} from '../src/index.js';
import {
  createAstroDustPreset,
  listAstroDustPresets
} from '../src/presets.js';

function geometryStats(engine) {
  const positions = engine.points.geometry.getAttribute('position').array;
  const stats = {
    count: positions.length / 3,
    meanX: 0,
    meanY: 0,
    meanZ: 0,
    momentX: 0,
    momentY: 0,
    momentZ: 0,
    thinDisk: 0,
    outerShell: 0,
    innerEjecta: 0
  };
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
    const radius = Math.hypot(x, y, z);
    stats.meanX += x;
    stats.meanY += y;
    stats.meanZ += z;
    stats.momentX += x * x;
    stats.momentY += y * y;
    stats.momentZ += z * z;
    if (Math.abs(z) < 0.12) stats.thinDisk += 1;
    if (radius > 0.60) stats.outerShell += 1;
    if (radius < 0.55) stats.innerEjecta += 1;
  }
  for (const key of ['meanX', 'meanY', 'meanZ', 'momentX', 'momentY', 'momentZ']) {
    stats[key] /= stats.count;
  }
  stats.thinDisk /= stats.count;
  stats.outerShell /= stats.count;
  stats.innerEjecta /= stats.count;
  return stats;
}

for (const morphology of [
  'diffuse',
  'galaxy',
  'oort',
  'supernovaEjecta',
  'whiteDwarfAccretion'
]) {
  assert.ok(listDustMorphologies().includes(morphology));
}
for (const palette of ['webb', 'galaxy', 'oort', 'supernova', 'accretion']) {
  assert.ok(listDustPalettes().includes(palette));
}
assert.equal(normalizeDustMorphology('galaxia'), 'galaxy');
assert.equal(normalizeDustMorphology('nube_oort'), 'oort');
assert.equal(normalizeDustMorphology('supernova'), 'supernovaEjecta');
assert.equal(normalizeDustMorphology('supernovaEjecta'), 'supernovaEjecta');
assert.equal(normalizeDustMorphology('enana_blanca'), 'whiteDwarfAccretion');
assert.equal(normalizeDustMorphology('whiteDwarfAccretion'), 'whiteDwarfAccretion');

for (const preset of [
  'interstellarDust',
  'galaxyDust',
  'oortCloud',
  'supernovaExplosion',
  'whiteDwarfAccretion'
]) {
  assert.ok(listAstroDustPresets().includes(preset));
}

const galaxy = createAstroDustPreset('galaxia', {
  sampleCount: 24000,
  adaptive: false
});
const galaxyStats = geometryStats(galaxy);
assert.equal(galaxy.metadata.phenomenon, 'galaxy-dust');
assert.equal(galaxy.metadata.morphology, 'galaxy');
assert.ok(galaxyStats.thinDisk > 0.70, 'El polvo galáctico debe conservar un disco fino.');
assert.ok(Math.abs(galaxyStats.meanZ) < 0.02, 'El disco galáctico debe estar centrado.');
assert.ok(galaxy.material.uniforms.uFlowSpeed.value > 0);
galaxy.dispose();

const oort = createAstroDustPreset('oort', {
  sampleCount: 24000,
  adaptive: false
});
const oortStats = geometryStats(oort);
const oortMoments = [oortStats.momentX, oortStats.momentY, oortStats.momentZ];
assert.ok(
  Math.max(...oortMoments) / Math.min(...oortMoments) < 1.08,
  'La nube de Oort debe ser aproximadamente isótropa.'
);
assert.ok(oortStats.outerShell > 0.55, 'La nube de Oort debe ocupar una envolvente amplia.');
oort.dispose();

const supernova = createAstroDustPreset('supernova', {
  sampleCount: 24000,
  adaptive: false
});
const supernovaStats = geometryStats(supernova);
assert.equal(supernova.metadata.phenomenon, 'supernova-explosion');
assert.equal(supernova.metadata.morphology, 'supernovaEjecta');
assert.equal(supernova.material.blending, THREE.AdditiveBlending);
assert.ok(supernovaStats.outerShell > 0.76, 'La supernova debe tener un frente de choque exterior.');
assert.ok(supernovaStats.innerEjecta > 0.08, 'La supernova debe conservar eyección interior.');
assert.equal(supernova.getStatus().evolution, 0);
for (let frame = 0; frame < 10; frame++) supernova.update(null, 0.1);
assert.ok(supernova.getStatus().evolution > 0.17, 'La explosión debe avanzar al actualizar el motor.');
assert.equal(supernova.setEvolution(2), 1);
assert.equal(supernova.restartEvolution(), 0);
assert.equal(supernova.material.uniforms.uEvolution.value, 0);
supernova.dispose();

const accretion = createAstroDustPreset('enana_blanca', {
  sampleCount: 24000,
  adaptive: false
});
const accretionStats = geometryStats(accretion);
assert.equal(accretion.metadata.phenomenon, 'white-dwarf-accretion');
assert.equal(accretion.material.blending, THREE.AdditiveBlending);
assert.ok(accretionStats.thinDisk > 0.98, 'La acreción de la enana blanca debe formar un disco fino.');
assert.ok(accretion.setFlowSpeed(3) === 3);
assert.ok(accretion.setMotion(0.5) === 0.5);
assert.ok(accretion.setParticleScale(1.4) === 1.4);
accretion.update(null, 1 / 60);
assert.equal(accretion.material.uniforms.uFlowSpeed.value, 3);
accretion.dispose();

/* Cáscara grumosa: todo entre rInt y rExt (salvo penachos), y NO lisa:
 * las celdas angulares tienen mucha más varianza que el ruido de Poisson. */
assert.equal(normalizeDustMorphology('cascara_grumosa'), 'clumpyShell');
assert.ok(listDustPalettes().includes('redSupergiant'));
function clumpyStats(options) {
  const engine = createNebulaDustEngine(Object.assign({
    morphology: 'clumpyShell', sampleCount: 30000, adaptive: false, seed: 'clumpy-test'
  }, options));
  const p = engine.points.geometry.getAttribute('position').array;
  const cells = new Float64Array(12 * 24);
  let inside = 0;
  let outside = 0;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i], p[i + 1], p[i + 2]);
    assert.ok(Number.isFinite(r));
    if (r < 0.5 * 0.97) inside += 1;
    if (r > 1.3) outside += 1;
    const pole = Math.floor((p[i + 1] / Math.max(r, 1e-9) + 1) / 2 * 11.999);
    const lon = Math.floor((Math.atan2(p[i + 2], p[i]) / (2 * Math.PI) + 0.5) * 23.999);
    cells[pole * 24 + lon] += 1;
  }
  const mean = (p.length / 3) / cells.length;
  let variance = 0;
  for (const c of cells) variance += (c - mean) * (c - mean);
  variance /= cells.length;
  engine.dispose();
  return { inside: inside / (p.length / 3), outside: outside / (p.length / 3), dispersion: variance / mean };
}
const clumpy = clumpyStats({ shellInner: 0.5, shellOuter: 1 });
assert.ok(clumpy.inside < 0.03, 'La cáscara grumosa no debe rellenar el hueco interior.');
assert.ok(clumpy.outside < 0.01, 'La cáscara grumosa no debe salirse de rExt salvo los penachos.');
assert.ok(clumpy.dispersion > 8, 'La cáscara grumosa debe tener nudos y huecos (dispersión ' + clumpy.dispersion.toFixed(1) + ').');
const smooth = clumpyStats({ shellInner: 0.5, shellOuter: 1, clumpContrast: 0, plumeCount: 0 });
assert.ok(smooth.dispersion < clumpy.dispersion / 2, 'El contraste de grumos debe mandar en la dispersión.');

/* Molinillo: espiral de Arquímedes con el paso pedido y sin NaN. */
assert.equal(normalizeDustMorphology('molinillo'), 'pinwheel');
const pinwheel = createAstroDustPreset('wr104', { radius: 10, spiralPitch: 4, sampleCount: 20000, adaptive: false });
assert.equal(pinwheel.metadata.morphology, 'pinwheel');
assert.equal(pinwheel.metadata.phenomenon, 'colliding-wind-pinwheel');
assert.equal(pinwheel.metadata.shape.pitch, 4);
{
  const p = pinwheel.points.geometry.getAttribute('position').array;
  const score = (pitch) => {
    let c = 0;
    let s = 0;
    for (let i = 0; i < p.length; i += 3) {
      const r = Math.hypot(p[i], p[i + 1]);
      const residual = Math.atan2(p[i + 1], p[i]) - 2 * Math.PI * r / pitch;
      c += Math.cos(residual);
      s += Math.sin(residual);
    }
    return Math.hypot(c, s) / (p.length / 3);
  };
  for (const value of p) assert.ok(Number.isFinite(value));
  assert.ok(score(4) > 0.6, 'El molinillo debe seguir su espiral.');
  assert.ok(score(4) > score(3.8) && score(4) > score(4.2), 'El paso del molinillo debe ser el pedido.');
  assert.ok(score(4.8) < score(4) * 0.8 && score(3.2) < score(4) * 0.8, 'El paso del molinillo debe ser el pedido.');
}
pinwheel.dispose();

const opacity = createNebulaDustEngine({
  sampleCount: 128,
  opacity: 0.8,
  seed: 'opacity-regression'
});
const alpha = opacity.points.geometry.getAttribute('aAlpha').array;
const before = Array.from(alpha);
opacity.setOpacity(0.4);
for (let index = 0; index < alpha.length; index++) {
  assert.ok(Math.abs(alpha[index] - before[index] * 0.5) < 1e-7);
}
opacity.setOpacity(0);
assert.equal(opacity.points.visible, false);
opacity.dispose();

console.log('Fenómenos reutilizables: OK');
