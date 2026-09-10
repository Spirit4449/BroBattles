# Thorg sprite polish

The base atlas `public/assets/thorg/spritesheet.webp` was edited with the built-in ImageGen tool in one generation. It now uses one Viking identity across idle, running, sweeping, falling, sliding and jumping, with no baked-in weapon. Phaser attaches the existing thrown-weapon texture, so the held weapon and attack share one asset. Alternate skin artwork is unchanged.

The generated result was normalized to the existing 768×768 atlas with 128×128 cells. Mechanical preparation removed the generated neutral checkerboard, retained each cell's largest connected sprite, scaled with nearest-neighbor sampling, and aligned feet to pixel 118. A missing sixth running frame was added to `animations.json`. The transparent atlas was decoded and composited onto a solid slate background to check silhouettes and transparency; some image viewers misdisplay transparent pixels, so inspect against a background.

Generation source: `/Users/nisch/.codex/generated_images/01a0726d-e466-7920-ab72-00a74de78d39/exec-5fd4b3ec-c631-481f-a1d6-41e645c13657.png`.

Exact prompt:

> Use case: precise-object-edit. Edit target: attached game sprite atlas. Produce a polished game-ready replacement, exactly square 768 by 768 pixels, transparent RGBA background, precise 6 columns by 6 rows of 128x128 cells. Preserve the same compact pixel-art Viking identity as the FIRST ROW: horned dark helmet, orange beard, warm skin, brown leather clothes, squat strong proportions. All frames must depict exactly that same face, costume, head size and body proportions. Remove ALL axes, hammers and weapons from EVERY cell; game engine will attach a separate weapon. Hands remain closed gripping fists. Consistent baseline y=118 and body center x=64 inside each cell, feet never clipped, all sprites entirely within their own cell. Preserve crisp outlined pixel art, no labels, grids, shadows or background. Layout row1 col1-6: subtle idle breathing progression facing slightly right. Row2 col1-2: final two idle breathing frames returning seamlessly to first pose. Row2 col3-6: first four running right frames. Row3 col1-2: last two running right frames in seamless six-frame run. Row3 col3-6: first four standing sweeping attack poses: ready at waist, windup behind body, rotate torso and grip forward at waist, follow through rotating across body; maintain same head and torso as idle, NOT a different face. Row4 col1: fifth attack recovery pose returning to idle. Row4 col2-6: EMPTY transparent. Row5 col1-6: smooth falling pose progression with legs tucked, arms slightly raised; maintain same appearance as idle. Row6 col1: wall sliding pose. Row6 col2-4: three upward jumping poses. Row6 col5-6: EMPTY transparent. Most important: frame-to-frame anatomical and pixel-art consistency, accurate 6x6 atlas alignment, absolutely no weapons anywhere, actual transparent background. Keep sprite scale and aesthetic extremely close to reference; fix existing mismatched attack/falling faces to match idle.

## Airborne, duck and power-up expansion

A second targeted built-in ImageGen call created additional frames from a magnified idle00 reference. Existing idle, running and sweeping art remains unchanged. The generated magenta chroma background was removed; poses were resampled with nearest-neighbor sampling to match the existing head/body scale and centered with feet at y118. The new atlas is 768×1152 with unchanged 128×128 frame cells. Six jump frames progressively lift the arms, four falling frames retain an upright torso and untucked legs, six power-up frames flex the arms, and a proper duck frame occupies the existing duck contract cell (column4,row4). Original unused distorted airborne frames were cleared. Grip coordinates are stored in `src/characters/thorg/handAnchors.json`.

Source: `/Users/nisch/.codex/generated_images/01a0726d-e466-7920-ab72-00a74de78d39/exec-7ac7fee4-95b3-4796-b94c-a71f4f582b8c.png`.

Exact expansion prompt:

> Use case: identity-preserve. Game sprite animation expansion from the attached reference Viking. Exactly match reference character: stocky muscular wide chest, orange beard, steel horn helmet, brown leather bracers, belt and boots, same pixel-art rendering. Create ONE sheet 6 columns by 4 rows, exactly 24 poses, equally sized invisible cells, all sprites complete inside cells with generous margins. Every character must have IDENTICAL size head, wide body, facial features and costume. Background SOLID PURE MAGENTA #FF00FF for chroma key, no checkerboard, no shadows. Row 1 six JUMP frames: beginning at reference idle with fists down; arms rise gradually over successive frames to shoulder level, legs remain strong spread stance only subtly bending, NEVER curl into ball. Row 2 six FALL frames: upright imposing buff airborne warrior with strong tall torso, broad shoulders, legs relaxed almost straight and spread below hips, boots below body, arms lower gently from shoulder height back toward hips across frames. No tucked knees, no fetal pose, no squashing or shrinking head/body. Row 3 six POWER-UP frames: upright feet planted wide, fists start beside hips, elbows raise smoothly into confident double-biceps flex with fists beside shoulders, chest broad and proud; finish slightly relaxed powerful pose. NO magical FX, no particles, no aura. Row 4 six CROUCH/DUCK frames: smoothly bend knees outward to lower a strong chest behind braced fists, head remains same size, wide sturdy thighs, feet planted, proper anatomical crouch, not an aerial ball. All face slightly right as reference, consistent body center and scale, crisp pixel outlines, no weapon, no text, no labels, no gridlines, no cutoff horns/boots. Anatomy must stay close to attached image in all 24 poses.

Follow-up carry adjustment: falling now loops only raised-hand `falling00` and `falling01` at 6 fps. The two lowering-hand frames are no longer registered in the atlas. All grip tracks carry the weapon head upward and behind the shoulder, with the existing movement sway and attack transitions retained. This adjustment reused the artwork without another image generation.

## Front carry idle hands

One targeted built-in ImageGen edit raised the idle forearms and cupped the supporting hand. Only the forearm/waist region of the eight idle cells was composited; original helmet, head and legs and every other animation remain unchanged. Measured right grip is (85,78), with one-pixel breathing offset in the last two frames. The support hand is around (55,77). Hand anchors retain the shallow front-carry angle -4.48 radians.

Source: `/Users/nisch/.codex/generated_images/01a0726d-e466-7920-ab72-00a74de78d39/exec-e0b1ba98-4193-4f75-b9a1-5cb622fd50a2.png`.

Exact prompt:

> Use case: precise-object-edit. Edit attached pixel-art Viking idle sprite. Change ONLY FOREARMS AND HANDS: lift both forearms in front of the lower chest, both elbows relaxed down. Viewer-right hand is a closed weapon-gripping fist centered at x=360,y=312 in the 512x512 reference canvas. Viewer-left hand moves slightly inward and upward to be a cupped supporting hand centered at x=220,y=288. They are holding an invisible long weapon diagonally across his LOWER chest, below beard and face, the weapon points toward viewer-left and slightly upward. DO NOT DRAW ANY WEAPON. Do NOT move head, beard, face, helmet, shoulders, belt, torso, legs, boots, body placement, or scale. Preserve pixel-art exactly with the same brown bracers and warm skin. One character only on solid pure #ff00ff magenta background. Exact same full-body framing and proportions as the image, 512x512. Do not redesign character or change any pixels outside forearms/hands. Hands must be below beard, no raised fists near head.

## Current carry and animation tuning

Idle uses the viewer-right grip at (85,78), with a one-pixel breathing offset in the last two frames and a flatter -4.55-radian angle across both hands. It renders in front of the body and plays at 6 fps. Running uses the rear-fist anchors with a -4.25-radian angle; the handle follows each displayed fist directly, without added running bob or angular sway. The 12 fps running order is 01, 00, 03, 04, 02, 05 to interleave lifted strides with planted contacts.

The sweep keeps its shared combat trajectory. Procedural body rocking is removed, and the carry grip is held through the throw frames so recovery does not slide to unrelated attack hand anchors. The swing retains its transition into and out of the combat arc.

## Finger occlusion and forward running carry (September 9)

The built-in ImageGen tool replaced `public/assets/thorg/weapon.webp` with a narrow leather-handled iron mace. Source: `/Users/nisch/.codex/generated_images/01a08496-7414-7f21-a345-42e71c29025c/exec-d12ab3ce-8564-4c35-a7d6-3b845b106723.png`. Sharp trims transparent margins and samples to 25×101 with nearest-neighbor filtering, preserving alpha. The held base weapon renders at 20×71; legacy skin weapon widths remain unchanged.

Exact generation prompt:

> Use case: precise-object-edit. Edit target: attached Viking iron mace sprite. Make a clean game-ready pixel-art replacement on genuinely transparent background. Single vertical weapon, pommel TOP and heavy iron striking head BOTTOM as reference. Preserve dark weathered iron palette and chunky outlined pixel art. Improve silhouette: upper 55% is a slender straight brown leather wrapped handle with distinct small pommel, comfortably narrow enough for fingers to wrap around; lower 45% a heavy rectangular iron mace head with modest blunt studs. No hands, no person, no text, no background or shadow. Center weapon on canvas, full object visible. Aspect ratio approximately 3:8. Crisp low-resolution pixel-art, not smooth painting.

The model now renders cropped foreground fingers over the handle, plus the supporting idle hand, using the original atlas pixels. These layers track facing, transparency, tint and rage size and are removed on destruction/shutdown. They hide during the sweep. Running anchors follow the forward fist in all six frames, with the mace angled upward ahead of the character. Rotation transitions ease over 60 ms. Body atlas identity and combat geometry are preserved.

Open `/thorg-preview.html` on the local server to inspect idle, running, jump, falling and sweep using the production renderer, mirrored at normal and enlarged sizes. The preview entry is built by webpack.

## Heavier head, faster startup and rear sweep occlusion

The next built-in ImageGen revision replaces `public/assets/thorg/weapon.webp` with a 36×101 transparent sprite, rendered 26×71 when carried. Its head occupies roughly two thirds of the length, with a shorter leather hilt. The first result included a painted checkerboard; a second ImageGen background-extraction call produced real transparency. Final source: `/Users/nisch/.codex/generated_images/01a08496-7414-7f21-a345-42e71c29025c/exec-178f1df9-53b3-416a-a7d7-9d6efa5eecb9.png`.

Weapon prompt:

> Use case: precise-object-edit. Edit target attached pixel art mace. Make the iron striking head substantially beefier and shorten the handle/hilt. Keep the SAME weathered dark iron, squared blunt studs, brown leather wraps, crisp chunky pixel art with black outlines. Vertical weapon with small pommel TOP, striking head BOTTOM. Head occupies LOWER 65% of total length, handle only UPPER 35%. Head width 33% of total weapon length, thick rectangular brutal iron mass. Small restrained pommel, narrow grippable leather handle. One weapon centered tightly framed, transparent RGBA background, no glow, no shadow, no text, no hands. Preserve the reference design while adjusting these proportions.

Background-extraction prompt:

> Use case: background-extraction. Keep this exact weapon unchanged. Remove all white and gray checkerboard background and produce ACTUAL transparent alpha around it, no painted checkerboard, no glow or shadow. Only the isolated pixel-art mace. Same proportions, same colors, same design.

The five attack frames in `public/assets/thorg/spritesheet.webp` use generated forearm motion. Generated cells were cropped, scaled with nearest-neighbor sampling to 105px character height, aligned by helmet center and baseline, and only source rows 55–93 of each attack cell were replaced. Other animations and the original attack heads and legs are unchanged. Source: `/Users/nisch/.codex/generated_images/01a08496-7414-7f21-a345-42e71c29025c/exec-918ea145-9213-4f21-a4b3-b5b8a4ca9f2f.png`.

Attack artwork prompt:

> Use case: precise-object-edit. Edit target: five-frame pixel-art Viking attack strip. Preserve EXACTLY the character identity, head, horned helmet, orange beard, torso, brown costume, legs, boots, style and position in each of FIVE equal cells. Change ONLY ARMS AND HANDS so a low horizontal mace sweep is readable while body stays planted. NO WEAPON, closed fists gripping an invisible handle. FIVE poses left to right: 1 dominant viewer-right fist extended forward at waist, support forearm bends toward it; 2 dominant fist swings inward across belly to center, elbow bent; 3 dominant fist reaches across belly toward viewer-left hip, support arm opens a little; 4 dominant hand passes behind hip/body, elbow slightly visible behind torso, support arm down; 5 dominant fist returns to viewer-right waist, recovery. Subtle controlled forearm motion, not huge punching, maintain same body and head. Transparent background, no checkerboard, no text. Exactly five frames in one horizontal strip, each full character fits its equal cell with consistent unchanged head and feet positions. Match reference pixels and proportions aggressively.

Carry settling uses a 24ms time constant (previously 60ms), and the running grip snaps to the displayed fist immediately. Shared client/server attack startup is 70ms (previously 140ms), the strike is 400ms (previously 460ms), and recovery remains 100ms. The attack animation uses that same 570ms clock. The rendered weapon foreshortens through the elliptical sweep with its grip at waist height; its head center stays on the authoritative hit trajectory. The trail is split at the body's depth plane into front and rear graphics layers, so a fading trail can span both without drawing through the torso. Front arc and Rear arc buttons in the preview freeze the actual renderer at representative phases for inspection.


## Dying animation

Added `dying00`–`dying05` in a new row at y1152, expanding the base atlas to 768×1280. All existing atlas pixels and frame coordinates are preserved. Six generated collapse poses use a uniform 0.235 nearest-neighbor scale and ground baseline y118 inside 128×128 cells. The existing `thorg-dying` registration plays them once at 10 fps; the held weapon already hides on dying frames. The preview now includes a Dying button.

Created with the built-in ImageGen tool using idle00 as the identity reference. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-03593d3c-14d1-4c2c-8553-acbc433b843f.png`.

Prompt: Create six equal-cell pixel-art death/collapse poses, three columns by two rows, of the reference stocky orange-bearded Viking with dark horned helmet, bare muscular arms and brown leather costume. Progress from upright recoil to buckling knees, kneeling slump, sideways fall, lying on side, and settled motionless with closed eyes. Preserve identity and proportions. Transparent alpha background, no weapon, blood, effects, labels, grid or clipped body parts. Keep each grounded pose on a consistent baseline.


## Slow weapon roll and subtle end cap

The base weapon now uses `weapon-spin.webp`: eight 36×101 frames at 8 fps (one second per axial revolution). The pose clock advances frames while retaining the existing grip, sweep rotation, depth and dying visibility. Alternate skin weapons retain their own art. `weapon.webp` is the first frame for static consumers. Running is reduced from 12 to 8 fps.

Built-in ImageGen generated the rotating head; mechanical preparation removed the checkerboard, normalized the cells and preserved the original upper 34px handle. The terminal head cap is slightly rounded with small spikes. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-78cf1ee6-f959-454a-aca6-47bf4987aa45.png`.

Prompt: Eight evenly spaced axial rotational views of the reference dark steel cylindrical studded mace, four columns by two rows. Preserve brown wrapped handle, proportions, colors and pixel art. Keep handle upward and heavy head downward in every cell. Add only an extremely subtle rounded bulge with small spikes at the terminal end of the heavy head, at most five percent wider; no large ball or redesign. Same size and alignment throughout, no end-over-end rotation, labels, shadows or clipped parts; transparent background.


## Hands-only attack polish

A limited built-in ImageGen edit supplies only the waist arm band of `throw01` and `throw02`. Original head, beard, lower torso, legs, facing and all other poses remain unchanged. The middle fist crosses from belly center toward the left waist. Front-facing grips now attach to the drawn fist and re-render fingers above the handle. Rear sweep depth remains unchanged. Strike duration remains 400ms, with 70ms windup and 100ms recovery shared by client and server.

Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-2c515073-bc22-4008-bec1-99ba42d1a76a.png`. Only selected arm pixels were used; the generated full image is not the atlas.

Prompt: Edit the exact five-cell reference strip, preserving original identity, texture, head, torso, belt, legs, boots and forward facing. Change only forearms and closed gripping hands at waist height, moving from viewer-right through center to viewer-left and back, with natural bent elbows and thumb around curled fingers. No body rotation, back views, redesign, weapon or enlarged fists. Original slate background.


Neck/shoulder correction: restored the original 400ms strike timing. A targeted built-in ImageGen neck/shoulder repair was composited only into rows 48–70 of the five attack cells; hands and lower-body pixels below that band remain unchanged. Prompt: Repair only cut-off neck/shoulder/head-to-body joins of the exact five-frame strip, reconnecting behind the beard with coherent outlines and pixel shading; preserve helmet, face, beard silhouette, poses, hands, legs and original identity. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-ab815f85-7445-4ab7-8b50-f7283d6b4282.png`.


## Complete attack-frame regeneration

Replaced all five `throw00`–`throw04` cells with complete generated sprites, superseding the partial arm and neck composites above. Other atlas cells are unchanged. Frames fit the existing 128×128 cells, with 106px character height and y118 baseline. Middle/left follow-through frames are mirrored to move hands across the waist while retaining a front-facing body. Grip anchors were remeasured. Timing remains 400ms strike, 70ms windup, 100ms recovery.

Built-in ImageGen source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-7f081d1a-e7e9-4af1-9403-a47fdd3bac4e.png`. Prompt: Regenerate five complete cohesive pixel-art attack sprites matching the original idle Thorg identity, helmet, orange beard, muscular proportions and detailed textured style. Natural connected neck/shoulders, front-facing body throughout, planted legs. Closed hands sweep at waist from right through middle toward left and recover; no full-body spin, weapon, effects or labels. Same scale and grounded baseline, transparent background.

## Unified attack/death palette and rigid weapon

Attack and dying frames were generated together using the original idle identity, then mapped to a 48-color palette sampled from idle00 with nearest-neighbor resizing. Grounded death poses retain approximately the upright character's length instead of shrinking to fit a short bounding-box height. All frames remain in their existing atlas cells. Source: `/Users/nisch/.codex/generated_images/01a084be-a03f-78c2-89a9-a2335aa026d5/exec-e1931d35-f856-410b-abc9-9ec129633267.png` (built-in ImageGen).

Prompt: Match exact Thorg reference, dark warm tan skin, orange/brown beard, charcoal horned helmet, muscular body and brown leather. Hard pixel clusters and restrained dark palette, no smooth gradients. Six front-facing waist-level arm sweep poses and six recoil-to-ground death poses; consistent helmet size and body mass, corpse length equals standing height. No body spin, weapons, effects, shadows or labels.

The base weapon remains 26×(26×101/36) pixels times character scale throughout carry, windup, strike and recovery. It rotates without axis stretching. The grip follows visible front fists; trail points follow the rigid visible head. Attack pose selection follows eased sweep phase rather than a separately advancing animation clock. Timing remains 70ms windup, 400ms strike, 100ms recovery. Server hit reach remains unchanged; its swept gameplay envelope is broader than the rigid artwork at some angles.


## Restored sweep orbit

The weapon head once again follows `sampleThorgSweep` exactly: a continuous waist-centered 75×26 ellipse with the original easing and front/rear depth split. The rigid weapon is positioned backward from the head along its rotation, preserving its 36:101 aspect ratio and constant size. Fist-frame snapping and visible-head path correction were removed. Revolution duration is now 560ms (previously 400ms); windup and recovery remain 70ms and 100ms. Body poses remain tied to sweep progress. The rendered head and server hit trajectory agree again.


## Grip pass reverted

Restored the prior rigid weapon orbit, 12% origin, and recovery. Removed idle finger/support overlays entirely so no copied hand pixels appear over the carried weapon. Sweep duration remains 560ms.
