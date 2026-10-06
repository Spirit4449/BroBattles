# Loading swords

`loading-swords.webp` is a 128×128 transparent two-column sprite sheet used by
the shared `.bb-battle-loader` in `public/styles/ui-system.css`. Each 64×128
cell contains one upright steel sword with gold guards and brown leather grips.
Only the inset gems use logo colors: ice/cobalt-blue “BATTLES” on the left,
yellow/orange “BRO” on the right.
Render with nearest-neighbor sampling. CSS supplies the swing, clash, and recoil.

Original artwork generated with built-in ImageGen using `public/assets/thorg/body.webp` and
`public/assets/currency/coins-small.webp` as style references. Original source:
`/Users/nisch/.codex/generated_images/01a10fdd-bc8f-7b41-95e2-01f4a4cd1ab2/exec-5a0ccb6c-4192-4014-85d3-506424ecd472.png`.
Sharp resized the complete sheet with nearest-neighbor sampling and lossless
WebP encoding, preserving alpha.

## Original generation prompt

Create a production-ready Bro Battles loading-icon sprite sheet on genuine transparent RGBA background. The supplied Thorg portrait and coin are STYLE REFERENCES ONLY: match their authentic coarse pixel art, large deliberate square clusters, thick near-black staircase outlines, saturated restrained palette, hard flat stepped metal highlights, NO smooth gradients, blur or antialiasing. Draw exactly TWO matching chunky medieval BROADSWORDS, upright, tip pointing straight up and pommel straight down, front-facing and rigidly straight. Left sword has a small vivid blue inset gem in its guard; right sword has a red inset gem. Both have broad beveled silver/steel blades with dark slate shadows, strong white pixel glints, thick antique gold angular crossguards, short wrapped brown leather grips, and square gold pommels. No blue/red glowing blades: blade metal stays silver. Compact muscular weapon shapes consistent with the references, readable at 64-pixel icon size, no tiny texture detail. Layout is an exact 2-column 1-row sprite sheet on a square canvas: left sword centered at x=25%, right at x=75%, identical scale and geometry. Each full sword occupies y=6% through 94%; guard center at y=72%; pommel center at y=90%. Each sword guard spans about 70% of its half-cell width; blade width about 28% of its half-cell. Wide transparent separation between the two swords, complete silhouette and safe margins. No hands, characters, effects, letters, labels, backdrop, checkerboard, or cast shadows. Only the two upright weapons on real transparency.

## Gem-only logo palette edit

Edited with built-in ImageGen using the original steel sword sheet as the target
and `public/assets/logos/logo-large.webp` as the gem palette reference. Installed
source: `/Users/nisch/.codex/generated_images/01a10fdd-bc8f-7b41-95e2-01f4a4cd1ab2/exec-9ae18fb7-4ea0-4705-b1c9-fffdb3cc45c6.png`.
Sharp resized the sheet to 128×128 with nearest-neighbor sampling and lossless
WebP encoding, preserving alpha. CSS clash/recoil motion remains unchanged.

Edit image 1, the ORIGINAL Bro Battles two-sword sprite sheet with SILVER STEEL BLADES and blue/red guard gems. Image 2 is the Bro Battles logo, PALETTE REFERENCE ONLY. Change ONLY THE TWO SMALL INSET GUARD GEMS: LEFT gem uses BATTLES lettering's ice-blue highlights, sky blue midtones, cobalt-blue shadows; RIGHT gem uses BRO lettering's pale cream highlights, vivid yellow/gold midtones, warm orange shadows, replacing its red. Keep their exact existing shape and pixel placement. EVERYTHING ELSE MUST STAY PIXEL-IDENTICAL to image 1, especially BOTH silver-gray steel blades with white glints and slate shadows, original gold crossguards/pommels, brown leather grips, dark navy outlines, square coarse pixel clusters, sword sizes, upright poses, alignment, spacing and canvas dimensions. Do not color the blades, guards, grips or pommels using the logo. No new objects, effects, glow, gradients, blur, text, background, or checkerboard. Exactly two original steel swords with only gems recolored, on genuine transparent RGBA background.
