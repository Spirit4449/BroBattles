# Thorg sprite polish

## Directional dash videos (September 23)

Installed three poses per direction from `thorg_dash_right.mp4` (frames 2, 5, 8),
`thorg_dash_45.mp4` (3, 6, 9), and `thorg_dash_up.mp4` (4, 8, 12).
Animations `dashright`, `dashdiagonal`, and `dashup` play once over the shared
160 ms dash duration. Leftward poses use the existing facing mirror. Downward
diagonals use `dashright`; straight down uses normal falling without a dash pose.
Local and remote playback share this selection. Legacy skins retain their own
fallback artwork. The green background is removed with the existing hard key,
using fixed scale 106/428 for all three directions, baseline 118,
and the unchanged 128-pixel logical canvas.

Straight horizontal dashes hold the final pose through 320 ms from launch,
extending the visual into early coasting without changing dash physics. Running
and falling yield to this short hold; attacks, jumps, ducking, wall slides,
death, and stopping interrupt it immediately. Diagonal/upward timing is unchanged.

Replaced the horizontal poses with the newer 21-frame `thorg_dash_right.mp4`.
Frames 2, 5, and 8 capture the lean into its low, forward-pointing mace pose.
Its standing reference matches the diagonal/up clips, so it now uses their
106/428 scale and x=626 body center. The 320 ms horizontal hold is retained.

Reimport with `python3 scripts/import-thorg-videos.py --dash-only` when the older
source clips are archived. This preserves all 53 existing frames pixel-for-pixel
and retains their alignment and metadata. Preview: `output/thorg-dash/installed.png`.
Validation: 78 focused Thorg, dash, animation, and movement tests pass.

## Installed regenerated duck and wall slide (September 22)

The approved green-background concepts are now installed as `duck00` and
`sliding00`, replacing the old held poses. Reproducible lossless masters live in
`public/assets/thorg/sources/duck-green.webp` and `wall-slide-green.webp`.
The importer removes green and uses nearest-neighbor scales 52/540 and 52/490,
respectively, matching idle's approximately 52-pixel horn span rather than
fitting the complete silhouettes to a box. Visible heights are 82 and 104 source
pixels; both end at y=118 on the 128-pixel logical canvas. The body scale stays
0.7. All other atlas frames were verified pixel-identical. Review:
`output/thorg-held-install/size-comparison.png`.

## Slower attack with restored baked sweep (September 22)

The replacement attack now takes 670 ms: 70 ms windup, 500 ms strike,
100 ms recovery. The source video blends its white sweep over green; the
previous hard chroma key incorrectly removed those translucent pixels.
For attack3 only, the importer reconstructs the white sweep's alpha from
red/blue differences against the sampled background. The effect is baked into
the spritesheet, and the procedural overlay is removed for embedded attacks.
The enlarged damage hitbox and head-anchored super HUD remain unchanged.

## Replacement circular attack and helmet HUD anchor (September 22)

Installed `Have_the_weapon_extend_outwards_20260922010509.mp4` as
`thorg_attack3.mp4`. Selected source frames 5–22, 38, 40, 43, and 46 remove
idle padding and the long extended-arm hold. The 22 poses retain the 292 ms
attack clock, 1.3× reach, doubled hitbox thickness, and procedural sweep trail.
Grip/tip anchors were retraced for the new circular motion. Import uses a fixed
106/428 scale and x=626 body center; all non-attack atlas poses were verified
pixel-identical. Previous atlas and track are saved in `output/thorg-attack-trial`.

Super HUD placement now uses the enlarged idle helmet height throughout the
activation. Raised hands and weapon no longer move the bars upward.

## Super HUD clearance and attack trails (September 22)

Rage now raises the shared HUD anchor with the enlarged sprite, with additional
clearance for the raised-weapon activation frames. It restores the normal anchor
on cleanup; the physical body remains unchanged. Local and remote HUDs consume
the same sprite offset.

Embedded-mace attacks draw a short fading sweep along the expanded damage path.
The trail mirrors with facing, scales with rage, changes from pale blue-white
to purple during rage, and samples crossed poses on slow frames. It is destroyed
on completion, interruption, scene reset/shutdown, and sprite destruction.

## Larger, faster attack and green pose concepts (September 22)

Attack playback and authoritative damage now share 28 ms windup, 224 ms strike,
and 40 ms recovery: 292 ms total, 2.5× faster than the previous 730 ms.
Recovery timing is configured alongside the other phases. The drawn weapon
track is unchanged. `sampleThorgHitbox` extends its tip's horizontal distance
from Thorg by 1.3× and doubles capsule thickness (base radius 7 → 14), mirrored
for facing and scaled with rage. Aim preview reach is enlarged to match.

New duck and wall-slide concept candidates are saved under
`output/thorg-pose-concepts/` as `duck-green.png` and `wall-slide-green.png`.
They were regenerated from the supplied concepts and canonical body reference
with the built-in image-generation tool, then corrected to opaque green
backgrounds. The wall-slide mace has a straight handle, aligned studded head,
and visible pommel. Exact prompts are in that directory's `prompts.md`.
These are concept deliverables; installed duck/wall sprites are unchanged.

## New attack, jump, fall, duck and collision alignment (September 22)

Imported `thorg_attack2.mp4` (all 22 poses), `thorg_jumping2.mp4` (all 15
poses), `thorg_fall2.mp4` (four poses), and `Duck_new.png`. The importer
normalizes the new 1920×1080 clips onto the existing 1280×720 sampling grid.
Duck's border-connected black background is removed before nearest-neighbor
scaling; dark interior details are retained. The new jump source itself clips
the raised mace in several middle frames; those source pixels are not repaired
or invented. Falling00 reuses jumping14 for an exact transition.

Attack timing remains 70 ms windup, 560 ms strike, and 100 ms recovery. The six
windup, twelve strike, and four recovery poses share their phase budgets. Jump
plays at 45 fps (the same one-third-second game transition as before), and fall
at 8 fps. `src/shared/thorgAttackFrames.json` records measured grip/tip anchors
and timing; the importer regenerates it with the atlas. Both embedded weapon
playback and server damage sample that clock. The new capsule follows the
grip-to-tip segment with a 7-world-pixel radius, rather than sweeping the old
body-centered ellipse. Storm and Iron retain their procedural orbit and its
server collision path.

Thorg's body is 88×106 source pixels, centered at x=64, with its soles at y=118.
Body offsets now use source units with no facing-dependent translation. Client
physics uses Phaser's untrimmed `realWidth`/`realHeight`, matching server geometry
instead of using each cropped image's bounds. Remote Thorg's duck collider also
shrinks around the same fixed foot baseline. This fixes the right-facing offset
and the boots appearing below the platform surface.

## Both-knee duck and wall contact correction

Supersedes the one-knee revision below. `duck.webp` now kneels on both knees
with the mace low across the lap, reducing visible height from idle's 106 px
to 85 px without scaling down the head. `wall-slide.webp` shows separate hands
and two boot soles aligned on the right wall plane. Both replace only their
existing atlas cells. Skin shading is remapped to six tones sampled from idle
to correct the generated lightening. Physics dimensions remain unchanged.

Built-in image generation sources: `exec-7861d245-49d9-4084-8735-2983e7501875.png`
and `exec-549282b4-03a3-44fb-baa6-5eb9fec813f7.png` in generation
`01a0c438-6a6a-75b0-a089-e90b54de5447`. Sources and comparison are saved in
`output/thorg-pose-correction`. Nearest-neighbor scales: duck 0.127, wall 0.121.

Prompt directions: low kneel on BOTH knees, hips seated back onto heels,
broad chest leaning forward, mace low across lap; wall pose with two distinct
short boots, both soles vertical and aligned against the same implied wall,
one hand gripping the mace and the other bracing near shoulder height.
Both prompts requested the reference's darker brown-tan skin, muscular build,
unchanged identity, coarse pixel art, and a transparent background.

## Kneeling and compact wall-pose revision (September 21)

Regenerated only `duck00` and `sliding00` using the built-in image tool and the
video-derived idle reference. Duck now kneels on one knee with the other boot
planted; the wall pose retains a broad torso with bent elbows and compact legs.
The mace remains embedded. Installed sources are `duck.webp` and
`wall-slide.webp`; all other atlas pixels were verified unchanged.

Generated sources: `exec-750ea10d-6d97-43bc-9885-b9295d30662d.png` (kneel) and
`exec-03466ed6-2912-4169-950a-2eaf69eaa445.png` (wall), under generation
`01a0c438-6a6a-75b0-a089-e90b54de5447`. Hard alpha threshold 128;
nearest-neighbor scales 0.125 and 0.132 respectively, chosen to match idle's
helmet width rather than fitting the complete poses to a bounding box.
Both retain baseline 118 on a 128×128 canvas. Comparison and full-resolution
sources are saved in `output/thorg-pose-revision`.

Kneel prompt:
> Regenerate this exact pixel-art Thorg in a low ONE-KNEE KNEEL: one knee rests on the ground, the other boot is planted ahead. Keep his standing-reference head size, wide muscular chest, thick shoulders and thick short limbs; lowering comes from kneeling, not shrinking his body. Hold the same mace across his front with bent arms. Match his neutral face, helmet, beard, outfit, colors and coarse square pixels. Single complete game sprite on transparent background with clear margins.

Wall-pose prompt:
> Regenerate this exact pixel-art Thorg in a compact wall-jump ready pose, facing slightly right. Keep his broad powerful chest and thick shoulders the SAME size as the reference. Bend his short thick legs close beneath his hips with boots toward an implied wall on his right; keep both elbows bent close to his body, one hand holding the same mace across his front and the free palm close beside his shoulder. Match the reference's normal small hands, short boots, neutral face, helmet, beard, outfit, colors and coarse square pixels. Full sprite on transparent background; the wall is not drawn.

## Video-derived base atlas (September 21)

The current base atlas comes from the seven approved `thorg_*.mp4` files in
`public/assets/thorg`, using `scripts/import-thorg-videos.py` (Python with Pillow
and NumPy, plus ffmpeg). The earlier generation notes below describe superseded
base artwork. Source frame indices and scaling live in the import script; atlas
frames also retain `sourceVideo` and `sourceFrame` for review.

The current counts/rates are idle 4 at 4 fps, run 8 at 16 fps, attack 8 with
variable timing, jump 8 at 24 fps, falling 4 at 8 fps, special 7 at 18 fps,
death 12 at 14 fps, and one held pose each for crouch and wall slide.
Wind-up takes two 35 ms poses, strike takes four 140 ms poses, and recovery
takes two 50 ms poses. Long source holds are omitted. The combat duration and
server sweep remain 70 + 560 + 100 ms; the video attack uses that same clock.

All base frames now include the mace. `bbEmbeddedWeapon` marks each frame;
`meta.bbVideoFrames` identifies the atlas so the renderer creates no separate
weapon, finger overlays, or procedural attack trail for it. Older skins use
their original frame counts, timing and separate weapon behavior.

Green is keyed out with hard alpha and edge spill suppression. Each clip uses
one fixed nearest-neighbor sampling grid, never an independent fit-to-box scale
for each pose. Frames retain the logical 128×128 size and foot baseline 118.
Trim offsets allow raised weapons and the extended corpse to render outside
that logical box without clipping or changing collision dimensions. Falling00
is an exact copy of jumping07, including placement. Reusing this transition
between animation states is intentional; no animation repeats a selected source
frame. Character/face changes and the brief white attack trail already in the
approved videos remain part of the extracted artwork.

`duck.webp` and `wall-slide.webp` are generated replacement poses with embedded
maces, matched to the extracted idle reference. Both preserve the neutral face,
helmet, beard and outfit; crouch bends the knees while holding the mace across
the front, and wall slide bends the knees with the free palm toward an implied
wall. Generated sources are `exec-123c4db9-cec5-4768-94dc-da71b9ab03fe.png` and
`exec-86dd39f7-f53b-48f0-9327-fb03b7027eed.png` under Codex generation
`01a0c438-6a6a-75b0-a089-e90b54de5447`. Alpha was thresholded at 128, then the
poses were sampled at 0.116 scale and aligned to baseline 118.

The import script regenerates the atlas, selected-pose contact sheet, timing
previews and selection manifest under `output/thorg-video-import`. The source
videos and the two generated pose WebPs are its complete art inputs.

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

Use the shared [Sprite Workshop](../spritesheet-generator/README.md): run `npm --prefix spritesheet-generator start`, create a project, and import Thorg from the character catalog. Inspect frames, both facings, onion skinning, and loop seams in one viewer. The workshop previews body sprites only; weapon sweeps and rage effects require in-game inspection.

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

## Narrow wall pose and full-length mace correction

Replaced duck and wall sprites again using the built-in image tool. Wall pose
width is now 78 px (previously 107 px), with knees and elbows tucked in and the
mace upright. Duck retains both knees down and holds a full-length mace across
its lap. The pose assets use 192×128 transparent canvases with atlas trim x=-32
and unchanged logical 128×128 dimensions, allowing the weapon to extend without
shrinking the character. Other atlas frames were verified unchanged.

Sources: `exec-02ef8069-4467-42c5-999c-b229ec72b51b.png` (wall) and
`exec-e54ccf32-2b8f-45e6-8b31-2fc629f7fbc1.png` (duck), generation
`01a0c438-6a6a-75b0-a089-e90b54de5447`. Copies and comparison are in
`output/thorg-weapon-pose-fix`. Sampling scales 0.133 (wall), 0.125 (duck);
warm skin pixels darkened by 9% to offset generation lightening.

Prompts: edit wall pose to pull both knees and elbows toward the torso, bring
chest close to wall, keep both soles and palm on one wall plane, and restore
idle-reference full mace head and handle length held upright. Edit duck only
to restore full idle-reference mace length horizontally across lap, extending
beyond knees, preserving both-knee kneel and identity. Both calls used the
installed pose as edit target and extracted idle as weapon/identity reference.

## Restore preferred low duck and clarify wall limbs

Latest replacement restores the 85 px tall both-knee duck with shallow-diagonal
mace, using the earlier preferred source as an edit target. The wall pose uses
separated normal boots, bent legs and the original diagonal studded mace design.
Only duck00 and sliding00 atlas cells changed. Sources and comparison:
`output/thorg-pose-restoration`. Built-in image generation sources:
`exec-f66e17ac-9624-4085-b9d0-5e94b05ed932.png` (duck),
`exec-10eb04de-867c-4031-ad57-ec35da6a31e5.png` (wall).
Both use scale 0.127, hard alpha, baseline 118 and the existing skin correction.

Duck prompt: preserve the earlier both-knee pose completely and enlarge only
the mace to match idle's cylindrical studded design, extending beyond the right
knee at its current shallow diagonal. Wall prompt: three-quarter wall-slide
with two separated small boots on one vertical wall plane, muscular torso,
original full diagonal mace and reference identity. Follow-up: bend both knees,
shorten the boot silhouette and bend the bracing elbow while preserving the
head, chest, shoulders, weapon and gripping hand. Transparent coarse pixel art.

## Tucked concept pose and straight duck mace

Latest wall pose uses the user's supplied old sprite ONLY as a pose concept:
folded knees beneath chest and hands close to ribs. Current idle remains the
identity, weapon and art-style reference. The wall silhouette is 87 px tall
(previous revision 109 px), with helmet width kept close to idle. Duck stays
low on both knees at 86 px and the mace now has a single horizontal centerline.
Only these two cells changed; four atlas/animation checks pass.

Built-in image tool sources: `exec-009b9789-86e0-45b9-9500-47751b197d34.png`
(wall) and `exec-fc216dc4-ab57-4d41-b57c-ecf616bbe156.png` (duck).
Source copies and final comparison: `output/thorg-tucked-pose`.
Sampling scales 0.105 wall and 0.127 duck, with existing 9% skin correction.
Installed outputs remain `public/assets/thorg/duck.webp`, `wall-slide.webp`
and their corresponding atlas cells.

Prompt directions: image 1 defines exact idle identity/style/weapon, image 2
is pose concept only; tightly crunched silhouette with folded elbows, hands
in front and short boots tucked below chest. Duck edit preserves low kneel and
corrects only weapon/gripping fingers; final correction specifies a perfectly
horizontal pommel, shaft, collar and cylindrical head on one straight axis.

## Original palette and larger sliding extremities

Updated both held poses with the built-in image tool using `body.webp` as the
original identity, palette and mace reference. Preserved the low two-knee duck
and tucked wall pose. Sliding hands, boots and mace were requested about 20%
larger; both mace tips use blunt steel end caps. Generated palette is retained
without the previous extra 9% darkening.

Sources and comparison: `output/thorg-palette-refinement`. Duck source:
`exec-c02a9d60-04ae-426a-aea5-da4fe14c1841.png`; wall source:
`exec-1594a6ec-3a61-4f58-ad74-aab9a6724f1d.png`.
Installed in `public/assets/thorg/duck.webp`, `wall-slide.webp`, and only their
atlas cells. Nearest-neighbor scales remain 0.127 and 0.105 respectively,
with baseline 118 and 192x128 transparent canvases. Visible heights: duck 86,
slide 92 pixels. All other atlas pixels were verified unchanged.

Duck prompt: preserve the exact low both-knee kneel and straight horizontal
mace; match original muted warm tan skin, brown shadows, beard and outfit;
restore the blunt steel end cap and short square studs while preserving length.
Wall prompt: preserve tucked pose and head/body size; enlarge hands, boots
and mace about 20%; match original skin/outfit palette and restore original
blunt mace cap, keeping its head and handle straight. Original is appearance
and weapon reference only; preserve crisp coarse pixel art and transparency.

## Full attack recovery and held-pose corrections (2026-09-22)

Attack3 now imports every return-to-idle source frame 38–46, following strike
frames 5–22. Recovery lasts 300 ms; windup remains 70 ms and strike 500 ms.
The 27 atlas frames and shared combat clock total 870 ms. The original embedded
white sweep is preserved.

Duck palette/outline was corrected with the built-in image tool using the actual
idle sprite as the style reference. Master: `public/assets/thorg/sources/duck-green.webp`.
Prompt and installed comparison: `output/thorg-pose-refinement/prompt.md` and
`output/thorg-pose-refinement/installed.png`. Horn span remains 52 source pixels,
foot baseline 118. Wall-slide is mirrored during import so the raised contact
hand points right in the base pose; normal facing logic mirrors it for left walls.

Validation: 41 focused Thorg tests pass; production build succeeds.

## Darker compact wall slide

Revised the wall-slide master using the built-in image tool: darker tan skin,
steel and leather, larger hands/forearms, raised elbow beside the helmet, and
knees/boots tucked together. Import scale is now 52/516 to preserve helmet size;
right-wall orientation and foot baseline 118 are retained. The new source is
`public/assets/thorg/sources/wall-slide-green.webp`; installed into `wall-slide.webp`
and atlas `sliding00`. Other atlas frames are pixel-identical to before this edit.
Prompt and before/after preview: `output/thorg-wall-compact/`.

## Version 3 jump/fall and eight-frame limit

Installed `thorg_jump3.mp4` and `thorg_fall3.mp4` (neutral facial expression).
Jump uses eight poses, fall four with its first pose copied from the jump endpoint.
All base Thorg animations now have at most eight frames: idle 4, run 8, attack 8,
jump 8, fall 4, super 7, death 8, duck 1, wall slide 1. Attack retains one windup,
four sweep and three return-to-idle poses, preserving the 70/500/300 ms phase
budgets and embedded sweep. Death and jump frame rates preserve their prior total
durations. Importer enforces the eight-frame limit.

Wall-slide color was subtly darkened with the built-in image tool; scale increased
from 56/512 to 58/512 (3.6%). Master and installed sprite remain in the same asset
paths. Prompt: `output/thorg-eight-frame/prompt.md`.

## Sweep exception and reference-matched skin

Attack is now the explicit exception to the eight-frame budget: 12 total frames,
with one windup, eight sweep poses and the same three recovery poses. Phase
budgets remain 70/500/300 ms. Other animation frame counts are unchanged.
Wall-slide skin was matched to actual idle00 golden tan rather than globally
darkened. The installed atlas was reviewed beside idle and duck at the same
scale; comparison and exact built-in image edit prompt are in
`output/thorg-sweep-palette/`. Wall-slide size and orientation are unchanged.

## Direct user PNG import and alpha preservation

Held poses now import directly from `public/assets/thorg/thorg_duck.png` and
`public/assets/thorg/thorg_slide.png`. Preserve source alpha alongside green
keying: discarding alpha revealed erased artwork, including the rear mace.
Existing scales (52/540 duck, 58/512 slide), baseline and facing are retained.
No generated replacement is installed. Verified installed slide visually and
ran the nine asset/geometry tests successfully.
