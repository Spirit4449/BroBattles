import { performSpecial } from "../characters/special";
import {
  spawnDamageImpact,
  spawnDeathBurst,
  spawnSpawnBurst,
  triggerDamageScreenPulse,
} from "../effects";

export function bindLocalSocketEvents({
  socket,
  getUsername,
  getScene,
  getPlayer,
  getCurrentCharacter,
  getGameId,
  getPlayersInTeam,
  getOpponentPlayersRef,
  resolveAnimKey,
  spawnHealthMarker,
  updateHealthBar,
  getCurrentHealth,
  setCurrentHealthValue,
  getMaxHealth,
  setMaxHealth,
  getDead,
  setDead,
  getSuperCharge,
  setSuperCharge,
  setMaxSuperCharge,
  getWallSlideLoopSfx,
  getWallSlideLoopPlaying,
  setWallSlideLoopPlaying,
  getIsEditMode,
  onLocalDeath,
  removeLocalCorpse,
  onDebug,
}) {
  const isEditModeActive = () => {
    try {
      if (typeof getIsEditMode === "function") return !!getIsEditMode();
    } catch (_) {}
    return !!window.__BB_MAP_EDIT_ACTIVE;
  };

  const healthUpdateHandler = (data) => {
    if (data.username !== getUsername()) return;

    const scene = getScene();
    const player = getPlayer();

    const prev = getCurrentHealth();
    if (typeof data.maxHealth === "number" && data.maxHealth > 0) {
      setMaxHealth(data.maxHealth);
      if (getCurrentHealth() > getMaxHealth()) {
        setCurrentHealthValue(getMaxHealth());
      }
    }
    setCurrentHealthValue(data.health);

    const delta = getCurrentHealth() - prev;

    if (isEditModeActive() && delta < 0) {
      setCurrentHealthValue(prev);
      updateHealthBar();
      return;
    }

    onDebug?.();

    if (scene && player && delta !== 0) {
      const markerY = player.body
        ? player.body.y - 16
        : player.y - player.height / 2;
      spawnHealthMarker(scene, player.x, markerY, delta, { depth: 18 });
    }

    if (scene && scene.sound && !getDead()) {
      if (delta < 0) {
        scene.sound.play("sfx-damage", { volume: 5 });
        if (data.cause !== "poison") {
          spawnDamageImpact(scene, player);
          triggerDamageScreenPulse(scene);
        }
      } else if (delta > 0) {
        const s = scene.sound.add("sfx-heal", { volume: 0.1 });
        try {
          s.play();
        } catch (_) {}
      }
    }

    if (getCurrentHealth() <= 0) {
      if (!getDead()) {
        setDead(true);
        if (typeof onLocalDeath === "function") {
          try {
            onLocalDeath();
          } catch (_) {}
        }
        if (getWallSlideLoopPlaying() && getWallSlideLoopSfx()) {
          try {
            getWallSlideLoopSfx().stop();
          } catch (_) {}
          setWallSlideLoopPlaying(false);
        }
        onDebug?.();
      }
      setCurrentHealthValue(0);
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
    setDead(true);
    try {
      onLocalDeath?.();
    } catch (_) {}

    if (getWallSlideLoopPlaying() && getWallSlideLoopSfx()) {
      try {
        getWallSlideLoopSfx().stop();
      } catch (_) {}
      setWallSlideLoopPlaying(false);
    }

    try {
      scene.sound.play("sfx-you-death", { volume: 0.55 });
    } catch (_) {}
    spawnDeathBurst(scene, player, { color: 0xff7394, glowColor: 0xffd4de });
    try {
      player.alpha = 1;
      player.setVisible(true);
      player.anims.play(
        resolveAnimKey(scene, getCurrentCharacter(), "dying", "idle"),
        true,
      );
    } catch (_) {}
    try {
      scene.input.enabled = false;
      if (scene.input?.keyboard) scene.input.keyboard.enabled = false;
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

    scene.time.delayedCall(1500, () => {
      if (!player) return;
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
    setSuperCharge(data.charge);
    setMaxSuperCharge(data.maxCharge);
    updateHealthBar();
  };

  const specialHandler = (data) => {
    if (data.username !== getUsername()) return;

    const scene = getScene();
    const player = getPlayer();

    const targets = Object.values(getOpponentPlayersRef() || {})
      .map((op) => op.opponent)
      .filter((s) => s && s.active);

    performSpecial(
      data.character,
      scene,
      player,
      getPlayersInTeam(),
      targets,
      getUsername(),
      getGameId(),
      true,
      data.aim || null,
    );
  };

  const knockbackHandler = (data) => {
    if (isEditModeActive()) return;
    const player = getPlayer();
    if (!player || !player.body || getDead()) return;

    const amountX = Number(data?.amountX) || 0;
    const amountY = Number(data?.amountY) || 0;
    player.setVelocityX(amountX);
    player.setVelocityY(-Math.abs(amountY));
    player._wallKickLockUntil = Date.now() + 120;
  };

  const playerRespawnHandler = (payload) => {
    if (payload?.username !== getUsername()) return;
    const scene = getScene();
    const player = getPlayer();
    if (!scene || !player) return;

    setDead(false);
    if (typeof payload?.maxHealth === "number" && payload.maxHealth > 0) {
      setMaxHealth(payload.maxHealth);
    }
    if (typeof payload?.health === "number") {
      setCurrentHealthValue(payload.health);
    }

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
      player.setVelocity?.(0, 0);
      player.setAcceleration?.(0, 0);
      player.anims?.play?.(
        resolveAnimKey(scene, getCurrentCharacter(), "idle", "idle"),
        true,
      );
      spawnSpawnBurst(scene, player, {
        tint: 0xffffff,
        accent: 0xb8ecff,
        depth: 28,
      });
    } catch (_) {}

    try {
      scene.input.enabled = true;
      if (scene.input?.keyboard) scene.input.keyboard.enabled = true;
    } catch (_) {}

    updateHealthBar();
  };

  socket.on("health-update", healthUpdateHandler);
  socket.on("super-update", superUpdateHandler);
  socket.on("player:special", specialHandler);
  socket.on("player:knockback", knockbackHandler);
  socket.on("player:dead", playerDeadHandler);
  socket.on("player:respawn", playerRespawnHandler);

  return () => {
    socket.off("health-update", healthUpdateHandler);
    socket.off("super-update", superUpdateHandler);
    socket.off("player:special", specialHandler);
    socket.off("player:knockback", knockbackHandler);
    socket.off("player:dead", playerDeadHandler);
    socket.off("player:respawn", playerRespawnHandler);
  };
}
