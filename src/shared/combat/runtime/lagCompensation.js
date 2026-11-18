const { SOCKET_EVENTS } = require("../../net/socketEvents.js");
const { HIT_STALENESS_MAX_MS } = require("../matchConfig.js");
const { getHistoricalPosition } = require("./combatValidation.js");
const { characterBody } = require('../../physics/characterBody');
const { DUCK_HEIGHT_RATIO } = require('../../physics/ducking');
const { combatMono } = require('./clock');
const { MAX_RENDER_DELAY_MS } = require('../../gameConstants');

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
    socket.timeout(1500).emit(SOCKET_EVENTS.GAME_LATENCY, {}, error => {
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

// The rewind is measured from the request's arrival on the server's monotonic
// clock: attacks start (and look up position history) at the arrival instant,
// and the simulation clock trails it by the loop's unspent remainder (0-17 ms,
// more during catch-up). `BB_VIEW_REWIND_CLOCK=simulation` restores the old
// simulation-clock stamp for comparisons; it pairs with the client's
// `netRemoteLead=legacy`, which restores the lead it compensated.
const STAMP_WITH_SIMULATION_CLOCK = typeof process !== 'undefined' && process.env?.BB_VIEW_REWIND_CLOCK === 'simulation';
function stampViewRewind(room, request, latency) {
  if (!request || typeof request !== "object") return request;
  const view = request.viewMono;
  const now = Number(STAMP_WITH_SIMULATION_CLOCK ? room?.simulationMono : combatMono(room));
  request.viewRewindMs = Number.isFinite(view) && Number.isFinite(now) ? Math.min(clampViewRewind(now - view), rewindAllowance(latency)) : 0;
  // The part of that rewind the client reports as its render buffer: never
  // more than the client maximum or the rewind itself. Deliveries cap only
  // the remainder (attackDelivery.clampDeliveryRewind).
  const buffer = typeof request.viewDelayMs === 'number' ? request.viewDelayMs : NaN;
  request.viewBufferMs = Number.isFinite(buffer) ? Math.max(0, Math.min(buffer, MAX_RENDER_DELAY_MS, request.viewRewindMs)) : 0;
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

// Net traces only: the victim's own timestamp (client Date.now()) of the
// position a rewind of `rewindMs` tests, interpolated between the history
// samples around it; null for server-side moves and bots.
function clientTimeAt(player, rewindMs, now = Date.now()) {
  const history = player?._posHistory || [];
  if (!history.length) return null;
  const at = now - (Number(rewindMs) > 0 ? Number(rewindMs) : 0);
  const last = history[history.length - 1];
  if (at >= last.t) return Number.isFinite(last.ts) ? last.ts : null;
  if (at <= history[0].t) return Number.isFinite(history[0].ts) ? history[0].ts : null;
  for (let i = history.length - 1; i > 0; i--) {
    const newer = history[i], older = history[i - 1];
    if (at < older.t || at > newer.t) continue;
    if (!Number.isFinite(newer.ts) || !Number.isFinite(older.ts)) return null;
    const alpha = Math.max(0, Math.min(1, (at - older.t) / Math.max(1e-6, newer.t - older.t)));
    return older.ts + (newer.ts - older.ts) * alpha;
  }
  return null;
}

function collisionPose(player) {
  const body = characterBody(player.char_class, player.flip);
  const height = body.height * (player.ducking ? DUCK_HEIGHT_RATIO : 1);
  return {
    _bodyHalfWidth: player._bodyHalfWidth ?? body.halfWidth,
    _bodyHalfHeight: player._bodyHalfHeight ?? height / 2,
    _bodyCenterOffsetX: player._bodyCenterOffsetX ?? body.offsetX,
    _bodyCenterOffsetY: player._bodyCenterOffsetY ?? body.offsetY + (body.height - height) / 2,
  };
}
module.exports = { stampViewRewind, positionAt, poseAt, collisionPose, clientTimeAt,
  createLatencyProbe, rewindAllowance, VIEW_BUFFER_ALLOWANCE_MS };
