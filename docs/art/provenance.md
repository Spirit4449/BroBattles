# Art prompt provenance

Historical source records consolidated on 2026-10-05. These quotations preserve generation prompts, source identifiers and extraction context, including superseded experiments. Words such as “current”, “final”, “now”, dimensions and test results describe the original record only. For installed behavior, use [the art guide](README.md) and current assets/catalogs. Absolute workstation paths and ignored output folders are provenance references, not required checkout files.

## body-art (historical)

> Installed at `public/assets/ninja/skins/ninja-arena-sovereign/body.webp`. Source, previous body, comparison, and exact prompt are in `output/body-art/king-revision/`.

> Built-in ImageGen repaired the clipped-looking viewer-left sleeve, purple hand, and flaring robe hem while retaining the hood, orange trim, staff and purple crystals. Installed as lossless native WebP at `public/assets/draven/body.webp`, with no palette reduction. Verified visible artwork has transparent margins on every side (209px left, 237px right, 76px top, 77px bottom on the 1254px square canvas). Source, before/after preview and exact prompt: `output/body-art/draven-repair/`.

## crystal-gloop-art (historical)

> Regular Gloop fall00–02 have been restored pixel-for-pixel from commit 676a62e. Duck and wall-slide revisions remain. Crystal falling poses were regenerated with built-in imagegen into public/assets/gloop/skins/gloop-amethyst/falling-source.png. Run node scripts/art/pack-crystal-falling.cjs to pack these into that skin's spritesheet.webp after a full atlas regeneration. One shared scale preserves the authored stretch: 38×44, 33×54, 37×46 visible pose rectangles inside the existing 128px frames. body.webp remains unchanged.

> Regeneration prompt:

> Assets: `public/assets/gloop/skins/gloop-amethyst/{ai-source.png,spritesheet.webp,body.webp}`.

> ## Generation prompt

> Use case: style-transfer. Create a production game animation spritesheet redesign of the attached Crystal Gloop. Transparent background, real alpha. Wide 3200x1280 canvas, exact evenly spaced 10 columns by 4 rows, one whole isolated character per cell with ample transparent gutters. All 40 cells occupied. Side-scroller orthographic view. Redesign as FACELESS amethyst purple gelatinous slime with LARGE sharply angular crystalline clusters growing out of its body, cyan and lilac facets, dark purple crisp outline, hand-pixeled game art, limited flat palette, NO fuzzy glow, no blur, no soft gradients, no eyes, no mouth, NO SMILEY FACE anywhere. Gooey low dome base with pointed geometric crystals; consistent identical crystal arrangement across frames. Row1: 10 subtle idle breathing frames. Row2: 10 squashing and stretching running/sliding cycle frames. Row3: first 5 ascending stretched jump frames then 5 squash landing frames. Row4: 10 attack windup then sideways slime extension to right and recovery frames. Each sprite centered in own cell horizontally and grounded near cell bottom. No grid lines no text no labels no floor shadow. Maintain clear large readable facets even at 48 pixels wide. This is replacement art: do not preserve fuzzy texture or face from reference.

> ## Transparency correction prompt

> Use case background-extraction. Keep this exact 10 column 4 row Crystal Gloop animation sheet and all 40 sprites unchanged, sharp details and faceless crystals. Remove the ENTIRE baked gray-and-white checkerboard background. Output real RGBA alpha transparency, NOT an illustration of a transparency checkerboard. Every background pixel between sprites must have alpha zero. Preserve original layout, character colors, shapes and crisp edges. NO checkerboard pixels in output, no backdrop, no shadow.

> The latest source is public/assets/gloop/movement-source.png, generated with built-in imagegen using the base and crystal body portraits as references. Both spritesheets use compact falling poses with small vertical changes, a moderately lowered duck dome, and a mildly compressed wall-contact pose. Portraits are unchanged.

> ### Final movement prompt

> Create corrected game animation poses from these two reference characters using very restrained deformation. 5 columns x 2 rows, ten separate small crisp pixel-art sprites with real transparent alpha background, no checkerboard pixels, ample gutters. TOP ROW reference1 base Gloop, faceless compact domed teal blob with blue core, same firm jelly shape. BOTTOM ROW reference2 Crystal Gloop, faceless broad purple rock-like jelly dome with intact cyan/amethyst crystal cluster. Preserve their dense solid compact body masses, do not turn them into water, no tails, no tendrils, no drips, no flames, no teardrops, no melting, no flexible crystals. Column1 falling onset: compact airborne rounded body, slightly rounded underside instead of flat grounded base, width roughly 1.2 times height. Column2 falling: same compact body, 5 percent vertical stretch, rounded underside, crystals retain rigid shape. Column3 falling: same with small 5 percent wobble, consistent size. Column4 duck: crouched compact broad dome, 25 percent shorter than standing, 8 percent wider, still substantial solid body volume, crystals retain their geometry and tuck down slightly, NOT a pancake or puddle. Column5 wall-slide: same compact domed blob mildly pressed against invisible wall on RIGHT, body only 15 percent narrower than normal with gently flattened right contact face and round left contour, about equal width and height, no tall sliver, no elongation, no drips, no tail, NO wall drawn. All whole characters centered in their cells at consistent scale. Crisp limited-palette pixel art matching original references, NO faces eyes mouths, no labels, no motion streaks, no glow, no blur.

## generated-reward-art (historical)

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-d2974df4-8678-4b74-a310-4bf9dfb3c776.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: a compact group of five overlapping currency pieces, arranged in a readable small pile with the front pieces face-on. The currency is coins. The attached original currency icon is the EXACT design reference. Keep the original plain golden coin face with curved pale highlight, orange center, yellow rim and near-black pixel outline. Absolutely NO star or emblem. Coins face the viewer, no thin side-on coins. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-2c6aad0d-e2ee-4cbd-8565-0686ab15f470.png`

> ### Final prompt

> Use case: stylized-concept. Create a simple pixel-art brown drawstring money bag overflowing with ROUND GOLD COINS. The attached image is a master coin sprite. Preserve its exact original gold colors, blank orange face, pale curved upper-left shine, yellow rim and dark outline. Treat each coin as a rigid physical circular disk, copying this original sprite and only rotating/tilting it in perspective. All upright coins must be CIRCLES, with wide rounded tops and bottoms, NEVER POINTED, no diamonds or football shapes. Coins tilted away become regular ellipses. Put three clear round coins across the bag opening with several partially overlapping tilted coins behind them; three natural circular coins spilled near the bag. Do not arrange a tall pointed central coin. Original hand-made chunky pixel-art style, moderate detail, brown bag with simple folds and cord. Compact balanced silhouette, transparent background with 3% padding. No symbols or stars on coins, no text, no frame, no ground, no glow.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-4b888cbb-6a06-4bb0-a915-fa17323e320b.png`

> ### Final prompt

> Use case: precise-object-edit. Correct ONLY the coins in the first image. Keep the container and composition. Second image is the original coin master. Each coin is a rigid ROUND DISC, NOT an egg, jewel, irregular blob, teardrop or polygon. Copy the second image's exact circular silhouette and internal face design; vary only scale, rigid rotation in 3D perspective and natural overlap. A tilted circular coin projects as a regular ellipse, never a pointed or lopsided shape. Front-facing coins must be true circles with equal width and height. Use fewer larger coins if needed for clarity. Each visible face has the same gold rim, orange center and upper-left pale curved highlight as the master; no emblems. Crisp original chunky pixel-art style. Correct the tall pointed top coin especially. Keep actual transparent background and full container outline. Small even 3% padding. No extra decoration.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-d56a5f37-02dd-4527-9615-f80372db8021.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: two open wooden treasure chests with simple gold trim, overflowing with currency, one slightly behind the other. The currency is coins. The attached original currency icon is the EXACT design reference. Keep the original plain golden coin face with curved pale highlight, orange center, yellow rim and near-black pixel outline. Absolutely NO star or emblem. Coins face the viewer, no thin side-on coins. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-ee713567-c5a4-4137-a4dd-bc4e5fc65037.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: one small wooden treasure handcart with two wheels, brimming with currency. The currency is coins. The attached original currency icon is the EXACT design reference. Keep the original plain golden coin face with curved pale highlight, orange center, yellow rim and near-black pixel outline. Absolutely NO star or emblem. Coins face the viewer, no thin side-on coins. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-517c4b75-899b-4698-845b-a7f351cc6341.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: a compact group of five overlapping currency pieces, arranged in a readable small pile with the front pieces face-on. The currency is gems. The attached original currency icon is the EXACT design reference. Keep the original blue diamond's relatively tall pointed silhouette, upper faceted crown and cyan/pale-blue facets and near-black pixel outline. Do not flatten or squash the gems. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-108b7c48-2158-4754-8452-06dc63c3b9f9.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: a simple brown cloth pouch overflowing with currency, three pieces spilling beside its base. The currency is gems. The attached original currency icon is the EXACT design reference. Keep the original blue diamond's relatively tall pointed silhouette, upper faceted crown and cyan/pale-blue facets and near-black pixel outline. Do not flatten or squash the gems. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-58f7795e-3944-4041-adb0-16527cc41dd8.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: one open wooden treasure chest with simple gold trim, overflowing with currency. The currency is gems. The attached original currency icon is the EXACT design reference. Keep the original blue diamond's relatively tall pointed silhouette, upper faceted crown and cyan/pale-blue facets and near-black pixel outline. Do not flatten or squash the gems. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-99b2ab37-a754-4832-8bda-690304a70d59.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: two open wooden treasure chests with simple gold trim, overflowing with currency, one slightly behind the other. The currency is gems. The attached original currency icon is the EXACT design reference. Keep the original blue diamond's relatively tall pointed silhouette, upper faceted crown and cyan/pale-blue facets and near-black pixel outline. Do not flatten or squash the gems. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-3da38637-8064-47fa-a7e3-5a5c6173f752.png`

> ### Final prompt

> Use case: stylized-concept. Create a production pixel-art game reward illustration: one small wooden treasure handcart with two wheels, brimming with currency. The currency is gems. The attached original currency icon is the EXACT design reference. Keep the original blue diamond's relatively tall pointed silhouette, upper faceted crown and cyan/pale-blue facets and near-black pixel outline. Do not flatten or squash the gems. Match the reference's chunky hand-made pixel-art language, moderate detail with large deliberate pixel clusters. Containers should be equally simple game sprites, no realistic texture or fine ornament. Currency must be prominent and instantly recognizable. Compact centered composition, all parts visible, real transparent alpha background, no white border, no opaque background or checkerboard, no ground plane, no lettering. Only 3% transparent padding around the complete object. Front-facing presentation with only enough depth to see the contents.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-d518ef66-424a-4fd9-a18a-e30e4b186c82.png`

> ### Final prompt

> Use case: stylized-concept. One unified pixel-art reward illustration of crossed blue and red capture flags and a small handful of gold coins. The ONLY currency in this illustration is GOLD COINS. Do not include ANY blue gems, diamonds, trophy badges or extra reward objects. The attached original coin is the exact master: blank orange-gold center, yellow rim, pale curved highlight, near-black pixel outline. Every coin is a rigid circular disk, only its perspective and overlap vary; tilted coins are regular ellipses, not pointed diamonds or distorted shapes. Match the original chunky pixel art with moderate detail. Single compact overlapping composition. Real transparent background, no checkerboard, no white fringe, all objects visible with 3% padding.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-115423eb-4d81-436f-a123-9ed43581aa22.png`

> ### Final prompt

> Use case: stylized-concept. One unified pixel-art reward illustration of a compact open bank safe with gold coins spilling out. The ONLY currency in this illustration is GOLD COINS. Do not include ANY blue gems, diamonds, trophy badges or extra reward objects. The attached original coin is the exact master: blank orange-gold center, yellow rim, pale curved highlight, near-black pixel outline. Every coin is a rigid circular disk, only its perspective and overlap vary; tilted coins are regular ellipses, not pointed diamonds or distorted shapes. Match the original chunky pixel art with moderate detail. Single compact overlapping composition. Real transparent background, no checkerboard, no white fringe, all objects visible with 3% padding.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-bfa12b45-fcbf-4b59-9852-4eb6773c8fc5.png`

> ### Final prompt

> Use case: stylized-concept. One unified pixel-art reward illustration of a blue supply crate under a small cream parachute with gold coins at its base. The ONLY currency in this illustration is GOLD COINS. Do not include ANY blue gems, diamonds, trophy badges or extra reward objects. The attached original coin is the exact master: blank orange-gold center, yellow rim, pale curved highlight, near-black pixel outline. Every coin is a rigid circular disk, only its perspective and overlap vary; tilted coins are regular ellipses, not pointed diamonds or distorted shapes. Match the original chunky pixel art with moderate detail. Single compact overlapping composition. Real transparent background, no checkerboard, no white fringe, all objects visible with 3% padding.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-2b96376d-f0e9-4956-87ce-d9248a6122d8.png`

> ### Final prompt

> Use case: stylized-concept. One unified pixel-art reward illustration of a black-and-white soccer ball in front of a small goal and a short pile of gold coins. The ONLY currency in this illustration is GOLD COINS. Do not include ANY blue gems, diamonds, trophy badges or extra reward objects. The attached original coin is the exact master: blank orange-gold center, yellow rim, pale curved highlight, near-black pixel outline. Every coin is a rigid circular disk, only its perspective and overlap vary; tilted coins are regular ellipses, not pointed diamonds or distorted shapes. Match the original chunky pixel art with moderate detail. Single compact overlapping composition. Real transparent background, no checkerboard, no white fringe, all objects visible with 3% padding.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-e69fd30d-0e49-42ee-896d-d86b6f654d11.png`

> ### Final prompt

> Use case: stylized-concept. One unified pixel-art reward illustration of a red covered wooden bed, a simple shield and sword, and two short piles of gold coins. The ONLY currency in this illustration is GOLD COINS. Do not include ANY blue gems, diamonds, trophy badges or extra reward objects. The attached original coin is the exact master: blank orange-gold center, yellow rim, pale curved highlight, near-black pixel outline. Every coin is a rigid circular disk, only its perspective and overlap vary; tilted coins are regular ellipses, not pointed diamonds or distorted shapes. Match the original chunky pixel art with moderate detail. Single compact overlapping composition. Real transparent background, no checkerboard, no white fringe, all objects visible with 3% padding.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-86f0de66-a183-4b87-aa33-74da426a9e15.png`

> ### Final prompt

> Use case: compositing. Generate a cohesive trophy reward bundle illustration. Feature the attached 500 trophy profile badge, large, upright and unchanged with its number legible, surrounded at its base by a small pile of coins and three gems. Preserve the badge's actual design; make a compact triangular composition with badge at the rear and treasures overlapping its lower edge. Currency references are first two images, badge is third. Use the attached original currency designs EXACTLY: plain orange-gold coin face with yellow rim, curved pale highlight, dark pixel outline, NO stars or emblem; blue diamonds with the original tall pointed proportions and original large cyan-blue facets, NEVER squashed. Consistent moderately detailed chunky pixel game art, large clean pixel clusters, no realistic textures or intricate ornament. Unified overlapping still-life, not a grid or separate reward tiles. All objects completely visible and tightly framed with 3% transparent padding. Real transparent alpha background, no checkerboard, no ground plane or rectangle, no outside text, no white fringe.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-58e6ab9f-9578-4178-aab7-b82783a7339d.png`

> ### Final prompt

> Use case: compositing. Generate a cohesive trophy reward bundle illustration. Feature the attached 1000 trophy profile badge, large, upright and unchanged with its number legible, surrounded at its base by an overflowing coin pouch and a small pile of gems. Preserve the badge's actual design; make a compact triangular composition with badge at the rear and treasures overlapping its lower edge. Currency references are first two images, badge is third. Use the attached original currency designs EXACTLY: plain orange-gold coin face with yellow rim, curved pale highlight, dark pixel outline, NO stars or emblem; blue diamonds with the original tall pointed proportions and original large cyan-blue facets, NEVER squashed. Consistent moderately detailed chunky pixel game art, large clean pixel clusters, no realistic textures or intricate ornament. Unified overlapping still-life, not a grid or separate reward tiles. All objects completely visible and tightly framed with 3% transparent padding. Real transparent alpha background, no checkerboard, no ground plane or rectangle, no outside text, no white fringe.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-78a0dd09-de9d-4207-ae47-a206116b947b.png`

> ### Final prompt

> Use case: compositing. Generate a cohesive trophy reward bundle illustration. Feature the attached 5000 trophy profile badge, large, upright and unchanged with its number legible, surrounded at its base by an open chest of coins and an overflowing gem pouch. Preserve the badge's actual design; make a compact triangular composition with badge at the rear and treasures overlapping its lower edge. Currency references are first two images, badge is third. Use the attached original currency designs EXACTLY: plain orange-gold coin face with yellow rim, curved pale highlight, dark pixel outline, NO stars or emblem; blue diamonds with the original tall pointed proportions and original large cyan-blue facets, NEVER squashed. Consistent moderately detailed chunky pixel game art, large clean pixel clusters, no realistic textures or intricate ornament. Unified overlapping still-life, not a grid or separate reward tiles. All objects completely visible and tightly framed with 3% transparent padding. Real transparent alpha background, no checkerboard, no ground plane or rectangle, no outside text, no white fringe.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-fcfb65fe-562c-438a-8bef-0c9e28a68b2e.png`

> ### Final prompt

> Use case: compositing. Generate a cohesive trophy reward bundle illustration. Feature the attached 7500 trophy profile badge, large, upright and unchanged with its number legible, surrounded at its base by two small open treasure chests holding coins and gems. Preserve the badge's actual design; make a compact triangular composition with badge at the rear and treasures overlapping its lower edge. Currency references are first two images, badge is third. Use the attached original currency designs EXACTLY: plain orange-gold coin face with yellow rim, curved pale highlight, dark pixel outline, NO stars or emblem; blue diamonds with the original tall pointed proportions and original large cyan-blue facets, NEVER squashed. Consistent moderately detailed chunky pixel game art, large clean pixel clusters, no realistic textures or intricate ornament. Unified overlapping still-life, not a grid or separate reward tiles. All objects completely visible and tightly framed with 3% transparent padding. Real transparent alpha background, no checkerboard, no ground plane or rectangle, no outside text, no white fringe.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-f6a4a25c-734b-4998-801a-0d1a87978413.png`

> ### Final prompt

> Use case: compositing. One special cohesive finale reward illustration. Show the provided crowned royal Ninja standing proudly in the foreground, the provided ornate royal player card upright behind him, the supplied 10,000 trophy badge to his left, and one open treasure chest of golden coins and blue gems at their feet. Exactly these five reward types, all recognizable, Ninja crown and purple cape match his supplied portrait. First two references are currency, third is badge, fourth Ninja, fifth royal card. Preserve these identities and the badge's exact number. Compact balanced trophy bundle silhouette. Use the attached original currency designs EXACTLY: plain orange-gold coin face with yellow rim, curved pale highlight, dark pixel outline, NO stars or emblem; blue diamonds with the original tall pointed proportions and original large cyan-blue facets, NEVER squashed. Consistent moderately detailed chunky pixel game art, large clean pixel clusters, no realistic textures or intricate ornament. Unified overlapping still-life, not a grid or separate reward tiles. All objects completely visible and tightly framed with 3% transparent padding. Real transparent alpha background, no checkerboard, no ground plane or rectangle, no outside text, no white fringe.

## king-skin-art (historical)

> Generated with the built-in imagegen tool using the user's king reference. Source: `public/assets/ninja/skins/ninja-arena-sovereign/ai-source.png`.

> Prompt: create a crisp limited-palette pixel-art king with dark hair and beard, visible face, jeweled gold crown, black outfit, gold jewelry and boots, and crimson cape with white ermine trim. Six columns by six rows, 34 isolated poses, consistent size, right-facing. Five idle, three falling, seven running, one wall-slide, nine jumping/somersault/landing, five dying, four throwing poses; final two cells empty. Large clear gaps, complete uncropped silhouettes, no labels, shadows or detached effects.

> Background refinement prompt: replace the generated checkerboard with uniform #FF00FF, preserving all poses and positions. The importer keys out this reserved background color.

> Built-in imagegen produced `action-source.png`: a 4×2 sheet containing three consistent upright, feet-down falling poses with lifted cape; four crown-removal/throw/followthrough/recovery poses with uncovered hair after removal; and a separate jeweled crown. Prompt required the same bearded king identity, right-facing poses, consistent scale, complete silhouettes, wide gaps and solid #FF00FF background. These replace only falling00–02 and throw00–03; crown.webp uses the base projectile's 237×237 canvas. Skin weapon loading and both ninja render paths use the crown, including trails and swarm attacks, without changing combat tuning.

> Built-in imagegen produced `portrait-source.png`: a single detailed full-body pixel-art portrait, three-quarter right-facing guard stance, dark swept hair and beard, jeweled crown, black tunic, gold chains/medallions/bracers/boots, red sash and crimson ermine cape, sharp pixel clusters, complete silhouette, solid #FF00FF backdrop. `body.webp` now preserves its native 1254×1254 detail. The packer no longer derives portraits from gameplay frames.

> Supersedes the adult-proportioned portrait above. Built-in imagegen reference: `ai-source.png`, specifically its top-left idle king ninja. Prompt: preserve that exact short chibi silhouette, oversized head, compact beard, simple angular eyes, low wide jeweled crown, small fists, black ninja outfit, gold chains, short boots and crimson ermine cape. Keep the idle pose and orientation; no adult anatomy, ornate lion armor, realistic hair strands or added accessories. Authentic coarse pixel art, hard staircase contours, limited-tone shading, no smoothing, solid magenta background.

> Built-in imagegen prompt for `motion-source.png`: match the existing chibi king; four subtly changing upright falling poses with fixed head/body/feet positions and gently moving cape/wrists; isolated jeweled crowns rotating around the vertical Y axis with tips always upright; crouched king with crown low over his eyes, visible black torso, bent arms and legs, gold boots and bunched crimson cape. Strict spaced 4×3 grid, crisp pixels, complete silhouettes, no labels/shadows. The generated alpha is retained with binary pixel edges during packing.

## level-badge-art (historical)

> ## Active v5 refinement prompt

> Use case: precise-object-edit
> Asset type: production pixel-art sprite atlas for every character-level display in Bro Battles
> Input image: `badges-v4.png`
> Primary request: Preserve the exact canvas, alpha, layout, and levels 1 and 3–10. Widen only level 2 by roughly 10–12 percent so its opaque footprint and visual weight match level 1 within about 5 percent, while keeping it compact and avoiding the earlier wide-banner shape. Preserve its burnt-orange/copper palette, two rivets, ivory numeral, stepped outline, pointed bottom, coarse pixel clusters, and centered position. Keep the silhouette clean with no detached pixels, noise, glow, blur, gradients, labels, backgrounds, antialiasing, or extra ornaments.

> ## Active v4 refinement prompt

> Use case: precise-object-edit and style-transfer
> Asset type: production pixel-art sprite atlas for every character-level display in Bro Battles
> Input images: `badges-v3.png` is the edit target; the original level 9 badge is the infernal-rank reference.
> Primary request: Preserve levels 1, 3, 4, 5, 6, 7, 8, and 10. Narrow level 2 to the compact footprint of levels 1 and 3 while retaining its burnt-orange shield, top bar, rivets, number, and centered cell position. Rebuild level 9 as a compact obsidian/deep-violet demon shield inspired by the original infernal badge, with two restrained horns and a crown of purple fire made from large hard pixel clusters. Use violet, magenta, lavender, and limited gold structure; no orange or red fire, wings, particles, haze, soft glow, gradients, antialiasing, or microdetail. Remove every detached dash, speck, and compression-like mark below or around all badges. Preserve the exact 5-by-2 layout, dimensions, alpha, spacing, and number placement.

> ## Active v3 generation prompt

> Use case: style-transfer
> Asset type: production pixel-art sprite atlas for every character-level display in Bro Battles
> Input images: Image 1 is the atlas to redesign. Images 2 and 3 are old badge references for ceremonial detail and progression energy.
> Primary request: Rebuild all ten badges so adjacent levels are immediately distinguishable by BOTH dominant color and silhouette. Preserve the clean chunky pixel style and readable ivory numbers, but eliminate repeated gold-shield variants.
> Composition: exactly 5 columns by 2 rows, equal square cells, reading order 1–5 top row and 6–10 bottom row. One centered badge per cell with identical center position and generous transparent padding. Keep every badge fully inside its cell.
> Required distinct progression:
> 1: compact round-bottom COPPER/BROWN buckler, one square top rivet, no side ornament.
> 2: wider BURNT-ORANGE/BRASS shield, two side rivets and a flat top bar.
> 3: pointed FOREST-GREEN/BRONZE shield with a small upward leaf crest and a single lower chevron.
> 4: angular COBALT-BLUE/SILVER kite shield with square shoulder plates, no gems and no ribbons.
> 5: CRIMSON-RED/GOLD shield with one ruby crown point and two short red banner tails.
> 6: icy CYAN/WHITE-SILVER diamond-bottom shield, one sapphire, compact horizontal ice fins; it must not use a gold body, ribbon tails, or feather wings.
> 7: deep MAGENTA/ROSE-GOLD shield with a three-point crown and split magenta pennant; no blue gem.
> 8: bright EMERALD-GREEN/GOLD shield with a round jade gem and a compact laurel branch on each side; no wings, no banner tails, no blue.
> 9: OBSIDIAN-BLACK/VIOLET shield with a tall amethyst spire, thin gold rim, and two short upward horn-like prongs; absolutely no side wings.
> 10: ROYAL-PURPLE/WHITE-GOLD champion shield with a gold crown, large central purple diamond, and unmistakable compact white wing fans with exactly three feathers per side.
> Style/medium: authentic chunky low-resolution 16-bit pixel art, hard pixel clusters, 3–4 shading bands, thick near-black stepped outlines, no antialiasing.
> Text: exact central numbers “1”, “2”, “3”, “4”, “5”, “6”, “7”, “8”, “9”, “10”; no word LEVEL and no other text.
> Constraints: central number is always dominant; each badge is recognizable at 48px; decorations grow gradually; levels 6, 8, 9, and 10 must have clearly different palettes and outer silhouettes; real alpha transparency.
> Avoid: repeated gold shields, similar purple badges for 9 and 10, similar winged badges for 6 and 8, glow, gradients, particles, dangling crystals, halos, excessive jewelry, smooth vector edges, tiny noise, casino styling.

> ## v2 generation prompt

> Use case: style-transfer
> Asset type: production pixel-art sprite atlas for the Bro Battles character-level UI
> Input images: the 5-by-2 badge atlas is the edit target; the separate old level 1, 5, and 10 badges are style references for the decorative progression only.
> Primary request: Redesign the ten badges in the atlas so every level gains a little more ceremonial decoration than the last, inspired by the old badges, while remaining compact, readable, and restrained.
> Composition: keep exactly 5 columns by 2 rows, equal square cells, reading order 1–5 on top and 6–10 beneath. Keep all badge centers, number positions, scale, transparent padding, and cell boundaries consistent. Each complete badge must stay entirely inside its cell.
> Style: authentic chunky low-resolution pixel art, hard pixel clusters, thick near-black stepped outlines, limited palette, no antialiasing, no gradients, no blur, no glow. The central ivory number remains the largest and clearest feature.
> Progression:
> 1 plain bronze shield with one top rivet.
> 2 bronze shield with paired studs.
> 3 bronze with a small top crest and tiny lower point.
> 4 silver rim with subtle corner plates.
> 5 silver/gold transition with a centered ruby and two short red ribbon tips.
> 6 silver-and-gold shield with one sapphire and small shoulder fins.
> 7 gold shield with a ruby, short split banner tails, and a modest three-point crest.
> 8 gold shield with small upward feather tabs and two gems.
> 9 gold-and-purple elite shield with a purple gem, compact crown crest, and short silver feather fans.
> 10 champion shield with purple center, crown, central purple gem, and compact white wing fans inspired by the old level 10, but with only 3 feathers per side and no halo, dangling gems, floating crystals, or long spikes.
> Constraints: one badge per cell; exact numbers 1,2,3,4,5,6,7,8,9,10; genuine alpha transparency around every badge; consistent footprint and visual weight; max decorations may extend only about 12% beyond the base shield. No word LEVEL and no other text. Avoid casino shine, excessive jewelry, particle effects, tiny noisy details, smooth vector edges, or ornamental clutter.

> ## Original v1 generation prompt

> Use case: stylized-concept. Asset type: ONE production sprite atlas of ten level badge icons for the pixel-art game Bro Battles.
> Create a transparent PNG sheet, exactly 5 columns by 2 rows of equal square cells, no margins between cells, all icons centered identically in their cells, ample transparent padding within cells. Order left to right: levels 1,2,3,4,5 then 6,7,8,9,10.
> Each badge is a compact broad heraldic shield with a large clear ivory pixel number in the center. No word LEVEL, no other text. Same shield body size and number position across all ten. Thick near-black stepped outlines, very chunky authentic low-resolution pixel art, each badge looks drawn on a 48x48 pixel canvas with a limited 12-color palette and hard pixel clusters. Flat two-tone metal shading, no fine detail, no gradients, no blur, no glow, no smooth vector edges.
> Progression: 1 plain warm bronze shield, 2 bronze with small rivets, 3 bronze with a small top stud; 4 brushed silver rim navy center, 5 silver with small side tabs, 6 silver with single blue top gem; 7 gold rim dark burgundy center, 8 gold with small shoulder fins, 9 gold rim violet center single purple gem, 10 gold violet champion shield with a small three-point crown and two short silver winglets. All restrained, compact, equal visual weight, no halos, no dangling crystals, no tall spikes, no oversized wings. Numbers 1 through 10 are the dominant feature. Each occupies about 70% cell height, max-level decorations fit inside same bounds. Real alpha transparency around every badge. This should feel like collectible equipment from a polished 16-bit RPG, charming and tactile, never mobile casino ornament.

## natural-currency-art (historical)

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-bcfd6695-5cf6-46de-bf92-8160c0b1f293.png`

> Prompt: Use case: stylized-concept. Original pixel-art game currency reward illustration: a short stack of four gold coins lying flat, plus one coin leaning naturally against the stack so its face is visible. Show the thin disk edges of the stacked coins, like an actual little coin stack, not five upright medallions. The attached original coin is the design master: preserve its colors, chunky dark outline, internal face details, and recognizable shape. Rigid circular gold disks with a plain orange center, yellow rim and pale curved shine. No star or symbol. Only change rigid perspective: circles become regular ellipses when tilted, never diamonds or irregular blobs. Match the original chunky hand-made pixel-art style, moderate detail and large clean pixel clusters. Cohesive compact natural composition, entire object visible with 3% transparent padding. Real transparent alpha background. No ground plane, no texture noise, no background, no white fringe, no lettering or watermark, no external glow.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-e6c8c6eb-4356-47da-a246-78330d669fe5.png`

> Prompt: Use case: background-extraction. Preserve the exact pixel-art objects and composition in this image. Remove ALL external glow, shadow haze, gray smudges and backdrop surrounding the objects. Everything outside the hard dark pixel outlines must be fully transparent alpha, including the spaces between objects. Do not change the colors or shapes inside the artwork. No added elements. Full object visible with tight 3% transparent padding. Return a clean game sprite cutout.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-d543f0ea-220a-44e2-be3c-9c74781541f0.png`

> Prompt: Use case: precise-object-edit. Change ONLY this bag's upper opening and currency arrangement. The mouth in this draft is still MUCH too wide. Shrink the entire mouth and rolled collar to 35 PERCENT of the plump body width, centered above the bag. Replace the old wide collar's left/right areas with gently sloping cloth shoulders leading up from the body to the tiny gathered neck. The neck should look softly cinched, not a wide bowl. Currency at the opening must be SMALL pieces tucked partly inside it, with a couple spilling over naturally; no giant upright coin above the opening. Keep the original currency design, rigid shape and simple pixel art. Keep the rounded lower body and naturally scattered currency at its base. Genuine transparent background, no glow or shadows outside silhouette, full object with 3% margins. This is a visibly smaller neck and mouth, not a color change.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-b5195981-eca0-441d-a446-02bec8307804.png`

> Prompt: Use case: stylized-concept. Original pixel-art game currency reward illustration: one simple open wooden treasure chest filled with a low dense pile of many small gold coins. Coins lie and overlap naturally inside it, showing thin circular disk edges at different angles, with a few coins and one short stack spilling beside the chest. No enormous upright coins arranged like flowers. The attached original coin is the design master: preserve its colors, chunky dark outline, internal face details, and recognizable shape. Rigid circular gold disks with a plain orange center, yellow rim and pale curved shine. No star or symbol. Only change rigid perspective: circles become regular ellipses when tilted, never diamonds or irregular blobs. Match the original chunky hand-made pixel-art style, moderate detail and large clean pixel clusters. Cohesive compact natural composition, entire object visible with 3% transparent padding. Real transparent alpha background. No ground plane, no texture noise, no background, no white fringe, no lettering or watermark, no external glow.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-cd5909a0-67cc-4d17-93d3-ca7b60ce10ec.png`

> Prompt: Use case: stylized-concept. Original pixel-art game currency reward illustration: a small natural cluster of three blue diamond gemstones resting together, one upright at a slight angle and two lying tilted against it. Natural overlap and depth, not three copies lined up facing the camera. The attached original gem is the design master: preserve its colors, chunky dark outline, internal face details, and recognizable shape. Preserve the original cyan-blue diamond cut and tall pointed lower half; only rotate in perspective, never squash or warp. Match the original chunky hand-made pixel-art style, moderate detail and large clean pixel clusters. Cohesive compact natural composition, entire object visible with 3% transparent padding. Real transparent alpha background. No ground plane, no texture noise, no background, no white fringe, no lettering or watermark, no external glow.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-d8e9c3fa-9a04-4715-a3af-f511ad10db71.png`

> Prompt: Use case: stylized-concept. Original pixel-art game currency reward illustration: a low natural treasure mound of about twelve blue diamond gemstones, scattered and overlapping under gravity at varied believable angles. A few front facets face the viewer and other gems show tilted facets. Not a bouquet or symmetrical fan of giant diamonds. The attached original gem is the design master: preserve its colors, chunky dark outline, internal face details, and recognizable shape. Preserve the original cyan-blue diamond cut and tall pointed lower half; only rotate in perspective, never squash or warp. Match the original chunky hand-made pixel-art style, moderate detail and large clean pixel clusters. Cohesive compact natural composition, entire object visible with 3% transparent padding. Real transparent alpha background. No ground plane, no texture noise, no background, no white fringe, no lettering or watermark, no external glow.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-fb35e2a2-5641-4d05-8e97-e0642f9b2a8c.png`

> Prompt: Use case: precise-object-edit. Change ONLY this bag's upper opening and currency arrangement. The mouth in this draft is still MUCH too wide. Shrink the entire mouth and rolled collar to 35 PERCENT of the plump body width, centered above the bag. Replace the old wide collar's left/right areas with gently sloping cloth shoulders leading up from the body to the tiny gathered neck. The neck should look softly cinched, not a wide bowl. Currency at the opening must be SMALL pieces tucked partly inside it, with a couple spilling over naturally; no giant upright gem above the opening. Keep the original currency design, rigid shape and simple pixel art. Keep the rounded lower body and naturally scattered currency at its base. Genuine transparent background, no glow or shadows outside silhouette, full object with 3% margins. This is a visibly smaller neck and mouth, not a color change.

> Source: `/Users/nisch/.codex/generated_images/01a0a30e-5ab7-7081-8524-b1ac791ebf87/exec-9d5df4e1-b62a-4dc3-976e-651f67cd653f.png`

> Prompt: Use case: stylized-concept. Original pixel-art game currency reward illustration: one simple open wooden treasure chest filled with many small blue diamond gemstones naturally resting against one another, in a low dense mound. Show varied believable perspective while preserving the original gem shape, a few loose gems spilled beside it. No oversized gems lined up like flowers. The attached original gem is the design master: preserve its colors, chunky dark outline, internal face details, and recognizable shape. Preserve the original cyan-blue diamond cut and tall pointed lower half; only rotate in perspective, never squash or warp. Match the original chunky hand-made pixel-art style, moderate detail and large clean pixel clusters. Cohesive compact natural composition, entire object visible with 3% transparent padding. Real transparent alpha background. No ground plane, no texture noise, no background, no white fringe, no lettering or watermark, no external glow.

## site-art (historical)

> Landscape assets also have 800 × 450 variants. About uses responsive `picture`
> and `srcset` selection; its map showcase uses the smaller export. The revised
> Lushy Home background uses its
> native dimensions and lossless WebP on desktop and mobile, preserving every
> generated pixel without downsampling. Its exact prompt and source are recorded
> in `output/site-art/home-revision.json`. News and mode covers retain their 4:3 framing. Existing mode
> covers, fighter portraits and support category icons remain the canonical art.
> Legal pages retain their reading layout.

> Exact prompts, generation source paths, export settings and layout screenshots
> are saved in `output/site-art/`. Run `export.py` there with Pillow to reproduce
> the original exports from the retained generation sources. Original exports use
> nearest-neighbor resizing and WebP quality 94, with no smoothing or palette
> reduction. The Lushy revision is exported separately at native size with lossless
> WebP; it is not processed by `export.py`.

## team-combat-art (historical)

> Each WebP has a matching JSON atlas. Original source assets remain available. Generated RGBA masters and exact final prompts are saved in `output/team-combat-art/manifest.json` and the adjacent `*-source.png` files. `scripts/art/pack-team-combat-art.py` performs mechanical cell extraction and nearest-neighbor packing with Pillow, retaining genuine alpha. The wizard uses 32 named cells: four ignition drawings held across 16 startup cells, then 12 looping drawings sampled across 16 flight cells. Draven explosion has 12 frames and special has 16.

## thorg-art (historical)

> The approved green-background concepts are now installed as `duck00` and
> `sliding00`, replacing the old held poses. Reproducible lossless masters live in
> `public/assets/thorg/sources/duck-green.webp` and `wall-slide-green.webp`.
> The importer removes green and uses nearest-neighbor scales 52/540 and 52/490,
> respectively, matching idle's approximately 52-pixel horn span rather than
> fitting the complete silhouettes to a box. Visible heights are 82 and 104 source
> pixels; both end at y=118 on the 128-pixel logical canvas. The body scale stays
> 0.7. All other atlas frames were verified pixel-identical. Review:
> `output/thorg-held-install/size-comparison.png`.

> New duck and wall-slide concept candidates are saved under
> `output/thorg-pose-concepts/` as `duck-green.png` and `wall-slide-green.png`.
> They were regenerated from the supplied concepts and canonical body reference
> with the built-in image-generation tool, then corrected to opaque green
> backgrounds. The wall-slide mace has a straight handle, aligned studded head,
> and visible pommel. Exact prompts are in that directory's `prompts.md`.
> These are concept deliverables; installed duck/wall sprites are unchanged.

> Prompt directions: low kneel on BOTH knees, hips seated back onto heels,
> broad chest leaning forward, mace low across lap; wall pose with two distinct
> short boots, both soles vertical and aligned against the same implied wall,
> one hand gripping the mace and the other bracing near shoulder height.
> Both prompts requested the reference's darker brown-tan skin, muscular build,
> unchanged identity, coarse pixel art, and a transparent background.

> Kneel prompt:
> > Regenerate this exact pixel-art Thorg in a low ONE-KNEE KNEEL: one knee rests on the ground, the other boot is planted ahead. Keep his standing-reference head size, wide muscular chest, thick shoulders and thick short limbs; lowering comes from kneeling, not shrinking his body. Hold the same mace across his front with bent arms. Match his neutral face, helmet, beard, outfit, colors and coarse square pixels. Single complete game sprite on transparent background with clear margins.

> Wall-pose prompt:
> > Regenerate this exact pixel-art Thorg in a compact wall-jump ready pose, facing slightly right. Keep his broad powerful chest and thick shoulders the SAME size as the reference. Bend his short thick legs close beneath his hips with boots toward an implied wall on his right; keep both elbows bent close to his body, one hand holding the same mace across his front and the free palm close beside his shoulder. Match the reference's normal small hands, short boots, neutral face, helmet, beard, outfit, colors and coarse square pixels. Full sprite on transparent background; the wall is not drawn.

> Generation source: `/Users/nisch/.codex/generated_images/01a0726d-e466-7920-ab72-00a74de78d39/exec-5fd4b3ec-c631-481f-a1d6-41e645c13657.png`.

> Exact prompt:

> Source: `/Users/nisch/.codex/generated_images/01a0726d-e466-7920-ab72-00a74de78d39/exec-7ac7fee4-95b3-4796-b94c-a71f4f582b8c.png`.

> Exact expansion prompt:

> Source: `/Users/nisch/.codex/generated_images/01a0726d-e466-7920-ab72-00a74de78d39/exec-e0b1ba98-4193-4f75-b9a1-5cb622fd50a2.png`.

> Exact prompt:

> The built-in ImageGen tool replaced `public/assets/thorg/weapon.webp` with a narrow leather-handled iron mace. Source: `/Users/nisch/.codex/generated_images/01a08496-7414-7f21-a345-42e71c29025c/exec-d12ab3ce-8564-4c35-a7d6-3b845b106723.png`. Sharp trims transparent margins and samples to 25×101 with nearest-neighbor filtering, preserving alpha. The held base weapon renders at 20×71; legacy skin weapon widths remain unchanged.

> Exact generation prompt:

> The next built-in ImageGen revision replaces `public/assets/thorg/weapon.webp` with a 36×101 transparent sprite, rendered 26×71 when carried. Its head occupies roughly two thirds of the length, with a shorter leather hilt. The first result included a painted checkerboard; a second ImageGen background-extraction call produced real transparency. Final source: `/Users/nisch/.codex/generated_images/01a08496-7414-7f21-a345-42e71c29025c/exec-178f1df9-53b3-416a-a7d7-9d6efa5eecb9.png`.

> Weapon prompt:

> Background-extraction prompt:

> The five attack frames in `public/assets/thorg/spritesheet.webp` use generated forearm motion. Generated cells were cropped, scaled with nearest-neighbor sampling to 105px character height, aligned by helmet center and baseline, and only source rows 55–93 of each attack cell were replaced. Other animations and the original attack heads and legs are unchanged. Source: `/Users/nisch/.codex/generated_images/01a08496-7414-7f21-a345-42e71c29025c/exec-918ea145-9213-4f21-a4b3-b5b8a4ca9f2f.png`.

> Attack artwork prompt:

> Created with the built-in ImageGen tool using idle00 as the identity reference. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-03593d3c-14d1-4c2c-8553-acbc433b843f.png`.

> Prompt: Create six equal-cell pixel-art death/collapse poses, three columns by two rows, of the reference stocky orange-bearded Viking with dark horned helmet, bare muscular arms and brown leather costume. Progress from upright recoil to buckling knees, kneeling slump, sideways fall, lying on side, and settled motionless with closed eyes. Preserve identity and proportions. Transparent alpha background, no weapon, blood, effects, labels, grid or clipped body parts. Keep each grounded pose on a consistent baseline.

> Built-in ImageGen generated the rotating head; mechanical preparation removed the checkerboard, normalized the cells and preserved the original upper 34px handle. The terminal head cap is slightly rounded with small spikes. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-78cf1ee6-f959-454a-aca6-47bf4987aa45.png`.

> Prompt: Eight evenly spaced axial rotational views of the reference dark steel cylindrical studded mace, four columns by two rows. Preserve brown wrapped handle, proportions, colors and pixel art. Keep handle upward and heavy head downward in every cell. Add only an extremely subtle rounded bulge with small spikes at the terminal end of the heavy head, at most five percent wider; no large ball or redesign. Same size and alignment throughout, no end-over-end rotation, labels, shadows or clipped parts; transparent background.

> Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-2c515073-bc22-4008-bec1-99ba42d1a76a.png`. Only selected arm pixels were used; the generated full image is not the atlas.

> Prompt: Edit the exact five-cell reference strip, preserving original identity, texture, head, torso, belt, legs, boots and forward facing. Change only forearms and closed gripping hands at waist height, moving from viewer-right through center to viewer-left and back, with natural bent elbows and thumb around curled fingers. No body rotation, back views, redesign, weapon or enlarged fists. Original slate background.

> Neck/shoulder correction: restored the original 400ms strike timing. A targeted built-in ImageGen neck/shoulder repair was composited only into rows 48–70 of the five attack cells; hands and lower-body pixels below that band remain unchanged. Prompt: Repair only cut-off neck/shoulder/head-to-body joins of the exact five-frame strip, reconnecting behind the beard with coherent outlines and pixel shading; preserve helmet, face, beard silhouette, poses, hands, legs and original identity. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-ab815f85-7445-4ab7-8b50-f7283d6b4282.png`.

> Built-in ImageGen source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-7f081d1a-e7e9-4af1-9403-a47fdd3bac4e.png`. Prompt: Regenerate five complete cohesive pixel-art attack sprites matching the original idle Thorg identity, helmet, orange beard, muscular proportions and detailed textured style. Natural connected neck/shoulders, front-facing body throughout, planted legs. Closed hands sweep at waist from right through middle toward left and recover; no full-body spin, weapon, effects or labels. Same scale and grounded baseline, transparent background.

> Attack and dying frames were generated together using the original idle identity, then mapped to a 48-color palette sampled from idle00 with nearest-neighbor resizing. Grounded death poses retain approximately the upright character's length instead of shrinking to fit a short bounding-box height. All frames remain in their existing atlas cells. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-e1931d35-f856-410b-abc9-9ec129633267.png` (built-in ImageGen).

> Prompt: Match exact Thorg reference, dark warm tan skin, orange/brown beard, charcoal horned helmet, muscular body and brown leather. Hard pixel clusters and restrained dark palette, no smooth gradients. Six front-facing waist-level arm sweep poses and six recoil-to-ground death poses; consistent helmet size and body mass, corpse length equals standing height. No body spin, weapons, effects, shadows or labels.

> Prompts: edit wall pose to pull both knees and elbows toward the torso, bring
> chest close to wall, keep both soles and palm on one wall plane, and restore
> idle-reference full mace head and handle length held upright. Edit duck only
> to restore full idle-reference mace length horizontally across lap, extending
> beyond knees, preserving both-knee kneel and identity. Both calls used the
> installed pose as edit target and extracted idle as weapon/identity reference.

> Duck prompt: preserve the earlier both-knee pose completely and enlarge only
> the mace to match idle's cylindrical studded design, extending beyond the right
> knee at its current shallow diagonal. Wall prompt: three-quarter wall-slide
> with two separated small boots on one vertical wall plane, muscular torso,
> original full diagonal mace and reference identity. Follow-up: bend both knees,
> shorten the boot silhouette and bend the bracing elbow while preserving the
> head, chest, shoulders, weapon and gripping hand. Transparent coarse pixel art.

> Prompt directions: image 1 defines exact idle identity/style/weapon, image 2
> is pose concept only; tightly crunched silhouette with folded elbows, hands
> in front and short boots tucked below chest. Duck edit preserves low kneel and
> corrects only weapon/gripping fingers; final correction specifies a perfectly
> horizontal pommel, shaft, collar and cylindrical head on one straight axis.

> Sources and comparison: `output/thorg-palette-refinement`. Duck source:
> `exec-c02a9d60-04ae-426a-aea5-da4fe14c1841.png`; wall source:
> `exec-1594a6ec-3a61-4f58-ad74-aab9a6724f1d.png`.
> Installed in `public/assets/thorg/duck.webp`, `wall-slide.webp`, and only their
> atlas cells. Nearest-neighbor scales remain 0.127 and 0.105 respectively,
> with baseline 118 and 192x128 transparent canvases. Visible heights: duck 86,
> slide 92 pixels. All other atlas pixels were verified unchanged.

> Duck prompt: preserve the exact low both-knee kneel and straight horizontal
> mace; match original muted warm tan skin, brown shadows, beard and outfit;
> restore the blunt steel end cap and short square studs while preserving length.
> Wall prompt: preserve tucked pose and head/body size; enlarge hands, boots
> and mace about 20%; match original skin/outfit palette and restore original
> blunt mace cap, keeping its head and handle straight. Original is appearance
> and weapon reference only; preserve crisp coarse pixel art and transparency.

> Duck palette/outline was corrected with the built-in image tool using the actual
> idle sprite as the style reference. Master: `public/assets/thorg/sources/duck-green.webp`.
> Prompt and installed comparison: `output/thorg-pose-refinement/prompt.md` and
> `output/thorg-pose-refinement/installed.png`. Horn span remains 52 source pixels,
> foot baseline 118. Wall-slide is mirrored during import so the raised contact
> hand points right in the base pose; normal facing logic mirrors it for left walls.

> Revised the wall-slide master using the built-in image tool: darker tan skin,
> steel and leather, larger hands/forearms, raised elbow beside the helmet, and
> knees/boots tucked together. Import scale is now 52/516 to preserve helmet size;
> right-wall orientation and foot baseline 118 are retained. The new source is
> `public/assets/thorg/sources/wall-slide-green.webp`; installed into `wall-slide.webp`
> and atlas `sliding00`. Other atlas frames are pixel-identical to before this edit.
> Prompt and before/after preview: `output/thorg-wall-compact/`.

> Wall-slide color was subtly darkened with the built-in image tool; scale increased
> from 56/512 to 58/512 (3.6%). Master and installed sprite remain in the same asset
> paths. Prompt: `output/thorg-eight-frame/prompt.md`.

> Attack is now the explicit exception to the eight-frame budget: 12 total frames,
> with one windup, eight sweep poses and the same three recovery poses. Phase
> budgets remain 70/500/300 ms. Other animation frame counts are unchanged.
> Wall-slide skin was matched to actual idle00 golden tan rather than globally
> darkened. The installed atlas was reviewed beside idle and duck at the same
> scale; comparison and exact built-in image edit prompt are in
> `output/thorg-sweep-palette/`. Wall-slide size and orientation are unchanged.

## treasure-art-refinement (historical)

> Source: /Users/nisch/.codex/generated_images/01a0a547-4385-7d51-bafe-94620bc9022b/exec-400b76b4-afcc-415b-8eb1-d17b989bb85d.png

> Prompt: Edit image 1 coin pile; image 2 is composition reference ONLY, not style. Rebuild coins into a dense low domed treasure heap just like reference: broad base, overlapping mostly flat tilted disks, layered irregularly rising to center. About 25 coins, no tall towers, no upright standing medallions. Keep gold orange centers and yellow rims, no symbols. Use case: precise-object-edit. Pixel-art game reward sprite. Preserve existing chunky crisp pixel clusters, dark outlines and currency colors/design. Genuine transparent alpha background, no glow, haze, ground shadow or backdrop. Entire sprite centered with 3% padding. No text.

> Source: /Users/nisch/.codex/generated_images/01a0a547-4385-7d51-bafe-94620bc9022b/exec-322690a0-9184-46da-b7d8-7b769b344056.png

> Prompt: Edit image 1 gem pile; image 2 is composition reference ONLY: use that dense overlapping low domed mound arrangement but entirely blue diamond gems. About 22 gems lying on sides and angled in perspective, nestled into a continuous heap, broad base and gently raised center. Most partly occluded, no isolated floating gems, no fan of upright diamond icons. Preserve rigid faceted diamond geometry. Use case: precise-object-edit. Pixel-art game reward sprite. Preserve existing chunky crisp pixel clusters, dark outlines and currency colors/design. Genuine transparent alpha background, no glow, haze, ground shadow or backdrop. Entire sprite centered with 3% padding. No text.

> Source: /Users/nisch/.codex/generated_images/01a0a547-4385-7d51-bafe-94620bc9022b/exec-a71f9ecf-fae9-485f-b53d-12a1d03bbf6c.png

> Prompt: Edit this overflowing coin bag. Make its top opening and entire collar visibly narrower: outer collar width only 23% of plump bag body width. Small gathered neck with soft sloping shoulders, tiny coins partly visible inside opening. Preserve body, rope, colors and scattered coins at base. Use case: precise-object-edit. Pixel-art game reward sprite. Preserve existing chunky crisp pixel clusters, dark outlines and currency colors/design. Genuine transparent alpha background, no glow, haze, ground shadow or backdrop. Entire sprite centered with 3% padding. No text.

> Source: /Users/nisch/.codex/generated_images/01a0a547-4385-7d51-bafe-94620bc9022b/exec-65cd3be0-1147-432d-bb62-61fa8bab4c5d.png

> Prompt: Edit this overflowing gem bag. Make its top opening and entire collar visibly narrower: outer collar width only 23% of plump bag body width. Small gathered neck with soft sloping shoulders, tiny gems tucked partly inside opening. Preserve body, rope, colors and scattered gems at base. Use case: precise-object-edit. Pixel-art game reward sprite. Preserve existing chunky crisp pixel clusters, dark outlines and currency colors/design. Genuine transparent alpha background, no glow, haze, ground shadow or backdrop. Entire sprite centered with 3% padding. No text.

> Source: /Users/nisch/.codex/generated_images/01a0a547-4385-7d51-bafe-94620bc9022b/exec-5d82e458-8f40-4890-ae14-45e9313dbd38.png

> Prompt: Edit ONLY the load of gems in this cart. Preserve wooden cart body, metal straps, wheels and pixel art style. Replace huge upright diamonds with many smaller cyan blue gems nestled naturally inside cart under gravity, lying on sides at varied angles with strong overlap, a low irregular mound rising just above rim. Gems partly hidden behind front rim. No giant central hanging diamond, no symmetrical bouquet, no floating gems. Preserve faceted diamond shapes. Use case: precise-object-edit. Pixel-art game reward sprite. Preserve existing chunky crisp pixel clusters, dark outlines and currency colors/design. Genuine transparent alpha background, no glow, haze, ground shadow or backdrop. Entire sprite centered with 3% padding. No text.
