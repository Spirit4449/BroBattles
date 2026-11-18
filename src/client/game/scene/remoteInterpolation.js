import { platformClock, remoteRideOffset } from "../maps/movingPlatforms";
import { sampleRemoteFrame, followRemotePosition, remoteLifeState } from "./remoteSmoothing.js";
import { resolveAnimKey, chooseRemoteAnimation } from "../characters";
import { remoteAnimationLockUntil, playCharacterAnimation } from "../characters/shared/animationState.js";
import MOVEMENT_PHYSICS from "../../../shared/physics/movementPhysics.json";
export const hermiteAxis = (aValue, bValue, aVelocity, bVelocity, t, spanMs) => {
  const p0 = Number(aValue);
  const p1 = Number(bValue);
  const v0 = Number(aVelocity);
  const v1 = Number(bVelocity);
  const spanSec = Math.max(0.001, Number(spanMs) || 0) / 1000;
  if (
    !Number.isFinite(p0) ||
    !Number.isFinite(p1) ||
    !Number.isFinite(v0) ||
    !Number.isFinite(v1)
  ) {
    return p0 + t * (p1 - p0);
  }
  const tt = t * t;
  const ttt = tt * t;
  const m0 = v0 * spanSec;
  const m1 = v1 * spanSec;
  return (
    (2 * ttt - 3 * tt + 1) * p0 +
    (ttt - 2 * tt + t) * m0 +
    (-2 * ttt + 3 * tt) * p1 +
    (ttt - tt) * m1
  );
};
export const projectAxis = (
  aValue,
  bValue,
  dtMs,
  velocityValue = null,
  options = {},
) => {
  const aNum = Number(aValue);
  const bNum = Number(bValue);
  if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) {
    return Number.isFinite(bNum) ? bNum : aNum;
  }
  const velocityNum = Number(velocityValue);
  const extrapolationMs = Math.max(0, Number(options.extrapolationMs) || 0);
  if (Number.isFinite(velocityNum) && extrapolationMs > 0) {
    if (options?.vertical && options?.airborne) {
      const tSec = extrapolationMs / 1000;
      const gravity = Number(MOVEMENT_PHYSICS.gravity) || 0;
      const fallMult =
        velocityNum > 0
          ? Number(MOVEMENT_PHYSICS.fallGravityFactor) || 1
          : 1;
      return (
        bNum + velocityNum * tSec + 0.5 * gravity * fallMult * tSec * tSec
      );
    }
    return bNum + velocityNum * (extrapolationMs / 1000);
  }
  const safeDtMs = Math.max(1, Number(dtMs) || 0);
  const velocityPerMs = (bNum - aNum) / safeDtMs;
  return bNum + velocityPerMs * extrapolationMs;
};

export function presentRemoteFrame(scene, wrapper, name, baseFrame, { snapshotBuffer, latestPlayerEffects, networkExperiments, hud }) {
  if (!wrapper || !wrapper.opponent) return;

  const now = performance.now();
  const sample = sampleRemoteFrame(
    snapshotBuffer,
    baseFrame,
    (wrapper._continuousSmoothing ||= {}),
    {
      attack:
        (Number(scene._localAttackPrecisionUntil) || 0) > now ||
        (Number(wrapper._attackPrecisionUntil) || 0) > now,
      airborne: baseFrame.bState?.players?.[name]?.grounded === false,
      deltaMs: scene.game?.loop?.delta || 16.67,
      snap: Number(wrapper._networkSnapUntil) > now,
      legacyLead: networkExperiments.legacyRemoteLead,
    },
  );
  const { aState, bState, alpha } = sample;
  const extrapolationMs = Math.max(0, Number(sample.extrapolationMs) || 0);

  const spr = wrapper.opponent;
  const aPosData = aState.players[name];
  const bPosData = bState.players[name];
  const respawnShieldRemainingMs = Math.max(
    0,
    Number(latestPlayerEffects?.[name]?.respawnShield) || 0,
  );
  const inRespawnShield = respawnShieldRemainingMs > 0;

  if (!aPosData && !bPosData) return;

  const life = remoteLifeState(wrapper._lifeEvent, aState, aPosData, bState, bPosData);
  const isDeadBySnapshot = life.dead;
  const isConnected =
    bPosData && typeof bPosData.connected === "boolean"
      ? bPosData.connected
      : aPosData && typeof aPosData.connected === "boolean"
        ? aPosData.connected
        : true;
  const isLoaded =
    bPosData && typeof bPosData.loaded === "boolean"
      ? bPosData.loaded
      : aPosData && typeof aPosData.loaded === "boolean"
        ? aPosData.loaded
        : true;

  // Render remote players directly from the buffered snapshot timeline.
  // Every actor is sampled at the render time attack requests report.
  let targetX = spr.x;
  let targetY = spr.y;
  // A loading fighter is still a hittable ghost, so it follows the server's
  // position too; otherwise it would be drawn where its hitbox is not.
  {
    const airborne = !(bPosData?.grounded ?? aPosData?.grounded ?? false);
    const effectiveAlpha = alpha;
    const aX = Number(aPosData?.x);
    const aY = Number(aPosData?.y);
    const bX = Number(bPosData?.x);
    const bY = Number(bPosData?.y);
    if (
      aPosData &&
      bPosData &&
      Number.isFinite(aX) &&
      Number.isFinite(aY) &&
      Number.isFinite(bX) &&
      Number.isFinite(bY)
    ) {
      if (life.newestOnly) {
        targetX = bX;
        targetY = bY;
      } else if (inRespawnShield) {
        if (extrapolationMs > 0) {
          targetX = bX;
          targetY = bY;
        } else {
          targetX = Phaser.Math.Linear(aX, bX, effectiveAlpha);
          targetY = Phaser.Math.Linear(aY, bY, effectiveAlpha);
        }
      } else if (extrapolationMs > 0) {
        const stateDeltaMs = Math.max(
          1,
          Number(bState?.tMono) - Number(aState?.tMono),
        );
        targetX = projectAxis(aX, bX, stateDeltaMs, bPosData?.vx, {
          extrapolationMs,
        });
        targetY = projectAxis(aY, bY, stateDeltaMs, bPosData?.vy, {
          vertical: true,
          airborne,
          extrapolationMs,
        });
      } else {
        const stateDeltaMs = Math.max(
          1,
          Number(bState?.tMono) - Number(aState?.tMono),
        );
        targetX = hermiteAxis(
          aX,
          bX,
          aPosData?.vx,
          bPosData?.vx,
          effectiveAlpha,
          stateDeltaMs,
        );
        targetY = hermiteAxis(
          aY,
          bY,
          aPosData?.vy,
          bPosData?.vy,
          effectiveAlpha,
          stateDeltaMs,
        );
      }
    } else if (bPosData && Number.isFinite(bX) && Number.isFinite(bY)) {
      targetX = bX;
      targetY = bY;
    } else if (aPosData && Number.isFinite(aX) && Number.isFinite(aY)) {
      targetX = aX;
      targetY = aY;
    }
    if (!airborne) {
      const ride = remoteRideOffset(scene, spr, targetX, targetY, sample.targetMono, platformClock());
      targetX += ride.x;
      targetY += ride.y;
    }
  }
  const shouldSnapToTarget =
    Number(wrapper._networkSnapUntil) > performance.now();

  if (!wrapper._deathPresentationActive && !wrapper._corpseRemoved && !life.holdPosition) {
    if (shouldSnapToTarget) {
      spr.x = targetX;
      spr.y = targetY;
    } else {
      followRemotePosition(spr, targetX, targetY, {
        deltaMs: scene.game?.loop?.delta ?? 16.67,
        attack:
          (Number(scene._localAttackPrecisionUntil) || 0) > now ||
          (Number(wrapper._attackPrecisionUntil) || 0) > now,
        airborne: !(bPosData?.grounded ?? aPosData?.grounded ?? false),
      });
    }
  }
  if (typeof wrapper.setPresenceState === "function") {
    wrapper.setPresenceState(isConnected, isLoaded);
  } else {
    // Fallback visual for wrappers without presence helper.
    spr.alpha = 1;
  }
  hud.setTeamHudPlayerPresence(name, isConnected);
  hud.setTeamHudPlayerLoaded(name, isLoaded);
  hud.setTeamHudPlayerAlive(name, !isDeadBySnapshot);

  if (
    !isDeadBySnapshot &&
    isConnected &&
    isLoaded &&
    (wrapper._deathPresentationActive || wrapper._corpseRemoved)
  ) {
    wrapper.handleRespawn?.({
      x: targetX,
      y: targetY,
      at:
        Number(bState?.timestamp) ||
        Number(aState?.timestamp) ||
        Date.now(),
    });
  }

  // Orientation/animation: take from newer if present (prefer b then a)
  const animSrc = bPosData && bPosData.animation ? bPosData : aPosData;
  if (isDeadBySnapshot) {
    wrapper.startDeathPresentation?.({
      x: targetX,
      y: targetY,
      at:
        Number(bState?.timestamp) ||
        Number(aState?.timestamp) ||
        Date.now(),
    });
  }

  if (
    animSrc &&
    !isDeadBySnapshot &&
    !wrapper._deathPresentationActive &&
    isConnected &&
    isLoaded
  ) {
    if (typeof wrapper.setDucking === "function") {
      wrapper.setDucking(animSrc.ducking === true);
    } else {
      spr._ducking = animSrc.ducking === true;
    }
    const prevFlip = spr.flipX;
    spr.flipX = !!animSrc.flip;
    if (
      spr.flipX !== prevFlip &&
      typeof wrapper.applyFlipOffset === "function"
    ) {
      wrapper.applyFlipOffset();
    }
    const lockUntil = remoteAnimationLockUntil(spr);
    if (performance.now() >= lockUntil) {
      const chosenAnim = chooseRemoteAnimation(wrapper.character, {
        animation: animSrc.animation || "idle",
        previousPosition: aPosData,
        currentPosition: bPosData,
        sprite: spr,
      });
      playCharacterAnimation({
        scene: scene,
        sprite: spr,
        character: wrapper.character,
        skinId: wrapper.skinId || "",
        resolveAnimKey,
        logical: chosenAnim,
        dashDirection: { x: animSrc.dashX, y: animSrc.dashY },
        fallback: "idle",
        force: true,
      });
    }
  }

  if (
    !isDeadBySnapshot &&
    !wrapper._deathPresentationActive &&
    isConnected &&
    isLoaded
  ) {
    wrapper.updateMovementVfx?.(bPosData || aPosData, animSrc);
  }

  // Keep remote UI positioning centralized in RemotePlayer so one offset controls all updates.
  // Bars are drawn once afterwards by the frame's updateHealthBars pass.
  if (typeof wrapper.updateUIPosition === "function") {
    wrapper.updateUIPosition({ drawBars: false });
  }

}
