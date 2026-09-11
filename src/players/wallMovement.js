const MOVEMENT_PHYSICS = require('../shared/movementPhysics.json');

// Contact, jump buffering and attachment share one clock and one body state.
// No Phaser scene or rendering resources are required to exercise these rules.
function resolveWallContact(player, mapObjects = [], input = {}, now = Date.now()) {
  const wallSlideVerticalPadding = 6;
  const wallSlideSnapDistance = MOVEMENT_PHYSICS.wallSlideSnapDistance;
  const wallJumpHorizontalGracePx = MOVEMENT_PHYSICS.wallJumpHorizontalGracePx ?? 2;
  const wallJumpPressBufferMs = 120;
  const wallSlideReentryDelayMs = MOVEMENT_PHYSICS.wallSlideReentryDelayMs || 220;
  const touchingLeftNow =
    !!player.body.touching.left || !!player.body.blocked.left;
  const touchingRightNow =
    !!player.body.touching.right || !!player.body.blocked.right;
  const playerBodyLeft = player.body.x;
  const playerBodyRight = player.body.x + player.body.width;
  const playerBodyTop = player.body.y;
  const playerBodyBottom = player.body.y + player.body.height;
  let nearLeftWall = false;
  let nearRightWall = false;
  let leftWallGap = Number.POSITIVE_INFINITY;
  let rightWallGap = Number.POSITIVE_INFINITY;
  const wallObjects = mapObjects;
  if (Array.isArray(wallObjects)) {
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
        leftWallGap = Math.min(leftWallGap, gap);
        if (gap <= wallSlideSnapDistance) {
          nearLeftWall = true;
        }
      }
      if (body.checkCollision?.left !== false && objLeft >= playerBodyRight) {
        const gap = objLeft - playerBodyRight;
        rightWallGap = Math.min(rightWallGap, gap);
        if (gap <= wallSlideSnapDistance) {
          nearRightWall = true;
        }
      }
      if (nearLeftWall && nearRightWall) break;
    }
  }
  const nowWallTs = now;

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
  const bufferedNearLeftWall =
    Number.isFinite(leftWallGap) && leftWallGap <= horizontalKickReachPx;
  const bufferedNearRightWall =
    Number.isFinite(rightWallGap) && rightWallGap <= horizontalKickReachPx;
  const bufferedKickSide =
    bufferedNearLeftWall && !bufferedNearRightWall
      ? "left"
      : bufferedNearRightWall && !bufferedNearLeftWall
        ? "right"
        : bufferedNearLeftWall && bufferedNearRightWall
          ? leftWallGap <= rightWallGap
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
  return { wallSide, wallSlideContact, effectiveWallSide, bufferedJumpPressActive, wallSlideSuppressed, wallBrakeHeld };
}

function applyWallSlide(player, { dead, movementLocked, wallSlideContact, wallSide, wallBrakeHeld }, now = Date.now()) {
  const wallSlideMaxFallSpeed = MOVEMENT_PHYSICS.wallSlideMaxFallSpeed;
  const wallAttachNow = now;
  const wallAttachEligible =
    !dead &&
    !movementLocked &&
    !player.body.touching.down &&
    wallSlideContact &&
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
    // Keep horizontal attachment while upward momentum runs its natural course.
    player.setAccelerationX(0);
    player.setVelocityX(wallSide === "left"
      ? -MOVEMENT_PHYSICS.wallSlideAttachSpeed
      : MOVEMENT_PHYSICS.wallSlideAttachSpeed);
    if (player.body.velocity.y >= 0) {
      player.setVelocityY(Math.min(player.body.velocity.y,
        wallBrakeHeld ? MOVEMENT_PHYSICS.wallSlideBrakeFallSpeed : wallSlideMaxFallSpeed));
    }
  }
  return isWallSliding;
}

module.exports = { resolveWallContact, applyWallSlide };
