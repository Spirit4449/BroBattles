const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe("Application bootstrap", () => {
  const { spawnSync } = require('node:child_process');

  test('malformed explicit listener and password settings fail before startup', () => {
    const { loadConfig } = require('../src/server/config');
    for (const [key, values] of Object.entries({ PORT: ['bad', '0', '65536'], BCRYPT_ROUNDS: ['bad', '0', '32'] })) {
      for (const value of values) assert.throws(() => loadConfig({ [key]: value }), new RegExp(key));
    }
    assert.equal(loadConfig({ PORT: ' ' }).port, loadConfig({}).port);
    assert.deepEqual(loadConfig({}).admin.users, []);
    const tracing = loadConfig({
      BB_NET_TRACE_TOKEN: 'a'.repeat(16),
      BB_NET_TRACE_DIR: 'data/test-traces',
      BB_NET_TRACE_CPU_PROFILE_S: '2.5',
    }).netTrace;
    assert.ok(Object.isFrozen(tracing));
    assert.equal(tracing.enabled, true);
    assert.equal(tracing.dir, path.resolve('data/test-traces'));
    assert.equal(tracing.cpuProfileSeconds, 2.5);
    for (const value of ['', 'bad', 'Infinity', '-1', '999999999']) {
      assert.equal(loadConfig({ BB_NET_TRACE_CPU_PROFILE_S: value }).netTrace.cpuProfileSeconds, 0);
    }
  });

  test('only configured permanent accounts can use admin routes', async () => {
    const { loadConfig } = require('../src/server/config');
    const { isAdminUser, isReservedAdminName, makeAuthHelpers } = require('../src/server/services/auth/auth');
    const { users } = loadConfig({ ADMIN_USERS: '17, Staff' }).admin;
    assert.equal(isAdminUser({ user_id: 17, name: 'Other' }, users), true);
    assert.equal(isAdminUser({ user_id: 18, name: 'staff' }, users), true);
    assert.equal(isAdminUser({ user_id: 17, name: 'staff', expires_at: new Date() }, users), false);
    assert.equal(isReservedAdminName(' STAFF ', users), true);
    assert.equal(isReservedAdminName('17', users), false);
    assert.equal(isAdminUser({ user_id: 1, name: 'nishay' }, loadConfig({}).admin.users), false);
    const { requireAdminUser } = makeAuthHelpers({}, { SIGNED_COOKIE_OPTS: {}, DISPLAY_COOKIE_OPTS: {} });
    assert.equal(await requireAdminUser({ authContext: { user: null } }, {}), null);
  });

  test('configured settings stay fixed for tracing and credential checks after initialization', () => {
    const script = `
      const assert = require('node:assert/strict');
      const { initializeConfig, getConfig } = require('./src/server/config');
      const settings = initializeConfig({
        ADMIN_USERS: 'Staff', COOKIE_SECRET: 'test-session-secret',
        BB_NET_TRACE_TOKEN: 'a'.repeat(16), BB_NET_TRACE_CPU_PROFILE_S: '3',
      });
      process.env.BB_NET_TRACE_TOKEN = 'b'.repeat(16);
      process.env.ADMIN_USERS = 'Other';
      const { netTrace } = require('./src/server/core/gameRoom/netTraceRecorder');
      const { validateCredentials } = require('./src/server/services/auth/authAccountService');
      assert.equal(getConfig(), settings);
      assert.ok(netTrace.authorize({ netTrace: { token: 'a'.repeat(16), runId: 'boot' } }));
      assert.equal(netTrace.authorize({ netTrace: { token: 'b'.repeat(16), runId: 'boot' } }), null);
      assert.deepEqual(validateCredentials('staff', 'password123'), {
        ok: false, statusCode: 409, payload: { success: false, error: 'Username is already taken.' },
      });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });

  for (const mode of ['development', 'production']) {
    test(`${mode} server loads its real imports and registers routes before acquiring the database`, () => {
      const root = path.resolve(__dirname, '..');
      const script = `
        const Module = require('node:module');
        const originalLoad = Module._load;
        let application;
        Module._load = function(request, parent, isMain) {
          // No local credentials or persistent database operations in this smoke test.
          if (request === 'express') {
            const express = originalLoad.apply(this, arguments);
            return new Proxy(express, { apply(target, receiver, args) {
              application = Reflect.apply(target, receiver, args);
              return application;
            } });
          }
          if (request === './core/socket.js' && parent.filename.endsWith('/src/server/application.js')) {
            const actual = originalLoad.apply(this, arguments);
            return { ...actual, initSocket(dependencies) {
              const db = originalLoad.call(Module, './core/sql', parent, false);
              for (const name of ['runQuery', 'withTransaction', 'setPartyStatus', 'setPartiesStatus']) {
                require('node:assert/strict').equal(dependencies.db[name], db[name], name);
              }
              return actual.initSocket(dependencies);
            } };
          }
          if (request === 'dotenv') return { config() {} };
          if (request === './services/runtimeOwnershipService' && parent.filename.endsWith('/src/server/server.js')) {
            return { acquireRuntimeOwnership() { const assert = require('node:assert/strict');
              const stack = application._router.stack;
              const webhook = stack.findIndex(layer => layer.route?.path === '/api/payments/stripe/webhook');
              const json = stack.findIndex(layer => layer.name === 'jsonParser');
              assert.ok(webhook >= 0 && json > webhook, 'raw webhook must register before JSON parsing');
              const pageGuard = stack.findIndex(layer => Array.isArray(layer.route?.path) && layer.route.path.includes('/index.html'));
              const staticFiles = stack.findIndex(layer => layer.name === 'serveStatic');
              const cookies = stack.findIndex(layer => layer.name === 'cookieParser');
              assert.ok(pageGuard > cookies && staticFiles > pageGuard, 'account restriction guard must run after cookies and before static lobby HTML');
              for (const endpoint of ['/api/shop/bootstrap', '/api/shop/viewed', '/api/shop/claim-daily', '/api/shop/purchase', '/api/shop/checkout-session', '/api/shop/checkout-status']) {
                assert.ok(stack.some(layer => layer.route?.path === endpoint), endpoint);
              }
              console.log('SERVER_BOOTSTRAP_READY'); process.exit(0); } };
          }
          return originalLoad.apply(this, arguments);
        };
        require('./src/server/server.js').startServer();
      `;
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: root,
        env: { PATH: process.env.PATH, NODE_ENV: mode, COOKIE_SECRET: 'isolated-startup-smoke-test' },
        encoding: 'utf8', timeout: 20000,
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      assert.match(result.stdout, /SERVER_BOOTSTRAP_READY/);
    });
  }


  test('Git ignores local environment secrets while retaining the example', () => {
    const { execFileSync } = require('node:child_process');
    const ignored = execFileSync('git', ['check-ignore', '--no-index', '.env', '.env.production', '.env.example'], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    }).trim().split('\n');
    assert.deepEqual(ignored, ['.env', '.env.production']);
  });
});

describe("Bounded asynchronous logging", () => {
  const { makeAsyncWriter } = require('../src/server/lib/asyncConsole');

  // A fake descriptor that accepts at most `limit` bytes per write and answers
  // later, like a pipe whose reader (pm2) or a disk is slow.
  function slowSink(limit = Infinity) {
    const pending = [];
    let output = '';
    const write = (fd, buffer, offset, length, position, callback) => {
      const take = Math.min(length, limit);
      pending.push(() => { output += buffer.subarray(offset, offset + take).toString(); callback(null, take); });
    };
    const drain = () => { while (pending.length) pending.shift()(); };
    return { write, drain, get output() { return output; } };
  }

  test('console writes return at once and reach the output in order, including partial writes', () => {
    const sink = slowSink(7);
    const writer = makeAsyncWriter({ fd: 1 }, { write: sink.write });
    for (let i = 0; i < 5; i++) writer.enqueue(`line ${i}\n`);
    assert.equal(sink.output, '', 'nothing waits on the descriptor inside the caller');
    sink.drain();
    assert.equal(sink.output, [0, 1, 2, 3, 4].map(i => `line ${i}\n`).join(''));
  });

  test('output queued behind a blocked descriptor is bounded and the loss is reported', () => {
    const sink = slowSink();
    const writer = makeAsyncWriter({ fd: 1 }, { write: sink.write, maxBufferedBytes: 16 });
    writer.enqueue('first\n');
    for (let i = 0; i < 10; i++) writer.enqueue('0123456789\n');
    sink.drain();
    assert.match(sink.output, /^first\n0123456789\n\[asyncConsole\] dropped 9 lines/);
  });
});

describe("Stripe startup listener", () => {
  const { createStripeListener, webhookPath } = require('../src/server/services/shop/stripeListener');

  test('local CLI readiness installs the signing secret and exit clears it', async t => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    const { PassThrough } = require('node:stream');
    const child = new (require('node:events').EventEmitter)();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const listener = createStripeListener({ production: false, stripe: {}, secretKey: 'sk_test_example', spawnCli(command, args) {
      assert.equal(command, 'stripe');
      assert.ok(args.includes('http://127.0.0.1:4321' + webhookPath));
      return child;
    } });
    await listener.start(4321);
    assert.equal(listener.getStatus().state, 'starting');
    child.stderr.write('Ready! Your webhook signing secret is whsec_example\n');
    assert.equal(listener.getSigningSecret(), 'whsec_example');
    assert.equal(listener.getStatus().state, 'listening');
    child.emit('close', 1);
    assert.equal(listener.getStatus().state, 'error');
    assert.equal(listener.getSigningSecret(), '');
  });

  test('application-owned shutdown signals the local child once and waits for close', async t => {
    t.mock.method(console, 'log', () => {});
    const { PassThrough } = require('node:stream');
    const child = new (require('node:events').EventEmitter)();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const signals = [];
    child.kill = (signal = 'SIGTERM') => { signals.push(signal); return true; };
    const listener = createStripeListener({
      production: false, stripe: {}, secretKey: 'sk_test_example', spawnCli: () => child,
    });
    const before = ['SIGINT', 'SIGUSR2'].map(signal => process.listenerCount(signal));
    await listener.start(4321);
    assert.deepEqual(['SIGINT', 'SIGUSR2'].map(signal => process.listenerCount(signal)), before);
    const first = listener.stop();
    assert.equal(listener.stop(), first);
    let drained = false;
    first.then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false);
    assert.deepEqual(signals, ['SIGTERM']);
    child.stderr.write('Ready! Your webhook signing secret is whsec_late\n');
    assert.equal(listener.getSigningSecret(), '');
    child.emit('close', null, 'SIGTERM');
    await first;
    assert.equal(drained, true);
    assert.equal(listener.getStatus().state, 'stopped');
    await listener.stop();
    assert.deepEqual(signals, ['SIGTERM']);
  });

  test('production verifies the public endpoint and event subscriptions', async () => {
    const endpoint = { url: 'https://shop.example' + webhookPath, status: 'enabled', enabled_events: ['*'] };
    const stripe = { webhookEndpoints: { list: () => [endpoint] } };
    const listener = createStripeListener({ production: true, stripe, publicBaseUrl: 'https://shop.example', configuredSecret: 'whsec_endpoint' });
    await listener.start(3002);
    assert.equal(listener.getStatus().state, 'listening');
    endpoint.enabled_events = ['checkout.session.completed'];
    await listener.start(3002);
    assert.equal(listener.getStatus().state, 'error');
  });
});

test('periodic cleanup only retires old matches without a live room or pending rewards', async t => {
  const { installFakeClock } = require('./helpers/fakeClock');
  installFakeClock(t, { apis: ['setInterval'] });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const { startCleanupJobs } = require('../src/server/jobs/cleanup');
  const calls = [];
  const db = {
    withTransaction(fn) { return fn(null, this.runQuery.bind(this)); },
    async runQuery(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT match_id')) return [1, 2, 3].map(match_id => ({ match_id }));
      if (sql.startsWith('UPDATE matches')) return { affectedRows: 1 };
      return [];
    },
    findAndRemoveInactiveMembers: async () => [],
    deleteEmptyParties: async () => 0,
    deleteExpiredGuestsAndMemberships: async () => ({}),
    setOfflineIfLastSeenOlderThan: async () => [],
  };
  const scheduler = require("../src/server/jobs/scheduler").createScheduler();
  t.after(() => scheduler.stop());
  startCleanupJobs({
    scheduler,
    db, io: {}, matchResults: { isPending: id => id === 1 }, getGameRoom: id => id === 2 ? {} : null,
  });
  await new Promise(resolve => setImmediate(resolve));
  const paramsFor = prefix => calls.find(call => call.sql.startsWith(prefix)).params;
  assert.deepEqual(paramsFor("UPDATE matches SET status='completed'"), [3]);
  assert.deepEqual(paramsFor("UPDATE parties p JOIN match_participants"), [3]);
  assert.deepEqual(paramsFor('DELETE FROM match_bot_participants'), [3]);
  assert.deepEqual(paramsFor('DELETE FROM match_participants'), [3]);
});

test('stale bot cleanup leaves live match rosters to guarded match retirement', async () => {
  const { startCleanupJobs } = require('../src/server/jobs/cleanup');
  const jobs = new Map();
  const calls = [];
  startCleanupJobs({
    scheduler: { every: (name, _delay, fn) => jobs.set(name, fn) },
    db: { runQuery: async sql => calls.push(sql) },
  });

  await jobs.get('stale bots')();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /m\.status IN \('completed','cancelled'\)/);
  assert.match(calls[0], /OR \(m\.status = 'queued' AND m\.created_at < NOW\(\) - INTERVAL \d+ MINUTE\)/);
});

test('importing the server leaves listeners, timers, and database pools untouched', () => {
  const { spawnSync } = require('node:child_process');
  const script = `
    require("mysql2/promise").createPool = () => { throw Error("pool created while importing"); };
    global.setInterval = () => { throw Error("interval created while importing"); };
    require("node:http").Server.prototype.listen = () => { throw Error("listen during import"); };
    require("./src/server/server");
    require("./src/server/core/sql");
  `;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
});

test('scheduler skips overlapping ticks and drains a running job before stopping', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const scheduler = require('../src/server/jobs/scheduler').createScheduler();
  let calls = 0, finish;
  scheduler.every('example', 10, () => { calls++; return new Promise(resolve => { finish = resolve; }); }, { immediate: true });
  await Promise.resolve();
  t.mock.timers.tick(100);
  let stopped = false;
  const close = scheduler.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(stopped, false);
  finish();
  await close;
  t.mock.timers.tick(100);
  assert.equal(calls, 1);
});
