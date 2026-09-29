/**
 * Nebula Dust System
 *
 * Varios grupos de polvo en una misma escena: cada grupo es un motor
 * (createNebulaDustEngine, una llamada de dibujo) con su semilla, su forma,
 * sus colores y su transformación. El sistema los crea, los cambia en
 * caliente, reparte entre ellos el tope de motas de la GPU, los selecciona
 * con un rayo, los «toca» y los guarda y carga en JSON.
 *
 * Todo grupo se describe con una especificación plana (spec) que es
 * exactamente lo que se guarda: la misma spec da siempre la misma nube.
 */
import * as THREE from 'three';
import {
  ENGINE_VERSION,
  MAX_GPU_SAMPLE_COUNT,
  createGpuTimerQuery,
  createNebulaDustEngine,
  defaultDustPalette,
  defaultDustVolumeProfile,
  dustColorToHex,
  normalizeDustMorphology,
  resolveDustBudget
} from './index.js';
import {
  NEBULA_DUST_PRESETS,
  nebulaDustOptions,
  resolveNebulaDustPresetName
} from './presets.js';

export const DUST_SCENE_FORMAT = 'nebula-dust-scene';
export const DUST_SCENE_VERSION = 1;
/** Grupos como máximo en un sistema (cada uno es una llamada de dibujo). */
export const MAX_DUST_GROUPS = 64;

/** Parámetros propios de algunas formas (clumpyShell, pinwheel): regeneran la nube. */
export const DUST_SHAPE_KEYS = Object.freeze([
  'shellInner', 'shellOuter', 'clumpScale', 'clumpContrast', 'plumeCount', 'plumeFraction',
  'spiralPitch', 'spiralSense', 'spiralPhase', 'spiralInner', 'armWidth', 'coneOpening', 'radialFade'
]);

const VOLUME_PROFILES = new Set(['mist', 'balanced', 'dense', 'emissive']);
const PALETTE_NAMES = new Set([
  'webb', 'orion', 'ionized', 'crab', 'dark', 'galaxy', 'oort', 'supernova', 'accretion', 'redSupergiant', 'hotDust'
]);
/** Opciones del sistema que el motor no debe recibir tal cual. */
const SYSTEM_ONLY = new Set([
  'maxTotalSamples', 'gpuTimer', 'measureGpuTime', 'onChange', 'seed', 'groups', 'defaults'
]);
/** Opciones del sistema que se cambian en todos los grupos sin rehacer la nube. */
const LIVE_SYSTEM_OPTIONS = {
  resolutionScale: 'setResolutionScale',
  minPointPx: 'setMinPointPx',
  maxVisibleSamples: 'setMaxVisibleSamples',
  touchDecay: 'setTouchDecay'
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function num(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return finite(n) ? clamp(n, minimum, maximum) : fallback;
}

function vec3(value, fallback) {
  if (value === undefined || value === null) return fallback;
  let out = null;
  if (Array.isArray(value)) out = [value[0], value[1], value[2]];
  else if (typeof value === 'object') out = [value.x, value.y, value.z];
  else if (finite(value)) out = [value, value, value];
  if (!out) return fallback;
  out = out.map((v) => (typeof v === 'string' ? Number(v) : v));
  return out.every(finite) ? out : fallback;
}

function hexColor(value) {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim().toLowerCase();
  return dustColorToHex(value);
}

function colorList(value) {
  if (!Array.isArray(value)) return null;
  const list = value.map(hexColor).filter(Boolean);
  return list.length >= 2 ? list.slice(0, 16) : null;
}

function seedValue(value) {
  if (finite(value)) return Math.floor(value) >>> 0;
  if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 200);
  return null;
}

/** El valor de la primera clave presente (aunque valga null); undefined si no hay ninguna. */
function field(src, ...keys) {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) return src[key];
  return undefined;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}

/** Una semilla nueva al azar, corta y legible (para «sembrar»). */
export function randomDustSeed() {
  let n = 0;
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    n = cryptoApi.getRandomValues(new Uint32Array(1))[0];
  } else {
    n = Math.floor(Math.random() * 4294967296);
  }
  return 's' + n.toString(36);
}

/**
 * Normaliza una especificación de grupo. `base` es la spec anterior (en una
 * actualización) o null. Idempotente: normalizar una spec ya normalizada la
 * deja igual, que es lo que hace que guardar y cargar dé lo mismo.
 */
export function normalizeDustGroupSpec(input = {}, base = null, fallbackSeed = 'dust-group') {
  const src = input || {};
  const spec = base ? cloneSpec(base) : {
    id: null,
    name: null,
    preset: null,
    seed: null,
    morphology: 'diffuse',
    palette: null,
    colors: null,
    tint: '#ffffff',
    blending: 'normal',
    volumeProfile: null,
    count: null,
    radius: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    opacity: 0.86,
    size: 1,
    maxPointSize: 3.8,
    motion: 0,
    flowSpeed: 0,
    evolution: 1,
    evolutionRate: 0,
    order: 1,
    layer: 0,
    visible: true,
    physicalGrainCount: null,
    shape: {}
  };

  // Un preset (nuevo o cambiado) rellena forma, colores, semilla y ritmo.
  const presetRequested = src.preset !== undefined && src.preset !== null && src.preset !== '';
  const presetKey = presetRequested ? resolveNebulaDustPresetName(src.preset) : null;
  if (presetRequested && !presetKey) throw new Error('Unknown nebula dust preset: ' + src.preset);
  if (presetKey) {
    const p = nebulaDustOptions(presetKey);
    if (!base || base.preset !== presetKey) {
      spec.preset = presetKey;
      spec.morphology = normalizeDustMorphology(p.morphology);
      spec.palette = p.palette || defaultDustPalette(spec.morphology);
      spec.colors = null;
      spec.seed = seedValue(p.seed) ?? spec.seed;
      spec.opacity = num(p.opacity, 0.86, 0, 1);
      spec.size = num(p.particleScale, 1, 0.01, 50);
      spec.motion = num(p.motion, 0, 0, 1);
      spec.flowSpeed = num(p.flowSpeed, 0, 0, 8);
      spec.evolution = num(p.evolution, 1, 0, 1);
      spec.evolutionRate = num(p.evolutionRate, 0, -4, 4);
      spec.blending = p.blending === 'additive' ? 'additive' : 'normal';
      spec.volumeProfile = VOLUME_PROFILES.has(p.volumeProfile) ? p.volumeProfile : null;
      spec.maxPointSize = num(p.maxPointSize, 3.8, 0.5, 16);
      spec.shape = {};
      for (const key of DUST_SHAPE_KEYS) if (finite(p[key])) spec.shape[key] = p[key];
      if (!base || src.name === undefined) spec.name = p.name || presetKey;
    }
  } else if (src.preset === null || src.preset === '') {
    spec.preset = null;
  }

  if (typeof src.id === 'string' && src.id.trim()) spec.id = src.id.trim().slice(0, 64);
  if (src.name !== undefined) spec.name = src.name === null ? null : String(src.name).slice(0, 120);

  const seed = seedValue(field(src, 'seed', 'semilla'));
  if (seed !== null) spec.seed = seed;
  if (spec.seed === null) spec.seed = fallbackSeed;

  const morphology = field(src, 'morphology', 'forma');
  if (morphology !== undefined && morphology !== null && morphology !== '') {
    spec.morphology = normalizeDustMorphology(morphology);
  }

  const colorsInput = field(src, 'colors', 'colorStops', 'colores');
  const colors = colorList(colorsInput);
  const palette = field(src, 'palette', 'paleta');
  if (colorsInput === null && palette === undefined && spec.palette === 'custom') {
    spec.colors = null;
    spec.palette = null;
  }
  if (colors) {
    spec.colors = colors;
    spec.palette = 'custom';
  } else if (palette !== undefined && palette !== null && palette !== '' && palette !== 'custom') {
    const key = String(palette).trim();
    if (PALETTE_NAMES.has(key)) {
      spec.palette = key;
      spec.colors = null;
    }
  } else if (palette === null || palette === '') {
    spec.palette = null;
    spec.colors = null;
  }
  if (spec.palette === 'custom' && !spec.colors) spec.palette = null;
  if (!spec.palette) spec.palette = defaultDustPalette(spec.morphology);

  const tint = field(src, 'tint', 'tinte');
  if (tint !== undefined) spec.tint = tint === null ? '#ffffff' : (hexColor(tint) || spec.tint);
  if (src.blending !== undefined || src.additiveBlending !== undefined) {
    spec.blending = (src.blending === 'additive' || src.additiveBlending === true) ? 'additive' : 'normal';
  }
  const volume = field(src, 'volumeProfile', 'perfilVolumen');
  if (volume !== undefined) spec.volumeProfile = VOLUME_PROFILES.has(volume) ? volume : null;
  if (!spec.volumeProfile) spec.volumeProfile = defaultDustVolumeProfile(spec.morphology);

  const count = field(src, 'count', 'sampleCount');
  if (count !== undefined) {
    const n = count === null || count === 'auto' ? 0 : num(count, 0, 0, MAX_GPU_SAMPLE_COUNT);
    spec.count = n >= 1 ? Math.floor(n) : null;
  }
  const radius = field(src, 'radius', 'radio');
  if (radius !== undefined) spec.radius = num(radius, spec.radius, 1e-9, 1e12);

  spec.position = vec3(src.position, spec.position);
  if (src.rotation !== undefined) {
    const r = src.rotation && src.rotation.isEuler ? [src.rotation.x, src.rotation.y, src.rotation.z] : vec3(src.rotation, null);
    if (r) spec.rotation = r;
  }
  if (src.scale !== undefined) {
    const s = vec3(src.scale, null);
    if (s && s.every((v) => v !== 0)) spec.scale = s;
  }

  const opacity = field(src, 'opacity', 'opacidad');
  if (opacity !== undefined) spec.opacity = num(opacity, spec.opacity, 0, 1);
  const size = field(src, 'size', 'particleScale');
  if (size !== undefined) spec.size = num(size, spec.size, 0.01, 50);
  if (src.maxPointSize !== undefined) spec.maxPointSize = num(src.maxPointSize, spec.maxPointSize, 0.5, 16);
  if (src.motion !== undefined) spec.motion = num(src.motion, spec.motion, 0, 1);
  if (src.flowSpeed !== undefined) spec.flowSpeed = num(src.flowSpeed, spec.flowSpeed, 0, 8);
  if (src.evolution !== undefined) spec.evolution = num(src.evolution, spec.evolution, 0, 1);
  if (src.evolutionRate !== undefined) spec.evolutionRate = num(src.evolutionRate, spec.evolutionRate, -4, 4);
  const order = field(src, 'order', 'renderOrder');
  if (order !== undefined) spec.order = num(order, spec.order, -1e6, 1e6);
  if (src.layer !== undefined) spec.layer = Math.floor(num(src.layer, spec.layer, 0, 31));
  if (src.visible !== undefined) spec.visible = src.visible !== false;
  if (src.physicalGrainCount !== undefined) {
    const g = num(src.physicalGrainCount, null, 0, Number.MAX_VALUE);
    spec.physicalGrainCount = g > 0 ? g : null;
  }

  const shapeInput = src.shape && typeof src.shape === 'object' ? src.shape : src;
  for (const key of DUST_SHAPE_KEYS) {
    if (shapeInput[key] === undefined) continue;
    if (shapeInput[key] === null) delete spec.shape[key];
    else if (finite(Number(shapeInput[key]))) spec.shape[key] = Number(shapeInput[key]);
  }
  // Orden fijo de las claves de la forma: el JSON sale siempre igual.
  const orderedShape = {};
  for (const key of DUST_SHAPE_KEYS) if (key in spec.shape) orderedShape[key] = spec.shape[key];
  spec.shape = orderedShape;
  if (!spec.name) spec.name = spec.preset ? (NEBULA_DUST_PRESETS[spec.preset]?.name || spec.preset) : spec.morphology;

  return {
    id: spec.id,
    name: spec.name,
    preset: spec.preset,
    seed: spec.seed,
    morphology: spec.morphology,
    palette: spec.palette,
    colors: spec.colors,
    tint: spec.tint,
    blending: spec.blending,
    volumeProfile: spec.volumeProfile,
    count: spec.count,
    radius: spec.radius,
    position: spec.position.slice(),
    rotation: spec.rotation.slice(),
    scale: spec.scale.slice(),
    opacity: spec.opacity,
    size: spec.size,
    maxPointSize: spec.maxPointSize,
    motion: spec.motion,
    flowSpeed: spec.flowSpeed,
    evolution: spec.evolution,
    evolutionRate: spec.evolutionRate,
    order: spec.order,
    layer: spec.layer,
    visible: spec.visible,
    physicalGrainCount: spec.physicalGrainCount,
    shape: spec.shape
  };
}

/** Punto donde un rayo corta el plano que pasa por `target` de cara a la cámara. */
export function projectToViewPlane(rayLike, camera, target = new THREE.Vector3(), out = new THREE.Vector3()) {
  const ray = rayLike && rayLike.ray ? rayLike.ray : rayLike;
  if (!ray || !camera) return null;
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, target);
  return ray.intersectPlane(plane, out);
}

/* ------------------------------------------------------------ enlaces cortos */
function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function streamBytes(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Escena → texto corto para un enlace (#s=...): JSON comprimido con
 * deflate-raw y en base64url ('z' delante), o sin comprimir ('j') si el
 * navegador no tiene CompressionStream.
 */
export async function encodeDustScene(scene) {
  const json = typeof scene === 'string' ? scene : JSON.stringify(scene);
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    try {
      return 'z' + toBase64Url(await streamBytes(bytes, new CompressionStream('deflate-raw')));
    } catch {
      // sin compresión
    }
  }
  return 'j' + toBase64Url(bytes);
}

/** Texto de encodeDustScene → objeto de escena. Lanza si no es válido. */
export async function decodeDustScene(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Empty dust scene link');
  const kind = t[0];
  const bytes = fromBase64Url(t.slice(1));
  let raw;
  if (kind === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the scene link');
    raw = await streamBytes(bytes, new DecompressionStream('deflate-raw'));
  } else if (kind === 'j') {
    raw = bytes;
  } else {
    throw new Error('Unknown dust scene link format');
  }
  return JSON.parse(new TextDecoder().decode(raw));
}

/* ------------------------------------------------------------ el sistema */

/**
 * Crea un sistema de grupos de polvo.
 *
 *   const dust = createDustSystem({ renderer, lightReferenceSamples: 786432 });
 *   scene.add(dust.object3d);
 *   const id = dust.addGroup({ preset: 'orion', position: [0, 0, 0] });
 *   dust.updateGroup(id, { palette: 'crab', size: 1.4 });
 *   // en el bucle: dust.update(camera, dt); renderer.render(scene, camera);
 *
 * Cualquier otra opción (renderer, adaptive, physicalGrainCount,
 * lightReferenceSamples, resolutionScale, minPointPx, nearLodDistance...) se
 * pasa a todos los motores.
 */
export function createDustSystem(options = {}) {
  const defaults = {};
  for (const [key, value] of Object.entries(options)) {
    if (!SYSTEM_ONLY.has(key)) defaults[key] = value;
  }
  let maxTotalSamples = Math.floor(num(options.maxTotalSamples, MAX_GPU_SAMPLE_COUNT, 1, MAX_GPU_SAMPLE_COUNT));
  const systemSeed = seedValue(options.seed) ?? 'dust';
  const object3d = new THREE.Group();
  object3d.name = options.name || 'Nebula dust system';
  const groups = new Map();
  const listeners = new Map();
  let nextId = 1;
  let batching = false;
  let disposed = false;
  let autoSamples = computeAutoSamples();

  const suppliedTimer = options.gpuTimer || null;
  const gpuTimer = suppliedTimer || (options.measureGpuTime === true ? createGpuTimerQuery(options.renderer) : null);
  const ownsTimer = Boolean(gpuTimer && !suppliedTimer);

  if (typeof options.onChange === 'function') on('change', options.onChange);

  function computeAutoSamples() {
    return resolveDustBudget({ ...defaults, sampleCount: undefined, muestrasGPU: undefined }).sampleCount;
  }

  function on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  }

  function emit(event) {
    for (const type of [event.type, 'change']) {
      const set = listeners.get(type);
      if (!set) continue;
      for (const fn of [...set]) {
        try { fn(event); } catch (error) { console.error('nebula-dust system listener', error); }
      }
    }
  }

  function requested(group) {
    return group.spec.count || autoSamples;
  }

  /** Reparto proporcional del tope entre los grupos (suma ≤ maxTotalSamples). */
  function allocation() {
    const list = [...groups.values()];
    const total = list.reduce((sum, g) => sum + requested(g), 0);
    const out = new Map();
    if (total <= maxTotalSamples) {
      for (const g of list) out.set(g.id, requested(g));
      return out;
    }
    let sum = 0;
    for (const g of list) {
      const n = Math.max(1, Math.floor(requested(g) * maxTotalSamples / total));
      out.set(g.id, n);
      sum += n;
    }
    // Con muchos grupos diminutos, el mínimo de 1 podría pasarse: se descuenta del mayor.
    while (sum > maxTotalSamples) {
      let biggest = null;
      for (const [id, n] of out) if (!biggest || n > out.get(biggest)) biggest = id;
      out.set(biggest, out.get(biggest) - 1);
      sum--;
    }
    return out;
  }

  function engineOptions(spec, sampleCount) {
    const o = { ...defaults };
    Object.assign(o, {
      name: spec.name || spec.id,
      seed: spec.seed,
      morphology: spec.morphology,
      volumeProfile: spec.volumeProfile,
      radius: spec.radius,
      opacity: spec.opacity,
      particleScale: spec.size,
      maxPointSize: spec.maxPointSize,
      motion: spec.motion,
      flowSpeed: spec.flowSpeed,
      evolution: spec.evolution,
      evolutionRate: spec.evolutionRate,
      blending: spec.blending,
      tint: spec.tint,
      renderOrder: spec.order,
      sampleCount,
      maximumSamples: sampleCount,
      ...spec.shape
    });
    if (spec.palette === 'custom' && spec.colors) {
      o.colorStops = spec.colors;
      delete o.palette;
    } else {
      o.palette = spec.palette;
      delete o.colorStops;
      delete o.colors;
    }
    if (spec.physicalGrainCount) o.physicalGrainCount = spec.physicalGrainCount;
    delete o.measureGpuTime;
    delete o.gpuTimer;
    return o;
  }

  function applyTransform(group) {
    const o = group.engine.object3d;
    const s = group.spec;
    o.position.fromArray(s.position);
    o.rotation.set(s.rotation[0], s.rotation[1], s.rotation[2]);
    o.scale.fromArray(s.scale);
    o.visible = s.visible;
    o.name = s.name || s.id;
    o.userData.dustGroupId = group.id;
    o.traverse((child) => child.layers.set(s.layer));
  }

  function build(group, sampleCount) {
    const old = group.engine;
    const engine = createNebulaDustEngine(engineOptions(group.spec, sampleCount));
    group.engine = engine;
    applyTransform(group);
    object3d.add(engine.object3d);
    if (old) {
      object3d.remove(old.object3d);
      old.dispose();
    }
    emit({ type: 'rebuild', id: group.id, engine });
  }

  function rebalance(force = null) {
    if (batching) return;
    const plan = allocation();
    for (const group of groups.values()) {
      const n = plan.get(group.id);
      if (!group.engine || group.engine.metadata.sampleCount !== n || (force && force.has(group.id))) build(group, n);
    }
  }

  function uniqueId(wanted) {
    if (wanted && !groups.has(wanted)) {
      const m = /^g(\d+)$/.exec(wanted);
      if (m) nextId = Math.max(nextId, Number(m[1]) + 1);
      return wanted;
    }
    while (groups.has('g' + nextId)) nextId++;
    return 'g' + nextId++;
  }

  /** Añade un grupo y devuelve su id. */
  function addGroup(input = {}) {
    if (disposed) throw new Error('The dust system is disposed');
    if (groups.size >= MAX_DUST_GROUPS) throw new Error('Too many dust groups (max ' + MAX_DUST_GROUPS + ')');
    const wanted = typeof input.id === 'string' && input.id.trim() ? input.id.trim().slice(0, 64) : null;
    const id = uniqueId(wanted);
    const spec = normalizeDustGroupSpec({ ...input, id }, null, systemSeed + '-' + id);
    const group = { id, spec, engine: null };
    groups.set(id, group);
    try {
      rebalance();
    } catch (error) {
      groups.delete(id);
      if (group.engine) {
        object3d.remove(group.engine.object3d);
        group.engine.dispose();
      }
      throw error;
    }
    emit({ type: 'add', id });
    return id;
  }

  /** «Sembrar»: un grupo nuevo en un punto de la escena. */
  function sow(point, input = {}) {
    const position = vec3(point, null);
    if (!position) throw new Error('sow() needs a point');
    return addGroup({ seed: input.seed ?? randomDustSeed(), ...input, position });
  }

  function needsRebuild(before, after) {
    return before.seed !== after.seed
      || before.morphology !== after.morphology
      || before.radius !== after.radius
      || before.volumeProfile !== after.volumeProfile
      || before.physicalGrainCount !== after.physicalGrainCount
      || !sameJson(before.shape, after.shape);
  }

  /**
   * Cambia un grupo en caliente. Color, paleta, tinte, mezcla, opacidad,
   * tamaño, movimiento, transformación, capa, orden y visibilidad no
   * regeneran nada; semilla, forma, preset, radio, volumen y motas sí.
   */
  function updateGroup(id, patch = {}) {
    const group = groups.get(id);
    if (!group || disposed) return false;
    const before = group.spec;
    commit(group, before, normalizeDustGroupSpec({ ...patch, id }, before, before.seed));
    emit({ type: 'update', id, patch });
    return true;
  }

  /** Aplica una spec nueva: regenera si hace falta y, si no, cambia al vuelo. */
  function commit(group, before, after) {
    group.spec = after;
    const engine = group.engine;
    if (before.count !== after.count) {
      rebalance(needsRebuild(before, after) ? new Set([group.id]) : null);
      if (group.engine !== engine) return;
    } else if (needsRebuild(before, after)) {
      build(group, engine.metadata.sampleCount);
      return;
    }
    if (before.opacity !== after.opacity) engine.setOpacity(after.opacity);
    if (before.size !== after.size) engine.setParticleScale(after.size);
    if (before.maxPointSize !== after.maxPointSize) engine.setMaxPointSize(after.maxPointSize);
    if (before.motion !== after.motion) engine.setMotion(after.motion);
    if (before.flowSpeed !== after.flowSpeed) engine.setFlowSpeed(after.flowSpeed);
    if (before.evolutionRate !== after.evolutionRate) engine.setEvolutionRate(after.evolutionRate);
    if (before.evolution !== after.evolution) engine.setEvolution(after.evolution);
    if (before.blending !== after.blending) engine.setBlending(after.blending);
    if (before.palette !== after.palette || !sameJson(before.colors, after.colors)) {
      engine.setPalette(after.palette === 'custom' ? after.colors : after.palette);
    }
    if (before.tint !== after.tint) engine.setTint(after.tint);
    if (before.order !== after.order) engine.setRenderOrder(after.order);
    applyTransform(group);
  }

  /**
   * Vuelve un grupo a los valores de su preset (o a los de fábrica si no
   * tiene), conservando id, nombre, semilla (si no hay preset), posición,
   * giro, escala, motas, capa, orden y visibilidad.
   */
  function resetGroup(id) {
    const group = groups.get(id);
    if (!group || disposed) return false;
    const s = group.spec;
    const fresh = normalizeDustGroupSpec({
      id,
      preset: s.preset,
      morphology: s.preset ? undefined : s.morphology,
      seed: s.preset ? undefined : s.seed,
      radius: s.radius,
      count: s.count,
      position: s.position,
      rotation: s.rotation,
      scale: s.scale,
      order: s.order,
      layer: s.layer,
      visible: s.visible
    }, null, s.seed);
    commit(group, s, fresh);
    emit({ type: 'update', id, patch: { reset: true } });
    return true;
  }

  function removeGroup(id) {
    const group = groups.get(id);
    if (!group) return false;
    groups.delete(id);
    if (group.engine) {
      object3d.remove(group.engine.object3d);
      group.engine.dispose();
      group.engine = null;
    }
    rebalance();
    emit({ type: 'remove', id });
    return true;
  }

  function duplicateGroup(id, patch = {}) {
    const group = groups.get(id);
    if (!group) return null;
    const copy = cloneSpec(group.spec);
    delete copy.id;
    copy.name = (group.spec.name || id) + ' (copy)';
    return addGroup({ ...copy, ...patch });
  }

  function listGroups() {
    return [...groups.values()].map((g) => ({
      id: g.id,
      name: g.spec.name,
      preset: g.spec.preset,
      morphology: g.spec.morphology,
      palette: g.spec.palette,
      blending: g.spec.blending,
      visible: g.spec.visible,
      order: g.spec.order,
      layer: g.spec.layer,
      requestedSamples: requested(g),
      sampleCount: g.engine ? g.engine.metadata.sampleCount : 0
    }));
  }

  function getGroup(id) {
    const g = groups.get(id);
    return g ? { id: g.id, spec: cloneSpec(g.spec), engine: g.engine, object3d: g.engine.object3d } : null;
  }

  /** El id del grupo al que pertenece un Object3D (el de un motor o cualquier hijo). */
  function groupIdOf(object) {
    for (let o = object; o; o = o.parent) {
      if (o.userData && o.userData.dustGroupId && groups.has(o.userData.dustGroupId)) return o.userData.dustGroupId;
    }
    return null;
  }

  /** Lee la transformación actual del Object3D del grupo (tras moverlo con un gizmo). */
  function captureTransform(id) {
    const g = groups.get(id);
    if (!g) return false;
    const o = g.engine.object3d;
    return updateGroup(id, {
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: [o.scale.x, o.scale.y, o.scale.z]
    });
  }

  function clear() {
    for (const group of groups.values()) {
      if (group.engine) {
        object3d.remove(group.engine.object3d);
        group.engine.dispose();
        group.engine = null;
      }
    }
    groups.clear();
    nextId = 1;
    emit({ type: 'clear' });
  }

  /** La escena entera como objeto JSON (lo que se guarda o se comparte). */
  function serialize(extra = {}) {
    const out = {
      format: DUST_SCENE_FORMAT,
      version: DUST_SCENE_VERSION,
      engine: ENGINE_VERSION,
      maxTotalSamples,
      groups: [...groups.values()].map((g) => cloneSpec(g.spec))
    };
    if (extra && extra.view !== undefined) out.view = JSON.parse(JSON.stringify(extra.view));
    if (extra && extra.title !== undefined) out.title = String(extra.title);
    return out;
  }

  /** Sustituye la escena por la de un JSON (objeto o texto). Devuelve { ids, view, title }. */
  function load(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || typeof data !== 'object' || !Array.isArray(data.groups)) throw new Error('Not a dust scene: missing groups');
    if (data.format !== undefined && data.format !== DUST_SCENE_FORMAT) throw new Error('Unknown dust scene format: ' + data.format);
    if (finite(data.version) && data.version > DUST_SCENE_VERSION) throw new Error('Dust scene version ' + data.version + ' is newer than this engine');
    // Se valida todo antes de tocar la escena: un fichero malo no la deja a medias.
    const specs = [];
    const seen = new Set();
    for (const entry of data.groups.slice(0, MAX_DUST_GROUPS)) {
      if (!entry || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' && entry.id.trim() && !seen.has(entry.id.trim()) ? entry.id.trim() : null;
      const spec = normalizeDustGroupSpec(entry, null, systemSeed + '-' + (id || specs.length + 1));
      spec.id = id;
      if (id) seen.add(id);
      specs.push(spec);
    }
    clear();
    if (finite(data.maxTotalSamples)) maxTotalSamples = Math.floor(clamp(data.maxTotalSamples, 1, MAX_GPU_SAMPLE_COUNT));
    batching = true;
    const ids = [];
    try {
      for (const spec of specs) {
        const id = uniqueId(spec.id);
        groups.set(id, { id, spec: { ...spec, id }, engine: null });
        ids.push(id);
      }
    } finally {
      batching = false;
    }
    rebalance();
    emit({ type: 'load', ids });
    return { ids, view: data.view ?? null, title: data.title ?? null };
  }

  /* -------------------------------------------------------- selección */
  const tmpCenter = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpPoint = new THREE.Vector3();
  const tmpSphere = new THREE.Sphere();

  function worldBounds(group) {
    const o = group.engine.object3d;
    o.updateWorldMatrix(true, false);
    o.getWorldPosition(tmpCenter);
    o.getWorldScale(tmpScale);
    const s = Math.max(Math.abs(tmpScale.x), Math.abs(tmpScale.y), Math.abs(tmpScale.z));
    return { center: tmpCenter.clone(), radius: group.spec.radius * s * 1.25, scale: s };
  }

  /**
   * El grupo que hay bajo un rayo (THREE.Raycaster o THREE.Ray). Se prueba la
   * esfera envolvente y, dentro, si el rayo pasa de verdad cerca de motas;
   * entre varios, gana el que tiene motas bajo el rayo y, a igualdad, el más
   * pequeño (el disco antes que el halo que lo rodea). `all: true` devuelve
   * la lista ordenada.
   */
  function pick(rayLike, pickOptions = {}) {
    const ray = rayLike && rayLike.ray ? rayLike.ray : rayLike;
    if (!ray || !ray.origin) return pickOptions.all ? [] : null;
    const hits = [];
    for (const group of groups.values()) {
      if (!group.engine || !group.spec.visible) continue;
      if (pickOptions.layer !== undefined && group.spec.layer !== pickOptions.layer) continue;
      const bounds = worldBounds(group);
      tmpSphere.set(bounds.center, bounds.radius);
      if (!ray.intersectsSphere(tmpSphere)) continue;
      const entry = ray.intersectSphere(tmpSphere, new THREE.Vector3());
      const positions = group.engine.points.geometry.getAttribute('position').array;
      const matrix = group.engine.points.matrixWorld;
      const total = positions.length / 3;
      const step = Math.max(1, Math.floor(total / 1500));
      let best = Infinity;
      for (let i = 0; i < total; i += step) {
        tmpPoint.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyMatrix4(matrix);
        const d = ray.distanceSqToPoint(tmpPoint);
        if (d < best) best = d;
      }
      const score = Math.sqrt(best) / bounds.radius;
      hits.push({
        id: group.id,
        distance: entry ? entry.distanceTo(ray.origin) : 0,
        point: entry || bounds.center.clone(),
        radius: bounds.radius,
        score,
        onSamples: score < 0.08
      });
    }
    hits.sort((a, b) => (Number(b.onSamples) - Number(a.onSamples)) || (a.radius - b.radius) || (a.distance - b.distance));
    return pickOptions.all ? hits : (hits[0] || null);
  }

  /** pick() desde coordenadas normalizadas de pantalla (-1..1) y una cámara. */
  function pickScreen(ndcX, ndcY, camera, pickOptions = {}) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    return pick(raycaster, pickOptions);
  }

  /**
   * «Tocar»: empuja las motas cerca de `worldPoint` (radio en unidades de la
   * escena) en los grupos a su alcance, o solo en `id`. Decae solo; todo en
   * GPU. Devuelve cuántos grupos se tocaron.
   */
  function touch(worldPoint, touchOptions = {}) {
    const point = vec3(worldPoint, null);
    if (!point) return 0;
    const radius = num(touchOptions.radius, 0.3, 1e-9, 1e12);
    const strength = num(touchOptions.strength, 0.35, 0, 4);
    let touched = 0;
    for (const group of groups.values()) {
      if (!group.engine || !group.spec.visible) continue;
      if (touchOptions.id && touchOptions.id !== group.id) continue;
      const bounds = worldBounds(group);
      const p = new THREE.Vector3(point[0], point[1], point[2]);
      if (!touchOptions.id && p.distanceTo(bounds.center) > bounds.radius + radius * 2) continue;
      group.engine.points.updateWorldMatrix(true, false);
      group.engine.points.worldToLocal(p);
      if (group.engine.touch(p, radius / Math.max(bounds.scale, 1e-9), strength) >= 0) touched++;
    }
    return touched;
  }

  /* -------------------------------------------------------- bucle */
  function update(camera, deltaSeconds = 0) {
    if (disposed) return 0;
    let gpuMs = null;
    if (gpuTimer && typeof gpuTimer.poll === 'function') {
      const polled = gpuTimer.poll();
      if (finite(polled)) gpuMs = polled;
    }
    let visible = 0;
    for (const group of groups.values()) {
      if (!group.engine || !group.spec.visible) continue;
      if (gpuMs !== null) group.engine.reportGpuFrameTime(gpuMs);
      group.engine.update(camera, deltaSeconds);
      visible += group.engine.getStatus().visibleSamplesApprox;
    }
    return visible;
  }

  function reportGpuFrameTime(milliseconds) {
    let ok = false;
    for (const group of groups.values()) if (group.engine && group.engine.reportGpuFrameTime(milliseconds)) ok = true;
    return ok;
  }

  function beginGpuFrame() {
    return Boolean(gpuTimer && typeof gpuTimer.begin === 'function' && gpuTimer.begin());
  }

  function endGpuFrame() {
    return Boolean(gpuTimer && typeof gpuTimer.end === 'function' && gpuTimer.end());
  }

  function isAnimated() {
    for (const group of groups.values()) {
      if (group.engine && group.spec.visible && group.engine.isAnimated()) return true;
    }
    return false;
  }

  /** Suma de engine.probeFrame de todos los grupos visibles. */
  function probeFrame(camera, probeCount = 4096) {
    const out = { drawnSamples: 0, sentSamples: 0, light: 0, referenceLight: 0 };
    const visibles = [...groups.values()].filter((g) => g.engine && g.spec.visible);
    for (const group of visibles) {
      const p = group.engine.probeFrame(camera, Math.max(256, Math.floor(probeCount / Math.max(1, visibles.length))));
      out.drawnSamples += p.drawnSamples || 0;
      out.sentSamples += p.sentSamples || 0;
      out.light += p.light || 0;
      out.referenceLight += p.referenceLight || 0;
    }
    return out;
  }

  /**
   * Cambia opciones comunes a todos los grupos. resolutionScale, minPointPx,
   * maxVisibleSamples y touchDecay se aplican al vuelo; maxTotalSamples
   * reparte de nuevo; el resto rehace las nubes.
   */
  function setOptions(patch = {}) {
    let rebuildAll = false;
    let reallocate = false;
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'maxTotalSamples') {
        maxTotalSamples = Math.floor(num(value, maxTotalSamples, 1, MAX_GPU_SAMPLE_COUNT));
        reallocate = true;
        continue;
      }
      if (SYSTEM_ONLY.has(key)) continue;
      if (value === undefined) delete defaults[key];
      else defaults[key] = value;
      if (LIVE_SYSTEM_OPTIONS[key]) {
        for (const group of groups.values()) if (group.engine) group.engine[LIVE_SYSTEM_OPTIONS[key]](value);
      } else {
        rebuildAll = true;
      }
    }
    if (rebuildAll) {
      autoSamples = computeAutoSamples();
      rebalance(new Set(groups.keys()));
    } else if (reallocate) {
      rebalance();
    }
    emit({ type: 'options', patch });
    return { ...defaults, maxTotalSamples };
  }

  function getOptions() {
    return { ...defaults, maxTotalSamples };
  }

  function getStatus() {
    let allocated = 0;
    let requestedTotal = 0;
    let visibleSamples = 0;
    for (const group of groups.values()) {
      requestedTotal += requested(group);
      if (!group.engine) continue;
      allocated += group.engine.metadata.sampleCount;
      if (group.spec.visible) visibleSamples += group.engine.getStatus().visibleSamplesApprox;
    }
    return Object.freeze({
      disposed,
      groups: groups.size,
      requestedSamples: requestedTotal,
      allocatedSamples: allocated,
      maxTotalSamples,
      autoSamplesPerGroup: autoSamples,
      visibleSamples,
      animated: isAnimated(),
      gpuTimer: gpuTimer && typeof gpuTimer.snapshot === 'function' ? gpuTimer.snapshot() : null
    });
  }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    if (object3d.parent) object3d.parent.remove(object3d);
    if (ownsTimer && typeof gpuTimer.dispose === 'function') gpuTimer.dispose();
    listeners.clear();
  }

  if (Array.isArray(options.groups) && options.groups.length) load({ groups: options.groups });

  return Object.freeze({
    object3d,
    addGroup,
    sow,
    updateGroup,
    resetGroup,
    removeGroup,
    duplicateGroup,
    listGroups,
    getGroup,
    groupIdOf,
    captureTransform,
    clear,
    serialize,
    load,
    pick,
    pickScreen,
    touch,
    update,
    reportGpuFrameTime,
    beginGpuFrame,
    endGpuFrame,
    isAnimated,
    probeFrame,
    setOptions,
    getOptions,
    getStatus,
    on,
    off,
    dispose,
    get size() { return groups.size; }
  });
}

export default createDustSystem;
