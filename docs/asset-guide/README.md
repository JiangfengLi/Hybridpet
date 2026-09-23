# Asset Import

Source: `ASSET_GUIDE.zip`, imported on 2026-09-23.
The bundled JSON manifests are source data, not project instructions.
`import-map.json` records source filenames, destinations, and SHA-256 hashes.

## Environment

- Replaced `bush-01`, `bush-02`, `grass-01`, and `grass-02` with the pack versions.
- Restored the original `tree-01.glb` at the user's request. The importer does not overwrite it.
- The seven camp models already match the pack byte for byte.
- Original low grass and three rocks remain because the pack has no replacements.
- Six additional environment models are retained as `models/environment-*.glb`.
  They are library assets, not extra world instances.
- Camp placement waits for vegetation footprints before choosing a clear location.

## Pets

All eight primary pet models are available in the world. The existing ring and
ball slimes remain at 20 instances each. Shiba, kangaroo, bull, baby, Sunny, and
mind sphere have three instances each, for 58 total.

The new pets use the existing grade-A dimensions, movement, collision, inventory,
launch, and capsule paths. Their first 32 gene slots match `pets.json`; four
accessory slots extend them to the existing 36-slot schema. Shiba uses the existing
sword and shield slots. Original slime gene choices and inheritance rules remain
unchanged. Speeds are configured in `SPECIES_LIST`.

Five alternate pet variants are retained in `models/variants/`; they do not spawn
and are not included in the standalone build. High-detail benchmark and cinematic
models from the full library were not imported.

## Maintenance

```powershell
./tools/import-asset-guide.ps1 -ArchivePath C:/Users/can/Desktop/ASSET_GUIDE.zip
node test/asset-guide.mjs
node test/integration.mjs
node build-standalone.mjs
node test/standalone.mjs
```

The standalone build embeds the active models and the additional environment
library. Asset checks verify hashes, embedded textures, spawn counts, material
properties, valid genes, inventory transfers, launching, and capsule parent
deposit/retrieval without submitting any external generation job.
