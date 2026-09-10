const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const input = require('../src/server/core/gameRoom/inputManager');
const { characterBody } = require('../src/shared/duelGeometry');
const { GameRoom } = require('../src/server/core/gameRoom');
const { createAuthSessionService, tokenHash } = require('../src/server/services/authSessionService');
const { createAbuseHttpMiddleware } = require('../src/server/middleware/abuseHttpMiddleware');
const { createRequestWindow } = require('../src/server/helpers/requestWindow');
const { acquireRuntimeOwnership } = require('../src/server/services/runtimeOwnershipService');
const { createPlayerActivityService } = require('../src/server/services/playerActivityService');
const { distributeMatchRewards } = require('../src/server/core/gameRoom/rewardManager');
const { createMatchResultService } = require('../src/server/services/matchResultService');

function movement(t) {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const player = { socketId: 'p', name: 'Player', char_class: 'ninja', x: 0, y: 0,
    isAlive: true, connected: true, lastInput: now, inputBuffer: [] };
  const events = [];
  const room = { players: new Map([['p', player]]), io: { to: () => ({ emit: (name, data) => events.push({ name, data }) }) } };
  input.resetMovementBudget(player, now);
  return { player, room, events, advance: ms => { now += ms; }, send: data => input.handlePlayerInput(room, 'p', data) };
}
for (const gap of [0, 1, 5, 250, 300, 10000]) {
  test(`movement is bounded after a ${gap}ms packet gap`, t => {
    const f = movement(t); f.advance(gap); f.send({ x: 3000, y: 900 });
    assert.ok(f.player.x <= 260); assert.ok(f.player.y <= 650);
    assert.equal(f.events[0].name, 'game:correction');
  });
}
test('packet spam does not replenish movement credit', t => {
  const f = movement(t);
  for (let i = 0; i < 6; i++) f.send({ x: f.player.x + 50, y: 0, sequence: i });
  assert.ok(f.player.x <= 80);
});
test('normal movement remains smooth and stale sequences are rejected', t => {
  const f = movement(t);
  for (let i = 0; i < 100; i++) { f.advance(20); f.send({ x: (i + 1) * 6, y: 0, sequence: i }); }
  assert.equal(f.player.x, 600); assert.equal(f.events.length, 0);
  f.send({ x: 0, y: 0, sequence: 1 }); assert.equal(f.player.x, 600);
});
test('client geometry and grounded claims cannot move or shrink collision bounds', t => {
  const f = movement(t); const body = characterBody('ninja');
  f.send({ x: 0, y: 0, bodyHalfWidth: 4, bodyHalfHeight: 8, bodyCenterOffsetX: 1e6,
    bodyCenterOffsetY: -1e6, width: 1e9, height: 1e9, grounded: true, ducking: true });
  assert.equal(f.player._bodyHalfWidth, body.halfWidth);
  assert.equal(f.player._bodyHalfHeight, body.halfHeight);
  assert.equal(f.player._bodyCenterOffsetX, body.offsetX);
  assert.equal(f.player._lastWidth, body.displayWidth);
  assert.equal(f.player.grounded, false); assert.equal(f.player.ducking, false);
});
test('grounded ducking uses canonical geometry and preserves the feet', t => {
  const f = movement(t); const body = characterBody('ninja');
  f.room.geometry = { colliders: [{ left: -100, right: 100, top: body.offsetY + body.halfHeight, collision: { up: true } }] };
  f.send({ x: 0, y: 0, grounded: true, ducking: true });
  assert.equal(f.player.ducking, true);
  assert.equal(f.player._bodyHalfHeight, body.halfHeight * 0.55);
  assert.equal(f.player._bodyCenterOffsetY + f.player._bodyHalfHeight, body.offsetY + body.halfHeight);
});
test('malformed packets do not reach the alternate movement buffer', t => {
  const f = movement(t); f.send({ x: NaN, right: true, up: true });
  assert.equal(f.player.inputBuffer.length, 0); assert.equal(f.player.x, 0);
});
test('ready acknowledgments cannot reposition players or mutate an active match', () => {
  const handlers = {}; const p = { user_id: 1, x: 10, y: 20, char_class: 'ninja' };
  const room = { onSocket: (_socket, name, cb) => { handlers[name] = cb; }, players: new Map([['s', p]]), status: 'active' };
  GameRoom.prototype.setupPlayerSocket.call(room, { id: 's' });
  handlers['game:ready']({ x: 1e6, y: -1e6, animation: 'bogus' });
  assert.deepEqual(p, { user_id: 1, x: 10, y: 20, char_class: 'ninja' });
});

function serialDb(initial, query) {
  let state = structuredClone(initial), chain = Promise.resolve();
  const db = { get state() { return state; }, async withTransaction(fn) {
    const prior = chain; let release; chain = new Promise(r => { release = r; }); await prior;
    const before = structuredClone(state);
    try { return await fn(null, (sql, params = []) => query(state, sql, params)); }
    catch (error) { state = before; throw error; } finally { release(); }
  } };
  db.runQuery = (sql, params) => db.withTransaction((_conn, q) => q(sql, params));
  return db;
}
function sessions() {
  const db = serialDb({ user: { user_id: 1, password: 'old-hash', expires_at: null, name: 'Player' }, sessions: new Map() }, (s, sql, p) => {
    if (sql.startsWith('SELECT password')) return [{ password: s.user.password }];
    if (sql.startsWith('INSERT INTO auth_sessions')) { s.sessions.set(p[0], { userId: p[1], expires: p[2] }); return { affectedRows: 1 }; }
    if (sql.startsWith('SELECT u.*')) {
      const entry = s.sessions.get(p[0]);
      return entry && entry.expires > new Date() ? [{ ...s.user, session_expires_at: entry.expires }] : [];
    }
    if (sql.startsWith('DELETE FROM auth_sessions WHERE token_hash')) return s.sessions.delete(p[0]);
    if (sql.startsWith('DELETE FROM auth_sessions WHERE user_id')) { s.sessions.clear(); return { affectedRows: 1 }; }
    if (sql.startsWith('UPDATE users SET password')) { s.user.password = p[0]; return { affectedRows: 1 }; }
    throw new Error(`Unexpected session SQL: ${sql}`);
  });
  const cookies = new Map();
  const res = { cookie: (name, value) => cookies.set(name, value), clearCookie: name => cookies.delete(name) };
  const service = createAuthSessionService({ db, cookieOptions: { signed: true, httpOnly: true } });
  const socket = () => Object.assign(new EventEmitter(), { data: {}, use(fn) { this.middleware = fn; }, disconnect() { this.disconnected = true; this.emit('disconnect'); } });
  return { db, service, res, cookies, socket };
}
test('sessions store hashes, reject legacy cookies, and expire on the server', async () => {
  const f = sessions(); const token = await f.service.create(f.db.state.user, f.res);
  assert.notEqual(tokenHash(token), token); assert.ok(f.db.state.sessions.has(tokenHash(token)));
  assert.equal(await f.service.resolve('1'), null);
  assert.equal((await f.service.resolve(token)).user_id, 1);
  f.db.state.sessions.get(tokenHash(token)).expires = new Date(0);
  assert.equal(await f.service.resolve(token), null);
});
test('logout revokes a copied cookie and disconnects its authenticated sockets', async () => {
  const f = sessions(); const token = await f.service.create(f.db.state.user, f.res);
  const socket = f.socket(); await f.service.authenticateSocket(socket, token);
  await f.service.revokeRequest({ signedCookies: { user_id: token } }, f.res);
  assert.equal(await f.service.resolve(token), null); assert.equal(socket.disconnected, true);
});
test('password changes revoke every session and prevent login with a stale password check', async () => {
  const f = sessions(); const oldUser = structuredClone(f.db.state.user);
  const a = await f.service.create(oldUser, f.res), b = await f.service.create(oldUser, f.res);
  const socket = f.socket(); await f.service.authenticateSocket(socket, b);
  await f.service.changePassword(1, 'old-hash', 'new-hash');
  assert.equal(await f.service.resolve(a), null); assert.equal(await f.service.resolve(b), null);
  assert.equal(socket.disconnected, true);
  await assert.rejects(f.service.create(oldUser, f.res), /credentials changed/);
});
test('missing or mismatched credentials cannot change a password', async () => {
  const f = sessions(); await assert.rejects(f.service.changePassword(1, 'wrong', 'new'), /Password changed/);
  assert.equal(f.db.state.user.password, 'old-hash');
});

test('HTTP aliases share limits and forwarded headers cannot invent identities', async () => {
  const decisions = [];
  const middleware = createAbuseHttpMiddleware({ abuseControl: { guardHttpAction: async x => { decisions.push(x); return { allowed: true }; } } });
  for (const route of ['/login', '/LOGIN', '/login/']) {
    await middleware({ method: 'POST', path: route, ip: '127.0.0.1', headers: { 'x-forwarded-for': Math.random().toString() } }, {}, () => {});
  }
  assert.deepEqual(decisions.map(x => [x.source, x.identityKey]), Array(3).fill(['POST /login', 'ip:127.0.0.1']));
});
test('HTTP guard errors fail closed', async () => {
  const middleware = createAbuseHttpMiddleware({ resolveUser: async () => { throw new Error('DB unavailable'); } });
  let status, reached = false;
  const res = { status(code) { status = code; return this; }, json() {} };
  await middleware({ method: 'POST', path: '/login', ip: 'local' }, res, () => { reached = true; });
  assert.equal(status, 503); assert.equal(reached, false);
});
test('rate windows bound key count, deny overflow, and recover after expiry', () => {
  const windows = createRequestWindow({ maxKeys: 2, maxEvents: 3 });
  windows.count('a', 10, 100); windows.count('b', 10, 100);
  assert.equal(windows.count('c', 10, 100), Infinity); assert.equal(windows.size, 2);
  assert.equal(windows.count('c', 10, 111), 1); assert.equal(windows.size, 1);
  windows.count('c', 10, 111); windows.count('c', 10, 111);
  assert.equal(windows.count('c', 10, 111), Infinity);
});

test('only one runtime can own a database and connection loss is fatal to its owner', async t => {
  let owner = null; const connections = []; const failures = [];
  const connect = async () => {
    const c = new EventEmitter(); connections.push(c);
    c.query = async ({ sql }) => {
      if (sql.includes('GET_LOCK')) { if (owner) return [[{ acquired: 0 }]]; owner = c; return [[{ acquired: 1 }]]; }
      return [[{ owned: owner === c ? 1 : 0 }]];
    };
    c.destroy = () => { if (owner === c) owner = null; };
    c.end = async () => c.destroy();
    return c;
  };
  const first = await acquireRuntimeOwnership({ connect, database: 'review', onLost: e => failures.push(e) });
  t.after(() => first.release());
  await assert.rejects(acquireRuntimeOwnership({ connect, database: 'review', onLost() {} }), /already owns/);
  connections[0].emit('error', new Error('connection lost'));
  assert.equal(failures.length, 1);
  const replacement = await acquireRuntimeOwnership({ connect, database: 'review', onLost() {} });
  await replacement.release();
});

test('presence evicts idle historical users and coalesces lobby database lookups', async () => {
  let now = 0, queries = 0;
  const service = createPlayerActivityService({ now: () => now, schedule: false,
    db: { runQuery: async () => { queries++; return []; }, getPartyIdByName: async () => null },
    io: { to: () => ({ emit() {} }) }, setPresence: async () => {} });
  const socket = { id: 's', data: { user: { user_id: 1, name: 'Player' } } };
  await Promise.all(Array.from({ length: 20 }, () => service.lobbyPing(socket)));
  assert.equal(queries, 1);
  service.disconnect(socket); now = 61000; await service.tick();
  assert.deepEqual(service.getStats(), { users: 0, matches: 0 }); service.dispose();
});

function rewardsDb() {
  let fail = false;
  const db = serialDb({ match: { status: 'live' }, user: { user_id: 1, coins: 0, gems: 0, trophies: 100 }, committed: null }, (s, sql, p) => {
    if (sql.startsWith('SELECT status FROM matches')) return [s.match];
    if (sql.startsWith('SELECT summary FROM match_reward_commits')) return s.committed ? [{ summary: s.committed }] : [];
    if (sql.startsWith('SELECT user_id, COALESCE(trophies')) return [s.user];
    if (sql.startsWith('UPDATE users SET coins')) { s.user.coins += p[0]; s.user.gems += p[1]; s.user.trophies += p[2]; return { affectedRows: 1 }; }
    if (sql.startsWith('UPDATE matches')) { if (fail) throw new Error('simulated persistence failure'); s.match = { status: 'completed', summary: p[1] }; return { affectedRows: 1 }; }
    if (sql.startsWith('INSERT INTO match_reward_commits')) { s.committed = p[1]; return { affectedRows: 1 }; }
    if (sql.includes('UPDATE match_participants') || sql.startsWith('UPDATE parties')) return { affectedRows: 1 };
    throw new Error(`Unexpected rewards SQL: ${sql}`);
  });
  return { db, fail: value => { fail = value; } };
}
function rewardRoom(db) {
  return { db, matchId: 1, matchData: { modeId: 'duels', modeVariantId: 'duels-1v1', map: 1 }, rewardStats: new Map(),
    players: new Map([['p', { user_id: 1, name: 'Player', team: 'team1', char_class: 'ninja' }]]) };
}
test('reward writes, battle logs, and completion roll back together, then retry once', async () => {
  const f = rewardsDb(), room = rewardRoom(f.db); f.fail(true);
  await assert.rejects(distributeMatchRewards(room, 'team1'), /simulated/);
  assert.equal(f.db.state.user.coins, 0); assert.equal(f.db.state.match.status, 'live');
  f.fail(false);
  const [first, retry] = await Promise.all([distributeMatchRewards(room, 'team1'), distributeMatchRewards(room, 'team1')]);
  assert.deepEqual(retry, first); assert.equal(f.db.state.user.coins, first[0].coinsAwarded);
  assert.equal(f.db.state.match.status, 'completed');
});
test('durable match results survive failed writes and service restart', async t => {
  const journalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-results-test-'));
  t.after(() => fs.rm(journalDir, { recursive: true, force: true }));
  const f = rewardsDb(); f.fail(true);
  const service = createMatchResultService({ db: f.db, journalDir });
  await assert.rejects(service.complete(rewardRoom(f.db), 'team1'), /simulated/);
  assert.equal(service.isPending(1), true);
  assert.deepEqual(await service.pendingMatchIds(), [1]);
  f.fail(false);
  const restarted = createMatchResultService({ db: f.db, journalDir });
  await restarted.prepare();
  assert.equal(restarted.isPending(1), true);
  const hub = require('../src/server/core/gameHub').createGameHub({ matchResults: restarted });
  await assert.rejects(hub.createGameRoom(1, {}), /rewards are pending/);
  await restarted.reconcile();
  assert.equal(restarted.isPending(1), false);
  assert.deepEqual(await restarted.pendingMatchIds(), []); assert.ok(f.db.state.user.coins > 0);
  const coins = f.db.state.user.coins; await restarted.reconcile(); assert.equal(f.db.state.user.coins, coins);
});
test('production disables inline source maps while development keeps debugging maps', () => {
  const config = require('../webpack.config');
  assert.equal(config({}, { mode: 'production' }).devtool, false);
  assert.equal(config({}, { mode: 'production' }).output.clean, true);
  assert.equal(config({}, { mode: 'development' }).devtool, 'inline-source-map');
});
