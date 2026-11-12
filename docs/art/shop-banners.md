# Shop banner artwork

Non-player-card banners live in `public/assets/shop/banners/` and are selected
by `src/shared/catalogs/shopCatalog.json`. The player-card banners are maintained
separately.

The coin packs use distinct scenes: a treasury satchel, a torchlit cavern chest,
and a moonlit mine cart. The chest and cart were revised using the Bank Bust cover
and coin icon as style and subject references, and exported as 768×512 lossless WebP.

The approved direction is the detailed treasury scene reviewed on 2026-11-03:
consistent visible pixel clusters throughout the architecture and props,
continuous stepped outlines, readable material details, and natural perspective.
Use the approved scene as the style reference and the installed currency icons
as the subject reference. Preserve the cyan gem's broad crown,
tall pointed lower half, facets and dark outline.

Prepare medium masters at 768×512 for regular banners and 1024×384 for wide
banners. Install at these native dimensions and encode lossless WebP; CSS supplies pixelated scaling. A baked 2× enlargement adds bytes without adding detail.
Do not force the scenes into a 16-color palette or reduce them to an 8× grid:
that earlier treatment lost detail and damaged contours. The shop CSS also uses
pixelated image scaling.

`node scripts/art/install-shop-banner-art.cjs <master-directory>` validates all
six named PNG masters before exporting them at their catalog dimensions.
Generation sometimes returns a larger canvas than requested; check its actual
dimensions and prepare the medium master before running the importer. Completed preview exports are not retained in the repository. The installed lossless WebPs preserve the approved native pixels; keep any new editable source masters outside the public asset tree.
