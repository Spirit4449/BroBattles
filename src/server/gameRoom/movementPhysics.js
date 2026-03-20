/**
 * Shared movement physics constants between client (Phaser) and server.
 * CRITICAL: Keep these synchronized between client/server to prevent desync.
 * Client: src/player.js handlePlayerMovement()
 * Server: src/server/gameRoom/movementSimulator.js
 */

const MOVEMENT_PHYSICS = {
  // Horizontal movement
  maxSpeed: 260,
  accel: 3500, // ground acceleration
  airAccel: 2300, // air acceleration
  dragGround: 1300, // slowdown on ground when no input
  dragAir: 200, // subtle slowdown in air

  // Vertical movement
  gravity: 950, // world gravity (px/s²)
  fallGravityFactor: 1.35, // multiplier for downward acceleration while falling

  // Jumping
  jumpSpeed: 450, // base jump velocity
  jumpBoost: 10, // bonus based on horizontal speed
  coyoteTimeMs: 130, // grace window after leaving ledge
  coyoteSpeedThreshold: 130, // don't count as grounded if falling faster than this

  // Wall mechanics
  wallJumpCooldownMs: 320,
  wallSlideMaxFallSpeed: 160,
  wallKickLockMs: 160,
  wallJumpGraceMs: 120,
  wallJumpGracePx: 20,
  wallKickSmall: 150,
  wallKickFull: 360,

  // Speed multipliers (applied by powerups/effects)
  minSpeedMult: 0.5,
  maxSpeedMult: 2.0,
};

module.exports = MOVEMENT_PHYSICS;
