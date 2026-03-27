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
  getSurfaceCollisionConfig,
  getSolidCollisionConfig,
  getDefaultPlayerCollisionBox,
} = require("../core/gameRoom/mapNetRuntime");

function buildPlayerBounds(x, y, halfWidth, halfHeight) {
  return {
    left: x - halfWidth,
    right: x + halfWidth,
    top: y - halfHeight,
    bottom: y + halfHeight,
  };
}

function normalizeRect(rect) {
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function resolveStaticCollisions({
  previousX,
  previousY,
  x,
  y,
  vx,
  vy,
  isGrounded,
  inputIntent,
  mapId,
}) {
  const surfaces = getSurfaceCollisionConfig(mapId);
  const solids = getSolidCollisionConfig(mapId);
  const playerBox = getDefaultPlayerCollisionBox();
  const halfWidth = playerBox.halfWidth;
  const halfHeight = playerBox.halfHeight;
  let resolvedX = x;
  let resolvedY = y;
  let resolvedVx = vx;
  let resolvedVy = vy;
  let resolvedGrounded = isGrounded;
  let landed = false;

  const prevBounds = buildPlayerBounds(previousX, previousY, halfWidth, halfHeight);
  let nextBounds = buildPlayerBounds(resolvedX, resolvedY, halfWidth, halfHeight);

  if (resolvedVy >= 0) {
    let bestSurfaceY = null;
    for (const surface of surfaces) {
      const centerX = Number(surface?.x);
      const topY = Number(surface?.y);
      const width = Number(surface?.width);
      if (
        !Number.isFinite(centerX) ||
        !Number.isFinite(topY) ||
        !Number.isFinite(width)
      ) {
        continue;
      }
      const left = centerX - width / 2;
      const right = centerX + width / 2;
      const overlapX = nextBounds.right >= left && nextBounds.left <= right;
      const crossedTop =
        prevBounds.bottom <= topY && nextBounds.bottom >= topY;
      if (!overlapX || !crossedTop) continue;
      const candidateY = topY - halfHeight;
      if (bestSurfaceY === null || candidateY < bestSurfaceY) {
        bestSurfaceY = candidateY;
      }
    }
    if (bestSurfaceY !== null) {
      resolvedY = bestSurfaceY;
      resolvedVy = 0;
      resolvedGrounded = true;
      landed = true;
      nextBounds = buildPlayerBounds(resolvedX, resolvedY, halfWidth, halfHeight);
    }
  }

  if (!landed) {
    let bestLandingY = null;
    let bestCeilingY = null;
    for (const solid of solids) {
      const rect = normalizeRect(solid);
      if (!rect) continue;
      const overlapX = nextBounds.right >= rect.left && nextBounds.left <= rect.right;
      if (!overlapX) continue;

      if (resolvedVy >= 0) {
        const crossedTop =
          prevBounds.bottom <= rect.top && nextBounds.bottom >= rect.top;
        if (crossedTop) {
          const candidateY = rect.top - halfHeight;
          if (bestLandingY === null || candidateY < bestLandingY) {
            bestLandingY = candidateY;
          }
        }
      }

      if (resolvedVy < 0) {
        const crossedBottom =
          prevBounds.top >= rect.bottom && nextBounds.top <= rect.bottom;
        if (crossedBottom) {
          const candidateY = rect.bottom + halfHeight;
          if (bestCeilingY === null || candidateY > bestCeilingY) {
            bestCeilingY = candidateY;
          }
        }
      }
    }

    if (bestLandingY !== null) {
      resolvedY = bestLandingY;
      resolvedVy = 0;
      resolvedGrounded = true;
      landed = true;
      nextBounds = buildPlayerBounds(resolvedX, resolvedY, halfWidth, halfHeight);
    } else if (bestCeilingY !== null) {
      resolvedY = bestCeilingY;
      resolvedVy = 0;
      nextBounds = buildPlayerBounds(resolvedX, resolvedY, halfWidth, halfHeight);
    }
  }

  if (resolvedVx !== 0) {
    let bestRightStop = null;
    let bestLeftStop = null;
    const prevResolvedBounds = buildPlayerBounds(
      previousX,
      resolvedY,
      halfWidth,
      halfHeight,
    );
    nextBounds = buildPlayerBounds(resolvedX, resolvedY, halfWidth, halfHeight);

    for (const solid of solids) {
      const rect = normalizeRect(solid);
      if (!rect) continue;
      const overlapY = nextBounds.bottom > rect.top && nextBounds.top < rect.bottom;
      if (!overlapY) continue;

      if (resolvedVx > 0) {
        const crossedLeft =
          prevResolvedBounds.right <= rect.left &&
          nextBounds.right >= rect.left;
        if (crossedLeft) {
          const candidateX = rect.left - halfWidth;
          if (bestRightStop === null || candidateX < bestRightStop) {
            bestRightStop = candidateX;
          }
        }
      }

      if (resolvedVx < 0) {
        const crossedRight =
          prevResolvedBounds.left >= rect.right &&
          nextBounds.left <= rect.right;
        if (crossedRight) {
          const candidateX = rect.right + halfWidth;
          if (bestLeftStop === null || candidateX > bestLeftStop) {
            bestLeftStop = candidateX;
          }
        }
      }
    }

    if (bestRightStop !== null) {
      resolvedX = bestRightStop;
      resolvedVx = 0;
    } else if (bestLeftStop !== null) {
      resolvedX = bestLeftStop;
      resolvedVx = 0;
    }
  }

  if (
    !landed &&
    typeof inputIntent?.grounded === "boolean" &&
    inputIntent.grounded &&
    resolvedVy >= 0
  ) {
    resolvedGrounded = true;
    resolvedVy = 0;
  }

  return {
    x: resolvedX,
    y: resolvedY,
    vx: resolvedVx,
    vy: resolvedVy,
    isGrounded: resolvedGrounded,
    landed,
  };
}

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
  const previousX = playerState.x || 0;
  const previousY = playerState.y || 0;
  let x = previousX;
  let y = previousY;
  let vx = playerState.vx || 0;
  let vy = playerState.vy || 0;
  let isGrounded = playerState.isGrounded !== false;
  let lastGroundTime = playerState.lastGroundTime || 0;
  let canJump = playerState.canJump !== false;

  const direction = inputIntent?.direction || 0;
  const isJumping = !!inputIntent?.isJumping;
  const dtSec = dt / 1000;

  const gravity = MOVEMENT_PHYSICS.gravity;
  vy += gravity * dtSec;

  if (vy > 0 && !isGrounded) {
    const fallMult = MOVEMENT_PHYSICS.fallGravityFactor;
    vy += gravity * (fallMult - 1) * dtSec;
  }

  const maxVelY = 1000;
  if (vy > maxVelY) vy = maxVelY;

  const maxSpeed = MOVEMENT_PHYSICS.maxSpeed;
  const accel = MOVEMENT_PHYSICS.accel;
  const airAccel = MOVEMENT_PHYSICS.airAccel;
  const dragGround = MOVEMENT_PHYSICS.dragGround;
  const dragAir = MOVEMENT_PHYSICS.dragAir;
  const moveAccel = isGrounded ? accel : airAccel;
  const moveDrag = isGrounded ? dragGround : dragAir;

  if (direction !== 0) {
    const targetVx = direction * maxSpeed;
    vx += Math.sign(direction) * moveAccel * dtSec;
    if ((direction > 0 && vx > targetVx) || (direction < 0 && vx < targetVx)) {
      vx = targetVx;
    }
  } else {
    const dragDelta = moveDrag * dtSec;
    if (Math.abs(vx) <= dragDelta) vx = 0;
    else vx -= Math.sign(vx) * dragDelta;
  }

  if (vx > maxSpeed) vx = maxSpeed;
  if (vx < -maxSpeed) vx = -maxSpeed;

  if (isJumping && canJump && isGrounded) {
    vy = -MOVEMENT_PHYSICS.jumpSpeed;
    isGrounded = false;
    canJump = false;
    lastGroundTime = Date.now();
  }

  if (
    (playerState.collidingDown || false) ||
    (typeof inputIntent?.grounded === "boolean" && inputIntent.grounded && vy >= 0)
  ) {
    vy = 0;
    isGrounded = true;
    lastGroundTime = Date.now();
    canJump = true;
  }

  const coyoteTimeMs = MOVEMENT_PHYSICS.coyoteTimeMs;
  const timeSinceGround = Date.now() - lastGroundTime;
  if (timeSinceGround < coyoteTimeMs && !isJumping) {
    canJump = true;
  }

  x += vx * dtSec;
  y += vy * dtSec;

  const resolved = resolveStaticCollisions({
    previousX,
    previousY,
    x,
    y,
    vx,
    vy,
    isGrounded,
    inputIntent,
    mapId: options?.mapId || playerState?.mapId,
  });
  x = resolved.x;
  y = resolved.y;
  vx = resolved.vx;
  vy = resolved.vy;
  isGrounded = resolved.isGrounded;
  if (resolved.landed) {
    lastGroundTime = Date.now();
    canJump = true;
  }

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

function simulateMovementSequence(
  playerState,
  intents,
  dt = 16.67,
  options = {},
) {
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
