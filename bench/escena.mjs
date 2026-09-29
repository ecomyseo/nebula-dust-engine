/**
 * Vuelca una escena de grupos (un ejemplo de src/examples.js o un JSON) para
 * dibujarla sin navegador con bench/capturas.py (moderngl): por cada grupo,
 * atributos (.bin), uniformes, matrices, mezcla y orden de dibujo, y el GLSL
 * tal como lo monta three (test/glsl.mjs).
 *
 *   node bench/escena.mjs <salida> <ejemplo|fichero.json> [motasPorGrupo] [W] [H]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDustSystem } from '../src/system.js';
import { DUST_EXAMPLE_SCENES } from '../src/examples.js';
import { fuentes } from '../test/glsl.mjs';

const [salida, cual, motasTxt = '262144', wTxt = '1280', hTxt = '720'] = process.argv.slice(2);
const W = Number(wTxt);
const H = Number(hTxt);
const datos = DUST_EXAMPLE_SCENES[cual] || JSON.parse(fs.readFileSync(cual, 'utf8'));
fs.mkdirSync(salida, { recursive: true });

const renderer = { getDrawingBufferSize: (v) => v.set(W, H), capabilities: { isWebGL2: true, maxAttributes: 16 }, getContext: () => null };
const sistema = createDustSystem({ renderer, adaptive: false, lightReferenceSamples: 786432, physicalGrainCount: 1e18 });
const escena = { ...datos, groups: datos.groups.map((g) => ({ ...g, count: Number(motasTxt) })) };
const { view } = sistema.load(escena);

const v = view || { target: [0, 0, 0], azimuth: 0, elevation: 0, distance: 3.2 };
const camera = new THREE.PerspectiveCamera(48, W / H, 0.01, 100);
const c = Math.cos(v.elevation || 0);
const t = new THREE.Vector3().fromArray(v.target || [0, 0, 0]);
camera.position.set(t.x + v.distance * c * Math.sin(v.azimuth || 0), t.y + v.distance * Math.sin(v.elevation || 0), t.z + v.distance * c * Math.cos(v.azimuth || 0));
camera.lookAt(t);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();
sistema.object3d.updateMatrixWorld(true);
sistema.update(camera, 0);

const plano = (valor) => {
  if (valor && valor.isColor) return [valor.r, valor.g, valor.b];
  if (valor && (valor.isVector4 || valor.isVector3 || valor.isVector2)) return valor.toArray();
  if (Array.isArray(valor)) return valor.flatMap(plano);
  return valor;
};

const grupos = [];
for (const g of sistema.listGroups()) {
  if (!g.visible) continue;
  const engine = sistema.getGroup(g.id).engine;
  const dir = path.join(salida, g.id);
  fs.mkdirSync(dir, { recursive: true });
  const geo = engine.points.geometry;
  const atributos = {};
  for (const nombre of ['position', 'aColor', 'aSize', 'aAlpha', 'aPhase']) {
    const a = geo.getAttribute(nombre);
    fs.writeFileSync(path.join(dir, nombre + '.bin'), Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    atributos[nombre] = a.itemSize;
  }
  const uniformes = {};
  for (const [k, u] of Object.entries(engine.material.uniforms)) uniformes[k] = plano(u.value);
  const mv = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, engine.points.matrixWorld);
  fs.writeFileSync(path.join(dir, 'datos.json'), JSON.stringify({
    motas: geo.drawRange.count, W, H, atributos, uniformes,
    modelView: Array.from(mv.elements), projection: Array.from(camera.projectionMatrix.elements),
    blending: engine.getStatus().blending, orden: engine.points.renderOrder,
    shaders: { despues: fuentes(engine.material, { logDepth: false }) }
  }));
  grupos.push({ id: g.id, orden: engine.points.renderOrder, blending: engine.getStatus().blending });
}
fs.writeFileSync(path.join(salida, 'escena.json'), JSON.stringify({ W, H, grupos }));
console.log(JSON.stringify({ escena: cual, grupos: grupos.length, W, H }));
sistema.dispose();
