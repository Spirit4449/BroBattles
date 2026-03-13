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
const BATTLE_HELP_DISMISSED_KEY = "bb_hide_keybind_hud_v1";
const TEAM_HUD_ROWS = new Map(); // name -> { row }
const POWERUP_TYPES = ["rage", "health", "shield", "poison", "gravityBoots"];
// Asset folder naming follows the requested convention under /assets/powerups/[name]/
const POWERUP_ASSET_DIR = {
  rage: "rage",
  health: "health",
  shield: "shield",
  poison: "poison",
  gravityBoots: "gravity-boots",
};
const POWERUP_COLORS = {
  rage: 0xa855f7,
  health: 0x34d399,
  shield: 0xf97316,
  poison: 0xfacc15,
  gravityBoots: 0xef4444,
  thorgRage: 0x9333ea,
};

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

function initTimerHud() {
  const hud = document.getElementById("game-timer-hud");
  if (hud) hud.classList.add("hidden");
}

function updateTimerHud(remainingMs, suddenDeath) {
  const hud = document.getElementById("game-timer-hud");
  const display = document.getElementById("game-timer-display");
  const label = document.getElementById("game-timer-label");
  if (!hud) return;
  hud.classList.remove("hidden");
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (display) display.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
  if (suddenDeath) {
    hud.classList.add("sudden-death");
    if (label) label.textContent = "SUDDEN DEATH";
  } else {
    hud.classList.remove("sudden-death");
    if (label) label.textContent = "Time Reamining";
  }
}

function showSuddenDeathBanner() {
  const existing = document.getElementById("sd-flash-banner");
  if (existing) return;
  const banner = document.createElement("div");
  banner.id = "sd-flash-banner";
  banner.textContent = "SUDDEN DEATH";
  Object.assign(banner.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%) scale(0.3)",
    fontFamily: "'Press Start 2P', cursive",
    fontSize: "clamp(28px, 6vw, 52px)",
    color: "#f87171",
    textShadow: "0 4px 0 #7f1d1d, 0 0 30px rgba(248,113,113,0.85)",
    zIndex: "10000",
    letterSpacing: "4px",
    pointerEvents: "none",
    transition:
      "transform 0.5s cubic-bezier(0.34,1.56,0.64,1), opacity 0.7s ease",
    opacity: "0",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(banner);
  requestAnimationFrame(() => {
    banner.style.transform = "translate(-50%, -50%) scale(1)";
    banner.style.opacity = "1";
  });
  setTimeout(() => {
    banner.style.opacity = "0";
    banner.style.transform = "translate(-50%, -50%) scale(1.3)";
    setTimeout(() => banner.remove(), 600);
  }, 2500);
}

function initKeybindHud() {
  const hud = document.getElementById("battle-keybind-hud");
  const dismissBtn = document.getElementById("battle-keybind-dismiss");
  if (!hud) return;

  let dismissed = false;
  try {
    dismissed = localStorage.getItem(BATTLE_HELP_DISMISSED_KEY) === "1";
  } catch (_) {}
  hud.classList.toggle("hidden", dismissed);

  if (!dismissBtn) return;
  dismissBtn.addEventListener("click", () => {
    hud.classList.add("hidden");
    try {
      localStorage.setItem(BATTLE_HELP_DISMISSED_KEY, "1");
    } catch (_) {}
  });
}

function initTeamStatusHud(players) {
  const root = document.getElementById("team-status-hud");
  const grid = document.getElementById("team-status-grid");
  if (!root || !grid) return;

  grid.innerHTML = "";
  TEAM_HUD_ROWS.clear();

  const list = Array.isArray(players) ? players : [];
  const sorted = [...list].sort((a, b) => {
    if (a?.name === username) return -1;
    if (b?.name === username) return 1;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });

  const makeCell = (p) => {
    const cell = document.createElement("div");
    cell.className = "team-hud-cell";
    if (!p) return cell;

    const row = document.createElement("li");
    row.className = "team-hud-player";
    if (p?.isAlive === false) row.classList.add("dead");

    const img = document.createElement("img");
    const cls = (p?.char_class || "ninja").toLowerCase();
    img.src = `/assets/${cls}/body.webp`;
    img.alt = cls;

    const nameEl = document.createElement("div");
    nameEl.className = "team-hud-player-name";
    const name = String(p?.name || "Player");
    nameEl.textContent = name + (name === username ? " (You)" : "");

    row.appendChild(img);
    row.appendChild(nameEl);
    cell.appendChild(row);
    TEAM_HUD_ROWS.set(name, { row });
    return cell;
  };

  const yourTeam = sorted.filter((p) => p?.team === gameData?.yourTeam);
  const oppTeam = sorted.filter((p) => p?.team !== gameData?.yourTeam);

  const yourHeader = document.createElement("div");
  yourHeader.className = "team-hud-title";
  yourHeader.textContent = "Your Team";
  const oppHeader = document.createElement("div");
  oppHeader.className = "team-hud-title";
  oppHeader.textContent = "Other Team";
  grid.appendChild(yourHeader);
  grid.appendChild(oppHeader);

  const rows = Math.max(yourTeam.length, oppTeam.length);
  for (let i = 0; i < rows; i++) {
    grid.appendChild(makeCell(yourTeam[i]));
    grid.appendChild(makeCell(oppTeam[i]));
  }

  root.classList.toggle("hidden", sorted.length === 0);
}

function setTeamHudPlayerAlive(name, isAlive) {
  if (!name) return;
  const entry = TEAM_HUD_ROWS.get(String(name));
  if (!entry?.row) return;
  entry.row.classList.toggle("dead", !isAlive);
}

function setTeamHudPlayerPresence(name, connected) {
  if (!name) return;
  const entry = TEAM_HUD_ROWS.get(String(name));
  if (!entry?.row) return;
  entry.row.classList.toggle("disconnected", !connected);
}

function setTeamHudPlayerLoaded(name, loaded) {
  if (!name) return;
  const entry = TEAM_HUD_ROWS.get(String(name));
  if (!entry?.row) return;
  entry.row.classList.toggle("loading", !loaded);
}

function syncTeamHudFromSnapshot(playersByName) {
  if (!playersByName || typeof playersByName !== "object") return;
  for (const [name, data] of Object.entries(playersByName)) {
    if (typeof data?.health === "number") {
      setTeamHudPlayerAlive(name, data.health > 0);
    }
    if (typeof data?.connected === "boolean") {
      setTeamHudPlayerPresence(name, data.connected);
    }
    if (typeof data?.loaded === "boolean") {
      setTeamHudPlayerLoaded(name, data.loaded);
    }
  }
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
  socket.on("game:joined", () => {
    hasJoined = true;
  });
  // If we're already connected when listeners are added, attempt once now
  if (socket.connected) tryJoin();

  // Game initialization
  socket.on("game:init", (gameState) => {
    console.log("Game initialized:", {
      players: Array.isArray(gameState?.players) ? gameState.players.length : 0,
      status: gameState?.status,
    });
    gameInitialized = true;
    hasJoined = true;
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
          if (typeof p.connected === "boolean") {
            setTeamHudPlayerPresence(p.name, p.connected);
          }
          if (typeof p.loaded === "boolean") {
            setTeamHudPlayerLoaded(p.name, p.loaded);
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
    if (gameData?.players) {
      // Initialize opponent and team players based on server data
      initializePlayers(gameData.players);
      initTeamStatusHud(
        Array.isArray(gameState?.players) && gameState.players.length
          ? gameState.players
          : gameData.players,
      );
    }
    if (Array.isArray(gameState.powerups)) latestPowerups = gameState.powerups;
    if (
      gameState.playerEffects &&
      typeof gameState.playerEffects === "object"
    ) {
      latestPlayerEffects = gameState.playerEffects;
      trackShieldEffectsPresence(latestPlayerEffects);
    }

    // Cache my level and stats for character modules
    try {
      const me = (gameState.players || []).find((p) => p.name === username);
      if (me) {
        window.__MATCH_SESSION__.level = me.level || 1;
        window.__MATCH_SESSION__.stats = me.stats || {};
        pendingAuthoritativeLocalState = {
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
        };
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

  socket.on("health-update", (payload) => {
    if (!payload?.username) return;
    if (typeof payload.health === "number") {
      setTeamHudPlayerAlive(payload.username, payload.health > 0);
      const prev = LAST_HEALTH_BY_PLAYER[payload.username];
      LAST_HEALTH_BY_PLAYER[payload.username] = payload.health;
      if (
        typeof prev === "number" &&
        payload.health < prev &&
        ((latestPlayerEffects?.[payload.username]?.shield || 0) > 0 ||
          Date.now() - (LAST_SHIELD_ACTIVE_AT[payload.username] || 0) <= 900)
      ) {
        SHIELD_IMPACT_QUEUE.push({
          username: payload.username,
          at: Date.now(),
        });
      }
    }
  });

  socket.on("player:dead", (payload) => {
    if (!payload?.username) return;
    setTeamHudPlayerAlive(payload.username, false);
  });

  // No periodic join retries needed; reconnect handler covers transient drops

  // Server snapshots for interpolation
  socket.on("game:snapshot", (snapshot) => {
    if (!snapshot || !snapshot.players) return;
    if (Array.isArray(snapshot.powerups)) latestPowerups = snapshot.powerups;
    if (snapshot.playerEffects && typeof snapshot.playerEffects === "object") {
      latestPlayerEffects = snapshot.playerEffects;
      trackShieldEffectsPresence(latestPlayerEffects);
    }
    syncTeamHudFromSnapshot(snapshot.players);
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
          serverMonoOffset.toFixed(2),
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
              String(gameData.map),
            );
            op._spawnVersion = SPAWN_VERSION;
            try {
              const idx =
                typeof SERVER_SPAWN_INDEX[pd.name] === "number"
                  ? SERVER_SPAWN_INDEX[pd.name]
                  : Math.max(
                      0,
                      (gameData.players || [])
                        .filter((p) => p.team === pd.team)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .findIndex((p) => p.name === pd.name),
                    );
              if (String(gameData.map) === "1") {
                positionLushySpawn(
                  gameScene,
                  op.opponent,
                  pd.team,
                  idx,
                  (gameData.players || []).filter((p) => p.team === pd.team)
                    .length,
                );
              } else if (String(gameData.map) === "2") {
                positionMangroveSpawn(gameScene, op.opponent, pd.team, idx);
              }
              op.updateUIPosition?.();
            } catch (_) {}
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
            2,
          )}ms n=${arr.length}`,
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
          String(gameData.map),
        );
        container[pd.name] = op;
        wrapper = op;
        op._spawnVersion = SPAWN_VERSION;
        try {
          const idx =
            typeof SERVER_SPAWN_INDEX[pd.name] === "number"
              ? SERVER_SPAWN_INDEX[pd.name]
              : Math.max(
                  0,
                  (gameData.players || [])
                    .filter((p) => p.team === pd.team)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .findIndex((p) => p.name === pd.name),
                );
          if (String(gameData.map) === "1") {
            positionLushySpawn(
              gameScene,
              op.opponent,
              pd.team,
              idx,
              (gameData.players || []).filter((p) => p.team === pd.team).length,
            );
          } else if (String(gameData.map) === "2") {
            positionMangroveSpawn(gameScene, op.opponent, pd.team, idx);
          }
          op.updateUIPosition?.();
        } catch (_) {}
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
      // Prevent snapshot idle/run animation from immediately stomping attack anims.
      if (consumed && wrapper) {
        wrapper._animLockUntil = performance.now() + 520;
      }
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
    if (data?.name) {
      setTeamHudPlayerPresence(data.name, false);
      setTeamHudPlayerLoaded(data.name, false);
    }
  });

  socket.on("player:reconnected", (data) => {
    if (data?.name) {
      setTeamHudPlayerPresence(data.name, true);
    }
  });

  // Game over event (team elimination)
  socket.on("game:over", (payload) => {
    if (gameEnded) return; // idempotent
    gameEnded = true;
    stopSuddenDeathMusic();
    playMatchEndSound(payload?.winnerTeam);
    try {
      player && player.body && (player.body.enable = false);
    } catch (_) {}
    // Hide timer HUD
    try {
      document.getElementById("game-timer-hud")?.classList.add("hidden");
    } catch (_) {}
    setTimeout(() => {
      showGameOverScreen(payload);
    }, 2000);
  });

  // Server-synced game timer and sudden death
  socket.on("game:timer", (payload) => {
    updateTimerHud(payload.remaining, payload.suddenDeath);
    if (
      payload.suddenDeath &&
      typeof payload.poisonY === "number" &&
      gameScene
    ) {
      gameScene._poisonWaterY = payload.poisonY;
      startSuddenDeathMusic();
    }
  });

  socket.on("game:sudden-death:start", (payload) => {
    showSuddenDeathBanner();
    startSuddenDeathMusic();
    if (gameScene && typeof payload?.poisonY === "number") {
      gameScene._poisonWaterY = payload.poisonY;
    }
  });

  socket.on("powerup:collected", (payload) => {
    if (!payload || typeof payload.id === "undefined") return;
    POWERUP_COLLECT_QUEUE.push(payload);
  });

  socket.on("powerup:tick", (payload) => {
    if (!payload || !payload.type || !gameScene || !gameScene.sound) return;
    // Tick SFX only on effects that feel periodic
    if (payload.type === "poison") {
      try {
        gameScene.sound.play("pu-tick-poison", { volume: 0.28 });
      } catch (_) {}
    } else if (payload.type === "health") {
      try {
        gameScene.sound.play("pu-tick-health", { volume: 0.2 });
      } catch (_) {}
    } else if (payload.type === "rage") {
      try {
        gameScene.sound.play("pu-tick-rage", { volume: 0.18 });
      } catch (_) {}
    } else if (payload.type === "thorgRage") {
      try {
        gameScene.sound.play("pu-tick-rage", { volume: 0.22, rate: 0.9 });
      } catch (_) {}
    } else if (payload.type === "gravityBoots") {
      try {
        gameScene.sound.play("pu-tick-gravityBoots", { volume: 0.2 });
      } catch (_) {}
    }
  });
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

    // Character assets (preload all registered characters)
    preloadAll(this, staticPath);

    this.load.image("tiles-image", `${staticPath}/map.webp`);
    this.load.tilemapTiledJSON("tiles", `${staticPath}/tilesheet.json`);
    this.load.image("lushy-base", `${staticPath}/lushy/base.webp`);
    this.load.image("lushy-platform", `${staticPath}/lushy/largePlatform.webp`);
    this.load.image(
      "lushy-side-platform",
      `${staticPath}/lushy/sidePlatform.webp`,
    );
    this.load.image(
      "mangrove-tiny-platform",
      `${staticPath}/mangrove/tinyPlatform.webp`,
    );
    this.load.image(
      "mangrove-base-left",
      `${staticPath}/mangrove/baseLeft.webp`,
    );
    this.load.image(
      "mangrove-base-middle",
      `${staticPath}/mangrove/baseMiddle.webp`,
    );
    this.load.image(
      "mangrove-base-right",
      `${staticPath}/mangrove/baseRight.webp`,
    );
    this.load.image("mangrove-base-top", `${staticPath}/mangrove/baseTop.webp`);
    this.load.image("thorg-weapon", `${staticPath}/thorg/weapon.webp`);
    // Movement SFX (place files under /assets/audio)
    this.load.audio("sfx-step", `${staticPath}/step.mp3`);
    this.load.audio("sfx-jump", `${staticPath}/jump.mp3`);
    this.load.audio("sfx-land", `${staticPath}/land.mp3`);
    this.load.audio("sfx-walljump", `${staticPath}/walljump.mp3`);
    this.load.audio("sfx-sliding", `${staticPath}/sliding.mp3`);
    this.load.audio("sfx-sudden-death", `${staticPath}/suddendeath.mp3`);
    this.load.audio("sfx-noammo", [
      `${staticPath}/noammo.mp3`,
      `${staticPath}/land.mp3`,
    ]);
    // Combat/health SFX
    this.load.audio("sfx-damage", `${staticPath}/damage.mp3`);
    this.load.audio("sfx-heal", `${staticPath}/heal.mp3`);
    // Music (non-blocking BGM: handled via HTMLAudio at runtime)
    this.load.audio("win", `${staticPath}/win.mp3`);
    this.load.audio("lose", `${staticPath}/lose.mp3`);
    // Powerup assets (support common icon/audio extensions)
    for (const type of POWERUP_TYPES) {
      const dir = POWERUP_ASSET_DIR[type] || type;
      this.load.image(
        `pu-icon-${type}-webp`,
        `${staticPath}/powerups/${dir}/icon.webp`,
      );
      this.load.audio(`pu-touch-${type}`, [
        `${staticPath}/powerups/${dir}/touch.mp3`,
        `${staticPath}/powerups/${dir}/touch.wav`,
      ]);
      this.load.audio(`pu-tick-${type}`, [
        `${staticPath}/powerups/${dir}/tick.mp3`,
        `${staticPath}/powerups/${dir}/tick.wav`,
      ]);
    }
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

    this.events.once("shutdown", () => {
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
      String(gameData.map),
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
      if (String(gameData.map) === "1") {
        positionLushySpawn(this, player, gameData.yourTeam, myIndex, teamSize);
      } else if (String(gameData.map) === "2") {
        positionMangroveSpawn(this, player, gameData.yourTeam, myIndex);
      }
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
    cam.setBounds(contentCenterX - 850, -40, 1700, this.game.config.height);

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
          if (String(gameData.map) === "1") {
            positionLushySpawn(
              this,
              existing.opponent,
              playerData.team,
              index,
              (gameData.players || []).filter((p) => p.team === playerData.team)
                .length,
            );
          } else if (String(gameData.map) === "2") {
            positionMangroveSpawn(
              this,
              existing.opponent,
              playerData.team,
              index,
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
        (gameData.players || []).filter((p) => p.team === playerData.team)
          .length,
        String(gameData.map), // map as string for spawn helpers
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
        if (String(gameData.map) === "1") {
          positionLushySpawn(
            this,
            opPlayer.opponent,
            playerData.team,
            index,
            (gameData.players || []).filter((p) => p.team === playerData.team)
              .length,
          );
        } else if (String(gameData.map) === "2") {
          positionMangroveSpawn(
            this,
            opPlayer.opponent,
            playerData.team,
            index,
          );
        }
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

  _powerupTextureFor(type) {
    const webpKey = `pu-icon-${type}-webp`;
    const pngKey = `pu-icon-${type}-png`;
    if (this.textures.exists(webpKey)) return webpKey;
    if (this.textures.exists(pngKey)) return pngKey;
    return null;
  }

  _powerupLabelFor(type) {
    if (type === "gravityBoots") return "B";
    if (type === "shield") return "S";
    return String(type || "?")
      .charAt(0)
      .toUpperCase();
  }

  _spawnTrailParticle(x, y, color, r = 5, life = 260) {
    const c = this.add.circle(x, y, r, color, 0.75);
    c.setDepth(19);
    this.tweens.add({
      targets: c,
      y: y - Phaser.Math.Between(10, 24),
      x: x + Phaser.Math.Between(-8, 8),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.2, 1.8),
      scaleY: Phaser.Math.FloatBetween(1.2, 1.8),
      duration: life,
      ease: "Quad.easeOut",
      onComplete: () => c.destroy(),
    });
  }

  _getSpriteByUsername(name) {
    if (!name) return null;
    if (name === username) return player;
    const w = opponentPlayers[name] || teamPlayers[name];
    return w?.opponent || null;
  }

  _spawnPlusParticle(x, y, color, size = 7, life = 380) {
    const g = this.add.graphics();
    g.setDepth(19);
    g.fillStyle(color, 0.88);
    g.fillRect(-size * 0.5, -size * 0.18, size, size * 0.36);
    g.fillRect(-size * 0.18, -size * 0.5, size * 0.36, size);
    g.x = x;
    g.y = y;
    this.tweens.add({
      targets: g,
      y: y - Phaser.Math.Between(22, 42),
      x: x + Phaser.Math.Between(-10, 10),
      alpha: 0,
      angle: Phaser.Math.Between(-25, 25),
      scaleX: Phaser.Math.FloatBetween(1.1, 1.7),
      scaleY: Phaser.Math.FloatBetween(1.1, 1.7),
      duration: life,
      ease: "Quad.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  _spawnArrowParticle(
    x,
    y,
    color,
    angle = -Math.PI / 2,
    size = 11,
    life = 260,
  ) {
    const g = this.add.graphics();
    g.setDepth(19);
    g.fillStyle(color, 0.9);
    // Arrow body
    g.fillRect(-size * 0.5, -size * 0.12, size * 0.62, size * 0.24);
    // Arrow head
    g.beginPath();
    g.moveTo(size * 0.12, -size * 0.32);
    g.lineTo(size * 0.52, 0);
    g.lineTo(size * 0.12, size * 0.32);
    g.closePath();
    g.fillPath();
    // Tiny white accent for readability
    g.fillStyle(0xffffff, 0.72);
    g.fillRect(-size * 0.34, -size * 0.06, size * 0.24, size * 0.12);

    g.x = x;
    g.y = y;
    g.rotation = angle;
    this.tweens.add({
      targets: g,
      x: x - Math.cos(angle) * Phaser.Math.Between(18, 30),
      y: y - Math.sin(angle) * Phaser.Math.Between(18, 30),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.9, 1.25),
      scaleY: Phaser.Math.FloatBetween(0.9, 1.25),
      duration: life,
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  _applyPowerupCharacterFX(spr, fx, nowSec) {
    if (!spr || !spr.active) return;
    if (typeof spr._puBaseScaleX !== "number") {
      spr._puBaseScaleX = spr.scaleX || 1;
      spr._puBaseScaleY = spr.scaleY || 1;
    }
    if (typeof spr._puBaseOriginX !== "number") {
      spr._puBaseOriginX = typeof spr.originX === "number" ? spr.originX : 0.5;
      spr._puBaseOriginY = typeof spr.originY === "number" ? spr.originY : 0.5;
    }
    const baseX = spr._puBaseScaleX || 1;
    const baseY = spr._puBaseScaleY || 1;
    const baseOriginX = spr._puBaseOriginX ?? 0.5;
    const baseOriginY = spr._puBaseOriginY ?? 0.5;
    const rageOn = (fx?.rage || 0) > 0;
    const thorgRageOn = (fx?.thorgRage || 0) > 0;
    const healthOn = (fx?.health || 0) > 0;
    const poisonOn = (fx?.poison || 0) > 0;
    const bootsOn = (fx?.gravityBoots || 0) > 0;

    spr._thorgRageActive = thorgRageOn;

    if (thorgRageOn) {
      const pulse = 0.5 + 0.5 * Math.sin(nowSec * 10 + (spr.x || 0) * 0.012);
      spr.setTint(pulse > 0.52 ? 0xc084fc : 0x7e22ce);
      spr.setScale(baseX * 1.14, baseY * 1.14);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.72) {
        this._spawnTrailParticle(
          spr.x + Phaser.Math.Between(-18, 18),
          spr.y + Phaser.Math.Between(-34, 14),
          POWERUP_COLORS.thorgRage,
          Phaser.Math.FloatBetween(3.6, 6.2),
          340,
        );
      }
      if (Math.random() < 0.28) {
        this._spawnTrailParticle(
          spr.x + Phaser.Math.Between(-12, 12),
          spr.y + Phaser.Math.Between(-38, 4),
          0xffffff,
          Phaser.Math.FloatBetween(2.6, 4.2),
          260,
        );
      }
    } else if (rageOn) {
      const pulse = Math.sin(nowSec * 8 + (spr.x || 0) * 0.01);
      // Rage keeps a fixed size boost; only tint pulses.
      spr.setTint(pulse > 0 ? 0xc084fc : 0x9333ea);
      spr.setScale(baseX * 1.22, baseY * 1.22);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.32) {
        this._spawnTrailParticle(
          spr.x + Phaser.Math.Between(-14, 14),
          spr.y + Phaser.Math.Between(-26, 18),
          POWERUP_COLORS.rage,
          3.5,
          300,
        );
      }
    } else if (healthOn) {
      const healthPulse = Math.sin(nowSec * 5 + (spr.x || 0) * 0.01);
      spr.setTint(healthPulse > 0 ? 0x86efac : 0x34d399);
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.55) {
        this._spawnPlusParticle(
          spr.x + Phaser.Math.Between(-16, 16),
          spr.y + Phaser.Math.Between(-30, 8),
          POWERUP_COLORS.health,
          9,
          430,
        );
      }
    } else if (poisonOn) {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.42) {
        this._spawnTrailParticle(
          spr.x + Phaser.Math.Between(-12, 12),
          spr.y + Phaser.Math.Between(-18, 18),
          POWERUP_COLORS.poison,
          4.3,
          300,
        );
      }
    } else if (bootsOn) {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      spr.setTint(0xfca5a5);
      const vy = spr.body?.velocity?.y || 0;
      const vx = spr.body?.velocity?.x || 0;
      if (vy < -35 && Math.random() < 0.72) {
        const moveAngle = Math.atan2(
          vy || -140,
          Math.abs(vx) > 8 ? vx : spr.flipX ? -24 : 24,
        );
        this._spawnArrowParticle(
          spr.x + Phaser.Math.Between(-12, 12),
          spr.y + Phaser.Math.Between(8, 20),
          POWERUP_COLORS.gravityBoots,
          moveAngle + Phaser.Math.FloatBetween(-0.24, 0.24),
          Phaser.Math.Between(9, 13),
          280,
        );
      }
    } else {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
    }
  }

  _consumeCollectedPowerupQueue() {
    while (POWERUP_COLLECT_QUEUE.length > 0) {
      const evt = POWERUP_COLLECT_QUEUE.shift();
      if (!evt) continue;
      const id = String(evt.id);
      const visual = this._powerupVisuals[id];
      try {
        this.sound.play(`pu-touch-${evt.type}`, { volume: 0.45 });
      } catch (_) {}
      if (visual && !visual.despawning) {
        visual.despawning = true;
        this.tweens.add({
          targets: [visual.container, visual.glow],
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          angle: 180,
          duration: 220,
          ease: "Back.easeIn",
          onComplete: () => {
            try {
              visual.glow.destroy();
              visual.container.destroy();
            } catch (_) {}
            delete this._powerupVisuals[id];
          },
        });
      } else if (typeof evt.x === "number" && typeof evt.y === "number") {
        // Fallback poof if snapshot already removed this sprite
        const puff = this.add.circle(
          evt.x,
          evt.y,
          14,
          POWERUP_COLORS[evt.type] || 0xffffff,
          0.9,
        );
        puff.setDepth(6);
        this.tweens.add({
          targets: puff,
          alpha: 0,
          scaleX: 1.9,
          scaleY: 1.9,
          duration: 220,
          ease: "Quad.easeOut",
          onComplete: () => puff.destroy(),
        });
      }
    }
  }

  _spriteFrameForAura(spr) {
    if (!spr) {
      return { x: 0, y: 0, top: 0, bottom: 0, radius: 24 };
    }
    const body = spr.body;
    if (
      body &&
      Number.isFinite(body.center?.x) &&
      Number.isFinite(body.center?.y)
    ) {
      const w = Math.max(14, Number(body.width) || 14);
      const h = Math.max(20, Number(body.height) || 20);
      return {
        x: body.center.x,
        y: body.center.y,
        top: Number(body.top) || body.center.y - h / 2,
        bottom: Number(body.bottom) || body.center.y + h / 2,
        radius: Phaser.Math.Clamp(Math.max(w, h) * 0.58, 18, 46),
      };
    }
    const h = Number(spr.height) || 48;
    return {
      x: spr.x,
      y: spr.y,
      top: spr.y - h / 2,
      bottom: spr.y + h / 2,
      radius: Phaser.Math.Clamp(h * 0.58, 18, 46),
    };
  }

  _renderPowerupAuras(nowSec) {
    const g = this._powerupAuraGraphics;
    if (!g) return;
    g.clear();

    const me = latestPlayerEffects[username] || {};
    const speedMult =
      ((me.rage || 0) > 0 ? 1.25 : 1) * ((me.thorgRage || 0) > 0 ? 1.12 : 1);
    const jumpMult =
      ((me.gravityBoots || 0) > 0 ? 1.5 : 1) *
      ((me.thorgRage || 0) > 0 ? 1.12 : 1);
    setPowerupMobility(speedMult, jumpMult);

    const drawAura = (spr, fx) => {
      if (!spr || !fx) return;
      const frame = this._spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      const r = frame.radius;
      const pulse = 0.75 + 0.25 * Math.sin(nowSec * 8 + x * 0.01);
      if ((fx.health || 0) > 0) {
        g.fillStyle(POWERUP_COLORS.health, 0.12 * pulse);
        g.fillCircle(x, y, r + 4 * pulse);
        g.lineStyle(3, POWERUP_COLORS.health, 0.75 * pulse);
        g.strokeCircle(x, y, r + 4 * pulse);
      }
      if ((fx.shield || 0) > 0) {
        g.fillStyle(POWERUP_COLORS.shield, 0.22);
        g.fillCircle(x, y, Math.max(16, r - 4 + 4 * pulse));
        g.lineStyle(4, POWERUP_COLORS.shield, 0.82 * pulse);
        g.strokeCircle(x, y, Math.max(16, r - 4 + 4 * pulse));
        g.fillStyle(0xffedd5, 0.08 + 0.05 * pulse);
        g.fillCircle(x, y, Math.max(12, r - 16 + 2 * pulse));
      }
      if ((fx.poison || 0) > 0) {
        g.fillStyle(POWERUP_COLORS.poison, 0.1 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 2 + 3 * pulse));
        g.lineStyle(3, POWERUP_COLORS.poison, 0.75 * pulse);
        g.strokeCircle(x, y, Math.max(16, r - 2 + 3 * pulse));
      }
      if ((fx.rage || 0) > 0) {
        g.fillStyle(POWERUP_COLORS.rage, 0.2 + 0.08 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 4 + 4 * pulse));
        g.lineStyle(3.5, POWERUP_COLORS.rage, 0.85 * pulse);
        g.strokeCircle(x, y, r + 3 + 4 * pulse);
        g.lineStyle(
          2.5,
          0xffffff,
          0.3 + 0.25 * Math.abs(Math.sin(nowSec * 16 + y * 0.015)),
        );
        g.strokeCircle(x, y, r + 8 + 2.2 * pulse);
      }
      if ((fx.gravityBoots || 0) > 0) {
        const bootY = frame.bottom - 2;
        g.fillStyle(POWERUP_COLORS.gravityBoots, 0.22 * pulse);
        g.fillEllipse(x, bootY, Math.max(28, r + 4), 10);
        g.lineStyle(2, POWERUP_COLORS.gravityBoots, 0.75 * pulse);
        g.strokeEllipse(x, bootY, Math.max(28, r + 4), 10);
      }
      if ((fx.thorgRage || 0) > 0) {
        g.fillStyle(POWERUP_COLORS.thorgRage, 0.22 + 0.08 * pulse);
        g.fillCircle(x, y, r + 6 + 5 * pulse);
        g.lineStyle(4.5, POWERUP_COLORS.thorgRage, 0.88 * pulse);
        g.strokeCircle(x, y, r + 12 + 5 * pulse);
        g.lineStyle(
          3,
          0xffffff,
          0.28 + 0.18 * Math.abs(Math.sin(nowSec * 18 + y * 0.02)),
        );
        g.strokeCircle(x, y, r + 18 + 2.5 * pulse);
      }
    };

    drawAura(player, latestPlayerEffects[username] || {});
    this._applyPowerupCharacterFX(
      player,
      latestPlayerEffects[username] || {},
      nowSec,
    );
    for (const [name, fx] of Object.entries(latestPlayerEffects || {})) {
      if (name === username) continue;
      const wrapper = opponentPlayers[name] || teamPlayers[name];
      if (!wrapper || !wrapper.opponent) continue;
      drawAura(wrapper.opponent, fx);
      this._applyPowerupCharacterFX(wrapper.opponent, fx, nowSec);
    }

    // Shield impact pulses when shielded players take damage.
    const fxG = this._powerupFxGraphics;
    while (SHIELD_IMPACT_QUEUE.length > 0) {
      const impact = SHIELD_IMPACT_QUEUE.shift();
      const spr = this._getSpriteByUsername(impact?.username);
      if (!spr || !fxG) continue;
      const frame = this._spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      for (let i = 0; i < 3; i++) {
        const ring = this.add.circle(
          x,
          y,
          24 + i * 4,
          POWERUP_COLORS.shield,
          0.22 - i * 0.05,
        );
        ring.setDepth(22);
        ring.setStrokeStyle(3, 0xffedd5, 0.85);
        this.tweens.add({
          targets: ring,
          alpha: 0,
          scaleX: 1.45 + i * 0.08,
          scaleY: 1.45 + i * 0.08,
          duration: 220 + i * 40,
          ease: "Cubic.easeOut",
          onComplete: () => ring.destroy(),
        });
      }
    }
  }

  _renderPowerupsAndEffects() {
    this._consumeCollectedPowerupQueue();
    const nowSec = this.time.now / 1000;
    const seenIds = new Set();
    const fxG = this._powerupFxGraphics;
    if (fxG) fxG.clear();

    for (const pu of latestPowerups || []) {
      if (!pu || typeof pu.id === "undefined") continue;
      const id = String(pu.id);
      seenIds.add(id);
      let visual = this._powerupVisuals[id];
      if (!visual) {
        const glow = this.add.circle(
          pu.x,
          pu.y,
          16,
          POWERUP_COLORS[pu.type] || 0xffffff,
          0.28,
        );
        glow.setDepth(4);
        const iconKey = this._powerupTextureFor(pu.type);
        const children = [];
        let spr = null;
        if (iconKey) {
          spr = this.add.image(0, 3, iconKey);
          spr.setOrigin(0.5, 0.5);
          // Normalize icon size so giant source images don't overflow and look offset.
          const maxDim = Math.max(spr.width || 1, spr.height || 1);
          const targetSize = 42;
          const s = maxDim > 0 ? targetSize / maxDim : 1;
          spr.setScale(s);
          children.push(spr);
        } else {
          const badge = this.add.circle(
            0,
            0,
            12,
            POWERUP_COLORS[pu.type] || 0xffffff,
            0.9,
          );
          const lbl = this.add.text(0, -1, this._powerupLabelFor(pu.type), {
            fontFamily: "Press Start 2P",
            fontSize: "10px",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3,
          });
          lbl.setOrigin(0.5, 0.5);
          children.push(badge, lbl);
        }
        const container = this.add.container(pu.x, pu.y, children);
        container.setDepth(5);
        visual = {
          id,
          type: pu.type,
          x: pu.x,
          y: pu.y,
          expiresAt: Number(pu.expiresAt) || 0,
          glow,
          sprite: spr,
          container,
          phase: Math.random() * Math.PI * 2,
          despawning: false,
        };
        visual.container.setAlpha(0);
        visual.glow.setAlpha(0);
        visual.container.setScale(0.55);
        visual.glow.setScale(0.45);
        this.tweens.add({
          targets: [visual.container, visual.glow],
          alpha: 1,
          scaleX: 1,
          scaleY: 1,
          duration: 480,
          ease: "Back.easeOut",
        });
        this._powerupVisuals[id] = visual;
      }

      if (!visual.despawning) {
        visual.expiresAt = Number(pu.expiresAt) || visual.expiresAt || 0;
        visual.x = pu.x;
        visual.y = pu.y;
        const bob = Math.sin(nowSec * 2.8 + visual.phase) * 5;
        let shakeX = 0;
        let shakeY = 0;
        if (visual.expiresAt > 0) {
          const remainingMs = visual.expiresAt - Date.now();
          if (remainingMs <= 2800) {
            const warn = Phaser.Math.Clamp(1 - remainingMs / 2800, 0, 1);
            const speed = 12 + warn * 5;
            const amp = 0.8 + warn * 1.8;
            shakeX = Math.sin(nowSec * speed + visual.phase * 3) * amp;
            shakeY =
              Math.cos(nowSec * (speed * 1.13) + visual.phase * 3) * amp * 0.6;
          }
        }
        visual.container.x = pu.x + shakeX;
        visual.container.y = pu.y - 6 + bob + shakeY;
        visual.glow.x = pu.x + shakeX;
        visual.glow.y = pu.y - 6 + bob + shakeY + 1;
        visual.glow.alpha =
          0.18 + 0.18 * Math.abs(Math.sin(nowSec * 3.5 + visual.phase));
        visual.glow.radius =
          16 + 4 * Math.abs(Math.sin(nowSec * 2.7 + visual.phase));
        // Half-spin/pixel-distort feel
        if (visual.sprite) {
          const baseS = visual.sprite.scaleY || 1;
          visual.sprite.scaleX =
            baseS * (0.9 + 0.1 * Math.sin(nowSec * 4.1 + visual.phase));
          visual.sprite.scaleY = baseS;
          visual.sprite.rotation = 0.05 * Math.sin(nowSec * 2.1 + visual.phase);
        }

        // Per-powerup VFX: animated rings + orbiting particles for visibility.
        if (fxG) {
          const c = POWERUP_COLORS[pu.type] || 0xffffff;
          const ringCy = visual.container.y + 8;
          const r1 = 21 + 4 * Math.sin(nowSec * 3 + visual.phase);
          const r2 = 27 + 3 * Math.sin(nowSec * 2.1 + visual.phase + 0.8);
          if (pu.type === "rage") {
            const shimmer =
              0.28 + 0.22 * Math.abs(Math.sin(nowSec * 14 + visual.phase));
            fxG.fillStyle(POWERUP_COLORS.rage, 0.22);
            fxG.fillCircle(
              visual.container.x,
              ringCy,
              18 + 2 * Math.sin(nowSec * 5 + visual.phase),
            );
            fxG.lineStyle(3, 0xffffff, shimmer);
            fxG.strokeCircle(visual.container.x, ringCy, r1 + 6);
            for (let i = 0; i < 3; i++) {
              const aa = nowSec * (2.3 + i * 0.2) + visual.phase + i * 2.1;
              fxG.fillStyle(0xffffff, 0.75 - i * 0.15);
              fxG.fillCircle(
                visual.container.x + Math.cos(aa) * (r1 + 4),
                ringCy + Math.sin(aa) * (r1 + 4),
                2.2 - i * 0.35,
              );
            }
          }
          fxG.lineStyle(2.5, c, 0.6);
          fxG.strokeCircle(visual.container.x, ringCy, r1);
          fxG.lineStyle(2.5, c, 0.38);
          fxG.strokeCircle(visual.container.x, ringCy, r2);
          for (let i = 0; i < 4; i++) {
            const a = nowSec * (1.6 + i * 0.15) + visual.phase + i * 1.57;
            const px = visual.container.x + Math.cos(a) * (r1 + 3);
            const py = ringCy + Math.sin(a) * (r1 + 3);
            fxG.fillStyle(c, 0.8);
            fxG.fillCircle(px, py, 3);
          }
        }
      }
    }

    for (const [id, visual] of Object.entries(this._powerupVisuals)) {
      if (seenIds.has(id) || visual.despawning) continue;
      visual.despawning = true;
      this.tweens.add({
        targets: [visual.container, visual.glow],
        alpha: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => {
          try {
            visual.glow.destroy();
            visual.container.destroy();
          } catch (_) {}
          delete this._powerupVisuals[id];
        },
      });
    }

    this._renderPowerupAuras(nowSec);
  }

  update() {
    // Draw poison water overlay (rendered every frame, including when dead)
    if (this._poisonGraphics) {
      const g = this._poisonGraphics;
      g.clear();

      // Smooth-lerp toward server-sent Y so 500ms updates don't cause visible jumps
      const worldH =
        Number(this.scale?.height) || Number(this.game.config.height) || 1000;
      if (this._smoothPoisonY == null)
        this._smoothPoisonY = this._poisonWaterY ?? worldH + 60;
      const poisonTargetY = this._poisonWaterY ?? worldH + 60;
      const poisonDelta = poisonTargetY - this._smoothPoisonY;
      const poisonLerp = Math.abs(poisonDelta) > 60 ? 0.2 : 0.07;
      this._smoothPoisonY += poisonDelta * poisonLerp;
      const py = this._smoothPoisonY;

      if (py < worldH + 10) {
        const W =
          Number(this.scale?.width) || Number(this.game.config.width) || 1300;
        const BOTTOM = worldH + 40; // extend below world so no gap at screen edge
        const t = this.time.now / 1000; // seconds
        // Dual-harmonic wave function
        const amp = 7;
        const waveY = (x) =>
          py +
          amp * Math.sin(x * 0.011 + t * 1.7) +
          amp * 0.4 * Math.sin(x * 0.024 - t * 1.1);

        // 1. Dark base body - wave surface down to bottom
        const basePts = [{ x: 0, y: BOTTOM }];
        for (let x = 0; x <= W; x += 8) basePts.push({ x, y: waveY(x) });
        basePts.push({ x: W, y: BOTTOM });
        g.fillStyle(0x166534, 0.48);
        g.fillPoints(basePts, true);

        // 2. Mid-depth overlay - slightly lighter, surface shifted down to show depth
        const midPts = [{ x: 0, y: BOTTOM }];
        for (let x = 0; x <= W; x += 8) midPts.push({ x, y: waveY(x) + 16 });
        midPts.push({ x: W, y: BOTTOM });
        g.fillStyle(0x16a34a, 0.27);
        g.fillPoints(midPts, true);

        // 3. Bright glowing surface stroke
        g.lineStyle(3, 0x4ade80, 0.95);
        g.beginPath();
        for (let x = 0; x <= W; x += 8) {
          x === 0 ? g.moveTo(x, waveY(x)) : g.lineTo(x, waveY(x));
        }
        g.strokePath();

        // 4. Foam flecks along wave crests
        g.fillStyle(0xd1fae5, 0.85);
        for (let x = 20; x < W; x += 55) {
          const wy = waveY(x);
          const r = 1.8 + 1.4 * Math.abs(Math.sin(t * 1.3 + x * 0.05));
          g.fillCircle(x + 8 * Math.sin(t * 0.9 + x * 0.03), wy - r * 0.3, r);
        }

        // 5. Rising bubble particles
        for (const b of this._poisonBubbles) {
          const range = BOTTOM - 20 - (py + amp + 8);
          if (range <= 0) continue;
          const elapsed = (t + b.phase * 4) % (range / b.speed);
          const bY = BOTTOM - 20 - elapsed * b.speed;
          if (bY < py + amp || bY > BOTTOM - 5) continue;
          const bX = b.x + b.drift * Math.sin(t * 0.7 + b.phase);
          const alpha = Math.min(0.6, (bY - py) / 35) * 0.9;
          g.fillStyle(0x86efac, alpha);
          g.fillCircle(bX, bY, b.r);
        }

        // 6. Sync CSS background overlay (fills viewport area outside Phaser canvas)
        const cssDiv = document.getElementById("poison-water-bg");
        if (cssDiv) {
          const canvasH = this.game.canvas.clientHeight || 650;
          const frac = Math.max(0, Math.min(1, (worldH - py) / worldH));
          cssDiv.style.height = Math.floor(frac * canvasH) + "px";
          cssDiv.style.display = "block";

          // 7. Red vignette when local player is submerged
          const vigEl = document.getElementById("water-vignette");
          if (vigEl) {
            const inWater = player && player.y >= py;
            vigEl.classList.toggle("water-danger-active", !!inWater && !dead);
            if (!inWater || dead) vigEl.style.opacity = "0";
          }
        }
      } else {
        const cssDiv = document.getElementById("poison-water-bg");
        if (cssDiv) cssDiv.style.display = "none";
        const vigEl2 = document.getElementById("water-vignette");
        if (vigEl2) {
          vigEl2.classList.remove("water-danger-active");
          vigEl2.style.opacity = "0";
        }
      }
    }

    // Powerup visuals/effects are rendered for all players every frame.
    this._renderPowerupsAndEffects();

    // Dynamic zoom: smoothly zoom out as the player climbs higher.
    // Keep bottom gameplay unchanged at 1.7, but reduce top zoom-out so
    // horizontal vision doesn't expand too much on high platforms.
    if (player) {
      const cam = this.cameras.main;
      const t = Phaser.Math.Clamp((player.y - 80) / (520 - 80), 0, 1);
      const targetZoom = 1.3 + (1.7 - 1.3) * t;
      cam.setZoom(cam.zoom + (targetZoom - cam.zoom) * 0.05);

      // When high up, bias the camera lower to reveal more below and reduce
      // the amount of empty sky shown above top-platform fights.
      const highFactor = 1 - t;
      const targetFollowOffsetY = 120 + 80 * highFactor;
      cam.setFollowOffset(
        0,
        cam.followOffset.y + (targetFollowOffsetY - cam.followOffset.y) * 0.08,
      );
    }

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
          loaded: true,
          ammoState: getAmmoSyncState(),
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
            }`,
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
            1,
          )}ms spacingEma=${spacingEma?.toFixed(
            2,
          )} jitterEma=${jitterEma?.toFixed(2)} buffer=${stateBuffer.length}`,
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

      // Position interpolation target
      let targetX = spr.x;
      let targetY = spr.y;
      if (isLoaded) {
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
      }

      // Direct snap to interpolated position (adaptive delay already smoothing jitter)
      spr.x = targetX;
      spr.y = targetY;
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
          let chosenAnim = animSrc.animation || "idle";
          if ((wrapper.character || "").toLowerCase() === "thorg") {
            const dx =
              (bPosData?.x ?? aPosData?.x ?? spr.x) -
              (aPosData?.x ?? bPosData?.x ?? spr.x);
            const dy =
              (bPosData?.y ?? aPosData?.y ?? spr.y) -
              (aPosData?.y ?? bPosData?.y ?? spr.y);
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const attackLike =
              typeof chosenAnim === "string" &&
              /throw|attack|slash/i.test(chosenAnim);

            if (attackLike) {
              // Avoid stale remote attack loops by selecting locomotion from motion.
              if (absDy > 1.8) {
                chosenAnim = dy < 0 ? "jumping" : "falling";
              } else if (absDx > 1.2) {
                chosenAnim = "running";
              } else {
                chosenAnim = "idle";
              }
            } else if (absDy > 2.2) {
              chosenAnim = dy < 0 ? "jumping" : "falling";
            } else if (absDx <= 0.7) {
              chosenAnim = "idle";
            }
          }
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
  // Show game timer HUD once battle begins
  try {
    document.getElementById("game-timer-hud")?.classList.remove("hidden");
  } catch (_) {}
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
  try {
    if (myReward) {
      sessionStorage.setItem(
        POST_MATCH_REWARD_STORAGE_KEY,
        JSON.stringify({
          at: Date.now(),
          coinsAwarded: Number(myReward.coinsAwarded) || 0,
          gemsAwarded: Number(myReward.gemsAwarded) || 0,
        }),
      );
    }
  } catch (_) {}
  const escapeHtml = (val) =>
    String(val ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const baseRowStyle =
    "display:grid;grid-template-columns:2fr 1.1fr repeat(3,1fr);gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid rgba(176,219,255,0.18);font-size:13px;";
  const headerRow = `
    <div style="${baseRowStyle}font-weight:600;border-bottom:1px solid rgba(176,219,255,0.3);text-transform:uppercase;font-size:11px;color:#cce8ff;font-family:'Press Start 2P', cursive;">
      <div style="text-align:left;">Player</div>
      <div>Team</div>
      <div>Hits</div>
      <div>Damage</div>
      <div>Kills</div>
    </div>`;
  const rewardRowsHtml = rewards
    .map((r) => {
      const isYou = r.username === username;
      const rowStyle = `${baseRowStyle}${
        isYou
          ? "background:rgba(88,157,226,0.2);border-bottom-color:rgba(126,194,255,0.45);"
          : ""
      }`;
      const label = `${escapeHtml(r.username)}${
        isYou ? ' <span style="font-size:11px;color:#c3e4ff;">(You)</span>' : ""
      }`;
      return `
        <div style="${rowStyle}">
          <div style="text-align:left;font-weight:${
            isYou ? 600 : 500
          };">${label}</div>
          <div>${escapeHtml(String(r.team || "-").toUpperCase())}</div>
          <div>${r.hits ?? 0}</div>
          <div>${r.damage ?? 0}</div>
          <div>${r.kills ?? 0}</div>
        </div>`;
    })
    .join("");
  const rewardSectionHtml = rewards.length
    ? `
      <div style="margin-top:28px;text-align:left;">
        <h2 style="margin:0 0 10px;font-size:18px;color:#e8f4ff;font-family:'Press Start 2P', cursive;">Match Results</h2>
        <div style="border:1px solid rgba(123,191,255,0.35);border-radius:10px;overflow:hidden;background:rgba(14,34,58,0.75);">
          ${headerRow}
          ${rewardRowsHtml}
        </div>
      </div>`
    : "";
  const personalSummaryHtml = myReward
    ? `
      <div style="margin-top:16px;padding:16px 18px;border-radius:10px;background:rgba(76,146,214,0.16);border:1px solid rgba(125,189,255,0.45);text-align:center;">
        <div style="font-size:15px;font-weight:600;margin-bottom:10px;color:#d7eeff;">You Earned</div>
        <div style="display:flex;justify-content:center;gap:26px;align-items:center;font-size:20px;font-weight:600;">
          <span style="display:flex;align-items:center;gap:8px;color:#facc15;"><img src="/assets/coin.webp" width="18" height="18" alt="coins" />${
            myReward.coinsAwarded ?? 0
          }</span>
          <span style="display:flex;align-items:center;gap:8px;color:#67e8f9;"><img src="/assets/gem.webp" width="18" height="18" alt="gems" />${
            myReward.gemsAwarded ?? 0
          }</span>
        </div>
        <div style="margin-top:6px;font-size:13px;color:#c8e6ff;">
          ${myReward.hits ?? 0} hits | ${myReward.damage ?? 0} dmg | ${
            myReward.kills ?? 0
          } kills
        </div>
      </div>`
    : "";
  div.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:radial-gradient(circle at 12% 14%, rgba(146,205,255,0.22), transparent 38%), rgba(5,12,20,0.72);font-family:'Poppins',sans-serif;">
      <div style="position:relative;background:linear-gradient(180deg,#204874f2,#153357f2);padding:32px 48px;border:3px solid #78bdff;border-radius:14px;min-width:320px;max-width:min(980px,92vw);text-align:center;box-shadow:0 16px 38px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(220,240,255,0.2);color:#fff;">
        <div style="position:absolute;inset:8px;border:1px dashed rgba(199,230,255,0.45);border-radius:10px;pointer-events:none;"></div>
        <h1 style="margin:0 0 12px;font-size:44px;letter-spacing:2px;font-family:'Press Start 2P',cursive;line-height:1.2;${
          winner === gameData?.yourTeam ? "color:#9fffc3;" : ""
        }${
          winner && winner !== gameData?.yourTeam ? "color:#ff9a9a;" : ""
        }">${heading}</h1>
        ${personalSummaryHtml || ""}
        ${rewardSectionHtml || ""}
        <button id="go-lobby" style="background:linear-gradient(180deg,#4fa5ff,#3d87df);color:#fff;font-size:14px;font-family:'Press Start 2P',cursive;padding:11px 18px;border:1px solid #d5ecff;border-radius:8px;box-shadow:0 3px 0 #1f4f83, 0 8px 18px rgba(0,0,0,0.22);cursor:pointer;margin-top:20px;">Return to Lobby (10)</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  let leaving = false;
  let countdown = 10;
  const button = document.getElementById("go-lobby");
  const goToLobby = async () => {
    if (leaving) return;
    leaving = true;
    try {
      const res = await fetch("/status", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const pid = Number(data?.party_id);
        if (Number.isFinite(pid) && pid > 0) {
          window.location.href = `/party/${pid}`;
          return;
        }
      }
    } catch (_) {}
    try {
      const myPartyId = Number(
        (gameData?.players || []).find((p) => p.name === username)?.party_id,
      );
      if (Number.isFinite(myPartyId) && myPartyId > 0) {
        window.location.href = `/party/${myPartyId}`;
        return;
      }
    } catch (_) {}
    window.location.href = "/";
  };
  const timer = setInterval(() => {
    countdown -= 1;
    if (button)
      button.textContent = `Return to Lobby (${Math.max(0, countdown)})`;
    if (countdown <= 0) {
      clearInterval(timer);
      goToLobby();
    }
  }, 1000);
  button.addEventListener("click", async () => {
    clearInterval(timer);
    await goToLobby();
  });
}
