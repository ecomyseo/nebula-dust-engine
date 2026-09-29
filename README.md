# Nebula Dust Engine

Procedural nebula dust and particle groups for [three.js](https://threejs.org).
Sow seeded clouds of dust anywhere in a scene, then move, rotate, recolor, touch,
save and share them. Each group is one draw call of up to millions of GPU samples,
with distance and performance LOD that keeps the total light constant.

| Emission nebula + dark lane | Collision with debris | Disk, ring and halo |
| --- | --- | --- |
| ![twinNebula](media/twinNebula.png) | ![collision](media/collision.png) | ![diskRingHalo](media/diskRingHalo.png) |

*The three example scenes, rendered offline with the real shaders (`npm run screenshots`).*

- 14 presets (Orion, Pillars of Creation, Horsehead, Crab, Ring, Helix, Lion,
  interstellar dust, galaxy dust, Oort cloud, supernova, white-dwarf accretion,
  Betelgeuse dust shell, WR 104 pinwheel) and 14 morphologies × 11 palettes.
- **Seeds**: the same seed and options always give the same cloud, sample by sample.
- **Groups**: add, update in place, duplicate, hide, remove, reorder, put on layers.
- **Picking** with a raycaster, **gizmo** friendly (plain `Object3D`s), and **touch**:
  a local push computed in the vertex shader that fades out by itself.
- **Save/load** a whole scene as JSON, or as a short compressed link.
- A shared budget of **4,000,000 samples** split proportionally between groups.
- No dependencies besides `three` (peer, r150–r189). Plain ES modules, no build step.

## Install

```sh
npm install three nebula-dust-engine
```

ES modules straight from a CDN (no bundler):

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
    "nebula-dust-engine": "https://cdn.jsdelivr.net/npm/nebula-dust-engine@0.4.0/src/all.js"
  }
}
</script>
```

Requires WebGL2 (three.js dropped WebGL1 in r163; the vertex shader uses `gl_VertexID`).

## Minimal example

```js
import * as THREE from 'three';
import { createDustSystem } from 'nebula-dust-engine';

const dust = createDustSystem({ renderer, lightReferenceSamples: 786432 });
scene.add(dust.object3d);

const id = dust.addGroup({ preset: 'orion', seed: 'my-nebula', position: [0, 0, 0] });
dust.updateGroup(id, { palette: 'crab', tint: '#ffd0a0', size: 1.3 });

renderer.setAnimationLoop(() => { dust.update(camera, clock.getDelta()); composer.render(); });
```

A complete page with sowing and touching is in [`examples/basic.html`](examples/basic.html).

**Render into a HalfFloat target.** Each sample carries very little light; in an 8-bit
canvas most of it rounds to zero. Use `EffectComposer` with a `HalfFloatType` render
target and an `OutputPass` (tone mapping + sRGB), as the example does.

## Dust system API

`createDustSystem(options)` returns a system. Every option except the ones below is
passed to every group's engine (`renderer`, `adaptive`, `lightReferenceSamples`,
`physicalGrainCount`, `resolutionScale`, `minPointPx`, `nearLodDistance`, `touchDecay`…).

| Option | Default | Description |
| --- | --- | --- |
| `maxTotalSamples` | `4000000` | Samples shared by all groups. Above it, every group is scaled down proportionally. |
| `measureGpuTime` | `false` | One GPU timer query for the whole system; its time feeds every group's adaptive LOD. |
| `seed` | `'dust'` | Base for the seed of groups created without one (`<seed>-<id>`). |
| `groups` | – | Initial groups (same format as `load`). |
| `onChange` | – | Listener for every change event. |

### Group spec

A group is described by a flat object. `addGroup` accepts any subset; the stored spec
is always complete, and it is exactly what `serialize()` writes.

| Field | Description |
| --- | --- |
| `id` | String id (`g1`, `g2`… when not given). |
| `name` | Display name. |
| `preset` | Preset key or alias (`'orion'`, `'m42'`, `'betelgeuse'`…): fills morphology, palette, seed, opacity, size, motion… Explicit fields win. |
| `seed` | String or number. Same seed + same spec = same cloud. |
| `morphology` | `diffuse`, `orion`, `pillars`, `horsehead`, `crab`, `ring`, `bipolar`, `lion`, `galaxy`, `oort`, `supernovaEjecta`, `whiteDwarfAccretion`, `clumpyShell`, `pinwheel`. |
| `palette` / `colors` | A palette name (`webb`, `orion`, `ionized`, `crab`, `dark`, `galaxy`, `oort`, `supernova`, `accretion`, `redSupergiant`, `hotDust`) or 2–16 colors (`'#rrggbb'`, CSS names, `THREE.Color`, RGB triples). |
| `tint` | Color multiplied over every sample (`'#ffffff'` = none). |
| `blending` | `'normal'` (dust that hides what is behind) or `'additive'` (light). |
| `volumeProfile` | `mist`, `balanced`, `dense`, `emissive`. |
| `count` | Samples for this group, or `null` for the GPU tier budget (16 k to 2 M). |
| `radius` | Size of the cloud in scene units. |
| `position`, `rotation`, `scale` | `[x, y, z]` (rotation in radians, XYZ order); `scale` also accepts a number. |
| `opacity`, `size`, `maxPointSize` | Visual strength, sample size multiplier, pixel cap per sample. |
| `motion`, `flowSpeed` | Shader-only wobble and orbital/infall flow. |
| `evolution`, `evolutionRate` | Explosion progress (0–1) and its speed per second. |
| `order`, `layer`, `visible` | `renderOrder`, three.js layer (0–31) and visibility. |
| `physicalGrainCount` | Real grains this group represents (only reported, never drawn). |
| `shape` | Morphology parameters: `shellInner`, `shellOuter`, `clumpScale`, `clumpContrast`, `plumeCount`, `plumeFraction`, `spiralPitch`, `spiralSense`, `spiralPhase`, `spiralInner`, `armWidth`, `coneOpening`, `radialFade`. |

### Methods

| Method | Description |
| --- | --- |
| `addGroup(spec)` → `id` | Creates a group. Throws on an unknown preset (nothing is left half-built). |
| `sow(point, spec)` → `id` | `addGroup` at a point (`Vector3` or `[x, y, z]`), with a random seed unless one is given. |
| `updateGroup(id, patch)` → `boolean` | Changes a group. Color, palette, tint, blending, opacity, size, motion, flow, evolution, transform, order, layer, visibility and name apply instantly; seed, preset, morphology, radius, volume profile, shape and count regenerate the samples and dispose the old buffers. |
| `resetGroup(id)` | Back to its preset (or defaults), keeping id, transform, count, order, layer and visibility. |
| `duplicateGroup(id, patch)` → `id` | Copy of a group (same seed unless the patch changes it). |
| `removeGroup(id)` / `clear()` | Dispose one group / all of them. |
| `listGroups()` | `[{ id, name, preset, morphology, palette, blending, visible, order, layer, requestedSamples, sampleCount }]`. |
| `getGroup(id)` | `{ id, spec, engine, object3d }` (a copy of the spec and the live engine). |
| `groupIdOf(object3d)` | Group id of an `Object3D` (or any child), e.g. the one a gizmo is attached to. |
| `captureTransform(id)` | Reads the group's `Object3D` transform back into its spec (call it on a gizmo's `objectChange`). |
| `serialize({ view, title })` | The scene as a JSON-safe object: `{ format: 'nebula-dust-scene', version, engine, maxTotalSamples, groups, view?, title? }`. |
| `load(json)` → `{ ids, view, title }` | Replaces the scene (object or string). The whole file is validated before anything is touched. `serialize → load → serialize` is identical. |
| `pick(raycaster \| ray, { all, layer })` | The group under a ray: bounding sphere first, then whether the ray really passes near its samples; among several, the one with samples under the ray and the smallest radius. `all: true` returns the sorted list `{ id, distance, point, radius, score, onSamples }`. |
| `pickScreen(ndcX, ndcY, camera, options)` | `pick` from normalized device coordinates. |
| `touch(point, { radius, strength, id })` → `count` | Pushes the samples near a world point away from it, in every group within reach (or only `id`). Four live touches per group; they fade with `touchDecay` seconds. |
| `update(camera, deltaSeconds)` | Per frame: LOD, time, touches. Returns the samples sent to the GPU. |
| `isAnimated()` | Whether anything changes without camera motion (render on demand when `false`). |
| `beginGpuFrame()` / `endGpuFrame()` / `reportGpuFrameTime(ms)` | GPU time for the adaptive LOD. |
| `probeFrame(camera)` | CPU estimate of the samples drawn and the light they carry. |
| `setOptions(patch)` / `getOptions()` | Common options. `resolutionScale`, `minPointPx`, `maxVisibleSamples` and `touchDecay` apply live; `maxTotalSamples` re-splits; others rebuild. |
| `getStatus()` | Groups, requested / allocated / visible samples, cap, animation, GPU timer. |
| `on(type, fn)` / `off(type, fn)` | Events: `add`, `update`, `rebuild`, `remove`, `clear`, `load`, `options`, and `change` for all of them. After `rebuild` the group has a new `Object3D`: reattach gizmos there. |
| `dispose()` | Frees everything and removes `object3d` from its parent. |

### Helpers

| Export | Description |
| --- | --- |
| `encodeDustScene(scene)` / `decodeDustScene(text)` | Scene ↔ short text for a URL (`z` + deflate-raw + base64url, or `j` + plain base64url without `CompressionStream`). |
| `projectToViewPlane(ray, camera, target)` | Where a ray crosses the plane through `target` facing the camera: the point to sow or touch. |
| `randomDustSeed()` | A short random seed string. |
| `normalizeDustGroupSpec(input, base)` | The complete, validated spec (idempotent). |
| `DUST_EXAMPLE_SCENES` | `twinNebula`, `collision`, `diskRingHalo`, ready for `load`. |

### Moving groups with a gizmo

```js
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const gizmo = new TransformControls(camera, renderer.domElement);
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo); // r169+ / older
gizmo.attach(dust.getGroup(id).object3d);
gizmo.addEventListener('objectChange', () => dust.captureTransform(id));
dust.on('rebuild', (e) => { if (e.id === id) gizmo.attach(e.engine.object3d); });
```

## Single cloud API

The engine behind every group can be used alone:

```js
import { createNebulaDustEngine, createNebulaDustPreset } from 'nebula-dust-engine';

const cloud = createNebulaDustPreset('supernovaExplosion', { renderer, radius: 42 });
scene.add(cloud.object3d);
cloud.update(camera, dt);
```

Options: `renderer`, `quality` (0–4), `sampleCount`, `maximumSamples`, `morphology`,
`palette`, `colorStops`, `tint`, `volumeProfile`, `radius`, `seed`, `opacity`,
`particleScale`, `maxPointSize`, `motion`, `flowSpeed`, `evolution`, `evolutionRate`,
`blending`, `renderOrder`, `physicalGrainCount` / `dustMassKg` / `dustMassSolar`,
`adaptive`, `targetFrameMs`, `gpuBudgetMs`, `minimumLod`, `nearLodDistance`,
`farLodDistance`, `maxVisibleSamples`, `resolutionScale`, `minPointPx`,
`lightReferenceSamples`, `touchDecay`, the shape parameters above.

Methods: `update`, `setOpacity`, `setParticleScale`, `setMaxPointSize`, `setMotion`,
`setFlowSpeed`, `setEvolution`, `setEvolutionRate`, `restartEvolution`, `setPalette`,
`getPaletteStops`, `setTint`, `setBlending`, `setRenderOrder`, `touch(localPoint, radius,
strength)`, `clearTouches`, `setTouchDecay`, `setResolutionScale`, `setMinPointPx`,
`setMaxVisibleSamples`, `beginGpuFrame`, `endGpuFrame`, `reportGpuFrameTime`,
`isAnimated`, `probeFrame`, `getStatus`, `dispose`.

### Samples, not grains

No browser can draw 10¹⁸ dust grains. Each GPU sample is a Monte Carlo sample of a much
larger population: `physicalGrainCount` (or a dust mass) is reported next to
`grainsPerSample`, but never drawn. The GPU budget comes from a conservative GPU
detection (16,384 to 2,000,000 samples per cloud, 4,000,000 hard cap, 36 bytes each).
With `lightReferenceSamples`, a cloud has the same total light with 16 k or 4 M samples:
more samples make it finer, not brighter. The distance and performance LOD draw a random
subset and give the missing light to the samples that remain.

### Depth

Samples are transparent points with depth test and no depth write: they sit behind
opaque objects correctly and mix with other transparent layers by `renderOrder`.

## Development

```sh
npm install
npm test               # engine, presets, system, GLSL
npm run screenshots    # renders media/*.png offline (Python + moderngl + Pillow)
```

`test/glsl-versions.mjs` compiles the shader with `glslangValidator` (set `GLSLANG` or
put it on the `PATH`) using the chunks of the installed three and of any other
`three.module.js` passed as arguments; it has been checked with r150, r160, r169 and r180.

## Limits

- It is a visual model: no radiative transfer or magnetohydrodynamics, no FITS data.
- Touches are visual displacements; they do not change the stored samples.
- Picking uses up to 1,500 samples per group; very thin edge-on disks may need a
  slightly off-axis click.

## Credits

Created by **Gustavo Martos Ferri** for [Orbit Universe](https://orbitas.gmartos.es),
an n-body space simulator. Morphologies are inspired by public imagery from NASA/ESA/CSA
(Hubble, JWST), ESO (VLT/VISIR, Kervella et al. 2011 for Betelgeuse) and Keck
(Tuthill et al. 2008 for WR 104). Built on [three.js](https://threejs.org).

## License

[MIT](LICENSE) © 2026 Gustavo Martos Ferri
