const test = require('node:test');
const assert = require('node:assert/strict');
const input = require('../src/server/core/gameRoom/inputManager');
const { publishedMotion, MAX_PLAYOUT_MS } = require('../src/server/core/gameRoom/humanPlayout');
const { getHistoricalPosition } = require('../src/shared/combat/runtime/combatValidation.js');
const movement = require('../src/shared/physics/movementPhysics.json');
const WORLD = require('../src/shared/maps/arenas').arenaFor('duels-1v1').world;

// A human running right at full speed. Its client sends a packet every
// `sendEveryMs` (stamped with its own clock, 5 s off the server's) that
// reaches the server after 30 ms plus `jitter(i)`. Snapshots publish every
// 33.3 ms. Returns the x each snapshot published.
function run(t, { sendEveryMs = 25, jitter = () => 0, timestamps = true, durationMs = 3000 } = {}) {
  let now = 200000;
  t.mock.method(Date, 'now', () => now);
  const speed = movement.maxSpeed;
  const player = { socketId: 'p', name: 'P', char_class: 'ninja', x: 0, y: 0, vx: 0, vy: 0, isAlive: true, connected: true };
  const room = { players: new Map([['p', player]]), geometry: { colliders: [], world: WORLD }, io: { to: () => ({ emit() {} }) } };
  input.resetMovementBudget(player, now);
  const start = now;
  const packets = [];
  for (let sent = 0, i = 0; sent < durationMs; sent += sendEveryMs, i++) {
    packets.push({ arrive: start + sent + 30 + jitter(i), data: {
      x: speed * sent / 1000, y: 0, vx: speed, vy: 0, sequence: i,
      ...(timestamps ? { timestamp: Math.round(start + sent + 5000) } : {}),
    } });
  }
  packets.sort((a, b) => a.arrive - b.arrive);
  const published = [];
  let next = 0;
  for (let at = start + 1000 / 30; at < start + durationMs; at += 1000 / 30) {
    while (next < packets.length && packets[next].arrive <= at) {
      now = packets[next].arrive;
      input.handlePlayerInput(room, 'p', packets[next++].data);
    }
    now = at;
    published.push({ at, x: publishedMotion(player, at).x });
  }
  return { player, room, published, speed, setNow: v => { now = v; } };
}

// Spread of the distance moved between consecutive snapshots, after the
// playout delay has settled.
function stepSpread(published) {
  const steps = published.slice(45).map((p, i, all) => i ? p.x - all[i - 1].x : null).slice(1);
  return Math.max(...steps) - Math.min(...steps);
}

test('a steady runner is published moving evenly, whatever its packet rate or network jitter', t => {
  const expected = movement.maxSpeed / 30;
  for (const sendEveryMs of [1000 / 60, 25, 1000 / 30]) {
    let seed = 7;
    const jitter = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 12;
    const { published } = run(t, { sendEveryMs, jitter });
    const steps = published.slice(46).map((p, i) => p.x - published[45 + i].x);
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    assert.ok(Math.abs(mean - expected) < 0.2, `${sendEveryMs} ms packets: mean step ${mean}`);
    assert.ok(stepSpread(published) < expected * 0.35, `${sendEveryMs} ms packets: spread ${stepSpread(published)}`);
  }
});

test('without send times the latest packet is published, as before', t => {
  const { published, player } = run(t, { timestamps: false });
  assert.equal(published[published.length - 1].x, player.x);
  // 25 ms packets against 33 ms snapshots: uneven steps.
  assert.ok(stepSpread(published) > movement.maxSpeed / 30 * 0.5);
});

test('rewinds find the position snapshots published at that time', t => {
  const { published, player } = run(t, { jitter: i => (i % 3) * 4 });
  for (const { at, x } of published.slice(-20, -2)) {
    assert.ok(Math.abs(getHistoricalPosition(player, at).x - x) < 0.75, `at ${at}: history ${getHistoricalPosition(player, at).x} vs published ${x}`);
  }
});

test('the playout delay stays bounded and a server-side move publishes at once', t => {
  // A connection whose packets bunch up badly.
  const { player, published } = run(t, { jitter: i => (i % 4 === 0 ? 150 : 0) });
  const last = published[published.length - 1];
  assert.ok(player.x - last.x <= movement.maxSpeed * (MAX_PLAYOUT_MS + 40) / 1000 + 1);
  // A hook pull or respawn moves the player on the server.
  player.x = 4000;
  assert.equal(publishedMotion(player, last.at + 33).x, 4000);
  input.resetMovementBudget(player, last.at + 40);
  assert.equal(publishedMotion(player, last.at + 66).x, 4000);
});
