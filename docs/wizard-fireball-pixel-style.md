# Pixel-style fireball regeneration

Generated with the built-in image generation tool using the wizard character sheet as the art-style reference and the unified fireball sheet as the layout reference.

Installed asset: `public/assets/wizard/fireball-unified.png` (1254 × 1254, verified alpha channel). The existing 8 × 4 atlas and spawn-once/flight-loop behavior are retained. Nearest-neighbor filtering preserves the stepped edges at runtime.

## Art prompt

Regenerate image 2 (fireball spritesheet) to MATCH THE PIXEL ART STYLE OF IMAGE 1 (wizard character reference). Image1 is style reference ONLY; do not include any character. Image2 is layout and animation reference. EXACT 32 frames, 8 columns x4 rows, square image, true transparent RGBA background. Preserve the grid and centers: each core at horizontal 50%, vertical79% of its cell. Match chunky low-resolution game sprites: flat hand-placed rectangular pixel clusters, hard stepped edges, 5-color palette (#2366bb #279fe0 #67d7ec #b8f1f5 #f1ffff), solid flat color regions, NO gradients, NO glow halo, NO noisy flecks, NO semi-transparent smoky fringes, NO realistic fire, NO painted look. Make each sprite look drawn on a 32x64 pixel grid with crisp large pixels. Compact bright pale core, angular blue flame tongues trailing UP. Frame0 tiny spark, frames1-15 gradual continuous growth and ignition, frames16-31 steady size seamless flickering flight loop. Frame15 matches16, 31 blends back to16. Flight core and total size remain fixed. All sprites isolated with padding inside cells; no overlap. Pure transparent pixels outside the flame silhouette. No text, labels, grids, checkerboard, staff or decorations. A cohesive understated retro pixel game spell, rather than high-detail magical illustration.

## Successful transparency correction

Background extraction only. Make all checkerboard and gray/white background fully transparent with an actual ALPHA CHANNEL. Do not draw checkerboard. Output RGBA with alpha zero between sprites. Keep blue flame sprites only, preserving their bright white nuclei enclosed inside cyan. Transparent background must display black in the tool preview, not gray checkerboard. Preserve 8x4 layout and dimensions, all 32 frames, and flat chunky pixel art style. This must be a transparent sprite cutout.
