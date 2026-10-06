# Animated card sources

Each card's static image, poster, WebM, and MOV live in its own `<card-id>/`
directory. Catalog URLs and art import scripts use the same directory layout.

The user supplied these videos for installation on 2026-10-06:

- `Animating_steel_battle-card_frame_1080p_20261006003230.mp4`: Default Card, six seconds.
- `Animate_royal_battle_card_frame_20261006003312.mp4`: Crown of the Arena, eight seconds.
- `Animate_ninja_battle_card_frame_20261006003442.mp4`: Slime Circuit, six seconds (identified by artwork, despite its filename).
- `Animate_pixel_art_battle_card_20261006005613.mp4`: Shuriken Strike, six seconds.

The original videos stay outside the published assets. Recreate the `*-animated.webm`
and aligned `*-poster.webp` files with `scripts/art/import-player-card-videos.cjs`.
Exports are silent, transparent, source 24 fps, and loop when the player requests it.
Steel retains its 540×960 canvas; royal is cropped to 400×800 from the
540×960 scaled source, starting at (70, 80). The crop trims outer sparks and
padding while retaining the card frame and main crown effects.
All 144 steel / 192 royal frames are retained.
The catalog's `animationViewport` preserves battle card/content alignment while
allowing the effects to extend outside the layout rectangle. The
green background is keyed out; the dark central panel remains part of the art.
The original static masters remain available as `default.webp` and
`arena-crown.webp`. Catalog IDs and ownership are unchanged.

## Final exports

Only the installed WebM, Safari MOV, and aligned poster exports are retained.
The superseded animated WebP files and six comparison videos were removed.
WebM uses the approved balanced steel (CRF 30) and small royal (CRF 42)
settings. Exact video byte sizes are
recorded in the catalog. Original static masters remain referenced by fallback
UI and Trophy Road rewards.

Encoded directly from the original MP4s with FFmpeg `libvpx-vp9`, `-b:v 0`,
`-deadline good -cpu-used 2 -row-mt 1 -threads 2`, and no audio. Steel uses
`format=rgba,colorkey=0x46ce00:0.3:0,despill=green:mix=1,scale=540:960:flags=neighbor,premultiply=inplace=1,format=yuva420p`.
Royal uses the same key and nearest-neighbor scale, adds
`crop=400:800:70:80` before premultiplication, and omits global despill as
described below.
Its catalog viewport subtracts the crop offset and uses an 800×1600 canvas
at the original source-coordinate scale, keeping card content aligned.
Safari/Apple uses the corresponding `*-animated.mov` HEVC-with-alpha files,
encoded with `hevc_videotoolbox`, no B frames, `hvc1`, and faststart.
Steel uses `alpha_quality=1`, one-second keyframes, and a 350 kbit/s target.
The approved smaller royal export uses `alpha_quality=0.6`, a 192-frame
keyframe interval, and a 360 kbit/s target. The renderer verifies decoded
alpha before exposing any video, so unsupported decoders retain the poster.
`animationAppleBytes` records the actual Safari file sizes in the catalog.

The 2026-10-06 royal crop reduces WebM from 945,863 to 800,425 bytes and
Safari MOV from 1,605,463 to 1,108,529 bytes. Its aligned poster decreases
from 33,370 to 32,582 bytes. Savings at that stage: 643,160 bytes (24.9%).
The subsequently approved stronger Safari export is 767,181 bytes, saving
another 341,348 bytes (30.8%) versus the cropped Safari file. Combined crop
and Safari compression savings across royal WebM, MOV, and poster are
984,508 bytes (38.1%) versus the original installed exports.

### Royal green-screen repair

The moving geometric outlines near the bottom revealed green screen that had
survived the earlier export. Reimport royal with `--card arena-crown` to key the
source throughout all 192 frames, then clear remaining pixels whose green
channel exceeds red by 28 and blue by 30. Royal skips global despill because
it changes the gold frame and cyan outlines. Fully transparent RGB is cleared
before encoding. The aligned poster uses WebP quality 92 and lossless alpha.
The repaired WebM is 720,865 bytes, Safari MOV 706,805 bytes, and poster
41,648 bytes. Both videos retain the 400×800 crop, 24 fps, and transparency.

## Slime Circuit and Shuriken Strike

Import either new source independently:

```sh
node scripts/art/import-player-card-videos.cjs --card slime-circuit <slime-source.mp4>
node scripts/art/import-player-card-videos.cjs --card shuriken-strike <shuriken-source.mp4>
```

Both retain all 144 frames at 24 fps on a 540×960 canvas, with aligned WebP
posters, VP9 alpha WebM (CRF 30), and HEVC alpha MOV (500 kbit/s target).
Audio is removed. Their catalog viewports align the visible frame with the
existing card layout. IDs, costs, unlocks, and original static masters remain.

Slime uses Sharp from the Sprite Workshop dependencies to flood-fill only
background-connected pixels within RGB distance 95 of `#46ce00`. Global
green keying/despilling would erase its green face, gems, and circuitry, so
these enclosed details retain their original colors. Shuriken uses global keying
and despill because its red/steel artwork has no intentional green. Boundary-only
cleanup left compressed screen-green fringes; the repaired exports retain all 144
frames and use the same canvas and viewport. The importer stages all three
exports before replacing installed assets, so an Apple encoder failure cannot
truncate the published MOV.

## October 2026 shop expansion and wood default

`output/art/New Player Cards/` preserves the user-supplied originals outside
the published asset tree (and is ignored by Git). Folder names are the
card names, PNG basenames are rarities, and MP4 basenames are ignored.
`Default/default.png` is the static wood default. The former steel default is
installed as Radiant Silver (`radiant-silver`), a common shop card; its existing
video and poster exports are reused without re-encoding.

Run `node scripts/art/install-new-player-cards.cjs` to recreate the batch.
`scripts/art/new-player-cards.json` records source folder mappings, prices and
animation viewports. Most viewports align their visible frames with the default
wood card. Wizard Spell, Astral Amethyst, and Mjolnir's Anvil use tighter
viewports so their ornate frames appear larger in battle, profile, and shop.
Common cards, including the radiant series and wood default, use `renderScale`
to appear five percent smaller in cosmetic previews while keeping their frames
centered. Battle cards use `battleViewport` to fit the visible artwork with one uniform
scale, preserving proportions. All frames get a 10% reduction except Shuriken Strike at 5%, centered in the same box. Posters and videos use identical geometry.
Cards with intentional green use background-connected keying. Wizard Spell,
Mjolnir's Anvil, and Astral Amethyst use full-frame keying and excess-green
despill (`mix=0`), removing enclosed screen green and spill in glowing effects
while retaining cyan highlights. Most exports use 540×960, VP9 CRF 30, HEVC
alpha quality 0.8 at 400 kbit/s, silent 24 fps, and aligned first-frame posters.
Amethyst's higher-quality settings are described below. Radiant Ruby
retains 192 frames (eight seconds); the other six retain 144 (six seconds).
The source PNGs also have static WebP masters and smaller shop banner copies.
The installer archives the upload folder outside public assets when finished;
Webpack also excludes pending uploads and `.DS_Store` from published assets.

| Cards | Rarity | Gems |
| --- | --- | --- |
| Radiant Silver, Diamond, Emerald, Gold, Ruby | common | 25 |
| Mjolnir’s Anvil, Wizard Spell | rare | 50 |
| Astral Amethyst | legendary | 200 |

All eight paid cards join the existing Sales promotion rotation and Profile
shop catalog. Shuriken Strike also uses the rare price of 50 gems. Trophy Road
cards retain their unlocks. The free `default` ID now displays wood, with no
animation; existing default ownership and selections need no database migration.

### Stronger video background cleanup

Exports with intentional green retain the background-connected key, then remove
screen-colored compression fringe within two output pixels of the transparent
exterior. The edge check targets yellow-green spill and protects cyan/emerald
highlights. This is applied before encoding both WebM and Apple MOV, and before
writing the aligned poster. The three non-green cards called out above now use
full-frame cleanup instead. Current
byte sizes are in the catalog; earlier size notes above describe older exports.

### Astral Amethyst and static card compression

The earlier 540×960, CRF 42 Amethyst export was too compressed. The subsequent
1080×1920, CRF 20 export improved quality but made the WebM 4,755,863 bytes
and the Safari MOV 2,785,098 bytes. The current 720×1280 exports retain all
144 frames at 24 fps, use VP9 CRF 36 and HEVC alpha quality 0.8 at a 900 kbit/s
target, and keep the same proportional display viewport. The WebM is now
1,740,873 bytes and the MOV is 1,141,138 bytes. The aligned first-frame poster
uses WebP quality 92 with lossless alpha and is 63,962 bytes, down from the
357 KB lossless poster. `new-player-cards.json` retains these settings for
future imports. Full-frame keying still removes green caught inside Amethyst's
particle bursts and Wizard Spell's orb.

All twelve static card WebPs use `cwebp -q 80 -m 6 -alpha_q 100` when that
produces a smaller file. Together they shrink from 1,417,202 to 1,075,100
bytes. Dimensions and decoded alpha pixels are unchanged. The trophy art
regeneration script uses the same preset for `slime-circuit.webp` and
`arena-crown.webp`; other trophy outputs retain their lossless preset.

### Shop cover composition

Standalone card offers use a generated, themed 960×400 background plus the
original static card as a separate DOM image (`shopAssetUrl` in the card
catalog, serialized as `shopImage` on the shop grant). The card uses its
intrinsic aspect ratio and `object-fit: contain`; the background can fill a
wide offer independently. No AI-redrawn card is used in the final cover.
The ten background prompts are recorded in
`docs/art/shop-card-cover-prompts.json`; generation used the built-in ImageGen
tool with the Bro Battles art guidance. Reimporting videos preserves covers.
