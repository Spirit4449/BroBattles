// A positional contact correction must not erase motion tangent to the face.
// Phaser Body.reset() also stops velocity AND acceleration, unlike a teleport.
function applyMovementCorrection(player, correction) {
  const body = player?.body;
  if (!body || !Number.isFinite(correction?.x) || !Number.isFinite(correction?.y)) return;
  if (correction.reason !== 'collision') {
    body.reset(correction.x, correction.y);
    return;
  }
  const vx = body.velocity.x, vy = body.velocity.y;
  const ax = body.acceleration.x, ay = body.acceleration.y;
  const hits = correction.contacts || {};
  const blocksX = value => (value < 0 && hits.left) || (value > 0 && hits.right);
  const blocksY = value => (value < 0 && hits.up) || (value > 0 && hits.down);
  body.reset(correction.x, correction.y);
  body.setVelocity(blocksX(vx) ? 0 : vx, blocksY(vy) ? 0 : vy);
  body.setAcceleration(blocksX(ax) ? 0 : ax, blocksY(ay) ? 0 : ay);
}

const SENT_HISTORY_LIMIT = 128;
const SMOOTH_TIME_MS = 70;
const INSTANT_BELOW_PX = 1;
const SNAP_ABOVE_PX = 240;
const DIAGNOSTIC_HISTORY_LIMIT = 40;

// Server corrections describe where the player should have been when a given
// packet was sent, which is already a round trip in the past. Shifting the
// current position by that error (instead of teleporting to the stale point)
// preserves movement made since, and small errors are blended in over a few
// frames rather than snapped.
function createMovementCorrector({ now = () => Date.now() } = {}) {
  const sent = new Map();
  let ack = 0;
  let pendingX = 0;
  let pendingY = 0;
  const stats = {
    received: 0, applied: 0, ignoredStale: 0, unacknowledgedWhileDead: 0,
    budget: 0, collision: 0, smoothed: 0, snapped: 0,
    lastPx: 0, maxPx: 0, totalPx: 0, history: [],
  };

  function recordSent(sequence, x, y) {
    if (!Number.isSafeInteger(sequence) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    sent.set(sequence, { x, y });
    if (sent.size > SENT_HISTORY_LIMIT) sent.delete(sent.keys().next().value);
  }

  function moveBody(player, x, y) {
    const body = player.body;
    const vx = body.velocity.x, vy = body.velocity.y;
    const ax = body.acceleration.x, ay = body.acceleration.y;
    body.reset(x, y);
    body.setVelocity(vx, vy);
    body.setAcceleration(ax, ay);
  }

  function note(entry) {
    stats.history.push({ at: now(), ...entry });
    if (stats.history.length > DIAGNOSTIC_HISTORY_LIMIT) stats.history.shift();
  }

  function apply(player, correction) {
    if (!Number.isFinite(correction?.x) || !Number.isFinite(correction?.y)) return false;
    stats.received += 1;
    const id = Number(correction.correctionId);
    if (Number.isFinite(id)) {
      if (id <= ack) {
        stats.ignoredStale += 1;
        return false;
      }
      // Acknowledge even when nothing can be moved, so the server does not keep
      // discarding this client's packets as pre-correction traffic.
      ack = id;
    }
    const body = player?.body;
    if (!body || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      stats.unacknowledgedWhileDead += 1;
      return false;
    }

    const collision = correction.reason === 'collision';
    stats[collision ? 'collision' : 'budget'] += 1;
    // Unknown sequences (older servers or evicted history) fall back to the
    // absolute server position.
    const sample = sent.get(Number(correction.sequence)) || { x: player.x, y: player.y };
    let targetX = player.x + (correction.x - sample.x);
    let targetY = player.y + (correction.y - sample.y);

    if (collision) {
      // A blocked axis cannot lie past the contacted face, but the player may
      // already have moved away from it since the packet was sent.
      const hits = correction.contacts || {};
      if (hits.right) targetX = Math.min(player.x, correction.x);
      else if (hits.left) targetX = Math.max(player.x, correction.x);
      if (hits.down) targetY = Math.min(player.y, correction.y);
      else if (hits.up) targetY = Math.max(player.y, correction.y);
    }

    const offsetX = targetX - player.x;
    const offsetY = targetY - player.y;
    const distance = Math.hypot(offsetX, offsetY);
    let mode = 'instant';
    if (collision) {
      pendingX = pendingY = 0;
      applyMovementCorrection(player, { ...correction, x: targetX, y: targetY });
    } else {
      // A newer correction is computed from a packet that already included any
      // blending in progress, so it replaces (never adds to) the remainder.
      pendingX = pendingY = 0;
      if (distance > SNAP_ABOVE_PX) {
        mode = 'snap';
        stats.snapped += 1;
        moveBody(player, targetX, targetY);
      } else if (distance >= INSTANT_BELOW_PX) {
        mode = 'smooth';
        stats.smoothed += 1;
        pendingX = offsetX;
        pendingY = offsetY;
      } else if (distance > 0) {
        moveBody(player, targetX, targetY);
      }
    }
    const errorPx = Number(correction.errorPx);
    const reportedPx = Number.isFinite(errorPx) ? errorPx : distance;
    stats.applied += 1;
    stats.lastPx = reportedPx;
    stats.totalPx += reportedPx;
    stats.maxPx = Math.max(stats.maxPx, reportedPx);
    note({ id: Number.isFinite(id) ? id : null, sequence: correction.sequence,
      reason: collision ? 'collision' : 'budget', errorPx: reportedPx,
      appliedPx: Math.round(distance * 10) / 10, mode });
    return true;
  }

  // Call once per frame before physics-driven packets are sent. Moving the game
  // object is picked up by the arcade body in its next preUpdate, and Phaser's
  // postUpdate applies body deltas additively, so velocity is untouched.
  function update(player, deltaMs) {
    if (!pendingX && !pendingY) return;
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      pendingX = pendingY = 0;
      return;
    }
    const k = 1 - Math.exp(-Math.max(0, Math.min(250, Number(deltaMs) || 0)) / SMOOTH_TIME_MS);
    let stepX = pendingX * k;
    let stepY = pendingY * k;
    if (Math.hypot(pendingX - stepX, pendingY - stepY) < 0.25) {
      stepX = pendingX;
      stepY = pendingY;
    }
    player.x += stepX;
    player.y += stepY;
    pendingX -= stepX;
    pendingY -= stepY;
  }

  // Teleports (spawn, respawn) invalidate both blending and sent history.
  function clear() {
    pendingX = pendingY = 0;
    sent.clear();
  }

  function getDiagnostics() {
    return { ack, pendingPx: Math.hypot(pendingX, pendingY), ...stats,
      history: stats.history.slice() };
  }

  return { recordSent, getAck: () => ack, apply, update, clear, getDiagnostics };
}

module.exports = { applyMovementCorrection, createMovementCorrector };
