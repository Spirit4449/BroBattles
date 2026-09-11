import { getResolvedCharacterAttackConfig } from "../../shared/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId.js";
import { lockPlayerFlip } from "../shared/flipLock.js";
import { playSpriteAnimation } from "../shared/animationState.js";

const ARROWS = getResolvedCharacterAttackConfig("huntress", "arrowSpread");

export function performHuntressArrowSpread(instance, attackContext = null) {
  const { scene, player: p } = instance;
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const angle = Number.isFinite(Number(context?.angle))
    ? Number(context.angle)
    : p.flipX
      ? Math.PI
      : 0;
  const speed = Math.max(1, ARROWS.speed * (Number(context.speedScale) || 1));
  const id = createRuntimeId("huntressArrow");
  const unlockFlip = lockPlayerFlip(p);
  playSpriteAnimation({ scene, sprite: p, character: "huntress", logical: "throw", fallback: "throw" });
  try {
    if (scene?.cache?.audio?.exists?.("huntress-attack") || scene?.sound?.get?.("huntress-attack")) {
      scene.sound?.play?.("huntress-attack", { volume: 0.55 });
    }
  } catch (_) {}
  scene.time.delayedCall(ARROWS.flipLockMs, unlockFlip);
  // The network adapter converts aim speed to normalized power. The server
  // owns projectile geometry, damage, launch timing and collision.
  return { type: "huntress-arrow", id, angle, speed };
}
