/**
 * COMPILAR UN ShaderMaterial SIN NAVEGADOR
 * ------------------------------------------------------------------
 * Monta el GLSL como lo monta three para un ShaderMaterial en WebGL2
 * (#version 300 es, precisiones, uniforms y atributos de serie,
 * `#define attribute in`, `gl_FragColor`, profundidad logarítmica) y
 * resuelve los #include con el ShaderChunk que se le pase (el del three
 * instalado por defecto; otro para probar otra versión). Después lo pasa por
 * glslangValidator (Khronos), que valida GLSL ES 3.00 como el navegador.
 *
 * Copia autónoma de dev/glsl_valida.mjs de Orbit Universe para que las
 * pruebas del paquete funcionen fuera de ese repositorio. Sin glslang, no
 * compila nada y lo dice (HAY_VALIDADOR = false).
 *
 *   GLSLANG=/ruta/glslangValidator node test/...
 */
import * as THREE from 'three';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function buscaBinario() {
  const candidatos = [process.env.GLSLANG, 'C:\\dev-tools\\glslang\\glslangValidator.exe'].filter(Boolean);
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  const r = spawnSync('glslangValidator', ['--version'], { stdio: 'ignore' });
  return r.status === 0 ? 'glslangValidator' : null;
}

export const BINARIO = buscaBinario();
export const HAY_VALIDADOR = Boolean(BINARIO);

function resuelve(src, chunks, prof = 0) {
  if (prof > 8) return src;
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (m, n) => {
    const c = chunks[n];
    if (c === undefined) throw new Error('#include <' + n + '> no existe en ShaderChunk');
    return resuelve(c, chunks, prof + 1);
  });
}

const PRECISION = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler3D;
precision highp sampler2DArray;
#define HIGH_PRECISION
`;

function defines(mat) {
  const d = mat.defines || {};
  return Object.entries(d).map(([k, v]) => (v === false ? '' : '#define ' + k + ' ' + v)).join('\n') + '\n';
}

/** Fuentes completas (vértice y fragmento) de un ShaderMaterial. */
export function fuentes(mat, op = {}) {
  const chunks = op.chunks || THREE.ShaderChunk;
  const log = op.logDepth !== false;
  const vPre = [
    '#version 300 es',
    '#define attribute in', '#define varying out', '#define texture2D texture',
    PRECISION,
    '#define SHADER_TYPE ShaderMaterial', '#define SHADER_NAME ' + (mat.name || 'x'),
    defines(mat),
    log ? '#define USE_LOGDEPTHBUF' : '',
    'uniform mat4 modelMatrix;', 'uniform mat4 modelViewMatrix;', 'uniform mat4 projectionMatrix;',
    'uniform mat4 viewMatrix;', 'uniform mat3 normalMatrix;', 'uniform vec3 cameraPosition;',
    'uniform bool isOrthographic;',
    'attribute vec3 position;', 'attribute vec3 normal;', 'attribute vec2 uv;', ''
  ].join('\n');
  const fPre = [
    '#version 300 es',
    '#define varying in',
    'layout(location = 0) out highp vec4 pc_fragColor;',
    '#define gl_FragColor pc_fragColor',
    '#define gl_FragDepthEXT gl_FragDepth', '#define texture2D texture', '#define textureCube texture',
    PRECISION,
    '#define SHADER_TYPE ShaderMaterial', '#define SHADER_NAME ' + (mat.name || 'x'),
    defines(mat),
    log ? '#define USE_LOGDEPTHBUF' : '',
    'uniform mat4 viewMatrix;', 'uniform vec3 cameraPosition;', 'uniform bool isOrthographic;', ''
  ].join('\n');
  /* glslang trae `average` como función de serie de una extensión de AMD y se
   * queja de que common.glsl la redeclara: se renombra solo en la copia que se valida. */
  const limpia = (s) => s.replace(/\baverage\s*\(/g, 'dcValAverage(');
  return { vert: limpia(vPre + resuelve(mat.vertexShader, chunks)), frag: limpia(fPre + resuelve(mat.fragmentShader, chunks)) };
}

/** Compila; devuelve la lista de errores (vacía si todo compila o si no hay validador). */
export function validaMaterial(nombre, mat, op = {}) {
  if (!HAY_VALIDADOR) return [];
  const { vert, frag } = fuentes(mat, op);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glsl-'));
  const errores = [];
  for (const [etapa, src] of [['vert', vert], ['frag', frag]]) {
    const f = path.join(dir, 's.' + etapa);
    fs.writeFileSync(f, src);
    try {
      execFileSync(BINARIO, ['-S', etapa, f], { stdio: 'pipe' });
    } catch (e) {
      const txt = String(e.stdout || '') + String(e.stderr || '');
      const lineas = txt.split(/\r?\n/).filter((l) => /ERROR/.test(l)).slice(0, 6);
      errores.push(nombre + ' [' + etapa + ']: ' + (lineas.join(' | ') || txt.slice(0, 300)));
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nada */ }
  return errores;
}
