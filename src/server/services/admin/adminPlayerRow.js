const userFields = `user_id, name, coins, gems, trophies, trophy_peak, status,
  char_class, char_levels, expires_at, created_at, updated_at, last_seen_at, highest_win_streak,
  selected_card_id, selected_profile_icon_id, selected_skin_id_by_char,
  is_banned, banned_at, ban_expires_at, ban_reason, chat_suspended_until, mm_suspended_until`;

async function readAdminPlayer(query, userId, { lock = false } = {}) {
  const [row] = await query(`SELECT ${userFields} FROM users WHERE user_id = ?${lock ? " FOR UPDATE" : ""}`, [userId]);
  return row || null;
}

module.exports = { userFields, readAdminPlayer };
