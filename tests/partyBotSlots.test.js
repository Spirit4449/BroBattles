const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPartyBotSlots,
  setPartyBotSlot,
  prunePartyBotSlots,
  clearPartyBotSlots,
} = require("../src/server/helpers/partyBotSlots");

test("party bot slots support shuffle, a fighter, and returning to random", () => {
  clearPartyBotSlots(7001);
  setPartyBotSlot(7001, { team: "team1", index: 1, character: "shuffle" });
  setPartyBotSlot(7001, { team: "team2", index: 0, character: "wizard" });
  assert.deepEqual(getPartyBotSlots(7001), [
    { team: "team1", index: 1, character: "shuffle" },
    { team: "team2", index: 0, character: "wizard" },
  ]);
  setPartyBotSlot(7001, { team: "team2", index: 0, character: "random" });
  assert.deepEqual(getPartyBotSlots(7001), [
    { team: "team1", index: 1, character: "shuffle" },
  ]);
  clearPartyBotSlots(7001);
});

test("party bot slots are removed when a player occupies them or mode shrinks", () => {
  clearPartyBotSlots(7002);
  setPartyBotSlot(7002, { team: "team1", index: 2, character: "ninja" });
  setPartyBotSlot(7002, { team: "team2", index: 1, character: "gloop" });
  assert.deepEqual(
    prunePartyBotSlots(7002, {
      teamSize: 2,
      members: [{ team: "team2" }, { team: "team2" }],
    }),
    [],
  );
});

test("party bot slots reject unknown fighters", () => {
  assert.throws(
    () => setPartyBotSlot(7003, { team: "team1", index: 0, character: "nope" }),
    /Invalid bot selection/,
  );
});

test("configured party bot fighter is used by match assembly", async () => {
  const { createMatchAssemblyManager } = require("../src/server/core/matchmaking/matchAssemblyManager");
  const ticket = {
    ticket_id: 81,
    party_id: 44,
    user_id: null,
    size: 2,
    team1_count: 1,
    team2_count: 1,
    mode_id: "duels",
    mode_variant_id: "duels-1v1",
    map: 1,
    status: "queued",
    claimed_by: null,
    created_at: new Date(),
  };
  const botInserts = [];
  const query = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM match_tickets")) return [{ ...ticket }];
    if (sql.includes("FROM party_members pm JOIN users")) {
      return [{
        user_id: 7,
        name: "Human",
        char_class: "ninja",
        char_levels: '{"ninja":2}',
        trophies: 500,
        party_id: 44,
        team: "team1",
      }];
    }
    if (sql.startsWith("INSERT INTO matches")) return { insertId: 91 };
    if (sql.startsWith("INSERT INTO match_bot_participants")) {
      botInserts.push(params);
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT INTO match_participants") || sql.startsWith("DELETE FROM match_tickets") || sql.startsWith("UPDATE parties")) {
      return { affectedRows: 1 };
    }
    if (sql.startsWith("SELECT user_id, socket_id")) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const manager = createMatchAssemblyManager({
    db: { runQuery: query, withTransaction: (fn) => fn(null, query) },
    io: { sockets: { sockets: new Map() } },
    partyStatus: { READY_CHECK: "ready_check" },
    lastProgress: new Map(),
    readyCheckCoordinator: { startReadyCheck() {} },
  });
  const result = await manager.assembleAndReady(
    "duels",
    "duels-1v1",
    1,
    [{
      ticket,
      flip: false,
      botSlots: [{ team: "team2", index: 0, character: "wizard" }],
    }],
    { teamSize: 1, seed: 3 },
  );
  assert.equal(result.players.length, 2);
  assert.equal(botInserts.length, 1);
  assert.equal(botInserts[0][4], "wizard");
});
