// match/matchCoordinator.js
//
// Owns all server socket event handlers for a live match session.
// Use createMatchCoordinator() to get an instance, then call register() once
// listeners should be active and dispose() to remove them on cleanup.
//
// Dependencies are injected via the config object so this module has zero
// hidden global state and can be tested or instantiated in isolation.
import { normalizeMapId } from "../maps/manifest";
import { spawnDamageImpact } from "../effects";
import {
  configureClientNetTest,
  noteClientLifecycle,
  noteClientRemoteAction,
  noteClientSnapshot,
  shouldMuteClientDefaultLogs,
} from "../lib/netTestLogger.js";

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
 * @property {(v: object|null) => void} setLatestModeState
 * @property {() => object|null}   getLatestModeState
 * @property {() => Array}         getLatestDeathDrops
 * @property {(v: Array) => void}  setLatestDeathDrops
 * @property {(v: object) => void} setLatestPlayerEffects
 * @property {() => object}        getLatestPlayerEffects
 * // ---- by-reference mutable collections  ----
 * @property {object} opponentPlayers
 * @property {object} teamPlayers
 * @property {Array}  pendingActionsQueue
 * @property {Array}  powerupCollectQueue
 * @property {Array}  deathdropCollectQueue
 * @property {Array}  shieldImpactQueue
 * @property {object} lastHealthByPlayer
 * @property {object} lastShieldActiveAt
 * // ---- module dependencies ----
 * @property {object}   snapshotBuffer
 * @property {object}   hud
 * @property {Function} positionSpawn
 * @property {Function} OpPlayer
 * @property {Function} handleRemoteAttack
 * @property {Function} handleLocalAuthoritativeAttack
 * @property {object}   powerupTickSounds
 * // ---- callbacks for behaviors that remain in game.js ----
 * @property {Function} onInitializePlayers
 * @property {Function} onTrySendReadyAck
 * @property {Function} onTrackShieldEffects
 * @property {Function} onReconcileLocalMovement
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
    setLatestModeState,
    getLatestModeState,
    getLatestDeathDrops,
    setLatestDeathDrops,
    setLatestPlayerEffects,
    getLatestPlayerEffects,
    opponentPlayers,
    teamPlayers,
    pendingActionsQueue,
    powerupCollectQueue,
    deathdropCollectQueue,
    shieldImpactQueue,
    lastHealthByPlayer,
    lastShieldActiveAt,
    snapshotBuffer,
    hud,
    positionSpawn,
    OpPlayer,
    handleRemoteAttack,
    handleLocalAuthoritativeAttack,
    powerupTickSounds,
    onInitializePlayers,
    onTrySendReadyAck,
    onTrackShieldEffects,
    onReconcileLocalMovement,
    onStartSuddenDeathMusic,
    onStopSuddenDeathMusic,
    onPlayMatchEndSound,
    onShowGameOverScreen,
  } = config;
  const REMOTE_ATTACK_PRECISION_WINDOW_MS = 320;
  const START_WATCHDOG_TIMEOUT_MS = 15_000;

  let _startWatchdogTimer = null;
  let _startWatchdogDeadline = 0;
  let _forceLiveInputTimer = null;

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
          : 0;
      positionSpawn(
        getGameScene(),
        op.opponent,
        gameData.map,
        pd.team,
        idx,
        teamRoster.length,
      );
      if (
        pd.loaded === true &&
        Number.isFinite(pd.x) &&
        Number.isFinite(pd.y)
      ) {
        op.opponent.body?.reset?.(pd.x, pd.y);
      }
      op.finalizeSpawnPresentation?.();
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
      if (!shouldMuteClientDefaultLogs()) {
        console.log("[game] connect", joinPayload);
      } else {
        noteClientLifecycle(
          "join-emit",
          `matchId=${joinPayload?.matchId ?? "?"}`,
        );
      }
      try {
        setJoinInFlight(true);
        socket.emit("game:join", joinPayload, (ack) => {
          setJoinInFlight(false);
          if (!ack || ack.ok !== true) {
            if (!shouldMuteClientDefaultLogs()) {
              console.warn("[game] join ack failed", ack);
            } else {
              noteClientLifecycle(
                "join-ack-fail",
                `error=${String(ack?.error || "unknown")}`,
              );
            }
          } else {
            if (!shouldMuteClientDefaultLogs()) {
              console.log("[game] join ack ok", ack);
            } else {
              noteClientLifecycle("join-ack-ok", `matchId=${ack?.matchId ?? "?"}`);
            }
            setHasJoined(true);
          }
        });
      } catch (e) {
        if (!shouldMuteClientDefaultLogs()) {
          console.warn("[game] join emit error", e);
        } else {
          noteClientLifecycle(
            "join-emit-error",
            String(e?.message || e || ""),
          );
        }
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

  function _clearForceLiveInputTimer() {
    if (_forceLiveInputTimer) {
      clearTimeout(_forceLiveInputTimer);
      _forceLiveInputTimer = null;
    }
  }

  function _forceLiveClientState() {
    try {
      setIsLiveGame(true);
      setStartingPhase(false);
      hud.hideBattleStartOverlay();
      const scene = getGameScene();
      if (scene?.input) scene.input.enabled = true;
      if (scene?.input?.keyboard) scene.input.keyboard.enabled = true;
    } catch (_) {}
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
        _clearForceLiveInputTimer();
        return;
      }

      if (Date.now() >= _startWatchdogDeadline) {
        _stopStartWatchdog();
        _clearForceLiveInputTimer();
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
        const readyPayload = { matchId: joinMatchId };
        const localPlayer = getPlayer();
        if (localPlayer) {
          if (Number.isFinite(localPlayer.x)) readyPayload.x = localPlayer.x;
          if (Number.isFinite(localPlayer.y)) readyPayload.y = localPlayer.y;
          readyPayload.flip = !!localPlayer.flipX;
          readyPayload.animation =
            localPlayer.anims?.currentAnim?.key || null;
        }
        socket.emit("game:ready", readyPayload);
      } catch (_) {}
    }, 1000);
  }

  function _onGameInit(gameState) {
    const gameData = getGameData();
    const username = getUsername();
    configureClientNetTest({
      username,
      matchId: gameState?.matchId || getJoinPayload()?.matchId || "",
    });
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Game initialized:", {
        players: Array.isArray(gameState?.players) ? gameState.players.length : 0,
        status: gameState?.status,
      });
    } else {
      noteClientLifecycle(
        "init",
        `players=${Array.isArray(gameState?.players) ? gameState.players.length : 0} status=${String(gameState?.status || "")}`,
      );
    }

    setGameInitialized(true);
    setHasJoined(true);

    // Detect late-join into an already-running game
    try {
      const status = String(gameState?.status || "").toLowerCase();
      const live =
        status === "active" || status === "started" || status === "running";
      setIsLiveGame(live);
      if (!shouldMuteClientDefaultLogs()) {
        console.log(live, "is live");
      } else {
        noteClientLifecycle("live-state", `live=${live ? 1 : 0}`);
      }
      if (live) {
        _clearForceLiveInputTimer();
        _forceLiveClientState();
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
      gameData.players = mergedRoster;
      onInitializePlayers(mergedRoster);
      hud.initTeamStatusHud(mergedRoster);
    }

    _applyWorldState(gameState, gameData?.yourTeam);

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

    onTrySendReadyAck();
  }

  /** Server says the game has started — begin the pre-game countdown for normal joiners. */
  function _onGameStart(data) {
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Game starting:", data);
    } else {
      noteClientLifecycle(
        "start",
        `countdown=${Number(data?.countdown) || 0}`,
      );
    }
    _stopStartWatchdog();
    _clearForceLiveInputTimer();
    const seconds = Math.max(1, Number(data?.countdown) || 3);
    // Late joiners skip the countdown because the game is already running
    if (!getIsLiveGame()) {
      hud.startCountdown(seconds);
    }
    _forceLiveInputTimer = setTimeout(
      () => {
        _forceLiveInputTimer = null;
        _forceLiveClientState();
      },
      seconds * 1000 + 250,
    );
  }

  /** Server entered the starting window — show battle overlay and ack readiness. */
  function _onGameStarting(payload) {
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Game starting phase:", payload);
    } else {
      noteClientLifecycle("starting", `matchId=${payload?.matchId ?? "?"}`);
    }
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
      if (
        typeof prev === "number" &&
        payload.health < prev &&
        payload.username !== getUsername() &&
        payload.cause !== "poison"
      ) {
        const wrapper =
          opponentPlayers[payload.username] || teamPlayers[payload.username];
        if (wrapper?.opponent) {
          const scene = getGameScene();
          if (scene) spawnDamageImpact(scene, wrapper.opponent);
        }
      }
      // Flash shield-impact particle if health dropped while shield was active
      if (
        typeof prev === "number" &&
        payload.health < prev &&
        (((getLatestPlayerEffects()?.[payload.username]?.shield || 0) > 0 ||
          (getLatestPlayerEffects()?.[payload.username]?.respawnShield || 0) > 0) ||
          Date.now() - (lastShieldActiveAt[payload.username] || 0) <= 900)
      ) {
        shieldImpactQueue.push({ username: payload.username, at: Date.now() });
      }
    }
  }

  function _onPlayerDead(payload) {
    if (!payload?.username) return;
    hud.setTeamHudPlayerAlive(payload.username, false);
    if (Array.isArray(payload.drops) && payload.drops.length) {
      const known = Array.isArray(getLatestDeathDrops())
        ? getLatestDeathDrops()
        : [];
      const byId = new Map(known.map((drop) => [String(drop.id), drop]));
      for (const drop of payload.drops) {
        if (drop?.id == null) continue;
        byId.set(String(drop.id), drop);
      }
      setLatestDeathDrops(Array.from(byId.values()));
    }
    if (payload.username === getUsername()) return;
    const wrapper =
      opponentPlayers[payload.username] || teamPlayers[payload.username];
    wrapper?.startDeathPresentation?.(payload);
  }

  function _onPlayerRespawn(payload) {
    if (!payload?.username) return;
    hud.setTeamHudPlayerAlive(payload.username, true);
    if (payload.username === getUsername()) return;
    const wrapper =
      opponentPlayers[payload.username] || teamPlayers[payload.username];
    wrapper?.handleRespawn?.(payload);
  }

  function _onGameSnapshot(snapshot) {
    if (!snapshot || !snapshot.players) return;

    try {
      const gameData = getGameData();
      if (Array.isArray(gameData?.players)) {
        gameData.players = gameData.players.map((p) => {
          const live = snapshot.players?.[p.name];
          return live ? { ...p, ...live, name: p.name } : p;
        });
      }
    } catch (_) {}

    _applyWorldState(snapshot, getGameData()?.yourTeam);

    try {
      const localSnapshot = snapshot.players?.[getUsername()];
      if (localSnapshot && typeof onReconcileLocalMovement === "function") {
        onReconcileLocalMovement(localSnapshot);
      }
    } catch (_) {}

    hud.syncTeamHudFromSnapshot(snapshot.players);

    const ingest = snapshotBuffer.ingestSnapshot(snapshot, performance.now());
    if (ingest.activated) {
      if (!shouldMuteClientDefaultLogs()) {
        console.log("Started receiving server snapshots (tMono/tickId enabled)");
      } else {
        noteClientLifecycle("snapshots-live", "");
      }
      _stopStartWatchdog();
      _clearForceLiveInputTimer();
      _forceLiveClientState();
    }
    if (typeof ingest.calibrationLog === "number") {
      if (!shouldMuteClientDefaultLogs()) {
        console.log(
          "Monotonic offset calibrated (ms):",
          ingest.calibrationLog.toFixed(2),
        );
      } else {
        noteClientLifecycle(
          "mono-offset",
          `ms=${ingest.calibrationLog.toFixed(2)}`,
        );
      }
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

    noteClientSnapshot(snapshot, ingest);
    if (ingest.snapshotDiagLine && !shouldMuteClientDefaultLogs()) {
      console.log(ingest.snapshotDiagLine);
    }
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
      const isSelfPacket = playerName === getUsername();
      if (isSelfPacket && !action?.ownerEcho) return;
      noteClientRemoteAction(packet);
      const actionWithPacketMeta = {
        ...(action || {}),
        origin: packet?.origin || action?.origin || null,
        flip: typeof packet?.flip === "boolean" ? packet.flip : action?.flip,
      };

      const gameData = getGameData();
      const pd = (gameData.players || []).find((p) => p.name === playerName);
      const charKey = (character || (pd && pd.char_class) || "").toLowerCase();
      if (isSelfPacket) {
        const consumedLocal =
          typeof handleLocalAuthoritativeAttack === "function"
            ? handleLocalAuthoritativeAttack(scene, charKey, actionWithPacketMeta, {
                ownerSprite: getPlayer(),
                username: getUsername(),
                opponentPlayersRef: opponentPlayers,
                teamPlayersRef: teamPlayers,
              })
            : false;
        if (!consumedLocal && !shouldMuteClientDefaultLogs()) {
          console.debug("Unhandled local authoritative action", {
            playerName,
            charKey,
            action,
          });
        }
        return;
      }

      const wrapper = _ensureOpPlayer(playerName);
      if (!wrapper) return;

      // PHASE 2: Attack visual consistency fix
      // Always render attack from opponent's CURRENT INTERPOLATED SPRITE POSITION
      // (not from server-recorded origin). This prevents visual gaps/stuttering.
      // Server origin is used only for hit validation (separate concern).
      const act = { ...actionWithPacketMeta };

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
          if (!shouldMuteClientDefaultLogs()) {
            console.debug(
              `[Attack Visual Delta] ${playerName}: visual (${wrapper.opponent.x.toFixed(0)},${wrapper.opponent.y.toFixed(0)}) vs origin (${packet.origin.x.toFixed(0)},${packet.origin.y.toFixed(0)}) delta=(${originDeltaX.toFixed(0)},${originDeltaY.toFixed(0)})px`,
            );
          }
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
        if (!shouldMuteClientDefaultLogs()) {
          console.debug("Unhandled remote action", {
            playerName,
            charKey,
            action,
          });
        }
      }
    } catch (err) {
      if (!shouldMuteClientDefaultLogs()) {
        console.warn("Failed to handle remote game:action", err);
      } else {
        noteClientLifecycle(
          "action-rx-error",
          String(err?.message || err || ""),
        );
      }
    }
  }

  function _onGameError(error) {
    console.error("Game error:", error);
    _stopStartWatchdog();
    alert(`Game error: ${error.message}`);
  }

  function _onPlayerDisconnected(data) {
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Player disconnected:", data);
    } else {
      noteClientLifecycle("player-disconnected", `name=${data?.name ?? "?"}`);
    }
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
    _clearForceLiveInputTimer();
    setGameEnded(true);
    onStopSuddenDeathMusic();
    onPlayMatchEndSound(payload?.winnerTeam);
    try {
      hud.hideSpectatingBanner?.();
    } catch (_) {}
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

  function _applyWorldState(payload, yourTeam = getGameData()?.yourTeam) {
    if (!payload || typeof payload !== "object") return;
    if (Array.isArray(payload.powerups)) setLatestPowerups(payload.powerups);
    if (payload.modeState && typeof payload.modeState === "object") {
      setLatestModeState(payload.modeState);
      hud.syncModeState?.(payload.modeState, yourTeam);
    }
    if (Array.isArray(payload.deathDrops)) {
      setLatestDeathDrops(payload.deathDrops);
    }
    if (payload.playerEffects && typeof payload.playerEffects === "object") {
      setLatestPlayerEffects(payload.playerEffects);
      onTrackShieldEffects(payload.playerEffects);
    }
  }

  function _onGameState(payload) {
    _applyWorldState(payload, getGameData()?.yourTeam);
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

  function _onDeathDropCollected(payload) {
    if (!payload || typeof payload.id === "undefined") return;
    deathdropCollectQueue.push(payload);
    const known = Array.isArray(getLatestDeathDrops()) ? getLatestDeathDrops() : [];
    setLatestDeathDrops(
      known.filter((drop) => String(drop?.id) !== String(payload.id)),
    );
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
    socket.on("player:respawn", _onPlayerRespawn);
    socket.on("game:snapshot", _onGameSnapshot);
    socket.on("game:state", _onGameState);
    socket.on("game:action", _onGameAction);
    socket.on("game:error", _onGameError);
    socket.on("player:disconnected", _onPlayerDisconnected);
    socket.on("player:reconnected", _onPlayerReconnected);
    socket.on("game:over", _onGameOver);
    socket.on("game:timer", _onGameTimer);
    socket.on("game:sudden-death:start", _onGameSuddenDeath);
    socket.on("powerup:collected", _onPowerupCollected);
    socket.on("powerup:tick", _onPowerupTick);
    socket.on("deathdrop:collected", _onDeathDropCollected);

    // If already connected when register() is called, attempt join right away
    if (socket.connected) _tryJoin();

    // Safety net for rare cases where start events are missed after joining.
    _startStartWatchdog();
  }

  /** Remove all match socket listeners. Safe to call multiple times. */
  function dispose() {
    _stopStartWatchdog();
    _clearForceLiveInputTimer();
    socket.off("connect", _tryJoin);
    socket.off("reconnect", _tryJoin);
    socket.off("game:joined", _onGameJoined);
    socket.off("game:init", _onGameInit);
    socket.off("game:start", _onGameStart);
    socket.off("game:starting", _onGameStarting);
    socket.off("health-update", _onHealthUpdate);
    socket.off("player:dead", _onPlayerDead);
    socket.off("player:respawn", _onPlayerRespawn);
    socket.off("game:snapshot", _onGameSnapshot);
    socket.off("game:state", _onGameState);
    socket.off("game:action", _onGameAction);
    socket.off("game:error", _onGameError);
    socket.off("player:disconnected", _onPlayerDisconnected);
    socket.off("player:reconnected", _onPlayerReconnected);
    socket.off("game:over", _onGameOver);
    socket.off("game:timer", _onGameTimer);
    socket.off("game:sudden-death:start", _onGameSuddenDeath);
    socket.off("powerup:collected", _onPowerupCollected);
    socket.off("powerup:tick", _onPowerupTick);
    socket.off("deathdrop:collected", _onDeathDropCollected);
  }

  return { register, dispose };
}
