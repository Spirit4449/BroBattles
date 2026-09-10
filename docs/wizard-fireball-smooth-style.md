# Smooth stylized fireball

Regenerated using the built-in image generation tool. Installed at `public/assets/wizard/fireball-unified.png` (1254 × 1254 with verified alpha transparency). Existing 32-frame atlas and spawn-once/flight-loop playback retained. Linear texture filtering softens the rendered edges.

## Art prompt

Edit this unified blue fireball spritesheet to be LESS PIXELATED: replace large stair-step blocks with finer, gently curved hand-drawn flame contours and smooth cel-shaded color transitions. Stylized 2D game art, moderate detail, not realistic fire, not blurry or smoky. Keep clean defined silhouettes, icy white core, cyan body and medium blue edge. Remove noisy detached fringe pixels. Preserve EXACT 32 frames in 8 columns x4 rows, original square dimensions, equal cells and the existing per-frame sizes/positions. Core remains at 50% width and 79% height of each cell. First16 frames grow once, last16 steady-size flickering flight loop. Preserve continuity at frame15->16 and31->16. Change only the rendering style, not animation layout or progression. MOST IMPORTANT preserve actual RGBA alpha transparency: empty space between flames must have alpha=0, no checkerboard, no black/white/gray painted background. Output transparent PNG.

## Transparency pass

Background extraction only. Make all checkerboard and gray/white background fully transparent with an actual ALPHA CHANNEL. Do not draw checkerboard. Output RGBA with alpha zero between sprites. Keep blue flame sprites only, preserving their bright white nuclei enclosed inside cyan. Transparent background must display black in the tool preview, not gray checkerboard. Preserve 8x4 layout and dimensions, all 32 frames, and smooth cel-shaded art style. This must be a transparent sprite cutout.
