# King skin revision

Generated with the built-in imagegen tool using the user's king reference. Source: `public/assets/ninja/skins/ninja-arena-sovereign/ai-source.png`.

Prompt: create a crisp limited-palette pixel-art king with dark hair and beard, visible face, jeweled gold crown, black outfit, gold jewelry and boots, and crimson cape with white ermine trim. Six columns by six rows, 34 isolated poses, consistent size, right-facing. Five idle, three falling, seven running, one wall-slide, nine jumping/somersault/landing, five dying, four throwing poses; final two cells empty. Large clear gaps, complete uncropped silhouettes, no labels, shadows or detached effects.

Background refinement prompt: replace the generated checkerboard with uniform #FF00FF, preserving all poses and positions. The importer keys out this reserved background color.

Run `node scripts/pack-king-skin.cjs` to reproduce the lossless WebP atlas and matching portrait. This mechanically keys, crops and packs generated pixels with nearest-neighbor sampling. All 34 logical frames remain 72×72, preserving animation names and gameplay size. Physical atlas positions have 16px gutters, plus internal transparent margins. Packing rejects source sprites touching their extraction cell edges or exceeding the safe frame size. The older batch importer no longer overwrites this skin.

Reviewed the supplied recording and packed sheet. Skin atlas contract and ninja renderer tests pass. The broader trophy skin test contains an unrelated failing currency sound assertion (expected rewardGems, received rewardCoins). A live match was not replayed for this revision.

## Crown throw, descent and portrait follow-up

Built-in imagegen produced `action-source.png`: a 4×2 sheet containing three consistent upright, feet-down falling poses with lifted cape; four crown-removal/throw/followthrough/recovery poses with uncovered hair after removal; and a separate jeweled crown. Prompt required the same bearded king identity, right-facing poses, consistent scale, complete silhouettes, wide gaps and solid #FF00FF background. These replace only falling00–02 and throw00–03; crown.webp uses the base projectile's 237×237 canvas. Skin weapon loading and both ninja render paths use the crown, including trails and swarm attacks, without changing combat tuning.

Built-in imagegen produced `portrait-source.png`: a single detailed full-body pixel-art portrait, three-quarter right-facing guard stance, dark swept hair and beard, jeweled crown, black tunic, gold chains/medallions/bracers/boots, red sash and crimson ermine cape, sharp pixel clusters, complete silhouette, solid #FF00FF backdrop. `body.webp` now preserves its native 1254×1254 detail. The packer no longer derives portraits from gameplay frames.

Validation: 18 ninja combat/renderer checks and both skin atlas contracts pass, including predicted basic/swarm crown rendering, crown trails, remote-owner skin selection and fallback for missing weapon textures. Revised packed artwork visually inspected; no live match replay in this pass.

## Portrait identity correction

Supersedes the adult-proportioned portrait above. Built-in imagegen reference: `ai-source.png`, specifically its top-left idle king ninja. Prompt: preserve that exact short chibi silhouette, oversized head, compact beard, simple angular eyes, low wide jeweled crown, small fists, black ninja outfit, gold chains, short boots and crimson ermine cape. Keep the idle pose and orientation; no adult anatomy, ornate lion armor, realistic hair strands or added accessories. Authentic coarse pixel art, hard staircase contours, limited-tone shading, no smoothing, solid magenta background.

Final `body.webp` is 1152×1152, sampled from this dedicated portrait on a 96×96 grid and enlarged exactly 12× using nearest-neighbor sampling. Every displayed pixel block has one solid RGBA value. Transparent background; gameplay atlas and crown remain as before.

## Falling, crown spin and crouch

Built-in imagegen prompt for `motion-source.png`: match the existing chibi king; four subtly changing upright falling poses with fixed head/body/feet positions and gently moving cape/wrists; isolated jeweled crowns rotating around the vertical Y axis with tips always upright; crouched king with crown low over his eyes, visible black torso, bent arms and legs, gold boots and bunched crimson cape. Strict spaced 4×3 grid, crisp pixels, complete silhouettes, no labels/shadows. The generated alpha is retained with binary pixel edges during packing.

The king has four falling frames played at 8fps in a forward/back loop. `duck00` is explicitly packed, avoiding the base ninja's fixed crop coordinates on this padded skin atlas. The crouch is 35px tall in the 72px cell, with body and feet visible. `crown-spin.webp` contains eight 237px frames, used by predicted/remote and legacy projectile rendering; crown z rotation and angular velocity remain zero, including return/hover phases. Trails preserve the current view. Default ninja projectiles retain their existing rotation.

Validation: renderer tests (including upright spin and reverse direction), ducking checks and atlas contracts pass. Production build passes with asset-size warnings. Packed art visually inspected; live match replay remains unverified. Portrait remains 1000×1000 with both soles at the bottom edge.
