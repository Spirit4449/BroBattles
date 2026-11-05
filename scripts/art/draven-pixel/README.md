# Draven: code-rendered portrait and idle

Run from repository root:

```sh
node scripts/art/draven-pixel/build.cjs
node scripts/art/draven-pixel/check.cjs
```

All artifacts go to `output/draven-pixel/`. The build uses Sharp and FFmpeg.
Nothing is installed into `public/assets/`.

- `pixels.cjs`: editable 64×64 palette-indexed drawing, 28 RGB colors. This is
  the artwork source, not a base64 image or runtime crop from the portrait.
- `parts.cjs`: semantic layer masks and named joint coordinates. The robe,
  torso, hood, two sleeves, two hands, staff, flame, crystal, and two floating
  shards can be posed independently. Joint coordinates document attachments;
  this is a row-warp rig, not a general skeletal IK solver.
- `render.cjs`: transparent 72×72 render canvas with four-pixel padding.
  Inverse nearest-neighbor sampling, intact hood/hand tiles, and a conservative
  enclosed-pinhole repair. It never reads a source image.
- `idle.cjs`: eight periodic authored keys at 2 fps, a four-second loop.
  Two-pixel breathing rise, one-pixel weight transfer, independent free-hand
  motion, delayed staff/grip lift, anchored robe hem and delayed cloth shift.
  Crystal/shard offsets have separate phases. The face is never rotated or
  stretched. The staff and grip move together; the staff tip lifts slightly.
- `analyze.cjs`: optional source transcription provenance. Samples cell-center
  medians and fits a deterministic palette. **Rerunning overwrites pixels.cjs**;
  unnecessary for rendering or animation. Grid sizes 60–68 were compared.
- `build.cjs`: exports artwork, extracts reference idle, measures accuracy,
  makes GIFs/contact sheets, and creates the local frame-scrubbing HTML viewer.
- `check.cjs`: checks logical rest fidelity, periodicity, unique frames,
  palette/alpha validity, clipping and isolated pixels.

## Source findings and accuracy

The installed portrait is 1254×1254 with 46,448 visible RGB colors and nonbinary
alpha, mostly 253/254. It is not a clean nearest-neighbor enlargement. Its
coarse drawing strongly fits a 64×64 lattice (effective scale 19.59375×);
64 has sampled premultiplied RGBA error 2.09 versus 5.03–6.67 for neighboring
60–68 grids. This identifies the apparent art grid, not a proven historical
source resolution or exact scaling pipeline.

The reconstruction removes small color/alpha variations, uses opaque pixels,
and snaps contours to the logical grid. At 1254×1254 it has **95.72% silhouette
IoU**, **2.263/255 full-canvas premultiplied RGBA MAE**, and **8.055/255 MAE on
the foreground union**. Raw exact-pixel agreement is only 71.92%, mostly from
transparent background; it is not a useful likeness claim. Full metrics are
in `report.json`, grid-fit evidence in `source-study.json`, and amplified
pixel differences in `difference-4x.png`.

## Preview files

- `preview.html`: play/pause, slider, keyboard stepping, enlarged contact sheet.
- `comparison.gif`: current in-game idle left; code rebuild right. Both 2 fps.
- `idle-preview.gif`: rebuilt idle alone on neutral gray.
- `rest-comparison.png`: source portrait and code reconstruction.
- `contact-sheet.png`: all eight rebuilt frames at 4×.
- `idle-strip.png`, `animations.json`: transparent 72px frame strip and metadata.
- `frames/`: individual transparent logical frames.
- `current/`: original unmodified 250px in-game idle frames.
- `body.webp`, `rest-64.png`: reconstructed rest portrait at full/logical sizes.

The comparison normalizes both silhouettes for readability. It uses one fixed
union crop for the old frames, so it does not stabilize away their motion.
The actual old atlas contains a smaller, softer figure and much larger magic
than the newer body portrait. This rebuild deliberately follows the requested
portrait identity/proportions, not the old atlas's different silhouette.

## Limits and polish

This is a limited pixel deformation rig for subtle poses. It has no invented
hidden anatomy; large turns or attacks require drawing additional coverage.
Motion is deliberately stepped at the existing 2 fps. The crystal and flames
translate as hard pixel clusters rather than recreating the old smoky fluid
effect. No blink was added to the largely concealed face.

Every pose was inspected enlarged. A skirt/hand ownership error was corrected;
rigid hood, grip and staff preserve their details, while connected sleeves and
robe use row-wise warps. Artifact checks and content validation pass. Game tests
are skipped because this work changes only standalone art scripts and outputs.
