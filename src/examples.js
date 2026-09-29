/**
 * Escenas de ejemplo, listas para `system.load(DUST_EXAMPLE_SCENES.collision)`.
 * Son specs parciales: lo que no se da sale del preset o de los valores de
 * fábrica, y la semilla fija hace que se vean siempre igual.
 */
const HALF_PI = Math.PI / 2;

export const DUST_EXAMPLE_SCENES = Object.freeze({
  // Una nebulosa de emisión y, delante, una lámina de polvo oscuro que la tapa.
  twinNebula: Object.freeze({
    format: 'nebula-dust-scene',
    version: 1,
    title: 'Emission nebula with a dark dust lane',
    view: { target: [0, 0, 0], azimuth: 0, elevation: 0.08, distance: 3.4 },
    groups: [
      {
        id: 'g1', name: 'Emission cloud', preset: 'orion', seed: 'twin-emission',
        radius: 1.12, position: [0, 0, 0], order: 1
      },
      {
        id: 'g2', name: 'Dark dust lane', preset: 'interstellarDust', seed: 'twin-dark-lane',
        palette: 'dark', tint: '#000000', blending: 'normal', volumeProfile: 'dense', opacity: 1, size: 3.2,
        radius: 1, position: [0.12, -0.05, 0.45], rotation: [0.2, 0.1, 0.55], scale: [1.35, 0.32, 0.55], order: 2
      }
    ]
  }),
  // Dos grumos que chocan y la nube de restos que sale del impacto.
  collision: Object.freeze({
    format: 'nebula-dust-scene',
    version: 1,
    title: 'Collision with debris',
    view: { target: [0, 0, 0], azimuth: 0.35, elevation: 0.25, distance: 3.6 },
    groups: [
      {
        id: 'g1', name: 'Impactor A', morphology: 'clumpyShell', palette: 'hotDust', seed: 'impactor-a',
        blending: 'additive', opacity: 0.3, size: 1.1, radius: 1, shape: { shellInner: 0, shellOuter: 1, plumeCount: 3 },
        position: [-0.62, 0.05, 0], scale: [0.42, 0.42, 0.42], motion: 0.05
      },
      {
        id: 'g2', name: 'Impactor B', morphology: 'clumpyShell', palette: 'ionized', seed: 'impactor-b',
        blending: 'additive', opacity: 0.3, size: 1.1, radius: 1, shape: { shellInner: 0, shellOuter: 1, plumeCount: 2 },
        position: [0.55, -0.04, 0.05], scale: [0.36, 0.36, 0.36], motion: 0.05
      },
      {
        id: 'g3', name: 'Debris', preset: 'supernovaExplosion', seed: 'collision-debris',
        evolution: 0.55, evolutionRate: 0, motion: 0.4, opacity: 0.22, radius: 1,
        position: [-0.02, 0, 0.02], scale: [0.95, 0.55, 0.7], rotation: [0, 0, 0.18], order: 2
      },
      {
        id: 'g4', name: 'Hot filaments', preset: 'crab', seed: 'collision-filaments',
        palette: 'supernova', blending: 'additive', opacity: 0.3, radius: 1,
        position: [0, 0, 0], scale: [0.5, 0.3, 0.4], order: 3
      }
    ]
  }),
  // Un disco de acreción con un anillo inclinado y un halo tenue alrededor.
  diskRingHalo: Object.freeze({
    format: 'nebula-dust-scene',
    version: 1,
    title: 'Disk with a ring and a halo',
    view: { target: [0, 0, 0], azimuth: 0.4, elevation: 0.42, distance: 3.8 },
    groups: [
      {
        id: 'g1', name: 'Accretion disk', preset: 'whiteDwarfAccretion', seed: 'disk',
        radius: 1, rotation: [-HALF_PI, 0, 0], scale: [0.62, 0.62, 0.62], order: 2
      },
      {
        id: 'g2', name: 'Ring', preset: 'ring', seed: 'ring', palette: 'ionized', blending: 'additive',
        opacity: 0.7, radius: 1, rotation: [-HALF_PI + 0.22, 0, 0], scale: [1.25, 1.25, 1.25], order: 3
      },
      {
        id: 'g3', name: 'Halo', preset: 'oortCloud', seed: 'halo', opacity: 0.45, volumeProfile: 'mist',
        radius: 1, scale: [1.7, 1.7, 1.7], order: 1
      }
    ]
  })
});

export function listDustExampleScenes() {
  return Object.keys(DUST_EXAMPLE_SCENES);
}
