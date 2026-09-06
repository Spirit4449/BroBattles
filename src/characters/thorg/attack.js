import { createRuntimeId } from "../shared/runtimeId";
import { THORG_SWEEP } from "../../shared/thorgSweep";
import { startThorgSweep } from "./weapon";
export const THORG_FALL_WINDUP_MS = THORG_SWEEP.windupMs;
export const THORG_FALL_STRIKE_MS = THORG_SWEEP.strikeMs;
export const THORG_FALL_DURATION_MS = THORG_FALL_WINDUP_MS + THORG_FALL_STRIKE_MS + 100;
export const THORG_FALL_RANGE = THORG_SWEEP.radiusX;
export function performThorgFallAttack(instance, attackContext = null) {
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const direction = Number(context.direction) === -1 ? -1 : Number(context.direction) === 1 ? 1 : instance.player.flipX ? -1 : 1;
  startThorgSweep(instance.scene, instance.player, { direction });
  return { type: "thorg-fall", id: createRuntimeId("thorgSweep"), direction,
    angle: direction < 0 ? Math.PI : 0, range: THORG_FALL_RANGE,
    strikeMs: THORG_FALL_STRIKE_MS, duration: THORG_FALL_DURATION_MS };
}
export function changeDebugState() {}
