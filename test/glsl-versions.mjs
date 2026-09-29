/**
 * EL SHADER CON LOS CHUNKS DE VARIAS VERSIONES DE THREE
 * ------------------------------------------------------------------
 * Compila el material del motor (cada modo de forma, las dos mezclas) con
 * glslangValidator usando el ShaderChunk del three instalado y, además, el
 * de cada build que se pase (three.module.js de r15x..r18x):
 *
 *   node test/glsl-versions.mjs [ruta/three.module.js ...]
 *   THREE_BUILDS="a/three.module.js;b/three.module.js" node test/glsl-versions.mjs
 *
 * Sin glslang no compila nada y lo dice (sale con 0).
 */
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { createNebulaDustEngine, DUST_MORPHOLOGIES } from '../src/index.js';
import { HAY_VALIDADOR, validaMaterial } from './glsl.mjs';

if (!HAY_VALIDADOR) {
  console.log('GLSL: sin glslangValidator, no se compila (define GLSLANG para probarlo)');
  process.exit(0);
}
const builds = [...process.argv.slice(2), ...String(process.env.THREE_BUILDS || '').split(';').filter(Boolean)];
const versiones = [{ nombre: 'r' + THREE.REVISION + ' (instalado)', chunks: THREE.ShaderChunk }];
for (const b of builds) {
  const t = await import(pathToFileURL(b).href);
  versiones.push({ nombre: 'r' + t.REVISION, chunks: t.ShaderChunk });
}
let fallos = 0;
for (const v of versiones) {
  let n = 0;
  for (const morphology of DUST_MORPHOLOGIES) {
    for (const blending of ['normal', 'additive']) {
      const e = createNebulaDustEngine({ morphology, blending, sampleCount: 64 });
      for (const logDepth of [true, false]) {
        const errores = validaMaterial(`${v.nombre}/${morphology}/${blending}`, e.material, { chunks: v.chunks, logDepth });
        n++;
        if (errores.length) { fallos++; console.log('FALLO', errores.join(' | ')); }
      }
      e.dispose();
      break;
    }
  }
  console.log(`GLSL ${v.nombre}: ${n} compilaciones`);
}
if (fallos) process.exit(1);
console.log('GLSL en todas las versiones: OK');
