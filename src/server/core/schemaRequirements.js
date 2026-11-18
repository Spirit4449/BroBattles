// Expected schema after a clean bootstrap. Keep the contract in step with migrations.
// Indexes and foreign keys are matched by their definitions, independent of names.
module.exports = {
  account_emails: {
    columns: "user_id email verified_at pending_email code_hash expires_at attempts sent_at window_start " +
      "send_count correction_used",
    keys: [
      "PRIMARY (user_id)",
      "UNIQUE (email)",
    ],
  },
  auth_sessions: {
    columns: "token_hash user_id created_at expires_at",
    keys: [
      "INDEX (expires_at)",
      "INDEX (user_id)",
      "PRIMARY (token_hash)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  email_marketing: {
    columns: "user_id email subscribed unsubscribe_id consent_at unsubscribed_at updated_at",
    keys: [
      "UNIQUE (email)",
      "PRIMARY (user_id)",
      "UNIQUE (unsubscribe_id)",
    ],
  },
  email_outbox: {
    columns: "id request_id created_at sent_at attempts next_attempt_at",
    keys: [
      "UNIQUE (request_id)",
      "PRIMARY (id)",
    ],
    foreignKeys: [
      "(request_id) REFERENCES site_requests (id) ON DELETE CASCADE",
    ],
  },
  email_webhook_events: {
    columns: "id created_at",
    keys: [
      "PRIMARY (id)",
    ],
  },
  friend_message_reactions: {
    columns: "message_id user_id reaction created_at",
    keys: [
      "INDEX (user_id)",
      "PRIMARY (message_id, user_id)",
    ],
    foreignKeys: [
      "(message_id) REFERENCES friend_messages (message_id) ON DELETE CASCADE",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  friend_messages: {
    columns: "message_id sender_id recipient_id body created_at read_at user_a user_b",
    keys: [
      "INDEX (sender_id)",
      "INDEX (user_a, user_b, message_id)",
      "INDEX (recipient_id, read_at)",
      "PRIMARY (message_id)",
    ],
    foreignKeys: [
      "(recipient_id) REFERENCES users (user_id) ON DELETE CASCADE",
      "(sender_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  friend_requests: {
    columns: "request_id from_user_id to_user_id status created_at responded_at pending_pair",
    keys: [
      "INDEX (from_user_id, status)",
      "INDEX (to_user_id, status)",
      "PRIMARY (request_id)",
      "UNIQUE (pending_pair)",
    ],
    foreignKeys: [
      "(from_user_id) REFERENCES users (user_id) ON DELETE CASCADE",
      "(to_user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  friendships: {
    columns: "user_id friend_id created_at",
    keys: [
      "INDEX (friend_id)",
      "PRIMARY (user_id, friend_id)",
    ],
    foreignKeys: [
      "(friend_id) REFERENCES users (user_id) ON DELETE CASCADE",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  legal_acceptances: {
    columns: "user_id terms_version privacy_version context accepted_at",
    keys: [
      "PRIMARY (user_id, terms_version, privacy_version, context)",
    ],
  },
  marketing_contact_sync: {
    columns: "email subscribed synced_at next_attempt_at attempts",
    keys: [
      "PRIMARY (email)",
    ],
  },
  marketing_jobs: {
    columns: "id user_id email kind due_at sent_at cancelled_at attempts last_error",
    keys: [
      "PRIMARY (id)",
      "INDEX (sent_at, cancelled_at, due_at)",
      "UNIQUE (user_id, kind)",
    ],
  },
  match_bot_participants: {
    columns: "participant_id match_id name team char_class level trophies seed difficulty health_override " +
      "created_at",
    keys: [
      "PRIMARY (participant_id)",
      "UNIQUE (match_id, name)",
    ],
    foreignKeys: [
      "(match_id) REFERENCES matches (match_id) ON DELETE CASCADE",
    ],
  },
  match_participants: {
    columns: "match_id user_id party_id team char_class trophies_delta kills damage hits coins_awarded " +
      "gems_awarded",
    keys: [
      "INDEX (party_id)",
      "INDEX (user_id)",
      "PRIMARY (match_id, user_id)",
    ],
    foreignKeys: [
      "(match_id) REFERENCES matches (match_id) ON DELETE CASCADE",
      "(party_id) REFERENCES parties (party_id) ON DELETE SET NULL",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  match_reward_commits: {
    columns: "match_id summary committed_at",
    keys: [
      "PRIMARY (match_id)",
    ],
  },
  match_tickets: {
    columns: "ticket_id party_id user_id mode mode_id mode_variant_id map size mmr team1_count team2_count " +
      "status claimed_by created_at",
    keys: [
      "INDEX (status, mode_id, mode_variant_id, map, created_at)",
      "UNIQUE (party_id)",
      "PRIMARY (ticket_id)",
      "UNIQUE (user_id)",
    ],
    foreignKeys: [
      "(party_id) REFERENCES parties (party_id) ON DELETE CASCADE",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  matches: {
    columns: "match_id mode mode_id mode_variant_id map status created_at winner_team summary",
    keys: [
      "INDEX (created_at)",
      "PRIMARY (match_id)",
    ],
  },
  parties: {
    columns: "party_id status mode mode_id mode_variant_id map created_at is_public public_name " +
      "allow_member_selection hide_enemy_bros",
    keys: [
      "INDEX (is_public)",
      "INDEX (public_name)",
      "PRIMARY (party_id)",
    ],
  },
  party_chat_message_reactions: {
    columns: "party_id message_id user_id reaction created_at",
    keys: [
      "INDEX (message_id)",
      "INDEX (user_id)",
      "PRIMARY (party_id, message_id, user_id)",
    ],
    foreignKeys: [
      "(message_id) REFERENCES party_chat_messages (message_id) ON DELETE CASCADE",
      "(party_id) REFERENCES parties (party_id) ON DELETE CASCADE",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  party_chat_message_reads: {
    columns: "party_id message_id user_id read_at",
    keys: [
      "INDEX (user_id)",
      "INDEX (message_id)",
      "INDEX (party_id, user_id)",
      "PRIMARY (party_id, message_id, user_id)",
    ],
    foreignKeys: [
      "(message_id) REFERENCES party_chat_messages (message_id) ON DELETE CASCADE",
      "(party_id) REFERENCES parties (party_id) ON DELETE CASCADE",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  party_chat_messages: {
    columns: "message_id party_id user_id reply_to_message_id body created_at updated_at",
    keys: [
      "INDEX (reply_to_message_id)",
      "INDEX (party_id, message_id)",
      "INDEX (user_id)",
      "PRIMARY (message_id)",
    ],
    foreignKeys: [
      "(party_id) REFERENCES parties (party_id) ON DELETE CASCADE",
      "(reply_to_message_id) REFERENCES party_chat_messages (message_id) ON DELETE SET NULL",
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  party_join_requests: {
    columns: "request_id party_id requester_user_id request_count status requested_at responded_at",
    keys: [
      "INDEX (party_id, status)",
      "INDEX (requester_user_id)",
      "PRIMARY (request_id)",
      "UNIQUE (party_id, requester_user_id)",
    ],
    foreignKeys: [
      "(party_id) REFERENCES parties (party_id) ON DELETE CASCADE",
      "(requester_user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  party_members: {
    columns: "party_id name team joined_at last_seen slot_index",
    keys: [
      "INDEX (name)",
      "PRIMARY (party_id, name)",
    ],
    foreignKeys: [
      "(party_id) REFERENCES parties (party_id) ON DELETE CASCADE",
      "(name) REFERENCES users (name) ON DELETE CASCADE ON UPDATE CASCADE",
    ],
  },
  pending_signups: {
    columns: "user_id challenge_id username password_hash email code_hash expires_at attempts sent_at " +
      "window_start send_count correction_used marketing_consent terms_version privacy_version",
    keys: [
      "PRIMARY (user_id)",
    ],
  },
  shop_currency_ledger: {
    columns: "ledger_id user_id currency amount source_type source_id created_at",
    keys: [
      "INDEX (user_id, created_at)",
      "PRIMARY (ledger_id)",
      "UNIQUE (source_type, source_id, currency)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  shop_orders: {
    columns: "order_id user_id offer_id status amount_cents currency reward_snapshot idempotency_key " +
      "stripe_checkout_session_id stripe_payment_intent_id refunded_amount_cents reversed_coins " +
      "reversed_gems dispute_status last_error created_at updated_at fulfilled_at",
    keys: [
      "INDEX (user_id, created_at)",
      "PRIMARY (order_id)",
      "UNIQUE (user_id, idempotency_key)",
      "UNIQUE (stripe_payment_intent_id)",
      "UNIQUE (stripe_checkout_session_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  shop_redemptions: {
    columns: "redemption_id user_id offer_id limit_key redemption_kind idempotency_key price_snapshot " +
      "reward_snapshot status created_at fulfilled_at",
    keys: [
      "INDEX (user_id, created_at)",
      "PRIMARY (redemption_id)",
      "UNIQUE (user_id, idempotency_key)",
      "UNIQUE (user_id, offer_id, limit_key)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  shop_rotation_state: {
    columns: "section period_key generation refreshed_at next_refresh_at refreshed_by_user_id",
    keys: [
      "PRIMARY (section)",
    ],
  },
  shop_views: {
    columns: "user_id view_kind view_key viewed_at",
    keys: [
      "PRIMARY (user_id, view_kind, view_key)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  shop_webhook_events: {
    columns: "event_id event_type status attempt_count last_error received_at processed_at",
    keys: [
      "PRIMARY (event_id)",
    ],
  },
  shop_webhook_inbox: {
    columns: "event_id payload next_attempt_at",
    keys: [
      "INDEX (next_attempt_at)",
      "PRIMARY (event_id)",
    ],
  },
  site_request_messages: {
    columns: "id request_id sender author_id body submission_key created_at",
    keys: [
      "PRIMARY (id)",
      "UNIQUE (request_id, sender, submission_key)",
    ],
    foreignKeys: [
      "(request_id) REFERENCES site_requests (id) ON DELETE CASCADE",
    ],
  },
  site_requests: {
    columns: "id user_id kind category subject status version submission_key created_at updated_at closed_at " +
      "player_read_at admin_read_at",
    keys: [
      "PRIMARY (id)",
      "INDEX (kind, status, updated_at)",
      "INDEX (user_id, kind, updated_at)",
      "UNIQUE (user_id, submission_key)",
    ],
  },
  user_abuse_events: {
    columns: "event_id user_id category source action_taken offense_level detail created_at",
    keys: [
      "INDEX (category, created_at)",
      "INDEX (user_id, created_at)",
      "PRIMARY (event_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  user_cards: {
    columns: "user_id card_id acquired_at source",
    keys: [
      "INDEX (user_id)",
      "PRIMARY (user_id, card_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  user_privacy_settings: {
    columns: "user_id friend_requests messages party_invites last_seen read_receipts show_in_suggestions " +
      "updated_at",
    keys: [
      "PRIMARY (user_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  user_profile_icons: {
    columns: "user_id icon_id unlocked_at source",
    keys: [
      "INDEX (user_id)",
      "PRIMARY (user_id, icon_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  user_skins: {
    columns: "user_id skin_id acquired_at source",
    keys: [
      "INDEX (user_id)",
      "PRIMARY (user_id, skin_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  user_titles: {
    columns: "user_id title_id source unlocked_at",
    keys: [
      "PRIMARY (user_id, title_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  user_trophy_reward_claims: {
    columns: "user_id tier_id claimed_at",
    keys: [
      "INDEX (user_id)",
      "PRIMARY (user_id, tier_id)",
    ],
    foreignKeys: [
      "(user_id) REFERENCES users (user_id) ON DELETE CASCADE",
    ],
  },
  users: {
    columns: "user_id name socket_id char_class status expires_at char_levels coins gems trophies password " +
      "created_at updated_at preferred_mode_id preferred_mode_variant_id preferred_map_id " +
      "abuse_offense_count abuse_offense_window_expires_at abuse_suspension_count selected_card_id " +
      "selected_profile_icon_id chat_offense_level chat_last_violation_at chat_suspended_until " +
      "chat_decay_anchor_at http_offense_level http_last_violation_at mm_suspended_until " +
      "http_decay_anchor_at is_banned banned_at ban_reason selected_skin_id_by_char stripe_customer_id " +
      "trophy_peak friend_code last_seen_at highest_win_streak next_name_change_at selected_title_id " +
      "ban_expires_at",
    keys: [
      "INDEX (chat_suspended_until)",
      "INDEX (is_banned)",
      "INDEX (mm_suspended_until)",
      "UNIQUE (stripe_customer_id)",
      "UNIQUE (name)",
      "PRIMARY (user_id)",
      "UNIQUE (friend_code)",
    ],
    checks: [
      "json_valid(char_levels)",
    ],
  },
};
