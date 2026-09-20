# Bro Battles Sprite Workshop

A local sprite editor and CLI sharing the same persistent project engine. Use it to inspect existing characters, prepare AI-generated frames, clean up motion, and export standard atlases. It does not regenerate art or modify live game assets.

## Run

Requires Node.js 18+; install dependencies with `npm install` in this directory. FFmpeg on PATH is needed only for video import. Image import, animated WebP reviews, and export work without it.

```bash
npm start
# http://127.0.0.1:3015
# Alternate port or project library:
node cli.js serve --port 3016 --projects ./projects
npm test
```

The server binds to localhost and rejects cross-origin browser requests. `projects/` and generated outputs are ignored by Git. Back up project directories yourself; copying one directory carries its original sources, editable frames, and undo history.

## Browser workflow

1. Create a project or reopen one from the project selector.
2. Import a repository character/skin, individual images, a numbered sequence, a uniform grid, an image with Phaser atlas JSON, or a video. Select image and JSON together for atlas import. Image sequences sort naturally by filename. Grid dimensions must divide the source exactly. Optional comma-separated grid row names assign animations.
3. Inspect original canvases before normalizing. Unknown atlas prefixes appear under `unassigned`; select those frames and move them into an existing or new animation row. Atlas names are preserved, including legacy `throw`, `sliding`, and other prefixes.
4. Normalize explicitly. All frames receive one common fit scale and a bottom-center source anchor; cells are 256×256. This preserves relative source sizes rather than fitting each pose independently. Use transform controls to adjust registration or intentional overhang afterward. Reimporting or replacing images requires normalization again.
5. Select, reorder, duplicate, insert blanks, delete, replace, crop, paint, or remove a keyed background. Click applies to one frame; Shift-click selects a range, and Ctrl/Cmd-click toggles selection. Drag within a row to reorder; “Move frames” handles animation reassignment. Scope can target selected frames or the entire animation. Painting is on the original canvas, and crop adjusts anchors to retain placement.
6. Play, step, scrub, change speed, flip, zoom, and inspect over checker/solid backgrounds. Use onion skin, pinned-frame comparison, last/first seam comparison, or transition playback. Space toggles playback; arrows step. Delete removes selected frames; Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z undo/redo.
7. Analyze frames, render a review pack, or export the atlas. Generated files appear as links. Portrait selection controls `body.webp`.

Every completed edit or brush stroke saves immediately. Inspector fields apply through their labeled buttons. Undo and redo survive reload. External CLI edits refresh in the browser when no field or brush stroke is being edited; a conflicting write is rejected with HTTP 409 and the latest project is reloaded, rather than overwriting it.

Preview links include `?project=<folder>&animation=<row>&frame=<stable-id>`. Projects created with the CLI inside the server's project library appear in the project selector after refresh. Use letters, digits, and hyphens in project folder names.

## Grid and project contract

`project.json` has `version: 1`, a monotonic `revision`, `cellSize: 256`, `normalized`, ordered `animations`, a frame-ID map, `portrait`, import provenance, and undo/redo snapshot references. Animation records contain `key`, `fps`, `loop`, and ordered frame IDs. Frames contain their stable `id`, export `name`, original `source` reference, immutable editable PNG `file`, native dimensions, and `transform` (`scale`, `x`, `y`, `anchorX`, `anchorY`). All asset paths are project-relative.

The fixed rows are `idle`, `running`, `jumping`, `falling`, `attack`, `dying`, `wall`, and `special`. Extras append. Empty rows remain in the atlas. Width is `max(8, longest animation) × 256`; each animation occupies one row, and unused slots stay transparent and are omitted from the atlas metadata. Deleting compacts only that row. Frame names must be unique for export; duplicates get unique copy names. New projects use 12 FPS, with idle/running/falling/wall looping. Frame counts are unrestricted within the 64-megapixel atlas limit.

Edits are atomic manifest transactions guarded by an exclusive project lock and expected revision. Immutable images may remain unreferenced after a failed transaction; they are harmless and retain recovery evidence. If a process is killed during a write, stop all workshop/CLI writers before manually removing the project's stale `.lock` directory. Do not hand-edit a manifest while the server or CLI is writing.

## Agent / CLI workflow

Commands produce JSON results; `--json` is accepted explicitly. Exit status is 0 on success, 3 on revision conflict, and 1 for invalid input or processing errors. Errors are JSON on stderr. Reads and exports use one manifest snapshot. Mutations require the revision obtained from `inspect`; refresh and reassess after a conflict.

From this directory:

```bash
node cli.js inspect --catalog --json
node cli.js init --project ./projects/thorg-study --name 'Thorg study' --json
node cli.js import --project ./projects/thorg-study --catalog-id thorg --revision 0 --json
node cli.js inspect --project ./projects/thorg-study --json
node cli.js edit --project ./projects/thorg-study --revision 1 --ops edits.json --json
node cli.js validate --project ./projects/thorg-study --json
node cli.js render --project ./projects/thorg-study --out ./output/thorg-review --animation running --json
node cli.js export --project ./projects/thorg-study --out ./output/thorg-atlas --zip --json
```

Example `edits.json`:

```json
[
  { "op": "normalize" },
  { "op": "animation", "animation": "idle", "fps": 8, "loop": true }
]
```

Input examples:

```bash
node cli.js import --project ./projects/demo --revision 0 --kind images --file idle01.png --file idle02.png --animation idle
node cli.js import --project ./projects/demo --revision 1 --kind grid --file sheet.png --width 256 --height 256 --rows idle,running
node cli.js import --project ./projects/demo --revision 2 --kind atlas --file sheet.webp --atlas animations.json
node cli.js import --project ./projects/demo --revision 3 --kind video --file run.mp4 --animation running --extract-fps 12
```

Extraction FPS does not change playback FPS. Video imports stop with an error at 2,000 extracted frames; shorten the input or lower extraction rate. Imports append frames; use `replace`, `delete`, or reassignment for iteration on existing work.

### Edit operations

Each batch is all-or-nothing. `ids` means stable frame IDs from `inspect`. Operations accepting `ids` also accept `animation` to target all frames in that row.

| `op` | Fields / behavior |
| --- | --- |
| `animation` | `animation`, optional `fps` and boolean `loop`; creates missing extra rows |
| `normalize` | Optional `scale`; default uses the largest native canvas dimensions to fit every frame |
| `reorder` | `animation`, `ids` containing the complete reordered row exactly once |
| `blank` | `animation`, optional insertion `index`; transparent 256×256 frame |
| `delete`, `duplicate` | `ids` |
| `assign` | `ids`, destination `to`, optional insertion `index` |
| `portrait` | Exactly one ID |
| `rename` | Exactly one ID and `name` |
| `transform` | `ids`, any of `x`, `y`, `scale`, `anchorX`, `anchorY`; absolute values |
| `crop` | `ids`, integer `x`, `y`, `width`, `height` inside each source canvas |
| `replace` | `ids`, image `file` path (CLI); IDs and ordering survive |
| `key` | `ids`, `color` (`#rrggbb`), `tolerance` (RGB distance, default 26) |
| `paint` | `ids`, source-coordinate `points: [[x,y],…]`, `color`, `radius`, optional `erase` |
| `undo`, `redo` | Must be the only operation in the batch |

Recommended AI loop: import externally generated art → inspect stable IDs → submit edits → validate → render → visually review contact sheets, animation, and seams → revise → export. No provider credentials or generation API are built into this release.

## Review and runtime compatibility

Review packs include labeled PNG contact sheets, lossless animated WebP files, last/first seam PNGs, `review.json`, and optionally an enlarged `frame.png` (`render --frame <id>`). WebP frames use replacement compositing so transparent pixels do not leave trails. The container follows the [WebP RIFF specification](https://developers.google.com/speed/webp/docs/riff_container).

Reports include empty/clipped frames, duplicate source pixels, alpha-weighted centroids, bounds, and adjacent-frame differences (including the loop seam for looping animations). Difference is a normalized premultiplied-RGBA distance at 64×64. Clipping is evaluated against the standardized 256×256 output; unnormalized previews use a shared larger inspection canvas. Metrics are review signals, not a verdict on smoothness or BB art style.

For catalog imports, the compatibility report records the current repository's animation declarations using a recording scene, then compares frame order, FPS/duration, repeat behavior, per-frame holds, and missing names. It includes source definitions for manual review. This captures, for example, Thorg's reordered run and timed attack, Gloop's repeated idle poses, and Wizard's per-frame cast holds. Workshop playback remains the editable project sequence; it does not claim to reproduce combat effects or override runtime declarations.

Exports contain `spritesheet.webp`, Phaser `animations.json`, `body.webp`, `animation-settings.json`, `review.json`, `import-notes.md`, and optional `bundle.zip`. Missing rows are allowed for drafts and listed in reports. No export is installed into the game automatically. Standardizing legacy cell sizes can require runtime scale, anchor, and animation changes later. The game does not automatically consume `animation-settings.json`.

The shared viewer replaces the dedicated Thorg preview. Weapon/rage inspection and other gameplay effects are outside this sprite-only workshop. Existing reward preview pages are unchanged.

The old temporary-session format is not reopened as a project. Import any previously exported atlas to continue work; old `tmp/` and `output/` files are left intact.
