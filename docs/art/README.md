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

- **Thorg:** current shared sweep phases are defined in `src/shared/characters/thorg.json`. `thorgAttackFrames.json` supplies the attack track. The atlas includes baked weapon/sweep artwork. Thorg has only his default appearance; separate weapon sprites and the old skin orbit are removed. Held pose imports use `thorg_duck.png` and `thorg_slide.png` with source alpha preserved. Straight-down stomp uses duck presentation; old falling-only dash notes are superseded.
- **Gloop / Crystal Gloop:** use 128px logical frames and named duck/wall poses. Base Gloop's `pack-gloop-refresh.cjs` samples the canonical `public/assets/gloop/body.webp` portrait onto native 128px canvases with nearest-neighbor sampling, using baseline atlas metadata under `output/gloop-hq/`. The generated approximation was replaced with portrait artwork. The original silhouette is preserved; only the very top tier is shortened by roughly one native sprite pixel (four rows in the intermediate master), reducing the raised cap from two steps to one. It strips baked outlines before deformation and adds one uniform native-pixel black contour afterward, including throwing poses. Enlarged previews use nearest-neighbor sampling. All base poses deform the same canonical portrait artwork: throw uses a windup, forward crest extension, delayed body compression, recoil, and damped recovery; airborne poses use an impulse-aligned vertical launch stretch, subtle lower-body lag, relaxation toward a rounded apex, and modest vertical descent stretch with a full rounded leading underside; column-wise ellipse remapping preserves the detailed core without lateral airborne wobble; wall slide flattens only the right contact side, mirrored by normal wall-facing logic. Frames share consistent foot registration. Base Gloop additionally has three-frame `dashright`, `dashdiagonal`, and `dashup` tracks at y=640, selected for local and remote dash direction and timed to the shared dash duration; dash poses keep the core artwork upright and morph the silhouette toward travel without rotating it; width/height tradeoffs keep their size near the resting body. Horizontal and angled left dashes mirror the right-facing art. Crystal retains its existing shared pose set. The base running loop has ten gradual poses with a restrained forward rolling crest, delayed lower-body sway, and a small traveling ripple; width and height change inversely to keep the apparent jelly volume steady. These are authored elastic poses, not a fluid simulation. Idle breathes over 3.5 seconds. Base running cadence covers roughly two visible body widths per roll and scales with horizontal velocity. Base jump/fall frames are selected by vertical velocity using `bbMotion` metadata, rather than fixed clip time; remote playback uses replicated velocity. Production still uses the regular atlas: only frame selection and playback rate are physics-driven. Skin clips without that metadata retain timed playback. The Crystal skin retains the internal ID/path `gloop-amethyst`. Full atlas packing and targeted pose packing are separate operations; `pack-gloop-poses.cjs` changes duck/wall frames and `pack-crystal-falling.cjs` changes Crystal falling frames. These older packers can overwrite the refreshed base poses. The procedural projectile renderer chooses its skin presentation while collision remains shared. Gloop’s hook super uses the refreshed eight-pose `hand-grip.webp` with genuine alpha, plus matching open/closed fallback images. `pack-gloop-super-refresh.cjs` packs the generated reference sheet under `output/gloop-super-refresh/` onto the existing coarse grid. Preserve pale mint highlights when uploading the atlas; the retired neutral-background color key would erase them. The tether and debris palette in `special.js` matches the black edge, royal-blue core, and mint jelly. The tether and trail droplets render behind the player layer; the hand remains in the attack foreground.
- **Arena Sovereign Ninja:** padded 72px logical atlas frames, explicit duck/falling overrides, crown projectile and upright crown-spin assets are supplied through skin assets. Preserve animation names and inspect both predicted and remote flight after repacking.
- **Wizard / Draven:** friendly and enemy `*-bb` atlases have matching JSON. Wizard's fireball is drawn in code (`src/client/game/characters/wizard/fireballArt.js`, blue and red palettes) with procedural pixel trails in `fireballParticles.js`; Draven uses `explosion-bb` and `special-bb` pairs. Team affiliation is viewer-relative and retained on released attacks. The shared team presentation contract is `src/shared/projectilePresentation.js`.

Chat reactions use six hand-authored SVG icons on a shared 16×16 pixel grid in
`public/assets/chat-reactions/`. Regenerate them with
`python3 scripts/art/generate-chat-reactions.py`. The renderer maps existing
Unicode reaction values to these assets for both party chat and direct messages;
unknown legacy reactions keep their text fallback. Each icon uses square edges,
transparent margins, a dark outline, and stepped shading from the game palette.

Site waffle-menu icons live in `public/assets/icons/menu/` (96×96 lossless
WebP, shown at 24px, 20px for the legal links). They were generated with Codex
`image_gen` on flat `#FF00FF`, one asset per run, using `gem.webp` and
`lock.webp` as style references. `node scripts/art/install-menu-icons.cjs
[sourceDir] [--preview]` keys, trims and installs them from
`output/menu-icons/<name>.png`.

## Tools and regeneration

For terrain or props redrawn as crisp pixel art in code (the Lushy Peaks platforms), follow [Code-drawn pixel art](code-pixel-art.md): process, choosing pixel size from map scale, and quality rules.

The [Sprite Workshop](../../spritesheet-generator/README.md) is the general local image/atlas/video editor. It keeps editable projects and exports; it never installs into game assets automatically. Its independent package supplies Sharp for several repository art scripts.

Specialized importers live in `scripts/art/`: body alignment, king packing, Crystal/Gloop pose packing, Thorg video import, team-combat packing, reward import and badge splitting. Read a script before running it: source paths, system dependencies and output scope differ. Depending on the tool, prerequisites include the Workshop's dependencies, Python/Pillow, FFmpeg/FFprobe or `cwebp`. Some inputs referenced by old generators were intentionally removed; the retained WebP/JSON assets are the working masters in those cases. Do not assume ignored `output/` files or absolute workstation paths exist in another checkout.

Preserve alpha and intentional pixel clusters, cell names, logical dimensions and registration. Full sheet regeneration can overwrite later targeted fixes; reapply only the intended pose edits and verify the result. Keep licensing records and source provenance when relocating assets.

## Verification

Run `npm run validate:content`, then relevant tests such as `tests/battleAssetPreload.test.js`, `tests/profileCharacters.test.js`, `tests/playerPresentation.test.js`. Build after changing runtime imports or URLs. Visually review transparent edges, atlas cells, animation seams, skin selection, team colors, and local/remote combat at game scale. A passing file contract does not verify animation quality.

## Transfer-size maintenance

Keep atlas dimensions, frame registration, animation timing and alpha intact.
Static pixel-art WebPs can be losslessly re-encoded with FFmpeg's `libwebp`
encoder (`-lossless 1 -compression_level 6`); compare decoded visible RGBA pixels
before installing and keep the original if it is smaller or color conversion
changes pixels. The minimal Homebrew FFmpeg lacks this encoder; use
`/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` where installed.

Shop banners ship at native master resolution (see [shop banners](shop-banners.md)).
Opaque background illustrations may use quality 95 WebP after visual review and
an FFmpeg SSIM check of at least 0.99, without changing canvas dimensions.
Short sound effects ship as MP3 VBR quality 2 with original sample rate and channel
layout. Music is already compressed; avoid repeated lossy transcodes. Card MOV
and WebM files are separate browser alpha implementations, not redundant copies.

Remove assets only after checking loaders, generated paths, catalogs, saved maps,
CSS, server-rendered pages and authoring tools. Map Studio asset-library entries
and referenced historical map revisions remain valid consumers. Keep license
records and unfinished character migration sources. Completed export directories,
old diagnostics, generated `dist`, and webpack caches can be regenerated or removed;
they are not asset sources. Do not delete editable Workshop projects, live data,
credentials, or Git history as cache cleanup.
