# Final body portraits

Final game artwork lives in `public/assets/{character}/body.webp` and the corresponding skin directories. These WebP files are the retained masters; generated PNGs, old versions, reference images, conversion previews, and the obsolete export script were removed at the user's request.

The final Ninja and Gloop match the selected first-pass references. Thorg has the final wider body, short legs and horns, and mace held across his body. Wizard uses the complete corrected-eye generation. Export preserved native dimensions, visible RGB, and alpha.

`src/lib/bodyPortraitAssets.js` bundles current catalog bodies for the character detail preview and selection cards, avoiding stale separately cached images. Cards use the equipped skin map, while the detail popup may preview an unconfirmed skin.

See `docs/asset-cleanup.json` for the removal inventory. Runtime PNG effects are intentionally retained where gameplay loads them directly.

## Arena Sovereign eye/crown correction

Regenerated individually with built-in ImageGen to repair the eyes, reduce the hood visible above the crown, and make the whole portrait slightly smaller. The visible height is now 77.4% of the square canvas, down from 87.5% (about 12% smaller). Native generated pixels and alpha are preserved in lossless WebP to avoid reintroducing eye distortion through coarse resampling or palette reduction.

Installed at `public/assets/ninja/skins/ninja-arena-sovereign/body.webp`. Source, previous body, comparison, and exact prompt are in `output/body-art/king-revision/`.

## Draven left silhouette repair

Built-in ImageGen repaired the clipped-looking viewer-left sleeve, purple hand, and flaring robe hem while retaining the hood, orange trim, staff and purple crystals. Installed as lossless native WebP at `public/assets/draven/body.webp`, with no palette reduction. Verified visible artwork has transparent margins on every side (209px left, 237px right, 76px top, 77px bottom on the 1254px square canvas). Source, before/after preview and exact prompt: `output/body-art/draven-repair/`.

## Uniform canvases and floor alignment

All ten catalog body files now share an exact 1254×1254 canvas. Existing relative silhouette sizes are preserved, including the smaller King and shorter Gloops. Nearest-neighbor scaling converts other canvas sizes, faint alpha flecks below 128 are cleared, and each image shifts downward until its lowest visible pixel reaches row 1253. No palette quantization or regeneration is used. The two omitted Thorg skins still contain their existing weapon placeholders; their canvases are standardized too.

Reproducible operation: `scripts/align-body-canvases.cjs`. Original backups, measurements, and the floor-aligned lineup are in `output/body-alignment/`. All ten installed images were checked for exact dimensions and a visible pixel on the final row.
