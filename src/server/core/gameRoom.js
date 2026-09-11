const damageResolver = require('./gameRoom/damageResolver');
const actionValidation = require('./gameRoom/actionValidation');
const playerTransport = require('./gameRoom/playerTransport');
const characterCombat = require('./gameRoom/characterCombatRegistry');
// gameRoom.js
// Individual game room handling server-authoritative game state
const {
  POWERUP_STARTING_COUNT
} = require("./gameRoomConfig");

const effectManager = require("./gameRoom/effects/effectManager");

const powerupManager = require("./gameRoom/powerupManager");
const deathDropManager = require("./gameRoom/deathDropManager");
const combatValidation = require("./gameRoom/combatValidation");
const healthManager = require("./gameRoom/healthManager");
const timerManager = require("./gameRoom/timerManager");
const inputManager = require("./gameRoom/inputManager");
const rewardManager = require("./gameRoom/rewardManager");
const lifecycleManager = require("./gameRoom/lifecycleManager");
const roomStateManager = require("./gameRoom/roomStateManager");
const netTestLogger = require("./gameRoom/netTestLogger");
const { createTimingDiagnostics } = require("./gameRoom/timingDiagnostics");
const attackRuntimeManager = require("./gameRoom/attackRuntimeManager");
const characterActionRegistry = require("./gameRoom/characterActionRegistry");

const { createGameModeRuntime } = require("./gameModes");
const {
  activateSpecial,
  tickActiveAbilities
} = require("./gameRoom/abilityRuntimeManager");

const { getDuelGeometry, spawnForParticipant } = require('../../shared/duelGeometry');
const { BotController } = require('./bots/controller');
const { startNinjaSwarm } = require('./bots/combat');

const { getParticipant, participantId } = require('./gameRoom/participants');
const { deleteMatchBots } = require('../services/matchRosterService');

class GameRoom {
  constructor(
    matchId,
    matchData,
    { io, db, runtimeConfig = null, abuseControl = null, playerActivity = null, matchResults = null },
  ) {
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
    this.mapSnapshot = matchData.editorMapSnapshot || require('../services/mapRepository').mapRepository.forMatch(matchId, matchData.map, matchData.modeVariantId || matchData.mode);
    this.geometry = getDuelGeometry(matchData.map, this.mapSnapshot.variant, this.mapSnapshot.map);
    this.gameMode = createGameModeRuntime(this);
    this.modeState = this.gameMode?.createRoomState?.() ?? null;

    // Game loop (will migrate to fixed-step accumulator + snapshot cadence)
    this.gameLoop = null; // legacy interval reference (used only until refactor start)
    this._loopRunning = false;
    this._tickId = 0; // monotonically increasing per 60Hz tick
    this._lastSnapshotMono = 0;
    this._snapshotIntervals = []; // diagnostics (ms spacing between snapshots)
    this._diagLastLogMono = 0;
    this._chatSeq = 1;
    this.FIXED_DT_MS = 1000 / 60; // 60 Hz fixed step
    this.SNAPSHOT_EVERY_TICKS = 2; // 60/2 = 30 Hz snapshots
    this.WORLD_STATE_EVERY_TICKS = 8; // 7.5 Hz world-state packets
    // Rollback switch for comparing publication pacing; simulation is unchanged.
    this.COALESCE_SNAPSHOTS = process.env.BB_COALESCE_SNAPSHOTS !== "0";
    this.DEV_TIMING_DIAG = true; // temporary diagnostics flag
    this._timingDiagnostics = createTimingDiagnostics(this, {
      fixedDtMs: this.FIXED_DT_MS,
    });
    this.DEBUG_HIT_EVENTS =
      String(process.env.DEBUG_HIT_EVENTS || "").toLowerCase() === "1" ||
      String(process.env.DEBUG_HIT_EVENTS || "").toLowerCase() === "true";

    // Health/regen tuning (simple, readable constants)
    this.REGEN_DELAY_MS = 3500; // idle time before regen starts
    this.REGEN_TICK_MS = 1500; // heal every 1.5 seconds in discrete ticks
    this.REGEN_MISSING_RATIO = 0.25; // heal 25% of missing health each tick (regressive)
    this.REGEN_MIN_ABS = 500; // absolute minimum heal per tick (fixed amount, not percent)
    this.REGEN_BROADCAST_MIN_MS = 120; // avoid spamming health-update too fast

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
    this._readyAcks = new Set(); // user_id set
    this._startTimeout = null; // NodeJS timer for starting phase
    this._abandonTimer = null;
    this.ABANDON_MATCH_GRACE_MS = 15000;

    // Powerups + timed effects (server authoritative)
    this._powerups = new Map(); // id -> { id, type, x, y, spawnedAt, expiresAt }
    this._nextPowerupId = 1;
    this._lastPowerupSpawnAt = 0;
    this._powerupSpawnBag = [];
    this._powerupTypeBag = [];
    this._recentPowerupSpawnKeys = [];
    this._lastPowerupType = null;
    this._lastPowerupTypeBySpawnKey = Object.create(null);
    this._deathDrops = new Map(); // id -> authoritative drop plan
    this._nextDeathDropId = 1;
    this._netTestEnabled = netTestLogger.isServerNetTestEnabled();

    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${matchId}] Created for mode ${matchData.modeId || matchData.mode}:${matchData.modeVariantId || ""} map ${matchData.map}`,
      );
    } else {
      netTestLogger.noteRoomCreated(this);
    }

    characterCombat.initialize(this);
    this.botControllers = new Map();
    this._scheduledActions = [];
    this._socketBindings = [];
    this._seedBotPlayers();
    if (this.geometry) for (const player of this.players.values()) {
      if (player.isBot) this.botControllers.set(player.participantId, new BotController(this, player));
    }
  }

  _seedBotPlayers() {
    for (const matchPlayer of Array.isArray(this.matchData?.players)
      ? this.matchData.players
      : []) {
      if (!matchPlayer?.isBot) continue;
      const spawn = this._getBotSpawnState(matchPlayer);
      const level = matchPlayer.level || 1;
      const {
        maxHealth,
        baseDamage,
        specialDamage,
        specialChargeHits,
        ammoCapacity,
        ammoCooldownMs,
        ammoReloadMs,
      } = this._computeStats(matchPlayer.char_class || "ninja", level);
      const botMaxHealth = this._resolveBotMaxHealth(matchPlayer, maxHealth);
      const key = matchPlayer.participantId;
      this.players.set(key, {
        socketId: null,
        participantId: matchPlayer.participantId,
        seed: matchPlayer.seed,
        difficulty: matchPlayer.difficulty,
        trophies: matchPlayer.trophies,
        _botActionSeq: 0,
        _botActionUntil: 0,
        user_id: matchPlayer.user_id,
        name: matchPlayer.name,
        team: matchPlayer.team,
        char_class: matchPlayer.char_class || "ninja",
        selected_skin_id: String(matchPlayer.selected_skin_id || "") || null,
        selected_skin_asset_url:
          String(matchPlayer.selected_skin_asset_url || "") || null,
        selected_skin_game_assets:
          matchPlayer.selected_skin_game_assets || null,
        profile_icon_id:
          String(matchPlayer.profile_icon_id || "") ||
          String(matchPlayer.char_class || "ninja"),
        isBot: true,
        connected: true,
        loaded: true,
        spawnIndex: this._computeSpawnIndex(matchPlayer.name, matchPlayer.team),
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        grounded: true,
        maxHealth: botMaxHealth,
        health: botMaxHealth,
        superCharge: 0,
        maxSuperCharge: specialChargeHits,
        isAlive: true,
        lastInput: Date.now(),
        _lastPositionPacketAt: 0,
        inputBuffer: [],
        level,
        baseDamage,
        specialDamage,
        lastCombatAt: Date.now(),
        lastAttackAt: 0,
        lastDamagedAt: 0,
        _regenCarry: 0,
        _lastHealthBroadcastAt: 0,
        effects: {},
        activeEffects: {},
        ammoState: {
          capacity: ammoCapacity,
          charges: ammoCapacity,
          cooldownMs: ammoCooldownMs,
          reloadMs: ammoReloadMs,
          reloadTimerMs: 0,
          nextFireInMs: 0,
        },
      });
    }
  }

  _resolveBotMaxHealth(matchPlayer, fallbackMaxHealth) {
    const explicitOverride = Number(matchPlayer?.botHealthOverride);
    if (Number.isFinite(explicitOverride) && explicitOverride > 0) {
      return Math.round(explicitOverride);
    }
    return Math.max(1, Number(fallbackMaxHealth) || 1);
  }

  _getBotSpawnState(matchPlayer) {
    if (!this.geometry) throw new Error('Bot navigation is unavailable for this map.');
    const team = this.matchData.players.filter((p) => p.team === matchPlayer.team);
    return spawnForParticipant(this.geometry, matchPlayer, team.findIndex((p) => p.participantId === matchPlayer.participantId), team.length);
  }

  async addPlayer(socket, user) {
    const userId = Number(user?.user_id);
    const matchPlayer = this.matchData.players.find(
      (p) => !p.isBot && Number(p.user_id) === userId,
    );
    if (!Number.isFinite(userId) || userId <= 0 || !matchPlayer) {
      throw new Error("You are not a participant in this match");
    }
    if (this._disposed || this.status === "finished") {
      throw new Error("This match has finished");
    }

    const gameRoom = `game:${this.matchId}`;
    const teamRoom = `${gameRoom}:team:${matchPlayer.team}`;
    const findExisting = () => Array.from(this.players.values()).find(
      (p) => !p.isBot && Number(p.user_id) === userId,
    );
    let playerData = findExisting();
    if (!playerData) {
      const level = Number(matchPlayer.level) > 0
        ? Number(matchPlayer.level)
        : await this._fetchLevelForUser(userId, matchPlayer.char_class);
      // Another join may have completed while the legacy level lookup awaited IO.
      if (findExisting()) return this.addPlayer(socket, user);
      if (this._disposed || this.status === "finished") {
        throw new Error("This match has finished");
      }
      const {
        maxHealth, baseDamage, specialDamage, specialChargeHits,
        ammoCapacity, ammoCooldownMs, ammoReloadMs,
      } = this._computeStats(matchPlayer.char_class, level);
      const now = Date.now();
      playerData = {
        socketId: socket.id,
        participantId: participantId(matchPlayer),
        user_id: userId,
        name: matchPlayer.name || user.name,
        team: matchPlayer.team,
        char_class: matchPlayer.char_class,
        selected_skin_id: String(matchPlayer.selected_skin_id || "") || null,
        selected_skin_asset_url: String(matchPlayer.selected_skin_asset_url || "") || null,
        selected_skin_game_assets: matchPlayer.selected_skin_game_assets || null,
        profile_icon_id: String(matchPlayer.profile_icon_id || matchPlayer.char_class || "ninja"),
        isBot: false,
        trophies: Number(matchPlayer.trophies) || 0,
        connected: true,
        loaded: false,
        spawnIndex: this._computeSpawnIndex(matchPlayer.name || user.name, matchPlayer.team),
        x: null,
        y: null,
        vx: 0,
        vy: 0,
        grounded: false,
        maxHealth,
        health: maxHealth,
        superCharge: 0,
        maxSuperCharge: specialChargeHits,
        isAlive: true,
        lastInput: now,
        _lastPositionPacketAt: 0,
        inputBuffer: [],
        level,
        baseDamage,
        specialDamage,
        lastCombatAt: now,
        lastAttackAt: 0,
        lastDamagedAt: 0,
        _regenCarry: 0,
        _lastHealthBroadcastAt: 0,
        effects: {},
        activeEffects: {},
        ammoState: {
          capacity: ammoCapacity,
          charges: ammoCapacity,
          cooldownMs: ammoCooldownMs,
          reloadMs: ammoReloadMs,
          reloadTimerMs: 0,
          nextFireInMs: 0,
        },
      };
      if (!Number.isFinite(playerData.x) || !Number.isFinite(playerData.y)) {
        const team = this.matchData.players.filter(p => p.team === playerData.team);
        Object.assign(playerData, spawnForParticipant(this.geometry, playerData, playerData.spawnIndex, team.length));
      }
      inputManager.resetMovementBudget(playerData);
      inputManager.updateBodyGeometry(playerData, this);
      this.players.set(socket.id, playerData);
      this._ensureRewardBucket(playerData);
    } else if (playerData.socketId === socket.id) {
      // Repeated game:join requests resend state without registering duplicate handlers.
      await socket.join(gameRoom);
      await socket.join(teamRoom);
      this.sendGameStateToPlayer(socket);
      this._cancelAbandonTimer("player_joined");
      return;
    } else {
      const previousSocket = this.io.sockets.sockets.get(playerData.socketId);
      if (previousSocket) {
        this.removePlayerSocket(previousSocket);
        await previousSocket.leave(gameRoom);
        await previousSocket.leave(teamRoom);
      }
      for (const [key, value] of this.players) {
        if (value === playerData) this.players.delete(key);
      }
      playerData.socketId = socket.id;
      playerData.connected = true;
      playerData._lastPositionSeq = -1;
      playerData._lastPositionClientTs = 0;
      playerData._lastInputSeq = -1;
      playerData.inputBuffer.length = 0;
      if (Array.isArray(playerData._inputIntentQueue)) playerData._inputIntentQueue.length = 0;
      playerData._currentInputIntent = null;
      playerData._lastInputIntent = null;
      if (!Number.isFinite(playerData.x) || !Number.isFinite(playerData.y)) {
        const team = this.matchData.players.filter(p => p.team === playerData.team);
        Object.assign(playerData, spawnForParticipant(this.geometry, playerData, playerData.spawnIndex, team.length));
      }
      inputManager.resetMovementBudget(playerData);
      inputManager.updateBodyGeometry(playerData, this);
      this.players.set(socket.id, playerData);
      this._ensureRewardBucket(playerData);
      this.io.to(gameRoom).emit("player:reconnected", {
        name: playerData.name,
        username: playerData.name,
        loaded: playerData.loaded === true,
      });
    }

    await socket.join(gameRoom);
    await socket.join(teamRoom);
    this.setupPlayerSocket(socket);
    this.sendGameStateToPlayer(socket);
    this._cancelAbandonTimer("player_joined");
    if (this.getPlayerCount() === this.matchData.players.length && this.status === "waiting") {
      this.potentialStartGame();
    }
  }

  scheduleAction(callback, delayMs, now = Date.now()) {
    this._scheduledActions.push({ callback, at: now + Math.max(0, delayMs) });
  }

  applyKnockback(player, impulse) {
    require("./gameRoom/participants").applyParticipantKnockback(this, player, impulse);
  }

  requestSpecial(id, payload = {}) {
    const p = getParticipant(this, id);
    const special = characterCombat.requestSpecial(this, p, payload);
    if (special?.handled) return special.result;
    if (!p || !p.isAlive || !p.loaded || this.status !== 'active') return false;
    const now = Date.now();
    if (p._controlLockUntil > now || p.superCharge < p.maxSuperCharge) return false;
    p.superCharge = 0; p.lastCombatAt = now;
    const aimPayload = payload?.aim || null;
    if (p.isBot && p.char_class === 'ninja') startNinjaSwarm(this, p, now, aimPayload || {});
    else activateSpecial(this, p, now, aimPayload);
    this.io.to(`game:${this.matchId}`).emit('super-update', { username: p.name, charge: 0, maxCharge: p.maxSuperCharge });
    if (p.char_class !== 'gloop') this.io.to(`game:${this.matchId}`).emit('player:special', {
      username: p.name, character: p.char_class, origin: { x: p.x, y: p.y }, flip: !!p.flip, aim: aimPayload,
    });
    return true;
  }

  /**
   * Remove a player from this game room
   * @param {object} socket
   * @param {object} user
   */
  async removePlayer(socket, user) {
    const playerData = this.players.get(socket.id);
    if (!playerData) return;

    this.removePlayerSocket(socket);
    socket.leave(`game:${this.matchId}`);
    const teamRoom = `game:${this.matchId}:team:${playerData.team || "team1"}`;
    socket.leave(teamRoom);
    this.players.delete(socket.id);
    playerData.socketId = null;
    playerData.connected = false;
    this.players.set(`offline:${playerData.user_id}`, playerData);

    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${this.matchId}] Player ${user.name} left (${this.getPlayerCount()} connected remaining)`,
      );
    }

    // Handle disconnection during active game
    if (this.status === "active") {
      // Mark player as disconnected but keep in game for potential reconnection
      // In a real game, you might want to pause or give them a grace period
      this.io.to(`game:${this.matchId}`).emit("player:disconnected", {
        name: user.name,
        username: user.name,
        loaded: playerData.loaded === true,
        playersRemaining: this.getPlayerCount(),
      });
    }

    this._scheduleAbandonIfNoHumansConnected();
  }

  _hasConnectedHumanPlayers() {
    for (const playerData of this.players.values()) {
      if (!playerData || playerData.isBot) continue;
      if (playerData.connected === false) continue;
      return true;
    }
    return false;
  }

  hasConnectedHumanPlayers() {
    return this._hasConnectedHumanPlayers();
  }

  _isConnectedPlayer(playerData) {
    return !!playerData && playerData.connected !== false;
  }

  _getConnectedPlayers() {
    return Array.from(this.players.values()).filter((playerData) =>
      this._isConnectedPlayer(playerData),
    );
  }

  _cancelAbandonTimer(reason = "clear") {
    if (!this._abandonTimer) return;
    try {
      clearTimeout(this._abandonTimer);
    } catch (_) {}
    this._abandonTimer = null;
    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${this.matchId}] abandon timer cleared (${reason})`,
      );
    }
  }

  _scheduleAbandonIfNoHumansConnected() {
    if (this.status === "finished") return;
    if (this._hasConnectedHumanPlayers()) {
      this._cancelAbandonTimer("humans_still_connected");
      return;
    }
    if (this._abandonTimer) return;

    if (!this._netTestEnabled) {
      console.warn(
        `[GameRoom ${this.matchId}] no connected humans; scheduling abandonment in ${this.ABANDON_MATCH_GRACE_MS}ms`,
      );
    }

    this._abandonTimer = setTimeout(() => {
      this._abandonTimer = null;
      if (this.status === "finished") return;
      if (this._hasConnectedHumanPlayers()) return;
      void this._cancelMatchAsAbandoned("All players left the match");
    }, this.ABANDON_MATCH_GRACE_MS);
  }

  async _cancelMatchAsAbandoned(reason) {
    if (this.status === "finished") return;
    this.status = "finished";
    this.playerActivity?.finishMatch(this.matchId, { endScreen: false });
    this._loopRunning = false;

    if (this._pendingVictoryFinishTimeout) {
      try {
        clearTimeout(this._pendingVictoryFinishTimeout);
      } catch (_) {}
      this._pendingVictoryFinishTimeout = null;
      this._pendingVictoryOutcomeKey = null;
    }
    if (this._startTimeout) {
      try {
        clearTimeout(this._startTimeout);
      } catch (_) {}
      this._startTimeout = null;
    }

    try {
      await this.db.runQuery(
        "UPDATE matches SET status = 'cancelled' WHERE match_id = ? AND status = 'live'",
        [this.matchId],
      );
    } catch (e) {
      console.warn(
        `[GameRoom ${this.matchId}] failed to mark match cancelled on abandonment`,
        e?.message,
      );
    }

    try {
      const participants = await this.db.runQuery(
        `SELECT mp.user_id, mp.party_id, u.name
           FROM match_participants mp
           JOIN users u ON u.user_id = mp.user_id
          WHERE mp.match_id = ?`,
        [this.matchId],
      );

      if (participants.length) {
        const partyIds = [
          ...new Set(
            participants
              .map((p) => Number(p.party_id))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        ];
        if (partyIds.length) {
          if (typeof this.db.setPartiesStatus === "function") {
            await this.db.setPartiesStatus(partyIds, "idle");
          } else {
            const ph = partyIds.map(() => "?").join(",");
            await this.db.runQuery(
              `UPDATE parties SET status='idle' WHERE party_id IN (${ph})`,
              partyIds,
            );
          }
        }

        for (const p of participants) {
          const pid = Number(p.party_id);
          if (!Number.isFinite(pid) || pid <= 0) continue;
          this.io.to(`party:${pid}`).emit("match:cancelled", {
            reason: reason || "Match cancelled",
          });
        }
      }
    } catch (e) {
      console.warn(
        `[GameRoom ${this.matchId}] failed to restore post-abandonment state`,
        e?.message,
      );
    }

    if (!this._netTestEnabled) {
      console.warn(
        `[GameRoom ${this.matchId}] cancelled abandoned live match (${reason || "no reason"})`,
      );
    }

    try { await deleteMatchBots(this.db, this.matchId); }
    finally { if (this.onFinished) this.onFinished(); else this.cleanup(); }
  }

  /**
   * Set up socket event handlers for a player in this room
   * @param {object} socket
   */
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
   * Enter a 10s starting phase where clients load and ack readiness.
   * If all acks received sooner, start immediately; otherwise start on timeout.
   */
  potentialStartGame() {
    lifecycleManager.potentialStartGame(this);
  }

  /**
   * Finalize start after all acks or timeout.
   * @param {"all_acks"|"timeout"} reason
   */
  _finalizeStart(reason = "timeout") {
    lifecycleManager.finalizeStart(this, reason);
  }

  /**
   * Start the game
   */
  startGame() {
    lifecycleManager.startGame(this);
  }

  async _broadcastParticipantStatus(statusLabel) {
    return lifecycleManager.broadcastParticipantStatus(this, statusLabel);
  }

  /**
   * Initialize spawn positions for players
   */
  initializeSpawnPositions() {
    roomStateManager.initializeSpawnPositions(this);
  }

  _computeSpawnIndex(name, team) {
    return roomStateManager.computeSpawnIndex(this, name, team);
  }

  /**
   * Start the server game loop
   */
  startGameLoop() {
    if (this._loopRunning || this._disposed || this.status !== "active") return;
    if (!this._netTestEnabled) {
      console.log(`[GameRoom ${this.matchId}] Fixed-step loop started`);
    }
    this._loopRunning = true;
    this._loopStartWallTime = Date.now();
    this._suddenDeathActive = false;
    this._lastTimerEmitMs = 0;
    this._powerups.clear();
    this._nextPowerupId = 1;
    this._lastPowerupSpawnAt = this._loopStartWallTime;
    this._powerupSpawnBag = [];
    this._powerupTypeBag = [];
    this._recentPowerupSpawnKeys = [];
    this._lastPowerupType = null;
    this._lastPowerupTypeBySpawnKey = Object.create(null);
    this._deathDrops.clear();
    this._nextDeathDropId = 1;
    for (let i = 0; i < POWERUP_STARTING_COUNT; i++) {
      this._spawnPowerup();
    }
    const perf = (typeof performance !== "undefined" && performance) || null;
    const monoNow = () =>
      perf && typeof perf.now === "function" ? perf.now() : Date.now();
    let lastMono = monoNow();
    let simulatedMono = lastMono;
    let acc = 0;
    let snapshotDue = false;
    let worldStateDue = false;

    const step = (currentMono) => {
      this._simulationMono = currentMono;
      this._tickId++;
      this.processTick();
      attackRuntimeManager.tickActiveAttacks(this, Date.now());
      characterCombat.tick(this);
      this._tickPowerupEffects();
      this.processRegen();
      this._tickTimerAndSuddenDeath();
      this._tickPowerups();
      this._tickDeathDrops();
      try {
        this.gameMode?.tick?.(Date.now());
      } catch (e) {
        console.warn(
          `[GameRoom ${this.matchId}] mode tick failed:`,
          e?.message,
        );
      }
      // Snapshot cadence: deterministic every N ticks
      if (this._tickId % this.SNAPSHOT_EVERY_TICKS === 0) {
        if (this.COALESCE_SNAPSHOTS) snapshotDue = true;
        else this._emitSnapshotWithTiming(currentMono);
      }
      if (this._tickId % this.WORLD_STATE_EVERY_TICKS === 0) {
        if (this.COALESCE_SNAPSHOTS) worldStateDue = true;
        else this.broadcastWorldState();
      }
    };

    const loop = () => {
      if (!this._loopRunning) return;
      const nowMono = monoNow();
      let delta = nowMono - lastMono;
      if (delta < 0) delta = 0; // guard
      if (delta > 1000) delta = 1000; // clamp huge pause (avoid spiral)
      lastMono = nowMono;
      const accBefore = acc;
      acc += delta;
      let stepsThisFrame = 0;
      snapshotDue = false;
      worldStateDue = false;
      while (acc >= this.FIXED_DT_MS && this._loopRunning) {
        simulatedMono += this.FIXED_DT_MS;
        step(simulatedMono);
        acc -= this.FIXED_DT_MS;
        stepsThisFrame += 1;
      }
      // Publish the final state, not every intermediate catch-up state. Immediate
      // respawn/action snapshots and discrete events retain their existing order.
      if (this._loopRunning) {
        if (snapshotDue) this._emitSnapshotWithTiming(simulatedMono);
        if (worldStateDue) this.broadcastWorldState();
      }
      // Yield a bit to avoid busy-spinning the CPU.
      // Sleep roughly until the next tick is due (at least 0–1ms).
      let sleepMs = 0;
      if (acc < this.FIXED_DT_MS) {
        sleepMs = Math.max(0, Math.floor(this.FIXED_DT_MS - acc));
        // Ensure we yield to the event loop at least briefly
        if (sleepMs === 0) sleepMs = 1;
      }
      this._timingDiagnostics?.noteLoopFrame({
        nowMono,
        deltaMs: delta,
        stepsThisFrame,
        sleepMs,
        accBefore,
        accAfter: acc,
      });
      if (this._loopRunning) setTimeout(loop, sleepMs);
    };
    setTimeout(loop, 0);
  }

  /**
   * Advance the match timer and apply sudden-death poison logic each tick.
   * Call once per fixed-step tick (inside step() in startGameLoop).
   */
  _tickTimerAndSuddenDeath() {
    timerManager.tickTimerAndSuddenDeath(this);
  }

  _emitSnapshotWithTiming(snapMono) {
    const nowMono =
      typeof performance !== "undefined" &&
      performance &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    this._timingDiagnostics?.noteSnapshot({
      nowMono,
      snapMono,
      tickId: this._tickId,
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
    if (Number(playerData._controlLockUntil || 0) > Date.now()) return;

    const sanitizedAction = this._sanitizeActionPayload(actionData);
    if (!sanitizedAction) return;

    try {
      const modeResult = this.gameMode?.handlePlayerAction?.(
        playerData,
        sanitizedAction,
      );
      if (modeResult?.handled) {
        if (modeResult?.broadcast) {
          this.io.to(`game:${this.matchId}`).emit("game:action", {
            playerId: playerData.user_id,
            playerName: playerData.name,
            origin: { x: playerData.x, y: playerData.y },
            flip: !!playerData.flip,
            character: playerData.char_class,
            action: sanitizedAction,
            t: Date.now(),
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
    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${this.matchId}] Player ${playerData.name} action: ${sanitizedAction.type}`,
      );
    }

    // Mark as combat to pause regen even if attack misses
    const actionNow = Date.now();
    playerData.lastCombatAt = actionNow;

    const characterActionResult = characterActionRegistry.handleCharacterAction(
      this,
      playerData,
      sanitizedAction,
      actionNow,
    );
    if (characterActionResult?.handled) return;

    // Process action (implement specific action handling later)
    // For now, just broadcast to other players
    characterActionRegistry.broadcastAction(
      this,
      playerData,
      sanitizedAction,
      Date.now(),
    );
  }

  _sanitizeActionPayload(actionData) {
    return actionValidation.sanitizeActionPayload(actionData);
  }

  /**
   * Process a single game tick
   */
  processTick() {
    const now = Date.now();
    this._botNow = now;
    const due = this._scheduledActions.filter((a) => a.at <= now);
    this._scheduledActions = this._scheduledActions.filter((a) => a.at > now);
    for (const action of due) if (this.status === 'active') action.callback();
    tickActiveAbilities(this, now);
    const botStart = performance.now();
    for (const controller of this.botControllers.values()) controller.tick(this.FIXED_DT_MS, now);
    if (this.botControllers.size) {
      const elapsed = performance.now() - botStart;
      const stats = this._botTickStats ||= { ticks: 0, totalMs: 0, maxMs: 0 };
      stats.ticks++; stats.totalMs += elapsed; stats.maxMs = Math.max(stats.maxMs, elapsed);
    }

    // For Phase 1, just process basic movement inputs
    for (const playerData of this.players.values()) {
      if (
        !playerData.isAlive ||
        playerData.connected === false ||
        playerData.loaded !== true
      )
        continue;

      // Process latest input from buffer
      if (playerData.inputBuffer.length > 0) {
        const latestInput =
          playerData.inputBuffer[playerData.inputBuffer.length - 1];
        this.processPlayerMovement(playerData, latestInput);

        // Clear old inputs
        playerData.inputBuffer = [];
      }

      inputManager.advancePlayerKinematics(this, playerData, this.FIXED_DT_MS);
    }
  }

  /**
   * Apply passive health regeneration to players who are out of combat.
   */
  processRegen() {
    healthManager.processRegen(this);
  }

  _getPlatformSpawnPoints() {
    return powerupManager.getPlatformSpawnPoints(this);
  }

  _pickSpawnPoint() {
    return powerupManager.pickSpawnPoint(this);
  }

  _spawnPowerup() {
    powerupManager.spawnPowerup(this);
  }

  _isInSuddenDeathWater(playerData, nowTs) {
    return powerupManager.isInSuddenDeathWater(this, playerData, nowTs);
  }

  _computePoisonY(sdElapsedMs) {
    return powerupManager.computePoisonY(this, sdElapsedMs);
  }

  _applyPowerupToPlayer(playerData, type, nowTs, params = null) {
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
   * Process player movement
   * @param {object} playerData
   * @param {object} input
   */
  processPlayerMovement(playerData, input) {
    inputManager.processPlayerMovement(playerData, input);
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
    clearTimeout(this._resultRetry);
    this._disposed = true;
    if (this._countdownTimeout) clearTimeout(this._countdownTimeout);
    this._countdownTimeout = null;
    for (const { socket, event, listener } of this._socketBindings) socket.off(event, listener);
    this._socketBindings.length = 0;
    for (const controller of this.botControllers.values()) controller.dispose();
    this.botControllers.clear();
    this._scheduledActions.length = 0;
    this._activeAttacks = [];
    characterCombat.dispose(this);
    this._recentHits?.clear();
    this._recentCharacterActions?.clear();
    this._recentAttackInstances?.clear();
    this._cancelAbandonTimer("cleanup");
    // Stop fixed-step loop
    this._loopRunning = false;
    if (this.gameLoop) {
      // legacy interval if still allocated
      try {
        clearInterval(this.gameLoop);
      } catch (_) {}
      this.gameLoop = null;
    }

    // Disconnect all remaining players
    for (const playerData of this.players.values()) {
      if (playerData?._respawnTimeout) {
        try {
          clearTimeout(playerData._respawnTimeout);
        } catch (_) {}
        playerData._respawnTimeout = null;
      }
      const socket = this.io.sockets.sockets.get(playerData.socketId);
      if (socket) {
        socket.leave(`game:${this.matchId}`);
      }
    }

    this.players.clear();
    this.matchData.players = [];
    this.rewardStats.clear();
    this._readyAcks.clear();
    this._requiredUserIds.clear();
    this._powerups.clear();
    this._deathDrops.clear();
    if (!this._netTestEnabled) {
      console.log(`[GameRoom ${this.matchId}] Cleaned up`);
    }
  }

  // Getters
  getPlayerCount() {
    return this._getConnectedPlayers().length;
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
  _getAttackMaxDist(charClass, attackType) {
    return combatValidation.getAttackMaxDist(charClass, attackType);
  }

  /**
   * Look up the recorded position of a player closest to `targetTimeMs` (wall ms).
   * Falls back to the player's current position when history is empty.
   */
  _getHistoricalPosition(playerData, targetTimeMs) {
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
   * Fetch the level for a user's current character class.
   */
  async _fetchLevelForUser(userId, charClass) {
    try {
      const rows = await this.db.runQuery(
        "SELECT char_levels FROM users WHERE user_id = ? LIMIT 1",
        [userId],
      );
      const json = rows[0]?.char_levels || null;
      if (!json) return 1;
      const obj = JSON.parse(json);
      const lvl = Number(obj?.[charClass]) || 1;
      return Math.max(1, lvl);
    } catch (_) {
      return 1;
    }
  }

  /**
   * Compute derived stats for a character at a level.
   */
  _computeStats(charClass, level) {
    try {
      const {
        getHealth,
        getDamage,
        getSuperChargeHits,
        getSpecialDamage,
        getCharacterStats,
      } = require("../../shared/characterStats.js");
      const maxHealth = Math.max(1, Number(getHealth(charClass, level)) || 1);
      const baseDamage = Math.max(0, Number(getDamage(charClass, level)) || 0);
      const specialDamage = Math.max(
        0,
        Number(getSpecialDamage(charClass, level)) || 0,
      );
      const stats = getCharacterStats(charClass) || {};
      const specialChargeHits = getSuperChargeHits(charClass);
      const ammoCapacity = stats.ammoCapacity || 1;
      const ammoCooldownMs = stats.ammoCooldownMs || 1200;
      const ammoReloadMs = stats.ammoReloadMs || 1200;
      return {
        maxHealth,
        baseDamage,
        specialDamage,
        specialChargeHits,
        ammoCapacity,
        ammoCooldownMs,
        ammoReloadMs,
      };
    } catch (e) {
      console.warn(
        `[GameRoom ${this.matchId}] computeStats failed:`,
        e?.message,
      );
      return {
        maxHealth: 100,
        baseDamage: 100,
        specialDamage: 200,
        specialChargeHits: 6,
        ammoCapacity: 1,
        ammoCooldownMs: 1200,
        ammoReloadMs: 1200,
      };
    }
  }

  /**
   * Emit a health-update to all players in the room.
   */
  _broadcastHealthUpdate(playerData, meta = {}) {
    healthManager.broadcastHealthUpdate(this, playerData, meta);
  }

  /**
   * Conditionally broadcast health if min interval elapsed.
   */
  _maybeBroadcastHealth(playerData, nowTs, meta = {}) {
    healthManager.maybeBroadcastHealth(this, playerData, nowTs, meta);
  }

  /**
   * Handle heal proposal from client. Applies clamped heal to target.
   */
  handleHeal(socketId, payload) {
    healthManager.handleHeal(this, socketId, payload);
  }

  /**
   * Evaluate whether one team has been fully eliminated and finish the game if so.
   */
  _checkVictoryCondition() {
    lifecycleManager.checkVictoryCondition(this);
  }

  /**
   * Finish game, update DB, broadcast game over, and cleanup loop.
   * @param {string|null} winnerTeam null means draw
   */
  async _finishGame(winnerTeam, meta = {}) {
    return lifecycleManager.finishGame(this, winnerTeam, meta);
  }

  _ensureRewardBucket(playerData) {
    return rewardManager.ensureRewardBucket(this, playerData);
  }

  _recordCombatStat(playerData, delta = {}) {
    rewardManager.recordCombatStat(this, playerData, delta);
  }

  async _distributeMatchRewards(winnerTeam) {
    return rewardManager.distributeMatchRewards(this, winnerTeam);
  }

  _calculateRewards(bucket, winnerTeam, playerTeam) {
    return rewardManager.calculateRewards(this, bucket, winnerTeam, playerTeam);
  }

  _handlePlayerDeath(playerData, meta = {}) {
    return deathDropManager.handlePlayerDeath(this, playerData, meta);
  }

  _scheduleRespawn(playerData, plan = {}, meta = {}) {
    if (!playerData || !plan?.enabled) return;
    if (playerData._respawnTimeout) {
      try {
        clearTimeout(playerData._respawnTimeout);
      } catch (_) {}
    }
    const delayMs = Math.max(0, Number(plan.delayMs) || 0);
    playerData._respawnTimeout = setTimeout(() => {
      playerData._respawnTimeout = null;
      if (this.status !== "active") return;
      const now = Date.now();
      const spawnX = Number(plan?.position?.x);
      const spawnY = Number(plan?.position?.y);
      const nextX = Number.isFinite(spawnX)
        ? spawnX
        : Number(playerData.x) || 0;
      const nextY = Number.isFinite(spawnY)
        ? spawnY
        : Number(playerData.y) || 0;
      playerData.isAlive = true;
      playerData._deathHandled = false;
      playerData.health = Math.max(1, Number(playerData.maxHealth) || 1);
      playerData.x = nextX;
      playerData.y = nextY;
      inputManager.resetMovementBudget(playerData, now);
      inputManager.updateBodyGeometry(playerData, this);
      playerData.vx = 0;
      playerData.vy = 0;
      playerData.ducking = false;
      playerData.wallSliding = false;
      playerData.wallSide = null;
      if (Array.isArray(playerData._inputIntentQueue)) {
        playerData._inputIntentQueue.length = 0;
      }
      playerData._currentInputIntent = null;
      playerData._lastInputIntent = null;
      playerData.lastDamagedAt = 0;
      playerData.lastCombatAt = now;
      if (Number(plan.shieldMs) > 0) {
        effectManager.apply(
          playerData,
          "respawnShield",
          now,
          { durationMs: Number(plan.shieldMs) },
          this,
        );
      }
      this.io.to(`game:${this.matchId}`).emit("player:respawn", {
        username: playerData.name,
        x: nextX,
        y: nextY,
        team: playerData.team,
        health: playerData.health,
        maxHealth: playerData.maxHealth,
        shieldMs: Math.max(0, Number(plan.shieldMs) || 0),
        at: now,
      });
      this._broadcastHealthUpdate(playerData, { cause: "respawn" });
      this.broadcastSnapshot();
    }, delayMs);
  }

  _handleDeathDropPickup(socketId, payload) {
    return deathDropManager.handleDeathDropPickup(this, socketId, payload);
  }
}

module.exports = { GameRoom };
