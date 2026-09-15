# Initial trophy art prompts (historical)

These are the first-generation prompts. Arena Spark remains in `public/assets/profile-icons/arena-spark.webp`. Other initial images and the old palette implementation have been superseded.

# Trophy Road artwork

Generated with the built-in image generation tool, then encoded as WebP with cwebp quality 90, preserving alpha. No API/CLI image generation was used. Paths below are relative to this directory.

## Final assets and prompts

### arena-crown.webp — Crown of the Arena, 10,000 player card

> Use case: stylized-concept. Asset type: transparent player card frame for Bro Battles, a pixel fantasy brawler. Create a premium 'Crown of the Arena' collectible portrait card border, approximately 650:1250 aspect ratio. Polished hand-painted game art with chunky dark outlines, angular golden metal, small cyan crystal accents, a majestic trophy crown crest at the top, elegant gold laurels and crossed short blades at the bottom. Thin straight vertical rails. Entire large rectangular interior window MUST be genuinely transparent, as must exterior corners. No character, no backdrop, no text or numbers. Frame occupies only outer 15 percent on each side and top/bottom 18 percent. Symmetrical, front view. It must read clearly at small sizes, visually special as the final 10,000-trophy prize.

### slime-circuit.webp — Slime Circuit, 1,750 player card

> Use case: stylized-concept. Asset type: transparent portrait player card frame for pixel fantasy brawler Bro Battles. Create 'Slime Circuit': a collectible card border, 650:1250 tall aspect ratio. Chunky black outlines, hand-painted angular dark gunmetal, glowing emerald slime channels and lime droplets, playful small slime face crest at top, broken crystal clusters at bottom. Thin straight vertical rails. Entire large rectangular interior window is genuinely TRANSPARENT, as are outer corners. No characters, no backdrop, no text, no numbers, no fake checkerboard. Symmetrical front view, detailed yet readable at small size. Border only outer 12 percent left/right and 18 percent top/bottom.

### arena-sovereign.webp — Arena Sovereign, 10,000 Ninja skin portrait

Reference: `public/assets/ninja/body.webp`.

> Use case: precise-object-edit. Asset type: transparent full body portrait for game skin 'Arena Sovereign'. Preserve the reference ninja exactly: same pixel art grid, silhouette, pose facing right, dark hood and eyes, and small shuriken weapon. Change only suit armor to gold with deep warm brown shadows and scarf to cyan. Preserve dark hood. Genuine transparent background. No extra objects, no text. Crisp pixel art.

### arena-spark.webp — Arena Spark, 1,250 player icon

> Use case: stylized-concept. Asset type: square player profile icon for Bro Battles fantasy pixel brawler, 'Arena Spark'. Bold chunky pixel-art cyan flame surrounding a golden shuriken star, dark navy square background, simple dark gold pixel bevel border, tiny spark highlights. Looks like an earned prestigious achievement badge, readable at 48 pixels. Centered composition, no letters, no numbers, no words. Crisp deliberately chunky pixels, not smooth vector, not photoreal.

### amethyst-gloop.webp — Amethyst Gloop, 3,500 skin portrait

Reference: `public/assets/gloop/body.webp`.

> Use case: precise-object-edit. Asset type: transparent game skin portrait, 'Amethyst Gloop'. Preserve the reference's pixel-art slime blob silhouette, pose, low placement in the square canvas and chunky pixel grid. Change turquoise outer slime to luminous purple/violet and deep blue inner slime to rich dark magenta with light lilac highlights. No eyes or added objects. True transparent background, no white, no text. This is a cosmetic palette variant for a pixel brawler.

## Animation safety

Skin portraits are generated artwork. Gameplay skins use palette transforms of the base atlases so every frame, hitbox and pose remains stable. The generated atlas experiment was not shipped because frame alignment was unreliable. Numeric milestone icons are supplied by the user separately; see `docs/trophy-road-overhaul.md`.
