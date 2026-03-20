// match/matchCoordinator.js
//
// Owns all server socket event handlers for a live match session.
// Use createMatchCoordinator() to get an instance, then call register() once
// listeners should be active and dispose() to remove them on cleanup.
//
// Dependencies are injected via the config object so this module has zero
// hidden global state and can be tested or instantiated in isolation.
import { normalizeMapId } from "../maps/manifest";

/**
 * @typedef {object} MatchCoordinatorConfig
 * @property {import('socket.io-client').Socket} socket
 * @property {number|string} matchId
 * @property {() => object}        getGameData
 * @property {() => string}        getUsername
 * @property {() => object}        getJoinPayload
 * @property {() => object|null}   getGameScene
 * @property {() => object|null}   getPlayer
 * // ---- mutable game-phase flags ----
 * @property {() => boolean}       getGameInitialized
 * @property {(v: boolean) => void} setGameInitialized
 * @property {() => boolean}       getHasJoined
 * @property {(v: boolean) => void} setHasJoined
 * @property {() => boolean}       getJoinInFlight
 * @property {(v: boolean) => void} setJoinInFlight
 * @property {() => boolean}       getIsLiveGame
 * @property {(v: boolean) => void} setIsLiveGame
 * @property {() => boolean}       getGameEnded
 * @property {(v: boolean) => void} setGameEnded
 * @property {(v: boolean) => void} setStartingPhase
 * @property {(v: any) => void}    setPendingAuthoritativeLocalState
 * // ---- spawn state ----
 * @property {() => number}        getSpawnVersion
 * @property {(v: number) => void} setSpawnVersion
 * @property {object}              serverSpawnIndex
 * // ---- live state (set via setter, read externally via closure var) ----
 * @property {(v: Array) => void}  setLatestPowerups
 * @property {(v: object) => void} setLatestPlayerEffects
 * @property {() => object}        getLatestPlayerEffects
 * // ---- by-reference mutable collections  ----
 * @property {object} opponentPlayers
 * @property {object} teamPlayers
 * @property {Array}  pendingActionsQueue
 * @property {Array}  powerupCollectQueue
 * @property {Array}  shieldImpactQueue
 * @property {object} lastHealthByPlayer
 * @property {object} lastShieldActiveAt
 * // ---- module dependencies ----
 * @property {object}   snapshotBuffer
 * @property {object}   hud
 * @property {Function} positionSpawn
 * @property {Function} OpPlayer
 * @property {Function} handleRemoteAttack
 * @property {object}   powerupTickSounds
 * // ---- callbacks for behaviors that remain in game.js ----
 * @property {Function} onInitializePlayers
 * @property {Function} onTrySendReadyAck
 * @property {Function} onTrackShieldEffects
 * @property {Function} onStartSuddenDeathMusic
 * @property {Function} onStopSuddenDeathMusic
 * @property {Function} onPlayMatchEndSound
 * @property {Function} onShowGameOverScreen
 */

/**
 * Creates a match coordinator that manages all socket event handling
 * for a live game session.
 *
 * @param {MatchCoordinatorConfig} config
 * @returns {{ register: Function, dispose: Function }}
 */
export function createMatchCoordinator(config) {
  const {
    socket,
    getGameData,
    getUsername,
    getJoinPayload,
    getGameScene,
    getPlayer,
    getGameInitialized,
    setGameInitialized,
    getHasJoined,
    setHasJoined,
    getJoinInFlight,
    setJoinInFlight,
    getIsLiveGame,
    setIsLiveGame,
    getGameEnded,
    setGameEnded,
    setStartingPhase,
    setPendingAuthoritativeLocalState,
    getSpawnVersion,
    setSpawnVersion,
    serverSpawnIndex,
    setLatestPowerups,
    setLatestPlayerEffects,
    getLatestPlayerEffects,
    opponentPlayers,
    teamPlayers,
    pendingActionsQueue,
    powerupCollectQueue,
    shieldImpactQueue,
    lastHealthByPlayer,
    lastShieldActiveAt,
    snapshotBuffer,
    hud,
    positionSpawn,
    OpPlayer,
    handleRemoteAttack,
    powerupTickSounds,
    onInitializePlayers,
    onTrySendReadyAck,
    onTrackShieldEffects,
    onStartSuddenDeathMusic,
    onStopSuddenDeathMusic,
    onPlayMatchEndSound,
    onShowGameOverScreen,
  } = config;
  const REMOTE_ATTACK_PRECISION_WINDOW_MS = 320;
  const START_WATCHDOG_TIMEOUT_MS = 15_000;

  let _startWatchdogTimer = null;
  let _startWatchdogDeadline = 0;

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Applies a server-provided spawn position to a newly created OpPlayer based
   * on the authoritative spawn index (falling back to roster sort order).
   */
  function _positionOpPlayer(op, pd) {
    const gameData = getGameData();
    try {
      const teamRoster = (gameData.players || []).filter(
        (p) => p.team === pd.team,
      );
      const idx =
        typeof serverSpawnIndex[pd.name] === "number"
          ? serverSpawnIndex[pd.name]
          : Math.max(
              0,
              teamRoster
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .findIndex((p) => p.name === pd.name),
            );
      positionSpawn(
        getGameScene(),
        op.opponent,
        gameData.map,
        pd.team,
        idx,
        teamRoster.length,
      );
      op.updateUIPosition?.();
    } catch (_) {}
  }

  /**
   * Returns the existing OpPlayer wrapper for name, or creates and registers
   * one if it is missing. Used as a lazy-create guard in both snapshot and
   * action handlers. Returns null when the player is the local user or has no
   * known roster entry.
   */
  function _ensureOpPlayer(name) {
    const username = getUsername();
    if (name === username) return null;

    const gameData = getGameData();
    const pd = (gameData?.players || []).find((p) => p.name === name);
    if (!pd) return null;

    const isTeammate = pd.team === gameData.yourTeam;
    const container = isTeammate ? teamPlayers : opponentPlayers;
    const existing = container[name];
    if (existing?.opponent) return existing;

    const scene = getGameScene();
    if (!scene) return null;

    const op = new OpPlayer(
      scene,
      pd.char_class,
      pd.name,
      isTeammate ? "teammate" : pd.team,
      null,
      null,
      (gameData.players || []).filter((p) => p.team === pd.team).length,
      normalizeMapId(gameData?.map),
    );
    op._spawnVersion = getSpawnVersion();
    _positionOpPlayer(op, pd);
    container[pd.name] = op;
    return op;
  }

  // ---------------------------------------------------------------------------
  // Socket event handlers (named functions so dispose() can target them exactly)
  // ---------------------------------------------------------------------------

  /** Re-emit game:join when a socket connection is established or restored. */
  function _tryJoin() {
    const joinPayload = getJoinPayload();
    if (
      !getGameInitialized() &&
      joinPayload &&
      Number(joinPayload.matchId) > 0 &&
      !getHasJoined() &&
      !getJoinInFlight()
    ) {
      console.log("[game] connect", joinPayload);
      try {
        setJoinInFlight(true);
        socket.emit("game:join", joinPayload, (ack) => {
          setJoinInFlight(false);
          if (!ack || ack.ok !== true) {
            console.warn("[game] join ack failed", ack);
          } else {
            console.log("[game] join ack ok", ack);
            setHasJoined(true);
          }
        });
      } catch (e) {
        console.warn("[game] join emit error", e);
      }
    }
  }

  function _onGameJoined() {
    setHasJoined(true);
  }

  function _stopStartWatchdog() {
    if (_startWatchdogTimer) {
      clearInterval(_startWatchdogTimer);
      _startWatchdogTimer = null;
    }
    _startWatchdogDeadline = 0;
  }

  function _startStartWatchdog() {
    if (getIsLiveGame() || getGameEnded()) return;
    if (_startWatchdogTimer) return;

    const joinPayload = getJoinPayload() || {};
    const joinMatchId = Number(joinPayload.matchId);
    if (!Number.isFinite(joinMatchId) || joinMatchId <= 0) return;

    _startWatchdogDeadline = Date.now() + START_WATCHDOG_TIMEOUT_MS;
    _startWatchdogTimer = setInterval(() => {
      if (getGameEnded() || getIsLiveGame()) {
        _stopStartWatchdog();
        return;
      }

      if (Date.now() >= _startWatchdogDeadline) {
        _stopStartWatchdog();
        try {
          alert("Match start timed out. Returning to lobby.");
        } catch (_) {}
        window.location.href = "/";
        return;
      }

      try {
        socket.emit("game:join", joinPayload);
      } catch (_) {}
      try {
        socket.emit("game:ready", { matchId: joinMatchId });
      } catch (_) {}
    }, 1000);
  }

  function _onGameInit(gameState) {
    const gameData = getGameData();
    const username = getUsername();

    console.log("Game initialized:", {
      players: Array.isArray(gameState?.players) ? gameState.players.length : 0,
      status: gameState?.status,
    });

    setGameInitialized(true);
    setHasJoined(true);

    // Detect late-join into an already-running game
    try {
      const status = String(gameState?.status || "").toLowerCase();
      const live =
        status === "active" || status === "started" || status === "running";
      setIsLiveGame(live);
      console.log(live, "is live");
      if (live) {
        hud.hideBattleStartOverlay();
        try {
          const scene = getGameScene();
          if (scene?.input?.keyboard) scene.input.keyboard.enabled = true;
        } catch (_) {}
      } else if (status === "waiting" || status === "starting") {
        try {
          const gameData = getGameData();
          hud.showBattleStartOverlay(gameData.players);
        } catch (_) {}
      }
    } catch (_) {}

    // Capture server-provided spawn indices and presence
    try {
      if (Array.isArray(gameState.players)) {
        for (const p of gameState.players) {
          if (typeof p.spawnIndex === "number")
            serverSpawnIndex[p.name] = p.spawnIndex;
          if (typeof p.connected === "boolean")
            hud.setTeamHudPlayerPresence(p.name, p.connected);
          if (typeof p.loaded === "boolean")
            hud.setTeamHudPlayerLoaded(p.name, p.loaded);
        }
      }
      if (
        typeof gameState.spawnVersion === "number" &&
        gameState.spawnVersion > getSpawnVersion()
      ) {
        setSpawnVersion(gameState.spawnVersion);
      }
    } catch (_) {}

    // Merge gamedata roster with init live-state, then initialize players
    if (Array.isArray(gameData?.players)) {
      const initByName = new Map(
        (Array.isArray(gameState?.players) ? gameState.players : []).map(
          (p) => [p?.name, p],
        ),
      );
      const mergedRoster = gameData.players.map((p) => {
        const live = initByName.get(p.name) || null;
        return {
          ...p,
          ...(live || {}),
          name: p.name,
          team: p.team,
          char_class: p.char_class,
        };
      });
      onInitializePlayers(mergedRoster);
      hud.initTeamStatusHud(mergedRoster);
    }

    if (Array.isArray(gameState.powerups))
      setLatestPowerups(gameState.powerups);
    if (
      gameState.playerEffects &&
      typeof gameState.playerEffects === "object"
    ) {
      setLatestPlayerEffects(gameState.playerEffects);
      onTrackShieldEffects(gameState.playerEffects);
    }

    // Stash local player's live stats so character modules and spawn logic can use them
    try {
      const me = (gameState.players || []).find((p) => p.name === username);
      if (me) {
        window.__MATCH_SESSION__.level = me.level || 1;
        window.__MATCH_SESSION__.stats = me.stats || {};
        setPendingAuthoritativeLocalState({
          x: me.x,
          y: me.y,
          health: me.health,
          maxHealth: me.stats?.health,
          superCharge: me.superCharge,
          maxSuperCharge: me.maxSuperCharge,
          ammoState: me.ammoState || null,
          isAlive: me.isAlive,
          loaded: me.loaded === true,
          connected: me.connected !== false,
        });
      }
    } catch (_) {}
  }

  /** Server says the game has started — begin the pre-game countdown for normal joiners. */
  function _onGameStart(data) {
    console.log("Game starting:", data);
    _stopStartWatchdog();
    // Late joiners skip the countdown because the game is already running
    if (!getIsLiveGame()) {
      const seconds = Math.max(1, Number(data?.countdown) || 3);
      hud.startCountdown(seconds);
    }
  }

  /** Server entered the starting window — show battle overlay and ack readiness. */
  function _onGameStarting(payload) {
    console.log("Game starting phase:", payload);
    setStartingPhase(true);
    if (!getIsLiveGame()) {
      const gameData = getGameData();
      hud.showBattleStartOverlay(gameData.players);
    }
    onTrySendReadyAck();
    _startStartWatchdog();
  }

  function _onHealthUpdate(payload) {
    if (!payload?.username) return;
    if (typeof payload.health === "number") {
      hud.setTeamHudPlayerAlive(payload.username, payload.health > 0);
      const prev = lastHealthByPlayer[payload.username];
      lastHealthByPlayer[payload.username] = payload.health;
      // Flash shield-impact particle if health dropped while shield was active
      if (
        typeof prev === "number" &&
        payload.health < prev &&
        ((getLatestPlayerEffects()?.[payload.username]?.shield || 0) > 0 ||
          Date.now() - (lastShieldActiveAt[payload.username] || 0) <= 900)
      ) {
        shieldImpactQueue.push({ username: payload.username, at: Date.now() });
      }
    }
  }

  function _onPlayerDead(payload) {
    if (!payload?.username) return;
    hud.setTeamHudPlayerAlive(payload.username, false);
  }

  function _onGameSnapshot(snapshot) {
    if (!snapshot || !snapshot.players) return;

    if (Array.isArray(snapshot.powerups)) setLatestPowerups(snapshot.powerups);
    if (snapshot.playerEffects && typeof snapshot.playerEffects === "object") {
      setLatestPlayerEffects(snapshot.playerEffects);
      onTrackShieldEffects(snapshot.playerEffects);
    }

    hud.syncTeamHudFromSnapshot(snapshot.players);

    const ingest = snapshotBuffer.ingestSnapshot(snapshot, performance.now());
    if (ingest.activated) {
      console.log("Started receiving server snapshots (tMono/tickId enabled)");
      _stopStartWatchdog();
      try {
        const introActive =
          typeof hud?.isBattleIntroActive === "function"
            ? hud.isBattleIntroActive()
            : false;
        if (!introActive) {
          hud.hideBattleStartOverlay();
          const scene = getGameScene();
          if (scene?.input?.keyboard) scene.input.keyboard.enabled = true;
        }
      } catch (_) {}
    }
    if (typeof ingest.calibrationLog === "number") {
      console.log(
        "Monotonic offset calibrated (ms):",
        ingest.calibrationLog.toFixed(2),
      );
    }

    // Late-join safety: lazily create OpPlayers for any player in this snapshot
    try {
      const scene = getGameScene();
      if (scene) {
        for (const name of Object.keys(snapshot.players)) {
          _ensureOpPlayer(name);
        }
      }
    } catch (_) {}

    if (ingest.snapshotDiagLine) console.log(ingest.snapshotDiagLine);
  }

  function _onGameAction(packet) {
    try {
      if (!packet) return;

      const scene = getGameScene();
      if (!scene || !scene.sys || !scene.sys.isActive) {
        pendingActionsQueue.push(packet);
        return;
      }

      const { playerName, character, action } = packet;
      if (!playerName || !action) return;
      if (playerName === getUsername()) return; // never process own packets

      const wrapper = _ensureOpPlayer(playerName);
      if (!wrapper) return;

      const gameData = getGameData();
      const pd = (gameData.players || []).find((p) => p.name === playerName);
      const charKey = (character || (pd && pd.char_class) || "").toLowerCase();

      // PHASE 2: Attack visual consistency fix
      // Always render attack from opponent's CURRENT INTERPOLATED SPRITE POSITION
      // (not from server-recorded origin). This prevents visual gaps/stuttering.
      // Server origin is used only for hit validation (separate concern).
      const act = { ...(action || {}) };

      if (wrapper.opponent) {
        const ownerSprite = wrapper.opponent;
        const actionType = String(act.type || "").toLowerCase();
        const isProjectileAction =
          actionType.includes("fireball") ||
          actionType.includes("shuriken") ||
          actionType.includes("projectile");
        const isFireballAction = actionType.includes("fireball");

        // Default visual origin: current interpolated owner position.
        let visualX = ownerSprite.x;
        let visualY = ownerSprite.y;

        if (isProjectileAction) {
          // Projectiles are most sensitive to cross-client origin gaps.
          // Use a hybrid anchor: mostly visible sprite position, lightly nudged
          // toward server origin (bounded) to reduce left/right disagreement.
          const lift =
            (ownerSprite.displayHeight || ownerSprite.height || 120) * 0.12;
          visualY = ownerSprite.y - lift;
          // Fireballs already follow caster during startup; avoid extra origin pull.
          if (!isFireballAction) {
            const ox = Number(packet?.origin?.x);
            const oy = Number(packet?.origin?.y);
            if (Number.isFinite(ox) && Number.isFinite(oy)) {
              const dx = ox - visualX;
              const dy = oy - visualY;
              const d = Math.hypot(dx, dy);
              if (d > 0.001) {
                const pull = Math.min(36, d);
                visualX += (dx / d) * pull;
                visualY += (dy / d) * pull;
              }
            }
          }
        }

        // Use visual anchor for rendering (consistent with interpolation)
        act.x = visualX;
        act.y = visualY;
        if (isProjectileAction || !act.start || typeof act.start !== "object") {
          act.start = { x: visualX, y: visualY };
        }
        if (
          typeof act.direction !== "number" &&
          typeof packet.flip === "boolean"
        ) {
          act.direction = packet.flip ? -1 : 1;
        }
        if (typeof act.direction !== "number") {
          act.direction = ownerSprite.flipX ? -1 : 1;
        }
      }

      // Diagnostic: log if server-provided origin differs significantly from visual
      if (packet?.origin && wrapper?.opponent) {
        const originDeltaX = Math.abs(packet.origin.x - wrapper.opponent.x);
        const originDeltaY = Math.abs(packet.origin.y - wrapper.opponent.y);
        if (originDeltaX > 60 || originDeltaY > 60) {
          console.debug(
            `[Attack Visual Delta] ${playerName}: visual (${wrapper.opponent.x.toFixed(0)},${wrapper.opponent.y.toFixed(0)}) vs origin (${packet.origin.x.toFixed(0)},${packet.origin.y.toFixed(0)}) delta=(${originDeltaX.toFixed(0)},${originDeltaY.toFixed(0)})px`,
          );
        }
      }

      const consumed = handleRemoteAttack(scene, charKey, act, wrapper);
      // Prevent snapshot animation from immediately overwriting attack animation,
      // and open a precision window so interpolation blends toward hit position.
      if (consumed && wrapper) {
        wrapper._animLockUntil = performance.now() + 520;
        wrapper._attackPrecisionUntil =
          performance.now() + REMOTE_ATTACK_PRECISION_WINDOW_MS;
      }
      if (!consumed) {
        console.debug("Unhandled remote action", {
          playerName,
          charKey,
          action,
        });
      }
    } catch (err) {
      console.warn("Failed to handle remote game:action", err);
    }
  }

  function _onGameError(error) {
    console.error("Game error:", error);
    _stopStartWatchdog();
    alert(`Game error: ${error.message}`);
  }

  function _onPlayerDisconnected(data) {
    console.log("Player disconnected:", data);
    if (data?.name) {
      hud.setTeamHudPlayerPresence(data.name, false);
      hud.setTeamHudPlayerLoaded(data.name, false);
    }
  }

  function _onPlayerReconnected(data) {
    if (data?.name) hud.setTeamHudPlayerPresence(data.name, true);
  }

  function _onGameOver(payload) {
    if (getGameEnded()) return; // idempotent guard
    _stopStartWatchdog();
    setGameEnded(true);
    onStopSuddenDeathMusic();
    onPlayMatchEndSound(payload?.winnerTeam);
    try {
      const p = getPlayer();
      if (p?.body) p.body.enable = false;
    } catch (_) {}
    try {
      document.getElementById("game-timer-hud")?.classList.add("hidden");
    } catch (_) {}
    setTimeout(() => onShowGameOverScreen(payload), 2000);
  }

  function _onGameTimer(payload) {
    hud.updateTimerHud(payload.remaining, payload.suddenDeath);
    if (payload.suddenDeath && typeof payload.poisonY === "number") {
      const scene = getGameScene();
      if (scene) scene._poisonWaterY = payload.poisonY;
      onStartSuddenDeathMusic();
    }
  }

  function _onGameSuddenDeath(payload) {
    hud.showSuddenDeathBanner();
    onStartSuddenDeathMusic();
    const scene = getGameScene();
    if (scene && typeof payload?.poisonY === "number") {
      scene._poisonWaterY = payload.poisonY;
    }
  }

  function _onPowerupCollected(payload) {
    if (!payload || typeof payload.id === "undefined") return;
    powerupCollectQueue.push(payload);
  }

  function _onPowerupTick(payload) {
    if (!payload || !payload.type) return;
    const scene = getGameScene();
    if (!scene?.sound) return;
    const entry = powerupTickSounds[payload.type];
    if (!entry) return;
    try {
      scene.sound.play(entry.key, entry.options || {});
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Attach all match socket listeners. Call once after game data is fetched. */
  function register() {
    socket.on("connect", _tryJoin);
    socket.on("reconnect", _tryJoin);
    socket.on("game:joined", _onGameJoined);
    socket.on("game:init", _onGameInit);
    socket.on("game:start", _onGameStart);
    socket.on("game:starting", _onGameStarting);
    socket.on("health-update", _onHealthUpdate);
    socket.on("player:dead", _onPlayerDead);
    socket.on("game:snapshot", _onGameSnapshot);
    socket.on("game:action", _onGameAction);
    socket.on("game:error", _onGameError);
    socket.on("player:disconnected", _onPlayerDisconnected);
    socket.on("player:reconnected", _onPlayerReconnected);
    socket.on("game:over", _onGameOver);
    socket.on("game:timer", _onGameTimer);
    socket.on("game:sudden-death:start", _onGameSuddenDeath);
    socket.on("powerup:collected", _onPowerupCollected);
    socket.on("powerup:tick", _onPowerupTick);

    // If already connected when register() is called, attempt join right away
    if (socket.connected) _tryJoin();

    // Safety net for rare cases where start events are missed after joining.
    _startStartWatchdog();
  }

  /** Remove all match socket listeners. Safe to call multiple times. */
  function dispose() {
    _stopStartWatchdog();
    socket.off("connect", _tryJoin);
    socket.off("reconnect", _tryJoin);
    socket.off("game:joined", _onGameJoined);
    socket.off("game:init", _onGameInit);
    socket.off("game:start", _onGameStart);
    socket.off("game:starting", _onGameStarting);
    socket.off("health-update", _onHealthUpdate);
    socket.off("player:dead", _onPlayerDead);
    socket.off("game:snapshot", _onGameSnapshot);
    socket.off("game:action", _onGameAction);
    socket.off("game:error", _onGameError);
    socket.off("player:disconnected", _onPlayerDisconnected);
    socket.off("player:reconnected", _onPlayerReconnected);
    socket.off("game:over", _onGameOver);
    socket.off("game:timer", _onGameTimer);
    socket.off("game:sudden-death:start", _onGameSuddenDeath);
    socket.off("powerup:collected", _onPowerupCollected);
    socket.off("powerup:tick", _onPowerupTick);
  }

  return { register, dispose };
}
