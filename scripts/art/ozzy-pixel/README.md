# Ozzy: code-drawn pixel art

Run from repository root. Same technique as Sparrow and Draven
(`scripts/art/sparrow-pixel/`, `scripts/art/draven-pixel/`), with the renderer
shared in `scripts/art/pixel-rig/rig.cjs`.

```sh
node scripts/art/ozzy-pixel/idle.cjs               # previews -> output/ozzy-pixel/rig/idle/ (the original code idle)
node scripts/art/ozzy-pixel/idle-video.cjs <clip.mp4> [--install]  # the shipped idle: cleaned frames of a breathing clip
node scripts/art/ozzy-pixel/run.cjs                # the original code run (previews)
node scripts/art/ozzy-pixel/run-video.cjs <clip.mp4> [--install]   # the shipped run: one cleaned stride of a running clip
node scripts/art/ozzy-pixel/attack.cjs
node scripts/art/ozzy-pixel/actions.cjs [name...]  # jump falling sing special dying
node scripts/art/ozzy-pixel/sheet.cjs [--install]  # game sheet -> output/ozzy-pixel/sheet/
node scripts/art/ozzy-pixel/compare.cjs run running # onion-skin vs the legacy frames
node scripts/art/ozzy-pixel/grid.cjs attack         # legacy frames on the art grid
```

- `pixels.cjs`: the 64x64 palette-indexed transcription of the original
  `public/assets/ozzy/body.webp` (since replaced by a high-detail body), the
  style reference (`transcribe.cjs`, run once).
- `puppet.cjs`: that art split into posable parts (staff, fist, near and far
  arm, book, head, torso, coat panels, legs and boots), plus pose-only template
  limbs (straight arms, a striding leg and its darker far copy) and the satchel
  the book becomes in action. Edit pixels here.
- `pose.cjs`: the rig instance and `figure()`, the skeleton every animation
  poses: lean, head, arms (angles or IK to a hand position), staff hand and
  angle, legs (rest, angles or IK to an ankle), coat swing, book/satchel.
- `fx.cjs`: painted effects in the violet palette of the super's code effect
  (the code-drawn super cast effect, since replaced by the super clip's own flames): staff flame, orbs, the blast, smoke,
  the swing arc, crystal shards, loose pages.
- Motion follows the legacy animations (`legacy/`, the pre-code sheet): hand,
  foot and staff positions were read off `grid.cjs` and each script's header
  lists the beats it copies.
- `sheet.cjs`: 128px cells at `hiResArt.scale` 1.3984 (one art px is 1.52
  legacy px at the legacy spriteScale, so the figure keeps its on-screen size).
  It also measures the rig points off the posed frames; `hiResArt.json` and
  `rig.json` it writes must match `src/shared/characters/ozzy.json` for the
  code-drawn frames still shipped (dying, dashup).

The shipped throws (level and four aimed), directional dashes, jump, fall
and super come from `actions-video.cjs <clip folder> [--install]`, which
picks frames out of one-shot clips (its header lists each pick and why),
re-centres the dash and air poses, and writes the throws' staff tips into
`ozzy.json`. The fireball muzzle is the level throw's staff tip on its
release frame (attack06). The straight-up dash is still the code-drawn one.
The super's `special`/`surge` staff-tip tracks follow the staff's fire: the
surge's beams and burst leave from it (`characters/ozzy/effects.js`).

The crouch (`duck00`) and wall slide (`sing00`–`sing07`) come from generated stills
drawn over the idle at 8 px per art px on #FF00FF
(`output/ozzy-pixel/gen/`): `poses-image.cjs <folder> [--install]` snaps
them to the art grid and the idle's palette and stands them on the ground /
against the wall. The slide animates a ripple through the cape at 10 fps while
the wall-facing side and feet stay planted. The body art (`public/assets/ozzy/body.webp`, lobby and
portraits) uses the original body with a dark purple cape. Install it with
`install-body.cjs output/ozzy-pixel/gen/body-cape.png --base output/ozzy-pixel/gen/body-original.webp`; rebuild portraits afterwards with
`node scripts/art/build-portraits.cjs`.

The shipped idle and run come from `idle-video.cjs` and `run-video.cjs`, which
keep the clip's own pixels and clean them (`video-clip.cjs` lists the steps;
each wrapper holds its clip's loop bounds and frame step). The run clip opens
on the rest pose, so its loop is searched from source frame 20 on.
`sheet.cjs --install` packs the code idle and run instead, so rerun both
video imports with `--install` after it.

The older `build.cjs` / `import.cjs` / `master.txt` / `source/` are an earlier
preview-only idle experiment from a different master and are not used here.
