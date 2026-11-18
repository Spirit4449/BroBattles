import { setAttackDebugState } from "../characters";
export function installPhysicsDebugToggle(scene, initial) {
  const setHitboxDebug = (enable) => {
    const world = scene.physics?.world;
    if (!world) return;
    world.drawDebug = enable;
    try {
      setAttackDebugState(initial ? false : enable);
    } catch (_) {}
    if (enable) {
      // Create debug graphic if Phaser hasn't created it yet
      try {
        if (!world.debugGraphic || !world.debugGraphic.scene) {
          if (typeof world.createDebugGraphic === "function") {
            world.createDebugGraphic();
          } else {
            world.debugGraphic = scene.add.graphics();
          }
        }
        world.debugGraphic.setVisible(true);
      } catch (_) {}
    } else {
      try {
        if (world.debugGraphic) {
          world.debugGraphic.clear?.();
          world.debugGraphic.setVisible(false);
        }
      } catch (_) {}
    }
    // Keep config in sync for any systems that read it
    const arcadeCfg = scene.sys?.game?.config?.physics?.arcade;
    if (arcadeCfg) arcadeCfg.debug = enable;
  };
  setHitboxDebug(initial);
  scene.input.keyboard.on("keydown-M", (e) => {
    if (e.ctrlKey) setHitboxDebug(!scene.physics?.world?.drawDebug);
  });

}
