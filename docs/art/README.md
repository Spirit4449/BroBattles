# Art workflow and installed assets

Use this guide for asset maintenance. [Prompt provenance](provenance.md) retains historical generation instructions and source identifiers; it is not a description of the current runtime. The catalogs, atlas JSON and character preloaders define what ships.

## Ownership

| Asset | Current contract |
| --- | --- |
| Base characters | `public/assets/<key>/body.webp`, `spritesheet.webp`, `animations.json`; registered by `src/client/game/characters/manifest.js` |
| Skins | `src/shared/catalogs/skinsCatalog.json` supplies identity, paths and optional `gameAssets` overrides |
| Portraits | `src/client/views/bodyPortraitAssets.js` bundles catalog bodies; selection uses equipped skins and detail views can preview a skin |
| Levels | `public/assets/levels/1.webp` through `10.webp`; standalone transparent images, not a runtime atlas |
| Mode covers | `public/assets/map-banners/`; URLs belong to the mode catalog. Artwork does not imply a mode is playable |
| Reward illustrations | `public/assets/currency/` and `public/assets/reward-bundles/`; display selection is separate from currency grants |
| Website | `public/assets/site/`; inspect current site templates for selected versions. Not every landscape has an 800px derivative |
| Map artwork | The map document asset library; see [Map Studio](../development/maps.md) for upload and immutable revisions |
| Sound | Keep source/permission records beside movement, UI, reward and character audio files |

Installed body portraits are maintained independently from atlas packing. The shared canvas alignment tool is `scripts/art/align-body-canvases.cjs`; check dimensions and silhouettes after any import. Do not replace a newer portrait with an older packer's output merely because its historical prompt described that portrait.

## Character-specific contracts

- **Thorg:** current shared sweep phases are 70ms windup, 500ms strike and 300ms recovery in `src/shared/characters/thorg.json`. `thorgAttackFrames.json` supplies the attack track. The base atlas includes baked weapon/sweep artwork; legacy skin presentation has separate handling. Held pose imports use `thorg_duck.png` and `thorg_slide.png` with source alpha preserved. Straight-down stomp uses duck presentation; old falling-only dash notes are superseded.
- **Gloop / Crystal Gloop:** use 128px logical frames and named duck/wall poses. The Crystal skin retains the internal ID/path `gloop-amethyst`. Full atlas packing and targeted pose packing are separate operations; `pack-gloop-poses.cjs` changes duck/wall frames and `pack-crystal-falling.cjs` changes Crystal falling frames. The procedural projectile renderer chooses its skin presentation while collision remains shared.
- **Arena Sovereign Ninja:** padded 72px logical atlas frames, explicit duck/falling overrides, crown projectile and upright crown-spin assets are supplied through skin assets. Preserve animation names and inspect both predicted and remote flight after repacking.
- **Wizard / Draven:** friendly and enemy `*-bb` atlases have matching JSON. Wizard uses `fireball-bb` / `fireball-bb-red` plus procedural particle trails; Draven uses `explosion-bb` and `special-bb` pairs. Team affiliation is viewer-relative and retained on released attacks. The shared team presentation contract is `src/shared/projectilePresentation.js`.

## Tools and regeneration

The [Sprite Workshop](../../spritesheet-generator/README.md) is the general local image/atlas/video editor. It keeps editable projects and exports; it never installs into game assets automatically. Its independent package supplies Sharp for several repository art scripts.

Specialized importers live in `scripts/art/`: body alignment, king packing, Crystal/Gloop pose packing, Thorg video import, team-combat packing, reward import and badge splitting. Read a script before running it: source paths, system dependencies and output scope differ. Depending on the tool, prerequisites include the Workshop's dependencies, Python/Pillow, FFmpeg/FFprobe or `cwebp`. Some inputs referenced by old generators were intentionally removed; the retained WebP/JSON assets are the working masters in those cases. Do not assume ignored `output/` files or absolute workstation paths exist in another checkout.

Preserve alpha and intentional pixel clusters, cell names, logical dimensions and registration. Full sheet regeneration can overwrite later targeted fixes; reapply only the intended pose edits and verify the result. Keep licensing records and source provenance when relocating assets.

## Verification

Run `npm run validate:content`, then relevant tests such as `tests/characterAssetPreload.test.js`, `tests/characterPortraitSelection.test.js`, `tests/trophySkinAssets.test.js`, `tests/thorgVideoAssets.test.js` and `tests/teamPresentation.test.js`. Build after changing runtime imports or URLs. Visually review transparent edges, atlas cells, animation seams, skin selection, team colors, and local/remote combat at game scale. A passing file contract does not verify animation quality.
