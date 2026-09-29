/**
 * Nebula Dust Engine
 *
 * Motor de polvo procedural para Three.js. Cada punto es una muestra visual
 * determinista de una población física mucho mayor; nunca se crea un objeto
 * JavaScript por cada grano real.
 */
import * as THREE from 'three';
import {
  GPU_SAMPLE_BUDGETS,
  GPU_TIER_NAMES,
  createAdaptiveLodController,
  createGpuTimerQuery,
  detectGpuProfile
} from './gpu-profile.js';

export const DUST_SAMPLE_BUDGETS = GPU_SAMPLE_BUDGETS;
export {
  GPU_TIER_NAMES,
  createAdaptiveLodController,
  createGpuTimerQuery,
  detectGpuProfile
} from './gpu-profile.js';

export const ENGINE_VERSION = '0.4.0';
export const DEFAULT_REPRESENTED_GRAIN_COUNT = null;
export const MAX_GPU_SAMPLE_COUNT = 4000000;
/**
 * Umbral recomendado para `minPointPx`: las motas de menos de este tamaño (px
 * del búfer) se sortean y se dibuja 1 de cada 1/p con su luz × 1/p. Apagado
 * por defecto (ver uMinPointPx).
 */
export const DEFAULT_MIN_POINT_PX = 0.5;
/** Probabilidad mínima de dibujar una mota pequeña (limita el grano del sorteo). */
export const DEFAULT_SUBPIXEL_KEEP_FLOOR = 0.25;
export const DUST_MORPHOLOGIES = Object.freeze([
  'diffuse',
  'orion',
  'pillars',
  'horsehead',
  'crab',
  'ring',
  'bipolar',
  'lion',
  'galaxy',
  'oort',
  'supernovaEjecta',
  'whiteDwarfAccretion',
  'clumpyShell',
  'pinwheel'
]);
export const DUST_PALETTES = Object.freeze([
  'webb',
  'orion',
  'ionized',
  'crab',
  'dark',
  'galaxy',
  'oort',
  'supernova',
  'accretion',
  'redSupergiant',
  'hotDust'
]);

const SOLAR_MASS_KG = 1.98847e30;
const DEFAULT_GRAIN_DENSITY_KG_M3 = 3000;
const TAU = Math.PI * 2;
const PILLAR_LAYOUTS = Object.freeze([
  Object.freeze([-0.53, -0.94, 1.68, 0.16, 0.18, -0.06]),
  Object.freeze([-0.18, -0.88, 1.35, 0.13, -0.10, 0.05]),
  Object.freeze([0.20, -0.91, 1.12, 0.11, 0.08, -0.02]),
  Object.freeze([0.51, -0.78, 0.82, 0.18, -0.18, 0.11])
]);

const PALETTES = Object.freeze({
  webb: Object.freeze([
    Object.freeze([0.22, 0.07, 0.56]),
    Object.freeze([0.62, 0.22, 0.88]),
    Object.freeze([1.00, 0.36, 0.61]),
    Object.freeze([1.00, 0.72, 0.28])
  ]),
  orion: Object.freeze([
    Object.freeze([0.13, 0.23, 0.34]),
    Object.freeze([0.43, 0.17, 0.36]),
    Object.freeze([0.82, 0.28, 0.34]),
    Object.freeze([0.92, 0.68, 0.42])
  ]),
  ionized: Object.freeze([
    Object.freeze([0.20, 0.38, 0.80]),
    Object.freeze([0.64, 0.24, 0.88]),
    Object.freeze([0.98, 0.42, 0.70]),
    Object.freeze([1.00, 0.76, 0.34])
  ]),
  crab: Object.freeze([
    Object.freeze([0.10, 0.32, 0.46]),
    Object.freeze([0.20, 0.66, 0.72]),
    Object.freeze([0.90, 0.26, 0.18]),
    Object.freeze([1.00, 0.62, 0.16])
  ]),
  dark: Object.freeze([
    Object.freeze([0.008, 0.006, 0.014]),
    Object.freeze([0.018, 0.010, 0.030]),
    Object.freeze([0.045, 0.018, 0.060]),
    Object.freeze([0.110, 0.040, 0.090])
  ]),
  galaxy: Object.freeze([
    Object.freeze([0.20, 0.12, 0.36]),
    Object.freeze([0.42, 0.32, 0.70]),
    Object.freeze([0.92, 0.62, 0.48]),
    Object.freeze([1.00, 0.88, 0.68])
  ]),
  oort: Object.freeze([
    Object.freeze([0.18, 0.28, 0.42]),
    Object.freeze([0.36, 0.58, 0.78]),
    Object.freeze([0.72, 0.86, 0.94]),
    Object.freeze([0.94, 0.96, 1.00])
  ]),
  supernova: Object.freeze([
    Object.freeze([0.16, 0.42, 0.92]),
    Object.freeze([0.64, 0.24, 0.88]),
    Object.freeze([0.98, 0.24, 0.30]),
    Object.freeze([1.00, 0.76, 0.22])
  ]),
  accretion: Object.freeze([
    Object.freeze([0.24, 0.52, 1.00]),
    Object.freeze([0.82, 0.91, 1.00]),
    Object.freeze([1.00, 0.76, 0.34]),
    Object.freeze([0.92, 0.20, 0.12])
  ]),
  // Silicatos y alúmina de una supergigante roja (VLT/VISIR): pardo a naranja.
  redSupergiant: Object.freeze([
    Object.freeze([0.34, 0.15, 0.06]),
    Object.freeze([0.60, 0.30, 0.12]),
    Object.freeze([0.84, 0.50, 0.24]),
    Object.freeze([1.00, 0.70, 0.40])
  ]),
  // Carbono amorfo caliente (Keck, Tuthill): rojo fuera, amarillo en la raíz.
  // Con `shade` el primer tono es el polvo frío y el último el recién formado.
  hotDust: Object.freeze([
    Object.freeze([0.36, 0.06, 0.03]),
    Object.freeze([0.78, 0.18, 0.05]),
    Object.freeze([1.00, 0.46, 0.12]),
    Object.freeze([1.00, 0.80, 0.46])
  ])
});

export const DUST_VOLUME_PROFILES = Object.freeze([
  'mist',
  'balanced',
  'dense',
  'emissive'
]);

const VOLUME_PROFILE_CONFIG = Object.freeze({
  mist: Object.freeze({
    alphaMin: 0.004,
    alphaSpan: 0.036,
    alphaPower: 1.65,
    sizeMin: 0.00020,
    sizeSpan: 0.0028,
    sizePower: 2.25
  }),
  balanced: Object.freeze({
    alphaMin: 0.012,
    alphaSpan: 0.070,
    alphaPower: 1.35,
    sizeMin: 0.00022,
    sizeSpan: 0.0033,
    sizePower: 2.10
  }),
  dense: Object.freeze({
    alphaMin: 0.020,
    alphaSpan: 0.105,
    alphaPower: 1.10,
    sizeMin: 0.00028,
    sizeSpan: 0.0038,
    sizePower: 1.85
  }),
  emissive: Object.freeze({
    alphaMin: 0.014,
    alphaSpan: 0.090,
    alphaPower: 1.18,
    sizeMin: 0.00024,
    sizeSpan: 0.0042,
    sizePower: 1.72
  })
});

const MORPHOLOGY_ALIASES = Object.freeze({
  diffuse: 'diffuse',
  difuso: 'diffuse',
  orion: 'orion',
  m42: 'orion',
  pillars: 'pillars',
  pilares: 'pillars',
  eagle: 'pillars',
  aguila: 'pillars',
  creation: 'pillars',
  creacion: 'pillars',
  horsehead: 'horsehead',
  caballo: 'horsehead',
  crab: 'crab',
  cangrejo: 'crab',
  ring: 'ring',
  anillo: 'ring',
  m57: 'ring',
  helix: 'ring',
  helice: 'ring',
  bipolar: 'bipolar',
  lion: 'lion',
  leon: 'lion',
  galaxy: 'galaxy',
  galaxia: 'galaxy',
  oort: 'oort',
  nube_oort: 'oort',
  supernova: 'supernovaEjecta',
  ejecta: 'supernovaEjecta',
  supernovaejecta: 'supernovaEjecta',
  supernova_ejecta: 'supernovaEjecta',
  accretion: 'whiteDwarfAccretion',
  whitedwarfaccretion: 'whiteDwarfAccretion',
  white_dwarf: 'whiteDwarfAccretion',
  enana_blanca: 'whiteDwarfAccretion',
  clumpyshell: 'clumpyShell',
  clumpy_shell: 'clumpyShell',
  cascara_grumosa: 'clumpyShell',
  grumosa: 'clumpyShell',
  pinwheel: 'pinwheel',
  molinillo: 'pinwheel',
  espiral_polvo: 'pinwheel'
});

const MORPHOLOGY_SHADER_MODES = Object.freeze({
  galaxy: 1,
  oort: 2,
  supernovaEjecta: 3,
  whiteDwarfAccretion: 4
});

const VERTEX_SHADER = [
  '#include <common>',
  '#include <logdepthbuf_pars_vertex>',
  'attribute vec3 aColor;',
  'attribute float aSize;',
  'attribute float aAlpha;',
  'attribute float aPhase;',
  'uniform float uHeightPx;',
  'uniform float uParticleScale;',
  'uniform float uLodPointScale;',
  'uniform float uLodAlphaScale;',
  'uniform float uMaxPointSize;',
  'uniform float uTime;',
  'uniform float uMotion;',
  'uniform float uMorphologyMode;',
  'uniform float uRadius;',
  'uniform float uEvolution;',
  'uniform float uFlowSpeed;',
  // Escala del búfer en que se dibuja respecto a la pantalla (0,5 = media resolución).
  'uniform float uResolutionScale;',
  // Motas de menos de uMinPointPx píxeles del búfer: se dibuja una de cada 1/p, con su luz × 1/p.
  'uniform float uMinPointPx;',
  'uniform float uCullFloor;',
  // Toques: xyz = punto (espacio local del grupo), w = fuerza que decae; uTouchRadius, un radio por toque.
  'uniform vec4 uTouch[4];',
  'uniform vec4 uTouchRadius;',
  'uniform vec3 uTint;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'varying float vGlow;',
  'mat2 rotation2d(float angle) {',
  '  float c = cos(angle);',
  '  float s = sin(angle);',
  '  return mat2(c, -s, s, c);',
  '}',
  // Empuje gaussiano hacia fuera del punto tocado; con fuerza 0 no mueve nada.
  'vec3 dustTouchPush(vec3 p, vec4 t, float r) {',
  '  if (t.w <= 0.0) return vec3(0.0);',
  '  vec3 d = p - t.xyz;',
  '  float rr = max(r * r, 1e-12);',
  '  float d2 = dot(d, d);',
  '  return d * inversesqrt(d2 + rr * 0.01) * (t.w * r * exp(-d2 / rr));',
  '}',
  'void main() {',
  '  vec3 p = position;',
  '  float normalizedRadius = clamp(length(position.xy) / max(uRadius, 0.000001), 0.0, 1.5);',
  '  vGlow = 0.0;',
  '  if (uMorphologyMode > 0.5 && uMorphologyMode < 1.5) {',
  '    float orbit = uTime * uFlowSpeed * (0.025 + (1.0 - min(normalizedRadius, 1.0)) * 0.075);',
  '    p.xy = rotation2d(orbit) * p.xy;',
  '  } else if (uMorphologyMode > 1.5 && uMorphologyMode < 2.5) {',
  '    p.xz = rotation2d(uTime * uFlowSpeed * 0.012) * p.xz;',
  '    p.yz = rotation2d(uTime * uFlowSpeed * 0.007) * p.yz;',
  '  } else if (uMorphologyMode > 2.5 && uMorphologyMode < 3.5) {',
  '    float blast = smoothstep(0.0, 1.0, uEvolution);',
  '    p *= mix(0.035, 1.0, blast);',
  '    vGlow = (1.0 - blast) * 1.35 + blast * 0.22;',
  '  } else if (uMorphologyMode > 3.5) {',
  '    float orbit = uTime * uFlowSpeed * (0.18 + 0.82 / (0.16 + normalizedRadius));',
  '    float infall = 0.58 + 0.42 * fract(aPhase / 6.28318530718 - uTime * uFlowSpeed * 0.045);',
  '    p.xy = rotation2d(orbit) * p.xy * infall;',
  '    vGlow = (1.0 - min(normalizedRadius, 1.0)) * 0.85;',
  '  }',
  '  vec3 radial = normalize(p + vec3(0.00001, 0.00002, 0.00003));',
  '  float onda = sin(uTime * (0.12 + fract(aPhase) * 0.08) + aPhase);',
  '  float motionBoost = uMorphologyMode > 2.5 && uMorphologyMode < 3.5 ? 1.8 : 1.0;',
  '  p += radial * onda * aSize * uMotion * motionBoost;',
  '  p += dustTouchPush(p, uTouch[0], uTouchRadius.x);',
  '  p += dustTouchPush(p, uTouch[1], uTouchRadius.y);',
  '  p += dustTouchPush(p, uTouch[2], uTouchRadius.z);',
  '  p += dustTouchPush(p, uTouch[3], uTouchRadius.w);',
  '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
  '  float distancia = max(-mv.z, 0.0001);',
  '  float s = max(uResolutionScale, 0.05);',
  // Tamaño de referencia: el de la pantalla con todas las motas (el aspecto de siempre).
  '  float pxPantalla = aSize * uParticleScale * uHeightPx / (distancia * s);',
  '  float pxRef = clamp(pxPantalla, 0.35, uMaxPointSize);',
  // Tamaño dibujado en el búfer, con la agregación del LOD.
  '  float pxCrudo = pxPantalla * uLodPointScale * s;',
  '  float px = clamp(pxCrudo, 0.35, uMaxPointSize * s);',
  // Luz de una mota ∝ alfa × área cubierta; un punto de menos de 1 px cubre 1 px.
  // uLodAlphaScale = motas totales / dibujadas: la luz que falta la ponen las que quedan.
  '  float areaRef = max(pxRef, 1.0);',
  '  areaRef *= areaRef;',
  '  float keep = 1.0;',
  '  if (uMinPointPx > 0.0 && pxCrudo < uMinPointPx) {',
  '    float f = pxCrudo / uMinPointPx;',
  '    keep = max(uCullFloor, f * f);',
  '  }',
  '  float luz = aAlpha * uLodAlphaScale * areaRef / keep;',
  '  float lado = max(px, 1.0) / s;',
  // Si el alfa se saturase, la luz se reparte en más área en vez de perderse.
  '  float areaNecesaria = luz / 0.9;',
  '  if (areaNecesaria > lado * lado) {',
  '    lado = min(sqrt(areaNecesaria), max(uMaxPointSize, lado));',
  '    px = max(px, lado * s);',
  '  }',
  '  gl_PointSize = px;',
  '  gl_Position = projectionMatrix * mv;',
  '  vColor = aColor * uTint;',
  '  vAlpha = min(luz / (lado * lado), 0.98);',
  '#include <logdepthbuf_vertex>',
  '  if (keep < 1.0) {',
  // Sorteo fijo por mota (hash PCG del índice), independiente del orden del LOD.
  '    uint h = uint(gl_VertexID) * 747796405u + 2891336453u;',
  '    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;',
  '    h = (h >> 22u) ^ h;',
  '    if (float(h) * (1.0 / 4294967296.0) >= keep) {',
  '      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
  '      gl_PointSize = 1.0;',
  '      vAlpha = 0.0;',
  '    }',
  '  }',
  '}'
].join('\n');

const FRAGMENT_SHADER = [
  '#include <common>',
  '#include <logdepthbuf_pars_fragment>',
  'precision highp float;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'varying float vGlow;',
  // 0,002 con todas las motas; menos cuando cada mota lleva menos luz (lightReferenceSamples).
  'uniform float uDiscardAlpha;',
  'void main() {',
  '  vec2 q = gl_PointCoord - 0.5;',
  '  float r2 = dot(q, q) * 4.0;',
  '  if (r2 > 1.0) discard;',
  '  float perfil = exp(-r2 * 4.6) * (1.0 - r2 * 0.30);',
  '  float alpha = vAlpha * perfil;',
  '  if (alpha < uDiscardAlpha) discard;',
  '  gl_FragColor = vec4(vColor * (1.0 + vGlow * perfil), alpha);',
  '#include <logdepthbuf_fragment>',
  '}'
].join('\n');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(minimum, maximum, value) {
  const t = clamp((value - minimum) / Math.max(maximum - minimum, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isAdditive(options) {
  return options.blending === 'additive' || options.additiveBlending === true;
}

function morphologyName(value) {
  const key = String(value || 'diffuse').toLowerCase().trim();
  return MORPHOLOGY_ALIASES[key] || 'diffuse';
}

/** Las paradas de color de una paleta incluida, como ternas RGB de 0 a 1. */
export function getDustPalette(name) {
  const stops = PALETTES[String(name || '').toLowerCase().trim()];
  return stops ? stops.map((stop) => Array.from(stop)) : null;
}

export function listDustMorphologies() {
  return Array.from(DUST_MORPHOLOGIES);
}

export function listDustPalettes() {
  return Array.from(DUST_PALETTES);
}

export function normalizeDustMorphology(value) {
  return morphologyName(value);
}

function phenomenonName(morphology) {
  if (morphology === 'galaxy') return 'galaxy-dust';
  if (morphology === 'oort') return 'oort-cloud';
  if (morphology === 'supernovaEjecta') return 'supernova-explosion';
  if (morphology === 'whiteDwarfAccretion') return 'white-dwarf-accretion';
  if (morphology === 'clumpyShell') return 'stellar-dust-shell';
  if (morphology === 'pinwheel') return 'colliding-wind-pinwheel';
  return 'nebular-dust';
}

function paletteName(morphology, requested) {
  if (PALETTES[requested]) return requested;
  if (morphology === 'orion') return 'orion';
  if (morphology === 'crab') return 'crab';
  if (morphology === 'horsehead') return 'dark';
  if (morphology === 'galaxy') return 'galaxy';
  if (morphology === 'oort') return 'oort';
  if (morphology === 'supernovaEjecta') return 'supernova';
  if (morphology === 'whiteDwarfAccretion') return 'accretion';
  if (morphology === 'clumpyShell') return 'redSupergiant';
  if (morphology === 'pinwheel') return 'hotDust';
  return 'webb';
}

function volumeProfileName(morphology, requested) {
  const normalized = String(requested || '').trim().toLowerCase();
  if (VOLUME_PROFILE_CONFIG[normalized]) return normalized;
  if (morphology === 'oort' || morphology === 'galaxy') return 'mist';
  if (morphology === 'horsehead' || morphology === 'pillars' || morphology === 'clumpyShell') return 'dense';
  if (morphology === 'supernovaEjecta' || morphology === 'whiteDwarfAccretion' || morphology === 'pinwheel') return 'emissive';
  return 'balanced';
}

function colorTuple(value) {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)) {
    const maximum = Math.max(value[0], value[1], value[2]);
    const scale = maximum > 1 ? 1 / 255 : 1;
    return [
      clamp(value[0] * scale, 0, 1),
      clamp(value[1] * scale, 0, 1),
      clamp(value[2] * scale, 0, 1)
    ];
  }
  try {
    const color = value && value.isColor ? value : new THREE.Color(value);
    return [color.r, color.g, color.b];
  } catch {
    return null;
  }
}

/**
 * Un color cualquiera (hex, nombre CSS, THREE.Color o terna RGB de 0-1 o
 * 0-255) como '#rrggbb', o null si no se entiende.
 */
export function dustColorToHex(value) {
  const tuple = colorTuple(value);
  if (!tuple) return null;
  // Las ternas son color lineal (las del shader); el hex, sRGB como el de un <input type=color>.
  return '#' + new THREE.Color().setRGB(tuple[0], tuple[1], tuple[2]).getHexString();
}

/** El nombre de paleta que el motor usaría para una forma si no se pide ninguna. */
export function defaultDustPalette(morphology) {
  return paletteName(morphologyName(morphology), null);
}

/** El perfil de volumen que el motor usaría para una forma si no se pide ninguno. */
export function defaultDustVolumeProfile(morphology) {
  return volumeProfileName(morphologyName(morphology), null);
}

function paletteDefinition(morphology, requested, customStops) {
  const fallbackId = paletteName(morphology, requested);
  if (!Array.isArray(customStops) || customStops.length < 2) {
    return { id: fallbackId, stops: PALETTES[fallbackId] };
  }
  const stops = customStops.map(colorTuple).filter(Boolean);
  return stops.length >= 2 ? { id: 'custom', stops } : { id: fallbackId, stops: PALETTES[fallbackId] };
}

function randomNormal(random) {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += random();
  return (sum - 3) * 0.72;
}

/** Ruido de valor 3D determinista (0..1), trilineal con suavizado. */
function latticeValue(ix, iy, iz, salt) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise3(x, y, z, salt) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c00 = lerp(latticeValue(x0, y0, z0, salt), latticeValue(x0 + 1, y0, z0, salt), u);
  const c10 = lerp(latticeValue(x0, y0 + 1, z0, salt), latticeValue(x0 + 1, y0 + 1, z0, salt), u);
  const c01 = lerp(latticeValue(x0, y0, z0 + 1, salt), latticeValue(x0 + 1, y0, z0 + 1, salt), u);
  const c11 = lerp(latticeValue(x0, y0 + 1, z0 + 1, salt), latticeValue(x0 + 1, y0 + 1, z0 + 1, salt), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w);
}

/** Dos octavas de ruido de baja frecuencia, reestiradas a 0..1. */
function clumpField(x, y, z, salt) {
  const f = valueNoise3(x, y, z, salt) * 0.64
    + valueNoise3(x * 2.03 + 17.1, y * 2.03 - 9.4, z * 2.03 + 3.7, salt ^ 0x5bd1e995) * 0.36;
  return clamp((f - 0.5) * 2.4 + 0.5, 0, 1);
}

/**
 * Parámetros propios de las morfologías que los tienen. Se calculan una vez
 * por motor; `writePosition` no lee `options`.
 *
 * clumpyShell (envoltura de una supergigante roja, VLT/VISIR): cáscara entre
 *   shellInner y shellOuter (fracciones del radio) cuya densidad la modula un
 *   ruido 3D de baja frecuencia (clumpScale ciclos por radio): nudos sueltos,
 *   huecos entre ellos y unos pocos penachos radiales (plumeFraction).
 * pinwheel (molinillo de vientos que chocan, WR 104): espiral de Arquímedes
 *   r = spiralPitch · (φ − spiralPhase) / 2π · spiralSense, en el plano XY,
 *   con el paso en unidades de la escena (velocidad del viento × periodo).
 */
function createShape(morphology, options, random, radius) {
  if (morphology === 'clumpyShell') {
    const inner = clamp(numberOr(options.shellInner, 0.55), 0, 0.98);
    const outer = clamp(numberOr(options.shellOuter, 1), inner + 0.01, 1.5);
    const plumeCount = Math.max(0, Math.min(12, Math.floor(numberOr(options.plumeCount, 5))));
    const plumes = [];
    for (let index = 0; index < plumeCount; index++) {
      const pole = random() * 2 - 1;
      const angle = random() * TAU;
      const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
      plumes.push([Math.cos(angle) * equator, pole, Math.sin(angle) * equator, 0.6 + random() * 0.8]);
    }
    return {
      kind: 'clumpyShell',
      inner,
      outer,
      clumpScale: clamp(numberOr(options.clumpScale, 2.2), 0.3, 12),
      clumpContrast: clamp(numberOr(options.clumpContrast, 0.8), 0, 1),
      plumeFraction: plumeCount ? clamp(numberOr(options.plumeFraction, 0.08), 0, 0.5) : 0,
      plumes,
      salt: Math.floor(random() * 4294967296) | 0,
      offset: [random() * 97, random() * 97, random() * 97]
    };
  }
  if (morphology === 'pinwheel') {
    const pitch = positiveOr(options.spiralPitch ?? options.pasoEspiral, radius / 3);
    return {
      kind: 'pinwheel',
      pitch,
      turns: radius / pitch,
      sense: numberOr(options.spiralSense, 1) < 0 ? -1 : 1,
      phase: numberOr(options.spiralPhase, 0),
      inner: clamp(numberOr(options.spiralInner, 0.015), 0, 0.9) * radius,
      armWidth: clamp(numberOr(options.armWidth, 0.075), 0.005, 0.5),
      opening: clamp(numberOr(options.coneOpening, 0.10), 0, 1),
      fade: clamp(numberOr(options.radialFade, 2.2), 0, 20)
    };
  }
  return null;
}

function writeShapedPosition(positions, offset, shape, random, radius, info) {
  let x = 0;
  let y = 0;
  let z = 0;
  if (shape.kind === 'clumpyShell') {
    const span = shape.outer - shape.inner;
    if (shape.plumeFraction > 0 && random() < shape.plumeFraction) {
      // Penacho: sale de la cara interior y se abre hacia fuera.
      const plume = shape.plumes[Math.floor(random() * shape.plumes.length)];
      const along = Math.pow(random(), 0.7);
      const reach = radius * (shape.inner * 0.9 + along * (shape.outer * 1.18 - shape.inner * 0.9));
      const spread = reach * (0.05 + 0.09 * along) * plume[3];
      x = plume[0] * reach + randomNormal(random) * spread;
      y = plume[1] * reach + randomNormal(random) * spread;
      z = plume[2] * reach + randomNormal(random) * spread;
      info.shade = clamp(0.85 - along * 0.55 + (random() - 0.5) * 0.2, 0, 1);
      info.weight = 0.8 + (1 - along) * 0.4;
    } else {
      // Rechazo contra el campo de grumos: se aceptan las muestras en los nudos.
      const threshold = 0.22 + shape.clumpContrast * 0.30;
      let density = 0;
      for (let attempt = 0; attempt < 48; attempt++) {
        const pole = random() * 2 - 1;
        const angle = random() * TAU;
        const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
        const shell = radius * (shape.inner + span * Math.pow(random(), 0.85));
        x = Math.cos(angle) * equator * shell;
        y = pole * shell;
        z = Math.sin(angle) * equator * shell;
        const k = shape.clumpScale / radius;
        density = clumpField(
          x * k + shape.offset[0],
          y * k + shape.offset[1],
          z * k + shape.offset[2],
          shape.salt
        );
        const accept = smoothstep(threshold, threshold + 0.38, density);
        if (random() < 0.04 + 0.96 * accept) break;
      }
      info.shade = clamp(0.15 + density * 0.8 + (random() - 0.5) * 0.25, 0, 1);
      info.weight = 0.55 + density * 0.7;
    }
  } else {
    // Pinwheel: la muestra nace en la raíz y el viento la aleja a ritmo
    // constante, así que su radio es su edad y su ángulo, el de la órbita
    // cuando salió: una espiral de Arquímedes rígida que gira con la binaria.
    const age = Math.pow(random(), 1.25);
    const r = shape.inner + (radius - shape.inner) * age;
    const width = shape.pitch * shape.armWidth * (0.45 + 0.55 * Math.min(1, r / shape.pitch));
    const rr = Math.max(0, r + randomNormal(random) * width);
    const angle = shape.phase + shape.sense * TAU * r / shape.pitch
      + randomNormal(random) * width * 0.6 / Math.max(rr, width);
    x = Math.cos(angle) * rr;
    y = Math.sin(angle) * rr;
    z = randomNormal(random) * (r * shape.opening * 0.5 + width * 0.15);
    info.shade = clamp(1 - age * 1.15 + (random() - 0.5) * 0.18, 0, 1);
    info.weight = 0.30 + 0.70 * Math.exp(-shape.fade * r / radius);
  }
  positions[offset] = x;
  positions[offset + 1] = y;
  positions[offset + 2] = z;
}

function writePosition(positions, offset, morphology, random, radius) {
  let x = 0;
  let y = 0;
  let z = 0;

  if (morphology === 'ring') {
    const theta = random() * TAU;
    const ringRadius = radius * (0.47 + random() * 0.27);
    const width = radius * (0.025 + Math.abs(randomNormal(random)) * 0.055);
    x = Math.cos(theta) * ringRadius + Math.cos(theta) * width;
    y = Math.sin(theta) * ringRadius * (0.76 + random() * 0.18) + Math.sin(theta) * width;
    z = randomNormal(random) * radius * 0.11;
  } else if (morphology === 'bipolar') {
    const sign = random() < 0.5 ? -1 : 1;
    const axial = radius * (0.16 + Math.pow(random(), 0.54) * 0.98);
    const transverse = radius * (0.025 + (1 - axial / (radius * 1.14)) * random() * 0.27);
    const theta = random() * TAU;
    x = Math.cos(theta) * transverse;
    y = sign * axial;
    z = Math.sin(theta) * transverse * 0.78;
  } else if (morphology === 'pillars') {
    // Cuatro nubes independientes, no cuatro cilindros idénticos.
    const layout = PILLAR_LAYOUTS[Math.floor(random() * PILLAR_LAYOUTS.length)];
    const length = Math.pow(random(), 0.62);
    const cap = Math.exp(-Math.pow((length - 0.94) / 0.12, 2));
    const width = radius * layout[3] * (0.42 + 0.72 * (1 - length) + cap * 0.55);
    x = (layout[0] + layout[4] * length) * radius + randomNormal(random) * width;
    y = (layout[1] + length * layout[2]) * radius;
    z = layout[5] * radius + randomNormal(random) * width * (0.82 + random() * 0.60);
  } else if (morphology === 'horsehead') {
    const height = random();
    const neck = radius * (0.10 + 0.15 * Math.sin(height * Math.PI));
    const head = height > 0.54 ? radius * (height - 0.54) * 0.44 : 0;
    x = randomNormal(random) * neck + head;
    y = (-0.92 + height * 1.78) * radius;
    z = randomNormal(random) * neck * 0.74;
  } else if (morphology === 'crab') {
    const theta = random() * TAU;
    const pole = random() * 2 - 1;
    const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
    const shell = radius * (0.26 + Math.pow(random(), 0.42) * 0.74);
    const filament = 1 + 0.10 * randomNormal(random) + 0.08 * Math.sin(theta + pole * 3.11);
    x = Math.cos(theta) * equator * shell * filament;
    y = pole * shell * (0.80 + random() * 0.25);
    z = Math.sin(theta) * equator * shell * filament;
  } else if (morphology === 'galaxy') {
    const theta = random() * TAU;
    if (random() < 0.22) {
      const bulge = radius * Math.pow(random(), 1.8) * 0.34;
      const pole = random() * 2 - 1;
      const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
      x = Math.cos(theta) * equator * bulge;
      y = Math.sin(theta) * equator * bulge;
      z = pole * bulge * 0.72;
    } else {
      const disk = Math.min(1, -Math.log(Math.max(1e-7, 1 - random())) * 0.28) * radius;
      const warp = Math.sin(theta + disk * 2.31 / radius) * disk * 0.035;
      x = Math.cos(theta) * disk * (1 + randomNormal(random) * 0.035);
      y = Math.sin(theta) * disk * (1 + randomNormal(random) * 0.035);
      z = randomNormal(random) * radius * (0.018 + disk / radius * 0.045) + warp;
    }
  } else if (morphology === 'oort') {
    const theta = random() * TAU;
    const pole = random() * 2 - 1;
    const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
    const shell = radius * (0.28 + Math.pow(random(), 0.68) * 0.72);
    x = Math.cos(theta) * equator * shell;
    y = pole * shell;
    z = Math.sin(theta) * equator * shell;
  } else if (morphology === 'supernovaEjecta') {
    const theta = random() * TAU;
    const pole = random() * 2 - 1;
    const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
    const component = random();
    const shell = component < 0.78
      ? radius * (0.66 + Math.pow(random(), 0.46) * 0.34)
      : radius * Math.pow(random(), 0.48) * 0.72;
    const knot = 1 + randomNormal(random) * (component < 0.78 ? 0.055 : 0.12);
    x = Math.cos(theta) * equator * shell * knot;
    y = pole * shell * (0.92 + random() * 0.16) * knot;
    z = Math.sin(theta) * equator * shell * knot;
  } else if (morphology === 'whiteDwarfAccretion') {
    const theta = random() * TAU;
    const disk = radius * (0.12 + Math.pow(random(), 1.34) * 0.88);
    const thickness = radius * (0.006 + 0.028 * disk / radius);
    x = Math.cos(theta) * disk + randomNormal(random) * thickness;
    y = Math.sin(theta) * disk + randomNormal(random) * thickness;
    z = randomNormal(random) * thickness;
  } else if (morphology === 'orion') {
    const component = random();
    if (component < 0.58) {
      // Lámina molecular turbulenta: distribución continua, sin familias radiales.
      x = randomNormal(random) * radius * 0.72;
      y = randomNormal(random) * radius * 0.50;
      z = randomNormal(random) * radius * 0.18;
      x += Math.sin(y * 4.73 / radius + z * 2.17 / radius) * radius * 0.11;
      y += Math.sin(x * 3.19 / radius - z * 5.41 / radius) * radius * 0.08;
    } else if (component < 0.84) {
      // Frente de ionización ancho alrededor de la cavidad del Trapecio.
      const theta = random() * TAU;
      const shell = radius * (0.22 + random() * 0.58);
      x = Math.cos(theta) * shell * 1.26 + randomNormal(random) * radius * 0.09;
      y = Math.sin(theta) * shell * 0.78 + randomNormal(random) * radius * 0.08;
      z = randomNormal(random) * radius * 0.20;
    } else {
      // Nube oscura frontal desplazada.
      x = (-0.48 + randomNormal(random) * 0.22) * radius;
      y = (0.20 + randomNormal(random) * 0.34) * radius;
      z = (0.10 + randomNormal(random) * 0.12) * radius;
    }
  } else if (morphology === 'lion') {
    const component = random();
    const theta = random() * TAU;
    const pole = random() * 2 - 1;
    const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
    if (component < 0.72) {
      // Melena: concha grumosa continua, sin radios ni dientes periódicos.
      const shell = radius * (0.48 + Math.pow(random(), 0.32) * 0.50);
      x = Math.cos(theta) * equator * shell * 1.05 + randomNormal(random) * radius * 0.055;
      y = pole * shell * 0.90 + randomNormal(random) * radius * 0.045;
      z = Math.sin(theta) * equator * shell * 0.72 + randomNormal(random) * radius * 0.055;
    } else {
      // Burbuja interior prolata y desplazada.
      const inner = radius * Math.pow(random(), 0.46) * 0.46;
      x = Math.cos(theta) * equator * inner * 0.74;
      y = pole * inner * 1.12;
      z = Math.sin(theta) * equator * inner * 0.64;
    }
  } else {
    const theta = random() * TAU;
    const pole = random() * 2 - 1;
    const equator = Math.sqrt(Math.max(0, 1 - pole * pole));
    const radial = radius * Math.pow(random(), 0.58);
    x = Math.cos(theta) * equator * radial * 1.18;
    y = pole * radial;
    z = Math.sin(theta) * equator * radial;
  }

  positions[offset] = x;
  positions[offset + 1] = y;
  positions[offset + 2] = z;
}

function writeColor(colors, offset, palette, random, shade = -1) {
  const t = shade >= 0 ? clamp(shade + (random() - 0.5) * 0.12, 0, 1) : random();
  const position = t * (palette.length - 1);
  const first = Math.floor(position);
  const second = Math.min(first + 1, palette.length - 1);
  const blend = position - first;
  colors[offset] = palette[first][0] * (1 - blend) + palette[second][0] * blend;
  colors[offset + 1] = palette[first][1] * (1 - blend) + palette[second][1] * blend;
  colors[offset + 2] = palette[first][2] * (1 - blend) + palette[second][2] * blend;
  return t;
}

function viewportHeight(renderer, vector) {
  if (renderer && typeof renderer.getDrawingBufferSize === 'function') {
    renderer.getDrawingBufferSize(vector);
    if (vector.y > 0) return vector.y;
  }
  if (typeof window !== 'undefined') {
    return Math.max(1, window.innerHeight * Math.min(window.devicePixelRatio || 1, 2));
  }
  return 900;
}

/**
 * Convierte una semilla numérica o textual en una semilla uint32 estable.
 */
export function normalizeSeed(seed = 1) {
  if (Number.isFinite(seed)) return (Math.floor(seed) >>> 0) || 1;
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return (hash >>> 0) || 1;
}

/**
 * Estima el número de granos esféricos que corresponde a una masa de polvo.
 * No se usa como afirmación científica para un escenario: el autor puede
 * suministrar physicalGrainCount directamente cuando disponga de una medida.
 */
export function normalizePhysicalGrainCount(value) {
  if (typeof value === 'bigint') {
    if (value <= 0n) return null;
    const approximate = Number(value);
    return Object.freeze({
      approximate: Number.isFinite(approximate) ? approximate : Number.MAX_VALUE,
      exact: value.toString()
    });
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
    const approximate = Number(trimmed);
    if (!Number.isFinite(approximate) || approximate <= 0) return null;
    return Object.freeze({ approximate, exact: trimmed });
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return Object.freeze({
    approximate: Number(value),
    exact: Number.isSafeInteger(value) ? String(value) : null
  });
}

export function estimatePhysicalGrainCount(options = {}) {
  const dustMassKg = positiveOr(options.dustMassKg, 0)
    || positiveOr(options.dustMassSolar, 0) * SOLAR_MASS_KG
    || positiveOr(options.masaPolvoSolar, 0) * SOLAR_MASS_KG;
  if (!dustMassKg) return null;

  const radiusM = positiveOr(options.grainRadiusMicrons, 0.1) * 1e-6;
  const density = positiveOr(options.grainDensityKgM3, DEFAULT_GRAIN_DENSITY_KG_M3);
  const massPerGrain = 4 / 3 * Math.PI * radiusM * radiusM * radiusM * density;
  const count = dustMassKg / Math.max(massPerGrain, Number.MIN_VALUE);
  return Number.isFinite(count) ? count : Number.MAX_VALUE;
}

/**
 * Decide cuántas muestras puede dibujar el motor. Los niveles 0–4
 * mantienen una presencia de polvo incluso en GPU modesta, sin crear millones
 * de entidades JavaScript ni forzar el presupuesto de relleno.
 */
export function resolveDustBudget(options = {}) {
  const explicitQuality = options.quality ?? options.nivelGPU ?? options.calidad;
  const gpuProfile = detectGpuProfile(options.renderer, {
    overrideTier: Number.isFinite(explicitQuality) ? explicitQuality : undefined,
    fallbackTier: options.fallbackTier,
    mobile: options.mobile,
    userAgent: options.userAgent,
    deviceMemoryGB: options.deviceMemoryGB
  });
  let quality = gpuProfile.tier;
  const capabilities = options.renderer && options.renderer.capabilities;
  if (capabilities && Number.isFinite(capabilities.maxAttributes) && capabilities.maxAttributes < 6) {
    quality = 0;
  }
  if (capabilities && capabilities.isWebGL2 === false) quality = Math.min(quality, 1);
  const mobile = options.mobile === true || gpuProfile.mobile === true;
  if (mobile && options.allowHighOnMobile !== true) quality = Math.min(quality, 1);

  const requestedSamples = positiveOr(options.sampleCount ?? options.muestrasGPU, 0)
    || DUST_SAMPLE_BUDGETS[quality];
  const maximumSamples = positiveOr(options.maximumSamples ?? options.maxMuestras, requestedSamples);
  const sampleCount = Math.max(1, Math.floor(Math.min(
    requestedSamples,
    maximumSamples,
    MAX_GPU_SAMPLE_COUNT
  )));

  const suppliedPhysicalCount = normalizePhysicalGrainCount(
    options.physicalGrainCount ?? options.granosFisicos
  );
  const estimatedPhysicalCount = estimatePhysicalGrainCount(options);
  const tracksPhysicalPopulation = options.trackPhysicalPopulation !== false;
  const physicalGrainCount = !tracksPhysicalPopulation ? null
    : (suppliedPhysicalCount?.approximate || estimatedPhysicalCount || DEFAULT_REPRESENTED_GRAIN_COUNT);
  const physicalGrainCountExact = !tracksPhysicalPopulation ? null
    : (suppliedPhysicalCount?.exact || null);
  const physicalGrainCountSource = !tracksPhysicalPopulation ? 'disabled'
    : (suppliedPhysicalCount ? 'provided' : (estimatedPhysicalCount ? 'mass-estimate' : 'unspecified'));
  const bytesPerSample = 9 * Float32Array.BYTES_PER_ELEMENT;

  return Object.freeze({
    quality,
    sampleCount,
    gpuProfile,
    hardMaximumSamples: MAX_GPU_SAMPLE_COUNT,
    bytesPerSample,
    estimatedAttributeBytes: sampleCount * bytesPerSample,
    physicalGrainCount,
    physicalGrainCountExact,
    physicalGrainCountSource,
    grainsPerSample: physicalGrainCount ? physicalGrainCount / sampleCount : null,
    isMonteCarloRepresentation: true
  });
}

/**
 * Crea un motor de polvo con una sola llamada de dibujo. Las unidades de
 * radius son las de la escena del consumidor, no unidades astronómicas.
 */
export function createNebulaDustEngine(options = {}) {
  const budget = resolveDustBudget(options);
  const sampleCount = budget.sampleCount;
  const seed = normalizeSeed(options.seed ?? options.semilla ?? 'nebula-dust');
  const random = (() => {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), 1 | value);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const morphology = morphologyName(options.morphology ?? options.forma);
  const paletteProfile = paletteDefinition(
    morphology,
    options.palette,
    options.colorStops ?? options.colors ?? options.colores
  );
  let paletteId = paletteProfile.id;
  let palette = paletteProfile.stops;
  const volumeProfileId = volumeProfileName(
    morphology,
    options.volumeProfile ?? options.perfilVolumen
  );
  const volumeProfile = VOLUME_PROFILE_CONFIG[volumeProfileId];
  const radius = positiveOr(options.radius ?? options.radio, 1);
  let currentOpacity = clamp(numberOr(options.opacity ?? options.opacidad, 0.86), 0, 1);
  let currentParticleScale = positiveOr(options.particleScale ?? options.escalaMota, 1);
  let currentMotion = clamp(numberOr(options.motion, 0), 0, 1);
  let currentFlowSpeed = clamp(numberOr(options.flowSpeed, 0), 0, 8);
  let currentEvolution = clamp(numberOr(options.evolution ?? options.explosionProgress, 1), 0, 1);
  let currentEvolutionRate = clamp(numberOr(options.evolutionRate, 0), -4, 4);

  const positions = new Float32Array(sampleCount * 3);
  const colors = new Float32Array(sampleCount * 3);
  const sizes = new Float32Array(sampleCount);
  const alpha = new Float32Array(sampleCount);
  const alphaWeights = new Float32Array(sampleCount);
  const phases = new Float32Array(sampleCount);
  // Posición de cada mota en la paleta (0..1): con ella se recolorea sin rehacer la nube.
  // En doble precisión (solo CPU): así recolorear da los mismos bits que generar con esa paleta.
  const colorT = new Float64Array(sampleCount);

  const shape = createShape(morphology, options, random, radius);
  const sampleInfo = { shade: -1, weight: 1 };
  for (let index = 0; index < sampleCount; index++) {
    const offset = index * 3;
    sampleInfo.shade = -1;
    sampleInfo.weight = 1;
    if (shape) writeShapedPosition(positions, offset, shape, random, radius, sampleInfo);
    else writePosition(positions, offset, morphology, random, radius);
    colorT[index] = writeColor(colors, offset, palette, random, sampleInfo.shade);
    sizes[index] = radius * (
      volumeProfile.sizeMin
      + Math.pow(random(), volumeProfile.sizePower) * volumeProfile.sizeSpan
    );
    alphaWeights[index] = (volumeProfile.alphaMin
      + Math.pow(random(), volumeProfile.alphaPower) * volumeProfile.alphaSpan) * sampleInfo.weight;
    alpha[index] = currentOpacity * alphaWeights[index];
    phases[index] = random() * TAU;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 2.2);
  geometry.setDrawRange(0, sampleCount);

  const uniforms = {
    uHeightPx: { value: 900 },
    uParticleScale: { value: currentParticleScale },
    uLodPointScale: { value: 1 },
    uLodAlphaScale: { value: 1 },
    uMaxPointSize: { value: clamp(numberOr(options.maxPointSize, 3.8), 0.5, 16) },
    uTime: { value: 0 },
    uMotion: { value: currentMotion },
    uMorphologyMode: { value: MORPHOLOGY_SHADER_MODES[morphology] || 0 },
    uRadius: { value: radius },
    uEvolution: { value: currentEvolution },
    uFlowSpeed: { value: currentFlowSpeed },
    uResolutionScale: { value: clamp(numberOr(options.resolutionScale, 1), 0.05, 4) },
    // Apagado por defecto: medido con bench/banco.py, ahorra un 10-20 % de GPU
    // pero añade grano en las zonas densas (p99 de 10-12 niveles en los
    // Pilares, 25 en la supernova con 4 M). Se enciende con minPointPx: 0.5.
    uMinPointPx: { value: clamp(numberOr(options.minPointPx, 0), 0, 4) },
    uCullFloor: { value: clamp(numberOr(options.subpixelKeepFloor, DEFAULT_SUBPIXEL_KEEP_FLOOR), 0.02, 1) },
    uDiscardAlpha: { value: 0.002 },
    // Vector4() nace con w = 1: los toques tienen que nacer apagados (w = 0).
    uTouch: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
    uTouchRadius: { value: new THREE.Vector4(1, 1, 1, 1) },
    uTint: { value: new THREE.Color(1, 1, 1) }
  };
  const initialTint = options.tint ?? options.tinte;
  if (initialTint !== undefined && initialTint !== null) {
    const tuple = colorTuple(initialTint);
    if (tuple) uniforms.uTint.value.setRGB(tuple[0], tuple[1], tuple[2]);
  }
  // Segundos en que un toque pierde el 63 % de su fuerza.
  let touchDecay = clamp(numberOr(options.touchDecay, 0.6), 0.02, 30);
  const blending = isAdditive(options)
    ? THREE.AdditiveBlending
    : THREE.NormalBlending;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: options.depthTest !== false,
    depthWrite: false,
    blending
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Nebula dust samples';
  points.renderOrder = numberOr(options.renderOrder, 1);
  points.frustumCulled = options.frustumCulled !== false;

  const object3d = new THREE.Group();
  object3d.name = options.name || 'Nebula dust engine';
  object3d.add(points);

  const metadata = Object.freeze({
    engine: 'nebula-dust-engine',
    initialPalette: paletteId,
    version: ENGINE_VERSION,
    phenomenon: phenomenonName(morphology),
    morphology,
    palette: paletteId,
    colorStopCount: palette.length,
    volumeProfile: volumeProfileId,
    blending: blending === THREE.AdditiveBlending ? 'additive' : 'normal',
    seed,
    radius,
    sampleCount,
    quality: budget.quality,
    gpuProfile: budget.gpuProfile,
    bytesPerSample: budget.bytesPerSample,
    estimatedAttributeBytes: budget.estimatedAttributeBytes,
    physicalGrainCount: budget.physicalGrainCount,
    physicalGrainCountExact: budget.physicalGrainCountExact,
    physicalGrainCountSource: budget.physicalGrainCountSource,
    grainsPerSample: budget.grainsPerSample,
    isMonteCarloRepresentation: true,
    initialEvolution: currentEvolution,
    initialEvolutionRate: currentEvolutionRate,
    shape: shape ? Object.freeze(Object.fromEntries(Object.entries(shape)
      .filter(([key]) => key !== 'salt' && key !== 'offset' && key !== 'plumes'))) : null,
    depthModel: 'normal-alpha-blending with depth test; no always-on-top particle layer'
  });
  object3d.userData.nebulaDust = metadata;

  const center = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const drawingBuffer = new THREE.Vector2();
  const nearLod = positiveOr(options.nearLodDistance, 3);
  const farLod = Math.max(nearLod + 0.01, positiveOr(options.farLodDistance, 28));
  const minimumLod = clamp(numberOr(options.minimumLod, 0.10), 0.01, 1);
  const adaptiveLod = createAdaptiveLodController({
    enabled: options.adaptive !== false,
    targetFrameMs: options.targetFrameMs,
    gpuBudgetMs: options.gpuBudgetMs,
    minimumFraction: options.minimumPerformanceLod ?? minimumLod
  });
  // Techo de motas dibujadas: nunca más que esto aunque la GPU tenga margen.
  let maxVisibleSamples = Math.max(1, Math.floor(positiveOr(options.maxVisibleSamples, sampleCount)));
  const suppliedGpuTimer = options.gpuTimer || null;
  const gpuTimer = suppliedGpuTimer
    || (options.measureGpuTime === true ? createGpuTimerQuery(options.renderer) : null);
  const ownsGpuTimer = Boolean(gpuTimer && !suppliedGpuTimer);
  const preserveApparentDensity = options.preserveApparentDensity !== false;
  // Luz total fija, la de tantas motas como esta referencia: con 16 k o con
  // 4 M la nube brilla igual (más fina o más gruesa). Sin ella la luz crece
  // con sampleCount, como siempre.
  const lightReferenceSamples = positiveOr(options.lightReferenceSamples, 0);
  const lightTotalSamples = lightReferenceSamples || sampleCount;
  let elapsed = 0;
  let visibleFraction = 1;
  let visibleSamples = sampleCount;
  let lodPointScale = 1;
  let lodAlphaScale = 1;
  let reportedGpuFrameMs = null;
  let disposed = false;

  function update(camera, deltaSeconds = 0) {
    if (disposed) return 0;
    const frameDelta = clamp(numberOr(deltaSeconds, 0), 0, 0.1);
    elapsed += frameDelta;
    decayTouches(frameDelta);
    currentEvolution = clamp(currentEvolution + frameDelta * currentEvolutionRate, 0, 1);
    uniforms.uTime.value = elapsed;
    uniforms.uEvolution.value = currentEvolution;
    uniforms.uHeightPx.value = viewportHeight(options.renderer, drawingBuffer);

    let lodFraction = 1;
    if (camera && (camera.isCamera || camera.position)) {
      object3d.getWorldPosition(center);
      if (typeof camera.getWorldPosition === 'function') {
        camera.getWorldPosition(cameraPosition);
      } else {
        cameraPosition.copy(camera.position);
      }
      const normalizedDistance = center.distanceTo(cameraPosition) / Math.max(radius, 1e-6);
      const fade = smoothstep(nearLod, farLod, normalizedDistance);
      lodFraction = 1 + (minimumLod - 1) * fade;
    }
    let measuredGpuMs = reportedGpuFrameMs;
    reportedGpuFrameMs = null;
    if (gpuTimer && typeof gpuTimer.poll === 'function') {
      const polledGpuMs = gpuTimer.poll();
      if (Number.isFinite(polledGpuMs)) measuredGpuMs = polledGpuMs;
    }
    const performanceFraction = adaptiveLod.update(deltaSeconds, measuredGpuMs);
    lodFraction = Math.min(lodFraction, performanceFraction, maxVisibleSamples / sampleCount);
    visibleSamples = Math.max(1, Math.min(sampleCount, Math.round(sampleCount * lodFraction)));
    visibleFraction = visibleSamples / sampleCount;
    geometry.setDrawRange(0, visibleSamples);

    if (preserveApparentDensity) {
      // Las motas dibujadas son una submuestra al azar (el orden de creación
      // es aleatorio): cada una lleva la luz de sampleCount / visibleSamples.
      // El shader reparte esa luz entre alfa y área, así que la luz total no
      // cambia con la fracción (antes a^0,84: con 1/4 se perdía un 20 %).
      const aggregation = lightTotalSamples / visibleSamples;
      lodPointScale = clamp(Math.pow(aggregation, 0.24), 1, 2.6);
      lodAlphaScale = aggregation;
    } else {
      lodPointScale = 1;
      lodAlphaScale = lightTotalSamples / sampleCount;
    }
    uniforms.uLodPointScale.value = lodPointScale;
    uniforms.uLodAlphaScale.value = lodAlphaScale;
    // El descarte de fragmentos tenues baja con la luz de cada mota.
    uniforms.uDiscardAlpha.value = 0.002 * Math.min(1, lodAlphaScale);
    points.visible = currentOpacity > 0 && lodFraction > 0.001;
    return lodFraction;
  }

  function reportGpuFrameTime(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds >= 250) return false;
    reportedGpuFrameMs = milliseconds;
    return true;
  }

  function beginGpuFrame() {
    return Boolean(gpuTimer && typeof gpuTimer.begin === 'function' && gpuTimer.begin());
  }

  function endGpuFrame() {
    return Boolean(gpuTimer && typeof gpuTimer.end === 'function' && gpuTimer.end());
  }

  function setOpacity(value) {
    const target = clamp(numberOr(value, currentOpacity), 0, 1);
    currentOpacity = target;
    for (let index = 0; index < sampleCount; index++) {
      alpha[index] = target * alphaWeights[index];
    }
    geometry.getAttribute('aAlpha').needsUpdate = true;
    points.visible = currentOpacity > 0 && visibleFraction > 0.001;
    return currentOpacity;
  }

  function setEvolution(value) {
    currentEvolution = clamp(numberOr(value, currentEvolution), 0, 1);
    uniforms.uEvolution.value = currentEvolution;
    return currentEvolution;
  }

  function setEvolutionRate(value) {
    currentEvolutionRate = clamp(numberOr(value, currentEvolutionRate), -4, 4);
    return currentEvolutionRate;
  }

  function restartEvolution(value = 0) {
    elapsed = 0;
    uniforms.uTime.value = 0;
    return setEvolution(value);
  }

  function setMotion(value) {
    currentMotion = clamp(numberOr(value, currentMotion), 0, 1);
    uniforms.uMotion.value = currentMotion;
    return currentMotion;
  }

  function setFlowSpeed(value) {
    currentFlowSpeed = clamp(numberOr(value, currentFlowSpeed), 0, 8);
    uniforms.uFlowSpeed.value = currentFlowSpeed;
    return currentFlowSpeed;
  }

  function setParticleScale(value) {
    currentParticleScale = positiveOr(value, currentParticleScale);
    uniforms.uParticleScale.value = currentParticleScale;
    return currentParticleScale;
  }

  /** Tope de tamaño de una mota, en píxeles de pantalla (limita el sobredibujado de cerca). */
  function setMaxPointSize(value) {
    uniforms.uMaxPointSize.value = clamp(numberOr(value, uniforms.uMaxPointSize.value), 0.5, 16);
    return uniforms.uMaxPointSize.value;
  }

  /**
   * Escala del búfer en que se dibuja respecto a la pantalla: 0,5 si el
   * consumidor dibuja a media resolución. Los tamaños y la luz se corrigen
   * para que la imagen reescalada se vea igual.
   */
  function setResolutionScale(value) {
    uniforms.uResolutionScale.value = clamp(numberOr(value, uniforms.uResolutionScale.value), 0.05, 4);
    return uniforms.uResolutionScale.value;
  }

  /** Umbral (px del búfer) bajo el que las motas se sortean conservando la luz; 0 lo apaga. */
  function setMinPointPx(value) {
    uniforms.uMinPointPx.value = clamp(numberOr(value, uniforms.uMinPointPx.value), 0, 4);
    return uniforms.uMinPointPx.value;
  }

  /** Techo de motas dibujadas por fotograma (la luz total se conserva). */
  function setMaxVisibleSamples(value) {
    maxVisibleSamples = Math.max(1, Math.floor(positiveOr(value, sampleCount)));
    return maxVisibleSamples;
  }

  /**
   * Cambia la paleta sin rehacer la nube: cada mota conserva su posición en
   * la paleta (la sombra de su forma), así que el resultado es idéntico al de
   * generarla con esa paleta. Acepta un nombre de DUST_PALETTES o una lista de
   * dos o más colores (hex, CSS, THREE.Color o ternas RGB).
   */
  function setPalette(value) {
    if (disposed) return paletteId;
    if (!Array.isArray(value) && value && !PALETTES[String(value).trim()]) return paletteId;
    const next = Array.isArray(value)
      ? paletteDefinition(morphology, null, value)
      : paletteDefinition(morphology, String(value || '').trim(), null);
    if (Array.isArray(value) && next.id !== 'custom') return paletteId;
    paletteId = next.id;
    palette = next.stops;
    const last = palette.length - 1;
    for (let index = 0; index < sampleCount; index++) {
      const position = colorT[index] * last;
      const first = Math.floor(position);
      const second = Math.min(first + 1, last);
      const blend = position - first;
      const offset = index * 3;
      colors[offset] = palette[first][0] * (1 - blend) + palette[second][0] * blend;
      colors[offset + 1] = palette[first][1] * (1 - blend) + palette[second][1] * blend;
      colors[offset + 2] = palette[first][2] * (1 - blend) + palette[second][2] * blend;
    }
    geometry.getAttribute('aColor').needsUpdate = true;
    return paletteId;
  }

  /** Paradas de color en uso, como ternas RGB de 0 a 1. */
  function getPaletteStops() {
    return palette.map((stop) => Array.from(stop));
  }

  /** Tinte que multiplica el color de todas las motas (blanco = sin tinte). */
  function setTint(value) {
    const tuple = colorTuple(value);
    if (tuple) uniforms.uTint.value.setRGB(tuple[0], tuple[1], tuple[2]);
    return uniforms.uTint.value.clone();
  }

  /** 'additive' (luz que se suma) o 'normal' (polvo que tapa lo de detrás). */
  function setBlending(value) {
    const additive = value === 'additive' || value === true || value === THREE.AdditiveBlending;
    const target = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (material.blending !== target) {
      material.blending = target;
      material.needsUpdate = true;
    }
    return additive ? 'additive' : 'normal';
  }

  /** Orden de dibujo entre objetos transparentes (Object3D.renderOrder). */
  function setRenderOrder(value) {
    if (Number.isFinite(value)) points.renderOrder = value;
    return points.renderOrder;
  }

  /**
   * «Tocar» la nube: un empuje local que aparta las motas de `localPoint`
   * (en el espacio de object3d) con caída gaussiana de radio `radius` y que
   * se desvanece solo (touchDecay). Todo ocurre en el shader: no se toca
   * ningún búfer. Hay cuatro toques a la vez; uno nuevo sustituye al más
   * débil. Devuelve el hueco usado, o -1 si no se aplicó.
   */
  function touch(localPoint, radius = radiusDefaultTouch(), strength = 0.35) {
    if (disposed || !localPoint) return -1;
    const x = Array.isArray(localPoint) ? localPoint[0] : localPoint.x;
    const y = Array.isArray(localPoint) ? localPoint[1] : localPoint.y;
    const z = Array.isArray(localPoint) ? localPoint[2] : localPoint.z;
    const r = positiveOr(radius, radiusDefaultTouch());
    const f = clamp(numberOr(strength, 0.35), 0, 4);
    if (![x, y, z].every(Number.isFinite) || f <= 0) return -1;
    const slots = uniforms.uTouch.value;
    let slot = 0;
    for (let index = 1; index < slots.length; index++) {
      if (slots[index].w < slots[slot].w) slot = index;
    }
    slots[slot].set(x, y, z, f);
    uniforms.uTouchRadius.value.setComponent(slot, r);
    return slot;
  }

  function radiusDefaultTouch() {
    return radius * 0.25;
  }

  function clearTouches() {
    for (const slot of uniforms.uTouch.value) slot.set(0, 0, 0, 0);
  }

  function decayTouches(seconds) {
    if (!(seconds > 0)) return;
    const factor = Math.exp(-seconds / touchDecay);
    for (const slot of uniforms.uTouch.value) {
      if (slot.w <= 0) continue;
      slot.w *= factor;
      if (slot.w < 0.002) slot.w = 0;
    }
  }

  function activeTouches() {
    let count = 0;
    for (const slot of uniforms.uTouch.value) if (slot.w > 0) count++;
    return count;
  }

  function setTouchDecay(value) {
    touchDecay = clamp(numberOr(value, touchDecay), 0.02, 30);
    return touchDecay;
  }

  /**
   * ¿Cambia la imagen con el tiempo aunque no se mueva la cámara? Si no, el
   * consumidor puede dejar de dibujar hasta que cambie algo.
   */
  function isAnimated() {
    if (disposed || !points.visible) return false;
    if (activeTouches() > 0) return true;
    if (currentMotion > 0) return true;
    const mode = uniforms.uMorphologyMode.value;
    if (currentFlowSpeed > 0 && (mode === 1 || mode === 2 || mode === 4)) return true;
    if (currentEvolutionRate > 0 && currentEvolution < 1) return true;
    if (currentEvolutionRate < 0 && currentEvolution > 0) return true;
    return false;
  }

  /**
   * Réplica en CPU de las cuentas del shader sobre una muestra de motas:
   * cuántas llegan a pintarse tras el sorteo de las pequeñas y cuánta luz
   * (alfa × área, en px² de pantalla) ponen, frente a la que pondrían todas
   * sin LOD ni sorteo. Para el contador de la demo y para las pruebas; no
   * incluye la ondulación del shader (desplazamientos de un tamaño de mota).
   */
  const probeMatrix = new THREE.Matrix4();
  const probeVector = new THREE.Vector3();
  function probeFrame(camera, probeCount = 4096) {
    if (disposed || !camera || !camera.matrixWorldInverse) {
      return { drawnSamples: 0, light: 0, referenceLight: 0 };
    }
    object3d.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    probeMatrix.multiplyMatrices(camera.matrixWorldInverse, points.matrixWorld);
    const s = Math.max(uniforms.uResolutionScale.value, 0.05);
    const heightPx = uniforms.uHeightPx.value;
    const maxPx = uniforms.uMaxPointSize.value;
    const minPx = uniforms.uMinPointPx.value;
    const floor = uniforms.uCullFloor.value;
    const step = Math.max(1, Math.floor(sampleCount / Math.max(1, probeCount)));
    let light = 0;
    let referenceLight = 0;
    let drawn = 0;
    let probed = 0;
    let probedDrawn = 0;
    for (let index = 0; index < sampleCount; index += step) {
      probeVector.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]).applyMatrix4(probeMatrix);
      const distance = Math.max(-probeVector.z, 0.0001);
      const pxScreen = sizes[index] * uniforms.uParticleScale.value * heightPx / (distance * s);
      const pxRef = clamp(pxScreen, 0.35, maxPx);
      const areaRef = Math.max(pxRef, 1) ** 2;
      const aRef = Math.min(alpha[index], 0.98);
      referenceLight += aRef * areaRef;
      probed++;
      if (index >= visibleSamples) continue;
      probedDrawn++;
      const raw = pxScreen * lodPointScale * s;
      let px = clamp(raw, 0.35, maxPx * s);
      let keep = 1;
      if (minPx > 0 && raw < minPx) keep = Math.max(floor, (raw / minPx) ** 2);
      const lum = alpha[index] * lodAlphaScale * areaRef / keep;
      let side = Math.max(px, 1) / s;
      if (lum / 0.9 > side * side) {
        side = Math.min(Math.sqrt(lum / 0.9), Math.max(maxPx, side));
        px = Math.max(px, side * s);
      }
      const a = Math.min(lum / (side * side), 0.98);
      // Esperanza del sorteo: se dibuja con probabilidad keep.
      light += keep * a * side * side;
      drawn += keep;
    }
    const scale = probed ? sampleCount / probed : 0;
    referenceLight *= lightTotalSamples / sampleCount;
    return {
      drawnSamples: Math.round(drawn * scale),
      sentSamples: visibleSamples,
      light: light * scale,
      referenceLight: referenceLight * scale,
      probedSamples: probed,
      probedSent: probedDrawn
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    object3d.remove(points);
    geometry.dispose();
    material.dispose();
    if (ownsGpuTimer && typeof gpuTimer.dispose === 'function') gpuTimer.dispose();
  }

  function getStatus() {
    const adaptive = adaptiveLod.snapshot();
    return Object.freeze({
      disposed,
      visibleFraction,
      visibleSamplesApprox: visibleSamples,
      representedGrainsPerVisibleSample: budget.physicalGrainCount
        ? budget.physicalGrainCount / visibleSamples
        : null,
      lodPointScale,
      lodAlphaScale,
      lightReferenceSamples: lightReferenceSamples || null,
      evolution: currentEvolution,
      evolutionRate: currentEvolutionRate,
      motion: currentMotion,
      flowSpeed: currentFlowSpeed,
      particleScale: currentParticleScale,
      maxPointSize: uniforms.uMaxPointSize.value,
      resolutionScale: uniforms.uResolutionScale.value,
      minPointPx: uniforms.uMinPointPx.value,
      maxVisibleSamples,
      palette: paletteId,
      blending: material.blending === THREE.AdditiveBlending ? 'additive' : 'normal',
      tint: '#' + uniforms.uTint.value.getHexString(),
      renderOrder: points.renderOrder,
      activeTouches: activeTouches(),
      touchDecay,
      animated: isAnimated(),
      adaptive,
      gpuTimer: gpuTimer && typeof gpuTimer.snapshot === 'function' ? gpuTimer.snapshot() : null,
      gpuProfile: budget.gpuProfile
    });
  }

  return Object.freeze({
    object3d,
    points,
    material,
    metadata,
    update,
    actualiza: update,
    reportGpuFrameTime,
    beginGpuFrame,
    endGpuFrame,
    setOpacity,
    setEvolution,
    setEvolutionRate,
    restartEvolution,
    setMotion,
    setFlowSpeed,
    setParticleScale,
    setMaxPointSize,
    setResolutionScale,
    setMinPointPx,
    setMaxVisibleSamples,
    setPalette,
    getPaletteStops,
    setTint,
    setBlending,
    setRenderOrder,
    touch,
    clearTouches,
    setTouchDecay,
    isAnimated,
    probeFrame,
    getStatus,
    dispose,
    libera: dispose
  });
}

export default createNebulaDustEngine;
