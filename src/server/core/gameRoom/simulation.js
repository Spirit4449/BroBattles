const characterCombat = require("../../../shared/combat/runtime/characterCombatRegistry.js");
const { BOT_PLANNING_STEP_MS, BOT_PLANNING_FRAME_MS } = require("../../../shared/combat/matchConfig.js");
const inputManager = require("./inputManager");
const { netTrace } = require("./netTraceRecorder");
const attackRuntimeManager = require("../../../shared/combat/runtime/attackRuntimeManager.js");
const { tickActiveAbilities } = require("../../../shared/combat/runtime/abilityRuntimeManager.js");
const { tickMovingPlatforms } = require("./movingPlatforms");

class BotControllers extends Map {
  inTickOrder() {
    return (this.order ||= Array.from(this.values()));
  }

  set(id, controller) {
    this.order = null;
    return super.set(id, controller);
  }

  delete(id) {
    this.order = null;
    return super.delete(id);
  }

  clear() {
    this.order = null;
    super.clear();
  }
}

function startGameLoop(room) {
  if (room._loopRunning || room._disposed || room.status !== "active") return;
  if (!room._netTestEnabled) {
    console.log(`[GameRoom ${room.matchId}] Fixed-step loop started`);
  }
  room._loopRunning = true;
  room.loopStartWallTime = Date.now();
  room.suddenDeathActive = false;
  room._lastTimerEmitMs = 0;
  room.powerups.clear();
  room._nextPowerupId = 1;
  room._lastPowerupSpawnAt = room.loopStartWallTime;
  room._powerupSpawnBag = [];
  room._powerupTypeBag = [];
  room._recentPowerupSpawnKeys = [];
  room._lastPowerupType = null;
  room._lastPowerupTypeBySpawnKey = Object.create(null);
  room.deathDrops.clear();
  room._nextDeathDropId = 1;
  room._startingPowerupsPending = true;
  const monoNow = () => performance.now();
  let lastMono = monoNow();
  let simulatedMono = lastMono;
  let acc = 0;
  let snapshotDue = false;
  let worldStateDue = false;

  const runMode = () => {
    try {
      room.gameMode?.tick?.(Date.now());
    } catch (e) {
      console.warn(
        `[GameRoom ${room.matchId}] mode tick failed:`,
        e?.message,
      );
    }
  };
  const platformsPhase = ['platforms', mono => tickMovingPlatforms(room, mono)];
  const modePhase = ['mode', runMode];
  const pausedPhases = [platformsPhase, modePhase];
  const phases = [
    platformsPhase,
    ['tick', () => room.processTick()],
    ['attacks', () => attackRuntimeManager.tickActiveAttacks(room, Date.now())],
    ['combat', () => characterCombat.tick(room)],
    ['items', () => {
      room._tickPowerupEffects();
      room.processRegen();
      room._tickTimerAndSuddenDeath();
      room._tickPowerups();
      room._tickDeathDrops();
    }],
    modePhase,
  ];
  const step = (currentMono) => {
    room.simulationMono = currentMono;
    room.tickId++;
    const timings = room.netTrace ? {} : null;
    let previous = timings ? performance.now() : 0;
    const started = previous;
    const activePhases = room.gameMode?.isCombatPaused?.() ? pausedPhases : phases;
    for (const [phase, run] of activePhases) {
      run(currentMono);
      if (timings) {
        const end = performance.now();
        timings[phase] = end - previous;
        previous = end;
      }
    }
    if (timings) netTrace.notePhases(room, timings, previous - started);
    // Snapshot cadence: deterministic every N ticks
    if (room.tickId % room.SNAPSHOT_EVERY_TICKS === 0) {
      if (room.COALESCE_SNAPSHOTS) snapshotDue = true;
      else room._emitSnapshotWithTiming(currentMono);
    }
    if (room.tickId % room.WORLD_STATE_EVERY_TICKS === 0) {
      if (room.COALESCE_SNAPSHOTS) worldStateDue = true;
      else room.broadcastWorldState();
    }
  };

  const loop = () => {
    if (!room._loopRunning) return;
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
    // Catch-up steps share one planning allowance (see BOT_PLANNING_FRAME_MS).
    room._botFrameBudgetUntil = performance.now() + BOT_PLANNING_FRAME_MS;
    while (acc >= room.FIXED_DT_MS && room._loopRunning) {
      simulatedMono += room.FIXED_DT_MS;
      step(simulatedMono);
      acc -= room.FIXED_DT_MS;
      stepsThisFrame += 1;
    }
    // Publish the final state, not every intermediate catch-up state. Immediate
    // respawn/action snapshots and discrete events retain their existing order.
    if (room._loopRunning) {
      const publishStart = room.netTrace ? performance.now() : 0;
      if (snapshotDue) room._emitSnapshotWithTiming(simulatedMono);
      if (worldStateDue) room.broadcastWorldState();
      if (room.netTrace && (snapshotDue || worldStateDue)) netTrace.notePhases(room, { publish: performance.now() - publishStart }, 0);
    }
    // Yield a bit to avoid busy-spinning the CPU.
    // Sleep roughly until the next tick is due (at least 0–1ms).
    let sleepMs = 0;
    if (acc < room.FIXED_DT_MS) {
      sleepMs = Math.max(0, Math.floor(room.FIXED_DT_MS - acc));
      // Ensure we yield to the event loop at least briefly
      if (sleepMs === 0) sleepMs = 1;
    }
    room._timingDiagnostics?.noteLoopFrame({
      nowMono,
      deltaMs: rawDelta,
      stepsThisFrame,
      sleepMs,
      accBefore,
      accAfter: acc,
    });
    if (room.netTrace) netTrace.noteLoopFrame(room, { deltaMs: rawDelta, stepsThisFrame, sleepMs });
    if (room._loopRunning) setTimeout(loop, sleepMs);
  };
  setTimeout(loop, 0);
}

function processTick(room) {
  const now = Date.now();
  room.botNow = now;
  // Most ticks have nothing scheduled; only rebuild the queue when needed.
  if (room._scheduledActions.some(action => action.at <= now)) {
    const due = room._scheduledActions.filter((a) => a.at <= now);
    room._scheduledActions = room._scheduledActions.filter((a) => a.at > now);
    for (const action of due) if (room.status === 'active') action.callback();
  }
  tickActiveAbilities(room, now);
  const botStart = performance.now();
  // A shared planning allowance leaves time for physics and human inputs.
  // Rotate first access so crowded rooms cannot starve their last bot.
  const controllers = room.botControllers.inTickOrder();
  const first = (room._botPlanningCursor || 0) % (controllers.length || 1);
  room._botPlanningCursor = first + 1;
  room.botPlanningDeadline = Math.min(botStart + BOT_PLANNING_STEP_MS, room._botFrameBudgetUntil ?? Infinity);
  if (room.netTrace) {
    for (let i = 0; i < controllers.length; i++) {
      const controller = controllers[(first + i) % controllers.length];
      const started = performance.now();
      controller.tick(room.FIXED_DT_MS, now);
      netTrace.noteBotTick(room, controller, performance.now() - started);
    }
  } else {
    for (let i = 0; i < controllers.length; i++) controllers[(first + i) % controllers.length].tick(room.FIXED_DT_MS, now);
  }
  if (controllers.length) {
    const elapsed = performance.now() - botStart;
    const stats = room._botTickStats ||= { ticks: 0, totalMs: 0, maxMs: 0 };
    stats.ticks++; stats.totalMs += elapsed; stats.maxMs = Math.max(stats.maxMs, elapsed);
  }

  inputManager.stepIdleHumans(room, room.FIXED_DT_MS, now);

  // Humans record history when their position packets are accepted; bots
  // move every simulation step, so their history is sampled here.
  for (const playerData of room.players.values()) {
    if (playerData.isBot) inputManager.recordBotHistory(playerData, now);
  }
}

module.exports = { BotControllers, startGameLoop, processTick };
