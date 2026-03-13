// gameRoom.js
// Individual game room handling server-authoritative game state

// World bounds for Phase 1 (client-authoritative positions)
const WORLD_BOUNDS = {
  width: 1300, // match Phaser config width
  height: 650, // match Phaser config height
  margin: 200, // allow going a bit off-screen before clamping
};

// ── Easily-tunable match timing ───────────────────────────────────────────
const GAME_DURATION_MS = 0.5 * 60 * 1000; // 2.5 minutes until sudden death starts
const SD_RISE_SPEED = 15; // px/s the poison water rises (world: 1300×650)
const SD_DAMAGE_PER_SEC = 400; // HP/s lost while standing in the poison
const TIMER_EMIT_INTERVAL_MS = 500; // how often game:timer is broadcast to clients
// Powerup tuning (server-authoritative)
const POWERUP_SPAWN_INTERVAL_MS = 20000; // recommended cadence
const POWERUP_STARTING_COUNT = 2; // spawn this many when game loop begins
const POWERUP_MAX_ACTIVE = 3;
const POWERUP_PICKUP_RADIUS = 52;
const POWERUP_DESPAWN_MS = 7000;
const POWERUP_RECENT_SPAWN_MEMORY = 4;
const POWERUP_SPAWN_Y_LIFT = 34; // lift from platform surface so pickup is visibly above ground
const POWERUP_TYPES = ["rage", "health", "shield", "poison", "gravityBoots"];
const POWERUP_DURATIONS_MS = {
  rage: 10000,
  health: 10000,
  shield: 10000,
  poison: 8000,
  gravityBoots: 7000,
};
const POWERUP_RAGE_DAMAGE_MULT = 1.35;
const POWERUP_SHIELD_DAMAGE_MULT = 0.7; // takes 70% damage
const POWERUP_HEALTH_REGEN_PER_SEC = 600;
const POWERUP_POISON_DPS = 600;
const POWERUP_EFFECT_TICK_MS = 500;
const POWERUP_AMBIENT_TICK_MS = 1200; // occasional cadence for non-damaging powerups
const THORG_RAGE_DURATION_MS = 8000;
const THORG_RAGE_DAMAGE_MULT = 1.12;
const THORG_RAGE_KNOCKBACK_X = 155;
const THORG_RAGE_KNOCKBACK_Y = 88;
const NINJA_SWARM_HIT_DAMAGE = 300;
const NINJA_SWARM_CHARGE_RATIO = 0.25;
const POWERUP_PLATFORM_POINTS = {
  // Reachable top-surface slots (avoid center-only placement)
  1: [
    { x: 435, y: 506 },
    { x: 650, y: 506 },
    { x: 865, y: 506 },
    { x: 505, y: 166 },
    { x: 650, y: 166 },
    { x: 795, y: 166 },
    { x: 145, y: 188 },
    { x: 285, y: 188 },
    { x: 1015, y: 188 },
    { x: 1155, y: 188 },
    { x: 92, y: 468 },
    { x: 1208, y: 468 },
  ],
  2: [
    { x: 590, y: 330 },
    { x: 710, y: 330 },
    { x: 650, y: 520 },
    { x: 225, y: 560 },
    { x: 1075, y: 560 },
    { x: 370, y: 247 },
    { x: 930, y: 247 },
    { x: 220, y: 122 },
    { x: 1080, y: 122 },
    { x: 520, y: 72 },
    { x: 780, y: 72 },
  ],
};
// ──────────────────────────────────────────────────────────────────────────

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
    this.SNAPSHOT_EVERY_TICKS = 3; // 60/3 = 20 Hz snapshots
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
      this.players.delete(existingPlayer.socketId);
      existingPlayer.socketId = socket.id;
      this.players.set(socket.id, existingPlayer);
      this._ensureRewardBucket(existingPlayer);
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
      const { maxHealth, baseDamage, specialDamage, specialChargeDamage } =
        this._computeStats(matchPlayer.char_class, level);

      const playerData = {
        socketId: socket.id,
        user_id: user.user_id,
        name: user.name,
        team: matchPlayer.team,
        char_class: matchPlayer.char_class,

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

        // Timed powerup state
        effects: {
          rageUntil: 0,
          healthUntil: 0,
          shieldUntil: 0,
          poisonUntil: 0,
          gravityUntil: 0,
          thorgRageUntil: 0,
          thorgRageNextTickAt: 0,
          healthNextTickAt: 0,
          poisonNextTickAt: 0,
          rageNextTickAt: 0,
          gravityNextTickAt: 0,
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

    console.log(
      `[GameRoom ${this.matchId}] Player ${user.name} left (${this.players.size} remaining)`,
    );

    // Handle disconnection during active game
    if (this.status === "active") {
      // Mark player as disconnected but keep in game for potential reconnection
      // In a real game, you might want to pause or give them a grace period
      this.io.to(`game:${this.matchId}`).emit("player:disconnected", {
        name: user.name,
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

    // Handle player actions (attacks, abilities, etc.)
    socket.on("game:action", (actionData) => {
      this.handlePlayerAction(socket.id, actionData);
    });

    // Handle special attack request
    socket.on("game:special", () => {
      const p = this.players.get(socket.id);
      if (!p || !p.isAlive) return;

      if (p.superCharge >= p.maxSuperCharge) {
        p.superCharge = 0;
        const now = Date.now();
        if (p.char_class === "thorg") {
          p.effects = p.effects || {};
          p.effects.thorgRageUntil = Math.max(
            p.effects.thorgRageUntil || 0,
            now + THORG_RAGE_DURATION_MS,
          );
          p.effects.thorgRageNextTickAt = now + POWERUP_AMBIENT_TICK_MS;
        }
        // Broadcast reset
        this.io.to(`game:${this.matchId}`).emit("super-update", {
          username: p.name,
          charge: 0,
          maxCharge: p.maxSuperCharge,
        });

        // Broadcast special activation
        this.io.to(`game:${this.matchId}`).emit("player:special", {
          username: p.name,
          character: p.char_class,
          origin: { x: p.x, y: p.y },
          flip: !!p.flip,
        });
      }
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
    const playerData = this.players.get(socket.id);
    if (!playerData) return;

    // Prepare game state for this player
    const computeSpawnIndex = (name, team) => {
      try {
        const teamList = (this.matchData.players || [])
          .filter((p) => p.team === team)
          .map((p) => ({ name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const idx = Math.max(
          0,
          teamList.findIndex((p) => p.name === name),
        );
        return idx;
      } catch (e) {
        return 0;
      }
    };
    const gameStateForPlayer = {
      matchId: this.matchId,
      mode: this.matchData.mode,
      map: this.matchData.map,
      yourTeam: playerData.team,
      yourCharacter: playerData.char_class,
      spawnVersion: this.spawnVersion,
      powerups: Array.from(this._powerups.values()).map((pu) => ({
        id: pu.id,
        type: pu.type,
        x: pu.x,
        y: pu.y,
        spawnedAt: pu.spawnedAt,
        expiresAt: pu.expiresAt,
      })),
      playerEffects: this._buildPlayerEffectsSnapshot(),
      players: Array.from(this.players.values()).map((p) => ({
        name: p.name,
        team: p.team,
        char_class: p.char_class,
        x: p.x,
        y: p.y,
        health: p.health,
        superCharge: p.superCharge,
        maxSuperCharge: p.maxSuperCharge,
        stats: { health: p.maxHealth },
        level: p.level,
        isAlive: p.isAlive,
        spawnIndex: computeSpawnIndex(p.name, p.team),
      })),
      status: this.status,
    };
    console.log("Emitting initial game state to player", gameStateForPlayer);
    socket.emit("game:init", gameStateForPlayer);
  }

  /**
   * Enter a 10s starting phase where clients load and ack readiness.
   * If all acks received sooner, start immediately; otherwise start on timeout.
   */
  potentialStartGame() {
    if (this.status !== "waiting") return; // only transition from waiting
    this.status = "starting";
    this._readyAcks = new Set();
    console.log(
      `[GameRoom ${this.matchId}] Entering starting phase (10s timeout)`,
    );

    // Announce starting phase to clients (UI can show VS overlay)
    this.io.to(`game:${this.matchId}`).emit("game:starting", {
      timeoutMs: 10000,
      at: Date.now(),
    });

    // Safety timeout: start even if not all clients ack
    if (this._startTimeout) {
      try {
        clearTimeout(this._startTimeout);
      } catch (_) {}
    }
    this._startTimeout = setTimeout(() => {
      this._finalizeStart("timeout");
    }, 10000);
  }

  /**
   * Finalize start after all acks or timeout.
   * @param {"all_acks"|"timeout"} reason
   */
  _finalizeStart(reason = "timeout") {
    if (this.status !== "starting") return; // idempotent guard
    if (this._startTimeout) {
      try {
        clearTimeout(this._startTimeout);
      } catch (_) {}
      this._startTimeout = null;
    }
    const have = this._readyAcks?.size || 0;
    const need = this._requiredUserIds?.size || 0;
    console.log(
      `[GameRoom ${this.matchId}] Finalizing start (reason=${reason}) acks=${have}/${need}`,
    );
    this.startGame();
  }

  /**
   * Start the game
   */
  startGame() {
    console.log(
      `[GameRoom ${this.matchId}] Starting game with ${this.players.size} players`,
    );

    this.status = "active";

    // Initialize spawn positions (basic implementation)
    this.initializeSpawnPositions();

    // Notify all players that game is starting
    this.io.to(`game:${this.matchId}`).emit("game:start", {
      countdown: 3, // 3 second countdown
    });

    // Start the game loop after countdown
    setTimeout(() => {
      this.startGameLoop();
    }, 3000);
  }

  /**
   * Initialize spawn positions for players
   */
  initializeSpawnPositions() {
    // No-op: Client is responsible for map-accurate spawn placement via
    // positionLushySpawn/positionMangroveSpawn helpers. Server will adopt
    // positions from client input in Phase 1.
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
    if (this.status !== "active") return;
    const now = Date.now();
    const elapsed = now - this._loopStartWallTime;
    const remaining = Math.max(0, GAME_DURATION_MS - elapsed);
    const suddenDeath = elapsed >= GAME_DURATION_MS;

    // Compute poison water surface (world Y: 650=bottom, 0=top)
    const sdElapsed = suddenDeath ? elapsed - GAME_DURATION_MS : 0;
    const poisonY = suddenDeath
      ? Math.max(0, 650 - (sdElapsed / 1000) * SD_RISE_SPEED)
      : 700; // off-screen

    // Announce sudden death exactly once
    if (suddenDeath && !this._suddenDeathActive) {
      this._suddenDeathActive = true;
      this.io
        .to(`game:${this.matchId}`)
        .emit("game:sudden-death:start", { poisonY });
      console.log(`[GameRoom ${this.matchId}] Sudden death started`);
    }

    // Apply poison damage each tick to alive players in the water
    if (this._suddenDeathActive) {
      const dmgPerTick = (SD_DAMAGE_PER_SEC * this.FIXED_DT_MS) / 1000;
      for (const p of this.players.values()) {
        if (!p.isAlive) continue;
        if (typeof p.y !== "number" || p.y < poisonY) continue; // above waterline
        // Block regen for any player standing in the poison water
        p.lastCombatAt = now;
        const old = p.health;
        p.health = Math.max(0, p.health - dmgPerTick);
        if (p.health !== old) {
          this._maybeBroadcastHealth(p, now);
          if (p.health <= 0) {
            p.isAlive = false;
            p.health = 0;
            this._broadcastHealthUpdate(p);
            this.io.to(`game:${this.matchId}`).emit("player:dead", {
              username: p.name,
              gameId: this.matchId,
            });
            try {
              this._checkVictoryCondition();
            } catch (_) {}
          }
        }
      }
    }

    // Broadcast timer at controlled interval
    if (now - this._lastTimerEmitMs >= TIMER_EMIT_INTERVAL_MS) {
      this._lastTimerEmitMs = now;
      this.io.to(`game:${this.matchId}`).emit("game:timer", {
        elapsed,
        remaining,
        total: GAME_DURATION_MS,
        suddenDeath,
        poisonY,
      });
    }
  }

  _emitSnapshotWithTiming(snapMono) {
    const wall = Date.now();
    if (this._lastSnapshotMono > 0) {
      const spacing = snapMono - this._lastSnapshotMono;
      if (spacing >= 0) this._snapshotIntervals.push(spacing);
    }
    this._lastSnapshotMono = snapMono;
    this.broadcastSnapshot({
      tickId: this._tickId,
      tMono: snapMono,
      sentAtWallMs: wall,
    });
    if (this.DEV_TIMING_DIAG) {
      if (
        snapMono - this._diagLastLogMono >= 1000 &&
        this._snapshotIntervals.length
      ) {
        const arr = this._snapshotIntervals.slice(-60);
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance =
          arr.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / arr.length;
        const stdev = Math.sqrt(variance);
        console.log(
          `[GameRoom ${this.matchId}] timing tickId=${
            this._tickId
          } avgSpacing=${avg.toFixed(2)}ms stdev=${stdev.toFixed(
            2,
          )}ms samples=${arr.length}`,
        );
        this._diagLastLogMono = snapMono;
      }
    }
  }

  /**
   * Handle player input (movement, etc.)
   * @param {string} socketId
   * @param {object} inputData
   */
  handlePlayerInput(socketId, inputData) {
    const playerData = this.players.get(socketId);
    if (!playerData || !playerData.isAlive) return;

    // Validate input
    if (!inputData || typeof inputData !== "object") return;

    // If client sent authoritative position, accept it (Phase 1: make it work)
    if (
      typeof inputData.x === "number" &&
      typeof inputData.y === "number" &&
      Number.isFinite(inputData.x) &&
      Number.isFinite(inputData.y)
    ) {
      const minX = -WORLD_BOUNDS.margin;
      const maxX = WORLD_BOUNDS.width + WORLD_BOUNDS.margin;
      const minY = -WORLD_BOUNDS.margin;
      const maxY = WORLD_BOUNDS.height + WORLD_BOUNDS.margin;
      playerData.x = Math.max(minX, Math.min(maxX, inputData.x));
      playerData.y = Math.max(minY, Math.min(maxY, inputData.y));
      if (typeof inputData.flip !== "undefined") {
        playerData.flip = !!inputData.flip;
      }
      if (typeof inputData.animation === "string") {
        playerData.animation = inputData.animation;
      }
      playerData.lastInput = Date.now();
      return; // done
    }

    // Else treat as directional input (server-simulated fallback)
    inputData.timestamp = Date.now();
    playerData.inputBuffer.push(inputData);
    if (playerData.inputBuffer.length > 10) playerData.inputBuffer.shift();
    playerData.lastInput = Date.now();
  }

  /**
   * Handle player actions (attacks, abilities)
   * @param {string} socketId
   * @param {object} actionData
   */
  handlePlayerAction(socketId, actionData) {
    const playerData = this.players.get(socketId);
    if (!playerData || !playerData.isAlive) return;

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
    // For Phase 1, just process basic movement inputs
    for (const playerData of this.players.values()) {
      if (!playerData.isAlive) continue;

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
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.isAlive) continue;
      if (typeof p.maxHealth !== "number" || typeof p.health !== "number")
        continue;

      const idleFor = now - (p.lastCombatAt || 0);
      if (idleFor < this.REGEN_DELAY_MS) continue; // still in post-combat cooldown
      if (p.health >= p.maxHealth) continue; // already full

      const nextAt = p._regenNextAt || 0;
      if (now < nextAt) continue; // wait until next tick

      const missing = Math.max(0, p.maxHealth - p.health);
      // Base desired heal = max(fixed minimum, % of missing)
      const baseDesired = Math.max(
        this.REGEN_MIN_ABS,
        Math.ceil(missing * this.REGEN_MISSING_RATIO),
      );
      // Round up to next 100 multiple (e.g., 1->100, 401->500)
      let inc = Math.ceil(baseDesired / 100) * 100;
      // Never exceed the actual missing health
      inc = Math.min(inc, missing);
      const old = p.health;
      p.health = Math.min(p.maxHealth, p.health + inc);
      p._regenNextAt = now + this.REGEN_TICK_MS;
      if (p.health !== old) {
        this._maybeBroadcastHealth(p, now);
      }
    }
  }

  _getPlatformSpawnPoints() {
    const mapId = Number(this.matchData?.map) || 1;
    const points = POWERUP_PLATFORM_POINTS[mapId] || POWERUP_PLATFORM_POINTS[1];
    return Array.isArray(points) && points.length
      ? points
      : POWERUP_PLATFORM_POINTS[1];
  }

  _pickSpawnPoint() {
    const points = this._getPlatformSpawnPoints();
    if (!points.length) return { x: 650, y: 300 };

    // Avoid spawning on top of current powerups or recent points.
    const activeIdxSet = new Set();
    for (const pu of this._powerups.values()) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dx = points[i].x - pu.x;
        const dy = points[i].y - pu.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) activeIdxSet.add(bestIdx);
    }

    const avoidRecent = new Set(this._recentPowerupSpawnIdx);
    const available = [];
    for (let i = 0; i < points.length; i++) {
      if (activeIdxSet.has(i)) continue;
      if (avoidRecent.has(i)) continue;
      available.push(i);
    }

    // If everything got filtered, progressively relax constraints.
    if (!available.length) {
      for (let i = 0; i < points.length; i++) {
        if (!activeIdxSet.has(i)) available.push(i);
      }
    }
    if (!available.length) {
      for (let i = 0; i < points.length; i++) available.push(i);
    }

    const idx = available[Math.floor(Math.random() * available.length)] ?? 0;
    this._recentPowerupSpawnIdx.push(idx);
    if (this._recentPowerupSpawnIdx.length > POWERUP_RECENT_SPAWN_MEMORY) {
      this._recentPowerupSpawnIdx.shift();
    }
    return points[idx];
  }

  _spawnPowerup() {
    if (this.status !== "active") return;
    if (this._powerups.size >= POWERUP_MAX_ACTIVE) return;
    const type =
      POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const point = this._pickSpawnPoint();
    const now = Date.now();
    const powerup = {
      id: this._nextPowerupId++,
      type,
      x: Number(point.x) || 650,
      y: (Number(point.y) || 300) - POWERUP_SPAWN_Y_LIFT,
      spawnedAt: now,
      expiresAt: now + POWERUP_DESPAWN_MS,
    };
    this._powerups.set(powerup.id, powerup);
  }

  _isInSuddenDeathWater(playerData, nowTs) {
    if (!this._suddenDeathActive) return false;
    const elapsed = nowTs - this._loopStartWallTime;
    const sdElapsed = Math.max(0, elapsed - GAME_DURATION_MS);
    const poisonY = Math.max(0, 650 - (sdElapsed / 1000) * SD_RISE_SPEED);
    return typeof playerData?.y === "number" && playerData.y >= poisonY;
  }

  _applyPowerupToPlayer(playerData, type, nowTs) {
    if (!playerData || !playerData.effects) return;
    const effects = playerData.effects;
    const duration = POWERUP_DURATIONS_MS[type] || 5000;
    if (type === "rage") {
      effects.rageUntil = Math.max(effects.rageUntil || 0, nowTs + duration);
      if ((effects.rageNextTickAt || 0) <= nowTs) {
        effects.rageNextTickAt = nowTs + POWERUP_AMBIENT_TICK_MS;
      }
    } else if (type === "health") {
      const old = playerData.health;
      playerData.health = playerData.maxHealth;
      effects.healthUntil = Math.max(
        effects.healthUntil || 0,
        nowTs + duration,
      );
      effects.healthNextTickAt = nowTs + POWERUP_EFFECT_TICK_MS;
      if (playerData.health !== old) this._broadcastHealthUpdate(playerData);
    } else if (type === "shield") {
      effects.shieldUntil = Math.max(
        effects.shieldUntil || 0,
        nowTs + duration,
      );
    } else if (type === "poison") {
      effects.poisonUntil = Math.max(
        effects.poisonUntil || 0,
        nowTs + duration,
      );
      effects.poisonNextTickAt = nowTs + POWERUP_EFFECT_TICK_MS;
    } else if (type === "gravityBoots") {
      effects.gravityUntil = Math.max(
        effects.gravityUntil || 0,
        nowTs + duration,
      );
      if ((effects.gravityNextTickAt || 0) <= nowTs) {
        effects.gravityNextTickAt = nowTs + POWERUP_AMBIENT_TICK_MS;
      }
    }
  }

  _tickPowerups() {
    if (this.status !== "active") return;
    const now = Date.now();

    if (now - this._lastPowerupSpawnAt >= POWERUP_SPAWN_INTERVAL_MS) {
      this._lastPowerupSpawnAt = now;
      this._spawnPowerup();
    }

    for (const [id, pu] of this._powerups.entries()) {
      if (!pu || now >= (pu.expiresAt || 0)) {
        this._powerups.delete(id);
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.isAlive) continue;
        const dx = (p.x || 0) - pu.x;
        const dy = (p.y || 0) - pu.y;
        if (Math.hypot(dx, dy) > POWERUP_PICKUP_RADIUS) continue;

        this._applyPowerupToPlayer(p, pu.type, now);
        this._powerups.delete(id);
        this.io.to(`game:${this.matchId}`).emit("powerup:collected", {
          id: pu.id,
          type: pu.type,
          username: p.name,
          x: pu.x,
          y: pu.y,
          at: now,
        });
        break;
      }
    }
  }

  _tickPowerupEffects() {
    if (this.status !== "active") return;
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.isAlive || !p.effects) continue;
      const e = p.effects;

      // Poison DOT
      if ((e.poisonUntil || 0) > now && (e.poisonNextTickAt || 0) <= now) {
        e.poisonNextTickAt = now + POWERUP_EFFECT_TICK_MS;
        const old = p.health;
        const dmg = (POWERUP_POISON_DPS * POWERUP_EFFECT_TICK_MS) / 1000;
        p.health = Math.max(0, p.health - dmg);
        p.lastCombatAt = now;
        if (p.health !== old) {
          this._broadcastHealthUpdate(p);
          this.io.to(`game:${this.matchId}`).emit("powerup:tick", {
            type: "poison",
            username: p.name,
          });
          if (p.health <= 0) {
            p.isAlive = false;
            this.io.to(`game:${this.matchId}`).emit("player:dead", {
              username: p.name,
              gameId: this.matchId,
            });
            try {
              this._checkVictoryCondition();
            } catch (_) {}
          }
        }
      }

      // Health-over-time boost (paused while standing in sudden-death water)
      if ((e.healthUntil || 0) > now && (e.healthNextTickAt || 0) <= now) {
        e.healthNextTickAt = now + POWERUP_EFFECT_TICK_MS;
        if (!this._isInSuddenDeathWater(p, now)) {
          const old = p.health;
          const inc =
            (POWERUP_HEALTH_REGEN_PER_SEC * POWERUP_EFFECT_TICK_MS) / 1000;
          p.health = Math.min(p.maxHealth, p.health + inc);
          if (p.health !== old) {
            this._maybeBroadcastHealth(p, now);
            this.io.to(`game:${this.matchId}`).emit("powerup:tick", {
              type: "health",
              username: p.name,
            });
          }
        }
      }

      if ((e.rageUntil || 0) > now && (e.rageNextTickAt || 0) <= now) {
        e.rageNextTickAt = now + POWERUP_AMBIENT_TICK_MS;
        this.io.to(`game:${this.matchId}`).emit("powerup:tick", {
          type: "rage",
          username: p.name,
        });
      }

      if (
        (e.thorgRageUntil || 0) > now &&
        (e.thorgRageNextTickAt || 0) <= now
      ) {
        e.thorgRageNextTickAt =
          now + Math.max(700, POWERUP_AMBIENT_TICK_MS - 250);
        this.io.to(`game:${this.matchId}`).emit("powerup:tick", {
          type: "thorgRage",
          username: p.name,
        });
      }

      if ((e.gravityUntil || 0) > now && (e.gravityNextTickAt || 0) <= now) {
        e.gravityNextTickAt = now + POWERUP_AMBIENT_TICK_MS;
        this.io.to(`game:${this.matchId}`).emit("powerup:tick", {
          type: "gravityBoots",
          username: p.name,
        });
      }
    }
  }

  _buildPlayerEffectsSnapshot() {
    const now = Date.now();
    const out = {};
    for (const p of this.players.values()) {
      const e = p.effects || {};
      out[p.name] = {
        rage: Math.max(0, (e.rageUntil || 0) - now),
        health: Math.max(0, (e.healthUntil || 0) - now),
        shield: Math.max(0, (e.shieldUntil || 0) - now),
        poison: Math.max(0, (e.poisonUntil || 0) - now),
        gravityBoots: Math.max(0, (e.gravityUntil || 0) - now),
        thorgRage: Math.max(0, (e.thorgRageUntil || 0) - now),
      };
    }
    return out;
  }

  /**
   * Process player movement
   * @param {object} playerData
   * @param {object} input
   */
  processPlayerMovement(playerData, input) {
    // Basic movement processing (expand this later)
    const speed = 5;

    if (input.left) playerData.x -= speed;
    if (input.right) playerData.x += speed;
    if (input.up) playerData.y -= speed;
    if (input.down) playerData.y += speed;

    // Basic bounds checking (allow slight off-screen margin)
    const minX = -WORLD_BOUNDS.margin;
    const maxX = WORLD_BOUNDS.width + WORLD_BOUNDS.margin;
    const minY = -WORLD_BOUNDS.margin;
    const maxY = WORLD_BOUNDS.height + WORLD_BOUNDS.margin;
    playerData.x = Math.max(minX, Math.min(maxX, playerData.x));
    playerData.y = Math.max(minY, Math.min(maxY, playerData.y));
  }

  /**
   * Broadcast game state snapshot to all players
   */
  broadcastSnapshot(extraTiming = null) {
    const snapshot = {
      timestamp: Date.now(), // legacy field for existing clients
      players: {},
      powerups: Array.from(this._powerups.values()).map((pu) => ({
        id: pu.id,
        type: pu.type,
        x: pu.x,
        y: pu.y,
        spawnedAt: pu.spawnedAt,
        expiresAt: pu.expiresAt,
      })),
      playerEffects: this._buildPlayerEffectsSnapshot(),
    };
    if (extraTiming) {
      snapshot.tickId = extraTiming.tickId;
      snapshot.tMono = extraTiming.tMono;
      snapshot.sentAtWallMs = extraTiming.sentAtWallMs;
    }

    // Build snapshot of all player positions
    for (const playerData of this.players.values()) {
      snapshot.players[playerData.name] = {
        x: playerData.x,
        y: playerData.y,
        flip: !!playerData.flip,
        animation: playerData.animation || null,
        health: playerData.health,
        isAlive: playerData.isAlive,
      };
    }

    // Disable compression for frequent movement messages to reduce latency
    this.io
      .to(`game:${this.matchId}`)
      .compress(false)
      .emit("game:snapshot", snapshot);
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
   * Handle a client-proposed hit. Server validates and applies damage.
   * @param {string} socketId
   * @param {object} payload { attacker, target, attackType?, instanceId?, damage? }
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

      // Rage buff: increase outgoing damage
      const now = Date.now();
      if ((attacker.effects?.rageUntil || 0) > now) {
        dmg *= POWERUP_RAGE_DAMAGE_MULT;
      }
      if (
        attacker.char_class === "thorg" &&
        (attacker.effects?.thorgRageUntil || 0) > now
      ) {
        dmg *= THORG_RAGE_DAMAGE_MULT;
      }

      if (dmg <= 0) return;

      // Generous plausibility check on distance (without per-ability ranges yet)
      // Prevents blatant long-range spoofing while not being too strict.
      const dx = (attacker.x || 0) - (target.x || 0);
      const dy = (attacker.y || 0) - (target.y || 0);
      const dist = Math.hypot(dx, dy);
      const maxDist = attackType === "special" || isNinjaSwarm ? 1000 : 850; // px
      if (!isSelf && dist > maxDist) return; // ignore impossible hits

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

      // Apply damage
      if ((target.effects?.shieldUntil || 0) > now) {
        dmg *= POWERUP_SHIELD_DAMAGE_MULT;
      }
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

        if (
          !isSelf &&
          attacker.char_class === "thorg" &&
          (attacker.effects?.thorgRageUntil || 0) > now &&
          target.socketId
        ) {
          const knockDirection = (target.x || 0) >= (attacker.x || 0) ? 1 : -1;
          this.io.to(target.socketId).emit("player:knockback", {
            source: attacker.name,
            amountX: THORG_RAGE_KNOCKBACK_X * knockDirection,
            amountY: THORG_RAGE_KNOCKBACK_Y,
          });
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
      return { maxHealth, baseDamage, specialDamage, specialChargeDamage };
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
      };
    }
  }

  /**
   * Emit a health-update to all players in the room.
   */
  _broadcastHealthUpdate(playerData) {
    this.io.to(`game:${this.matchId}`).emit("health-update", {
      username: playerData.name,
      health: Math.max(0, Math.round(playerData.health)),
      maxHealth: Math.max(
        1,
        Math.round(playerData.maxHealth || playerData.health || 1),
      ),
      gameId: this.matchId,
    });
    playerData._lastHealthBroadcastAt = Date.now();
  }

  /**
   * Conditionally broadcast health if min interval elapsed.
   */
  _maybeBroadcastHealth(playerData, nowTs) {
    const last = Number(playerData._lastHealthBroadcastAt || 0);
    if (
      nowTs - last >= this.REGEN_BROADCAST_MIN_MS ||
      playerData.health === playerData.maxHealth
    ) {
      this._broadcastHealthUpdate(playerData);
    }
  }

  /**
   * Handle heal proposal from client. Applies clamped heal to target.
   */
  handleHeal(socketId, payload) {
    try {
      if (!payload || typeof payload !== "object") return;
      const sourceName = String(
        payload.source || payload.attacker || "",
      ).trim();
      const targetName = String(payload.target || "").trim();
      if (!targetName) return;

      const source = sourceName
        ? Array.from(this.players.values()).find((p) => p.name === sourceName)
        : null;
      const target = Array.from(this.players.values()).find(
        (p) => p.name === targetName,
      );
      if (!target || !target.isAlive) return;

      // Basic anti-abuse: optionally require same team if source provided
      if (source && source.team && target.team && source.team !== target.team)
        return;

      // Compute heal amount: use a conservative default (half of baseDamage) if no ability type specified
      const ability = String(
        payload.abilityType || payload.attackType || "heal",
      ).toLowerCase();
      let amount = 0;
      if (source) {
        // Tie to source offensive power to avoid huge spoofed heals
        const ref = Math.max(0, Number(source.baseDamage || 0));
        amount = Math.round(ref * 0.5);
      } else {
        amount = 200; // fallback small heal
      }
      if (amount <= 0) return;

      const now = Date.now();
      const old = target.health;
      target.health = Math.min(target.maxHealth, target.health + amount);
      if (target.health !== old) {
        // Mark combat only if healing counts as combat pause (we will mark as combat to pause regen stacking)
        target.lastCombatAt = now;
        this._broadcastHealthUpdate(target);
      }
    } catch (e) {
      console.warn(`[GameRoom ${this.matchId}] handleHeal error:`, e?.message);
    }
  }

  /**
   * Evaluate whether one team has been fully eliminated and finish the game if so.
   */
  _checkVictoryCondition() {
    if (this.status !== "active") return; // only during active play
    const aliveByTeam = { team1: 0, team2: 0 };
    for (const p of this.players.values()) {
      if (p.isAlive) {
        if (p.team === "team1") aliveByTeam.team1++;
        else if (p.team === "team2") aliveByTeam.team2++;
      }
    }
    const t1Alive = aliveByTeam.team1;
    const t2Alive = aliveByTeam.team2;
    let winner = null;
    if (t1Alive === 0 && t2Alive === 0) {
      // Simultaneous elimination -> draw (null winner)
      winner = null;
    } else if (t1Alive === 0) {
      winner = "team2";
    } else if (t2Alive === 0) {
      winner = "team1";
    }
    if (winner !== null || (t1Alive === 0 && t2Alive === 0)) {
      this._finishGame(winner, { t1Alive, t2Alive });
    }
  }

  /**
   * Finish game, update DB, broadcast game over, and cleanup loop.
   * @param {string|null} winnerTeam null means draw
   */
  async _finishGame(winnerTeam, meta = {}) {
    if (this.status === "finished") return; // idempotent
    this.status = "finished";
    console.log(
      `[GameRoom ${this.matchId}] Game finished. Winner: ${
        winnerTeam || "draw"
      }`,
    );
    // Stop loop
    this._loopRunning = false;
    if (this.gameLoop) {
      try {
        clearInterval(this.gameLoop);
      } catch (_) {}
      this.gameLoop = null;
    }
    // Persist match completion (best-effort)
    try {
      await this.db.runQuery(
        "UPDATE matches SET status = 'completed' WHERE match_id = ?",
        [this.matchId],
      );
    } catch (e) {
      console.warn(
        `[GameRoom ${this.matchId}] failed to update match status`,
        e?.message,
      );
    }
    let rewardSummary = [];
    try {
      rewardSummary = await this._distributeMatchRewards(winnerTeam);
    } catch (e) {
      console.warn(
        `[GameRoom ${this.matchId}] reward distribution failed`,
        e?.message,
      );
    }

    const finalMeta = { ...(meta || {}), rewards: rewardSummary };

    // Broadcast game over event to clients
    this.io.to(`game:${this.matchId}`).emit("game:over", {
      matchId: this.matchId,
      winnerTeam: winnerTeam, // may be null for draw
      meta: finalMeta,
    });
    // Optional: schedule room cleanup later (allow clients to show UI)
    setTimeout(() => {
      try {
        this.cleanup();
      } catch (_) {}
    }, 15000); // 15s grace
  }

  _ensureRewardBucket(playerData) {
    if (!playerData || !playerData.name) return null;
    if (!this.rewardStats) this.rewardStats = new Map();
    let bucket = this.rewardStats.get(playerData.name);
    if (!bucket) {
      bucket = {
        username: playerData.name,
        userId: playerData.user_id,
        team: playerData.team,
        hits: 0,
        damage: 0,
        kills: 0,
      };
      this.rewardStats.set(playerData.name, bucket);
    } else {
      bucket.userId = playerData.user_id;
      bucket.team = playerData.team;
    }
    return bucket;
  }

  _recordCombatStat(playerData, delta = {}) {
    const bucket = this._ensureRewardBucket(playerData);
    if (!bucket) return;
    if (delta.hits) bucket.hits += Math.max(0, delta.hits);
    if (delta.damage) bucket.damage += Math.max(0, Math.round(delta.damage));
    if (delta.kills) bucket.kills += Math.max(0, delta.kills);
  }

  async _distributeMatchRewards(winnerTeam) {
    if (!this.rewardStats) this.rewardStats = new Map();
    const summary = [];
    const updates = [];

    for (const playerData of this.players.values()) {
      const bucket = this._ensureRewardBucket(playerData) || {
        username: playerData.name,
        team: playerData.team,
        hits: 0,
        damage: 0,
        kills: 0,
      };
      const reward = this._calculateRewards(
        bucket,
        winnerTeam,
        playerData.team,
      );
      summary.push({
        username: bucket.username,
        team: bucket.team,
        hits: bucket.hits,
        damage: bucket.damage,
        kills: bucket.kills,
        coinsAwarded: reward.coins,
        gemsAwarded: reward.gems,
      });
      if ((reward.coins > 0 || reward.gems > 0) && playerData.user_id) {
        updates.push(
          this.db
            .runQuery(
              "UPDATE users SET coins = coins + ?, gems = gems + ? WHERE user_id = ?",
              [reward.coins, reward.gems, playerData.user_id],
            )
            .catch((e) => {
              console.warn(
                `[GameRoom ${this.matchId}] Failed to update rewards for ${playerData.name}`,
                e?.message,
              );
            }),
        );
      }
    }

    if (updates.length) {
      await Promise.all(updates);
    }

    return summary;
  }

  _calculateRewards(bucket, winnerTeam, playerTeam) {
    const hits = bucket?.hits || 0;
    const damage = bucket?.damage || 0;
    const kills = bucket?.kills || 0;
    const isWinner = winnerTeam && playerTeam && winnerTeam === playerTeam;

    const baseCoins = 40;
    const coinFromHits = hits * 3;
    const coinFromDamage = Math.floor(damage / 150);
    const coinFromKills = kills * 30;
    const winBonus = winnerTeam == null ? 10 : isWinner ? 40 : 15;
    let coins =
      baseCoins + coinFromHits + coinFromDamage + coinFromKills + winBonus;
    let gems = 0;
    if (isWinner) gems += 20;
    if (kills >= 1) gems += 10;
    if (kills >= 2) gems += 30;
    if (damage >= 10000) gems += 20;
    if (damage >= 15000) gems += 15;

    const overrides = (() => {
      try {
        if (
          this.runtimeConfig &&
          typeof this.runtimeConfig.get === "function"
        ) {
          return this.runtimeConfig.get() || {};
        }
        return this.runtimeConfig || {};
      } catch (_) {
        return {};
      }
    })();
    const rewardMultipliers = overrides?.rewardMultipliers || {};
    const coinMultiplier = Number(rewardMultipliers.coins) || 1;
    const gemMultiplier = Number(rewardMultipliers.gems) || 1;
    if (Number.isFinite(coinMultiplier) && coinMultiplier > 0) {
      coins *= coinMultiplier;
    }
    if (Number.isFinite(gemMultiplier) && gemMultiplier > 0) {
      gems *= gemMultiplier;
    }

    const minCoins = Number(overrides?.rewardFloor) || 5;
    const maxCoins = Number(overrides?.rewardCeiling) || 500;
    coins = Math.max(minCoins, Math.min(maxCoins, Math.round(coins)));

    return { coins, gems };
  }
}

module.exports = { GameRoom };
