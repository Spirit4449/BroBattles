// game.js

import {
  lushyPeaks,
  lushyPeaksObjects,
  positionLushySpawn,
} from "./maps/lushyPeaks";
import {
  mangroveMeadow,
  mangroveMeadowObjects,
  positionMangroveSpawn,
} from "./maps/mangroveMeadow";
import { createPlayer, player, handlePlayerMovement, dead } from "./player";
import {
  preloadAll,
  handleRemoteAttack,
  setupAll,
  resolveAnimKey,
} from "./characters";
import socket, { waitForConnect } from "./socket";
import OpPlayer from "./opPlayer";
import { spawnDust, prewarmDust } from "./effects";
import { changeDebugState as changeDravenDebug } from "./characters/draven/attack";
import { changeDebugState as changeThorgDebug } from "./characters/thorg/attack";
import { changeDebugState as changeWizardDebug } from "./characters/wizard/attack";

// Make Phaser globally available for character modules
window.Phaser = Phaser;

// Path to get assets
const staticPath = "/assets";

let __booted = false;
function onReady(fn) {
  if (document.readyState === "loading") {
    // not ready yet — wait once
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    // DOM is already ready — run on next tick to keep ordering sane
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
// Buffer for remote actions that arrive before scene is ready
const PENDING_ACTIONS = [];
// Spawn coordination
let SPAWN_VERSION = 0; // increments per scene init to version spawns
const SERVER_SPAWN_INDEX = Object.create(null); // name -> spawnIndex (if server provided)

// Movement throttling variables
let lastMovementSent = 0;
const movementThrottleMs = 20; // ~60Hz movement updates for snappier remote view
let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };

// Server snapshot interpolation
let stateActive = false; // set true once we start receiving server snapshots
const stateBuffer = []; // queue of { tMono, tickId, players: { [username]: {...} } }
const MAX_STATE_BUFFER = 120; // cushion (~6s at 20 Hz) for safety
let interpDelayMs = 150; // slightly larger to absorb jitter (will tune later)
// Monotonic timing alignment
let serverMonoOffset = 0; // server tMono - client performance.now()
let monoCalibrated = false;
const SNAP_INTERVAL_MS = 50; // 20 Hz cadence from server
// Diagnostics
let snapshotSpacings = []; // recent spacing deltas
let lastDiagLogMono = 0;

// ---- Adaptive interpolation / PLL variables (Task 4) ----
let renderClockMono = null; // our smoothed render timeline in server-monotonic domain
let lastFramePerfNow = null; // perf.now of previous frame for delta calc
const MIN_INTERP_DELAY = 120;
const MAX_INTERP_DELAY = 300;
// EMA of snapshot spacing & jitter (absolute deviation)
let spacingEma = null;
let jitterEma = null;
const SPACING_EMA_ALPHA = 0.12; // responsiveness of spacing/jitter tracking
// Debug diag throttle
let lastAdaptivePrint = 0;

// Game scene reference
let gameScene = null;

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

    // 1) Register listeners before join
    console.log("Setting up game listeners");
    setupGameEventListeners();

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
  const root = document.getElementById("battle-start-overlay");
  if (!root) return null;

  // Background image based on map
  const bg = document.getElementById("bs-bg");
  if (bg) {
    bg.src =
      String(gameData?.map) === "2"
        ? "/assets/mangrove/gameBg.webp"
        : "/assets/lushy/gameBg.webp";
  }

  // Header labels
  const modeEl = document.getElementById("bs-mode");
  if (modeEl)
    modeEl.textContent = `${gameData?.mode || 1}v${gameData?.mode || 1}`;
  const mapEl = document.getElementById("bs-map");
  if (mapEl) mapEl.textContent = `Map ${gameData?.map || 1}`;

  // Columns
  const yourCol = document.getElementById("bs-your");
  const oppCol = document.getElementById("bs-opp");
  if (yourCol) yourCol.innerHTML = "";
  if (oppCol) oppCol.innerHTML = "";
  const yourTeam = (players || []).filter((p) => p.team === gameData?.yourTeam);
  const oppTeam = (players || []).filter((p) => p.team !== gameData?.yourTeam);

  const appendTile = (container, p) => {
    if (!container) return;
    const tile = document.createElement("div");
    tile.className = "bs-player";
    const img = document.createElement("img");
    const cls = (p?.char_class || "ninja").toLowerCase();
    img.src = `/assets/${cls}/body.webp`;
    img.alt = cls;
    const name = document.createElement("div");
    name.className = "bs-name";
    const nm = p?.name || "Player";
    name.textContent = nm + (nm === username ? " (You)" : "");
    tile.appendChild(img);
    tile.appendChild(name);
    container.appendChild(tile);
  };

  yourTeam.forEach((p) => appendTile(yourCol, p));
  oppTeam.forEach((p) => appendTile(oppCol, p));

  // Reset countdown label
  const c = document.getElementById("countdown-display");
  if (c) c.textContent = "3";

  // Show and fade-in
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  const wrap = root.querySelector(".bs-wrap");
  if (wrap) requestAnimationFrame(() => (wrap.style.opacity = "1"));
  return root;
}

// Set up socket event listeners for game
function setupGameEventListeners() {
  // Re-join room if socket reconnects before init completed (idempotent on server)
  const tryJoin = () => {
    if (
      !gameInitialized &&
      __joinPayload &&
      Number(__joinPayload.matchId) > 0 &&
      !hasJoined &&
      !joinInFlight
    ) {
      console.log("[game] connect", __joinPayload);
      try {
        joinInFlight = true;
        socket.emit("game:join", __joinPayload, (ack) => {
          joinInFlight = false;
          if (!ack || ack.ok !== true) {
            console.warn("[game] join ack failed", ack);
          } else {
            console.log("[game] join ack ok", ack);
            hasJoined = true;
          }
        });
      } catch (e) {
        console.warn("[game] join emit error", e);
      }
    }
  };
  socket.on("connect", tryJoin);
  socket.on("reconnect", tryJoin);
  // If we're already connected when listeners are added, attempt once now
  if (socket.connected) tryJoin();

  // Game initialization
  socket.on("game:init", (gameState) => {
    console.log("Game initialized:", {
      players: Array.isArray(gameState?.players) ? gameState.players.length : 0,
      status: gameState?.status,
    });
    gameInitialized = true;
    // Mark if game is already live (late join)
    try {
      const status = String(gameState?.status || "").toLowerCase();
      isLiveGame =
        status === "active" || status === "started" || status === "running";
      console.log(isLiveGame, "is live");
    } catch (_) {}
    // If already live at init, hide overlay and enable controls immediately
    if (isLiveGame) {
      hideBattleStartOverlay();
      try {
        if (gameScene && gameScene.input?.keyboard) {
          gameScene.input.keyboard.enabled = true;
        }
      } catch (_) {}
    }

    // Capture server-provided spawn index/version if present
    try {
      if (Array.isArray(gameState.players)) {
        for (const p of gameState.players) {
          if (typeof p.spawnIndex === "number") {
            SERVER_SPAWN_INDEX[p.name] = p.spawnIndex;
          }
        }
      }
      if (typeof gameState.spawnVersion === "number") {
        // Only advance if server version is newer
        if (gameState.spawnVersion > SPAWN_VERSION)
          SPAWN_VERSION = gameState.spawnVersion;
      }
    } catch (_) {}

    // Update local game data with server state
    if (gameState.players) {
      // Initialize opponent and team players based on server data
      initializePlayers(gameState.players);
    }

    // Cache my level and stats for character modules
    try {
      const me = (gameState.players || []).find((p) => p.name === username);
      if (me) {
        window.__MATCH_SESSION__.level = me.level || 1;
        window.__MATCH_SESSION__.stats = me.stats || {};
      }
    } catch (_) {}
  });

  // Game start countdown (only if not already live)
  socket.on("game:start", (data) => {
    console.log("Game starting:", data);
    if (!isLiveGame) startCountdown();
  });

  // Server indicates starting phase (10s window)
  socket.on("game:starting", (payload) => {
    console.log("Game starting phase:", payload);
    startingPhase = true;
    // Only show overlay if not already live
    if (!isLiveGame) {
      showBattleStartOverlay(gameData.players);
    }
    trySendReadyAck();
  });

  // No periodic join retries needed; reconnect handler covers transient drops

  // Server snapshots for interpolation
  socket.on("game:snapshot", (snapshot) => {
    if (!snapshot || !snapshot.players) return;
    if (!stateActive) {
      stateActive = true;
      console.log("Started receiving server snapshots (tMono/tickId enabled)");
      // Receiving snapshots implies the match is live; hide any pending overlay.
      try {
        hideBattleStartOverlay();
        if (gameScene && gameScene.input?.keyboard) {
          gameScene.input.keyboard.enabled = true;
        }
      } catch (_) {}
    }

    // Calibrate monotonic offset using performance.now() vs server tMono
    try {
      const clientMonoNow = performance.now();
      if (!monoCalibrated && typeof snapshot.tMono === "number") {
        serverMonoOffset = snapshot.tMono - clientMonoNow; // server = client + offset
        monoCalibrated = true;
        console.log(
          "Monotonic offset calibrated (ms):",
          serverMonoOffset.toFixed(2)
        );
      }
    } catch (_) {}

    // Derive monotonic time for snapshot (fallbacks if missing)
    let snapMono = null;
    if (typeof snapshot.tMono === "number") {
      snapMono = snapshot.tMono;
    } else if (typeof snapshot.timestamp === "number") {
      // Fallback: treat legacy timestamp as wall ms, convert using offset if calibrated
      const clientMonoNow = performance.now();
      snapMono = monoCalibrated
        ? clientMonoNow + serverMonoOffset // approximate current server mono
        : snapshot.timestamp; // best effort
    } else {
      snapMono = (performance.now && performance.now()) || Date.now();
    }

    // Track spacing diagnostics + adaptive EMA for delay
    if (stateBuffer.length > 0) {
      const prev = stateBuffer[stateBuffer.length - 1].tMono;
      const d = snapMono - prev;
      if (d >= 0 && d < 500) {
        snapshotSpacings.push(d);
        if (snapshotSpacings.length > 400) snapshotSpacings.splice(0, 200);
        // EMA updates
        spacingEma =
          spacingEma == null
            ? d
            : spacingEma + (d - spacingEma) * SPACING_EMA_ALPHA;
        const dev = Math.abs(d - (spacingEma || d));
        jitterEma =
          jitterEma == null
            ? dev
            : jitterEma + (dev - jitterEma) * SPACING_EMA_ALPHA;
        // Adaptive delay target: base ~ 3 * spacing + 2 * jitter (bounded)
        if (spacingEma != null && jitterEma != null) {
          let targetDelay = spacingEma * 3 + jitterEma * 2;
          if (targetDelay < MIN_INTERP_DELAY) targetDelay = MIN_INTERP_DELAY;
          if (targetDelay > MAX_INTERP_DELAY) targetDelay = MAX_INTERP_DELAY;
          // Smooth adjustments (avoid big jumps)
          interpDelayMs += (targetDelay - interpDelayMs) * 0.1;
        }
      }
    }

    // Initialize render clock when first snapshot w/ monotonic time arrives
    if (renderClockMono == null && typeof snapMono === "number") {
      renderClockMono = snapMono; // start locked
      lastFramePerfNow = performance.now();
    }

    // Late-join safety: create opponents on first snapshot if missing
    try {
      if (gameScene && snapshot && snapshot.players) {
        for (const name of Object.keys(snapshot.players)) {
          if (name === username) continue;
          const pd = (gameData.players || []).find((p) => p.name === name);
          const isTeammate = pd && pd.team === gameData.yourTeam;
          const existing =
            (isTeammate ? teamPlayers[name] : opponentPlayers[name]) || null;
          const isValidInstance = !!(existing && existing.opponent);
          if (!isValidInstance && pd) {
            const container = isTeammate ? teamPlayers : opponentPlayers;
            const op = new OpPlayer(
              gameScene,
              pd.char_class,
              pd.name,
              isTeammate ? "teammate" : pd.team,
              null,
              null,
              (gameData.players || []).filter((p) => p.team === pd.team).length,
              String(gameData.map)
            );
            container[pd.name] = op;
          }
        }
      }
    } catch (_) {}

    // Add to state buffer for interpolation using server monotonic timeline
    stateBuffer.push({
      tMono: snapMono,
      tickId: typeof snapshot.tickId === "number" ? snapshot.tickId : null,
      players: snapshot.players,
    });

    // Keep buffer size manageable
    if (stateBuffer.length > MAX_STATE_BUFFER) {
      stateBuffer.shift();
    }

    // Periodic diagnostics (every ~4s) about snapshot spacing
    try {
      const cm = performance.now();
      if (cm - lastDiagLogMono > 4000 && snapshotSpacings.length > 5) {
        const arr = snapshotSpacings.slice(-80);
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance =
          arr.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / arr.length;
        const stdev = Math.sqrt(variance);
        console.log(
          `[interp] snapshots avg=${avg.toFixed(2)}ms sd=${stdev.toFixed(
            2
          )}ms n=${arr.length}`
        );
        lastDiagLogMono = cm;
      }
    } catch (_) {}
  });

  // Game actions from other players
  socket.on("game:action", (packet) => {
    try {
      if (!packet) return;
      // If scene not ready yet, queue the action to replay shortly
      if (!gameScene || !gameScene.sys || !gameScene.sys.isActive) {
        PENDING_ACTIONS.push(packet);
        return;
      }
      const { playerName, character, origin, flip, action } = packet;
      if (!playerName || !action) return;
      if (playerName === username) return; // ignore self

      // Determine which container holds this player
      const pd = (gameData.players || []).find((p) => p.name === playerName);
      const isTeammate = pd && pd.team === gameData.yourTeam;
      const container = isTeammate ? teamPlayers : opponentPlayers;
      let wrapper = container[playerName];

      // Lazy-create if missing (late join/desync safety)
      if (!wrapper || !wrapper.opponent) {
        if (!pd) return; // can't create without char/team info
        const op = new OpPlayer(
          gameScene,
          pd.char_class,
          pd.name,
          isTeammate ? "teammate" : pd.team,
          null,
          null,
          (gameData.players || []).filter((p) => p.team === pd.team).length,
          String(gameData.map)
        );
        container[pd.name] = op;
        wrapper = op;
      }

      // Do NOT snap the opponent sprite to packet.origin; keep interpolation smooth.
      // We'll only use origin for spawning projectiles/effects coordinates below.

      // Resolve character (packet.character overrides roster info if present)
      const charKey = (character || (pd && pd.char_class) || "").toLowerCase();
      // Build action payload: use live sprite position/flip for fluid visuals
      const act = { ...(action || {}) };
      if (wrapper && wrapper.opponent) {
        act.x = wrapper.opponent.x;
        act.y = wrapper.opponent.y;
        if (typeof act.direction !== "number") {
          act.direction = wrapper.opponent.flipX ? -1 : 1;
        }
      }
      const consumed = handleRemoteAttack(gameScene, charKey, act, wrapper);
      if (!consumed) {
        // Optional dev log for unhandled action types
        console.debug("Unhandled remote action", {
          playerName,
          charKey,
          action,
        });
      }
    } catch (err) {
      console.warn("Failed to handle remote game:action", err);
    }
  });

  // Game errors
  socket.on("game:error", (error) => {
    console.error("Game error:", error);
    alert(`Game error: ${error.message}`);
  });

  // Player disconnections
  socket.on("player:disconnected", (data) => {
    console.log("Player disconnected:", data);
    // Handle player disconnection in UI
  });

  // Game over event (team elimination)
  socket.on("game:over", (payload) => {
    if (gameEnded) return; // idempotent
    gameEnded = true;
    try {
      player && player.body && (player.body.enable = false);
    } catch (_) {}
    showGameOverScreen(payload);
  });
}

// Initialize players based on server data
function initializePlayers(players) {
  // Clear existing players
  for (const name in opponentPlayers) {
    if (opponentPlayers[name].sprite) {
      opponentPlayers[name].sprite.destroy();
    }
    delete opponentPlayers[name];
  }

  for (const name in teamPlayers) {
    if (teamPlayers[name].sprite) {
      teamPlayers[name].sprite.destroy();
    }
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
      health: playerData.health || 100,
      isAlive: playerData.isAlive !== false,
      spawnIndex:
        typeof playerData.spawnIndex === "number"
          ? playerData.spawnIndex
          : undefined,
    };
  });
}

// Initialize game when page loads
window.__BOOT_GAME__ = () => onReady(initializeGame);

// Phaser class to setup the game
class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  // Preloads assets
  preload() {
    this.load.on("progress", (p) => {
      // 50% - 90%
      const pct = Math.floor(50 + p * 40); // maps 0–1 → 50–90
      updateLoading(pct, `Loading assets…`);
    });

    this.load.once("complete", () => {
      updateLoading(95, "Assets loaded");
      // Overlay will be controlled strictly by socket events (game:starting/game:start/init/live)
      // Do not show here to avoid race with late-arriving init/live status.
      // Input will be enabled on game:start or immediately if already live.
    });

    // Character assets (preload all registered characters)
    preloadAll(this, staticPath);

    this.load.image("tiles-image", `${staticPath}/map.webp`);
    this.load.tilemapTiledJSON("tiles", `${staticPath}/tilesheet.json`);
    this.load.image("lushy-base", `${staticPath}/lushy/base.webp`);
    this.load.image("lushy-platform", `${staticPath}/lushy/largePlatform.webp`);
    this.load.image(
      "lushy-side-platform",
      `${staticPath}/lushy/sidePlatform.webp`
    );
    this.load.image(
      "mangrove-tiny-platform",
      `${staticPath}/mangrove/tinyPlatform.webp`
    );
    this.load.image(
      "mangrove-base-left",
      `${staticPath}/mangrove/baseLeft.webp`
    );
    this.load.image(
      "mangrove-base-middle",
      `${staticPath}/mangrove/baseMiddle.webp`
    );
    this.load.image(
      "mangrove-base-right",
      `${staticPath}/mangrove/baseRight.webp`
    );
    this.load.image("mangrove-base-top", `${staticPath}/mangrove/baseTop.webp`);
    this.load.image("thorg-weapon", `${staticPath}/thorg/weapon.webp`);
    // Movement SFX (place files under /assets/audio)
    this.load.audio("sfx-step", `${staticPath}/step.mp3`);
    this.load.audio("sfx-jump", `${staticPath}/jump.mp3`);
    this.load.audio("sfx-land", `${staticPath}/land.mp3`);
    this.load.audio("sfx-walljump", `${staticPath}/walljump.mp3`);
    // Combat/health SFX
    this.load.audio("sfx-damage", `${staticPath}/damage.mp3`);
    this.load.audio("sfx-heal", `${staticPath}/heal.mp3`);
    // Music (non-blocking BGM: handled via HTMLAudio at runtime)
    this.load.audio("win", `${staticPath}/win.mp3`);
    this.load.audio("lose", `${staticPath}/lose.mp3`);
  }

  create() {
    // Store scene reference
    gameScene = this;
    // Don't let players move until game is fully ready (unless late-joining a live game)
    this.input.keyboard.enabled = false;
    this.physics.world.setBoundsCollision(false, false, false, false);
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
    // No per-scene spawn plan needed now; map modules provide positioning helpers
    // Creates the map objects based on game data
    if (gameData.map === 1) {
      mapObjects = lushyPeaksObjects;
      lushyPeaks(this);
    } else if (gameData.map === 2) {
      mapObjects = mangroveMeadowObjects;
      mangroveMeadow(this);
    }

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
              (p) => p.name === playerName
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

    // Background music: play once (2:30 track), no loop, but only after audio unlock (user gesture)
    this._bgmStarted = false;
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
    if (this.sound.locked) {
      // Phaser will emit 'unlocked' on first user interaction
      this.sound.once("unlocked", startBgm);
    } else {
      // If already unlocked, start immediately; also set a safe first-click hook
      startBgm();
    }
    // Extra safety: if for some reason 'unlocked' doesn't fire, start on first pointer/keydown
    this.input.once("pointerdown", startBgm);
    this.input.keyboard?.once("keydown", startBgm);

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
      String(gameData.map),
      opponentPlayers
    );
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
          teamList.findIndex((p) => p.name === username)
        );
      }
      const teamSize = (gameData.players || []).filter(
        (p) => p.team === gameData.yourTeam
      ).length;
      if (String(gameData.map) === "1") {
        positionLushySpawn(this, player, gameData.yourTeam, myIndex, teamSize);
      } else if (String(gameData.map) === "2") {
        positionMangroveSpawn(this, player, gameData.yourTeam, myIndex);
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
        changeDravenDebug(enable);
      } catch (_) {}
      try {
        changeThorgDebug(enable);
      } catch (_) {}
      try {
        changeWizardDebug(enable);
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
  }

  initializeOtherPlayers() {
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
                    teamList.findIndex((p) => p.name === playerData.name)
                  );
                })();
          if (String(gameData.map) === "1") {
            positionLushySpawn(
              this,
              existing.opponent,
              playerData.team,
              index,
              (gameData.players || []).filter((p) => p.team === playerData.team)
                .length
            );
          } else if (String(gameData.map) === "2") {
            positionMangroveSpawn(
              this,
              existing.opponent,
              playerData.team,
              index
            );
          }
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
        (gameData.players || []).filter(
          (p) => p.team === playerData.team
        ).length,
        String(gameData.map) // map as string for spawn helpers
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
                  teamList.findIndex((p) => p.name === playerData.name)
                );
              })();
        const index = Math.max(0, idx);
        if (String(gameData.map) === "1") {
          positionLushySpawn(
            this,
            opPlayer.opponent,
            playerData.team,
            index,
            (gameData.players || []).filter((p) => p.team === playerData.team)
              .length
          );
        } else if (String(gameData.map) === "2") {
          positionMangroveSpawn(
            this,
            opPlayer.opponent,
            playerData.team,
            index
          );
        }
        if (opPlayer.updateUIPosition) opPlayer.updateUIPosition();
      } catch (_) {}

      // Apply server-sent max health if provided
      if (playerData.stats && typeof playerData.stats.health === "number") {
        opPlayer.opMaxHealth = playerData.stats.health;
        opPlayer.opCurrentHealth = playerData.stats.health;
        if (opPlayer.updateHealthBar) opPlayer.updateHealthBar();
      }

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

  update() {
    // Only process if game is initialized
    if (!hasJoined || !gameInitialized || dead || gameEnded) return;

    // Handle player movement input and send to server
    if (player && !dead && !gameEnded) {
      handlePlayerMovement(this);

      // Send position + state to server (throttled)
      const now = Date.now();
      if (now - lastMovementSent >= movementThrottleMs) {
        const currentState = {
          x: player.x,
          y: player.y,
          flip: player.flipX,
          animation: player.anims?.currentAnim?.key || null,
        };

        // Only send if state has changed
        if (
          Math.abs(currentState.x - lastPlayerState.x) > 1 ||
          Math.abs(currentState.y - lastPlayerState.y) > 1 ||
          currentState.flip !== lastPlayerState.flip ||
          currentState.animation !== lastPlayerState.animation
        ) {
          // Disable per-message compression for movement for lower latency on constrained devices
          socket.volatile.compress(false).emit("game:input", currentState);

          lastPlayerState = { ...currentState };
          lastMovementSent = now;
        }
      }
    }

    // Server state interpolation
    if (stateActive && stateBuffer.length > 0) {
      const perfNow = performance.now();
      if (renderClockMono == null) {
        // Fallback: just snap to last
        const last = stateBuffer[stateBuffer.length - 1];
        this.interpolatePlayerStates(last, last, 1);
      } else {
        // Advance render clock by real frame delta (bounded) then subtract adaptive delay
        if (lastFramePerfNow == null) lastFramePerfNow = perfNow;
        let dt = perfNow - lastFramePerfNow;
        lastFramePerfNow = perfNow;
        if (dt < 0) dt = 0;
        if (dt > 250) dt = 250; // clamp huge frame stalls
        renderClockMono += dt; // advance in server mono domain (assuming near 1:1)
        let targetMono = renderClockMono - interpDelayMs;

        // Guard: ensure we don't outrun newest snapshot - small margin
        const newest = stateBuffer[stateBuffer.length - 1].tMono;
        const oldest = stateBuffer[0].tMono;
        if (targetMono > newest - 5) {
          // Pull back gently (fast catch-up)
          targetMono = newest - 5;
          renderClockMono = targetMono + interpDelayMs;
        }
        // If we're too close to oldest (buffer underrun), push forward
        if (targetMono < oldest + 5) {
          targetMono = oldest + 5;
          renderClockMono = targetMono + interpDelayMs;
        }

        // PLL correction: measure average spacing vs expected to nudge speed
        if (spacingEma != null) {
          const expected = 50; // server nominal spacing
          const error = spacingEma - expected; // positive => slower than expected
          // tiny proportional adjustment to render clock to keep phase reasonable
          renderClockMono += error * 0.02; // extremely conservative
        }

        // ---- Backlog safeguard ----
        const headT = newest; // latest snapshot tMono
        let lagMs = headT - interpDelayMs - targetMono;

        // Hard clamp: never render more than 500ms behind head
        const MAX_HISTORY_MS = 500;
        const minTarget = headT - (interpDelayMs + MAX_HISTORY_MS);
        if (targetMono < minTarget) {
          console.warn(
            `[interp] clamping backlog: lag=${lagMs.toFixed(1)}ms buffer=${
              stateBuffer.length
            }`
          );
          targetMono = minTarget;
          renderClockMono = targetMono + interpDelayMs;

          // Drop stale snapshots older than target
          while (
            stateBuffer.length > 2 &&
            stateBuffer[1].tMono <= targetMono - 50
          ) {
            stateBuffer.shift();
          }
          lagMs = headT - interpDelayMs - targetMono;
        }

        // Fast-forward if we ever fall >1s behind
        if (lagMs > 1000) {
          console.warn(`[interp] severe lag reset: lag=${lagMs.toFixed(0)}ms`);
          targetMono = headT - interpDelayMs;
          renderClockMono = targetMono + interpDelayMs;
          // keep only most recent ~10
          if (stateBuffer.length > 10) {
            stateBuffer.splice(0, stateBuffer.length - 10);
          }
        }
        // ----------------------------

        // ---- Catch-up PLL (gentle fast-forward when behind) ----
        {
          const headT = newest; // latest snapshot tMono
          const desired = headT - interpDelayMs;
          let lagMs = desired - targetMono; // >0 means we are behind

          // If we are behind by more than ~2 frames at 20Hz, speed up a bit
          if (lagMs > 120) {
            // Proportional gain: move up to 10ms/frame toward the head
            const gain = 0.12; // small proportional factor
            const maxPerFrame = 10; // hard cap per frame (ms)
            const step = Math.min(lagMs * gain, maxPerFrame);
            targetMono += step;
            renderClockMono = targetMono + interpDelayMs;
          }

          // If somehow ahead (negative lag), gently slow down a bit
          if (lagMs < -60) {
            const gain = 0.08;
            const maxPerFrame = 8;
            const step = Math.min(-lagMs * gain, maxPerFrame);
            targetMono -= step;
            renderClockMono = targetMono + interpDelayMs;
          }

          // Keep buffer tight around target: drop stale snapshots far behind target
          while (
            stateBuffer.length > 2 &&
            stateBuffer[1].tMono <= targetMono - 50
          ) {
            stateBuffer.shift();
          }
        }
        // --------------------------------------------------------

        // Locate surrounding snapshots for targetMono
        let aState = null;
        let bState = null;
        for (let i = 0; i < stateBuffer.length - 1; i++) {
          const a = stateBuffer[i];
          const b = stateBuffer[i + 1];
          if (a.tMono <= targetMono && targetMono <= b.tMono) {
            aState = a;
            bState = b;
            break;
          }
        }

        if (aState && bState) {
          const span = bState.tMono - aState.tMono;
          let alpha = span > 0 ? (targetMono - aState.tMono) / span : 1;
          if (alpha < 0) alpha = 0;
          else if (alpha > 1) alpha = 1;
          this.interpolatePlayerStates(aState, bState, alpha);
        } else {
          // Fallbacks
          if (stateBuffer.length >= 2) {
            const a = stateBuffer[stateBuffer.length - 2];
            const b = stateBuffer[stateBuffer.length - 1];
            this.interpolatePlayerStates(a, b, 1);
          } else if (stateBuffer.length === 1) {
            const only = stateBuffer[0];
            this.interpolatePlayerStates(only, only, 1);
          }
        }
      }
    }

    // Debug print every ~5s (dev aid) - comment out for production
    try {
      const pn = performance.now();
      if (pn - lastAdaptivePrint > 5000 && spacingEma != null) {
        lastAdaptivePrint = pn;
        console.log(
          `[adaptive] delay=${interpDelayMs.toFixed(
            1
          )}ms spacingEma=${spacingEma?.toFixed(
            2
          )} jitterEma=${jitterEma?.toFixed(2)} buffer=${stateBuffer.length}`
        );
      }
    } catch (_) {}

    // Update health bars for all players
    for (const player in opponentPlayers) {
      const opponentPlayer = opponentPlayers[player];
      if (opponentPlayer.updateHealthBar) {
        opponentPlayer.updateHealthBar();
      }
    }
    for (const player in teamPlayers) {
      const teamPlayer = teamPlayers[player];
      if (teamPlayer.updateHealthBar) {
        teamPlayer.updateHealthBar();
      }
    }
  }

  interpolatePlayerStates(aState, bState, alpha) {
    const applyInterp = (wrapper, name) => {
      if (!wrapper || !wrapper.opponent) return;

      const spr = wrapper.opponent;
      const aPosData = aState.players[name];
      const bPosData = bState.players[name];

      if (!aPosData && !bPosData) return;

      // Position interpolation target
      let targetX = spr.x;
      let targetY = spr.y;
      if (aPosData && bPosData) {
        targetX = aPosData.x + alpha * (bPosData.x - aPosData.x);
        targetY = aPosData.y + alpha * (bPosData.y - aPosData.y);
      } else if (bPosData) {
        targetX = bPosData.x;
        targetY = bPosData.y;
      } else if (aPosData) {
        targetX = aPosData.x;
        targetY = aPosData.y;
      }

      // Direct snap to interpolated position (adaptive delay already smoothing jitter)
      spr.x = targetX;
      spr.y = targetY;

      // Orientation/animation: take from newer if present (prefer b then a)
      const animSrc = bPosData && bPosData.animation ? bPosData : aPosData;
      if (animSrc) {
        const prevFlip = spr.flipX;
        spr.flipX = !!animSrc.flip;
        if (
          spr.flipX !== prevFlip &&
          typeof wrapper.applyFlipOffset === "function"
        ) {
          wrapper.applyFlipOffset();
        }
        if (animSrc.animation) {
          spr.anims.play(
            resolveAnimKey(this, wrapper.character, animSrc.animation, "idle"),
            true
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
    width: 1300,
    height: 650,
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
  const countdownEl = document.getElementById("countdown-display");
  if (!countdownEl) return;

  let count = 3;

  const updateCountdown = () => {
    if (count > 0) {
      countdownEl.style.transform = "scale(0.5)";
      countdownEl.style.opacity = "0.5";

      setTimeout(() => {
        countdownEl.textContent = count;
        countdownEl.style.transform = "scale(1.2)";
        countdownEl.style.opacity = "1";
        countdownEl.style.transition = "transform 0.3s ease, opacity 0.3s ease";

        setTimeout(() => {
          countdownEl.style.transform = "scale(1)";
        }, 150);
      }, 50);

      count--;
      setTimeout(updateCountdown, 1000);
    } else {
      countdownEl.textContent = "FIGHT!";
      countdownEl.style.color = "#ef4444";
      countdownEl.style.transform = "scale(1.5)";

      setTimeout(() => {
        hideBattleStartOverlay();
        try {
          if (gameScene && gameScene.input?.keyboard) {
            gameScene.input.keyboard.enabled = true;
          }
        } catch (_) {}
      }, 1000);
    }
  };

  updateCountdown();
}

function hideBattleStartOverlay() {
  const overlay = document.getElementById("battle-start-overlay");
  if (!overlay) return;
  const wrap = overlay.querySelector(".bs-wrap");
  if (wrap) wrap.style.opacity = "0";
  setTimeout(() => {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }, 300);
}

// -----------------------------
// Simple Game Over Overlay
// -----------------------------
function showGameOverScreen(payload) {
  const existing = document.getElementById("game-over-overlay");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "game-over-overlay";
  const winner = payload?.winnerTeam;
  let heading = "Game Over";
  if (winner === null) heading = "Draw";
  else if (winner === gameData?.yourTeam) heading = "Victory";
  else heading = "Defeat";
  const rewards = Array.isArray(payload?.meta?.rewards)
    ? payload.meta.rewards
    : [];
  const myReward = rewards.find((r) => r.username === username);
  const escapeHtml = (val) =>
    String(val ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const baseRowStyle =
    "display:grid;grid-template-columns:2.2fr repeat(5,1fr);gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:13px;";
  const headerRow = `
    <div style="${baseRowStyle}font-weight:600;border-bottom:1px solid rgba(255,255,255,0.2);text-transform:uppercase;font-size:12px;">
      <div style="text-align:left;">Player</div>
      <div>Hits</div>
      <div>Damage</div>
      <div>Kills</div>
      <div>Coins</div>
      <div>Gems</div>
    </div>`;
  const rewardRowsHtml = rewards
    .map((r) => {
      const isYou = r.username === username;
      const rowStyle = `${baseRowStyle}${
        isYou
          ? "background:rgba(37,99,235,0.18);border-bottom-color:rgba(37,99,235,0.35);"
          : ""
      }`;
      const label = `${escapeHtml(r.username)}${
        isYou ? ' <span style="font-size:11px;color:#93c5fd;">(You)</span>' : ""
      }`;
      return `
        <div style="${rowStyle}">
          <div style="text-align:left;font-weight:${
            isYou ? 600 : 500
          };">${label}</div>
          <div>${r.hits ?? 0}</div>
          <div>${r.damage ?? 0}</div>
          <div>${r.kills ?? 0}</div>
          <div style="color:#facc15;font-weight:600;">${
            r.coinsAwarded ?? 0
          }</div>
          <div style="color:#67e8f9;font-weight:600;">${
            r.gemsAwarded ?? 0
          }</div>
        </div>`;
    })
    .join("");
  const rewardSectionHtml = rewards.length
    ? `
      <div style="margin-top:28px;text-align:left;">
        <h2 style="margin:0 0 10px;font-size:18px;color:#f8fafc;">Match Rewards</h2>
        <div style="border:1px solid rgba(148,163,184,0.25);border-radius:10px;overflow:hidden;background:rgba(15,23,42,0.65);">
          ${headerRow}
          ${rewardRowsHtml}
        </div>
      </div>`
    : "";
  const personalSummaryHtml = myReward
    ? `
      <div style="margin-top:20px;padding:14px 18px;border-radius:10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);text-align:left;">
        <div style="font-size:15px;font-weight:600;margin-bottom:6px;">You earned</div>
        <div style="display:flex;gap:18px;font-size:18px;font-weight:600;">
          <span style="color:#facc15;">${
            myReward.coinsAwarded ?? 0
          } coins</span>
          <span style="color:#67e8f9;">${myReward.gemsAwarded ?? 0} gems</span>
        </div>
        <div style="margin-top:6px;font-size:13px;color:#cbd5f5;">
          ${myReward.hits ?? 0} hits · ${myReward.damage ?? 0} dmg · ${
        myReward.kills ?? 0
      } kills
        </div>
      </div>`
    : "";
  div.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:rgba(0,0,0,0.65);font-family:Arial,sans-serif;">
      <div style="background:#111;padding:32px 48px;border:2px solid #444;border-radius:12px;min-width:320px;text-align:center;box-shadow:0 0 32px rgba(0,0,0,0.6);color:#fff;">
        <h1 style="margin:0 0 12px;font-size:48px;letter-spacing:2px;${
          winner === gameData?.yourTeam ? "color:#4ade80;" : ""
        }${
    winner && winner !== gameData?.yourTeam ? "color:#ef4444;" : ""
  }">${heading}</h1>
        <p style="margin:0 0 20px;font-size:16px;opacity:0.8;">Match ${
          payload?.matchId ?? ""
        }</p>
        ${personalSummaryHtml || ""}
        ${rewardSectionHtml || ""}
        <button id="go-lobby" style="background:#2563eb;color:#fff;font-size:16px;padding:10px 22px;border:none;border-radius:6px;cursor:pointer;margin-top:20px;">Return to Lobby</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  document.getElementById("go-lobby").addEventListener("click", () => {
    window.location.href = "/";
  });
}
