// game.js

import {
  buildMap,
  positionSpawn,
  getMapBgAsset,
  getMapObjects,
  normalizeMapId,
} from "./maps/manifest";
import { createGameHudController } from "./hud/gameHudController";
import { createGameOverScreenController } from "./hud/gameOverScreenController";
import { createSnapshotBuffer } from "./match/snapshotBuffer";
import { createMatchCoordinator } from "./match/matchCoordinator";
import { preloadGameAssets } from "./gameScene/preloadGameAssets";
import { renderPoisonWater } from "./gameScene/poisonWaterRenderer";
import { updateDynamicCamera } from "./gameScene/cameraDynamics";
import { createLocalInputSync } from "./gameScene/localInputSync";
import { processSnapshotInterpolation } from "./gameScene/networkInterpolation";
import { updateHealthBars } from "./gameScene/healthBarUpdater";
import {
  POWERUP_TYPES,
  POWERUP_ASSET_DIR,
  POWERUP_COLORS,
  createPowerupTickSounds,
} from "./powerups/powerupConfig";
import { createPowerupRenderer } from "./powerups/powerupRenderer";
import {
  createPlayer,
  player,
  handlePlayerMovement,
  dead,
  setSuperStats,
  setPowerupMobility,
  applyAuthoritativeState,
  getAmmoSyncState,
} from "./player";
import {
  preloadAll,
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

// Make Phaser globally available for character modules
window.Phaser = Phaser;

// Path to get assets
const staticPath = "/assets";
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
// Cache join payload for reconnect re-emit safety
let __joinPayload = { matchId: Number(matchId || 0) };

// Map variable
let mapObjects;

// Lists that store all the players in player team and op team
const opponentPlayers = [];
const teamPlayers = [];
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
let latestPlayerEffects = {}; // name -> effect duration map (ms remaining)
const POWERUP_COLLECT_QUEUE = [];
const LAST_HEALTH_BY_PLAYER = Object.create(null);
const SHIELD_IMPACT_QUEUE = [];
const LAST_SHIELD_ACTIVE_AT = Object.create(null);
const POST_MATCH_REWARD_STORAGE_KEY = "bb_post_match_rewards_v1";

const localInputSync = createLocalInputSync({
  socket,
  getAmmoSyncState,
  throttleMs: 30,
});

// Server snapshot interpolation
const snapshotBuffer = createSnapshotBuffer({
  maxStateBuffer: 90,
  initialInterpDelayMs: 115,
  minInterpDelayMs: 95,
  maxInterpDelayMs: 180,
  snapIntervalMs: 50,
  spacingEmaAlpha: 0.12,
  enableAdaptiveDelay: true,
  enableClockCorrection: false,
  enableBacklogCatchup: true,
});

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
  setLatestPlayerEffects: (v) => {
    latestPlayerEffects = v;
  },
  getLatestPlayerEffects: () => latestPlayerEffects,
  opponentPlayers,
  teamPlayers,
  pendingActionsQueue: PENDING_ACTIONS,
  powerupCollectQueue: POWERUP_COLLECT_QUEUE,
  shieldImpactQueue: SHIELD_IMPACT_QUEUE,
  lastHealthByPlayer: LAST_HEALTH_BY_PLAYER,
  lastShieldActiveAt: LAST_SHIELD_ACTIVE_AT,
  snapshotBuffer,
  hud,
  positionSpawn,
  OpPlayer,
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
    if ((Number(fx.shield) || 0) > 0) {
      LAST_SHIELD_ACTIVE_AT[name] = now;
    }
  }
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
    alert("Failed to load game data. Redirecting to lobby...");
    window.location.href = "/";
    throw error;
  }
}

// Initialize game connection
async function initializeGame() {
  try {
    if (__booted) return;
    __booted = true;
    console.log("Fetching game data for match:", matchId);
    gameData = await fetchGameData();
    console.log("Game data received:", gameData);
    username = gameData.yourName || username;
    initTeamStatusHud(gameData?.players || []);

    // 1) Register listeners before join
    console.log("Setting up game listeners");
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
    }
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
    // Don't let players move until game is fully ready (unless late-joining a live game)
    this.input.keyboard.enabled = false;
    this.physics.world.setBoundsCollision(false, false, false, false);
    // Poison water overlay graphics (sudden death - drawn every frame in update)
    const worldH =
      Number(this.scale?.height) || Number(this.game.config.height) || 1000;
    this._poisonWaterY = worldH + 60; // start off-screen below world
    this._smoothPoisonY = null; // interpolated, set on first use
    this._poisonGraphics = this.add.graphics();
    this._poisonGraphics.setDepth(12);
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
    this._powerupAuraGraphics = this.add.graphics();
    this._powerupAuraGraphics.setDepth(21);
    this._powerupFxGraphics = this.add.graphics();
    this._powerupFxGraphics.setDepth(20);
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
      getLatestPlayerEffects: () => latestPlayerEffects,
      powerupCollectQueue: POWERUP_COLLECT_QUEUE,
      shieldImpactQueue: SHIELD_IMPACT_QUEUE,
      setPowerupMobility,
      applyCharacterPowerupFx,
      drawCharacterPowerupAura,
      getCharacterPowerupMobilityModifier,
    });
    // Wait for game data before creating map and player
    if (!gameData) {
      console.log("Waiting for game data...");
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
    const activeMapId = normalizeMapId(gameData?.map);
    // No per-scene spawn plan needed now; map modules provide positioning helpers
    // Creates the map objects based on game data
    buildMap(this, activeMapId);
    mapObjects = getMapObjects(activeMapId);

    // Ensure all character animations are registered for this scene
    setupAll(this);

    // Replay any queued remote actions now that the scene is ready
    try {
      if (Array.isArray(PENDING_ACTIONS) && PENDING_ACTIONS.length) {
        const queued = PENDING_ACTIONS.splice(0, PENDING_ACTIONS.length);
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

    // Background music: prepare a starter callback and trigger it at FIGHT.
    this._bgmStarted = false;
    applyMatchBackground(gameData?.map);
    const startBgm = () => {
      if (this._bgmStarted) return;
      this._bgmStarted = true;
      try {
        if (!this._bgmEl) {
          const el = new Audio(`${staticPath}/main.mp3`);
          el.preload = "none"; // or 'metadata' to fetch small header first
          el.loop = false; // set to true if you want continuous loop
          el.volume = 0.05;
          // Optional: el.crossOrigin = 'anonymous';
          this._bgmEl = el;
          // Hook into scene lifecycle for cleanup
          this.events.once("shutdown", () => {
            try {
              this._bgmEl?.pause();
            } catch (_) {}
            this._bgmEl = null;
          });
          this.events.on("pause", () => this._bgmEl?.pause());
          this.events.on("resume", () => {
            try {
              this._bgmEl?.play();
            } catch (_) {}
          });
        }
        // Play (will stream progressively)
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

    this.events.once("shutdown", () => {
      try {
        matchCoordinator?.dispose();
      } catch (_) {}
      stopSuddenDeathMusic();
      try {
        this._suddenDeathMusicSfx?.destroy();
      } catch (_) {}
      this._suddenDeathMusicSfx = null;
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
    // After sprite exists and body sized, move to a map-appropriate spawn slot (prefer server spawnIndex)
    try {
      const serverIdx = SERVER_SPAWN_INDEX[username];
      let myIndex;
      if (typeof serverIdx === "number") {
        myIndex = Math.max(0, serverIdx);
      } else {
        const teamList = (gameData.players || [])
          .filter((p) => p.team === gameData.yourTeam)
          .sort((a, b) => a.name.localeCompare(b.name));
        myIndex = Math.max(
          0,
          teamList.findIndex((p) => p.name === username),
        );
      }
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
    } catch (_) {}

    // If server already has my live state (refresh/reconnect), apply it after spawn snap.
    try {
      if (pendingAuthoritativeLocalState) {
        applyAuthoritativeState(pendingAuthoritativeLocalState);
        const shouldRestorePosition =
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
        }
      }
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

    // Adds collision between map and player
    mapObjects.forEach((mapObject) => {
      // Add collider between the object and each map object
      this.physics.add.collider(player, mapObject);
    });

    // Camera: smooth follow
    const cam = this.cameras.main;

    // Starting zoom; update() adjusts this dynamically based on player height.
    cam.setZoom(1.7);

    // Horizontal: keep the 1700px camera window centered on the map content
    // (which always sits at game.config.width / 2). This decouples the camera
    // from the total world width, so expanding the canvas for device clipping
    // never shifts the visible play area.
    // Vertical: keep slight top headroom without wasting too much empty space.
    const contentCenterX = this.game.config.width / 2;
    cam.setBounds(contentCenterX - 850, -40, 2000, this.game.config.height);

    // Deadzone: small central box - camera only chases when player exits it.
    cam.setDeadzone(50, 50);

    // Downward bias: keep baseline framing close to original feel.
    // This places the player in the upper half of the frame when on high
    // platforms, naturally revealing the content below them.
    cam.setFollowOffset(0, 120);

    // lerpX=0.08 for crisp horizontal tracking; lerpY=0.05 is deliberately
    // lazier so the vertical frame shifts more gently - vertical centering is
    // less critical than horizontal awareness.
    cam.startFollow(player, false, 0.08, 0.05);
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
                : undefined;
          const index =
            typeof idx === "number"
              ? idx
              : (() => {
                  const teamList = (gameData.players || [])
                    .filter((p) => p.team === playerData.team)
                    .sort((a, b) => a.name.localeCompare(b.name));
                  return Math.max(
                    0,
                    teamList.findIndex((p) => p.name === playerData.name),
                  );
                })();
          positionSpawn(
            this,
            existing.opponent,
            activeMapId,
            playerData.team,
            index,
            (gameData.players || []).filter((p) => p.team === playerData.team)
              .length,
          );
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
              : (() => {
                  const teamList = (gameData.players || [])
                    .filter((p) => p.team === playerData.team)
                    .sort((a, b) => a.name.localeCompare(b.name));
                  return Math.max(
                    0,
                    teamList.findIndex((p) => p.name === playerData.name),
                  );
                })();
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

  update() {
    renderPoisonWater(this, { player, dead });

    // Powerup visuals/effects are rendered for all players every frame.
    this._renderPowerupsAndEffects();

    updateDynamicCamera(this, player, Phaser);

    // Only process if game is initialized
    if (!hasJoined || !gameInitialized || dead || gameEnded) return;

    localInputSync.sync(this, player, {
      dead,
      gameEnded,
      handlePlayerMovement,
    });

    processSnapshotInterpolation({
      snapshotBuffer,
      now: performance.now(),
      applyFrame: (frame) =>
        this.interpolatePlayerStates(frame.aState, frame.bState, frame.alpha),
      onDebugLine: (line) => console.log(line),
    });

    updateHealthBars({ opponentPlayers, teamPlayers });
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
  interpolatePlayerStates(aState, bState, alpha) {
    const applyInterp = (wrapper, name) => {
      if (!wrapper || !wrapper.opponent) return;

      const spr = wrapper.opponent;
      const aPosData = aState.players[name];
      const bPosData = bState.players[name];

      if (!aPosData && !bPosData) return;

      const isDeadBySnapshot =
        aPosData?.isAlive === false || bPosData?.isAlive === false;
      const isConnected =
        (bPosData && typeof bPosData.connected === "boolean"
          ? bPosData.connected
          : true) &&
        (aPosData && typeof aPosData.connected === "boolean"
          ? aPosData.connected
          : true);
      const isLoaded =
        (bPosData && typeof bPosData.loaded === "boolean"
          ? bPosData.loaded
          : true) &&
        (aPosData && typeof aPosData.loaded === "boolean"
          ? aPosData.loaded
          : true);

      // Position interpolation target.
      // During a combat precision window (opened when we receive an attack from this
      // opponent), blend toward their newest known snapshot position at a higher rate
      // (effectiveAlpha ≥ 0.85) to shrink the visual-vs-authoritative gap on hits.
      let targetX = spr.x;
      let targetY = spr.y;
      if (isLoaded) {
        const inPrecision =
          (Number(wrapper._attackPrecisionUntil) || 0) > performance.now();
        const effectiveAlpha = inPrecision ? Math.max(alpha, 0.85) : alpha;
        if (aPosData && bPosData) {
          targetX = aPosData.x + effectiveAlpha * (bPosData.x - aPosData.x);
          targetY = aPosData.y + effectiveAlpha * (bPosData.y - aPosData.y);
        } else if (bPosData) {
          targetX = bPosData.x;
          targetY = bPosData.y;
        } else if (aPosData) {
          targetX = aPosData.x;
          targetY = aPosData.y;
        }
      }

      // Move toward interpolated target with a bounded step.
      // This prevents visible twitch from sudden target jumps while still catching up fast.
      const dx = targetX - spr.x;
      const dy = targetY - spr.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.35) {
        const inPrecision =
          (Number(wrapper._attackPrecisionUntil) || 0) > performance.now();
        const maxStep = inPrecision ? 120 : 70;
        const snapDistance = inPrecision ? 220 : 140;
        if (dist <= snapDistance) {
          spr.x = targetX;
          spr.y = targetY;
        } else {
          const step = Math.min(maxStep, dist);
          spr.x += (dx / dist) * step;
          spr.y += (dy / dist) * step;
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

      // Orientation/animation: take from newer if present (prefer b then a)
      const animSrc = bPosData && bPosData.animation ? bPosData : aPosData;
      if (isDeadBySnapshot) {
        if (!wrapper._deathVisualApplied) {
          wrapper._deathVisualApplied = true;
          wrapper.opCurrentHealth = 0;
          try {
            wrapper.updateHealthBar(true);
          } catch (_) {}
          try {
            spr.setVelocity(0, 0);
          } catch (_) {}
          try {
            spr.anims.play(
              resolveAnimKey(this, wrapper.character, "dying", "idle"),
              true,
            );
          } catch (_) {}
          try {
            this.tweens.add({
              targets: spr,
              alpha: 0.4,
              duration: 260,
              ease: "Quad.easeOut",
            });
          } catch (_) {
            spr.alpha = 0.4;
          }
        }
      } else {
        if (wrapper._deathVisualApplied) {
          wrapper._deathVisualApplied = false;
          try {
            spr.alpha = 1;
          } catch (_) {}
        }
      }

      if (animSrc && !isDeadBySnapshot && isConnected && isLoaded) {
        const prevFlip = spr.flipX;
        spr.flipX = !!animSrc.flip;
        if (
          spr.flipX !== prevFlip &&
          typeof wrapper.applyFlipOffset === "function"
        ) {
          wrapper.applyFlipOffset();
        }
        const lockUntil = Number(wrapper._animLockUntil || 0);
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

      // Update name tag position
      if (wrapper.opPlayerName) {
        const bodyTop = spr.body ? spr.body.y : spr.y - spr.height / 2;
        wrapper.opPlayerName.setPosition(spr.x, bodyTop - 36);
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
    width: 2300,
    height: 1000,
  },
  scene: GameScene,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 950 },
      debug: false,
    },
  },
};

const game = new Phaser.Game(config);

export { opponentPlayers, teamPlayers };

// Emit a one-time game:ready ack when both scene and startingPhase are true
function trySendReadyAck() {
  if (readyAckSent) return;
  const sceneReady = !!gameScene && !!player; // player created implies scene ready
  if (!sceneReady || !startingPhase) return;
  try {
    readyAckSent = true;
    socket.emit("game:ready", { matchId: Number(matchId) });
    console.log("Sent game:ready ack");
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
  gameOverScreenController.showGameOverScreen(payload);
}
