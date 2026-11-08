#!/usr/bin/env node
// Seeded authoritative gameplay/performance smoke run; no SQL or browser needed.
//
//   node scripts/dev/simulate-bots.cjs [--map=4] [--players=6] [--seconds=30] [--seed=17]
//     [--characters=ninja,huntress] [--trophies=2000] [--matrix] [--sudden-death=10]
//     [--json] [--top=8] [--deterministic]
//
// Prints one timing summary per run (tick and per-bot cost on this machine,
// navigation builds, slowest bot ticks); --json prints the full result objects.
// Bot constructors build their default graphs before the timed loop, as on a
// live server whose navigation cache already holds this map. Builds inside the
// loop (buff modifiers, Bank Bust walls) run synchronously here, where the live
// server uses a worker; their ticks are listed but left out of "slow".
// Run it with `node --cpu-prof` and summarize with cpuprofile-top.cjs.
// --deterministic finishes every plan in the tick it starts instead of slicing
// it by wall-clock budget, so play is identical on any machine and a "play"
// fingerprint that matches before/after a change shows behavior is unchanged.
const navigation = require('../../src/server/core/bots/navigation');
// Count and time graph builds. Patched before anything destructures buildGraph.
const navBuilds = [];
const originalBuildGraph = navigation.buildGraph;
navigation.buildGraph = function timedBuildGraph(...buildArgs) {
  const started = performance.now();
  const before = navBuilds.length;
  const graph = originalBuildGraph.apply(this, buildArgs);
  const ms = performance.now() - started;
  if (ms > 1 && navBuilds.length === before) navBuilds.push({ character: buildArgs[1], ms: Math.round(ms) });
  return graph;
};
const { makeRoom } = require('../../tests/helpers/botRoom');
const { createRandom } = require('../../src/server/core/bots/random');
const { BotController } = require('../../src/server/core/bots/controller');
const { getModifiers } = require('../../src/shared/combat/runtime/effects/effectManager.js');
const { isMovementSuppressed } = require('../../src/shared/combat/runtime/abilityRuntimeManager.js');
const { broadcastSnapshot } = require('../../src/server/core/gameRoom/roomStateManager');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const seconds = Math.max(1, Math.min(300, Number(args.seconds) || 30));
const matrix = Object.hasOwn(args, 'matrix');
const suddenDeath = Object.hasOwn(args, 'sudden-death');
const maps = args.map ? [Number(args.map)] : [1, 2, 3];
const seeds = args.seed ? [Number(args.seed)] : matrix ? [17, 41, 73] : [17];
const counts = args.players ? [Math.max(2, Math.min(6, Math.round(Number(args.players) / 2) * 2))] : matrix ? [2, 4, 6] : [6];
const ratings = args.trophies != null ? [Number(args.trophies)] : matrix ? [0, 2000, 4000] : [2000];
const topN = Math.max(0, Number(args.top ?? 6));
const deterministic = Object.hasOwn(args, 'deterministic');
if (deterministic) {
  BotController.prototype.advancePlanning = function finishPlanning(now) {
    const plan = this.planning;
    if (!plan) return;
    if (now - plan.at > 500 || this.player.lastDamagedAt !== plan.damageAt) { this.planning = null; this.nextThink = 0; return; }
    for (;;) if (plan.steps.next().done) { this.planning = null; break; }
  };
}
const kits = ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'];
const originalNow = Date.now, originalLog = console.log;
let clock = 1000000;

// Per-bot tick timing, attributed to whatever the bot was doing.
let botTicks = null;
const originalTick = BotController.prototype.tick;
BotController.prototype.tick = function timedTick(...tickArgs) {
  if (!botTicks) return originalTick.apply(this, tickArgs);
  const started = performance.now();
  const builds = navBuilds.length;
  const planning = !!this.planning;
  originalTick.apply(this, tickArgs);
  const ms = performance.now() - started;
  botTicks.push({ ms, character: this.player.char_class, name: this.player.name, planning,
    built: navBuilds.length > builds, mode: this.decision?.mode || null,
    objective: this.objective?.type || this.objective?.kind || null,
    travel: this.traversal ? 'traversal' : this.maneuver ? 'maneuver' : this.approachEdge ? 'approach' : null });
};

const q = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;
const r2 = (x) => Math.round(x * 100) / 100;

Date.now = () => clock; console.log = () => {};
const results = [];
try {
  for (const map of maps) for (const players of counts) for (const trophies of ratings) for (const [seedIndex, seed] of seeds.entries()) {
    // Rotate the roster so the 1v1 matrix includes every character, too.
    clock = 1000000;
    const characters = args.characters ? args.characters.split(',') : Array.from({ length: players }, (_, i) => kits[(i + seedIndex * 2) % kits.length]);
    const h = makeRoom({ map, seed, trophies, characters });
    navBuilds.length = 0;
    try {
      if (suddenDeath) h.room._loopStartWallTime = clock - h.room.gameMode.getMatchDurationMs() - Math.max(0, Number(args['sudden-death']) || 0) * 1000;
      h.room._powerupRandom = createRandom(seed);
      h.room._lastPowerupSpawnAt = clock;
      for (let i = 0; i < 3; i++) h.room._spawnPowerup();
      let packets = 0, bytes = 0;
      h.room.io.to = () => ({ emit(type, payload) { packets++; bytes += Buffer.byteLength(JSON.stringify({ type, payload })); }, compress() { return this; } });
      const samples = [], start = performance.now();
      botTicks = [];
      const perTickBots = [];
      const activity = h.players.map(() => ({ aliveMs: 0, distanceMoved: 0, modes: {}, blockedMs: 0, longestBlockedMs: 0 }));
      for (let i = 0; i < seconds * 60; i++) {
        clock += 1000 / 60;
        const positions = h.players.map((p) => ({ x: p.x, y: p.y, alive: p.isAlive }));
        const tickStart = performance.now();
        const botBefore = botTicks.length;
        if (suddenDeath) h.room._tickTimerAndSuddenDeath();
        h.tick(clock);
        h.room._tickPowerups();
        h.room.gameMode?.tick?.(clock);
        if (i % 2 === 0) broadcastSnapshot(h.room);
        samples.push(performance.now() - tickStart);
        perTickBots.push(botTicks.slice(botBefore).reduce((n, t) => n + t.ms, 0));
        h.players.forEach((p, index) => {
          if (!positions[index].alive) return;
          const brain = h.room.botControllers.get(p.participantId), a = activity[index];
          a.aliveMs += 1000 / 60;
          a.distanceMoved += Math.hypot(p.x - positions[index].x, p.y - positions[index].y);
          const mode = brain.decision?.mode || 'opening';
          a.modes[mode] = (a.modes[mode] || 0) + 1000 / 60;
          a.blockedMs = getModifiers(p, clock).speedMult > 0 && !(p._controlLockUntil > clock) && !isMovementSuppressed(p, clock) && brain.wantsProgress && p.grounded && Math.abs(p.vx) < 12 && clock >= brain.idleUntil
            ? a.blockedMs + 1000 / 60 : 0;
          a.longestBlockedMs = Math.max(a.longestBlockedMs, a.blockedMs);
        });
      }
      const ticks = botTicks; botTicks = null;
      const sorted = samples.slice().sort((a, b) => a - b);
      const botSorted = perTickBots.slice().sort((a, b) => a - b);
      const byBot = {};
      for (const t of ticks) {
        const b = byBot[t.name] ||= { character: t.character, n: 0, totalMs: 0, maxMs: 0, over4: 0, all: [] };
        b.n++; b.totalMs += t.ms; b.maxMs = Math.max(b.maxMs, t.ms); if (t.ms > 4) b.over4++; b.all.push(t.ms);
      }
      for (const b of Object.values(byBot)) { b.all.sort((x, y) => x - y); b.p99 = r2(q(b.all, 0.99)); delete b.all; b.totalMs = r2(b.totalMs); b.maxMs = r2(b.maxMs); }
      const slowest = ticks.filter(t => !t.built).sort((a, b) => b.ms - a.ms).slice(0, topN)
        .map(t => ({ ...t, ms: r2(t.ms) }));
      results.push({ map, seed, players, trophies, characters, suddenDeath, simulatedSeconds: seconds, elapsedMs: Math.round(performance.now() - start),
        p50TickMs: r2(q(sorted, 0.5)), p95TickMs: r2(q(sorted, 0.95)), p99TickMs: r2(q(sorted, 0.99)), maxTickMs: r2(sorted.at(-1)),
        ticksOver8: samples.filter(x => x > 8).length, ticksOver16: samples.filter(x => x > 16).length, ticksOver50: samples.filter(x => x > 50).length,
        botMsPerSecond: r2(perTickBots.reduce((n, x) => n + x, 0) / seconds),
        botMsPerSecondNoBuild: r2(ticks.filter(t => !t.built).reduce((n, t) => n + t.ms, 0) / seconds),
        navBuildMs: navBuilds.reduce((n, b) => n + b.ms, 0), botTickP99: r2(q(botSorted, 0.99)), botTickMax: r2(botSorted.at(-1)),
        navBuilds: navBuilds.slice(), byBot, slowest, packets, bytes,
        bots: h.players.map((p, i) => ({ character: p.char_class, alive: p.isAlive, health: p.health, damage: h.room.rewardStats.get(p.name)?.damage || 0,
          x: Math.round(p.x), y: Math.round(p.y), teamPlan: h.room.botControllers.get(p.participantId).teamPlan,
          ...h.room.botControllers.get(p.participantId).metrics, ...activity[i] })) });
    } finally { h.room.cleanup(); }
  }
} finally { Date.now = originalNow; console.log = originalLog; }
if (Object.hasOwn(args, 'json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`map ${r.map} seed ${r.seed} ${r.characters.join(',')} ${r.simulatedSeconds}s in ${r.elapsedMs}ms`);
    console.log(`  tick p50 ${r.p50TickMs} p95 ${r.p95TickMs} p99 ${r.p99TickMs} max ${r.maxTickMs}ms | >8ms ${r.ticksOver8} >16ms ${r.ticksOver16} >50ms ${r.ticksOver50}`);
    console.log(`  bots ${r.botMsPerSecond}ms/s (${r.botMsPerSecondNoBuild}ms/s outside graph builds), per-tick p99 ${r.botTickP99} max ${r.botTickMax}ms | nav builds ${r.navBuilds.length}${r.navBuilds.length ? ` (${r.navBuilds.map(b => `${b.character} ${b.ms}ms`).join(', ')})` : ''}`);
    console.log(`  per bot: ${Object.entries(r.byBot).map(([, b]) => `${b.character} ${b.totalMs}ms max ${b.maxMs} p99 ${b.p99} >4ms ${b.over4}`).join(' | ')}`);
    for (const t of r.slowest) console.log(`  slow ${t.ms}ms ${t.character} planning=${t.planning} mode=${t.mode} objective=${t.objective} travel=${t.travel}`);
    const dmg = r.bots.map(b => `${b.character}:${b.damage}`).join(' ');
    console.log(`  play: damage ${dmg} | attacks ${r.bots.reduce((n, b) => n + (b.attacks || 0), 0)} falls ${r.bots.reduce((n, b) => n + (b.falls || 0), 0)}` +
      ` | fingerprint ${require('node:crypto').createHash('sha1').update(JSON.stringify(r.bots.map(b => [b.x, b.y, b.health, b.damage, b.thinks, b.attacks, b.jumps]))).digest('hex').slice(0, 10)}`);
  }
}
