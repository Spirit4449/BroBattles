import { playSpriteAnimation } from "../shared/animationState";

// While Inferno locks movement, the local Draven rises from where it was cast
// and bobs in place. Once released, restore the gravity setting saved at cast.
export function updateInfernoHover(scene, player, { locked, now }) {
  if (!player) return;
  if (locked) {
    const startedAt = Number(player._dravenInfernoStartedAt || now);
    const baseX = Number.isFinite(player._dravenInfernoBaseX) ? player._dravenInfernoBaseX : player.x;
    const baseY = Number.isFinite(player._dravenInfernoBaseY) ? player._dravenInfernoBaseY : player.y;
    const riseMs = Number(player._dravenInfernoRiseMs || 650);
    const riseT = Phaser.Math.Clamp((now - startedAt) / riseMs, 0, 1);
    const lift = Number(player._dravenInfernoLift || 125);
    player.x = baseX;
    player.y = baseY - lift * Phaser.Math.Easing.Cubic.Out(riseT) + Math.sin((now - startedAt) / 120) * 8;
    playSpriteAnimation({ scene, sprite: player, character: "draven", logical: "special", fallback: "throw" });
  } else if (player.body && player._dravenInfernoPrevGravity !== undefined) {
    player.body.allowGravity =
      typeof player._dravenInfernoPrevGravity === "boolean" ? player._dravenInfernoPrevGravity : true;
    delete player._dravenInfernoPrevGravity;
  }
}
