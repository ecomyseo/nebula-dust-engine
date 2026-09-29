import { createNebulaDustEngine } from './index.js';

const PRESETS = {
  orion: {
    name: 'Orion dust',
    morphology: 'orion',
    palette: 'orion',
    radius: 1,
    opacity: 0.90,
    particleScale: 1.15,
    seed: 'm42-orion'
  },
  eaglePillars: {
    name: 'Eagle pillars dust',
    morphology: 'pillars',
    palette: 'webb',
    radius: 1,
    opacity: 0.92,
    particleScale: 1.05,
    seed: 'm16-eagle-pillars'
  },
  horsehead: {
    name: 'Horsehead dark dust',
    morphology: 'horsehead',
    palette: 'dark',
    radius: 1,
    opacity: 0.96,
    particleScale: 1.10,
    seed: 'barnard-33-horsehead'
  },
  crab: {
    name: 'Crab filament dust',
    morphology: 'crab',
    palette: 'crab',
    radius: 1,
    opacity: 0.82,
    particleScale: 0.95,
    seed: 'm1-crab'
  },
  ring: {
    name: 'Ring nebula dust',
    morphology: 'ring',
    palette: 'ionized',
    radius: 1,
    opacity: 0.78,
    particleScale: 0.88,
    seed: 'm57-ring'
  },
  helix: {
    name: 'Helix nebula dust',
    morphology: 'ring',
    palette: 'webb',
    radius: 1,
    opacity: 0.84,
    particleScale: 0.94,
    seed: 'ngc7293-helix'
  },
  lion: {
    name: 'Lion nebula dust',
    morphology: 'lion',
    palette: 'webb',
    radius: 1,
    opacity: 0.80,
    particleScale: 0.92,
    seed: 'ngc2392-lion'
  },
  interstellarDust: {
    name: 'Interstellar dust',
    morphology: 'diffuse',
    palette: 'webb',
    radius: 1,
    opacity: 0.74,
    particleScale: 0.88,
    motion: 0.12,
    seed: 'interstellar-dust'
  },
  galaxyDust: {
    name: 'Galaxy dust',
    morphology: 'galaxy',
    palette: 'galaxy',
    radius: 1,
    opacity: 0.68,
    particleScale: 0.78,
    motion: 0.12,
    flowSpeed: 0.55,
    seed: 'galaxy-dust'
  },
  oortCloud: {
    name: 'Oort cloud',
    morphology: 'oort',
    palette: 'oort',
    radius: 1,
    opacity: 0.62,
    particleScale: 0.72,
    motion: 0.08,
    flowSpeed: 0.24,
    seed: 'oort-cloud'
  },
  supernovaExplosion: {
    name: 'Supernova explosion',
    morphology: 'supernovaEjecta',
    palette: 'supernova',
    radius: 1,
    opacity: 0.96,
    particleScale: 1.18,
    motion: 0.92,
    flowSpeed: 0.65,
    evolution: 0,
    evolutionRate: 0.18,
    blending: 'additive',
    seed: 'supernova-explosion'
  },
  whiteDwarfAccretion: {
    name: 'White dwarf accretion',
    morphology: 'whiteDwarfAccretion',
    palette: 'accretion',
    radius: 1,
    opacity: 0.86,
    particleScale: 0.82,
    motion: 0.34,
    flowSpeed: 0.90,
    blending: 'additive',
    seed: 'white-dwarf-accretion'
  },
  // Envoltura de polvo de Betelgeuse (VLT/VISIR, Kervella 2011): nudos y penachos.
  redSupergiantShell: {
    name: 'Red supergiant dust shell',
    morphology: 'clumpyShell',
    palette: 'redSupergiant',
    radius: 1,
    opacity: 1,
    particleScale: 1.2,
    motion: 0.03,
    shellInner: 0.55,
    shellOuter: 1,
    clumpScale: 2.2,
    clumpContrast: 0.8,
    plumeCount: 5,
    plumeFraction: 0.08,
    blending: 'normal',
    seed: 'red-supergiant-shell'
  },
  // Molinillo de WR 104 (Keck, Tuthill 2008): paso = viento × periodo.
  collidingWindPinwheel: {
    name: 'Colliding-wind pinwheel',
    morphology: 'pinwheel',
    palette: 'hotDust',
    radius: 1,
    opacity: 1,
    particleScale: 1.2,
    motion: 0,
    spiralPitch: 0.4,
    armWidth: 0.075,
    coneOpening: 0.10,
    blending: 'additive',
    seed: 'colliding-wind-pinwheel'
  }
};

const ALIASES = Object.freeze({
  m42: 'orion',
  orion: 'orion',
  m16: 'eaglePillars',
  eagle: 'eaglePillars',
  aguila: 'eaglePillars',
  pilares: 'eaglePillars',
  creacion: 'eaglePillars',
  caballo: 'horsehead',
  horsehead: 'horsehead',
  m1: 'crab',
  cangrejo: 'crab',
  m57: 'ring',
  anillo: 'ring',
  helice: 'helix',
  helix: 'helix',
  leon: 'lion',
  lion: 'lion',
  dust: 'interstellarDust',
  polvo: 'interstellarDust',
  galaxy: 'galaxyDust',
  galaxia: 'galaxyDust',
  oort: 'oortCloud',
  nube_oort: 'oortCloud',
  supernova: 'supernovaExplosion',
  explosion: 'supernovaExplosion',
  accretion: 'whiteDwarfAccretion',
  white_dwarf: 'whiteDwarfAccretion',
  enana_blanca: 'whiteDwarfAccretion',
  betelgeuse: 'redSupergiantShell',
  supergigante_roja: 'redSupergiantShell',
  cascara_grumosa: 'redSupergiantShell',
  pinwheel: 'collidingWindPinwheel',
  molinillo: 'collidingWindPinwheel',
  wr104: 'collidingWindPinwheel'
});

export const NEBULA_DUST_PRESETS = Object.freeze(
  Object.fromEntries(Object.entries(PRESETS).map(([key, value]) => [key, Object.freeze(value)]))
);
export const ASTRO_DUST_PRESETS = NEBULA_DUST_PRESETS;

export function listNebulaDustPresets() {
  return Object.keys(NEBULA_DUST_PRESETS);
}

/** El nombre canónico de un preset (acepta alias como «m42» o «betelgeuse»), o null. */
export function resolveNebulaDustPresetName(name) {
  const requested = String(name || '').trim();
  if (NEBULA_DUST_PRESETS[requested]) return requested;
  return ALIASES[requested.toLowerCase()] || null;
}

export function nebulaDustOptions(name, overrides = {}) {
  const requested = String(name || '').trim();
  const key = NEBULA_DUST_PRESETS[requested] ? requested : ALIASES[requested.toLowerCase()];
  if (!key) throw new Error('Unknown nebula dust preset: ' + requested);
  return { ...NEBULA_DUST_PRESETS[key], ...overrides };
}

export function createNebulaDustPreset(name, overrides = {}) {
  return createNebulaDustEngine(nebulaDustOptions(name, overrides));
}

export const listAstroDustPresets = listNebulaDustPresets;
export const astroDustOptions = nebulaDustOptions;
export const createAstroDustPreset = createNebulaDustPreset;
