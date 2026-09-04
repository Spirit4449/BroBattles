const tuning = require("../../../shared/movementPhysics.json");
const { characterBody } = require("../../../shared/duelGeometry");

function bounds(player) {
  const body = characterBody(player.char_class, player.flip);
  const x = player.x + body.offsetX, y = player.y + body.offsetY;
  return { ...body, left: x - body.halfWidth, right: x + body.halfWidth, top: y - body.halfHeight, bottom: y + body.halfHeight };
}
function overlaps(a, b, c, d) { return a < d - 0.01 && b > c + 0.01; }
function approach(value, target, amount) { return value < target ? Math.min(target, value + amount) : Math.max(target, value - amount); }

// Pure, fixed-step platform solver. Coordinates use the same sprite/body offsets as Phaser.
function stepBody(p, intent, geometry, dtMs, now, modifiers = {}) {
  const dt = dtMs / 1000;
  const speedMult = modifiers.speedMult ?? 1, jumpMult = modifiers.jumpMult ?? 1;
  const direction = Math.sign(intent.direction || 0);
  const events = [];
  const wasGrounded = !!p.grounded;
  p.vx = Number(p.vx) || 0; p.vy = Number(p.vy) || 0;
  p._lastGroundTime = p._lastGroundTime ?? -Infinity;
  if (wasGrounded) { p._lastGroundTime = now; p._jumpConsumed = false; }
  const wallSide = p.wallSide;
  const canWallJump = wallSide && now >= (p._nextWallJump || 0) && !wasGrounded;
  if (intent.jumpPressed && jumpMult > 0) {
    if (canWallJump) {
      p._jumpLaunch = null;
      const kick = wallSide === "left" ? 1 : -1;
      p.vx = kick * tuning.wallKickFull * Math.max(tuning.minSpeedMult, speedMult);
      p.vy = -Math.max(tuning.jumpSpeed + 30, 220) * tuning.wallKickVerticalMult * Math.max(tuning.minSpeedMult, jumpMult);
      p._wallKickUntil = now + tuning.wallKickLockMs;
      p._nextWallJump = now + tuning.wallJumpCooldownMs;
      p._slideSuppressedUntil = now + tuning.wallSlideReentryDelayMs;
      p.grounded = false; p._jumpConsumed = true;
      events.push("wall-jump");
    } else if (!p._jumpConsumed && (wasGrounded || now - p._lastGroundTime <= tuning.coyoteTimeMs)) {
      const boost = Math.min(tuning.jumpBoost, Math.abs(p.vx) / tuning.maxSpeed * tuning.jumpBoost);
      p.vy = -(tuning.jumpSpeed + boost) * Math.max(tuning.minSpeedMult, jumpMult);
      p._jumpLaunch = { startedAt: now, vy: p.vy * tuning.jumpLaunchSpeedMult };
      p.grounded = false; p._jumpConsumed = true; events.push("jump");
    }
  }
  const impulseLocked = now < (p._wallKickUntil || 0) || now < (p._knockbackUntil || 0);
  if (!impulseLocked) {
    const maxSpeed = tuning.maxSpeed * (speedMult <= 0 ? 0 : Math.max(tuning.minSpeedMult, speedMult));
    if (speedMult <= 0) p.vx = 0;
    else if (direction && speedMult > 0) p.vx = approach(p.vx, direction * maxSpeed, (p.grounded ? tuning.accel : tuning.airAccel) * dt);
    else p.vx = approach(p.vx, 0, (p.grounded ? tuning.dragGround : tuning.dragAir) * dt);
  }
  const sliding = wallSide && !p.grounded && direction === (wallSide === "left" ? -1 : 1) && now >= (p._slideSuppressedUntil || 0);
  p.vy += tuning.gravity * (p.vy > 5 && !sliding ? tuning.fallGravityFactor : 1) * dt;
  if (p._jumpLaunch) {
    const t = Math.min(1, (now - p._jumpLaunch.startedAt) / tuning.jumpRampMs);
    p.vy = p._jumpLaunch.vy * (tuning.jumpStartSpeedRatio + (1 - tuning.jumpStartSpeedRatio) * t);
    if (t >= 1) p._jumpLaunch = null;
  }
  if (sliding) p.vy = Math.min(p.vy, tuning.wallSlideMaxFallSpeed);
  const before = bounds(p);
  p.x += p.vx * dt;
  let b = bounds(p);
  p.wallSide = null;
  for (const rect of geometry.colliders) {
    if (!overlaps(before.top, before.bottom, rect.top, rect.bottom)) continue;
    if (p.vx > 0 && rect.collision.left && before.right <= rect.left + 0.1 && b.right >= rect.left) {
      p.x -= b.right - rect.left; p.vx = 0; p.wallSide = "right"; b = bounds(p);
    } else if (p.vx < 0 && rect.collision.right && before.left >= rect.right - 0.1 && b.left <= rect.right) {
      p.x += rect.right - b.left; p.vx = 0; p.wallSide = "left"; b = bounds(p);
    }
  }
  const world = geometry.world;
  p.x = Math.max(world.x + b.halfWidth - b.offsetX, Math.min(world.x + world.width - b.halfWidth - b.offsetX, p.x));
  const old = bounds(p);
  p.y += p.vy * dt;
  b = bounds(p); p.grounded = false; p.platformId = null;
  for (const rect of geometry.colliders) {
    if (!overlaps(b.left, b.right, rect.left, rect.right)) continue;
    if (p.vy >= 0 && rect.collision.up && old.bottom <= rect.top + 0.15 && b.bottom >= rect.top) {
      p.y -= b.bottom - rect.top; p.vy = 0; p._jumpLaunch = null; p.grounded = true; p.platformId = rect.id; b = bounds(p);
    } else if (p.vy < 0 && rect.collision.down && old.top >= rect.bottom - 0.15 && b.top <= rect.bottom) {
      p.y += rect.bottom - b.top; p.vy = 0; p._jumpLaunch = null; b = bounds(p);
    }
  }
  p.wallSliding = !!p.wallSide && !p.grounded && p.vy > 0;
  if (p.grounded) { p._lastGroundTime = now; p._jumpConsumed = false; if (!wasGrounded) events.push("land"); }
  p._bodyHalfWidth = b.halfWidth; p._bodyHalfHeight = b.halfHeight;
  p._bodyCenterOffsetX = b.offsetX; p._bodyCenterOffsetY = b.offsetY;
  p._lastWidth = b.displayWidth; p._lastHeight = b.displayHeight;
  return { events, fell: p.y > world.y + world.height + 50 };
}

function applyImpulse(player, impulse, now = Date.now()) {
  player._jumpLaunch = null;
  if (impulse.radial) { player.vx = Number(impulse.amountX) || 0; player.vy = Number(impulse.amountY) || 0; }
  else { player.vx = (Number(impulse.direction) || 1) * (Number(impulse.amountX) || 0); player.vy = -(Number(impulse.amountY) || 0); }
  player._knockbackUntil = now + 180; player.grounded = false;
}
module.exports = { bounds, stepBody, applyImpulse };
