const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Readiness lifecycle", () => {
  const { registerPartyEvents } = require('../src/server/core/socketEvents/partyEvents');
  const { registerPresenceEvents } = require('../src/server/core/socketEvents/presenceEvents');
  const { createPartyQueueTransitionService } = require('../src/server/services/party/partyQueueTransitionService');
  const { PARTY_STATUS } = require('../src/server/services/party/partyRules');

  function fixture(names = ['Owner'], gameHub = undefined) {
    const party = { party_id: 7, status: 'idle', mode: 1, map: 1 };
    const members = names.map(name => ({ name, status: 'online', team: 'team1' }));
    const events = [];
    let joins = 0, ticket = false, failJoin = false;
    const db = {
      getPartyIdByName: async name => members.some(m => m.name === name) ? 7 : null,
      fetchPartyMembersDetailed: async () => members.map(m => ({ ...m })),
      setPartyStatus: async (_, status) => { party.status = status; },
      setUserStatus: async (name, status) => { members.find(m => m.name === name).status = status; },
      async runQuery(sql, params) {
        if (sql.includes("FROM legal_acceptances")) return [{}];
        if (sql.startsWith('SELECT * FROM parties')) return [{ ...party }];
        if (sql.startsWith('SELECT status FROM parties')) return [{ status: party.status }];
        if (sql.startsWith('SELECT 1 FROM match_tickets')) return ticket ? [{}] : [];
        if (sql.includes('FROM matches')) return [];
        if (sql.startsWith('SELECT 1 FROM party_members')) return members.some(m => m.name === params[1]) ? [{}] : [];
        if (sql.startsWith('SELECT status FROM users')) return [{ status: members.find(m => m.name === params[0]).status }];
        if (sql.startsWith('SELECT * FROM users')) {
          const member = members.find(m => m.name === params[0] || Number(params[0]) === 1);
          return member ? [{ user_id: 1, char_class: 'ninja', char_levels: { ninja: 1 }, ...member }] : [];
        }
        if (sql.startsWith('UPDATE parties SET status')) { party.status = 'idle'; return {}; }
        throw new Error(sql);
      },
    };
    const io = { to: () => ({ emit: (event, data) => events.push({ event, data }) }) };
    const mm = {
      queueJoin: async () => { joins++; await new Promise(resolve => setImmediate(resolve)); if (failJoin) throw new Error('Queue unavailable'); ticket = true; },
      queueLeave: async () => { ticket = false; },
      handleDisconnect: async () => { ticket = false; },
    };
    const partyQueueTransition = createPartyQueueTransitionService({ db, io, mm });
    const partyPresence = {
      setUserPresence: async (name, status) => { await db.setUserStatus(name, status); },
      emitPartyRosterById: async () => { events.push({ event: 'roster', data: members.map(m => ({ ...m })) }); },
    };
    function client(name) {
      const handlers = {};
      const socket = { data: { user: { name, user_id: 1 } }, on: (event, handler) => { handlers[event] = handler; } };
      registerPartyEvents(socket, { db, io, mm, partyPresence, partyQueueTransition, gameHub, PARTY_STATUS });
      return {
        handlers,
        ready: async (ready, partyId = 7) => { let reply; await handlers['ready:status']({ ready, partyId }, result => { reply = result; }); return reply; },
        changeCharacter: async (character = 'ninja') => { let reply; await handlers['char-change']({ partyId: 7, character }, result => { reply = result; }); return reply; },
      };
    }
    return { party, members, events, db, io, mm, partyQueueTransition, client, get joins() { return joins; }, fail() { failJoin = true; } };
  }

  test('a one-person party enters matchmaking on its first ready', async () => {
    const f = fixture();
    assert.deepEqual(await f.client('Owner').ready(true), { ok: true, ready: true });
    assert.equal(f.joins, 1);
    assert.equal(f.party.status, 'queued');
  });

  test('simultaneous ready requests enqueue exactly once and duplicates do not requeue', async () => {
    const f = fixture(['Owner', 'Member']);
    const a = f.client('Owner'), b = f.client('Member');
    await Promise.all([a.ready(true), b.ready(true), a.ready(true)]);
    assert.equal(f.joins, 1);
    assert.ok(f.members.every(m => m.status === 'ready'));
  });

  test('unready while idle only changes the requesting member', async () => {
    const f = fixture(['Owner', 'Member', 'Third']);
    await f.client('Owner').ready(true);
    await f.client('Member').ready(true);
    await f.client('Member').ready(false);
    assert.deepEqual(f.members.map(m => m.status), ['ready', 'online', 'online']);
    assert.equal(f.joins, 0);
  });

  test('cancel during an overlapping enqueue completes after enqueue and leaves party idle', async () => {
    const f = fixture();
    const a = f.client('Owner');
    await Promise.all([a.ready(true), a.ready(false)]);
    assert.equal(f.party.status, 'idle');
    assert.equal(f.members[0].status, 'online');
  });

  for (const status of ['queued', 'ready_check']) {
    test(`stale ${status} with no ticket or match recovers`, async () => {
      const f = fixture(); f.party.status = status;
      assert.equal((await f.client('Owner').ready(true)).ok, true);
      assert.equal(f.joins, 1);
    });
  }

  test('enqueue failure resets authoritative readiness and reports failure', async () => {
    const f = fixture(); f.fail();
    assert.equal((await f.client('Owner').ready(true)).ok, false);
    assert.equal(f.party.status, 'idle');
    assert.equal(f.members[0].status, 'online');
  });

  test('stale party IDs and nonmembers cannot change readiness', async () => {
    const f = fixture();
    assert.equal((await f.client('Owner').ready(true, 8)).ok, false);
    assert.equal((await f.client('Outsider').ready(true)).ok, false);
    assert.equal(f.joins, 0);
    assert.equal(f.members[0].status, 'online');
  });

  test('closing character menu cannot overwrite a later ready request', async () => {
    const f = fixture(['Owner', 'Member']);
    const a = f.client('Owner');
    await a.handlers['char-menu:status']({ partyId: 7, open: true });
    await a.ready(true);
    await a.handlers['char-menu:status']({ partyId: 7, open: false });
    assert.equal(f.members[0].status, 'ready');
    await a.handlers['char-menu:status']({ partyId: 7, open: true });
    assert.equal(f.members[0].status, 'ready');
  });

  test('a ready party member cannot change character through the socket', async () => {
    const f = fixture(['Owner', 'Member']);
    const owner = f.client('Owner');
    await owner.ready(true);
    assert.deepEqual(await owner.changeCharacter(), {
      ok: false,
      error: 'unready_before_character_change',
    });
  });

  test('idle disconnect preserves other members readiness', async () => {
    const f = fixture(['Owner', 'Member']);
    await f.client('Owner').ready(true);
    await f.partyQueueTransition.cancelForDisconnectedUser({ username: 'Member' });
    assert.deepEqual(f.members.map(m => m.status), ['ready', 'offline']);
    assert.ok(!f.events.some(e => e.event === 'match:cancelled'));
  });

  for (const event of ['client:bye', 'disconnect']) {
    test(`${event} from one of multiple sockets does not cancel the party`, async () => {
      let cancellations = 0;
      const handlers = {};
      const socket = { id: 'old', data: { user: { name: 'Owner', user_id: 1 } }, on: (name, fn) => { handlers[name] = fn; } };
      registerPresenceEvents(socket, {
        db: { clearUserSocketIfMatch: async () => {}, runQuery: async () => [] },
        userSockets: new Map([['Owner', new Set(['old', 'active'])]]), pendingOffline: new Map(),
        partyQueueTransition: { cancelForDisconnectedUser: async () => { cancellations++; } },
      });
      await handlers[event]();
      assert.equal(cancellations, 0);
    });
  }

  test('disconnect racing with enqueue removes the ticket after the ready transition', async () => {
    const f = fixture();
    await Promise.all([
      f.client('Owner').ready(true),
      f.partyQueueTransition.cancelForDisconnectedUser({ username: 'Owner' }),
    ]);
    assert.equal(f.party.status, 'idle');
    assert.equal(f.members[0].status, 'offline');
  });

  test('failed presence writes reject readiness instead of acknowledging success', async () => {
    const { createPartyPresenceService } = require('../src/server/services/party/partyPresenceService');
    const presence = createPartyPresenceService({ db: { setUserStatus: async () => { throw new Error('DB unavailable'); } }, io: {} });
    await assert.rejects(presence.setUserPresence('Owner', 'ready', 7, { strict: true }), /DB unavailable/);
  });

  test('an offline participant does not make a live battle cancellable from ready', async () => {
    const f = fixture(); f.party.status = 'live';
    const query = f.db.runQuery;
    f.db.runQuery = async (sql, params) => sql.includes('FROM matches') ? [{ match_id: 77 }] : query(sql, params);
    assert.equal((await f.client('Owner').ready(true)).ok, false);
    assert.equal(f.party.status, 'live');
    assert.equal(f.joins, 0);
  });

  test('ready recovers from an empty old battle and joins a new queue', async () => {
    const ended = [];
    const f = fixture(['Owner'], { endEmptyMatch: async id => { ended.push(id); return true; } });
    f.party.status = 'live';
    const query = f.db.runQuery;
    f.db.runQuery = async (sql, params) => sql.includes('FROM matches') ? [{ match_id: 77 }] : query(sql, params);
    assert.equal((await f.client('Owner').ready(true)).ok, true);
    assert.deepEqual(ended, [77]);
    assert.equal(f.party.status, 'queued');
    assert.equal(f.joins, 1);
  });

  test('first ready without accepted terms cannot enqueue, but unready still works', async () => {
    const f = fixture(); const query = f.db.runQuery;
    f.db.runQuery = (sql, params) => sql.includes('FROM legal_acceptances') ? Promise.resolve([]) : query(sql, params);
    const response = await f.client('Owner').ready(true);
    assert.equal(response.ok, false);
    assert.equal(f.joins, 0);
    assert.equal((await f.client('Owner').ready(false)).ok, true);
  });

  test('unready after assembly preserves readiness and emits no cancellation', async () => {
    const f = fixture();
    await f.client('Owner').ready(true);
    f.party.status = 'ready_check';
    f.mm.queueLeave = async () => ({ cancelled: false, matchId: 77 });
    const query = f.db.runQuery;
    f.db.runQuery = (sql, params) => sql.includes('FROM matches') ? Promise.resolve([{ match_id: 77 }]) : query(sql, params);
    const result = await f.client('Owner').ready(false);
    assert.deepEqual(result, { ok: true, ready: true, cancelled: false, matchId: 77 });
    assert.equal(f.party.status, 'ready_check');
    assert.equal(f.members[0].status, 'ready');
    assert.ok(!f.events.some(event => event.event === 'match:cancelled'));
  });

  test('queue cancellation does not bring offline members back online', async () => {
    const f = fixture(['Owner', 'Offline', 'Ready']);
    f.members[1].status = 'offline';
    f.members[2].status = 'ready';
    await f.partyQueueTransition.cancelPartyQueue({partyId:7, reason:'test'});
    assert.deepEqual(f.members.map(m => m.status), ['online','offline','online']);
    assert.equal(f.events.some(event => event.event === 'status:update' && event.data.name === 'Offline'), false);
  });

  test('queued disconnect preserves other offline members', async () => {
    const f = fixture(['Owner', 'Offline', 'Ready']);
    f.party.status = 'queued';
    f.members[1].status = 'offline';
    f.members[2].status = 'ready';
    await f.partyQueueTransition.cancelForDisconnectedUser({username:'Owner'});
    assert.deepEqual(f.members.map(m => m.status), ['offline','offline','online']);
  });
});

describe("Discovery and join visibility", () => {
  const { test, describe } = require('node:test');


  describe("Discovery ranking", () => {
    const {
      createPartyRouteService,
    } = require("../src/server/services/party/partyRouteService");

    test("public parties are ranked by average trophy distance", async () => {
      const rows = [
        {
          party_id: 1,
          public_name: "Far",
          party_status: "idle",
          party_battle_count: 0,
          mode_id: "duels",
          mode_variant_id: "duels-2v2",
          name: "A",
          status: "online",
          trophies: 50,
          is_owner: 1,
        },
        {
          party_id: 2,
          public_name: "Close",
          party_status: "idle",
          party_battle_count: 3,
          mode_id: "duels",
          mode_variant_id: "duels-2v2",
          name: "B",
          status: "online",
          trophies: 480,
          is_owner: 1,
        },
        {
          party_id: 2,
          public_name: "Close",
          party_status: "idle",
          party_battle_count: 3,
          mode_id: "duels",
          mode_variant_id: "duels-2v2",
          name: "C",
          status: "online",
          trophies: 520,
          is_owner: 0,
        },
      ];
      const db = { runQuery: async () => rows };
      const result = await createPartyRouteService({ db }).discoverPublicParties({
        requesterName: "Viewer",
        requesterTrophies: 550,
      });

      assert.equal(result.payload.parties[0].publicName, "Close");
      assert.equal(result.payload.parties[0].skillRating, 500);
      assert.equal(result.payload.parties[0].skillGap, 50);
      assert.equal(result.payload.parties[0].membersCount, 2);
      assert.equal(result.payload.parties[0].capacity, 4);
      assert.equal(result.payload.parties[0].activeMembers, 2);
      assert.equal(result.payload.parties[0].suggestionEligible, true);
      assert.equal(result.payload.parties[0].members[0].trophies, 480);
      assert.equal(result.payload.parties[1].publicName, "Far");
      assert.equal(result.payload.parties[1].suggestionEligible, false);
    });

    test("an active solo host with battle history can be suggested for 1v1", async () => {
      const db = {
        runQuery: async () => [
          {
            party_id: 3,
            public_name: "Need One",
            party_status: "idle",
            party_battle_count: 2,
            mode_id: "duels",
            mode_variant_id: "duels-1v1",
            name: "Host",
            status: "online",
            trophies: 700,
            is_owner: 1,
          },
        ],
      };
      const result = await createPartyRouteService({ db }).discoverPublicParties({
        requesterName: "Viewer",
        requesterTrophies: 680,
      });
      const party = result.payload.parties[0];

      assert.equal(party.membersCount, 1);
      assert.equal(party.capacity, 2);
      assert.equal(party.activeMembers, 1);
      assert.equal(party.suggestionEligible, true);
    });
  });

  describe("Join request visibility", () => {
    const { createPartyStateService } = require("../src/server/services/party/partyStateService");

    function fixture(socketId = "owner-socket") {
      const emissions = [];
      const request = {
        request_id: 10, party_id: 7, requester_user_id: 3,
        requester_name: "Requester", status: "pending", request_count: 1,
        requested_at: new Date(),
      };
      const conn = {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async query(sql) {
          if (sql.includes("SELECT * FROM parties")) return [[{ party_id: 7, is_public: 0 }]];
          if (sql.includes("SELECT 1 FROM party_members")) return [[]];
          if (sql.includes("FOR UPDATE")) return [[]];
          if (sql.includes("INSERT INTO party_join_requests")) return [{ affectedRows: 1 }];
          if (sql.includes("FROM party_join_requests")) return [[request]];
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      const db = {
        pool: { getConnection: async () => conn },
        async runQuery(sql, params) {
          assert.deepEqual(params, [7]);
          if (sql.includes("SELECT socket_id FROM users")) {
            assert.match(sql, /ORDER BY joined_at ASC, name ASC/);
            return socketId ? [{ socket_id: socketId }] : [];
          }
          if (sql.includes("FROM party_members")) return [{ name: "Owner" }];
          if (sql.includes("UPDATE party_join_requests")) return { affectedRows: 0 };
          if (sql.includes("FROM party_join_requests")) return [request];
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      const io = { to: (target) => ({ emit: (event, payload) => emissions.push({ target, event, payload }) }) };
      return { state: createPartyStateService({ db, io }), emissions };
    }

    test("new join requests are delivered only to the owner's socket", async () => {
      const { state, emissions } = fixture();
      const result = await state.submitJoinRequest({ partyId: 7, requesterUserId: 3, requesterName: "Requester" });
      assert.equal(result.ok, true);
      assert.equal(emissions.length, 1);
      assert.equal(emissions[0].target, "owner-socket");
      assert.equal(emissions[0].event, "party:join-request");
      assert.equal(emissions[0].payload.requesterName, "Requester");
    });

    test("an offline owner does not cause requests to be broadcast to members", async () => {
      const { state, emissions } = fixture(null);
      const result = await state.submitJoinRequest({ partyId: 7, requesterUserId: 3, requesterName: "Requester" });
      assert.equal(result.ok, true);
      assert.deepEqual(emissions, []);
    });

    for (const actorName of ["Owner", "Member", "Outsider"]) {
      test(`pending request visibility for ${actorName}`, async () => {
        const { state } = fixture();
        const result = await state.getPendingJoinRequests({ partyId: 7, actorName });
        if (actorName === "Owner") {
          assert.equal(result.ok, true);
          assert.equal(result.payload.requests[0].requesterName, "Requester");
        } else {
          assert.equal(result.statusCode, 403);
          assert.equal(result.payload.requests, undefined);
        }
      });
    }
  });
});
