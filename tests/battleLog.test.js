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
  assert.equal(battle.trophiesDelta, 20); // Fallback estimate
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
