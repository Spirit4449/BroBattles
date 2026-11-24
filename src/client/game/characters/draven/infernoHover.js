import { characterDefinitions } from "../../../../shared/characters/index.js";
import { infernoLiftAt } from "../../../../shared/combat/runtime/abilities/dravenInfernoLift.js";
import { playSpriteAnimation } from "../shared/animationState";

// While Inferno locks movement, the local Draven rises from where it was cast
// and bobs in place, on the same curve the server uses (dravenInfernoLift.js). Once released, restore the gravity setting saved at cast.

const { key: NAME } = characterDefinitions.draven;

export function updateInfernoHover(scene, player, { locked, now }) {
  if (!player) return;
  if (locked) {
    const startedAt = Number(player._dravenInfernoStartedAt || now);
    const baseX = Number.isFinite(player._dravenInfernoBaseX) ? player._dravenInfernoBaseX : player.x;
    const baseY = Number.isFinite(player._dravenInfernoBaseY) ? player._dravenInfernoBaseY : player.y;
    player.x = baseX;
    player.y = baseY - infernoLiftAt(now - startedAt);
    playSpriteAnimation({ scene, sprite: player, character: NAME, logical: "special", fallback: "throw" });
  } else if (player.body && player._dravenInfernoPrevGravity !== undefined) {
    player.body.allowGravity =
      typeof player._dravenInfernoPrevGravity === "boolean" ? player._dravenInfernoPrevGravity : true;
    delete player._dravenInfernoPrevGravity;
  }
}
