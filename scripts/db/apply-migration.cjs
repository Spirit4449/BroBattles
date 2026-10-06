// Applies one named, additive migration and verifies it. Every step is safe
// to re-run; none rewrites existing game data.
//
//   node scripts/db/apply-migration.cjs <name>      (npm run migrate:apply -- <name>)
//   node scripts/db/apply-migration.cjs --list
const { hasColumn, hasIndex, readMigration, runScript } = require('./db.cjs');

async function requireTables(conn, tables) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
    [tables]);
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = tables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Verification failed; missing tables: ${missing.join(', ')}`);
}

const MIGRATIONS = {
  'shop-views': {
    describe: 'Account-saved viewed Shop offers and rotations.',
    async run(conn) {
      await conn.query(readMigration('2026-10-06_shop_views.sql'));
      await requireTables(conn, ['shop_views']);
    },
  },
  hardening: {
    describe: 'Battle log, auth sessions, reward commits and webhook inbox.',
    async run(conn) {
      for (const table of ['users', 'matches', 'match_participants', 'parties', 'shop_orders', 'shop_webhook_events']) {
        const [rows] = await conn.query('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
        if (rows[0]?.ENGINE !== 'InnoDB') throw new Error(`${table} must exist and use InnoDB before this migration`);
      }
      await conn.query(readMigration('2026-09-03_match_battle_log.sql'));
      await conn.query(readMigration('2026-09-10_production_hardening.sql'));
      await requireTables(conn, ['auth_sessions', 'match_reward_commits', 'shop_webhook_inbox']);
    },
  },
  site: {
    describe: 'Legal acceptances and support requests.',
    async run(conn) {
      await conn.query(readMigration('2026-09-12_site_support.sql'));
      await requireTables(conn, ['legal_acceptances', 'site_requests', 'site_request_messages']);
    },
  },
  email: {
    describe: 'Account emails and the email outbox.',
    async run(conn) {
      await conn.query(readMigration('2026-09-13_email.sql'));
      await requireTables(conn, ['account_emails', 'email_outbox']);
    },
  },
  'email-polish': {
    describe: 'Email correction cooldown columns.',
    async run(conn) {
      for (const table of ['pending_signups', 'account_emails']) {
        if (!(await hasColumn(conn, table, 'correction_used'))) {
          await conn.query(`ALTER TABLE ${table} ADD COLUMN correction_used BOOLEAN NOT NULL DEFAULT FALSE`);
        }
      }
    },
  },
  'signup-marketing': {
    describe: 'Pending signups and marketing email tables.',
    async run(conn) {
      await conn.query(readMigration('2026-09-13_signup_marketing.sql'));
      await requireTables(conn, ['pending_signups', 'email_marketing', 'marketing_jobs', 'marketing_contact_sync', 'email_webhook_events']);
    },
  },
  'party-slots': {
    describe: 'party_members.slot_index.',
    async run(conn) {
      if (!(await hasColumn(conn, 'party_members', 'slot_index'))) {
        await conn.query(readMigration('2026-09-14_party_slots.sql'));
      }
    },
  },
  'trophy-road': {
    describe: 'Trophy peak, legacy claims and cosmetic backfill (no currency reissued).',
    async run(conn) {
      const { buildTrophyRewardTrack } = require('../../src/server/services/trophies/trophySystem');
      const { grantTrophyItems } = require('../../src/server/services/trophies/trophyRewardGrants');
      if (!(await hasColumn(conn, 'users', 'trophy_peak'))) {
        await conn.query('ALTER TABLE users ADD COLUMN trophy_peak INT UNSIGNED NOT NULL DEFAULT 0');
      }
      await conn.beginTransaction();
      try {
        await conn.query(readMigration('2026-09-15_trophy_road.sql'));
        const q = async (sql, params) => (await conn.query(sql, params))[0];
        for (const tier of buildTrophyRewardTrack()) {
          if (!tier.rewards.some((r) => !['currency', 'mode'].includes(r.kind))) continue;
          const rows = await q('SELECT user_id FROM user_trophy_reward_claims WHERE tier_id = ?', [tier.tierId]);
          for (const row of rows) {
            await q('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [row.user_id]);
            await grantTrophyItems(q, row.user_id, tier.rewards.filter((r) => r.kind !== 'currency'));
          }
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    },
  },
  friends: {
    describe: 'Friends tables, users.friend_code and matches.created_at index.',
    async run(conn) {
      if (!(await hasColumn(conn, 'users', 'friend_code'))) {
        await conn.query('ALTER TABLE users ADD COLUMN friend_code VARCHAR(12) NULL, ADD UNIQUE KEY uq_users_friend_code (friend_code)');
      }
      await conn.query(readMigration('2026-10-02_friends.sql'));
      if (!(await hasIndex(conn, 'matches', 'idx_matches_created_at'))) {
        await conn.query('ALTER TABLE matches ADD INDEX idx_matches_created_at (created_at)');
      }
    },
  },
};

const name = process.argv[2];
if (!name || name === '--list' || !MIGRATIONS[name]) {
  if (name && name !== '--list') console.error(`Unknown migration "${name}".`);
  console.log('Migrations:');
  for (const [key, { describe }] of Object.entries(MIGRATIONS)) console.log(`  ${key.padEnd(18)} ${describe}`);
  if (name && name !== '--list') process.exitCode = 1;
} else {
  runScript(`${name} migration`, async (conn) => {
    await MIGRATIONS[name].run(conn);
    console.log(`${name} migration applied and verified.`);
  });
}
