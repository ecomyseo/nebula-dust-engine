/**
 * Nebula Dust Engine · the editor demo.
 *
 * The panel is ./panel.js, after guspira, the panel of spite's
 * bumpy-metaballs-2026 (both MIT, credited in panel.css, the page and the
 * README). The whole state lives in the URL hash as readable parameters
 * (./hash.js) and the image goes through ./post.js (HalfFloat target, bloom,
 * ACES, vignette, grain).
 *
 * Keys: ← → presets, R random look, Space pause, Tab hides the interface,
 * F / double-click / double-tap fullscreen, 1–4 the modes.
 */
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
  createDustSystem, decodeDustScene, encodeDustScene, projectToViewPlane, randomDustSeed
} from '../src/system.js';
import { DUST_EXAMPLE_SCENES } from '../src/examples.js';
import { Panel, bindKey, unbindAllKeys, random } from './panel.js';
import {
  encodeHash, parseHash, presetScene, exampleView, parseSeed, printSeed, RENDER_SPEC, RENDER_DEFAULTS,
  DEFAULT_SCENE, DEMO_RADIUS, GRAIN_OPTIONS, QUALITY_OPTIONS, BUDGET_OPTIONS
} from './hash.js';
import { createPost } from './post.js';

const $ = (id) => document.getElementById(id);

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
$('container').appendChild(renderer.domElement);

/* The dust is drawn into a HalfFloat target and graded onto the canvas (post.js):
 * an 8-bit canvas rounds the faint samples to 0 (the black of 28/9/2026). */
const post = createPost(renderer);
/* Reference light: each group shines the same with 16 k as with 4 M samples
 * (the 786,432 of the "high" tier); more samples make it finer, not brighter. */
const LUZ_REFERENCIA = DUST_SAMPLE_BUDGETS[3];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.01, 100);
/* The gizmo is drawn on its own, on top and without grading: inside the target it would burn out. */
const escenaGizmo = new THREE.Scene();

/* ------------------------------------------------------------ texts */
const PRESETS = {
  orion: ['Orion Nebula (M42)', 'Emission nebula: gas ionized by the Trapezium and turbulent dust with no radial structure.'],
  eaglePillars: ['Pillars of Creation (M16)', 'Four columns of dense dust, each with its own height, width and tilt.'],
  horsehead: ['Horsehead (B33)', 'A dark cloud: the dust hides what is behind it instead of glowing.'],
  crab: ['Crab Nebula (M1)', 'Supernova remnant: filaments opening out from the central pulsar.'],
  ring: ['Ring Nebula (M57)', 'A planetary nebula seen almost face on: a torus of ionized gas.'],
  helix: ['Helix Nebula (NGC 7293)', 'The nearest planetary nebula, in the James Webb palette.'],
  lion: ['Lion (NGC 2392)', 'A continuous, turbulent field with no periodic families of spokes.'],
  interstellarDust: ['Interstellar dust', 'Diffuse dust with a gentle drift.'],
  galaxyDust: ['Galactic dust', 'Dust arms turning around the center.'],
  oortCloud: ['Oort cloud', 'A spherical shell of distant comets in a slow orbit.'],
  supernovaExplosion: ['Supernova explosion', 'The ejecta start at the center and expand; it starts again on its own.'],
  whiteDwarfAccretion: ['White dwarf accretion', 'Matter from the companion spiralling onto the white dwarf.'],
  redSupergiantShell: ['Betelgeuse dust shell', 'Dust from a red supergiant: loose knots and plumes (VLT/VISIR).'],
  collidingWindPinwheel: ['WR 104 pinwheel', 'Two colliding winds wind hot dust into a spiral (Keck).']
};
const PRESET_GROUPS = [
  ['Nebulae', ['orion', 'eaglePillars', 'horsehead', 'crab', 'ring', 'helix', 'lion']],
  ['Dust and phenomena', ['interstellarDust', 'galaxyDust', 'oortCloud', 'supernovaExplosion', 'whiteDwarfAccretion']],
  ['Stellar dust', ['redSupergiantShell', 'collidingWindPinwheel']]
];
const SCENES = {
  twinNebula: 'Emission nebula with a dark lane',
  collision: 'Collision with debris',
  diskRingHalo: 'Disk with a ring and a halo'
};
const SHAPES = {
  diffuse: 'Diffuse', orion: 'Orion', pillars: 'Pillars', horsehead: 'Horsehead', crab: 'Filaments (Crab)',
  ring: 'Ring', bipolar: 'Bipolar', lion: 'Lion', galaxy: 'Spiral galaxy', oort: 'Shell (Oort)',
  supernovaEjecta: 'Supernova ejecta', whiteDwarfAccretion: 'Accretion disk', clumpyShell: 'Clumpy shell', pinwheel: 'Pinwheel'
};
const PALETTES = {
  webb: 'James Webb', orion: 'Orion', ionized: 'Ionized gas', crab: 'Crab', dark: 'Dark cloud', galaxy: 'Galaxy',
  oort: 'Ice (Oort)', supernova: 'Supernova', accretion: 'Accretion', redSupergiant: 'Red supergiant', hotDust: 'Hot dust'
};
const VOLUMES = { mist: 'Mist', balanced: 'Balanced', dense: 'Dense', emissive: 'Emissive' };
const SAMPLES = [
  ['auto', 'Auto (by GPU)'], ['16384', '16,384'], ['65536', '65,536'], ['262144', '262,144'],
  ['500000', '500,000'], ['1000000', '1 million'], ['2000000', '2 million'], ['4000000', '4 million']
];
const GRAINS = {
  '1e6': '10⁶ (a million)', '1e9': '10⁹', '1e12': '10¹²', '1e15': '10¹⁵', '1e18': '10¹⁸', '1e21': '10²¹',
  '1e24': '10²⁴', '1e30': '10³⁰', '1e36': '10³⁶', mass: '0.03 solar masses'
};
const QUALITIES = {
  auto: 'Auto (by GPU)', minimal: 'Minimal · 16 k', balanced: 'Balanced · 65 k', detailed: 'Detailed · 262 k',
  high: 'High · 786 k', ultra: 'Ultra · 2 M'
};
const BUDGETS = {
  4000000: '4 M (all)', 2000000: '2 M', 1000000: '1 M', 500000: '500 k', 250000: '250 k', 100000: '100 k'
};
const MODES = [
  ['orbit', 'Orbit', 'Drag to orbit, tap a cloud to select it.'],
  ['sow', 'Sow', 'Tap the scene to plant a new cloud there.'],
  ['move', 'Move', 'Drag the gizmo to move, turn or scale the selected cloud; tap another cloud to switch.'],
  ['touch', 'Touch', 'Drag over the dust to push it; it drifts back on its own.']
];
/* Shape parameters: key, label, min, max, step, default (the engine's). */
const SHAPE_CONTROLS = {
  clumpyShell: [
    ['shellInner', 'Shell inner', 0, 0.98, 0.01, 0.55],
    ['shellOuter', 'Shell outer', 0.01, 1.5, 0.01, 1],
    ['clumpScale', 'Clump scale', 0.3, 12, 0.1, 2.2],
    ['clumpContrast', 'Clump contrast', 0, 1, 0.01, 0.8],
    ['plumeCount', 'Plumes', 0, 12, 1, 5],
    ['plumeFraction', 'Plume share', 0, 0.5, 0.01, 0.08]
  ],
  pinwheel: [
    ['spiralPitch', 'Spiral pitch', 0.05, 1.5, 0.01, null],
    ['spiralPhase', 'Spiral phase', 0, 6.28, 0.01, 0],
    ['spiralInner', 'Inner gap', 0, 0.9, 0.005, 0.015],
    ['armWidth', 'Arm width', 0.005, 0.5, 0.005, 0.075],
    ['coneOpening', 'Cone opening', 0, 1, 0.01, 0.1],
    ['radialFade', 'Radial fade', 0, 20, 0.1, 2.2]
  ]
};
const MOVIL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const ESTRECHO = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
const NOMBRES = listNebulaDustPresets();
const ORDEN_PRESETS = [...PRESET_GROUPS.flatMap(([, k]) => k).filter((k) => NOMBRES.includes(k)),
  ...NOMBRES.filter((k) => !PRESET_GROUPS.some(([, l]) => l.includes(k)))];
const nombrePreset = (k) => (PRESETS[k] ? PRESETS[k][0] : k);
const GRADOS = 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------ numbers */
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
function grande(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  const e = Math.floor(Math.log10(n));
  const m = n / Math.pow(10, e);
  return m.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' × 10' + String(e).replace(/./g, (c) => SUP[c]);
}
const corto = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' M'
  : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));
const miles = (n) => Math.round(n).toLocaleString('en-US');

/* ------------------------------------------------------------ messages
 * A shader that does not compile, or a canvas that comes out empty after a
 * scene is mounted, is said on screen: an unexplained black cannot be diagnosed. */
const fallo = $('error');
const toast = $('toast');
let falloShader = false;
/* a message the canvas check must not clear (a broken link) */
let falloFijo = false;
function avisaFallo(texto) {
  fallo.textContent = texto;
  fallo.hidden = false;
}
let toastHasta = 0;
function avisa(texto, ms = 3000) {
  toast.textContent = texto;
  toast.hidden = false;
  const n = ++toastHasta;
  if (ms) setTimeout(() => { if (n === toastHasta) toast.hidden = true; }, ms);
}
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
    .map((t) => String(t || '').trim()).filter(Boolean).join(' · ');
  console.error('Nebula Dust Engine: the shader does not compile', log);
  falloShader = true;
  avisaFallo('The dust shader does not compile on this GPU: ' + (log.slice(0, 400) || 'the browser gave no detail'));
};
/** Reads the freshly graded canvas (once per mounted scene) and says so if nothing shows. */
function compruebaLienzo() {
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (!w || !h || typeof gl.readPixels !== 'function') return;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  /* the background is the darkest pixel; "alive" is 6 levels above it */
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
  if (vacio) avisaFallo('The canvas came out empty: the samples are drawn but none of them shows. Try more exposure, another volume or more samples.');
  else if (!falloShader && !falloFijo) fallo.hidden = true;
  return { vivos, maximo, fondo, vacio };
}

/* ------------------------------------------------------------ render settings */
const render = { ...RENDER_DEFAULTS };
const fpsTope = () => Number(render.fps) || 0;
const escalaRes = () => (render.halfres ? 0.5 : 1);
const tierDe = (q) => (QUALITY_OPTIONS.indexOf(q) > 0 ? QUALITY_OPTIONS.indexOf(q) - 1 : undefined);
function opcionesGranos() {
  if (render.dustgrains === 'mass') {
    return { physicalGrainCount: undefined, dustMassSolar: 0.03, grainRadiusMicrons: 0.1, grainDensityKgM3: 3000 };
  }
  return { physicalGrainCount: Number(render.dustgrains), dustMassSolar: undefined };
}

/* ------------------------------------------------------------ the system */
/* loop state (below): here because mounting a scene already asks for a frame */
let pedido = 0;
let sucio = true;
let ultimoDibujo = 0;
let ultimoRitmo = 0;
let compruebaEn = 0;
let pausado = false;
const contador = { cuadros: 0, desde: 0, msCpu: 0, fps: 0, cpu: 0, gpu: null, dibujadas: 0, enviadas: 0 };
const finExplosion = new Map();
let sel = null;
let modo = 'orbit';
let msGenerada = 0;
/** The example the scene started from (the hash writes the groups against it), or null. */
let escenaBase = null;

const sistema = createDustSystem({
  renderer,
  adaptive: true,
  /* the adaptive LOD aims at the frame cap; with a GPU timer the dust stays
   * under half the frame instead of filling the card */
  targetFrameMs: 1000 / 60,
  measureGpuTime: true,
  resolutionScale: 1,
  minPointPx: 0,
  lightReferenceSamples: LUZ_REFERENCIA,
  ...opcionesGranos()
});
scene.add(sistema.object3d);

/** The engine of the selected group (or null). */
const motor = () => (sel && sistema.getGroup(sel) ? sistema.getGroup(sel).engine : null);
const spec = () => (sel && sistema.getGroup(sel) ? sistema.getGroup(sel).spec : null);

/* ------------------------------------------------------------ orbit camera */
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
const vistaJson = () => ({
  target: vista.target.toArray().map((n) => Math.round(n * 1e4) / 1e4),
  azimuth: Math.round(vista.azimuth * 1e4) / 1e4,
  elevation: Math.round(vista.elevation * 1e4) / 1e4,
  distance: Math.round(vista.distance * 1e4) / 1e4
});
/** The view the link carries: the one the user left, not where the auto-rotation is. */
let vistaGuardada = vistaJson();
function ponVista(v) {
  const t = v && Array.isArray(v.target) ? v.target : [0, 0, 0];
  vista.target.set(Number(t[0]) || 0, Number(t[1]) || 0, Number(t[2]) || 0);
  vista.azimuth = Number.isFinite(v && v.azimuth) ? v.azimuth : 0;
  vista.elevation = Number.isFinite(v && v.elevation) ? THREE.MathUtils.clamp(v.elevation, -1.45, 1.45) : 0;
  vista.distance = Number.isFinite(v && v.distance) ? THREE.MathUtils.clamp(v.distance, 1.2, 14) : 3.2;
  aplicaVista();
  vistaGuardada = vistaJson();
}
function fijaVista() {
  vistaGuardada = vistaJson();
  guardaHash();
}
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
  syncTransformacion();
  guardaHash();
  pide();
});
function colocaGizmo() {
  const g = sel ? sistema.getGroup(sel) : null;
  if (modo === 'move' && g) {
    if (gizmo.object !== g.object3d) gizmo.attach(g.object3d);
    gizmo.setMode(ui.get('gizmo').get());
  } else if (gizmo.object) {
    gizmo.detach();
  }
}
/* A regenerated cloud is another Object3D: the gizmo moves to the new one. */
sistema.on('rebuild', (e) => {
  compruebaEn = 1;
  if (e.id === sel) colocaGizmo();
});

/* ------------------------------------------------------------ the panel */
const gui = new Panel('Nebula Dust Engine', $('panel'), { storageKey: 'nebula-dust-demo' });
const ui = gui.controllers;
/* on a phone the panel starts folded, whatever was remembered */
if (ESTRECHO || MOVIL) gui.setCollapsed(true, { save: false });
const help = $('help');
gui.rows.appendChild(help);
help.hidden = false;
gui.addSection('Keys', { key: 'keys', open: !MOVIL });
const teclas = $('keys');
teclas.hidden = false;
gui.addElement(teclas, { key: 'keys-table' });
gui.endSection();

const presetOptions = () => [
  ['', 'None (shape only)'],
  ...PRESET_GROUPS.map(([group, keys]) => ({ group, items: keys.filter((k) => NOMBRES.includes(k)).map((k) => [k, nombrePreset(k)]) })),
  ...NOMBRES.filter((k) => !PRESET_GROUPS.some(([, l]) => l.includes(k))).map((k) => [k, nombrePreset(k)])
];
gui.addSelect('Preset', '', presetOptions(), {
  key: 'preset',
  title: 'The look of the selected group. ← and → step through them; it keeps where the group is.',
  onChange: (v) => cambiaPreset(v),
  buttons: [
    { label: '‹', key: 'preset-prev', title: 'Previous preset (←)', ariaLabel: 'Previous preset', onClick: () => pasoPreset(-1), before: true },
    { label: '›', key: 'preset-next', title: 'Next preset (→)', ariaLabel: 'Next preset', onClick: () => pasoPreset(1) }
  ]
});
gui.addSegmented('Mode', 'orbit', MODES.map(([v, t, h], i) => [v, t, h + ' (' + (i + 1) + ')']), {
  key: 'mode', onChange: (v) => ponModo(v), randomizable: false
});
gui.addNote(MODES[0][2], { key: 'mode-help' });
gui.addSelect('Sow', 'interstellarDust', [
  ...PRESET_GROUPS.map(([group, keys]) => ({ group, items: keys.filter((k) => NOMBRES.includes(k)).map((k) => [k, nombrePreset(k)]) })),
  { group: 'Shape only', items: DUST_MORPHOLOGIES.map((k) => ['shape:' + k, SHAPES[k] || k]) }
], { key: 'sow', title: 'What a tap plants in Sow mode.', randomizable: false });
gui.addSlider('Sow size', 0.45, 0.1, 2, 0.01, { key: 'sowsize', title: 'Scale of the clouds a tap plants.', randomizable: false });
gui.addSegmented('Gizmo', 'translate', [['translate', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']], {
  key: 'gizmo', onChange: () => colocaGizmo(), randomizable: false
});
gui.addSlider('Touch radius', 0.3, 0.05, 1.5, 0.01, { key: 'touchradius', randomizable: false });
gui.addSlider('Touch strength', 0.45, 0.05, 1.5, 0.01, { key: 'touchstrength', randomizable: false });

/* Scene */
gui.addTab('Scene');
gui.addSection('Examples', { key: 'examples' });
gui.addSelect('Example', '', [['', 'Choose an example…'], ...Object.entries(SCENES)], {
  key: 'example', title: 'Scenes made of several groups.', randomizable: false,
  onChange: (v) => { if (v) cargaEjemplo(v); }
});
gui.addButtons([
  { label: 'Save JSON', key: 'save', title: 'Download the scene as a JSON file', onClick: () => guardar() },
  { label: 'Load JSON', key: 'load', title: 'Open a scene file', onClick: () => { const f = $('file'); if (typeof f.click === 'function') f.click(); } }
]);
gui.addButtons([
  { label: 'Copy link', key: 'link', title: 'Copy the address: the whole scene is in it', onClick: () => copiaEnlace() },
  { label: 'Clear', key: 'clear', title: 'Remove every group', onClick: () => vaciar() }
]);
gui.addSection('Groups', { key: 'groups' });
const lista = document.createElement('ul');
lista.className = 'group-list';
lista.id = 'group-list';
lista.setAttribute('aria-label', 'Dust groups');
gui.addElement(lista, { key: 'group-list' });
gui.addButtons([
  { label: 'Add', key: 'add', title: 'A group of the current preset at the center of the view', onClick: () => anadir() },
  { label: 'Duplicate', key: 'duplicate', title: 'A copy with another seed', onClick: () => duplicar() },
  { label: 'Hide', key: 'hide', onClick: () => ocultar() },
  { label: 'Delete', key: 'delete', onClick: () => borrar() }
]);
gui.addSection('View', { key: 'view' });
gui.addCheckbox('Auto-rotate', render.spin, { key: 'spin', title: 'Off, a still scene costs the GPU nothing.', onChange: (v) => aplicaRender({ spin: v }) });
gui.addSelect('Layers', render.layers, [['all', 'All'], ['0', 'Only 0'], ['1', 'Only 1'], ['2', 'Only 2'], ['3', 'Only 3']], {
  key: 'layers', title: 'Which layers the camera sees.', randomizable: false, onChange: (v) => aplicaRender({ layers: v })
});
gui.addButtons([{ label: 'Reset view', key: 'resetview', onClick: () => restableceVista() }]);

/* Group */
gui.addTab('Group');
const notaGrupo = gui.addNote('No groups: press Add or sow one in the scene.', { key: 'nogroup' });
const secciones = [];
secciones.push(gui.addSection('Look', { key: 'look' }));
gui.addNote('', { key: 'about' });
gui.addText('Name', '', { key: 'name', maxLength: 120, onChange: (v) => cambia({ name: v.trim() || null }) });
gui.addText('Seed', '', {
  key: 'seed',
  title: 'The same seed always grows the same cloud. Digits are a number, anything else is hashed.',
  onChange: (v) => { const s = parseSeed(v); if (s !== undefined) cambia({ seed: s }, true); },
  button: { label: 'New', key: 'newseed', title: 'A new random seed', onClick: () => cambia({ seed: randomDustSeed() }, true) }
});
gui.addSelect('Samples', 'auto', SAMPLES.map(([v, t]) => (MOVIL && Number(v) > 1000000 ? [v, t + ' (desktop only)', true] : [v, t])), {
  key: 'samples', title: 'GPU samples of this group; the scene shares its budget between groups.', randomizable: false,
  onChange: (v) => cambia({ count: v === 'auto' ? null : Number(v) }, true)
});
gui.addSelect('Shape', '', [['', "The preset's"], ...DUST_MORPHOLOGIES.map((k) => [k, SHAPES[k] || k])], {
  key: 'shape',
  onChange: (v) => {
    const s = spec();
    cambia({ morphology: v || (s && s.preset ? nebulaDustOptions(s.preset).morphology : 'diffuse') }, true);
  }
});
for (const [morfologia, filas] of Object.entries(SHAPE_CONTROLS)) {
  for (const [k, label, min, max, step, def] of filas) {
    gui.addSlider(label, def ?? min, min, max, step, {
      key: 'shape-' + k, title: SHAPES[morfologia] + ' parameter.',
      onChange: (v) => cambia({ shape: { [k]: v } }, true)
    });
  }
  if (morfologia === 'pinwheel') {
    gui.addSegmented('Sense', '1', [['1', '+1'], ['-1', '−1']], {
      key: 'shape-spiralSense', title: 'Which way the spiral winds.',
      onChange: (v) => cambia({ shape: { spiralSense: Number(v) } }, true)
    });
  }
}
secciones.push(gui.addSection('Color', { key: 'color' }));
gui.addSelect('Palette', '', [['', "The shape's"], ...DUST_PALETTES.map((k) => [k, PALETTES[k] || k]), ['custom', 'Custom colors']], {
  key: 'palette',
  onChange: (v) => {
    if (v === 'custom') cambia({ colors: ui.get('colors').get() });
    else cambia({ palette: v || null });
  }
});
gui.addColors('Colors', ['#ffffff', '#ffffff', '#ffffff', '#ffffff'], { key: 'colors', onChange: (list) => cambia({ colors: list }) });
gui.addColor('Tint', '#ffffff', { key: 'tint', title: 'Multiplies every color of the group.', onChange: (v) => cambia({ tint: v }) });
secciones.push(gui.addSection('Material', { key: 'material' }));
gui.addSelect('Volume', '', [['', "The shape's"], ...DUST_VOLUME_PROFILES.map((k) => [k, VOLUMES[k] || k])], {
  key: 'volume', title: 'How the density falls off: mist, balanced, dense or emissive.',
  onChange: (v) => cambia({ volumeProfile: v || null }, true)
});
gui.addSegmented('Blend', 'normal', [['normal', 'Dust', 'Hides what is behind it'], ['additive', 'Light', 'Adds up like glowing gas']], {
  key: 'blend', onChange: (v) => cambia({ blending: v })
});
gui.addSlider('Opacity', 0.86, 0, 1, 0.01, { key: 'opacity', range: [0.3, 1], onChange: (v) => cambia({ opacity: v }) });
gui.addSlider('Sample size', 1, 0.2, 3, 0.01, { key: 'size', range: [0.5, 2], onChange: (v) => cambia({ size: v }) });
gui.addSlider('Max point size', 3.8, 0.5, 16, 0.1, { key: 'maxpx', range: [1.5, 8], title: 'Largest a sample can be drawn, in pixels.', onChange: (v) => cambia({ maxPointSize: v }) });
secciones.push(gui.addSection('Transform', { key: 'transform' }));
for (const [i, eje] of ['X', 'Y', 'Z'].entries()) {
  gui.addSlider('Position ' + eje, 0, -4, 4, 0.01, { key: 'pos' + eje.toLowerCase(), range: [-1, 1], onChange: (v) => mueveEje('position', i, v) });
}
for (const [i, eje] of ['X', 'Y', 'Z'].entries()) {
  gui.addSlider('Rotation ' + eje, 0, -180, 180, 1, { key: 'rot' + eje.toLowerCase(), onChange: (v) => mueveEje('rotation', i, v / GRADOS) });
}
gui.addSlider('Scale', 1, 0.05, 4, 0.01, { key: 'scale', range: [0.4, 2], onChange: (v) => escalaGrupo(v) });
gui.addSlider('Order', 1, 0, 10, 1, { key: 'order', title: 'Draw order: higher is drawn later, on top.', randomizable: false, onChange: (v) => cambia({ order: v }) });
gui.addSegmented('Layer', '0', [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], {
  key: 'layer', title: 'Camera layer of the group (see View · Layers).', randomizable: false, onChange: (v) => cambia({ layer: Number(v) })
});
secciones.push(gui.addSection('Motion', { key: 'motion' }));
gui.addSlider('Flow', 0, 0, 4, 0.01, { key: 'flow', range: [0, 1.5], title: 'Orbits and infall of the disks, arms and shells.', onChange: (v) => cambia({ flowSpeed: v }) });
gui.addSlider('Turbulence', 0, 0, 1, 0.01, { key: 'turbulence', range: [0, 0.5], onChange: (v) => cambia({ motion: v }) });
gui.addSlider('Explosion', 1, 0, 1, 0.001, { key: 'explosion', title: 'How far the ejecta have gone.', onChange: (v) => mueveExplosion(v) });
gui.addButtons([{ label: 'Restart explosion', key: 'restart', onClick: () => reiniciaExplosion() }]);
gui.endSection();
gui.addButtons([{ label: 'Reset group', key: 'resetgroup', title: "Back to the preset's values; keeps where it is", onClick: () => restableceGrupo() }]);

/* Render */
gui.addTab('Render');
gui.addSection('Quality', { key: 'quality' });
gui.addSelect('Quality', render.quality, QUALITY_OPTIONS.map((q, i) => (MOVIL && i > 2 ? [q, QUALITIES[q] + ' (desktop only)', true] : [q, QUALITIES[q]])), {
  key: 'quality', title: "Samples per group when a group's count is Auto.", randomizable: false,
  onChange: (v) => aplicaRender({ quality: v })
});
gui.addSelect('Sample budget', String(render.budget), BUDGET_OPTIONS.map((b) => [b, BUDGETS[b]]), {
  key: 'budget', title: 'The most samples the whole scene holds; groups share it in proportion.', randomizable: false,
  onChange: (v) => aplicaRender({ budget: Number(v) })
});
gui.addCheckbox('Adaptive', render.adaptive, { key: 'adaptive', title: 'Draw fewer samples when a frame runs late (the light is kept).', onChange: (v) => aplicaRender({ adaptive: v }) });
gui.addSelect('Frame cap', String(render.fps), [['30', '30 fps'], ['60', '60 fps'], ['120', '120 fps'], ['0', 'Off']], {
  key: 'fps', randomizable: false, onChange: (v) => aplicaRender({ fps: Number(v) })
});
gui.addCheckbox('Half resolution', render.halfres, { key: 'halfres', title: 'A quarter of the pixels.', onChange: (v) => aplicaRender({ halfres: v }) });
gui.addCheckbox('Cull tiny samples', render.cull, { key: 'cull', title: 'Draw a share of the samples under half a pixel, with the same light: faster, a little grainier.', onChange: (v) => aplicaRender({ cull: v }) });
gui.addSelect('Dust grains', render.dustgrains, GRAIN_OPTIONS.map((g) => [g, GRAINS[g] || g]), {
  key: 'dustgrains', title: 'How many real grains the samples stand for (shown in Stats).', randomizable: false,
  onChange: (v) => aplicaRender({ dustgrains: v })
});
gui.addSection('Post', { key: 'post' });
const R = RENDER_SPEC;
gui.addSlider('Exposure', render.exposure, R.exposure.min, R.exposure.max, R.exposure.step, { key: 'exposure', range: [4, 14], onChange: (v) => aplicaRender({ exposure: v }) });
gui.addCheckbox('ACES tone mapping', render.aces, { key: 'aces', title: 'Filmic curve; off, the light is clipped.', onChange: (v) => aplicaRender({ aces: v }) });
gui.addSlider('Bloom', render.bloom, R.bloom.min, R.bloom.max, R.bloom.step, { key: 'bloom', range: [0, 1.2], title: 'Glow around the bright parts. At 0 it costs nothing.', onChange: (v) => aplicaRender({ bloom: v }) });
gui.addSlider('Bloom radius', render.bloomradius, R.bloomradius.min, R.bloomradius.max, R.bloomradius.step, { key: 'bloomradius', onChange: (v) => aplicaRender({ bloomradius: v }) });
gui.addSlider('Bloom threshold', render.bloomthreshold, R.bloomthreshold.min, R.bloomthreshold.max, R.bloomthreshold.step, { key: 'bloomthreshold', range: [0.4, 2], onChange: (v) => aplicaRender({ bloomthreshold: v }) });
gui.addSlider('Grain', render.grain, R.grain.min, R.grain.max, R.grain.step, { key: 'grain', range: [0, 0.05], onChange: (v) => aplicaRender({ grain: v }) });
gui.addSlider('Vignette', render.vignette, R.vignette.min, R.vignette.max, R.vignette.step, { key: 'vignette', range: [0, 0.6], onChange: (v) => aplicaRender({ vignette: v }) });
gui.endSection();
gui.addButtons([{ label: 'Reset render', key: 'resetrender', onClick: () => restableceRender() }]);

/* Stats */
gui.addTab('Stats');
gui.addStat('FPS', { key: 'fpsnow', title: 'Frames drawn per second; idle when nothing changes and the GPU rests.' });
gui.addStat('CPU', { key: 'cpu', title: 'CPU time per drawn frame.' });
gui.addStat('GPU', { key: 'gpu', title: 'GPU time per frame (timer query), when the driver reports it.' });
gui.addStat('Drawn', { key: 'drawn', title: 'Samples that reach a pixel this frame.' });
gui.addStat('Sent', { key: 'sent', title: 'Samples sent to the GPU; the light is kept when fewer are sent.' });
gui.addStat('Samples', { key: 'allocated', title: 'Samples in the scene and its budget.' });
gui.addMonitor('Groups', { key: 'groups' });
gui.addMonitor('Grains', { key: 'grains', title: 'Real dust grains the selected group stands for.' });
gui.addMonitor('Grains per sample', { key: 'pergrain' });
gui.addMonitor('GPU tier', { key: 'tier' });
gui.addMonitor('Generated in', { key: 'generated', title: 'Time to grow the selected cloud.' });
const stat = (k) => ui.get(k);

/* ------------------------------------------------------------ panel ← state */
function pintaLista() {
  lista.textContent = '';
  for (const g of sistema.listGroups()) {
    const li = document.createElement('li');
    li.dataset.group = g.id;
    if (g.id === sel) li.classList.add('active');
    if (!g.visible) li.classList.add('off');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'group-pick';
    b.dataset.action = 'pick';
    b.textContent = g.name + ' · ' + corto(g.sampleCount);
    const v = document.createElement('button');
    v.type = 'button';
    v.className = 'group-eye';
    v.dataset.action = 'eye';
    v.textContent = g.visible ? 'Hide' : 'Show';
    v.setAttribute('aria-label', (g.visible ? 'Hide ' : 'Show ') + g.name);
    li.appendChild(b);
    li.appendChild(v);
    lista.appendChild(li);
  }
  const s = spec();
  ui.get('hide').setLabel(s && !s.visible ? 'Show' : 'Hide');
  for (const k of ['duplicate', 'hide', 'delete']) ui.get(k).setDisabled(!s);
}

function syncTransformacion() {
  const s = spec();
  if (!s) return;
  ['x', 'y', 'z'].forEach((e, i) => {
    ui.get('pos' + e).set(s.position[i]);
    ui.get('rot' + e).set(Math.round(s.rotation[i] * GRADOS));
  });
  ui.get('scale').set(Math.max(...s.scale.map(Math.abs)));
}

function explosionVisible(s) {
  return Boolean(s) && (s.evolutionRate > 0 || s.morphology === 'supernovaEjecta');
}

/** Every control of the Group tab from the selected group's spec. */
function syncGrupo() {
  const s = spec();
  pintaLista();
  gui.setSubtitle(s ? s.name : '');
  notaGrupo.setHidden(Boolean(s));
  for (const sec of secciones) sec.setHidden(!s);
  ui.get('resetgroup').setHidden(!s);
  ui.get('preset').set(s ? s.preset || '' : '');
  if (!s) return;
  ui.get('about').set(s.preset && PRESETS[s.preset] ? PRESETS[s.preset][1] : (SHAPES[s.morphology] || s.morphology) + ', no preset.');
  ui.get('name').set(s.name);
  ui.get('seed').set(printSeed(s.seed));
  const muestras = ui.get('samples');
  if (s.count && !muestras.options().some((o) => o.value === String(s.count))) {
    muestras.setOptions([...SAMPLES.map(([v, t]) => (MOVIL && Number(v) > 1000000 ? [v, t, true] : [v, t])), [String(s.count), miles(s.count)]]);
  }
  muestras.set(s.count ? String(s.count) : 'auto');
  ui.get('shape').set(s.morphology);
  for (const [morfologia, filas] of Object.entries(SHAPE_CONTROLS)) {
    for (const [k, , , , , def] of filas) {
      const c = ui.get('shape-' + k);
      c.setHidden(s.morphology !== morfologia);
      const d = k === 'spiralPitch' ? s.radius / 3 : def;
      c.set(k in s.shape ? s.shape[k] : d);
    }
  }
  ui.get('shape-spiralSense').setHidden(s.morphology !== 'pinwheel');
  ui.get('shape-spiralSense').set(s.shape.spiralSense < 0 ? '-1' : '1');
  ui.get('palette').set(s.palette);
  ui.get('colors').setHidden(s.palette !== 'custom');
  ui.get('colors').set(s.palette === 'custom' ? s.colors : (getDustPalette(s.palette) || []).map(dustColorToHex));
  ui.get('tint').set(s.tint);
  ui.get('volume').set(s.volumeProfile);
  ui.get('blend').set(s.blending);
  ui.get('opacity').set(s.opacity);
  ui.get('size').set(s.size);
  ui.get('maxpx').set(s.maxPointSize);
  syncTransformacion();
  ui.get('order').set(s.order);
  ui.get('layer').set(String(s.layer));
  ui.get('flow').set(s.flowSpeed);
  ui.get('turbulence').set(s.motion);
  const hayExplosion = explosionVisible(s);
  ui.get('explosion').setHidden(!hayExplosion);
  ui.get('restart').setHidden(!hayExplosion);
  const e = motor();
  if (e) ui.get('explosion').set(e.getStatus().evolution);
}

function syncRender() {
  for (const k of ['exposure', 'bloom', 'bloomradius', 'bloomthreshold', 'grain', 'vignette']) ui.get(k).set(render[k]);
  for (const k of ['aces', 'adaptive', 'halfres', 'cull', 'spin']) ui.get(k).set(render[k]);
  ui.get('quality').set(render.quality);
  ui.get('budget').set(String(render.budget));
  ui.get('fps').set(String(render.fps));
  ui.get('dustgrains').set(render.dustgrains);
  ui.get('layers').set(render.layers);
}

function syncModo() {
  ui.get('mode').set(modo);
  ui.get('mode-help').set(MODES.find((m) => m[0] === modo)[2]);
  ui.get('sow').setHidden(modo !== 'sow');
  ui.get('sowsize').setHidden(modo !== 'sow');
  ui.get('gizmo').setHidden(modo !== 'move');
  ui.get('touchradius').setHidden(modo !== 'touch');
  ui.get('touchstrength').setHidden(modo !== 'touch');
}

function elige(id) {
  sel = id && sistema.getGroup(id) ? id : (sistema.listGroups()[0]?.id || null);
  colocaGizmo();
  syncGrupo();
  pide();
}

/** Changes the selected group. `pesado` = it regenerates samples (said when it is millions). */
function cambia(patch, pesado = false) {
  if (!sel) return;
  const hazlo = () => {
    const t0 = performance.now();
    sistema.updateGroup(sel, patch);
    if (pesado) msGenerada = performance.now() - t0;
    syncGrupo();
    guardaHash();
    pide();
  };
  /* only when a million or more are asked for explicitly */
  const n = 'count' in patch ? (patch.count || 0) : ((spec() && spec().count) || 0);
  if (pesado && n >= 1000000) {
    avisa('Generating ' + miles(n) + ' samples…', 0);
    setTimeout(() => { hazlo(); toast.hidden = true; }, 30);
  } else {
    hazlo();
  }
}

function mueveEje(clave, eje, valor) {
  const s = spec();
  if (!s || !Number.isFinite(valor)) return;
  const v = s[clave].slice();
  v[eje] = valor;
  cambia({ [clave]: v });
}

function escalaGrupo(t) {
  const s = spec();
  if (!s) return;
  const m = Math.max(...s.scale.map(Math.abs)) || 1;
  cambia({ scale: s.scale.map((v) => v / m * t) });
}

function mueveExplosion(v) {
  const s = spec();
  const e = motor();
  if (!s || !e) return;
  /* a still explosion keeps the value (in the link); a running one is only scrubbed */
  if (s.evolutionRate > 0) {
    e.setEvolution(v);
    finExplosion.delete(sel);
    pide();
  } else {
    cambia({ evolution: v });
  }
}

function reiniciaExplosion() {
  const e = motor();
  if (e) e.restartEvolution(0);
  finExplosion.delete(sel);
  pide();
}

/* ------------------------------------------------------------ render settings → engine */
function aplicaRender(patch, { sync = true, hash = true } = {}) {
  const cambiado = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in RENDER_SPEC)) continue;
    if (render[k] !== v) cambiado[k] = v;
    render[k] = v;
  }
  const s = post.settings;
  s.exposure = render.exposure;
  s.aces = render.aces;
  s.bloom = render.bloom;
  s.bloomRadius = render.bloomradius;
  s.bloomThreshold = render.bloomthreshold;
  s.grain = render.grain;
  s.vignette = render.vignette;
  const sys = {};
  if ('quality' in cambiado) sys.quality = tierDe(render.quality);
  if ('adaptive' in cambiado) sys.adaptive = render.adaptive;
  if ('cull' in cambiado) sys.minPointPx = render.cull ? 0.5 : 0;
  if ('fps' in cambiado) sys.targetFrameMs = 1000 / (fpsTope() || 60);
  if ('dustgrains' in cambiado) Object.assign(sys, opcionesGranos());
  if ('budget' in cambiado) sys.maxTotalSamples = render.budget;
  if ('halfres' in cambiado) {
    renderer.setPixelRatio(DPR_BASE * escalaRes());
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.resize();
    sys.resolutionScale = escalaRes();
  }
  if (Object.keys(sys).length) {
    sistema.setOptions(sys);
    compruebaEn = 1;
  }
  /* always: a new camera sees only layer 0, and "All" has to mean all from the start */
  if (render.layers === 'all') camera.layers.enableAll();
  else camera.layers.set(Number(render.layers));
  if (sync) syncRender();
  if (Object.keys(sys).length && sync) syncGrupo();
  if (hash) guardaHash();
  pide();
}

function restableceRender() {
  const { spin, layers, ...resto } = RENDER_DEFAULTS;
  aplicaRender(resto);
}

/* ------------------------------------------------------------ scenes */
let montadas = 0;
function montaEscena(datos, { seleccion = 0 } = {}) {
  montadas++;
  falloFijo = false;
  const t0 = performance.now();
  const r = sistema.load(datos);
  msGenerada = performance.now() - t0;
  ponVista(r.view);
  /* a file can bring its own budget: kept if the panel offers it */
  const m = sistema.getOptions().maxTotalSamples;
  if (BUDGET_OPTIONS.includes(String(m))) render.budget = m;
  else sistema.setOptions({ maxTotalSamples: render.budget });
  finExplosion.clear();
  compruebaEn = 1;
  elige(r.ids[seleccion] || r.ids[0] || null);
  syncRender();
  return r;
}

function cargaEjemplo(k) {
  montaEscena(DUST_EXAMPLE_SCENES[k]);
  escenaBase = k;
  ui.get('example').set(k);
  guardaHash({ now: true });
}

function cargaPreset(k) {
  montaEscena(presetScene(k));
  escenaBase = null;
  ui.get('example').set('');
  guardaHash({ now: true });
}

function cambiaPreset(k) {
  if (!sel) {
    if (k) anadir(k);
    return;
  }
  cambia({ preset: k || null }, true);
}

/** ← →: the previous or next preset on the selected group (a new group if there is none). */
function pasoPreset(d) {
  const s = spec();
  const n = ORDEN_PRESETS.length;
  const i = s && s.preset ? ORDEN_PRESETS.indexOf(s.preset) : -1;
  const k = ORDEN_PRESETS[i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n];
  if (!s) anadir(k);
  else cambia({ preset: k }, true);
}

/** R: a random preset and seed for the selected group, with its color and sliders rolled within looks that work. */
function lookAleatorio() {
  if (!sel) anadir();
  const s = spec();
  if (!s) return;
  const presets = ORDEN_PRESETS.filter((k) => k !== s.preset);
  const k = presets[Math.floor(random() * presets.length)];
  const base = nebulaDustOptions(k);
  const patch = { preset: k, seed: randomDustSeed() };
  if (random() < 0.4) {
    const paletas = DUST_PALETTES.filter((p) => p !== 'dark');
    patch.palette = paletas[Math.floor(random() * paletas.length)];
  }
  if (random() < 0.3) {
    const h = random();
    patch.tint = '#' + [0, 1, 2].map((c) => Math.round(255 * (0.78 + 0.22 * Math.cos(6.2832 * (h + c / 3))))
      .toString(16).padStart(2, '0')).join('');
  } else {
    patch.tint = '#ffffff';
  }
  patch.opacity = clamp((base.opacity ?? 0.86) * (0.75 + random() * 0.35), 0.25, 1);
  patch.size = clamp((base.particleScale ?? 1) * (0.8 + random() * 0.5), 0.2, 3);
  if (random() < 0.5) patch.motion = Math.round(random() * 35) / 100;
  cambia(patch, true);
}

/* ------------------------------------------------------------ groups */
function anadir(preset) {
  const k = preset || (spec() && spec().preset) || 'interstellarDust';
  const id = sistema.addGroup({
    preset: k, seed: randomDustSeed(), radius: DEMO_RADIUS, position: vista.target.toArray(), order: 1 + sistema.size
  });
  elige(id);
  guardaHash();
  return id;
}

function duplicar() {
  if (!sel) return;
  const s = spec();
  const id = sistema.duplicateGroup(sel, {
    seed: randomDustSeed(),
    position: [s.position[0] + 0.3, s.position[1], s.position[2]]
  });
  elige(id);
  guardaHash();
}

function ocultar() {
  const s = spec();
  if (s) cambia({ visible: !s.visible });
}

function borrar() {
  if (!sel) return;
  sistema.removeGroup(sel);
  finExplosion.delete(sel);
  sel = null;
  elige(null);
  guardaHash();
}

function vaciar() {
  sistema.clear();
  finExplosion.clear();
  sel = null;
  escenaBase = null;
  elige(null);
  ui.get('example').set('');
  guardaHash();
}

function restableceGrupo() {
  if (!sel) return;
  sistema.resetGroup(sel);
  sistema.updateGroup(sel, { count: null });
  syncGrupo();
  guardaHash();
  pide();
}

function restableceVista() {
  ponVista(exampleView(escenaBase));
  guardaHash();
  pide();
}

lista.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  const li = b && b.closest('[data-group]');
  if (!li) return;
  const id = li.dataset.group;
  if (b.dataset.action === 'pick') elige(id);
  else if (b.dataset.action === 'eye') {
    const g = sistema.getGroup(id);
    if (g) sistema.updateGroup(id, { visible: !g.spec.visible });
    if (id === sel) colocaGizmo();
    syncGrupo();
    guardaHash();
  }
  pide();
});

/* ------------------------------------------------------------ the hash
 * After each change the whole scene goes into the hash as readable
 * parameters (hash.js); an example or a preset that was not touched is just
 * #scene=collision or #preset=orion. */
let hashPendiente = 0;
const esperandoHash = [];
function ponHash(h) {
  if (location.hash !== h) history.replaceState(null, '', h);
}
function estadoHash() {
  const idx = sistema.listGroups().findIndex((g) => g.id === sel);
  return { groups: sistema.serialize().groups, view: vistaGuardada, render: { ...render }, selected: Math.max(0, idx), scene: escenaBase };
}
function escribeHash() {
  hashPendiente = 0;
  const h = '#' + encodeHash(estadoHash());
  ponHash(h);
  for (const r of esperandoHash.splice(0)) r(h);
  return h;
}
function guardaHash({ now = false } = {}) {
  if (hashPendiente) clearTimeout(hashPendiente);
  hashPendiente = 0;
  if (now) return escribeHash();
  hashPendiente = setTimeout(escribeHash, 250);
  return null;
}

/** Reads the hash: readable parameters, #s=scene (v0.4.0), #example, #preset (or its alias). */
async function desdeHash() {
  const p = parseHash(location.hash);
  if (p.kind === 'empty') { cargaEjemplo(DEFAULT_SCENE); return; }
  if (p.kind === 'compressed') {
    try {
      montaEscena(await decodeDustScene(p.text));
      escenaBase = null;
      ui.get('example').set('');
      guardaHash({ now: true });
    } catch (e) {
      cargaEjemplo(DEFAULT_SCENE);
      avisaFallo('The link does not carry a valid scene (' + (e && e.message ? e.message : e) + '): the example opens instead.');
      falloFijo = true;
    }
    return;
  }
  if (p.kind === 'name') {
    if (p.scene) cargaEjemplo(p.scene);
    else if (p.preset) cargaPreset(p.preset);
    else {
      cargaEjemplo(DEFAULT_SCENE);
      avisa('Unknown link "' + String(p.unknown).slice(0, 40) + '": the example opens instead.');
    }
    return;
  }
  if (p.onlyRender) {
    /* only render settings: they apply to the scene that is up (the example on a first visit) */
    if (!montadas) {
      montaEscena(DUST_EXAMPLE_SCENES[DEFAULT_SCENE]);
      escenaBase = DEFAULT_SCENE;
      ui.get('example').set(DEFAULT_SCENE);
    }
    aplicaRender(p.render, { hash: false });
  } else {
    /* first away with the old clouds, so the settings below do not rebuild them */
    sistema.clear();
    aplicaRender({ ...RENDER_DEFAULTS, ...p.render }, { hash: false });
    montaEscena(p.scene, { seleccion: p.selected });
    escenaBase = p.example;
    ui.get('example').set(p.example || '');
  }
  guardaHash({ now: true });
  if (p.warnings.length) avisa('Ignored in the link: ' + p.warnings.join(', '));
}
window.addEventListener('hashchange', () => { desdeHash().then(pide); });

/* ------------------------------------------------------------ save and load */
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
function guardar() {
  descarga(jsonEscena(), 'nebula-dust-scene.json');
  avisa('Scene saved as nebula-dust-scene.json');
}
function importaJson(texto) {
  try {
    montaEscena(JSON.parse(texto));
    escenaBase = null;
    ui.get('example').set('');
    guardaHash({ now: true });
    avisa('Scene loaded: ' + sistema.size + (sistema.size === 1 ? ' group.' : ' groups.'));
    return true;
  } catch (e) {
    avisaFallo('That file is not a Nebula Dust Engine scene: ' + (e && e.message ? e.message : e));
    return false;
  }
}
$('file').addEventListener('change', () => {
  const input = $('file');
  const f = input.files && input.files[0];
  if (!f) return;
  Promise.resolve(typeof f.text === 'function' ? f.text() : '').then((t) => { importaJson(t); pide(); });
  input.value = '';
});
function copiaEnlace() {
  guardaHash({ now: true });
  const url = String(location.href);
  const portapapeles = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(url) : Promise.reject(new Error('no clipboard'));
  return portapapeles.then(() => avisa('Link copied: the whole scene is in it.'), () => avisa('The link is in the address bar.'));
}

/* ------------------------------------------------------------ modes */
function ponModo(m) {
  if (!MODES.some((x) => x[0] === m)) return;
  modo = m;
  syncModo();
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
const capaVista = () => (render.layers === 'all' ? undefined : Number(render.layers));

function eligeEn(x, y) {
  const hit = sistema.pick(rayoDe(x, y), { layer: capaVista() });
  if (hit) elige(hit.id);
  return hit;
}

function siembraEn(x, y) {
  const punto = projectToViewPlane(rayoDe(x, y), camera, vista.target);
  if (!punto) return null;
  const v = ui.get('sow').get();
  const t = ui.get('sowsize').get() || 0.45;
  const base = v.startsWith('shape:')
    ? { morphology: v.slice(6), name: SHAPES[v.slice(6)] || v.slice(6) }
    : { preset: v, name: nombrePreset(v) };
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
  const n = sistema.touch(punto, { radius: ui.get('touchradius').get(), strength: ui.get('touchstrength').get() });
  pide();
  return n;
}

/* ------------------------------------------------------------ pause, fullscreen, hiding the interface */
const btnPausa = $('pause');
const btnAzar = $('randomize');
const btnPantalla = $('fullscreen');
const btnInterfaz = $('ui-toggle');

function ponPausa(on) {
  pausado = Boolean(on);
  btnPausa.setAttribute('aria-pressed', String(pausado));
  btnPausa.setAttribute('aria-label', pausado ? 'Play' : 'Pause');
  btnPausa.title = pausado ? 'Play (Space)' : 'Pause (Space)';
  pide();
}

/* The whole page, not the canvas: the panel and the buttons have to stay reachable. */
function pantallaCompleta() {
  const d = document;
  if (d.fullscreenElement) {
    if (typeof d.exitFullscreen === 'function') {
      const p = d.exitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } else if (d.documentElement && typeof d.documentElement.requestFullscreen === 'function') {
    const p = d.documentElement.requestFullscreen();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}
document.addEventListener('fullscreenchange', () => {
  const on = Boolean(document.fullscreenElement);
  btnPantalla.setAttribute('aria-pressed', String(on));
  btnPantalla.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
});

function ocultaInterfaz(on) {
  document.body.classList.toggle('ui-hidden', Boolean(on));
  btnInterfaz.setAttribute('aria-pressed', String(Boolean(on)));
  const texto = on ? 'Show the interface' : 'Hide the interface';
  btnInterfaz.setAttribute('aria-label', texto);
  btnInterfaz.title = texto + ' (Tab)';
}

btnPausa.addEventListener('click', () => ponPausa(!pausado));
btnAzar.addEventListener('click', () => { btnAzar.classList.toggle('turned'); lookAleatorio(); });
/* no Fullscreen API (an iPhone): no button, as in bumpy-metaballs */
btnPantalla.hidden = !document.fullscreenEnabled;
btnPantalla.addEventListener('click', () => pantallaCompleta());
btnInterfaz.addEventListener('click', () => ocultaInterfaz(!document.body.classList.contains('ui-hidden')));
$('buttons').hidden = false;

/* ------------------------------------------------------------ keys (guspira's rules: not while typing, not with Ctrl) */
bindKey('ArrowRight', () => pasoPreset(1));
bindKey('ArrowLeft', () => pasoPreset(-1));
bindKey('KeyR', () => lookAleatorio());
bindKey('Space', () => ponPausa(!pausado));
bindKey('KeyF', () => pantallaCompleta());
bindKey('Tab', (e) => {
  /* inside the panel and the buttons, Tab still moves the focus */
  if (e.target && typeof e.target.closest === 'function' && e.target.closest('#panel, #buttons')) return false;
  ocultaInterfaz(!document.body.classList.contains('ui-hidden'));
  return true;
});
MODES.forEach(([m], i) => bindKey('Digit' + (i + 1), () => ponModo(m)));

/* ------------------------------------------------------------ mouse and fingers
 * One finger or the mouse does what the mode says (orbit, sow, move, touch);
 * a short tap without dragging selects the group under it (or sows, in Sow);
 * two fingers pinch to zoom in any mode; the wheel zooms. A double click, or
 * a double tap, in Orbit goes fullscreen. */
const punteros = new Map();
let distPellizco = 0;
let pellizco = false;
let inicioToque = null;
let ultimoPuntero = 'mouse';
let ultimoToque = null;
const acerca = (f) => {
  vista.distance = THREE.MathUtils.clamp(vista.distance * f, 1.2, 14);
  aplicaVista();
  pide();
};
function dobleToque(e) {
  const t = performance.now();
  if (ultimoToque && t - ultimoToque.t < 350 && Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) < 40) {
    ultimoToque = null;
    pantallaCompleta();
  } else {
    ultimoToque = { t, x: e.clientX, y: e.clientY };
  }
}
const lienzo = renderer.domElement;
lienzo.addEventListener('pointerdown', (e) => {
  ultimoPuntero = e.pointerType || 'mouse';
  punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (typeof lienzo.setPointerCapture === 'function') {
    try { lienzo.setPointerCapture(e.pointerId); } catch { /* nothing */ }
  }
  if (punteros.size === 1) {
    inicioToque = { x: e.clientX, y: e.clientY, t: performance.now(), movido: 0 };
    if (modo === 'touch') tocaEn(e.clientX, e.clientY);
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
      if (modo === 'sow') siembraEn(e.clientX, e.clientY);
      else if (modo === 'orbit' || modo === 'move') eligeEn(e.clientX, e.clientY);
      if (modo === 'orbit' && e.pointerType === 'touch') dobleToque(e);
    } else if (modo !== 'touch') {
      fijaVista();
    }
  }
  if (punteros.size === 0) {
    if (pellizco) fijaVista();
    pellizco = false;
    inicioToque = null;
  }
  pide();
};
lienzo.addEventListener('pointerup', suelta);
lienzo.addEventListener('pointercancel', suelta);
lienzo.addEventListener('pointermove', (e) => {
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
    pellizco = true;
    return;
  }
  if (punteros.size !== 1) return;
  if (modo === 'touch') { tocaEn(e.clientX, e.clientY); return; }
  if (modo === 'move' && arrastrandoGizmo) return;
  vista.azimuth -= dx * 0.006;
  vista.elevation = THREE.MathUtils.clamp(vista.elevation + dy * 0.006, -1.45, 1.45);
  aplicaVista();
  pide();
});
lienzo.addEventListener('wheel', (e) => {
  e.preventDefault();
  acerca(Math.exp(e.deltaY * 0.001));
  fijaVista();
}, { passive: false });
lienzo.addEventListener('dblclick', () => {
  if (ultimoPuntero !== 'touch' && modo === 'orbit') pantallaCompleta();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.resize();
  pide();
});

/* ------------------------------------------------------------ loop
 * A frame is drawn only when something changes (auto-rotation, turbulence,
 * flow, explosion, a touch, a control or the camera), at most at the frame
 * cap, and never with the tab hidden or while paused. Still, the GPU rests. */
function anima() {
  if (pausado) return punteros.size > 0;
  return render.spin || punteros.size > 0 || finExplosion.size > 0 || sistema.isAnimated();
}
let detenido = false;
function programa() {
  if (!pedido && !document.hidden && !detenido) pedido = requestAnimationFrame(frame);
}
function pide() {
  sucio = true;
  programa();
}

/** Explosions start again 2.5 s after they end. */
function cicloExplosiones(now) {
  const explosion = ui.get('explosion');
  for (const g of sistema.listGroups()) {
    if (!g.visible) continue;
    const e = sistema.getGroup(g.id).engine;
    const st = e.getStatus();
    if (!(st.evolutionRate > 0)) { finExplosion.delete(g.id); continue; }
    if (st.evolution >= 1) {
      if (!finExplosion.has(g.id)) finExplosion.set(g.id, now);
      else if (now - finExplosion.get(g.id) > 2500) { e.restartEvolution(0); finExplosion.delete(g.id); }
    }
    if (g.id === sel && !explosion.hidden && document.activeElement !== explosion.input) explosion.set(st.evolution);
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
  /* the pace follows the cap's grid, so a 144 Hz screen does not lose frames */
  const pasado = now - ultimoRitmo;
  ultimoRitmo = intervalo && ultimoRitmo && pasado < intervalo * 3
    ? ultimoRitmo + intervalo * Math.max(1, Math.floor(pasado / intervalo))
    : now;
  ultimoDibujo = now;
  sucio = false;

  const t0 = performance.now();
  if (render.spin && !pausado && punteros.size === 0) {
    vista.azimuth += deltaSeconds * 0.035;
    aplicaVista();
  }
  sistema.update(camera, pausado ? 0 : deltaSeconds);
  if (!pausado) cicloExplosiones(now);
  const midiendo = sistema.beginGpuFrame();
  post.begin();
  renderer.render(scene, camera);
  post.finish();
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
  const tope = fpsTope();
  stat('fpsnow').set(quieto ? (pausado ? 'paused' : 'idle') : Math.round(contador.fps) + ' fps', tope ? 'cap ' + tope : 'no cap',
    !quieto && tope > 0 && contador.fps < tope * 0.8);
  stat('cpu').set(contador.cpu.toFixed(2) + ' ms');
  stat('gpu').set(contador.gpu != null ? contador.gpu.toFixed(2) + ' ms' : 'n/a', '', contador.gpu != null && contador.gpu > 16.7);
  stat('drawn').set(miles(contador.dibujadas), 'of ' + miles(st.allocatedSamples));
  stat('sent').set(miles(st.visibleSamples),
    (st.allocatedSamples ? Math.round(st.visibleSamples / st.allocatedSamples * 100) + ' %' : '') + (escalaRes() < 1 ? ', half res' : ''));
  stat('allocated').set(miles(st.allocatedSamples), 'budget ' + corto(st.maxTotalSamples) + (st.requestedSamples > st.maxTotalSamples ? ', shared' : ''));
  stat('groups').set(String(st.groups));
  const e = motor();
  const md = e ? e.metadata : null;
  stat('grains').set(md ? grande(md.physicalGrainCount) : '—');
  stat('pergrain').set(md ? grande(md.grainsPerSample) : '—');
  stat('tier').set(md ? String(md.gpuProfile.tier) + ' · ' + md.sampleCount.toLocaleString('en-US') + ' samples' : '—');
  stat('generated').set(msGenerada ? Math.round(msGenerada) + ' ms' : '—');
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

syncModo();
syncRender();
aplicaRender({}, { hash: false });
const listo = desdeHash().then(() => pide());
programa();

window.nebulaDustDemo = {
  /** The engine of the selected group. */
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
  get paused() {
    return pausado;
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
  /** The render settings (a copy): exposure, aces, bloom… as in the hash. */
  get render() {
    return { ...render };
  },
  get panel() {
    return gui;
  },
  get post() {
    return post;
  },
  ready: listo,
  /** Resolves with the hash once the pending write (if any) is done. */
  get hashWritten() {
    return hashPendiente ? new Promise((r) => esperandoHash.push(r)) : Promise.resolve(location.hash);
  },
  flushHash: () => guardaHash({ now: true }),
  hashState: estadoHash,
  maxSamples: MAX_GPU_SAMPLE_COUNT,
  checkCanvas: compruebaLienzo,
  select: elige,
  setMode: ponModo,
  setPaused: ponPausa,
  setRender: (patch) => aplicaRender(patch),
  stepPreset: pasoPreset,
  randomize: lookAleatorio,
  toggleFullscreen: pantallaCompleta,
  setInterfaceHidden: ocultaInterfaz,
  loadExample: cargaEjemplo,
  exportJSON: jsonEscena,
  importJSON: importaJson,
  copyLink: copiaEnlace,
  sowAt: siembraEn,
  touchAt: tocaEn,
  pickAt: eligeEn,
  /** Stops the demo and frees the GPU (to embed it and take it away). */
  stop() {
    detenido = true;
    if (pedido) cancelAnimationFrame(pedido);
    pedido = 0;
    if (hashPendiente) clearTimeout(hashPendiente);
    hashPendiente = 0;
    unbindAllKeys();
    gizmo.detach();
    if (typeof gizmo.dispose === 'function') gizmo.dispose();
    sistema.dispose();
    post.dispose();
  },
  selectPreset(name) {
    const k = resolveNebulaDustPresetName(name);
    if (!k) throw new Error('Unknown preset: ' + name);
    cargaPreset(k);
  },
  /** A compressed #s=… link of the scene (the v0.4.0 format; still read). */
  compressedLink: () => encodeDustScene(sistema.serialize({ view: vistaJson() })).then((t) => '#s=' + t)
};
