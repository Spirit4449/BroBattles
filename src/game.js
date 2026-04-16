// game.js

import {
  buildMap,
  positionSpawn,
  getMapBgAsset,
  getMapMusicAsset,
  getMapObjects,
  getMapBoundaryConfig,
  normalizeMapId,
} from "./maps/manifest";
import { applyMapBounds } from "./maps/mapUtils";
import { createGameHudController } from "./hud/gameHudController";
import { createGameOverScreenController } from "./hud/gameOverScreenController";
import { wireFullscreenToggles } from "./lib/fullscreen.js";
import { createGameChatController } from "./lib/chatController.js";
import { isChatInputActive, setChatInputActive } from "./player";
import "./styles/chat.css";
import { createSnapshotBuffer } from "./match/snapshotBuffer";
import { createMatchCoordinator } from "./match/matchCoordinator";
import { preloadGameAssets } from "./gameScene/preloadGameAssets";
import { renderPoisonWater } from "./gameScene/poisonWaterRenderer";
import { updateDynamicCamera } from "./gameScene/cameraDynamics";
import { createLocalInputSync } from "./gameScene/localInputSync";
import { processSnapshotInterpolation } from "./gameScene/networkInterpolation";
import { updateHealthBars } from "./gameScene/healthBarUpdater";
import { createMapEditorRuntime } from "./gameScene/mapEditorRuntime";
import { createBankBustRuntime } from "./modes/bankBust/runtime";
import {
  POWERUP_TYPES,
  POWERUP_ASSET_DIR,
  POWERUP_COLORS,
  createPowerupTickSounds,
} from "./powerups/powerupConfig";
import { createPowerupRenderer } from "./powerups/powerupRenderer";
import { RENDER_LAYERS } from "./gameScene/renderLayers";
import {
  createPlayer,
  finalizeLocalSpawnPresentation,
  player,
  handlePlayerMovement,
  dead,
  setSuperStats,
  setPowerupMobility,
  applyAuthoritativeState,
  getAmmoSyncState,
  getNetworkInputState,
  setLocalNetStateFlusher,
} from "./player";
import {
  preloadAll,
  handleLocalAuthoritativeAttack,
  handleRemoteAttack,
  setupAll,
  resolveAnimKey,
  chooseRemoteAnimation,
  setAttackDebugState,
  applyCharacterPowerupFx,
  drawCharacterPowerupAura,
  getCharacterPowerupMobilityModifier,
  getCharacterEffectTickSounds,
} from "./characters";
import socket, { waitForConnect } from "./socket";
import OpPlayer from "./opPlayer";
import { spawnDust, prewarmDust } from "./effects";
import {
  configureClientNetTest,
  noteClientFrame,
  noteClientLifecycle,
  shouldMuteClientDefaultLogs,
} from "./lib/netTestLogger.js";
import MOVEMENT_PHYSICS from "./shared/movementPhysics.json";

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
const MAX_TOP_PLAYFIELD_PADDING = 320;

function getViewportAdaptiveGameHeight() {
  const viewportWidth = Math.max(
    1,
    Number(window.innerWidth) ||
      Number(document.documentElement?.clientWidth) ||
      BASE_GAME_WIDTH,
  );
  const viewportHeight = Math.max(
    1,
    Number(window.innerHeight) ||
      Number(document.documentElement?.clientHeight) ||
      BASE_GAME_HEIGHT,
  );
  const fittedHeight = Math.round(
    (BASE_GAME_WIDTH * viewportHeight) / viewportWidth,
  );
  return Math.max(
    BASE_GAME_HEIGHT,
    Math.min(BASE_GAME_HEIGHT + MAX_TOP_PLAYFIELD_PADDING, fittedHeight),
  );
}

function getTopPlayfieldPadding() {
  return Math.max(0, getViewportAdaptiveGameHeight() - BASE_GAME_HEIGHT);
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
let startingPhase = false; // server announced starting phase
let readyAckSent = false; // ensure single ready ack
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
let latestPlayerEffects = {}; // name -> effect duration map (ms remaining)
const POWERUP_COLLECT_QUEUE = [];
const DEATHDROP_COLLECT_QUEUE = [];
const LAST_HEALTH_BY_PLAYER = Object.create(null);
const SHIELD_IMPACT_QUEUE = [];
const LAST_SHIELD_ACTIVE_AT = Object.create(null);
const POST_MATCH_REWARD_STORAGE_KEY = "bb_post_match_rewards_v1";
const EDIT_CAMERA_SCROLL_SPEED = 14;

function updateEditorCamera(scene) {
  if (!scene || !scene._editModeActive) return;
  const cam = scene.cameras?.main;
  const keys = scene._editorCamKeys;
  if (!cam || !keys) return;

  let dx = 0;
  let dy = 0;

  if (keys.left?.isDown || keys.leftAlt?.isDown) dx -= 1;
  if (keys.right?.isDown || keys.rightAlt?.isDown) dx += 1;
  if (keys.up?.isDown || keys.upAlt?.isDown) dy -= 1;
  if (keys.down?.isDown || keys.downAlt?.isDown) dy += 1;

  if (dx === 0 && dy === 0) return;

  const step = EDIT_CAMERA_SCROLL_SPEED / Math.max(0.3, cam.zoom || 1);
  cam.scrollX += dx * step;
  cam.scrollY += dy * step;
}

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
const snapshotBuffer = createSnapshotBuffer();

// Game scene reference
let gameScene = null;

// matchCoordinator is declared here and instantiated after hud/snapshotBuffer below.
// It is created at module scope so all state setters close over the let variables.
let matchCoordinator = null;

const hud = createGameHudController({
  getGameData: () => gameData,
  getUsername: () => username,
  getMapBgAsset,
  getScene: () => gameScene,
  onCountdownFight: () => {
    try {
      gameScene?._startMainBgm?.();
    } catch (_) {}
  },
  onEnableInput: () => {
    try {
      if (gameScene && gameScene.input?.keyboard) {
        gameScene.input.keyboard.enabled = true;
      }
    } catch (_) {}
  },
});

const gameOverScreenController = createGameOverScreenController({
  getGameData: () => gameData,
  getUsername: () => username,
  rewardStorageKey: POST_MATCH_REWARD_STORAGE_KEY,
});

// Wire all server socket event handling for the live match.
// Function declarations below (startSuddenDeathMusic, etc.) are hoisted so this
// can safely reference them even though they appear later in the file.
matchCoordinator = createMatchCoordinator({
  socket,
  getGameData: () => gameData,
  getUsername: () => username,
  getJoinPayload: () => __joinPayload,
  getGameScene: () => gameScene,
  getPlayer: () => player,
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
  },
  getGameEnded: () => gameEnded,
  setGameEnded: (v) => {
    gameEnded = v;
  },
  setStartingPhase: (v) => {
    startingPhase = v;
  },
  setPendingAuthoritativeLocalState: (v) => {
    pendingAuthoritativeLocalState = v;
  },
  getSpawnVersion: () => SPAWN_VERSION,
  setSpawnVersion: (v) => {
    SPAWN_VERSION = v;
  },
  serverSpawnIndex: SERVER_SPAWN_INDEX,
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
  onStartSuddenDeathMusic: startSuddenDeathMusic,
  onStopSuddenDeathMusic: stopSuddenDeathMusic,
  onPlayMatchEndSound: playMatchEndSound,
  onShowGameOverScreen: showGameOverScreen,
});

// Ensure listeners are not kept around when the tab navigates away.
window.addEventListener(
  "beforeunload",
  () => {
    try {
      matchCoordinator?.dispose();
    } catch (_) {}
  },
  { once: true },
);

function startSuddenDeathMusic() {
  if (!gameScene || !gameScene.sound) return;
  try {
    try {
      gameScene._bgmEl?.pause();
    } catch (_) {}
    if (!gameScene._suddenDeathMusicSfx) {
      gameScene._suddenDeathMusicSfx = gameScene.sound.add("sfx-sudden-death", {
        loop: true,
        volume: 0.32,
      });
    }
    if (!gameScene._suddenDeathMusicSfx.isPlaying) {
      gameScene._suddenDeathMusicSfx.play();
    }
  } catch (_) {}
}

function stopSuddenDeathMusic() {
  if (!gameScene || !gameScene._suddenDeathMusicSfx) return;
  try {
    if (gameScene._suddenDeathMusicSfx.isPlaying) {
      gameScene._suddenDeathMusicSfx.stop();
    }
  } catch (_) {}
}

function playMatchEndSound(winnerTeam) {
  if (!gameScene || !gameScene.sound) return;
  const key =
    winnerTeam == null
      ? null
      : winnerTeam === gameData?.yourTeam
        ? "win"
        : "lose";
  if (!key) return;
  const trigger = () => {
    try {
      gameScene._bgmEl?.pause();
    } catch (_) {}
    try {
      gameScene.sound.play(key, {
        volume: key === "win" ? 0.55 : 0.48,
      });
    } catch (_) {}
  };
  if (gameScene.sound.locked) {
    gameScene.sound.once("unlocked", trigger);
    return;
  }
  trigger();
}

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

// Prewarm frequently used textures to force GL upload before gameplay
function prewarmTextures(scene) {
  try {
    const keys = [
      // Character main atlases
      "ninja",
      "draven",
      "thorg",
      // Attack visuals
      "draven-explosion",
      "shuriken",
      "thorg-weapon",
    ];
    const spawned = [];
    for (const key of keys) {
      if (!scene.textures.exists(key)) continue;
      // Heuristic: atlases are fine as sprites; plain images as images
      const isAtlas =
        !!scene.textures.get(key)?.frameTotal &&
        scene.textures.get(key).frameTotal > 1;
      let obj = null;
      if (isAtlas) {
        obj = scene.add.sprite(-9999, -9999, key);
      } else {
        obj = scene.add.image(-9999, -9999, key);
      }
      if (obj) {
        obj.setVisible(false);
        spawned.push(obj);
      }
    }
    // Destroy on next tick once GL textures are created
    scene.time.delayedCall(0, () => {
      for (const o of spawned) {
        try {
          o.destroy();
        } catch (_) {}
      }
    });
  } catch (_) {}
}

// Fetch game data from server
async function fetchGameData() {
  try {
    const response = await fetch("/gamedata", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ matchId: Number(matchId) }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to fetch game data");
    }

    return result.gameData;
  } catch (error) {
    console.error("Failed to fetch game data:", error);
    hud.showSystemNotice?.({
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
    gameData = await fetchGameData();
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
    console.error("Failed to initialize game:", error);
  }
}

// -----------------------------
// Battle Start Overlay (static DOM in game.html)
// -----------------------------
function showBattleStartOverlay(players) {
  return hud.showBattleStartOverlay(players);
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

function applyMatchBackground(mapId) {
  try {
    const bgUrl = getMapBgAsset(mapId);
    const bgImg = document.querySelector("#game-bg img");
    if (bgImg && bgUrl) {
      bgImg.setAttribute("src", bgUrl);
      bgImg.style.transform = "translate3d(0,0,0) scale(1)";
    }
  } catch (_) {}
}

function updateMatchBackgroundParallax(scene) {
  try {
    const bgImg = document.querySelector("#game-bg img");
    const activeMapId = normalizeMapId(gameData?.map);
    if (!bgImg || activeMapId !== 4) {
      if (bgImg) bgImg.style.transform = "translate3d(0,0,0) scale(1)";
      return;
    }
    const cam = scene?.cameras?.main;
    if (!cam) return;
    // Smooth parallax with clamped shift to prevent exposing white edges.
    const parallaxFactor = 0.35;
    const worldW = Math.max(
      1,
      Number(scene?.physics?.world?.bounds?.width) || 2300,
    );
    const viewportW = Math.max(
      1,
      Number(window.innerWidth) || Number(scene?.scale?.width) || 1280,
    );
    const baseScale = 1.22;
    const effectiveBgW = Math.max(viewportW, viewportW * baseScale);
    const maxOverflow = Math.max(0, effectiveBgW - viewportW);
    const progress = Phaser.Math.Clamp(
      (Number(cam.scrollX) || 0) / worldW,
      0,
      1,
    );
    const parallaxShift = -maxOverflow * progress * parallaxFactor;
    const shiftPx = Phaser.Math.Clamp(parallaxShift, -maxOverflow, 0);
    bgImg.style.transform = `translate3d(${shiftPx}px,0,0) scale(${baseScale})`;
    bgImg.style.transformOrigin = "50% 100%";
  } catch (_) {}
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

function attachMapCollidersToSprite(scene, sprite, objects) {
  if (!scene?.physics || !sprite || !Array.isArray(objects)) return;
  for (const mapObject of objects) {
    if (!mapObject) continue;
    try {
      scene.physics.add.collider(sprite, mapObject);
    } catch (_) {}
  }
}

// Initialize game when page loads
window.__BOOT_GAME__ = () =>
  onReady(() => {
    initKeybindHud();
    initTimerHud();
    initializeGame();
  });

// Phaser class to setup the game
class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
    this._topPlayfieldPadding = getTopPlayfieldPadding();
  }

  // Preloads assets
  preload() {
    this.load.on("progress", (p) => {
      // 50% - 90%
      const pct = Math.floor(50 + p * 40); // maps 0-1 -> 50-90
      updateLoading(pct, `Loading assets...`);
    });

    this.load.once("complete", () => {
      updateLoading(95, "Assets loaded");
      // Overlay will be controlled strictly by socket events (game:starting/game:start/init/live)
      // Do not show here to avoid race with late-arriving init/live status.
      // Input will be enabled on game:start or immediately if already live.
    });

    preloadGameAssets({
      scene: this,
      staticPath,
      powerupTypes: POWERUP_TYPES,
      powerupAssetDir: POWERUP_ASSET_DIR,
      preloadAllCharacters: preloadAll,
    });
  }

  create() {
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
    this._bankBustRuntime = null;
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
      setPowerupMobility,
      applyCharacterPowerupFx,
      drawCharacterPowerupAura,
      getCharacterPowerupMobilityModifier,
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
    updateLoading(100, "Starting...");
  }

  initializeGameWorld() {
    // New spawn version for this scene
    SPAWN_VERSION = Math.max(SPAWN_VERSION, Date.now());
    this._topPlayfieldPadding = getTopPlayfieldPadding();
    const activeMapId = normalizeMapId(gameData?.map);
    // No per-scene spawn plan needed now; map modules provide positioning helpers
    // Creates the map objects based on game data
    buildMap(this, activeMapId);
    mapObjects = getMapObjects(activeMapId);
    this._mapObjects = mapObjects;
    const mapBoundaryConfig = getMapBoundaryConfig(activeMapId);
    applyMapBounds(this, mapBoundaryConfig, {
      extraTopSpace: this._topPlayfieldPadding,
    });
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

    // Ensure all character animations are registered for this scene
    setupAll(this);

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
            handleRemoteAttack(this, charKey, act, wrapper);
          } catch (_) {}
        }
        if (retryActions.length) {
          PENDING_ACTIONS.push(...retryActions);
        }
      }
    } catch (_) {}

    // Prewarm textures is only meaningful for WebGL (uploads to GPU)
    try {
      if (
        this.game &&
        this.game.config &&
        this.game.config.renderType === Phaser.WEBGL
      ) {
        prewarmTextures(this);
      }
    } catch (_) {}

    // Background music: create only the active map's track and start it
    // as soon as the match scene is live.
    this._bgmStarted = false;
    applyMatchBackground(gameData?.map);
    const bgmSrc = getMapMusicAsset(gameData?.map);
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
          el.volume = 0.05;
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
              this._bgmEl?.play();
            } catch (_) {}
          });
        }
        const p = this._bgmEl.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
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
    this._startMainBgm();

    this.events.once("shutdown", () => {
      try {
        matchCoordinator?.dispose();
      } catch (_) {}
      try {
        this._bankBustRuntime?.destroy?.();
      } catch (_) {}
      this._bankBustRuntime = null;
      try {
        this._mapEditorRuntime?.destroy?.();
      } catch (_) {}
      this._mapEditorRuntime = null;
      stopSuddenDeathMusic();
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
    );

    attachMapCollidersToSprite(this, player, mapObjects);

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
    const hasAuthoritativeSpawn =
      pendingAuthoritativeLocalState &&
      pendingAuthoritativeLocalState.loaded === true &&
      Number.isFinite(pendingAuthoritativeLocalState.x) &&
      Number.isFinite(pendingAuthoritativeLocalState.y) &&
      player?.body;

    // After sprite exists and body sized, move to a map-appropriate spawn slot
    // only when we do not already have an authoritative live position.
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
        const teamSize = (gameData.players || []).filter(
          (p) => p.team === gameData.yourTeam,
        ).length;
        positionSpawn(
          this,
          player,
          activeMapId,
          gameData.yourTeam,
          myIndex,
          teamSize,
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
    this.input.keyboard.on("keydown-M", (e) => {
      if (!e.ctrlKey) return;
      const world = this.physics?.world;
      if (!world) return;
      const enable = !world.drawDebug;
      world.drawDebug = enable;
      try {
        setAttackDebugState(enable);
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
    });

    // Camera: smooth follow
    const cam = this.cameras.main;
    if (!mapBoundaryConfig?.camera) {
      cam.setZoom(1.7);
      const contentCenterX = BASE_GAME_WIDTH / 2;
      cam.setBounds(contentCenterX - 850, -40, 2000, BASE_GAME_HEIGHT);
      cam.setDeadzone(50, 50);
      cam.setFollowOffset(0, 120);
    }

    // lerpX=0.08 for crisp horizontal tracking; lerpY=0.05 is deliberately
    // lazier so the vertical frame shifts more gently - vertical centering is
    // less critical than horizontal awareness.
    cam.startFollow(player, false, 0.08, 0.05);
    this._editModeActive = false;
    this._editorCamKeys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftAlt: Phaser.Input.Keyboard.KeyCodes.A,
      rightAlt: Phaser.Input.Keyboard.KeyCodes.D,
      upAlt: Phaser.Input.Keyboard.KeyCodes.W,
      downAlt: Phaser.Input.Keyboard.KeyCodes.S,
    });

    if (!this._mapEditorRuntime) {
      this._mapEditorRuntime = createMapEditorRuntime({
        scene: this,
        mapId: activeMapId,
        mapObjects,
        canEdit: !!gameData?.isAdmin,
        onCreateMapObject: (mapObject) => {
          if (!mapObject) return;
          try {
            if (player) this.physics.add.collider(player, mapObject);
          } catch (_) {}
        },
        onEditModeChange: (editing) => {
          try {
            this._editModeActive = !!editing;
            window.__BB_MAP_EDIT_ACTIVE = !!editing;
            try {
              this._bankBustRuntime?.setEditMode?.(!!editing);
            } catch (_) {}
            if (this._editModeActive) {
              try {
                player?.setVelocity?.(0, 0);
              } catch (_) {}
              try {
                this.cameras.main.stopFollow();
              } catch (_) {}
            } else {
              try {
                this.cameras.main.startFollow(player, false, 0.08, 0.05);
              } catch (_) {}
            }
            hud.setTimerPaused?.(!!editing);
          } catch (_) {}
        },
      });
    }
    if (!this._bankBustRuntime) {
      this._bankBustRuntime = createBankBustRuntime({
        scene: this,
        Phaser,
        getGameData: () => gameData,
        getModeState: () => latestModeState,
        getMapObjects: () => mapObjects,
        getLocalPlayer: () => player,
        getOpponentPlayers: () => opponentPlayers,
        getTeamPlayers: () => teamPlayers,
        canEdit: !!gameData?.isAdmin,
      });
      this._bankBustRuntime.setEditMode?.(!!this._editModeActive);
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
            (gameData.players || []).filter((p) => p.team === playerData.team)
              .length,
          );
          if (
            isLiveGame &&
            playerData.loaded === true &&
            Number.isFinite(playerData.x) &&
            Number.isFinite(playerData.y)
          ) {
            existing.opponent.body?.reset?.(playerData.x, playerData.y);
          }
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
          (gameData.players || []).filter((p) => p.team === playerData.team)
            .length,
        );
        if (
          isLiveGame &&
          playerData.loaded === true &&
          Number.isFinite(playerData.x) &&
          Number.isFinite(playerData.y)
        ) {
          opPlayer.opponent.body?.reset?.(playerData.x, playerData.y);
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
    this._powerupRenderer?.renderPowerupsAndEffects();
  }

  _renderModeObjectives() {
    this._bankBustRuntime?.render?.();
  }

  _enterSpectatorMode() {
    if (this._spectatorModeActive) return;
    this._spectatorModeActive = true;
    this._spectatorVignette = true;
    hud.showSpectatingBanner?.();

    const cam = this.cameras.main;
    if (!cam) return;
    try {
      cam.stopFollow();
    } catch (_) {}

    const bounds = this._spectatorBounds || {};
    const targetX =
      Number(bounds.centerX) ||
      Number(this.physics?.world?.bounds?.centerX) ||
      1150;
    const targetY =
      Number(bounds.centerY) ||
      Number(this.physics?.world?.bounds?.centerY) ||
      500;
    const width = Math.max(
      1,
      Number(bounds.width) ||
        Number(this.physics?.world?.bounds?.width) ||
        2300,
    );
    const height = Math.max(
      1,
      Number(bounds.height) ||
        Number(this.physics?.world?.bounds?.height) ||
        1000,
    );
    const zoomX = (Number(this.scale?.width) || width) / width;
    const zoomY = (Number(this.scale?.height) || height) / height;
    const targetZoom = Phaser.Math.Clamp(
      Math.min(1, Math.min(zoomX, zoomY) * 0.985),
      0.82,
      1,
    );
    const raisedTargetY = targetY - Math.min(140, height * 0.12);

    try {
      cam.pan(targetX, raisedTargetY, 900, "Cubic.easeOut");
    } catch (_) {}
    try {
      cam.zoomTo(targetZoom, 900, "Quad.easeOut");
    } catch (_) {
      cam.setZoom(targetZoom);
    }
  }

  update() {
    updateMatchBackgroundParallax(this);
    const isBankBustMode = String(latestModeState?.type || "") === "bank-bust";
    const poisonAllowed =
      hasJoined &&
      gameInitialized &&
      !gameEnded &&
      !hud.isBattleIntroActive?.();
    if (!poisonAllowed || this._editModeActive || isBankBustMode) {
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

    if (this._editModeActive) {
      try {
        player?.setVelocity?.(0, 0);
      } catch (_) {}
      updateEditorCamera(this);
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
          this.cameras.main.startFollow(player, false, 0.08, 0.05);
        } catch (_) {}
      }
      this._spectatorModeActive = false;
      hud.hideSpectatingBanner?.();
      updateDynamicCamera(this, player, Phaser);
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
    const extrapolationMs = Math.max(0, Number(frame?.extrapolationMs) || 0);
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
    const filterRemoteTarget = (
      wrapper,
      rawTargetX,
      rawTargetY,
      previousSnapshot,
      currentSnapshot,
    ) => {
      const prevAcceptedX = Number(wrapper._filteredTargetX);
      const prevAcceptedY = Number(wrapper._filteredTargetY);
      if (!Number.isFinite(prevAcceptedX) || !Number.isFinite(prevAcceptedY)) {
        wrapper._filteredTargetX = rawTargetX;
        wrapper._filteredTargetY = rawTargetY;
        return { x: rawTargetX, y: rawTargetY };
      }

      const incomingDx = rawTargetX - prevAcceptedX;
      const stableDir = Number(wrapper._stableTargetDirX) || 0;
      const snapshotDx =
        Number(currentSnapshot?.x) - Number(previousSnapshot?.x);
      const snapshotVx = Number(currentSnapshot?.vx);
      const motionHint =
        Number.isFinite(snapshotVx) && Math.abs(snapshotVx) > 35
          ? Math.sign(snapshotVx)
          : Number.isFinite(snapshotDx) && Math.abs(snapshotDx) > 1.25
            ? Math.sign(snapshotDx)
            : 0;
      const incomingDir =
        Math.abs(incomingDx) > 0.75 ? Math.sign(incomingDx) : 0;
      const reverseAgainstTrend =
        stableDir !== 0 &&
        incomingDir !== 0 &&
        incomingDir === -stableDir &&
        Math.abs(incomingDx) >= 6;
      const reverseConfirmed = motionHint !== 0 && motionHint === incomingDir;
      const nowPerf = performance.now();

      if (reverseAgainstTrend && !reverseConfirmed) {
        const pending = wrapper._reverseTargetCandidate;
        if (
          !pending ||
          pending.dir !== incomingDir ||
          nowPerf - pending.at > 180
        ) {
          wrapper._reverseTargetCandidate = {
            dir: incomingDir,
            at: nowPerf,
          };
          return { x: prevAcceptedX, y: prevAcceptedY };
        }
      } else {
        wrapper._reverseTargetCandidate = null;
      }

      if (incomingDir !== 0) {
        wrapper._stableTargetDirX = incomingDir;
      }
      wrapper._filteredTargetX = rawTargetX;
      wrapper._filteredTargetY = rawTargetY;
      return { x: rawTargetX, y: rawTargetY };
    };

    const applyInterp = (wrapper, name) => {
      if (!wrapper || !wrapper.opponent) return;

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
      // During a combat precision window (opened when we receive an attack from this
      // opponent), blend toward their newest known snapshot position at a higher rate
      // (effectiveAlpha ≥ 0.85) to shrink the visual-vs-authoritative gap on hits.
      let targetX = spr.x;
      let targetY = spr.y;
      if (isLoaded) {
        const inPrecision =
          (Number(wrapper._attackPrecisionUntil) || 0) > performance.now();
        const airborne = !(bPosData?.grounded ?? aPosData?.grounded ?? false);
        const effectiveAlpha = inPrecision
          ? Math.max(alpha, 0.85)
          : airborne
            ? Math.max(alpha, 0.72)
            : alpha;
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
            targetX = projectAxis(aX, bX, stateDeltaMs, bPosData?.vx);
            targetY = projectAxis(aY, bY, stateDeltaMs, bPosData?.vy, {
              vertical: true,
              airborne,
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
      }
      const shouldSnapToTarget =
        Number(wrapper._networkSnapUntil) > performance.now();
      if (shouldSnapToTarget) {
        wrapper._filteredTargetX = targetX;
        wrapper._filteredTargetY = targetY;
        wrapper._stableTargetDirX = 0;
        wrapper._reverseTargetCandidate = null;
      } else {
        const filteredTarget = filterRemoteTarget(
          wrapper,
          targetX,
          targetY,
          aPosData,
          bPosData,
        );
        targetX = filteredTarget.x;
        targetY = filteredTarget.y;
      }

      if (!wrapper._deathPresentationActive && !wrapper._corpseRemoved) {
        if (shouldSnapToTarget) {
          spr.x = targetX;
          spr.y = targetY;
        } else {
          // Move toward interpolated target with a bounded step.
          // This prevents visible twitch from sudden target jumps while still catching up fast.
          const dx = targetX - spr.x;
          const dy = targetY - spr.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.35) {
            const inPrecision =
              (Number(wrapper._attackPrecisionUntil) || 0) > performance.now();
            const airborne = !(
              bPosData?.grounded ??
              aPosData?.grounded ??
              false
            );
            const dtMs = Math.max(1, Number(this.game?.loop?.delta) || 16.7);
            const followSpeedPxPerSec = inPrecision
              ? 3000
              : airborne
                ? 2300
                : 1500;
            const maxStep = (followSpeedPxPerSec * dtMs) / 1000;
            const snapDistance = inPrecision ? 1.5 : airborne ? 1.25 : 0.9;
            if (dist > 520 || dist <= snapDistance) {
              spr.x = targetX;
              spr.y = targetY;
            } else {
              const step = Math.min(maxStep, dist);
              spr.x += (dx / dist) * step;
              spr.y += (dy / dist) * step;
            }
          }
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
        const prevFlip = spr.flipX;
        spr.flipX = !!animSrc.flip;
        if (
          spr.flipX !== prevFlip &&
          typeof wrapper.applyFlipOffset === "function"
        ) {
          wrapper.applyFlipOffset();
        }
        const lockUntil = Math.max(
          Number(wrapper._animLockUntil || 0),
          Number(spr._specialAnimLockUntilPerf || 0),
        );
        if (performance.now() >= lockUntil) {
          const chosenAnim = chooseRemoteAnimation(wrapper.character, {
            animation: animSrc.animation || "idle",
            previousPosition: aPosData,
            currentPosition: bPosData,
            sprite: spr,
          });
          spr.anims.play(
            resolveAnimKey(this, wrapper.character, chosenAnim, "idle"),
            true,
          );
        }
      }

      // Keep remote UI positioning centralized in OpPlayer so one offset controls all updates.
      if (typeof wrapper.updateUIPosition === "function") {
        wrapper.updateUIPosition();
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
  // Force Canvas renderer; enable transparency so the canvas can show the HTML/CSS background behind it
  type: Phaser.CANVAS,
  transparent: true,
  backgroundColor: "rgba(0,0,0,0)",
  // Pixel-art friendly settings
  pixelArt: true,
  roundPixels: false, // allow subpixel rendering for smoother interpolation (adaptive timeline)
  antialias: false,
  resolution: window.devicePixelRatio,
  disableVisibilityChange: true, // keep running when tab is unfocused
  scale: {
    // Makes sure the game looks good on all screens
    mode: Phaser.Scale.FIT,
    // We'll position the canvas via CSS, so disable Phaser auto centering
    autoCenter: Phaser.Scale.NO_CENTER,
    width: BASE_GAME_WIDTH,
    height: getViewportAdaptiveGameHeight(),
  },
  scene: GameScene,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 800 },
      debug: false,
    },
  },
};

const game = new Phaser.Game(config);

export { opponentPlayers, teamPlayers };

function buildReadyPayload() {
  const payload = { matchId: Number(matchId) };
  const authoritativeSpawn =
    pendingAuthoritativeLocalState &&
    pendingAuthoritativeLocalState.loaded === true &&
    Number.isFinite(pendingAuthoritativeLocalState.x) &&
    Number.isFinite(pendingAuthoritativeLocalState.y)
      ? pendingAuthoritativeLocalState
      : null;
  if (authoritativeSpawn) {
    payload.x = authoritativeSpawn.x;
    payload.y = authoritativeSpawn.y;
  } else if (player) {
    if (Number.isFinite(player.x)) payload.x = player.x;
    if (Number.isFinite(player.y)) payload.y = player.y;
  } else {
    return payload;
  }
  payload.flip = player ? !!player.flipX : false;
  payload.animation = player?.anims?.currentAnim?.key || null;
  return payload;
}

// Emit a one-time game:ready handshake once the scene exists and the server can
// use the local player's real spawn position instead of waiting for movement.
function trySendReadyAck() {
  if (readyAckSent) return;
  const sceneReady = !!gameScene && !!player; // player created implies scene ready
  if (!sceneReady || (!startingPhase && !isLiveGame)) return;
  try {
    readyAckSent = true;
    socket.emit("game:ready", buildReadyPayload());
    if (!shouldMuteClientDefaultLogs()) {
      console.log("Sent game:ready ack");
    } else {
      noteClientLifecycle("ready-ack", "");
    }
  } catch (_) {}
}

function startCountdown() {
  return hud.startCountdown();
}

function hideBattleStartOverlay() {
  return hud.hideBattleStartOverlay();
}

// -----------------------------
// Simple Game Over Overlay
// -----------------------------
function showGameOverScreen(payload) {
  if (window.__BB_MAP_EDIT_ACTIVE) return;
  gameOverScreenController.showGameOverScreen(payload);
}
