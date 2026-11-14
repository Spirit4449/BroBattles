const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe("Application bootstrap", () => {
  const { spawnSync } = require('node:child_process');

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
          if (request === './core/socket.js' && parent.filename.endsWith('/src/server/server.js')) {
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
        require('./src/server/server.js');
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
