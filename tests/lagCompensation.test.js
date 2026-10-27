const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { tickActiveAttacks } = require('../src/server/core/gameRoom/attackRuntimeManager');
const characterCombat = require('../src/server/core/gameRoom/characterCombatRegistry');
const { stampViewRewind, rewindAllowance, VIEW_BUFFER_ALLOWANCE_MS, createLatencyProbe, poseAt } = require('../src/server/core/gameRoom/lagCompensation');
const { HIT_STALENESS_MAX_MS } = require('../src/server/core/gameRoomConfig');
const { FIXED_DT_MS: STEP } = require('../src/shared/gameConstants');

// Every human shot: the request a browser sends, and the room entry point.
const SHOOTERS = {
  huntress: (room, p, id) => room.handlePlayerAction(p.participantId, request(room, { type: 'huntress-arrow', id, angle: 0, power: 0.5 })),
  ninja: (room, p, id) => room.handlePlayerAction(p.participantId, request(room, { type: 'ninja-shuriken', id, angle: 0 })),
  wizard: (room, p, id) => room.handlePlayerAction(p.participantId, request(room, { type: 'wizard-fireball', id, angle: 0, direction: 1 })),
  gloop: (room, p, id) => room.handlePlayerAction(p.participantId, request(room, { type: 'gloop-slimeball', id, direction: 1,
    target: { x: p.x + 220, y: p.y } })),
  'gloop hook': (room, p, id) => { p.superCharge = p.maxSuperCharge; return room.requestSpecial(p.participantId, request(room, { id, aim: { angle: 0 } })); },
};
let viewLagMs = 0;
// What the socket handlers do with a browser request rendered `viewLagMs` behind.
function request(room, data) { return stampViewRewind(room, { ...data, viewMono: room._simulationMono - viewLagMs }, { samples: [{ at: performance.now(), rtt: HIT_STALENESS_MAX_MS }] }); }

function arena(t, shooter) {
  const clock = { now: 5_000_000 };
  t.mock.method(Date, 'now', () => clock.now);
  const f = makeRoom({ characters: [shooter.split(' ')[0], 'thorg'] });
  t.after(() => f.room.cleanup());
  const { room } = f, [p, target] = f.players;
  Object.assign(p, { x: 100, y: 300, isBot: false, connected: true, loaded: true });
  // A tall target across every shot's path, whatever its arc.
  Object.assign(target, { x: 330, y: 300, isBot: false, connected: true, loaded: true,
    _bodyHalfWidth: 20, _bodyHalfHeight: 400, _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0 });
  room.geometry = { ...room.geometry, colliders: [] };
  room.gameMode = null; room._tickId = 0; room._simulationMono = 90_000;
  const scheduled = [];
  room.scheduleAction = (fn, ms) => scheduled.push({ at: room._simulationMono + ms, fn });
  f.step = () => {
    clock.now += STEP; room._tickId++; room._simulationMono += STEP;
    for (const job of scheduled.splice(0)) (job.at <= room._simulationMono ? job.fn() : scheduled.push(job));
    tickActiveAttacks(room, clock.now);
    characterCombat.tick(room);
  };
  // Milliseconds after firing at which the target lost health, or null.
  f.fire = (id = 'shot') => {
    const fired = clock.now, hp = target.health;
    assert.ok(SHOOTERS[shooter](room, p, id) !== false, `${shooter} shot accepted`);
    for (let i = 0; i < 120; i++) { f.step(); if (target.health < hp) return clock.now - fired; }
    return null;
  };
  // The target stood in the path until `ms` after the shot, then stepped away.
  f.leaveAfter = ms => {
    const away = { x: 330, y: -5000 };
    target._posHistory = [{ x: 330, y: 300, t: clock.now - 1000 }, { x: 330, y: 300, t: clock.now + ms },
      { ...away, t: clock.now + ms + 1 }];
    Object.assign(target, away);
  };
  return f;
}

for (const shooter of Object.keys(SHOOTERS)) {
  test(`${shooter}: hits where the shooter saw a target that has since stepped away, within the rewind cap`, t => {
    // Reference: how long the shot takes to reach a target that stays put.
    viewLagMs = 0;
    const travelMs = arena(t, shooter).fire();
    assert.ok(travelMs > 100, `${shooter} reaches the target after ${travelMs} ms`);

    // The target leaves 100 ms before the shot arrives on the live timeline.
    for (const [lag, hits] of [[0, false], [200, true], [HIT_STALENESS_MAX_MS + 300, false]]) {
      viewLagMs = lag;
      const f = arena(t, shooter);
      f.leaveAfter(travelMs - (lag > HIT_STALENESS_MAX_MS ? HIT_STALENESS_MAX_MS + 100 : 100));
      assert.equal(f.fire() !== null, hits, `${shooter} with the shooter's view ${lag} ms behind`);
    }
    viewLagMs = 0;
  });
}

test('the server bounds claimed view age by observed latency and rejects malformed times', t => {
  const room = { _simulationMono: 1000 };
  assert.equal(stampViewRewind(room, { viewMono: 880, viewRewindMs: 999 }).viewRewindMs, 120);
  assert.equal(stampViewRewind(room, { viewRewindMs: 250 }).viewRewindMs, 0);
  assert.equal(stampViewRewind(room, { viewMono: 2000 }).viewRewindMs, 0, 'future view');
  assert.equal(stampViewRewind(room, { viewMono: -5000 }).viewRewindMs, VIEW_BUFFER_ALLOWANCE_MS);
  assert.equal(stampViewRewind(room, null), null);
});

test('bot shots and melee use live target positions', t => {
  viewLagMs = 0;
  const f = arena(t, 'wizard'), [p] = f.players;
  p.isBot = true;
  f.leaveAfter(-1);
  // A bot's request never passes the transport, so even a forged field is ignored.
  f.room.handlePlayerAction(p.participantId, { type: 'wizard-fireball', id: 'bot', angle: 0, direction: 1, viewRewindMs: 300 });
  for (let i = 0; i < 120; i++) f.step();
  assert.equal(f.players[1].health, f.players[1].maxHealth);
  const melee = require('../src/server/core/gameRoom/attackRuntimes/attackIdentity')
    .attackIdentity(p, { type: 'thorg-fall', viewRewindMs: 200 }, { runtime: { kind: 'path-rect' } }, Date.now());
  assert.equal(melee.viewRewindMs, 0);
});

test('a Huntress arrow attaches relative to where the shooter saw the target', t => {
  viewLagMs = 0;
  const travelMs = arena(t, 'huntress').fire();
  viewLagMs = 200;
  const f = arena(t, 'huntress'), target = f.players[1];
  f.leaveAfter(travelMs - 100);
  assert.ok(f.fire() !== null);
  const terminal = f.events.map(e => e.payload?.action).find(a => a?.type === 'huntress-terminal' && a.reason === 'target');
  // The live target is 5000 px away; the arrow sits in the body that was seen.
  assert.equal(target.y, -5000);
  assert.ok(Math.abs(terminal.targetOffset.x) <= 20, `x offset ${terminal.targetOffset.x}`);
  assert.ok(Math.abs(terminal.targetOffset.y) <= 400, `y offset ${terminal.targetOffset.y}`);
  assert.ok(Math.hypot(330 + terminal.targetOffset.x - terminal.x, 300 + terminal.targetOffset.y - terminal.y) < 40);
});

test('a Gloop hook uses the requesting browser\'s id, so its prediction is not replayed', t => {
  viewLagMs = 0;
  const f = arena(t, 'gloop hook');
  f.fire('hook-7');
  const release = f.events.map(e => e.payload?.action).find(a => a?.type === 'gloop-hook-release');
  assert.equal(release.id, 'hook-7');
});

test('rewind budget accommodates measured latency, expires, and ignores client coercions', () => {
  const room = { _simulationMono: 10000 }, at = performance.now();
  const low = { samples: [{ at, rtt: 10 }, { at, rtt: 500 }] };
  const high = { samples: [{ at, rtt: HIT_STALENESS_MAX_MS }] };
  for (const viewMono of [null, '', '9000', false, [], NaN, Infinity]) {
    assert.equal(stampViewRewind(room, { viewMono, viewRewindMs: 300 }, high).viewRewindMs, 0);
  }
  assert.equal(stampViewRewind(room, { viewMono: 0 }, low).viewRewindMs, rewindAllowance(low));
  assert.equal(stampViewRewind(room, { viewMono: 0 }, high).viewRewindMs, HIT_STALENESS_MAX_MS);
  assert.equal(stampViewRewind(room, { viewMono: 9800 }, high).viewRewindMs, 200);
  assert.equal(rewindAllowance(high, at + 60000), VIEW_BUFFER_ALLOWANCE_MS);
});

test('latency probe measures server elapsed time and bounds outstanding requests', t => {
  let now = 1000, ack, calls = 0;
  t.mock.method(performance, 'now', () => now);
  const socket = { id: 'p', connected: true, timeout() { return this; },
    emit(event, data, cb) { assert.equal(event, 'game:latency'); calls++; ack = cb; } };
  const room = { players: new Map([['p', {}]]) };
  const latency = createLatencyProbe(room, socket);
  latency.probe(); latency.probe(); assert.equal(calls, 1);
  now += 80; ack(null, { rtt: 99999 });
  assert.equal(latency.samples[0].rtt, 80);
  now += 200; latency.probe(); ack(new Error('timeout'));
  assert.equal(latency.samples.length, 1);
  now += 200; latency.probe(); room.players.clear(); ack(null);
  assert.equal(latency.samples.length, 1);
});

test('rewind interpolates position but preserves discrete historical body dimensions', () => {
  const input = require('../src/server/core/gameRoom/inputManager');
  const { shotTargetBounds } = require('../src/server/core/gameRoom/attackRuntimes/targets');
  const { circleAabbOverlap } = require('../src/shared/combat/shotContact');
  const p = { char_class: 'ninja', x: 100, y: 100, _bodyHalfWidth: 20,
    _bodyHalfHeight: 60, _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0 };
  input.pushPositionHistory(p, 1000);
  Object.assign(p, { x: 120, _bodyHalfHeight: 30, _bodyCenterOffsetY: 30, _bodyCenterOffsetX: 5 });
  input.pushPositionHistory(p, 1200);
  const past = shotTargetBounds({ viewRewindMs: 100 }, p, 1200);
  assert.equal(poseAt(p, 100, 1200).x, 110);
  assert.equal(circleAabbOverlap(110, 50, 1, past), true);
  assert.equal(circleAabbOverlap(120, 50, 1, shotTargetBounds({}, p, 1200)), false);
  Object.assign(p, { _bodyHalfHeight: 60, _bodyCenterOffsetY: 0 });
  input.pushPositionHistory(p, 1400);
  assert.equal(circleAabbOverlap(120, 50, 1, shotTargetBounds({ viewRewindMs: 100 }, p, 1400)), false);
  assert.equal(poseAt(p, 200, 1400)._bodyCenterOffsetX, 5);
  input.resetMovementBudget(p, 1500);
  assert.equal(poseAt(p, 300, 1500)._bodyHalfHeight, 60);
});

for (const shooter of Object.keys(SHOOTERS)) {
  test(`${shooter}: contact uses the historical body, not a newer smaller body`, t => {
    viewLagMs = 0;
    const travel = arena(t, shooter).fire();
    const f = arena(t, shooter), target = f.players[1];
    const { collisionPose } = require('../src/server/core/gameRoom/lagCompensation');
    const standing = collisionPose(target), now = Date.now();
    // A posture transition moves the occupied area out of the flight path.
    Object.assign(target, { _bodyHalfHeight: 10, _bodyCenterOffsetY: 1000 });
    target._posHistory = [
      { x: target.x, y: target.y, t: now - 1000, body: standing },
      { x: target.x, y: target.y, t: now + travel - 100, body: collisionPose(target) },
    ];
    viewLagMs = 200;
    assert.ok(f.fire() !== null);
    viewLagMs = 0;
  });
}
