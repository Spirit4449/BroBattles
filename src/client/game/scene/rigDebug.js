// Draws every player's rig with the physics debug view (Ctrl+M): the anchors
// effects attach to and the rig points on the frame being shown, so a point
// can be checked against the art instead of tuned blind.
//   white cross   feet (sprite position: ring, floor effects)
//   cyan bar      top (HUD)
//   yellow dot    centre of the hitbox
//   magenta box   named rig points (characters/<name>.json `rig.points`)
import rigData from "../../../shared/characters/characterRig.js";
import { boundPlayerSprites, playerAnchor, rigPoint } from "../characters/shared/rig.js";

const { rigOf } = rigData;

export function drawRigDebug(graphics, sprites, zoom = 1) {
  graphics.clear();
  const line = 1.5 / zoom;
  for (const sprite of sprites) {
    if (!sprite?.active || !sprite.visible) continue;
    const feet = playerAnchor(sprite, "feet");
    const top = playerAnchor(sprite, "top");
    const centre = playerAnchor(sprite, "centre");
    graphics.lineStyle(line, 0xffffff, 1);
    graphics.lineBetween(feet.x - 6, feet.y, feet.x + 6, feet.y);
    graphics.lineBetween(feet.x, feet.y - 6, feet.x, feet.y + 2);
    graphics.lineStyle(line, 0x22d3ee, 1);
    graphics.lineBetween(top.x - 8, top.y, top.x + 8, top.y);
    graphics.fillStyle(0xfacc15, 1);
    graphics.fillCircle(centre.x, centre.y, 2.5 / zoom);
    graphics.lineStyle(line, 0xf472b6, 1);
    for (const name of Object.keys(rigOf(String(sprite._bbCharacter || "")).points)) {
      const point = rigPoint(sprite, name);
      if (point) graphics.strokeRect(point.x - 3, point.y - 3, 6, 6);
    }
  }
}

export function installRigDebug(scene) {
  const graphics = scene.add.graphics().setDepth(100001);
  const draw = () => {
    if (!scene.physics?.world?.drawDebug) return graphics.clear();
    drawRigDebug(graphics, boundPlayerSprites, scene.cameras?.main?.zoom || 1);
  };
  scene.events.on("postupdate", draw);
  scene.events.once("shutdown", () => {
    scene.events.off("postupdate", draw);
    graphics.destroy();
  });
  return { draw };
}
