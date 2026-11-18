# Local scripts

Run commands from the repository root. The default test suite and CI cover
server and client contracts. These manual checks exercise browser rendering,
media, and development workloads.

| Command | What it checks | Setup |
| --- | --- | --- |
| `node scripts/dev/test-generated-html.cjs` | Generated card art, playback, lobby and battle overlays, and reward reveals | Google Chrome or `CHROME_EXECUTABLE` |
| `node scripts/dev/test-rendering.cjs` | Rendered pixels, resolution changes, transparency, and deferred audio | Google Chrome or `CHROME_EXECUTABLE`, plus `npx playwright-core install webkit` |
| `node scripts/dev/test-map-studio.cjs` | Built Map Studio canvas, staged playtest launch, iframe exit, and session cleanup | `npm run build`, then Google Chrome or `CHROME_EXECUTABLE` |
| `node scripts/dev/sparrow-network-lab.cjs` | Local Sparrow combat, delayed replication, and browser profiling | Open the localhost URL printed by the script |
| `node scripts/dev/benchmark-sparrow.cjs` | Headless fixed-step Sparrow combat workload | Root npm dependencies |
| `node scripts/dev/review-about-page.cjs` | About page navigation, media playback, and screenshots | Current production build and `CHROME_EXECUTABLE` or Playwright Chromium |

The browser commands run against local fixtures. See [Client development](../docs/development/client.md)
for the generated HTML harness's focused flags. For V8 CPU profiles,
`node scripts/dev/cpuprofile-top.cjs <file-or-directory>` summarizes hot functions and
`node scripts/dev/cpuprofile-spans.cjs <file.cpuprofile>` summarizes stack spans.

## Art and maps

See [Art workflow](../docs/art/README.md) and [Map development](../docs/development/maps.md)
for the active commands and their source files.

- Run `node scripts/art/render-map-full-previews.cjs [mapId ...]` with Playwright Chromium or `CHROME_EXECUTABLE` to publish full-arena previews into the configured map store.
- Node image tooling that imports Sharp uses the [Sprite Workshop](../spritesheet-generator/README.md)
  installation. Run `npm --prefix spritesheet-generator ci` from the repository root.
- Media extraction and encoding require FFmpeg and FFprobe. The WebP tools
  `cwebp`, `dwebp`, and `img2webp` come from libwebp. The player-card video importer
  also uses macOS VideoToolbox for alpha video.
- Python art recipes need Python 3 and Pillow. Some also use NumPy, as noted in
  the script header.
- `scripts/art/archive/` holds superseded asset recipes for provenance. The two
  [Sky Soil recipes](art/archive/sky-soil/) require the exact source PNGs named in the
  files. The archived trophy pixel-art script requires the older source WebPs and
  libwebp. These recipes overwrite installed assets when invoked.

Database commands and environment setup are documented in the
[Database guide](../docs/operations/database.md).
