const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePartySlots, movePartyMember } = require('../src/server/helpers/partySlots');
const { registerPartyEvents } = require('../src/server/core/socketEvents/partyEvents');
const { PARTY_STATUS } = require('../src/server/helpers/partyRules');
const { setPartyBotSlot, prunePartyBotSlots, clearPartyBotSlots } = require('../src/server/helpers/partyBotSlots');
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
  const { resizePartySlots } = require('../src/server/helpers/partySlots');
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
