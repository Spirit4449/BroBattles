# Draven: code-drawn pixel art

Run from repository root. Everything renders from code; nothing reads a raster
except `pixels.cjs`'s original transcription.

```sh
node scripts/art/draven-pixel/idle.cjs              # previews -> output/draven-pixel/rig/idle/
node scripts/art/draven-pixel/run.cjs
node scripts/art/draven-pixel/attack.cjs            # staff sweep + smoke wraith effects
node scripts/art/draven-pixel/actions.cjs [name...] # jump fall sliding hit special dying duck dash*
node scripts/art/draven-pixel/sheet.cjs [--install] # game sheet -> output/draven-pixel/sheet/
```

Same technique as Sparrow (`scripts/art/sparrow-pixel/`), with the renderer
shared in `scripts/art/pixel-rig/rig.cjs`:

- `pixels.cjs`: the 64x64 palette-indexed transcription of
  `public/assets/draven/body.webp`, the style reference.
- `puppet.cjs`: that art split into 12 posable part maps (robe, torso, hood,
  back arm and hand, front arm, grip, staff, magic, crystal, two shards) with
  named joints. Edit pixels here.
- `pose.cjs`: the rig instance, `figure()` (the standard skeleton from a few
  angles: lean, arms, staff, robe length/spread/sway, magic offsets, recolour
  swaps) and the preview writer (frames, strip, 6x GIF, contact sheet).
- Parts move by affine transforms or warps; the rig resamples them
  RotSprite-style (Scale2x x8) and rebuilds a clean 1px outline, so rotated
  parts stay pixel art. Faces and crystals only translate.
- Motion follows the legacy animations (`legacy/`), redrawn in this style:
  each script's header lists the beats it copies. `smoke.cjs` paints the
  staff's smoke flame and the effects (wisps, sweep smears, the wraith, the
  special's crescent, the death burst, dash speed lines) in the magic palette.
- Beyond the legacy set: a second wall-slide frame, `duck00` (the crouch,
  `hiResArt.duckFrame`) and `dashright`/`dashdiagonal`/`dashup` (3 frames each
  over the 160 ms dash), packed in rows below the legacy grid.
- `attack.cjs`: the attack follows the legacy beats (wind-up coil, sweep smear,
  red-eyed smoke wraith, shredding streaks). Its effects are painted on the art
  grid in the magic palette with an outline and rim light, on a 176px canvas
  so the wraith fits ahead of him.
- `sheet.cjs`: packs every animation in the legacy atlas order (frame names
  from `legacy/animations.json`, the pre-code sheet kept for reference). Cells
  are 207px at `hiResArt.scale` 1.4493, so the frame keeps the legacy 300 world
  px (the Inferno overlay sizes from it) and one art pixel is ~1.45 world px,
  the legacy figure's height. `hiResArt.json` and `rig.json` it writes must
  match `src/shared/characters/draven.json`.

Rates come from `src/client/game/characters/draven/anim.js` (idle 6 fps).

## Effect atlases (`fx.cjs`)

`node scripts/art/draven-pixel/fx.cjs [--install]` draws the Inferno overlay
(`special-bb*`, 24-frame loop designed on a 192px square inside 288px frames) and the splash hit
explosion (`explosion-bb*`, 10 frames on a 48px grid) in palette keys,
coloured per team. Previews and GIFs go to `output/draven-pixel/fx/`;
`--install` writes the atlases into `public/assets/draven/`. Both play at
24 fps (see `characters/draven/constructor.js`).

## Inferno sound layers (`inferno-sfx.cjs`)

`node scripts/art/draven-pixel/inferno-sfx.cjs [--install] [--check]` synthesises
`inferno-{ignite,crackle,pulse,hit,end}.mp3` and prints each one's loudest-200 ms
K-weighted volume for `combatSoundVolumes` in `game/audio/playerAudio.js`
(`--check` prints the same for the existing Draven sounds). They are played by
`characters/draven/infernoAudio.js`.
