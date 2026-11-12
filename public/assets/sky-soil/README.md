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
