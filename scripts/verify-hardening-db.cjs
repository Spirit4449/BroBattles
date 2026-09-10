// Creates and removes an isolated local database. Never changes the configured game database.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const schema = `bb_review_${crypto.randomBytes(8).toString('hex')}`;
const host = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('This verifier only connects to a local MySQL server');
const config = { host, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, multipleStatements: true };
let admin, db, firstOwner;
async function run() {
  admin = await mysql.createConnection(config);
  await admin.query(`CREATE DATABASE \`${schema}\``);
  await admin.query(`USE \`${schema}\``);
  await admin.query(`
    CREATE TABLE users (user_id INT PRIMARY KEY, name VARCHAR(50), password TEXT, expires_at DATETIME,
      coins INT DEFAULT 0, gems INT DEFAULT 0, trophies INT DEFAULT 0, is_banned INT DEFAULT 0) ENGINE=InnoDB;
    CREATE TABLE matches (match_id INT PRIMARY KEY, status VARCHAR(20), winner_team VARCHAR(16), summary JSON) ENGINE=InnoDB;
    CREATE TABLE parties (party_id INT PRIMARY KEY, status VARCHAR(20)) ENGINE=InnoDB;
    CREATE TABLE match_participants (match_id INT, user_id INT, party_id INT, trophies_delta INT, kills INT,
      damage INT, hits INT, coins_awarded INT, gems_awarded INT, PRIMARY KEY(match_id, user_id)) ENGINE=InnoDB;
    INSERT INTO users (user_id, name, password) VALUES (1, 'Review', 'old-hash');
    INSERT INTO matches VALUES (1, 'live', NULL, NULL);
    INSERT INTO parties VALUES (1, 'live');
    INSERT INTO match_participants (match_id, user_id, party_id) VALUES (1, 1, 1);
  `);
  await admin.query(await fs.readFile(path.join(__dirname, '../migrations/2026-08-31_shop_commerce.sql'), 'utf8'));
  const migration = await fs.readFile(path.join(__dirname, '../migrations/2026-09-10_production_hardening.sql'), 'utf8');
  await admin.query(migration); await admin.query(migration); // Reapplying must be safe.
  Object.assign(process.env, { DB_NAME: schema, DB_CONNECTION_LIMIT: '2', DB_QUEUE_LIMIT: '2', DB_ACQUIRE_TIMEOUT_MS: '250', DB_QUERY_TIMEOUT_MS: '1000' });
  db = require('../src/server/core/sql');
  const { acquireRuntimeOwnership } = require('../src/server/services/runtimeOwnershipService');
  firstOwner = await acquireRuntimeOwnership({ connect: db.openRuntimeConnection, database: schema, onLost: e => { throw e; } });
  await assert.rejects(acquireRuntimeOwnership({ connect: db.openRuntimeConnection, database: schema, onLost() {} }), /already owns/);
  await firstOwner.release(); firstOwner = null;
  console.log('PASS: migration reapply and real MySQL runtime exclusivity');

  const { createAuthSessionService } = require('../src/server/services/authSessionService');
  const sessions = createAuthSessionService({ db, cookieOptions: { signed: true } });
  const res = { cookie() {}, clearCookie() {} };
  const user = { user_id: 1, name: 'Review', password: 'old-hash' };
  const token = await sessions.create(user, res);
  const socket = Object.assign(new EventEmitter(), { data: {}, use() {}, disconnect() { this.disconnected = true; this.emit('disconnect'); } });
  assert.equal((await sessions.authenticateSocket(socket, token)).user_id, 1);
  await sessions.changePassword(1, 'old-hash', 'new-hash');
  assert.equal(socket.disconnected, true); assert.equal(await sessions.resolve(token), null);
  await assert.rejects(sessions.create(user, res), /credentials changed/);
  console.log('PASS: sessions, transactional socket authentication, password revocation');

  const { distributeMatchRewards } = require('../src/server/core/gameRoom/rewardManager');
  const room = { db, matchId: 1, matchData: { modeId: 'duels', modeVariantId: 'duels-1v1', map: 1 },
    players: new Map([['p', { user_id: 1, name: 'Review', char_class: 'ninja', team: 'team1' }]]), rewardStats: new Map() };
  const [a, b] = await Promise.all([distributeMatchRewards(room, 'team1'), distributeMatchRewards(room, 'team1')]);
  assert.deepEqual(a, b);
  const [wallet] = await db.runQuery('SELECT coins, gems FROM users WHERE user_id = 1');
  assert.equal(wallet.coins, a[0].coinsAwarded); assert.equal(wallet.gems, a[0].gemsAwarded);
  assert.equal((await db.runQuery('SELECT status FROM matches WHERE match_id = 1'))[0].status, 'completed');
  assert.equal((await db.runQuery('SELECT coins_awarded FROM match_participants WHERE user_id = 1'))[0].coins_awarded, a[0].coinsAwarded);
  console.log('PASS: concurrent reward settlement credits once and commits history');

  const { createStripeShopService } = require('../src/server/services/stripeShopService');
  process.env.STRIPE_SECRET_KEY = 'mock'; process.env.STRIPE_WEBHOOK_SECRET = 'mock';
  let event = { id: 'evt_refund', type: 'refund.created', data: { object: { payment_intent: 'pi_review', amount: 250 } } };
  const stripeClient = { webhooks: { constructEvent(_payload, signature) { if (signature !== 'valid') throw new Error('Invalid signature'); return event; } } };
  const shopService = { createShopError: (status, code, message) => Object.assign(new Error(message), { status, code }) };
  const stripe = createStripeShopService({ db, shopService, stripeClient });
  await db.runQuery(`INSERT INTO shop_orders (order_id, user_id, offer_id, amount_cents, currency, reward_snapshot, idempotency_key)
    VALUES ('order', 1, 'offer', 500, 'usd', ?, 'review')`, [JSON.stringify([{ kind: 'currency', currency: 'gems', amount: 100 }])]);
  await assert.rejects(stripe.handleWebhook(Buffer.from('{}'), 'invalid'), /signature/);
  assert.equal((await db.runQuery('SELECT * FROM shop_webhook_inbox')).length, 0);
  await assert.rejects(stripe.handleWebhook(Buffer.from('{}'), 'valid'), /not ready/);
  assert.equal((await db.runQuery('SELECT status FROM shop_webhook_events'))[0].status, 'failed');
  assert.equal((await db.runQuery('SELECT * FROM shop_webhook_inbox')).length, 1);
  await db.runQuery("UPDATE shop_orders SET status = 'fulfilled', fulfilled_at = NOW(), stripe_payment_intent_id = 'pi_review'");
  await db.runQuery('UPDATE users SET gems = 100 WHERE user_id = 1');
  await db.runQuery('UPDATE shop_webhook_inbox SET next_attempt_at = NOW()');
  await stripe.reconcileWebhooks();
  assert.equal((await db.runQuery('SELECT gems FROM users WHERE user_id = 1'))[0].gems, 50);
  assert.equal((await db.runQuery('SELECT * FROM shop_webhook_inbox')).length, 0);
  await stripe.handleWebhook(Buffer.from('{}'), 'valid');
  assert.equal((await db.runQuery('SELECT gems FROM users WHERE user_id = 1'))[0].gems, 50);
  console.log('PASS: refund before fulfillment, durable retry, duplicate delivery, signature rejection');

  const x = await db.pool.getConnection(), y = await db.pool.getConnection();
  await assert.rejects(db.runQuery('SELECT 1'), error => error.code === 'DB_BUSY');
  x.release(); y.release();
  await assert.rejects(db.runQuery('SELECT SLEEP(2)'), error => error.code === 'PROTOCOL_SEQUENCE_TIMEOUT');
  assert.equal((await db.runQuery('SELECT 1 AS ok'))[0].ok, 1);
  console.log('PASS: bounded connection wait, query timeout, healthy connection recovery');
}
run().catch(error => { console.error('Integration verification failed:', error.code || '', error.message); process.exitCode = 1; })
  .finally(async () => {
    await firstOwner?.release();
    await db?.pool.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``); await admin.end(); }
  });
