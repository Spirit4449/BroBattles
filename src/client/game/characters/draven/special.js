import { characterDefinitions } from "../../../../shared/characters/index.js";
import { drawShieldBubble } from "../../scene/fx/shieldBubble";
import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { getResolvedCharacterSpecialAimConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import {
  playSpriteAnimation,
  resolveSpriteAnimationKey,
} from "../shared/animationState.js";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { startInfernoAudio } from "./infernoAudio";
import { infernoLiftAt } from "../../../../shared/combat/runtime/abilities/dravenInfernoLift.js";
import {
  INFERNO_SHIELD_POP_MS,
  infernoEnterBeats,
  infernoBurnoutAlpha,
  infernoPopScale,
  playInfernoEnter,
  playInfernoExit,
} from "./infernoTransitions";

const { key: NAME } = characterDefinitions.draven;

const shieldReflections = new WeakMap();

const INFERNO = getResolvedCharacterSpecialConfig(NAME, "inferno");
const INFERNO_AIM = getResolvedCharacterSpecialAimConfig(NAME);

// Tuning lives in src/shared/characters/draven.json (special.inferno / special.aim).
const DRAVEN_INFERNO_DURATION_MS = INFERNO.durationMs;
const DRAVEN_INFERNO_RISE_MS = INFERNO.riseMs;
const DRAVEN_INFERNO_RADIUS = INFERNO_AIM.radius; // same radius the server damages
const DRAVEN_FIRE_PULSE_MS = INFERNO.firePulseMs;
const DRAVEN_SPECIAL_FX_TEXTURE_KEY = "draven-special-fx";
const DRAVEN_SPECIAL_FX_ANIM_KEY = "draven-special-fx";

// The Inferno art is designed on a 192px square inside a larger frame that
// leaves headroom for the flames (scripts/art/draven-pixel/fx.cjs SP.art), so
// the overlay is sized from that square, not from the frame.
const INFERNO_FX_ART_PX = 192;
// How much larger than the legacy overlay sizing the effect is drawn.
const INFERNO_FX_GROWTH = 1.3;

const FIRE_COLORS = [0xff5a2f, 0xff8a00, 0xb13cff, 0xff2f5d];
const INFERNO_SHIELD_RADIUS = 46;

function syncInfernoOverlay(player, overlay) {
  if (!player || !overlay || !overlay.active) return;
  // While igniting, the circle grows out of the staff head (playInfernoEnter).
  const at = overlay._infernoAnchor?.() || player;
  overlay.x = at.x;
  overlay.y = at.y;
  overlay.flipX = !!player.flipX;
  overlay.setDepth(RENDER_LAYERS.PLAYER - 1);
}

function destroyInfernoOverlay(player) {
  player?._dravenInfernoShield?.destroy();
  if (player) delete player._dravenInfernoShield;
  if (!player || !player._dravenInfernoOverlay) return;
  try {
    player._dravenInfernoOverlay.destroy();
  } catch (_) {}
  delete player._dravenInfernoOverlay;
}

function ensureInfernoOverlay(scene, player) {
  if (!scene?.add || !player?.active) return null;
  if (
    !scene.textures?.exists(DRAVEN_SPECIAL_FX_TEXTURE_KEY) ||
    !scene.anims?.exists(DRAVEN_SPECIAL_FX_ANIM_KEY)
  ) {
    return null;
  }

  destroyInfernoOverlay(player);
  const fxKey = teamColor(player) === TEAM_RED && scene.textures.exists("draven-special-fx-red") ? "draven-special-fx-red" : DRAVEN_SPECIAL_FX_TEXTURE_KEY;

  const overlay = scene.add.sprite(player.x, player.y, fxKey);
  overlay.setAlpha(0);
  // Normal blending keeps the pixel-art palette (and the team colour) intact on
  // bright maps; additive washed it out to white.
  const scaleBase = player.displayWidth || player.width || 72;
  overlay._infernoScale = Math.max(0.45, (scaleBase / 92) * 1.7) * INFERNO_FX_GROWTH * 72 / INFERNO_FX_ART_PX;
  overlay.setScale(overlay._infernoScale);
  syncInfernoOverlay(player, overlay);
  try {
    overlay.anims.play(fxKey, true);
  } catch (_) {}
  player._dravenInfernoOverlay = overlay;
  return overlay;
}

function spawnFireParticle(scene, x, y, owner, particles) {
  const colors = teamColor(owner) === TEAM_RED ? [0xff5148, 0xff965b, 0xe63960, 0xffcd83] : FIRE_COLORS;
  const color = colors[Phaser.Math.Between(0, colors.length - 1)];
  const p = scene.add.circle(x, y, Phaser.Math.Between(3, 7), color, 0.8);
  p.setDepth(18);
  p.setBlendMode(Phaser.BlendModes.ADD);
  particles.add(p);

  scene.tweens.add({
    targets: p,
    y: y - Phaser.Math.Between(22, 56),
    x: x + Phaser.Math.Between(-14, 14),
    alpha: 0,
    scaleX: Phaser.Math.FloatBetween(1.1, 1.8),
    scaleY: Phaser.Math.FloatBetween(1.2, 2),
    duration: Phaser.Math.Between(260, 460),
    ease: "Cubic.easeOut",
    onComplete: () => { particles.delete(p); p.destroy(); },
  });
}

function spawnInfernoPulse(scene, cx, cy, owner, particles) {
  const ring = scene.add.circle(
    cx,
    cy,
    DRAVEN_INFERNO_RADIUS * 0.75,
    teamColor(owner) === TEAM_RED ? 0xff5360 : 0xb13cff,
    0.22,
  );
  ring.setDepth(14);
  ring.setBlendMode(Phaser.BlendModes.ADD);
  particles.add(ring);
  scene.tweens.add({
    targets: ring,
    scaleX: 1.35,
    scaleY: 1.35,
    alpha: 0,
    duration: 260,
    ease: "Quad.easeOut",
    onComplete: () => { particles.delete(ring); ring.destroy(); },
  });

  for (let i = 0; i < 10; i++) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const radius = Phaser.Math.FloatBetween(20, DRAVEN_INFERNO_RADIUS);
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    spawnFireParticle(scene, px, py, owner, particles);
  }
}

function startInfernoVisualLoop(scene, player, token, isOwner, particles) {
  // The first pulse waits for the ignite, which comes from the staff.
  // The ignite owns the stage until the circle has bloomed at the crown.
  const { doneMs: igniteDoneMs } = infernoEnterBeats(DRAVEN_INFERNO_RISE_MS);
  let nextFireAt = scene.time.now + igniteDoneMs;
  let timer;

  const tick = () => {
    if (!player || !player.active || player._matchEnded) return;
    if (player._dravenInfernoToken !== token) return;

    const now = scene.time.now;
    const until = Number(player._dravenInfernoUntil || 0);
    if (Date.now() >= until) return;

    const elapsed = Math.max(
      0,
      Date.now() - Number(player._dravenInfernoStartedAt || Date.now()),
    );
    // Same rise as the server: crouch, surge past the hover, settle, bob.
    const liftNow = infernoLiftAt(elapsed);

    const baseX = Number.isFinite(player._dravenInfernoBaseX)
      ? player._dravenInfernoBaseX
      : player.x;
    const baseY = Number.isFinite(player._dravenInfernoBaseY)
      ? player._dravenInfernoBaseY
      : player.y;
    const centerX = player.x;
    const centerY = player.y;

    if (now >= nextFireAt) {
      nextFireAt = now + DRAVEN_FIRE_PULSE_MS;
      spawnInfernoPulse(scene, centerX, centerY, player, particles);
    }

    // Explosion positions come from the authoritative damage events. Keeping
    // this loop free of random effects prevents local/remote duplicates.

    const specialKey = resolveSpriteAnimationKey({
      scene,
      sprite: player,
      character: NAME,
      logical: "special",
      fallback: "throw",
    });
    if (specialKey && player.anims?.currentAnim?.key !== specialKey) {
      playSpriteAnimation({
        scene,
        sprite: player,
        character: NAME,
        logical: "special",
        fallback: "throw",
      });
    }

    // Keep the owner fully anchored while channeling.
    if (isOwner) {
      player.x = baseX;
      player.y = baseY - liftNow;
      if (player.body) {
        player.body.allowGravity = false;
        player.setVelocity(0, 0);
      }
    }

    const remaining = until - Date.now();
    const overlay = player._dravenInfernoOverlay;
    syncInfernoOverlay(player, overlay);
    // The ignite tween owns the overlay's alpha until the burnout flicker.
    if (overlay && elapsed > igniteDoneMs) overlay.setAlpha(infernoBurnoutAlpha(remaining));
    const shield = player._dravenInfernoShield;
    if (shield) {
      shield.clear();
      // Pops in with an overshoot and stays solid: the exit shatters it.
      const radius = INFERNO_SHIELD_RADIUS * infernoPopScale(elapsed / INFERNO_SHIELD_POP_MS);
      drawShieldBubble(shield, player, { x: player.x, y: player.y, radius },
        now / 1000, Math.max(remaining, 1000), shieldReflections);
    }

    timer = scene.time.delayedCall(16, tick);
  };

  tick();
  return () => timer?.remove?.(false);
}

export function perform({ scene, player, isOwner = false }) {
  if (!scene || !player || !player.active) return;

  const now = Date.now();
  const token = createRuntimeId("draven_inferno");
  const baseX = player.x;
  const baseY = player.y;

  player._dravenInfernoToken = token;
  player._dravenInfernoStartedAt = now;
  player._dravenInfernoUntil = now + DRAVEN_INFERNO_DURATION_MS;
  player._dravenInfernoBaseX = baseX;
  player._dravenInfernoBaseY = baseY;
  player._movementLockedUntil = now + DRAVEN_INFERNO_DURATION_MS;

  const unlockFlip = lockPlayerFlip(player);

  if (player.body) {
    player._dravenInfernoPrevGravity = player.body.allowGravity;
    player.body.allowGravity = false;
    player.setVelocity(0, 0);
  }

  // The pose holds for the whole channel.
  playSpriteAnimation({
    scene,
    sprite: player,
    character: NAME,
    logical: "special",
    fallback: "throw",
    holdMs: DRAVEN_INFERNO_DURATION_MS,
    remote: !isOwner,
  });

  destroyInfernoOverlay(player);
  const overlay = ensureInfernoOverlay(scene, player);
  const shield = scene.add.graphics();
  shield.setDepth(RENDER_LAYERS.PLAYER + 1);
  player._dravenInfernoShield = shield;

  const stopAudio = startInfernoAudio(scene, player, {
    riseMs: DRAVEN_INFERNO_RISE_MS,
    durationMs: DRAVEN_INFERNO_DURATION_MS,
  });

  const particles = new Set();
  playInfernoEnter(scene, player, {
    overlay,
    particles,
    radius: DRAVEN_INFERNO_RADIUS,
    riseMs: DRAVEN_INFERNO_RISE_MS,
    isOwner,
  });

  // Hands the overlay to the burnout so it can implode after the channel.
  const releaseWithExit = () => {
    const ownOverlay = player._dravenInfernoOverlay;
    delete player._dravenInfernoOverlay;
    destroyInfernoOverlay(player);
    playInfernoExit(scene, player, {
      overlay: ownOverlay,
      x: player.x,
      y: player.y,
      shieldRadius: INFERNO_SHIELD_RADIUS + 11,
      radius: DRAVEN_INFERNO_RADIUS,
    });
  };
  // Destroy and shutdown tear down without effects; a stun or hook still bursts.
  const interrupt = (reason) => {
    if (player._dravenInfernoToken !== token) return;
    player.off?.("attack:interrupted", onInterrupted);
    player.off?.("destroy", onTeardown);
    scene.events?.off("shutdown", onTeardown);
    endTimer?.remove?.(false);
    stopVisualLoop();
    for (const particle of particles) {
      scene.tweens.killTweensOf?.(particle);
      particle.destroy();
    }
    particles.clear();
    stopAudio(false);
    player._movementLockedUntil = player._dravenInfernoUntil = 0;
    delete player._dravenInfernoToken;
    unlockFlip();
    if (reason === "interrupted" && player.active && scene.sys?.isActive?.() !== false) releaseWithExit();
    else destroyInfernoOverlay(player);
    if (player.body) player.body.allowGravity = player._dravenInfernoPrevGravity ?? true;
    delete player._dravenInfernoPrevGravity;
  };
  const onInterrupted = () => interrupt("interrupted");
  const onTeardown = () => interrupt("teardown");
  player.once?.("attack:interrupted", onInterrupted);
  player.once?.("destroy", onTeardown);
  scene.events?.once("shutdown", onTeardown);
  const stopVisualLoop = startInfernoVisualLoop(scene, player, token, isOwner, particles);

  const endTimer = scene.time.delayedCall(DRAVEN_INFERNO_DURATION_MS, () => {
    player.off?.("attack:interrupted", onInterrupted);
    player.off?.("destroy", onTeardown);
    scene.events?.off("shutdown", onTeardown);
    if (!player || !player.active) return;
    if (player._dravenInfernoToken !== token) return;
    stopVisualLoop();

    stopAudio(!player._matchEnded);
    player._movementLockedUntil = 0;
    player._dravenInfernoUntil = 0;
    unlockFlip();
    if (player._matchEnded) destroyInfernoOverlay(player);
    else releaseWithExit();

    if (player._matchEnded) {
      delete player._dravenInfernoPrevGravity;
      delete player._dravenInfernoToken;
      if (player.body) {
        player.setVelocity(0, 0);
      }
      return;
    }

    if (player.body) {
      const prevGravity =
        typeof player._dravenInfernoPrevGravity === "boolean"
          ? player._dravenInfernoPrevGravity
          : true;
      player.body.allowGravity = prevGravity;
      player.setVelocityY(Math.max(player.body.velocity.y, 150));
    }

    delete player._dravenInfernoPrevGravity;
    delete player._dravenInfernoToken;
  });
}
