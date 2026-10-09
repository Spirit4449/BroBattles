// gameScene/cameraDynamics.js

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const LIGHT_HIT_DAMAGE_LIMIT = 2000;
const MAX_SHAKE_DAMAGE = 6000;
const WALL_JUMP_RECOIL_IN_MS = 80;
const WALL_JUMP_RECOIL_OUT_MS = 220;
const WALL_JUMP_RECOIL_PX = 3;
const WALL_JUMP_ZOOM_RATIO = 0.01;
export const FOLLOW_LERP = { x: 0.08, y: 0.05 };

function movementFollowLerp(velocity, axis, delta) {
  // Preserve gentle walking/jump tracking, then tighten up for dashes and falls.
  const speed = Math.abs(Number(velocity) || 0);
  const fast = smoothstep((speed - 300) / 700);
  const perFrame = FOLLOW_LERP[axis] + (0.3 - FOLLOW_LERP[axis]) * fast;
  return 1 - Math.pow(1 - perFrame, delta / (1000 / 60));
}

function resetMovementCameraFeedback(scene, cam) {
  scene._wallJumpCameraKick = null;
  scene._wallJumpCameraOffsetX = 0;
  cam.setZoom(cam.zoom - (scene._wallJumpCameraZoom || 0) - (scene._dashCameraZoom || 0));
  scene._dashCameraZoom = 0;
  scene._dashCameraBaseZoom = null;
  scene._wallJumpCameraZoom = 0;
  scene._movementZoomRecoveryMs = WALL_JUMP_RECOIL_OUT_MS;
}

function bindMovementCameraFeedback(scene, cam) {
  if (scene._movementCameraCleanup || !cam.on) return;
  // The renderer emits this after follow, dead-zone, bounds and shake updates.
  // Matrix translation is in screen pixels, independent of camera zoom.
  const render = () => {
    if (scene._spectatorModeActive) {
      resetMovementCameraFeedback(scene, cam);
      return;
    }
    cam.matrix.e -= scene._wallJumpCameraOffsetX || 0;
  };
  const cleanup = () => {
    cam.off('prerender', render);
    cam.off('cameradestroy', cleanup);
    scene.events?.off('shutdown', cleanup);
    resetMovementCameraFeedback(scene, cam);
    scene._movementCameraCleanup = null;
  };
  cam.on('prerender', render);
  cam.once('cameradestroy', cleanup);
  scene.events?.once('shutdown', cleanup);
  scene._movementCameraCleanup = cleanup;
}

export function triggerWallJumpCameraKick(scene, direction) {
  if (!scene?.cameras?.main || !Number.isFinite(direction) || direction === 0) return;
  const cam = scene.cameras.main;
  bindMovementCameraFeedback(scene, cam);
  scene._wallJumpCameraKick = {
    direction: Math.sign(direction), elapsedMs: 0,
    startOffsetX: scene._wallJumpCameraOffsetX || 0,
    startZoom: scene._wallJumpCameraZoom || 0,
    baseZoom: cam.zoom - (scene._dashCameraZoom || 0) - (scene._wallJumpCameraZoom || 0),
  };
  scene._movementZoomRecoveryMs = 0;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

// Where the follow camera settles for a player standing at playerY: zoomed out
// as the player climbs (more vertical context) and biased down when high up
// (less empty sky). The arena camera (arenas.json) sets the zoom range and the
// heights it spans: maxZoom at or below climbY[1], minZoom at or above climbY[0].
export function restingCameraFrame(playerY, camera) {
  const [high, low] = camera.climbY;
  const t = clamp((playerY - high) / (low - high), 0, 1);
  return { zoom: camera.minZoom + (camera.maxZoom - camera.minZoom) * t, followOffsetY: 120 + 80 * (1 - t) };
}


export function updateDynamicCamera(scene, player) {
  if (!scene || !player) return;

  const cam = scene.cameras.main;

  const followDelta = clamp(scene.game.loop.delta || 1000 / 60, 0, 100);
  cam.setLerp(
    movementFollowLerp(player.body?.velocity?.x, 'x', followDelta),
    movementFollowLerp(player.body?.velocity?.y, 'y', followDelta),
  );

  // Smoothly approach the resting framing for the player's height.
  const { zoom: targetZoom, followOffsetY: targetFollowOffsetY } = restingCameraFrame(player.y, scene._mapArena.camera);
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const previousDashZoom = scene._dashCameraZoom || 0;
  const baseZoom = cam.zoom - previousDashZoom - (scene._wallJumpCameraZoom || 0);
  const dashing = !!player._dash && !reducedMotion;
  if (dashing) {
    if (scene._dashCameraBaseZoom == null) {
      scene._dashCameraBaseZoom = baseZoom;
      bindMovementCameraFeedback(scene, cam);
    }
    scene._movementZoomRecoveryMs = 0;
  } else {
    scene._dashCameraBaseZoom = null;
  }
  // Match the visible view at dash start, rather than the changing height target.
  const dashTarget = dashing ? scene._dashCameraBaseZoom * 0.025 : 0;
  const dashBlend = 1 - Math.exp(-Math.min(100, scene.game.loop.delta || 16.67) /
    (dashTarget ? 55 : 180));
  const dashZoom = previousDashZoom + (dashTarget - previousDashZoom) * dashBlend;

  const aim = scene._combatAimLook || { x: 0, y: 0 };
  const blend = 1 - Math.exp(-Math.min(100, scene.game.loop.delta || 16.67) / 140);
  // Camera follow already eases movement; keep this extra aim filter brief.
  const aimBlend = 1 - Math.exp(-Math.min(100, scene.game.loop.delta || 16.67) / 160);
  const previous = scene._aimCameraShift || { x: 0, y: 0 };
  const kick = scene._wallJumpCameraKick;
  let recoil = 0;
  let wallJumpZoom = 0;
  if (kick) {
    kick.elapsedMs += Math.max(0, scene.game.loop.delta || 16.67);
    if (!reducedMotion) {
      const peak = -kick.direction * WALL_JUMP_RECOIL_PX;
      const zoomPeak = kick.baseZoom * WALL_JUMP_ZOOM_RATIO;
      if (kick.elapsedMs < WALL_JUMP_RECOIL_IN_MS) {
        const progress = smoothstep(kick.elapsedMs / WALL_JUMP_RECOIL_IN_MS);
        recoil = kick.startOffsetX + (peak - kick.startOffsetX) * progress;
        wallJumpZoom = kick.startZoom + (zoomPeak - kick.startZoom) * progress;
      } else {
        const remaining = 1 - smoothstep((kick.elapsedMs - WALL_JUMP_RECOIL_IN_MS) / WALL_JUMP_RECOIL_OUT_MS);
        recoil = peak * remaining;
        wallJumpZoom = zoomPeak * remaining;
      }
    }
    if (reducedMotion || kick.elapsedMs >= WALL_JUMP_RECOIL_IN_MS + WALL_JUMP_RECOIL_OUT_MS) {
      scene._wallJumpCameraKick = null;
    }
  }
  // Freeze the resting zoom during the pulse so ascent cannot cancel it.
  // Resume height tracking gradually afterward, without a catch-up snap.
  let restingZoom = baseZoom;
  if (kick && !reducedMotion) restingZoom = kick.baseZoom;
  else if (dashing) restingZoom = scene._dashCameraBaseZoom;
  if ((!kick || reducedMotion) && !dashing) {
    const delta = Math.max(0, scene.game.loop.delta || 16.67);
    const recovery = reducedMotion ? WALL_JUMP_RECOIL_OUT_MS : Math.min(WALL_JUMP_RECOIL_OUT_MS,
      (scene._movementZoomRecoveryMs ?? WALL_JUMP_RECOIL_OUT_MS) + delta);
    scene._movementZoomRecoveryMs = recovery;
    const zoomBlend = (1 - Math.pow(0.95, delta / (1000 / 60))) * smoothstep(recovery / WALL_JUMP_RECOIL_OUT_MS);
    restingZoom += (targetZoom - restingZoom) * zoomBlend;
  }
  cam.setZoom(restingZoom + dashZoom + wallJumpZoom);
  scene._dashCameraZoom = dashZoom;
  scene._wallJumpCameraZoom = wallJumpZoom;
  // Only aim affects follow and bounds; recoil is applied by the renderer.
  const shift = {
    x: previous.x + (aim.x - previous.x) * aimBlend,
    y: previous.y + (aim.y - previous.y) * aimBlend,
  };
  // Move the clamp window with the seek as well as the follow point. Otherwise
  // bounds erase the entire aim offset when the player is at either map edge.
  if (cam.useBounds && cam._bounds) {
    const bounds = cam._bounds;
    cam.setBounds(bounds.x - previous.x + shift.x, bounds.y - previous.y + shift.y,
      bounds.width, bounds.height);
  }
  scene._aimCameraShift = shift;
  scene._wallJumpCameraOffsetX = recoil;
  scene._resetAimCameraBounds = () => {
    const offset = scene._aimCameraShift;
    if (!offset) return;
    if (cam.useBounds && cam._bounds) {
      const bounds = cam._bounds;
      cam.setBounds(bounds.x - offset.x, bounds.y - offset.y, bounds.width, bounds.height);
    }
    cam.setFollowOffset(0, cam.followOffset.y + offset.y);
    scene._aimCameraShift = null;
    resetMovementCameraFeedback(scene, cam);
  };
  cam.setFollowOffset(
    -shift.x,
    cam.followOffset.y + previous.y +
      (targetFollowOffsetY - (cam.followOffset.y + previous.y)) * blend - shift.y,
  );
}

export function triggerDamageCameraShake(scene, damage) {
  const cam = scene?.cameras?.main;
  const damageAmount = Math.max(0, Number(damage) || 0);
  if (!cam || damageAmount <= 0) return;

  let duration;
  let intensity;

  if (damageAmount < LIGHT_HIT_DAMAGE_LIMIT) {
    // Keep chip and damage-over-time hits just visible without making them noisy.
    const lightHitRatio = damageAmount / LIGHT_HIT_DAMAGE_LIMIT;
    duration = Math.round(38 + lightHitRatio * 17);
    intensity = 0.0002 + lightHitRatio * 0.0003;
  } else {
    // Past 2,000 damage, ease into the full shake so heavy hits feel distinct.
    const heavyHitRatio = smoothstep(
      (damageAmount - LIGHT_HIT_DAMAGE_LIMIT) /
        (MAX_SHAKE_DAMAGE - LIGHT_HIT_DAMAGE_LIMIT),
    );
    duration = Math.round(55 + heavyHitRatio * 60);
    intensity = 0.0005 + heavyHitRatio * 0.0035;
  }

  cam.shake(duration, intensity, false);
}
