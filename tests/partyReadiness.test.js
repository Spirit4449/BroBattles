const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPartyEvents } = require('../src/server/core/socketEvents/partyEvents');
const { registerPresenceEvents } = require('../src/server/core/socketEvents/presenceEvents');
const { createPartyQueueTransitionService } = require('../src/server/services/partyQueueTransitionService');
const { PARTY_STATUS } = require('../src/server/helpers/partyRules');

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
      if (sql.startsWith('SELECT * FROM parties')) return [{ ...party }];
      if (sql.startsWith('SELECT status FROM parties')) return [{ status: party.status }];
      if (sql.startsWith('SELECT 1 FROM match_tickets')) return ticket ? [{}] : [];
      if (sql.includes('FROM matches')) return [];
      if (sql.startsWith('SELECT 1 FROM party_members')) return members.some(m => m.name === params[1]) ? [{}] : [];
      if (sql.startsWith('SELECT status FROM users')) return [{ status: members.find(m => m.name === params[0]).status }];
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
    const socket = { data: { user: { name } }, on: (event, handler) => { handlers[event] = handler; } };
    registerPartyEvents(socket, { db, io, mm, partyPresence, partyQueueTransition, gameHub, PARTY_STATUS });
    return {
      handlers,
      ready: async (ready, partyId = 7) => { let reply; await handlers['ready:status']({ ready, partyId }, result => { reply = result; }); return reply; },
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
  const { createPartyPresenceService } = require('../src/server/services/partyPresenceService');
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
