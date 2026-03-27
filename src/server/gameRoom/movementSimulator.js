/**
 * Server-side movement simulation for Phase 2 netcode improvements.
 * Simulates player movement using the same physics constants as client.
 * Output stored separately (_simX/_simY) for hit validation; NOT broadcast to client yet.
 *
 * CRITICAL SAFEGUARD: This is a NON-INVASIVE implementation. Simulation results
 * are stored but NOT applied to the player's main x/y position. The local client
 * player is never snapped from server positions (prevents physics conflicts).
 */

const MOVEMENT_PHYSICS = require("./movementPhysics");
const {
  getWorldBoundsForMap,
  clampToWorldBounds,
} = require("../core/gameRoom/mapNetRuntime");

/**
 * Simulate a single fixed-timestep movement tick for a player.
 * Returns {x, y, vx, vy} without modifying playerData in-place.
 *
 * @param {object} playerState - { x, y, vx, vy, isGrounded, lastGroundTime, ... }
 * @param {object} inputIntent - { direction: [-1|0|1], isJumping: bool }
 * @param {number} dt - timestep in milliseconds
 * @returns {object} { x, y, vx, vy, isGrounded, canJump }
 */
function simulateMovementTick(playerState, inputIntent, dt, options = {}) {
  // Unpack state (use current values, don't modify original)
  let x = playerState.x || 0;
  let y = playerState.y || 0;
  let vx = playerState.vx || 0;
  let vy = playerState.vy || 0;
  let isGrounded = playerState.isGrounded !== false;
  let lastGroundTime = playerState.lastGroundTime || 0;
  let canJump = playerState.canJump !== false;

  // Unpack input (default to idle if missing)
  const direction = inputIntent?.direction || 0;
  const isJumping = !!inputIntent?.isJumping;

  // Convert dt to seconds
  const dtSec = dt / 1000;

  // ===== GRAVITY & FALLING =====
  const gravity = MOVEMENT_PHYSICS.gravity;
  vy += gravity * dtSec;

  // Fast-fall when dropping (increase gravity multiplier)
  if (vy > 0 && !isGrounded) {
    const fallMult = MOVEMENT_PHYSICS.fallGravityFactor;
    vy += gravity * (fallMult - 1) * dtSec;
  }

  // Apply ceiling: max downward velocity (optional)
  const maxVelY = 1000; // reasonable terminal velocity
  if (vy > maxVelY) vy = maxVelY;

  // ===== HORIZONTAL MOVEMENT =====
  const maxSpeed = MOVEMENT_PHYSICS.maxSpeed;
  const accel = MOVEMENT_PHYSICS.accel;
  const airAccel = MOVEMENT_PHYSICS.airAccel;
  const dragGround = MOVEMENT_PHYSICS.dragGround;
  const dragAir = MOVEMENT_PHYSICS.dragAir;

  const moveAccel = isGrounded ? accel : airAccel;
  const moveDrag = isGrounded ? dragGround : dragAir;

  // Apply direction-based acceleration
  if (direction !== 0) {
    const targetVx = direction * maxSpeed;
    const accelPerSec = moveAccel;
    vx += Math.sign(direction) * accelPerSec * dtSec;
    if ((direction > 0 && vx > targetVx) || (direction < 0 && vx < targetVx)) {
      vx = targetVx;
    }
  } else {
    const dragDelta = moveDrag * dtSec;
    if (Math.abs(vx) <= dragDelta) vx = 0;
    else vx -= Math.sign(vx) * dragDelta;
  }

  // Clamp horizontal velocity
  if (vx > maxSpeed) vx = maxSpeed;
  if (vx < -maxSpeed) vx = -maxSpeed;

  // ===== JUMPING =====
  if (isJumping && canJump && isGrounded) {
    vy = -MOVEMENT_PHYSICS.jumpSpeed;
    isGrounded = false;
    canJump = false;
    lastGroundTime = Date.now();
  }

  // ===== LANDING & COYOTE =====
  if (
    (playerState.collidingDown || false) ||
    (typeof inputIntent?.grounded === "boolean" && inputIntent.grounded && vy >= 0)
  ) {
    vy = 0;
    isGrounded = true;
    lastGroundTime = Date.now();
    canJump = true;
  }

  // Coyote time: allow jump shortly after leaving ground
  const coyoteTimeMs = MOVEMENT_PHYSICS.coyoteTimeMs;
  const timeSinceGround = Date.now() - lastGroundTime;
  if (timeSinceGround < coyoteTimeMs && !isJumping) {
    canJump = true;
  }

  // ===== POSITION UPDATE =====
  x += vx * dtSec;
  y += vy * dtSec;

  // ===== WORLD BOUNDS CLAMPING =====
  const bounds =
    options?.bounds || getWorldBoundsForMap(options?.mapId || playerState?.mapId);
  const clamped = clampToWorldBounds(bounds, x, y);
  x = clamped.x;
  y = clamped.y;

  return {
    x,
    y,
    vx,
    vy,
    isGrounded,
    lastGroundTime,
    canJump,
  };
}

/**
 * Convenience: Process multiple input intents over time.
 * Useful for catch-up or batch processing.
 *
 * @param {object} playerState - initial state
 * @param {array} intents - [{ direction, isJumping, timestamp }, ...]
 * @returns {object} final state after all intents processed
 */
function simulateMovementSequence(playerState, intents, dt = 16.67, options = {}) {
  let state = { ...playerState };
  for (const intent of intents) {
    state = simulateMovementTick(state, intent, dt, options);
  }
  return state;
}

module.exports = {
  simulateMovementTick,
  simulateMovementSequence,
};
