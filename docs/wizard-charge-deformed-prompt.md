# Deformed charge sheet

Generated with the built-in image generation tool. Saved to `public/assets/wizard/fireball-charge.png`, with the existing 16-frame atlas in `fireball-charge.json`. Verified RGBA transparency and 1254 × 1254 dimensions.

## Prompt

Edit this wizard charge spritesheet. Keep EXACT 4 by 4 equal cell grid, square image, same cyan/ice-white/electric-blue palette. TRUE TRANSPARENT RGBA background, never paint checkerboard. Replace the solid circular balls in ALL sixteen cells with irregular wispy magical combustion effects: torn crescent flame tongues, branching pixel lightning, ragged flame ribbons, holes and transparent gaps, asymmetric shapes with a small bright white nucleus. NOT a solid ball, NOT circular rings, NOT a rotating spiral. Crisp chunky pixel art edges, no blur. Animation progresses left to right then top to bottom: first four cells small sparks and few jagged wisps, next four growing irregular forks of blue-white fire, next four dense but porous ragged energy gathering around center, final four slender upward flame tongues around small bright core. Keep center at cell center, all effects fit within 85% of cell, no spill. Each frame should deform organically with tongues flickering, NOT rotate. Later frames same overall size. These effects overlay an existing growing fireball, so leave substantial transparent empty space inside the shape and avoid large filled disks. No staff, text, borders or extra objects. Preserve actual transparent background.

## Alpha correction

Background extraction only. Make all checkerboard and gray/white background fully transparent with an actual ALPHA CHANNEL. Do not draw checkerboard. Output RGBA with alpha zero between sprites. Keep blue flame sprites only, preserving their bright white nuclei enclosed inside cyan. Transparent background must display black in the tool preview, not gray checkerboard. Preserve 4x4 layout and dimensions. This must be a transparent sprite cutout.

## Playback

All 16 frames play over the growing flight sprite. The flight sprite grows from 2.5% to full scale during the 520 ms cast and remains fixed-size after launch. The wisps fade during the last 35% of the cast. Both irregular pixel trail layers render behind the ball.
