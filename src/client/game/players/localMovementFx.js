// Per-frame movement presentation for the local fighter: footstep cadence,
// turn bursts, wall-slide sparks, fast-fall trails, landing impacts and run
// dust. Gameplay never reads this state; it only follows the physics body.
// `hidden` (invisibility powerup) suppresses visuals but not audio/events.
import {
  MOVEMENT_VFX_CONFIG,
  spawnDirectionChangeBurst,
  spawnFastFallTrail,
  spawnLandingImpact,
  spawnRunDust,
  spawnWallSlideBurst,
  spawnWallSlideTrail,
} from "../scene/effects";
import { shouldPlayLandingSound, terrainLandingSound } from "../audio/movementAudio";

// Same semantics as Phaser.Math.Clamp (NaN passes through, so NaN-driven
// comparisons below stay false exactly as before extraction).
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (from, to, t) => from + (to - from) * t;
const bodyBottom = (player) => Number(player.body?.bottom) || player.y + player.height * 0.5;

/**
 * @param {object} deps
 * @param {ReturnType<import("./localMovementAudio").createLocalMovementAudio>} deps.audio
 * @param {(type: string, details?: object) => void} deps.noteEvent Replicated movement FX events.
 */
export function createLocalMovementFx({ audio, noteEvent }) {
  let walkStepElapsed = 0;
  let wasGroundWalking = false;
  let lastGroundInputDirection = 0;
  let lastDirectionChangeAt = 0;
  let wasWallSliding = false;
  let wallSlideElapsed = 0;
  let fastFallElapsed = 0;
  let wasOnGround = false;
  let initialized = false;
  let lastAirborneVelocityY = 0;
  let airbornePeakBottomY = null;
  let dustElapsed = 0;

  function reset() {
    wasOnGround = false;
    initialized = false;
    lastAirborneVelocityY = 0;
    airbornePeakBottomY = null;
    wasWallSliding = false;
    wallSlideElapsed = 0;
    fastFallElapsed = 0;
    lastGroundInputDirection = 0;
    lastDirectionChangeAt = 0;
    wasGroundWalking = false;
  }

  // A dash detaches from any wall without the slide's exit handling.
  function clearWallSlide() {
    wasWallSliding = false;
  }

  // Ducking snaps the body to the floor; treat it as already landed.
  function markGrounded() {
    wasOnGround = true;
    lastAirborneVelocityY = 0;
    airbornePeakBottomY = null;
  }

  // Turn bursts and footsteps while walking on the ground.
  function updateGroundMotion(scene, player, { inputDirection, maxSpeed, dead, hidden, attacking }) {
    const grounded = player.body.touching.down;
    const groundSpeed = Math.abs(Number(player.body.velocity.x) || 0);
    const speedRatio = clamp01(groundSpeed / maxSpeed);
    if (
      !dead && !hidden && grounded &&
      inputDirection !== 0 && lastGroundInputDirection !== 0 &&
      inputDirection !== lastGroundInputDirection &&
      groundSpeed >= MOVEMENT_VFX_CONFIG.directionChangeMinSpeed &&
      Date.now() - lastDirectionChangeAt >= 130
    ) {
      spawnDirectionChangeBurst(
        scene,
        Number(player.body.center?.x) || player.x,
        bodyBottom(player) - 2,
        { previousDirection: lastGroundInputDirection, speedRatio },
      );
      noteEvent("turn", { direction: lastGroundInputDirection });
      audio.playStep(scene, Math.max(0.62, speedRatio), true);
      lastDirectionChangeAt = Date.now();
    }
    if (inputDirection !== 0) lastGroundInputDirection = inputDirection;

    const isGroundWalking = !dead && grounded && inputDirection !== 0 && !attacking;
    if (isGroundWalking) {
      // Play on the first grounded movement frame so a quick key tap is audible.
      // The cooldown continues to space footsteps during sustained movement.
      if (!wasGroundWalking) {
        audio.playStep(scene, speedRatio, false);
        walkStepElapsed = 0;
      }
      walkStepElapsed += scene.game.loop.delta;
      if (walkStepElapsed >= lerp(285, 150, speedRatio)) {
        walkStepElapsed = 0;
        audio.playStep(scene, speedRatio, false);
      }
    } else {
      walkStepElapsed = 0;
    }
    wasGroundWalking = isGroundWalking;
    return speedRatio;
  }

  // Strong entry accent, then a lighter continuous scrape.
  function updateWallSlide(scene, player, { sliding, wallSide, maxFallSpeed, hidden }) {
    audio.updateWallSlide(sliding, clamp01((Number(player.body.velocity.y) || 0) / maxFallSpeed));
    if (sliding) {
      const side = wallSide || (player.flipX ? "left" : "right");
      const body = player.body;
      const contactX = body ? body.x + (side === "left" ? 0 : body.width) : player.x + (side === "left" ? -24 : 24);
      const contactY = body ? body.y + body.height * 0.68 : player.y + 12;
      if (!wasWallSliding && !hidden) {
        spawnWallSlideBurst(scene, contactX, contactY, side);
        wallSlideElapsed = MOVEMENT_VFX_CONFIG.wallTrailIntervalMs;
      }
      wallSlideElapsed += scene.game.loop.delta;
      if (wallSlideElapsed >= MOVEMENT_VFX_CONFIG.wallTrailIntervalMs) {
        wallSlideElapsed = 0;
        if (!hidden) spawnWallSlideTrail(scene, contactX, contactY, side);
      }
    } else {
      wallSlideElapsed = 0;
    }
    wasWallSliding = sliding;
  }

  // Falling-air rush and fast-fall streaks.
  function updateFalling(scene, player, { dead, sliding, hidden }) {
    const fallVelocity = Number(player.body.velocity.y) || 0;
    const fastFallRatio = clamp01(
      (fallVelocity - MOVEMENT_VFX_CONFIG.fastFallStartVelocity) /
        (MOVEMENT_VFX_CONFIG.fastFallMaxVelocity - MOVEMENT_VFX_CONFIG.fastFallStartVelocity),
    );
    const falling = !dead && !player.body.touching.down && !sliding && fallVelocity > 85;
    audio.updateFallingAir(scene, falling, fallVelocity);
    if (falling && !hidden && fallVelocity >= MOVEMENT_VFX_CONFIG.fastFallStartVelocity) {
      fastFallElapsed += scene.game.loop.delta;
      const interval = lerp(
        MOVEMENT_VFX_CONFIG.fastFallTrailMaxIntervalMs,
        MOVEMENT_VFX_CONFIG.fastFallTrailMinIntervalMs,
        fastFallRatio,
      );
      if (fastFallElapsed >= interval) {
        fastFallElapsed = 0;
        spawnFastFallTrail(scene, player, { velocityY: fallVelocity });
      }
    } else {
      fastFallElapsed = 0;
    }
  }

  // Airborne -> grounded transition: terrain landing sound and impact.
  function updateLanding(scene, player, { dead, hidden }) {
    const onGround = player.body.touching.down;
    const playSound = shouldPlayLandingSound(player, onGround);
    const currentBottom = bodyBottom(player);
    if (!onGround && !dead) {
      airbornePeakBottomY = !Number.isFinite(airbornePeakBottomY) || wasOnGround
        ? currentBottom
        : Math.min(airbornePeakBottomY, currentBottom);
    }
    if (initialized && !wasOnGround && onGround && !dead) {
      const fallDistance = Math.max(0, currentBottom -
        (Number.isFinite(airbornePeakBottomY) ? airbornePeakBottomY : currentBottom));
      const velocityRatio = clamp01(lastAirborneVelocityY / MOVEMENT_VFX_CONFIG.landingMaxVelocity);
      const heightRatio = clamp01(fallDistance / (MOVEMENT_VFX_CONFIG.landingShockwaveMinFallPx * 2));
      const strength = velocityRatio * 0.65 + heightRatio * 0.35;
      const shaped = strength * strength;
      const landingAudio = terrainLandingSound(scene._terrainType, 0.28 + shaped * 0.5);
      if (playSound) {
        scene.sound.play(landingAudio.key, { volume: landingAudio.volume, rate: 0.93 - shaped * 0.02 });
      }
      if (!hidden) {
        const body = player.body;
        spawnLandingImpact(scene, Number(body?.center?.x) || player.x, bodyBottom(player) - 2, {
          impactVelocity: lastAirborneVelocityY,
          fallDistance,
          bodyWidth: Number(body?.width) || player.displayWidth,
          cameraShake: true,
        });
      }
      if (playSound) noteEvent("land", { fallDistance, impactVelocity: lastAirborneVelocityY });
    }
    if (!onGround && !dead) {
      lastAirborneVelocityY = Math.max(lastAirborneVelocityY, Number(player.body.velocity.y) || 0);
    } else if (onGround) {
      lastAirborneVelocityY = 0;
      airbornePeakBottomY = null;
    }
    wasOnGround = onGround;
    initialized = true;
  }

  // Ground running dust becomes denser and more frequent with actual speed.
  function updateRunDust(scene, player, { dead, hidden, moving, maxSpeed }) {
    dustElapsed += scene.game.loop.delta;
    const runSpeed = Math.abs(Number(player.body.velocity.x) || 0);
    const runSpeedRatio = clamp01(runSpeed / maxSpeed);
    const interval = lerp(MOVEMENT_VFX_CONFIG.runDustMaxIntervalMs, MOVEMENT_VFX_CONFIG.runDustMinIntervalMs, runSpeedRatio);
    if (!(!dead && !hidden && moving && player.body.touching.down && runSpeed > 35 && dustElapsed >= interval)) return;
    dustElapsed = 0;
    // Spawn at the physics body's bottom to account for per-character frame sizing.
    const bottom = player.body ? player.body.y + player.body.height : player.y + player.height / 2;
    const direction = Math.sign(Number(player.body.velocity.x) || 0) || (player.flipX ? -1 : 1);
    spawnRunDust(scene, player.x - direction * 10, bottom - 2, { direction, intensity: runSpeedRatio });
  }

  return { reset, clearWallSlide, markGrounded, updateGroundMotion, updateWallSlide, updateFalling, updateLanding, updateRunDust };
}
