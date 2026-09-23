const physics = require('./movementPhysics.json');

function dashDirection(left, right, up, down, facing = 1) {
  const x = Number(!!right) - Number(!!left);
  const y = Number(!!down) - Number(!!up);
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: facing < 0 ? -1 : 1, y: 0 };
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
  player._dashReadyAt = now + physics.dashDurationMs + physics.dashCooldownMs;
  player._dashUntil = now + physics.dashDurationMs;
  player.dashSeq = id;
  player.dashX = x;
  player.dashY = y;
  player._stompPendingUntil = x === 0 && y === 1 && !player.grounded ? now + physics.dashDurationMs + physics.dashCoastMs : 0;
  return true;
}
module.exports = { dashDirection, acceptDash };
