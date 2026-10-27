const { HIT_STALENESS_MAX_MS } = require("../gameRoomConfig");
const { getHistoricalPosition } = require("./combatValidation");

// Shooter-favoring lag compensation for projectiles.
//
// A shooter's own shots are predicted from the moment they fire, while remote
// actors are drawn from a buffered past (the render timeline). A shot request
// carries that render time as `viewMono` (server simulation clock). The gap to
// the simulation time the request reaches the server is how far the shooter's
// shot runs ahead of the actors they aimed at, and it stays constant for the
// whole flight, so each projectile step tests targets where they stood that
// long before. The cap bounds how far behind cover a victim can still be hit.

// Overwrites any client-supplied `viewRewindMs`; humans' requests pass here.
// Allow the render buffer plus a small jitter margin even before a probe returns.
const VIEW_BUFFER_ALLOWANCE_MS = 150;
const LATENCY_SAMPLE_MAX_AGE_MS = 30000;
function rewindAllowance(latency, now = performance.now()) {
  const samples = (latency?.samples || []).filter(s => now - s.at <= LATENCY_SAMPLE_MAX_AGE_MS);
  // Full RTT tolerates asymmetric delivery and the remote render buffer's lag.
  return clampViewRewind(VIEW_BUFFER_ALLOWANCE_MS + (samples.length ? Math.min(...samples.map(s => s.rtt)) : 0));
}

// Server-originated acknowledgments measure elapsed time, never client numbers.
// One in flight per socket; the existing clock cadence drives probes (no timer).
function createLatencyProbe(room, socket) {
  const state = { samples: [], pending: false, lastProbe: -Infinity };
  state.probe = () => {
    const sent = performance.now();
    if (state.pending || sent - state.lastProbe < 100 || typeof socket.timeout !== 'function') return;
    state.pending = true; state.lastProbe = sent;
    socket.timeout(1500).emit('game:latency', {}, error => {
      state.pending = false;
      if (error || !room.players.has(socket.id) || socket.connected === false) return;
      const at = performance.now();
      state.samples = state.samples.filter(s => at - s.at <= LATENCY_SAMPLE_MAX_AGE_MS);
      state.samples.push({ at, rtt: Math.max(0, at - sent) });
      if (state.samples.length > 12) state.samples.shift();
    });
  };
  return state;
}

function stampViewRewind(room, request, latency) {
  if (!request || typeof request !== "object") return request;
  const view = request.viewMono;
  const now = Number(room?._simulationMono);
  request.viewRewindMs = Number.isFinite(view) && Number.isFinite(now) ? Math.min(clampViewRewind(now - view), rewindAllowance(latency)) : 0;
  return request;
}

function clampViewRewind(ms) {
  const value = Number(ms);
  return Number.isFinite(value) ? Math.max(0, Math.min(HIT_STALENESS_MAX_MS, value)) : 0;
}

// Where `player` stood `rewindMs` ago, from position history (wall clock).
function positionAt(player, rewindMs, now = Date.now()) {
  if (!(rewindMs > 0)) return { x: Number(player.x), y: Number(player.y) };
  return getHistoricalPosition(player, now - rewindMs);
}

// Position interpolates; posture/facing changes take effect at their sample.
function poseAt(player, rewindMs, now = Date.now()) {
  const position = positionAt(player, rewindMs, now);
  const history = player._posHistory || [];
  let sample = null;
  if (rewindMs > 0 && history.length) {
    sample = history[0];
    for (const entry of history) { if (entry.t > now - rewindMs) break; sample = entry; }
  }
  // Preserve each runtime's existing fallback for live/legacy bodies.
  return { _bodyHalfWidth: player._bodyHalfWidth, _bodyHalfHeight: player._bodyHalfHeight,
    _bodyCenterOffsetX: player._bodyCenterOffsetX, _bodyCenterOffsetY: player._bodyCenterOffsetY,
    ...(sample?.body || {}), ...position };
}

function collisionPose(player) {
  const { characterBody } = require('../../../shared/physics/characterBody');
  const { DUCK_HEIGHT_RATIO } = require('../../../shared/physics/ducking');
  const body = characterBody(player.char_class, player.flip);
  const height = body.height * (player.ducking ? DUCK_HEIGHT_RATIO : 1);
  return {
    _bodyHalfWidth: player._bodyHalfWidth ?? body.halfWidth,
    _bodyHalfHeight: player._bodyHalfHeight ?? height / 2,
    _bodyCenterOffsetX: player._bodyCenterOffsetX ?? body.offsetX,
    _bodyCenterOffsetY: player._bodyCenterOffsetY ?? body.offsetY + (body.height - height) / 2,
  };
}
module.exports = { stampViewRewind, clampViewRewind, positionAt, poseAt, collisionPose,
  createLatencyProbe, rewindAllowance, VIEW_BUFFER_ALLOWANCE_MS };
