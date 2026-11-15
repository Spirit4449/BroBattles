// Legacy only (`netRemoteLead=legacy`): attacking and airborne actors were
// drawn this far ahead of the render timeline. Attack requests report one
// render time (`viewMono`) for every actor, so a per-actor lead made the server
// rewind targets 9-12 ms further than they were drawn; it is off by default.
// The lead approximated the average time advantage of the old alpha floors at
// 30 Hz (floor² / 2 * 33.33 ms), but crosses snapshot boundaries continuously.
export const REMOTE_SMOOTHING_CONFIG = Object.freeze({
  attackLeadMs: 12,
  airborneLeadMs: 9,
  transitionMs: 80,
});

export function readNetworkExperiments(search = "") {
  const params = new URLSearchParams(search);
  return {
    // The pre-2026-11 render delay (2 x spacing + 2 x jitter, 45-115 ms)
    // instead of the arrival-based one.
    delayMode: params.get("netRenderDelay") === "legacy" ? "spacing" : "arrival",
    // Draw attacking/airborne actors ahead of the timeline again (pairs with
    // the server's BB_VIEW_REWIND_CLOCK=simulation).
    legacyRemoteLead: params.get("netRemoteLead") === "legacy",
    // The pre-2026-11 Date.now() input throttle instead of once per frame.
    legacyInputCadence: params.get("netInputCadence") === "legacy",
  };
}

// The buffered target already interpolates movement. Follow it without a second
// deadband that would discard subpixel progress on high-refresh displays. Keep
// bounded recovery for corrections, and snap only unusually large teleports.
export function followRemotePosition(sprite, x, y, {
  deltaMs = 16.67, attack = false, airborne = false,
} = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const dx = x - sprite.x;
  const dy = y - sprite.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const speed = distance > 520 ? 5200 : distance > 260 ? 3600
    : attack ? 3000 : airborne ? 2300 : 1500;
  const maxStep = speed * Math.max(0, Math.min(250, deltaMs)) / 1000;
  if (distance > (attack ? 900 : 1600) || distance <= maxStep) {
    sprite.x = x;
    sprite.y = y;
  } else {
    sprite.x += dx / distance * maxStep;
    sprite.y += dy / distance * maxStep;
  }
}

// Death and respawn events arrive one interpolation delay ahead of the
// snapshots being drawn, and those older snapshots still show the previous
// life state. Socket.IO keeps one socket's messages in order, so every
// snapshot received before an event was emitted before it: such snapshots take
// the event's state instead, or they would undo the event until the timeline
// caught up (a revived corpse, a respawned player back at the death spot).
// `life` is `{ epoch, afterSeq, dead }` from the latest event, or null.
export function remoteLifeState(life, aState, aPos, bState, bPos) {
  const predates = (state) => !!life && Number.isFinite(life.afterSeq) &&
    (life.epoch == null || state?.snapshotEpoch === life.epoch) &&
    Number(state?.snapshotSeq) <= life.afterSeq;
  const deadIn = (state, pos) => !!pos && (predates(state) ? life.dead === true : pos.isAlive === false);
  const respawned = life?.dead === false;
  return {
    dead: deadIn(aState, aPos) || deadIn(bState, bPos),
    // Positions from before a respawn are the death spot: keep the sprite at
    // the spawn until the timeline reaches it, then jump to it without
    // interpolating across the map.
    holdPosition: respawned && predates(bState),
    newestOnly: respawned && predates(aState) && !predates(bState),
  };
}

// Every actor is drawn at the frame's render time, the `viewMono` attack
// requests report. The per-actor state only keeps an actor's time from going
// backwards across buffer resets.
export function sampleRemoteFrame(buffer, baseFrame, state, {
  attack = false, airborne = false, deltaMs = 16.67, snap = false, legacyLead = false,
} = {}) {
  if (!Number.isFinite(baseFrame?.targetMono)) return baseFrame;
  const generation = buffer.getGeneration();
  if (snap || state.generation !== generation) {
    state.generation = generation;
    state.time = null;
    state.lead = 0;
  }
  const config = REMOTE_SMOOTHING_CONFIG;
  const desiredLead = !legacyLead ? 0 : attack ? config.attackLeadMs : airborne ? config.airborneLeadMs : 0;
  const blend = 1 - Math.exp(-Math.max(0, deltaMs) / config.transitionMs);
  state.lead = (state.lead || 0) + (desiredLead - (state.lead || 0)) * blend;
  const target = baseFrame.targetMono + state.lead;
  // Returning from a precision window must never rewind an actor.
  state.time = state.time == null ? target : Math.max(state.time, target);
  return buffer.sampleAt(state.time) || baseFrame;
}
