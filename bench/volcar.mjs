/**
 * Vuelca a disco lo que la GPU necesita para dibujar una nube del motor sin
 * navegador: atributos (.bin), uniformes y matrices (.json) y el GLSL completo
 * tal como lo monta three (dev/glsl_valida.mjs), del shader actual y, si se
 * da --antes <index.js viejo>, del de antes. Lo lee bench/banco.py.
 *
 *   node nebula-dust-engine/bench/volcar.mjs <salida> <preset> <motas> [--antes ruta/index.js|no] [--opciones JSON]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as THREE from 'three';
import { createNebulaDustPreset } from '../src/presets.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const { fuentes, validaMaterial } = await import(pathToFileURL(path.join(RAIZ, 'dev', 'glsl_valida.mjs')).href);

const [salida, preset, motasTxt] = process.argv.slice(2);
const iAntes = process.argv.indexOf('--antes');
const iOpc = process.argv.indexOf('--opciones');
const opciones = iOpc > 0 ? JSON.parse(process.argv[iOpc + 1]) : {};
const motas = Number(motasTxt);
fs.mkdirSync(salida, { recursive: true });

const W = 1920;
const H = 1080;
const renderer = {
  getDrawingBufferSize: (v) => v.set(W, H),
  capabilities: { isWebGL2: true, maxAttributes: 16 },
  getContext: () => null
};
const camera = new THREE.PerspectiveCamera(48, W / H, 0.01, 100);
camera.position.set(0, 0, 3.2);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();

const engine = createNebulaDustPreset(preset, {
  renderer, radius: 1.12, sampleCount: motas, adaptive: false, physicalGrainCount: 1e18, ...opciones
});
engine.object3d.rotation.set(0.35, 0.6, 0);
engine.object3d.updateMatrixWorld(true);
// La supernova arranca en el centro (evolución 0): se mide ya abierta.
engine.setEvolution(1);
engine.update(camera, 0);

const g = engine.points.geometry;
const atributos = {};
for (const nombre of ['position', 'aColor', 'aSize', 'aAlpha', 'aPhase']) {
  const a = g.getAttribute(nombre);
  fs.writeFileSync(path.join(salida, nombre + '.bin'), Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  atributos[nombre] = a.itemSize;
}
const mv = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, engine.points.matrixWorld);
const uniformes = {};
for (const [k, u] of Object.entries(engine.material.uniforms)) uniformes[k] = u.value;

const shaders = { despues: fuentes(engine.material, { logDepth: false }) };
const errores = validaMaterial('polvo-despues', engine.material);
if (iAntes > 0 && process.argv[iAntes + 1] !== 'no') {
  const txt = fs.readFileSync(process.argv[iAntes + 1], 'utf8');
  const saca = (nombre) => {
    const m = txt.match(new RegExp('const ' + nombre + ' = (\\[[\\s\\S]*?\\])\\.join\\(\'\\\\n\'\\);'));
    if (!m) throw new Error('no encuentro ' + nombre + ' en el index.js de antes');
    return Function('return ' + m[1])().join('\n');
  };
  shaders.antes = fuentes({ vertexShader: saca('VERTEX_SHADER'), fragmentShader: saca('FRAGMENT_SHADER') }, { logDepth: false });
}
fs.writeFileSync(path.join(salida, 'datos.json'), JSON.stringify({
  preset, motas: g.getAttribute('position').count, W, H, atributos, uniformes,
  modelView: Array.from(mv.elements), projection: Array.from(camera.projectionMatrix.elements),
  blending: engine.metadata.blending, shaders, erroresGlsl: errores
}));
console.log(JSON.stringify({ preset, motas, blending: engine.metadata.blending, erroresGlsl: errores }));
engine.dispose();
