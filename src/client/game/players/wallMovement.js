const MOVEMENT_PHYSICS = require('../../../shared/physics/movementPhysics.json');
const { isStepFace } = require('../../../shared/physics/wallJumpFace');

function standableSurfaces(mapObjects, playerBody) {
  const surfaces = [];
  for (const obj of mapObjects) {
    const body = obj?.body;
    if (!body || body === playerBody || body.enable === false) continue;
    const left = Number(body.x) || 0;
    surfaces.push({ left, right: left + (Number(body.width) || 0), top: Number(body.y) || 0, up: body.checkCollision?.up !== false });
  }
  return surfaces;
}

// Contact, jump buffering and attachment share one clock and one body state.
// No Phaser scene or rendering resources are required to exercise these rules.
function resolveWallContact(player, mapObjects = [], input = {}, now = Date.now()) {
  const wallSlideVerticalPadding = 6;
  const wallSlideSnapDistance = MOVEMENT_PHYSICS.wallSlideSnapDistance;
  const wallJumpHorizontalGracePx = MOVEMENT_PHYSICS.wallJumpHorizontalGracePx;
  const wallJumpPressBufferMs = 120;
  const wallSlideReentryDelayMs = MOVEMENT_PHYSICS.wallSlideReentryDelayMs;
  const playerBodyLeft = player.body.x;
  const playerBodyRight = player.body.x + player.body.width;
  const playerBodyTop = player.body.y;
  const playerBodyBottom = player.body.y + player.body.height;
  let nearLeftWall = false;
  let nearRightWall = false;
  // Distance to the walls beside the body, and whether a step is beside it.
  // Steps are neither slid on nor kicked off.
  let leftKickGap = Number.POSITIVE_INFINITY;
  let rightKickGap = Number.POSITIVE_INFINITY;
  let stepOnLeft = false;
  let stepOnRight = false;
  const maxKickReachPx = wallSlideSnapDistance + wallJumpHorizontalGracePx;
  const wallObjects = mapObjects;
  if (Array.isArray(wallObjects)) {
    let surfaces = null;
    const stepFace = (objTop) => isStepFace(objTop,
      { left: playerBodyLeft, right: playerBodyRight, bottom: playerBodyBottom },
      surfaces ||= standableSurfaces(wallObjects, player.body));
    for (const obj of wallObjects) {
      const body = obj?.body;
      if (!body || body === player.body || body.enable === false) continue;
      const bodyWidth = Number(body.width) || 0;
      const bodyHeight = Number(body.height) || 0;
      if (bodyWidth <= 0 || bodyHeight <= 0) continue;

      const objLeft = Number(body.x) || 0;
      const objRight = objLeft + bodyWidth;
      const objTop = Number(body.y) || 0;
      const objBottom = objTop + bodyHeight;
      const verticallyAligned =
        playerBodyBottom > objTop + wallSlideVerticalPadding &&
        playerBodyTop < objBottom - wallSlideVerticalPadding;
      if (!verticallyAligned) continue;

      if (body.checkCollision?.right !== false && playerBodyLeft >= objRight) {
        const gap = playerBodyLeft - objRight;
        if (gap <= maxKickReachPx) {
          if (stepFace(objTop)) {
            stepOnLeft = true;
          } else {
            leftKickGap = Math.min(leftKickGap, gap);
            if (gap <= wallSlideSnapDistance) nearLeftWall = true;
          }
        }
      }
      if (body.checkCollision?.left !== false && objLeft >= playerBodyRight) {
        const gap = objLeft - playerBodyRight;
        if (gap <= maxKickReachPx) {
          if (stepFace(objTop)) {
            stepOnRight = true;
          } else {
            rightKickGap = Math.min(rightKickGap, gap);
            if (gap <= wallSlideSnapDistance) nearRightWall = true;
          }
        }
      }
    }
  }
  const nowWallTs = now;
  // Contact with something outside mapObjects, such as a built wall, still counts.
  const touchingLeftNow =
    (!!player.body.touching.left || !!player.body.blocked.left) && !stepOnLeft;
  const touchingRightNow =
    (!!player.body.touching.right || !!player.body.blocked.right) && !stepOnRight;

  // A fresh jump press detaches; an already-held Up input brakes the slide.
  const wallBrakeHeld = input.upHeld &&
    !player.body.touching.down &&
    (touchingLeftNow || touchingRightNow || nearLeftWall || nearRightWall);
  const upKeyFreshPress = input.jumpPressed;
  if (upKeyFreshPress) player._lastJumpPressTime = nowWallTs;
  const bufferedJumpPressActive =
    nowWallTs - (player._lastJumpPressTime || 0) <= wallJumpPressBufferMs;
  const horizontalKickReachPx =
    wallSlideSnapDistance +
    (bufferedJumpPressActive ? wallJumpHorizontalGracePx : 0);
  const kickableLeftWall = leftKickGap <= horizontalKickReachPx || touchingLeftNow;
  const kickableRightWall = rightKickGap <= horizontalKickReachPx || touchingRightNow;
  const bufferedKickSide =
    kickableLeftWall && !kickableRightWall
      ? "left"
      : kickableRightWall && !kickableLeftWall
        ? "right"
        : kickableLeftWall && kickableRightWall
          ? leftKickGap <= rightKickGap
            ? "left"
            : "right"
          : null;
  const wallSlideLeft = touchingLeftNow || nearLeftWall;
  const wallSlideRight = touchingRightNow || nearRightWall;
  const wallSlideContact = wallSlideLeft || wallSlideRight;
  const wallSide = touchingLeftNow
    ? "left"
    : touchingRightNow
      ? "right"
      : nearLeftWall
        ? "left"
        : nearRightWall
          ? "right"
          : null;
  // Buffered presses still work, but remembered contact cannot extend jump reach.
  const effectiveWallSide = wallSide || bufferedKickSide;
  const movingAwayFromWall =
    (wallSide === "left" && input.right && !input.left) ||
    (wallSide === "right" && input.left && !input.right);
  if (movingAwayFromWall) {
    player._wallSlideSuppressedUntil = nowWallTs + wallSlideReentryDelayMs;
  }
  const wallSlideSuppressed =
    (player._wallSlideSuppressedUntil || 0) > nowWallTs;
  // Held input toward the wall; collision zeroes velocity once in contact.
  const drivingIntoWall =
    (wallSide === "left" && !!input.left && !input.right) ||
    (wallSide === "right" && !!input.right && !input.left);
  return { wallSide, wallSlideContact, effectiveWallSide, bufferedJumpPressActive, wallSlideSuppressed, wallBrakeHeld, drivingIntoWall };
}

function applyWallSlide(player, { dead, movementLocked, wallSlideContact, wallSide, wallBrakeHeld, drivingIntoWall = false }, now = Date.now()) {
  const wallSlideMaxFallSpeed = MOVEMENT_PHYSICS.wallSlideMaxFallSpeed;
  const wallAttachNow = now;
  // Rising straight up beside a wall never starts a slide. Moving into the wall
  // (held input or momentum) still does, and an attach already under way holds.
  const velocityX = Number(player.body.velocity?.x) || 0;
  const headingIntoWall = drivingIntoWall ||
    (wallSide === "right" && velocityX > 0) ||
    (wallSide === "left" && velocityX < 0);
  const risingPastWall =
    (Number(player.body.velocity?.y) || 0) < 0 &&
    !headingIntoWall &&
    player._wallAttachSide !== wallSide;
  const wallAttachEligible =
    !dead &&
    !movementLocked &&
    !player.body.touching.down &&
    wallSlideContact &&
    !risingPastWall &&
    (player._wallSlideSuppressedUntil || 0) <= wallAttachNow;
  if (!wallAttachEligible) {
    player._wallAttachSide = null;
    player._wallAttachStartedAt = null;
  } else if (player._wallAttachSide !== wallSide) {
    player._wallAttachSide = wallSide;
    player._wallAttachStartedAt = wallAttachNow;
  }
  const isWallSliding = wallAttachEligible &&
    wallAttachNow - player._wallAttachStartedAt >= MOVEMENT_PHYSICS.wallSlideAttachDelayMs;
  if (isWallSliding) {
    // Contact can brake descent, but must never pull the player into a wall
    // or replace the horizontal velocity/acceleration chosen by movement.
    const velocityY = Number(player.body.velocity.y) || 0;
    const lastAt = player._wallRiseDragAt;
    const dt = lastAt == null ? 0 : Math.min(0.05, Math.max(0, (wallAttachNow - lastAt) / 1000));
    if (velocityY >= 0) {
      let capped = Math.min(velocityY,
        wallBrakeHeld ? MOVEMENT_PHYSICS.wallSlideBrakeFallSpeed : wallSlideMaxFallSpeed);
      // After stalling on the wall, the slide picks up speed gently, so the
      // turn at the apex hangs instead of snapping straight back down.
      const prevVy = player._wallSlidePrevVy;
      if (lastAt != null && Number.isFinite(prevVy)) {
        capped = Math.min(capped, Math.max(0, prevVy) + MOVEMENT_PHYSICS.wallSlideFallAccel * dt);
      }
      player.setVelocityY(capped);
    } else if (!player._jumpLaunch && lastAt != null) {
      // Rising along a wall bleeds upward speed on top of gravity, so a jump
      // into a wall stalls instead of carrying the player far up its face.
      player.setVelocityY(Math.min(0, velocityY + MOVEMENT_PHYSICS.wallSlideRiseDrag * dt));
    }
  }
  player._wallRiseDragAt = isWallSliding ? wallAttachNow : null;
  player._wallSlidePrevVy = isWallSliding ? Number(player.body.velocity.y) || 0 : null;
  return isWallSliding;
}

// A wall-slide pose faces the contacted surface. Horizontal input normally owns
// flipX, so knockback/momentum can otherwise leave the slide using the stale
// facing direction from before impact.
function resolveWallSlideFlipX(wallSide, velocityX = 0, currentFlipX = false) {
  if (wallSide === "left") return true;
  if (wallSide === "right") return false;
  const horizontalVelocity = Number(velocityX) || 0;
  if (horizontalVelocity !== 0) return horizontalVelocity < 0;
  return !!currentFlipX;
}

module.exports = { resolveWallContact, applyWallSlide, resolveWallSlideFlipX };
