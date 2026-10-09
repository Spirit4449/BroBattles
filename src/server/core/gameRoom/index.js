const damageResolver = require('./damageResolver');
const actionValidation = require('./actionValidation');
const playerTransport = require('./playerTransport');
const characterCombat = require('./characterCombatRegistry');
// gameRoom.js
// Individual game room handling server-authoritative game state
const {
  POWERUP_STARTING_COUNT,
  ABANDON_MATCH_GRACE_MS,
  REGEN_DELAY_MS,
  REGEN_TICK_MS,
  REGEN_MISSING_RATIO,
  REGEN_MIN_ABS,
  REGEN_BROADCAST_MIN_MS,
} = require("../gameRoomConfig");
const {
  FIXED_DT_MS,
  SNAPSHOT_EVERY_TICKS,
  WORLD_STATE_EVERY_TICKS,
} = require("../../../shared/gameConstants");

const effectManager = require("./effects/effectManager");

const powerupManager = require("./powerupManager");
const deathDropManager = require("./deathDropManager");
const combatValidation = require("./combatValidation");
const healthManager = require("./healthManager");
const timerManager = require("./timerManager");
const inputManager = require("./inputManager");
const rewardManager = require("./rewardManager");
const lifecycleManager = require("./lifecycleManager");
const roomStateManager = require("./roomStateManager");
const netTestLogger = require("./netTestLogger");
const { createTimingDiagnostics } = require("./timingDiagnostics");
const attackRuntimeManager = require("./attackRuntimeManager");
const characterActionRegistry = require("./characterActionRegistry");

const { createGameModeRuntime } = require("../gameModes");
const {
  activateSpecial,
  tickActiveAbilities
} = require("./abilityRuntimeManager");

const { getDuelGeometry } = require('../../../shared/physics/duelGeometry');
const { tickMovingPlatforms } = require('./movingPlatforms');
const { BotController } = require('../bots/controller');
const { startNinjaSwarm } = require('../bots/combat');

const { getParticipant, participantId } = require('./participants');
const { deleteMatchBots } = require('../../services/match/matchRosterService');
const { DEFAULT_CHARACTER, resolveCharacterKey } = require("../../../shared/characters/characterStats.js");

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
    this.mapSnapshot = matchData.editorMapSnapshot || require('../../services/maps/mapRepository').mapRepository.forMatch(matchId, matchData.map);
    this.geometry = getDuelGeometry(matchData.map, this.mapSnapshot.map);
    this.gameMode = createGameModeRuntime(this);
    this.modeState = this.gameMode?.createRoomState?.() ?? null;

    // Fixed-step loop state (see startGameLoop)
    this._loopRunning = false;
    this._tickId = 0; // monotonically increasing per 60Hz tick
    this._chatSeq = 1;
    // Tick/snapshot cadence: src/shared/gameConstants.js
    this.FIXED_DT_MS = FIXED_DT_MS;
    this.SNAPSHOT_EVERY_TICKS = SNAPSHOT_EVERY_TICKS;
    this.WORLD_STATE_EVERY_TICKS = WORLD_STATE_EVERY_TICKS;
    // Rollback switch for comparing publication pacing; simulation is unchanged.
    this.COALESCE_SNAPSHOTS = process.env.BB_COALESCE_SNAPSHOTS !== "0";
    // Gates timing/anti-cheat warnings. Routine periodic timing summaries are
    // further limited to development (or BB_TIMING_DIAG=1); stalls always log.
    this.DEV_TIMING_DIAG = true;
    this._timingDiagnostics = createTimingDiagnostics(this, {
      fixedDtMs: this.FIXED_DT_MS,
      periodicSummaries: process.env.BB_TIMING_DIAG
        ? process.env.BB_TIMING_DIAG === "1"
        : process.env.NODE_ENV !== "production",
    });
    this.DEBUG_HIT_EVENTS =
      String(process.env.DEBUG_HIT_EVENTS || "").toLowerCase() === "1" ||
      String(process.env.DEBUG_HIT_EVENTS || "").toLowerCase() === "true";

    // Health regen tuning: src/server/core/gameRoomConfig.js
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
    lifecycleManager.armStartDeadline(this);
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
      } = this._computeStats(matchPlayer.char_class || DEFAULT_CHARACTER, level);
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
        char_class: matchPlayer.char_class || DEFAULT_CHARACTER,
        selected_skin_id: String(matchPlayer.selected_skin_id || "") || null,
        selected_skin_asset_url:
          String(matchPlayer.selected_skin_asset_url || "") || null,
        selected_skin_game_assets:
          matchPlayer.selected_skin_game_assets || null,
        profile_icon_id:
          String(matchPlayer.profile_icon_id || "") ||
          resolveCharacterKey(matchPlayer.char_class),
        isBot: true,
        connected: true,
        loaded: true,
        spawnIndex: spawn.spawnIndex,
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
    return this.spawnStateFor(matchPlayer);
  }

  async addPlayer(socket, user) {
    const userId = Number(user?.user_id);
    const matchPlayer = this.matchData.players.find(
      (p) => !p.isBot && Number(p.user_id) === userId,
    );
    if (!Number.isFinite(userId) || userId <= 0 || !matchPlayer) {
      throw Object.assign(new Error("You are not a participant in this match"), { code: "NOT_PARTICIPANT" });
    }
    if (this._disposed || this.status === "finished") {
      throw Object.assign(new Error("This match has finished"), { code: "MATCH_FINISHED" });
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
        throw Object.assign(new Error("This match has finished"), { code: "MATCH_FINISHED" });
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
        profile_icon_id: String(matchPlayer.profile_icon_id || matchPlayer.char_class || DEFAULT_CHARACTER),
        isBot: false,
        trophies: Number(matchPlayer.trophies) || 0,
        connected: true,
        loaded: false,
        spawnIndex: roomStateManager.computeSpawnIndex(this, matchPlayer),
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
        Object.assign(playerData, this.spawnStateFor(playerData), { flip: false });
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
      if (!Number.isFinite(playerData.x) || !Number.isFinite(playerData.y)) {
        Object.assign(playerData, this.spawnStateFor(playerData), { flip: false });
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
  }

  scheduleAction(callback, delayMs, now = Date.now()) {
    this._scheduledActions.push({ callback, at: now + Math.max(0, delayMs) });
  }

  applyKnockback(player, impulse) {
    require("./participants").applyParticipantKnockback(this, player, impulse);
  }

  requestSpecial(id, payload = {}) {
    const p = getParticipant(this, id);
    const special = characterCombat.requestSpecial(this, p, payload);
    if (special?.handled) return special.result;
    if (!p || !p.isAlive || !p.loaded || this.status !== 'active') return false;
    const now = Date.now();
    if (Math.max(p._controlLockUntil || 0, p._attackInterruptedUntil || 0) > now || p.superCharge < p.maxSuperCharge) return false;
    p.superCharge = 0; p.lastCombatAt = now;
    const aimPayload = payload?.aim || null;
    if (p.isBot && p.char_class === 'ninja') startNinjaSwarm(this, p, now, aimPayload || {});
    else activateSpecial(this, p, now, aimPayload, { id: payload?.id, viewRewindMs: payload?.viewRewindMs });
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
    lifecycleManager.clearPendingVictory(this);
    lifecycleManager.clearStartTimers(this);

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
   * Schedule the countdown from the ready signals received so far (see
   * shared/matchIntroTiming). `force` starts now; used by the start deadline.
   * Editor playtest rooms override this to never start a countdown.
   */
  potentialStartGame(options) {
    lifecycleManager.potentialStartGame(this, options);
  }

  _noteReady(player) {
    return lifecycleManager.noteReady(this, player);
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

  /** Authoritative start position for a participant (see roomStateManager). */
  spawnStateFor(player) {
    return roomStateManager.spawnStateFor(this, player);
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
    const monoNow = () => performance.now();
    let lastMono = monoNow();
    let simulatedMono = lastMono;
    let acc = 0;
    let snapshotDue = false;
    let worldStateDue = false;

    const step = (currentMono) => {
      this._simulationMono = currentMono;
      this._tickId++;
      tickMovingPlatforms(this, currentMono);
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
      const rawDelta = Math.max(0, nowMono - lastMono);
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
        deltaMs: rawDelta,
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
    this._timingDiagnostics?.noteSnapshot({
      nowMono: performance.now(),
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
    if (Math.max(playerData._controlLockUntil || 0, playerData._attackInterruptedUntil || 0) > Date.now()) return;

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
            action: characterActionRegistry.withoutUnusedTerrain(sanitizedAction),
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
    // Most ticks have nothing scheduled; only rebuild the queue when needed.
    if (this._scheduledActions.length) {
      const due = this._scheduledActions.filter((a) => a.at <= now);
      if (due.length) {
        this._scheduledActions = this._scheduledActions.filter((a) => a.at > now);
        for (const action of due) if (this.status === 'active') action.callback();
      }
    }
    tickActiveAbilities(this, now);
    const botStart = performance.now();
    // A shared planning allowance leaves time for physics and human inputs.
    // Rotate first access so crowded rooms cannot starve their last bot.
    const controllers = [...this.botControllers.values()];
    const first = (this._botPlanningCursor || 0) % (controllers.length || 1);
    this._botPlanningCursor = first + 1;
    this._botPlanningDeadline = botStart + 4;
    for (let i = 0; i < controllers.length; i++) controllers[(first + i) % controllers.length].tick(this.FIXED_DT_MS, now);
    if (controllers.length) {
      const elapsed = performance.now() - botStart;
      const stats = this._botTickStats ||= { ticks: 0, totalMs: 0, maxMs: 0 };
      stats.ticks++; stats.totalMs += elapsed; stats.maxMs = Math.max(stats.maxMs, elapsed);
    }

    inputManager.stepIdleHumans(this, this.FIXED_DT_MS, now);

    // Humans record history when their position packets are accepted; bots
    // move every simulation step, so their history is sampled here.
    for (const playerData of this.players.values()) {
      if (playerData.isBot) inputManager.recordBotHistory(playerData, now);
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
    this._activeAttacks = [];
    characterCombat.dispose(this);
    this._recentHits?.clear();
    this._recentCharacterActions?.clear();
    this._recentAttackInstances?.clear();
    this._damageHitboxes?.clear();
    this._snapshotEncoder = null;
    this._cancelAbandonTimer("cleanup");
    // Stop fixed-step loop
    this._loopRunning = false;

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
        socket.leave(`game:${this.matchId}:team:${playerData.team || "team1"}`);
      }
    }

    this.players.clear();
    this.matchData.players = [];
    this.rewardStats.clear();
    this._readyAt.clear();
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
      } = require("../../../shared/characters/characterStats.js");
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
      playerData._dashReadyAt = 0;
      playerData._dashUntil = 0;
      playerData._stompPendingUntil = 0;
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
