const { resolveShockwaveImpulse, SHOCKWAVE_MOMENTUM_MS } = require("./shockwaveImpulse");

function applyImpulse(player, impulse, now = Date.now()) {
  player._botDashCoastUntil = 0;
  player._dashUntil = 0;
  player._jumpLaunch = null;
  if (impulse.radial) { player.vx = Number(impulse.amountX) || 0; player.vy = Number(impulse.amountY) || 0; }
  else { player.vx = (Number(impulse.direction) || 1) * (Number(impulse.amountX) || 0); player.vy = -(Number(impulse.amountY) || 0); }
  if (["shockwave", "stomp"].includes(impulse.cause)) {
    const resolved = resolveShockwaveImpulse(player.vx, player.vy, {
      down: player.grounded, left: player.wallSide === "left", right: player.wallSide === "right",
    });
    player.vx = resolved.x; player.vy = resolved.y;
    player._slideSuppressedUntil = now + SHOCKWAVE_MOMENTUM_MS;
  }
  player._knockbackUntil = now + (["shockwave", "stomp"].includes(impulse.cause) ? SHOCKWAVE_MOMENTUM_MS : 180);
  player.grounded = false;
}

module.exports = { applyImpulse };
