const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPartyRoutes } = require('../src/server/routes/modules/partyRoutes');
const { emitRoster } = require('../src/server/helpers/party');

function fixture({ existing = true, missing = false, full = false, privateParty = false, statusFails = false, rosterFails = false } = {}) {
  const calls = [], emissions = [], routes = new Map();
  const party = { party_id: 42, mode: 1, map: 1, is_public: privateParty ? 0 : 1, allow_member_selection: 0 };
  let status = 'ingame';
  const conn = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    async query(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push(q);
      if (q.startsWith('SELECT * FROM parties')) return [missing ? [] : [party]];
      if (q.startsWith('SELECT team FROM party_members')) return [existing ? [{ team: 'team1' }] : []];
      if (q.startsWith('UPDATE party_members SET last_seen')) return [{ affectedRows: 1 }];
      if (q.includes('FROM party_join_requests')) return [[]];
      if (q.startsWith('SELECT COUNT(*)')) return [[{ cnt: full ? 99 : 1 }]];
      if (q.startsWith('SELECT team, COUNT(*)')) return [[{ team: 'team1', c: 1 }]];
      if (q.startsWith('DELETE FROM party_members') || q.startsWith('INSERT INTO party_members')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${q}`);
    },
  };
  const db = {
    pool: { getConnection: async () => conn },
    async setUserStatus(name, next) {
      calls.push('online');
      assert.equal(calls.at(-2), 'release', 'release transaction before more pooled queries');
      assert.equal(name, 'Player');
      if (statusFails) throw new Error('presence unavailable');
      status = next;
    },
    async fetchPartyMembersDetailed() {
      calls.push('roster');
      if (rosterFails) throw new Error('roster unavailable');
      return [
        { name: 'Owner', team: 'team2', slot_index: 1, char_class: 'ninja', status: 'online' },
        { name: 'Player', team: 'team1', slot_index: 0, char_class: 'ninja', status },
      ];
    },
    async fetchSelectedCardsByNames() { calls.push('cards'); return { Player: 'card' }; },
    async runQuery(sql) {
      calls.push('owner');
      assert.match(sql, /SELECT name/);
      return [{ name: 'Owner' }];
    },
  };
  const io = { to: room => ({ emit: (event, data) => emissions.push({ room, event, data }) }) };
  const app = { post: (path, handler) => routes.set(path, handler), locals: { socketApi: {
    moveUserSocketToParty: async () => calls.push('move'),
    cancelPartyQueue: async () => calls.push('cancelQueue'),
  } } };
  registerPartyRoutes({ app, io, db, requireCurrentUser: async () => ({ name: 'Player', user_id: 1 }) });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
  return { calls, emissions, db, io, party, res, run: () => routes.get('/partydata')({ body: { partyId: 42 }, app }, res) };
}

test('return reads one fresh roster, releases its pool slot, and reuses ownership for emission', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.res.code, 200);
  for (const key of ['roster', 'online', 'cards', 'release']) assert.equal(f.calls.filter(call => call === key).length, 1, key);
  assert.equal(f.calls.includes('owner'), false);
  assert.equal(f.calls.includes('cancelQueue'), false);
  assert.ok(f.calls.indexOf('online') < f.calls.indexOf('roster'));
  assert.ok(f.calls.indexOf('commit') < f.calls.indexOf('release'));
  assert.ok(f.calls.indexOf('move') < f.calls.indexOf('cards'));
  assert.equal(f.res.payload.ownerName, 'Owner', 'ownership follows join order, not seats');
  assert.equal(f.res.payload.members[1].status, 'online');
  assert.equal(f.res.payload.allowMemberSelection, false);
  const roster = f.emissions.find(e => e.event === 'party:members').data;
  assert.equal(roster.ownerName, f.res.payload.ownerName);
  assert.equal(roster.members[1].selected_card_id, 'card');
  assert.equal(roster.members[1].status, 'online');
  assert.deepEqual(f.emissions.map(e => e.event), ['party:members', 'mode-change', 'map-change']);
});

test('new joins still update membership and cancel matchmaking before broadcasting', async () => {
  const f = fixture({ existing: false });
  await f.run();
  assert.equal(f.res.code, 200);
  assert.ok(f.calls.some(q => q.startsWith('INSERT INTO party_members')));
  assert.ok(f.calls.indexOf('cancelQueue') < f.calls.indexOf('cards'));
  assert.equal(f.calls.filter(q => q === 'roster').length, 1);
});

for (const [options, code] of [[{ missing: true }, 404], [{ existing: false, full: true }, 409], [{ existing: false, privateParty: true }, 403]]) {
  test(`rejected party return (${code}) does not mark online or move the socket`, async () => {
    const f = fixture(options);
    await f.run();
    assert.equal(f.res.code, code);
    assert.equal(f.calls.includes('online'), false);
    assert.equal(f.calls.includes('move'), false);
    assert.equal(f.calls.includes('rollback'), true);
    assert.equal(f.calls.filter(q => q === 'release').length, 1);
    assert.equal(f.emissions.length, 0);
  });
}

test('presence write failure still reads authoritative roster and returns the lobby', async () => {
  const f = fixture({ statusFails: true });
  await f.run();
  assert.equal(f.res.code, 200);
  assert.equal(f.res.payload.members[1].status, 'ingame');
  assert.equal(f.calls.filter(q => q === 'roster').length, 1);
});

test('other roster callers retain owner lookup; explicit no-owner snapshot avoids one', async () => {
  const f = fixture();
  await emitRoster(f.io, 42, f.party, [], f.db);
  assert.equal(f.calls.filter(q => q === 'owner').length, 1);
  await emitRoster(f.io, 42, f.party, [], f.db, { ownerName: null });
  assert.equal(f.calls.filter(q => q === 'owner').length, 1);
  assert.equal(f.emissions.at(-1).data.ownerName, null);
});

test('failed fresh roster read does not broadcast stale data or leak the transaction connection', async () => {
  const f = fixture({ rosterFails: true });
  await f.run();
  assert.equal(f.res.code, 500);
  assert.equal(f.calls.filter(q => q === 'release').length, 1);
  assert.equal(f.calls.includes('move'), false);
  assert.equal(f.emissions.length, 0);
});
