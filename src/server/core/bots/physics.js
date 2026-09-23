const { resolveShockwaveImpulse, SHOCKWAVE_MOMENTUM_MS } = require("../../../shared/shockwaveImpulse");
const tuning = require("../../../shared/movementPhysics.json");
const { characterBody } = require("../../../shared/duelGeometry");
const { DUCK_SPEED_RATIO } = require("../../../shared/ducking");
const { acceptDash } = require('../../../shared/dash');
const { sweepMovement } = require('../../../shared/sweptCollision');

function bounds(player) {
  const body = characterBody(player.char_class, player.flip);
  const x = player.x + body.offsetX, y = player.y + body.offsetY;
  return { ...body, left: x - body.halfWidth, right: x + body.halfWidth, top: y - body.halfHeight, bottom: y + body.halfHeight };
}
function overlaps(a, b, c, d) { return a < d - 0.01 && b > c + 0.01; }
function approach(value, target, amount) { return value < target ? Math.min(target, value + amount) : Math.max(target, value - amount); }

function startDash(p, direction, now) {
  if (p._botActionUntil > now || !acceptDash(p, {
    dashSeq: (p._dashSeq || 0) + 1, dashX: direction.x, dashY: direction.y,
  }, now)) return false;
  p.vx = direction.x * tuning.dashSpeed;
  p.vy = direction.y * (direction.x === 0 && direction.y > 0 ? tuning.dashDownSpeed : tuning.dashSpeed);
  p._botDashCoastUntil = p._dashUntil + tuning.dashCoastMs;
  p._botDashWallContact = false;
  p._jumpLaunch = null;
  p._wallKickUntil = 0;
  p.ducking = false;
  if (direction.x) p.flip = direction.x < 0;
  return true;
}

// The preview and live bot share this swept solver, including the full coast.
function stepDash(p, intent, geometry, dtMs, now, modifiers) {
  const dt = dtMs / 1000, bursting = now < p._dashUntil;
  const wasGrounded = p.grounded, direction = Math.sign(intent.direction || 0);
  if (!bursting) {
    const maxSpeed = tuning.maxSpeed * (modifiers.speedMult ?? 1);
    const coasting = Math.abs(p.vx) > maxSpeed && (!direction || direction === Math.sign(p.vx));
    const drag = p.grounded ? tuning.dashSurfaceDrag : tuning.dashCoastDrag;
    p.vx = approach(p.vx, coasting ? 0 : direction * maxSpeed,
      (coasting ? drag : direction ? tuning.airAccel : p.grounded ? tuning.dragGround : tuning.dragAir) * dt);
  }
  if (!bursting || p._botDashWallContact) p.vy += tuning.gravity * dt;
  const before = bounds(p);
  const result = sweepMovement({ x: before.left, y: before.top,
    width: before.halfWidth * 2, height: before.halfHeight * 2 }, p.vx * dt, p.vy * dt, geometry.colliders);
  p.x += result.x - before.left; p.y += result.y - before.top;
  const world = geometry.world;
  const x = Math.max(world.x + before.halfWidth - before.offsetX,
    Math.min(world.x + world.width - before.halfWidth - before.offsetX, p.x));
  if (x !== p.x || result.hits.left || result.hits.right) p.vx = 0;
  p.x = x;
  if (result.hits.up || result.hits.down) p.vy = 0;
  const b = bounds(p);
  const support = geometry.colliders.find(r => r.collision.up && p.vy >= 0 &&
    Math.abs(b.bottom - r.top) < 0.5 && overlaps(b.left, b.right, r.left, r.right));
  const wall = geometry.colliders.find(r => overlaps(b.top, b.bottom, r.top, r.bottom) &&
    ((r.collision.left && Math.abs(b.right - r.left) < 0.5) ||
     (r.collision.right && Math.abs(b.left - r.right) < 0.5)));
  p.grounded = !!support; p.platformId = support?.id ?? null;
  p.wallSide = wall ? (Math.abs(b.right - wall.left) < 0.5 ? 'right' : 'left') : null;
  if (wall) { p._botDashWallContact = true; p.vy *= Math.exp(-tuning.dashWallDragRate * dt); }
  if (bursting && (support || result.hits.up)) p.vx = approach(p.vx, 0, tuning.dashSurfaceDrag * dt);
  const strength = bursting ? 1 : Math.max(0, (p._botDashCoastUntil - now) / tuning.dashCoastMs) ** 2;
  p.vy /= 1 + tuning.dashVerticalResistance * Math.abs(p.vy) * dt * strength;
  if (wall && !p.grounded && direction === (p.wallSide === 'left' ? -1 : 1)) p.vy = Math.min(p.vy, tuning.wallSlideMaxFallSpeed);
  p.wallSliding = !!wall && !p.grounded && p.vy > 0;
  if (p.grounded) { p._lastGroundTime = now; p._jumpConsumed = false; }
  p._bodyHalfWidth = b.halfWidth; p._bodyHalfHeight = b.halfHeight;
  p._bodyCenterOffsetX = b.offsetX; p._bodyCenterOffsetY = b.offsetY;
  p._lastWidth = b.displayWidth; p._lastHeight = b.displayHeight;
  return { events: !wasGrounded && p.grounded ? ['land'] : [], fell: p.y > world.y + world.height + 50 };
}

// Pure, fixed-step platform solver. Coordinates use the same sprite/body offsets as Phaser.
function stepBody(p, intent, geometry, dtMs, now, modifiers = {}) {
  const launched = intent.dash && (modifiers.speedMult ?? 1) > 0 && startDash(p, intent.dash, now);
  if (p._knockbackUntil > now || p._controlLockUntil > now || modifiers.speedMult === 0) {
    p._botDashCoastUntil = 0;
    p._dashUntil = 0;
  }
  if (p._dashUntil && now < (p._botDashCoastUntil || 0)) {
    if (now < p._dashUntil || !intent.jumpPressed) {
      const result = stepDash(p, intent, geometry, dtMs, now, modifiers);
      if (launched) result.events.unshift('dash');
      return result;
    }
    p._botDashCoastUntil = 0;
  }
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
  if (intent.jumpPressed && jumpMult > 0 && now >= (p._knockbackUntil || 0)) {
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
    const duckSpeed = p.ducking && p.grounded ? DUCK_SPEED_RATIO : 1;
    const maxSpeed = tuning.maxSpeed * duckSpeed * (speedMult <= 0 ? 0 : Math.max(tuning.minSpeedMult, speedMult));
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
module.exports = { bounds, stepBody, applyImpulse, startDash };
