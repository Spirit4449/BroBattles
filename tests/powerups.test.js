const assert = require("node:assert/strict");
const test = require("node:test");

const {
  POWERUP_TYPES,
  POWERUP_TYPE_ROTATION,
  POWERUP_DURATIONS_MS,
  POWERUP_SHOCKWAVE_RADIUS,
  POWERUP_SHOCKWAVE_FORCE_X,
  POWERUP_SHOCKWAVE_FORCE_Y,
  POWERUP_FREEZE_SPEED_MULT,
  POWERUP_FREEZE_JUMP_MULT,
} = require("../src/server/core/gameRoomConfig");
const effectManager = require("../src/server/core/gameRoom/effects/effectManager");
const powerupManager = require("../src/server/core/gameRoom/powerupManager");

function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("new powerups are registered with durations and spawn rotation", () => {
  for (const type of ["invisibility", "shockwave", "freeze"]) {
    assert.ok(POWERUP_TYPES.includes(type), `${type} missing from type registry`);
    assert.ok(
      POWERUP_TYPE_ROTATION.includes(type),
      `${type} missing from spawn rotation`,
    );
    assert.ok(POWERUP_DURATIONS_MS[type] > 0, `${type} has no duration`);
  }
});

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
  assert.ok(POWERUP_SHOCKWAVE_FORCE_X >= 1_500);
  assert.ok(POWERUP_SHOCKWAVE_FORCE_Y >= 1_000);
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
