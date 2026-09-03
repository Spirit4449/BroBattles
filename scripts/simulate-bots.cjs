#!/usr/bin/env node
// Headless, seeded gameplay/performance smoke run; no SQL server or browser required.
const { makeRoom } = require('../tests/helpers/botRoom');
const { createRandom } = require('../src/server/core/bots/random');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const seconds = Math.max(1, Math.min(300, Number(args.seconds) || 30));
const seed = Number(args.seed) || 17;
const counts = Math.max(2, Math.min(6, Number(args.players) || 6));
const originalNow = Date.now, originalLog = console.log;
let clock = 1000000;
Date.now = () => clock; console.log = () => {};
const results = [];
try {
  for (const map of args.map ? [Number(args.map)] : [1, 2, 3]) {
    const h = makeRoom({ map, seed, trophies: Number(args.trophies) || 2000, characters: ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'].slice(0, counts) });
    h.room._powerupRandom = createRandom(seed);
    let packets = 0, bytes = 0;
    h.room.io.to = () => ({ emit(type, payload) { packets++; bytes += Buffer.byteLength(JSON.stringify({ type, payload })); }, compress() { return this; } });
    const samples = [], start = performance.now();
    const snapshot = require('../src/server/core/gameRoom/roomStateManager').broadcastSnapshot;
    for (let i = 0; i < seconds * 60; i++) {
      clock += 1000 / 60;
      const tickStart = performance.now();
      h.tick(clock);
      if (i % 2 === 0) snapshot(h.room);
      samples.push(performance.now() - tickStart);
    }
    samples.sort((a, b) => a - b);
    results.push({ map, seed, players: counts, simulatedSeconds: seconds, elapsedMs: Math.round(performance.now() - start),
      p95TickMs: +samples[Math.floor(samples.length * 0.95)].toFixed(3), maxTickMs: +samples.at(-1).toFixed(3), packets, bytes,
      bots: h.players.map((p) => ({ character: p.char_class, alive: p.isAlive, health: p.health, damage: h.room.rewardStats.get(p.name)?.damage || 0,
        x: Math.round(p.x), y: Math.round(p.y), ...h.room.botControllers.get(p.participantId).metrics })) });
    h.room.cleanup();
  }
} finally { Date.now = originalNow; console.log = originalLog; }
console.log(JSON.stringify(results, null, 2));
