// The ban page reads these display cookies. The signed account hold stays server-side.
const BAN_REASON_COOKIE = 'bb_ban_reason';
const BAN_EXPIRES_AT_COOKIE = 'bb_ban_expires_at';

// A null expiry is permanent. Timed bans stop applying at the exact deadline,
// including after restarts, without depending on a cleanup timer.
function isAccountBanned(user, now = Date.now()) {
  if (Number(user?.is_banned) !== 1) return false;
  if (!user.ban_expires_at) return true;
  const until = new Date(user.ban_expires_at).getTime();
  return !Number.isFinite(until) || until > now;
}

module.exports = { isAccountBanned, BAN_REASON_COOKIE, BAN_EXPIRES_AT_COOKIE };
