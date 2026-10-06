import { processPlayerPlatformCollision } from '../game/players/platformCollision';
import { loadGameFonts } from '../game/scene/loadGameFonts';
import { installDamageHitboxDebug } from '../game/scene/damageHitboxDebug';
import { bindGameAudio, getSettings, graphicsRenderScale, subscribeSettings } from "../site/preferences";
import { bindMusicEnvelope } from '../lib/musicEnvelope';
import { ensureLegalAcceptance } from "../site/shell";
import "../site/shell.js";
import { syncLocalEffects } from '../game/players/localStateSync';
import '../styles/mapPlaytest.css';
import '../styles/dashHud.css';
import '../styles/battlePixelHud.css';
import '../styles/levelBadge.css';
const editorSession = window.location.pathname === '/map-editor/playtest' ? new URLSearchParams(window.location.search).get('session') : null;
if (editorSession) document.body.classList.add('editor-playtest');
import { preloadMapDocument } from '../game/maps/documentRuntime';
import { buildScenery, preloadScenery } from '../game/maps/sceneryRuntime';
import { installMovingPlatforms, passesThrough, platformClock, remoteRideOffset } from '../game/maps/movingPlatforms';
import { attachCharacterNetworks, discardCharacterPresentation } from '../game/characters/networkRegistry';
// game.js

import {
  buildMap,
  registerMapMetadata,
  positionSpawn,
  getMapBgAsset,
  getMapMusicAsset,
  getMapMusicVolume,
  getMapObjects,
  getMapArena,
  getDefaultMapDocument,
  normalizeMapId,
} from "../game/maps/manifest";
import { applyMapBounds } from "../game/maps/mapUtils";
import { POST_MATCH_REWARD_STORAGE_KEY } from "../lobby/profile/postMatchRewards.js";
import { applyMatchBackground } from "../game/scene/matchBackground.js";
import { installAmbientBezels } from "../game/scene/ambientBezels.js";
import { fitGameSize, installViewportFit, viewportSize } from "../game/scene/gameViewport.js";
import { playMatchEndSound, startSuddenDeathMusic, stopSuddenDeathMusic } from "../game/audio/matchAudio.js";
import { createGameHudController } from "../game/hud/gameHudController";
import { createGameOverScreenController } from "../game/hud/gameOverScreenController";
import { createBattleTutorialController } from "../game/hud/battleTutorialController";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import { createGameChatController } from "../chat/gameChatController.js";
import { focusBattleInput, isChatInputActive, setChatInputActive } from "../game/players/localPlayer";
import "../styles/chat.css";
import "../styles/tutorialTips.css";
import { createSnapshotBuffer, processSnapshotInterpolation } from "../game/match/snapshotBuffer";
import {
  readNetworkExperiments,
  sampleRemoteFrame,
  followRemotePosition,
} from "../game/scene/remoteSmoothing.js";
import { createMatchCoordinator } from "../game/match/matchCoordinator";
import { preloadGameAssets } from "../game/scene/preloadGameAssets";
import { renderPoisonWater } from "../game/scene/poisonWaterRenderer";
import { updateDynamicCamera } from "../game/scene/cameraDynamics";
import { createMatchIntro, FOLLOW_LERP } from "../game/scene/matchIntro";
import { installRenderResolution } from "../game/scene/renderResolution";
import { deferSceneAudio } from "../game/audio/deferredAudio";
import { createLocalInputSync } from "../game/scene/localInputSync";
import { localMovementCorrector } from "../game/players/localMovementCorrector";
import { getServerClockDiagnostics } from "../game/match/serverClock";
import { updateHealthBars } from "../game/scene/healthBarRenderer";
import { createModeRuntime, loadMode, preloadModeAssets, supportsSuddenDeath } from "../game/modes";
import {
  POWERUP_TYPES,
  POWERUP_ASSET_DIR,
  POWERUP_COLORS,
  createPowerupTickSounds,
} from "../game/powerups/powerupConfig";
import { createPowerupRenderer } from "../game/powerups/powerupRenderer";
import { RENDER_LAYERS } from "../game/scene/renderLayers";
import {
  createPlayer,
  finalizeLocalSpawnPresentation,
  syncLocalUiPosition,
  player,
  handlePlayerMovement,
  dead,
  setSuperStats,
  setPowerupMobility,
  setPowerupInvisible,
  applyAuthoritativeState,
  getAmmoSyncState,
  getNetworkInputState,
  getPlayerTutorialState,
  setLocalNetStateFlusher,
  setExternalControlLockUntil,
  destroyMobileControls,
} from "../game/players/localPlayer";
import {
  preloadForRoster,
  handleLocalAuthoritativeAttack,
  handleRemoteAttack,
  setupAll,
  setupVariantAnimationsForRoster,
  resolveAnimKey,
  chooseRemoteAnimation,
  setAttackDebugState,
  applyCharacterPowerupFx,
  drawCharacterPowerupAura,
  getCharacterEffectTickSounds,
} from "../game/characters";
import {
  getAnimationDurationMs,
  markOneShotAnimation,
  remoteAnimationLockUntil,
  playCharacterAnimation,
  toLogicalAnimation,
} from "../game/characters/shared/animationState.js";
import socket, { waitForConnect } from "../lib/socket";
import OpPlayer from "../game/players/RemotePlayer";
import {
  configureClientNetTest,
  noteClientFrame,
  noteClientLifecycle,
  shouldMuteClientDefaultLogs,
} from "../lib/netTestLogger.js";
import MOVEMENT_PHYSICS from "../../shared/physics/movementPhysics.json";
import { POST_BATTLE_LOBBY_RETURN_KEY } from "../lib/storageKeys.js";


wireFullscreenToggles();

createGameChatController({
  socket,
  getGameData: () => gameData,
  getUsername: () => username,
  setChatInputActive,
  isChatInputActive,
  getScene: () => gameScene,
});

// Make Phaser globally available for character modules
window.Phaser = Phaser;

// Path to get assets
const staticPath = "/assets";
const BASE_GAME_WIDTH = 2300;
const BASE_GAME_HEIGHT = 1000;

function initialGameSize() {
  const { width, height } = viewportSize();
  return fitGameSize(width, height);
}

function getTopPlayfieldPadding() {
  return Math.max(0, initialGameSize().height - BASE_GAME_HEIGHT);
}

const POWERUP_TICK_SOUNDS = createPowerupTickSounds(
  getCharacterEffectTickSounds(),
);

let __booted = false;
function onReady(fn) {
  if (document.readyState === "loading") {
    // not ready yet - wait once
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    // DOM is already ready - run on next tick to keep ordering sane
    queueMicrotask(fn); // or setTimeout(fn, 0)
  }
}

// Get match ID from URL path, fallback to query params or session storage
function getMatchIdFromUrl() {
  // Try URL path first: /game/123
  const pathParts = window.location.pathname.split("/");
  if (pathParts.length >= 3 && pathParts[1] === "game") {
    const pathMatchId = pathParts[2];
    if (pathMatchId && pathMatchId !== "") {
      return pathMatchId;
    }
  }

  // Fallback to query params: /game.html?match=123
  const urlParams = new URLSearchParams(window.location.search);
  const queryMatchId = urlParams.get("match");
  if (queryMatchId) return queryMatchId;

  // Last resort: session storage
  return sessionStorage.getItem("matchId");
}

const matchId = getMatchIdFromUrl();

if (!matchId) {
  console.error("No match ID found, redirecting to lobby");
  window.location.href = "/";
} else {
  // Mark every battle session, not only completed ones. If the player leaves
  // early or uses browser Back, the lobby can discard its cached match-found
  // state instead of restoring it from the back/forward cache.
  try {
    sessionStorage.setItem(POST_BATTLE_LOBBY_RETURN_KEY, "1");
  } catch (_) {}
}

// Variables to store game session data
// Use server-sent identity (from /gamedata) rather than client cookies
let username = null;
let gameData = null; // Will be fetched from /gamedata endpoint
// Expose current match session details (level, per-character damages) for character modules
window.__MATCH_SESSION__ = window.__MATCH_SESSION__ || {};
window.__BB_LIVE_MATCH_CONTEXT__ = window.__BB_LIVE_MATCH_CONTEXT__ || {};
// Cache join payload for reconnect re-emit safety
let __joinPayload = { matchId: Number(matchId || 0) };

// Map variable
let mapObjects;

// Lists that store all the players in player team and op team
const opponentPlayers = Object.create(null);
const teamPlayers = Object.create(null);
let gameEnded = false; // stops update loop network emissions after game over
let gameInitialized = false; // track if game has been initialized
let hasJoined = false;
let joinInFlight = false; // prevent duplicate in-flight join emits
let clientRevealed = false; // loading screen lifted over a built scene
let readyAckSocketId = null; // socket that last carried our ready signal
let isLiveGame = false; // server reported active game (late join)
let pendingAuthoritativeLocalState = null; // apply once local sprite exists
// Buffer for remote actions that arrive before scene is ready
const PENDING_ACTIONS = [];
// Spawn coordination
let SPAWN_VERSION = 0; // increments per scene init to version spawns
const SERVER_SPAWN_INDEX = Object.create(null); // name -> spawnIndex (if server provided)
let latestPowerups = []; // from server snapshots
let latestModeState = null; // objective/timer state from server snapshots
let latestDeathDrops = []; // from server snapshots / death events
let latestEffectMovement = {};
let latestPlayerEffects = {}; // name -> effect duration map (ms remaining)
const POWERUP_COLLECT_QUEUE = [];
const DEATHDROP_COLLECT_QUEUE = [];
const LAST_HEALTH_BY_PLAYER = Object.create(null);
const SHIELD_IMPACT_QUEUE = [];
const LAST_SHIELD_ACTIVE_AT = Object.create(null);

const localInputSync = createLocalInputSync({
  socket,
  getAmmoSyncState,
  getNetworkInputState,
  throttleMs: 16,
});
setLocalNetStateFlusher((state) =>
  localInputSync.flushNow(gameScene, player, state),
);

// Server snapshot interpolation
const networkExperiments = readNetworkExperiments(window.location.search);
const snapshotBuffer = createSnapshotBuffer(networkExperiments);
window.__BB_NETWORK_DIAGNOSTICS__ = () => ({
  experiments: { ...networkExperiments },
  ...snapshotBuffer.getDiagnostics(),
  corrections: localMovementCorrector.getDiagnostics(),
  clock: getServerClockDiagnostics(),
});

// Game scene reference
let gameScene = null;

// matchCoordinator is declared here and instantiated after hud/snapshotBuffer below.
// It is created at module scope so all state setters close over the let variables.
let matchCoordinator = null;

const hud = createGameHudController({
  getGameData: () => gameData,
  getUsername: () => username,
  getMapBgAsset: mapId => getMapBgAsset(mapId, gameScene),
  getScene: () => gameScene,
  onCountdownFight: () => {
    window.__BB_NAVIGATION__?.lobbyAudio?.handoff();
    try {
      if (gameScene) gameScene._bgmIntensity = 1;
      gameScene?._startMainBgm?.();
      gameScene?._bgmEnvelope?.fade(1, 900);
    } catch (_) {}
  },
  onCountdownStart: () => {
    matchIntro.conclude();
    if (gameScene) gameScene._bgmIntensity = 0.3;
    gameScene?._startMainBgm?.();
    gameScene?._bgmEnvelope?.fade(0.3, 450);
    focusBattleInput();
  },
  onEnableInput: () => {
    try {
      if (gameScene && gameScene.input?.keyboard) {
        gameScene.input.keyboard.enabled = true;
      }
    } catch (_) {}
  },
  onSpectatePrevious: () => gameScene?._cycleSpectatedPlayer?.(-1),
  onSpectateNext: () => gameScene?._cycleSpectatedPlayer?.(1),
});

// Pregame flythrough + pregame.mp3 between the loading screen and countdown.
const matchIntro = createMatchIntro({
  getScene: () => gameScene,
  getPlayer: () => player,
  getEnemySprites: () =>
    Object.values(opponentPlayers).map((wrapper) => wrapper?.opponent).filter(Boolean),
  onActiveChange: (active) => hud.setPregameActive(active),
});

// The loading screen lifted: this client's pregame starts and the server
// counts us as loaded. A match already counting down or live skips it.
function onGameRevealed() {
  clientRevealed = true;
  trySendReadyAck();
  const skipPregame =
    isLiveGame || gameEnded || editorSession || gameData?.editorPlaytest ||
    hud.isBattleIntroActive?.();
  if (!skipPregame) matchIntro.beginPregame();
}
document.addEventListener("game:ready", onGameRevealed, { once: true });

const battleTutorial = createBattleTutorialController({
  socket,
  getGameData: () => gameData,
  getScene: () => gameScene,
  getPlayer: () => player,
  getPlayerState: getPlayerTutorialState,
  getNetworkInputState,
  getOpponentPlayers: () => opponentPlayers,
  getLatestPowerups: () => latestPowerups,
  getDead: () => dead,
  isBattleReady: () =>
    hasJoined && gameInitialized && !gameEnded && !hud.isBattleIntroActive?.(),
});

const gameOverScreenController = createGameOverScreenController({
  getGameData: () => gameData,
  getUsername: () => username,
  rewardStorageKey: POST_MATCH_REWARD_STORAGE_KEY,
});

// Wire all server socket event handling for the live match.
// Function declarations referenced below are hoisted, so this can safely
// reference helpers that appear later in the file.
matchCoordinator = createMatchCoordinator({
  socket,
  onHuntressAmmo: (ammoState) => applyAuthoritativeState({ ammoState }),
  getGameData: () => gameData,
  getUsername: () => username,
  getJoinPayload: () => __joinPayload,
  getGameScene: () => gameScene,
  getPlayer: () => player,
  setExternalControlLockUntil,
  getGameInitialized: () => gameInitialized,
  setGameInitialized: (v) => {
    gameInitialized = v;
  },
  getHasJoined: () => hasJoined,
  setHasJoined: (v) => {
    hasJoined = v;
  },
  getJoinInFlight: () => joinInFlight,
  setJoinInFlight: (v) => {
    joinInFlight = v;
  },
  getIsLiveGame: () => isLiveGame,
  setIsLiveGame: (v) => {
    isLiveGame = v;
    if (!v) return;
    matchIntro.conclude();
    gameScene?._startMainBgm?.();
  },
  getGameEnded: () => gameEnded,
  setGameEnded: (v) => {
    gameEnded = v;
    if (gameScene) gameScene._battleEnded = !!v;
  },
  isClientReady: () => clientRevealed && !!gameScene && !!player,
  setPendingAuthoritativeLocalState: (v) => {
    pendingAuthoritativeLocalState = v;
  },
  getSpawnVersion: () => SPAWN_VERSION,
  setSpawnVersion: (v) => {
    SPAWN_VERSION = v;
  },
  serverSpawnIndex: SERVER_SPAWN_INDEX,
  onServerSpawns: applyServerSpawns,
  setLatestPowerups: (v) => {
    latestPowerups = v;
  },
  setLatestModeState: (v) => {
    latestModeState = v;
    syncLiveMatchContext();
  },
  getLatestModeState: () => latestModeState,
  getLatestDeathDrops: () => latestDeathDrops,
  setLatestDeathDrops: (v) => {
    latestDeathDrops = v;
  },
  setLatestPlayerEffects: (v) => {
    latestPlayerEffects = v;
  },
  getLatestPlayerEffects: () => latestPlayerEffects,
  setLatestEffectMovement: (value) => { latestEffectMovement = value; },
  opponentPlayers,
  teamPlayers,
  pendingActionsQueue: PENDING_ACTIONS,
  powerupCollectQueue: POWERUP_COLLECT_QUEUE,
  deathdropCollectQueue: DEATHDROP_COLLECT_QUEUE,
  shieldImpactQueue: SHIELD_IMPACT_QUEUE,
  lastHealthByPlayer: LAST_HEALTH_BY_PLAYER,
  lastShieldActiveAt: LAST_SHIELD_ACTIVE_AT,
  snapshotBuffer,
  hud,
  positionSpawn,
  OpPlayer,
  handleLocalAuthoritativeAttack,
  handleRemoteAttack,
  powerupTickSounds: POWERUP_TICK_SOUNDS,
  onInitializePlayers: initializePlayers,
  onTrySendReadyAck: trySendReadyAck,
  onTrackShieldEffects: trackShieldEffectsPresence,
  onStartSuddenDeathMusic: () => startSuddenDeathMusic(gameScene),
  onStopSuddenDeathMusic: () => stopSuddenDeathMusic(gameScene),
  onPlayMatchEndSound: (winnerTeam) =>
    playMatchEndSound(gameScene, winnerTeam, gameData?.yourTeam),
  onShowGameOverScreen: showGameOverScreen,
  isPresentationSuppressed: () => document.hidden,
});

function clearTransientPresentation() {
  PENDING_ACTIONS.length = 0;
  POWERUP_COLLECT_QUEUE.length = 0;
  DEATHDROP_COLLECT_QUEUE.length = 0;
  SHIELD_IMPACT_QUEUE.length = 0;
  discardCharacterPresentation();
  for (const sprite of [
    player,
    ...Object.values(opponentPlayers).map((entry) => entry?.opponent),
    ...Object.values(teamPlayers).map((entry) => entry?.opponent),
  ]) {
    try { sprite?._thorgAttackCleanup?.(); } catch (_) {}
  }
  try { gameScene?.events?.emit?.("presentation:reset"); } catch (_) {}
  try { gameScene?.sound?.stopAll?.(); } catch (_) {}
}

function snapRemotePlayersToLatestState() {
  for (const entry of gameData?.players || []) {
    if (entry?.name === username) continue;
    const sprite = (opponentPlayers[entry?.name] || teamPlayers[entry?.name])?.opponent;
    const x = Number(entry?.x), y = Number(entry?.y);
    if (!sprite || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    try { sprite.body?.reset?.(x, y); } catch (_) { sprite.setPosition?.(x, y); }
    if (sprite._bbAnimationState) {
      sprite._bbAnimationState.oneShot = null;
      sprite._bbAnimationState.oneShotUntilMs = 0;
      sprite._bbAnimationState.oneShotUntilPerf = 0;
    }
    sprite._remoteActionAnimUntil = 0;
    const wrapper = opponentPlayers[entry.name] || teamPlayers[entry.name];
    if (wrapper) wrapper._animLockUntil = 0;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTransientPresentation();
    try { gameScene?._bgmEl?.pause?.(); gameScene?._suddenDeathMusicSfx?.pause?.(); } catch (_) {}
    return;
  }
  // Throw away the old interpolation timeline and show current authoritative
  // positions immediately. Fresh snapshots rebuild smoothing from "now".
  clearTransientPresentation();
  snapshotBuffer.reset();
  snapRemotePlayersToLatestState();
  try {
    if (!gameEnded && gameScene?._suddenDeathMusicSfx) {
      startSuddenDeathMusic(gameScene);
    } else if (!gameEnded && gameScene?._bgmStarted) {
      gameScene._bgmEl?.play?.()?.catch?.(() => {});
    }
  } catch (_) {}
});

// Ensure listeners are not kept around when the tab navigates away.
window.addEventListener(
  "beforeunload",
  () => {
    try {
      matchCoordinator?.dispose();
    } catch (_) {}
    try {
      battleTutorial?.destroy();
    } catch (_) {}
  },
  { once: true },
);

function trackShieldEffectsPresence(effectsSnapshot) {
  if (!effectsSnapshot || typeof effectsSnapshot !== "object") return;
  const now = Date.now();
  for (const [name, fx] of Object.entries(effectsSnapshot)) {
    if (!name || !fx) continue;
    if ((Number(fx.shield) || 0) > 0 || (Number(fx.respawnShield) || 0) > 0) {
      LAST_SHIELD_ACTIVE_AT[name] = now;
    }
  }
}

function syncLiveMatchContext() {
  try {
    window.__BB_LIVE_MATCH_CONTEXT__ = {
      modeState: latestModeState,
      yourTeam: gameData?.yourTeam || null,
      mapId: gameData?.map ?? null,
      modeId: gameData?.modeId || null,
    };
  } catch (_) {}
}

// Fetch game data from server
async function fetchGameData() {
  try {
    const response = await fetch(editorSession ? `/api/admin/map-playtests/${editorSession}` : "/gamedata", {
      method: editorSession ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: editorSession ? undefined : JSON.stringify({ matchId: Number(matchId) }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      const error = new Error(result.error || "Failed to fetch game data");
      error.code = result.code;
      throw error;
    }

    return result.gameData;
  } catch (error) {
    console.error("Failed to fetch game data:", error);
    if (!window.__BB_NAVIGATION__) hud.showSystemNotice?.({
      title: "Failed To Load Match",
      message: "We couldn't load this match. Returning to the lobby.",
      buttonText: "Lobby",
      tone: "error",
      autoCloseMs: 2200,
      confirmOnAutoClose: true,
      onConfirm: () => {
        window.location.href = "/";
      },
    });
    throw error;
  }
}

// Initialize game connection
async function initializeGame() {
  try {
    if (__booted) return;
    __booted = true;
    configureClientNetTest({ matchId });
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Fetching game data for match:", matchId);
    } else {
      noteClientLifecycle("fetch-gamedata", `matchId=${matchId}`);
    }
    if (!editorSession) await ensureLegalAcceptance();
    gameData = await fetchGameData();
    if (!editorSession) battleTutorial.initialize();
    // Start fetching the authoritative map background as soon as match data
    // arrives. The loading screen stays visible until this image is ready.
    if (gameData?.mapSnapshot?.metadata) registerMapMetadata([gameData.mapSnapshot.metadata]);
    applyMatchBackground(gameScene, gameData, gameData?.map);
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Game data received:", gameData);
    } else {
      noteClientLifecycle(
        "gamedata",
        `players=${Array.isArray(gameData?.players) ? gameData.players.length : 0} map=${gameData?.map ?? "?"}`,
      );
    }
    username = gameData.yourName || username;
    configureClientNetTest({ username, matchId });
    syncLiveMatchContext();
    initTeamStatusHud(gameData?.players || []);

    // 1) Register listeners before join
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Setting up game listeners");
    } else {
      noteClientLifecycle("listeners", "register");
    }
    matchCoordinator.dispose();
    matchCoordinator.register();

    // 2) Enrich payload with gameId if provided
    if (gameData?.gameId) __joinPayload.gameId = Number(gameData.gameId);

    // 3) Ensure connection; if not connected, connect and join on next connect
    try {
      await waitForConnect(4000);
    } catch {}
    // Do not emit here; connect/reconnect handlers (and immediate call below) will do it once.
  } catch (error) {
    if(error.code === "CONSENT_CANCELLED") { location.assign("/"); return; }
    console.error("Failed to initialize game:", error);
    throw error;
  }
}

function initTimerHud() {
  return hud.initTimerHud();
}

function updateTimerHud(remainingMs, suddenDeath) {
  return hud.updateTimerHud(remainingMs, suddenDeath);
}

function showSuddenDeathBanner() {
  return hud.showSuddenDeathBanner();
}

function initKeybindHud() {
  return hud.initKeybindHud();
}

function initTeamStatusHud(players) {
  return hud.initTeamStatusHud(players);
}

function setTeamHudPlayerAlive(name, isAlive) {
  return hud.setTeamHudPlayerAlive(name, isAlive);
}

function setTeamHudPlayerPresence(name, connected) {
  return hud.setTeamHudPlayerPresence(name, connected);
}

function setTeamHudPlayerLoaded(name, loaded) {
  return hud.setTeamHudPlayerLoaded(name, loaded);
}

function syncTeamHudFromSnapshot(playersByName) {
  return hud.syncTeamHudFromSnapshot(playersByName);
}

// Initialize players based on server data
function initializePlayers(players) {
  // Clear existing players
  for (const name in opponentPlayers) {
    const existing = opponentPlayers[name];
    if (typeof existing?.destroy === "function") existing.destroy();
    else if (existing?.opponent?.destroy) existing.opponent.destroy();
    delete opponentPlayers[name];
  }

  for (const name in teamPlayers) {
    const existing = teamPlayers[name];
    if (typeof existing?.destroy === "function") existing.destroy();
    else if (existing?.opponent?.destroy) existing.opponent.destroy();
    delete teamPlayers[name];
  }

  // Add players based on teams
  players.forEach((playerData) => {
    if (playerData.name === username) {
      // This is the local player, handled separately
      return;
    }

    const isTeammate = playerData.team === gameData.yourTeam;
    const playerContainer = isTeammate ? teamPlayers : opponentPlayers;

    // Create OpPlayer instance (this will be created when the scene is ready)
    playerContainer[playerData.name] = {
      name: playerData.name,
      character: playerData.char_class,
      skinId: playerData.selected_skin_id || "",
      team: playerData.team,
      x: playerData.x || 100,
      y: playerData.y || 100,
      health: typeof playerData.health === "number" ? playerData.health : 100,
      isAlive: playerData.isAlive !== false,
      connected: playerData.connected !== false,
      loaded: playerData.loaded === true,
      spawnIndex:
        typeof playerData.spawnIndex === "number"
          ? playerData.spawnIndex
          : undefined,
    };
  });
}

// Before FIGHT the server's spawn is authoritative for every fighter. In a live
// game only a loaded player's position is; others still fall back to the map.
function hasServerPosition(playerData) {
  return (
    (!isLiveGame || playerData?.loaded === true) &&
    Number.isFinite(Number(playerData?.x)) &&
    Number.isFinite(Number(playerData?.y))
  );
}

/**
 * Stand fighters on the server's spawns ({ [name]: { x, y } }). Used on
 * game:init and game:start; live games move players through snapshots and
 * corrections instead, so this does nothing once the fight is on.
 */
function applyServerSpawns(spawns) {
  if (!spawns || isLiveGame) return;
  const place = (sprite, spawn) => {
    const x = Number(spawn?.x);
    const y = Number(spawn?.y);
    if (!sprite?.body || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    sprite.body.reset(x, y);
    sprite.setVelocity?.(0, 0);
    sprite.setAcceleration?.(0, 0);
    return true;
  };
  if (username && place(player, spawns[username])) {
    localMovementCorrector.clear();
    syncLocalUiPosition();
  }
  for (const [name, spawn] of Object.entries(spawns)) {
    if (name === username) continue;
    const wrapper = opponentPlayers[name] || teamPlayers[name];
    if (place(wrapper?.opponent, spawn)) wrapper.updateUIPosition?.();
  }
}

// A moving platform passing through a trapped player skips separation.
function collidePlayerWithPlatform(player, platform) {
  return !passesThrough(player, platform) && processPlayerPlatformCollision(player, platform);
}

function attachMapCollidersToSprite(scene, sprite, objects) {
  if (!scene?.physics || !sprite || !Array.isArray(objects)) return;
  for (const mapObject of objects) {
    if (!mapObject) continue;
    try {
      scene.physics.add.collider(sprite, mapObject, null, collidePlayerWithPlatform);
    } catch (_) {}
  }
}

// Initialize game when page loads
let game = null;
window.__BB_PAGE_SCOPE__?.onDispose(async () => {
  document.removeEventListener("game:ready", onGameRevealed);
  matchIntro.dispose();
  matchCoordinator?.dispose();
  battleTutorial?.destroy();
  destroyMobileControls?.();
  if (game) {
    const retiring = game;
    game = null;
    // game.destroy() only emits each scene's DESTROY event. Shut the scenes
    // down first so their "shutdown" cleanup hooks run as they would on stop.
    for (const scene of retiring.scene.scenes) {
      try {
        if (scene.sys.settings.status < Phaser.Scenes.SHUTDOWN) scene.sys.shutdown();
      } catch (error) {
        console.warn("[game] scene shutdown failed", error);
      }
    }
    await new Promise(resolve => {
      retiring.events.once(Phaser.Core.Events.DESTROY, resolve);
      retiring.destroy(true, false);
      // A hidden tab can have a sleeping loop. Wake it so destruction runs
      // before the next screen is mounted, including browser Back transitions.
      retiring.loop.wake();
    });
  }
});
window.__BOOT_GAME__ = () =>
  onReady(async () => {
    try {
      initKeybindHud();
      if (editorSession) { const controls=document.getElementById("battle-keybind-hud"); if(controls){controls.dataset.state="collapsed";controls.style.display="none";} }
      hud.initSpectateHud?.();
      initTimerHud();
      // Canvas text captures its font at creation; CSS preloads alone do not
      // guarantee it is decoded before the first Phaser text object is made.
      await Promise.all([
        initializeGame(),
        loadGameFonts(document.fonts),
      ]);
      if (!gameData) throw new Error('Unable to initialize this battle');
      await loadMode(gameData?.modeId);
      if (window.__BB_PAGE_SCOPE__ && !window.__BB_PAGE_SCOPE__.active) return;
      if (!game) {
        game = new Phaser.Game(config);
      }
    } catch (error) {
      if (window.__BB_PAGE_SCOPE__?.active) window.__BB_NAVIGATION__?.fail(error);
      else console.error(error);
    }
  });

// Phaser class to setup the game
class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
    this._topPlayfieldPadding = getTopPlayfieldPadding();
  }

  // Preloads assets
  preload() {
    deferSceneAudio(this);
    const onVisualProgress = (p) => {
      // 50% - 90%
      const pct = Math.floor(50 + p * 40); // maps 0-1 -> 50-90
      updateLoading(pct, "Loading arena...");
    };
    this.load.on("progress", onVisualProgress);

    this.load.once("complete", () => {
      this.load.off("progress", onVisualProgress);
      updateLoading(95, "Arena ready...");
      // The pregame begins when the loading screen lifts (onGameRevealed);
      // input is enabled at FIGHT, or immediately when joining a live match.
    });

    preloadMapDocument(
      this,
      gameData?.mapSnapshot?.map || getDefaultMapDocument(gameData?.map),
    );
    preloadScenery(this, gameData?.mapSnapshot?.map || getDefaultMapDocument(gameData?.map));
    preloadModeAssets(this, gameData?.modeId, staticPath);
    preloadGameAssets({
      scene: this,
      staticPath,
      powerupTypes: POWERUP_TYPES,
      powerupAssetDir: POWERUP_ASSET_DIR,
      preloadAllCharacters: (activeScene, activeStaticPath) =>
        preloadForRoster(
          activeScene,
          gameData?.players || [],
          activeStaticPath,
        ),
    });
  }

  create() {
    bindGameAudio(this);
    // Store scene reference
    gameScene = this;
    this._topPlayfieldPadding = getTopPlayfieldPadding();
    // Don't let players move until game is fully ready (unless late-joining a live game)
    this.input.keyboard.enabled = false;
    this.physics.world.setBoundsCollision(false, false, false, false);
    // Poison water overlay graphics (sudden death - drawn every frame in update)
    const worldH = BASE_GAME_HEIGHT;
    this._poisonWaterY = worldH + 60; // start off-screen below world
    this._smoothPoisonY = null; // interpolated, set on first use
    this._poisonGraphics = this.add.graphics();
    this._poisonGraphics.setDepth(RENDER_LAYERS.POISON);
    // Pre-generate bubble positions (22 bubbles, deterministic so no jitter on re-use)
    const poisonWidth =
      Number(this.scale?.width) || Number(this.game.config.width) || 1300;
    const bubbleCount = Math.max(22, Math.floor(poisonWidth / 60));
    this._poisonBubbles = Array.from({ length: bubbleCount }, (_, i) => ({
      x: 30 + ((i * 59 + i * 11) % Math.max(60, poisonWidth - 60)),
      phase: i * 0.57,
      r: 1.5 + (i % 3) * 0.75,
      speed: 20 + (i % 6) * 8,
      drift: 2.5 + (i % 4) * 1.5,
    }));
    this._powerupVisuals = Object.create(null); // id -> visual bundle
    this._deathDropVisuals = Object.create(null); // id -> visual bundle
    this._pendingDeathDropPickups = new Set();
    this._powerupAuraGraphics = this.add.graphics();
    this._powerupAuraGraphics.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    this._powerupFxGraphics = this.add.graphics();
    this._powerupFxGraphics.setDepth(RENDER_LAYERS.PLAYER_HUD);
    this._modeObjectiveGraphics = this.add.graphics();
    this._modeObjectiveGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS);
    this._modeObjectiveUiGraphics = this.add.graphics();
    this._modeObjectiveUiGraphics.setDepth(RENDER_LAYERS.PLAYER_HUD);
    this._modeRuntime = null;
    this._powerupRenderer = createPowerupRenderer({
      scene: this,
      Phaser,
      colors: POWERUP_COLORS,
      getUsername: () => username,
      getGameData: () => gameData,
      getLocalPlayer: () => player,
      getOpponentPlayers: () => opponentPlayers,
      getTeamPlayers: () => teamPlayers,
      getLatestPowerups: () => latestPowerups,
      getLatestDeathDrops: () => latestDeathDrops,
      getLatestPlayerEffects: () => latestPlayerEffects,
      powerupCollectQueue: POWERUP_COLLECT_QUEUE,
      deathdropCollectQueue: DEATHDROP_COLLECT_QUEUE,
      shieldImpactQueue: SHIELD_IMPACT_QUEUE,
      socket,
      getMapObjects: () => mapObjects,
      getDead: () => dead,
      applyCharacterPowerupFx,
      drawCharacterPowerupAura,
    });
    // Wait for game data before creating map and player
    if (!gameData) {
      if (!shouldMuteClientDefaultLogs()) {
        console.log("Waiting for game data...");
      } else {
        noteClientLifecycle("wait-gamedata", "");
      }
      updateLoading(96, "Server error. Refresh or return to lobby.");
      // Poll for game data
      const pollForGameData = () => {
        if (gameData) {
          this.initializeGameWorld();
        } else {
          setTimeout(pollForGameData, 100);
        }
      };
      setTimeout(pollForGameData, 100);
      return;
    }

    this.initializeGameWorld();

    // If joining a live game, enable controls right away (no overlay/countdown)
    if (isLiveGame) {
      this.input.keyboard.enabled = true;
    }

    // Scene is now ready; if server is in starting phase, ack readiness
    trySendReadyAck();
    updateLoading(100, "Let's battle!");
  }

  initializeGameWorld() {
    // New spawn version for this scene
    SPAWN_VERSION = Math.max(SPAWN_VERSION, Date.now());
    this._topPlayfieldPadding = getTopPlayfieldPadding();
    const activeMapId = normalizeMapId(gameData?.map);
    // No per-scene spawn plan needed now; map modules provide positioning helpers
    // Creates the map objects based on game data
    buildMap(this, gameData?.mapSnapshot?.mapId || activeMapId, gameData?.mapSnapshot?.map);
    mapObjects = getMapObjects(activeMapId, this);
    this._mapObjects = mapObjects;
    applyMapBounds(this, getMapArena(activeMapId, this), {
      extraTopSpace: this._topPlayfieldPadding,
    });
    // Parallax layers fit themselves to the camera bounds set above.
    buildScenery(this, this._mapDocument);
    this._spectatorBounds = {
      centerX:
        Number(this.physics?.world?.bounds?.centerX) ||
        Number(this.game.config.width) / 2,
      centerY:
        Number(this.physics?.world?.bounds?.centerY) ||
        Number(this.game.config.height) / 2,
      width:
        Number(this.physics?.world?.bounds?.width) ||
        Number(this.game.config.width),
      height:
        Number(this.physics?.world?.bounds?.height) ||
        Number(this.game.config.height),
    };
    this._spectatorModeActive = false;
    this._spectatedPlayerName = null;
    this._spectatedPlayerAudioSprite = null;
    this._spectatorCandidateCount = 0;
    this._spectatorFallbackActive = false;
    this._spectatorCameraTarget = { x: 0, y: 0 };
    this._spectatorCameraFollowing = false;

    // Ensure all character animations are registered for this scene
    setupAll(this);
    setupVariantAnimationsForRoster(this, gameData?.players || []);

    // Replay any queued remote actions now that the scene is ready
    try {
      if (Array.isArray(PENDING_ACTIONS) && PENDING_ACTIONS.length) {
        const queued = PENDING_ACTIONS.splice(0, PENDING_ACTIONS.length);
        const retryActions = [];
        for (const pkt of queued) {
          try {
            const { playerName, character, action } = pkt || {};
            if (!playerName || !action) continue;
            if (playerName === username) continue;
            const pd = (gameData.players || []).find(
              (p) => p.name === playerName,
            );
            const isTeammate = pd && pd.team === gameData.yourTeam;
            const container = isTeammate ? teamPlayers : opponentPlayers;
            const wrapper = container[playerName];
            if (!wrapper?.opponent) {
              retryActions.push(pkt);
              continue;
            }
            const charKey = (
              character ||
              (pd && pd.char_class) ||
              ""
            ).toLowerCase();
            const act = { ...(action || {}) };
            if (wrapper && wrapper.opponent) {
              act.x = wrapper.opponent.x;
              act.y = wrapper.opponent.y;
              if (typeof act.direction !== "number") {
                act.direction = wrapper.opponent.flipX ? -1 : 1;
              }
            }
            const consumed = handleRemoteAttack(this, charKey, act, wrapper);
            if (consumed && wrapper?.opponent) {
              const currentKey = wrapper.opponent.anims?.currentAnim?.key || "";
              const logical = toLogicalAnimation(
                currentKey || act.type,
                charKey,
              );
              const duration = getAnimationDurationMs(
                this,
                currentKey,
                logical === "special" ? 900 : 520,
              );
              markOneShotAnimation(wrapper.opponent, logical, duration, {
                remote: true,
              });
              wrapper._animLockUntil = performance.now() + duration;
            }
          } catch (_) {}
        }
        if (retryActions.length) {
          PENDING_ACTIONS.push(...retryActions);
        }
      }
    } catch (_) {}

    // Background music: create only the active map's track and start it
    // as soon as the match scene is live.
    this._bgmStarted = false;
    const bgmSrc = gameData?.mapSnapshot?.metadata?.musicAsset || getMapMusicAsset(gameData?.map);
    const bgmVolume = gameData?.mapSnapshot?.metadata?.musicVolume ?? getMapMusicVolume(gameData?.map);
    const startBgm = () => {
      if (this._bgmStarted) return;
      this._bgmStarted = true;
      try {
        if (this._bgmEl && this._bgmSrc !== bgmSrc) {
          try {
            this._bgmEl.pause();
          } catch (_) {}
          this._bgmEl = null;
        }
        if (!this._bgmEl) {
          const el = new Audio(bgmSrc);
          el.preload = "auto";
          el.loop = true;
          this._bgmEnvelope = bindMusicEnvelope(el, bgmVolume, 0);
          el.addEventListener('playing', () => {
            this._bgmEnvelope.fade(this._bgmIntensity ?? (isLiveGame ? 1 : 0.3), 1200);
          }, { once: true });
          this.events.once("shutdown", () => this._bgmEnvelope?.dispose());
          this._bgmSrc = bgmSrc;
          this._bgmEl = el;
          // Hook into scene lifecycle for cleanup
          this.events.once("shutdown", () => {
            try {
              this._bgmEl?.pause();
            } catch (_) {}
            this._bgmSrc = null;
            this._bgmEl = null;
          });
          this.events.on("pause", () => this._bgmEl?.pause());
          this.events.on("resume", () => {
            try {
              this._bgmEl?.play()?.catch(() => {});
            } catch (_) {}
          });
        }
        const playingElement = this._bgmEl;
        const p = playingElement.play();
        if (p && typeof p.then === "function") p.then(() => {
          if (this._bgmEl === playingElement) window.__BB_NAVIGATION__?.lobbyAudio?.handoff();
        }).catch(() => { this._bgmStarted = false; });
      } catch (e) {}
    };
    this._startMainBgm = () => {
      if (this._bgmStarted) return;
      if (this.sound.locked) {
        this.sound.once("unlocked", startBgm);
        this.input.once("pointerdown", startBgm);
        this.input.keyboard?.once("keydown", startBgm);
        return;
      }
      startBgm();
    };
    // Normal starts stay silent through the pregame hold; the countdown (or
    // going live) starts the map music.
    if (isLiveGame) this._startMainBgm();

    this.events.once("shutdown", () => {
      try {
        matchCoordinator?.dispose();
      } catch (_) {}
      try {
        this._modeRuntime?.destroy?.();
      } catch (_) {}
      this._modeRuntime = null;
      stopSuddenDeathMusic(gameScene);
      try {
        this._suddenDeathMusicSfx?.destroy();
      } catch (_) {}
      this._suddenDeathMusicSfx = null;
      try {
        hud.hideSpectatingBanner?.();
      } catch (_) {}
    });

    // Cache my level and stats BEFORE creating the player so HUD uses server values
    try {
      const me = (gameData.players || []).find((p) => p.name === username);
      if (me) {
        window.__MATCH_SESSION__ = window.__MATCH_SESSION__ || {};
        window.__MATCH_SESSION__.level = me.level || 1;
        window.__MATCH_SESSION__.stats = me.stats || {};
      }
    } catch (_) {}

    // Creates player object using game data
    createPlayer(
      this,
      username,
      gameData.yourCharacter,
      null,
      null,
      (gameData.players || []).filter((p) => p.team === gameData.yourTeam)
        .length,
      activeMapId,
      opponentPlayers,
      (gameData.players || []).find((p) => p.name === username)
        ?.selected_skin_id || "",
    );

    attachMapCollidersToSprite(this, player, mapObjects);
    installMovingPlatforms(this, {
      riders: () => (player && !dead ? [player] : []),
    });

    // Set initial super stats
    const me = (gameData.players || []).find((p) => p.name === username);
    if (me) {
      setSuperStats(me.superCharge || 0, me.maxSuperCharge || 100);
    }

    // Safety: ensure we never keep an OpPlayer entry for myself
    try {
      if (username) {
        if (opponentPlayers && opponentPlayers[username]) {
          const op = opponentPlayers[username];
          if (op && op.destroy) op.destroy();
          delete opponentPlayers[username];
        }
        if (teamPlayers && teamPlayers[username]) {
          const tp = teamPlayers[username];
          if (tp && tp.destroy) tp.destroy();
          delete teamPlayers[username];
        }
      }
    } catch (_) {}
    // Before FIGHT the server's spawn is authoritative; in a live game only a
    // loaded (previously synced) position is.
    const hasAuthoritativeSpawn =
      pendingAuthoritativeLocalState &&
      (!isLiveGame || pendingAuthoritativeLocalState.loaded === true) &&
      Number.isFinite(pendingAuthoritativeLocalState.x) &&
      Number.isFinite(pendingAuthoritativeLocalState.y) &&
      player?.body;

    // After sprite exists and body sized, fall back to the map's spawn slot
    // only when the server has not sent a position yet.
    try {
      if (hasAuthoritativeSpawn) {
        player.body.reset(
          pendingAuthoritativeLocalState.x,
          pendingAuthoritativeLocalState.y,
        );
      } else {
        const serverIdx = SERVER_SPAWN_INDEX[username];
        const myIndex =
          typeof serverIdx === "number" ? Math.max(0, serverIdx) : 0;
        positionSpawn(
          this,
          player,
          activeMapId,
          gameData.yourTeam,
          myIndex,
        );
      }
      stabilizeSpawnedSpriteOnMap(this, player, mapObjects);
    } catch (_) {}

    // If server already has my live state (refresh/reconnect), apply it after spawn snap.
    try {
      if (pendingAuthoritativeLocalState) {
        applyAuthoritativeState(pendingAuthoritativeLocalState);
        const shouldRestorePosition =
          !hasAuthoritativeSpawn &&
          isLiveGame &&
          pendingAuthoritativeLocalState.connected !== false &&
          pendingAuthoritativeLocalState.loaded === true;
        if (
          shouldRestorePosition &&
          pendingAuthoritativeLocalState.isAlive !== false &&
          Number.isFinite(pendingAuthoritativeLocalState.x) &&
          Number.isFinite(pendingAuthoritativeLocalState.y) &&
          player?.body
        ) {
          player.body.reset(
            pendingAuthoritativeLocalState.x,
            pendingAuthoritativeLocalState.y,
          );
          stabilizeSpawnedSpriteOnMap(this, player, mapObjects);
        }
      }
    } catch (_) {}

    try {
      finalizeLocalSpawnPresentation();
    } catch (_) {}

    // Server stats are already applied above prior to createPlayer

    // Initialize other players from game data
    this.initializeOtherPlayers();

    // Toggle physics debug with Ctrl+M (ensures debug graphic exists)
    if (gameData?.editorPlaytest) installDamageHitboxDebug(this, socket);
    const setHitboxDebug = (enable) => {
      const world = this.physics?.world;
      if (!world) return;
      world.drawDebug = enable;
      try {
        setAttackDebugState(gameData?.editorDebugHitboxes ? false : enable);
      } catch (_) {}
      if (enable) {
        // Create debug graphic if Phaser hasn't created it yet
        try {
          if (!world.debugGraphic || !world.debugGraphic.scene) {
            if (typeof world.createDebugGraphic === "function") {
              world.createDebugGraphic();
            } else {
              world.debugGraphic = this.add.graphics();
            }
          }
          world.debugGraphic.setVisible(true);
        } catch (_) {}
      } else {
        try {
          if (world.debugGraphic) {
            world.debugGraphic.clear?.();
            world.debugGraphic.setVisible(false);
          }
        } catch (_) {}
      }
      // Keep config in sync for any systems that read it
      const arcadeCfg = this.sys?.game?.config?.physics?.arcade;
      if (arcadeCfg) arcadeCfg.debug = enable;
    };
    setHitboxDebug(gameData?.editorDebugHitboxes === true);
    this.input.keyboard.on("keydown-M", (e) => {
      if (e.ctrlKey) setHitboxDebug(!this.physics?.world?.drawDebug);
    });

    // Camera: smooth follow
    const cam = this.cameras.main;

    // lerpX=0.08 for crisp horizontal tracking; lerpY=0.05 is deliberately
    // lazier so the vertical frame shifts more gently - vertical centering is
    // less critical than horizontal awareness.
    followLocalPlayer(cam);
    if (!this._modeRuntime) {
      this._modeRuntime = createModeRuntime({
        scene: this,
        Phaser,
        getGameData: () => gameData,
        getModeState: () => latestModeState,
        getMapObjects: () => mapObjects,
        getLocalPlayer: () => player,
        getOpponentPlayers: () => opponentPlayers,
        getTeamPlayers: () => teamPlayers,
      });
    }
    // End camera setup
  }

  initializeOtherPlayers() {
    const activeMapId = normalizeMapId(gameData?.map);
    // Create OpPlayer instances for other players
    gameData.players.forEach((playerData) => {
      if (playerData.name === username) {
        return; // Skip local player
      }

      const isTeammate = playerData.team === gameData.yourTeam;
      const playerContainer = isTeammate ? teamPlayers : opponentPlayers;
      const isBotPlayer = playerData?.isBot === true;

      // If an instance already exists for this name in this spawn version, upsert instead of re-create
      const existing = playerContainer[playerData.name];
      if (
        existing &&
        existing.opponent &&
        existing._spawnVersion === SPAWN_VERSION
      ) {
        // Ensure UI position is refreshed and exit
        try {
          const idx =
            typeof existing.spawnIndex === "number"
              ? existing.spawnIndex
              : typeof SERVER_SPAWN_INDEX[playerData.name] === "number"
                ? SERVER_SPAWN_INDEX[playerData.name]
                : 0;
          positionSpawn(
            this,
            existing.opponent,
            activeMapId,
            playerData.team,
            Math.max(0, idx),
          );
          if (hasServerPosition(playerData)) {
            const serverX = Number(playerData.x);
            const serverY = Number(playerData.y);

            existing.opponent.body?.reset?.(serverX, serverY);
          }
          existing.isBot = isBotPlayer;

          existing.finalizeSpawnPresentation?.();
          if (existing.updateUIPosition) existing.updateUIPosition();
        } catch (_) {}
        return;
      }

      // Determine spawn info from plan
      // Create OpPlayer instance with correct constructor parameters
      const opPlayer = new OpPlayer(
        this, // scene
        playerData.char_class, // character
        playerData.selected_skin_id || "", // skin
        playerData.name, // username
        isTeammate ? "teammate" : playerData.team, // team or teammate flag for ally coloring
        null,
        null,
        (gameData.players || []).filter((p) => p.team === playerData.team)
          .length,
        activeMapId,
      );

      // Tag instance with spawn version and optional server index to support idempotency
      opPlayer._spawnVersion = SPAWN_VERSION;
      if (typeof SERVER_SPAWN_INDEX[playerData.name] === "number") {
        opPlayer.spawnIndex = SERVER_SPAWN_INDEX[playerData.name];
      }
      opPlayer.isBot = isBotPlayer;

      // Snap opponent sprite to its map-specific spawn immediately
      try {
        const idx =
          typeof opPlayer.spawnIndex === "number"
            ? opPlayer.spawnIndex
            : typeof playerData.spawnIndex === "number"
              ? playerData.spawnIndex
              : 0;
        const index = Math.max(0, idx);
        positionSpawn(
          this,
          opPlayer.opponent,
          activeMapId,
          playerData.team,
          index,
        );
        if (hasServerPosition(playerData)) {
          const serverX = Number(playerData.x);
          const serverY = Number(playerData.y);

          opPlayer.opponent.body?.reset?.(serverX, serverY);
        }
        opPlayer.finalizeSpawnPresentation?.();
        if (opPlayer.updateUIPosition) opPlayer.updateUIPosition();
      } catch (_) {}

      // Apply server-sent max health if provided
      if (playerData.stats && typeof playerData.stats.health === "number") {
        opPlayer.opMaxHealth = playerData.stats.health;
        opPlayer.opCurrentHealth = playerData.stats.health;
      }
      if (typeof playerData.superCharge === "number") {
        opPlayer.opSuperCharge = playerData.superCharge;
      }
      if (typeof playerData.maxSuperCharge === "number") {
        opPlayer.opMaxSuperCharge = playerData.maxSuperCharge;
      }
      if (opPlayer.updateHealthBar) opPlayer.updateHealthBar();
      opPlayer.setPresenceState?.(
        playerData.connected !== false,
        playerData.loaded === true,
      );

      playerContainer[playerData.name] = opPlayer;

      // TTL self-clean: if this instance isn't the canonical mapping soon, destroy it to avoid ghosts
      setTimeout(() => {
        try {
          if (playerContainer[playerData.name] !== opPlayer) {
            if (typeof opPlayer.destroy === "function") opPlayer.destroy();
            else if (opPlayer.opponent?.destroy) opPlayer.opponent.destroy();
          }
        } catch (_) {}
      }, 1500);
    });
  }

  _renderPowerupsAndEffects() {
    syncLocalEffects({
      effects: latestPlayerEffects[username] || {},
      authoritative: latestEffectMovement[username],
      setMobility: setPowerupMobility,
      setInvisible: setPowerupInvisible,
    });
    this._powerupRenderer?.renderPowerupsAndEffects();
  }

  _renderModeObjectives() {
    this._modeRuntime?.render?.();
  }

  _enterSpectatorMode() {
    if (!this._spectatorModeActive) {
      this._spectatorModeActive = true;
      this._spectatorVignette = true;
      hud.showSpectatingBanner?.();
    }
    this._syncSpectatedPlayer();
  }

  _getSpectatablePlayers() {
    const roster = Array.isArray(gameData?.players) ? gameData.players : [];
    return roster
      .filter((entry) => {
        if (!entry?.name || entry.name === username) return false;
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

  _setSpectatedPlayer(name) {
    const candidates = this._getSpectatablePlayers();
    const selected =
      candidates.find((entry) => entry.name === name) || candidates[0] || null;
    const nextName = selected?.name || null;
    const changed = nextName !== this._spectatedPlayerName;
    const candidateCountChanged =
      candidates.length !== this._spectatorCandidateCount;

    if (changed) {
      for (const wrapper of [
        ...Object.values(opponentPlayers),
        ...Object.values(teamPlayers),
      ]) {
        wrapper?.setSpectated?.(!!nextName && wrapper.username === nextName);
      }
    }

    this._spectatedPlayerName = nextName;
    this._spectatedPlayerAudioSprite = selected?.wrapper?.opponent || null;
    this._spectatorCandidateCount = candidates.length;
    if (changed || candidateCountChanged) {
      hud.setSpectatingPlayer?.(nextName, { canSwitch: candidates.length > 1 });
    }

    const cam = this.cameras.main;
    if (!cam) return;
    if (!selected?.wrapper?.opponent) {
      if (!this._spectatorFallbackActive) {
        this._spectatorFallbackActive = true;
        this._spectatorCameraFollowing = false;
        const bounds = this._spectatorBounds || {};
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
    this._spectatorFallbackActive = false;
    const watchedPlayer = selected.wrapper.opponent;
    const cameraTarget = this._spectatorCameraTarget ||
      (this._spectatorCameraTarget = { x: 0, y: 0 });
    if (!this._spectatorCameraFollowing) {
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
        this._spectatorCameraFollowing = true;
      } catch (_) {}
    }
    // The camera remains attached to this proxy across player changes. Updating
    // its destination lets Phaser's follow lerp glide between fighters instead
    // of startFollow snapping straight to the newly selected sprite.
    cameraTarget.x = watchedPlayer.x;
    cameraTarget.y = watchedPlayer.y;
    // Keep the watched fighter lower in frame, revealing more of the platforms
    // above them, while staying substantially closer than the old map overview.
    cam.setFollowOffset(
      0,
      cam.followOffset.y + (180 - cam.followOffset.y) * 0.1,
    );
    cam.setZoom(cam.zoom + (1.55 - cam.zoom) * 0.075);
  }

  _syncSpectatedPlayer() {
    this._setSpectatedPlayer(this._spectatedPlayerName);
  }

  _cycleSpectatedPlayer(direction = 1) {
    const candidates = this._getSpectatablePlayers();
    if (!candidates.length) {
      this._setSpectatedPlayer(null);
      return;
    }
    const currentIndex = candidates.findIndex(
      (entry) => entry.name === this._spectatedPlayerName,
    );
    const step = direction < 0 ? -1 : 1;
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + step + candidates.length) % candidates.length;
    this._setSpectatedPlayer(candidates[nextIndex].name);
  }

  update() {
    attachCharacterNetworks(this, { localPlayer: player, localUsername: username,
      opponentPlayersRef: opponentPlayers, teamPlayersRef: teamPlayers });
    const suddenDeathEnabled = supportsSuddenDeath(latestModeState?.type || gameData?.modeId);
    const poisonAllowed =
      hasJoined &&
      gameInitialized &&
      !gameEnded &&
      !hud.isBattleIntroActive?.();
    if (!poisonAllowed || !suddenDeathEnabled) {
      try {
        this._poisonGraphics?.clear?.();
      } catch (_) {}
      try {
        const cssDiv = document.getElementById("poison-water-bg");
        if (cssDiv) cssDiv.style.display = "none";
      } catch (_) {}
      try {
        const vigEl = document.getElementById("water-vignette");
        if (vigEl) {
          vigEl.classList.remove("water-danger-active");
          vigEl.style.opacity = "0";
        }
      } catch (_) {}
    } else {
      renderPoisonWater(this, { player, dead });
    }

    // Powerup visuals/effects are rendered for all players every frame.
    this._renderPowerupsAndEffects();
    this._renderModeObjectives();
    battleTutorial.update();

    // The pregame flythrough (and its hand-back blend) owns the camera.
    // Before FIGHT, fighters stand at their spawns: no input or movement sync.
    const introCamera = matchIntro.updateCamera();
    if (!isLiveGame) {
      syncLocalUiPosition();
      if (!introCamera) updateDynamicCamera(this, player);
      updateHealthBars({ opponentPlayers, teamPlayers, syncPositions: true });
      return;
    }
    // Only process if game is initialized
    if (!hasJoined || !gameInitialized || gameEnded) return;

    if (dead) {
      this._enterSpectatorMode();
    } else {
      this._spectatorVignette = false;
      if (this._spectatorModeActive) {
        try {
          followLocalPlayer(this.cameras.main);
        } catch (_) {}
      }
      this._spectatorModeActive = false;
      this._spectatedPlayerName = null;
      this._spectatedPlayerAudioSprite = null;
      this._spectatorCandidateCount = 0;
      this._spectatorFallbackActive = false;
      this._spectatorCameraFollowing = false;
      for (const wrapper of [
        ...Object.values(opponentPlayers),
        ...Object.values(teamPlayers),
      ]) {
        wrapper?.setSpectated?.(false);
      }
      hud.hideSpectatingBanner?.();
      hud.hideSpectatingPlayer?.();
      if (!introCamera) updateDynamicCamera(this, player);
      localMovementCorrector.update(player, this.game?.loop?.delta ?? 16.67);
      localInputSync.sync(this, player, {
        dead,
        gameEnded,
        handlePlayerMovement,
      });
    }

    processSnapshotInterpolation({
      snapshotBuffer,
      now: performance.now(),
      applyFrame: (frame) =>
        this.interpolatePlayerStates(
          frame.aState,
          frame.bState,
          frame.alpha,
          frame,
        ),
      onDebugLine: (line) => {
        if (!shouldMuteClientDefaultLogs()) console.log(line);
      },
    });

    updateHealthBars({ opponentPlayers, teamPlayers });
    noteClientFrame(this.game.loop.delta);
  }

  /**
   * CRITICAL SAFEGUARD (Phase 2 netcode):
   * This function ONLY updates remote players (opponentPlayers and teamPlayers).
   * LOCAL PLAYER is NEVER snapped from snapshots and remains 100% Phaser physics-driven.
   *
   * Violating this would cause double-application of movement:
   * 1. handlePlayerMovement() applies physics: player.x += velocity * dt
   * 2. If snapshot also sets: player.x = snapshot.x
   * 3. Result: Position applied twice, then corrected → jitter/rubber-banding
   *
   * When server-side movement simulation (Phase 2B) is enabled, it will ONLY
   * be used for hit validation via stored position history. Snapshots will NOT
   * update the local player's position.
   */
  interpolatePlayerStates(aState, bState, alpha, frame = null) {
    const baseFrame = frame || { aState, bState, alpha, extrapolationMs: 0 };
    const hermiteAxis = (aValue, bValue, aVelocity, bVelocity, t, spanMs) => {
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
    const projectAxis = (
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
    const applyInterp = (wrapper, name) => {
      if (!wrapper || !wrapper.opponent) return;

      const now = performance.now();
      const sample = sampleRemoteFrame(
        snapshotBuffer,
        baseFrame,
        (wrapper._continuousSmoothing ||= {}),
        {
          attack:
            (Number(this._localAttackPrecisionUntil) || 0) > now ||
            (Number(wrapper._attackPrecisionUntil) || 0) > now,
          airborne: baseFrame.bState?.players?.[name]?.grounded === false,
          deltaMs: this.game?.loop?.delta || 16.67,
          snap: Number(wrapper._networkSnapUntil) > now,
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

      const isDeadBySnapshot =
        aPosData?.isAlive === false || bPosData?.isAlive === false;
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
      // Attack/airborne precision is handled by sampleRemoteFrame's small lead.
      let targetX = spr.x;
      let targetY = spr.y;
      if (isLoaded) {
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
          if (inRespawnShield) {
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
          const ride = remoteRideOffset(this, spr, targetX, targetY, sample.targetMono, platformClock());
          targetX += ride.x;
          targetY += ride.y;
        }
      }
      const shouldSnapToTarget =
        Number(wrapper._networkSnapUntil) > performance.now();

      if (!wrapper._deathPresentationActive && !wrapper._corpseRemoved) {
        if (shouldSnapToTarget) {
          spr.x = targetX;
          spr.y = targetY;
        } else {
          followRemotePosition(spr, targetX, targetY, {
            deltaMs: this.game?.loop?.delta ?? 16.67,
            attack:
              (Number(this._localAttackPrecisionUntil) || 0) > now ||
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
      setTeamHudPlayerPresence(name, isConnected);
      setTeamHudPlayerLoaded(name, isLoaded);
      setTeamHudPlayerAlive(name, !isDeadBySnapshot);

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
        const lockUntil = remoteAnimationLockUntil(spr, wrapper);
        if (performance.now() >= lockUntil) {
          const chosenAnim = chooseRemoteAnimation(wrapper.character, {
            animation: animSrc.animation || "idle",
            previousPosition: aPosData,
            currentPosition: bPosData,
            sprite: spr,
          });
          playCharacterAnimation({
            scene: this,
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

      // Keep remote UI positioning centralized in OpPlayer so one offset controls all updates.
      // Bars are drawn once afterwards by the frame's updateHealthBars pass.
      if (typeof wrapper.updateUIPosition === "function") {
        wrapper.updateUIPosition({ drawBars: false });
      }
    };

    for (const name in opponentPlayers) {
      applyInterp(opponentPlayers[name], name);
    }
    for (const name in teamPlayers) {
      applyInterp(teamPlayers[name], name);
    }
  }
}

function stabilizeSpawnedSpriteOnMap(scene, sprite, objects) {
  if (!scene?.physics?.world || !sprite || !Array.isArray(objects)) return;
  try {
    sprite.body?.updateFromGameObject?.();
  } catch (_) {}
  try {
    sprite.setVelocity?.(0, 0);
    sprite.setAcceleration?.(0, 0);
  } catch (_) {}
  for (const mapObject of objects) {
    if (!mapObject) continue;
    try {
      scene.physics.world.collide(sprite, mapObject);
    } catch (_) {}
  }
}

const config = {
  audio: { context: window.__BB_NAVIGATION__?.getAudioContext() },
  // Prefer WebGL; Phaser falls back to Canvas when WebGL is unavailable.
  type: Phaser.AUTO,
  transparent: true,
  backgroundColor: "rgba(0,0,0,0)",
  // Pixel-art friendly settings
  pixelArt: true,
  roundPixels: false, // allow subpixel rendering for smoother interpolation (adaptive timeline)
  antialias: false,
  // Shared backing-resolution control preserves FIT size and world coordinates.
  callbacks: {
    postBoot: (game) => {
      game.canvas.dataset.gameRenderer = game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
      document.dispatchEvent(new Event('bb:rendererchange'));
      game.events.once(Phaser.Core.Events.DESTROY, () => {
        delete game.canvas.dataset.gameRenderer;
        document.dispatchEvent(new Event('bb:rendererchange'));
      });
      installViewportFit(game);
      installAmbientBezels(game);
      const renderResolution = installRenderResolution(game, Phaser, graphicsRenderScale(getSettings().graphics));
      if (renderResolution) {
        let currentScale = graphicsRenderScale(getSettings().graphics);
        const off = subscribeSettings(settings => {
          const nextScale = graphicsRenderScale(settings.graphics);
          if (nextScale === currentScale) return;
          currentScale = nextScale;
          renderResolution.setScale(nextScale);
        });
        game.events.once(Phaser.Core.Events.DESTROY, off);
      }
    },
  },
  // Let Phaser sleep with the page. Network state keeps arriving, and the
  // visibility resync above restores only the latest authoritative state.
  disableVisibilityChange: false,
  scale: {
    // Makes sure the game looks good on all screens
    mode: Phaser.Scale.FIT,
    // We'll position the canvas via CSS, so disable Phaser auto centering
    autoCenter: Phaser.Scale.NO_CENTER,
    // Fills the window, trimming the view within limits (gameViewport.js).
    ...initialGameSize(),
  },
  scene: GameScene,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: MOVEMENT_PHYSICS.gravity },
      debug: false,
    },
  },
};

export { opponentPlayers, teamPlayers };

// Phaser's startFollow resets the follow offset to (0, 0) unless given one,
// which visibly snaps the framing; keep the offset the camera already has.
function followLocalPlayer(cam) {
  if (!cam || !player) return;
  cam.startFollow(player, false, FOLLOW_LERP.x, FOLLOW_LERP.y, cam.followOffset.x, cam.followOffset.y);
}

// Tell the server our loading screen lifted (our pregame began). Sent once per
// socket; the start watchdog may `force` a resend, which the server ignores if
// it already counted us.
function trySendReadyAck(force = false) {
  if (!clientRevealed || !gameScene || !player || !hasJoined || !socket.connected) return;
  if (!force && readyAckSocketId === socket.id) return;
  try {
    readyAckSocketId = socket.id;
    socket.emit("game:ready", { matchId: Number(matchId) });
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Sent game:ready ack");
    } else {
      noteClientLifecycle("ready-ack", "");
    }
  } catch (_) {}
}

// -----------------------------
// Simple Game Over Overlay
// -----------------------------
function showGameOverScreen(payload) {
  if (gameScene) gameScene._battleEnded = true;
  try {
    destroyMobileControls?.();
  } catch (_) {}
  gameOverScreenController.showGameOverScreen(payload);
}

if (editorSession) {
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();event.stopImmediatePropagation();
      window.parent.postMessage({type:'bb-map-playtest-exit'},window.location.origin);
    } else if (event.code === 'KeyQ' && !event.repeat && gameData?.editorSoloPlaytest && !isChatInputActive()) {
      event.preventDefault();event.stopImmediatePropagation();
      socket.emit('editor:self-kill');
    }
  },true);
}
