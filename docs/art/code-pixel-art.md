# Code-drawn pixel art

How to remake existing art as crisp pixel art in code, and the rules that make the result look clean. It applies to any terrain, prop or sprite. The Lushy Peaks platforms were the first use, so their specifics appear as examples in parentheses; adapt those to whatever the art contains. Scripts: `scripts/art/lushy-platform-masks.cjs` (tracing) and `scripts/art/generate-lushy-platforms.cjs` (drawing).

## Process

1. **Start from the existing art, not from scratch.** Sample the original's own pixels onto the chunky grid and restyle on top. Procedural stones only look right in the gaps the original leaves (for example under moss). Inventing everything gave uniform, generated-looking results every time.
2. **Choose the pixel size first** (see below). Every later number is in art pixels on that grid.
3. **Trace the original onto the grid.**
   - Silhouette: a cell is solid when most of its texture pixels are opaque and belong to the body (exclude loose overlays; Lushy: non-green rock). Fill enclosed holes, remove thin dangling strands with a small opening, keep only the largest piece, then close tiny notches. A few 5×5 majority passes turn sawtooth teeth into clean bulges.
   - Colours: per cell, take the **mode** of the palette-snapped pixels, not the mean. The mode keeps edges crisp; the mean blurs.
   - Structure: find the parts the art is built from by the outlines or gaps between them, and keep their outlines for later layers to follow (Lushy: stones found by the dark mortar, reused for mortar lines and crack-following vines).
4. **Remove what the redesign replaces.** Mask out the original's parts you are redrawing and inpaint them from the surrounding material. Check what the inpaint produces: if the area sat on something dark or empty (a gap, shadow, background), fill it with generated material instead, or it reads as a hole. (Lushy: the original's boxy moss was removed; where it sat in mortar, generated stones fill it.)
5. **Draw the new layers on top** from code, in back-to-front order, each one aware of the traced structure: details follow real edges, cracks or contours instead of being scattered at random. (Lushy: a draped turf mat, vines that follow the mortar, moss hanging off the underside, flowers.)
6. **Upscale with nearest neighbour** by the integer pixel size, crop to the exact installed texture size, and verify every texture pixel matches its art pixel.
7. **Compare and review.** Put the original next to the remake at the same display size, zoom in on edges, and look at it in the game. Run an independent critique (a subagent) against the full list of feedback so far before showing work.
8. **Install at identical texture dimensions** so map scales, collision bodies and spawns need no changes. Keep the previous textures as tracing sources. Run `npm run validate:content` and `npm test`.

## Setting pixel size when the art is already in a map

Players see texture pixels × map scale, so one map can mix wildly different pixel sizes if every texture is drawn on the same grid. Match the **on-screen** size instead:

1. Read each object's `scaleX` from the map JSON (`src/shared/maps/<id>.json`; also check the `data/maps/` override, which wins at runtime).
2. Choose a target on-screen art-pixel size from an approved reference. The Lushy large ledge: 8 texture px × 0.175 = 1.4 screen px.
3. For each texture, texture px per art pixel = target ÷ scale, rounded to a whole number: base 1.4 / 0.2 → 8 to 12, small 1.4 / 0.045 → 31 to 40, side 1.4 / 0.075 → 19 to 24.
4. Compute the logical grid as `ceil(textureSize / pixelSize)` and crop the upscale back to the texture size. Keep the cropped last row and column empty.
5. Convert every layout number to the new grid: the walk line (`body.offsetY / pixelSize`), the rock top, stone sizes, vine counts.
6. Check by multiplying each pixel size by its scale and comparing them. Large objects can sit a little coarser and small ones a little finer, but keep them within about 1.4–2.4 screen px so the set reads as one style.

Lushy Peaks result: base 12× (2.4 screen px), large 8× (1.4), side 24× (1.8), small 40× (1.8).

## What makes it look defined and good

- **One shared palette across a set,** with ramps of about 11 stone, 8 turf and 6 moss steps. Snap everything to it. Then match average brightness across pieces (measure the mean rock luminance; Lushy targets about 77–81) and shift ramps one step to fix outliers.
- **Shading tells the depth:** a lit top-left face, a darker lower-right face, creases on big stones, a one-pixel highlight rim on top-left edges, a two-step shadow rim on bottom-right edges, and a cast shadow into the mortar below. Light comes from one fixed direction for every piece.
- **Part sizes follow the original:** keep its mix of small, long and large parts. A uniform grid of equal parts looks generated, so derive sizes from the trace and split parts the trace merged (Lushy: small, long and boulder stones).
- **Parts fit together:** one even separating line where parts meet and no empty patches. Draw separators only where the original is already dark, so lines never cut across a lit face (Lushy: mortar between stones).
- **Clean outlines:** a one-pixel dark outline, with no slivers, lone pixels, spikes or bare strips between the stones and the edge. Let stones run right up to the outline. Curves are curves drawn in pixels, steep near the top and flattening toward the base, never 45° stair-steps or big blocky steps.
- **Organic, not noisy:** small, deliberate irregularity in stone shapes and tufts. Avoid speckle noise, straight dash strips, repeated identical stamps (every tuft and flower should differ) and regular checker textures.
- **Overlays look grown, not stamped:** thin, varied shapes that follow the structure underneath (Lushy: 1–2 px vines winding along mortar cracks, moss strands hanging off the underside). Avoid thick, boxy or geometric patches.
- **Layers overlap instead of stacking in bands:** a surface layer should drape over what's below it with a ragged edge, not sit as a flat strip with details glued on top (Lushy: the turf mat). Keep gameplay edges, such as a walk line, exactly where collision expects them.
- **Edges of large flat areas:** darken toward the sides with a dithered fade so they don't look flat-lit (Lushy: the pillar sides).
- **Deterministic:** seed every random choice, so a rerun reproduces the approved art exactly.

## Common mistakes

- Thresholding a distance field for shapes: uneven stair-steps that look choppy. Use real polygons with supersampling, or the original's pixels.
- Clipping stones short of the outline, or deleting clipped stone fragments: leaves bare mortar strips along the edge.
- Tracing too strictly, so shadowed stone faces read as mortar: stones split into fragments and too much mortar shows.
- Reusing one grid for objects drawn at different map scales: pixel sizes no longer match on screen.
- Judging only scaled-down previews: always zoom to the native grid and check in game.

## Other maps

`scripts/art/pixelate-map-platforms.cjs` applies the trace, palette and outline steps to the Mangrove Meadow, Serenity and Candy Land platforms. Candy Land and Serenity use about 1.8 screen px. Mangrove is set to a fine 2-texture-px grid, but its textures are currently the originals. Run it with no flags to preview into `output/platform-pixel/`, and with `--install` to replace the textures. It traces from `scripts/art/mangrove-repaint/`, `scripts/art/serenity-redesign/` and `scripts/art/candyland-originals/`.

The Mangrove and Serenity sources are BB-style redraws made with Codex image generation; the raw paintings are in `scripts/art/platform-concepts/`. `scripts/art/fit-platform-concepts.cjs` fits them to the texture sizes: it paints the Mangrove ground as one image and slices it into its four tiles, and lines up each platform's walkable top with its collision line. What worked for Serenity: ask Codex to edit the original platforms (`scripts/art/serenity-originals/`) with small, specific changes, rather than redrawing from scratch. Keep the art flat and side-on with no angled top. Then match colours in code: the large platform's stone to the side platform's, and every green to the original Serenity moss green. Code colour-matching is exact, and image generation is not. Set `PIXEL_TARGET` and `ONLY_MAP` to preview one map at another grid size. A map's `outline` setting controls how dark the silhouette edge is: 0.32 is near-black, and Serenity uses a soft 0.7 because the black border looked heavy.

The installed Serenity set uses a frame of flat river stones around a recessed, weathered panel, with carved chevron rows and a carved pennant (the banner from the logo). The final Codex images are in `scripts/art/platform-concepts/`.

Match the size of details, not only the pixel size. Platforms drawn at different map scales need their stones, carvings and grass drawn at the same in-game size. Codex doesn't know a texture's map scale, so give it a scale reference: the large platform resized by `(genWidth / worldWidth) / (largeGenWidth / largeWorldWidth)` and cropped to the target canvas. To check a set, render every texture at `textureWidth × scaleX` side by side. Run the fit script, then the pixelate script. Art that runs off a texture edge gets no outline there, so tiled pieces such as the Mangrove base meet without seams. Run `pixelate-candyland.cjs --install` before this script, never after: that script rewrites the Candy Land platforms from the originals.
