const membership = require("./membership");
const abandonment = require("./abandonment");
const simulation = require("./simulation");
const respawn = require("./respawn");

const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { roomChannel, teamChannel } = require("./channels");
const { getConfig } = require("../../config");
const { combatNow } = require("../../../shared/combat/runtime/clock");
const { requestSpecial } = require("../../../shared/combat/runtime/actions");
const damageResolver = require('../../../shared/combat/runtime/damageResolver.js');
const actionValidation = require('./actionValidation');
const playerTransport = require('./playerTransport');
const characterCombat = require('../../../shared/combat/runtime/characterCombatRegistry.js');
// Individual game room handling server-authoritative game state
const { ABANDON_MATCH_GRACE_MS, REGEN_DELAY_MS, REGEN_TICK_MS, REGEN_MISSING_RATIO, REGEN_MIN_ABS, REGEN_BROADCAST_MIN_MS } = require("../../../shared/combat/matchConfig.js");
const {
  FIXED_DT_MS,
  snapshotEveryTicksFor,
  WORLD_STATE_EVERY_TICKS,
} = require("../../../shared/gameConstants");

const powerupManager = require("./powerupManager");
const deathDropManager = require("./deathDropManager");
const combatValidation = require("../../../shared/combat/runtime/combatValidation.js");
const healthManager = require("./healthManager");
const timerManager = require("./timerManager");
const inputManager = require("./inputManager");
const rewardManager = require("./rewardManager");
const lifecycleManager = require("./lifecycleManager");
const roomStateManager = require("./roomStateManager");
const netTestLogger = require("./netTestLogger");
const { createTimingDiagnostics } = require("./timingDiagnostics");
const { netTrace } = require("./netTraceRecorder");

const characterActionRegistry = require("../../../shared/combat/runtime/characterActionRegistry.js");

const { createGameModeRuntime } = require("../gameModes");

const { getDuelGeometry } = require('../../../shared/physics/duelGeometry');

const { BotController } = require('../bots/controller');

const { getParticipant } = require('./participants');

class GameRoom {
  constructor(
    matchId,
    matchData,
    { io, db, runtimeConfig = null, abuseControl = null, playerActivity = null, matchResults = null, timingDiagnostics = true, navigation = null },
  ) {
    this.navigation = navigation;
    this.matchId = matchId;
    this.matchData = matchData; // { mode, map, players }
    this.io = io;
    this.db = db;
    this.runtimeConfig = runtimeConfig;
    this.abuseControl = abuseControl;
    this.playerActivity = playerActivity;
    this.matchResults = matchResults;

    // Room state
    this.status = "waiting"; // waiting, active, finished
    this.startTime = Date.now();
    this.players = new Map(); // socketId -> playerData
    this.rewardStats = new Map(); // name -> { userId, team, hits, damage, kills }
    this.gameState = null;
    this.mapSnapshot = matchData.editorMapSnapshot || require('../../services/maps/mapRepository').mapRepository.forMatch(matchId, matchData.map);
    this.geometry = getDuelGeometry(matchData.map, this.mapSnapshot.map);
    this.gameMode = createGameModeRuntime(this);
    this.modeState = this.gameMode?.createRoomState?.() ?? null;

    // Fixed-step loop state (see startGameLoop)
    this._loopRunning = false;
    this.traceCombatHit = (attacker, targetName, details) => netTrace.noteHit(this, attacker, targetName, details);
    this.traceShotGap = (details) => netTrace.noteShotGap(this, details);
    this.tickId = 0; // monotonically increasing per 60Hz tick
    this._chatSeq = 1;
    // Tick/snapshot cadence: src/shared/gameConstants.js
    this.FIXED_DT_MS = FIXED_DT_MS;
    // BB_SNAPSHOT_HZ (e.g. 60) changes the player snapshot rate for newly
    // created rooms; game:init tells clients the interval. Default 30 Hz.
    const diagnostics = getConfig().diagnostics;
    this.SNAPSHOT_EVERY_TICKS = snapshotEveryTicksFor(diagnostics.snapshotHz);
    this.WORLD_STATE_EVERY_TICKS = WORLD_STATE_EVERY_TICKS;
    // Rollback switch for comparing publication pacing; simulation is unchanged.
    this.COALESCE_SNAPSHOTS = diagnostics.coalesceSnapshots;
    // Gates timing/anti-cheat warnings. Routine periodic timing summaries are
    // further limited to development (or BB_TIMING_DIAG=1); stalls always log.
    this.DEV_TIMING_DIAG = timingDiagnostics;
    this._timingDiagnostics = createTimingDiagnostics(this, {
      fixedDtMs: this.FIXED_DT_MS,
      periodicSummaries: diagnostics.timing,
    });
    this.DEBUG_HIT_EVENTS = diagnostics.hitEvents;

    // Health regen tuning: src/shared/combat/matchConfig.js
    this.REGEN_DELAY_MS = REGEN_DELAY_MS;
    this.REGEN_TICK_MS = REGEN_TICK_MS;
    this.REGEN_MISSING_RATIO = REGEN_MISSING_RATIO;
    this.REGEN_MIN_ABS = REGEN_MIN_ABS;
    this.REGEN_BROADCAST_MIN_MS = REGEN_BROADCAST_MIN_MS;

    // Versioning for idempotent spawns on clients
    this.spawnVersion = Date.now();

    // Handshake before game start
    this._requiredUserIds = new Set(
      (Array.isArray(matchData?.players) ? matchData.players : [])
        .map((p) =>
          !p?.isBot && Number.isFinite(Number(p?.user_id))
            ? Number(p.user_id)
            : null,
        )
        .filter((id) => id !== null),
    );
    this._readyAt = new Map(); // user_id -> server time their pregame began
    this._startTimer = null;
    this._startDeadlineTimer = null;
    this._countdownTimeout = null;
    this._countdownEndsAt = 0;
    this._abandonTimer = null;
    this.ABANDON_MATCH_GRACE_MS = ABANDON_MATCH_GRACE_MS;

    // Powerups + timed effects (server authoritative)
    this.powerups = new Map(); // id -> { id, type, x, y, spawnedAt, expiresAt }
    this._nextPowerupId = 1;
    this._lastPowerupSpawnAt = 0;
    this._startingPowerupsPending = false;
    this._powerupSpawnBag = [];
    this._powerupTypeBag = [];
    this._recentPowerupSpawnKeys = [];
    this._lastPowerupType = null;
    this._lastPowerupTypeBySpawnKey = Object.create(null);
    this.deathDrops = new Map(); // id -> authoritative drop plan
    this._nextDeathDropId = 1;
    this._netTestEnabled = netTestLogger.isServerNetTestEnabled();

    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${matchId}] Created for mode ${matchData.modeId || matchData.mode}:${matchData.modeVariantId || ""} map ${matchData.map}`,
      );
    } else {
      netTestLogger.noteRoomCreated(this);
    }

    if (!getConfig().isProd) require('../../../shared/combat/runtime/hostContract').assertHost(this);
    characterCombat.initialize(this);
    this.botControllers = new simulation.BotControllers();
    this._scheduledActions = [];
    this._socketBindings = [];
    this._seedBotPlayers();
    if (this.geometry) for (const player of this.players.values()) {
      if (player.isBot) this.botControllers.set(player.participantId, new BotController(this, player));
    }
    lifecycleManager.armStartDeadline(this);
  }

  _seedBotPlayers() {
    return membership.seedBotPlayers(this);
  }

  // A fighter whose client has not joined yet still stands at its spawn as a
  // hittable ghost, so every human gets a server entry when the countdown
  // starts. Joining later takes this entry over like a reconnect.
  _seedAbsentHumans() {
    return membership.seedAbsentHumans(this);
  }

  async addPlayer(socket, user) {
    return membership.addPlayer(this, socket, user);
  }

  scheduleAction(callback, delayMs, now = Date.now()) {
    this._scheduledActions.push({ callback, at: now + Math.max(0, delayMs) });
  }

  applyKnockback(player, impulse) {
    require("./participants").applyParticipantKnockback(this, player, impulse);
  }

  requestSpecial(id, payload = {}) {
    if (this.gameMode?.acceptsCombatInput?.(payload, getParticipant(this, id)) === false) return false;
    return requestSpecial(this, id, payload);
  }

  /**
   * Remove a player from this game room
   * @param {object} socket
   * @param {object} user
   */
  async removePlayer(socket, user) {
    return membership.removePlayer(this, socket, user);
  }

  hasConnectedHumanPlayers() {
    for (const playerData of this.players.values()) {
      if (!playerData || playerData.isBot) continue;
      if (playerData.connected === false) continue;
      return true;
    }
    return false;
  }

  _cancelAbandonTimer(reason = "clear") {
    return abandonment.cancelAbandonTimer(this, reason);
  }

  _scheduleAbandonIfNoHumansConnected() {
    return abandonment.scheduleAbandonIfNoHumansConnected(this);
  }

  async cancelMatchAsAbandoned(reason) {
    return abandonment.cancelMatchAsAbandoned(this, reason);
  }

  /**
   * Set up socket event handlers for a player in this room
   * @param {object} socket
   */
  broadcast(event, payload, { compress = true } = {}) {
    const target = this.io.to(roomChannel(this.matchId));
    (compress ? target : target.compress(false)).emit(event, payload);
  }

  broadcastTeam(team, event, payload) {
    this.io.to(teamChannel(this.matchId, team)).emit(event, payload);
  }

  sendTo(player, event, payload) {
    if (player.socketId) this.io?.to(player.socketId).emit(event, payload);
  }

  onSocket(socket, event, listener) {
    socket.on(event, listener);
    this._socketBindings.push({ socket, event, listener });
  }

  removePlayerSocket(socket) {
    this._socketBindings = this._socketBindings.filter((binding) => {
      if (binding.socket !== socket) return true;
      socket.off(binding.event, binding.listener);
      return false;
    });
  }

  setupPlayerSocket(socket) {
    return playerTransport.setupPlayerSocket(this, socket);
  }

  /**
   * Send initial game state to a player
   * @param {object} socket
   */
  sendGameStateToPlayer(socket) {
    roomStateManager.sendGameStateToPlayer(this, socket);
  }

  /**
   * Schedule the countdown from the ready signals received so far (see
   * shared/matchIntroTiming). `force` starts now; used by the start deadline.
   * Quick Map Studio playtests bypass this countdown.
   */
  potentialStartGame(options) {
    lifecycleManager.potentialStartGame(this, options);
  }

  _noteReady(player) {
    return lifecycleManager.noteReady(this, player);
  }

  async broadcastParticipantStatus(statusLabel) {
    return lifecycleManager.broadcastParticipantStatus(this, statusLabel);
  }

  /**
   * Initialize spawn positions for players
   */
  initializeSpawnPositions() {
    this._seedAbsentHumans();
    roomStateManager.initializeSpawnPositions(this);
  }

  /** Authoritative start position for a participant (see roomStateManager). */
  spawnStateFor(player) {
    return roomStateManager.spawnStateFor(this, player);
  }

  /**
   * Start the server game loop
   */
  startGameLoop() {
    return simulation.startGameLoop(this);
  }

  /**
   * Advance the match timer and apply sudden-death poison logic each tick.
   * Call once per fixed-step tick (inside step() in startGameLoop).
   */
  _tickTimerAndSuddenDeath() {
    timerManager.tickTimerAndSuddenDeath(this);
  }

  _emitSnapshotWithTiming(snapMono) {
    this._timingDiagnostics?.noteSnapshot({
      nowMono: performance.now(),
      snapMono,
      tickId: this.tickId,
      burstSize: 1,
    });
    timerManager.emitSnapshotWithTiming(this, snapMono);
  }

  /**
   * Handle player input (movement, etc.)
   * @param {string} socketId
   * @param {object} inputData
   */
  handlePlayerInput(socketId, inputData) {
    inputManager.handlePlayerInput(this, socketId, inputData);
  }

  /**
   * Handle player actions (attacks, abilities)
   * @param {string} socketId
   * @param {object} actionData
   */
  handlePlayerAction(socketId, actionData) {
    const playerData = getParticipant(this, socketId);
    if (this.gameMode?.acceptsCombatInput?.(actionData, playerData) === false) return false;
    if (characterCombat.ownsAction(this, playerData, actionData)) {
      return characterCombat.requestAction(this, playerData, actionData);
    }
    if (
      !playerData ||
      !playerData.isAlive ||
      playerData.connected === false ||
      playerData.loaded !== true
    )
      return;
    if (Math.max(playerData._controlLockUntil || 0, playerData._attackInterruptedUntil || 0) > combatNow(this)) return;

    const sanitizedAction = actionValidation.sanitizeActionPayload(actionData);
    if (!sanitizedAction) return;

    try {
      const modeResult = this.gameMode?.handlePlayerAction?.(
        playerData,
        sanitizedAction,
      );
      if (modeResult?.handled) {
        if (modeResult?.broadcast) {
          this.broadcast(SOCKET_EVENTS.GAME_ACTION, {
            playerId: playerData.user_id,
            playerName: playerData.name,
            origin: { x: playerData.x, y: playerData.y },
            flip: !!playerData.flip,
            character: playerData.char_class,
            action: characterActionRegistry.withoutUnusedTerrain(sanitizedAction),
            t: combatNow(this),
          });
        }
        if (modeResult?.shouldBroadcastSnapshot) {
          this.broadcastSnapshot();
        }
        return;
      }
    } catch (e) {
      console.warn(
        `[GameRoom ${this.matchId}] mode handlePlayerAction failed`,
        e?.message,
      );
    }

    netTestLogger.noteAction(this, playerData, sanitizedAction.type);

    // Mark as combat to pause regen even if attack misses
    const actionNow = combatNow(this);
    playerData.lastCombatAt = actionNow;

    const characterActionResult = characterActionRegistry.handleCharacterAction(
      this,
      playerData,
      sanitizedAction,
      actionNow,
    );
    if (characterActionResult?.handled) return;

    // For now, just broadcast to other players
    characterActionRegistry.broadcastAction(
      this,
      playerData,
      sanitizedAction,
      combatNow(this),
    );
  }

  /**
   * Process a single game tick
   */
  processTick() {
    return simulation.processTick(this);
  }

  /**
   * Apply passive health regeneration to players who are out of combat.
   */
  processRegen() {
    healthManager.processRegen(this);
  }

  _spawnPowerup() {
    powerupManager.spawnPowerup(this);
  }

  isInSuddenDeathWater(playerData, nowTs) {
    return powerupManager.isInSuddenDeathWater(this, playerData, nowTs);
  }

  computePoisonY(sdElapsedMs) {
    return powerupManager.computePoisonY(this, sdElapsedMs);
  }

  applyPowerupToPlayer(playerData, type, nowTs, params = null) {
    powerupManager.applyPowerupToPlayer(this, playerData, type, nowTs, params);
  }

  _tickPowerups() {
    powerupManager.tickPowerups(this);
  }

  _tickDeathDrops() {
    deathDropManager.tickDeathDrops(this);
  }

  _tickPowerupEffects() {
    powerupManager.tickPowerupEffects(this);
  }

  _buildPlayerEffectsSnapshot() {
    return powerupManager.buildPlayerEffectsSnapshot(this);
  }

  _buildDeathDropsSnapshot() {
    return deathDropManager.buildDeathDropsSnapshot(this);
  }

  /**
   * Broadcast game state snapshot to all players
   */
  broadcastSnapshot(extraTiming = null) {
    roomStateManager.broadcastSnapshot(this, extraTiming);
  }

  broadcastWorldState() {
    roomStateManager.broadcastWorldState(this);
  }

  /**
   * Clean up room resources
   */
  cleanup() {
    if (this._disposed) return;
    clearTimeout(this._resultRetry);
    clearTimeout(this._finishCleanupTimer);
    this._resultRetry = null;
    this._finishCleanupTimer = null;
    this._disposed = true;
    lifecycleManager.clearPendingVictory(this);
    lifecycleManager.clearStartTimers(this);
    for (const { socket, event, listener } of this._socketBindings) socket.off(event, listener);
    this._socketBindings.length = 0;
    for (const controller of this.botControllers.values()) controller.dispose();
    this.botControllers.clear();
    this._scheduledActions.length = 0;
    this.activeAttacks = [];
    characterCombat.dispose(this);
    this.recentHits?.clear();
    this.recentCharacterActions?.clear();
    this.recentAttackInstances?.clear();
    this.damageHitboxes?.clear();
    this._snapshotEncoder = null;
    this._cancelAbandonTimer("cleanup");
    // Stop fixed-step loop
    this._loopRunning = false;

    // Disconnect all remaining players
    for (const playerData of this.players.values()) {
      if (playerData?._respawnTimeout) {
        clearTimeout(playerData._respawnTimeout);
        playerData._respawnTimeout = null;
      }
      const socket = this.io.sockets.sockets.get(playerData.socketId);
      if (socket) {
        socket.leave(roomChannel(this.matchId));
        socket.leave(teamChannel(this.matchId, playerData.team || "team1"));
      }
    }

    this.players.clear();
    this.matchData.players = [];
    this.rewardStats.clear();
    this._readyAt.clear();
    this._requiredUserIds.clear();
    this.powerups.clear();
    this.deathDrops.clear();
    if (!this._netTestEnabled) {
      console.log(`[GameRoom ${this.matchId}] Cleaned up`);
    }
  }

  // Getters
  getPlayerCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player && player.connected !== false) count++;
    }
    return count;
  }
  getStatus() {
    return this.status;
  }
  getStartTime() {
    return this.startTime;
  }

  /**
   * Return the per-character maximum hit acceptance distance (px).
   * Falls back to the generic "any|<type>" bucket when no exact entry exists.
   */
  getAttackMaxDist(charClass, attackType) {
    return combatValidation.getAttackMaxDist(charClass, attackType);
  }

  /**
   * Look up the recorded position of a player closest to `targetTimeMs` (wall ms).
   * Falls back to the player's current position when history is empty.
   */
  getHistoricalPosition(playerData, targetTimeMs) {
    return combatValidation.getHistoricalPosition(playerData, targetTimeMs);
  }

  /**
   * Handle a client-proposed hit. Server validates and applies damage.
   * @param {string} socketId
   * @param {object} payload { attacker, target, attackType?, instanceId?, attackTime?, damage? }
   */
  handleHit(socketId, payload, options = {}) {
    return damageResolver.handleHit(this, socketId, payload, options);
  }

  /**
   * Emit a health-update to all players in the room.
   */
  broadcastHealthUpdate(playerData, meta = {}) {
    healthManager.broadcastHealthUpdate(this, playerData, meta);
  }

  /**
   * Conditionally broadcast health if min interval elapsed.
   */
  maybeBroadcastHealth(playerData, nowTs, meta = {}) {
    healthManager.maybeBroadcastHealth(this, playerData, nowTs, meta);
  }

  /**
   * Evaluate whether one team has been fully eliminated and finish the game if so.
   */
  checkVictoryCondition() {
    lifecycleManager.checkVictoryCondition(this);
  }

  /**
   * Finish game, update DB, broadcast game over, and cleanup loop.
   * @param {string|null} winnerTeam null means draw
   */
  async finishGame(winnerTeam, meta = {}) {
    return lifecycleManager.finishGame(this, winnerTeam, meta);
  }

  ensureRewardBucket(playerData) {
    return rewardManager.ensureRewardBucket(this, playerData);
  }

  recordCombatStat(playerData, delta = {}) {
    rewardManager.recordCombatStat(this, playerData, delta);
  }

  async distributeMatchRewards(winnerTeam) {
    return this.matchResults ? this.matchResults.complete(this, winnerTeam) : rewardManager.distributeMatchRewards(this, winnerTeam);
  }

  handlePlayerDeath(playerData, meta = {}) {
    return deathDropManager.handlePlayerDeath(this, playerData, meta);
  }

  scheduleRespawn(playerData, plan = {}, meta = {}) {
    return respawn.scheduleRespawn(this, playerData, plan, meta);
  }

  pickupDeathDrop(socketId, payload) {
    return deathDropManager.handleDeathDropPickup(this, socketId, payload);
  }
}

module.exports = { GameRoom };
