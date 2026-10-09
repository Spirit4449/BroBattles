# Art workflow and installed assets

Use this guide for asset maintenance. [Prompt provenance](provenance.md) retains historical generation instructions and source identifiers; it is not a description of the current runtime. The catalogs, atlas JSON and character preloaders define what ships.

## Ownership

| Asset | Current contract |
| --- | --- |
| Base characters | `public/assets/<key>/body.webp`, `spritesheet.webp`, `animations.json`; registered by `src/client/game/characters/manifest.js` |
| Skins | `src/shared/catalogs/skinsCatalog.json` supplies identity, paths and optional `gameAssets` overrides |
| Portraits | `src/client/views/bodyPortraitAssets.js` bundles catalog bodies; selection uses equipped skins and detail views can preview a skin |
| Levels | `public/assets/levels/1.webp` through `10.webp` are still fallbacks; `animations.json` maps imported transparent looping WebP animations and aligned posters |
| Mode covers | `public/assets/map-banners/`; URLs belong to the mode catalog. Artwork does not imply a mode is playable |
| Reward illustrations | `public/assets/currency/` and `public/assets/reward-bundles/`; display selection is separate from currency grants |
| Website | `public/assets/site/`; inspect current site templates for selected versions. Not every landscape has an 800px derivative |
| Map artwork | The map document asset library; see [Map Studio](../development/maps.md) for upload and immutable revisions |
| Sound | Keep source/permission records beside movement, UI, reward and character audio files |

Installed body portraits are maintained independently from atlas packing. The shared canvas alignment tool is `scripts/art/align-body-canvases.cjs`; check dimensions and silhouettes after any import. Do not replace a newer portrait with an older packer's output merely because its historical prompt described that portrait.

For the ten standalone level badges, use the [Gemini Omni animation prompts](level-badge-video-prompts.md) as image-to-video directions. Levels 1–10 use the supplied clips, keyed to transparent animated WebP at 160×160 (displayed at 40–96px). Motion interpolation happens before background removal, preserving moving alpha edges. Most clips sample interpolated motion at 40fps and display each frame for 33ms: approximately 30fps playback at 75% speed. Level 10 uses 72fps interpolation and 42ms display frames, retaining its one-third playback speed at approximately 24fps. WebP quality 82 and minimum-size frame packing keep downloads compact; the encoder can merge identical frames while preserving total duration.

Loop edits are half-open ranges in the interpolated source timeline. Level 4 keeps 0.2–2.8s, removing the late silver flare that extends below the shield, then adds 48 eased transition frames (1.584s) back to the opening pose for a 5.016-second loop. Level 9 keeps 0.325–3.4s, matching flame poses. Level 10 keeps approximately 0.417–1.417s: two continuous wingbeats without the idle lead-in/tail. Levels 9 and 10 ease their final frames into the source frames immediately preceding the new start, preserving alpha and avoiding a held or reversed frame at the seam.

`scripts/art/import-level-badge-videos.cjs <source-directory> [level ...]` reproduces the assets using FFmpeg, img2webp and the Workshop's Sharp dependency. Omit level numbers to import all badges. The importer removes exterior-connected screen green, preserves enclosed green artwork, and uses a fixed crop across each clip to prevent jitter. The manifest retains source filenames, content versions, actual encoded frame counts, durations and byte sizes.

The shared `levelBadgeView.js` uses native looping images, avoiding autoplay permissions and browser-specific alpha-video codecs for these small badges. A picture source selects animation only when reduced motion is disabled; aligned posters cover reduced motion, and load errors restore the original still. Original still masters remain unchanged. Reimporting updates content-versioned animation/poster URLs.

`levelBadge.css` applies per-level scale and vertical alignment after measuring each poster's visible silhouette, then tuning against the character-selection layout. Level 8 is shifted down slightly. These adjustments apply to both poster and animation at every badge placement; keep them aligned with the actual imported artwork if badge sources change.

## Character-specific contracts

### Win-streak fire trophy

`public/assets/icons/win-streak.webp` is the transparent looping fire trophy,
imported from the user-supplied `animatedtrophy.mp4`. It is used only for the
win-streak badge on Ready, the profile streak metric, and match-result streak
updates. The regular `trophy.webp` remains the trophy currency/progression icon.
The loop retains all 27 frames at 42ms each (1.134 seconds), without audio,
on a 160×160 canvas. Its fixed crop retains moving flames without shifting
alignment. Green is removed globally, including the spaces inside the handles.
`win-streak-poster.webp` is the aligned reduced-motion still.

Reimport with `node scripts/art/import-trophy-video.cjs <source.mp4>` (FFmpeg,
img2webp, and the Sprite Workshop's Sharp dependency). Run content validation
and inspect the alpha edges and loop after importing.

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
