const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Human seating", () => {
  const { normalizePartySlots, movePartyMember } = require('../src/server/services/party/partySlots');
  const { registerPartyEvents } = require('../src/server/core/socketEvents/partyEvents');
  const { PARTY_STATUS } = require('../src/server/services/party/partyRules');
  const { setPartyBotSlot, prunePartyBotSlots, clearPartyBotSlots } = require('../src/server/services/party/partyBotSlots');
  const members = [
    { name: 'Owner', team: 'team1', slot_index: 0 },
    { name: 'Friend', team: 'team2', slot_index: 0 },
  ];
  test('saved seats survive new members, gaps, and different roster order', () => {
    const saved = [{ name: 'A', team: 'team1', slot_index: 1 }, { name: 'B', team: 'team1', slot_index: null }];
    assert.deepEqual(normalizePartySlots(saved, 2).map(m => m.slot_index), [1, 0]);
    assert.deepEqual(normalizePartySlots([...saved].reverse(), 2).map(m => m.slot_index), [0, 1]);
    assert.equal(normalizePartySlots(saved.slice(0, 1), 2)[0].slot_index, 1);
    assert.equal(normalizePartySlots(saved.slice(0, 1), 1)[0].slot_index, 0);
  });
  test('move to empty seat and swap across full teams preserve unique positions', () => {
    const swapped = movePartyMember(members, { name: 'Owner', team: 'team2', index: 0 }, 1);
    assert.deepEqual(swapped.map(m => m.team), ['team2', 'team1']);
    const moved = movePartyMember(members, { name: 'Owner', team: 'team2', index: 1 }, 2);
    assert.deepEqual(moved.map(m => m.slot_index), [1, 0]);
    assert.deepEqual(members.map(m => m.team), ['team1', 'team2']);
    for (const index of [-1, 2, 0.5, '0']) assert.throws(() => movePartyMember(members, { name: 'Owner', team: 'team1', index }, 2));
    assert.throws(() => movePartyMember(members, { name: 'Missing', team: 'team1', index: 0 }, 2));
  });
  test('bots use actual occupied seats instead of member counts', () => {
    setPartyBotSlot(8901, { team: 'team1', index: 0, character: 'shuffle' });
    assert.equal(prunePartyBotSlots(8901, { teamSize: 2, members: [{ team: 'team1', slot_index: 1 }] }).length, 1);
    clearPartyBotSlots(8901);
  });
  function fixture({ actor = 'Owner', status = 'idle', ready = false } = {}) {
    let rows = members.map(m => ({ ...m }));
    let broadcasts = 0;
    const handlers = {};
    const db = { withTransaction: async fn => fn(null, async (sql, args) => {
      if (sql.startsWith('SELECT * FROM parties')) return [{ status, mode: 1 }];
      if (sql.startsWith('SELECT name, team')) return rows;
      if (sql.startsWith('SELECT u.name')) return ready ? [{ name: 'Friend' }] : [];
      if (sql.startsWith('UPDATE party_members')) { const m = rows.find(m => m.name === args[3]); m.team = args[0]; m.slot_index = args[1]; return {}; }
      throw Error(sql);
    }) };
    registerPartyEvents({ data: { user: { name: actor } }, on: (event, fn) => handlers[event] = fn }, { db, PARTY_STATUS, partyPresence: { emitPartyRosterById: async () => { broadcasts++; } } });
    return { async move() { let reply; await handlers['party:slot:move']({ partyId: 9, name: 'Friend', team: 'team1', index: 0 }, value => reply = value); return reply; }, get broadcasts() { return broadcasts; }, get rows() { return rows; } };
  }
  test('server authorizes owner, commits swap, and broadcasts shared roster', async () => {
    const f = fixture();
    assert.equal((await f.move()).ok, true);
    assert.deepEqual(f.rows.map(m => m.team), ['team2', 'team1']);
    assert.equal(f.broadcasts, 1);
  });
  test('server rejects non-owner, ready players, and active matches', async () => {
    for (const options of [{ actor: 'Friend' }, { actor: 'Outsider' }, { ready: true }, { status: 'queued' }, { status: 'live' }]) {
      const f = fixture(options);
      assert.equal((await f.move()).ok, false);
      assert.equal(f.broadcasts, 0);
      assert.deepEqual(f.rows, members);
    }
  });

  test('every two-player seating survives resizing between duel sizes', () => {
    const { resizePartySlots } = require('../src/server/services/party/partySlots');
    for (const from of [1, 2, 3]) for (const to of [1, 2, 3]) {
      const seats = ['team1', 'team2'].flatMap(team => Array.from({ length: from }, (_, slot_index) => ({ team, slot_index })));
      for (let a = 0; a < seats.length; a++) for (let b = a + 1; b < seats.length; b++) {
        const original = [{ name: 'A', ...seats[a] }, { name: 'B', ...seats[b] }];
        const next = resizePartySlots(original, to);
        assert.equal(next.length, 2);
        assert.equal(new Set(next.map(m => `${m.team}:${m.slot_index}`)).size, 2);
        assert.ok(next.every(m => m.slot_index >= 0 && m.slot_index < to));
        if (to >= from) assert.deepEqual(next, original);
      }
    }
    assert.throws(() => resizePartySlots([...members, { name: 'Third', team: 'team1', slot_index: 1 }], 1), /Too many players/);
  });
});

describe("Configured bot seats", () => {
  const {
    getPartyBotSlots,
    setPartyBotSlot,
    prunePartyBotSlots,
    clearPartyBotSlots,
  } = require("../src/server/services/party/partyBotSlots");

  test("party bot slots support shuffle, a fighter, and returning to random", () => {
    clearPartyBotSlots(7001);
    setPartyBotSlot(7001, { team: "team1", index: 1, character: "shuffle" });
    setPartyBotSlot(7001, { team: "team2", index: 0, character: "ozzy" });
    assert.deepEqual(getPartyBotSlots(7001), [
      { team: "team1", index: 1, character: "shuffle" },
      { team: "team2", index: 0, character: "ozzy" },
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
          selected_card_id: "radiant-silver",
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
        botSlots: [{ team: "team2", index: 0, character: "ozzy" }],
      }],
      { teamSize: 1, seed: 3 },
    );
    assert.equal(result.players.length, 2);
    assert.equal(result.players.find(player => !player.isBot).selected_card_id, "radiant-silver");
    assert.equal(botInserts.length, 1);
    assert.equal(botInserts[0][4], "ozzy");
  });
});
