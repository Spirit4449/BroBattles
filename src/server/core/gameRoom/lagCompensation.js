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
function stampViewRewind(room, request) {
  if (!request || typeof request !== "object") return request;
  const view = Number(request.viewMono);
  const now = Number(room?._simulationMono);
  request.viewRewindMs = Number.isFinite(view) && Number.isFinite(now) ? clampViewRewind(now - view) : 0;
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

module.exports = { stampViewRewind, clampViewRewind, positionAt };
