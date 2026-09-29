/**
 * LA LUZ TOTAL NO CAMBIA CON LA FRACCIÓN DIBUJADA NI CON EL SORTEO DE MOTAS
 * PEQUEÑAS NI A MEDIA RESOLUCIÓN (28/9/2026)
 *
 * Réplica en CPU del shader (engine.probeFrame): luz = alfa × área cubierta
 * (px² de pantalla, un punto de menos de 1 px cubre 1 px), en esperanza del
 * sorteo. Se dibuja 1, 1/2, 1/4 y 1/16 de las motas y la luz tiene que quedar
 * a menos de un 3 % de la de todas. Y la compensación de antes (tamaño a^0,24,
 * alfa a^0,36) TIENE que suspender: si no, la prueba no mide nada.
 *
 * La misma medida con la GPU de verdad está en nebula-dust-engine/bench/banco.py.
 *
 *     node nebula-dust-engine/test/light-conservation.mjs
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNebulaDustPreset } from '../src/presets.js';

const FRACCIONES = [1, 1 / 2, 1 / 4, 1 / 16];
const TOLERANCIA = 0.03;
const fallos = [];

const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.01, 100);
camera.position.set(0, 0, 3.2);
camera.updateMatrixWorld();
let alto = 1080;
const renderer = {
  getDrawingBufferSize: (v) => v.set(alto * 16 / 9, alto),
  capabilities: { isWebGL2: true, maxAttributes: 16 },
  getContext: () => null
};

/** Luz con la compensación de antes (para demostrar que la prueba la caza). */
function luzAntigua(engine, fraction) {
  const g = engine.points.geometry;
  const pos = g.getAttribute('position').array;
  const size = g.getAttribute('aSize').array;
  const alpha = g.getAttribute('aAlpha').array;
  const n = size.length;
  const visible = Math.max(1, Math.round(n * fraction));
  const a = 1 / Math.max(fraction, 0.02);
  const ps = Math.min(2.6, Math.max(1, a ** 0.24));
  const as = Math.min(3.2, Math.max(1, a ** 0.36));
  const U = engine.material.uniforms;
  const m = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, engine.points.matrixWorld);
  const v = new THREE.Vector3();
  let luz = 0;
  for (let i = 0; i < visible; i++) {
    v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
    const px = Math.min(U.uMaxPointSize.value, Math.max(0.35, size[i] * U.uParticleScale.value * ps * alto / Math.max(-v.z, 1e-4)));
    luz += Math.min(alpha[i] * as, 0.98) * Math.max(px, 1) ** 2;
  }
  return luz;
}

for (const [nombre, extra] of [
  ['orion', {}], ['orion', { minPointPx: 0.5 }], ['eaglePillars', { minPointPx: 0.5 }],
  ['supernovaExplosion', { evolution: 1, minPointPx: 0.5 }], ['collidingWindPinwheel', {}]
]) {
  alto = 1080;
  const engine = createNebulaDustPreset(nombre, { renderer, sampleCount: 200000, radius: 1.12, adaptive: false, ...extra });
  engine.points.updateMatrixWorld(true);
  let referencia = null;
  const filas = [];
  for (const escala of [1, 0.5]) {
    engine.setResolutionScale(escala);
    alto = 1080 * escala;
    for (const f of FRACCIONES) {
      engine.setMaxVisibleSamples(Math.round(200000 * f));
      engine.update(camera, 1 / 60);
      const p = engine.probeFrame(camera, 200000);
      if (referencia == null) referencia = p.referenceLight;
      const r = p.light / referencia;
      filas.push(`${escala === 1 ? 'completa' : 'media   '} ${String(Math.round(1 / f)).padStart(2)}⁻¹: luz ${(r * 100).toFixed(1)} %, pintadas ${p.drawnSamples}`);
      if (Math.abs(r - 1) > TOLERANCIA) fallos.push(`${nombre} a ${escala === 1 ? 'resolución completa' : 'media resolución'} con 1/${Math.round(1 / f)} de las motas: luz ${(r * 100).toFixed(1)} %`);
    }
  }
  const antigua = luzAntigua(engine, 1 / 4) / luzAntigua(engine, 1);
  filas.push(`compensación de antes con 1/4: ${(antigua * 100).toFixed(1)} %`);
  if (Math.abs(antigua - 1) <= TOLERANCIA) fallos.push(`${nombre}: la compensación de antes (${(antigua * 100).toFixed(1)} %) aprueba; la prueba no mide la luz`);
  console.log(nombre + ' (sorteo bajo ' + engine.getStatus().minPointPx + ' px)\n  ' + filas.join('\n  '));
  engine.dispose();
}

/* Con lightReferenceSamples la nube brilla igual con 16 k que con 1 M motas
 * (la demo, 28/9/2026: con 4 M salía casi negra y con 16 k no se veía); sin
 * ella la luz crece con las motas, como siempre (la app no cambia). */
alto = 1080;
for (const nombre of ['orion', 'galaxyDust', 'supernovaExplosion']) {
  const luces = {};
  const sinRef = {};
  for (const n of [16384, 262144, 1000000]) {
    for (const [tabla, extra] of [[luces, { lightReferenceSamples: 786432 }], [sinRef, {}]]) {
      const engine = createNebulaDustPreset(nombre, { renderer, sampleCount: n, radius: 1.12, adaptive: false, evolution: 1, ...extra });
      engine.points.updateMatrixWorld(true);
      engine.update(camera, 1 / 60);
      tabla[n] = engine.probeFrame(camera, n).light;
      engine.dispose();
    }
  }
  const filas = Object.keys(luces).map((n) => `${n}: ${(luces[n] / luces[1000000] * 100).toFixed(1)} % (sin referencia ${(sinRef[n] / sinRef[1000000] * 100).toFixed(1)} %)`);
  console.log(nombre + ' con lightReferenceSamples 786 432, luz frente a 1 M\n  ' + filas.join('\n  '));
  for (const n of [16384, 262144]) {
    const r = luces[n] / luces[1000000];
    if (Math.abs(r - 1) > 0.05) fallos.push(`${nombre} con ${n} motas y luz de referencia: ${(r * 100).toFixed(1)} % de la de 1 M`);
  }
  if (sinRef[16384] / sinRef[1000000] > 0.05) fallos.push(`${nombre}: sin referencia la luz ya no crece con las motas`);
}

assert.deepEqual(fallos, [], fallos.join('\n'));
console.log('Luz conservada: OK');
