const test = require('node:test');
const assert = require('node:assert/strict');
const { bounds, startDash, stepBody, applyImpulse } = require('../src/server/core/bots/physics');
const { previewDash, tryDashSteps } = require('../src/server/core/bots/dash');
const { standOn } = require('../src/server/core/bots/navigation');
const { incomingThreat, maneuverDanger } = require('../src/server/core/bots/perception');
const { finishSteps, preferredRange } = require('../src/server/core/bots/tactics');
const { requestBasic, requestSpecial } = require('../src/server/core/bots/combat');
const movement = require('../src/shared/movementPhysics.json');
const { makeRoom } = require('./helpers/botRoom');

const now = 1000000;
const floor = { id: 'floor', left: 0, right: 2200, top: 900, bottom: 940,
  collision: { up: true, down: true, left: true, right: true } };
const geometry = { world: { x: 0, y: 0, width: 2200, height: 1200 }, colliders: [floor] };
function player(x = 1000) {
  return { ...standOn(floor, 'ninja', x), isAlive: true, health: 100, maxHealth: 100, _botActionUntil: 0 };
}
function setup() {
  const p = player(), enemy = { ...player(1120), participantId: 'enemy', health: 100 };
  const brain = { player: p, room: { geometry }, profile: { dodgeChance: 0.8 }, spacing: 1,
    random: () => 0.1, between: (a, b) => (a + b) / 2, retreating: false,
    clearTravel() { this.maneuver = null; },
    metrics: { dashes: 0, dashEscapes: 0, dashChases: 0, dashDodges: 0 } };
  const observed = { at: now, enemies: [enemy], projectiles: [] };
  const context = { poisonAt: () => Infinity };
  const attempt = (at = now, mods = {}) => finishSteps(tryDashSteps(brain, observed, enemy,
    incomingThreat(observed, p, at), mods, context, at));
  return { p, enemy, brain, observed, context, attempt };
}

test('hurt bots dash away, replay the preview, and retain the shared cooldown and network activation', () => {
  const h = setup(); h.brain.retreating = true; h.p.health = 20;
  assert.equal(h.attempt(), true);
  assert.equal(h.p.dashX, -1);
  assert.equal(h.p.dashSeq, 1);
  assert.equal(h.p._dashReadyAt, now + movement.dashDurationMs + movement.dashCooldownMs);
  const maneuver = h.brain.maneuver;
  maneuver.frames.forEach((frame, i) => stepBody(h.p, frame, geometry, 1000 / 60, now + i * 1000 / 60));
  assert.equal(h.p.x, maneuver.end.x);
  assert.equal(h.p.y, maneuver.end.y);
  assert.ok(h.p.x < 850);
  assert.equal(h.p.grounded, true);
  assert.ok(h.brain.nextDashAt > h.p._dashReadyAt + 249);
  h.brain.maneuver = null;
  assert.equal(h.attempt(h.p._dashReadyAt), false);
});

test('bots close on low-health enemies outside their preferred range but save dash in ordinary fights', () => {
  const h = setup(); h.enemy.x = h.p.x + preferredRange(h.brain, h.enemy) + 190;
  assert.equal(h.attempt(), false);
  h.enemy.health = 25;
  assert.equal(h.attempt(), true);
  assert.equal(h.p.dashX, 1);
  assert.equal(h.brain.metrics.dashChases, 1);
  assert.ok(h.brain.maneuver.end.x > h.p.x + 100);
});

test('a dash dodge reduces predicted projectile danger and has a verified landing', () => {
  const h = setup();
  h.observed.projectiles.push({ x: h.p.x + 210, y: h.p.y + bounds(h.p).offsetY,
    vx: -500, vy: 0, gravity: 0, radius: 12 });
  const baseline = previewDash(h.p, null, geometry, {}, now);
  assert.equal(h.attempt(), true);
  assert.equal(h.brain.metrics.dashDodges, 1);
  assert.ok(maneuverDanger(h.brain.maneuver, h.observed, now, 'ninja') < maneuverDanger(baseline, h.observed, now, 'ninja'));
  assert.equal(h.brain.maneuver.end.grounded, true);
});

test('unfavorable opportunity rolls are spaced out instead of retried every think', () => {
  const h = setup(); h.brain.retreating = true;
  h.brain.random = () => 0.99;
  assert.equal(h.attempt(), false);
  h.brain.random = () => 0;
  assert.equal(h.attempt(now + 150), false);
  assert.equal(h.attempt(h.brain.nextDashAttemptAt), true);
});

test('dash rejects unsafe ledges, rising poison, and paths blocked by a wall', () => {
  const h = setup(); h.brain.retreating = true;
  h.brain.room.geometry = { ...geometry, colliders: [{ ...floor, left: 970, right: 1250 }] };
  assert.equal(h.attempt(), false);
  h.brain.nextDashAt = 0; h.brain.nextDashAttemptAt = 0; h.brain.room.geometry = geometry;
  h.context.poisonAt = () => 905;
  assert.equal(h.attempt(), false);
  h.brain.nextDashAt = 0; h.brain.nextDashAttemptAt = 0; h.context.poisonAt = () => Infinity;
  h.brain.room.geometry = { ...geometry, colliders: [floor, { ...floor, id: 'wall', left: 935, right: 950, top: 500, bottom: 900 }] };
  assert.equal(h.attempt(), false);
});

test('dash cannot interrupt attacks, cooldowns, knockback, stun, or a frozen bot', () => {
  for (const state of [{ isAlive: false }, { _botActionUntil: now + 300 },
    { _dashReadyAt: now + 100 }, { _knockbackUntil: now + 100 }, { _controlLockUntil: now + 100 }]) {
    const h = setup(); h.brain.retreating = true; Object.assign(h.p, state);
    assert.equal(h.attempt(), false);
  }
  const h = setup(); h.brain.retreating = true;
  assert.equal(h.attempt(now, { speedMult: 0 }), false);
});

test('dash sweeps thin obstacles, preserves sliding, and knockback interrupts momentum', () => {
  const p = player(); p.y -= 200; p.grounded = false;
  const wall = { ...floor, left: 1050, right: 1052, top: 300, bottom: 900 };
  assert.equal(startDash(p, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, now), true);
  stepBody(p, {}, { ...geometry, colliders: [floor, wall] }, 160, now);
  assert.ok(bounds(p).right <= wall.left + 0.001);
  assert.equal(p.vx, 0);
  assert.ok(p.vy < 0);
  assert.equal(requestBasic({}, p, {}, {}, () => 0, now + 10), false);
  assert.equal(requestSpecial({}, p, {}, now + 10), false);
  applyImpulse(p, { direction: -1, amountX: 200, amountY: 100 }, now + 20);
  assert.equal(p._dashUntil, 0);
  assert.equal(p.vx, -200);
});

test('airborne dash keeps its burst velocity, restores gravity, and replays a safe landing', () => {
  const p = player(); p.y -= 180; p.grounded = false; p.vy = 150;
  const direction = { x: -1, y: 0 };
  const preview = previewDash(p, direction, geometry, {}, now);
  assert.ok(preview);
  startDash(p, direction, now);
  preview.frames.forEach((frame, i) => {
    stepBody(p, frame, geometry, 1000 / 60, now + i * 1000 / 60);
    if (i < 9) { assert.equal(p.vy, 0); assert.equal(p.vx, -movement.dashSpeed); }
    if (i === 10) assert.ok(p.vy > 0, 'gravity resumes after the burst');
  });
  assert.equal(p.x, preview.end.x);
  assert.equal(p.y, preview.end.y);
  assert.equal(p.grounded, true);
  assert.equal(startDash(p, direction, now + 2000), false, 'landing does not refresh dash');
});

test('a dead target is not chased from an old dash maneuver observation', t => {
  t.mock.method(console, 'log', () => {});
  const h = makeRoom(); t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  brain.openingUntil = 0;
  brain.maneuver = { dash: true, frames: [], cursor: 0 };
  brain.target = { ...enemy };
  enemy.isAlive = false;
  brain.think({ at: now, enemies: [], projectiles: [] }, {}, now);
  assert.equal(brain.metrics.attacks, 0);
  assert.equal(brain.target, null);
});

test('live controller chooses a dash and keeps its animation and movement through subsequent ticks', t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(Date, 'now', () => now);
  const h = makeRoom({ seed: 17 }); t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  h.room.geometry = { ...h.room.geometry, ...geometry, mapId: 998 };
  h.place(p, 1000, floor); h.place(enemy, 1120, floor); p.health = p.maxHealth * 0.2;
  brain.random = () => 0.1; brain.openingUntil = 0;
  const { observe } = require('../src/server/core/bots/perception');
  brain.think(observe(h.room, p, now, brain.projectileSamples), {}, now);
  assert.equal(brain.metrics.dashes, 1);
  const startX = p.x; brain.nextThink = Infinity;
  for (let i = 0; i < 8; i++) brain.tick(1000 / 60, now + i * 1000 / 60);
  assert.ok(p.x < startX - 50);
  assert.equal(p.animation, 'dashing');
  assert.equal(brain.metrics.attacks, 0);
});

test('airborne bots sometimes stomp predicted nearby enemies with the boosted downward dash', () => {
  const h = setup(); h.p.y -= 150; h.p.grounded = false;
  h.enemy.x = h.p.x + 70;
  h.brain.traversal = { dash: false }; // ordinary jumps can turn into a stomp
  h.brain.clearTravel = function () { this.maneuver = this.traversal = null; };
  assert.equal(h.attempt(), true);
  assert.equal(h.p.dashX, 0); assert.equal(h.p.dashY, 1);
  assert.equal(h.p.vy, movement.dashDownSpeed);
  assert.equal(h.brain.metrics.dashStomps, 1);
  assert.ok(h.brain.maneuver.stompImpact.afterMs <= movement.dashDurationMs + movement.dashCoastMs);
  assert.equal(h.brain.traversal, null);
});

test('stomp opportunities use spaced random rolls, not every frame', () => {
  const h = setup(); h.p.y -= 150; h.p.grounded = false; h.enemy.x = h.p.x + 70;
  h.brain.random = () => 0.9;
  assert.equal(h.attempt(), false);
  h.brain.random = () => 0;
  assert.equal(h.attempt(now + 150), false);
  assert.equal(h.attempt(h.brain.nextStompAttemptAt), true);
});

test('bots save their stomp when targets move out of range, landings are unsafe, or a dash route is committed', () => {
  for (const change of [
    h => { h.enemy.vx = 700; },
    h => { h.enemy.x += 400; },
    h => { h.context.poisonAt = () => 905; },
    h => { h.brain.room.geometry = { ...geometry, colliders: [] }; },
    h => { h.brain.traversal = { dash: true }; },
    h => { h.p._knockbackUntil = now + 200; },
  ]) {
    const h = setup(); h.p.y -= 150; h.p.grounded = false; h.enemy.x = h.p.x + 70;
    change(h);
    assert.equal(h.attempt(), false);
    assert.equal(h.p.dashSeq, undefined);
  }
});

test('live bot controller completes a stomp and interrupts a nearby opponent on landing', t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(Date, 'now', () => now);
  const h = makeRoom({ seed: 17 }); t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  h.room.geometry = { ...h.room.geometry, ...geometry, mapId: 998 };
  h.place(p, 1000, floor); h.place(enemy, 1070, floor);
  p.y -= 150; p.grounded = false;
  brain.random = () => 0.1; brain.openingUntil = 0;
  const { observe } = require('../src/server/core/bots/perception');
  brain.think(observe(h.room, p, now, brain.projectileSamples), {}, now);
  assert.equal(brain.metrics.dashStomps, 1);
  brain.nextThink = Infinity;
  for (let i = 0; i < 40; i++) brain.tick(1000 / 60, now + i * 1000 / 60);
  assert.equal(h.events.filter(e => e.type === 'player:stomp').length, 1);
  assert.equal(enemy._attackInterruptSeq, 1);
  assert.ok(enemy.vx > 0 && enemy.vy < 0);
});
