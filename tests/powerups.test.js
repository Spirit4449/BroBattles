const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("World pickups and timed effects", () => {
  const {
    POWERUP_TYPES,
    POWERUP_TYPE_ROTATION,
    POWERUP_DURATIONS_MS,
    POWERUP_SHOCKWAVE_RADIUS,
    POWERUP_SHOCKWAVE_FORCE_X,
    POWERUP_SHOCKWAVE_FORCE_Y,
    POWERUP_FREEZE_SPEED_MULT,
    POWERUP_FREEZE_JUMP_MULT,
    POWERUP_FIRST_SPAWN_DELAY_MS,
    POWERUP_STARTING_COUNT,
  } = require("../src/shared/combat/matchConfig.js");
  const effectManager = require("../src/shared/combat/runtime/effects/effectManager.js");
  const powerupManager = require("../src/server/core/gameRoom/powerupManager");

  function seededRandom(seed = 1) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }



  test("spawn points use a shuffled bag and avoid recently used locations", () => {
    const room = {
      matchData: { map: 1 },
      _powerups: new Map(),
      _powerupRandom: seededRandom(42),
      _powerupSpawnBag: [],
      _recentPowerupSpawnKeys: [],
    };
    const pointCount = powerupManager.getPlatformSpawnPoints(room).length;
    const selectedKeys = [];

    for (let i = 0; i < pointCount; i += 1) {
      const point = powerupManager.pickSpawnPoint(room);
      assert.ok(point);
      selectedKeys.push(point._spawnPointKey);
    }

    assert.equal(new Set(selectedKeys).size, pointCount);
    for (let i = 1; i < selectedKeys.length; i += 1) {
      assert.notEqual(selectedKeys[i], selectedKeys[i - 1]);
    }
  });

  test("active spawn locations are never selected again", () => {
    const room = {
      matchData: { map: 1 },
      _powerups: new Map(),
      _powerupRandom: seededRandom(7),
      _powerupSpawnBag: [],
      _recentPowerupSpawnKeys: [],
    };
    const first = powerupManager.pickSpawnPoint(room);
    room._powerups.set(1, {
      x: first.x,
      y: first.y - 22,
      _spawnPointKey: first._spawnPointKey,
    });

    for (let i = 0; i < 8; i += 1) {
      const next = powerupManager.pickSpawnPoint(room);
      assert.notEqual(next._spawnPointKey, first._spawnPointKey);
    }
  });

  test("the first powerups wait for the opening delay before spawning", (t) => {
    let now = 50000;
    t.mock.method(Date, "now", () => now);
    const room = {
      status: "active",
      matchData: { map: 1 },
      players: new Map(),
      _powerups: new Map(),
      _deathDrops: new Map(),
      _nextPowerupId: 1,
      _powerupRandom: seededRandom(3),
      _powerupSpawnBag: [],
      _powerupTypeBag: [],
      _recentPowerupSpawnKeys: [],
      _loopStartWallTime: now,
      _lastPowerupSpawnAt: now,
      _startingPowerupsPending: true,
    };

    now += POWERUP_FIRST_SPAWN_DELAY_MS - 1;
    powerupManager.tickPowerups(room);
    assert.equal(room._powerups.size, 0);

    now += 1;
    powerupManager.tickPowerups(room);
    assert.equal(room._powerups.size, POWERUP_STARTING_COUNT);
    assert.equal(room._startingPowerupsPending, false);
  });

  test("powerup types shuffle independently without immediate repeats", () => {
    const room = {
      _powerupRandom: seededRandom(99),
      _powerupTypeBag: [],
      _lastPowerupType: null,
      _lastPowerupTypeBySpawnKey: Object.create(null),
    };
    const selected = [];
    for (let i = 0; i < POWERUP_TYPE_ROTATION.length * 2; i += 1) {
      selected.push(
        powerupManager.pickPowerupType(room, POWERUP_TYPE_ROTATION, {
          x: i,
          y: i,
          _spawnPointKey: `point-${i}`,
        }),
      );
    }

    for (let i = 1; i < selected.length; i += 1) {
      assert.notEqual(selected[i], selected[i - 1]);
    }
    assert.equal(
      new Set(selected.slice(0, POWERUP_TYPE_ROTATION.length)).size,
      POWERUP_TYPE_ROTATION.length,
    );
  });

  test("invisibility is exposed in snapshots for its full duration", () => {
    const player = {};
    const now = 10_000;
    effectManager.apply(player, "invisibility", now);

    assert.equal(
      effectManager.snapshotAll(player, now).invisibility,
      POWERUP_DURATIONS_MS.invisibility,
    );
    assert.equal(
      effectManager.snapshotAll(player, now + POWERUP_DURATIONS_MS.invisibility)
        .invisibility,
      0,
    );
  });

  test("freeze slows horizontal movement and jump without disabling either", () => {
    const player = {};
    effectManager.apply(player, "freeze", 5_000);
    const modifiers = effectManager.getModifiers(player, 5_001);

    assert.equal(modifiers.speedMult, POWERUP_FREEZE_SPEED_MULT);
    assert.equal(modifiers.jumpMult, POWERUP_FREEZE_JUMP_MULT);
    assert.ok(modifiers.speedMult > 0 && modifiers.speedMult < 1);
    assert.ok(modifiers.jumpMult > 0 && modifiers.jumpMult < 1);
    assert.equal(modifiers.damageMult, 1);
  });

  test("shockwave launches every other eligible player inside its radius", () => {
    assert.equal(POWERUP_SHOCKWAVE_FORCE_X, 990);
    assert.equal(POWERUP_SHOCKWAVE_FORCE_Y, 750);
    const emitted = [];
    const collector = {
      name: "collector",
      socketId: "collector-socket",
      x: 100,
      y: 100,
      isAlive: true,
      connected: true,
      loaded: true,
    };
    const nearbyEnemy = {
      name: "enemy",
      socketId: "enemy-socket",
      x: 220,
      y: 100,
      isAlive: true,
      connected: true,
      loaded: true,
    };
    const nearbyTeammate = {
      name: "teammate",
      socketId: "teammate-socket",
      x: 100,
      y: 20,
      isAlive: true,
      connected: true,
      loaded: true,
    };
    const distant = {
      name: "distant",
      socketId: "distant-socket",
      x: 100 + POWERUP_SHOCKWAVE_RADIUS + 1,
      y: 100,
      isAlive: true,
      connected: true,
      loaded: true,
    };
    const room = {
      applyKnockback(player, impulse) { require('../src/server/core/gameRoom/participants').applyParticipantKnockback(this, player, impulse); },
      players: new Map([
        [collector.socketId, collector],
        [nearbyEnemy.socketId, nearbyEnemy],
        [nearbyTeammate.socketId, nearbyTeammate],
        [distant.socketId, distant],
      ]),
      io: {
        to(socketId) {
          return {
            emit(event, payload) {
              emitted.push({ socketId, event, payload });
            },
          };
        },
      },
    };

    effectManager.apply(collector, "shockwave", 20_000, {}, room);

    assert.deepEqual(
      emitted.map((entry) => entry.socketId).sort(),
      ["enemy-socket", "teammate-socket"],
    );
    assert.ok(emitted.every((entry) => entry.event === "player:knockback"));
    assert.ok(emitted.every((entry) => entry.payload.radial === true));
    assert.ok(
      emitted.every(
        (entry) =>
          Number.isFinite(entry.payload.amountX) &&
          Number.isFinite(entry.payload.amountY),
      ),
    );
  });

  test('shockwave smoothly scales from a huge close blast to a strong edge blast with lift', () => {
    const collector = { name: 'source', x: 0, y: 0 };
    const hits = [];
    const targets = [0, POWERUP_SHOCKWAVE_RADIUS / 2, POWERUP_SHOCKWAVE_RADIUS].map((x, i) => ({
      x, y: 0, socketId: String(i), isAlive: true, connected: true, loaded: true,
    }));
    const room = {
      applyKnockback(player, impulse) { require('../src/server/core/gameRoom/participants').applyParticipantKnockback(this, player, impulse); },
      players: new Map([['source', collector], ...targets.map(t => [t.socketId, t])]),
      io: { to: () => ({ emit: (event, payload) => hits.push(payload) }) },
    };
    effectManager.apply(collector, 'shockwave', 20_000, {}, room);
    assert.equal(hits.length, 3);
    assert.ok(hits[0].amountX > hits[1].amountX);
    assert.ok(hits[1].amountX > hits[2].amountX);
    assert.ok(hits[0].amountX >= POWERUP_SHOCKWAVE_FORCE_X * 1.5);
    assert.ok(hits[2].amountX >= POWERUP_SHOCKWAVE_FORCE_X * 0.8);
    assert.ok(hits.every(hit => hit.amountY <= -270));
  });
});

describe("Team powerup grants", () => {
  const surge = require('../src/shared/combat/runtime/abilities/wizardArcaneSurgeAbility.js');
  const { POWERUP_CATALOG } = require('../src/shared/powerups');

  function cast(random) {
    const applied = [], emitted = [];
    const player = (name, team) => ({ name, team, isAlive: true, loaded: true });
    const caster = player('wiz', 'team1');
    const room = {
      applyKnockback(player, impulse) { require('../src/server/core/gameRoom/participants').applyParticipantKnockback(this, player, impulse); },
      players: new Map([caster, player('ally', 'team1'), player('foe', 'team2')].map(p => [p.name, p])),
      _applyPowerupToPlayer: (target, type) => applied.push([target.name, type]),
      io: { to: () => ({ emit: (event, payload) => emitted.push(payload) }) },
    };
    const original = Math.random;
    Math.random = random;
    try { surge.activate(caster, Date.now(), room); } finally { Math.random = original; }
    return { applied, emitted };
  }

  test('the surge only hands out helpful powerups, and only to the caster\'s team', () => {
    for (const bad of ['poison', 'freeze', 'shockwave']) {
      assert.ok(POWERUP_CATALOG[bad], `${bad} is still a powerup`);
      assert.ok(!surge.SURGE_POWERUPS.includes(bad), `${bad} is never granted`);
    }
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const { applied, emitted } = cast(() => (i + 0.5) / 40);
      assert.deepEqual(applied.map(([name]) => name).sort(), ['ally', 'wiz']);
      for (const [, type] of applied) assert.ok(surge.SURGE_POWERUPS.includes(type), type);
      seen.add(applied.find(([name]) => name === 'wiz')[1]);
      assert.equal(emitted[0].recipients.find(r => r.isCaster).type, applied.find(([n]) => n === 'wiz')[1]);
    }
    assert.deepEqual([...seen].sort(), [...surge.SURGE_POWERUPS].sort(), 'the caster can roll any of them, not just rage');
  });
});
