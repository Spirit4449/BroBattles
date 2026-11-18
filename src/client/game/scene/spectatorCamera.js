import { restingCameraFrame } from "./cameraDynamics";
const LOCAL_DEATH_PAUSE_MS = 2000;

export function createSpectatorCamera(scene, { getGameData, getUsername, getPlayer, opponentPlayers, teamPlayers, hud, followLocalPlayer }) {
  // The audio listener and poison vignette read their current targets from the scene.
  function _enterSpectatorMode({ holdCamera = false } = {}) {
    if (!scene._spectatorModeActive) {
      scene._spectatorModeActive = true;
      scene._spectatorVignette = true;
    }
    _setSpectatedPlayer(scene._spectatedPlayerName, { holdCamera });
  }

  function _getSpectatablePlayers() {
    const roster = Array.isArray(getGameData()?.players) ? getGameData().players : [];
    return roster
      .filter((entry) => {
        if (!entry?.name || entry.name === getUsername()) return false;
        const wrapper = opponentPlayers[entry.name] || teamPlayers[entry.name];
        return (
          entry.isAlive !== false &&
          entry.connected !== false &&
          entry.loaded !== false &&
          !!wrapper?.opponent?.active &&
          !wrapper._deathPresentationActive &&
          !wrapper._corpseRemoved
        );
      })
      .map((entry) => ({
        name: String(entry.name),
        wrapper: opponentPlayers[entry.name] || teamPlayers[entry.name],
      }));
  }

  function _noteLocalKiller(name) {
    scene._localKillerName = name ? String(name) : null;
  }

  // First spectate target after dying: the killer, else the nearest fighter.
  function _pickDeathSpectateTarget() {
    const candidates = _getSpectatablePlayers();
    const killer = candidates.find((entry) => entry.name === scene._localKillerName);
    if (killer) return killer.name;
    let nearest = null;
    let nearestDistSq = Infinity;
    for (const entry of candidates) {
      const sprite = entry.wrapper.opponent;
      const distSq = (sprite.x - getPlayer().x) ** 2 + (sprite.y - getPlayer().y) ** 2;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = entry.name;
      }
    }
    return nearest;
  }

  function _setSpectatedPlayer(name, { holdCamera = false } = {}) {
    const candidates = _getSpectatablePlayers();
    const selected =
      candidates.find((entry) => entry.name === name) || candidates[0] || null;
    const nextName = selected?.name || null;
    const changed = nextName !== scene._spectatedPlayerName;
    const candidateCountChanged =
      candidates.length !== scene._spectatorCandidateCount;

    if (changed) {
      for (const wrapper of [
        ...Object.values(opponentPlayers),
        ...Object.values(teamPlayers),
      ]) {
        wrapper?.setSpectated?.(!!nextName && wrapper.username === nextName);
      }
    }

    scene._spectatedPlayerName = nextName;
    scene._spectatedPlayerAudioSprite = selected?.wrapper?.opponent || null;
    scene._spectatorCandidateCount = candidates.length;
    if (changed || candidateCountChanged) {
      hud.setSpectatingPlayer?.(nextName, { canSwitch: candidates.length > 1 });
    }

    const cam = scene.cameras.main;
    // The death pause keeps the camera on the local corpse.
    if (!cam || holdCamera) return;
    if (!selected?.wrapper?.opponent) {
      if (!scene._spectatorFallbackActive) {
        scene._spectatorFallbackActive = true;
        scene._spectatorCameraFollowing = false;
        const bounds = scene._spectatorBounds || {};
        try {
          cam.stopFollow();
          cam.pan(
            Number(bounds.centerX) || 1150,
            (Number(bounds.centerY) || 500) - 120,
            500,
            "Cubic.easeOut",
          );
        } catch (_) {}
      }
      cam.setZoom(cam.zoom + (1.2 - cam.zoom) * 0.075);
      return;
    }
    scene._spectatorFallbackActive = false;
    const watchedPlayer = selected.wrapper.opponent;
    const cameraTarget = scene._spectatorCameraTarget ||
      (scene._spectatorCameraTarget = { x: 0, y: 0 });
    if (!scene._spectatorCameraFollowing) {
      // startFollow immediately centers on its target. Seed the proxy from the
      // camera's current midpoint so entering (or resuming) spectate never snaps.
      cameraTarget.x = cam.midPoint.x + cam.followOffset.x;
      cameraTarget.y = cam.midPoint.y + cam.followOffset.y;
      try {
        cam.stopFollow();
        cam.startFollow(
          cameraTarget,
          false,
          0.075,
          0.06,
          cam.followOffset.x,
          cam.followOffset.y,
        );
        scene._spectatorCameraFollowing = true;
      } catch (_) {}
    }
    // The camera remains attached to this proxy across player changes. Updating
    // its destination lets Phaser's follow lerp glide between fighters instead
    // of startFollow snapping straight to the newly selected sprite.
    cameraTarget.x = watchedPlayer.x;
    cameraTarget.y = watchedPlayer.y;
    // Frame the watched fighter exactly as their own follow camera would.
    const rest = scene._mapArena?.camera
      ? restingCameraFrame(watchedPlayer.y, scene._mapArena.camera)
      : { zoom: 1.55, followOffsetY: 85 };
    cam.setFollowOffset(
      0,
      cam.followOffset.y + (rest.followOffsetY - cam.followOffset.y) * 0.1,
    );
    cam.setZoom(cam.zoom + (rest.zoom - cam.zoom) * 0.075);
  }

  function _syncSpectatedPlayer() {
    _setSpectatedPlayer(scene._spectatedPlayerName);
  }

  function _cycleSpectatedPlayer(direction = 1) {
    scene._deathSpectateTargetLocked = true;
    const candidates = _getSpectatablePlayers();
    if (!candidates.length) {
      _setSpectatedPlayer(null);
      return;
    }
    const currentIndex = candidates.findIndex(
      (entry) => entry.name === scene._spectatedPlayerName,
    );
    const step = direction < 0 ? -1 : 1;
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + step + candidates.length) % candidates.length;
    _setSpectatedPlayer(candidates[nextIndex].name);
  }


  function updateDeath() {
    // Hold the camera on the corpse before handing it to spectate.
    const now = performance.now();
    if (scene._localDeathStartedAt == null) {
      scene._localDeathStartedAt = now;
      hud.showLocalDeath?.();
    }
    const holdCamera = now - scene._localDeathStartedAt < LOCAL_DEATH_PAUSE_MS;
    // The killer name can land a few frames after health hits zero, so keep
    // re-picking until the pause ends or the player chooses someone.
    if (!scene._deathSpectateTargetLocked) {
      scene._spectatedPlayerName = _pickDeathSpectateTarget();
      if (!holdCamera) scene._deathSpectateTargetLocked = true;
    }
    _enterSpectatorMode({ holdCamera });
  }

  function updateAlive() {
    if (scene._localDeathStartedAt != null) {
      scene._localDeathStartedAt = null;
      scene._localKillerName = null;
      scene._deathSpectateTargetLocked = false;
      hud.hideLocalDeath?.();
    }
    scene._spectatorVignette = false;
    if (scene._spectatorModeActive) {
      try {
        followLocalPlayer(scene.cameras.main);
      } catch (_) {}
    }
    scene._spectatorModeActive = false;
    scene._spectatedPlayerName = null;
    scene._spectatedPlayerAudioSprite = null;
    scene._spectatorCandidateCount = 0;
    scene._spectatorFallbackActive = false;
    scene._spectatorCameraFollowing = false;
    for (const wrapper of [
      ...Object.values(opponentPlayers),
      ...Object.values(teamPlayers),
    ]) {
      wrapper?.setSpectated?.(false);
    }
    hud.hideSpectatingPlayer?.();
  }
  return { updateDeath, updateAlive, noteLocalKiller: _noteLocalKiller, syncSpectatedPlayer: _syncSpectatedPlayer, cycleSpectatedPlayer: _cycleSpectatedPlayer };
}
