# Rendering and loading

The game uses `Phaser.AUTO`: WebGL when supported, Canvas otherwise. Characters,
map objects, particles, animations, and effects use ordinary Phaser APIs in both
renderers. Keep renderer-specific resolution handling in
`src/gameScene/renderResolution.js`; do not add renderer branches to gameplay.

Quality changes affect the main drawing buffer, not the logical world, cameras,
physics or input coordinates:

| Setting | Total pixels relative to Medium | Width/height multiplier |
| --- | --- | --- |
| Low | 0.25× (unchanged) | 0.5× |
| Medium | 1× | 1× |
| High | 2× | √2× |
| Super High | 4× | 2× |

Pixel dimensions are rounded. WebGL dimensions are capped to hardware limits.
The Phaser 3.70 WebGL adapter scales viewport/scissor calls for the screen and
leaves offscreen render targets at their own sizes. The Canvas adapter scales
context transforms. Neither adds per-sprite renderer selection. Changes to other
settings do not resize the renderer. Revalidate this adapter when upgrading Phaser.

`deferSceneAudio` captures existing `load.audio` declarations during preload,
including character and mode sounds, and starts them after scene creation with
two parallel downloads. Visual assets and their atlas/map data remain blocking;
audio downloads and decoding do not block scene creation or visual loading
progress. Missing one-shots are skipped, never replayed late. Local movement
loops initialize when their decoded audio enters the cache. Shutdown cancels
pending startup and restores patched methods; Phaser owns active loader cleanup.

## Verification

`node --test tests/renderResolution.test.js tests/highResolutionCanvas.test.mjs tests/deferredAudio.test.mjs`

`node scripts/test-rendering.cjs` requires Playwright with Chromium and WebKit
installed. `NODE_PATH` can point to an existing Playwright package directory;
`CHROME_EXECUTABLE` optionally selects an installed Chrome. The harness needs no
database or game server. It checks actual rendered pixels, transparency, clipping,
generated textures, WebGL render textures, quality changes, camera mapping,
resize, automatic Canvas fallback, slow/failed audio, and teardown in both engines.
The preserved drawing buffer is enabled only in the harness for pixel inspection.
