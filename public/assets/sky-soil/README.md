# Sky Soil artwork

Generated with the built-in image generation tool. Installed assets: `public/assets/sky-soil/background.webp` and `underside.webp`.

Background prompt: Redesign the existing meadow backdrop as an airy alpine sky archipelago with floating grassy islands, tapered exposed warm stone, pine groves, waterfalls spilling into cloud seas, distant teal mountains, cream cloud towers and turquoise sky. Frame the sides with islands at several distances; leave the upper center open for combat. Use deliberate coarse square pixel clusters, hard staircase contours and flat stepped shading. No characters, UI, text, buildings or playable foreground platform. References: existing Mangrove background and Bedwars mode cover (style only).

Underside prompt: One isolated transparent wide floating earth island underside sprite, continuous flat brown upper attachment band, layered earth transitioning into angular tapered rocks, asymmetric stone teeth, deeper central keel, dangling roots and short vines. Match existing baseMiddle soil and Bedwars pixel style. No grass, trees, sky or detached rocks. Preserve the entire silhouette with transparent margins.

The generated underside is cropped, resized with nearest-neighbor sampling and feathered over its first 12 pixels to join the existing earth. It is a world-fixed scenery layer over the base art, with no collision. Existing platform geometry, spawns and stable map key remain unchanged.

## Layered mountain revision

The side-island backdrop was replaced at the user's request. Runtime layers are
`sky.webp` (scroll 0.025), `far-peaks.webp` (0.10), and
`forest-ridges.webp` (0.26), followed by the world-fixed platform underside.
`background.webp` is a flattened lobby-only composite of the new scenery.
Three moving cloud groups stack between the mountains. High/Super High add
mint distance fog, three drifting mist banks, warm sunlight glow and rays,
subtle motes, platform lighting and a restrained teal vignette.

Built-in image generation prompts:

- Sky: Match the existing turquoise alpine atmosphere, with only turquoise sky,
  stepped mint horizon light and cream cloud banks along the bottom and far
  edges. Open upper sky, crisp square pixel clusters. Remove all mountains,
  land, trees, floating islands and waterfalls; no text or sun disc.
- Mountain sheet: Two separate transparent mountain strips. Upper: pale mint,
  sage and blue teal alpine peaks around a low central valley. Lower: distinct
  emerald forested ridges with pine silhouettes and thin waterfalls. Continuous
  full-width terrain, transparent above the ridgelines, solid baselines; no
  islands, sky, clouds, labels or borders. Match the original meadow mountains'
  hard staircase contours and stepped pixel colors.

The strips are cropped into separate full-canvas layers and extended below
frame to avoid exposed bottom edges. Installer: `scripts/art/sky-soil/install-layers.cjs`
(requires the original generated files recorded there). The game-rendered full
preview is a still composition; live atmosphere is verified separately.

## Livelier sky and integrated island revision

Current runtime art uses `sky-v2.webp`, `forest-ridges-v2.webp`, the existing
far peaks, four `mangrove-base-*.webp` textures in this folder, and
`underside-v2.webp`. `island-master.png` is the assembled base master.
`refine-art.cjs` fits the generated base to the original grassy ledges and
splits it into the existing texture sizes using original alpha masks. The
underside comes from the same master, eliminating the separate dark rock band.
Collision geometry is unchanged. Keep this revision after the older installer.

Built-in image generation prompts, referencing the respective installed assets:

- Sky edit: Rich wind-shaped cream cloud ribbons across the upper half, tall
  sculptural sunlit cloud banks at the sides, smaller central wisps, warm golden
  sunshine at upper right, stepped turquoise/mint sky bands. Deliberate chunky
  pixels, readable gaps, no land, floating islands, UI or text.
- Forest edit: Keep transparent upper half and lower forested valley composition.
  Add varied clustered pines, sunlit meadow and moss patches, pink/yellow flowers,
  a winding turquoise river, two tiered waterfalls and weathered rock shelves.
  Continuous grounded terrain, no floating islands, labels or buildings.
- Base edit: Preserve grassy ledge positions and stepped top silhouette. Redraw
  the whole face and underside together as warm terracotta/tan sandstone strata,
  rounded stone slabs, exposed roots, moss and hanging vines. Compact organic bowl
  with three broad uneven lobes. No repeated pointed teeth, grey stalactites,
  straight join or attached lower band. Transparent background, side-on pixel art.

Artwork generated with the built-in image generation tool. The source paths
are recorded in `scripts/art/sky-soil/refine-art.cjs`.

## Current: unified pixel finish

Run `node scripts/art/sky-soil/pixel-finish.cjs` for the current installed finish.
Its project-local source masters are in `scripts/art/sky-soil/pixel-sources/`.
This deterministic finishing pass uses area sampling, small per-asset palettes,
hard transparency, nearest-neighbor expansion and lossless WebP. Grid spacing
is 2 world pixels for the island, 3 texture pixels for the forest, 4 for sky
and far peaks, and 5 for the small platform's 0.4x texture.

The entire main island now renders as ONE `island-base` world-fixed scenery
image. `p0`–`p3` retain their exact original collision definitions and IDs but
have `alpha: 0`. There are no visible tiled joins or separate underside image.
The saved Map Studio layout uses a refitted master for its lower central pillar;
the built-in layout uses the original pillar height. Platform lighting overlays
are disabled for this map to avoid exposing the four hidden rectangles; the
scene's glow, rays, mist and parallax remain active.

Runtime assets: `sky-pixel.webp`, `peaks-pixel.webp`, `forest-pixel.webp`,
`small-platform-pixel.webp`, and either `island-pixel.webp` (built-in) or
`island-saved-pixel.webp` (saved map). `background.webp` is the matching flattened
lobby background. No new image generation was needed for this finishing pass;
it processes the previously generated artwork without changing its composition.

## Current: native-detail sharp revision

`sharp-finish.cjs` supersedes the coarse pixel finishing pass. It preserves
native RGB detail without downsampling or palette reduction, exports lossless
WebP with hard alpha, and uses nearest texture filtering. The island is stored
at 1595×986 and scaled to the same 1100-world-pixel design frame. It remains a
single continuous image with unchanged invisible collision rows. Detached alpha
specks are removed by retaining the largest connected island component.
Foreground fog, glow and mist were reduced to retain contrast.

Two new source images were generated with the built-in image tool and saved in
`scripts/art/sky-soil/sharp-sources/`. Forest prompt: redraw the existing alpine
valley with exceptionally sharp designed pine/rock clusters, clean waterfalls,
meadow flowers and river; retain framing and transparent sky, deep teal shadows
and emerald/gold highlights; no blurred haze, gradients, islands, buildings or UI.
Island prompt: preserve exact frame and platform silhouette, redraw as sharp
handcrafted pixel art with terracotta sandstone strata, dark creases, clean
highlights, olive grass, roots, moss and angular vines; no seams, soft gradients,
antialiasing, noisy speckling, scenery or text. Sky and distant peaks retain
native source detail rather than the reduced pixel-grid versions.

## Current: Codex islands, code-drawn platform, animated sea and falls

Run, in order:

```bash
node scripts/art/sky-soil/main-platform.cjs --install
node scripts/art/sky-soil/compose-backdrop.cjs --install
node scripts/art/sky-soil/library-clouds.cjs --install
```

**Main platform** (`island-v4.webp` built-in, `island-saved-v4.webp` saved
layout). Drawn in code on the small platform's own grid: 2 world px per art
pixel, with the palette sampled from `small-platform-sharp.webp` (lime grass
over warm brown soil, light left rim, dark base). Extra texture: broad
two-tone strata, rounded outlined stones, speckles, leafy vines, grass bumps
and branching roots. The silhouette comes from the previous island art in
`scripts/art/sky-soil/platform-masks/`, opened to drop plant overhangs and
flattened along each ledge, so the grassy tops stay on the unchanged invisible
`p0`–`p3` collision rows. A Codex repaint was tried and rejected: its art
pixels were 4x the small platform's.

**Backdrop.** Islands were generated with Codex `image_gen` in BB style on flat
`#FF00FF`, then pixelated: the source's own pixel grid (about 12.5–13 px) is
detected from colour edges and resampled one majority-colour sample per art
pixel. Sources are in `scripts/art/sky-soil/codex-sources/`. Prompts (style
references: `small-platform-sharp.webp`, Candy Land's full preview, then
`island-b.png` for the later ones):

- island-a: big wide floating island, lime grass, pines on the left and two
  round pink blossom trees on the right, terracotta strata with rounded stones,
  lobed underside with rocky points, hanging roots and leafy vines; no water.
- island-b: big island with a higher right plateau, tall pines, one pink
  blossom tree, bushes, strata, stones, a deep rocky keel, roots and vines.
- islets: three small islands in a row: one with a pine, a bare grassy rock,
  and one with a blossom tree and a bush.

Layers, back to front:

- `sky-v4.webp`: smooth gradient sky, soft sun glow and blurred, sky-tinted
  distant islands and cloud banks. No pixel grid, linear filtering.
- `far-isles-v4.webp`: hazed islands (2 px grid) over a far cloud sea.
- `cloud-sea.webp` + `cloud-sea-anim.webp`: the cloud sea the arena floats in,
  stored at native size (the cover fit scales it 2x). The part loops 12 frames
  at 5 fps: lobes swell on their own phases and banks sway by one pixel.
- `near-isles-v4.webp` (3 px grid): framing islands and islets, with
  `waterfall-1/2.webp` parts (8 frames at 14 fps) placed on each island's
  inner grass lip and falling into the sea.
- Sky clouds come only from the scenery clouds feature (library clouds).

**Cloud library.** `library-clouds.cjs` redraws all twelve
`public/assets/clouds/cloud-*.png` as pixel cumulus on a 4 px grid, each at its
original's size, so maps that place them (Candy Land, Sky Soil) keep their
layout.

`pixel-kit.cjs` holds the shared drawing code: cumulus, cloud sea, waterfall
helpers and the per-layer on-screen windows (`WIN`), which were measured from a
game render of the whole camera bounds. Re-measure them if a layer's `scroll`,
`fit` or offset changes.
