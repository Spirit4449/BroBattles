# Wizard fireball charge

Generated with the built-in image generation tool. The existing flight sheet was the palette and silhouette reference.

Asset: `public/assets/wizard/fireball-charge.png` (1254 × 1254, RGBA).
Atlas: `public/assets/wizard/fireball-charge.json` (16 frames, 4 × 4).

The generated sheet retains all 16 frames. The renderer uses its settled bright orb frame with additive blending, growing from a tiny spark over a 520 ms cast. It avoids the rotating spiral frames and smoothly blends into the existing flight animation between 72% and 97% of the cast, after both silhouettes reach matching size, completing the transition before launch. The flight pivot is on the bright core (0.5, 0.70), and the initial server-path correction uses a 240 ms smoothstep to avoid the release dip observed in the gameplay recording. Growth is confined to charging. Staff anchors are frame-relative and mirrored for left-facing casts.

## Generation prompt

Use case: stylized-concept. Asset: transparent pixel-art game VFX spritesheet for the wizard's blue fireball charging on a staff. Reference image is the existing FLIGHT animation, used only for palette/style matching. Generate a NEW 1024x1024 PNG with true alpha transparency, EXACT 4 columns by 4 rows of equal 256x256 cells, 16 frames in reading order, no gaps, borders, labels, background or checkerboard. Every frame's orb center is exactly at the cell center (128,128). Keep all pixels within each cell. Crisp chunky pixel art, stepped edges and small square sparks, no soft glow or blur. Electric azure outer flame, cyan middle, pale icy white core, matching reference. Frames 0-3: tiny blue spark turns into a small swirling orb (diameters 16,28,44,60 pixels). Frames 4-7: orb grows to diameter 80,100,120,140, with curling energy bands. Frames 8-11: grows to 160,175,185,192 pixels, a bright dense round fireball with tiny blue pixel fragments around it. Frames 12-15: retain SAME 192 pixel width and bright round lower core, while small flame tongues develop upward, blending visually into the reference's upright blue flame. Final silhouette no taller than 210 pixels and centered, with rounded white-cyan core and blue upward flame tips. Growth only during charging; final four frames steady size. No staff or character drawn in the sheet. Preserve detailed game-sprite visual quality.

## Transparency correction prompt

Edit only the background of this spritesheet: REMOVE the baked gray checkerboard completely and output actual transparent alpha PNG. All gray grid pixels and diagonal gray artifacts must become fully transparent. Preserve every blue/cyan/white sprite exactly and preserve their 4 by 4 equal-cell layout, alignment, colors and sizes. Output square PNG with true RGBA transparency, no painted checkerboard, no background color. The image will be rendered over a game so actual transparent pixels are mandatory.
