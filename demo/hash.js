/**
 * The demo's whole state in the URL hash, as readable parameters, in the
 * manner of spite's bumpy-metaballs-2026 (#mat=…&res=…):
 *
 *   #preset=orion&seed=3&samples=262144&opacity=0.7
 *   #scene=collision&g3.turb=0.6&exposure=10&bloom=0.8
 *
 * - `scene=<example>` starts from one of the example scenes and each group then
 *   lists only what differs from that example's group. Without `scene`, each
 *   group is written against a fresh group of its preset (or of no preset).
 * - The first group's parameters have no prefix; the second one's start with
 *   `g2.`, the third one's with `g3.`, and so on. A group with nothing to say
 *   still says `preset=none`, so that it exists.
 * - Render settings, the view and the selected group are written only when
 *   they differ from their defaults.
 *
 * Old links keep working: `#s=…` (the compressed scene of v0.4.0) and plain
 * names such as `#orion`, `#m42`, `#collision` or `#choque`.
 *
 * Pure functions, no DOM: test/demo-static.mjs checks them directly in Node.
 */
import { normalizeDustGroupSpec, MAX_DUST_GROUPS } from '../src/system.js';
import { resolveNebulaDustPresetName } from '../src/presets.js';
import { DUST_EXAMPLE_SCENES } from '../src/examples.js';

/** Radius of the groups the demo creates (one preset, Add, the arrow keys). */
export const DEMO_RADIUS = 1.12;
export const DEFAULT_VIEW = Object.freeze({ target: Object.freeze([0, 0, 0]), azimuth: 0, elevation: 0, distance: 3.2 });
export const DEFAULT_SCENE = 'twinNebula';
/** Old Spanish names of the example scenes, kept for the links already out there. */
export const SCENE_ALIASES = Object.freeze({ nebulosa: 'twinNebula', choque: 'collision', disco: 'diskRingHalo' });

export const GRAIN_OPTIONS = Object.freeze(['1e6', '1e9', '1e12', '1e15', '1e18', '1e21', '1e24', '1e30', '1e36', 'mass']);
export const QUALITY_OPTIONS = Object.freeze(['auto', 'minimal', 'balanced', 'detailed', 'high', 'ultra']);
export const BUDGET_OPTIONS = Object.freeze(['4000000', '2000000', '1000000', '500000', '250000', '100000']);
export const FPS_OPTIONS = Object.freeze(['30', '60', '120', '0']);
export const LAYER_OPTIONS = Object.freeze(['all', '0', '1', '2', '3']);

/**
 * Render settings: the name in the hash is the key. `num` ones carry the range
 * and step the panel's slider uses too, so the two can never disagree.
 */
export const RENDER_SPEC = Object.freeze({
  exposure: Object.freeze({ kind: 'num', min: 0.5, max: 24, step: 0.05, def: 8 }),
  aces: Object.freeze({ kind: 'bool', def: true }),
  bloom: Object.freeze({ kind: 'num', min: 0, max: 3, step: 0.01, def: 0.35 }),
  bloomradius: Object.freeze({ kind: 'num', min: 0, max: 1, step: 0.01, def: 0.5 }),
  bloomthreshold: Object.freeze({ kind: 'num', min: 0, max: 4, step: 0.01, def: 1 }),
  grain: Object.freeze({ kind: 'num', min: 0, max: 0.3, step: 0.001, def: 0.012 }),
  vignette: Object.freeze({ kind: 'num', min: 0, max: 1, step: 0.01, def: 0.2 }),
  quality: Object.freeze({ kind: 'enum', values: QUALITY_OPTIONS, def: 'auto' }),
  budget: Object.freeze({ kind: 'enum', values: BUDGET_OPTIONS, def: 4000000, number: true }),
  fps: Object.freeze({ kind: 'enum', values: FPS_OPTIONS, def: 60, number: true }),
  halfres: Object.freeze({ kind: 'bool', def: false }),
  adaptive: Object.freeze({ kind: 'bool', def: true }),
  cull: Object.freeze({ kind: 'bool', def: false }),
  dustgrains: Object.freeze({ kind: 'enum', values: GRAIN_OPTIONS, def: '1e18' }),
  spin: Object.freeze({ kind: 'bool', def: true }),
  layers: Object.freeze({ kind: 'enum', values: LAYER_OPTIONS, def: 'all' })
});
export const RENDER_DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(RENDER_SPEC).map(([k, v]) => [k, v.def])));
export const RENDER_PARAMS = Object.freeze(Object.keys(RENDER_SPEC));

/** Shape parameters: engine key → name in the hash. */
export const SHAPE_PARAMS = Object.freeze({
  shellInner: 'shellin', shellOuter: 'shellout', clumpScale: 'clump', clumpContrast: 'contrast',
  plumeCount: 'plumes', plumeFraction: 'plumefrac', spiralPitch: 'pitch', spiralSense: 'sense',
  spiralPhase: 'phase', spiralInner: 'spiralin', armWidth: 'arm', coneOpening: 'cone', radialFade: 'fade'
});
const SHAPE_BY_PARAM = Object.fromEntries(Object.entries(SHAPE_PARAMS).map(([k, v]) => [v, k]));

const DEG = 180 / Math.PI;
const fmt = (n, dp = 4) => {
  const f = 10 ** dp;
  const r = Math.round(n * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
};
const hex = (c) => String(c || '').replace(/^#/, '').toLowerCase();
const toHex = (s) => (/^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null);
const toNum = (s) => (String(s).trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
const vec = (s) => {
  const v = String(s).split(',').map(toNum);
  return v.length === 3 && v.every((x) => x !== null) ? v : null;
};

/**
 * Seeds keep their type: the engine hashes the text "3" and uses the number 3
 * as it is, so they give different clouds. Numbers go as digits; text that
 * would read as a number goes in quotes.
 */
const CANONICAL_INT = /^(0|[1-9]\d{0,9})$/;
export function printSeed(seed) {
  if (typeof seed === 'number') return String(seed);
  const s = String(seed ?? '');
  return CANONICAL_INT.test(s) ? '"' + s + '"' : s;
}
export function parseSeed(text) {
  const s = String(text ?? '').trim();
  if (!s) return undefined;
  const quoted = s.match(/^"(.*)"$/);
  if (quoted) return quoted[1] ? quoted[1].slice(0, 200) : undefined;
  if (CANONICAL_INT.test(s) && Number(s) <= 4294967295) return Number(s);
  return s.slice(0, 200);
}

/** Group fields: name in the hash, spec key, print (value → text) and parse (text → value or undefined). */
const GROUP_FIELDS = [
  ['name', 'name', (v) => String(v ?? ''), (s) => s.slice(0, 120) || null],
  ['seed', 'seed', printSeed, parseSeed],
  ['samples', 'count', (v) => (v ? String(v) : 'auto'), (s) => (s === 'auto' ? null : (toNum(s) ?? undefined))],
  ['shape', 'morphology', String, (s) => s || undefined],
  ['palette', 'palette', String, (s) => (s && s !== 'custom' ? s : undefined)],
  ['colors', 'colors', (v) => (Array.isArray(v) ? v.map(hex).join(',') : ''), (s) => {
    const list = s.split(',').map(toHex);
    return list.length >= 2 && list.every(Boolean) ? list : undefined;
  }],
  ['tint', 'tint', hex, (s) => toHex(s) ?? undefined],
  ['volume', 'volumeProfile', String, (s) => s || undefined],
  ['blend', 'blending', String, (s) => (s === 'additive' || s === 'normal' ? s : undefined)],
  ['opacity', 'opacity', fmt, (s) => toNum(s) ?? undefined],
  ['size', 'size', fmt, (s) => toNum(s) ?? undefined],
  ['maxpx', 'maxPointSize', fmt, (s) => toNum(s) ?? undefined],
  ['radius', 'radius', fmt, (s) => toNum(s) ?? undefined],
  ['pos', 'position', (v) => v.map((x) => fmt(x)).join(','), (s) => vec(s) ?? undefined],
  ['rot', 'rotation', (v) => v.map((x) => fmt(x * DEG, 3)).join(','), (s) => {
    const v = vec(s);
    return v ? v.map((x) => x / DEG) : undefined;
  }],
  ['scale', 'scale', (v) => v.map((x) => fmt(x)).join(','), (s) => vec(s) ?? undefined],
  ['order', 'order', fmt, (s) => toNum(s) ?? undefined],
  ['layer', 'layer', String, (s) => toNum(s) ?? undefined],
  ['hidden', 'visible', (v) => (v ? '0' : '1'), (s) => (s === '1' || s === 'true' ? false : (s === '0' || s === 'false' ? true : undefined))],
  ['flow', 'flowSpeed', fmt, (s) => toNum(s) ?? undefined],
  ['turb', 'motion', fmt, (s) => toNum(s) ?? undefined],
  ['evo', 'evolution', fmt, (s) => toNum(s) ?? undefined],
  ['evorate', 'evolutionRate', fmt, (s) => toNum(s) ?? undefined],
  ['pgrains', 'physicalGrainCount', (v) => (v ? String(v) : 'auto'), (s) => (s === 'auto' ? null : (toNum(s) ?? undefined))]
];
const FIELD_BY_PARAM = new Map(GROUP_FIELDS.map((f) => [f[0], f]));

/** Every parameter name the hash can carry for a group (without the gN. prefix). */
export const GROUP_PARAMS = Object.freeze(['preset', ...GROUP_FIELDS.map((f) => f[0]), ...Object.values(SHAPE_PARAMS)]);

/* ------------------------------------------------------------------ bases */
const EXAMPLE_SPECS = new Map();
/** The normalised groups of an example scene (cached). */
function exampleSpecs(name) {
  if (!EXAMPLE_SPECS.has(name)) {
    const scene = DUST_EXAMPLE_SCENES[name];
    EXAMPLE_SPECS.set(name, scene.groups.map((g, i) => normalizeDustGroupSpec({ ...g, id: g.id || 'g' + (i + 1) }, null, 'dust-' + (g.id || 'g' + (i + 1)))));
  }
  return EXAMPLE_SPECS.get(name).map((s) => JSON.parse(JSON.stringify(s)));
}
/** A fresh group of the demo (no preset, diffuse, the demo's radius). */
function blankSpec(index) {
  return normalizeDustGroupSpec({ id: 'g' + (index + 1), radius: DEMO_RADIUS }, null, 'dust-g' + (index + 1));
}
/** The scene a hash of one preset stands for (#orion, #preset=orion). */
export function presetScene(key) {
  return { groups: [{ id: 'g1', preset: key, radius: DEMO_RADIUS }] };
}
/** Canonical example name for a text (name or old alias), or null. */
export function resolveSceneName(text) {
  const t = String(text || '').trim();
  if (DUST_EXAMPLE_SCENES[t]) return t;
  return SCENE_ALIASES[t.toLowerCase()] || null;
}
/** The view an example opens with (or the default one). */
export function exampleView(name) {
  const v = name && DUST_EXAMPLE_SCENES[name] ? DUST_EXAMPLE_SCENES[name].view : null;
  return JSON.parse(JSON.stringify(v || DEFAULT_VIEW));
}

/** Whether a list of specs starts with an example scene's groups (ids included): groups added after them are fine. */
function startsWithExample(specs, name) {
  const base = DUST_EXAMPLE_SCENES[name].groups;
  return specs.length >= base.length && base.every((b, i) => specs[i].id === (b.id || 'g' + (i + 1)));
}

/** Applies a preset change the way the system does (fresh preset values over the base). */
function withPreset(base, preset) {
  if (preset === (base.preset || null)) return base;
  return normalizeDustGroupSpec({ preset: preset || null }, base, base.seed);
}

/* ------------------------------------------------------------------ writing */
const ENC = (s) => encodeURIComponent(s).replace(/%2C/gi, ',').replace(/%20/g, '+').replace(/%3A/gi, ':');

/** The parameters of one group against its base, in a fixed order. */
function groupParams(spec, base) {
  const out = [];
  const cur = spec.preset || null;
  let b = base;
  if (cur !== (base.preset || null)) {
    out.push(['preset', cur || 'none']);
    b = withPreset(base, cur);
  }
  for (const [param, key, print] of GROUP_FIELDS) {
    if (key === 'palette' && spec.palette === 'custom') continue;
    if (key === 'colors' && spec.palette !== 'custom') continue;
    const a = print(spec[key]);
    if (a !== print(b[key])) out.push([param, a]);
  }
  for (const [key, param] of Object.entries(SHAPE_PARAMS)) {
    const has = spec.shape && key in spec.shape;
    const had = b.shape && key in b.shape;
    if (has && (!had || fmt(spec.shape[key]) !== fmt(b.shape[key]))) out.push([param, fmt(spec.shape[key])]);
    else if (!has && had) out.push([param, '']);
  }
  return out;
}

function viewText(v) {
  const t = Array.isArray(v.target) ? v.target : [0, 0, 0];
  return [fmt((v.azimuth || 0) * DEG, 3), fmt((v.elevation || 0) * DEG, 3), fmt(v.distance ?? 3.2), ...t.map((x) => fmt(x))].join(',');
}
function renderText(k, v) {
  const d = RENDER_SPEC[k];
  if (d.kind === 'bool') return v ? '1' : '0';
  if (d.kind === 'num') return fmt(Number(v));
  return String(v);
}

/**
 * The hash for a state: { groups: specs, view, render, selected (index), scene (the example
 * the scene started from, or null) }. Returns the text after '#'.
 */
export function encodeHash(state) {
  const groups = state.groups || [];
  const pairs = [];
  const scene = state.scene && DUST_EXAMPLE_SCENES[state.scene] && startsWithExample(groups, state.scene) ? state.scene : null;
  const example = scene ? exampleSpecs(scene) : [];
  if (scene) pairs.push(['scene', scene]);
  else if (!groups.length) pairs.push(['scene', 'empty']);
  groups.forEach((spec, i) => {
    const prefix = i === 0 ? '' : 'g' + (i + 1) + '.';
    const params = groupParams(spec, example[i] || blankSpec(i));
    /* a group identical to a fresh one still has to exist */
    if (!params.length && !example[i]) params.push(['preset', 'none']);
    for (const [k, v] of params) pairs.push([prefix + k, v]);
  });
  if (state.view) {
    const v = viewText(state.view);
    if (v !== viewText(exampleView(scene))) pairs.push(['view', v]);
  }
  if (state.selected > 0 && state.selected < groups.length) pairs.push(['sel', String(state.selected + 1)]);
  const render = state.render || {};
  for (const [k, d] of Object.entries(RENDER_SPEC)) {
    if (!(k in render)) continue;
    const t = renderText(k, render[k]);
    if (t !== renderText(k, d.def)) pairs.push([k, t]);
  }
  return pairs.map(([k, v]) => k + '=' + ENC(v)).join('&');
}

/* ------------------------------------------------------------------ reading */
/**
 * Reads a hash (with or without '#'). Returns one of:
 *   { kind: 'empty' }
 *   { kind: 'compressed', text }                   the old #s=… link
 *   { kind: 'name', scene | preset | unknown }     #collision, #m42…
 *   { kind: 'params', scene: { groups, view }, example, render, selected, warnings, onlyRender }
 */
export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return { kind: 'empty' };
  if (h.startsWith('s=')) return { kind: 'compressed', text: h.slice(2) };
  if (!h.includes('=')) {
    let name = h;
    try { name = decodeURIComponent(h); } catch { /* as is */ }
    const scene = resolveSceneName(name);
    if (scene) return { kind: 'name', scene };
    const preset = resolveNebulaDustPresetName(name);
    if (preset) return { kind: 'name', preset };
    return { kind: 'name', unknown: name };
  }
  const params = new Map();
  for (const part of h.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    let v = i < 0 ? '' : part.slice(i + 1);
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { /* as is */ }
    if (!params.has(k)) params.set(k, v);
  }
  return readParams(params);
}

/** A render value from its text, or undefined if it is not one. */
export function parseRenderValue(k, s) {
  const d = RENDER_SPEC[k];
  if (!d) return undefined;
  if (d.kind === 'bool') {
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false') return false;
    return undefined;
  }
  if (d.kind === 'num') {
    const n = toNum(s);
    return n === null ? undefined : Math.min(d.max, Math.max(d.min, n));
  }
  if (d.values.includes(String(s))) return d.number ? Number(s) : String(s);
  return undefined;
}

function readParams(params) {
  const warnings = [];
  const render = {};
  for (const k of RENDER_PARAMS) {
    if (!params.has(k)) continue;
    const v = parseRenderValue(k, params.get(k));
    if (v === undefined) warnings.push(k);
    else render[k] = v;
  }

  /* group index → its parameters */
  const perGroup = new Map();
  let top = 0;
  for (const [k, v] of params) {
    const m = k.match(/^g(\d{1,2})\.(\w+)$/);
    const idx = m ? Number(m[1]) - 1 : 0;
    const name = m ? m[2] : k;
    if (!m && (RENDER_SPEC[k] || k === 'scene' || k === 'view' || k === 'sel')) continue;
    if (!GROUP_PARAMS.includes(name)) { warnings.push(k); continue; }
    if (idx < 0 || idx >= MAX_DUST_GROUPS) { warnings.push(k); continue; }
    if (!perGroup.has(idx)) perGroup.set(idx, new Map());
    perGroup.get(idx).set(name, v);
    top = Math.max(top, idx + 1);
  }

  let example = null;
  let bases = [];
  if (params.has('scene')) {
    const s = params.get('scene');
    example = resolveSceneName(s);
    if (example) bases = exampleSpecs(example);
    else if (s !== 'empty') warnings.push('scene');
  }
  const count = Math.max(bases.length, top);
  const groups = [];
  for (let i = 0; i < count; i++) {
    const p = perGroup.get(i) || new Map();
    let spec = bases[i] || blankSpec(i);
    const tag = (i ? 'g' + (i + 1) + '.' : '');
    if (p.has('preset')) {
      const raw = p.get('preset');
      const key = raw === 'none' || raw === '' ? null : resolveNebulaDustPresetName(raw);
      if (key === null && raw !== 'none' && raw !== '') warnings.push(tag + 'preset');
      else spec = withPreset(spec, key);
    }
    const patch = {};
    for (const [name, v] of p) {
      if (name === 'preset') continue;
      const f = FIELD_BY_PARAM.get(name);
      if (f) {
        const val = f[3](v);
        if (val === undefined) warnings.push(tag + name);
        else patch[f[1]] = val;
        continue;
      }
      const key = SHAPE_BY_PARAM[name];
      if (key) {
        const n = v === '' ? null : toNum(v);
        if (n === undefined || (n === null && v !== '')) warnings.push(tag + name);
        else (patch.shape ||= {})[key] = n;
      }
    }
    try {
      spec = normalizeDustGroupSpec(patch, spec, spec.seed);
    } catch {
      warnings.push('g' + (i + 1));
    }
    spec.id = bases[i] ? bases[i].id : 'g' + (i + 1);
    groups.push(spec);
  }

  let view = exampleView(example);
  if (params.has('view')) {
    const v = params.get('view').split(',').map(toNum);
    if (v.length === 6 && v.every((x) => x !== null)) {
      view = { target: [v[3], v[4], v[5]], azimuth: v[0] / DEG, elevation: v[1] / DEG, distance: v[2] };
    } else warnings.push('view');
  }
  let selected = 0;
  if (params.has('sel')) {
    const n = toNum(params.get('sel'));
    if (n !== null && n >= 1 && n <= groups.length) selected = Math.floor(n) - 1;
    else warnings.push('sel');
  }
  /* a hash of only render settings keeps the scene that is up */
  const onlyRender = !params.has('scene') && !perGroup.size && !params.has('view') && !params.has('sel');
  return { kind: 'params', scene: { groups, view }, example, render, selected, warnings, onlyRender };
}
