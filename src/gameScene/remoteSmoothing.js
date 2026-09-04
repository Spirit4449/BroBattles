// The lead approximates the average time advantage of the old alpha floors at
// 30 Hz (floor² / 2 * 33.33 ms), but crosses snapshot boundaries continuously.
export const REMOTE_SMOOTHING_CONFIG = Object.freeze({
  attackLeadMs: 12,
  airborneLeadMs: 9,
  transitionMs: 80,
});

export function readNetworkExperiments(search = "") {
  const params = new URLSearchParams(search);
  return {
    continuousSmoothing: params.get("netSmoothing") !== "legacy",
    enableArrivalAdaptiveDelay: params.get("netArrivalDelay") === "1",
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

export function sampleRemoteFrame(buffer, baseFrame, state, {
  attack = false, airborne = false, deltaMs = 16.67, snap = false,
} = {}) {
  if (!Number.isFinite(baseFrame?.targetMono)) return baseFrame;
  const generation = buffer.getGeneration();
  if (snap || state.generation !== generation) {
    state.generation = generation;
    state.time = null;
    state.lead = 0;
  }
  const config = REMOTE_SMOOTHING_CONFIG;
  const desiredLead = attack ? config.attackLeadMs : airborne ? config.airborneLeadMs : 0;
  const blend = 1 - Math.exp(-Math.max(0, deltaMs) / config.transitionMs);
  state.lead = (state.lead || 0) + (desiredLead - (state.lead || 0)) * blend;
  const target = baseFrame.targetMono + state.lead;
  // Returning from a precision window must never rewind an actor.
  state.time = state.time == null ? target : Math.max(state.time, target);
  return buffer.sampleAt(state.time) || baseFrame;
}
