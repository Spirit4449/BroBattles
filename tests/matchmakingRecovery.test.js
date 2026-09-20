const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createQueueTicketManager } = require('../src/server/core/matchmaking/queueTicketManager');
const { registerMatchmakingEvents } = require('../src/server/core/socketEvents/matchmakingEvents');
const { createPartyQueueTransitionService } = require('../src/server/services/partyQueueTransitionService');
const { createMatchmaking } = require('../src/server/core/matchmaking');
const { PARTY_STATUS } = require('../src/server/helpers/partyRules');

for (const status of ['queued', 'live']) {
  test(`queue leave and duplicate join cannot change a ${status} match`, async () => {
    const writes = [];
    const manager = createQueueTicketManager({ db: { runQuery: async sql => {
      if (sql.includes('FROM matches')) return [{ match_id: 77, status }];
      writes.push(sql); throw Error('Unexpected write');
    } } });
    assert.deepEqual(await manager.queueLeave({ partyId: 7 }), { cancelled: false, matchId: 77 });
    await assert.rejects(manager.queueJoin({ partyId: 7 }), { code: 'MATCH_FOUND' });
    assert.deepEqual(writes, []);
  });
}

test('late socket cancellation acknowledges the match without cancelling or changing presence', async () => {
  const events = [], handlers = {};
  const socket = { data: { user: { name: 'Owner', user_id: 1 } }, on: (key, fn) => { handlers[key] = fn; }, emit: (...args) => events.push(args) };
  registerMatchmakingEvents(socket, {
    db: { getPartyIdByName: async () => 7 },
    io: { to: () => ({ emit: (...args) => events.push(args) }) },
    mm: { queueLeave: async () => ({ cancelled: false, matchId: 77 }) }, PARTY_STATUS,
  });
  let reply;
  await handlers['queue:leave'](value => { reply = value; });
  assert.deepEqual(reply, { ok: true, cancelled: false, matchId: 77 });
  assert.deepEqual(events, []);
});

test('party cancellation leaves a claimed match untouched and propagates database failures', async () => {
  const service = createPartyQueueTransitionService({ db: {}, io: {}, mm: {
    queueLeave: async () => ({ cancelled: false, matchId: 77 }),
  } });
  assert.deepEqual(await service.cancelPartyQueue({ partyId: 7 }), { cancelled: false, matchId: 77 });
  const failed = createPartyQueueTransitionService({ db: {}, io: {}, mm: {
    queueLeave: async () => { throw Error('DB unavailable'); },
  } });
  await assert.rejects(failed.cancelPartyQueue({ partyId: 7 }), /DB unavailable/);
});

test('stale roster and disconnected tickets are removed while a healthy queue still progresses', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const events = [];
  let tickets = [
    { ticket_id: 1, user_id: 1, size: 2, team1_count: 2, team2_count: 0 },
    { ticket_id: 2, user_id: 2, size: 1, team1_count: 1, team2_count: 0 },
    { ticket_id: 3, user_id: 3, size: 1, team1_count: 1, team2_count: 0, claimed_by: 'old-worker' },
  ].map(row => ({ ...row, status: 'queued', created_at: new Date(Date.now() - 30000), mode_id: 'duels', mode_variant_id: 'duels-3v3', map: 1, mmr: 0 }));
  const users = [1, 2, 3].map(id => ({ user_id: id, name: `User${id}`, socket_id: `s${id}`, char_class: 'ninja' }));
  const db = { async runQuery(sql, params = []) {
    if (sql.startsWith('SELECT * FROM match_tickets')) return tickets.map(row => ({ ...row }));
    if (sql.includes('FROM matches')) return [];
    if (sql.startsWith('UPDATE match_tickets')) { tickets.find(row => row.ticket_id === params[0]).claimed_by = null; return {}; }
    if (sql.startsWith('DELETE FROM match_tickets')) { tickets = tickets.filter(row => row.user_id !== params[0]); return { affectedRows: 1 }; }
    if (sql.includes('COUNT(*)')) return [{ c: tickets.length }];
    if (sql.includes('FROM users')) return users.filter(user => params.includes(user.user_id));
    throw Error(sql);
  } };
  const sockets = new Map([1, 3].map(id => [`s${id}`, { emit: (event, data) => events.push({ id, event, data }) }]));
  createMatchmaking({ db, io: { sockets: { sockets } }, runtimeConfig: { get: () => ({ bots: { enabled: false } }) } });
  t.mock.timers.tick(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(tickets.map(row => row.ticket_id), [3]);
  assert.equal(tickets[0].claimed_by, null);
  assert.ok(events.some(e => e.id === 1 && e.event === 'match:cancelled'));
  assert.ok(events.some(e => e.id === 3 && e.event === 'match:progress' && e.data.found === 1));
});

function browserFixture() {
  const source = fs.readFileSync(require.resolve('../src/party.js'), 'utf8');
  const button = { dataset: {}, disabled: false, addEventListener: (_, fn) => { button.click = fn; } };
  const requests = [];
  let hidden = 0;
  const context = vm.createContext({
    document: { getElementById: () => button },
    socket: { timeout: () => ({ emit: (...args) => requests.push(args) }), emit: (...args) => requests.push(args) },
    checkMatchmakingHealth: () => {}, hideMatchmakingOverlay: () => { hidden++; },
  });
  const lockStart = source.indexOf('function lockMatchmakingCancel(');
  const lockEnd = source.indexOf('\nfunction checkMatchmakingHealth', lockStart);
  const cancelStart = source.indexOf('function wireCancelButton()');
  const cancelEnd = source.indexOf('\nfunction wireAdminFillBotsButtons', cancelStart);
  vm.runInContext(`let __matchedQueueId = null; let __queueHealthGeneration = 0; ${source.slice(lockStart, lockEnd)} ${source.slice(cancelStart, cancelEnd)} wireCancelButton();`, context);
  return { button, requests, context, get hidden() { return hidden; } };
}

test('cancel stays visible until acknowledged and cannot hide an intervening found match', () => {
  const f = browserFixture();
  f.button.click();
  assert.equal(f.button.disabled, true);
  assert.equal(f.hidden, 0);
  vm.runInContext('lockMatchmakingCancel(77)', f.context);
  f.requests[0][1](null, { ok: true, cancelled: true });
  assert.equal(f.hidden, 0);
  f.button.click();
  assert.equal(f.requests.length, 1);
});

test('cancel rejection locks the button while a failed request permits retry', () => {
  const f = browserFixture();
  f.button.click();
  f.requests[0][1](Error('timeout'));
  assert.equal(f.button.disabled, false);
  f.button.click();
  f.requests[1][1](null, { ok: true, cancelled: false, matchId: 77 });
  assert.equal(f.button.disabled, true);
  assert.equal(f.hidden, 0);
});

test('queue health distinguishes missing tickets and refreshes persisted queue progress', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let hasTicket = false;
  const mm = createMatchmaking({ io: {}, db: { runQuery: async sql => {
    if (sql.includes('FROM matches')) return [];
    if (sql.includes('FROM match_tickets')) return hasTicket ? [{ ticket_id: 1 }] : [];
    throw Error(sql);
  } } });
  assert.deepEqual(await mm.queueStatus({ userId: 1 }), { state: 'missing' });
  hasTicket = true;
  assert.deepEqual(await mm.queueStatus({ userId: 1 }), { state: 'queued' });
});

test('a ready check abandoned by restart is cancelled and no longer traps the queue', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let active = true;
  const emitted = [], writes = [];
  const mm = createMatchmaking({ io: { sockets: { sockets: new Map([['s1', { emit: (...args) => emitted.push(args) }]]) } }, db: {
    async runQuery(sql) {
      if (sql.includes('FROM matches')) return active ? [{ match_id: 77, status: 'queued' }] : [];
      if (sql.startsWith('UPDATE matches')) { active = false; writes.push(sql); return {}; }
      if (sql.startsWith('DELETE') || sql.startsWith('UPDATE')) { writes.push(sql); return {}; }
      if (sql.includes('SELECT DISTINCT party_id')) return [];
      if (sql.includes('FROM match_participants')) return [{ user_id: 1, socket_id: 's1' }];
      if (sql.includes('FROM match_tickets')) return [];
      throw Error(sql);
    },
  } });
  assert.deepEqual(await mm.queueStatus({ userId: 1 }), { state: 'missing' });
  assert.equal(active, false);
  assert.ok(writes.some(sql => sql.includes("u.status='online'")));
  assert.equal(emitted[0][0], 'match:cancelled');
  assert.equal(emitted[0][1].matchId, 77);
});

test('browser health check recovers a missing ticket and ignores a response overtaken by match found', () => {
  const source = fs.readFileSync(require.resolve('../src/party.js'), 'utf8');
  const start = source.indexOf('function checkMatchmakingHealth()');
  const end = source.indexOf('let __partyReadyPending', start);
  const requests = [], emits = [];
  const context = vm.createContext({
    socket: { timeout: () => ({ emit: (...args) => requests.push(args) }), emit: (...args) => emits.push(args) },
    window: { location: {} }, lockMatchmakingCancel: () => {},
  });
  vm.runInContext(`let __matchedQueueId = null, __queueHealthPending = false, __queueHealthGeneration = 0; ${source.slice(start, end)} checkMatchmakingHealth();`, context);
  requests[0][1](null, { state: 'missing' });
  assert.equal(emits[0][0], 'queue:leave');
  vm.runInContext('checkMatchmakingHealth(); __matchedQueueId = 77;', context);
  requests[1][1](null, { state: 'missing' });
  assert.equal(emits.length, 1);
  assert.equal(vm.runInContext('__matchedQueueId', context), 77);
});

test('ready state survives asynchronous room startup and accepts numeric-string user IDs', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { createReadyCheckCoordinator } = require('../src/server/core/matchmaking/readyCheckCoordinator');
  let releaseRoom;
  const room = new Promise(resolve => { releaseRoom = resolve; });
  const events = [];
  const ready = createReadyCheckCoordinator({
    db: { runQuery: async sql => sql.startsWith('SELECT user_id') ? [{ user_id: 1, socket_id: 's1' }] : [] },
    io: { sockets: { sockets: new Map([['s1', { emit: (...args) => events.push(args) }]]) } },
    partyStatus: PARTY_STATUS,
    cancelMatch: async () => assert.fail('Ready match should start'),
    getMatchDataForGameRoom: async () => ({}),
    gameHub: { createGameRoom: () => room },
  });
  ready.startReadyCheck(77, ['1']);
  ready.handleReadyAck('1', '77');
  t.mock.timers.tick(250);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready.isActive(77), true);
  assert.deepEqual(events, []);
  releaseRoom();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready.isActive(77), false);
  assert.deepEqual(events, [['match:gameReady', { matchId: 77 }]]);
});
