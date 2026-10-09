const test = require('node:test');
const assert = require('node:assert/strict');
const input = require('../src/server/core/gameRoom/inputManager');
const { characterBody } = require('../src/shared/physics/duelGeometry');
const { createMovementCorrector } = require('../src/client/game/players/movementCorrection');
const WORLD = require('../src/shared/maps/arenas').arenaFor('duels-1v1').world;
const physics = require('../src/shared/physics/movementPhysics.json');

function server(t) {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const player = { socketId: 'p', name: 'Player', char_class: 'ninja', x: 0, y: 0,
    isAlive: true, connected: true, lastInput: now };
  const events = [];
  const room = { players: new Map([['p', player]]), geometry: { colliders: [], world: WORLD },
    io: { to: () => ({ emit: (name, data) => events.push({ name, data }) }) } };
  input.resetMovementBudget(player, now);
  const corrections = () => events.filter(e => e.name === 'game:correction').map(e => e.data);
  return { player, room, events, corrections, advance: ms => { now += ms; },
    send: data => input.handlePlayerInput(room, 'p', data) };
}

test('server allows the full horizontal dash burst but repeated packets cannot grant it twice', t => {
  const f = server(t);
  f.player._movementBudget.x = 0;
  const distance = physics.dashHorizontalSpeed * physics.dashDurationMs / 1000;
  f.send({ x: distance, y: 0, vx: physics.dashHorizontalSpeed, sequence: 1,
    dashSeq: 1, dashX: 1, dashY: 0 });
  assert.equal(f.player.x, distance);
  assert.equal(f.player.vx, physics.dashHorizontalSpeed);
  assert.equal(f.corrections().length, 0);
  f.send({ x: distance * 2, y: 0, sequence: 2, dashSeq: 1, dashX: 1, dashY: 0 });
  assert.equal(f.player.x, distance);
  assert.equal(f.corrections().length, 1);
  assert.equal(f.corrections()[0].reason, 'budget');
});

test('packets already in flight when a correction is issued do not cascade into more corrections', t => {
  const f = server(t);
  f.advance(20);
  f.send({ x: 600, y: 0, sequence: 1, correctionAck: 0 });
  assert.equal(f.corrections().length, 1);
  const { correctionId, x } = f.corrections()[0];
  assert.equal(correctionId, 1);
  // The client kept running along the rejected path until the correction arrived.
  for (let seq = 2; seq <= 5; seq++) {
    f.advance(20);
    f.send({ x: 600 + seq * 6, y: 0, sequence: seq, correctionAck: 0 });
  }
  assert.equal(f.corrections().length, 1);
  assert.equal(f.player.x, x);
  assert.equal(f.player._movementStats.staleDropped, 4);
  // Once acknowledged, the corrected path is accepted normally.
  f.advance(20);
  f.send({ x: x + 6, y: 0, sequence: 6, correctionAck: 1 });
  assert.equal(f.corrections().length, 1);
  assert.equal(f.player.x, x + 6);
});

test('a client that never acknowledges is not frozen past the timeout', t => {
  const f = server(t);
  f.advance(20);
  f.send({ x: 600, y: 0, sequence: 1, correctionAck: 0 });
  const x = f.player.x;
  f.advance(input.CORRECTION_ACK_TIMEOUT_MS);
  f.send({ x: x + 10, y: 0, sequence: 2, correctionAck: 0 });
  assert.equal(f.player.x, x + 10);
});

test('untagged packets from older clients are always processed', t => {
  const f = server(t);
  f.advance(20);
  f.send({ x: 600, y: 0, sequence: 1 });
  const x = f.player.x;
  f.advance(20);
  f.send({ x: x + 6, y: 0, sequence: 2 });
  assert.equal(f.player.x, x + 6);
});

test('repeated clamps never freeze movement input', t => {
  const f = server(t);
  for (let seq = 1; seq <= 12; seq++) {
    f.advance(20);
    f.send({ x: f.player.x + 400, y: 0, sequence: seq, correctionAck: seq - 1 });
  }
  assert.equal(f.corrections().length, 12);
  const x = f.player.x;
  f.advance(20);
  f.send({ x: x + 5, y: 0, sequence: 13, correctionAck: 12 });
  assert.equal(f.player.x, x + 5);
  assert.equal(f.player._movementStats.budget, 12);
});

test('server stores the reported position even when it trails the previous one', t => {
  const f = server(t);
  f.advance(20);
  f.send({ x: 6, y: 0, vx: 260, sequence: 1 });
  f.advance(20);
  f.send({ x: 2, y: 0, vx: 200, sequence: 2 });
  assert.equal(f.player.x, 2);
  assert.equal(f.player.vx, 200);
});

test('respawn teleports supersede an unacknowledged correction', t => {
  const f = server(t);
  f.advance(20);
  f.send({ x: 600, y: 0, sequence: 1, correctionAck: 0 });
  f.player.x = 50;
  input.resetMovementBudget(f.player, Date.now());
  f.advance(20);
  f.send({ x: 55, y: 0, sequence: 2, correctionAck: 0 });
  assert.equal(f.player.x, 55);
});

test('dash contact disagreements within 2px are clamped silently; deeper penetration corrects', t => {
  for (const [depth, expected] of [[1.5, 0], [6, 1]]) {
    const f = server(t);
    const shape = characterBody('ninja');
    const wallLeft = 50;
    f.room.geometry = { colliders: [{ left: wallLeft, right: 52, top: -500, bottom: 500 }], world: WORLD };
    // Player standing flush against the wall's left face during dash coast.
    f.player.x = wallLeft - shape.offsetX - shape.halfWidth;
    f.player._dashUntil = Date.now();
    f.advance(20);
    f.send({ x: f.player.x + depth, y: 0, vx: 300, sequence: 1 });
    assert.equal(f.corrections().length, expected, `depth ${depth}`);
    assert.ok(f.player.x + shape.offsetX + shape.halfWidth <= wallLeft + 1e-6);
  }
});

function fakePlayer(x = 0, y = 0) {
  const player = { x, y };
  player.body = {
    velocity: { x: 0, y: 0 }, acceleration: { x: 0, y: 0 },
    reset(nx, ny) { player.x = nx; player.y = ny; this.velocity = { x: 0, y: 0 }; this.acceleration = { x: 0, y: 0 }; },
    setVelocity(vx, vy) { this.velocity = { x: vx, y: vy }; },
    setAcceleration(ax, ay) { this.acceleration = { x: ax, y: ay }; },
  };
  return player;
}

test('client shifts by the error at the corrected packet instead of rewinding to it, keeping velocity', () => {
  const c = createMovementCorrector();
  const p = fakePlayer(100, 0);
  p.body.velocity = { x: 260, y: 0 };
  c.recordSent(7, 100, 0);
  p.x = 130; // moved on during the round trip
  assert.equal(c.apply(p, { x: 90, y: 0, sequence: 7, correctionId: 1, reason: 'budget' }), true);
  for (let i = 0; i < 60; i++) c.update(p, 16.67);
  assert.ok(Math.abs(p.x - 120) < 1e-9, `x=${p.x}`);
  assert.equal(p.body.velocity.x, 260);
  assert.equal(c.getAck(), 1);
});

test('client blends small corrections across frames instead of snapping', () => {
  const c = createMovementCorrector();
  const p = fakePlayer(0, 0);
  c.recordSent(1, 0, 0);
  c.apply(p, { x: -20, y: 0, sequence: 1, correctionId: 1 });
  assert.equal(p.x, 0);
  c.update(p, 16.67);
  assert.ok(p.x < 0 && p.x > -10, `first frame moved ${p.x}`);
  for (let i = 0; i < 30; i++) c.update(p, 16.67);
  assert.ok(Math.abs(p.x + 20) < 1e-9);
});

test('a newer correction replaces the remaining blend rather than adding to it', () => {
  const c = createMovementCorrector();
  const p = fakePlayer(0, 0);
  c.recordSent(1, 0, 0);
  c.apply(p, { x: -20, y: 0, sequence: 1, correctionId: 1 });
  c.update(p, 16.67);
  c.recordSent(2, p.x, 0);
  c.apply(p, { x: p.x, y: 0, sequence: 2, correctionId: 2 });
  const settled = p.x;
  for (let i = 0; i < 30; i++) c.update(p, 16.67);
  assert.equal(p.x, settled);
});

test('stale or duplicate correction ids are ignored', () => {
  const c = createMovementCorrector();
  const p = fakePlayer(0, 0);
  c.recordSent(1, 0, 0);
  c.apply(p, { x: 0.5, y: 0, sequence: 1, correctionId: 2 });
  assert.equal(c.apply(p, { x: -200, y: 0, sequence: 1, correctionId: 1 }), false);
  assert.equal(c.apply(p, { x: -200, y: 0, sequence: 1, correctionId: 2 }), false);
  assert.equal(c.getDiagnostics().ignoredStale, 2);
});

test('huge offsets snap immediately but keep velocity', () => {
  const c = createMovementCorrector();
  const p = fakePlayer(0, 0);
  p.body.velocity = { x: 100, y: -50 };
  c.recordSent(1, 0, 0);
  c.apply(p, { x: 500, y: 0, sequence: 1, correctionId: 1 });
  assert.equal(p.x, 500);
  assert.deepEqual(p.body.velocity, { x: 100, y: -50 });
});

test('collision corrections never pull a player back toward a wall they already left', () => {
  const c = createMovementCorrector();
  const p = fakePlayer(0, 0);
  p.body.velocity = { x: -200, y: 0 };
  c.recordSent(1, 56, 0);
  p.x = 30; // reversed away from the wall at x=50
  c.apply(p, { x: 50, y: 0, sequence: 1, correctionId: 1, reason: 'collision', contacts: { right: true } });
  assert.equal(p.x, 30);
  assert.equal(p.body.velocity.x, -200);
  c.recordSent(2, 58, 0);
  p.x = 60; p.body.velocity = { x: 200, y: 0 };
  c.apply(p, { x: 50, y: 0, sequence: 2, correctionId: 2, reason: 'collision', contacts: { right: true } });
  assert.equal(p.x, 50);
  assert.equal(p.body.velocity.x, 0);
});

test('corrections are acknowledged even while the local body is unavailable', () => {
  const c = createMovementCorrector();
  assert.equal(c.apply({ body: null }, { x: 1, y: 2, sequence: 1, correctionId: 3 }), false);
  assert.equal(c.getAck(), 3);
});
