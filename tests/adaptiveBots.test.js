const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOT_NAMES,
  TROLL_NAMES,
  GAMER_NAMES,
  createBotParticipants,
} = require("../src/server/core/bots/identity");
const {
  stagedSeatCount,
  difficultyForTrophies,
  getBotConfig,
  getSeatSchedule,
} = require("../src/server/core/bots/config");
const {
  pickGroup,
  pickCompositeGroup,
} = require("../src/server/core/matchmaking/teamBalancer");
const {
  computeUserMMRFromRow,
  ratingWindow,
} = require("../src/server/core/matchmaking/mmrUtils");
const {
  getDuelGeometry,
  characterBody,
  spawnForParticipant,
} = require("../src/shared/duelGeometry");
const {
  buildGraph,
  findRoute,
  standOn,
  safeWalkDirection,
} = require("../src/server/core/bots/navigation");
const {
  stepBody,
  bounds,
  applyImpulse,
} = require("../src/server/core/bots/physics");
const {
  requestBasic,
  requestSpecial,
  advanceAmmo,
} = require("../src/server/core/bots/combat");
const { makeRoom } = require("./helpers/botRoom");
const effects = require("../src/server/core/gameRoom/effects/effectManager");
const { getParticipant } = require("../src/server/core/gameRoom/participants");
const now = 100000;
const ticket = (id, rating, a = 1, b = 0) => ({
  ticket_id: id,
  user_id: id,
  size: a + b,
  team1_count: a,
  team2_count: b,
  mmr: rating,
  created_at: new Date(now - 10000),
});

test("server bootstrap supplies transaction and party lifecycle helpers to sockets", (t) => {
  const { readFileSync } = require("node:fs");
  const { runInNewContext } = require("node:vm");
  const db = require("../src/server/core/sql");
  t.after(() => db.pool.end());
  const source = readFileSync(require.resolve("../src/server/server"), "utf8");
  const start = source.indexOf("const socketApi = initSocket(");
  const end = source.indexOf("app.locals.socketApi = socketApi;", start);
  assert.ok(start >= 0 && end > start, "socket bootstrap is present");
  let socketDb;
  // Execute the actual dependency wiring without starting HTTP, jobs, or MySQL.
  runInNewContext(source.slice(start, end), {
    db,
    io: {},
    COOKIE_SECRET: "test",
    runtimeConfig: {},
    chatService: {},
    abuseControl: {},
    initSocket(deps) {
      socketDb = deps.db;
      return {};
    },
  });
  for (const name of [
    "runQuery",
    "withTransaction",
    "setPartyStatus",
    "setPartiesStatus",
  ]) {
    assert.equal(
      typeof socketDb?.[name],
      "function",
      `socket DB provides ${name}`,
    );
    assert.equal(socketDb[name], db[name]);
  }
});

test("fill starts from 5 seconds with randomized join times, disabled until configured", () => {
  const t1 = { ticket_id: 101, created_at: new Date(0) };
  const t2 = { ticket_id: 202, created_at: new Date(0) };

  // Never joins before 5000ms
  assert.equal(stagedSeatCount(t1, 0), 0);
  assert.equal(stagedSeatCount(t1, 4999), 0);
  assert.equal(stagedSeatCount(t2, 4999), 0);

  // First seat schedule starts at or after 5000ms
  const s1 = getSeatSchedule(t1);
  const s2 = getSeatSchedule(t2);
  assert.ok(s1[0] >= 5000, "t1 first bot starts at >= 5s");
  assert.ok(s2[0] >= 5000, "t2 first bot starts at >= 5s");

  // Different tickets produce different randomized join schedules
  assert.notEqual(s1[0], s2[0], "different tickets join at different times");

  // Seats monotonically increase as time elapses
  assert.ok(stagedSeatCount(t1, s1[0]) >= 1);
  assert.equal(stagedSeatCount(t1, s1[4]), 5);

  assert.equal(getBotConfig().enabled, false);
  assert.equal(
    computeUserMMRFromRow({ trophies: 750, char_levels: '{"ninja":5}' }),
    750,
  );
  assert.equal(ratingWindow(t1, 10000), 250);
});

test("partial assembly maximizes humans, preserves party sides, excludes incompatible ratings", () => {
  const pool = [
    ticket(1, 600, 2, 1),
    ticket(2, 700),
    ticket(3, 690),
    ticket(4, 4000),
  ];
  const group = pickGroup(pool, 3, { partial: true, anchorId: 1, now });
  assert.equal(
    group.reduce((n, p) => n + p.ticket.size, 0),
    5,
  );
  assert.ok(group.some((p) => p.ticket.ticket_id === 1));
  assert.ok(!group.some((p) => p.ticket.ticket_id === 4));
  assert.equal(pickCompositeGroup(pool, 3, { now }), null);
  assert.equal(
    pickCompositeGroup([...pool, ticket(5, 650)], 3, { now }).length,
    4,
  );
});

test("ordinary bot identities have no accounts, support troll/guest/real names, and median character levels", () => {
  assert.ok(BOT_NAMES.length >= 2000);
  assert.equal(new Set(BOT_NAMES).size, BOT_NAMES.length);
  assert.ok(TROLL_NAMES.length >= 50);
  assert.ok(GAMER_NAMES.length >= 50);

  const humans = [
    {
      name: BOT_NAMES[0],
      team: "team1",
      char_class: "ninja",
      level: 1,
      trophies: 500,
    },
    {
      name: "Human",
      team: "team2",
      char_class: "wizard",
      level: 5,
      trophies: 1500,
    },
  ];
  const realUserPool = ["ApexPredatorReal", "LegendaryUser99", "DatabaseGamer"];
  const bots = createBotParticipants(humans, 3, {
    seed: 5,
    realNames: realUserPool,
  });

  assert.equal(bots.length, 4);
  assert.equal(new Set(bots.map((b) => b.name)).size, 4);
  for (const b of bots) {
    assert.equal(b.user_id, null);
    assert.equal(b.level, 3);
    assert.notEqual(b.trophies, 1000);
    assert.ok(Math.abs(b.trophies - 1000) <= 80);
    assert.equal(b.difficulty.trophies, 1000);
    assert.notEqual(b.name, humans[0].name);
    assert.notEqual(b.name, humans[1].name);
  }

  // Verify multiple runs generate troll, guest, or real names without collision
  const sampleBots = [];
  for (let s = 0; s < 20; s++) {
    const batch = createBotParticipants(humans, 2, {
      seed: s * 31 + 7,
      realNames: realUserPool,
    });
    sampleBots.push(...batch);
  }
  const sampleNames = sampleBots.map((b) => b.name);
  const hasGuest = sampleNames.some((n) => n.startsWith("Guest"));
  const hasTroll = sampleNames.some((n) => TROLL_NAMES.includes(n));
  const hasReal = sampleNames.some((n) => realUserPool.includes(n));
  assert.ok(
    hasGuest || hasTroll || hasReal,
    "sample contains diverse names (guest, troll, or real names)",
  );

  assert.ok(
    difficultyForTrophies(2000).reactionMaxMs <
      difficultyForTrophies(0).reactionMinMs,
  );
});

test("every character spawns on a real collider and has physically verified routes on every Duel map", () => {
  for (const map of [1, 2, 3])
    for (const character of [
      "ninja",
      "thorg",
      "draven",
      "wizard",
      "huntress",
      "gloop",
    ]) {
      const g = getDuelGeometry(map),
        graph = buildGraph(g, character);
      assert.ok([...graph.edges.values()].some((list) => list.length));
      for (const team of ["team1", "team2"]) {
        const p = {
          char_class: character,
          team,
          ...spawnForParticipant(g, { char_class: character, team }, 0, 1),
        };
        for (let i = 0; i < 30; i++)
          stepBody(p, {}, g, 1000 / 60, (i * 1000) / 60);
        assert.ok(p.grounded, `${map}/${character}/${team} grounded`);
        assert.ok(graph.surfaces.some((s) => s.id === p.platformId));
        assert.equal(findRoute(graph, p.platformId, p.platformId).length, 0);
      }
    }
});

test("safe patrol brakes at edges; jump, one-way collision, wall jump and knockback are physical", () => {
  const g = getDuelGeometry(3),
    surface = g.colliders.find((s) => s.id === "h5");
  const p = standOn(surface, "ninja", surface.right - 18);
  assert.equal(safeWalkDirection(p, 1, g), 0);
  stepBody(p, { jumpPressed: true }, g, 1000 / 60, 1000);
  assert.ok(p.vy < 0);
  assert.equal(p.grounded, false);
  const below = standOn(surface, "ninja", surface.x);
  below.y += 65;
  below.grounded = false;
  below.vy = -375;
  for (let i = 0; i < 12; i++) stepBody(below, {}, g, 1000 / 60, 1100 + i * 17);
  assert.ok(
    bounds(below).top < surface.bottom,
    "jump through underside of a one-way surface",
  );
  p.wallSide = "left";
  p.grounded = false;
  stepBody(p, { jumpPressed: true, direction: 1 }, g, 1000 / 60, 2000);
  assert.ok(p.vx > 0 && p.vy < 0);
  applyImpulse(p, { amountX: -400, amountY: 200 }, 2100);
  assert.equal(p.vx, -400);
  assert.equal(p.vy, -200);
});

test("all six characters attack and use specials without a browser; ammo and charge are enforced", () => {
  const originalNow = Date.now;
  let clock = 1000000;
  Date.now = () => clock;
  try {
    for (const character of [
      "ninja",
      "thorg",
      "draven",
      "wizard",
      "huntress",
      "gloop",
    ]) {
      const h = makeRoom({ characters: [character, "ninja"] });
      const [p, target] = h.players;
      h.room.botControllers.clear();
      h.place(p, 1080);
      h.place(target, 1190);
      target.health = target.maxHealth = 100000;
      const initial = target.health;
      assert.equal(
        requestBasic(
          h.room,
          p,
          target,
          difficultyForTrophies(2000),
          () => 0.5,
          clock,
        ),
        true,
        character,
      );
      const remaining = p.ammoState.charges;
      assert.equal(
        requestBasic(
          h.room,
          p,
          target,
          difficultyForTrophies(2000),
          () => 0.5,
          clock,
        ),
        false,
      );
      assert.equal(p.ammoState.charges, remaining);
      for (let i = 0; i < 180; i++) {
        clock += 17;
        h.tick(clock);
      }
      assert.ok(target.health < initial, `${character} basic damage`);
      assert.equal(
        requestSpecial(h.room, p, target, clock),
        false,
        "uncharged special",
      );
      p.superCharge = p.maxSuperCharge;
      const before = target.health;
      assert.equal(
        requestSpecial(h.room, p, target, clock),
        true,
        `${character} special`,
      );
      assert.equal(p.superCharge, 0);
      for (let i = 0; i < 200; i++) {
        clock += 17;
        h.tick(clock);
      }
      if (["ninja", "draven", "huntress"].includes(character))
        assert.ok(target.health < before, `${character} special damage`);
      if (character === "thorg")
        assert.ok(effects.isActive(p, "thorgRage", clock));
      advanceAmmo(p, 10000);
      assert.equal(p.ammoState.charges, p.ammoState.capacity);
      h.room.cleanup();
    }
  } finally {
    Date.now = originalNow;
  }
});

test("socket clients cannot submit hits on behalf of a bot and identities survive reconnect", () => {
  const h = makeRoom();
  const [p, target] = h.players;
  h.place(p, 1100);
  h.place(target, 1140);
  const health = target.health;
  h.room.handleHit("unrelated-socket", {
    attacker: p.name,
    target: target.name,
  });
  assert.equal(target.health, health);
  assert.equal(getParticipant(h.room, p.participantId), p);
  p.socketId = "new-socket";
  assert.equal(getParticipant(h.room, p.participantId), p);
  h.room.scheduleAction(() => assert.fail("action survived cleanup"), 100);
  h.room.cleanup();
  assert.equal(h.room._scheduledActions.length, 0);
  assert.equal(h.room.botControllers.size, 0);
});

test("bots ignore invisible opponents and freeze affects actual movement", () => {
  const h = makeRoom();
  const [p, target] = h.players;
  h.place(p, 1080);
  h.place(target, 1190);
  effects.apply(target, "invisibility", now);
  const controller = h.room.botControllers.get(p.participantId);
  controller.tick(17, now + 50);
  assert.equal(controller.observations.at(-1).enemies.length, 0);
  const regular = standOn(h.room.geometry.colliders[0], "ninja", 1100);
  const frozen = { ...regular };
  stepBody(regular, { direction: 1 }, h.room.geometry, 100, now);
  stepBody(frozen, { direction: 1 }, h.room.geometry, 100, now, {
    speedMult: 0,
    jumpMult: 0,
  });
  assert.ok(regular.x > frozen.x);
  h.room.cleanup();
});

test("atomic assembly commits once under concurrent fill attempts and creates no users", async () => {
  const {
    createMatchAssemblyManager,
  } = require("../src/server/core/matchmaking/matchAssemblyManager");
  let queued = [
    {
      ...ticket(1, 800),
      status: "queued",
      mode_id: "duels",
      mode_variant_id: "duels-3v3",
      map: 1,
      claimed_by: null,
    },
  ];
  const inserts = [],
    ready = [],
    notifications = [];
  const user = {
    user_id: 1,
    name: "RealPlayer",
    char_class: "ninja",
    char_levels: '{"ninja":3}',
    trophies: 800,
  };
  let mutex = Promise.resolve();
  const query = async (sql, params) => {
    if (sql.startsWith("SELECT * FROM match_tickets"))
      return queued.map((t) => ({ ...t }));
    if (sql.includes("FROM users WHERE user_id =")) return [{ ...user }];
    if (sql.startsWith("INSERT INTO matches")) {
      inserts.push({ sql, params });
      return { insertId: 10 };
    }
    if (sql.startsWith("INSERT")) {
      inserts.push({ sql, params });
      return { affectedRows: 1 };
    }
    if (sql.startsWith("DELETE FROM match_tickets")) {
      queued = [];
      return { affectedRows: 1 };
    }
    if (sql.startsWith("SELECT user_id, socket_id"))
      return [{ user_id: 1, socket_id: "human" }];
    throw new Error("Unexpected query: " + sql);
  };
  const db = {
    runQuery: query,
    withTransaction(fn) {
      const result = mutex.then(() => fn(null, query));
      mutex = result.catch(() => {});
      return result;
    },
  };
  const manager = createMatchAssemblyManager({
    db,
    io: {
      sockets: {
        sockets: new Map([
          ["human", { emit: (...args) => notifications.push(args) }],
        ]),
      },
    },
    partyStatus: { READY_CHECK: "ready_check" },
    lastProgress: new Map(),
    readyCheckCoordinator: { startReadyCheck: (...args) => ready.push(args) },
  });
  const picks = [{ ticket: queued[0], flip: false }];
  const results = await Promise.all(
    [1, 2].map(() =>
      manager.assembleAndReady("duels", "duels-3v3", 1, picks, {
        teamSize: 3,
        fillBots: true,
        seed: 1,
      }),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    inserts.filter((q) => q.sql.startsWith("INSERT INTO users")).length,
    0,
  );
  assert.equal(
    inserts.filter((q) =>
      q.sql.startsWith("INSERT INTO match_bot_participants"),
    ).length,
    5,
  );
  assert.deepEqual(ready, [[10, [1]]]);
  assert.equal(notifications.length, 1);
});

test("cancelled tickets cannot produce a bot match", async () => {
  const {
    createMatchAssemblyManager,
  } = require("../src/server/core/matchmaking/matchAssemblyManager");
  const manager = createMatchAssemblyManager({
    db: { withTransaction: (fn) => fn(null, async () => []) },
  });
  const result = await manager.assembleAndReady(
    "duels",
    "duels-1v1",
    1,
    [{ ticket: ticket(1, 500), flip: false }],
    { teamSize: 1, fillBots: true },
  );
  assert.equal(result, null);
});

test("bot results retain combat stats, but only human accounts receive normal rewards", async () => {
  const {
    distributeMatchRewards,
  } = require("../src/server/core/gameRoom/rewardManager");
  const h = makeRoom();
  const [human, bot] = h.players;
  human.isBot = false;
  human.user_id = 42;
  h.room._recordCombatStat(human, { hits: 3, damage: 4000, kills: 1 });
  h.room._recordCombatStat(bot, { hits: 2, damage: 2000 });
  const results = await distributeMatchRewards(h.room, human.team);
  const humanResult = results.find((r) => r.username === human.name);
  const botResult = results.find((r) => r.username === bot.name);
  assert.ok(humanResult.coinsAwarded > 0 && humanResult.trophiesDelta > 0);
  assert.equal(botResult.damage, 2000);
  assert.equal(botResult.coinsAwarded, 0);
  assert.equal(botResult.trophiesDelta, 0);
  const updates = h.queries.filter((q) => q.sql.startsWith("UPDATE users"));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params.at(-1), 42);
  h.room.cleanup();
});

test("melee bots reach one another instead of stalling behind a takeoff ledge guard", () => {
  const originalNow = Date.now;
  let clock = 1000000;
  Date.now = () => clock;
  try {
    const h = makeRoom({
      map: 1,
      characters: ["thorg", "thorg"],
      trophies: 2000,
      seed: 17,
    });
    for (let i = 0; i < 2700; i++) {
      clock += 1000 / 60;
      h.tick(clock);
    }
    const damage = [...h.room.rewardStats.values()].reduce(
      (sum, stat) => sum + stat.damage,
      0,
    );
    assert.ok(damage > 0, "a melee fight starts within 45 seconds");
    h.room.cleanup();
  } finally {
    Date.now = originalNow;
  }
});

test("cleanup removes only this room’s socket listeners and releases bot roster state", () => {
  const { EventEmitter } = require("node:events");
  const h = makeRoom(),
    socket = new EventEmitter();
  socket.id = "human";
  const external = () => {};
  socket.on("game:action", external);
  h.room.setupPlayerSocket(socket);
  assert.equal(socket.listenerCount("game:action"), 2);
  h.room.cleanup();
  assert.deepEqual(socket.listeners("game:action"), [external]);
  assert.equal(socket.listenerCount("game:chat:send"), 0);
  assert.equal(h.room.matchData.players.length, 0);
});
