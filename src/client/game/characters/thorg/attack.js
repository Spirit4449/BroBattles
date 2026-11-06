import { createRuntimeId } from "../shared/runtimeId";
import { THORG_SWEEP } from "../../../../shared/characters/thorgSweep";
import { attackerPose, pathSweepShapes, pathSweepProgress } from "../../../../shared/combat/attackDelivery";
import { predictAttachedContacts, notePredictedHit } from "../shared/shotPrediction";
import { startThorgSweep } from "./weapon";
export const THORG_FALL_WINDUP_MS = THORG_SWEEP.windupMs;
export const THORG_FALL_STRIKE_MS = THORG_SWEEP.strikeMs;
export const THORG_FALL_DURATION_MS = THORG_FALL_WINDUP_MS + THORG_FALL_STRIKE_MS + THORG_SWEEP.recoveryMs;
export const THORG_FALL_RANGE = THORG_SWEEP.radiusX;

// The sweep is predicted against enemies as drawn with the server's capsules
// (attackDelivery.pathSweepShapes), on the attack's own clock from the press,
// so a hitstop that holds the drawn mace does not delay what it strikes.
function predictSweep(scene, body, direction) {
  const startedAt = performance.now(), struck = new Set();
  let previous = 0;
  const stop = () => { scene.events.off("update", update); scene.events.off("presentation:reset", stop); };
  function update() {
    if (!body.active) { stop(); return; }
    const progress = pathSweepProgress(performance.now() - startedAt);
    if (progress === null) return;
    const legacy = /thorg-(storm|iron)/.test(String(body._bbSkinTextureKey || body.texture?.key));
    const pose = attackerPose("thorg", body.x, body.y, { flip: direction < 0, scale: body._bbVisualScale || 1, legacy });
    for (const hit of predictAttachedContacts(pathSweepShapes(pose, direction, previous, progress), { skip: struck })) {
      struck.add(hit.target.name);
      notePredictedHit({ delivery: "attached", character: "thorg", target: hit.target, attacker: body });
    }
    previous = progress;
    if (progress >= 1) stop();
  }
  scene.events.on("update", update);
  scene.events.once("presentation:reset", stop);
}

export function performThorgFallAttack(instance, attackContext = null) {
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const direction = Number(context.direction) === -1 ? -1 : Number(context.direction) === 1 ? 1 : instance.player.flipX ? -1 : 1;
  startThorgSweep(instance.scene, instance.player, { direction });
  predictSweep(instance.scene, instance.player, direction);
  return { type: "thorg-fall", id: createRuntimeId("thorgSweep"), direction,
    angle: direction < 0 ? Math.PI : 0, range: THORG_FALL_RANGE,
    strikeMs: THORG_FALL_STRIKE_MS, duration: THORG_FALL_DURATION_MS };
}
export function changeDebugState() {}
