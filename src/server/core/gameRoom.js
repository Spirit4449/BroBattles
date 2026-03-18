// gameRoom.js
// Individual game room handling server-authoritative game state
const {
  POWERUP_STARTING_COUNT,
  NINJA_SWARM_HIT_DAMAGE,
  NINJA_SWARM_CHARGE_RATIO,
} = require("./gameRoomConfig");
const effectManager = require("./gameRoom/effects/effectManager");
const powerupManager = require("./gameRoom/powerupManager");
const combatValidation = require("./gameRoom/combatValidation");
const healthManager = require("./gameRoom/healthManager");
const timerManager = require("./gameRoom/timerManager");
const inputManager = require("./gameRoom/inputManager");
const rewardManager = require("./gameRoom/rewardManager");
const lifecycleManager = require("./gameRoom/lifecycleManager");
const roomStateManager = require("./gameRoom/roomStateManager");
const {
  activateSpecial,
  tickActiveAbilities,
  applyOutgoingDamageMultiplier,
  requiresMeleeFacingCheck,
  getKnockback,
} = require("./gameRoom/abilityRuntimeManager");

class GameRoom {
  constructor(matchId, matchData, { io, db, runtimeConfig = null }) {
    this.matchId = matchId;
    this.matchData = matchData; // { mode, map, players }
    this.io = io;
    this.db = db;
    this.runtimeConfig = runtimeConfig;

    // Room state
    this.status = "waiting"; // waiting, active, finished
    this.startTime = Date.now();
    this.players = new Map(); // socketId -> playerData
    this.rewardStats = new Map(); // name -> { userId, team, hits, damage, kills }
    this.gameState = null;

    // Game loop (will migrate to fixed-step accumulator + snapshot cadence)
    this.gameLoop = null; // legacy interval reference (used only until refactor start)
    this._loopRunning = false;
    this._tickId = 0; // monotonically increasing per 60Hz tick
    this._lastSnapshotMono = 0;
    this._snapshotIntervals = []; // diagnostics (ms spacing between snapshots)
    this._diagLastLogMono = 0;
    this.FIXED_DT_MS = 1000 / 60; // 60 Hz fixed step
    this.SNAPSHOT_EVERY_TICKS = 2; // 60/2 = 30 Hz snapshots
    this.DEV_TIMING_DIAG = true; // temporary diagnostics flag

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
      (Array.isArray(matchData?.players) ? matchData.players : []).map(
        (p) => p.user_id,
      ),
    );
    this._readyAcks = new Set(); // user_id set
    this._startTimeout = null; // NodeJS timer for starting phase

    // Powerups + timed effects (server authoritative)
    this._powerups = new Map(); // id -> { id, type, x, y, spawnedAt, expiresAt }
    this._nextPowerupId = 1;
    this._lastPowerupSpawnAt = 0;
    this._recentPowerupSpawnIdx = [];

    console.log(
      `[GameRoom ${matchId}] Created for mode ${matchData.mode}, map ${matchData.map}`,
    );
  }

  async addPlayer(socket, user) {
    // Verify this user is actually supposed to be in this match
    const isParticipant = this.matchData.players.some(
      (p) => p.user_id === user.user_id,
    );
    if (!isParticipant) {
      throw new Error("You are not a participant in this match");
    }

    // Check if player is already in the room (reconnection)
    const existingPlayer = Array.from(this.players.values()).find(
      (p) => p.user_id === user.user_id,
    );
    if (existingPlayer) {
      // Update socket for reconnection
      for (const [key, value] of this.players.entries()) {
        if (value?.user_id === user.user_id) this.players.delete(key);
      }
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      this.players.set(socket.id, existingPlayer);
      this._ensureRewardBucket(existingPlayer);
      this.io.to(`game:${this.matchId}`).emit("player:reconnected", {
        name: existingPlayer.name,
        username: existingPlayer.name,
      });
      console.log(`[GameRoom ${this.matchId}] Player ${user.name} reconnected`);
    } else {
      // New player joining
      const matchPlayer = this.matchData.players.find(
        (p) => p.user_id === user.user_id,
      );
      // Fetch player's character level for current class to compute health/damage
      const level = await this._fetchLevelForUser(
        user.user_id,
        matchPlayer.char_class,
      );
      const {
        maxHealth,
        baseDamage,
        specialDamage,
        specialChargeDamage,
        ammoCapacity,
        ammoCooldownMs,
        ammoReloadMs,
      } = this._computeStats(matchPlayer.char_class, level);

      const playerData = {
        socketId: socket.id,
        user_id: user.user_id,
        name: user.name,
        team: matchPlayer.team,
        char_class: matchPlayer.char_class,
        connected: true,
        loaded: false,
        spawnIndex: this._computeSpawnIndex(user.name, matchPlayer.team),

        // Game state
        x: 400, // Will be set by spawn logic
        y: 400,
        maxHealth,
        health: maxHealth,
        superCharge: 0,
        maxSuperCharge: specialChargeDamage,
        isAlive: true,
        lastInput: Date.now(),

        // Input buffer for server authority
        inputBuffer: [],

        // Combat stats (server-side authoritative)
        level,
        baseDamage,
        specialDamage,

        // Combat timestamps for regen and anti-spam
        lastCombatAt: Date.now(), // updated when attacking or being hit
        lastAttackAt: 0,
        lastDamagedAt: 0,
        _regenCarry: 0, // fractional regen accumulator
        _lastHealthBroadcastAt: 0,

        // Timed powerup state (managed by effectManager via player.activeEffects)
        // player.effects is reserved for ability-specific state (e.g. dravenInferno*)
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

      this.players.set(socket.id, playerData);
      this._ensureRewardBucket(playerData);
      console.log(
        `[GameRoom ${this.matchId}] Player ${user.name} joined (${this.players.size}/${this.matchData.players.length})`,
      );
    }

    // Join socket to game room
    socket.join(`game:${this.matchId}`);

    // Set up socket event handlers for this room
    this.setupPlayerSocket(socket);

    // Send initial game state to the player
    this.sendGameStateToPlayer(socket);

    // Start game if all players are present
    if (
      this.players.size === this.matchData.players.length &&
      this.status === "waiting"
    ) {
      this.potentialStartGame();
    }
  }

  /**
   * Remove a player from this game room
   * @param {object} socket
   * @param {object} user
   */
  async removePlayer(socket, user) {
    const playerData = this.players.get(socket.id);
    if (!playerData) return;

    socket.leave(`game:${this.matchId}`);
    this.players.delete(socket.id);
    playerData.socketId = null;
    playerData.connected = false;
    this.players.set(`offline:${playerData.user_id}`, playerData);

    console.log(
      `[GameRoom ${this.matchId}] Player ${user.name} left (${this.players.size} remaining)`,
    );

    // Handle disconnection during active game
    if (this.status === "active") {
      // Mark player as disconnected but keep in game for potential reconnection
      // In a real game, you might want to pause or give them a grace period
      this.io.to(`game:${this.matchId}`).emit("player:disconnected", {
        name: user.name,
        username: user.name,
        playersRemaining: this.players.size,
      });
    }
  }

  /**
   * Set up socket event handlers for a player in this room
   * @param {object} socket
   */
  setupPlayerSocket(socket) {
    // Handle player input
    socket.on("game:input", (inputData) => {
      this.handlePlayerInput(socket.id, inputData);
    });

    // NEW: Handle input intent (Phase 2 server-side movement simulation)
    // Non-breaking; queued but not used unless USE_SERVER_MOVEMENT_SIMULATION_V1 enabled
    socket.on("game:input-intent", (intentData) => {
      inputManager.handlePlayerInputIntent(this, socket.id, intentData);
    });

    // Handle player actions (attacks, abilities, etc.)
    socket.on("game:action", (actionData) => {
      this.handlePlayerAction(socket.id, actionData);
    });

    // Handle special attack request
    socket.on("game:special", () => {
      const p = this.players.get(socket.id);
      if (!p || !p.isAlive) return;
      if (p.superCharge < p.maxSuperCharge) return;

      p.superCharge = 0;
      const now = Date.now();
      p.lastCombatAt = now;
      activateSpecial(this, p, now);

      this.io.to(`game:${this.matchId}`).emit("super-update", {
        username: p.name,
        charge: 0,
        maxCharge: p.maxSuperCharge,
      });

      this.io.to(`game:${this.matchId}`).emit("player:special", {
        username: p.name,
        character: p.char_class,
        origin: { x: p.x, y: p.y },
        flip: !!p.flip,
      });
    });

    // Owner-side hit proposal (server authoritative application)
    socket.on("hit", (payload) => {
      this.handleHit(socket.id, payload);
    });

    // Heal proposal (e.g., abilities/pickups) - server clamps and applies
    socket.on("heal", (payload) => {
      this.handleHeal(socket.id, payload);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      // This will be handled by the main socket disconnect handler
      // which calls gameHub.handlePlayerLeave
    });

    // Client signals they're ready to start (assets + scene loaded)
    socket.on("game:ready", () => {
      try {
        if (this.status !== "starting") return;
        const p = this.players.get(socket.id);
        if (!p || !p.user_id) return;
        // Track by user_id (robust to reconnection)
        if (!this._readyAcks.has(p.user_id)) {
          this._readyAcks.add(p.user_id);
          const need = this._requiredUserIds.size;
          const have = this._readyAcks.size;
          console.log(
            `[GameRoom ${this.matchId}] Ready ack from ${p.name} (${have}/${need})`,
          );
          if (have >= need) {
            this._finalizeStart("all_acks");
          }
        }
      } catch (e) {
        console.warn(
          `[GameRoom ${this.matchId}] game:ready handler error`,
          e?.message,
        );
      }
    });
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
    if (this._loopRunning) return; // already running
    console.log(`[GameRoom ${this.matchId}] Fixed-step loop started`);
    this._loopRunning = true;
    this._loopStartWallTime = Date.now();
    this._suddenDeathActive = false;
    this._lastTimerEmitMs = 0;
    this._powerups.clear();
    this._nextPowerupId = 1;
    this._lastPowerupSpawnAt = this._loopStartWallTime;
    this._recentPowerupSpawnIdx = [];
    for (let i = 0; i < POWERUP_STARTING_COUNT; i++) {
      this._spawnPowerup();
    }
    const perf = (typeof performance !== "undefined" && performance) || null;
    const monoNow = () =>
      perf && typeof perf.now === "function" ? perf.now() : Date.now();
    let lastMono = monoNow();
    let acc = 0;

    const step = (currentMono) => {
      this._tickId++;
      this.processTick();
      this._tickPowerupEffects();
      this.processRegen();
      this._tickTimerAndSuddenDeath();
      this._tickPowerups();
      // Snapshot cadence: deterministic every N ticks
      if (this._tickId % this.SNAPSHOT_EVERY_TICKS === 0) {
        this._emitSnapshotWithTiming(currentMono);
      }
    };

    const loop = () => {
      if (!this._loopRunning) return;
      const nowMono = monoNow();
      let delta = nowMono - lastMono;
      if (delta < 0) delta = 0; // guard
      if (delta > 1000) delta = 1000; // clamp huge pause (avoid spiral)
      lastMono = nowMono;
      acc += delta;
      while (acc >= this.FIXED_DT_MS) {
        step(nowMono);
        acc -= this.FIXED_DT_MS;
      }
      // Yield a bit to avoid busy-spinning the CPU.
      // Sleep roughly until the next tick is due (at least 0–1ms).
      let sleepMs = 0;
      if (acc < this.FIXED_DT_MS) {
        sleepMs = Math.max(0, Math.floor(this.FIXED_DT_MS - acc));
        // Ensure we yield to the event loop at least briefly
        if (sleepMs === 0) sleepMs = 1;
      }
      setTimeout(loop, sleepMs);
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
    const playerData = this.players.get(socketId);
    if (
      !playerData ||
      !playerData.isAlive ||
      playerData.connected === false ||
      playerData.loaded !== true
    )
      return;

    // Basic action validation
    if (!actionData || !actionData.type) return;

    console.log(
      `[GameRoom ${this.matchId}] Player ${playerData.name} action: ${actionData.type}`,
    );

    // Mark as combat to pause regen even if attack misses
    playerData.lastCombatAt = Date.now();

    // Process action (implement specific action handling later)
    // For now, just broadcast to other players
    this.io.to(`game:${this.matchId}`).emit("game:action", {
      playerId: playerData.user_id,
      playerName: playerData.name,
      // Include authoritative origin and facing for accurate remote visuals
      origin: { x: playerData.x, y: playerData.y },
      flip: !!playerData.flip,
      character: playerData.char_class,
      action: actionData,
      // Optional timestamp for ordering on client
      t: Date.now(),
    });
  }

  /**
   * Process a single game tick
   */
  processTick() {
    tickActiveAbilities(this, Date.now());

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

  _applyPowerupToPlayer(playerData, type, nowTs) {
    powerupManager.applyPowerupToPlayer(this, playerData, type, nowTs);
  }

  _tickPowerups() {
    powerupManager.tickPowerups(this);
  }

  _tickPowerupEffects() {
    powerupManager.tickPowerupEffects(this);
  }

  _buildPlayerEffectsSnapshot() {
    return powerupManager.buildPlayerEffectsSnapshot(this);
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

  /**
   * Clean up room resources
   */
  cleanup() {
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
      const socket = this.io.sockets.sockets.get(playerData.socketId);
      if (socket) {
        socket.leave(`game:${this.matchId}`);
      }
    }

    this.players.clear();
    console.log(`[GameRoom ${this.matchId}] Cleaned up`);
  }

  // Getters
  getPlayerCount() {
    return this.players.size;
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
  handleHit(socketId, payload) {
    try {
      if (!payload || typeof payload !== "object") return;
      const attackerName = String(payload.attacker || "").trim();
      const targetName = String(payload.target || "").trim();
      if (!attackerName || !targetName) return;

      const attacker = Array.from(this.players.values()).find(
        (p) => p.name === attackerName,
      );
      const target = Array.from(this.players.values()).find(
        (p) => p.name === targetName,
      );
      if (!attacker || !target) return;
      if (
        attacker.connected === false ||
        attacker.loaded !== true ||
        target.connected === false ||
        target.loaded !== true
      )
        return;
      if (!attacker.isAlive || !target.isAlive) return;
      // Allow self-hit (suicide on fall) but otherwise disable friendly fire
      const isSelf = attacker.name === target.name;
      if (
        !isSelf &&
        attacker.team &&
        target.team &&
        attacker.team === target.team
      )
        return;

      // Determine damage from server-side stats
      const attackType = String(payload.attackType || "basic").toLowerCase();
      const isNinjaSwarm = attackType === "ninja-special-swarm";
      const base = isNinjaSwarm
        ? NINJA_SWARM_HIT_DAMAGE
        : attackType === "special"
          ? Number(attacker.specialDamage || 0)
          : Number(attacker.baseDamage || 0);
      let dmg = Number.isFinite(base) && base > 0 ? base : 0;

      // Outgoing damage modifiers (rage powerup, thorgRage ability, damageBoost, etc.)
      const now = Date.now();
      dmg *= effectManager.getModifiers(attacker, now).damageMult;
      dmg = applyOutgoingDamageMultiplier(attacker, dmg, now);

      if (dmg <= 0) return;

      // Per-character range check with lag-compensated position rewind.
      // The client reports attackTime (wall clock) so the server can look up
      // both players' historical positions at the moment the hit was detected,
      // rather than comparing against the latest (stale) known positions.
      const attackTimeRaw =
        typeof payload.attackTime === "number" &&
        Number.isFinite(payload.attackTime)
          ? payload.attackTime
          : now;
      // Clamp to [now - HIT_STALENESS_MAX_MS, now] — reject absurdly old claims
      // but still handle normal network round-trip delay gracefully.
      const { attackTimeClamped, aPos, tPos, dist, maxDist, attackWasFuture } =
        combatValidation.evaluateHitRange({
          attacker,
          target,
          attackType,
          attackTimeRaw,
          now,
        });
      if (attackWasFuture) {
        if (this.DEV_TIMING_DIAG) {
          console.warn(
            `[GameRoom ${this.matchId}] hit rejected: future attackTime attacker=${attacker.name} target=${target.name} ` +
              `type=${attackType} raw=${attackTimeRaw} now=${now}`,
          );
        }
        return;
      }
      if (!isSelf && dist > maxDist) {
        if (this.DEV_TIMING_DIAG) {
          console.warn(
            `[GameRoom ${this.matchId}] hit rejected: dist=${dist.toFixed(0)}px > max=${maxDist}px ` +
              `attacker=${attacker.name}(${attacker.char_class}) target=${target.name} ` +
              `type=${attackType} age=${(now - attackTimeClamped).toFixed(0)}ms`,
          );
        }
        return;
      }

      // Facing-direction check for melee attacks (Draven splash, Thorg fall).
      // The target must be on the side the attacker is facing; a generous tolerance
      // prevents false rejections at the boundary.
      const isMeleeFacing = requiresMeleeFacingCheck(
        attacker,
        attackType,
        isSelf,
      );
      if (isMeleeFacing) {
        const validFacing = combatValidation.isMeleeFacingValid({
          attacker,
          aPos,
          tPos,
        });
        if (!validFacing) return;
      }

      // Basic per-attacker->target rate limit to avoid accidental double submissions
      this._recentHits = this._recentHits || new Map(); // key: attacker|target -> timestamp
      const instanceId = payload.instanceId ? String(payload.instanceId) : "";
      const key =
        attacker.name + "|" + target.name + "|" + attackType + "|" + instanceId;
      const last = this._recentHits.get(key) || 0;
      const DUP_WINDOW_MS = 80; // hits within 80ms considered duplicate
      if (!isSelf && now - last < DUP_WINDOW_MS) return; // duplicate, ignore
      this._recentHits.set(key, now);
      this._recordCombatStat(attacker, { hits: 1 });

      // Apply damage (incoming modifier covers shield powerup, freeze stun, etc.)
      dmg *= effectManager.getModifiers(target, now).damageTakenMult;
      const old = target.health;
      target.health = Math.max(0, target.health - Math.round(dmg));
      const appliedDamage = Math.max(0, old - target.health);
      attacker.lastAttackAt = now;
      target.lastDamagedAt = now;
      attacker.lastCombatAt = now;
      target.lastCombatAt = now;
      if (appliedDamage > 0) {
        this._recordCombatStat(attacker, { damage: appliedDamage });

        // Update super charge
        if (!isSelf && attacker.maxSuperCharge > 0) {
          const chargeGain = isNinjaSwarm
            ? Math.round(appliedDamage * NINJA_SWARM_CHARGE_RATIO)
            : appliedDamage;
          attacker.superCharge = Math.min(
            attacker.maxSuperCharge,
            (attacker.superCharge || 0) + chargeGain,
          );
          this.io.to(`game:${this.matchId}`).emit("super-update", {
            username: attacker.name,
            charge: attacker.superCharge,
            maxCharge: attacker.maxSuperCharge,
          });
        }

        if (!isSelf) {
          const knockback = getKnockback(attacker, target, now);
          if (knockback) {
            this.io.to(target.socketId).emit("player:knockback", {
              source: attacker.name,
              ...knockback,
            });
          }
        }
      }

      if (target.health !== old) {
        const scoredKill = !isSelf && target.health === 0 && old > 0 ? 1 : 0;
        if (scoredKill) {
          this._recordCombatStat(attacker, { kills: scoredKill });
        }
        if (target.health === 0) target.isAlive = false;
        this._broadcastHealthUpdate(target);
        if (!target.isAlive) {
          console.log(
            `%c[GameRoom ${this.matchId}] Player ${target.name} was killed by ${attacker.name}`,
            "color: red; font-weight: bold;",
          );
          // Optional: emit death event
          this.io.to(`game:${this.matchId}`).emit("player:dead", {
            username: target.name,
            gameId: this.matchId,
          });
          // After a death, check victory conditions
          try {
            this._checkVictoryCondition();
          } catch (e) {
            console.warn(
              `[GameRoom ${this.matchId}] victory check failed`,
              e?.message,
            );
          }
        }
      }
    } catch (e) {
      console.warn(`[GameRoom ${this.matchId}] handleHit error:`, e?.message);
    }
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
        getSpecialDamage,
        getCharacterStats,
      } = require("../../lib/characterStats.js");
      const maxHealth = Math.max(1, Number(getHealth(charClass, level)) || 1);
      const baseDamage = Math.max(0, Number(getDamage(charClass, level)) || 0);
      const specialDamage = Math.max(
        0,
        Number(getSpecialDamage(charClass, level)) || 0,
      );
      const stats = getCharacterStats(charClass) || {};
      const specialChargeDamage = stats.specialChargeDamage || 3000;
      const ammoCapacity = stats.ammoCapacity || 1;
      const ammoCooldownMs = stats.ammoCooldownMs || 1200;
      const ammoReloadMs = stats.ammoReloadMs || 1200;
      return {
        maxHealth,
        baseDamage,
        specialDamage,
        specialChargeDamage,
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
        specialChargeDamage: 3000,
        ammoCapacity: 1,
        ammoCooldownMs: 1200,
        ammoReloadMs: 1200,
      };
    }
  }

  /**
   * Emit a health-update to all players in the room.
   */
  _broadcastHealthUpdate(playerData) {
    healthManager.broadcastHealthUpdate(this, playerData);
  }

  /**
   * Conditionally broadcast health if min interval elapsed.
   */
  _maybeBroadcastHealth(playerData, nowTs) {
    healthManager.maybeBroadcastHealth(this, playerData, nowTs);
  }

  /**
   * Handle heal proposal from client. Applies clamped heal to target.
   */
  handleHeal(socketId, payload) {
    healthManager.handleHeal(this, payload);
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
}

module.exports = { GameRoom };
