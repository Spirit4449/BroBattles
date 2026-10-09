import { characterHitBounds, firstTargetContact } from "../../../../shared/combat/shotContact";
import { serverClock } from "../../match/serverClock";
import { RENDER_LAYERS } from "../../scene/renderLayers";

// One contract for every shooter (see docs/development/networking.md):
//
// 1. Requests carry `viewMono`, the server time remote actors are drawn at, so
//    the server can test the shot's targets where this player saw them.
// 2. The shooter predicts its own launch and draws hits against the enemies on
//    screen at once. Damage, sounds and health still wait for the server.
// 3. A predicted hit the server has not confirmed within the confirmation
//    window is withdrawn by fading, never by flying on.

let viewMono = null;
let roster = { localUsername: null, opponentPlayersRef: null };
const staticTargets = new Map();

// The render timeline's current time (server simulation clock).
export function noteRemoteView(targetMono) {
  if (Number.isFinite(targetMono)) viewMono = targetMono;
}

export function withShotView(request) {
  if (!request || typeof request !== "object" || !Number.isFinite(viewMono)) return request;
  return { ...request, viewMono };
}

export function trackShotTargets(context = {}) {
  roster = { localUsername: context.localUsername ?? roster.localUsername,
    opponentPlayersRef: context.opponentPlayersRef ?? roster.opponentPlayersRef };
}

// Mode objects that shots damage, such as Bank Bust vaults: [{ name, bounds }].
export function setStaticShotTargets(source, targets = []) {
  if (targets.length) staticTargets.set(source, targets);
  else staticTargets.delete(source);
}

export function isLocalShooter(name) {
  return !!name && name === roster.localUsername;
}

// Enemies as this player currently sees them, with the server's hit boxes.
export function displayedShotTargets() {
  const targets = [];
  for (const [name, wrapper] of Object.entries(roster.opponentPlayersRef || {})) {
    const sprite = wrapper?.opponent;
    if (!sprite?.active || sprite.visible === false || wrapper.opCurrentHealth <= 0) continue;
    if (!Number.isFinite(sprite.x) || !Number.isFinite(sprite.y)) continue;
    targets.push({ name, sprite, bounds: characterHitBounds(wrapper.character, sprite.x, sprite.y,
      { flip: !!sprite.flipX, ducking: !!sprite._ducking }) });
  }
  for (const list of staticTargets.values()) targets.push(...list);
  return targets;
}

// Earliest displayed enemy a circle touches moving from a to b, or null.
// `skip` holds names already struck by a piercing shot.
export function predictShotContact(a, b, radius, { inset = false, skip = null } = {}) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
  return firstTargetContact(a, b, Math.max(0, Number(radius) || 0), displayedShotTargets(), { inset, skip });
}

// A confirmation for a predicted hit arrives about one round trip after it is
// drawn, because the shooter's shot leads the server by the upstream trip.
export function confirmWindowMs() {
  const rtts = serverClock.samples.map((sample) => sample.rtt).filter(Number.isFinite);
  const rtt = rtts.length ? Math.min(...rtts) : 150;
  return Math.min(900, rtt + 220);
}

// A brief flash where a predicted shot meets a displayed enemy.
export function playPredictedImpact(scene, x, y, color = 0xfff2d4, radius = 10) {
  if (!scene?.add?.circle || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const flash = scene.add.circle(x, y, radius, color, 0.75);
  flash.setDepth?.(RENDER_LAYERS.ATTACKS + 6);
  scene.tweens?.add?.({ targets: flash, alpha: 0, scaleX: 1.8, scaleY: 1.8, duration: 160,
    onComplete: () => flash.destroy() });
  return flash;
}

export function resetShotPrediction() {
  viewMono = null;
  roster = { localUsername: null, opponentPlayersRef: null };
  staticTargets.clear();
}
