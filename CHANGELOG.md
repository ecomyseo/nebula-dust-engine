# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
- Package entry `src/all.js` and subpath exports (`/core`, `/presets`, `/system`,
  `/examples`, `/gpu-profile`); `examples/basic.html`.
- Tests: `test/system.mjs`, `test/glsl-versions.mjs` (three r150, r160, r169, r180 chunks),
  `bench/escena.mjs` + `bench/capturas.py` render the
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
