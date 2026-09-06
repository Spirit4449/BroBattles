#!/usr/bin/env node
// Seeded authoritative gameplay/performance smoke run; no SQL or browser needed.
const { makeRoom } = require('../tests/helpers/botRoom');
const { createRandom } = require('../src/server/core/bots/random');
const { getModifiers } = require('../src/server/core/gameRoom/effects/effectManager');
const { isMovementSuppressed } = require('../src/server/core/gameRoom/abilityRuntimeManager');
const { broadcastSnapshot } = require('../src/server/core/gameRoom/roomStateManager');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const seconds = Math.max(1, Math.min(300, Number(args.seconds) || 30));
const matrix = Object.hasOwn(args, 'matrix');
const suddenDeath = Object.hasOwn(args, 'sudden-death');
const maps = args.map ? [Number(args.map)] : [1, 2, 3];
const seeds = args.seed ? [Number(args.seed)] : matrix ? [17, 41, 73] : [17];
const counts = args.players ? [Math.max(2, Math.min(6, Math.round(Number(args.players) / 2) * 2))] : matrix ? [2, 4, 6] : [6];
const ratings = args.trophies != null ? [Number(args.trophies)] : matrix ? [0, 2000, 4000] : [2000];
const kits = ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'];
const originalNow = Date.now, originalLog = console.log;
let clock = 1000000;
Date.now = () => clock; console.log = () => {};
const results = [];
try {
  for (const map of maps) for (const players of counts) for (const trophies of ratings) for (const [seedIndex, seed] of seeds.entries()) {
    // Rotate the roster so the 1v1 matrix includes every character, too.
    clock = 1000000;
    const characters = args.characters ? args.characters.split(',') : Array.from({ length: players }, (_, i) => kits[(i + seedIndex * 2) % kits.length]);
    const h = makeRoom({ map, seed, trophies, characters });
    try {
      if (suddenDeath) h.room._loopStartWallTime = clock - h.room.gameMode.getMatchDurationMs() - Math.max(0, Number(args['sudden-death']) || 0) * 1000;
      h.room._powerupRandom = createRandom(seed);
      h.room._lastPowerupSpawnAt = clock;
      for (let i = 0; i < 3; i++) h.room._spawnPowerup();
      let packets = 0, bytes = 0;
      h.room.io.to = () => ({ emit(type, payload) { packets++; bytes += Buffer.byteLength(JSON.stringify({ type, payload })); }, compress() { return this; } });
      const samples = [], start = performance.now();
      const activity = h.players.map(() => ({ aliveMs: 0, distanceMoved: 0, modes: {}, blockedMs: 0, longestBlockedMs: 0 }));
      for (let i = 0; i < seconds * 60; i++) {
        clock += 1000 / 60;
        const positions = h.players.map((p) => ({ x: p.x, y: p.y, alive: p.isAlive }));
        const tickStart = performance.now();
        if (suddenDeath) h.room._tickTimerAndSuddenDeath();
        h.tick(clock);
        h.room._tickPowerups();
        if (i % 2 === 0) broadcastSnapshot(h.room);
        samples.push(performance.now() - tickStart);
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
      samples.sort((a, b) => a - b);
      results.push({ map, seed, players, trophies, characters, suddenDeath, simulatedSeconds: seconds, elapsedMs: Math.round(performance.now() - start),
        p95TickMs: +samples[Math.floor(samples.length * 0.95)].toFixed(3), maxTickMs: +samples.at(-1).toFixed(3), packets, bytes,
        bots: h.players.map((p, i) => ({ character: p.char_class, alive: p.isAlive, health: p.health, damage: h.room.rewardStats.get(p.name)?.damage || 0,
          x: Math.round(p.x), y: Math.round(p.y), teamPlan: h.room.botControllers.get(p.participantId).teamPlan,
          ...h.room.botControllers.get(p.participantId).metrics, ...activity[i] })) });
    } finally { h.room.cleanup(); }
  }
} finally { Date.now = originalNow; console.log = originalLog; }
console.log(JSON.stringify(results, null, 2));
