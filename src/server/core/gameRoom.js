// gameRoom.js
// Individual game room handling server-authoritative game state
const {
  POWERUP_STARTING_COUNT,
  NINJA_SWARM_HIT_DAMAGE,
  NINJA_SWARM_CHARGE_RATIO,
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
const attackRuntimeManager = require("./gameRoom/attackRuntimeManager");
const characterActionRegistry = require("./gameRoom/characterActionRegistry");
const { createGameModeRuntime } = require("./gameModes");
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
    this.gameMode = createGameModeRuntime(this);
    this.modeState = this.gameMode?.createRoomState?.() ?? null;

    // Game loop (will migrate to fixed-step accumulator + snapshot cadence)
    this.gameLoop = null; // legacy interval reference (used only until refactor start)
    this._loopRunning = false;
    this._tickId = 0; // monotonically increasing per 60Hz tick
    this._lastSnapshotMono = 0;
    this._snapshotIntervals = []; // diagnostics (ms spacing between snapshots)
    this._diagLastLogMono = 0;
    this.FIXED_DT_MS = 1000 / 60; // 60 Hz fixed step
    this.SNAPSHOT_EVERY_TICKS = 1; // 60/2 = 30 Hz snapshots
    this.WORLD_STATE_EVERY_TICKS = 8; // 7.5 Hz world-state packets
    this.DEV_TIMING_DIAG = true; // temporary diagnostics flag
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

    // Powerups + timed effects (server authoritative)
    this._powerups = new Map(); // id -> { id, type, x, y, spawnedAt, expiresAt }
    this._nextPowerupId = 1;
    this._lastPowerupSpawnAt = 0;
    this._nextPowerupSpawnPointIdx = 0;
    this._nextPowerupTypeIdx = 0;
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

    this._seedBotPlayers();
  }

  _seedBotPlayers() {
    for (const matchPlayer of Array.isArray(this.matchData?.players)
      ? this.matchData.players
      : []) {
      if (!matchPlayer?.isBot) continue;
      const spawn = this._getBotSpawnState(matchPlayer);
      const level = 1;
      const {
        maxHealth,
        baseDamage,
        specialDamage,
        specialChargeDamage,
        ammoCapacity,
        ammoCooldownMs,
        ammoReloadMs,
      } = this._computeStats(matchPlayer.char_class || "ninja", level);
      const key = `bot:${matchPlayer.user_id || matchPlayer.name}`;
      this.players.set(key, {
        socketId: null,
        user_id: matchPlayer.user_id,
        name: matchPlayer.name,
        team: matchPlayer.team,
        char_class: matchPlayer.char_class || "ninja",
        isBot: true,
        connected: true,
        loaded: true,
        spawnIndex: this._computeSpawnIndex(matchPlayer.name, matchPlayer.team),
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        grounded: true,
        maxHealth,
        health: maxHealth,
        superCharge: 0,
        maxSuperCharge: specialChargeDamage,
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

  _getBotSpawnState(matchPlayer) {
    const mapId = Number(this.matchData?.map) || 1;
    const team = matchPlayer?.team === "team2" ? "team2" : "team1";
    const teamSize = Math.max(
      1,
      (Array.isArray(this.matchData?.players) ? this.matchData.players : []).filter(
        (player) => player?.team === team,
      ).length,
    );
    const index = Math.max(
      0,
      Number(this._computeSpawnIndex(matchPlayer?.name, team)) || 0,
    );
    const slotsBySize = {
      1: [0],
      2: [-120, 120],
      3: [-180, 0, 180],
    };
    const pickDx = (fallback = 0, bySize = slotsBySize) => {
      const list = bySize[String(Math.max(1, Math.min(3, teamSize)))] || [fallback];
      return Number(list[Math.max(0, Math.min(list.length - 1, index))]) || 0;
    };

    if (mapId === 1) {
      const centerX = 1150;
      const y = team === "team1" ? 490 : 227;
      return { x: centerX + pickDx(), y };
    }

    if (mapId === 2) {
      const teamAnchors =
        team === "team1"
          ? [
              { x: 1631, y: 291 },
              { x: 1004, y: 138 },
              { x: 1298, y: 138 },
            ]
          : [
              { x: 843, y: 429 },
              { x: 1457, y: 429 },
              { x: 671, y: 291 },
            ];
      return teamAnchors[Math.max(0, Math.min(teamAnchors.length - 1, index))];
    }

    if (mapId === 3) {
      const centerX = 1150;
      if (team === "team1") {
        const dxBySize = {
          1: [0],
          2: [-100, 100],
          3: [-145, 0, 145],
        };
        return { x: centerX + 350 + pickDx(0, dxBySize), y: 262 };
      }
      const dxBySize = {
        1: [0],
        2: [-130, 130],
        3: [-200, 0, 200],
      };
      return { x: centerX + pickDx(0, dxBySize), y: 500 };
    }

    if (mapId === 4) {
      const base = team === "team1" ? { x: 290, y: 835 } : { x: 2710, y: 835 };
      const dxBySize = {
        1: [0],
        2: [-65, 65],
        3: [-130, 0, 130],
      };
      return { x: base.x + pickDx(0, dxBySize), y: base.y };
    }

    return {
      x: team === "team1" ? 1000 : 1300,
      y: 500,
    };
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
      if (existingPlayer.socketId === socket.id) {
        if (!this._netTestEnabled) {
          console.log(
            `[GameRoom ${this.matchId}] Duplicate game:join ignored for ${user.name} on socket ${socket.id}`,
          );
        }
        socket.join(`game:${this.matchId}`);
        this.sendGameStateToPlayer(socket);
        return;
      }
      // Update socket for reconnection
      for (const [key, value] of this.players.entries()) {
        if (value?.user_id === user.user_id) this.players.delete(key);
      }
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      // Reconnection/new page load resets client packet sequencing.
      // If we keep the old sequence counters, the server will reject fresh
      // movement packets until the new client sequence number catches up.
      existingPlayer._lastPositionSeq = -1;
      existingPlayer._lastPositionClientTs = 0;
      existingPlayer._lastInputSeq = -1;
      if (Array.isArray(existingPlayer._inputIntentQueue)) {
        existingPlayer._inputIntentQueue.length = 0;
      }
      existingPlayer._currentInputIntent = null;
      existingPlayer._lastInputIntent = null;
      this.players.set(socket.id, existingPlayer);
      this._ensureRewardBucket(existingPlayer);
      this.io.to(`game:${this.matchId}`).emit("player:reconnected", {
        name: existingPlayer.name,
        username: existingPlayer.name,
        loaded: existingPlayer.loaded === true,
      });
      if (!this._netTestEnabled) {
        console.log(`[GameRoom ${this.matchId}] Player ${user.name} reconnected`);
      }
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
        x: null,
        y: null,
        vx: 0,
        vy: 0,
        grounded: false,
        maxHealth,
        health: maxHealth,
        superCharge: 0,
        maxSuperCharge: specialChargeDamage,
        isAlive: true,
        lastInput: Date.now(),
        _lastPositionPacketAt: 0,

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
      if (!this._netTestEnabled) {
        console.log(
          `[GameRoom ${this.matchId}] Player ${user.name} joined (${this.players.size}/${this.matchData.players.length})`,
        );
      }
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

    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${this.matchId}] Player ${user.name} left (${this.players.size} remaining)`,
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
    socket.on("game:special", (payload = {}) => {
      const p = this.players.get(socket.id);
      if (!p || !p.isAlive) return;
      if (p.superCharge < p.maxSuperCharge) return;

      p.superCharge = 0;
      const now = Date.now();
      p.lastCombatAt = now;
      const aimPayload =
        payload && typeof payload === "object" ? payload.aim || null : null;
      activateSpecial(this, p, now, aimPayload);

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
        aim: aimPayload,
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

    socket.on("deathdrop:pickup", (payload) => {
      this._handleDeathDropPickup(socket.id, payload);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      // This will be handled by the main socket disconnect handler
      // which calls gameHub.handlePlayerLeave
    });

    // Client signals they're ready to start (assets + scene loaded)
    socket.on("game:ready", (payload = {}) => {
      try {
        const p = this.players.get(socket.id);
        if (!p || !p.user_id) return;
        p._sceneReady = true;
        if (Number.isFinite(Number(payload?.x))) p.x = Number(payload.x);
        if (Number.isFinite(Number(payload?.y))) p.y = Number(payload.y);
        if (typeof payload?.flip === "boolean") p.flip = !!payload.flip;
        if (typeof payload?.animation === "string") {
          p.animation = payload.animation;
        }
        p.loaded = Number.isFinite(p.x) && Number.isFinite(p.y);
        if (this.status !== "starting") return;
        // Track by user_id (robust to reconnection)
        if (!this._readyAcks.has(p.user_id)) {
          this._readyAcks.add(p.user_id);
          const need = this._requiredUserIds.size;
          const have = this._readyAcks.size;
          if (!this._netTestEnabled) {
            console.log(
              `[GameRoom ${this.matchId}] Ready ack from ${p.name} (${have}/${need})`,
            );
          }
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
    this._nextPowerupSpawnPointIdx = 0;
    this._nextPowerupTypeIdx = 0;
    this._deathDrops.clear();
    this._nextDeathDropId = 1;
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
      attackRuntimeManager.tickActiveAttacks(this, Date.now());
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
        this._emitSnapshotWithTiming(currentMono);
      }
      if (this._tickId % this.WORLD_STATE_EVERY_TICKS === 0) {
        this.broadcastWorldState();
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

    try {
      const modeResult = this.gameMode?.handlePlayerAction?.(playerData, actionData);
      if (modeResult?.handled) {
        if (modeResult?.broadcast) {
          this.io.to(`game:${this.matchId}`).emit("game:action", {
            playerId: playerData.user_id,
            playerName: playerData.name,
            origin: { x: playerData.x, y: playerData.y },
            flip: !!playerData.flip,
            character: playerData.char_class,
            action: actionData,
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

    netTestLogger.noteAction(this, playerData, actionData.type);
    if (!this._netTestEnabled) {
      console.log(
        `[GameRoom ${this.matchId}] Player ${playerData.name} action: ${actionData.type}`,
      );
    }

    // Mark as combat to pause regen even if attack misses
    const actionNow = Date.now();
    playerData.lastCombatAt = actionNow;

    const characterActionResult = characterActionRegistry.handleCharacterAction(
      this,
      playerData,
      actionData,
      actionNow,
    );
    if (characterActionResult?.handled) return;

    // Process action (implement specific action handling later)
    // For now, just broadcast to other players
    characterActionRegistry.broadcastAction(this, playerData, actionData, Date.now());
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
    this._powerups.clear();
    this._deathDrops.clear();
    if (!this._netTestEnabled) {
      console.log(`[GameRoom ${this.matchId}] Cleaned up`);
    }
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
      if (!attackerName || !targetName) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=invalid_names socket=${socketId}`,
          );
        }
        return;
      }

      const attacker = Array.from(this.players.values()).find(
        (p) => p.name === attackerName,
      );
      const target = Array.from(this.players.values()).find(
        (p) => p.name === targetName,
      );
      const vaultMatch = targetName.match(/^vault:(team1|team2)$/i);
      const targetVaultTeam = vaultMatch ? String(vaultMatch[1]).toLowerCase() : null;
      const targetVault = targetVaultTeam
        ? this.gameMode?.getVaultState?.(targetVaultTeam) || null
        : null;
      if (!attacker || (!target && !targetVault)) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=missing_player attacker=${attackerName} target=${targetName}`,
          );
        }
        return;
      }
      if (
        attacker.connected === false ||
        attacker.loaded !== true ||
        (!targetVault && target.loaded !== true)
      ) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=not_loaded_or_disconnected attacker=${attacker.name} target=${targetVault ? targetName : target.name}`,
          );
        }
        return;
      }
      if (!attacker.isAlive || (!targetVault && !target.isAlive)) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=dead_player attackerAlive=${attacker.isAlive} targetAlive=${target?.isAlive}`,
          );
        }
        return;
      }
      if (targetVault) {
        if (!attacker.team || attacker.team === targetVaultTeam) {
          if (this.DEBUG_HIT_EVENTS) {
            console.log(
              `[HitDebug ${this.matchId}] reject reason=friendly_vault attacker=${attacker.name} target=${targetName}`,
            );
          }
          return;
        }
      }
      // Allow self-hit (suicide on fall) but otherwise disable friendly fire
      const isSelf = !targetVault && attacker.name === target.name;
      if (
        !isSelf &&
        !targetVault &&
        attacker.team &&
        target.team &&
        attacker.team === target.team
      ) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=friendly_fire attacker=${attacker.name} target=${target.name}`,
          );
        }
        return;
      }

      // Determine damage from server-side stats
      const attackType = String(payload.attackType || "basic").toLowerCase();
      const isNinjaSwarm = attackType === "ninja-special-swarm";
      const base = isNinjaSwarm
        ? NINJA_SWARM_HIT_DAMAGE
        : attackType === "special"
          ? Number(attacker.specialDamage || 0)
          : Number(attacker.baseDamage || 0);
      let dmg = Number.isFinite(base) && base > 0 ? base : 0;
      if (targetVault && attackType !== "basic") {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=vault_attack_type attacker=${attacker.name} type=${attackType}`,
          );
        }
        return;
      }

      // Outgoing damage modifiers (rage powerup, thorgRage ability, damageBoost, etc.)
      const now = Date.now();
      dmg *= effectManager.getModifiers(attacker, now).damageMult;
      dmg = applyOutgoingDamageMultiplier(attacker, dmg, now);

      if (dmg <= 0) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=non_positive_damage attacker=${attacker.name} type=${attackType} dmg=${dmg}`,
          );
        }
        return;
      }

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
      let attackTimeClamped = attackTimeRaw;
      let aPos = null;
      let tPos = null;
      let dist = 0;
      let maxDist = this._getAttackMaxDist(attacker.char_class, attackType);
      let attackWasFuture = false;
      if (targetVault) {
        aPos = this._getHistoricalPosition(attacker, attackTimeRaw);
        tPos = { x: Number(targetVault.x) || 0, y: Number(targetVault.y) || 0 };
        attackTimeClamped = Math.min(now, attackTimeRaw);
        attackWasFuture = attackTimeRaw > now + 250;
        dist = Math.hypot(
          Number(aPos?.x || 0) - tPos.x,
          Number(aPos?.y || 0) - tPos.y,
        );
        maxDist += Math.max(20, Number(targetVault.radius) || 90);
      } else {
        ({
          attackTimeClamped,
          aPos,
          tPos,
          dist,
          maxDist,
          attackWasFuture,
        } = combatValidation.evaluateHitRange({
          attacker,
          target,
          attackType,
          attackTimeRaw,
          now,
        }));
      }
      if (attackWasFuture) {
        if (this.DEV_TIMING_DIAG) {
          console.warn(
            `[GameRoom ${this.matchId}] hit rejected: future attackTime attacker=${attacker.name} target=${targetVault ? targetName : target.name} ` +
              `type=${attackType} raw=${attackTimeRaw} now=${now}`,
          );
        }
        return;
      }
      if (!isSelf && dist > maxDist) {
        if (this.DEV_TIMING_DIAG) {
          console.warn(
            `[GameRoom ${this.matchId}] hit rejected: dist=${dist.toFixed(0)}px > max=${maxDist}px ` +
              `attacker=${attacker.name}(${attacker.char_class}) target=${targetVault ? targetName : target.name} ` +
              `type=${attackType} age=${(now - attackTimeClamped).toFixed(0)}ms`,
          );
        }
        return;
      }

      // Facing-direction check for melee attacks (Draven splash, Thorg fall).
      // The target must be on the side the attacker is facing; a generous tolerance
      // prevents false rejections at the boundary.
      const isMeleeFacing = !targetVault && requiresMeleeFacingCheck(
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
        if (!validFacing) {
          if (this.DEBUG_HIT_EVENTS) {
            console.log(
              `[HitDebug ${this.matchId}] reject reason=facing attacker=${attacker.name} target=${target.name} type=${attackType}`,
            );
          }
          return;
        }
      }

      // Basic per-attacker->target rate limit to avoid accidental double submissions
      this._recentHits = this._recentHits || new Map(); // key: attacker|target -> timestamp
      const instanceId = payload.instanceId ? String(payload.instanceId) : "";
      const hitTargetKey = targetVault ? `vault:${targetVaultTeam}` : target.name;
      const keySafe =
        attacker.name + "|" + hitTargetKey + "|" + attackType + "|" + instanceId;
      const last = this._recentHits.get(keySafe) || 0;
      const DUP_WINDOW_MS = 80; // hits within 80ms considered duplicate
      if (!isSelf && now - last < DUP_WINDOW_MS) {
        if (this.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${this.matchId}] reject reason=duplicate attacker=${attacker.name} target=${targetVault ? targetName : target.name} type=${attackType} dt=${now - last}`,
          );
        }
        return; // duplicate, ignore
      }
      this._recentHits.set(keySafe, now);
      this._recordCombatStat(attacker, { hits: 1 });

      if (targetVault) {
        const previousHealth = Number(targetVault.health) || 0;
        const vaultState = this.gameMode?.damageVault?.(targetVaultTeam, dmg, {
          sourcePlayer: attacker.name,
          sourceTeam: attacker.team,
          attackType,
        });
        const appliedDamage = Math.max(
          0,
          previousHealth - (Number(vaultState?.health) || 0),
        );
        if (appliedDamage > 0) {
          attacker.lastAttackAt = now;
          attacker.lastCombatAt = now;
          this._recordCombatStat(attacker, { damage: appliedDamage });
          if (attacker.maxSuperCharge > 0) {
            attacker.superCharge = Math.min(
              attacker.maxSuperCharge,
              (attacker.superCharge || 0) + appliedDamage,
            );
            this.io.to(`game:${this.matchId}`).emit("super-update", {
              username: attacker.name,
              charge: attacker.superCharge,
              maxCharge: attacker.maxSuperCharge,
            });
          }
          this.broadcastSnapshot();
          this._checkVictoryCondition();
        }
        return;
      }

      // Apply damage (incoming modifier covers shield powerup, freeze stun, etc.)
      dmg *= effectManager.getModifiers(target, now).damageTakenMult;
      const old = target.health;
      target.health = Math.max(0, target.health - Math.round(dmg));
      const appliedDamage = Math.max(0, old - target.health);
      if (this.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${this.matchId}] accept attacker=${attacker.name} target=${target.name} type=${attackType} dist=${dist.toFixed(0)}/${maxDist} dmgRaw=${Math.round(dmg)} applied=${appliedDamage} hp=${old}->${target.health}`,
        );
      }
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
          if (knockback && target.connected !== false && target.socketId) {
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
        if (appliedDamage > 0) {
          this.io.to(`game:${this.matchId}`).emit("game:action", {
            playerId: attacker.user_id,
            playerName: attacker.name,
            origin: { x: attacker.x, y: attacker.y },
            flip: !!attacker.flip,
            character: attacker.char_class,
            action: {
              type: "character-hit-confirm",
              attackType,
              target: target.name,
              ownerEcho: true,
            },
            t: now,
          });
        }
        this._broadcastHealthUpdate(target, { cause: "combat" });
        if (target.health === 0 && old > 0) {
          console.log(
            `%c[GameRoom ${this.matchId}] Player ${target.name} was killed by ${attacker.name}`,
            "color: red; font-weight: bold;",
          );
          this._handlePlayerDeath(target, {
            cause: "combat",
            killedBy: attacker.name,
            at: now,
          });
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
      const nextX = Number.isFinite(spawnX) ? spawnX : Number(playerData.x) || 0;
      const nextY = Number.isFinite(spawnY) ? spawnY : Number(playerData.y) || 0;
      playerData.isAlive = true;
      playerData._deathHandled = false;
      playerData.health = Math.max(1, Number(playerData.maxHealth) || 1);
      playerData.x = nextX;
      playerData.y = nextY;
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
