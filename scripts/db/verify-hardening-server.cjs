// End-to-end smoke test using a freshly bootstrapped local database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const { connect } = require('./db.cjs');
const { bootstrapSchema } = require('./apply-migration.cjs');

const schema = `bb_smoke_${crypto.randomBytes(8).toString('hex')}`;
const host = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Local MySQL only');
const port = crypto.randomInt(31000, 39000);
const base = `http://127.0.0.1:${port}`;
let admin, child, socket, journal;
let created = false;
let output = '';

async function run() {
  admin = await connect({ database: undefined, multipleStatements: true });
  await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [schema]);
  created = true;
  await admin.query('USE ??', [schema]);
  await bootstrapSchema(admin);
  journal = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-server-smoke-'));
  child = spawn(process.execPath, ['src/server/server.js'], {
    cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DB_NAME: schema, NODE_ENV: 'production', PORT: String(port),
      SECURE_COOKIES: 'false', COOKIE_SECRET: crypto.randomBytes(32).toString('hex'),
      MATCH_RESULT_DIR: journal, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' },
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const deadline = Date.now() + 20000;
  while (!output.includes('Server listening')) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    if (Date.now() >= deadline) throw new Error('Server startup timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await fetch(base)).status, 200);
  const status = await fetch(`${base}/status`, { method: 'POST' });
  assert.equal(status.status, 200);
  const cookie = status.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.match(cookie, /user_id=/);
  const [sessions] = await admin.query('SELECT token_hash FROM ??.auth_sessions', [schema]);
  assert.equal(sessions.length, 1);
  assert.match(sessions[0].token_hash, /^[a-f0-9]{64}$/);
  socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false });
  await Promise.race([once(socket, 'connect'), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5000); timer.unref();
    socket.once('connect', () => clearTimeout(timer));
    socket.once('connect_error', reject);
  })]);
  const disconnected = once(socket, 'disconnect');
  assert.equal((await fetch(`${base}/logout`, { method: 'POST', headers: { Cookie: cookie } })).status, 200);
  await Promise.race([disconnected, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Logout did not disconnect socket')), 5000); timer.unref();
    disconnected.then(() => clearTimeout(timer));
  })]);
  const [remaining] = await admin.query('SELECT COUNT(*) AS n FROM ??.auth_sessions', [schema]);
  assert.equal(remaining[0].n, 0);
  assert.doesNotMatch(output, /MySQL query failed|❌|UnhandledPromiseRejection/);
  console.log('PASS: production server startup, page load, guest session, WebSocket connection, logout revocation');
}

run().catch(error => { console.error('Server smoke failed:', error.message); process.exitCode = 1; })
  .finally(async () => {
    socket?.close();
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    if (admin) {
      try { if (created) await admin.query('DROP DATABASE ??', [schema]); }
      finally { await admin.end(); }
    }
    if (journal) await fs.rm(journal, { recursive: true, force: true });
  });
