import { getResolvedCharacterAttackConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId.js";
import { aimAngle, aimFacesLeft, faceAttack } from "../shared/flipLock.js";
import { playSpriteAnimation } from "../shared/animationState.js";
import { playPlayerSound } from "../../audio/playerAudio";
import { sparrowAimVariant } from "./aimPoses";

const ARROWS = getResolvedCharacterAttackConfig("sparrow", "arrowSpread");

export function performSparrowArrowSpread(instance, attackContext = null) {
  const { scene, player: p } = instance;
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const angle = aimAngle(context?.angle, p);
  const speed = Math.max(1, ARROWS.speed * (Number(context.speedScale) || 1));
  const id = createRuntimeId("sparrowArrow");
  // Face the shot and hold it, so running the other way does not turn her mid-draw.
  faceAttack(scene, p, aimFacesLeft({ direction: context?.direction, angle }, p.flipX), ARROWS.flipLockMs);
  playSpriteAnimation({ scene, sprite: p, character: "sparrow", logical: "throw", fallback: "throw", id,
    variant: sparrowAimVariant(angle) });
  try {
    if (scene?.cache?.audio?.exists?.("sparrow-attack") || scene?.sound?.get?.("sparrow-attack")) {
      playPlayerSound(scene, p, "sparrow-attack", { volume: 0.48 });
    }
  } catch (_) {}
  // The network adapter converts aim speed to normalized power. The server
  // owns projectile geometry, damage, launch timing and collision.
  return { type: "sparrow-arrow", id, angle, speed };
}
