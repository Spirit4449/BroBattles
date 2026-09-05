const test = require('node:test');
const assert = require('node:assert/strict');
const { basicAim, hasClearShot, requestBasic } = require('../src/server/core/bots/combat');
const { getResolvedAttackDescriptor } = require('../src/server/core/gameRoom/attackDescriptorResolver');

const profile = { prediction: 1, aimError: 0 };
const room = { FIXED_DT_MS: 1000 / 60, geometry: { colliders: [] } };
const player = (char_class) => ({ char_class, x: 0, y: 500, difficulty: profile });
const target = { x: 400, y: 500, vx: 0, vy: 0 };

test('ducking does not change whether a bot considers the target attackable', () => {
  const p = player('ninja');
  const standingAim = basicAim(p, target, profile, () => 0.5, room);
  const duckAim = basicAim(p, {
    ...target,
    ducking: true,
    bodyHalfHeight: 24,
    bodyCenterOffsetY: 28,
  }, profile, () => 0.5, room);
  assert.equal(duckAim.canHit, standingAim.canHit);
  assert.equal(duckAim.angle, standingAim.angle);
  assert.deepEqual(duckAim.target, standingAim.target);
});

// Independently step the same velocity-first integration used by live attacks.
function missDistance(p, enemy, angle, speed) {
  const huntress = p.char_class === 'huntress';
  const runtime = getResolvedAttackDescriptor(huntress ? 'huntress-arrow-release' : 'wizard-fireball-release').runtime;
  speed ??= runtime.speed;
  const startup = getResolvedAttackDescriptor(huntress ? 'huntress-arrow' : 'wizard-fireball').actionFlow.startupMs / 1000;
  const dt = room.FIXED_DT_MS / 1000, g = huntress ? runtime.gravity : 0;
  let x = p.x + Math.cos(angle) * 80 * runtime.forwardOffsetWidthFactor;
  let y = p.y - 120 * runtime.verticalOffsetHeightFactor + Math.sin(angle) * 80 * runtime.forwardOffsetWidthFactor;
  let vy = Math.sin(angle) * speed, best = Infinity;
  for (let t = dt; t <= (huntress ? 3 : runtime.range / runtime.speed); t += dt) {
    vy += g * dt; x += Math.cos(angle) * speed * dt; y += vy * dt;
    best = Math.min(best, Math.hypot(x - enemy.x - enemy.vx * (startup + t), y - enemy.y - enemy.vy * (startup + t)));
  }
  return best;
}

test('wizard shoots through walls while leading both movement components', () => {
  const p = player('wizard');
  const blocked = { ...room, geometry: { colliders: [{ left: 180, right: 220, top: 0, bottom: 1000 }] } };
  assert.equal(hasClearShot(blocked, p, target), true);
  for (const [vx, vy] of [[0, 160], [120, -90], [-160, 80]]) {
    const enemy = { ...target, vx, vy };
    const aim = basicAim(p, enemy, profile, () => 0.5, blocked);
    assert.equal(aim.canHit, true);
    assert.ok(missDistance(p, enemy, aim.angle, aim.speed) < 10);
  }
});

test('ninja only considers a shuriken shot clear when terrain leaves room for it', () => {
  const ninja = player('ninja');
  const aim = basicAim(ninja, target, profile, () => 0.5, room);
  const blocked = {
    ...room,
    geometry: {
      colliders: [{ left: 180, right: 220, top: 0, bottom: 1000 }],
    },
  };
  const overhead = {
    ...room,
    geometry: {
      colliders: [{ left: 180, right: 220, top: 0, bottom: 400 }],
    },
  };

  assert.equal(hasClearShot(blocked, ninja, target, aim), false);
  assert.equal(hasClearShot(overhead, ninja, target, aim), true);
});

test('ninja preserves ammo instead of firing a basic shuriken into a wall', () => {
  const ninja = {
    ...player('ninja'),
    participantId: 'blocked-ninja',
    isAlive: true,
    _botActionSeq: 0,
    ammoState: { charges: 1, nextFireInMs: 0, cooldownMs: 100 },
  };
  const actions = [];
  const blocked = {
    FIXED_DT_MS: room.FIXED_DT_MS,
    geometry: {
      colliders: [{ left: 180, right: 220, top: 0, bottom: 1000 }],
    },
    handlePlayerAction: (id, action) => actions.push(action),
  };

  assert.equal(requestBasic(blocked, ninja, target, profile, () => 0.5, 1000), false);
  assert.equal(ninja.ammoState.charges, 1);
  assert.equal(actions.length, 0);
});

test('ninja can shoot a ducking human without mistaking their floor for cover', () => {
  const ninja = {
    ...player('ninja'),
    participantId: 'duck-shot-ninja',
    isAlive: true,
    _botActionSeq: 0,
    ammoState: { charges: 1, nextFireInMs: 0, cooldownMs: 100 },
  };
  const duckingHuman = {
    ...target,
    char_class: 'ninja',
    ducking: true,
  };
  const actions = [];
  const floorRoom = {
    FIXED_DT_MS: room.FIXED_DT_MS,
    geometry: {
      colliders: [{ left: -100, right: 500, top: 528, bottom: 560 }],
    },
    handlePlayerAction: (id, action) => actions.push(action),
  };

  assert.equal(requestBasic(floorRoom, ninja, duckingHuman, profile, () => 0.5, 1000), true);
  assert.equal(ninja.ammoState.charges, 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].target.y, ninja.y);
});

test('ninja can shoot a ducking Gloop despite its large sprite-to-body offset', () => {
  const ninja = {
    ...player('ninja'),
    y: 511.7,
    participantId: 'ducked-gloop-shot-ninja',
    isAlive: true,
    _botActionSeq: 0,
    ammoState: { charges: 1, nextFireInMs: 0, cooldownMs: 100 },
  };
  const duckingGloop = {
    ...target,
    x: 250,
    y: 467.6,
    char_class: 'gloop',
    ducking: true,
  };
  const actions = [];
  const floorRoom = {
    FIXED_DT_MS: room.FIXED_DT_MS,
    geometry: {
      colliders: [{ left: -100, right: 500, top: 539.6, bottom: 640 }],
    },
    handlePlayerAction: (id, action) => actions.push(action),
  };

  assert.equal(requestBasic(floorRoom, ninja, duckingGloop, profile, () => 0.5, 1000), true);
  assert.equal(actions.length, 1);
  assert.ok(actions[0].target.y < 539.6 - 18, 'aim leaves the shuriken clear of the floor');
});

test('huntress selects a high arc over cover and rejects fully blocked trajectories', () => {
  const p = player('huntress');
  const cover = { ...room, geometry: { colliders: [{ left: 180, right: 220, top: 400, bottom: 1000 }] } };
  const low = basicAim(p, target, profile, () => 0.5, room);
  const high = basicAim(p, target, profile, () => 0.5, cover);
  assert.equal(high.canHit, true);
  assert.ok(high.angle < low.angle - 0.5);
  assert.ok(missDistance(p, target, high.angle, high.speed) < 10);
  const sealed = { ...room, geometry: { colliders: [{ left: 180, right: 220, top: -1000, bottom: 1000 }] } };
  assert.equal(basicAim(p, target, profile, () => 0.5, sealed).canHit, false);
  Object.assign(p, { isAlive: true, ammoState: { charges: 3, nextFireInMs: 0 } });
  assert.equal(requestBasic(sealed, p, target, profile, () => 0.5, 1000), false);
  assert.equal(p.ammoState.charges, 3);
});

test('huntress bot aim has extra inaccuracy for its forgiving arrow spread', () => {
  const ordinary = basicAim(player('ninja'), target, profile, () => 1, room);
  const huntress = basicAim(player('huntress'), target, profile, () => 1, room);
  const perfectHuntress = basicAim(player('huntress'), target, { ...profile, aimError: 0 }, () => 0.5, room);
  const ordinaryError = Math.abs(ordinary.angle);
  const huntressError = Math.abs(huntress.angle - perfectHuntress.angle);
  assert.ok(huntressError > ordinaryError + 0.02,
    `huntress error ${huntressError} should exceed ordinary error ${ordinaryError}`);
});

test('huntress intercepts moving targets more accurately than the previous gravity estimate', (t) => {
  const p = player('huntress');
  let oldTotal = 0, newTotal = 0;
  for (const [vx, vy] of [[0, 0], [120, 0], [-180, 0], [0, -100], [80, 80], [-80, -80]]) {
    const enemy = { ...target, vx, vy };
    const aim = basicAim(p, enemy, profile, () => 0.5, room);
    assert.equal(aim.canHit, true);
    const a = vx * vx + vy * vy - 560 * 560, b = 2 * target.x * vx, c = target.x ** 2;
    const flight = Math.min(0.9, 0.1 + (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a));
    const dx = target.x + vx * flight, dy = vy * flight - 200 * (dx / 560) ** 2;
    oldTotal += missDistance(p, enemy, Math.atan2(dy, dx));
    const miss = missDistance(p, enemy, aim.angle, aim.speed);
    assert.ok(miss < 10, `miss ${miss} for velocity ${vx}, ${vy}`);
    newTotal += miss;
  }
  assert.ok(newTotal < oldTotal);
  t.diagnostic(`Mean closest approach: old ${(oldTotal / 6).toFixed(1)}px; new ${(newTotal / 6).toFixed(1)}px (perfect aim, constant velocity).`);
});

test('pressure shots threaten nearby space without wasting the last ammo charge', () => {
  const { pressureAim } = require('../src/server/core/bots/combat');
  const p = { ...player('huntress'), isAlive: true, participantId: 'pressure-bot', _botActionSeq: 0,
    ammoState: { charges: 3, nextFireInMs: 0, cooldownMs: 100 } };
  const enemy = { ...target, x: 580 };
  assert.equal(basicAim(p, enemy, profile, () => 0.5, room).canHit, false);
  const pressure = pressureAim(room, p, enemy, profile);
  assert.ok(pressure?.pressure);
  assert.ok(missDistance(p, enemy, pressure.angle, pressure.speed) < 100);
  const actions = [], firingRoom = { ...room, handlePlayerAction: (id, action) => actions.push(action) };
  assert.equal(requestBasic(firingRoom, p, enemy, profile, () => 0.2, 1000), true);
  assert.equal(actions.length, 1);
  p.ammoState.nextFireInMs = 0;
  assert.equal(requestBasic(firingRoom, p, enemy, profile, () => 0.2, 1600), false, 'pressure cooldown');
  p.ammoState.charges = 1;
  assert.equal(requestBasic(firingRoom, p, enemy, profile, () => 0.2, 4000), false, 'save last charge');
  assert.equal(pressureAim(room, p, { ...enemy, x: 1600 }, profile), null);
  const sealed = { ...room, geometry: { colliders: [{ left: 180, right: 220, top: -1000, bottom: 1000 }] } };
  assert.equal(pressureAim(sealed, p, enemy, profile), null);
});

test('huntress rarely lobs at level targets but freely aims high at elevated targets', () => {
  const cover = { ...room, geometry: { colliders: [{ left: 180, right: 220, top: 400, bottom: 1000 }] },
    handlePlayerAction() {} };
  const ready = () => ({ ...player('huntress'), isAlive: true, participantId: 'archer', _botActionSeq: 0,
    ammoState: { charges: 3, nextFireInMs: 0, cooldownMs: 100 } });
  let fired = 0;
  for (let i = 0; i < 100; i++) {
    if (requestBasic(cover, ready(), target, profile, () => i / 100, 1000)) fired++;
  }
  assert.equal(fired, 20);
  const p = ready();
  assert.equal(requestBasic(cover, p, target, profile, () => 0.5, 1000), false);
  assert.equal(p.ammoState.charges, 3);
  assert.equal(requestBasic(cover, p, target, profile, () => 0, 1200), false, 'no rapid probability retries');
  assert.equal(requestBasic(cover, p, { ...target, y: 350 }, profile, () => 0.9, 1400), true,
    'an elevated target bypasses the lob restriction');
  assert.equal(requestBasic(roomWithActions(), ready(), target, profile, () => 0.9, 1000), true,
    'ordinary low arcs remain available');
  function roomWithActions() { return { ...room, handlePlayerAction() {} }; }
});

test('huntress varies power by distance and angle and sends it into every runtime arrow', () => {
  const { createRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const p = { ...player('huntress'), participantId: 'adaptive-archer', name: 'Archer', isBot: true };
  const near = basicAim(p, { ...target, x: 160 }, profile, () => 0.5, room);
  const far = basicAim(p, { ...target, x: 500 }, profile, () => 0.5, room);
  assert.ok(far.speed > near.speed + 100, 'distant shots use more power');
  const levelTarget = { ...target, x: 300 };
  const lowerTarget = { ...target, x: Math.sqrt(300 ** 2 - 80 ** 2), y: 580 };
  const level = basicAim(p, levelTarget, profile, () => 0.5, room);
  const lower = basicAim(p, lowerTarget, profile, () => 0.5, room);
  assert.ok(Math.abs(level.speed - lower.speed) > 10, 'angle affects power at the same distance');
  for (const enemy of [{ ...target, x: 160 }, { ...target, x: 500 }, levelTarget, lowerTarget, { ...target, vx: 120 }]) {
    const aim = basicAim(p, enemy, profile, () => 0.5, room);
    assert.equal(aim.canHit, true);
    assert.ok(missDistance(p, enemy, aim.angle, aim.speed) < 12);
    const arrows = createRuntimeAttack(p, { ...aim, type: 'huntress-arrow-release', id: 'power-test' }, 1000);
    assert.ok(arrows.length > 0);
    for (const arrow of arrows) {
      assert.equal(arrow.speed, aim.speed);
      assert.ok(Math.abs(Math.hypot(arrow.vx, arrow.vy) - aim.speed) < 0.001);
    }
  }
});

test('ninja bot shurikens stop when their swept path crosses a wall', () => {
  const {
    createRuntimeAttack,
    tickRuntimeAttack,
  } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const ninja = {
    ...player('ninja'),
    participantId: 'wall-test-ninja',
    name: 'Ninja Bot',
    isAlive: true,
    isBot: true,
  };
  const attack = createRuntimeAttack(ninja, {
    type: 'ninja-shuriken',
    id: 'wall-test-shuriken',
    x: 0,
    y: 200,
    direction: 1,
    angle: 0,
    forwardDistance: 500,
    outwardDuration: 380,
  }, 1000);
  const wallRoom = {
    FIXED_DT_MS: 200,
    players: new Map([[ninja.participantId, ninja]]),
    geometry: {
      colliders: [{ left: 100, right: 110, top: 0, bottom: 400 }],
    },
  };

  assert.equal(tickRuntimeAttack(wallRoom, attack, 1200), true);
  assert.ok(attack.x > 110, 'the test crosses the entire wall in one server tick');
});
