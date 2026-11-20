import { BROWSER_EVENTS } from "../lib/browserEvents.js";
import "../styles/ui-system.css";
import { BROWSER_GLOBALS, getNavigation, getPageScope } from "../lib/globals.cjs";
import { setBattleLoading } from "../game/boot/battleLoading.js";
import { replayQueuedRemoteActions } from "../game/match/replayQueuedRemoteActions";
import { placeLocalFighter } from "../game/players/localSpawn";
import { createSpectatorCamera } from "../game/scene/spectatorCamera";
import { presentRemoteFrame } from "../game/scene/remoteInterpolation";
import { installMatchMusic } from "../game/audio/matchMusic";
import { installPhysicsDebugToggle } from "../game/scene/physicsDebug";
import { createPlayerLookup } from "../game/players/playerLookup";
import { requestMatchData } from "../navigation/gameData.js";
import { MATCH_ID_KEY } from "../lib/storageKeys.js";
import { createRemotePlayer, placeRemoteAtSpawn, applyRemoteRosterState, destroyRemote } from "../game/players/remotePlayerFactory";
import { supportsSuddenDeath } from "../../shared/modeCapabilities.js";
import { SOCKET_EVENTS } from "../../shared/net/socketEvents.js";
import { processPlayerPlatformCollision } from '../game/players/platformCollision';
import { loadGameFonts } from '../game/scene/loadGameFonts';
import { installDamageHitboxDebug } from '../game/scene/damageHitboxDebug';
import { installRigDebug } from '../game/scene/rigDebug';
import { bindGameAudio, getSettings, graphicsRenderScale, subscribeSettings } from "../site/preferences";
import { ensureLegalAcceptance, initSiteShell } from "../site/shell";
import { syncLocalEffects } from '../game/players/localStateSync';
import '../styles/mapPlaytest.css';
import '../styles/dashHud.css';
import '../styles/battlePixelHud.css';
import '../styles/levelBadge.css';
const editorSession = window.location.pathname === '/map-editor/playtest' ? new URLSearchParams(window.location.search).get('session') : null;
if (editorSession) document.body.classList.add('editor-playtest');
import { preloadMapDocument } from '../game/maps/documentRuntime';
import { buildScenery, preloadScenery } from '../game/maps/sceneryRuntime';
import { installMovingPlatforms, passesThrough } from "../game/maps/movingPlatforms";
import { installDisplayRatePhysics } from '../game/scene/displayRatePhysics';
import { attachCharacterNetworks, discardCharacterPresentation } from '../game/characters/networkRegistry';
import { noteRemoteView, noteLocalBodyFrame } from '../game/characters/shared/shotPrediction';
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
import { releaseRendererContext, rendererContextOf } from "../game/scene/releaseRenderer.js";
import { GAME_VIEW, fitGameSize, installViewportFit, viewportSize } from "../game/scene/gameViewport.js";
import { playMatchEndSound, startSuddenDeathMusic, stopSuddenDeathMusic } from "../game/audio/matchAudio.js";
import { createGameHudController } from "../game/hud/gameHudController";
import { createGameOverScreenController } from "../game/hud/gameOverScreenController";
import { createBattleTutorialController } from "../game/hud/battleTutorialController";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import { createGameChatController } from "../chat/gameChatController.js";
import { getLocalFighterEvents, focusBattleInput, isChatInputActive, setChatInputActive } from "../game/players/localPlayer";
import "../styles/chat.css";
import "../styles/mobileControls.css";
import { isTouchGameDevice } from "../game/scene/mobileControls.js";
import "../styles/tutorialTips.css";
import { createSnapshotBuffer, processSnapshotInterpolation } from "../game/match/snapshotBuffer";
import { readNetworkExperiments } from "../game/scene/remoteSmoothing.js";
import { createMatchCoordinator } from "../game/match/matchCoordinator";
import { syncRemoteRoster } from "../game/match/playerRosterMerge";
import { preloadGameAssets } from "../game/scene/preloadGameAssets";
import { createPoisonState, renderPoisonWater } from "../game/scene/poisonWaterRenderer";
import { updateDynamicCamera, restingCameraFrame } from "../game/scene/cameraDynamics";
import { createMatchIntro, FOLLOW_LERP } from "../game/scene/matchIntro";
import { installRenderResolution } from "../game/scene/renderResolution";
import { deferSceneAudio } from "../game/audio/deferredAudio";
import { createLocalInputSync } from "../game/scene/localInputSync";
import { localMovementCorrector } from "../game/players/localMovementCorrector";
import { getServerClockDiagnostics, serverNowMono } from "../game/match/serverClock";
import { installNetTrace } from "../game/match/netTrace";
import { updateHealthBars } from "../game/scene/healthBarRenderer";
import { createModeRuntime, loadMode, preloadModeAssets } from "../game/modes";
import {
  POWERUP_TYPES,
  POWERUP_ASSET_DIR,
  POWERUP_COLORS,
  createPowerupTickSounds,
} from "../game/powerups/powerupConfig";
import { createPowerupRenderer } from "../game/powerups/powerupRenderer";
import { RENDER_LAYERS } from "../game/scene/renderLayers";
import { createPlayer, syncLocalUiPosition, player, handlePlayerMovement, dead, setSuperStats, setPowerupMobility, setPowerupInvisible, applyAuthoritativeState, getAmmoSyncState, getNetworkInputState, getPlayerTutorialState, setLocalNetStateFlusher, setExternalControlLockUntil, destroyMobileControls } from "../game/players/localPlayer";
import { preloadForRoster, handleLocalAuthoritativeAttack, handleRemoteAttack, setupAll, setupVariantAnimationsForRoster, applyCharacterPowerupFx, drawCharacterPowerupAura, getCharacterEffectTickSounds } from "../game/characters";
import { clearAction } from "../game/characters/shared/animationState.js";
import socket, { waitForConnect } from "../lib/socket";
import { netFlagSearch, readNetFlags } from "../lib/netFlags";
import RemotePlayer from "../game/players/RemotePlayer";
import {
  configureClientNetTest,
  noteClientFrame,
  noteClientLifecycle,
  shouldMuteClientDefaultLogs,
} from "../lib/netTestLogger.js";
import MOVEMENT_PHYSICS from "../../shared/physics/movementPhysics.json";
import { POST_BATTLE_LOBBY_RETURN_KEY } from "../lib/storageKeys.js";
import "../styles/game.css";
import "../styles/battle-results.css";
import "../styles/ui-components.css";
import "../styles/loading.css";


initSiteShell();
wireFullscreenToggles();
// Touch players get on-screen controls; chat and settings stay desktop-only.
document.body.classList.toggle("bb-touch-game", isTouchGameDevice());

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

function initialGameSize() {
  const { width, height } = viewportSize();
  return fitGameSize(width, height);
}

function getTopPlayfieldPadding() {
  return Math.max(0, initialGameSize().height - GAME_VIEW.height);
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
  return sessionStorage.getItem(MATCH_ID_KEY);
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
window[BROWSER_GLOBALS.matchSession] = window[BROWSER_GLOBALS.matchSession] || {};

function setLocalSession({ level, stats }) {
  Object.assign(window[BROWSER_GLOBALS.matchSession], { level, stats });
}
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

// Server snapshot interpolation and input cadence comparisons (URL flags).
// Flags persist across lobby -> game navigation (lib/netFlags.js).
const networkExperiments = readNetworkExperiments(netFlagSearch());
const localInputSync = createLocalInputSync({
  socket,
  getAmmoSyncState,
  getNetworkInputState,
  throttleMs: 16,
  frameCadence: !networkExperiments.legacyInputCadence,
});
setLocalNetStateFlusher((state) =>
  localInputSync.flushNow(gameScene, player, state),
);

// Server snapshot interpolation
const snapshotBuffer = createSnapshotBuffer(networkExperiments);
window[BROWSER_GLOBALS.networkDiagnostics] = () => ({
  experiments: { ...networkExperiments },
  ...snapshotBuffer.getDiagnostics(),
  corrections: localMovementCorrector.getDiagnostics(),
  clock: getServerClockDiagnostics(),
});

// Opt-in production tracing (?nettrace=<run>&ntk=<token>); a no-op otherwise.
const disposeNetTrace = installNetTrace({
  socket,
  getLocal: () => player,
  getRemotes: () => [...Object.entries(opponentPlayers), ...Object.entries(teamPlayers)]
    .map(([name, w]) => (w?.opponent?.active ? { name, x: w.opponent.x, y: w.opponent.y } : null)),
  getUsername: () => username,
  getSnapshotDiagnostics: () => snapshotBuffer.getDiagnostics(),
  getCorrectionDiagnostics: () => localMovementCorrector.getDiagnostics(),
  getClockDiagnostics: getServerClockDiagnostics,
  serverNow: serverNowMono,
  getFlags: () => ({ urlFlags: readNetFlags(), effective: { ...networkExperiments,
    projectileLead: getServerClockDiagnostics().projectileLead } }),
  getCharacter: () => player?._bbCharacter || null,
  getEnemies: () => Object.entries(opponentPlayers)
    .map(([name, w]) => (w?.opponent?.active && w.opponent.visible !== false && !(w.opCurrentHealth <= 0)
      ? { name, x: w.opponent.x, y: w.opponent.y } : null)),
  toScreen: (x, y) => {
    const cam = gameScene?.cameras?.main, canvas = gameScene?.game?.canvas;
    if (!cam || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / (gameScene.scale?.width || rect.width);
    return { x: rect.left + (cam.x + (x - cam.worldView.x) * cam.zoom) * scale,
      y: rect.top + (cam.y + (y - cam.worldView.y) * cam.zoom) * scale };
  },
});
if (disposeNetTrace) getPageScope()?.onDispose(disposeNetTrace);

// Console check for remote fighters that should be on screen but are not.
window[BROWSER_GLOBALS.remotePlayers] = () =>
  [...Object.entries(opponentPlayers), ...Object.entries(teamPlayers)].map(([name, w]) => ({
    name,
    sprite: !!w?.opponent,
    active: w?.opponent?.active ?? null,
    visible: w?.opponent?.visible ?? null,
    alpha: w?.opponent?.alpha ?? null,
    x: w?.opponent ? Math.round(w.opponent.x) : w?.x,
    y: w?.opponent ? Math.round(w.opponent.y) : w?.y,
    depth: w?.opponent?.depth ?? null,
    loaded: w?.presenceLoaded ?? w?.loaded,
    spawnPresented: w?._spawnPresented ?? null,
    ghost: w ? w.presenceLoaded === false : null,
    live: isLiveGame,
  }));

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
    gameScene?._modeRuntime?.onCountdownFight?.();
    getNavigation()?.lobbyAudio?.handoff();
    try {
      if (gameScene) gameScene._bgmIntensity = 1;
      gameScene?._startMainBgm?.();
      gameScene?._bgmEnvelope?.fade(1, 900);
      gameScene?.cameras?.main?.shake?.(260, 0.006);
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
  onSpectatePrevious: () => gameScene?._spectatorCamera?.cycleSpectatedPlayer?.(-1),
  onSpectateNext: () => gameScene?._spectatorCamera?.cycleSpectatedPlayer?.(1),
});

// Pregame flythrough + pregame.mp3 between the loading screen and countdown.
const matchIntro = createMatchIntro({
  getScene: () => gameScene,
  getPlayer: () => player,
  getEnemySprites: () =>
    Object.values(opponentPlayers).map((wrapper) => wrapper?.opponent).filter(Boolean),
  getTour: getVaultTour,
  onActiveChange: (active) => hud.setPregameActive(active),
});

// Bank Bust tours from the enemy vault to ours. Spectators get the default shot.
function getVaultTour() {
  const vaults = gameData?.mapSnapshot?.map?.objectiveLayout?.bankBust?.vaults;
  const team = gameData?.yourTeam;
  const own = vaults?.[team];
  const enemy = Object.entries(vaults || {}).find(([key]) => key !== team)?.[1];
  const point = (vault) =>
    Number.isFinite(Number(vault?.x)) && Number.isFinite(Number(vault?.y))
      ? { x: Number(vault.x), y: Number(vault.y) }
      : null;
  const tour = { enemy: point(enemy), own: point(own) };
  return tour.enemy && tour.own ? tour : null;
}

// The loading screen lifted: this client's pregame starts and the server
// counts us as loaded. A match already counting down or live skips it.
function onGameRevealed() {
  clientRevealed = true;
  // Ease the world in from dark as the loading screen lifts.
  gameScene?.cameras?.main?.fadeIn(600, 0, 0, 0);
  trySendReadyAck();
  const skipPregame =
    isLiveGame || gameEnded || editorSession || gameData?.editorPlaytest ||
    hud.isBattleIntroActive?.();
  if (!skipPregame) matchIntro.beginPregame();
}
document.addEventListener(BROWSER_EVENTS.BATTLE_REVEALED, onGameRevealed, { once: true });

const poisonState = createPoisonState();
const battleTutorial = createBattleTutorialController({
  poisonState,
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
const playerLookup = createPlayerLookup({
  getUsername: () => username,
  getLocalPlayer: () => player,
  getOpponentPlayers: () => opponentPlayers,
  getTeamPlayers: () => teamPlayers,
});
matchCoordinator = createMatchCoordinator({
  poisonState,
  noteLocalKiller: name => gameScene?._spectatorCamera?.noteLocalKiller(name),
  playerLookup,
  socket,
  getLocalFighterEvents,
  onCharacterNetworksConfigured: () => {
    if (gameScene && player) attachMatchFighters(gameScene);
  },
  onAuthoritativeAmmo: (ammoState) => applyAuthoritativeState({ ammoState }),
  getGameData: () => gameData,
  getUsername: () => username,
  getJoinPayload: () => __joinPayload,
  getGameScene: () => gameScene,
  getPlayer: () => player,
  setLocalSession,
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
  RemotePlayer,
  handleLocalAuthoritativeAttack,
  handleRemoteAttack,
  powerupTickSounds: POWERUP_TICK_SOUNDS,
  onInitializePlayers: initializePlayers,
  onTrySendReadyAck: trySendReadyAck,
  onTrackShieldEffects: trackShieldEffectsPresence,
  onStartSuddenDeathMusic: () => startSuddenDeathMusic(gameScene),
  onStopSuddenDeathMusic: () => stopSuddenDeathMusic(gameScene),
  onPlayMatchEndSound: (winnerTeam) =>
    playMatchEndSound(gameScene, winnerTeam, gameData?.yourTeam, {
      skipSting: winnerTeam === gameData?.yourTeam && gameScene?._modeRuntime?.playedWinningGoal === true,
    }),
  onShowGameOverScreen: showGameOverScreen,
  isPresentationSuppressed: () => document.hidden,
});

function clearTransientPresentation() {
  PENDING_ACTIONS.length = 0;
  POWERUP_COLLECT_QUEUE.length = 0;
  DEATHDROP_COLLECT_QUEUE.length = 0;
  SHIELD_IMPACT_QUEUE.length = 0;
  discardCharacterPresentation();
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
    clearAction(sprite);
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

// Fetch game data from server
// Navigation requests a battle's match data alongside the page and scripts.
// A failed handoff falls back to a fresh request.
async function requestGameData() {
  const handoff = !editorSession && getNavigation()?.consumeGameData?.(matchId);
  const prefetched = handoff && await handoff.catch(() => null);
  if (prefetched) return prefetched;
  return requestMatchData(matchId, { editorSession });
}

async function fetchGameData() {
  try {
    const { ok, body: result } = await requestGameData();
    if (!ok || !result.success) {
      const error = new Error(result.error || "Failed to fetch game data");
      error.code = result.code;
      throw error;
    }

    return result.gameData;
  } catch (error) {
    // Missing consent is resolved by the caller's terms dialog.
    if (error.code === "TERMS_REQUIRED") throw error;
    console.error("Failed to fetch game data:", error);
    if (!getNavigation()) hud.showSystemNotice?.({
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
    // /gamedata enforces current terms, so ask only when it reports they are
    // missing instead of spending a request on every battle.
    gameData = await fetchGameData().catch(async (error) => {
      if (editorSession || error.code !== "TERMS_REQUIRED") throw error;
      await ensureLegalAcceptance();
      return fetchGameData();
    });
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

    // 3) Ensure connection; if not connected, connect and join on next connect.
    // Asset loading does not need the socket, so Phaser starts without waiting.
    waitForConnect(4000).catch(() => {});
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

function initKeybindHud() {
  return hud.initKeybindHud();
}

function initTeamStatusHud(players) {
  return hud.initTeamStatusHud(players);
}

// Initialize players based on server data
function attachMatchFighters(scene) {
  attachCharacterNetworks(scene, { localPlayer: player, localUsername: username,
    opponentPlayersRef: opponentPlayers, teamPlayersRef: teamPlayers });
}

function initializePlayers(players) {
  const refresh = syncRemoteRoster({
    players,
    username,
    yourTeam: gameData.yourTeam,
    opponentPlayers,
    teamPlayers,
    spritesBuilt: gameScene?._remoteSpritesBuilt === true,
    destroy: destroyRemote,
    // The scene turns these into sprites once it is ready.
    placeholder: (playerData) => ({
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
    }),
  });
  if (refresh) gameScene.initializeOtherPlayers();
}

// Number(null) is 0: a missing coordinate must not read as the map corner.
function isPosition(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

/**
 * Stand fighters on the server's spawns ({ [name]: { x, y } }). Used on
 * game:init and game:start; live games move players through snapshots and
 * corrections instead, so this does nothing once the fight is on.
 */
function applyServerSpawns(spawns) {
  if (!spawns || isLiveGame) return;
  const place = (sprite, spawn) => {
    if (!sprite?.body || !isPosition(spawn?.x) || !isPosition(spawn?.y)) return false;
    const x = Number(spawn.x);
    const y = Number(spawn.y);
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
getPageScope()?.onDispose(async () => {
  document.removeEventListener(BROWSER_EVENTS.BATTLE_REVEALED, onGameRevealed);
  matchIntro.dispose();
  matchCoordinator?.dispose();
  battleTutorial?.destroy();
  destroyMobileControls?.();
  document.body.classList.remove("bb-touch-game");
  if (game) {
    const retiring = game;
    game = null;
    const retiringContext = rendererContextOf(retiring);
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
    releaseRendererContext(retiringContext);
  }
});
setBattleLoading(50, "Loading arena...");
onReady(async () => {
    try {
      initKeybindHud();
      if (editorSession) { const controls=document.getElementById("battle-keybind-hud"); if(controls){controls.dataset.state="collapsed";controls.style.display="none";} }
      hud.initSpectateHud?.();
      initTimerHud();
      // Canvas text captures its font at creation; CSS preloads alone do not
      // guarantee it is decoded before the first Phaser text object is made.
      await Promise.all([
        initializeGame().then(() => {
          if (!gameData) throw new Error('Unable to initialize this battle');
          return loadMode(gameData.modeId);
        }),
        loadGameFonts(document.fonts),
      ]);
      if (getPageScope() && !getPageScope().active) return;
      if (!game) {
        game = new Phaser.Game(config);
      }
    } catch (error) {
      if (getPageScope()?.active) getNavigation()?.fail(error);
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
    deferSceneAudio(this, { holdDownloads: () => getNavigation()?.holdGameplayDownloads?.() });
    // Prepare cached roster media throughout visual loading. The HUD pauses
    // unfinished decoder work and optional downloads during the flythrough.
    if (!isLiveGame && !gameEnded && !editorSession && !gameData?.editorPlaytest) hud.prepareBattleCards();
    const onVisualProgress = (p) => {
      // 50% - 90%
      const pct = Math.floor(50 + p * 40); // maps 0-1 -> 50-90
      setBattleLoading(pct, "Loading arena...");
    };
    this.load.on("progress", onVisualProgress);

    this.load.once("complete", () => {
      this.load.off("progress", onVisualProgress);
      setBattleLoading(95, "Arena ready...");
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
    // One physics step per rendered frame, so the local fighter moves smoothly
    // on high-refresh displays instead of on alternate frames.
    installDisplayRatePhysics(this);
    // The coin is smooth artwork shown at a quarter of its size, which nearest
    // sampling turns to shimmer as it spins.
    if (this.textures.exists("coin-spin")) {
      this.textures.get("coin-spin").setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    // Poison water overlay graphics (sudden death - drawn every frame in update)
    // Map bounds are installed later; resolve the inactive level at render time.
    this.events.once("shutdown", () => {
      poisonState.targetY = null;
      poisonState.smoothY = null;
    });
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
    this._modeObjectiveGraphics = this.add.graphics();
    this._modeObjectiveGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS);
    this._modeObjectiveUiGraphics = this.add.graphics();
    this._modeObjectiveUiGraphics.setDepth(RENDER_LAYERS.PLAYER_HUD);
    this._modeRuntime = null;
    this._powerupRenderer = createPowerupRenderer({
      playerLookup,
      scene: this,
      Phaser,
      colors: POWERUP_COLORS,
      getUsername: () => username,
      getGameData: () => gameData,
      getLocalPlayer: () => player,
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
      setBattleLoading(96, "Server error. Refresh or return to lobby.");
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
    setBattleLoading(100, "Let's battle!");
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
    this._spectatorCamera = createSpectatorCamera(this, { getGameData: () => gameData, getUsername: () => username, getPlayer: () => player, opponentPlayers, teamPlayers, hud, followLocalPlayer });
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

    replayQueuedRemoteActions(this, PENDING_ACTIONS, { username, gameData, teamPlayers, opponentPlayers });

    installMatchMusic(this, {
      src: gameData?.mapSnapshot?.metadata?.musicAsset || getMapMusicAsset(gameData?.map),
      volume: gameData?.mapSnapshot?.metadata?.musicVolume ?? getMapMusicVolume(gameData?.map),
      isLive: () => isLiveGame,
    });

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
    });

    // The local HUD and combat setup read the session during player creation.
    const me = (gameData.players || []).find(p => p.name === username);
    if (me) setLocalSession({ level: me.level || 1, stats: me.stats || {} });

    // Creates player object using game data
    createPlayer(this, {
      getPlayerEffects: name => latestPlayerEffects?.[name],
      username,
      isSystemNoticeOpen: hud.isSystemNoticeOpen,
      character: gameData.yourCharacter,
      opponentPlayers,
      skinId: me?.selected_skin_id || "",
    });

    attachMapCollidersToSprite(this, player, mapObjects);
    installMovingPlatforms(this, {
      riders: () => (player && !dead ? [player] : []),
    });

    // Set initial super stats
    if (me) {
      setSuperStats(me.superCharge || 0, me.maxSuperCharge || 100);
    }

    // The roster maps are updated in place. Reattach when a scene gets its local fighter.
    attachMatchFighters(this);

    // Safety: ensure we never keep an RemotePlayer entry for myself
    try {
      if (username) {
        if (opponentPlayers && opponentPlayers[username]) {
          const op = opponentPlayers[username];
          destroyRemote(op);
          delete opponentPlayers[username];
        }
        if (teamPlayers && teamPlayers[username]) {
          const tp = teamPlayers[username];
          destroyRemote(tp);
          delete teamPlayers[username];
        }
      }
    } catch (_) {}
    placeLocalFighter(this, player, { state: pendingAuthoritativeLocalState, live: isLiveGame,
      spawnIndex: SERVER_SPAWN_INDEX[username], mapId: activeMapId, team: gameData.yourTeam, mapObjects });

    // Server stats are already applied above prior to createPlayer

    // Initialize other players from game data
    this.initializeOtherPlayers();

    // Toggle physics debug with Ctrl+M (ensures debug graphic exists)
    if (gameData?.editorPlaytest) installDamageHitboxDebug(this, socket);
    installRigDebug(this);
    installPhysicsDebugToggle(this, gameData?.editorDebugHitboxes === true);

    // Camera: smooth follow
    const cam = this.cameras.main;

    // Start with gentle tracking; cameraDynamics tightens follow at high speed.
    if (player && this._mapArena?.camera) {
      cam.setFollowOffset(0, restingCameraFrame(player.y, this._mapArena.camera).followOffsetY);
    }
    followLocalPlayer(cam);
    if (!this._modeRuntime) {
      this._modeRuntime = createModeRuntime({
        playerLookup,
        scene: this,
        Phaser,
        getGameData: () => gameData,
        getModeState: () => latestModeState,
        onGoal: discardCharacterPresentation,
        getMapObjects: () => mapObjects,
        getLocalPlayer: () => player,
      });
    }
    // End camera setup
  }

  initializeOtherPlayers() {
    const activeMapId = normalizeMapId(gameData?.map);
    // Create RemotePlayer instances for other players
    gameData.players.forEach((playerData) => {
      if (playerData.name === username) {
        return; // Skip local player
      }

      const isTeammate = playerData.team === gameData.yourTeam;
      const playerContainer = isTeammate ? teamPlayers : opponentPlayers;
      const existing = playerContainer[playerData.name];
      const reuse = existing?.opponent && existing._spawnVersion === SPAWN_VERSION;
      const opPlayer = reuse ? existing : createRemotePlayer(this, {
        Player: RemotePlayer, roster: playerData, gameData, spawnVersion: SPAWN_VERSION,
        getPlayerEffects: name => latestPlayerEffects?.[name],
      });
      const serverIndex = SERVER_SPAWN_INDEX[playerData.name];
      if (!reuse && typeof serverIndex === "number") opPlayer.spawnIndex = serverIndex;
      const spawnIndex = typeof opPlayer.spawnIndex === "number"
        ? opPlayer.spawnIndex
        : reuse ? serverIndex : playerData.spawnIndex;
      placeRemoteAtSpawn(this, opPlayer, playerData, { positionSpawn, mapId: activeMapId, spawnIndex });
      applyRemoteRosterState(opPlayer, playerData);
      if (reuse) return;

      playerContainer[playerData.name] = opPlayer;

      // TTL self-clean: if this instance isn't the canonical mapping soon, destroy it to avoid ghosts
      setTimeout(() => {
        try {
          if (playerContainer[playerData.name] !== opPlayer) {
            destroyRemote(opPlayer);
          }
        } catch (_) {}
      }, 1500);
    });
    // A game:init arriving after this point refreshes these sprites in place.
    this._remoteSpritesBuilt = true;
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

  _syncSpectatedPlayer(...args) { return this._spectatorCamera?.syncSpectatedPlayer(...args); }
  _cycleSpectatedPlayer(...args) { return this._spectatorCamera?.cycleSpectatedPlayer(...args); }

  update() {
    const suddenDeathEnabled = supportsSuddenDeath(latestModeState?.type || gameData?.modeId);
    const poisonAllowed =
      hasJoined &&
      gameInitialized &&
      !gameEnded &&
      !hud.isBattleIntroActive?.();
    renderPoisonWater(this, { player, dead, poisonState, active: poisonAllowed && suddenDeathEnabled });

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
      this._spectatorCamera.updateDeath();
    } else {
      this._spectatorCamera.updateAlive();
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
      // The frame's own timestamp: every frame is shown one refresh apart, but
      // performance.now() here also counts however long this frame's earlier
      // work took, which made remote fighters step unevenly.
      now: Number.isFinite(this.game?.loop?.now) ? this.game.loop.now : performance.now(),
      applyFrame: (frame) => {
        this._modeRuntime?.sample?.(frame);
        // Shots report this render time so the server aims at what was drawn.
        noteRemoteView(frame.targetMono, frame.interpDelayMs);
        this.interpolatePlayerStates(
          frame.aState,
          frame.bState,
          frame.alpha,
          frame,
        );
      },
      onDebugLine: (line) => {
        if (!shouldMuteClientDefaultLogs()) console.log(line);
      },
    });

    // This frame's body as sent: enemy shots are tested against past frames.
    noteLocalBodyFrame();
    updateHealthBars({ opponentPlayers, teamPlayers });
    noteClientFrame(this.game.loop.delta);
  }

  // Interpolate remote fighters only. Local position is owned by local
  // physics and the explicit movement-correction path.
  interpolatePlayerStates(aState, bState, alpha, frame = null) {
    const baseFrame = frame || { aState, bState, alpha, extrapolationMs: 0 };
    const context = { snapshotBuffer, latestPlayerEffects, networkExperiments, hud };
    for (const name in opponentPlayers) {
      presentRemoteFrame(this, opponentPlayers[name], name, baseFrame, context);
    }
    for (const name in teamPlayers) {
      presentRemoteFrame(this, teamPlayers[name], name, baseFrame, context);
    }
  }
}



const config = {
  audio: { context: getNavigation()?.getAudioContext() },
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
      document.dispatchEvent(new Event(BROWSER_EVENTS.RENDERER_CHANGED));
      game.events.once(Phaser.Core.Events.DESTROY, () => {
        delete game.canvas.dataset.gameRenderer;
        document.dispatchEvent(new Event(BROWSER_EVENTS.RENDERER_CHANGED));
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
    socket.emit(SOCKET_EVENTS.GAME_READY, { matchId: Number(matchId) });
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
      socket.emit(SOCKET_EVENTS.EDITOR_SELF_KILL);
    }
  },true);
}
