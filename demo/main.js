import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  listNebulaDustPresets,
  nebulaDustOptions,
  resolveNebulaDustPresetName
} from '../src/presets.js';
import {
  getDustPalette, dustColorToHex, DUST_MORPHOLOGIES, DUST_PALETTES, DUST_VOLUME_PROFILES, DUST_SAMPLE_BUDGETS,
  MAX_GPU_SAMPLE_COUNT
} from '../src/index.js';
import {
  createDustSystem, decodeDustScene, encodeDustScene, normalizeDustGroupSpec, projectToViewPlane, randomDustSeed
} from '../src/system.js';
import { DUST_EXAMPLE_SCENES } from '../src/examples.js';

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance'
});
const DPR_BASE = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR_BASE);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x03030a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/* Exposición de la pasada de salida. Con 1,45 el pie de ACES se comía el polvo
 * tenue (por debajo de ~0,0015 lineal sale 0): medido con bench/lienzo8.py, con
 * 8 ningún objeto sale negro y apenas se satura nada. */
const EXPOSICION = 8;
renderer.toneMappingExposure = EXPOSICION;
document.body.appendChild(renderer.domElement);

/* LA NUBE SE ACUMULA EN HALFFLOAT Y SE COMPONE AL LIENZO (28/9/2026)
 * El lienzo es de 8 bits y en lineal: una mota de alfa 0,004 suma menos de
 * medio nivel, se redondea a 0 y 4 millones de motas no pintaban nada (el
 * negro de producción). Y un ShaderMaterial no aplica ni el tonemap ni el
 * sRGB. Como en la app (EffectComposer): se dibuja en un búfer HalfFloat y
 * una pasada de salida aplica exposición + ACES + sRGB (OutputPass). */
const bufer = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const salida = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  name: 'Salida del polvo',
  uniforms: { tDiffuse: { value: bufer.texture } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse;',
    'varying vec2 vUv;',
    'void main() {',
    '  gl_FragColor = texture2D(tDiffuse, vUv);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n'),
  depthTest: false,
  depthWrite: false
}));
salida.frustumCulled = false;
const escenaSalida = new THREE.Scene();
escenaSalida.add(salida);
const camSalida = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const tamBufer = new THREE.Vector2();
function ajustaBufer() {
  renderer.getDrawingBufferSize(tamBufer);
  bufer.setSize(Math.max(1, tamBufer.x), Math.max(1, tamBufer.y));
}
ajustaBufer();
/* Luz de referencia: cada grupo brilla igual con 16 k que con 4 M motas (la de
 * 786 432, el nivel alto de la app); más motas lo hacen más fino, no más claro. */
const LUZ_REFERENCIA = DUST_SAMPLE_BUDGETS[3];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.01, 100);
/* El gizmo se dibuja aparte, encima y sin tonemap: dentro del búfer saldría quemado. */
const escenaGizmo = new THREE.Scene();

/* ------------------------------------------------------------ textos */
const DEMOS = {
  orion: ['Orión (M42)', 'Nebulosa de emisión: gas ionizado por el Trapecio y polvo turbulento sin estructura radial.'],
  eaglePillars: ['Pilares de la Creación (M16)', 'Cuatro columnas de polvo denso, cada una con su altura, anchura e inclinación.'],
  horsehead: ['Cabeza de Caballo (B33)', 'Nube oscura: el polvo tapa lo que tiene detrás en vez de brillar.'],
  crab: ['Cangrejo (M1)', 'Resto de supernova: filamentos que se abren desde el púlsar central.'],
  ring: ['Anillo (M57)', 'Nebulosa planetaria vista casi de frente: un toro de gas ionizado.'],
  helix: ['Hélice (NGC 7293)', 'La planetaria más cercana, con la paleta del James Webb.'],
  lion: ['León (NGC 2392)', 'Campo continuo y turbulento, sin familias de radios periódicos.'],
  interstellarDust: ['Polvo interestelar', 'Polvo difuso con una oscilación suave.'],
  galaxyDust: ['Polvo galáctico', 'Brazos de polvo que giran alrededor del centro.'],
  oortCloud: ['Nube de Oort', 'Cascarón esférico de cometas lejanos, en órbita lenta.'],
  supernovaExplosion: ['Explosión de supernova', 'La eyecta nace en el centro y se abre; se reinicia sola al terminar.'],
  whiteDwarfAccretion: ['Acreción en una enana blanca', 'Materia de la compañera que cae en espiral hacia la enana.'],
  redSupergiantShell: ['Envoltura de Betelgeuse', 'Polvo de una supergigante roja: nudos sueltos y penachos (VLT/VISIR).'],
  collidingWindPinwheel: ['Molinillo de WR 104', 'Dos vientos que chocan forman una espiral de polvo caliente (Keck).']
};
const GRUPOS_PRESET = [
  ['Nebulosas', ['orion', 'eaglePillars', 'horsehead', 'crab', 'ring', 'helix', 'lion']],
  ['Polvo y fenómenos', ['interstellarDust', 'galaxyDust', 'oortCloud', 'supernovaExplosion', 'whiteDwarfAccretion']],
  ['Polvo de estrellas', ['redSupergiantShell', 'collidingWindPinwheel']]
];
const ESCENAS = {
  twinNebula: ['Nebulosa con dos grupos', 'Una nebulosa de emisión y, delante, una lámina de polvo oscuro que la tapa.'],
  collision: ['Choque con restos', 'Dos grumos que chocan y la nube de restos y filamentos que sale del impacto.'],
  diskRingHalo: ['Disco con anillo y halo', 'Un disco de acreción, un anillo inclinado y un halo tenue alrededor.']
};
const ALIAS_ESCENA = { nebulosa: 'twinNebula', choque: 'collision', disco: 'diskRingHalo' };
const FORMAS = {
  diffuse: 'Difusa', orion: 'Orión', pillars: 'Pilares', horsehead: 'Cabeza de Caballo', crab: 'Filamentos (Cangrejo)',
  ring: 'Anillo', bipolar: 'Bipolar', lion: 'León', galaxy: 'Espiral galáctica', oort: 'Cascarón (Oort)',
  supernovaEjecta: 'Eyecta de supernova', whiteDwarfAccretion: 'Disco de acreción',
  clumpyShell: 'Cáscara grumosa', pinwheel: 'Molinillo'
};
const PALETAS = {
  webb: 'James Webb', orion: 'Orión', ionized: 'Gas ionizado', crab: 'Cangrejo', dark: 'Nube oscura',
  galaxy: 'Galaxia', oort: 'Hielo (Oort)', supernova: 'Supernova', accretion: 'Acreción',
  redSupergiant: 'Supergigante roja', hotDust: 'Polvo caliente'
};
const PERFILES = { mist: 'Neblina', balanced: 'Equilibrado', dense: 'Denso', emissive: 'Emisivo' };
const MOTAS = [
  ['auto', 'Según la tarjeta'], ['16384', '16 384'], ['65536', '65 536'], ['262144', '262 144'],
  ['500000', 'medio millón'], ['1000000', '1 millón'], ['2000000', '2 millones'], ['4000000', '4 millones']
];
const GRANOS = [
  ['1e6', 'un millón (10⁶)'], ['1e9', 'mil millones (10⁹)'], ['1e12', 'un billón (10¹²)'],
  ['1e15', 'mil billones (10¹⁵)'], ['1e18', 'un trillón (10¹⁸)'], ['1e21', 'mil trillones (10²¹)'],
  ['1e24', 'un cuatrillón (10²⁴)'], ['1e30', 'un quintillón (10³⁰)'], ['1e36', 'un sextillón (10³⁶)'],
  ['masa', '0,03 masas solares de polvo']
];
const AYUDA = {
  girar: 'Arrastra para girar la vista; toca un grupo para elegirlo. Rueda o pellizco: acercar.',
  sembrar: 'Toca la escena para sembrar un grupo nuevo en ese punto.',
  mover: 'Arrastra el gizmo para mover, girar o escalar el grupo elegido; toca otro grupo para cambiar.',
  tocar: 'Arrastra sobre el polvo para empujarlo; vuelve solo a su sitio.'
};
const MOVIL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const RADIO_OBJETO = 1.12;

/* ------------------------------------------------------------ controles */
const $ = (id) => document.getElementById(id);
const opcion = (sel, valor, texto, padre) => {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  (padre || sel).appendChild(o);
  return o;
};
const NOMBRES = listNebulaDustPresets();
const presetSelect = $('preset');
const siembraSelect = $('siembra');
const puestos = new Set();
for (const [titulo, claves] of GRUPOS_PRESET) {
  const og = document.createElement('optgroup');
  og.label = titulo;
  const og2 = document.createElement('optgroup');
  og2.label = titulo;
  for (const k of claves.filter((c) => NOMBRES.includes(c))) {
    opcion(presetSelect, k, DEMOS[k][0], og);
    opcion(siembraSelect, k, DEMOS[k][0], og2);
    puestos.add(k);
  }
  presetSelect.appendChild(og);
  siembraSelect.appendChild(og2);
}
for (const k of NOMBRES.filter((c) => !puestos.has(c))) {
  opcion(presetSelect, k, DEMOS[k] ? DEMOS[k][0] : k);
  opcion(siembraSelect, k, DEMOS[k] ? DEMOS[k][0] : k);
}
{
  const og = document.createElement('optgroup');
  og.label = 'Solo la forma';
  for (const k of DUST_MORPHOLOGIES) opcion(siembraSelect, 'forma:' + k, FORMAS[k] || k, og);
  siembraSelect.appendChild(og);
}
siembraSelect.value = 'interstellarDust';

const selEscena = $('escena');
opcion(selEscena, '', 'Elige un ejemplo…');
for (const [k, [t]] of Object.entries(ESCENAS)) opcion(selEscena, k, t);

const selMotas = $('motas'), selGranos = $('granos'), selForma = $('forma'), selPaleta = $('paleta');
const selPerfil = $('perfil'), selMezcla = $('mezcla'), selAdapt = $('adaptativo');
const selFps = $('fps'), selResolucion = $('resolucion'), selGiro = $('giro'), selSorteo = $('sorteo');
for (const [v, t] of MOTAS) {
  const o = opcion(selMotas, v, t);
  if (MOVIL && Number(v) > 1000000) { o.disabled = true; o.textContent += ' (solo ordenador)'; }
}
for (const [v, t] of GRANOS) opcion(selGranos, v, t);
opcion(selForma, '', 'La del objeto');
for (const k of DUST_MORPHOLOGIES) opcion(selForma, k, FORMAS[k] || k);
opcion(selPaleta, '', 'La de la forma');
for (const k of DUST_PALETTES) opcion(selPaleta, k, PALETAS[k] || k);
opcion(selPaleta, 'propia', 'Colores propios');
opcion(selPerfil, '', 'El de la forma');
for (const k of DUST_VOLUME_PROFILES) opcion(selPerfil, k, PERFILES[k] || k);
opcion(selMezcla, '', 'La del objeto');
opcion(selMezcla, 'normal', 'Polvo (tapa lo de detrás)');
opcion(selMezcla, 'additive', 'Luz (se suma)');
selMotas.value = 'auto';
selGranos.value = '1e18';

const nav = $('ir');
for (const k of Object.keys(ESCENAS)) {
  const a = document.createElement('a');
  a.href = '#' + k;
  a.dataset.k = k;
  a.textContent = ESCENAS[k][0];
  nav.appendChild(a);
}
for (const k of NOMBRES) {
  const a = document.createElement('a');
  a.href = '#' + k;
  a.dataset.k = k;
  a.textContent = DEMOS[k] ? DEMOS[k][0].replace(/ \(.*\)$/, '') : k;
  nav.appendChild(a);
}

const samples = $('samples'), status = $('status'), aviso = $('aviso'), hud = $('hud');
const escala = $('escala'), flujo = $('flujo'), movimiento = $('movimiento');
const opacidad = $('opacidad'), maxpx = $('maxpx'), exposicion = $('exposicion');
const evolucion = $('evolucion'), bloqueExplosion = $('bloqueExplosion');
const colores = $('colores');
const pickers = [...colores.querySelectorAll('input')];
const lista = $('grupos');
exposicion.value = String(renderer.toneMappingExposure);
if (MOVIL) {
  $('info').classList.add('plegado');
  $('plegar').textContent = 'Mostrar';
  $('plegar').setAttribute('aria-expanded', 'false');
}

/* ------------------------------------------------------------ avisos de fallo
 * Si el shader no compila, o si el lienzo sale vacío tras montar la escena,
 * se dice en pantalla: un negro sin explicación no se puede diagnosticar. */
const fallo = $('fallo');
let falloShader = false;
/* un aviso que no debe quitar la comprobación del lienzo (un enlace roto) */
let falloFijo = false;
function avisaFallo(texto) {
  fallo.textContent = texto;
  fallo.hidden = false;
}
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
    .map((t) => String(t || '').trim()).filter(Boolean).join(' · ');
  console.error('Nebula Dust Engine: el shader no compila', log);
  falloShader = true;
  avisaFallo('El shader del polvo no compila en esta tarjeta: ' + (log.slice(0, 400) || 'sin detalle del navegador'));
};
/** Lee el lienzo recién compuesto (una vez por escena montada) y avisa si no hay nada. */
function compruebaLienzo() {
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (!w || !h || typeof gl.readPixels !== 'function') return;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  /* el fondo es el píxel más oscuro; «vivo» es lo que sube 6 niveles sobre él */
  let fondo = 255, vivos = 0, maximo = 0;
  for (let pasada = 0; pasada < 2; pasada++) {
    for (let y = 0; y < h; y += 2) {
      for (let x = 0, i = y * w * 4; x < w; x += 2, i += 8) {
        const m = Math.max(px[i], px[i + 1], px[i + 2]);
        if (pasada === 0) { if (m < fondo) fondo = m; if (m > maximo) maximo = m; } else if (m > fondo + 6) vivos++;
      }
    }
  }
  const vacio = sistema.size > 0 && vivos < 50 && maximo < fondo + 24;
  if (vacio) avisaFallo('El lienzo ha quedado vacío: las motas se dibujan pero no llega a verse ninguna. Prueba más exposición, otro volumen o más motas.');
  else if (!falloShader && !falloFijo) fallo.hidden = true;
  return { vivos, maximo, fondo, vacio };
}

/* ------------------------------------------------------------ números grandes */
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
function grande(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1e6) return Math.round(n).toLocaleString('es-ES');
  const e = Math.floor(Math.log10(n));
  const m = n / Math.pow(10, e);
  return m.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' × 10' + String(e).replace(/./g, (c) => SUP[c]);
}
const corto = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M'
  : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));
const GRADOS = 180 / Math.PI;

/* ------------------------------------------------------------ rendimiento */
const fpsTope = () => Number(selFps.value) || 0;
const escalaRes = () => Number(selResolucion.value) || 1;
/** Umbral del sorteo de motas pequeñas (0 = se dibujan todas). */
const minPx = () => (selSorteo.value === 'si' ? 0.5 : 0);

function opcionesGranos() {
  if (selGranos.value === 'masa') {
    return { physicalGrainCount: undefined, dustMassSolar: 0.03, grainRadiusMicrons: 0.1, grainDensityKgM3: 3000 };
  }
  return { physicalGrainCount: Number(selGranos.value), dustMassSolar: undefined };
}

/* ------------------------------------------------------------ el sistema */
/* estado del bucle (abajo): va aquí porque montar la escena ya pide un dibujo */
let pedido = 0;
let sucio = true;
let ultimoDibujo = 0;
let ultimoRitmo = 0;
let compruebaEn = 0;
const contador = { cuadros: 0, desde: 0, msCpu: 0, fps: 0, cpu: 0, gpu: null, dibujadas: 0, enviadas: 0 };
const finExplosion = new Map();
let sel = null;
let modo = 'girar';
let msGenerada = 0;

const sistema = createDustSystem({
  renderer,
  adaptive: true,
  /* el adaptativo apunta al tope de fps, y con cronómetro de GPU el polvo no
   * pasa de la mitad del cuadro: no sube hasta llenar la tarjeta */
  targetFrameMs: 1000 / 60,
  measureGpuTime: true,
  resolutionScale: 1,
  minPointPx: 0,
  lightReferenceSamples: LUZ_REFERENCIA,
  ...opcionesGranos()
});
scene.add(sistema.object3d);

/** El motor del grupo elegido (o null). */
const motor = () => (sel && sistema.getGroup(sel) ? sistema.getGroup(sel).engine : null);
const spec = () => (sel && sistema.getGroup(sel) ? sistema.getGroup(sel).spec : null);

/* ------------------------------------------------------------ cámara en órbita */
const vista = { target: new THREE.Vector3(), azimuth: 0, elevation: 0, distance: 3.2 };
function aplicaVista() {
  const c = Math.cos(vista.elevation);
  camera.position.set(
    vista.target.x + vista.distance * c * Math.sin(vista.azimuth),
    vista.target.y + vista.distance * Math.sin(vista.elevation),
    vista.target.z + vista.distance * c * Math.cos(vista.azimuth)
  );
  camera.lookAt(vista.target);
  camera.updateMatrixWorld();
}
function ponVista(v) {
  const t = v && Array.isArray(v.target) ? v.target : [0, 0, 0];
  vista.target.set(Number(t[0]) || 0, Number(t[1]) || 0, Number(t[2]) || 0);
  vista.azimuth = Number.isFinite(v && v.azimuth) ? v.azimuth : 0;
  vista.elevation = Number.isFinite(v && v.elevation) ? THREE.MathUtils.clamp(v.elevation, -1.45, 1.45) : 0;
  vista.distance = Number.isFinite(v && v.distance) ? THREE.MathUtils.clamp(v.distance, 1.2, 14) : 3.2;
  aplicaVista();
}
const vistaJson = () => ({
  target: vista.target.toArray().map((n) => Math.round(n * 1e4) / 1e4),
  azimuth: Math.round(vista.azimuth * 1e4) / 1e4,
  elevation: Math.round(vista.elevation * 1e4) / 1e4,
  distance: Math.round(vista.distance * 1e4) / 1e4
});
ponVista(null);

/* ------------------------------------------------------------ gizmo */
const gizmo = new TransformControls(camera, renderer.domElement);
const gizmoAyudante = typeof gizmo.getHelper === 'function' ? gizmo.getHelper() : gizmo;
escenaGizmo.add(gizmoAyudante);
let arrastrandoGizmo = false;
gizmo.addEventListener('dragging-changed', (e) => { arrastrandoGizmo = Boolean(e.value); });
gizmo.addEventListener('change', () => pide());
gizmo.addEventListener('objectChange', () => {
  if (!sel) return;
  sistema.captureTransform(sel);
  panelTransformacion();
  guardaHash();
  pide();
});
function colocaGizmo() {
  const g = sel ? sistema.getGroup(sel) : null;
  if (modo === 'mover' && g) {
    if (gizmo.object !== g.object3d) gizmo.attach(g.object3d);
    gizmo.setMode($('gizmo').value);
  } else if (gizmo.object) {
    gizmo.detach();
  }
}
/* Una nube regenerada es otro Object3D: el gizmo se engancha al nuevo. */
sistema.on('rebuild', (e) => {
  compruebaEn = 1;
  if (e.id === sel) colocaGizmo();
});

/* ------------------------------------------------------------ panel del grupo */
function nombreDe(s) {
  if (!s) return '';
  return s.name || s.id;
}

function pintaLista() {
  lista.textContent = '';
  for (const g of sistema.listGroups()) {
    const li = document.createElement('li');
    li.dataset.grupo = g.id;
    if (g.id === sel) li.classList.add('activo');
    if (!g.visible) li.classList.add('oculto');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'elegir';
    b.dataset.accion = 'elegir';
    b.textContent = g.name + ' · ' + corto(g.sampleCount);
    const v = document.createElement('button');
    v.type = 'button';
    v.className = 'ver';
    v.dataset.accion = 'ver';
    v.textContent = g.visible ? 'Ocultar' : 'Mostrar';
    li.appendChild(b);
    li.appendChild(v);
    lista.appendChild(li);
  }
  const s = spec();
  $('ocultar').textContent = s && !s.visible ? 'Mostrar' : 'Ocultar';
  for (const id of ['duplicar', 'borrar', 'ocultar']) $(id).disabled = !s;
}

function panelTransformacion() {
  const s = spec();
  if (!s) return;
  $('posX').value = String(s.position[0]);
  $('posY').value = String(s.position[1]);
  $('posZ').value = String(s.position[2]);
  $('rotX').value = String(Math.round(s.rotation[0] * GRADOS));
  $('rotY').value = String(Math.round(s.rotation[1] * GRADOS));
  $('rotZ').value = String(Math.round(s.rotation[2] * GRADOS));
  $('tamGrupo').value = String(Math.max(...s.scale.map(Math.abs)));
}

/** Rellena el panel con los valores del grupo elegido. */
function panelDesdeGrupo() {
  const s = spec();
  pintaLista();
  if (!s) {
    $('que').textContent = 'No hay ningún grupo: añade uno o siembra en la escena.';
    return;
  }
  $('nombre').value = nombreDe(s);
  presetSelect.value = s.preset || '';
  $('que').textContent = s.preset && DEMOS[s.preset] ? DEMOS[s.preset][1] : (FORMAS[s.morphology] || s.morphology);
  $('semillaTxt').value = String(s.seed);
  if (s.count && ![...selMotas.querySelectorAll('option')].some((o) => o.value === String(s.count))) {
    opcion(selMotas, String(s.count), s.count.toLocaleString('es-ES'));
  }
  selMotas.value = s.count ? String(s.count) : 'auto';
  selForma.value = s.morphology;
  selPaleta.value = s.palette === 'custom' ? 'propia' : s.palette;
  colores.hidden = s.palette !== 'custom';
  const stops = s.palette === 'custom' ? s.colors : (getDustPalette(s.palette) || []).map(dustColorToHex);
  pickers.forEach((p, i) => { if (stops.length) p.value = stops[Math.min(i, stops.length - 1)]; });
  $('tinte').value = s.tint;
  selPerfil.value = s.volumeProfile;
  selMezcla.value = s.blending;
  opacidad.value = String(s.opacity);
  escala.value = String(s.size);
  maxpx.value = String(s.maxPointSize);
  flujo.value = String(s.flowSpeed);
  movimiento.value = String(s.motion);
  $('orden').value = String(s.order);
  $('capa').value = String(s.layer);
  panelTransformacion();
  bloqueExplosion.hidden = !(s.evolutionRate > 0 || s.morphology === 'supernovaEjecta');
  const e = motor();
  if (e) evolucion.value = String(e.getStatus().evolution);
  pintaMuestras();
}

function pintaMuestras() {
  const e = motor();
  const st = sistema.getStatus();
  if (!e) { samples.textContent = 'Motas en la GPU: 0'; return; }
  const md = e.metadata;
  samples.textContent = 'Grupo: ' + md.sampleCount.toLocaleString('es-ES') + ' motas'
    + (msGenerada ? ' (generadas en ' + Math.round(msGenerada) + ' ms)' : '')
    + ' · escena: ' + st.allocatedSamples.toLocaleString('es-ES') + ' de ' + st.maxTotalSamples.toLocaleString('es-ES')
    + (st.requestedSamples > st.maxTotalSamples ? ' (reparto proporcional)' : '')
    + ' · granos reales: ' + grande(md.physicalGrainCount)
    + ' · cada mota representa ' + grande(md.grainsPerSample) + ' granos'
    + ' · tarjeta: nivel ' + md.gpuProfile.tier;
}

function elige(id) {
  sel = id && sistema.getGroup(id) ? id : (sistema.listGroups()[0]?.id || null);
  colocaGizmo();
  panelDesdeGrupo();
  pide();
}

/** Cambia el grupo elegido. `pesado` = regenera motas (se avisa si son millones). */
function cambia(patch, pesado = false) {
  if (!sel) return;
  const hazlo = () => {
    const t0 = performance.now();
    sistema.updateGroup(sel, patch);
    if (pesado) msGenerada = performance.now() - t0;
    panelDesdeGrupo();
    guardaHash();
    pide();
  };
  /* solo si se piden de forma explícita un millón o más (como antes con el selector de motas) */
  const n = 'count' in patch ? (patch.count || 0) : ((spec() && spec().count) || 0);
  if (pesado && n >= 1000000) {
    aviso.hidden = false;
    aviso.textContent = 'Generando ' + n.toLocaleString('es-ES') + ' motas…';
    setTimeout(() => { hazlo(); aviso.hidden = true; }, 30);
  } else {
    hazlo();
  }
}

/* ------------------------------------------------------------ escenas */
/** Una escena de un solo objeto del catálogo (los enlaces #orion, #m42...). */
const escenaDePreset = (k) => ({ groups: [{ id: 'g1', preset: k, radius: RADIO_OBJETO }] });

function montaEscena(datos, { vistaNueva = true } = {}) {
  falloFijo = false;
  const t0 = performance.now();
  const r = sistema.load(datos);
  msGenerada = performance.now() - t0;
  if (vistaNueva) ponVista(r.view);
  finExplosion.clear();
  compruebaEn = 1;
  elige(r.ids[0] || null);
  return r;
}

function cargaEjemplo(k) {
  montaEscena(DUST_EXAMPLE_SCENES[k]);
  selEscena.value = k;
  marcaNav(k);
  ponHash('#' + k);
}

function cargaPreset(k) {
  montaEscena(escenaDePreset(k));
  selEscena.value = '';
  marcaNav(k);
  ponHash('#' + k);
}

function marcaNav(k) {
  for (const a of nav.children) a.classList.toggle('activo', a.dataset.k === k);
}

/* ------------------------------------------------------------ enlace en el hash
 * Tras cada cambio, la escena entera (grupos y encuadre) va comprimida en
 * #s=...; si es un ejemplo o un objeto del catálogo sin tocar, queda el
 * nombre corto (#collision, #orion). */
let hashPendiente = 0;
let hashListo = Promise.resolve();
function ponHash(h) {
  if (location.hash !== h) history.replaceState(null, '', h || '#');
}
function hashCorto() {
  const actual = JSON.stringify(sistema.serialize().groups);
  const igual = (datos) => {
    try {
      const specs = datos.groups.map((g, i) => normalizeDustGroupSpec({ ...g, id: g.id || 'g' + (i + 1) }, null, 'dust-g' + (i + 1)));
      return JSON.stringify(specs) === actual;
    } catch {
      return false;
    }
  };
  for (const k of Object.keys(DUST_EXAMPLE_SCENES)) if (igual(DUST_EXAMPLE_SCENES[k])) return '#' + k;
  for (const k of NOMBRES) if (igual(escenaDePreset(k))) return '#' + k;
  return null;
}
async function escribeHash() {
  const c = hashCorto();
  if (c) { ponHash(c); return c; }
  const texto = await encodeDustScene(sistema.serialize({ view: vistaJson() }));
  const h = '#s=' + texto;
  ponHash(h);
  return h;
}
function guardaHash() {
  if (hashPendiente) clearTimeout(hashPendiente);
  hashPendiente = setTimeout(() => {
    hashPendiente = 0;
    hashListo = escribeHash().catch((e) => console.warn('enlace', e));
  }, 250);
}

/** Lee el hash: #s=escena, #ejemplo, #objeto (o su alias). Si no, el primer ejemplo. */
async function desdeHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('s=')) {
    try {
      const datos = await decodeDustScene(h.slice(2));
      montaEscena(datos);
      selEscena.value = '';
      marcaNav('');
      return;
    } catch (e) {
      cargaEjemplo('twinNebula');
      avisaFallo('El enlace no trae una escena válida (' + (e && e.message ? e.message : e) + '): se abre el ejemplo.');
      falloFijo = true;
      return;
    }
  }
  const ej = DUST_EXAMPLE_SCENES[h] ? h : ALIAS_ESCENA[h.toLowerCase()];
  if (ej) { cargaEjemplo(ej); return; }
  const k = resolveNebulaDustPresetName(h);
  if (k) { cargaPreset(k); return; }
  cargaEjemplo('twinNebula');
}

/* ------------------------------------------------------------ guardar y cargar */
let ultimoJson = '';
function jsonEscena() {
  return JSON.stringify(sistema.serialize({ view: vistaJson() }), null, 2);
}
function descarga(texto, nombre) {
  ultimoJson = texto;
  if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  if (typeof a.click === 'function') a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
function importaJson(texto) {
  try {
    montaEscena(JSON.parse(texto));
    selEscena.value = '';
    marcaNav('');
    guardaHash();
    avisa('Escena cargada: ' + sistema.size + ' grupos.');
    return true;
  } catch (e) {
    avisaFallo('Ese fichero no es una escena de Nebula Dust Engine: ' + (e && e.message ? e.message : e));
    return false;
  }
}
let avisoHasta = 0;
function avisa(texto) {
  aviso.hidden = false;
  aviso.textContent = texto;
  const hasta = ++avisoHasta;
  setTimeout(() => { if (hasta === avisoHasta) aviso.hidden = true; }, 3000);
}

/* ------------------------------------------------------------ modos */
function ponModo(m) {
  modo = m;
  for (const [id, v] of [['mGirar', 'girar'], ['mSembrar', 'sembrar'], ['mMover', 'mover'], ['mTocar', 'tocar']]) {
    $(id).classList.toggle('activo', v === m);
    $(id).setAttribute('aria-pressed', String(v === m));
  }
  $('opSembrar').hidden = m !== 'sembrar';
  $('opMover').hidden = m !== 'mover';
  $('opTocar').hidden = m !== 'tocar';
  $('ayudaModo').textContent = AYUDA[m];
  colocaGizmo();
  pide();
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function rayoDe(x, y) {
  const rect = typeof renderer.domElement.getBoundingClientRect === 'function'
    ? renderer.domElement.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  ndc.set(((x - rect.left) / (rect.width || 1)) * 2 - 1, -((y - rect.top) / (rect.height || 1)) * 2 + 1);
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
  return raycaster;
}
const capaVista = () => ($('capaVista').value === 'todas' ? undefined : Number($('capaVista').value));

function eligeEn(x, y) {
  const hit = sistema.pick(rayoDe(x, y), { layer: capaVista() });
  if (hit) elige(hit.id);
  return hit;
}

function siembraEn(x, y) {
  const punto = projectToViewPlane(rayoDe(x, y), camera, vista.target);
  if (!punto) return null;
  const v = siembraSelect.value;
  const t = Number($('tamSiembra').value) || 0.45;
  const base = v.startsWith('forma:')
    ? { morphology: v.slice(6), name: FORMAS[v.slice(6)] || v.slice(6) }
    : { preset: v, name: DEMOS[v] ? DEMOS[v][0] : v };
  const id = sistema.sow(punto, {
    ...base,
    seed: randomDustSeed(),
    radius: 1,
    scale: [t, t, t],
    order: 1 + sistema.size,
    layer: capaVista() ?? 0
  });
  elige(id);
  guardaHash();
  return id;
}

function tocaEn(x, y) {
  const s = spec();
  const centro = s ? new THREE.Vector3().fromArray(s.position) : vista.target;
  const punto = projectToViewPlane(rayoDe(x, y), camera, centro);
  if (!punto) return 0;
  const n = sistema.touch(punto, { radius: Number($('radioToque').value), strength: Number($('fuerzaToque').value) });
  pide();
  return n;
}

/* ------------------------------------------------------------ eventos, por delegación */
const AL_CAMBIAR = {
  escena: () => { if (selEscena.value) cargaEjemplo(selEscena.value); },
  fichero: () => {
    const f = $('fichero').files && $('fichero').files[0];
    if (!f) return;
    Promise.resolve(typeof f.text === 'function' ? f.text() : '').then(importaJson);
    $('fichero').value = '';
  },
  nombre: () => { cambia({ name: $('nombre').value.trim() || null }); },
  preset: () => { cambia({ preset: presetSelect.value }, true); },
  semillaTxt: () => { if ($('semillaTxt').value.trim()) cambia({ seed: $('semillaTxt').value.trim() }, true); },
  motas: () => { cambia({ count: selMotas.value === 'auto' ? null : Number(selMotas.value) }, true); },
  forma: () => {
    const s = spec();
    const m = selForma.value || (s && s.preset ? nebulaDustOptions(s.preset).morphology : 'diffuse');
    cambia({ morphology: m }, true);
  },
  paleta: () => {
    if (selPaleta.value === 'propia') cambia({ colors: pickers.map((p) => p.value) });
    else cambia({ palette: selPaleta.value || null });
  },
  perfil: () => { cambia({ volumeProfile: selPerfil.value || null }, true); },
  mezcla: () => {
    const s = spec();
    const b = selMezcla.value || (s && s.preset && nebulaDustOptions(s.preset).blending === 'additive' ? 'additive' : 'normal');
    cambia({ blending: b });
  },
  capa: () => { cambia({ layer: Number($('capa').value) }); },
  granos: () => { sistema.setOptions(opcionesGranos()); compruebaEn = 1; panelDesdeGrupo(); },
  adaptativo: () => { sistema.setOptions({ adaptive: selAdapt.value === 'si' }); panelDesdeGrupo(); },
  sorteo: () => { sistema.setOptions({ minPointPx: minPx() }); },
  fps: () => { sistema.setOptions({ targetFrameMs: 1000 / (fpsTope() || 60) }); panelDesdeGrupo(); },
  resolucion: () => {
    renderer.setPixelRatio(DPR_BASE * escalaRes());
    renderer.setSize(window.innerWidth, window.innerHeight);
    ajustaBufer();
    sistema.setOptions({ resolutionScale: escalaRes() });
  },
  capaVista: () => {
    if ($('capaVista').value === 'todas') camera.layers.enableAll();
    else camera.layers.set(Number($('capaVista').value));
  },
  giro: () => {},
  siembra: () => {},
  gizmo: () => { colocaGizmo(); }
};
const AL_MOVER = {
  escala: () => cambia({ size: Number(escala.value) }),
  flujo: () => cambia({ flowSpeed: Number(flujo.value) }),
  movimiento: () => cambia({ motion: Number(movimiento.value) }),
  opacidad: () => cambia({ opacity: Number(opacidad.value) }),
  maxpx: () => cambia({ maxPointSize: Number(maxpx.value) }),
  tinte: () => cambia({ tint: $('tinte').value }),
  tamGrupo: () => {
    const s = spec();
    if (!s) return;
    const m = Math.max(...s.scale.map(Math.abs)) || 1;
    const t = Number($('tamGrupo').value);
    cambia({ scale: s.scale.map((v) => v / m * t) });
  },
  posX: () => mueveEje('position', 0, Number($('posX').value)),
  posY: () => mueveEje('position', 1, Number($('posY').value)),
  posZ: () => mueveEje('position', 2, Number($('posZ').value)),
  rotX: () => mueveEje('rotation', 0, Number($('rotX').value) / GRADOS),
  rotY: () => mueveEje('rotation', 1, Number($('rotY').value) / GRADOS),
  rotZ: () => mueveEje('rotation', 2, Number($('rotZ').value) / GRADOS),
  orden: () => cambia({ order: Number($('orden').value) }),
  exposicion: () => { renderer.toneMappingExposure = Number(exposicion.value); },
  evolucion: () => {
    const e = motor();
    if (e) e.setEvolution(Number(evolucion.value));
    finExplosion.delete(sel);
  },
  tamSiembra: () => {},
  radioToque: () => {},
  fuerzaToque: () => {}
};
function mueveEje(clave, eje, valor) {
  const s = spec();
  if (!s || !Number.isFinite(valor)) return;
  const v = s[clave].slice();
  v[eje] = valor;
  cambia({ [clave]: v });
}
const AL_PULSAR = {
  anadir: () => {
    const k = presetSelect.value && NOMBRES.includes(presetSelect.value) ? presetSelect.value : 'interstellarDust';
    const id = sistema.addGroup({ preset: k, seed: randomDustSeed(), radius: RADIO_OBJETO, position: vista.target.toArray(), order: 1 + sistema.size });
    elige(id);
    guardaHash();
  },
  duplicar: () => {
    if (!sel) return;
    const s = spec();
    const id = sistema.duplicateGroup(sel, {
      name: nombreDe(s) + ' (copia)',
      seed: randomDustSeed(),
      position: [s.position[0] + 0.3, s.position[1], s.position[2]]
    });
    elige(id);
    guardaHash();
  },
  borrar: () => {
    if (!sel) return;
    sistema.removeGroup(sel);
    finExplosion.delete(sel);
    sel = null;
    elige(null);
    guardaHash();
  },
  ocultar: () => {
    const s = spec();
    if (s) cambia({ visible: !s.visible });
  },
  vaciar: () => {
    sistema.clear();
    sel = null;
    elige(null);
    selEscena.value = '';
    guardaHash();
  },
  guardar: () => {
    descarga(jsonEscena(), 'nebula-dust-scene.json');
    avisa('Escena guardada en nebula-dust-scene.json');
  },
  cargar: () => { const f = $('fichero'); if (typeof f.click === 'function') f.click(); },
  enlace: () => {
    if (hashPendiente) { clearTimeout(hashPendiente); hashPendiente = 0; }
    hashListo = encodeDustScene(sistema.serialize({ view: vistaJson() })).then((t) => {
      ponHash('#s=' + t);
      const url = String(location.href || '#s=' + t);
      const portapapeles = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(url) : Promise.reject(new Error('sin portapapeles'));
      return portapapeles.then(() => avisa('Enlace copiado: la escena va dentro.'), () => avisa('Enlace listo en la barra de direcciones.'));
    });
  },
  semilla: () => { cambia({ seed: randomDustSeed() }, true); },
  restablecer: () => {
    if (sel) {
      sistema.resetGroup(sel);
      sistema.updateGroup(sel, { count: null });
    }
    selGranos.value = '1e18';
    selAdapt.value = 'si';
    selSorteo.value = 'no';
    sistema.setOptions({ ...opcionesGranos(), adaptive: true, minPointPx: 0 });
    renderer.toneMappingExposure = EXPOSICION;
    exposicion.value = String(EXPOSICION);
    panelDesdeGrupo();
    guardaHash();
  },
  reiniciar: () => { const e = motor(); if (e) e.restartEvolution(0); finExplosion.delete(sel); },
  plegar: () => {
    const p = $('info').classList.toggle('plegado');
    $('plegar').textContent = p ? 'Mostrar' : 'Ocultar';
    $('plegar').setAttribute('aria-expanded', String(!p));
  },
  mGirar: () => ponModo('girar'),
  mSembrar: () => ponModo('sembrar'),
  mMover: () => ponModo('mover'),
  mTocar: () => ponModo('tocar')
};
/* Los botones de cada fila de la lista de grupos no tienen id: van por data-accion. */
const EN_LISTA = {
  elegir: (id) => elige(id),
  ver: (id) => {
    const s = sistema.getGroup(id);
    if (s) sistema.updateGroup(id, { visible: !s.spec.visible });
    if (id === sel) colocaGizmo();
    pintaLista();
    guardaHash();
  }
};
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t || !t.id) {
    /* los selectores de color no tienen id: van por su contenedor */
    if (t && t.closest && t.closest('#colores')) cambia({ colors: pickers.map((p) => p.value) });
    pide();
    return;
  }
  if (AL_CAMBIAR[t.id]) { AL_CAMBIAR[t.id](); pide(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t && AL_MOVER[t.id]) { AL_MOVER[t.id](); pide(); }
});
document.addEventListener('click', (e) => {
  const fila = e.target && e.target.closest ? e.target.closest('[data-accion]') : null;
  if (fila) {
    const li = fila.closest('[data-grupo]');
    if (li && EN_LISTA[fila.dataset.accion]) EN_LISTA[fila.dataset.accion](li.dataset.grupo);
    pide();
    return;
  }
  const b = e.target && e.target.closest ? e.target.closest('button[id]') : null;
  if (b && AL_PULSAR[b.id]) { AL_PULSAR[b.id](); pide(); }
});
window.addEventListener('hashchange', () => { desdeHash().then(pide); });

/* ------------------------------------------------------------ ratón y dedos
 * Un dedo o el ratón hacen lo del modo (girar, sembrar, mover, tocar); un
 * toque corto sin arrastrar elige el grupo (o siembra, en «Sembrar»); dos
 * dedos pellizcan para acercar en cualquier modo; la rueda acerca. */
const punteros = new Map();
let distPellizco = 0;
let inicioToque = null;
const acerca = (f) => {
  vista.distance = THREE.MathUtils.clamp(vista.distance * f, 1.2, 14);
  aplicaVista();
  pide();
};
renderer.domElement.addEventListener('pointerdown', (e) => {
  punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (typeof renderer.domElement.setPointerCapture === 'function') {
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* nada */ }
  }
  if (punteros.size === 1) {
    inicioToque = { x: e.clientX, y: e.clientY, t: performance.now(), movido: 0 };
    if (modo === 'tocar') tocaEn(e.clientX, e.clientY);
  } else {
    inicioToque = null;
  }
  if (punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    distPellizco = Math.hypot(a.x - b.x, a.y - b.y);
  }
  pide();
});
const suelta = (e) => {
  const era = punteros.get(e.pointerId);
  punteros.delete(e.pointerId);
  distPellizco = 0;
  if (e.type === 'pointerup' && era && inicioToque && punteros.size === 0 && !arrastrandoGizmo) {
    const corto = inicioToque.movido < 6 && performance.now() - inicioToque.t < 600;
    if (corto) {
      if (modo === 'sembrar') siembraEn(e.clientX, e.clientY);
      else if (modo === 'girar' || modo === 'mover') eligeEn(e.clientX, e.clientY);
    }
  }
  if (punteros.size === 0) inicioToque = null;
  pide();
};
renderer.domElement.addEventListener('pointerup', suelta);
renderer.domElement.addEventListener('pointercancel', suelta);
renderer.domElement.addEventListener('pointermove', (e) => {
  const prev = punteros.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (inicioToque) inicioToque.movido += Math.hypot(dx, dy);
  if (punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (distPellizco > 0 && d > 0) acerca(distPellizco / d);
    distPellizco = d;
    return;
  }
  if (punteros.size !== 1) return;
  if (modo === 'tocar') { tocaEn(e.clientX, e.clientY); return; }
  if (modo === 'mover' && arrastrandoGizmo) return;
  vista.azimuth -= dx * 0.006;
  vista.elevation = THREE.MathUtils.clamp(vista.elevation + dy * 0.006, -1.45, 1.45);
  aplicaVista();
  pide();
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  acerca(Math.exp(e.deltaY * 0.001));
}, { passive: false });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  ajustaBufer();
  pide();
});

/* ------------------------------------------------------------ bucle
 * Se dibuja solo si algo cambia (giro, turbulencia, flujo, explosión, un
 * toque, un control o la cámara), como mucho al tope de fps, y nada con la
 * pestaña oculta. Quieto, la GPU no hace nada. */

function anima() {
  return selGiro.value === 'si' || punteros.size > 0 || finExplosion.size > 0
    || sistema.isAnimated();
}
let detenido = false;
function programa() {
  if (!pedido && !document.hidden && !detenido) pedido = requestAnimationFrame(frame);
}
function pide() {
  sucio = true;
  programa();
}

/** Las explosiones vuelven a empezar 2,5 s después de acabar. */
function cicloExplosiones(now) {
  for (const g of sistema.listGroups()) {
    if (!g.visible) continue;
    const e = sistema.getGroup(g.id).engine;
    const st = e.getStatus();
    if (!(st.evolutionRate > 0)) { finExplosion.delete(g.id); continue; }
    if (st.evolution >= 1) {
      if (!finExplosion.has(g.id)) finExplosion.set(g.id, now);
      else if (now - finExplosion.get(g.id) > 2500) { e.restartEvolution(0); finExplosion.delete(g.id); }
    }
    if (g.id === sel && !bloqueExplosion.hidden && document.activeElement !== evolucion) evolucion.value = String(st.evolution);
  }
}

function frame(now) {
  pedido = 0;
  if (document.hidden) return;
  const seMueve = anima();
  if (!sucio && !seMueve) {
    ultimoRitmo = 0;
    pintaContador(now, true);
    return;
  }
  const intervalo = fpsTope() ? 1000 / fpsTope() : 0;
  if (intervalo && ultimoRitmo && now - ultimoRitmo < intervalo - 0.5) {
    programa();
    return;
  }
  const deltaSeconds = ultimoDibujo && ultimoRitmo ? Math.min(0.1, (now - ultimoDibujo) / 1000) : 0;
  /* el ritmo sigue la rejilla del tope para no perder fps con pantallas de 144 Hz */
  const pasado = now - ultimoRitmo;
  ultimoRitmo = intervalo && ultimoRitmo && pasado < intervalo * 3
    ? ultimoRitmo + intervalo * Math.max(1, Math.floor(pasado / intervalo))
    : now;
  ultimoDibujo = now;
  sucio = false;

  const t0 = performance.now();
  if (selGiro.value === 'si' && punteros.size === 0) {
    vista.azimuth += deltaSeconds * 0.035;
    aplicaVista();
  }
  sistema.update(camera, deltaSeconds);
  cicloExplosiones(now);
  const midiendo = sistema.beginGpuFrame();
  renderer.setRenderTarget(bufer);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(escenaSalida, camSalida);
  if (midiendo) sistema.endGpuFrame();
  if (gizmo.object) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(escenaGizmo, camera);
    renderer.autoClear = auto;
  }
  if (compruebaEn && --compruebaEn === 0) compruebaLienzo();
  contador.msCpu += performance.now() - t0;
  contador.cuadros++;
  pintaContador(now, false);
  programa();
}

function pintaContador(now, quieto) {
  if (!contador.desde) contador.desde = now;
  const pasado = now - contador.desde;
  if (!quieto && pasado < 500) return;
  if (pasado > 0) {
    contador.fps = quieto ? 0 : contador.cuadros * 1000 / pasado;
    contador.cpu = contador.cuadros ? contador.msCpu / contador.cuadros : 0;
  }
  contador.cuadros = 0;
  contador.msCpu = 0;
  contador.desde = now;
  const st = sistema.getStatus();
  contador.gpu = st.gpuTimer && Number.isFinite(st.gpuTimer.lastGpuMs) ? st.gpuTimer.lastGpuMs : null;
  const sonda = sistema.probeFrame(camera, 2048);
  contador.enviadas = sonda.sentSamples;
  contador.dibujadas = sonda.drawnSamples;
  hud.textContent = (quieto ? 'Quieto: nada cambia, la GPU descansa' : Math.round(contador.fps) + ' fps')
    + (fpsTope() ? ' (tope ' + fpsTope() + ')' : ' (sin tope)')
    + ' · ' + (contador.gpu != null ? contador.gpu.toFixed(1) + ' ms de GPU' : contador.cpu.toFixed(1) + ' ms de CPU')
    + ' por fotograma · ' + contador.dibujadas.toLocaleString('es-ES') + ' motas dibujadas'
    + (contador.enviadas < st.allocatedSamples || contador.dibujadas < contador.enviadas
      ? ' de ' + st.allocatedSamples.toLocaleString('es-ES') : '')
    + ' · ' + st.groups + (st.groups === 1 ? ' grupo' : ' grupos');
  status.textContent = 'Enviadas a la GPU: ' + st.visibleSamples.toLocaleString('es-ES')
    + (st.allocatedSamples ? ' (' + Math.round(st.visibleSamples / st.allocatedSamples * 100) + ' %, la luz se conserva)' : '')
    + (escalaRes() < 1 ? ' · a media resolución' : '');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (pedido) cancelAnimationFrame(pedido);
    pedido = 0;
    ultimoRitmo = 0;
  } else {
    pide();
  }
});

ponModo('girar');
const listo = desdeHash().then(() => pide());
programa();

window.nebulaDustDemo = {
  /** El motor del grupo elegido. */
  get engine() {
    return motor();
  },
  get system() {
    return sistema;
  },
  get selected() {
    return sel;
  },
  get mode() {
    return modo;
  },
  get counter() {
    return { ...contador };
  },
  get view() {
    return vistaJson();
  },
  get camera() {
    return camera;
  },
  get gizmo() {
    return gizmo;
  },
  get lastExport() {
    return ultimoJson;
  },
  ready: listo,
  /** Promesa del último enlace escrito en el hash. */
  get hashWritten() {
    return hashListo;
  },
  maxSamples: MAX_GPU_SAMPLE_COUNT,
  checkCanvas: compruebaLienzo,
  select: elige,
  setMode: ponModo,
  loadExample: cargaEjemplo,
  exportJSON: jsonEscena,
  importJSON: importaJson,
  sowAt: siembraEn,
  touchAt: tocaEn,
  pickAt: eligeEn,
  /** Para la demo y libera la GPU (para incrustarla y quitarla). */
  stop() {
    detenido = true;
    if (pedido) cancelAnimationFrame(pedido);
    pedido = 0;
    if (hashPendiente) clearTimeout(hashPendiente);
    hashPendiente = 0;
    gizmo.detach();
    if (typeof gizmo.dispose === 'function') gizmo.dispose();
    sistema.dispose();
  },
  selectPreset(name) {
    const k = resolveNebulaDustPresetName(name);
    if (!k) throw new Error('Preset desconocido: ' + name);
    cargaPreset(k);
  }
};
