/**
 * EL EDITOR DE LA DEMO, DE PUNTA A PUNTA, SIN NAVEGADOR (panel nuevo, 29/9/2026)
 * ------------------------------------------------------------------
 * Monta demo/index.html + demo/main.js (con panel.js, hash.js y post.js) en
 * Node con un DOM de verdad pequeño (eventos que burbujean, selectores, foco,
 * pantalla completa, portapapeles, localStorage) y un WebGLRenderer falso que
 * se hace pasar por una RTX 4090 con cronómetro de GPU, y comprueba:
 *
 *  1. lo que importa cada fichero de la demo existe (three, el motor, la demo);
 *  2. los ids del HTML y del JS, y que cada ui.get('x') del JS es un control;
 *  3. el arranque: la escena de dos grupos, el panel (título, ayuda, teclas,
 *     créditos, pestañas), los botones y el hash legible #scene=twinNebula;
 *  4. los 14 presets en el grupo elegido, sin NaN, con el shader compilado y
 *     el hash #scene=twinNebula&preset=<k>;
 *  5. TODOS los controles del panel: cada opción de cada selector, mínimo,
 *     medio y máximo de cada deslizador, interruptores, colores, textos,
 *     segmentos y botones, con su efecto en la spec, el motor, el renderer o
 *     el posproceso; y que no queda ningún control sin probar;
 *  6. los grupos: añadir, duplicar, ocultar (botón y fila), elegir, borrar;
 *  7. los modos (botones y teclas 1-4): sembrar, mover con el gizmo, tocar,
 *     elegir con un toque, pellizcar;
 *  8. las teclas: ← → presets, R azar, Espacio pausa (el reloj se para), Tab
 *     oculta la interfaz, F / doble clic / doble toque pantalla completa, y
 *     nada mientras se escribe ni con Ctrl;
 *  9. el hash legible: ida y vuelta completa (grupos, vista, render), #preset=
 *     con semilla y motas, y los enlaces viejos #s=…, #orion, #m42, #collision,
 *     #choque, además de hashchange, un hash roto y uno desconocido;
 * 10. guardar y cargar JSON, copiar el enlace, vaciar y los tres ejemplos;
 * 11. el rendimiento: quieto no dibuja, tope de 60 fps en 144 Hz, sin tope,
 *     pestaña oculta, 4 M de motas;
 * 12. el negro de producción (HalfFloat, pasada de gradación, luz de
 *     referencia, lienzo vacío, shader roto) y los shaders del posproceso
 *     compilados con glslang;
 * 13. el móvil: panel plegado, 2 y 4 M y calidades altas deshabilitadas,
 *     sembrar, pellizcar y doble toque con el dedo.
 *
 * Con --autoprueba reescribe los ficheros de la demo en memoria con fallos
 * conocidos y exige que la prueba salte en cada uno.
 *
 *     node test/demo-dom.mjs [--autoprueba]
 *     THREE_ADDONS_DIR=<three>/examples/jsm node test/demo-dom.mjs   (gizmo real)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOTOR = path.resolve(AQUI, '..');
const DEMO = path.join(MOTOR, 'demo');
const HTML = fs.readFileSync(path.join(DEMO, 'index.html'), 'utf8');
const FICHEROS = ['main.js', 'panel.js', 'hash.js', 'post.js'];
const ORIGINAL = Object.fromEntries(FICHEROS.map((f) => [f, fs.readFileSync(path.join(DEMO, f), 'utf8')]));
const AUTO = process.argv.includes('--autoprueba');

/* 'three' → un envoltorio con el three de verdad y un WebGLRenderer falso */
const THREE_REAL = import.meta.resolve('three');
/* los ficheros de la prueba van al temporal, nunca a demo/ */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-dom-'));
const ENVOLTORIO = path.join(TMP, '_three_falso_prueba.mjs');
fs.writeFileSync(ENVOLTORIO, `export * from ${JSON.stringify(THREE_REAL)};
export const WebGLRenderer = globalThis.__RendererFalso;
`);

/* El gizmo: el TransformControls de three si se encuentra; si no, uno de prueba. */
function buscaTransformControls() {
  const candidatos = [];
  if (process.env.THREE_ADDONS_DIR) candidatos.push(path.join(process.env.THREE_ADDONS_DIR, 'controls', 'TransformControls.js'));
  try { candidatos.push(fileURLToPath(import.meta.resolve('three/addons/controls/TransformControls.js'))); } catch { /* no está */ }
  return candidatos.find((f) => fs.existsSync(f)) || null;
}
const TC_REAL = buscaTransformControls();
const TC_STUB = path.join(TMP, '_tc_prueba.mjs');
fs.writeFileSync(TC_STUB, `import { EventDispatcher, Object3D } from ${JSON.stringify(THREE_REAL)};
/* Misma interfaz que TransformControls (r169+): attach, detach, setMode, getHelper,
 * pointerDown/Move/Up con coordenadas normalizadas y los mismos eventos. */
export class TransformControls extends EventDispatcher {
  constructor(camera, domElement) {
    super();
    this.camera = camera; this.domElement = domElement; this.object = undefined;
    this.mode = 'translate'; this.axis = null; this.dragging = false; this.enabled = true;
    this._helper = new Object3D();
    if (domElement && domElement.style) domElement.style.touchAction = 'none';
  }
  getHelper() { return this._helper; }
  attach(o) { this.object = o; this.dispatchEvent({ type: 'change' }); return this; }
  detach() { this.object = undefined; this.axis = null; this.dispatchEvent({ type: 'change' }); return this; }
  setMode(m) { this.mode = m; this.dispatchEvent({ type: 'change' }); }
  pointerDown(p) {
    if (!this.object || this.axis === null) return;
    this._x = p.x; this.dragging = true;
    this.dispatchEvent({ type: 'dragging-changed', value: true }); this.dispatchEvent({ type: 'mouseDown', mode: this.mode });
  }
  pointerMove(p) {
    if (!this.dragging) return;
    const d = (p.x - this._x) * 2; this._x = p.x;
    if (this.mode === 'translate') this.object.position.x += d;
    else if (this.mode === 'rotate') this.object.rotation.z += d;
    else this.object.scale.multiplyScalar(1 + d);
    this.dispatchEvent({ type: 'change' }); this.dispatchEvent({ type: 'objectChange' });
  }
  pointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.dispatchEvent({ type: 'dragging-changed', value: false }); this.dispatchEvent({ type: 'mouseUp', mode: this.mode });
  }
  dispose() {}
}
`);
const TC_URL = pathToFileURL(TC_REAL || TC_STUB).href;
const TC_DIR = TC_REAL ? pathToFileURL(path.dirname(path.dirname(TC_REAL))).href : '\u0000';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const padre = ctx.parentURL || '';
  if (spec === 'three' && padre.includes('/_demo_run_')) {
    return { url: ${JSON.stringify(pathToFileURL(ENVOLTORIO).href)}, shortCircuit: true };
  }
  if (spec === 'three' && padre.startsWith(${JSON.stringify(TC_DIR)})) {
    return { url: ${JSON.stringify(THREE_REAL)}, shortCircuit: true };
  }
  if (spec === 'three/addons/controls/TransformControls.js' && padre.includes('/_demo_run_')) {
    return { url: ${JSON.stringify(TC_URL)}, shortCircuit: true };
  }
  return next(spec, ctx);
}`));
const THREE = await import('three');
const { validaMaterial, HAY_VALIDADOR } = await import('./glsl.mjs');
const { normalizeSeed, DUST_SAMPLE_BUDGETS } = await import('../src/index.js');
const { encodeDustScene } = await import('../src/system.js');
const { nebulaDustOptions } = await import('../src/presets.js');
const { normalizeDustMorphology } = await import('../src/index.js');
const HASH = await import('../demo/hash.js');
const POST = await import('../demo/post.js');

/* ------------------------------------------------------------------ DOM pequeño */
const VACIOS = new Set(['input', 'meta', 'br', 'link', 'img', 'hr', 'source']);
const camel = (s) => s.replace(/-(\w)/g, (m, c) => c.toUpperCase());
let estado;
let erroresPasada = [];

function evento(type, props = {}) {
  return {
    type, bubbles: true, cancelable: true, defaultPrevented: false, target: null, currentTarget: null,
    _parar: false, _inmediato: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._parar = true; },
    stopImmediatePropagation() { this._parar = true; this._inmediato = true; },
    ...props
  };
}
function despacha(nodo, ev) {
  ev.target = nodo;
  const ruta = [];
  for (let e = nodo; e; e = e.parentNode) ruta.push(e);
  const d = globalThis.document;
  if (d && ruta.at(-1) === d.documentElement) ruta.push(d, globalThis.window);
  for (const n of ev.bubbles === false ? [nodo] : ruta) {
    ev.currentTarget = n;
    for (const f of [...((n.listeners && n.listeners[ev.type]) || [])]) {
      try { f.call(n, ev); } catch (e) { estado.error(`${ev.type} en ${n.id ? '#' + n.id : n.tagName || 'window'}: ${(e.stack || e).toString().split('\n').slice(0, 3).join(' | ')}`); }
      if (ev._inmediato) break;
    }
    if (ev._parar) break;
  }
  return !ev.defaultPrevented;
}

function coincideSimple(e, s) {
  const m = s.match(/^([a-zA-Z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/);
  if (!m || e.nodeType !== 1) return false;
  if (m[1] && m[1] !== '*' && e.tagName !== m[1].toUpperCase()) return false;
  for (const p of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (p[0] === '#') { if (e.id !== p.slice(1)) return false; } else if (p[0] === '.') { if (!e.classList.contains(p.slice(1))) return false; } else {
      const a = p.slice(1, -1).match(/^([\w-]+)(?:="?([^"]*)"?)?$/);
      if (!a) return false;
      const v = e.getAttribute(a[1]);
      if (v === null || (a[2] !== undefined && v !== a[2])) return false;
    }
  }
  return true;
}
function coincide(e, sel) {
  return sel.split(',').some((parte) => {
    const trozos = parte.trim().split(/\s+/);
    if (!coincideSimple(e, trozos.at(-1))) return false;
    let i = trozos.length - 2;
    for (let a = e.parentNode; a && i >= 0; a = a.parentNode) if (coincideSimple(a, trozos[i])) i--;
    return i < 0;
  });
}

class Nodo {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.dataset = {};
    this.style = { setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] ?? ''; }, removeProperty(k) { delete this[k]; } };
    this._text = '';
    this._clases = new Set();
    this.id = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.type = '';
    this.title = '';
    this.files = null;
    this.clicks = 0;
    this.classList = {
      add: (...c) => { for (const x of c) this._clases.add(x); },
      remove: (...c) => { for (const x of c) this._clases.delete(x); },
      contains: (c) => this._clases.has(c),
      toggle: (c, f) => {
        const on = f === undefined ? !this._clases.has(c) : Boolean(f);
        if (on) this._clases.add(c); else this._clases.delete(c);
        return on;
      }
    };
    if ('type' in attrs) this.setAttribute('type', attrs.type);
    for (const [k, v] of Object.entries(attrs)) if (k !== 'type') this.setAttribute(k, v);
  }
  get className() { return [...this._clases].join(' '); }
  set className(v) { this._clases = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get ownerDocument() { return globalThis.document; }
  get isContentEditable() { return false; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this._text = String(t); for (const c of this.children) c.parentNode = null; this.children = []; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get options() { return this.opciones(); }
  get value() {
    if (this.tagName === 'SELECT') {
      const ops = this.opciones();
      const sel = ops.find((o) => o.selected) || (this._sinSeleccion ? null : ops[0]);
      return sel ? sel.value : '';
    }
    if (this.tagName === 'OPTION') return this._v ?? this._text;
    if (this.tagName === 'BUTTON') return this._v ?? '';
    if (this.tagName === 'INPUT') {
      if (this._valor !== undefined) return this._valor;
      if (this.type === 'range') {
        const a = Number(this.min ?? 0), b = Number(this.max ?? 100);
        return String(b < a ? a : a + (b - a) / 2);
      }
      if (this.type === 'color') return '#000000';
      if (this.type === 'checkbox') return 'on';
      return '';
    }
    return this._v ?? '';
  }
  set value(v) {
    v = String(v);
    if (this.tagName === 'SELECT') {
      let hay = false;
      for (const o of this.opciones()) { o.selected = !hay && o.value === v; if (o.selected) hay = true; }
      this._sinSeleccion = !hay;
      return;
    }
    if (this.tagName === 'INPUT' && this.type === 'range') {
      const a = Number(this.min ?? 0), b = Number(this.max ?? 100), st = Number(this.step) || 1;
      let n = Number(v);
      if (!Number.isFinite(n)) n = a + (b - a) / 2;
      n = a + Math.round((n - a) / st) * st;
      const dec = (String(this.step).split('.')[1] || '').length;
      n = Math.min(b, Math.max(a, Number(n.toFixed(Math.min(10, dec + 2)))));
      this._valor = String(n);
      return;
    }
    if (this.tagName === 'INPUT' && this.type === 'color') { this._valor = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#000000'; return; }
    if (this.tagName === 'INPUT') { this._valor = v; return; }
    this._v = v;
  }
  get selectedIndex() { return this.opciones().findIndex((o) => o.selected); }
  opciones() {
    const out = [];
    const recorre = (e) => { for (const c of e.children) { if (c.tagName === 'OPTION') out.push(c); else recorre(c); } };
    recorre(this);
    return out;
  }
  setAttribute(k, v) {
    v = String(v);
    this.attrs[k] = v;
    if (k === 'id') this.id = v;
    else if (k === 'class') this.className = v;
    else if (k === 'hidden') this.hidden = true;
    else if (k === 'disabled') this.disabled = true;
    else if (k === 'checked') this.checked = true;
    else if (k === 'type') this.type = v;
    else if (k === 'title') this.title = v;
    else if (k === 'min' || k === 'max' || k === 'step' || k === 'label') this[k] = v;
    else if (k === 'value') this.value = v;
    else if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = v;
  }
  getAttribute(k) {
    if (k === 'id') return this.id || null;
    if (k === 'class') return this.className || null;
    if (k === 'hidden') return this.hidden ? '' : null;
    if (k === 'disabled') return this.disabled ? '' : null;
    if (k === 'title') return this.title || null;
    if (k.startsWith('data-')) return this.dataset[camel(k.slice(5))] ?? null;
    return k in this.attrs ? this.attrs[k] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) {
    delete this.attrs[k];
    if (k === 'hidden') this.hidden = false;
    if (k === 'disabled') this.disabled = false;
    if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))];
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = this.children.indexOf(ref);
    c.parentNode = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, c);
    return c;
  }
  prepend(c) { return this.insertBefore(c, this.children[0] || null); }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let e = n; e; e = e.parentNode) if (e === this) return true; return false; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  dispatchEvent(ev) { return despacha(this, ev); }
  click() { this.clicks++; if (this.disabled) return; despacha(this, evento('click')); }
  focus() {
    const d = globalThis.document;
    if (d.activeElement && d.activeElement !== this && d.activeElement.blur) d.activeElement.blur();
    d.activeElement = this;
  }
  blur() {
    const d = globalThis.document;
    if (d.activeElement !== this) return;
    d.activeElement = d.body;
    despacha(this, evento('blur', { bubbles: false }));
  }
  select() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: globalThis.window.innerWidth, height: globalThis.window.innerHeight }; }
  matches(sel) { return coincide(this, sel); }
  closest(sel) { for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (coincide(e, sel)) return e; return null; }
  querySelectorAll(sel) {
    const out = [];
    const recorre = (e) => { for (const c of e.children) { if (coincide(c, sel)) out.push(c); recorre(c); } };
    recorre(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function parseaHtml(html) {
  const cuerpo = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  const raiz = new Nodo('body');
  const pila = [raiz];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  re.lastIndex = cuerpo.indexOf('>') + 1;
  while ((m = re.exec(cuerpo))) {
    if (m[4] !== undefined) { const t = m[4].replace(/\s+/g, ' ').trim(); if (t) pila[pila.length - 1]._text += t; continue; }
    const [, cierra, tagRaw, resto] = m;
    const tag = tagRaw.toLowerCase();
    if (tag === 'script') continue;
    if (cierra) { while (pila.length > 1 && pila.pop().tagName !== tag.toUpperCase()); continue; }
    const attrs = {};
    for (const a of resto.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    const e = new Nodo(tag, attrs);
    pila[pila.length - 1].appendChild(e);
    if (!VACIOS.has(tag) && !resto.trim().endsWith('/')) pila.push(e);
  }
  return raiz;
}

/* ------------------------------------------------------------------ renderer y GL falsos */
const GL = {
  RENDERER: 0x1F01, MAX_TEXTURE_SIZE: 0x0D33, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
  QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867
};
/* La RTX 4090 da el nivel 4 (2 M de motas por grupo en automático); la Intel HD 4000,
 * el nivel 1 (65 536): las secciones que no miden el reparto usan esta, que genera
 * treinta veces menos motas en cada regeneración y deja la prueba en un minuto. */
const GPUS = {
  rtx4090: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)',
  intelhd: 'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0)'
};
function glFalso(r) {
  const ext = {
    WEBGL_debug_renderer_info: { UNMASKED_RENDERER_WEBGL: 0x9246 },
    EXT_disjoint_timer_query_webgl2: { TIME_ELAPSED_EXT: 0x88BF, GPU_DISJOINT_EXT: 0x8FBB }
  };
  return {
    ...GL,
    getExtension: (n) => ext[n] || null,
    getParameter: (p) => ({ 0x9246: GPUS[estado.gpu], [GL.MAX_TEXTURE_SIZE]: 16384, [GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: 32, 0x8FBB: false })[p],
    createQuery: () => ({}), deleteQuery() {}, beginQuery() {}, endQuery() {},
    getQueryParameter: (q, p) => (p === GL.QUERY_RESULT_AVAILABLE ? true : 1.25e6),
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    get drawingBufferWidth() { return Math.floor(r.w * r.pixelRatio); },
    get drawingBufferHeight() { return Math.floor(r.h * r.pixelRatio); },
    getProgramInfoLog: () => '', getShaderInfoLog: () => 'ERROR: 0:12: fallo fingido',
    /* el lienzo: fondo (3, 3, 10) y, si estado.lienzo === 'lleno', una mancha */
    readPixels(x, y, w, h, f, t, px) {
      estado.lecturas++;
      for (let i = 0; i < px.length; i += 4) { px[i] = 3; px[i + 1] = 3; px[i + 2] = 10; px[i + 3] = 255; }
      if (estado.lienzo === 'lleno') for (let i = 0; i < Math.min(px.length, 4 * 40000); i += 4) px[i] = 90;
    }
  };
}

class RendererFalso {
  constructor() {
    this.domElement = new Nodo('canvas');
    this.pixelRatio = 1;
    this.w = 300; this.h = 150;
    this.autoClear = true;
    this.toneMapping = 0;
    this.capabilities = { isWebGL2: true, maxAttributes: 16, maxTextureSize: 16384, maxVertexTextures: 32 };
    this._gl = glFalso(this);
    this._rt = null;
    this.debug = { checkShaderErrors: true, onShaderError: null };
    estado.renderer = this;
  }
  getContext() { return this._gl; }
  setRenderTarget(t) { this._rt = t || null; }
  getRenderTarget() { return this._rt; }
  setPixelRatio(r) { this.pixelRatio = r; }
  getPixelRatio() { return this.pixelRatio; }
  setSize(w, h) { this.w = w; this.h = h; }
  setClearColor() {}
  getDrawingBufferSize(v) { return v.set(Math.floor(this.w * this.pixelRatio), Math.floor(this.h * this.pixelRatio)); }
  render(scene, camera) {
    let puntos = false;
    scene.traverse((o) => { if (o.isPoints) puntos = true; });
    if (!puntos) {
      const primero = scene.children[0];
      if (primero && primero.name === 'Nebula dust system') {
        /* la escena sin ningún grupo (tras vaciarla): también va al búfer HalfFloat */
        if (!this._rt) estado.error('la escena vacía se dibuja en el lienzo y no en el búfer');
        return;
      }
      if (primero && primero.isMesh) {
        /* una pasada del posproceso: al búfer (bloom) o al lienzo (gradación) */
        if (this._rt) {
          estado.pasadasPost++;
          if (!this._rt.texture || this._rt.texture.type !== THREE.HalfFloatType) estado.error('una pasada de bloom no va a un búfer HalfFloat');
        } else {
          estado.salidas++;
          estado.ultimaSalida = primero.material;
          if (!primero.material || primero.material.name !== 'Dust grade') estado.error('al lienzo va una pasada que no es la gradación: ' + (primero.material && primero.material.name));
        }
      } else if (primero) {
        estado.gizmos++;
        if (this._rt) estado.error('el gizmo se dibuja en un búfer y no en el lienzo');
      }
      return;
    }
    estado.renders++;
    estado.tipoDestino = this._rt && this._rt.texture ? this._rt.texture.type : 'lienzo';
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    let visibles = 0;
    scene.traverse((o) => {
      if (!o.isPoints) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      if (!camera.layers.test(o.layers)) return;
      visibles++;
      for (const [k, u] of Object.entries(o.material.uniforms)) {
        if (typeof u.value === 'number' && !Number.isFinite(u.value)) estado.error(`uniforme ${k} = ${u.value}`);
        if (Array.isArray(u.value)) {
          for (const v of u.value) if (v && v.isVector4 && ![v.x, v.y, v.z, v.w].every(Number.isFinite)) estado.error(`uniforme ${k} con NaN`);
        }
      }
      const dr = o.geometry.drawRange;
      const n = o.geometry.getAttribute('position').count;
      if (!(dr.count >= 1 && dr.count <= n)) estado.error(`drawRange ${dr.count} de ${n}`);
      estado.ultimoDraw = dr.count;
    });
    estado.nubesDibujadas = visibles;
  }
  dispose() {}
}
globalThis.__RendererFalso = RendererFalso;

function almacen() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; }
  };
}

function montaGlobales(hash, { movil = false, guardado = null, gpu = 'rtx4090', sinPantallaCompleta = false } = {}) {
  const body = parseaHtml(HTML);
  const html = new Nodo('html');
  html.appendChild(body);
  let rafs = new Map();
  let rafId = 0;
  estado = {
    /* los errores de todas las demos de una pasada, no solo los de la última */
    gpu, renders: 0, salidas: 0, pasadasPost: 0, gizmos: 0, lecturas: 0, lienzo: 'lleno', tipoDestino: null, errores: erroresPasada,
    ultimoDraw: 0, nubesDibujadas: 0, pantallas: 0, portapapeles: [], body, ultimaSalida: null,
    error(m) { if (this.errores.length < 30) this.errores.push(m); },
    get rafs() { return rafs; }
  };
  const doc = {
    nodeType: 9,
    documentElement: html,
    body,
    hidden: false,
    activeElement: body,
    fullscreenElement: null,
    fullscreenEnabled: true,
    listeners: {},
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    createElement: (t) => new Nodo(t),
    createElementNS: (ns, t) => new Nodo(t),
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    dispatchEvent(ev) { ev.target = this; for (const f of [...(this.listeners[ev.type] || [])]) f(ev); return !ev.defaultPrevented; },
    exitFullscreen() {
      this.fullscreenElement = null;
      this.dispatchEvent(evento('fullscreenchange'));
      return Promise.resolve();
    }
  };
  html.requestFullscreen = () => {
    doc.fullscreenElement = html;
    estado.pantallas++;
    doc.dispatchEvent(evento('fullscreenchange'));
    return Promise.resolve();
  };
  /* un iPhone: sin la API de pantalla completa */
  if (sinPantallaCompleta) {
    delete doc.fullscreenEnabled;
    delete doc.exitFullscreen;
    delete html.requestFullscreen;
  }
  const loc = {
    hash: hash || '', pathname: '/nebula-dust-engine/demo/', search: '',
    get href() { return 'https://orbitas.gmartos.es/nebula-dust-engine/demo/' + this.hash; }
  };
  globalThis.document = doc;
  globalThis.location = loc;
  globalThis.history = { replaceState: (a, b, url) => { loc.hash = String(url).startsWith('#') && url.length > 1 ? String(url) : ''; } };
  globalThis.window = {
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1.5, listeners: {},
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    dispatchEvent(ev) { ev.target = this; for (const f of [...(this.listeners[ev.type] || [])]) f(ev); return true; }
  };
  globalThis.localStorage = guardado || almacen();
  globalThis.matchMedia = (q) => ({ matches: movil, media: q, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = (f) => { rafs.set(++rafId, f); return rafId; };
  globalThis.cancelAnimationFrame = (id) => { rafs.delete(id); };
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: movil ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140 Mobile' : 'Mozilla/5.0 (Windows NT 10.0) Chrome/140',
        deviceMemory: 16,
        clipboard: { writeText: async (t) => { estado.portapapeles.push(String(t)); } }
      },
      configurable: true
    });
  } catch { /* nada */ }
}

let reloj = 1000;
/** Avanza la pantalla n cuadros a hz; cada cuadro ejecuta los rAF pendientes. */
function cuadros(n, hz = 144) {
  for (let i = 0; i < n; i++) {
    reloj += 1000 / hz;
    const lista = [...estado.rafs.entries()];
    estado.rafs.clear();
    for (const [, f] of lista) {
      try { f(reloj); } catch (e) { estado.error('en el bucle: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
    }
  }
}
/** Avanza hasta que se dibuje un cuadro nuevo (con el tope de 60 fps, dos cuadros a 144 Hz pueden caer entre dos dibujos). */
function dibuja(max = 12) {
  const r0 = estado.renders;
  for (let i = 0; i < max && estado.renders === r0; i++) cuadros(1);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
/** Un evento de puntero sobre el lienzo (ratón o dedo). */
function puntero(tipo, x, y, id = 1, clase = 'mouse') {
  despacha(estado.renderer.domElement, evento(tipo, {
    pointerId: id, clientX: x, clientY: y, button: 0, pointerType: clase, isPrimary: id === 1, deltaY: 0
  }));
}
function toque(x, y, clase = 'mouse') {
  puntero('pointerdown', x, y, 1, clase);
  puntero('pointerup', x, y, 1, clase);
}
/** Una tecla (KeyboardEvent.code) pulsada sobre `target` (el body si no se dice). */
function tecla(code, { target = null, ctrl = false, repeat = false, key = null } = {}) {
  const ev = evento('keydown', { code, key: key || code, ctrlKey: ctrl, metaKey: false, altKey: false, shiftKey: false, repeat });
  despacha(target || globalThis.document.body, ev);
  return ev;
}

let versionImport = 0;
async function cargaDemo(fuentes, hash, op = {}) {
  /* la demo anterior se para: si no, su bucle seguiría pidiendo cuadros al rAF nuevo */
  const anterior = globalThis.window && globalThis.window.nebulaDustDemo;
  if (anterior && typeof anterior.stop === 'function') anterior.stop();
  montaGlobales(hash, op);
  const dir = path.join(TMP, '_demo_run_' + (++versionImport));
  fs.mkdirSync(dir);
  const src = pathToFileURL(path.join(MOTOR, 'src')).href + '/';
  for (const [f, texto] of Object.entries(fuentes)) fs.writeFileSync(path.join(dir, f), texto.replace(/'\.\.\/src\//g, "'" + src));
  try {
    await import(pathToFileURL(path.join(dir, 'main.js')).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const demo = globalThis.window.nebulaDustDemo;
  if (demo && demo.ready) await demo.ready;
  cuadros(3);
  return demo;
}

function sinNaN(sistema, donde) {
  for (const g of sistema.listGroups()) {
    const engine = sistema.getGroup(g.id).engine;
    const geo = engine.points.geometry;
    for (const [k, a] of Object.entries(geo.attributes)) {
      const arr = a.array;
      for (let i = 0; i < arr.length; i += 97) {
        if (!Number.isFinite(arr[i])) { estado.error(`${donde}: ${g.id} atributo ${k}[${i}] = ${arr[i]}`); break; }
      }
    }
    const st = engine.getStatus();
    for (const k of ['visibleFraction', 'lodPointScale', 'lodAlphaScale', 'evolution', 'motion', 'flowSpeed', 'particleScale']) {
      if (!Number.isFinite(st[k])) estado.error(`${donde}: ${g.id} estado ${k} = ${st[k]}`);
    }
  }
}

/** Diferencias entre dos listas de specs (sin mirar los ids), con tolerancia en los números. */
function difiere(a, b, tol = 2e-3) {
  const out = [];
  if (a.length !== b.length) return [`${a.length} grupos frente a ${b.length}`];
  const igual = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x));
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => igual(v, y[i]));
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const k = new Set([...Object.keys(x), ...Object.keys(y)]);
      return [...k].every((c) => igual(x[c], y[c]));
    }
    return x === y;
  };
  a.forEach((g, i) => {
    for (const k of Object.keys(g)) if (k !== 'id' && !igual(g[k], b[i][k])) out.push(`grupo ${i + 1}.${k}: ${JSON.stringify(g[k])} ≠ ${JSON.stringify(b[i][k])}`);
  });
  return out;
}

/* ------------------------------------------------------------------ la prueba */
class Abortada extends Error {}

async function prueba(fuentes, { aborta = false } = {}) {
  const fallos = [];
  erroresPasada = [];
  const falla = (m) => {
    fallos.push(m);
    if (aborta) throw new Abortada(m);
  };
  try {
    await pasos(fuentes, falla);
  } catch (e) {
    if (!(e instanceof Abortada)) fallos.push('la prueba revienta: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  }
  for (const e of erroresPasada) fallos.push(e);
  return fallos;
}

async function pasos(fuentes, falla) {
  let tHito = Date.now();
  const hito = (n) => {
    if (!process.env.DEMO_TIEMPOS) return;
    const t = Date.now();
    console.log('  ' + ((t - tHito) / 1000).toFixed(1) + ' s hasta ' + n);
    tHito = t;
  };
  const MAIN = fuentes['main.js'];
  const compilados = new Set();
  const compila = (mat, donde, op) => {
    const clave = mat.name + '|' + mat.blending + '|' + mat.vertexShader.length + '|' + mat.fragmentShader.length;
    if (compilados.has(clave)) return;
    compilados.add(clave);
    for (const e of validaMaterial(donde, mat, op)) falla('shader: ' + e);
  };

  /* 1. importaciones */
  hito('1. importaciones');
  const mods = {
    'three': THREE,
    '../src/presets.js': await import('../src/presets.js'),
    '../src/index.js': await import('../src/index.js'),
    '../src/system.js': await import('../src/system.js'),
    '../src/examples.js': await import('../src/examples.js'),
    './panel.js': await import('../demo/panel.js'),
    './hash.js': HASH,
    './post.js': POST,
    'three/addons/controls/TransformControls.js': await import(TC_URL)
  };
  for (const [f, texto] of Object.entries(fuentes)) {
    for (const m of texto.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const mod = mods[m[2]];
      if (!mod) { falla(`${f} importa de un módulo desconocido: ${m[2]}`); continue; }
      for (const nombre of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!(nombre in mod)) falla(`${f} importa ${nombre} de ${m[2]} y no existe`);
      }
    }
    for (const m of new Set([...texto.matchAll(/THREE\.(\w+)/g)].map((x) => x[1]))) {
      if (!(m in THREE)) falla(`${f} usa THREE.${m} y three no lo tiene`);
    }
  }

  /* 2. ids */
  hito('2. ids');
  const idsHtml = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const idsJs = new Set([...MAIN.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  for (const id of idsJs) if (!idsHtml.has(id)) falla(`main.js usa #${id} y no está en index.html`);
  for (const m of HTML.matchAll(/<(button|input|select)\b[^>]*\bid="([^"]+)"/g)) {
    if (!idsJs.has(m[2])) falla(`<${m[1]} id="${m[2]}"> está en el HTML y main.js no lo usa`);
  }
  if (!/<html lang="en">/.test(HTML)) falla('index.html no está en inglés (lang="en")');

  /* 3. arranque */
  hito('3. arranque');
  const demo = await cargaDemo(fuentes, '');
  if (!demo) { falla('la demo no expone window.nebulaDustDemo'); return; }
  const $ = (id) => document.getElementById(id);
  const S = demo.system;
  const ui = demo.panel.controllers;
  const C = (k) => { const c = ui.get(k); if (!c) falla('no hay control ' + k); return c; };
  const probados = new Set();
  const cambiaSel = (k, v) => { probados.add(k); const c = C(k); c.input.value = v; despacha(c.input, evento('change')); };
  const desliza = (k, v) => { probados.add(k); const c = C(k); c.input.value = String(v); despacha(c.input, evento('input')); };
  const marca = (k, on) => { probados.add(k); const c = C(k); c.input.checked = on; despacha(c.input, evento('change')); };
  const pulsa = (k) => { probados.add(k); C(k).input.click(); };
  const segmento = (k, v) => { probados.add(k); const b = $('ctl-' + k + '-' + v); if (!b) { falla(`el segmento ${k}=${v} no existe`); return; } b.click(); };
  const colorea = (k, v, i = null) => {
    probados.add(k);
    const c = C(k);
    const input = i === null ? c.input : c.inputs[i];
    input.value = v;
    despacha(input, evento('input'));
  };
  const escribe = (k, v) => { probados.add(k); const c = C(k); c.input.focus(); c.input.value = v; despacha(c.input, evento('change')); c.input.blur(); };
  const flush = () => demo.flushHash();
  const renders = () => estado.renders;

  if (S.size !== 2) falla(`sin hash no arranca con la escena de dos grupos (${S.size})`);
  if (!demo.engine || demo.engine.metadata.morphology !== 'orion') falla('sin hash, el grupo elegido no es la nebulosa de Orión');
  if (location.hash !== '#scene=twinNebula') falla('sin hash, el enlace no es #scene=twinNebula: ' + location.hash);
  if (estado.renders < 1) falla('la demo no dibuja al cargar');
  if (estado.nubesDibujadas !== S.size) falla(`se dibujan ${estado.nubesDibujadas} nubes de ${S.size}`);
  if ($('group-list').children.length !== 2) falla(`la lista enseña ${$('group-list').children.length} grupos`);
  const raiz = $('panel').querySelector('.gui');
  if (!raiz || !raiz.classList.contains('visible')) falla('el panel no se monta en #panel');
  if (demo.panel.collapsed) falla('en el ordenador el panel arranca plegado');
  if (!/^Nebula Dust Engine/.test($('gui-title').textContent)) falla('el título del panel no es «Nebula Dust Engine»: ' + $('gui-title').textContent);
  if ($('gui-subtitle').textContent !== S.getGroup(demo.selected).spec.name) falla('el título no dice el grupo elegido: ' + $('gui-subtitle').textContent);
  if (!$('gui-rows').contains($('help')) || $('help').hidden) falla('la ayuda no está arriba del panel');
  if (!$('panel').contains($('keys')) || $('keys').hidden) falla('la tabla de teclas no está en el panel');
  for (const t of ['←', 'R', 'Space', 'Tab', 'F', 'double-click', 'double-tap', '1']) {
    if (!$('keys').textContent.includes(t)) falla('la tabla de teclas no dice ' + t);
  }
  if (!/guspira/.test($('credits').textContent) || !/MIT/.test($('credits').textContent) || !/Bumpy Metaballs/.test($('credits').textContent)) falla('los créditos no citan guspira, Bumpy Metaballs y la licencia MIT');
  const tabs = ['scene', 'group', 'render', 'stats'].map((k) => $('tab-' + k));
  if (tabs.some((t) => !t)) falla('faltan pestañas: Scene, Group, Render, Stats');
  else if (!tabs[0].classList.contains('active')) falla('la primera pestaña no está abierta');
  if ($('buttons').hidden) falla('los botones de pausa, azar, pantalla completa e interfaz no se enseñan');
  if (estado.tipoDestino !== THREE.HalfFloatType) falla('el polvo no se dibuja en un búfer HalfFloat');
  if (estado.salidas < 1) falla('no hay pasada de gradación al lienzo');
  if (estado.pasadasPost < 1) falla('con el bloom de fábrica no hay pasadas de bloom');
  if ((demo.camera.layers.mask >>> 0) !== 0xffffffff) falla('al arrancar, con «Layers: All», la cámara no ve todas las capas (máscara ' + demo.camera.layers.mask + ')');
  /* cada ui.get('x') y stat('x') del JS es un control del panel */
  for (const m of new Set([...MAIN.matchAll(/(?:ui\.get|stat)\('([^']+)'\)/g)].map((x) => x[1]))) {
    if (!ui.has(m)) falla(`main.js usa el control ${m} y el panel no lo tiene`);
  }
  /* los controles: todos con id y con su texto en inglés */
  for (const [k, c] of ui) {
    const el = c.input || c.el || c.value;
    if (el && !el.id) falla(`el control ${k} no tiene id`);
  }
  if (/[áéíóúñ¿¡]/i.test($('panel').textContent.replace(/Sánchez/g, ''))) falla('el panel tiene texto en castellano: ' + ($('panel').textContent.match(/[^.]*[áéíóúñ¿¡][^.]*/i) || [''])[0].slice(0, 80));

  /* 4. presets */
  hito('4. presets');
  /* de aquí en adelante, 16 384 motas por grupo: cada regeneración cuesta cien veces menos */
  cambiaSel('quality', 'minimal'); cuadros(3);
  if (S.getStatus().autoSamplesPerGroup !== 16384) falla('Quality · Minimal no deja 16 384 motas por grupo');
  const Q = '&quality=minimal';
  const sel = C('preset').input;
  const valoresPreset = sel.opciones().map((o) => o.value).filter(Boolean);
  if (valoresPreset.length !== 14) falla(`el selector tiene ${valoresPreset.length} presets y no 14`);
  if (sel.querySelectorAll('optgroup').length !== 3) falla('los presets no van en tres grupos');
  if (C('sow').options().length !== 14 + 14) falla(`«Sow» tiene ${C('sow').options().length} opciones y no 28`);
  for (const o of sel.opciones()) if (o.value && (o.textContent === o.value || /Nebulosa|Polvo|Pilares/.test(o.textContent))) falla(`${o.value} sale sin nombre en inglés: ${o.textContent}`);
  for (const k of valoresPreset) {
    cambiaSel('preset', k);
    cuadros(4);
    if (demo.engine.metadata.sampleCount < 1) falla(`${k}: sin motas`);
    if (demo.engine.metadata.morphology !== normalizeDustMorphology(nebulaDustOptions(k).morphology)) falla(`${k}: el grupo elegido no cambia de forma`);
    sinNaN(S, k);
    compila(demo.engine.material, k);
    flush();
    const esperado = (k === 'orion' ? '#scene=twinNebula' : '#scene=twinNebula&preset=' + k) + Q;
    if (location.hash !== esperado) falla(`${k}: el hash es ${location.hash} y no ${esperado}`);
  }
  cambiaSel('preset', 'orion');
  cuadros(3);

  /* 5. todos los controles */
  hito('5. todos los controles');
  const g1 = demo.selected;
  const spec = () => S.getGroup(demo.selected).spec;
  const grade = demo.post.materials.grade.uniforms;
  const selects = ['shape', 'palette', 'volume', 'samples', 'quality', 'budget', 'fps', 'dustgrains', 'layers', 'sow'];
  for (const k of selects) {
    const c = C(k);
    for (const o of c.options()) {
      if (o.disabled) continue;
      const antes = renders();
      cambiaSel(k, o.value);
      if (c.input.value !== o.value && !(k === 'shape' || k === 'palette' || k === 'volume')) { falla(`${k}: no se puede elegir ${o.value}`); continue; }
      if (Number(o.value) >= 1000000) await espera(60);
      cuadros(8);
      if (renders() === antes && k !== 'sow') falla(`${k}=${o.value}: no se vuelve a dibujar`);
      sinNaN(S, `${k}=${o.value}`);
      compila(demo.engine.material, `${k}=${o.value}`);
      const sp = spec();
      const st = demo.engine.getStatus();
      if (k === 'shape' && o.value && sp.morphology !== o.value) falla(`shape=${o.value}: la spec tiene ${sp.morphology}`);
      if (k === 'shape' && !o.value && sp.morphology !== 'orion') falla('shape vacía no vuelve a la forma del preset');
      if (k === 'palette') {
        if (o.value === 'custom') {
          if (C('colors').hidden) falla('paleta propia: no salen los colores');
          if (st.palette !== 'custom') falla('paleta propia: el motor no la usa');
        } else if (o.value && st.palette !== o.value) falla(`palette=${o.value}: el motor usa ${st.palette}`);
        else if (o.value && !C('colors').hidden) falla(`palette=${o.value}: siguen a la vista los colores propios`);
      }
      if (k === 'volume' && o.value && sp.volumeProfile !== o.value) falla(`volume=${o.value}: la spec tiene ${sp.volumeProfile}`);
      if (k === 'samples') {
        const pedido = o.value === 'auto' ? null : Number(o.value);
        if (sp.count !== pedido) falla(`samples=${o.value}: la spec pide ${sp.count}`);
        const grupos = S.listGroups();
        const total = grupos.reduce((a, g) => a + g.requestedSamples, 0);
        const tope = S.getStatus().maxTotalSamples;
        const suma = grupos.reduce((a, g) => a + g.sampleCount, 0);
        if (suma > tope) falla(`samples=${o.value}: ${suma} motas en total, más que el presupuesto ${tope}`);
        for (const g of grupos) {
          const esperado = total <= tope ? g.requestedSamples : g.requestedSamples * tope / total;
          if (Math.abs(g.sampleCount - esperado) > 2) falla(`samples=${o.value}: ${g.id} tiene ${g.sampleCount} y le tocan ${Math.floor(esperado)} (reparto proporcional)`);
        }
      }
      if (k === 'quality') {
        const tier = HASH.QUALITY_OPTIONS.indexOf(o.value) - 1;
        const q = S.getOptions().quality;
        if (tier < 0 ? q !== undefined : q !== tier) falla(`quality=${o.value}: el sistema tiene quality ${q}`);
        if (tier >= 0 && S.getStatus().autoSamplesPerGroup !== DUST_SAMPLE_BUDGETS[tier]) falla(`quality=${o.value}: ${S.getStatus().autoSamplesPerGroup} motas por grupo`);
      }
      if (k === 'budget') {
        if (S.getStatus().maxTotalSamples !== Number(o.value)) falla(`budget=${o.value}: el sistema tiene ${S.getStatus().maxTotalSamples}`);
        if (S.getStatus().allocatedSamples > Number(o.value)) falla(`budget=${o.value}: ${S.getStatus().allocatedSamples} motas`);
      }
      if (k === 'fps' && Math.abs(S.getOptions().targetFrameMs - 1000 / (Number(o.value) || 60)) > 1e-9) falla(`fps=${o.value}: el adaptativo apunta a ${S.getOptions().targetFrameMs} ms`);
      if (k === 'dustgrains' && o.value !== 'mass' && demo.engine.metadata.physicalGrainCount !== Number(o.value)) falla(`dustgrains=${o.value}: el motor representa ${demo.engine.metadata.physicalGrainCount}`);
      if (k === 'dustgrains' && o.value === 'mass' && !(demo.engine.metadata.physicalGrainCount > 1e30)) falla('dustgrains=mass: no sale de la masa de polvo');
      if (k === 'layers') {
        const esperado = o.value === 'all' ? 0xffffffff : (1 << Number(o.value));
        if ((demo.camera.layers.mask >>> 0) !== (esperado >>> 0)) falla(`layers=${o.value}: la cámara ve la máscara ${demo.camera.layers.mask}`);
      }
      if (['quality', 'fps', 'budget', 'dustgrains', 'layers'].includes(k) && String(demo.render[k]) !== o.value) falla(`${k}=${o.value}: el estado de render tiene ${demo.render[k]}`);
    }
    if (k === 'samples') { cambiaSel('samples', 'auto'); cuadros(3); }
    if (k === 'quality') { cambiaSel('quality', 'minimal'); cuadros(2); }
    if (k === 'budget') { cambiaSel('budget', '4000000'); cuadros(2); }
    if (k === 'fps') { cambiaSel('fps', '60'); cuadros(2); }
    if (k === 'dustgrains') { cambiaSel('dustgrains', '1e18'); cuadros(2); }
    if (k === 'layers') { cambiaSel('layers', 'all'); cuadros(2); }
    if (k === 'shape') { cambiaSel('shape', ''); cuadros(2); }
    if (k === 'palette') { cambiaSel('palette', ''); cuadros(2); }
    if (k === 'volume') { cambiaSel('volume', ''); cuadros(2); }
  }
  /* capas: con «solo la 1» se dibuja solo el grupo de la capa 1 */
  {
    const [a, b] = S.listGroups().map((g) => g.id);
    demo.select(b);
    segmento('layer', '1'); cuadros(2);
    if (S.getGroup(b).spec.layer !== 1 || !S.getGroup(b).engine.points.layers.isEnabled(1)) falla('layer=1: el grupo no pasa a la capa 1');
    cambiaSel('layers', '1'); dibuja();
    if (estado.nubesDibujadas !== 1) falla(`capas: con «solo la 1» se dibujan ${estado.nubesDibujadas} nubes`);
    cambiaSel('layers', 'all'); dibuja();
    if (estado.nubesDibujadas !== 2) falla(`capas: con «todas» se dibujan ${estado.nubesDibujadas} nubes`);
    for (const v of ['2', '3', '0']) { segmento('layer', v); cuadros(1); if (S.getGroup(b).spec.layer !== Number(v)) falla(`layer=${v} no llega a la spec`); }
    demo.select(a);
  }
  /* la mezcla */
  for (const v of ['additive', 'normal']) {
    segmento('blend', v); cuadros(2);
    if (demo.engine.getStatus().blending !== v || spec().blending !== v) falla(`blend=${v}: el motor mezcla ${demo.engine.getStatus().blending}`);
  }
  /* interruptores */
  for (const [k, efecto] of [
    ['aces', (on) => (grade.uAces.value === (on ? 1 : 0) ? null : 'uAces = ' + grade.uAces.value)],
    ['adaptive', (on) => (S.getOptions().adaptive === on ? null : 'el sistema tiene adaptive ' + S.getOptions().adaptive)],
    ['halfres', (on) => {
      const r = on ? 0.5 : 1;
      if (Math.abs(estado.renderer.pixelRatio - 1.5 * r) > 1e-9) return 'pixelRatio ' + estado.renderer.pixelRatio;
      if (demo.post.target.width !== Math.floor(1600 * 1.5 * r)) return 'el búfer mide ' + demo.post.target.width;
      for (const g of S.listGroups()) if (Math.abs(S.getGroup(g.id).engine.getStatus().resolutionScale - r) > 1e-9) return g.id + ' cree ' + S.getGroup(g.id).engine.getStatus().resolutionScale;
      return null;
    }],
    ['cull', (on) => (demo.engine.getStatus().minPointPx === (on ? 0.5 : 0) ? null : 'umbral ' + demo.engine.getStatus().minPointPx)],
    ['spin', (on) => (demo.render.spin === on ? null : 'spin ' + demo.render.spin)]
  ]) {
    const inicial = C(k).get();
    for (const on of [!inicial, inicial]) {
      const antes = renders();
      marca(k, on);
      cuadros(3);
      if (renders() === antes) falla(`${k}=${on}: no se vuelve a dibujar`);
      const e = efecto(on);
      if (e) falla(`${k}=${on}: ${e}`);
      if (demo.render[k] !== on) falla(`${k}=${on}: el estado de render tiene ${demo.render[k]}`);
    }
  }
  /* la media resolución sobrevive a rehacer la nube */
  marca('halfres', true);
  cambiaSel('dustgrains', '1e21'); cuadros(3);
  if (demo.engine.getStatus().resolutionScale !== 0.5) falla('al rehacer la nube se pierde la media resolución');
  if (demo.engine.metadata.physicalGrainCount !== 1e21) falla('dustgrains no llega al motor');
  marca('halfres', false); cambiaSel('dustgrains', '1e18'); cuadros(2);

  /* deslizadores */
  const uniforme = { size: 'uParticleScale', maxpx: 'uMaxPointSize', flow: 'uFlowSpeed', turbulence: 'uMotion' };
  const deSpec = {
    posx: (s) => s.position[0], posy: (s) => s.position[1], posz: (s) => s.position[2],
    rotx: (s) => s.rotation[0] * 180 / Math.PI, roty: (s) => s.rotation[1] * 180 / Math.PI, rotz: (s) => s.rotation[2] * 180 / Math.PI,
    scale: (s) => Math.max(...s.scale), order: (s) => s.order, opacity: (s) => s.opacity, size: (s) => s.size,
    maxpx: (s) => s.maxPointSize, flow: (s) => s.flowSpeed, turbulence: (s) => s.motion
  };
  const dePost = {
    exposure: () => grade.uExposure.value, grain: () => grade.uGrain.value, vignette: () => grade.uVignette.value,
    bloom: () => grade.uBloom.value, bloomthreshold: () => demo.post.materials.bright.uniforms.uThreshold.value,
    bloomradius: () => grade.uBloomWeights.value.x
  };
  const esperaPost = { bloomradius: (v) => POST.bloomWeights(v)[0] };
  for (const k of ['opacity', 'size', 'maxpx', 'posx', 'posy', 'posz', 'rotx', 'roty', 'rotz', 'scale', 'order', 'flow', 'turbulence',
    'exposure', 'bloom', 'bloomradius', 'bloomthreshold', 'grain', 'vignette', 'sowsize', 'touchradius', 'touchstrength']) {
    const c = C(k);
    for (const v of [c.min, (Number(c.min) + Number(c.max)) / 2, c.max]) {
      const antes = renders();
      const pasadas = estado.pasadasPost;
      desliza(k, v);
      cuadros(3);
      const valor = Number(c.input.value);
      if (!['sowsize', 'touchradius', 'touchstrength'].includes(k) && renders() === antes) falla(`${k}=${v}: no se vuelve a dibujar`);
      if (c.reading && c.reading.textContent === '') falla(`${k}: la lectura del deslizador está vacía`);
      if (uniforme[k]) {
        const u = demo.engine.material.uniforms[uniforme[k]].value;
        if (Math.abs(u - valor) > 1e-6) falla(`${k}=${v}: ${uniforme[k]} = ${u}`);
      }
      if (deSpec[k]) {
        const x = deSpec[k](spec());
        if (Math.abs(x - valor) > 1e-6) falla(`${k}=${v}: la spec tiene ${x}`);
      }
      if (k.startsWith('pos') && Math.abs(demo.engine.object3d.position.toArray()['xyz'.indexOf(k[3])] - valor) > 1e-9) falla(`${k}: el grupo no se mueve`);
      if (k === 'order' && demo.engine.points.renderOrder !== valor) falla('order no llega al renderOrder');
      if (dePost[k]) {
        const esperado = esperaPost[k] ? esperaPost[k](valor) : valor;
        if (Math.abs(dePost[k]() - esperado) > 1e-6) falla(`${k}=${v}: el posproceso tiene ${dePost[k]()} y no ${esperado}`);
        if (Math.abs(demo.render[k] - valor) > 1e-9) falla(`${k}=${v}: el estado de render tiene ${demo.render[k]}`);
      }
      if (k === 'bloom') {
        const hubo = estado.pasadasPost - pasadas;
        if (valor > 0 && hubo < 12) falla(`bloom=${valor}: ${hubo} pasadas de bloom en 3 cuadros`);
        if (valor === 0 && hubo !== 0) falla(`bloom=0: sigue haciendo ${hubo} pasadas de bloom`);
      }
      sinNaN(S, `${k}=${v}`);
    }
  }
  for (const k of ['posx', 'posy', 'posz', 'rotx', 'roty', 'rotz']) desliza(k, 0);
  desliza('scale', 1); cuadros(2);
  /* la lectura del deslizador se puede escribir */
  {
    const c = C('opacity');
    c.reading.click();
    const ed = c.editor;
    if (!ed) falla('pulsar la lectura de un deslizador no abre el campo para escribir');
    else {
      ed.value = '0.42';
      despacha(ed, evento('keydown', { key: 'Enter', code: 'Enter' }));
      cuadros(2);
      if (Math.abs(spec().opacity - 0.42) > 1e-9 || c.reading.hidden) falla('escribir 0.42 en la lectura no cambia la opacidad');
    }
  }
  /* pulsar la etiqueta sortea el control (guspira) */
  {
    const c = C('opacity');
    if (!c.labelEl.classList.contains('gui-randomizable')) falla('la etiqueta de Opacity no se puede pulsar para sortear');
    if (C('samples').labelEl.classList.contains('gui-randomizable')) falla('Samples (un coste, no un aspecto) se sortea');
    let cambio = false;
    for (let i = 0; i < 6 && !cambio; i++) {
      const antes = spec().opacity;
      c.labelEl.click(); cuadros(1);
      cambio = spec().opacity !== antes;
      if (Math.abs(spec().opacity - c.get()) > 1e-9) falla('el sorteo de la etiqueta no llega a la spec');
      if (spec().opacity < 0.3 - 1e-9 || spec().opacity > 1) falla('el sorteo de Opacity se sale de su rango: ' + spec().opacity);
    }
    if (!cambio) falla('pulsar la etiqueta de Opacity no la sortea');
    const f0 = spec().morphology;
    C('shape').labelEl.click(); cuadros(2);
    if (spec().morphology === f0) falla('pulsar la etiqueta de Shape no sortea la forma');
    cambiaSel('shape', ''); cuadros(2);
  }
  /* los parámetros de las formas: solo los de la forma elegida */
  for (const [morfologia, claves] of [['clumpyShell', ['shellInner', 'shellOuter', 'clumpScale', 'clumpContrast', 'plumeCount', 'plumeFraction']],
    ['pinwheel', ['spiralPitch', 'spiralPhase', 'spiralInner', 'armWidth', 'coneOpening', 'radialFade']]]) {
    cambiaSel('shape', morfologia); cuadros(2);
    for (const k of claves) {
      const c = C('shape-' + k);
      if (c.hidden) { falla(`${morfologia}: no sale ${k}`); continue; }
      const v = (Number(c.min) + Number(c.max)) / 2;
      desliza('shape-' + k, v); cuadros(2);
      if (Math.abs(spec().shape[k] - Number(c.input.value)) > 1e-9) falla(`${k}=${v}: la spec tiene ${spec().shape[k]}`);
      sinNaN(S, k);
    }
    const otra = morfologia === 'pinwheel' ? 'shape-shellInner' : 'shape-spiralPitch';
    if (!C(otra).hidden) falla(`${morfologia}: se ven parámetros de otra forma (${otra})`);
    if (morfologia === 'pinwheel') {
      segmento('shape-spiralSense', '-1'); cuadros(2);
      if (spec().shape.spiralSense !== -1) falla('Sense −1 no llega a la spec');
      segmento('shape-spiralSense', '1'); cuadros(1);
    }
  }
  cambiaSel('shape', ''); cuadros(2);
  if (!C('shape-shellInner').hidden || !C('shape-spiralPitch').hidden) falla('con la forma de Orión se ven parámetros de otras formas');
  /* tinte, colores propios, nombre y semilla escrita */
  {
    const antes = demo.engine;
    colorea('tint', '#ff4400'); cuadros(2);
    if (demo.engine.getStatus().tint !== '#ff4400') falla('tint no llega al motor: ' + demo.engine.getStatus().tint);
    if (demo.engine !== antes) falla('tint regenera la nube (debe ser al vuelo)');
    colorea('tint', '#ffffff');
    cambiaSel('palette', 'custom'); cuadros(2);
    colorea('colors', '#ff00aa', 1); cuadros(2);
    if (spec().palette !== 'custom' || spec().colors[1] !== '#ff00aa') falla('un color propio no se guarda en la spec: ' + JSON.stringify(spec().colors));
    if (demo.engine !== antes && demo.engine.metadata.seed === antes.metadata.seed) { /* la paleta al vuelo no rehace la nube */ }
    if (demo.engine !== antes) falla('un color propio regenera la nube (debe ser al vuelo)');
    for (let i = 0; i < 4; i++) if ($('ctl-colors-' + i) === null) falla('falta el color propio ' + (i + 1));
    flush();
    if (!/[#&]colors=[0-9a-f]{6},ff00aa,/.test(location.hash)) falla('el hash no lleva los colores propios: ' + location.hash);
    cambiaSel('palette', ''); cuadros(2);
    escribe('name', 'My cloud'); cuadros(2);
    if (spec().name !== 'My cloud' || !/My cloud/.test($('group-list').textContent) || $('gui-subtitle').textContent !== 'My cloud') falla('name no cambia el nombre del grupo (spec, lista y título)');
    escribe('seed', 'test-seed'); cuadros(2);
    if (demo.engine.metadata.seed !== normalizeSeed('test-seed')) falla('seed no siembra con esa semilla');
    const pos1 = Float32Array.from(demo.engine.points.geometry.getAttribute('position').array.subarray(0, 3000));
    escribe('seed', '42'); cuadros(2);
    if (spec().seed !== 42 || demo.engine.metadata.seed !== 42) falla('una semilla de cifras no es un número: ' + JSON.stringify(spec().seed));
    flush();
    if (!/[#&]seed=42(&|$)/.test(location.hash)) falla('el hash no lleva seed=42: ' + location.hash);
    escribe('seed', 'test-seed'); cuadros(2);
    const pos2 = demo.engine.points.geometry.getAttribute('position').array.subarray(0, 3000);
    if (pos1.some((v, i) => v !== pos2[i])) falla('la misma semilla no da la misma nube');
  }
  /* la explosión: en marcha se arrastra el motor; quieta, la spec */
  {
    cambiaSel('preset', 'supernovaExplosion'); cuadros(3);
    if (C('explosion').hidden || C('restart').hidden) falla('la supernova no enseña el control de la explosión');
    desliza('explosion', 0.7); cuadros(1);
    if (Math.abs(demo.engine.getStatus().evolution - 0.7) > 0.02) falla('explosion no mueve la explosión');
    pulsa('restart'); cuadros(1);
    if (demo.engine.getStatus().evolution > 0.05) falla('restart no reinicia la explosión');
    const semillaAntes = demo.engine.metadata.seed;
    pulsa('newseed'); cuadros(2);
    if (demo.engine.metadata.seed === semillaAntes) falla('newseed no cambia la semilla');
    cambiaSel('samples', '65536'); cuadros(2);
    cambiaSel('palette', 'crab'); cuadros(2);
    pulsa('resetgroup'); cuadros(2);
    const sp = spec();
    const fresco = nebulaDustOptions('supernovaExplosion');
    if (C('samples').get() !== 'auto' || sp.count !== null) falla('resetgroup no vuelve a las motas automáticas');
    if (sp.palette !== fresco.palette || sp.seed !== fresco.seed) falla(`resetgroup no vuelve al preset (${sp.palette}, ${sp.seed})`);
    cambiaSel('preset', 'orion'); cuadros(2);
    if (!C('explosion').hidden) falla('Orión enseña el control de la explosión');
  }
  /* reiniciar el render */
  {
    desliza('exposure', 12); desliza('bloom', 1.1); marca('aces', false); cambiaSel('fps', '30'); marca('spin', false);
    pulsa('resetrender'); cuadros(2);
    const r = demo.render;
    for (const k of ['exposure', 'bloom', 'aces', 'fps']) if (r[k] !== HASH.RENDER_DEFAULTS[k]) falla(`resetrender no restablece ${k} (${r[k]})`);
    if (r.spin !== false) falla('resetrender toca el giro de la vista');
    if (C('exposure').get() !== HASH.RENDER_DEFAULTS.exposure) falla('resetrender no pone la exposición en el panel');
    marca('spin', true);
  }
  /* plegar el panel, las secciones y las pestañas; lo abierto se recuerda */
  {
    $('gui-title').click();
    if (!demo.panel.collapsed || $('gui-title').getAttribute('aria-expanded') !== 'false') falla('el título no pliega el panel');
    $('gui-title').click();
    if (demo.panel.collapsed) falla('el título no despliega el panel');
    const sec = $('sec-transform');
    sec.click();
    if ($('section-transform').classList.contains('open')) falla('el título de la sección no la pliega');
    sec.click();
    $('tab-render').click();
    if (!$('tabpanel-render').classList.contains('active') || $('tabpanel-scene').classList.contains('active')) falla('la pestaña Render no se abre');
    if (localStorage.getItem('nebula-dust-demo:tab') !== 'Render') falla('la pestaña abierta no se recuerda');
    $('tab-scene').click();
  }

  /* 6. grupos */
  hito('6. grupos');
  {
    const n0 = S.size;
    pulsa('add'); dibuja();
    if (S.size !== n0 + 1) falla('add no añade un grupo');
    const nuevo = demo.selected;
    if (S.listGroups().at(-1).id !== nuevo) falla('add no elige el grupo nuevo');
    if ($('group-list').children.length !== S.size) falla('la lista no enseña el grupo añadido');
    if (estado.nubesDibujadas !== S.size) falla(`tras añadir se dibujan ${estado.nubesDibujadas} nubes de ${S.size}`);
    pulsa('duplicate'); cuadros(2);
    const copia = demo.selected;
    if (S.size !== n0 + 2 || copia === nuevo) falla('duplicate no duplica');
    const a = S.getGroup(nuevo).spec, b = S.getGroup(copia).spec;
    if (a.morphology !== b.morphology || a.palette !== b.palette || a.seed === b.seed) falla('duplicate no copia la forma y la paleta con otra semilla');
    pulsa('hide'); dibuja();
    if (S.getGroup(copia).spec.visible || S.getGroup(copia).object3d.visible) falla('hide no oculta el grupo');
    if (estado.nubesDibujadas !== S.size - 1) falla(`con un grupo oculto se dibujan ${estado.nubesDibujadas} nubes de ${S.size}: ` + JSON.stringify(S.listGroups().map((g) => [g.id, g.visible, g.layer, S.getGroup(g.id).engine.points.visible])));
    if (C('hide').input.textContent !== 'Show') falla('con el grupo oculto el botón no dice Show');
    const fila = $('group-list').querySelector('[data-group="' + copia + '"]');
    const ojo = fila && fila.querySelector('[data-action="eye"]');
    if (!ojo) falla('la fila del grupo no tiene botón de ver');
    else {
      ojo.click(); cuadros(2);
      if (!S.getGroup(copia).spec.visible) falla('el botón de la fila no vuelve a mostrar el grupo');
    }
    $('group-list').querySelector('[data-group="' + nuevo + '"] [data-action="pick"]').click(); cuadros(1);
    if (demo.selected !== nuevo) falla('tocar la fila no elige el grupo');
    if (!$('group-list').querySelector('[data-group="' + nuevo + '"]').classList.contains('active')) falla('la fila elegida no se marca');
    pulsa('delete'); cuadros(2);
    if (S.size !== n0 + 1 || S.getGroup(nuevo)) falla('delete no borra el grupo');
    if (!demo.selected) falla('tras borrar no queda ningún grupo elegido');
    pulsa('delete'); cuadros(2);
    if (S.size !== n0) falla('delete no borra el segundo grupo');
  }

  /* 7. modos */
  hito('7. modos');
  {
    const n0 = S.size;
    segmento('mode', 'sow'); cuadros(1);
    if (demo.mode !== 'sow' || C('sow').hidden || !$('ctl-mode-sow').classList.contains('active')) falla('el segmento Sow no pone el modo sembrar');
    if (!/plant/i.test(C('mode-help').get())) falla('la ayuda del modo no cambia: ' + C('mode-help').get());
    cambiaSel('sow', 'ring');
    toque(800, 450); cuadros(2);
    if (S.size !== n0 + 1) falla('un toque en modo sembrar no siembra');
    else {
      const sp = spec();
      if (sp.preset !== 'ring') falla('se siembra otra cosa: ' + sp.preset);
      const t = demo.view.target;
      if (Math.hypot(sp.position[0] - t[0], sp.position[1] - t[1], sp.position[2] - t[2]) > 1e-6) falla('sembrado en el centro de la pantalla y no cae en el centro de la vista: ' + sp.position);
      if (Math.abs(sp.scale[0] - C('sowsize').get()) > 1e-9) falla('el tamaño de la siembra no se aplica');
    }
    cambiaSel('sow', 'shape:pinwheel');
    toque(1100, 300); cuadros(2);
    const sp2 = S.size === n0 + 2 ? spec() : null;
    if (!sp2 || sp2.morphology !== 'pinwheel' || sp2.preset !== null) falla('sembrar solo una forma no funciona');
    else if (!(sp2.position[0] > 0.1 && sp2.position[1] > 0.05)) falla('sembrar arriba a la derecha no cae arriba a la derecha: ' + sp2.position);
    /* un arrastre en modo sembrar gira la vista, no siembra y deja la vista en el enlace */
    const az = demo.view.azimuth;
    puntero('pointerdown', 500, 500); puntero('pointermove', 560, 500); puntero('pointerup', 560, 500); cuadros(1);
    if (S.size !== n0 + 2) falla('arrastrar en modo sembrar siembra');
    if (demo.view.azimuth === az) falla('arrastrar en modo sembrar no gira la vista');
    flush();
    if (!/[#&]view=/.test(location.hash)) falla('tras girar la vista a mano el enlace no la lleva: ' + location.hash);

    /* mover con el gizmo */
    tecla('Digit3'); cuadros(1);
    if (demo.mode !== 'move') falla('la tecla 3 no pone el modo mover');
    const gz = demo.gizmo;
    const o = S.getGroup(demo.selected).object3d;
    if (gz.object !== o) falla('en modo mover el gizmo no se engancha al grupo elegido');
    if (C('gizmo').hidden) falla('en modo mover no sale el selector del gizmo');
    segmento('gizmo', 'translate');
    if (gz.mode !== 'translate') falla('Gizmo · Move no pone el gizmo en mover');
    const antes = spec().position[0];
    gz.axis = 'X';
    if (typeof gz.getHelper === 'function') gz.getHelper().updateMatrixWorld(true);
    gz.pointerDown({ x: 0, y: 0, button: 0 });
    gz.pointerMove({ x: 0.3, y: 0, button: -1 });
    gz.pointerUp({ x: 0.3, y: 0, button: 0 });
    cuadros(2);
    const despues = spec().position[0];
    if (!(Math.abs(despues - antes) > 1e-3)) falla(`arrastrar el gizmo no mueve el grupo en la spec (${antes} → ${despues})`);
    if (Math.abs(C('posx').get() - Math.round(despues * 100) / 100) > 0.011) falla('el panel no sigue al gizmo');
    if (estado.gizmos < 1) falla('el gizmo no se dibuja');
    segmento('gizmo', 'rotate');
    if (gz.mode !== 'rotate') falla('Gizmo · Rotate no cambia el modo del gizmo');
    segmento('gizmo', 'scale');
    if (gz.mode !== 'scale') falla('Gizmo · Scale no cambia el modo del gizmo');
    segmento('gizmo', 'translate');
    /* una nube regenerada es otro Object3D: el gizmo tiene que seguirla */
    cambiaSel('samples', '65536'); cuadros(2);
    if (gz.object !== S.getGroup(demo.selected).object3d) falla('tras regenerar la nube el gizmo se queda en la vieja');
    tecla('Digit1'); cuadros(1);
    if (demo.mode !== 'orbit' || gz.object) falla('la tecla 1 no vuelve a Orbit o el gizmo sigue enganchado');

    /* tocar */
    marca('spin', false);
    for (const g of S.listGroups()) S.updateGroup(g.id, { motion: 0, flowSpeed: 0, evolutionRate: 0 });
    cuadros(30);
    segmento('mode', 'touch'); cuadros(1);
    if (demo.mode !== 'touch' || C('touchradius').hidden) falla('el segmento Touch no pone el modo tocar');
    const antesToque = estado.renders;
    puntero('pointerdown', 800, 450); puntero('pointermove', 820, 455); puntero('pointerup', 820, 455);
    const tocados = S.listGroups().filter((g) => S.getGroup(g.id).engine.getStatus().activeTouches > 0).length;
    if (tocados < 1) falla('tocar no empuja ningún grupo');
    if (!S.isAnimated()) falla('con un toque vivo el sistema no se anima');
    cuadros(30);
    if (estado.renders - antesToque < 10) falla('con un toque vivo no se dibuja');
    cuadros(600);
    if (S.isAnimated()) falla('el toque no se desvanece');
    const r0 = estado.renders;
    cuadros(144);
    if (estado.renders !== r0) falla('tras el toque sigue dibujando sin nada que cambie');
    tecla('Digit4');
    if (demo.mode !== 'touch') falla('la tecla 4 no pone el modo tocar');
    tecla('Digit2');
    if (demo.mode !== 'sow') falla('la tecla 2 no pone el modo sembrar');

    /* elegir con un toque: se elige lo que hay bajo el centro */
    segmento('mode', 'orbit'); cuadros(1);
    const esperado = S.pickScreen(0, 0, demo.camera);
    if (!esperado) falla('no hay ningún grupo en el centro de la pantalla');
    else {
      const otro = S.listGroups().find((g) => g.id !== esperado.id);
      demo.select(otro.id);
      toque(800, 450); cuadros(1);
      if (demo.selected !== esperado.id) falla(`un toque en el centro elige ${demo.selected} y no ${esperado.id}`);
    }
    /* pellizco */
    const d0 = demo.view.distance;
    puntero('pointerdown', 700, 450, 1, 'touch'); puntero('pointerdown', 900, 450, 2, 'touch');
    puntero('pointermove', 600, 450, 1, 'touch'); puntero('pointermove', 1000, 450, 2, 'touch');
    puntero('pointerup', 600, 450, 1, 'touch'); puntero('pointerup', 1000, 450, 2, 'touch');
    cuadros(1);
    if (!(demo.view.distance < d0 * 0.8)) falla(`el pellizco no acerca (${d0} → ${demo.view.distance})`);
    if (Math.abs(demo.hashState().view.distance - demo.view.distance) > 1e-3) falla('tras el pellizco el enlace no lleva la distancia nueva');
    /* la rueda */
    const d1 = demo.view.distance;
    despacha(estado.renderer.domElement, evento('wheel', { deltaY: 300 }));
    if (!(demo.view.distance > d1)) falla('la rueda no aleja');
    marca('spin', true);
  }

  /* 8. teclas */
  hito('8. teclas');
  {
    await cargaDemo(fuentes, '#preset=orion', { gpu: 'intelhd' });
    const d = globalThis.window.nebulaDustDemo;
    const ui2 = d.panel.controllers;
    const sp = () => d.system.getGroup(d.selected).spec;
    const orden = ui2.get('preset').options().map((o) => o.value).filter(Boolean);
    tecla('ArrowRight'); cuadros(2);
    if (sp().preset !== orden[orden.indexOf('orion') + 1]) falla('→ no pasa al preset siguiente: ' + sp().preset);
    tecla('ArrowLeft'); cuadros(2);
    if (sp().preset !== 'orion') falla('← no vuelve al preset anterior: ' + sp().preset);
    tecla('ArrowLeft'); cuadros(2);
    if (sp().preset !== orden.at(-1)) falla('← desde el primero no da la vuelta al último: ' + sp().preset);
    tecla('ArrowRight'); cuadros(2);
    if (sp().preset !== 'orion') falla('→ desde el último no da la vuelta al primero');
    ui2.get('preset-next').input.click(); cuadros(2);
    probados.add('preset-next');
    if (sp().preset !== orden[1]) falla('el botón › no pasa al preset siguiente');
    ui2.get('preset-prev').input.click(); cuadros(2);
    probados.add('preset-prev');
    if (sp().preset !== 'orion') falla('el botón ‹ no vuelve al anterior');
    const pos = sp().position.slice();
    d.system.updateGroup(d.selected, { position: [0.5, 0.2, -0.1] });
    tecla('ArrowRight'); cuadros(2);
    if (sp().position[0] !== 0.5) falla('→ mueve el grupo: el preset no debe tocar dónde está');
    d.system.updateGroup(d.selected, { position: pos, preset: 'orion' });
    /* R */
    const antes = { preset: sp().preset, seed: sp().seed };
    tecla('KeyR'); cuadros(2);
    if (sp().preset === antes.preset || sp().seed === antes.seed) falla('R no sortea otro aspecto: ' + JSON.stringify({ antes, ahora: [sp().preset, sp().seed] }));
    d.flushHash();
    if (!/[#&]preset=/.test(location.hash) || !/[#&]seed=/.test(location.hash)) falla('tras R el hash no lleva el preset y la semilla: ' + location.hash);
    const r1 = sp().preset;
    $('randomize').click(); cuadros(2);
    if (sp().preset === r1) falla('el botón de azar no cambia el aspecto');
    if (!$('randomize').classList.contains('turned')) falla('el botón de azar no gira');
    /* nada mientras se escribe, ni con Ctrl */
    const nombre = ui2.get('name').input;
    nombre.focus();
    const p1 = sp().preset;
    const ev = tecla('KeyR', { target: nombre });
    cuadros(1);
    if (sp().preset !== p1) falla('R sortea mientras se escribe en un campo');
    if (ev.defaultPrevented) falla('R se come la tecla mientras se escribe');
    tecla('ArrowRight', { target: ui2.get('opacity').input }); cuadros(1);
    if (sp().preset !== p1) falla('→ cambia de preset con el foco en un deslizador');
    nombre.blur();
    tecla('KeyR', { ctrl: true }); cuadros(1);
    if (sp().preset !== p1) falla('Ctrl+R sortea (debe recargar la página)');
    /* Espacio: pausa; el reloj del motor se para y no se dibuja */
    d.system.updateGroup(d.selected, { motion: 0.4 });
    cuadros(10);
    /* el cuadro que pinta la pausa ya no avanza el reloj */
    const t0 = d.engine.material.uniforms.uTime.value;
    tecla('Space'); cuadros(3);
    if (!d.paused || $('pause').getAttribute('aria-pressed') !== 'true') falla('Espacio no pausa');
    if (d.engine.material.uniforms.uTime.value !== t0) falla('en pausa el reloj del motor sigue corriendo');
    let r0 = estado.renders;
    cuadros(144);
    if (estado.renders !== r0) falla(`en pausa, con giro y turbulencia, se dibujan ${estado.renders - r0} cuadros`);
    ui2.get('opacity').input.value = '0.5';
    despacha(ui2.get('opacity').input, evento('input'));
    cuadros(3);
    if (estado.renders === r0) falla('en pausa, mover un control no vuelve a dibujar');
    if (d.engine.material.uniforms.uTime.value !== t0) falla('en pausa, al volver a dibujar, el reloj del motor corre');
    tecla('Space'); cuadros(3);
    r0 = estado.renders;
    cuadros(30);
    if (d.paused || estado.renders - r0 < 10) falla('Espacio no quita la pausa');
    $('pause').click();
    if (!d.paused) falla('el botón de pausa no pausa');
    $('pause').click();
    const pausaBoton = tecla('Space', { target: $('pause') });
    if (d.paused || pausaBoton.defaultPrevented) falla('Espacio sobre un botón pausa en vez de pulsar el botón');
    /* Tab: oculta la interfaz; dentro del panel mueve el foco */
    const evTab = tecla('Tab');
    if (!document.body.classList.contains('ui-hidden') || !evTab.defaultPrevented) falla('Tab no oculta la interfaz');
    if ($('ui-toggle').getAttribute('aria-pressed') !== 'true') falla('con la interfaz oculta el botón no se marca');
    tecla('Tab');
    if (document.body.classList.contains('ui-hidden')) falla('Tab no vuelve a enseñar la interfaz');
    const dentro = tecla('Tab', { target: $('tab-scene') });
    if (document.body.classList.contains('ui-hidden') || dentro.defaultPrevented) falla('Tab dentro del panel oculta la interfaz en vez de mover el foco');
    $('ui-toggle').click();
    if (!document.body.classList.contains('ui-hidden')) falla('el botón de la interfaz no la oculta');
    $('ui-toggle').click();
    /* F, el botón, el doble clic y el doble toque: pantalla completa */
    tecla('KeyF');
    if (estado.pantallas !== 1 || !document.fullscreenElement) falla('F no pone la pantalla completa');
    if ($('fullscreen').getAttribute('aria-pressed') !== 'true') falla('en pantalla completa el botón no se marca');
    tecla('KeyF');
    if (document.fullscreenElement) falla('F no quita la pantalla completa');
    $('fullscreen').click();
    if (estado.pantallas !== 2) falla('el botón no pone la pantalla completa');
    $('fullscreen').click();
    puntero('pointerdown', 300, 300); puntero('pointerup', 300, 300);
    despacha(estado.renderer.domElement, evento('dblclick'));
    if (estado.pantallas !== 3) falla('el doble clic no pone la pantalla completa');
    document.exitFullscreen();
    toque(810, 440, 'touch'); toque(812, 441, 'touch');
    if (estado.pantallas !== 4) falla('el doble toque no pone la pantalla completa');
    document.exitFullscreen();
    d.setMode('sow');
    const n = d.system.size;
    despacha(estado.renderer.domElement, evento('dblclick'));
    if (estado.pantallas !== 4) falla('el doble clic en modo sembrar pone la pantalla completa');
    if (d.system.size !== n) falla('el doble clic siembra');
    d.setMode('orbit');
    /* con la escena vacía, → siembra el primer preset */
    ui2.get('clear').input.click(); cuadros(2);
    tecla('ArrowRight'); cuadros(2);
    if (d.system.size !== 1 || sp().preset !== orden[0]) falla('→ con la escena vacía no crea un grupo del primer preset');
  }

  /* 9. el hash legible */
  hito('9. el hash legible');
  {
    /* ida y vuelta completa: ejemplo retocado, un grupo sembrado, vista y render */
    let d = await cargaDemo(fuentes, '#scene=collision', { gpu: 'intelhd' });
    if (d.system.size !== 4) falla('#scene=collision no monta el choque');
    d.select(d.system.listGroups()[2].id);
    let u = d.panel.controllers;
    const mueve = (k, v) => { u.get(k).input.value = String(v); despacha(u.get(k).input, evento('input')); };
    mueve('turbulence', 0.6);
    mueve('posy', 0.25);
    mueve('explosion', 0.3);
    u.get('palette').input.value = 'custom'; despacha(u.get('palette').input, evento('change'));
    u.get('name').input.value = 'Debris & dust, 50%'; despacha(u.get('name').input, evento('change'));
    d.setMode('sow');
    u.get('sow').input.value = 'shape:clumpyShell'; despacha(u.get('sow').input, evento('change'));
    toque(500, 380); cuadros(2);
    d.setMode('orbit');
    puntero('pointerdown', 700, 500); puntero('pointermove', 760, 470); puntero('pointerup', 760, 470);
    d.setRender({ exposure: 10.5, bloom: 0.8, halfres: true, grain: 0.03, fps: 30, quality: 'balanced', budget: 2000000 });
    cuadros(3);
    const h = d.flushHash();
    const esperado = { groups: d.system.serialize().groups, view: d.hashState().view, render: d.render, selected: d.hashState().selected };
    if (/^#s=/.test(h) || !/^#scene=collision&/.test(h)) falla('el hash no es legible ni parte del ejemplo: ' + h.slice(0, 60));
    for (const p of ['g3.turb=0.6', 'g3.pos=', 'g3.evo=0.3', 'g3.colors=', 'g5.shape=clumpyShell', 'view=', 'exposure=10.5', 'bloom=0.8', 'halfres=1', 'grain=0.03', 'fps=30', 'quality=balanced', 'budget=2000000', 'sel=5']) {
      if (!h.includes(p)) falla('el hash no lleva ' + p + ': ' + h);
    }
    if (!/g3\.name=Debris\+%26\+dust,\+50%25/.test(h)) falla('el nombre no va legible en el hash: ' + h);
    d = await cargaDemo(fuentes, h, { gpu: 'intelhd' });
    const dif = difiere(esperado.groups, d.system.serialize().groups);
    if (dif.length) falla('el enlace legible no monta la misma escena: ' + dif.slice(0, 4).join('; '));
    if (difiere([esperado.view], [d.hashState().view]).length) falla('el enlace no conserva la vista: ' + JSON.stringify([esperado.view, d.hashState().view]));
    if (JSON.stringify(esperado.render) !== JSON.stringify(d.render)) falla('el enlace no conserva el render: ' + JSON.stringify(d.render));
    if (d.hashState().selected !== esperado.selected) falla('el enlace no conserva el grupo elegido');
    if (estado.renderer.pixelRatio !== 0.75 || d.post.settings.exposure !== 10.5) falla('el render del enlace no llega al renderer y al posproceso');
    if (location.hash !== h) falla('al cargar un enlace legible se reescribe distinto: ' + location.hash.slice(0, 80));
    /* #preset=… con semilla, motas y opacidad */
    d = await cargaDemo(fuentes, '#preset=orion&seed=3&samples=65536&opacity=0.7', { gpu: 'intelhd' });
    let s = d.system.size === 1 ? d.system.getGroup(d.selected).spec : null;
    if (!s || s.preset !== 'orion' || s.seed !== 3 || s.count !== 65536 || s.opacity !== 0.7) falla('#preset=orion&seed=3&samples=65536&opacity=0.7 no da ese grupo: ' + JSON.stringify(s && [s.preset, s.seed, s.count, s.opacity]));
    else if (d.engine.metadata.sampleCount !== 65536 || d.engine.metadata.seed !== 3) falla('el grupo del enlace no tiene esas motas o esa semilla');
    if (location.hash !== '#preset=orion&seed=3&samples=65536&opacity=0.7') falla('el hash de un preset no queda igual: ' + location.hash);
    /* una semilla de texto que se lee como número va entre comillas; «0042» no se confunde */
    d.system.updateGroup(d.selected, { seed: '42' });
    let h2 = d.flushHash();
    if (!h2.includes('seed=%2242%22')) falla('una semilla de texto «42» no va entre comillas: ' + h2);
    d = await cargaDemo(fuentes, h2, { gpu: 'intelhd' });
    if (d.system.getGroup(d.selected).spec.seed !== '42') falla('la semilla de texto «42» vuelve como ' + JSON.stringify(d.system.getGroup(d.selected).spec.seed));
    d.system.updateGroup(d.selected, { seed: '0042' });
    h2 = d.flushHash();
    d = await cargaDemo(fuentes, h2, { gpu: 'intelhd' });
    if (d.system.getGroup(d.selected).spec.seed !== '0042') falla('la semilla «0042» vuelve como ' + JSON.stringify(d.system.getGroup(d.selected).spec.seed));
    /* una escena de un grupo sin nada propio también existe */
    d.system.clear();
    d.system.addGroup({ id: 'g1', radius: HASH.DEMO_RADIUS });
    d.select('g1');
    h2 = d.flushHash();
    if (h2 !== '#preset=none') falla('un grupo en blanco no se escribe como #preset=none: ' + h2);
    d = await cargaDemo(fuentes, h2, { gpu: 'intelhd' });
    if (d.system.size !== 1) falla('#preset=none no monta un grupo');
    /* los enlaces viejos: #s=… (0.4.0) y los nombres */
    const vieja = { format: 'nebula-dust-scene', version: 1, groups: [{ id: 'a', preset: 'ring', seed: 'x', radius: 1, opacity: 0.5 }, { id: 'b', morphology: 'pinwheel', palette: 'hotDust', radius: 0.8, position: [0.3, 0, 0] }], view: { target: [0, 0, 0], azimuth: 0.4, elevation: 0.1, distance: 4 } };
    const comprimido = '#s=' + await encodeDustScene(vieja);
    d = await cargaDemo(fuentes, comprimido, { gpu: 'intelhd' });
    if (d.system.size !== 2 || d.system.getGroup(d.system.listGroups()[0].id).spec.preset !== 'ring' || d.system.getGroup(d.system.listGroups()[1].id).spec.morphology !== 'pinwheel') falla('un enlace #s=… de la 0.4.0 no monta su escena');
    if (location.hash.startsWith('#s=') || !/[#&]preset=ring/.test(location.hash)) falla('un enlace #s=… no se pasa a parámetros legibles: ' + location.hash.slice(0, 60));
    if (Math.abs(d.hashState().view.distance - 4) > 1e-9) falla('un enlace #s=… pierde su vista');
    const legible = location.hash;
    d = await cargaDemo(fuentes, legible, { gpu: 'intelhd' });
    const dif2 = difiere(d.system.serialize().groups, (await cargaDemo(fuentes, comprimido, { gpu: 'intelhd' })).system.serialize().groups);
    if (dif2.length) falla('el #s=… pasado a legible no da la misma escena: ' + dif2.slice(0, 3).join('; '));
    d = await cargaDemo(fuentes, '#orion', { gpu: 'intelhd' });
    for (const [hh, esperadoForma] of [['#m42', 'orion'], ['#betelgeuse', 'clumpyShell'], ['#wr104', 'pinwheel'], ['#M1', 'crab'], ['#pilares', 'pillars']]) {
      location.hash = hh;
      globalThis.window.dispatchEvent(evento('hashchange'));
      await espera(5);
      cuadros(2);
      if (d.system.size !== 1 || d.engine.metadata.morphology !== esperadoForma) falla(`hashchange ${hh}: forma ${d.engine && d.engine.metadata.morphology}`);
      if (!/^#preset=\w+$/.test(location.hash)) falla(`${hh} no se reescribe como #preset=…: ${location.hash}`);
    }
    location.hash = '#choque'; globalThis.window.dispatchEvent(evento('hashchange')); await espera(5); cuadros(2);
    if (d.system.size !== 4 || location.hash !== '#scene=collision') falla('#choque no monta el ejemplo del choque como #scene=collision');
    location.hash = '#bloom=1.5&vignette=0'; globalThis.window.dispatchEvent(evento('hashchange')); await espera(5); cuadros(2);
    if (d.system.size !== 4 || d.render.bloom !== 1.5 || d.render.vignette !== 0) falla('un hash de solo render no se aplica sobre la escena que hay');
    if (!/^#scene=collision&/.test(location.hash) || !location.hash.includes('bloom=1.5')) falla('tras un hash de solo render el enlace no lleva la escena: ' + location.hash);
    for (const [hh, esperadoPreset, n] of [['#betelgeuse', 'redSupergiantShell', 1], ['#collidingWindPinwheel', 'collidingWindPinwheel', 1], ['#no-existe', 'orion', 2], ['#enana_blanca', 'whiteDwarfAccretion', 1], ['#diskRingHalo', 'whiteDwarfAccretion', 3], ['#s=zbasura', 'orion', 2], ['#exposure=12', 'orion', 2]]) {
      const dd = await cargaDemo(fuentes, hh, { gpu: 'intelhd' });
      const dentro = dd.panel.controllers.get('preset').get();
      if (dentro !== esperadoPreset) falla(`al cargar con ${hh}: preset ${dentro}`);
      if (dd.system.size !== n) falla(`al cargar con ${hh}: ${dd.system.size} grupos y no ${n}`);
      if (!dd.engine || dd.engine.metadata.sampleCount < 1) falla(`al cargar con ${hh}: sin motas`);
      if (hh === '#s=zbasura' && $('error').hidden) falla('un enlace roto no se avisa');
      if (hh === '#no-existe' && ($('toast').hidden || !/Unknown link/.test($('toast').textContent))) falla('un enlace desconocido no se avisa');
      if (hh === '#exposure=12' && dd.render.exposure !== 12) falla('#exposure=12 no pone la exposición');
    }
    const dw = await cargaDemo(fuentes, '#preset=orion&foo=1&opacity=abc', { gpu: 'intelhd' });
    if ($('toast').hidden || !/foo/.test($('toast').textContent) || !/opacity/.test($('toast').textContent)) falla('los parámetros que no se entienden no se avisan: ' + $('toast').textContent);
    if (dw.system.size !== 1) falla('un parámetro raro estropea el enlace');
  }

  /* 10. guardar, cargar, enlace, vaciar y ejemplos */
  hito('10. guardar, cargar, enlace, vaciar y ejemplos');
  {
    const d = await cargaDemo(fuentes, '#scene=diskRingHalo', { gpu: 'intelhd' });
    const u = d.panel.controllers;
    const P = (k) => { probados.add(k); u.get(k).input.click(); };
    P('save'); cuadros(1);
    let datos = null;
    try { datos = JSON.parse(d.lastExport); } catch { falla('save no da un JSON'); }
    if (datos && (datos.format !== 'nebula-dust-scene' || datos.groups.length !== d.system.size || !datos.view)) falla('save no guarda la escena entera con la vista');
    if ($('toast').hidden || !/saved/.test($('toast').textContent)) falla('save no avisa');
    const antes = JSON.stringify(d.system.serialize().groups);
    P('clear'); cuadros(2);
    if (d.system.size !== 0 || d.selected !== null) falla('clear no vacía');
    d.flushHash();
    if (!/^#scene=empty(&|$)/.test(location.hash)) falla('la escena vacía no es #scene=empty: ' + location.hash);
    if (u.get('nogroup').hidden || !$('section-look').hidden) falla('sin grupos no se dice que no hay grupos');
    P('load');
    if ($('file').clicks < 1) falla('load no abre el selector de ficheros');
    $('file').files = [{ name: 'scene.json', text: async () => d.lastExport }];
    despacha($('file'), evento('change'));
    await espera(20); cuadros(3);
    if (JSON.stringify(d.system.serialize().groups) !== antes) falla('cargar el JSON guardado no da la misma escena');
    if (JSON.stringify(JSON.parse(d.exportJSON()).groups) !== JSON.stringify(datos.groups)) falla('guardar tras cargar no da el mismo JSON');
    $('file').files = [{ name: 'bad.json', text: async () => '{"hello": 1}' }];
    despacha($('file'), evento('change'));
    await espera(20); cuadros(2);
    if ($('error').hidden || !/not a Nebula Dust Engine scene/.test($('error').textContent)) falla('un JSON que no es escena no se avisa');
    if (JSON.stringify(d.system.serialize().groups) !== antes) falla('un JSON malo estropea la escena');
    $('error').hidden = true;
    P('link');
    await espera(10);
    const copiado = estado.portapapeles.at(-1) || '';
    if (!copiado.endsWith(location.hash) || !/#preset=|#scene=|#g/.test(copiado) || /#s=/.test(copiado)) falla('copy link no copia la dirección con el hash legible: ' + copiado.slice(0, 80));
    const E = u.get('example');
    const esperados = { twinNebula: 2, collision: 4, diskRingHalo: 3 };
    for (const k of Object.keys(esperados)) {
      probados.add('example');
      E.input.value = k; despacha(E.input, evento('change')); cuadros(3);
      if (d.system.size !== esperados[k]) falla(`ejemplo ${k}: ${d.system.size} grupos`);
      if (location.hash !== '#scene=' + k) falla(`ejemplo ${k}: el hash no es #scene=${k} (${location.hash.slice(0, 30)})`);
      sinNaN(d.system, k);
      for (const g of d.system.listGroups()) compila(d.system.getGroup(g.id).engine.material, k + '/' + g.id);
    }
    /* la vista vuelve a la del ejemplo */
    puntero('pointerdown', 700, 500); puntero('pointermove', 800, 420); puntero('pointerup', 800, 420);
    P('resetview'); cuadros(1);
    if (JSON.stringify(d.hashState().view) !== JSON.stringify(HASH.exampleView('diskRingHalo'))) falla('resetview no vuelve a la vista del ejemplo');
  }

  /* 11. rendimiento */
  hito('11. rendimiento');
  {
    const d = await cargaDemo(fuentes, '#preset=orion&spin=0', { gpu: 'intelhd' });
    const u = d.panel.controllers;
    cuadros(10);
    if (d.system.isAnimated()) falla('Orión quieto se cree animado');
    const r0 = estado.renders;
    cuadros(300);
    if (estado.renders !== r0) falla(`quieto dibuja igual: ${estado.renders - r0} cuadros en 2 s`);
    if (estado.rafs.size) falla('quieto sigue pidiendo requestAnimationFrame');
    if (u.get('fpsnow').get() !== 'idle') falla('las estadísticas no dicen que está quieto: ' + u.get('fpsnow').get());
    u.get('spin').input.checked = true; despacha(u.get('spin').input, evento('change'));
    cuadros(20);
    let r1 = estado.renders;
    cuadros(288, 144);
    const fps60 = (estado.renders - r1) / 2;
    if (fps60 < 50 || fps60 > 66) falla(`tope de 60 en pantalla de 144 Hz: ${fps60} fps`);
    if (!/^\d+ fps$/.test(u.get('fpsnow').get()) || u.get('fpsnow').range.textContent !== 'cap 60') falla('las estadísticas no enseñan los fps y el tope: ' + u.get('fpsnow').get());
    if (!/ms$/.test(u.get('gpu').get()) || !/^[\d,]+$/.test(u.get('drawn').get())) falla('las estadísticas no enseñan la GPU y las motas dibujadas');
    u.get('fps').input.value = '0'; despacha(u.get('fps').input, evento('change'));
    cuadros(10);
    r1 = estado.renders;
    cuadros(144, 144);
    if (estado.renders - r1 < 130) falla(`sin tope no va a 144 fps: ${estado.renders - r1}`);
    u.get('fps').input.value = '60'; despacha(u.get('fps').input, evento('change')); cuadros(5);
    document.hidden = true;
    for (const f of document.listeners.visibilitychange || []) f({});
    r1 = estado.renders;
    cuadros(144);
    if (estado.renders !== r1) falla(`con la pestaña oculta dibuja: ${estado.renders - r1}`);
    document.hidden = false;
    for (const f of document.listeners.visibilitychange || []) f({});
    cuadros(20);
    if (estado.renders === r1) falla('al volver a la pestaña no vuelve a dibujar');
    u.get('samples').input.value = '4000000'; despacha(u.get('samples').input, evento('change'));
    if ($('toast').hidden || !/Generating 4,000,000/.test($('toast').textContent)) falla('no se avisa de que se generan 4 millones');
    await espera(60);
    cuadros(3);
    if (d.engine.metadata.sampleCount !== 4000000) falla('no se generan 4 millones de motas');
    sinNaN(d.system, '4 M');
  }

  /* 12. el negro de producción y los shaders del posproceso */
  hito('12. el negro de producción y los shaders del posproceso');
  {
    const d7 = await cargaDemo(fuentes, '#interstellarDust', { gpu: 'intelhd' });
    if (estado.tipoDestino !== THREE.HalfFloatType) falla(`el polvo se dibuja en ${estado.tipoDestino === 'lienzo' ? 'el lienzo de 8 bits' : 'un destino de tipo ' + estado.tipoDestino}, no en HalfFloat`);
    if (estado.salidas < 1) falla('no hay pasada de gradación al lienzo (tonemap + sRGB)');
    if (!(d7.engine.getStatus().lightReferenceSamples > 0)) falla('la demo no fija la luz de referencia (lightReferenceSamples)');
    if (estado.lecturas < 1) falla('la demo no comprueba el lienzo tras montar la escena');
    if (!$('error').hidden) falla('con el lienzo bien, se avisa de un fallo: ' + $('error').textContent);
    estado.lienzo = 'vacio';
    d7.selectPreset('orion');
    cuadros(4);
    if ($('error').hidden || !/empty/.test($('error').textContent)) falla('con el lienzo vacío no se avisa en pantalla');
    estado.lienzo = 'lleno';
    d7.selectPreset('interstellarDust');
    cuadros(4);
    if (!$('error').hidden) falla('el aviso de lienzo vacío no se quita cuando vuelve a verse');
    const r = estado.renderer;
    if (typeof r.debug.onShaderError !== 'function') falla('la demo no escucha los errores de compilación del shader');
    else {
      const errorDeConsola = console.error;
      console.error = () => {};
      try { r.debug.onShaderError(r.getContext(), {}, {}, {}); } finally { console.error = errorDeConsola; }
      if ($('error').hidden || !/does not compile/.test($('error').textContent)) falla('un shader que no compila no se avisa en pantalla');
    }
    for (const [k, m] of Object.entries(d7.post.materials)) compila(m, 'posproceso ' + k, { logDepth: false });
    if (d7.post.materials.grade.uniforms.uExposure.value !== HASH.RENDER_DEFAULTS.exposure) falla('la exposición de fábrica no llega a la gradación');
  }

  /* 13. el móvil */
  hito('13. el móvil');
  {
    const dm = await cargaDemo(fuentes, '', { movil: true });
    const u = dm.panel.controllers;
    if (!dm.panel.collapsed) falla('en el móvil el panel no arranca plegado');
    const grandes = u.get('samples').options().filter((o) => Number(o.value) > 1000000);
    if (!grandes.length || grandes.some((o) => !o.disabled)) falla('en el móvil se ofrecen más de un millón de motas');
    const altas = u.get('quality').options().filter((o) => ['high', 'ultra'].includes(o.value));
    if (altas.length !== 2 || altas.some((o) => !o.disabled)) falla('en el móvil se ofrecen las calidades High y Ultra');
    if (dm.engine.metadata.sampleCount > 65536) falla(`en el móvil el grupo automático tiene ${dm.engine.metadata.sampleCount} motas`);
    dm.setMode('sow');
    const n0 = dm.system.size;
    toque(400, 300, 'touch'); cuadros(2);
    if (dm.system.size !== n0 + 1) falla('en el móvil un toque no siembra');
    const d0 = dm.view.distance;
    puntero('pointerdown', 700, 450, 1, 'touch'); puntero('pointerdown', 900, 450, 2, 'touch');
    puntero('pointermove', 750, 450, 1, 'touch'); puntero('pointermove', 850, 450, 2, 'touch');
    puntero('pointerup', 750, 450, 1, 'touch'); puntero('pointerup', 850, 450, 2, 'touch');
    if (!(dm.view.distance > d0)) falla('en el móvil el pellizco no aleja');
    if (dm.system.size !== n0 + 1) falla('en el móvil el pellizco siembra');
    dm.setMode('orbit');
    toque(600, 500, 'touch'); toque(603, 502, 'touch');
    if (estado.pantallas !== 1) falla('en el móvil el doble toque no pone la pantalla completa');
    /* sin la API (un iPhone): ni botón ni errores al tocar dos veces o pulsar F */
    const di = await cargaDemo(fuentes, '', { movil: true, gpu: 'intelhd', sinPantallaCompleta: true });
    if (!$('fullscreen').hidden) falla('sin la API de pantalla completa se enseña el botón');
    toque(600, 500, 'touch'); toque(603, 502, 'touch');
    tecla('KeyF');
    if (!di.system.size) falla('sin la API de pantalla completa la demo no arranca');
    /* la pestaña recordada vuelve en la visita siguiente */
    const guardado = globalThis.localStorage;
    document.getElementById('tab-stats').click();
    const d2 = await cargaDemo(fuentes, '', { guardado, gpu: 'intelhd' });
    if (d2.panel.activeTab !== 'Stats') falla('la pestaña abierta no se recuerda entre visitas');
  }

  /* 14. ningún control sin probar */
  hito('14. ningún control sin probar');
  const sinProbar = [...ui.entries()]
    .filter(([k, c]) => (c.input || c.buttons || c.inputs) && !probados.has(k))
    .map(([k]) => k);
  if (sinProbar.length) falla('controles del panel sin probar: ' + sinProbar.join(', '));
}

let codigo = 0;
try {
  if (!HAY_VALIDADOR) console.log('(sin glslangValidator: los shaders no se compilan)');
  console.log('gizmo: ' + (TC_REAL ? 'TransformControls de three (' + TC_REAL + ')' : 'de prueba (three/addons no está instalado)'));
  const t0 = Date.now();
  const fallos = await prueba(ORIGINAL);
  if (fallos.length) {
    console.log('FALLOS:\n  ' + fallos.join('\n  '));
    codigo = 1;
  } else {
    console.log(`Editor de la demo en Node (DOM y renderer falsos): OK (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  if (AUTO) {
    const M = (fichero, nombre, antes, despues) => [nombre, fichero, (s) => s.replace(antes, despues)];
    const mutantes = [
      M('main.js', 'sin tope de fps', 'if (intervalo && ultimoRitmo && now - ultimoRitmo < intervalo - 0.5) {', 'if (false) {'),
      M('main.js', 'sin render bajo demanda', 'if (!sucio && !seMueve) {', 'if (false) {'),
      ['sin pausa con la pestaña oculta', 'main.js', (s) => s.replace('  if (document.hidden) return;\n  const seMueve', '  const seMueve').replace('if (!pedido && !document.hidden && !detenido)', 'if (!pedido && !detenido)').replace('if (pedido) cancelAnimationFrame(pedido);\n    pedido = 0;\n    ultimoRitmo = 0;', 'ultimoRitmo = 0;')],
      M('main.js', 'el polvo en el lienzo de 8 bits', '  post.begin();\n', '\n'),
      M('main.js', 'sin aviso de lienzo vacío', 'if (compruebaEn && --compruebaEn === 0) compruebaLienzo();', ''),
      M('main.js', 'sin luz de referencia', 'lightReferenceSamples: LUZ_REFERENCIA,', ''),
      M('main.js', 'el gizmo no guarda en la spec', '  sistema.captureTransform(sel);\n', '\n'),
      M('main.js', 'sembrar no siembra', "if (modo === 'sow') siembraEn(e.clientX, e.clientY);", "if (modo === 'sow') void 0;"),
      M('main.js', 'tocar no toca', 'const n = sistema.touch(', 'const n = 0 && sistema.touch('),
      M('main.js', 'la fila no oculta', 'if (g) sistema.updateGroup(id, { visible: !g.spec.visible });', ''),
      M('main.js', 'la fila no elige', "if (b.dataset.action === 'pick') elige(id);", "if (b.dataset.action === 'pick') void 0;"),
      M('main.js', 'el gizmo no sigue a la nube regenerada', 'if (e.id === sel) colocaGizmo();', ''),
      M('main.js', 'la pausa no para el reloj', 'sistema.update(camera, pausado ? 0 : deltaSeconds);', 'sistema.update(camera, deltaSeconds);'),
      M('main.js', 'la pausa no para de dibujar', '  if (pausado) return punteros.size > 0;\n', '\n'),
      M('main.js', '→ no cambia de preset', "bindKey('ArrowRight', () => pasoPreset(1));", "bindKey('ArrowRight', () => {});"),
      M('main.js', 'R no sortea', "bindKey('KeyR', () => lookAleatorio());", "bindKey('KeyR', () => {});"),
      M('main.js', 'Tab no oculta', "  ocultaInterfaz(!document.body.classList.contains('ui-hidden'));\n  return true;", '  return true;'),
      M('main.js', 'F sin pantalla completa', "bindKey('KeyF', () => pantallaCompleta());", "bindKey('KeyF', () => {});"),
      M('main.js', 'doble toque sin pantalla completa', "if (modo === 'orbit' && e.pointerType === 'touch') dobleToque(e);", ''),
      M('main.js', 'media resolución sin efecto', 'renderer.setPixelRatio(DPR_BASE * escalaRes());', ''),
      M('main.js', 'el maxpx no llega', 'onChange: (v) => cambia({ maxPointSize: v })', 'onChange: (v) => void v'),
      M('main.js', 'la cámara arranca viendo solo la capa 0', "  if (render.layers === 'all') camera.layers.enableAll();\n  else camera.layers.set(Number(render.layers));", "  if ('layers' in cambiado) camera.layers.set(render.layers === 'all' ? 0 : Number(render.layers));"),
      M('main.js', 'una excepción escondida en una demo anterior', "btnPantalla.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');", "btnPantalla.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen'); if (on) throw new Error('fallo fingido');"),
      M('main.js', 'la vista del usuario no va al enlace', '    } else if (modo !== \'touch\') {\n      fijaVista();', '    } else if (modo !== \'touch\') {\n      void 0;'),
      M('hash.js', 'el hash no lleva los grupos', 'for (const [k, v] of params) pairs.push([prefix + k, v]);', ''),
      M('hash.js', 'el hash ignora los enlaces #s=', "if (h.startsWith('s=')) return { kind: 'compressed', text: h.slice(2) };", ''),
      M('hash.js', 'el hash pierde el render', '    else render[k] = v;', '    else void v;'),
      M('hash.js', 'las semillas pierden su tipo', "  return CANONICAL_INT.test(s) ? '\"' + s + '\"' : s;", '  return s;'),
      M('panel.js', 'teclas mientras se escribe', '  if (isField(e.target)) return;\n', '\n'),
      M('panel.js', 'el deslizador no avisa', "input.addEventListener('input', c.fire);", ''),
      M('panel.js', 'la etiqueta no sortea', 'if (reroll && !c.disabled && !row.hidden) reroll();', ''),
      M('panel.js', 'el panel no se pliega', "this.titleEl.addEventListener('click', () => this.setCollapsed(!this.collapsed));", ''),
      M('post.js', 'sin bloom', '    if (bloomOn) renderBloom();\n', '\n'),
      M('post.js', 'la exposición no llega', '    u.uExposure.value = settings.exposure;\n', '\n'),
      M('post.js', 'la gradación no compila', "  '  c *= 1.0 - uVignette * smoothstep(0.3, 1.0, r);',", "  '  c *= 1.0 - uVignette * smoothstep(0.3, 1.0, r)',")
    ];
    const desde = Number(process.env.MUTANTE_DESDE || 0);
    for (const [nombre, fichero, muta] of mutantes.slice(desde)) {
      const fuentes = { ...ORIGINAL, [fichero]: muta(ORIGINAL[fichero]) };
      if (fuentes[fichero] === ORIGINAL[fichero]) { console.log(`autoprueba «${nombre}»: el mutante no cambia nada`); codigo = 1; continue; }
      if (nombre === 'la gradación no compila' && !HAY_VALIDADOR) { console.log(`autoprueba «${nombre}»: sin glslang, no se puede cazar (se salta)`); continue; }
      let f;
      try { f = await prueba(fuentes, { aborta: true }); } catch (e) { f = ['el mutante ni siquiera carga: ' + String(e && e.message || e).slice(0, 120)]; }
      console.log(`autoprueba «${nombre}»: ${f.length ? 'cazado (' + f[0].slice(0, 110) + ')' : 'NO CAZADO'}`);
      if (!f.length) codigo = 1;
    }
  }
} finally {
  const anterior = globalThis.window && globalThis.window.nebulaDustDemo;
  if (anterior && typeof anterior.stop === 'function') anterior.stop();
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.exit(codigo);
