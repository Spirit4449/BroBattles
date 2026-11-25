import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { spawnRespawnEffect } from '../scene/respawnEffect';
import { endDash } from '../scene/dash';
import { cancelFighterCombat } from './fighterCombatCleanup';
import { spawnKnockbackTrail } from '../scene/knockbackTrail';
import movementPhysics from '../../../shared/physics/movementPhysics.json';
import { combatSoundVolume, playPlayerSound } from '../audio/playerAudio';
import { localMovementCorrector } from './localMovementCorrector';
import { resolveShockwaveImpulse, SHOCKWAVE_MOMENTUM_MS } from "../../../shared/physics/shockwaveImpulse";
import { performSpecial } from "../characters/special";
import {
  spawnStompImpact,
  spawnDuckGuardImpact,
  spawnDeathBurst,
  triggerDamageScreenPulse,
} from "../scene/effects";
import { triggerDamageCameraShake } from "../scene/cameraDynamics";
import { playSpriteAnimation } from "../characters/shared/animationState.js";
import { playHitFeedback, hitstopForDelivery } from "../characters/shared/hitFeedback";

export function bindLocalSocketEvents({
  socket,
  getUsername,
  getScene,
  getPlayer,
  getCurrentCharacter,
  getOpponentPlayersRef,
  showHealthChange,
  updateHealthBar,
  stats,
  stopWallSlideAudio,
  onLocalDeath,
  onLocalRespawn,
  removeLocalCorpse,
  onDuckBlocked,
  onAttackInterrupted,
}) {
  let corpseRemovalTimer = null;
  let deathGeneration = 0;
  const cancelCorpseRemoval = () => {
    deathGeneration += 1;
    corpseRemovalTimer?.remove?.(false);
    corpseRemovalTimer = null;
  };
  const healthUpdateHandler = (data) => {
    if (data.username !== getUsername()) return;

    const scene = getScene();
    const player = getPlayer();

    const prev = stats.currentHealth;
    if (typeof data.maxHealth === "number" && data.maxHealth > 0) {
      stats.maxHealth = data.maxHealth;
      if (stats.currentHealth > stats.maxHealth) {
        stats.currentHealth = stats.maxHealth;
      }
    }
    stats.currentHealth = data.health;

    const delta = stats.currentHealth - prev;

    if (scene && player && delta !== 0) {
      showHealthChange(delta);
    }

    if (scene && scene.sound && !stats.dead) {
      if (delta < 0) {
        scene.sound.play("sfx-damage", { volume: combatSoundVolume("sfx-damage") });
        if (data.duckBlocked === true || player._ducking === true) {
          onDuckBlocked?.();
          spawnDuckGuardImpact(scene, player);
        }
        if (data.cause !== "poison") {
          playHitFeedback(scene, player, {
            hitstopMs: data.cause === "combat" ? hitstopForDelivery(data.delivery) : 0,
          });
          triggerDamageScreenPulse(scene);
          triggerDamageCameraShake(scene, -delta);
        }
      }
    }

    if (stats.currentHealth <= 0) {
      if (!stats.dead) {
        stats.dead = true;
        if (typeof onLocalDeath === "function") {
          try {
            onLocalDeath();
          } catch (_) {}
        }
        stopWallSlideAudio?.();
      }
      stats.currentHealth = 0;
    }

    updateHealthBar();
  };

  const playerDeadHandler = (payload) => {
    if (payload?.username !== getUsername()) return;

    const scene = getScene();
    const player = getPlayer();
    if (!scene || !player || player._deathPresentationActive) return;

    player._deathPresentationActive = true;
    player._deathPresentationAt = Number(payload?.at) || Date.now();
    stats.dead = true;
    try { cancelFighterCombat(player, { local: true }); } catch (_) {}
    try {
      onLocalDeath?.();
    } catch (_) {}

    stopWallSlideAudio?.();

    try {
      scene.sound.play("sfx-you-death", { volume: 0.23 });
    } catch (_) {}
    spawnDeathBurst(scene, player, { color: 0xff7394, glowColor: 0xffd4de });
    try {
      player.alpha = 1;
      player.setVisible(true);
      playSpriteAnimation({
        scene,
        sprite: player,
        character: getCurrentCharacter(),
        logical: "dying",
        fallback: "idle",
      });
    } catch (_) {}
    try {
      player.setAcceleration(0, 0);
    } catch (_) {}
    try {
      player.setVelocity(0, 0);
    } catch (_) {}
    if (player.body) {
      player.body.enable = false;
    }

    cancelCorpseRemoval();
    const generation = deathGeneration;
    corpseRemovalTimer = scene.time.delayedCall(1500, () => {
      if (generation !== deathGeneration || getPlayer() !== player || !player._deathPresentationActive) return;
      corpseRemovalTimer = null;
      try {
        removeLocalCorpse?.();
      } catch (_) {}
      try {
        player.setVisible(false);
      } catch (_) {}
    });
  };

  const superUpdateHandler = (data) => {
    if (data.username !== getUsername()) return;
    stats.superCharge = data.charge;
    stats.maxSuperCharge = data.maxCharge;
    updateHealthBar();
  };

  const specialHandler = (data) => {
    if (data.username !== getUsername()) return;

    const scene = getScene();
    const player = getPlayer();

    performSpecial(data.character, { scene, player, isOwner: true, aim: data.aim || null });
  };

  const knockbackHandler = (data) => {
    const player = getPlayer();
    if (!player || !player.body || stats.dead) return;

    const amountX = Number(data?.amountX) || 0;
    const amountY = Number(data?.amountY) || 0;
    // The server cancels a pending stomp when knocked back; match it locally.
    player._stompArmedUntil = 0;
    if (player._bbAnimationState) player._bbAnimationState.stompPose = false;
    if (data?.cause === "stomp") {
      endDash(player, false);
      player._attackInterruptedUntil = Date.now() + 300;
      interruptPresentation(player);
      onAttackInterrupted?.();
    }
    if (data?.cause === "shockwave" || data?.cause === "stomp") {
      const body = player.body;
      const contacts = Object.fromEntries(["up", "down", "left", "right"].map(
        side => [side, !!(body.blocked?.[side] || body.touching?.[side])],
      ));
      const impulse = resolveShockwaveImpulse(amountX, amountY, contacts);
      player._jumpLaunch = null;
      player._shockwaveUntil = Date.now() + SHOCKWAVE_MOMENTUM_MS;
      player._wallSlideSuppressedUntil = player._shockwaveUntil;
      player.setMaxVelocity(Math.max(1, Math.abs(impulse.x)), Math.max(movementPhysics.maxVerticalSpeed, Math.abs(impulse.y)));
      player.setAccelerationX(0);
      player.setDragX(0);
      player.setVelocityX(impulse.x);
      player.setVelocityY(impulse.y);
    } else {
      player.setVelocityX(amountX);
      player.setVelocityY(data?.radial === true ? amountY : -Math.abs(amountY));
    }
    player._wallKickLockUntil = Date.now() + 120;
    if (amountX || amountY) spawnKnockbackTrail?.(getScene?.(), player);
  };

  const playerRespawnHandler = (payload) => {
    if (payload?.username !== getUsername()) return;
    const scene = getScene();
    const player = getPlayer();
    if (!scene || !player) return;

    cancelCorpseRemoval();
    stats.dead = false;
    if (typeof payload?.maxHealth === "number" && payload.maxHealth > 0) {
      stats.maxHealth = payload.maxHealth;
    }
    if (typeof payload?.health === "number") {
      stats.currentHealth = payload.health;
    }

    try {
      cancelFighterCombat(player, { local: true });
      if (payload.spawnReset) player.flipX = false;
      onAttackInterrupted?.();
    } catch (_) {}

    try {
      player._deathPresentationActive = false;
      player._deathPresentationAt = 0;
      player.alpha = 1;
      player.setVisible(true);
      if (player.body) {
        player.body.enable = true;
        if (Number.isFinite(payload?.x) && Number.isFinite(payload?.y)) {
          player.body.reset(Number(payload.x), Number(payload.y));
        }
      }
      localMovementCorrector?.clear();
      player.setVelocity?.(0, 0);
      player.setAcceleration?.(0, 0);
      playSpriteAnimation({
        scene,
        sprite: player,
        character: getCurrentCharacter(),
        logical: "idle",
        fallback: "idle",
      });
      // Animation frames can change the display origin; refresh the body before
      // drawing UI anchored to its top edge.
      player.body?.updateFromGameObject?.();
    } catch (_) {}

    try {
      onLocalRespawn?.();
    } catch (_) {}

    try {
      spawnRespawnEffect(scene, player, { silent: payload.kickoff === true });
    } catch (_) {}

    updateHealthBar();
  };

  const stompHandler = (data) => {
    const scene = getScene();
    if (!scene || !Number.isFinite(data?.x) || !Number.isFinite(data?.y)) return;
    const local = data.username === getUsername();
    // Our own stomp was already shown and heard on landing (localMovementFx);
    // the server event then only confirms who it interrupted.
    const predicted = local && Date.now() - (scene._localStompPredictedAt || 0) < 1000;
    if (predicted) scene._localStompPredictedAt = 0;
    else {
      spawnStompImpact(scene, data.x, data.y, { cameraShake: local, fallDistance: data.fallDistance });
      if (local) scene.sound?.play('sfx-stomp', { volume: combatSoundVolume('sfx-stomp') });
      else playPlayerSound(scene, { x: data.x, y: data.y }, 'sfx-stomp');
    }
    for (const name of data.interrupted || []) {
      const wrapper = Object.values(getOpponentPlayersRef() || {}).find(op =>
        op.username === name || op.name === name || op.opponent?.name === name);
      if (!wrapper?.opponent) continue;
      interruptPresentation(wrapper.opponent);
    }
  };
  const interruptPresentation = (sprite) => {
    sprite.emit?.('attack:interrupted');
    sprite._specialCastLockUntil = 0;
    // Ends any throw or special, so the falling pose below can play.
    sprite._bbAnimationState = {};
    sprite._lockFlip = false;
    playSpriteAnimation({ scene: getScene(), sprite, character: sprite._bbCharacter,
      logical: 'falling', fallback: 'idle' });
  };
  const correctionHandler = (data) => {
    const player = getPlayer();
    if (localMovementCorrector?.apply(player, data) && data.reason === 'idle') {
      endDash(player, false);
    }
  };
  socket.on(SOCKET_EVENTS.PLAYER_STOMP, stompHandler);
  socket.on(SOCKET_EVENTS.GAME_CORRECTION, correctionHandler);

  socket.on(SOCKET_EVENTS.PLAYER_KNOCKBACK, knockbackHandler);
  socket.on(SOCKET_EVENTS.PLAYER_DEAD, playerDeadHandler);
  socket.on(SOCKET_EVENTS.PLAYER_RESPAWN, playerRespawnHandler);

  function dispose() {
    cancelCorpseRemoval();
    socket.off(SOCKET_EVENTS.PLAYER_STOMP, stompHandler);
    socket.off(SOCKET_EVENTS.GAME_CORRECTION, correctionHandler);

    socket.off(SOCKET_EVENTS.PLAYER_KNOCKBACK, knockbackHandler);
    socket.off(SOCKET_EVENTS.PLAYER_DEAD, playerDeadHandler);
    socket.off(SOCKET_EVENTS.PLAYER_RESPAWN, playerRespawnHandler);
  }
  return { dispose, applyHealthUpdate: healthUpdateHandler, applySuperUpdate: superUpdateHandler, presentSpecial: specialHandler };
}
