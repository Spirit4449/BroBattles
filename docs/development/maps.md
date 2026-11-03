# Maps and Map Studio

Every map is built for exactly one game mode: `duels-1v1`, `duels-2v2` or `bank-bust-3v3`. A map's `modeVariantId` decides which lobby selection lists it. A mode with no maps shows as "Coming soon" in the party menu.

## Modes and arenas

Each mode's world size and match camera live in `src/shared/maps/arenas.json` (read through `src/shared/maps/arenas.js`). All maps of a mode share them, and a map cannot override them, so every map of a mode plays and frames the same way.

- `world`: the physics bounds.
- `camera`: the follow camera's bounds (`x`, `y`, `width`, `height`), its dead zone and `followOffsetY`.
  - `zoom` is the reference zoom that scenery is composed at.
  - The live zoom eases from `maxZoom`, with the player at or below `climbY[1]`, to `minZoom` at or above `climbY[0]`. See `restingCameraFrame` in `cameraDynamics.js`.
  - The follow bounds extend 80 px past each side of the Duels 1v1 and Bank Bust worlds, giving players more camera tracking near the edges. Duels 2v2 retains a 90 px side inset to keep edge art out of view. Every mode's bounds also allow the camera to track above and below the physics world.

To give a new mode maps, add its variant id (from `gameModes.catalog.json`) to `arenas.json`. Retuning a mode's camera or size there changes all of its maps.

## Map Studio

Admins can open Map Studio using the Edit map action inside the lobby map selection menu, or visit `/map-editor`. Editing runs separately from matchmaking. The toolbar shows the map's mode. **New map** asks for the mode, and its spawns are sized to the mode's team size. Player slots stay fixed to that formation.

Admin map cards place the Edit map action in the top-left corner of the preview. Hitbox debugging is controlled inside Map Studio; the lobby does not set or pass that preference to the editor.

### Editing controls

- Click to select without moving. Shift-click toggles objects in the selection; drag empty space to box-select. Drag a selected object to move the group.
- Drag corner or edge handles to resize. Proportions are preserved by default; hold Shift for free resizing. Size fields also preserve proportions unless Shift is held when the change is applied.
- Tab switches a platform between green artwork handles and orange collision handles. Collision handles change the solid boundary without stretching the artwork.
- Grid and alignment guides help with placement. Hold Command (macOS) or Control to bypass snapping. Player spawns still require a safe, walkable platform.
- Space + drag, middle drag, or right drag pans. Scroll zooms; F fits the world. Arrow keys nudge the selected object; Shift increases the nudge to 16 pixels.
- C toggles **Game camera**: live scenery (parallax, drifting clouds, atmosphere) framed by the mode's camera bounds and zoom range, as in a match. The overlay outlines the camera bounds.
- Command/Control Z undoes; Command/Control Shift Z or Control Y redoes. History keeps 250 document states, including settings and scenery, while retaining the Phaser scene and camera.
- D duplicates; Delete removes. A platform supporting a player spawn cannot be deleted until its markers are moved to another platform.
- Escape opens a real game playtest. Choose Solo or With bots and a character first. Escape in the playtest returns to the editor. Controls/tutorial overlays stay hidden; the actual GameRoom, movement, combat, bots, objectives, effects, and powerups run in an isolated admin session. Playtests expire after an hour and do not award rewards or create matchmaking records.

Powerup markers can be placed anywhere. Editing or dragging an older anchored powerup turns it into a free point; its coordinates are used directly by the server. Player markers always stay anchored.

The World tab shows the mode's arena (read-only) and edits powerup rules and catalog presentation. Less common controls are inside expandable Advanced sections. Pixel fields display whole numbers; percentage fields expose values such as opacity without requiring decimal entry. Scale factors and coordinate conversions retain the precision needed to keep artwork and physics aligned.

The Scenery tab edits the backdrop (see [Scenery](#scenery-parallax-and-atmosphere)): layers in back-to-front order, the cloud switch and the atmosphere settings. Clouds are canvas objects: add one from the add menu, then drag it, duplicate it or set its type, direction and speed in the inspector.

### Artwork and animations

The Assets tab is a library of reusable platform artwork. **New platform artwork** registers an image and places a platform. Still images require only an image URL; dimensions are read automatically. Animated platforms use either an image with equal-sized frames or an image plus a JSON frame file. Animated artwork additionally exposes frame dimensions, frame numbers/names, and playback speed. Atlas frames must currently be untrimmed, unrotated, and equal-sized.

URLs must point under `/assets/`, corresponding to `public/assets/` in the repository. Dropping a PNG, WebP, or JPEG onto an artwork card (or choosing **Replace image**) stages a replacement, updates matching references across the document, and preserves platform size and collision placement. Animated image replacements retain their animation/frame configuration and are validated when saving or starting a playtest.

**Save map** publishes uploaded artwork to its game asset path and updates the production `dist` copy if present. Uploaded images are also stored at immutable revision URLs so existing matches retain their artwork. A failed document save restores any overwritten artwork. Files must be at most 8 MB and 16384 pixels per dimension.

**Export** produces a portable JSON document. Image files are not embedded. If artwork was uploaded, an export dialog lists every game file that must be copied manually, including uploads that have already been saved. Keep the replacement image files alongside your export.

## Persistence and deployment

Built-in documents live in `src/shared/maps/{id}.json`. The backend reads saved overrides from `data/maps/{id}.json`, or from `BB_MAP_DIR` if configured. Back up that directory and `public/assets` together and keep them writable/persistent on the server. Generated asset revisions, map history and match snapshots are runtime data excluded from Git. Saved overrides take precedence over built-in documents.

Each save validates the document and its image/frame files, checks the revision to reject stale writes, and atomically replaces the document. Previous document revisions are retained in `history/{id}/`. Browser drafts recover unsaved edits; a stale draft must be exported and merged with the latest document before saving.

New maps are discovered by the lobby catalog without adding JavaScript modules. Matches receive a fixed document/artwork snapshot when first loaded, so later saves apply to new matches. Production additionally persists match snapshots across server restarts.

## Document format

The format is data-only JSON, validated by `src/shared/maps/mapDocument.js`. Start from an exported document or clone a built-in document, keep `schemaVersion: 2`, and preserve stable object IDs. A document contains:

- `id`, `label`, `modeVariantId` and `metadata` (presentation: previews, lobby background, music).
- `layout.platforms`, `layout.hitboxes`, `assets`, `textureSizes`, `anchors`, `spawns`, `powerups` and `scenery`. Bank Bust maps also need `objectiveLayout.bankBust`.

### Iron Junction is generated, not hand-edited

Map 4 is written by `scripts/maps/build-iron-junction.cjs`, which emits both
`src/shared/maps/4.json` and `data/maps/4.json`. Authoring it in code is what
keeps the two halves exact mirrors and keeps every surface's height honest: the
generator places artwork by the surface you want to stand on and works the
sprite offset out itself. Edit the script and re-run it rather than editing the
JSON; a Map Studio save will win at runtime and silently diverge from the
source.

#### Art drawn in code

`scripts/art/bake-iron-junction.cjs` paints the platforms, walls, vault, mine and
buildable walls on a 4-world-pixel grid from one palette, so they share a pixel
size and colours. Nothing is scaled at runtime.

Solid ground is painted from the union of all solid rectangles rather than
stamped per block. A pixel with air above becomes walking surface and a pixel
with air beside it becomes an edge, so stairs get real treads and risers with no
slices to line up, and touching blocks share one brick grid. That grid is folded
about the centre line, which makes the right half an exact flip of the left. The
walking surface and horizontal brick courses are deliberately one-way-up: the
earlier frame looked the same from all four sides and read as a rotated panel.

Because art is baked to the geometry, building is two passes:

```
node scripts/maps/build-iron-junction.cjs     # writes iron-junction-shapes.json
node scripts/art/bake-iron-junction.cjs       # bakes one image per shape
node scripts/maps/build-iron-junction.cjs     # measures them and writes the map
node scripts/maps/check-iron-junction.cjs     # always
```

#### The shape of the level

Three storeys, about 300px apart, and a tunnel under them. HIGH is jump-through catwalks: two balconies carrying
the mine and turret, split by a hatch directly over the vault, then one long deck
towards the middle and a centre deck over the hill. MID is the top of the base, one jump-through lane, and the top of the hill.
FLOOR is one flat run between the stairs, broken only by the hill in the centre.
A full-height side wall closes each end of the level.

The tunnel joins the two low points, with an S-bend at each end so that falling
down a shaft does not put you in it. A shaft opens in the floor on each side of the
hill, jumpable if you want to stay up, and drops onto a shelf. A low passage runs
back under the lower treads of the stairs, off the end of the shelf, and into one
flat run under the hill. Back out is a solid step at the end of the run, then a
one-way ledge in the shaft.
The low wall slot sits on the lip between the stairs and the shaft, so it shuts
the floor and the tunnel together.

The tunnel's darkness is a front layer (`tunnel-shade.webp`) baked to the shape of
its air, with a soft hole cut under each lamp. It covers fighters but not the ground
around it, so a fighter is dim in the dark and fully lit under a lamp, on every
graphics setting. `atmosphere.lamps` adds the visible glow over that on High and
Super High. If you move a lamp, re-run the bake or its hole stays behind.

The mine and turret are drawn by the bake as short spritesheets, one file per owner.
The mine's coin count is written onto the brass plate in its art, at the spot
recorded in `propFrames.json`, which the bake writes. A turret's motion
is client-side on top of the server's aim: unclaimed it droops, claimed it sweeps
until it has a target, and it kicks back with a muzzle flash on each shot.

Backdrop layers can carry `parts`, looping sprites pinned to a spot on the image.
`scripts/art/install-iron-junction-backdrop.cjs` cuts the cog, crane hook, valve
wheels and lamps out of the painted layers, replaces the painted smoke, and writes
`iron-junction-parts.json` for the build. Most of these loops hold still for a while.

A few animated pieces sit in the walls (`DECO_PLACES` in the build script): a
clock, a coin chute, a furnace grate, a fuse box, a rat and a leaking
valve. Each is different and used once, and most of each loop is still; keep it that
way, because a wall of moving things reads as noise. They are four-frame strips
painted by Codex's `image_gen` into `output/bank-bust-art/v5`, installed by
`scripts/art/install-iron-junction-deco.cjs`, which lines the frames up and reduces
them to a 2px grid. The build refuses a placement that is not inside solid ground,
unless it is marked as hanging on the tunnel's back wall. About one brick in ten
also carries a static patch, crack, rust stain or chip, chosen by a hash so it stays
put and mirrors exactly.

- **Climb.** Every storey is three big hops. Solid steps rise 96px, which keeps
  their faces under `wallMinFaceHeight` so they do not catch a wall slide, and
  ledges rise 100px. A jump peaks near 120, so none of them needs a perfect jump.
- **Routes.** Each side has two climbs of two ledges from MID to HIGH, one beside
  the base and one beside the hill. Decks and ledges are one-way, so they never seal the
  ground beneath them.
- **Clearance.** Solid ground never runs under a deck, and ledges sit in the gaps
  between decks, so drawn pieces do not collide.

A buildable wall is an upright 48x96 bulkhead. It is deliberately about a jump
high: walls have no health, so a taller one could lock a team out of a base.
Built walls stop every player, the builder's team included, through
`getMovementBlockers` on the mode (the client collides every player with them;
bots read them through `movementGeometry` in `src/server/core/bots/physics.js`).
They stop only the other team's shots, through `getShotBlockers`, so the
builder's team fires through its own walls. Terrain-colliding shots read them
through `shotTerrain`; linear shots ignore terrain and test them directly.

The **firing perch** is a ledge one step above the balcony on the enemy's approach
to each vault. Decks stop shots, so from the deck the hatch hides the vault, but
from the perch you can fire down through it, standing at its hatch end. The answer
is the **hatch wall**, a 168px slot on the lip between perch and hatch. It is the one tall wall, because it
has to stop a shot from someone jumping on the perch and because the hatch is
never the only way into a base. The auditor checks both halves: the hatch end of
the perch has a line to the vault, and the built wall cuts all of them.

#### The auditor

`scripts/maps/check-iron-junction.cjs` audits the result against
`movementPhysics.json`: rise and gap limits, reachability from the spawns in both
directions, mirror symmetry, world containment, and that spawns and objectives
have somewhere to stand. Run it after any change to the level.

- Platforms use center `x/y`, a `textureKey`, positive `scaleX/scaleY`, optional collision settings and a `body`. Body width/height are world pixels; offsets are unscaled texture pixels measured from the artwork's top left.
- A platform may add `motion` to move (see [Moving platforms](#moving-platforms)).
- `spawns.players.team1` and `team2` each list exactly the mode's players per team. A slot contains `anchorId`, optional horizontal `dx`, and optional `dropHeight`. Free powerups contain an `id`, `x/y`, optional `type`, and optional `enabled`.
- Documents never contain world or camera bounds; those come from the mode's arena.

`retargetMap(document, modeVariantId)` in `src/client/editor/editorModel.js` moves a document to another mode. It resizes the spawn lists and adds or drops objectives. That module also exposes the snapping, resizing, replacement, and export operations used by the GUI.

Use `validateDocument(document)` before importing. The server additionally validates local asset dimensions and animation frames. `geometryFromMap` is the shared collision contract.

Authenticated admin endpoints:

- `GET /api/admin/maps`: list maps, their modes and revisions.
- `GET /api/admin/maps/:id`: retrieve `{document, revision}`.
- `PUT /api/admin/maps/:id`: send `{document, revision}`. Use `revision: null` for a new ID. A stale revision returns 409; validation errors return 422 with field paths.
- `POST /api/admin/maps/upload`: stage `{targetUrl, fileName, base64}`; use its returned `url`, `targetUrl`, `width` and `height` for the replacement.

For manual JSON changes, import in Map Studio and Save, or use the authenticated API so validation and revision checks run. Do not modify a live match snapshot.

Verification: `node --test tests/mapEditor*.test.js tests/mapDocumentRuntime.test.js` and `npm run build`.

## Moving platforms

Select a platform and tick **Moving platform** in its Movement section. Choose **Up and down** or **Left and right**, how far it travels, its speed and its ease. Under Timing, set the pause at each end and a start offset that staggers platforms sharing a rhythm. The canvas draws each moving platform's path, its far end and a live preview. Drag the round handle at the far end to set the travel distance; the grid applies unless you hold Command or Control.

In the document this is `motion: { axis: 'x' | 'y', distance, speed, ease, pauseMs, phase }`. `x`/`y` stay the rest position. `distance` is signed world pixels (negative goes left or up). `speed` is the average pixels per second of one leg, so eased platforms move faster mid-way. Eases are `linear`, `sine`, `quad`, `cubic`, `quart` and `expo`; each eases in and out of both ends. `phase` is 0 to 1.

A platform's position is a pure function of server time (`src/shared/maps/platformMotion.js`). The client reads the synchronized server clock, so every player sees the same platform and nothing extra is replicated. Rules that follow:

- Moving platforms cannot hold player spawns or anchored powerups; validation rejects them and spawn snapping skips them.
- A moving platform's colliding faces behave like any wall. Walking into a side stops you; dashing up into a blocking underside bonks you back down. A player is stopped only at a face they actually crossed during the physics step, and only if that face collides, so jumping up through an open underside (Block from below off) passes through even with the sides on, and you land on top coming back down. Crossing a side with your feet within `PLATFORM_STEP_UP_PX` (10) of the top steps you onto it (`resolveOverlap` in `src/shared/physics/sweptCollision.js`).
- A platform carries players standing on it and pushes players its own travel runs into (only with a colliding leading face), swept against other solid ground. When that ground would trap a player (a ceiling above a lift, a wall beside a sliding block, the floor under a descending one), the platform passes through them instead of crushing them. The client (`src/client/game/maps/movingPlatforms.js`) and the server's bot physics (`carryOnPlatforms` in `src/server/core/bots/physics.js`) apply the same rule.
- Leaving a moving platform gives no extra speed: a jump or step off moves only at the player's own speed.
- Ducking still stops you at a moving platform's edges, like static ground. The edge guard re-reads the live ground every physics step, so it follows the platform and lets go when the ground leaves.
- Remote players standing on one are shifted by the platform's travel over the interpolation delay so they do not slide.
- The server advances platform colliders every tick (`src/server/core/gameRoom/movingPlatforms.js`), so projectiles and ground checks use current positions. Ninja projectile prediction and Gloop slimeballs move platforms to the same times on the client.
- Bots plan routes over static platforms only. Every jump, dash and landing preview forecasts platform motion, so bots also jump onto moving platforms deliberately. A bot riding one edges toward its goal and leaves by the first hop, wall climb or dash that the forecast proves lands on static ground. In the air on these maps, bots steer toward a landing the forecast proves.
- Server movement budgets add the fastest platform speed on each axis. Dash collision checks on the server skip moving platforms, because the client saw them at an earlier time.
- Keep moving platforms clear of paths that would squeeze players between them and other ground unless that is intended; squeezed players drop through the platform. Avoid placing them where flight abilities usually end (Draven's Inferno, Ninja's super), because a bot or player may come down after the platform has moved away.

Checks: `node --test tests/movingPlatforms.test.js tests/ducking.test.js tests/mapEditor.test.js`, and `npm run test:slow` after changing bot behaviour. `tests/helpers/arcadePlatforms.js` runs the real Arcade bodies and client runtime headlessly for new movement cases.

## Scenery (parallax and atmosphere)

Every map's backdrop renders inside Phaser from its required `scenery` block, which has at least one layer. A map with a single flat background has a single `background` layer. Candy Land (`src/shared/maps/5.json`) is the full example. Edit scenery in Map Studio's Scenery tab or in the JSON.

- `layers`: art images, listed back to front. `scroll` is the parallax factor: 0 is fixed to the screen, 1 moves with the arena, and above 1 is foreground drawn over fighters (under their HUD). `x`/`y` are offsets in world units from the camera bounds centre. `fit` controls size:
  - `"cover"` (the default) scales the layer so no edge shows at any zoom or camera position in the mode's range, so nearer layers display larger.
  - `"cover-x"` only guarantees the width, for horizon strips that leave sky above or ground below.
  - `"none"` uses `scale` as given.

  `fog` (0 to 1) hazes everything behind and including that layer toward `atmosphere.fogColor`; the haze is heavier toward the ground. `blur` records how many pixels of blur are baked into the image. The game never blurs at runtime; the importer applies it.
- `stack` on a layer sets its depth: `"back"` (behind the platforms; the default up to `scroll` 1), `"arena"` (over the platforms and everything placed `after: "arena"`, under the fighters) or `"front"` (over the fighters; the default above `scroll` 1). A layer with `scroll: 1` stays fixed in the world like the platforms.
- `frame` on a layer (`{ width, height, x, y }` in image pixels) records where a cropped image sat in the full canvas it was exported from. The frame is fitted instead of the image, so layers exported from one canvas keep their composition.
- `clouds`: `{ enabled, items }`. Setting `enabled: false` hides every cloud without deleting them. Each item is an object:
  - `id`.
  - `type`: a key of the shared library `src/shared/maps/clouds.json`, or `"random"`. A random cloud picks the same image every time, from a hash of its id.
  - `x`/`y`: the world position.
  - `direction`: `"left"` or `"right"`.
  - `speed`: world px per second, 0 to 500. Clouds wrap around the camera bounds.
  - Optional: `scale`, `alpha`, `flipX`, and `after` or `front` (see below).

  Any map can use any library cloud. Add new cloud art under `public/assets/clouds/` and list it in `clouds.json`.
- `atmosphere`: `glows`, `mist`, `rays`, `lamps` (soft cones of light from a point, with `flicker`, always over the fighters), `dust`, `platforms` (top-lit gradient on platform art, with an optional drop shadow) and `vignette`. `dust` may be a list of fields at different depths; large, faint motes placed `after` far layers read as out-of-focus particles. Rays and glows pulse with `alpha: [min, max]`.

Clouds, glows, mist and rays stack with `after`: a layer ID places them just above that layer, and `"arena"` places them over the platforms but under the fighters. `front: true` draws them over the fighters. Layers are sized for the mode's camera zoom range, so a map looks right at every zoom the match uses.

Layers, clouds and parallax render on every graphics setting. The atmosphere renders only with WebGL on High and Super High, and Super High uses `dust.superHighCount`. The runtime is `src/client/game/maps/sceneryRuntime.js`; validation and the parallax math live in `src/shared/maps/scenery.js`. Matches pin layer images like platform art. Avoid Phaser `preFX` on map objects: under the game's framebuffer scaling it renders offset and clipped.

### Importing layered art

Layered art can be added by hand: put WebP files under `public/assets/<map>/` and add layers in the Scenery tab or JSON. Pre-blur any image that should look out of focus.

To speed this up, export full-canvas PNGs from the art file and run:

```bash
node scripts/art/import-map-art.cjs <map id> <export dir> [--clouds] [--scale 0.5]
```

Name the exports `[Layer0]_Background.png`, `[Layer1]_Peaks.png` and so on, back to front. Put platform art in a `[LayerN]_Platforms/` folder and clouds in a `[LayerN]_Clouds/` folder.

The importer trims and scales each image, bakes each layer's `blur`, saves WebP files and records each crop as `frame`. It also registers platform artwork and writes `lobby-background.webp`. With `--clouds` it adds the clouds to the shared library.

New layers start with depth defaults that you then tune: the back layer is the sky, farther layers get more fog and blur, and layers above the platform folder are foreground. Re-running updates art in place and keeps the settings of layers and platforms already in the map. It needs `cwebp`/`dwebp` (`brew install webp`). Keep the source PNGs outside `public/`.

Checks: `node --test tests/mapScenery.test.js` and `npm run validate:content`.

## Spawn placement

Spawn slots describe safe landing surfaces, not sprite centers. `src/shared/physics/spawnPlacement.js` resolves character bodies, collision-enabled surfaces and platform-edge clearance. Player markers stay anchored to supporting platforms; legacy `dropHeight` values are validated but do not cause the pregame fighters to fall.

`spawnStateFor` in `src/server/core/gameRoom/roomStateManager.js` supplies human, bot, playtest and Bank Bust respawn positions from the match's map snapshot. `game:init` and `game:start` carry the server positions; the client falls back to document placement only when positions are absent. Movement input stays locked until FIGHT.

Checks: `node --test tests/spawnPlacement.test.js tests/gameRoomStartup.test.js tests/pregameFlythrough.test.js`.

### Mangrove Meadow collision surfaces

Mangrove Meadow colliders follow the refreshed grassy surfaces rather than the
flowers above them. Soil blocks retain their side walls for wall-jumping, with
heights bounded by the artwork. Floating ledges use shallow bodies inset from the
fringe. Every platform permits upward passage through its underside and catches
players descending onto its top. Saved overrides retain their authored positions.
