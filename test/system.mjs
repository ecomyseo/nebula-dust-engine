/**
 * EL SISTEMA DE GRUPOS (29/9/2026)
 * ------------------------------------------------------------------
 *  - grupos: añadir, listar, cambiar, duplicar, borrar; ids estables;
 *  - la semilla: la misma spec da la misma nube, en otro sistema y tras
 *    regenerar; otra semilla, otra nube; sembrar en un punto;
 *  - serialize → load → serialize idéntico (y JSON de texto, y los ejemplos);
 *  - updateGroup: lo que es al vuelo no regenera (mismo motor) y lo que
 *    regenera libera el motor viejo; 300 cambios seguidos sin fugas (motores,
 *    hijos, geometrías vivas y memoria) ni NaN;
 *  - el tope de 4 M motas entre grupos, con reparto proporcional;
 *  - pick: el grupo bajo el rayo, el pequeño antes que el halo, nada fuera;
 *  - tocar: empuja en el shader, decae y deja de animar;
 *  - la paleta al vuelo es idéntica a generar con esa paleta;
 *  - capas, orden de dibujo, mezcla y visibilidad llegan a three;
 *  - el enlace comprimido va y vuelve;
 *  - createNebulaDustPreset sigue igual (la app lo usa).
 *
 *     node --expose-gc test/system.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {
  MAX_GPU_SAMPLE_COUNT,
  createNebulaDustEngine,
  normalizeSeed
} from '../src/index.js';
import { createNebulaDustPreset } from '../src/presets.js';
import {
  DUST_SCENE_FORMAT,
  createDustSystem,
  decodeDustScene,
  encodeDustScene,
  normalizeDustGroupSpec,
  projectToViewPlane
} from '../src/system.js';
import { DUST_EXAMPLE_SCENES, listDustExampleScenes } from '../src/examples.js';
import * as todo from '../src/all.js';

const huella = (engine) => {
  const h = crypto.createHash('sha1');
  for (const n of ['position', 'aColor', 'aSize', 'aAlpha', 'aPhase']) {
    const a = engine.points.geometry.getAttribute(n).array;
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  return h.digest('hex');
};
const sinNaN = (engine, donde) => {
  for (const [k, a] of Object.entries(engine.points.geometry.attributes)) {
    for (let i = 0; i < a.array.length; i++) assert.ok(Number.isFinite(a.array[i]), `${donde}: ${k}[${i}] = ${a.array[i]}`);
  }
  for (const [k, u] of Object.entries(engine.material.uniforms)) {
    if (typeof u.value === 'number') assert.ok(Number.isFinite(u.value), `${donde}: uniforme ${k}`);
  }
};
const opciones = { quality: 1, adaptive: false };
/** Igualdad de dos listas de números, con un mensaje corto. */
const iguales = (a, b, mensaje) => {
  assert.equal(a.length, b.length, mensaje + ': longitudes ' + a.length + ' y ' + b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${mensaje}: [${i}] ${a[i]} ≠ ${b[i]}`);
};

/* ---------------------------------------------------------------- entrada del paquete */
for (const n of ['createDustSystem', 'createNebulaDustEngine', 'createNebulaDustPreset', 'DUST_EXAMPLE_SCENES', 'encodeDustScene']) {
  assert.ok(n in todo, 'src/all.js no exporta ' + n);
}

/* ---------------------------------------------------------------- grupos */
{
  const s = createDustSystem(opciones);
  const a = s.addGroup({ preset: 'orion', position: [1, 2, 3] });
  const b = s.addGroup({ morphology: 'ring', palette: 'crab', seed: 'b' });
  assert.deepEqual([a, b], ['g1', 'g2']);
  assert.equal(s.size, 2);
  assert.equal(s.object3d.children.length, 2);
  const lista = s.listGroups();
  assert.equal(lista[0].preset, 'orion');
  assert.equal(lista[1].morphology, 'ring');
  assert.equal(lista[1].palette, 'crab');
  assert.deepEqual(s.getGroup(a).object3d.position.toArray(), [1, 2, 3]);
  assert.equal(s.groupIdOf(s.getGroup(b).engine.points), b, 'groupIdOf desde un hijo');
  const c = s.duplicateGroup(a, { position: [0, 0, 0] });
  assert.equal(s.getGroup(c).spec.seed, s.getGroup(a).spec.seed, 'duplicar conserva la semilla si no se pide otra');
  assert.equal(huella(s.getGroup(c).engine), huella(s.getGroup(a).engine), 'el duplicado es la misma nube');
  assert.ok(s.removeGroup(a));
  assert.equal(s.getGroup(a), null);
  assert.equal(s.object3d.children.length, 2);
  assert.equal(s.removeGroup('no-existe'), false);
  assert.equal(s.updateGroup('no-existe', { opacity: 0 }), false);
  const d = s.addGroup({ id: 'mio', preset: 'crab' });
  assert.equal(d, 'mio', 'id pedido');
  assert.notEqual(s.addGroup({ id: 'mio', preset: 'crab' }), 'mio', 'id repetido: se da otro');
  assert.throws(() => s.addGroup({ preset: 'no-existe' }), /Unknown nebula dust preset/);
  assert.equal(s.size, 4, 'un preset malo no deja un grupo a medias');
  const eventos = [];
  s.on('change', (e) => eventos.push(e.type));
  s.updateGroup(d, { opacity: 0.3 });
  s.removeGroup(d);
  assert.deepEqual(eventos.filter((t) => t !== 'rebuild'), ['update', 'remove']);
  s.dispose();
  assert.equal(s.object3d.children.length, 0);
}

/* ---------------------------------------------------------------- semilla */
{
  const s1 = createDustSystem(opciones);
  const s2 = createDustSystem(opciones);
  const spec = { morphology: 'clumpyShell', palette: 'hotDust', seed: 'reproducible', count: 20000, shape: { plumeCount: 3 } };
  const a = s1.addGroup(spec);
  const b = s2.addGroup(spec);
  assert.equal(huella(s1.getGroup(a).engine), huella(s2.getGroup(b).engine), 'misma spec, misma nube en otro sistema');
  const antes = huella(s1.getGroup(a).engine);
  s1.updateGroup(a, { seed: 'otra' });
  assert.notEqual(huella(s1.getGroup(a).engine), antes, 'otra semilla, otra nube');
  s1.updateGroup(a, { seed: 'reproducible' });
  assert.equal(huella(s1.getGroup(a).engine), antes, 'volver a la semilla da la misma nube');
  assert.equal(s1.getGroup(a).engine.metadata.seed, normalizeSeed('reproducible'));
  /* una semilla numérica también sirve y se guarda como número */
  const n = s1.addGroup({ seed: 12345, count: 4000 });
  assert.equal(s1.getGroup(n).spec.seed, 12345);
  /* sin semilla: una fija por sistema e id, no al azar */
  const x1 = createDustSystem({ ...opciones, seed: 'escena' });
  const x2 = createDustSystem({ ...opciones, seed: 'escena' });
  assert.equal(huella(x1.getGroup(x1.addGroup({ count: 5000 })).engine), huella(x2.getGroup(x2.addGroup({ count: 5000 })).engine));
  /* sembrar en un punto con una forma */
  const id = s1.sow(new THREE.Vector3(0.5, -0.25, 2), { morphology: 'pinwheel', count: 5000 });
  const g = s1.getGroup(id);
  assert.deepEqual(g.spec.position, [0.5, -0.25, 2]);
  assert.equal(g.spec.morphology, 'pinwheel');
  assert.match(String(g.spec.seed), /^s[0-9a-z]+$/, 'sembrar sin semilla da una al azar');
  const id2 = s1.sow([0, 0, 0], { morphology: 'pinwheel', count: 5000, seed: g.spec.seed });
  assert.equal(huella(s1.getGroup(id2).engine), huella(g.engine), 'sembrar con la misma semilla da la misma nube');
  /* regenerar con menos motas da el principio de la misma nube */
  s1.updateGroup(a, { count: 10000 });
  const p1 = s1.getGroup(a).engine.points.geometry.getAttribute('position').array;
  const sOtro = createDustSystem(opciones);
  const p2 = sOtro.getGroup(sOtro.addGroup(spec)).engine.points.geometry.getAttribute('position').array;
  iguales(p1, p2.subarray(0, p1.length), 'con menos motas, el principio de la misma nube');
  for (const s of [s1, s2, x1, x2, sOtro]) s.dispose();
}

/* ---------------------------------------------------------------- serialización */
{
  const s = createDustSystem(opciones);
  s.addGroup({ preset: 'orion', name: 'Uno', position: [1, 0, 0], rotation: [0.1, 0.2, 0.3], scale: [2, 1, 0.5], count: 12000 });
  s.addGroup({ morphology: 'pinwheel', colors: ['#ff0000', '#00ff88', '#0000ff'], tint: '#ffcc88', blending: 'additive', layer: 2, order: 5, visible: false, seed: 77, shape: { spiralPitch: 0.3 } });
  s.addGroup({ preset: 'supernovaExplosion', evolution: 0.4, evolutionRate: 0.1, volumeProfile: 'dense', physicalGrainCount: 1e21 });
  const uno = s.serialize({ view: { distance: 3 }, title: 'prueba' });
  assert.equal(uno.format, DUST_SCENE_FORMAT);
  assert.equal(uno.title, 'prueba');
  const texto = JSON.stringify(uno);
  const huellas = s.listGroups().map((g) => huella(s.getGroup(g.id).engine));
  const r = s.load(texto);
  assert.deepEqual(r.ids, ['g1', 'g2', 'g3']);
  assert.deepEqual(r.view, { distance: 3 });
  assert.equal(JSON.stringify(s.serialize({ view: { distance: 3 }, title: 'prueba' })), texto, 'serialize → load → serialize idéntico');
  assert.deepEqual(s.listGroups().map((g) => huella(s.getGroup(g.id).engine)), huellas, 'la nube cargada es la misma, mota a mota');
  /* en otro sistema también */
  const otro = createDustSystem(opciones);
  otro.load(uno);
  assert.equal(JSON.stringify(otro.serialize({ view: { distance: 3 }, title: 'prueba' })), texto);
  assert.equal(otro.getGroup('g2').engine.object3d.visible, false);
  assert.equal(otro.getGroup('g2').engine.getStatus().palette, 'custom');
  /* normalizar es idempotente */
  for (const g of uno.groups) assert.deepEqual(normalizeDustGroupSpec(g), g, 'normalizar una spec normalizada la deja igual');
  /* un fichero malo no toca la escena */
  assert.throws(() => s.load({ nada: 1 }), /missing groups/);
  assert.throws(() => s.load({ format: 'otro', groups: [] }), /Unknown dust scene format/);
  assert.throws(() => s.load({ groups: [{ preset: 'no-existe' }] }), /Unknown nebula dust preset/);
  assert.equal(JSON.stringify(s.serialize({ view: { distance: 3 }, title: 'prueba' })), texto, 'un load fallido deja la escena como estaba');
  /* los ejemplos */
  for (const k of listDustExampleScenes()) {
    s.load(DUST_EXAMPLE_SCENES[k]);
    assert.equal(s.size, DUST_EXAMPLE_SCENES[k].groups.length, k);
    const a = JSON.stringify(s.serialize());
    s.load(JSON.parse(a));
    assert.equal(JSON.stringify(s.serialize()), a, k + ': ida y vuelta');
    for (const g of s.listGroups()) sinNaN(s.getGroup(g.id).engine, k + '/' + g.id);
  }
  /* el enlace comprimido */
  const enlace = await encodeDustScene(uno);
  assert.match(enlace, /^z[A-Za-z0-9_-]+$/);
  assert.ok(enlace.length < texto.length, 'el enlace comprime');
  assert.deepEqual(await decodeDustScene(enlace), uno);
  await assert.rejects(() => decodeDustScene('zbasura'));
  assert.deepEqual(await decodeDustScene('j' + Buffer.from(texto).toString('base64url')), uno, 'sin comprimir también');
  for (const x of [s, otro]) x.dispose();
}

/* ---------------------------------------------------------------- updateGroup al vuelo */
{
  const s = createDustSystem(opciones);
  const id = s.addGroup({ preset: 'orion', count: 30000 });
  const motor = s.getGroup(id).engine;
  const colores = Float32Array.from(motor.points.geometry.getAttribute('aColor').array);
  s.updateGroup(id, {
    opacity: 0.4, size: 2, maxPointSize: 6, motion: 0.5, flowSpeed: 1, evolution: 0.5, evolutionRate: 0.2,
    blending: 'additive', palette: 'crab', tint: '#ff8000', order: 7, layer: 3,
    position: [1, 2, 3], rotation: [0.5, 0, 0], scale: 2, name: 'x', visible: false
  });
  const g = s.getGroup(id);
  assert.equal(g.engine, motor, 'nada de eso regenera la nube');
  const st = motor.getStatus();
  assert.equal(st.motion, 0.5);
  assert.equal(st.flowSpeed, 1);
  assert.equal(st.particleScale, 2);
  assert.equal(st.maxPointSize, 6);
  assert.equal(st.evolution, 0.5);
  assert.equal(st.evolutionRate, 0.2);
  assert.equal(st.blending, 'additive');
  assert.equal(motor.material.blending, THREE.AdditiveBlending);
  assert.equal(st.palette, 'crab');
  assert.equal(st.tint, '#ff8000');
  assert.equal(motor.points.renderOrder, 7);
  assert.ok(motor.points.layers.isEnabled(3) && !motor.points.layers.isEnabled(0), 'capa 3');
  assert.deepEqual(motor.object3d.scale.toArray(), [2, 2, 2]);
  assert.equal(motor.object3d.visible, false);
  assert.ok(Math.abs(motor.material.uniforms.uTint.value.r - 1) < 1e-6);
  /* la paleta al vuelo = generar con esa paleta */
  const conCrab = createNebulaDustPreset('orion', { sampleCount: 30000, palette: 'crab', quality: 1 });
  iguales(motor.points.geometry.getAttribute('aColor').array, conCrab.points.geometry.getAttribute('aColor').array, 'setPalette = generar con esa paleta');
  conCrab.dispose();
  s.updateGroup(id, { palette: 'orion' });
  iguales(motor.points.geometry.getAttribute('aColor').array, colores, 'volver a la paleta original');
  s.updateGroup(id, { colors: ['#000000', '#ffffff'] });
  assert.equal(motor.getStatus().palette, 'custom');
  s.updateGroup(id, { colors: null });
  assert.equal(motor.getStatus().palette, 'orion', 'quitar los colores propios vuelve a la paleta de la forma');
  /* lo que regenera: libera el viejo */
  s.updateGroup(id, { morphology: 'crab' });
  assert.notEqual(s.getGroup(id).engine, motor);
  assert.equal(motor.getStatus().disposed, true, 'el motor viejo queda liberado');
  assert.deepEqual(s.getGroup(id).engine.object3d.position.toArray(), [1, 2, 3], 'la nube nueva conserva la transformación');
  assert.equal(s.getGroup(id).engine.object3d.visible, false);
  assert.equal(s.getGroup(id).engine.points.renderOrder, 7);
  assert.equal(s.getGroup(id).engine.getStatus().tint, '#ff8000');
  /* resetGroup vuelve al preset y conserva dónde está */
  s.resetGroup(id);
  const r = s.getGroup(id).spec;
  assert.equal(r.morphology, 'orion');
  assert.equal(r.palette, 'orion');
  assert.equal(r.tint, '#ffffff');
  assert.deepEqual(r.position, [1, 2, 3]);
  assert.equal(r.count, 30000);
  s.dispose();
}

/* ---------------------------------------------------------------- sin fugas */
{
  const s = createDustSystem(opciones);
  const ids = [s.addGroup({ preset: 'orion', count: 20000 }), s.addGroup({ preset: 'crab', count: 20000 })];
  let vivas = 0;
  const vigila = () => {
    for (const g of s.listGroups()) {
      const geo = s.getGroup(g.id).engine.points.geometry;
      if (geo.__vigilada) continue;
      geo.__vigilada = true;
      vivas++;
      geo.addEventListener('dispose', () => { vivas--; });
    }
  };
  vigila();
  const memoria = () => { if (global.gc) { global.gc(); global.gc(); } return process.memoryUsage().arrayBuffers; };
  const m0 = memoria();
  const FORMAS = ['orion', 'crab', 'ring', 'galaxy', 'pinwheel', 'clumpyShell'];
  for (let i = 0; i < 300; i++) {
    const id = ids[i % 2];
    const patch = i % 3 === 0
      ? { seed: 'fuga-' + i, morphology: FORMAS[i % FORMAS.length] }
      : { opacity: (i % 10) / 10, size: 0.5 + (i % 7) / 3, palette: i % 2 ? 'webb' : 'dark', position: [i % 5, 0, 0], tint: i % 2 ? '#ff0000' : '#ffffff', flowSpeed: i % 4, motion: (i % 3) / 3 };
    s.updateGroup(id, patch);
    vigila();
    const e = s.getGroup(id).engine;
    e.update(null, 0.016);
    if (i % 25 === 0) sinNaN(e, 'cambio ' + i);
  }
  assert.equal(vivas, 2, `geometrías vivas: ${vivas} (deben ser 2)`);
  assert.equal(s.object3d.children.length, 2, 'sin hijos huérfanos');
  const m1 = memoria();
  if (global.gc) {
    /* dos nubes de 20 000 motas son ~2 MB: tras 100 regeneraciones no puede quedar más */
    assert.ok(m1 - m0 < 8e6, `memoria de búferes: ${((m1 - m0) / 1e6).toFixed(1)} MB más tras 300 cambios`);
  }
  s.dispose();
  assert.equal(vivas, 0, 'dispose libera todo');
  console.log(`sin fugas: 300 cambios, geometrías vivas 2 → 0, búferes ${global.gc ? ((m1 - m0) / 1e6).toFixed(2) + ' MB' : '(sin --expose-gc)'}`);
}

/* ---------------------------------------------------------------- tope de 4 M con reparto */
{
  const s = createDustSystem({ quality: 4, adaptive: false });
  const a = s.addGroup({ count: 3000000, seed: 'a' });
  const b = s.addGroup({ count: 3000000, seed: 'b' });
  const c = s.addGroup({ count: 2000000, seed: 'c' });
  const st = s.getStatus();
  assert.equal(st.requestedSamples, 8000000);
  assert.ok(st.allocatedSamples <= MAX_GPU_SAMPLE_COUNT, 'nunca más de 4 M');
  const n = (id) => s.getGroup(id).engine.metadata.sampleCount;
  assert.equal(n(a), 1500000);
  assert.equal(n(b), 1500000);
  assert.equal(n(c), 1000000);
  s.removeGroup(c);
  assert.equal(n(a), 2000000, 'al borrar, los demás crecen');
  s.updateGroup(b, { count: 1000000 });
  assert.equal(n(a), 3000000);
  assert.equal(n(b), 1000000);
  s.setOptions({ maxTotalSamples: 1000000 });
  assert.equal(n(a) + n(b), 1000000);
  assert.equal(n(a), 750000);
  /* los automáticos reciben el presupuesto de la tarjeta */
  const t = createDustSystem({ quality: 2, adaptive: false });
  const auto = t.addGroup({ seed: 'x' });
  assert.equal(t.getGroup(auto).engine.metadata.sampleCount, 262144);
  assert.equal(t.getStatus().autoSamplesPerGroup, 262144);
  s.dispose();
  t.dispose();
}

/* ---------------------------------------------------------------- pick */
{
  const s = createDustSystem(opciones);
  s.load(DUST_EXAMPLE_SCENES.diskRingHalo);
  const lejos = s.addGroup({ preset: 'crab', position: [6, 0, 0], scale: 0.5, count: 8000 });
  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.01, 100);
  cam.position.set(0, 2.2, 2.2);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  s.object3d.updateMatrixWorld(true);
  const centro = s.pickScreen(0, 0, cam);
  assert.equal(centro && centro.id, 'g1', 'en el centro, el disco (el más pequeño con motas bajo el rayo), no el halo');
  const todos = s.pickScreen(0, 0, cam, { all: true }).map((h) => h.id);
  assert.ok(todos.includes('g3'), 'el halo también está bajo el rayo');
  const rc = new THREE.Raycaster(new THREE.Vector3(6, 0, 5), new THREE.Vector3(0, 0, -1));
  assert.equal(s.pick(rc).id, lejos, 'pick con un Raycaster');
  assert.equal(s.pick(new THREE.Ray(new THREE.Vector3(30, 30, 5), new THREE.Vector3(0, 0, -1))), null, 'fuera de todo: nada');
  s.updateGroup(lejos, { visible: false });
  assert.equal(s.pick(rc), null, 'un grupo oculto no se elige');
  s.updateGroup(lejos, { visible: true, layer: 2 });
  assert.equal(s.pick(rc, { layer: 0 }), null, 'filtrar por capa');
  assert.equal(s.pick(rc, { layer: 2 }).id, lejos);
  /* el punto del plano de la vista */
  const p = projectToViewPlane(new THREE.Ray(cam.position.clone(), new THREE.Vector3(0, 0, 0).sub(cam.position).normalize()), cam, new THREE.Vector3());
  assert.ok(p.length() < 1e-9, 'el rayo del centro corta el plano de la vista en el blanco');
  s.dispose();
}

/* ---------------------------------------------------------------- tocar */
{
  const s = createDustSystem({ ...opciones, touchDecay: 0.5 });
  const id = s.addGroup({ preset: 'orion', count: 10000, position: [2, 0, 0], scale: 2 });
  const lejos = s.addGroup({ preset: 'crab', count: 10000, position: [40, 0, 0] });
  const e = s.getGroup(id).engine;
  assert.equal(e.getStatus().activeTouches, 0, 'los toques nacen apagados');
  assert.equal(s.isAnimated(), false);
  const n = s.touch([2.5, 0, 0], { radius: 0.4, strength: 0.6 });
  assert.equal(n, 1, 'solo se toca el grupo al alcance');
  assert.equal(s.getGroup(lejos).engine.getStatus().activeTouches, 0);
  const t = e.material.uniforms.uTouch.value[0];
  const r = e.material.uniforms.uTouchRadius.value.x;
  assert.ok(Math.abs(t.x - 0.25) < 1e-9 && Math.abs(t.w - 0.6) < 1e-9, 'el punto pasa al espacio local del grupo');
  assert.ok(Math.abs(r - 0.2) < 1e-9, 'el radio se divide por la escala');
  assert.equal(s.isAnimated(), true);
  for (let i = 0; i < 4; i++) s.touch([2, 0.1 * i, 0], { radius: 0.4, strength: 0.3, id });
  assert.equal(e.getStatus().activeTouches, 4, 'cuatro toques a la vez; el quinto sustituye al más débil');
  for (let i = 0; i < 100; i++) s.update(null, 0.1);
  assert.equal(e.getStatus().activeTouches, 0, 'los toques decaen');
  assert.equal(s.isAnimated(), false);
  s.dispose();
}

/* ---------------------------------------------------------------- el motor de siempre */
{
  const e = createNebulaDustPreset('orion', { sampleCount: 5000 });
  assert.equal(e.getStatus().activeTouches, 0);
  assert.equal(e.getStatus().tint, '#ffffff');
  assert.equal(e.isAnimated(), false, 'Orión quieto no se anima (los toques nacen apagados)');
  for (const v of e.material.uniforms.uTouch.value) assert.equal(v.w, 0);
  const d = createNebulaDustEngine({ sampleCount: 1000, tint: '#00ff00' });
  assert.equal(d.getStatus().tint, '#00ff00');
  e.dispose();
  d.dispose();
}

console.log('Sistema de grupos: OK');
