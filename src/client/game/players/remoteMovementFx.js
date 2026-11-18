import { presentRemoteDash } from "../scene/dash";
import { presentRemoteKnockback } from "../scene/knockbackTrail";
import { runDustInterval, fallSpeedRatio, wallContactPoint, MOVEMENT_VFX_CONFIG, spawnDirectionChangeBurst, spawnFastFallTrail, spawnJumpTakeoff, spawnLandingImpact, spawnRunDust, spawnWallKickCloud, spawnWallSlideBurst, spawnWallSlideTrail } from "../scene/effects";
import { createRemoteMovementAudio } from "../audio/remoteMovementAudio";
export function createRemoteMovementFx() {
  let movementVfxState = null;
  let runDustVfxAt = 0;
  let fastFallVfxAt = 0;
  let lastMovementFxSeq = null;
  let audio;

  function update(wrapper, movementState, animationState = movementState) {
    if (wrapper.opponent?.active && wrapper.opCurrentHealth > 0 &&
        wrapper.presenceLoaded && wrapper.presenceConnected && wrapper._spawnPresented) {
      audio ||= createRemoteMovementAudio(wrapper.scene, wrapper.opponent);
      audio.update(movementState, animationState);
    } else {
      audio?.reset();
    }
    presentRemoteDash(wrapper.scene, wrapper.opponent, movementState, wrapper,
      wrapper.opCurrentHealth <= 0);
    presentRemoteKnockback(wrapper.scene, wrapper.opponent, movementState, wrapper,
      wrapper.opCurrentHealth <= 0 || wrapper._powerupInvisible ||
      !wrapper.presenceLoaded || !wrapper.presenceConnected || !wrapper._spawnPresented);
    if (
      !wrapper.scene?.add ||
      !wrapper.opponent?.active ||
      !movementState ||
      wrapper._powerupInvisible
    ) {
      return;
    }
    const grounded = !!movementState.grounded;
    const velocityY = Number(movementState.vy) || 0;
    const velocityX = Number(movementState.vx) || 0;
    const animation = String(animationState?.animation || "").toLowerCase();
    const reportedWallSide =
      movementState.wallSide === "left" || movementState.wallSide === "right"
        ? movementState.wallSide
        : movementState.flip
          ? "left"
          : "right";
    const wallSliding =
      !grounded &&
      (typeof movementState.wallSliding === "boolean"
        ? movementState.wallSliding
        : animation.includes("wallslid"));
    const body = wrapper.opponent.body;
    const centerX = Number(body?.center?.x) || wrapper.opponent.x;
    const bottom =
      Number(body?.bottom) ||
      wrapper.opponent.y +
        (wrapper.opponent.displayHeight || wrapper.opponent.height) * 0.5;
    const bodyWidth = Number(body?.width) || wrapper.opponent.displayWidth;
    const previous = movementVfxState;
    const airbornePeakBottomY = grounded
      ? null
      : Math.min(
          Number.isFinite(previous?.airbornePeakBottomY)
            ? previous.airbornePeakBottomY
            : bottom,
          bottom,
        );
    let handledNetworkFx = null;
    const movementFxSeq = Number(movementState.movementFxSeq);
    if (Number.isFinite(movementFxSeq)) {
      if (lastMovementFxSeq === null) {
        lastMovementFxSeq = movementFxSeq;
      } else if (movementFxSeq > lastMovementFxSeq) {
        lastMovementFxSeq = movementFxSeq;
        handledNetworkFx = String(movementState.movementFxType || "");

        if (handledNetworkFx === "jump") {
          spawnJumpTakeoff(wrapper.scene, centerX, bottom - 2, {
            bodyWidth,
            velocityX,
          });
        } else if (handledNetworkFx === "land") {
          spawnLandingImpact(wrapper.scene, centerX, bottom - 2, {
            bodyWidth,
            impactVelocity: Number(movementState.movementFxImpactVelocity) || 0,
            fallDistance: Number(movementState.movementFxFallDistance) || 0,
            cameraShake: false,
          });
        } else if (handledNetworkFx === "turn") {
          spawnDirectionChangeBurst(wrapper.scene, centerX, bottom - 2, {
            previousDirection:
              Number(movementState.movementFxDirection) ||
              -Math.sign(velocityX),
            speedRatio: Phaser.Math.Clamp(
              Math.abs(velocityX) / MOVEMENT_VFX_CONFIG.runSpeedReference,
              0,
              1,
            ),
          });
        } else if (handledNetworkFx === "wall-jump") {
          const eventWallSide =
            movementState.movementFxWallSide === "left" ||
            movementState.movementFxWallSide === "right"
              ? movementState.movementFxWallSide
              : reportedWallSide;
          const { x: contactX, y: contactY } = wallContactPoint(body, eventWallSide, MOVEMENT_VFX_CONFIG.wallKickHeightFraction, centerX, wrapper.opponent.y + 12, bodyWidth * 0.5);
          spawnWallKickCloud(
            wrapper.scene,
            contactX,
            contactY,
            Number(movementState.movementFxDirection) < 0 ? -1 : 1,
            { follow: wrapper.opponent },
          );
        }
      } else if (movementFxSeq < lastMovementFxSeq) {
        // A respawned/reconnected sender starts a fresh event sequence.
        lastMovementFxSeq = movementFxSeq;
      }
    }

    if (previous) {
      if (
        handledNetworkFx !== "jump" &&
        previous.grounded &&
        !grounded &&
        velocityY < MOVEMENT_VFX_CONFIG.jumpRiseThreshold
      ) {
        spawnJumpTakeoff(wrapper.scene, centerX, bottom - 2, {
          bodyWidth,
          velocityX,
        });
      } else if (
        handledNetworkFx !== "land" &&
        !previous.grounded &&
        grounded
      ) {
        spawnLandingImpact(wrapper.scene, centerX, bottom - 2, {
          bodyWidth,
          impactVelocity: Math.max(previous.airborneVelocityY, velocityY),
          fallDistance: Math.max(
            0,
            bottom -
              (Number.isFinite(previous.airbornePeakBottomY)
                ? previous.airbornePeakBottomY
                : bottom),
          ),
          cameraShake: false,
        });
      }
    }

    if (
      previous?.wallSliding &&
      !wallSliding &&
      !grounded &&
      handledNetworkFx !== "wall-jump" &&
      Math.abs(velocityX) > MOVEMENT_VFX_CONFIG.wallKickMinSpeed
    ) {
      const previousWallSide = previous.wallSide || "left";
      const { x: contactX, y: contactY } = wallContactPoint(body, previousWallSide, MOVEMENT_VFX_CONFIG.wallKickHeightFraction, centerX, wrapper.opponent.y + 12, bodyWidth * 0.5);
      spawnWallKickCloud(
        wrapper.scene,
        contactX,
        contactY,
        velocityX < 0 ? -1 : 1,
        { follow: wrapper.opponent },
      );
    }

    const runSpeedRatio = Phaser.Math.Clamp(
      Math.abs(velocityX) / MOVEMENT_VFX_CONFIG.runSpeedReference,
      0,
      1,
    );
    const runDirection = Math.sign(velocityX);
    const now = performance.now();
    if (grounded && runDirection !== 0 && Math.abs(velocityX) > MOVEMENT_VFX_CONFIG.runDustMinSpeed) {
      if (
        previous?.grounded &&
        previous.runDirection &&
        runDirection !== previous.runDirection &&
        handledNetworkFx !== "turn" &&
        Math.abs(velocityX) >= MOVEMENT_VFX_CONFIG.directionChangeMinSpeed
      ) {
        spawnDirectionChangeBurst(wrapper.scene, centerX, bottom - 2, {
          previousDirection: previous.runDirection,
          speedRatio: runSpeedRatio,
        });
      }
      const runInterval = runDustInterval(runSpeedRatio);
      if (!runDustVfxAt || now - runDustVfxAt >= runInterval) {
        runDustVfxAt = now;
        spawnRunDust(wrapper.scene, centerX - runDirection * 10, bottom - 2, {
          direction: runDirection,
          intensity: runSpeedRatio,
        });
      }
    } else {
      runDustVfxAt = 0;
    }

    if (
      !grounded &&
      !wallSliding &&
      velocityY >= MOVEMENT_VFX_CONFIG.fastFallStartVelocity
    ) {
      const fastFallRatio = fallSpeedRatio(velocityY);
      const fastFallInterval = Phaser.Math.Linear(
        MOVEMENT_VFX_CONFIG.fastFallTrailMaxIntervalMs,
        MOVEMENT_VFX_CONFIG.fastFallTrailMinIntervalMs,
        fastFallRatio,
      );
      if (
        !fastFallVfxAt ||
        now - fastFallVfxAt >= fastFallInterval
      ) {
        fastFallVfxAt = now;
        spawnFastFallTrail(wrapper.scene, wrapper.opponent, { velocityY });
      }
    } else {
      fastFallVfxAt = 0;
    }

    if (wallSliding) {
      const side = reportedWallSide;
      const { x: contactX, y: contactY } = wallContactPoint(body, side, MOVEMENT_VFX_CONFIG.wallSlideHeightFraction, centerX, wrapper.opponent.y + 12, bodyWidth * 0.5);
      const slideRatio = Phaser.Math.Clamp(
        velocityY / MOVEMENT_VFX_CONFIG.wallSlideSpeedReference,
        0,
        1,
      );
      if (!previous?.wallSliding) {
        spawnWallSlideBurst(wrapper.scene, contactX, contactY, side);
      }
      spawnWallSlideTrail(wrapper.scene, contactX, contactY, side, {
        speedRatio: slideRatio,
        velocityY,
        owner: this,
      });
    }

    movementVfxState = {
      grounded,
      wallSliding,
      airborneVelocityY: grounded
        ? 0
        : Math.max(Number(previous?.airborneVelocityY) || 0, velocityY),
      airbornePeakBottomY,
      runDirection:
        grounded &&
        Math.abs(velocityX) < MOVEMENT_VFX_CONFIG.directionChangeMinSpeed
          ? previous?.runDirection || runDirection
          : runDirection,
      wallSide: wallSliding ? reportedWallSide : previous?.wallSide || null,
    };
  }

  function reset() {
    audio?.reset();
    movementVfxState = null;
    runDustVfxAt = 0;
    fastFallVfxAt = 0;
  }
  return { update, reset, resetAudio: () => audio?.reset(), destroy: () => audio?.destroy() };
}
