# Reforged level badges

Generated with the built-in image_gen tool. The final source atlas was `badges-v5.png` (removed after extraction). The active production assets are `public/assets/levels/1.webp` through `10.webp`: ten standalone 397×397 transparent images centered on identical canvases. They are extracted with `scripts/split-level-badge-atlas.py`, which isolates each connected badge so neighboring atlas pixels cannot leak into another level. Level 4 received a separate image-gen repair because its lower point touched level 9 in the source atlas; the splitter preserves that repaired file. Earlier concepts and the original badges were removed during asset cleanup.

The selection cards and character details use a framed top-left level plaque. Upgrade previews use the same artwork. No idle glow or scaling animation is applied to the medallion.

## Active v5 refinement prompt

Use case: precise-object-edit
Asset type: production pixel-art sprite atlas for every character-level display in Bro Battles
Input image: `badges-v4.png`
Primary request: Preserve the exact canvas, alpha, layout, and levels 1 and 3–10. Widen only level 2 by roughly 10–12 percent so its opaque footprint and visual weight match level 1 within about 5 percent, while keeping it compact and avoiding the earlier wide-banner shape. Preserve its burnt-orange/copper palette, two rivets, ivory numeral, stepped outline, pointed bottom, coarse pixel clusters, and centered position. Keep the silhouette clean with no detached pixels, noise, glow, blur, gradients, labels, backgrounds, antialiasing, or extra ornaments.

## Active v4 refinement prompt

Use case: precise-object-edit and style-transfer
Asset type: production pixel-art sprite atlas for every character-level display in Bro Battles
Input images: `badges-v3.png` is the edit target; the original level 9 badge is the infernal-rank reference.
Primary request: Preserve levels 1, 3, 4, 5, 6, 7, 8, and 10. Narrow level 2 to the compact footprint of levels 1 and 3 while retaining its burnt-orange shield, top bar, rivets, number, and centered cell position. Rebuild level 9 as a compact obsidian/deep-violet demon shield inspired by the original infernal badge, with two restrained horns and a crown of purple fire made from large hard pixel clusters. Use violet, magenta, lavender, and limited gold structure; no orange or red fire, wings, particles, haze, soft glow, gradients, antialiasing, or microdetail. Remove every detached dash, speck, and compression-like mark below or around all badges. Preserve the exact 5-by-2 layout, dimensions, alpha, spacing, and number placement.

## Active v3 generation prompt

Use case: style-transfer
Asset type: production pixel-art sprite atlas for every character-level display in Bro Battles
Input images: Image 1 is the atlas to redesign. Images 2 and 3 are old badge references for ceremonial detail and progression energy.
Primary request: Rebuild all ten badges so adjacent levels are immediately distinguishable by BOTH dominant color and silhouette. Preserve the clean chunky pixel style and readable ivory numbers, but eliminate repeated gold-shield variants.
Composition: exactly 5 columns by 2 rows, equal square cells, reading order 1–5 top row and 6–10 bottom row. One centered badge per cell with identical center position and generous transparent padding. Keep every badge fully inside its cell.
Required distinct progression:
1: compact round-bottom COPPER/BROWN buckler, one square top rivet, no side ornament.
2: wider BURNT-ORANGE/BRASS shield, two side rivets and a flat top bar.
3: pointed FOREST-GREEN/BRONZE shield with a small upward leaf crest and a single lower chevron.
4: angular COBALT-BLUE/SILVER kite shield with square shoulder plates, no gems and no ribbons.
5: CRIMSON-RED/GOLD shield with one ruby crown point and two short red banner tails.
6: icy CYAN/WHITE-SILVER diamond-bottom shield, one sapphire, compact horizontal ice fins; it must not use a gold body, ribbon tails, or feather wings.
7: deep MAGENTA/ROSE-GOLD shield with a three-point crown and split magenta pennant; no blue gem.
8: bright EMERALD-GREEN/GOLD shield with a round jade gem and a compact laurel branch on each side; no wings, no banner tails, no blue.
9: OBSIDIAN-BLACK/VIOLET shield with a tall amethyst spire, thin gold rim, and two short upward horn-like prongs; absolutely no side wings.
10: ROYAL-PURPLE/WHITE-GOLD champion shield with a gold crown, large central purple diamond, and unmistakable compact white wing fans with exactly three feathers per side.
Style/medium: authentic chunky low-resolution 16-bit pixel art, hard pixel clusters, 3–4 shading bands, thick near-black stepped outlines, no antialiasing.
Text: exact central numbers “1”, “2”, “3”, “4”, “5”, “6”, “7”, “8”, “9”, “10”; no word LEVEL and no other text.
Constraints: central number is always dominant; each badge is recognizable at 48px; decorations grow gradually; levels 6, 8, 9, and 10 must have clearly different palettes and outer silhouettes; real alpha transparency.
Avoid: repeated gold shields, similar purple badges for 9 and 10, similar winged badges for 6 and 8, glow, gradients, particles, dangling crystals, halos, excessive jewelry, smooth vector edges, tiny noise, casino styling.

## v2 generation prompt

Use case: style-transfer
Asset type: production pixel-art sprite atlas for the Bro Battles character-level UI
Input images: the 5-by-2 badge atlas is the edit target; the separate old level 1, 5, and 10 badges are style references for the decorative progression only.
Primary request: Redesign the ten badges in the atlas so every level gains a little more ceremonial decoration than the last, inspired by the old badges, while remaining compact, readable, and restrained.
Composition: keep exactly 5 columns by 2 rows, equal square cells, reading order 1–5 on top and 6–10 beneath. Keep all badge centers, number positions, scale, transparent padding, and cell boundaries consistent. Each complete badge must stay entirely inside its cell.
Style: authentic chunky low-resolution pixel art, hard pixel clusters, thick near-black stepped outlines, limited palette, no antialiasing, no gradients, no blur, no glow. The central ivory number remains the largest and clearest feature.
Progression:
1 plain bronze shield with one top rivet.
2 bronze shield with paired studs.
3 bronze with a small top crest and tiny lower point.
4 silver rim with subtle corner plates.
5 silver/gold transition with a centered ruby and two short red ribbon tips.
6 silver-and-gold shield with one sapphire and small shoulder fins.
7 gold shield with a ruby, short split banner tails, and a modest three-point crest.
8 gold shield with small upward feather tabs and two gems.
9 gold-and-purple elite shield with a purple gem, compact crown crest, and short silver feather fans.
10 champion shield with purple center, crown, central purple gem, and compact white wing fans inspired by the old level 10, but with only 3 feathers per side and no halo, dangling gems, floating crystals, or long spikes.
Constraints: one badge per cell; exact numbers 1,2,3,4,5,6,7,8,9,10; genuine alpha transparency around every badge; consistent footprint and visual weight; max decorations may extend only about 12% beyond the base shield. No word LEVEL and no other text. Avoid casino shine, excessive jewelry, particle effects, tiny noisy details, smooth vector edges, or ornamental clutter.

## Original v1 generation prompt

Use case: stylized-concept. Asset type: ONE production sprite atlas of ten level badge icons for the pixel-art game Bro Battles.
Create a transparent PNG sheet, exactly 5 columns by 2 rows of equal square cells, no margins between cells, all icons centered identically in their cells, ample transparent padding within cells. Order left to right: levels 1,2,3,4,5 then 6,7,8,9,10.
Each badge is a compact broad heraldic shield with a large clear ivory pixel number in the center. No word LEVEL, no other text. Same shield body size and number position across all ten. Thick near-black stepped outlines, very chunky authentic low-resolution pixel art, each badge looks drawn on a 48x48 pixel canvas with a limited 12-color palette and hard pixel clusters. Flat two-tone metal shading, no fine detail, no gradients, no blur, no glow, no smooth vector edges.
Progression: 1 plain warm bronze shield, 2 bronze with small rivets, 3 bronze with a small top stud; 4 brushed silver rim navy center, 5 silver with small side tabs, 6 silver with single blue top gem; 7 gold rim dark burgundy center, 8 gold with small shoulder fins, 9 gold rim violet center single purple gem, 10 gold violet champion shield with a small three-point crown and two short silver winglets. All restrained, compact, equal visual weight, no halos, no dangling crystals, no tall spikes, no oversized wings. Numbers 1 through 10 are the dominant feature. Each occupies about 70% cell height, max-level decorations fit inside same bounds. Real alpha transparency around every badge. This should feel like collectible equipment from a polished 16-bit RPG, charming and tactile, never mobile casino ornament.
