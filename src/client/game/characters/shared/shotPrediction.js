import { characterHitBounds, firstTargetContact } from "../../../../shared/combat/shotContact";
import { DELIVERIES, shapeTouches } from "../../../../shared/combat/attackDelivery";
import { sweep } from "../../../../shared/characters/sparrowProjectile";
import { serverClock } from "../../match/serverClock";

// One contract for every attack (see docs/development/networking.md, "Attack
// delivery"); the delivery's policy is in src/shared/combat/attackDelivery.js:
//
// 1. Requests carry `viewMono`, the server time remote actors are drawn at, so
//    the server can test the attack's targets where this player saw them.
// 2. The attacker predicts its own launch or swing and tests it against the
//    enemies on screen. Every predicted contact goes through notePredictedHit:
//    the hit sound plays at the target and the shared hit feedback
//    (hitFeedback.js: flash, burst, hitstop) marks it, the same for every
//    character. Damage and health still wait for the server, and the
//    server's confirmation does not repeat what the prediction already played.
// 3. A predicted hit the server has not confirmed within the confirmation
//    window is withdrawn by fading, never by flying on.

let viewMono = null;
// Production network tracing (match/netTrace.js) listens for predicted hits and
// withdrawals here; null unless a traced tab installed it.
let traceHook = null;
let roster = { localUsername: null, opponentPlayersRef: null };
// Plays a character's hit sound at a sprite; installed with the roster.
let playHitSound = null;
// Plays the shared hit feedback on a struck sprite; installed with the roster.
let playHitFeedback = null;
// Predicted hits awaiting the server: { target, at, confirm, impact, feedback };
// a part is true once nothing is left for the server's echo to skip.
const predictedHits = [];
const staticTargets = new Map();
const blockerSources = new Map();

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
  if (context.playHitSound) playHitSound = context.playHitSound;
  if (context.playHitFeedback) playHitFeedback = context.playHitFeedback;
}

// Mode objects that shots damage, such as Bank Bust vaults: [{ name, bounds }].
export function setStaticShotTargets(source, targets = []) {
  if (targets.length) staticTargets.set(source, targets);
  else staticTargets.delete(source);
}

// Mode walls that stop shots, such as Bank Bust's built walls:
// [{ friendly, left, right, top, bottom }], friendly when built by this
// player's team. A wall stops the other team's shots and lets its own through.
export function setShotBlockers(source, blockers = []) {
  if (blockers.length) blockerSources.set(source, blockers);
  else blockerSources.delete(source);
}

// The walls that stop shots fired by `shooterName`.
export function shotBlockersFor(shooterName) {
  if (!blockerSources.size) return [];
  const enemyShot = !!roster.opponentPlayersRef?.[shooterName];
  const blockers = [];
  for (const list of blockerSources.values()) {
    for (const wall of list) if (wall.friendly === enemyShot) blockers.push(wall);
  }
  return blockers;
}

// Fraction along a->b where a circle fired by `shooterName` first meets one of
// those walls, or null. Every shot stops there, even ones that pass terrain.
export function shotBlockerContact(shooterName, a, b, radius = 0) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
  let first = null;
  for (const wall of shotBlockersFor(shooterName)) {
    const t = sweep(a, b, wall, Math.max(0, Number(radius) || 0));
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
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
  const contact = firstTargetContact(a, b, Math.max(0, Number(radius) || 0), displayedShotTargets(), { inset, skip });
  if (traceHook && contact?.target?.name) traceHook.prediction?.(contact.target.name);
  return contact;
}

// Displayed targets an attached attack's shapes touch, skipping `skip`, each
// with the point drawn as struck (the target's centre).
export function predictAttachedContacts(shapes, { skip = null } = {}) {
  if (!shapes?.length) return [];
  const hits = [];
  for (const target of displayedShotTargets()) {
    if (skip?.has(target.name)) continue;
    const { bounds } = target;
    // Mode objects are tested at their centre, so their half width is reach.
    const reach = target.sprite ? 24 : 24 + (bounds.right - bounds.left) / 2;
    if (!shapes.some((shape) => shapeTouches(shape, bounds, { reach }))) continue;
    hits.push({ target, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });
    traceHook?.prediction?.(target.name);
  }
  return hits;
}

// Freezes a sprite's animation frame for `ms`; position and simulation go on.
export function hitstop(sprite, ms) {
  const anims = sprite?.anims;
  if (!anims || !(ms > 0)) return;
  anims._hitstopUntil = Math.max(anims._hitstopUntil || 0, performance.now() + ms);
  if (anims._hitstopWrapped) return;
  anims._hitstopWrapped = true;
  const update = anims.update;
  anims.update = function hitstopUpdate(time, delta) {
    if (performance.now() < this._hitstopUntil) return undefined;
    return update.call(this, time, delta);
  };
}

export function inHitstop(sprite) {
  return performance.now() < (sprite?.anims?._hitstopUntil || 0);
}

function prunePredictedHits(now) {
  const window = confirmWindowMs();
  while (predictedHits.length && now - predictedHits[0].at > window) predictedHits.shift();
}

// The moment a predicted hit lands, for every delivery: the attacker's hit
// sound and the shared hit feedback at the target, with the delivery's hitstop.
export function notePredictedHit({ delivery, character, target, attacker = null }) {
  const policy = DELIVERIES[delivery];
  if (!policy?.predict || !target?.name) return;
  const now = performance.now();
  prunePredictedHits(now);
  const source = target.sprite || attacker;
  // Only what played here may silence the server's echo of it.
  const sounded = !!(source && playHitSound);
  if (sounded) playHitSound(character, source);
  const felt = !!(target.sprite && playHitFeedback?.(target.sprite, {
    hitstopMs: policy.hitstopMs, duckBlocked: target.sprite._ducking === true }));
  if (!felt) hitstop(target.sprite, policy.hitstopMs);
  if (sounded || felt) {
    predictedHits.push({ target: target.name, at: now, confirm: !sounded, impact: !sounded, feedback: !felt });
  }
  if (policy.attackerHitstop) hitstop(attacker, policy.hitstopMs);
}

// True once per predicted hit on `targetName` for each server echo ("confirm"
// for the hit confirmation, "impact" for an impact effect, "feedback" for the
// health update's hit feedback), so the attacker's
// client does not play again what the prediction already did.
export function takePredictedHit(targetName, part = "confirm") {
  prunePredictedHits(performance.now());
  const entry = predictedHits.find((hit) => hit.target === targetName && !hit[part]);
  if (!entry) return false;
  entry[part] = true;
  return true;
}

// A confirmation for a predicted hit arrives about one round trip after it is
// drawn, because the shooter's shot leads the server by the upstream trip.
export function confirmWindowMs() {
  const rtts = serverClock.samples.map((sample) => sample.rtt).filter(Number.isFinite);
  const rtt = rtts.length ? Math.min(...rtts) : 150;
  return Math.min(900, rtt + 220);
}

export function setShotTraceHook(hook) {
  traceHook = hook || null;
}

// A predicted hit the shooter takes back because the server did not confirm it.
export function noteShotWithdrawn(kind, id = null) {
  traceHook?.withdrawn?.(kind, id);
}

export function resetShotPrediction() {
  viewMono = null;
  roster = { localUsername: null, opponentPlayersRef: null };
  staticTargets.clear();
  blockerSources.clear();
  predictedHits.length = 0;
}
