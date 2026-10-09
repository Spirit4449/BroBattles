const { resolveShockwaveImpulse, SHOCKWAVE_MOMENTUM_MS } = require("../../../shared/physics/shockwaveImpulse");
const tuning = require("../../../shared/physics/movementPhysics.json");
const { FALL_OUT_DEPTH } = require("../../../shared/gameConstants");
const { characterBody } = require("../../../shared/physics/duelGeometry");
const { DUCK_SPEED_RATIO } = require("../../../shared/physics/ducking");
const { acceptDash } = require('../../../shared/physics/dash');
const { sweepMovement, resolveOverlap } = require('../../../shared/physics/sweptCollision');
const { advanceGeometry, PLATFORM_STEP_UP_PX } = require('../../../shared/maps/platformMotion');

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
  p.vx = direction.x * tuning.dashHorizontalSpeed;
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
  return { events: !wasGrounded && p.grounded ? ['land'] : [], fell: p.y > world.y + world.height + FALL_OUT_DEPTH };
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
      p.vy = -Math.max(tuning.jumpSpeed + tuning.wallKickVerticalBonus, tuning.wallKickMinVerticalSpeed) * tuning.wallKickVerticalMult * Math.max(tuning.minSpeedMult, jumpMult);
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
  p.vy += tuning.gravity * (p.vy > tuning.fallGravityMinSpeed && !sliding ? tuning.fallGravityFactor : 1) * dt;
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
  return { events, fell: p.y > world.y + world.height + FALL_OUT_DEPTH };
}

// Applies one tick of platform motion (advanceGeometry's result) to a body,
// matching the client (client/game/maps/movingPlatforms.js): a rider moves
// with its platform and a platform whose colliding leading face runs into a
// body pushes it, both swept against other ground. A body that ground would
// trap stays where the sweep stops and the platform passes through it;
// stepBody ignores colliders a body already overlaps. A body inside a platform
// for any other reason is stopped at the colliding face it crossed during its
// last step, as at a wall (onto the top only from within PLATFORM_STEP_UP_PX);
// faces with collision off are passed through. Leaving a platform gives no
// extra speed. Call every tick on maps with moving platforms, before stepBody.
function carryOnPlatforms(p, moved, colliders) {
  const sweep = (mx, my, others) => {
    const b = bounds(p);
    const result = sweepMovement({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }, mx, my, others);
    p.x += result.x - b.left; p.y += result.y - b.top;
    return Math.abs(result.x - b.left - mx) < 0.01 && Math.abs(result.y - b.top - my) < 0.01;
  };
  // Where the body began its last step, relative to each platform's position then.
  const stepStart = p._platformStepStart;
  for (const { collider, dx, dy } of moved) {
    const others = colliders.filter((c) => c !== collider);
    if (p.grounded && p.platformId === collider.id) {
      if (!sweep(dx, dy, others) && dy < 0) { p.grounded = false; p.platformId = null; }
      continue;
    }
    const b = bounds(p);
    const inside = (r) => b.left < r.right - 0.01 && b.right > r.left + 0.01 && b.top < r.bottom - 0.01 && b.bottom > r.top + 0.01;
    if (!inside(collider)) continue;
    const previous = { left: collider.left - dx, right: collider.right - dx, top: collider.top - dy, bottom: collider.bottom - dy };
    if (inside(previous)) {
      if (!stepStart) continue;
      const before = { left: stepStart.left + dx, right: stepStart.right + dx, top: stepStart.top + dy, bottom: stepStart.bottom + dy };
      const exit = resolveOverlap(b, collider, PLATFORM_STEP_UP_PX, before);
      if (!exit) continue;
      p.x += exit.dx; p.y += exit.dy;
      if (exit.dx) p.vx = 0;
      if (exit.face === 'up') p.vy = Math.max(0, p.vy || 0);
      if (exit.face === 'down') { p.vy = Math.min(0, p.vy || 0); p.grounded = true; p.platformId = collider.id; }
      continue;
    }
    const c = collider.collision || {};
    if (dx > 0 ? c.right === false : dx < 0 ? c.left === false : false) continue;
    if (dy > 0 ? c.down === false : dy < 0 ? c.up === false : false) continue;
    const pushed = sweep(dx > 0 ? collider.right - b.left : dx < 0 ? collider.left - b.right : 0,
      dy > 0 ? collider.bottom - b.top : dy < 0 ? collider.top - b.bottom : 0, others);
    if (pushed && dy < 0) { p.vy = Math.min(p.vy || 0, 0); p.grounded = true; p.platformId = collider.id; }
  }
  const b = bounds(p);
  p._platformStepStart = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
}

// Predictions must see platforms where they will be, not frozen where they
// are. Returns a private geometry; step(p, elapsedMs) moves its platforms to
// `elapsedMs` after the source geometry's time and carries the body.
function forecastGeometry(geometry) {
  if (!geometry?.movingColliders?.length) return { geometry, step() {} };
  const copies = new Map(geometry.movingColliders.map((c) => [c, { ...c }]));
  const forecast = { ...geometry, colliders: geometry.colliders.map((c) => copies.get(c) || c),
    movingColliders: [...copies.values()] };
  const start = geometry.motionTime ?? 0;
  return { geometry: forecast,
    step(p, elapsedMs) {
      const previous = forecast.motionTime;
      const moved = advanceGeometry(forecast, start + elapsedMs);
      if (forecast.motionTime > previous) carryOnPlatforms(p, moved, forecast.colliders);
    } };
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
module.exports = { bounds, stepBody, applyImpulse, startDash, carryOnPlatforms, forecastGeometry };
