// Moves map platforms that have `motion` (see shared/maps/platformMotion.js).
// Positions come from the estimated server clock, so every client and the
// server agree without replicating platform state.
//
// A platform carries players standing on it and pushes players it runs into,
// sweeping them against other solid ground. Its sides and underside are walls:
// a player who crosses one of those faces any other way (a dash, a fast step)
// is stopped at it, and steps onto the top only from within
// PLATFORM_STEP_UP_PX. Faces with collision off are passed through. When that ground would trap a
// player, the platform passes through them instead of crushing them. Leaving a
// platform gives no extra speed. The server applies the same rules to bots
// (bots/physics.js carryOnPlatforms).
import { motionOffset, PLATFORM_STEP_UP_PX } from '../../../shared/maps/platformMotion';
import { sweepMovement, resolveOverlap } from '../../../shared/physics/sweptCollision';
import { serverNowMono } from '../match/serverClock';

// Feet within this distance of a platform top ride it.
const RIDE_TOLERANCE_PX = 3;
// Remote positions are older than the platform time they are compared to.
const REMOTE_RIDE_TOLERANCE_PX = 12;

export function platformClock() {
  return serverNowMono() ?? performance.now();
}

function movingObjects(scene) {
  return (scene?._mapObjects || []).filter((object) => object?._mapMotion && object.body);
}

function overlapsHorizontally(left, right, surface) {
  return right > surface.left + 0.5 && left < surface.right - 0.5;
}

function overlaps(a, b) {
  return a.right > b.left + 0.01 && a.left < b.right - 0.01 && a.bottom > b.top + 0.01 && a.top < b.bottom - 0.01;
}

function standsOn(body, surface) {
  return surface.enable && surface.checkCollision.up && body.velocity.y >= -1 &&
    Math.abs(body.bottom - surface.top) <= RIDE_TOLERANCE_PX &&
    overlapsHorizontally(body.left, body.right, surface);
}

// Moves a rider's body by up to (dx, dy), stopping at solid map ground.
// Returns whether the whole distance was travelled.
function moveRider(rider, dx, dy, obstacles) {
  const body = rider.body;
  const result = sweepMovement({ x: body.left, y: body.top, width: body.width, height: body.height }, dx, dy, obstacles);
  const movedX = result.x - body.left, movedY = result.y - body.top;
  rider.setPosition(rider.x + movedX, rider.y + movedY);
  body.updateFromGameObject();
  return Math.abs(movedX - dx) < 0.01 && Math.abs(movedY - dy) < 0.01;
}

// Call before the physics step.
export function advanceMovingPlatforms(scene, timeMs, riders = []) {
  const objects = movingObjects(scene);
  const solid = (scene?._mapObjects || []).map((object) => object.body).filter((body) => body?.enable);
  const active = riders.filter((rider) => rider?.body?.enable);
  for (const object of objects) {
    const body = object.body, offset = motionOffset(object._mapMotion, timeMs);
    const dx = object._mapBase.x + offset.x - object.x, dy = object._mapBase.y + offset.y - object.y;
    const carried = dx || dy ? active.filter((rider) => standsOn(rider.body, body)) : [];
    const before = { left: body.left, right: body.right, top: body.top, bottom: body.bottom };
    object.setPosition(object.x + dx, object.y + dy);
    body.updateFromGameObject();
    const passing = (object._passThrough ||= new Set());
    for (const rider of passing) if (!overlaps(rider.body, body)) passing.delete(rider);
    if (!body.enable) continue;
    const obstacles = solid.filter((other) => other !== body);
    for (const rider of active) {
      if (carried.includes(rider)) {
        // A rider stopped by a wall keeps standing while the platform slides
        // beneath; one stopped by a ceiling is passed through, not crushed.
        if (!moveRider(rider, dx, dy, obstacles) && dy < 0) passing.add(rider);
        continue;
      }
      // Only the platform's own travel pushes; an overlap that already existed
      // is settled like a wall after the physics step.
      if (passing.has(rider) || !overlaps(rider.body, body) || overlaps(rider.body, before)) continue;
      // The leading face must collide: an open side or underside passes over riders.
      const c = body.checkCollision;
      if (dx > 0 ? !c.right : dx < 0 ? !c.left : false) continue;
      if (dy > 0 ? !c.down : dy < 0 ? !c.up : false) continue;
      const b = rider.body;
      const pushX = dx > 0 ? body.right - b.left : dx < 0 ? body.left - b.right : 0;
      const pushY = dy > 0 ? body.bottom - b.top : dy < 0 ? body.top - b.bottom : 0;
      if (!moveRider(rider, pushX, pushY, obstacles)) passing.add(rider);
      else if (dy < 0) rider.body.velocity.y = Math.min(rider.body.velocity.y, 0);
    }
  }
}

// Call after the physics step (and dash correction). A rider that crossed a
// colliding face of a moving platform during the step is stopped at that face,
// as at a wall. Body.prev is the rider at the start of the step, and the
// platform already stood where it is now (it moves before the step).
export function settleMovingPlatformOverlaps(scene, riders = []) {
  for (const object of movingObjects(scene)) {
    const surface = object.body;
    if (!surface.enable) continue;
    for (const rider of riders) {
      const body = rider?.body;
      if (!body?.enable || object._passThrough?.has(rider) || !overlaps(body, surface)) continue;
      const before = { left: body.prev.x, top: body.prev.y, right: body.prev.x + body.width, bottom: body.prev.y + body.height };
      const exit = resolveOverlap(body, surface, PLATFORM_STEP_UP_PX, before);
      if (!exit) continue;
      body.x += exit.dx; body.y += exit.dy;
      body.updateCenter();
      body.blocked[exit.face] = true; body.touching[exit.face] = true;
      body.blocked.none = false; body.touching.none = false;
      if (exit.face === 'left' || exit.face === 'right') body.velocity.x = 0;
      else if (exit.face === 'up') body.velocity.y = Math.max(0, body.velocity.y);
      else body.velocity.y = Math.min(0, body.velocity.y);
    }
  }
}

// Collision process callback filter: a platform passing through a trapped
// player must not also be separated from them by Arcade.
export function passesThrough(player, platform) {
  return !!platform?._passThrough?.has(player);
}

export function installMovingPlatforms(scene, { riders = () => [], paused = () => false } = {}) {
  if (!movingObjects(scene).length) return () => {};
  const step = () => { if (!paused()) advanceMovingPlatforms(scene, platformClock(), riders()); };
  const settle = () => { if (!paused()) settleMovingPlatformOverlaps(scene, riders()); };
  scene.events.on('preupdate', step);
  // Registered after the local player's dash correction, so this runs last.
  scene.physics.world.on('worldstep', settle);
  const remove = () => { scene.events.off('preupdate', step); scene.physics.world.off('worldstep', settle); };
  scene.events.once('shutdown', remove);
  return remove;
}

// Remote players render from snapshots older than the platforms they stand on.
// Returns how far a grounded remote sprite at (x, y) must move to stay on the
// platform it was riding at `fromMono`, now that the platform is drawn at `toMono`.
export function remoteRideOffset(scene, sprite, x, y, fromMono, toMono) {
  const none = { x: 0, y: 0 };
  const body = sprite?.body;
  if (!body || !Number.isFinite(fromMono) || !Number.isFinite(toMono)) return none;
  const feet = y + body.bottom - sprite.y, left = x + body.left - sprite.x, right = x + body.right - sprite.x;
  for (const object of movingObjects(scene)) {
    const surface = object.body;
    if (!surface.enable || !surface.checkCollision.up) continue;
    const then = motionOffset(object._mapMotion, fromMono), now = motionOffset(object._mapMotion, toMono);
    const shiftX = object._mapBase.x + then.x - object.x, shiftY = object._mapBase.y + then.y - object.y;
    const past = { left: surface.left + shiftX, right: surface.right + shiftX, top: surface.top + shiftY };
    if (Math.abs(feet - past.top) <= REMOTE_RIDE_TOLERANCE_PX && overlapsHorizontally(left, right, past)) {
      return { x: now.x - then.x, y: now.y - then.y };
    }
  }
  return none;
}
