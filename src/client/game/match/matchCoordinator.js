import { isLiveRoomStatus } from "../../../shared/net/matchPresentation.js";
import { remoteActionPresentation } from "../characters/shared/remoteActionPresentation";
import { createPlayerLookup } from "../players/playerLookup";
import { returnFromMatch } from "../../navigation/lobbyReturn.js";
import { createRemotePlayer, placeRemoteAtSpawn, applyRemoteRosterState } from "../players/remotePlayerFactory";
import { buildJoinPayload } from "./joinPayload";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { supportsSuddenDeath } from '../../../shared/modeCapabilities';
import { COUNTDOWN_MS, START_WATCHDOG_TIMEOUT_MS, START_RECOVERY_GRACE_MS, START_INPUT_GRACE_MS, RESULTS_PRESENTATION_DELAY_MS } from '../../../shared/matchIntroTiming';
import { configureCharacterNetworks, resetCharacterNetworks, observeCharacterSnapshot, handleCharacterNetworkPacket } from '../characters/networkRegistry';
// match/matchCoordinator.js
//
// Owns all server socket event handlers for a live match session.
// Use createMatchCoordinator() to get an instance, then call register() once
// listeners should be active and dispose() to remove them on cleanup.
//
// The coordinator uses the page-scoped server clock and character network
// registry. The battle page supplies access to its scene, HUD, and local state.
import { performGameErrorAction, resolveGameErrorAction } from "./gameErrorActions";
import { spawnDeathTombstone } from "../scene/deathTombstone";
import { spawnShockwaveHitSmoke } from "../powerups/shockwaveHit";
import { applyActionToLocalPlayer, getCharacterSocketEvents, playCharacterSound } from "../characters";
import { playPlayerSound } from "../audio/playerAudio";
import { takePredictedHit } from "../characters/shared/shotPrediction";
import { playHitFeedback, hitstopForDelivery } from "../characters/shared/hitFeedback";
import { presentRemoteAction } from "../characters/shared/animationState.js";
import {
  configureClientNetTest,
  logLifecycle,
  noteClientRemoteAction,
  noteClientSnapshot,
  shouldMuteClientDefaultLogs,
} from "../../lib/netTestLogger.js";
import { mergeInitialRosterPlayer } from "./playerRosterMerge.js";
import { noteDecodedSnapshot, noteRemoteActionOrigin } from "./netTrace";
import { createSnapshotDecoder } from "../../../shared/snapshotDelta";
import {
  observeServerClockSnapshot,
  resyncServerClock,
  startServerClockSync,
  stopServerClockSync,
} from "./serverClock.js";

const ROSTER_OWNED_FIELDS = new Set([
  "name", "team", "char_class", "selected_title_id", "selected_skin_id",
  "selected_skin_asset_url", "selected_skin_game_assets",
]);

/**
 * @typedef {object} MatchCoordinatorConfig
 * @property {import('socket.io-client').Socket} socket
 * @property {number|string} matchId
 * @property {() => object}        getGameData
 * @property {() => string}        getUsername
 * @property {() => object}        getJoinPayload
 * @property {() => object|null}   getGameScene
 * @property {() => object|null}   getPlayer
 * @property {(session: {level: number, stats: object}) => void} [setLocalSession]
 * @property {object} [poisonState]
 * @property {(name: string) => void} [noteLocalKiller]
 * @property {object} [playerLookup]
 * @property {() => boolean} [isPresentationSuppressed]
 * @property {Function} [getLocalFighterEvents]
 * @property {Function} [onCharacterNetworksConfigured]
 * @property {(ammoState: object) => void} [onAuthoritativeAmmo]
 * @property {(untilMs: number) => void} setExternalControlLockUntil
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
 * @property {() => boolean}       isClientReady  loading screen lifted and scene built
 * @property {(v: any) => void}    setPendingAuthoritativeLocalState
 * // ---- spawn state ----
 * @property {() => number}        getSpawnVersion
 * @property {(v: number) => void} setSpawnVersion
 * @property {object}              serverSpawnIndex
 * @property {(spawns: Record<string, {x: number, y: number}>) => void} onServerSpawns
 * @property {(payload: {kickoff?: boolean}) => void} [onLocalSpawnReset]
 * @property {(username: string) => void} [onFighterDeath]
 * // ---- live state (set via setter, read externally via closure var) ----
 * @property {(v: Array) => void}  setLatestPowerups
 * @property {(v: object|null) => void} setLatestModeState
 * @property {() => object|null}   getLatestModeState
 * @property {() => Array}         getLatestDeathDrops
 * @property {(v: Array) => void}  setLatestDeathDrops
 * @property {(v: object) => void} setLatestPlayerEffects
 * @property {(v: object) => void} [setLatestEffectMovement]
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
 * @property {Function} RemotePlayer
 * @property {Function} handleRemoteAttack
 * @property {Function} handleLocalAuthoritativeAttack
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
    poisonState = {},
    noteLocalKiller,
    getPlayer,
    setLocalSession,
    setExternalControlLockUntil,
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
    isClientReady,
    setPendingAuthoritativeLocalState,
    getSpawnVersion,
    setSpawnVersion,
    serverSpawnIndex,
    onServerSpawns,
    setLatestPowerups,
    setLatestModeState,
    getLatestModeState,
    getLatestDeathDrops,
    setLatestDeathDrops,
    setLatestPlayerEffects,
    setLatestEffectMovement,
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
    RemotePlayer,
    handleRemoteAttack,
    handleLocalAuthoritativeAttack,
    powerupTickSounds,
    onInitializePlayers,
    onTrySendReadyAck,
    onTrackShieldEffects,
    onStartSuddenDeathMusic,
    onStopSuddenDeathMusic,
    onPlayMatchEndSound,
    onShowGameOverScreen,
  } = config;
  const playerLookup = config.playerLookup || createPlayerLookup({
    getUsername,
    getLocalPlayer: getPlayer,
    getOpponentPlayers: () => opponentPlayers,
    getTeamPlayers: () => teamPlayers,
  });
  const presentationSuppressed = () =>
    typeof config.isPresentationSuppressed === "function"
      ? config.isPresentationSuppressed()
      : typeof document !== "undefined" && document.hidden;
  const REMOTE_ATTACK_PRECISION_WINDOW_MS = 320;

  // Snapshots arrive as deltas; everything below sees rebuilt full states.
  const snapshotDecoder = createSnapshotDecoder();
  // Newest snapshot received; death and respawn events carry it (remoteLifeState).
  let lastSnapshotMark = null;
  let _startWatchdogTimer = null;
  let _startWatchdogDeadline = 0;
  let _forceLiveInputTimer = null;
  let _startWatchdogRecoveryInFlight = false;
  let _joinedSocketId = null;
  const lastHealthSoundAt = new Map();

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the existing RemotePlayer wrapper for name, or creates and registers
   * one if it is missing. Used as a lazy-create guard in both snapshot and
   * action handlers. Returns null when the player is the local user or has no
   * known roster entry.
   */
  function _ensureRemotePlayer(name) {
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

    const op = createRemotePlayer(scene, {
      Player: RemotePlayer, roster: pd, gameData, spawnVersion: getSpawnVersion(),
      getPlayerEffects: name => getLatestPlayerEffects()?.[name],
    });
    placeRemoteAtSpawn(scene, op, pd, {
      positionSpawn, mapId: gameData.map, spawnIndex: serverSpawnIndex[pd.name],
    });
    applyRemoteRosterState(op, pd);
    container[pd.name] = op;
    return op;
  }

  function _markJoinStale(reason = "unknown") {
    if (_joinedSocketId == null && !getHasJoined() && !getJoinInFlight())
      return;
    logLifecycle("join-stale", `reason=${reason} joined=${_joinedSocketId || "none"} current=${socket.id || "none"}`, "warn", "[game] join state reset", {
        reason,
        joinedSocketId: _joinedSocketId,
        currentSocketId: socket.id || null,
      });
    _joinedSocketId = null;
    snapshotBuffer.reset();
    snapshotDecoder.reset();
    setHasJoined(false);
    setJoinInFlight(false);
  }

  // ---------------------------------------------------------------------------
  // Socket event handlers (named functions so dispose() can target them exactly)
  // ---------------------------------------------------------------------------

  /** Re-emit game:join when a socket connection is established or restored. */
  function _tryJoin() {
    const joinPayload = buildJoinPayload(getJoinPayload());
    const currentSocketId = socket.id || null;
    if (
      currentSocketId &&
      _joinedSocketId &&
      currentSocketId !== _joinedSocketId
    ) {
      _markJoinStale("socket_id_changed");
    }
    if (
      joinPayload &&
      Number(joinPayload.matchId) > 0 &&
      !getJoinInFlight() &&
      (!getHasJoined() ||
        !getGameInitialized() ||
        !currentSocketId ||
        currentSocketId !== _joinedSocketId)
    ) {
      logLifecycle("join-emit", `matchId=${joinPayload?.matchId ?? "?"}`, "log", "[game] connect", {
          ...joinPayload,
          socketId: currentSocketId,
          joinedSocketId: _joinedSocketId,
          gameInitialized: getGameInitialized(),
          hasJoined: getHasJoined(),
        });
      try {
        setJoinInFlight(true);
        socket.emit(SOCKET_EVENTS.GAME_JOIN, joinPayload, (ack) => {
          setJoinInFlight(false);
          if (!ack || ack.ok !== true) {
            logLifecycle("join-ack-fail", `error=${String(ack?.error || "unknown")}`, "warn", "[game] join ack failed", ack);
          } else {
            logLifecycle("join-ack-ok", `matchId=${ack?.matchId ?? "?"}`, "log", "[game] join ack ok", ack);
            _joinedSocketId = socket.id || currentSocketId;
            setHasJoined(true);
          }
        });
      } catch (e) {
        setJoinInFlight(false);
        logLifecycle("join-emit-error", String(e?.message || e || ""), "warn", "[game] join emit error", e);
      }
    }
  }

  function _onGameJoined() {
    _joinedSocketId = socket.id || _joinedSocketId;
    setHasJoined(true);
  }

  function _onSocketDisconnect(reason) {
    resetCharacterNetworks();
    logLifecycle("disconnect", `reason=${String(reason || "unknown")}`, "warn", "[game] socket disconnected", {
        reason,
        socketId: _joinedSocketId || socket.id || null,
        active: socket.active,
      });
    if (!getGameEnded()) {
      _markJoinStale(`disconnect:${String(reason || "unknown")}`);
    }
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
      hud.hideTopHudFade?.();
      if (!hud.isCountdownRunning?.()) hud.hideBattleStartOverlay();
    } catch (_) {}
  }

  function _emitJoinAck(joinPayload, timeoutMs = 2500) {
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        setJoinInFlight(false);
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        cleanup({ ok: false, error: "timeout" });
      }, timeoutMs);

      try {
        setJoinInFlight(true);
        socket.emit(SOCKET_EVENTS.GAME_JOIN, joinPayload, (ack) => {
          cleanup(ack || { ok: false, error: "no_ack" });
        });
      } catch (error) {
        cleanup({
          ok: false,
          error: error?.message || "emit_failed",
        });
      }
    });
  }

  async function _recoverTimedOutStart(joinPayload) {
    if (_startWatchdogRecoveryInFlight) return false;
    _startWatchdogRecoveryInFlight = true;
    try {
      logLifecycle("watchdog-expired", `matchId=${joinPayload?.matchId ?? "?"}`, "warn", "[game] start watchdog expired, attempting recovery", {
          matchId: joinPayload?.matchId ?? null,
          hasJoined: getHasJoined(),
        });

      const ack = await _emitJoinAck(joinPayload);
      if (ack?.ok === true) {
        setHasJoined(true);
        _startWatchdogDeadline = Date.now() + START_WATCHDOG_TIMEOUT_MS;
        hud.showSystemNotice?.({
          title: "Syncing Match",
          message: "Recovered your game connection. Resuming the match...",
          buttonText: "OK",
          autoCloseMs: 1600,
          tone: "info",
        });
        return true;
      }

      logLifecycle("watchdog-recovery-fail", `error=${String(ack?.error || "unknown")}`, "warn", "[game] start watchdog recovery failed", ack);
      return false;
    } finally {
      _startWatchdogRecoveryInFlight = false;
    }
  }

  function _startStartWatchdog() {
    if (getIsLiveGame() || getGameEnded()) return;
    if (_startWatchdogTimer) return;

    const joinPayload = buildJoinPayload(getJoinPayload());
    const joinMatchId = Number(joinPayload?.matchId);
    if (!Number.isFinite(joinMatchId) || joinMatchId <= 0) return;

    _startWatchdogDeadline = Date.now() + START_WATCHDOG_TIMEOUT_MS;
    _startWatchdogTimer = setInterval(() => {
      if (getGameEnded() || getIsLiveGame()) {
        _stopStartWatchdog();
        _clearForceLiveInputTimer();
        return;
      }

      // Slow loads are not missed starts: the timeout counts from our own
      // loading screen lifting, and the server waits for us until then.
      if (!isClientReady()) {
        _startWatchdogDeadline = Math.max(
          _startWatchdogDeadline,
          Date.now() + START_WATCHDOG_TIMEOUT_MS,
        );
      }

      if (Date.now() >= _startWatchdogDeadline) {
        _stopStartWatchdog();
        _clearForceLiveInputTimer();
        Promise.resolve().then(async () => {
          const recovered = await _recoverTimedOutStart(joinPayload);
          if (recovered) {
            _startStartWatchdog();
            return;
          }
          hud.showSystemNotice?.({
            title: "Match Connection Failed",
            message:
              "We couldn't recover this match connection. Returning to the lobby.",
            buttonText: "Lobby",
            tone: "error",
            autoCloseMs: 2200,
            confirmOnAutoClose: true,
            onConfirm: () => {
              _returnToLobby();
            },
          });
        });
        return;
      }

      try {
        if (!getHasJoined() && !getJoinInFlight()) {
          logLifecycle("watchdog-join", `matchId=${joinPayload?.matchId ?? "?"}`, "log", "[game] watchdog re-emitting join", joinPayload);
          socket.emit(SOCKET_EVENTS.GAME_JOIN, joinPayload);
        }
      } catch (_) {}
      // Re-send readiness in case it was lost; only once we really are ready.
      onTrySendReadyAck(true);
    }, 1000);
  }

  function _onGameInit(gameState) {
    configureCharacterNetworks(gameState);
    config.onCharacterNetworksConfigured?.();
    // The room's snapshot rate; older servers omit it (the build default).
    snapshotBuffer.setSnapshotIntervalMs?.(gameState?.snapshotIntervalMs);
    const gameData = getGameData();
    const username = getUsername();
    configureClientNetTest({
      username,
      matchId: gameState?.matchId || getJoinPayload()?.matchId || "",
    });
    logLifecycle("init", `players=${Array.isArray(gameState?.players) ? gameState.players.length : 0} status=${String(gameState?.status || "")}`, "log", "Game initialized:", {
        players: Array.isArray(gameState?.players)
          ? gameState.players.length
          : 0,
        status: gameState?.status,
      });

    setGameInitialized(true);
    _joinedSocketId = socket.id || _joinedSocketId;
    setHasJoined(true);

    // Detect late-join into an already-running game. A join during the
    // pre-fight countdown resumes the countdown instead.
    let resumeCountdownMs = 0;
    try {
      const status = String(gameState?.status || "").toLowerCase();
      const active =
        isLiveRoomStatus(status);
      resumeCountdownMs = active ? Math.max(0, Number(gameState?.countdownRemainingMs) || 0) : 0;
      const live = active && resumeCountdownMs <= 0;
      setIsLiveGame(live);
      if (live) {
        _clearForceLiveInputTimer();
        _forceLiveClientState();
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
        return mergeInitialRosterPlayer(p, live);
      });
      gameData.players = mergedRoster;
      onInitializePlayers(mergedRoster);
      hud.initTeamStatusHud(mergedRoster);
    }

    _applyWorldState(gameState, gameData?.yourTeam);

    // Sprites that already exist stand on the server's spawns (pre-fight only).
    if (Array.isArray(gameState?.players)) {
      onServerSpawns?.(Object.fromEntries(gameState.players
        .filter((p) => p?.name && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => [p.name, { x: p.x, y: p.y }])));
    }

    // Stash local player's live stats so character modules and spawn logic can use them
    try {
      const me = (gameState.players || []).find((p) => p.name === username);
      if (me) {
        setLocalSession?.({ level: me.level || 1, stats: me.stats || {} });
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
    if (resumeCountdownMs > 0) {
      _onGameStart({ countdownMs: resumeCountdownMs, elapsedMs: COUNTDOWN_MS - resumeCountdownMs });
    }
  }

  /** Server started the pre-fight countdown: cards, 3..1, FIGHT. */
  function _onGameStart(data) {
    const countdownMs = Math.max(0, Number(data?.countdownMs) || COUNTDOWN_MS);
    logLifecycle("start", `countdownMs=${countdownMs}`, "log", "Game starting:", data);
    _clearForceLiveInputTimer();
    // Keep the watchdog alive through the countdown until we receive
    // actual live evidence (snapshot/timer/world-state). This avoids a
    // permanent client-side stall if `game:start` arrives but the first
    // live packets are missed.
    _startWatchdogDeadline =
      Date.now() + Math.max(START_WATCHDOG_TIMEOUT_MS, countdownMs + START_RECOVERY_GRACE_MS);
    _startStartWatchdog();
    // Spawns are re-established when the countdown starts; stand everyone on
    // them so the first live packet matches the server.
    onServerSpawns?.(data?.spawns);
    // Late joiners skip the countdown because the game is already running
    if (!getIsLiveGame()) {
      for (const name of Object.keys(data?.spawns || {})) {
        const wrapper = playerLookup.wrapper(name);
        wrapper?.setPresenceState?.(true, true);
      }
      // A resumed countdown counts down the full scale from where it is.
      const elapsedMs = Math.max(0, Number(data?.elapsedMs) || 0);
      hud.startCountdown((countdownMs + elapsedMs) / 1000, { elapsedMs });
    }
    _forceLiveInputTimer = setTimeout(
      () => {
        _forceLiveInputTimer = null;
        _forceLiveClientState();
      },
      countdownMs + START_INPUT_GRACE_MS,
    );
  }

  function fighterEvents(payload) {
    return payload?.username === getUsername()
      ? config.getLocalFighterEvents?.()
      : playerLookup.wrapper(payload?.username);
  }

  function _onHealthUpdate(payload) {
    if (!payload?.username) return;
    fighterEvents(payload)?.applyHealthUpdate?.(payload);
    if (typeof payload.health === "number") {
      hud.setTeamHudPlayerHealth?.(
        payload.username,
        payload.health,
        payload.maxHealth,
      );
      const prev = lastHealthByPlayer[payload.username];
      lastHealthByPlayer[payload.username] = payload.health;
      // Use the same match-level audio path as health power-up ticks. This
      // remains reliable when the local player has already synced its health.
      if (payload.username === getUsername() && payload.health > 0 &&
          (payload.cause === "heal" || (payload.cause !== "respawn" &&
            typeof prev === "number" && payload.health > prev))) {
        _onPowerupTick({ type: "health", username: payload.username });
      }
      if (
        !presentationSuppressed() &&
        typeof prev === "number" &&
        payload.health < prev &&
        payload.username !== getUsername() &&
        payload.cause !== "poison"
      ) {
        const wrapper =
          playerLookup.wrapper(payload.username);
        if (wrapper?.opponent) {
          const scene = getGameScene();
          // The attacker already played this at its predicted contact.
          if (scene && !takePredictedHit(payload.username, "feedback")) {
            playHitFeedback(scene, wrapper.opponent, {
              hitstopMs: payload.cause === "combat" ? hitstopForDelivery(payload.delivery) : 0,
              duckBlocked: payload.duckBlocked === true || wrapper.opponent._ducking === true,
            });
          }
        }
      }
      // Flash shield-impact particle if health dropped while shield was active
      if (
        typeof prev === "number" &&
        payload.health < prev &&
        ((getLatestPlayerEffects()?.[payload.username]?.shield || 0) > 0 ||
          (getLatestPlayerEffects()?.[payload.username]?.respawnShield || 0) >
            0 ||
          Date.now() - (lastShieldActiveAt[payload.username] || 0) <= 900)
      ) {
        shieldImpactQueue.push({ username: payload.username, at: Date.now() });
      }
    }
  }

  function _onPlayerDead(payload) {
    if (!payload?.username) return;
    config.onFighterDeath?.(payload.username);
    const dyingPlayer = payload.username === getUsername()
      ? getPlayer()
      : playerLookup.sprite(payload.username);
    if (!presentationSuppressed()) {
      const scene = getGameScene();
      spawnDeathTombstone(scene, payload, dyingPlayer);
      scene?._modeRuntime?.onPlayerDeath?.(payload);
    }
    hud.setTeamHudPlayerAlive(payload.username, false);
    if (payload.username === getUsername() && !getGameEnded()) {
      noteLocalKiller?.(payload.killedBy);
      hud.showLocalDeath?.(payload);
    }
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
    if (payload.username === getUsername() || presentationSuppressed()) return;
    const wrapper =
      playerLookup.wrapper(payload.username);
    wrapper?.startDeathPresentation?.({ ...payload, afterSnapshot: lastSnapshotMark });
  }

  function _onPlayerRespawn(payload) {
    if (!payload?.username) return;
    hud.setTeamHudPlayerAlive(payload.username, true);
    if ((payload.spawnReset || payload.kickoff) && payload.username === getUsername()) {
      config.onLocalSpawnReset?.(payload);
    }
    if (payload.username === getUsername() || presentationSuppressed()) return;
    const wrapper =
      playerLookup.wrapper(payload.username);
    wrapper?.handleRespawn?.({ ...payload, afterSnapshot: lastSnapshotMark });
  }

  function _onGameSnapshot(packet) {
    // Null until a keyframe arrives after joining or a missed packet.
    const snapshot = snapshotDecoder.decode(packet);
    if (!snapshot || !snapshot.players) return;
    if (Number.isFinite(snapshot.snapshotSeq)) {
      lastSnapshotMark = { epoch: snapshot.snapshotEpoch ?? null, seq: snapshot.snapshotSeq };
    }
    const receivedAt = performance.now();
    const ingest = snapshotBuffer.ingestSnapshot(snapshot, receivedAt);
    if (ingest.accepted === false) return;
    noteDecodedSnapshot(snapshot, receivedAt);
    observeServerClockSnapshot(snapshot, receivedAt, getUsername());
    observeCharacterSnapshot(snapshot);

    try {
      // Update roster entries in place: rebuilding every player object at 30 Hz
      // only produced garbage. Identity/cosmetic fields stay roster-owned.
      const gameData = getGameData();
      if (Array.isArray(gameData?.players)) {
        for (const p of gameData.players) {
          const live = snapshot.players?.[p?.name];
          if (!live) continue;
          for (const key in live) {
            if (!ROSTER_OWNED_FIELDS.has(key)) p[key] = live[key];
          }
        }
      }
    } catch (_) {}

    _applyWorldState(snapshot, getGameData()?.yourTeam);

    hud.syncTeamHudFromSnapshot(snapshot.players);

    if (ingest.activated) {
      logLifecycle("snapshots-live", "", "log", "Started receiving server snapshots (tMono/tickId enabled)");
      _stopStartWatchdog();
      _clearForceLiveInputTimer();
      _forceLiveClientState();
    }
    if (typeof ingest.calibrationLog === "number") {
      logLifecycle("mono-offset", `ms=${ingest.calibrationLog.toFixed(2)}`, "log", "Monotonic offset calibrated (ms):", ingest.calibrationLog.toFixed(2));
    }

    // Late-join safety: lazily create RemotePlayers for any player in this snapshot
    try {
      const scene = getGameScene();
      if (scene) {
        for (const name of Object.keys(snapshot.players)) {
          _ensureRemotePlayer(name);
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
      // Socket.IO may deliver a burst after the browser has throttled a hidden
      // tab. These packets describe past presentation; snapshots remain the
      // source of truth for the current state.
      if (presentationSuppressed()) return;

      const scene = getGameScene();
      if (!scene || !scene.sys || !scene.sys.isActive) {
        pendingActionsQueue.push(packet);
        return;
      }

      const { playerName, character, action } = packet;
      if (!playerName || !action) return;
      noteClientRemoteAction(packet);
      if (handleCharacterNetworkPacket(scene, packet, {
        localPlayer: getPlayer(), localUsername: getUsername(),
        opponentPlayersRef: opponentPlayers, teamPlayersRef: teamPlayers,
        onAmmo: config.onAuthoritativeAmmo,
      })) return;
      const isSelfPacket = playerName === getUsername();
      if (isSelfPacket && !action?.ownerEcho) return;
      const actionType = String(action?.type || "").toLowerCase();
      const gameData = getGameData();
      const pd = (gameData.players || []).find((p) => p.name === playerName);
      const charKey = (character || (pd && pd.char_class) || "").toLowerCase();

      if (actionType === "character-hit-confirm") {
        const targetName = String(action?.target || "").trim();
        const targetSprite =
          targetName === getUsername()
            ? getPlayer()
            : playerLookup.sprite(targetName) ||
              null;
        const soundSource = targetSprite ||
          (isSelfPacket ? getPlayer() : playerLookup.sprite(playerName));
        // The attacker's own predicted hit already played its sound.
        const predicted = isSelfPacket && takePredictedHit(targetName, "confirm");
        if (soundSource && !predicted) playCharacterSound(scene, charKey, "hit", {}, soundSource);
        if (typeof handleRemoteAttack === "function") {
          handleRemoteAttack(scene, charKey, action, null, {
            targetSprite,
            targetUsername: targetName,
          });
        }
        // Health updates emit the damage number once for every observer.
        // Hit confirmations still drive attack sounds and impact effects.
        return;
      }

      const actionWithPacketMeta = {
        ...(action || {}),
        origin: packet?.origin || action?.origin || null,
        flip: typeof packet?.flip === "boolean" ? packet.flip : action?.flip,
      };
      applyActionToLocalPlayer(actionWithPacketMeta, {
        scene: getGameScene(),
        localPlayer: getPlayer(),
        username: String(getUsername() || ""),
        findSprite: _findPlayerSprite,
        setExternalControlLockUntil,
      });
      if (isSelfPacket) {
        const consumedLocal =
          typeof handleLocalAuthoritativeAttack === "function"
            ? handleLocalAuthoritativeAttack(
                scene,
                charKey,
                actionWithPacketMeta,
                {
                  ownerSprite: getPlayer(),
                  username: getUsername(),
                  opponentPlayersRef: opponentPlayers,
                  teamPlayersRef: teamPlayers,
                },
              )
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

      const wrapper = _ensureRemotePlayer(playerName);
      if (!wrapper) return;

      // Align remote attack presentation with the displayed attacker.
      const act = remoteActionPresentation(actionWithPacketMeta, wrapper.opponent);
      noteRemoteActionOrigin(actionWithPacketMeta, act, wrapper.opponent);

      // The handler's animation holds snapshot animation off the sprite.
      const consumed = presentRemoteAction({ scene, wrapper, character: charKey, actionType: act.type },
        () => handleRemoteAttack(scene, charKey, act, wrapper, {
          opponentPlayersRef: opponentPlayers,
          teamPlayersRef: teamPlayers,
          localPlayer: getPlayer(),
          localUsername: getUsername(),
          attackerUsername: playerName,
          attackerTeam: pd?.team || "",
          players: gameData.players || [],
        }));
      // Open a precision window so interpolation blends toward hit position.
      if (consumed && wrapper) {
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
      logLifecycle("action-rx-error", String(err?.message || err || ""), "warn", "Failed to handle remote game:action", err);
    }
  }

  function _returnToLobby() {
    return returnFromMatch({ gameData: getGameData(), username: getUsername() });
  }

  function _onGameError(error) {
    logLifecycle("game-error", String(error?.code || error?.message || ""), "error", "Game error:", error);
    _stopStartWatchdog();
    const { action, buttonText } = resolveGameErrorAction(error, {
      editorPlaytest:
        !!getGameData()?.editorPlaytest ||
        window.location.pathname === "/map-editor/playtest",
    });
    hud.showSystemNotice?.({
      title: "Game Error",
      message: String(error?.message || "Something went wrong in this match."),
      buttonText,
      tone: "error",
      onConfirm: () => performGameErrorAction(action, _returnToLobby),
    });
  }

  function _onPlayerDisconnected(data) {
    logLifecycle("player-disconnected", `name=${data?.name ?? "?"}`, "log", "Player disconnected:", data);
    if (data?.name) {
      const wrapper = playerLookup.wrapper(data.name);
      const shouldStayLoaded =
        data.loaded === true || wrapper?.presenceLoaded === true;
      hud.setTeamHudPlayerPresence(data.name, false);
      hud.setTeamHudPlayerLoaded(data.name, shouldStayLoaded);
      wrapper?.setPresenceState?.(false, shouldStayLoaded);
    }
  }

  function _onPlayerReconnected(data) {
    if (data?.name) {
      const wrapper = playerLookup.wrapper(data.name);
      const shouldShowLoaded =
        data.loaded === true || wrapper?.presenceLoaded === true;
      hud.setTeamHudPlayerPresence(data.name, true);
      hud.setTeamHudPlayerLoaded(data.name, shouldShowLoaded);
      wrapper?.setPresenceState?.(true, shouldShowLoaded);
    }
  }

  // Another fighter finished loading during the pregame (no snapshots yet).
  function _onPlayerLoaded(data) {
    if (!data?.name) return;
    const rosterEntry = (getGameData()?.players || []).find((p) => p.name === data.name);
    if (rosterEntry) rosterEntry.loaded = true;
    const wrapper = playerLookup.wrapper(data.name) || _ensureRemotePlayer(data.name);
    hud.setTeamHudPlayerPresence(data.name, true);
    hud.setTeamHudPlayerLoaded(data.name, true);
    // Stand them on the spawn the server holds for them.
    onServerSpawns?.({ [data.name]: { x: data.x, y: data.y } });
    wrapper?.setPresenceState?.(true, true);
  }

  function _onGameOver(payload) {
    resetCharacterNetworks();
    if (getGameEnded()) return; // idempotent guard
    _stopStartWatchdog();
    _clearForceLiveInputTimer();
    setGameEnded(true);
    onStopSuddenDeathMusic();
    onPlayMatchEndSound(payload?.winnerTeam);
    try {
      hud.hideLocalDeath?.();
      hud.hideSpectatingPlayer?.();
      for (const wrapper of [
        ...Object.values(opponentPlayers),
        ...Object.values(teamPlayers),
      ]) {
        wrapper?.setSpectated?.(false);
      }
    } catch (_) {}
    try {
      const p = getPlayer();
      if (p) p._matchEnded = true;
      if (p?.body) {
        p.setVelocity?.(0, 0);
        p.body.enable = false;
      }
    } catch (_) {}
    setTimeout(() => onShowGameOverScreen(payload), RESULTS_PRESENTATION_DELAY_MS);
  }

  function _onGameTimer(payload) {
    if (getGameEnded()) return;
    _stopStartWatchdog();
    hud.updateTimerHud(payload.remaining, payload.suddenDeath);
    if (!getIsLiveGame()) {
      _clearForceLiveInputTimer();
      _forceLiveClientState();
    }
    if (!supportsSuddenDeath(getLatestModeState?.()?.type || getGameData()?.modeId)) return;
    if (payload.suddenDeath && typeof payload.poisonY === "number") {
      poisonState.targetY = payload.poisonY;
      onStartSuddenDeathMusic();
    } else {
      poisonState.targetY = null;
      poisonState.smoothY = null;
    }
  }

  function _onGameSuddenDeath(payload) {
    if (!supportsSuddenDeath(getLatestModeState?.()?.type || getGameData()?.modeId)) return;
    hud.showSuddenDeathBanner();
    onStartSuddenDeathMusic();
    if (typeof payload?.poisonY === "number") {
      poisonState.targetY = payload.poisonY;
    }
  }

  function _onPowerupCollected(payload) {
    if (!payload || typeof payload.id === "undefined") return;
    if (presentationSuppressed()) return;
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
      setLatestEffectMovement?.(payload.playerEffectMovement || {});
      onTrackShieldEffects(payload.playerEffects);
    }
  }

  function _onGameState(payload) {
    _stopStartWatchdog();
    _applyWorldState(payload, getGameData()?.yourTeam);
    if (!getIsLiveGame()) {
      _clearForceLiveInputTimer();
      _forceLiveClientState();
    }
  }

  function _onPowerupTick(payload) {
    if (!payload || !payload.type) return;
    if (presentationSuppressed()) return;
    const scene = getGameScene();
    if (!scene?.sound) return;
    const entry = powerupTickSounds[payload.type];
    if (!entry) return;
    const now = Date.now();
    if (payload.type === "health" &&
        now - (lastHealthSoundAt.get(payload.username) ?? -Infinity) < 120) return;
    try {
      const source = payload.username === getUsername()
        ? getPlayer()
        : playerLookup.sprite(payload.username);
      if (!source) return;
      playPlayerSound(scene, source, entry.key, entry.options || {});
      // A power-up heal also sends health-update; play that pair only once.
      if (payload.type === "health") lastHealthSoundAt.set(payload.username, now);
    } catch (_) {}
  }

  function _onShockwaveHit(payload) {
    if (!payload?.username || presentationSuppressed()) return;
    const sprite = payload.username === getUsername()
      ? getPlayer()
      : playerLookup.sprite(payload.username);
    spawnShockwaveHitSmoke(getGameScene(), sprite, payload);
  }

  function _onDeathDropCollected(payload) {
    if (!payload || typeof payload.id === "undefined") return;
    if (!presentationSuppressed()) deathdropCollectQueue.push(payload);
    const known = Array.isArray(getLatestDeathDrops())
      ? getLatestDeathDrops()
      : [];
    setLatestDeathDrops(
      known.filter((drop) => String(drop?.id) !== String(payload.id)),
    );
  }

  const _findPlayerSprite = playerLookup.sprite;

  // Character-owned socket events (see CharacterEntityBase.socketEvents).
  const characterSocketHandlers = getCharacterSocketEvents().map(([event, handler]) => [
    event,
    (payload) => {
      const scene = getGameScene();
      if (!scene || !payload || presentationSuppressed()) return;
      handler({ scene, findSprite: _findPlayerSprite }, payload);
    },
  ]);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Attach all match socket listeners. Call once after game data is fetched. */
  function onPresenceProbe(data, ack) {
    const matchId = Number(getJoinPayload()?.matchId);
    if (typeof ack === "function" && Number(data?.matchId) === Number(matchId)) ack({ matchId: Number(matchId) });
  }

  const listeners = [
    [SOCKET_EVENTS.GAME_PRESENCE_PROBE, onPresenceProbe],
    [SOCKET_EVENTS.CONNECT, _tryJoin],
    [SOCKET_EVENTS.CONNECT, resyncServerClock],
    [SOCKET_EVENTS.DISCONNECT, _onSocketDisconnect],
    [SOCKET_EVENTS.GAME_JOINED, _onGameJoined],
    [SOCKET_EVENTS.GAME_INIT, _onGameInit],
    [SOCKET_EVENTS.GAME_START, _onGameStart],
    [SOCKET_EVENTS.HEALTH_UPDATE, _onHealthUpdate],
    [SOCKET_EVENTS.SUPER_UPDATE, payload => fighterEvents(payload)?.applySuperUpdate?.(payload)],
    [SOCKET_EVENTS.PLAYER_SPECIAL, payload => fighterEvents(payload)?.presentSpecial?.(payload)],
    [SOCKET_EVENTS.PLAYER_DEAD, _onPlayerDead],
    [SOCKET_EVENTS.PLAYER_RESPAWN, _onPlayerRespawn],
    [SOCKET_EVENTS.GAME_SNAPSHOT, _onGameSnapshot],
    [SOCKET_EVENTS.GAME_STATE, _onGameState],
    [SOCKET_EVENTS.GAME_ACTION, _onGameAction],
    [SOCKET_EVENTS.GAME_ERROR, _onGameError],
    [SOCKET_EVENTS.PLAYER_DISCONNECTED, _onPlayerDisconnected],
    [SOCKET_EVENTS.PLAYER_RECONNECTED, _onPlayerReconnected],
    [SOCKET_EVENTS.PLAYER_LOADED, _onPlayerLoaded],
    [SOCKET_EVENTS.GAME_OVER, _onGameOver],
    [SOCKET_EVENTS.GAME_TIMER, _onGameTimer],
    [SOCKET_EVENTS.GAME_SUDDEN_DEATH_START, _onGameSuddenDeath],
    [SOCKET_EVENTS.POWERUP_COLLECTED, _onPowerupCollected],
    [SOCKET_EVENTS.POWERUP_TICK, _onPowerupTick],
    [SOCKET_EVENTS.SHOCKWAVE_HIT, _onShockwaveHit],
    ...characterSocketHandlers,
    [SOCKET_EVENTS.DEATHDROP_COLLECTED, _onDeathDropCollected],
  ];
  let registered = false;

  function register() {
    if (registered) return;
    registered = true;
    for (const [event, handler] of listeners) socket.on(event, handler);
    startServerClockSync(socket);

    // If already connected when register() is called, attempt join right away
    if (socket.connected) _tryJoin();

    // Safety net for rare cases where start events are missed after joining.
    _startStartWatchdog();
  }

  /** Remove all match socket listeners. Safe to call multiple times. */
  function dispose() {
    if (!registered) return;
    registered = false;
    for (const [event, handler] of listeners) socket.off(event, handler);
    resetCharacterNetworks();
    _stopStartWatchdog();
    _clearForceLiveInputTimer();
    stopServerClockSync();
    snapshotDecoder.reset();
  }

  return { register, dispose };
}
