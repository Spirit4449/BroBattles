/**
 * Shared movement physics constants between client (Phaser) and server.
 * Client-side version (JavaScript modules).
 * CRITICAL: Keep these perfectly synchronized with server/gameRoom/movementPhysics.js
 */

export const MOVEMENT_PHYSICS = {
  // Horizontal movement
  maxSpeed: 260,
  accel: 3500, // ground acceleration
  airAccel: 3300, // air acceleration
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
  wallJumpGracePx: 50,
  wallKickSmall: 150,
  wallKickFull: 360,

  // Speed multipliers (applied by powerups/effects)
  minSpeedMult: 0.5,
  maxSpeedMult: 2.0,
};
