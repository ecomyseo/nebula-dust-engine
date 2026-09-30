# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Rotating outflow** (`src/outflow.js`, subpath `nebula-dust-engine/outflow`):
  `createDustOutflow` for matter streaming out of a spinning compact source. Angular
  momentum conserved from co-rotation at launch, closed-form radial acceleration, a
  rotating sprinkler of streams that draws spiral arms, polar jets, a slower dust
  population, relativistic Doppler colour and D³ beaming with β capped below 1, an
  optional sink. Helpers `relativisticDoppler`, `kerrHorizonOmega`, `outflowRadial`.
- **Volumetric cloud** for the outflow (`cloud: {}`): an impostor sphere that integrates
  the 1/r² wind along each ray with six samples spaced uniformly in angle (exact for the
  radial part), with the same rotating arms, Doppler colour and an absorbing dust shell.
- **Samples without buffers**: the outflow has no per-sample attributes (0 bytes per
  sample, everything from a hash of `gl_VertexID`), up to 2²⁴ samples; its clock wraps
  every 1024 units without a jump.
- **`maximumSamples`** for the outflow: a ceiling for `sampleCount`; what is drawn is set
  by `maxVisibleSamples` and the frame-time LOD, always with the same total light.
- `test/outflow.mjs`: kinematics, Doppler, light kept by the LOD and by
  `maxVisibleSamples`, no per-sample buffers, clock wrap, and the three shaders through
  glslang. `bench/lienzo8.py` measures what an 8-bit canvas does to faint dust.
- README: rotating outflow, performance guide (measured point costs), avoiding walls
  in boxed volumes (round envelope), limitations.

### Changed
- **Editor demo rebuilt** with the panel of spite's Bumpy Metaballs 2026 (guspira, MIT,
  credited in the README, the page and `demo/panel.css`): foldable panel with the group
  name in its title, help, key table and credits on top, preset (‹ ›) and mode above four
  tabs (Scene, Group, Render, Stats) of folding sections; sliders with a typeable value,
  labels that randomize their control; pause, random, fullscreen and hide buttons; a
  bottom sheet on phones. All in English.
- **Keys**: ← → presets, R random look, Space pause (the engine clock stops), Tab hides
  the interface, F / double-click / double-tap fullscreen, 1–4 modes.
- **Readable URL hash** with the whole state (`#preset=orion&seed=3&samples=262144`,
  `#scene=collision&g3.turb=0.6&bloom=0.8`), written against the preset or example it
  started from; `#s=…`, `#orion`, `#m42`, `#collision` and `#choque` still open.
- **Post-processing** in the demo (`demo/post.js`): bloom (strength, radius, threshold),
  grain, vignette, ACES on/off and exposure in one grade pass after the HalfFloat target;
  quality and sample budget in the panel.

### Fixed
- The demo's camera saw only layer 0 until "Layers" was changed, although it read "All".

### Tests
- `test/demo-dom.mjs` rewritten on a small DOM with bubbling events, focus, fullscreen and
  clipboard: every panel control, the keys, the readable hash round trip and the old links,
  the post shaders through glslang; `npm run test:mutants` re-breaks 35 things across
  `main.js`, `panel.js`, `hash.js` and `post.js`. Listener exceptions are now collected
  from every demo the test mounts, not only the last one. `test/demo-static.mjs` checks the page,
  the credits and licence notices and the hash functions directly.

## [0.4.0] - 2026-09-29

### Added
- **Dust system with groups** (`createDustSystem`): several seeded dust groups in one
  scene, each one a single draw call. `addGroup`, `updateGroup` (hot, without
  regenerating whenever possible), `resetGroup`, `removeGroup`, `duplicateGroup`,
  `listGroups`, `getGroup`, `clear`, `sow(point, options)`.
- **Scene files**: `serialize()` / `load(json)` with an identical round trip, and
  `encodeDustScene` / `decodeDustScene` for short share links (deflate-raw + base64url).
- **Picking**: `pick(raycaster | ray)` and `pickScreen(x, y, camera)` against the
  bounding sphere, refined by the samples under the ray (a disk wins over the halo
  around it), with an optional layer filter.
- **Touch**: `touch(point, { radius, strength })` pushes the samples near a point in the
  vertex shader (four simultaneous touches per group, exponential decay, no buffer upload).
- **Engine**: `setPalette` (bit-identical to generating with that palette), `setTint`,
  `setBlending`, `setRenderOrder`, `touch`, `clearTouches`, `setTouchDecay`; `tint`
  and `touchDecay` options; `dustColorToHex`, `defaultDustPalette`,
  `defaultDustVolumeProfile`; `resolveNebulaDustPresetName` in the presets module.
- **Sample budget across groups**: the 4,000,000 sample cap is shared between groups
  with a proportional split (`maxTotalSamples`); one shared GPU timer for all groups.
- **Example scenes** (`DUST_EXAMPLE_SCENES`): `twinNebula`, `collision`, `diskRingHalo`.
- **Editor demo**: group list, per-group panel, click to sow, TransformControls gizmo,
  touch mode, JSON save/load, compressed share link in the URL hash, touch controls.
- Package entry `src/all.js` and subpath exports (`/core`, `/presets`, `/system`,
  `/examples`, `/gpu-profile`); `examples/basic.html`.
- Tests: `test/system.mjs`, `test/glsl-versions.mjs` (three r150, r160, r169, r180 chunks),
  a much larger `test/demo-dom.mjs`; `bench/escena.mjs` + `bench/capturas.py` render the
  example scenes offline with moderngl.

### Unchanged
- `createNebulaDustEngine`, `createNebulaDustPreset` and every preset produce exactly the
  same samples as 0.3.0 (checked attribute by attribute).

## [0.3.0] - 2026-09-28

- Presets for galaxy dust, Oort cloud, supernova ejecta, white-dwarf accretion,
  red-supergiant dust shell and colliding-wind pinwheel.
- Light conservation across LOD levels and sample counts (`lightReferenceSamples`),
  sub-pixel sample lottery (`minPointPx`), resolution scale, GPU timer queries and an
  adaptive LOD governor.
