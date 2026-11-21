import { RENDER_LAYERS } from "../scene/renderLayers";
import { createPickupRenderer } from "./pickupRenderer";
import { createDeathDropRenderer } from "./deathDropRenderer";
import { createStatusAuraRenderer } from "./statusAuraRenderer";

export function createPowerupRenderer(options) {
  const { scene, auraDepth = RENDER_LAYERS.PLAYER_HUD + 1, fxDepth = RENDER_LAYERS.PLAYER_HUD } = options;
  const auraGraphics = scene.add.graphics().setDepth(auraDepth);
  const fxG = scene.add.graphics().setDepth(fxDepth);
  const auras = createStatusAuraRenderer({ ...options, auraGraphics, fxG });
  const pickups = createPickupRenderer({ ...options, ...auras, fxG });
  const deathDrops = createDeathDropRenderer(options);
  let destroyed = false;
  function renderPowerupsAndEffects() {
    if (destroyed) return;
    const nowSec = scene.time.now / 1000;
    pickups.consumeCollectedPowerupQueue();
    deathDrops.consumeCollectedDeathDropQueue();
    fxG.clear();
    pickups.render(nowSec);
    deathDrops.renderDeathDrops(nowSec);
    auras.renderPowerupAuras(nowSec);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    scene.events?.off("shutdown", destroy);
    pickups.destroy();
    deathDrops.destroy();
    auraGraphics.destroy();
    fxG.destroy();
  }
  function resetEffects(username) {
    auras.resetEffects(username);
    pickups.resetClaimEffects(username);
    if (!username) {
      auraGraphics.clear();
      fxG.clear();
    }
  }
  scene.events?.once("shutdown", destroy);
  return { renderPowerupsAndEffects, resetEffects, destroy };
}
