# Map Studio

Admins can open Map Studio using the Edit map action inside the lobby map selection menu, or visit `/map-editor`. Editing runs separately from matchmaking. Choose a map and its **1v1**, **2v2**, or **3v3** variant in the toolbar. All built-in variants start with the same layout; edits affect only the selected variant. **Copy variant** explicitly copies the full layout and settings to another size.

## Editing controls

- Click to select without moving. Shift-click toggles objects in the selection; drag empty space to box-select. Drag a selected object to move the group.
- Drag corner or edge handles to resize. Proportions are preserved by default; hold Shift for free resizing. Size fields also preserve proportions unless Shift is held when the change is applied.
- Tab switches a platform between green artwork handles and orange collision handles. Collision handles change the solid boundary without stretching the artwork.
- Grid and alignment guides help with placement. Hold Command (macOS) or Control to bypass snapping. Player spawns still require a safe, walkable platform.
- Space + drag, middle drag, or right drag pans. Scroll zooms; F fits the world. Arrow keys nudge the selected object; Shift increases the nudge to 16 pixels.
- Command/Control Z undoes; Command/Control Shift Z or Control Y redoes. History keeps 250 document states, including settings and all variants, while retaining the Phaser scene and camera.
- D duplicates; Delete removes. A platform supporting a player spawn cannot be deleted until its markers are moved to another platform. Player slots remain fixed to the required team formation.
- Escape opens a real game playtest. Choose Solo or With bots and a character first. Escape in the playtest returns to the editor. Controls/tutorial overlays stay hidden; the actual GameRoom, movement, combat, bots, objectives, effects, and powerups run in an isolated admin session. Playtests expire after an hour and do not award rewards or create matchmaking records.

Powerup markers can be placed anywhere. Editing or dragging an older anchored powerup turns it into a free point; its coordinates are used directly by the server. Player markers always stay anchored. The **All spawn formations** checkbox exposes the alternate team formations stored in that variant.

The World tab edits world/camera bounds, powerup rules, background and catalog presentation. Less common controls are inside expandable Advanced sections. Pixel fields display whole numbers; percentage fields expose values such as opacity and camera zoom without requiring decimal entry. Scale factors and coordinate conversions retain the precision needed to keep artwork and physics aligned.

## Artwork and animations

The Assets tab is a library of reusable platform artwork. **New platform artwork** registers an image and places a platform. Still images require only an image URL; dimensions are read automatically. Animated platforms use either an image with equal-sized frames or an image plus a JSON frame file. Animated artwork additionally exposes frame dimensions, frame numbers/names, and playback speed. Atlas frames must currently be untrimmed, unrotated, and equal-sized.

URLs must point under `/assets/`, corresponding to `public/assets/` in the repository. Dropping a PNG, WebP, or JPEG onto an artwork card (or choosing **Replace image**) stages a replacement, updates matching references across the document's variants, and preserves platform size and collision placement. Variants using a different artwork URL remain independent. Animated image replacements retain their animation/frame configuration and are validated when saving or starting a playtest.

**Save map** publishes uploaded artwork to its game asset path and updates the production `dist` copy if present. Uploaded images are also stored at immutable revision URLs so existing matches retain their artwork. A failed document save restores any overwritten artwork. Files must be at most 8 MB and 16384 pixels per dimension.

**Export** produces a portable JSON document containing all variants. Image files are not embedded. If artwork was uploaded, an export dialog lists every game file that must be copied manually, including uploads that have already been saved. Keep the replacement image files alongside your export.

## Persistence and deployment

Built-in documents live in `src/shared/maps/{id}.json`. The backend reads saved overrides from `data/maps/{id}.json`, or from `BB_MAP_DIR` if configured. Back up that directory and `public/assets` together and keep them writable/persistent on the server. Generated asset revisions, map history and match snapshots are runtime data excluded from Git. Saved overrides take precedence over built-in documents.

Each save validates every variant and its image/frame files, checks the revision to reject stale writes, and atomically replaces the document. Previous document revisions are retained in `history/{id}/`. Browser drafts recover unsaved edits; a stale draft must be exported and merged with the latest document before saving.

New maps are discovered by the lobby catalog without adding JavaScript modules. Matches receive a fixed document/artwork snapshot when first loaded, so later saves apply to new matches. Production additionally persists match snapshots across server restarts.

## Editing with AI or other tools

The format is data-only JSON, validated by `src/shared/maps/mapDocument.js`. Start from an exported document or clone a built-in document, retain `schemaVersion: 1`, and preserve stable object IDs. A document contains:

- `id`, `label`, and `metadata` for catalog compatibility and presentation.
- `variants['1v1'|'2v2'|'3v3']`, each holding `layout.platforms`, `layout.hitboxes`, `assets`, `textureSizes`, `bounds`, `spawns`, `powerups`, `anchors`, and optional `objectiveLayout.bankBust`.
- Platforms use center `x/y`, a `textureKey`, positive `scaleX/scaleY`, optional collision settings and a `body`. Body width/height are world pixels; offsets are unscaled texture pixels measured from the artwork's top left.
- A platform may add `motion` to move (see [Moving platforms](#moving-platforms)).
- Player spawn slots contain `anchorId`, optional horizontal `dx`, and optional `dropHeight`. Each team has arrays of exactly 1, 2, and 3 slots under `spawns.players`. Free powerups contain an `id`, `x/y`, optional `type`, and optional `enabled`.

Use `validateDocument(document)` before importing. The server additionally validates local asset dimensions and animation frames. `geometryFromMap` is the shared collision contract. `src/client/editor/editorModel.js` exposes the same snapping, resizing, replacement, and export operations used by the GUI.

Authenticated admin endpoints:

- `GET /api/admin/maps`: list maps and revisions.
- `GET /api/admin/maps/:id`: retrieve `{document, revision}`.
- `PUT /api/admin/maps/:id`: send `{document, revision}`. Use `revision: null` for a new ID. A stale revision returns 409; validation errors return 422 with field paths.
- `POST /api/admin/maps/upload`: stage `{targetUrl, fileName, base64}`; use its returned `url`, `targetUrl`, `width` and `height` for the replacement.

For manual JSON changes, import in Map Studio and Save, or use the authenticated API so validation and revision checks run. Do not rewrite legacy map JavaScript constants or modify a live match snapshot.

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

Every map's backdrop renders inside Phaser. A variant without `scenery` layers shows its `background` as a single layer with a gentle parallax. A variant may add an optional `scenery` block instead. Candy Land (`src/shared/maps/5.json`) is the working example. Map Studio does not edit it yet; change the JSON directly. `background` is still required and is used for previews.

- `layers`: art images, listed back to front. `scroll` is the parallax factor: 0 is fixed to the screen, 1 moves with the arena, and above 1 is foreground drawn over fighters (under their HUD). `x`/`y` are offsets in world units from the camera bounds centre. `fit` controls size:
  - `"cover"` (the default) scales the layer so no edge shows at any zoom or camera position, so nearer layers display larger.
  - `"cover-x"` only guarantees the width, for horizon strips that leave sky above or ground below.
  - `"none"` uses `scale` as given.

  `fog` (0 to 1) hazes everything behind and including that layer toward `atmosphere.fogColor`; the haze is heavier toward the ground. `blur` (0 to 16, texture pixels) gives depth of field: the game blurs a copy of the art once when the map loads. It uses canvas blurring, not Phaser `preFX`.
- `stack` on a layer sets its depth: `"back"` (behind the platforms; the default up to `scroll` 1), `"arena"` (over the platforms and everything placed `after: "arena"`, under the fighters) or `"front"` (over the fighters; the default above `scroll` 1). A layer with `scroll: 1` stays fixed in the world like the platforms.
- `frame` on a layer (`{ width, height, x, y }` in image pixels) records where a cropped image sat in the full canvas it was exported from. The frame is fitted instead of the image, so layers exported from one canvas keep their composition.
- `clouds`: individual images that drift sideways at `speed` (world px per second) and wrap around the arena. With `scroll: 1` they sit in the world and only move by drifting. They take `x`/`y`, `scroll`, `scale`, `alpha` and `flipX`, and render on every graphics setting.
- `atmosphere`: `glows`, `mist`, `rays`, `dust`, `platforms` (top-lit gradient on platform art, with an optional drop shadow) and `vignette`. `dust` may be a list of fields at different depths; large, faint motes placed `after` far layers read as out-of-focus particles. Rays and glows pulse with `alpha: [min, max]`.

A map whose `bounds.camera` sets `minZoom`/`maxZoom` sizes its layers for that zoom range (see the follow camera in `cameraDynamics.js`). Clouds, glows, mist and rays stack with `after`: a layer ID places them just above that layer, and `"arena"` places them over the platforms but under the fighters. `front: true` draws them over the fighters.

Layers, clouds and parallax render on every graphics setting. The atmosphere renders only with WebGL on High and Super High, and Super High uses `dust.superHighCount`. The runtime is `src/client/game/maps/sceneryRuntime.js`; validation and the parallax math live in `src/shared/maps/scenery.js`. Matches pin layer and cloud images like platform art. Avoid Phaser `preFX` on map objects: under the game's framebuffer scaling it renders offset and clipped.

Candy Land art is exported as full-canvas PNG layers. Keep those sources outside `public/` (by default in the ignored `output/candyland-source/`) and run `node scripts/art/import-candyland.cjs [source dir]`. It trims, halves and converts each image to WebP in `public/assets/candyland/`, prints each crop (the `frame` values) and flattens the backdrop into `lobby-background.webp`.

Checks: `node --test tests/mapScenery.test.js` and `npm run validate:content`.

## Spawn placement

Spawn slots describe safe landing surfaces, not sprite centers. `src/shared/physics/spawnPlacement.js` resolves character bodies, collision-enabled surfaces and platform-edge clearance. Player markers stay anchored to supporting platforms; legacy `dropHeight` values are validated but do not cause the pregame fighters to fall.

`spawnStateFor` in `src/server/core/gameRoom/roomStateManager.js` supplies human, bot, playtest and Bank Bust respawn positions. `game:init` and `game:start` carry the server positions; the client falls back to document placement only when positions are absent. Movement input stays locked until FIGHT. New maps and edits use the document/API workflow above; do not replace legacy `duelMaps.json` or `bankSpawnGeometry.json` snippets as an editing workflow.

Checks: `node --test tests/spawnPlacement.test.js tests/gameRoomStartup.test.js tests/pregameFlythrough.test.js`.
