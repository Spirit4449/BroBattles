// Applies a named schema or backfill step. The bootstrap is for empty schemas.
//
//   node scripts/db/apply-migration.cjs <name>      (npm run migrate:apply -- <name>)
//   node scripts/db/apply-migration.cjs --list
const { hasColumn, hasIndex, readMigration, runScript } = require('./db.cjs');
const { assertSchema } = require('../../src/server/core/schemaContract');

// Explicit order includes helper-only changes and same-day dependencies.
const BOOTSTRAP_ORDER = [
  '0000_base_schema.sql',
  '2026-03-25_game_mode_registry_scaffold.sql',
  '2026-04-06_trophy_reward_claims.sql',
  '2026-04-09_party_discovery_visibility.sql',
  '2026-04-11_party_chat.sql',
  '2026-04-14_party_join_requests.sql',
  'player-cards',
  '2026-04-14_profile_icons.sql',
  '2026-04-15_abuse_controls.sql',
  '2026-04-16_skins.sql',
  '2026-08-31_shop_commerce.sql',
  '2026-09-03_adaptive_bots.sql',
  '2026-09-03_party_member_selection.sql',
  'hardening',
  'site',
  'email',
  'signup-marketing',
  'email-polish',
  'party-slots',
  'trophy-road',
  'friends',
  'shop-views',
  'friend-last-seen',
  'highest-win-streak',
  'name-changes',
  'privacy-settings',
  'party-hidden-bros',
  'titles',
  'temporary-bans',
  '2026-11-12_ozzy_sparrow.sql',
  'shop-payment-intent-unique',
  'party-member-rename-cascade',
];

async function requireTables(conn, tables) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
    [tables]);
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = tables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Verification failed; missing tables: ${missing.join(', ')}`);
}

const MIGRATIONS = {
  bootstrap: {
    describe: 'Build the full game schema in an empty database.',
    async run(conn) {
      const [[{ tableCount }]] = await conn.query(
        'SELECT COUNT(*) AS tableCount FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
      );
      if (Number(tableCount) !== 0) {
        throw new Error('Bootstrap requires an empty database. Use the individual migration steps on an existing installation.');
      }
      await conn.query('SET SESSION default_storage_engine = InnoDB');
      for (const step of BOOTSTRAP_ORDER) {
        try {
          if (step.endsWith('.sql')) await conn.query(readMigration(step));
          else await MIGRATIONS[step].run(conn);
        } catch (error) {
          throw new Error(`Bootstrap failed at ${step}: ${error.message}`, { cause: error });
        }
      }
      await assertSchema({ runQuery: async sql => (await conn.query(sql))[0] });
    },
  },
  'player-cards': {
    describe: 'Player-card ownership and equipped card.',
    async run(conn) {
      await conn.query(readMigration('2026-04-14_player_cards.sql'));
      await requireTables(conn, ['user_cards']);
      if (!(await hasColumn(conn, 'users', 'selected_card_id'))) throw new Error('Missing users.selected_card_id');
    },
  },
  'shop-payment-intent-unique': {
    describe: 'Require a unique Stripe payment intent per shop order.',
    async run(conn) {
      await conn.query(readMigration('2026-11-17_shop_payment_intent_unique.sql'));
    },
  },
  'party-member-rename-cascade': {
    describe: 'Keep party membership linked when a user changes their name.',
    async run(conn) {
      await conn.query(readMigration('2026-11-17_party_member_rename_cascade.sql'));
    },
  },
  'temporary-bans': {
    describe: 'Optional expiry for account bans and suspensions.',
    async run(conn) {
      if (!(await hasColumn(conn, 'users', 'ban_expires_at'))) {
        await conn.query(readMigration('2026-11-12_temporary_bans.sql'));
      }
      if (!(await hasColumn(conn, 'users', 'ban_expires_at'))) throw new Error('Missing users.ban_expires_at');
    },
  },
  titles: {
    describe: 'Purchasable player titles and equipped title.',
    async run(conn) {
      await conn.query(readMigration('2026-11-12_titles.sql'));
      await requireTables(conn, ['user_titles']);
      if (!(await hasColumn(conn, 'users', 'selected_title_id'))) throw new Error('Missing users.selected_title_id');
    },
  },
  'party-hidden-bros': {
    describe: 'Owner-controlled hidden enemy Bro portraits in party lobbies.',
    async run(conn) {
      if (!(await hasColumn(conn, 'parties', 'hide_enemy_bros'))) {
        await conn.query(readMigration('2026-11-11_party_hidden_bros.sql'));
      }
      if (!(await hasColumn(conn, 'parties', 'hide_enemy_bros'))) throw new Error('Missing parties.hide_enemy_bros');
    },
  },
  'name-changes': {
    describe: 'Persistent monthly name-change cooldown.',
    async run(conn) {
      await conn.query(readMigration('2026-10-09_name_changes.sql'));
      if (!(await hasColumn(conn, 'users', 'next_name_change_at'))) {
        throw new Error('Verification failed; missing users.next_name_change_at');
      }
    },
  },
  'friend-last-seen': {
    describe: 'Persistent account activity timestamps for friends.',
    async run(conn) {
      await conn.query(readMigration('2026-10-09_friend_last_seen.sql'));
      if (!(await hasColumn(conn, 'users', 'last_seen_at'))) {
        throw new Error('Verification failed; missing users.last_seen_at');
      }
    },
  },
  'privacy-settings': {
    describe: 'Per-account friend, message and presence privacy settings.',
    async run(conn) {
      await conn.query(readMigration('2026-10-09_privacy_settings.sql'));
      await requireTables(conn, ['user_privacy_settings']);
    },
  },
  'highest-win-streak': {
    describe: 'Stored highest win streak and completed-history backfill.',
    async run(conn) {
      await requireTables(conn, ['users', 'matches', 'match_participants']);
      await conn.query(readMigration('2026-10-09_highest_win_streak.sql'));
      if (!(await hasColumn(conn, 'users', 'highest_win_streak'))) {
        throw new Error('Verification failed; missing users.highest_win_streak');
      }
      await require('./backfill-highest-win-streak.cjs').backfillHighestWinStreak(conn);
    },
  },
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

if (require.main === module) {
  const name = process.argv[2];
  if (!name || name === '--list' || !Object.hasOwn(MIGRATIONS, name)) {
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
}

module.exports = { bootstrapSchema: MIGRATIONS.bootstrap.run };
