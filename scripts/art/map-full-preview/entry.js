// Browser entry for render-map-full-previews.cjs. Builds one saved map with the
// game's own map and scenery runtime, frames the arena's whole camera area and
// signals window.__snapshotReady for the screenshot.
import Phaser from 'phaser/dist/phaser-arcade-physics.min.js';
import { preloadMapDocument, buildMapDocument } from '../../../src/client/game/maps/documentRuntime';
import { buildScenery, layerDepths, preloadScenery } from '../../../src/client/game/maps/sceneryRuntime';
import { createCrowd } from '../../../src/client/game/modes/broBall/crowd';
import { crowdRows } from '../../../src/client/game/modes/broBall/runtime';
import { mapArena } from '../../../src/shared/maps/arenas';

const map = window.__SNAPSHOT_MAP__;
// The full-arena frame reveals above Candy Land's sky artwork. Lower its
// canopy for this snapshot only so the candy border covers that exposed strip.
if (String(map.id) === '5') {
  const canopy = map.scenery?.layers?.find(layer => layer.id === 'canopy');
  if (canopy) canopy.y = (canopy.y || 0) + 80;
}
const { camera } = mapArena(map);
const width = window.innerWidth, height = window.innerHeight;

class SnapshotScene extends Phaser.Scene {
  preload() {
    this.failedAssets = [];
    this.load.on('loaderror', file => this.failedAssets.push(file.src));
    preloadMapDocument(this, map);
    preloadScenery(this, map);
  }
  create() {
    if (this.failedAssets.length) throw new Error(`Failed to load: ${this.failedAssets.join(', ')}`);
    buildMapDocument(this, map.id, map);
    const cam = this.cameras.main;
    const card = new URLSearchParams(window.location.search).has('card');
    cam.removeBounds();
    cam.setZoom(card ? height / camera.height : Math.max(width / camera.width, height / camera.height));
    cam.centerOn(camera.x + camera.width / 2, camera.y + camera.height / 2);
    buildScenery(this, map, { preview: true });
    if (map.objectiveLayout?.broBall) {
      const rows = crowdRows(map);
      if (rows) {
        const { goals } = map.objectiveLayout.broBall;
        createCrowd(this, Phaser, {
          rows, goals, reduced: true,
          left: goals.team1.backX, right: goals.team2.backX,
          skyY: camera.y, depth: layerDepths(map.scenery.layers).stands + 0.25,
        });
      }
    }
    // Let textures draw before the capture.
    this.time.delayedCall(250, () => { window.__snapshotReady = true; });
  }
}

new Phaser.Game({
  type: Phaser.WEBGL, parent: 'game', width, height, backgroundColor: '#111d29',
  pixelArt: true, preserveDrawingBuffer: true,
  physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
  scale: { mode: Phaser.Scale.NONE }, scene: SnapshotScene,
});
