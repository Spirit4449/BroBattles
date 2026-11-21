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
// The render delay (interpolation buffer) behind the snapshots, at viewMono.
let viewDelayMs = null;
// Production network tracing (match/netTrace.js) listens for predicted hits and
// withdrawals here; null unless a traced tab installed it.
let traceHook = null;
let roster = { localUsername: null, opponentPlayersRef: null, localPlayer: null };
// Plays a character's hit sound at a sprite; installed with the roster.
let playHitSound = null;
// Plays the shared hit feedback on a struck sprite; installed with the roster.
let playHitFeedback = null;
// Predicted hits awaiting the server: { target, at, confirm, impact, feedback };
// a part is true once nothing is left for the server's echo to skip.
const predictedHits = [];
const staticTargets = new Map();
const blockerSources = new Map();

// The render timeline's current time (server simulation clock), and how far
// it is held behind the snapshots received (the render buffer).
export function noteRemoteView(targetMono, delayMs = null) {
  if (!Number.isFinite(targetMono)) return;
  viewMono = targetMono;
  viewDelayMs = Number.isFinite(delayMs) ? delayMs : null;
}

// `viewDelayMs` lets the server honour the render-buffer part of the rewind.
// Bro Ball uses the rally ID to discard inputs from before the last kickoff.
export function withCombatRequestContext(request, mode = null) {
  if (!request || typeof request !== "object") return request;
  const payload = { ...request };
  if (Number.isFinite(viewMono)) {
    payload.viewMono = viewMono;
    if (viewDelayMs != null) payload.viewDelayMs = viewDelayMs;
  }
  if (mode?.rally != null) payload.broBallRally = mode.rally;
  return payload;
}

export function trackShotTargets(context = {}) {
  roster = { localUsername: context.localUsername ?? roster.localUsername,
    opponentPlayersRef: context.opponentPlayersRef ?? roster.opponentPlayersRef,
    localPlayer: context.localPlayer ?? roster.localPlayer };
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

// A shot that can damage this player: fired by an opponent. Enemy released
// shots are drawn ahead (CombatClock.enemyLeadMs) and stop on this player's
// drawn body until the server's verdict.
export function isEnemyShooter(name) {
  return !!name && name !== roster.localUsername && !!roster.opponentPlayersRef?.[name];
}

// This player's own body as drawn, with the server's hit box.
export function localShotTarget() {
  const sprite = roster.localPlayer, character = sprite?._bbCharacter;
  // A dead player's body takes no more shots (the server's do not hit it).
  if (!roster.localUsername || !character || !sprite?.active || sprite.visible === false || sprite._deathPresentationActive) return null;
  if (!Number.isFinite(sprite.x) || !Number.isFinite(sprite.y)) return null;
  return { name: roster.localUsername, sprite, bounds: characterHitBounds(character, sprite.x, sprite.y,
    { flip: !!sprite.flipX, ducking: !!sprite._ducking }) };
}

// This player's drawn body over the last second, recorded once a frame after
// it moved (game.js calls noteLocalBodyFrame after sending the frame's input).
// The server tests an enemy shot of age g against the frame this player drew
// when the fully led flight was at g; while the lead is still ramping in (or
// before the shot reached this screen at all, at close range) that frame is
// in the past by the lead not yet shown (victimLagMs).
const BODY_HISTORY_MS = 1000;
const bodyHistory = [];
export function noteLocalBodyFrame(now = performance.now()) {
  const target = localShotTarget();
  // Dead or respawning: the server restarts its history too.
  if (!target) { bodyHistory.length = 0; return; }
  bodyHistory.push({ t: now, x: target.sprite.x, y: target.sprite.y, bounds: target.bounds });
  while (bodyHistory.length > 2 && bodyHistory[0].t < now - BODY_HISTORY_MS) bodyHistory.shift();
}

// The lead an enemy shot still lacks this frame: its target lead minus the
// lead shown (negative shown leads start a flight in the hand).
export function victimLagMs(targetLeadMs, shownLeadMs) {
  const lag = (Number(targetLeadMs) || 0) - (Number(shownLeadMs) || 0);
  return Number.isFinite(lag) ? Math.max(0, Math.min(BODY_HISTORY_MS, lag)) : 0;
}

function localBodyAt(lagMs, now) {
  const live = localShotTarget();
  if (!live) return null;
  if (!(lagMs > 2) || !bodyHistory.length) return { ...live, origin: { x: live.sprite.x, y: live.sprite.y } };
  const at = now - lagMs;
  let frame = bodyHistory[0];
  for (const entry of bodyHistory) { if (entry.t > at) break; frame = entry; }
  return { name: live.name, sprite: live.sprite, bounds: frame.bounds, origin: { x: frame.x, y: frame.y } };
}

// Where a circle moving from a to b first meets this player's body as drawn
// `lagMs` ago (now by default), or null. `spanMs`: the flight time the
// segment covers; its earlier points were tested by the server against
// correspondingly earlier frames, so a long segment (the first frame of a
// shot, a catch-up) is split. `origin` is where the tested body was drawn:
// an offset from it places the shot on the body as drawn now.
export function localBodyContact(a, b, radius, { inset = false, lagMs = 0, spanMs = 0, now = performance.now() } = {}) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
  const span = Number(spanMs) > 0 ? Math.min(BODY_HISTORY_MS, Number(spanMs)) : 0;
  const pieces = span > 8 && bodyHistory.length ? Math.min(8, Math.ceil(span / 8)) : 1;
  const r = Math.max(0, Number(radius) || 0);
  for (let i = 1; i <= pieces; i++) {
    const f0 = (i - 1) / pieces, f1 = i / pieces;
    const target = localBodyAt((Number(lagMs) || 0) + (1 - f1) * span, now);
    if (!target) return null;
    const from = { x: a.x + (b.x - a.x) * f0, y: a.y + (b.y - a.y) * f0 }, to = { x: a.x + (b.x - a.x) * f1, y: a.y + (b.y - a.y) * f1 };
    const hit = firstTargetContact(from, to, r, [target], { inset });
    if (hit) return { ...hit, t: f0 + (f1 - f0) * hit.t, origin: target.origin };
  }
  return null;
}

// How long an enemy shot embedded in this player's body waits for the
// server before it is withdrawn: the server tests that frame `leadMs` (the
// lead shown at the contact) later, and its verdict takes a downlink.
export const VICTIM_CONFIRM_MARGIN_MS = 100;
export function victimHoldWindowMs(leadMs = 0) {
  const best = serverClock.bestSample?.();
  return Math.min(900, Math.max(0, Number(leadMs) || 0) + (best ? best.rtt / 2 : 75) + VICTIM_CONFIRM_MARGIN_MS);
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
// `traceId` (the projectile or request id) only labels production traces.
export function predictShotContact(a, b, radius, { inset = false, skip = null, traceId = null } = {}) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
  const contact = firstTargetContact(a, b, Math.max(0, Number(radius) || 0), displayedShotTargets(), { inset, skip });
  if (traceHook && contact?.target?.name) traceHook.prediction?.(contact.target.name, traceId, contact.x, contact.y, "released");
  return contact;
}

// Displayed targets an attached attack's shapes touch, skipping `skip`, each
// with the point drawn as struck (the target's centre).
export function predictAttachedContacts(shapes, { skip = null, traceId = null } = {}) {
  if (!shapes?.length) return [];
  const hits = [];
  for (const target of displayedShotTargets()) {
    if (skip?.has(target.name)) continue;
    const { bounds } = target;
    // Mode objects are tested at their centre, so their half width is reach.
    const reach = target.sprite ? 24 : 24 + (bounds.right - bounds.left) / 2;
    if (!shapes.some((shape) => shapeTouches(shape, bounds, { reach }))) continue;
    hits.push({ target, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 });
    traceHook?.prediction?.(target.name, traceId, hits[hits.length - 1].x, hits[hits.length - 1].y, "attached");
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

// Victim screen truth for production tracing (match/netTrace.js): each frame
// an enemy released shot that can damage this player is drawn, its id,
// shooter, the drawn collision circle, the lead it is drawn with, its view
// rewind, whether it is held on this player's body and its flight age (server
// age plus the lead shown; while held, the age its flight would have).
// Callers check enemyShotTraced() first, so an untraced tab computes nothing.
export function enemyShotTraced() {
  return !!traceHook?.enemyShot;
}
export function traceEnemyShot(id, shooter, character, x, y, radius, leadMs, rewindMs, held, age = null) {
  traceHook?.enemyShot?.(id, shooter, character, x, y, radius, leadMs, rewindMs, held, age);
}

// A predicted hit the shooter takes back because the server did not confirm it.
export function noteShotWithdrawn(kind, id = null) {
  traceHook?.withdrawn?.(kind, id);
}

export function resetShotPrediction() {
  viewMono = null;
  roster = { localUsername: null, opponentPlayersRef: null, localPlayer: null };
  staticTargets.clear();
  blockerSources.clear();
  bodyHistory.length = 0;
  predictedHits.length = 0;
}
