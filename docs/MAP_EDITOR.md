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

The format is data-only JSON, validated by `src/shared/mapDocument.js`. Start from an exported document or clone a built-in document, retain `schemaVersion: 1`, and preserve stable object IDs. A document contains:

- `id`, `label`, and `metadata` for catalog compatibility and presentation.
- `variants['1v1'|'2v2'|'3v3']`, each holding `layout.platforms`, `layout.hitboxes`, `assets`, `textureSizes`, `bounds`, `spawns`, `powerups`, `anchors`, and optional `objectiveLayout.bankBust`.
- Platforms use center `x/y`, a `textureKey`, positive `scaleX/scaleY`, optional collision settings and a `body`. Body width/height are world pixels; offsets are unscaled texture pixels measured from the artwork's top left.
- Player spawn slots contain `anchorId`, optional horizontal `dx`, and optional `dropHeight`. Each team has arrays of exactly 1, 2, and 3 slots under `spawns.players`. Free powerups contain an `id`, `x/y`, optional `type`, and optional `enabled`.

Use `validateDocument(document)` before importing. The server additionally validates local asset dimensions and animation frames. `geometryFromMap` is the shared collision contract. `src/editor/editorModel.js` exposes the same snapping, resizing, replacement, and export operations used by the GUI.

Authenticated admin endpoints:

- `GET /api/admin/maps`: list maps and revisions.
- `GET /api/admin/maps/:id`: retrieve `{document, revision}`.
- `PUT /api/admin/maps/:id`: send `{document, revision}`. Use `revision: null` for a new ID. A stale revision returns 409; validation errors return 422 with field paths.
- `POST /api/admin/maps/upload`: stage `{targetUrl, fileName, base64}`; use its returned `url`, `targetUrl`, `width` and `height` for the replacement.

For manual JSON changes, import in Map Studio and Save, or use the authenticated API so validation and revision checks run. Do not rewrite legacy map JavaScript constants or modify a live match snapshot.

Verification: `node --test tests/mapEditor*.test.js tests/mapDocumentRuntime.test.js` and `npm run build`.
