// Browser entry for render-map-full-previews.cjs. Builds one saved map with the
// game's own map and scenery runtime, frames the arena's whole camera area and
// signals window.__snapshotReady for the screenshot.
import Phaser from 'phaser/dist/phaser-arcade-physics.min.js';
import { preloadMapDocument, buildMapDocument } from '../../../src/client/game/maps/documentRuntime';
import { buildScenery, preloadScenery } from '../../../src/client/game/maps/sceneryRuntime';
import { mapArena } from '../../../src/shared/maps/arenas';

const map = window.__SNAPSHOT_MAP__;
const { camera } = mapArena(map);
const width = window.innerWidth, height = window.innerHeight;

class SnapshotScene extends Phaser.Scene {
  preload() { preloadMapDocument(this, map); preloadScenery(this, map); }
  create() {
    buildMapDocument(this, map.id, map);
    const scenery = buildScenery(this, map, { still: true });
    // Still scenery is composed for the camera at rest. Zoomed out to the whole
    // arena, grow the parallax (scroll < 1) layers about the arena centre until
    // the farthest one covers the frame, as panning would reveal in a match.
    const far = scenery?.layers[0];
    if (far && far.scroll < 1) {
      const k = Math.max(1, camera.width / far.obj.displayWidth, camera.height / far.obj.displayHeight);
      for (const item of [...scenery.layers, ...scenery.parts]) {
        if (item.scroll >= 1) continue;
        item.obj.setScale(item.sx * k, item.sy * k)
          .setPosition(scenery.center.x + item.offset.x * k, scenery.center.y + item.offset.y * k);
      }
    }
    const cam = this.cameras.main;
    cam.removeBounds();
    cam.setZoom(Math.max(width / camera.width, height / camera.height));
    cam.centerOn(camera.x + camera.width / 2, camera.y + camera.height / 2);
    // Two frames so every texture has drawn before the capture.
    this.time.delayedCall(250, () => { window.__snapshotReady = true; });
  }
}

new Phaser.Game({
  type: Phaser.WEBGL, parent: 'game', width, height, backgroundColor: '#111d29',
  pixelArt: true, preserveDrawingBuffer: true,
  physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
  scale: { mode: Phaser.Scale.NONE }, scene: SnapshotScene,
});
