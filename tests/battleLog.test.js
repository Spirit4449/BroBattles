const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatModeLabel,
  recordMatchOutcome,
  getBattleLogForUser,
} = require("../src/server/helpers/battleLog");

test("formatModeLabel returns friendly readable mode labels", () => {
  assert.equal(formatModeLabel("duels", "duels-1v1"), "1v1 Duel");
  assert.equal(formatModeLabel("duels", "duels-2v2"), "2v2 Duel");
  assert.equal(formatModeLabel("duels", "duels-3v3"), "3v3 Duel");
  assert.equal(formatModeLabel("bank-bust", "bank-bust-3v3"), "Bank Bust 3v3");
});

test("recordMatchOutcome writes summary JSON and updates participants", async () => {
  const executedQueries = [];
  const mockDb = {
    async runQuery(sql, params) {
      executedQueries.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };

  const room = {
    matchId: 42,
    matchData: {
      modeId: "duels",
      modeVariantId: "duels-1v1",
      map: 2,
    },
    players: new Map([
      [
        "PlayerOne",
        {
          user_id: 101,
          name: "PlayerOne",
          team: "team1",
          char_class: "ninja",
          profile_icon_id: "ninja",
          isBot: false,
        },
      ],
      [
        "BotOpponent",
        {
          user_id: null,
          name: "BotOpponent",
          team: "team2",
          char_class: "thorg",
          profile_icon_id: "thorg",
          isBot: true,
        },
      ],
    ]),
  };

  const rewardSummary = [
    {
      username: "PlayerOne",
      team: "team1",
      kills: 2,
      damage: 850,
      hits: 12,
      trophiesDelta: 16,
      coinsAwarded: 50,
      gemsAwarded: 2,
    },
    {
      username: "BotOpponent",
      team: "team2",
      kills: 0,
      damage: 320,
      hits: 5,
      trophiesDelta: 0,
      coinsAwarded: 0,
      gemsAwarded: 0,
    },
  ];

  const summary = await recordMatchOutcome(mockDb, room, "team1", rewardSummary);

  assert.ok(summary);
  assert.equal(summary.matchId, 42);
  assert.equal(summary.winnerTeam, "team1");
  assert.equal(summary.players.length, 2);
  assert.equal(summary.players[0].name, "PlayerOne");
  assert.equal(summary.players[0].kills, 2);
  assert.equal(summary.players[0].trophiesDelta, 16);
  assert.equal(summary.players[1].name, "BotOpponent");
  assert.equal(summary.players[1].isBot, true);

  assert.ok(executedQueries.some((q) => q.sql.includes("UPDATE matches SET status = 'completed'")));
  assert.ok(executedQueries.some((q) => q.sql.includes("UPDATE match_participants")));
});

test("getBattleLogForUser parses summary and provides modeArt, mapBanner, and player details", async () => {
  const summaryData = {
    matchId: 99,
    modeId: "duels",
    modeVariantId: "duels-1v1",
    mapId: 1,
    winnerTeam: "team1",
    completedAt: "2026-09-03T04:00:00.000Z",
    players: [
      {
        userId: 101,
        name: "PlayerOne",
        team: "team1",
        charClass: "ninja",
        profileIconId: "ninja",
        isBot: false,
        kills: 3,
        damage: 1200,
        hits: 15,
        trophiesDelta: 18,
        coinsAwarded: 60,
        gemsAwarded: 3,
      },
      {
        userId: null,
        name: "BotTwo",
        team: "team2",
        charClass: "wizard",
        profileIconId: "wizard",
        isBot: true,
        kills: 1,
        damage: 600,
        hits: 7,
        trophiesDelta: 0,
      },
    ],
  };

  const mockDb = {
    async runQuery(sql) {
      if (sql.includes("FROM match_participants") && sql.includes("matches")) {
        return [
          {
            match_id: 99,
            mode: 1,
            mode_id: "duels",
            mode_variant_id: "duels-1v1",
            map: 1,
            status: "completed",
            winner_team: "team1",
            created_at: "2026-09-03T04:00:00.000Z",
            summary: JSON.stringify(summaryData),
            player_team: "team1",
            player_char_class: "ninja",
            player_trophies_delta: 18,
            player_kills: 3,
            player_damage: 1200,
            player_hits: 15,
            player_coins_awarded: 60,
            player_gems_awarded: 3,
          },
        ];
      }
      return [];
    },
  };

  const battles = await getBattleLogForUser(mockDb, 101, 10);
  assert.equal(battles.length, 1);
  const battle = battles[0];

  assert.equal(battle.matchId, 99);
  assert.equal(battle.outcome, "victory");
  assert.equal(battle.trophiesDelta, 18);
  assert.equal(battle.modeLabel, "1v1 Duel");
  assert.equal(battle.mapLabel, "Lushy Peaks");
  assert.ok(battle.mapBanner.includes("/assets/"));
  assert.ok(battle.modeArt.includes("/assets/"));

  assert.equal(battle.player.name, "PlayerOne");
  assert.equal(battle.player.charClass, "ninja");
  assert.equal(battle.playerStats.kills, 3);
  assert.equal(battle.playerStats.damage, 1200);
  assert.equal(battle.playerStats.coinsAwarded, 60);
  assert.equal(battle.playerStats.gemsAwarded, 3);
});

test("getBattleLogForUser handles defeat and negative trophies", async () => {
  const summaryData = {
    matchId: 100,
    modeId: "duels",
    modeVariantId: "duels-1v1",
    mapId: 2,
    winnerTeam: "team2",
    players: [
      {
        userId: 101,
        name: "PlayerOne",
        team: "team1",
        charClass: "huntress",
        profileIconId: "huntress",
        isBot: false,
        kills: 0,
        damage: 400,
        hits: 6,
        trophiesDelta: -12,
      },
      {
        userId: 102,
        name: "Opponent",
        team: "team2",
        charClass: "draven",
        profileIconId: "draven",
        isBot: false,
        kills: 1,
        damage: 1000,
        hits: 11,
        trophiesDelta: 15,
      },
    ],
  };

  const mockDb = {
    async runQuery(sql) {
      if (sql.includes("FROM match_participants") && sql.includes("matches")) {
        return [
          {
            match_id: 100,
            mode: 1,
            mode_id: "duels",
            mode_variant_id: "duels-1v1",
            map: 2,
            status: "completed",
            winner_team: "team2",
            created_at: "2026-09-03T04:00:00.000Z",
            summary: JSON.stringify(summaryData),
            player_team: "team1",
            player_char_class: "huntress",
            player_trophies_delta: -12,
            player_kills: 0,
            player_damage: 400,
            player_hits: 6,
          },
        ];
      }
      return [];
    },
  };

  const battles = await getBattleLogForUser(mockDb, 101, 10);
  assert.equal(battles.length, 1);
  const battle = battles[0];

  assert.equal(battle.matchId, 100);
  assert.equal(battle.outcome, "defeat");
  assert.equal(battle.trophiesDelta, -12);
  assert.equal(battle.mapLabel, "Mangrove Meadow");
});

test("getBattleLogForUser handles historical matches without summary", async () => {
  const mockDb = {
    async runQuery(sql) {
      if (sql.includes("FROM match_participants") && sql.includes("matches")) {
        return [
          {
            match_id: 50,
            mode: 1,
            mode_id: "duels",
            mode_variant_id: "duels-1v1",
            map: 1,
            status: "completed",
            winner_team: "team1",
            created_at: "2026-09-01T12:00:00.000Z",
            summary: null,
            player_team: "team1",
            player_char_class: "ninja",
            player_trophies_delta: 0,
            player_kills: 0,
            player_damage: 0,
            player_hits: 0,
          },
        ];
      }
      if (sql.includes("FROM match_participants") && sql.includes("users")) {
        return [
          {
            match_id: 50,
            user_id: 101,
            team: "team1",
            char_class: "ninja",
            name: "PlayerOne",
            profile_icon_id: "ninja",
          },
          {
            match_id: 50,
            user_id: 105,
            team: "team2",
            char_class: "wizard",
            name: "PlayerTwo",
            profile_icon_id: "wizard",
          },
        ];
      }
      if (sql.includes("FROM match_bot_participants")) {
        return [];
      }
      return [];
    },
  };

  const battles = await getBattleLogForUser(mockDb, 101, 10);
  assert.equal(battles.length, 1);
  const battle = battles[0];

  assert.equal(battle.matchId, 50);
  assert.equal(battle.outcome, "victory");
  assert.equal(battle.trophiesDelta, 0); // A recorded zero must not become an estimate.
  assert.equal(battle.player.name, "PlayerOne");
  assert.equal(battle.player.charClass, "ninja");
});

test("getBattleLogForUser returns empty array when no completed matches", async () => {
  const mockDb = {
    async runQuery() {
      return [];
    },
  };
  const battles = await getBattleLogForUser(mockDb, 999, 10);
  assert.deepEqual(battles, []);
});

test("legacy schema preserves the winner and available participant stats", async () => {
  const db = { async runQuery(sql) {
    if (sql.includes("m.summary")) throw Object.assign(new Error("Missing column"), { code: "ER_BAD_FIELD_ERROR" });
    if (sql.includes("JOIN matches")) return [{ match_id: 77, mode: 1, map: 1, winner_team: "team2", player_team: "team1" }];
    if (sql.includes("LEFT JOIN users")) return [{ match_id: 77, user_id: 101, name: "Hero", team: "team1", kills: 1, damage: 840, trophies_delta: -8 }];
    return [];
  }};
  const [battle] = await getBattleLogForUser(db, 101);
  assert.equal(battle.outcome, "defeat");
  assert.equal(battle.trophiesDelta, -8);
  assert.deepEqual(battle.playerStats, { kills: 1, damage: 840, hits: null, coinsAwarded: null, gemsAwarded: null });
});

test("unrecorded history is unknown, not a draw or invented zero", async () => {
  const db = { async runQuery(sql) {
    return sql.includes("JOIN matches") ? [{ match_id: 78, mode: 1, map: 1, player_team: "team1" }] : [];
  }};
  const [battle] = await getBattleLogForUser(db, 101);
  assert.equal(battle.outcome, "unknown");
  assert.equal(battle.trophiesDelta, null);
  assert.equal(battle.playerStats.kills, null);
});

test("a missing participant column does not discard a saved match summary", async () => {
  const db = { async runQuery(sql) {
    if (sql.includes("mp.gems_awarded")) throw Object.assign(new Error("Missing column"), { code: "ER_BAD_FIELD_ERROR" });
    if (sql.includes("JOIN matches")) return [{
      match_id: 77, player_team: "team1", summary: JSON.stringify({
        winnerTeam: "team1", players: [{ userId: 101, name: "Hero", team: "team1", kills: 2, damage: 900, hits: 8, trophiesDelta: 16 }],
      }),
    }];
    return [];
  }};
  const [battle] = await getBattleLogForUser(db, 101);
  assert.equal(battle.outcome, "victory");
  assert.equal(battle.playerStats.damage, 900);
  assert.equal(battle.trophiesDelta, 16);
});

test("explicit draws and zero stats survive summary round-trip", async () => {
  let saved;
  const room = { matchId: 79, players: new Map([["p", { user_id: 101, name: "Hero", team: "team1" }]]) };
  await recordMatchOutcome({ async runQuery(sql, params) {
    if (sql.includes("summary =")) saved = params[1];
    return [];
  }}, room, null, [{ username: "Hero", kills: 0, damage: 0, hits: 0, trophiesDelta: 0 }]);
  const [battle] = await getBattleLogForUser({ async runQuery() {
    return [{ match_id: 79, summary: saved, player_team: "team1", player_kills: 99, player_trophies_delta: 20 }];
  }}, 101);
  assert.equal(battle.outcome, "draw");
  assert.equal(battle.playerStats.kills, 0);
  assert.equal(battle.trophiesDelta, 0);
});

test("combat stats are retained even when reward distribution fails", async () => {
  const summary = await recordMatchOutcome({ async runQuery() { return []; } }, {
    matchId: 80,
    players: new Map([["p", { user_id: 101, name: "Hero", team: "team1" }]]),
    rewardStats: new Map([["Hero", { kills: 2, damage: 900, hits: 8 }]]),
  }, "team1");
  assert.equal(summary.players[0].damage, 900);
  assert.equal(summary.players[0].trophiesDelta, null);
});

test("non-schema database failures are not hidden by fallback writes", async () => {
  await assert.rejects(recordMatchOutcome({ async runQuery() { throw new Error("Connection lost"); } }, {
    matchId: 80, players: new Map(),
  }, "team1"), /Connection lost/);
});

test("finishing a game persists results before game-over and bot cleanup, once only", async (t) => {
  const { finishGame } = require("../src/server/core/gameRoom/lifecycleManager");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "log", () => {});
  const events = [];
  const room = {
    matchId: 81, status: "active", _scheduledActions: [], botControllers: new Map(),
    players: new Map([
      ["human", { user_id: 101, name: "Hero", team: "team1" }],
      ["bot", { name: "Bot", team: "team2", isBot: true }],
    ]),
    db: { async runQuery(sql, params) {
      if (sql.includes("summary =")) events.push({ type: "save", summary: JSON.parse(params[1]) });
      if (sql.includes("DELETE FROM match_bot_participants")) events.push({ type: "cleanup" });
      return [];
    } },
    io: { to() { return { emit(type) { events.push({ type }); } }; } },
    async _broadcastParticipantStatus() {},
    async _distributeMatchRewards() { return [{ username: "Hero", kills: 2, damage: 950, hits: 12, trophiesDelta: 18 }]; },
  };
  await finishGame(room, "team1");
  await finishGame(room, "team1");
  assert.deepEqual(events.map((event) => event.type), ["save", "game:over", "cleanup"]);
  assert.equal(events[0].summary.winnerTeam, "team1");
  assert.equal(events[0].summary.players.length, 2);
  assert.equal(events[0].summary.players[0].damage, 950);
});

test("renderer distinguishes unavailable stats from real zeros and escapes names", async () => {
  const { transformFileSync } = require("@babel/core");
  const vm = require("node:vm");
  const compiled = transformFileSync(require.resolve("../src/lib/battleLogView.js"), {
    presets: [["@babel/preset-env", { targets: { node: "current" } }]],
  });
  const context = { exports: {}, require: () => ({ buildProfileIconUrl: () => "/assets/profile-icons/ninja.webp" }) };
  vm.runInNewContext(compiled.code, context);
  const { renderBattleLog } = context.exports;
  const container = {};
  renderBattleLog(container, [{ matchId: 1, outcome: "unknown", player: { name: '<img src=x onerror=alert(1)>' }, playerStats: {} }]);
  assert.match(container.innerHTML, /UNAVAILABLE/);
  assert.match(container.innerHTML, /1 result unavailable/);
  assert.doesNotMatch(container.innerHTML, /DRAW|1D|onerror=alert\(1\)>/);
  assert.match(container.innerHTML, /chip-val kills">—/);
  renderBattleLog(container, [{ matchId: 2, outcome: "draw", trophiesDelta: 0, playerStats: { kills: 0, damage: 0, hits: 0 } }]);
  assert.match(container.innerHTML, /DRAW/);
  assert.match(container.innerHTML, /chip-val kills">0/);
  assert.doesNotMatch(container.innerHTML, /unavailable/);
});
