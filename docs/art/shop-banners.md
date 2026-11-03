# Shop banner artwork

Non-player-card banners live in `public/assets/shop/banners/` and are selected
by `src/shared/catalogs/shopCatalog.json`. The player-card banners are maintained
separately; the Ironbound Arsenal bundle includes an empty frame in its scene.

The approved direction is the detailed treasury scene reviewed on 2026-11-03:
consistent visible pixel clusters throughout the architecture and props,
continuous stepped outlines, readable material details, and natural perspective.
Use the approved scene as the style reference and the installed currency icons
or Ironbound body as the subject reference. Preserve the cyan gem's broad crown,
tall pointed lower half, facets and dark outline.

Prepare medium masters at 768×512 for regular banners and 1024×384 for wide
banners. Enlarge exactly 2× with nearest neighbor and encode lossless WebP.
Do not force the scenes into a 16-color palette or reduce them to an 8× grid:
that earlier treatment lost detail and damaged contours. The shop CSS also uses
pixelated image scaling.

`node scripts/art/install-shop-banner-art.cjs <master-directory>` validates all
eight named PNG masters before exporting them at their catalog dimensions.
Generation sometimes returns a larger canvas than requested; check its actual
dimensions and prepare the medium master before running the importer. Local
approved sources, medium masters, prompts and the review sheet are retained in
`output/shop-banner-approved/`.
