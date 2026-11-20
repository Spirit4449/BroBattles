const physics = require('./movementPhysics.json');

function dashDirection(left, right, up, down, facing = 1) {
  const x = Number(!!right) - Number(!!left);
  const y = Number(!!down) - Number(!!up);
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: facing < 0 ? -1 : 1, y: 0 };
}

function canArmStomp(directionY, grounded) {
  return directionY > 0 && !grounded;
}

// Repeated position packets carry the same activation ID. Only a new,
// server-approved activation can grant one burst's worth of distance credit.
function acceptDash(player, input, now) {
  const id = input.dashSeq;
  if (!Number.isSafeInteger(id) || id <= (player._dashSeq || 0)) return false;
  player._dashSeq = id;
  if (now < (player._dashReadyAt || 0) || !player.isAlive ||
      now < Math.max(player._controlLockUntil || 0, player._knockbackUntil || 0)) return false;
  const x = Number(input.dashX), y = Number(input.dashY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(Math.hypot(x, y) - 1) > 0.01) return false;
  // A mode can shorten the reload for its players (Bro Ball sets _dashCooldownMs).
  player._dashReadyAt = now + physics.dashDurationMs + (player._dashCooldownMs ?? physics.dashCooldownMs);
  player._dashUntil = now + physics.dashDurationMs;
  player.dashSeq = id;
  player.dashX = x;
  player.dashY = y;
  player._stompPendingUntil = canArmStomp(y, player.grounded) ? Number.MAX_SAFE_INTEGER : 0;
  player._stompStartY = player._stompPendingUntil ? player.y : null;
  return true;
}
module.exports = { dashDirection, canArmStomp, acceptDash };
