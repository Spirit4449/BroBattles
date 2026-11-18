const { readAdminPlayer } = require("../admin/adminPlayerRow");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents");
const { isAccountBanned } = require("../../../shared/moderation/accountBan");
const { httpError } = require("../httpError");

function bannedResult() {
  return {
    allowed: false,
    type: "ban",
    message: "Your account has been banned.",
    clearAuth: false,
  };
}

async function recordAbuseEvent(q, { userId, category, source, action, level, detail }) {
  await q(
    "INSERT INTO user_abuse_events (user_id, category, source, action_taken, offense_level, detail) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, category, source.slice(0, 120), action, level, JSON.stringify(detail)],
  );
}

// The caller holds the user's row lock. Account changes and audit entries commit together.
async function writeRestriction(q, { userId, action, reason, expiresAt = null, adminUserId }) {
  if (action === "unban") {
    await q(
      "UPDATE users SET is_banned = 0, banned_at = NULL, ban_expires_at = NULL, ban_reason = NULL, updated_at = NOW() WHERE user_id = ?",
      [userId],
    );
  } else {
    await q(
      "UPDATE users SET is_banned = 1, banned_at = NOW(), ban_reason = ?, ban_expires_at = ?, updated_at = NOW() WHERE user_id = ?",
      [reason, expiresAt, userId],
    );
  }
  await recordAbuseEvent(q, {
    userId,
    category: "account",
    action,
    source: adminUserId ? "admin" : "abuse-control",
    level: adminUserId ? 0 : 999,
    detail: adminUserId
      ? { adminUserId, reason: action === "unban" ? null : reason, expiresAt }
      : { reason },
  });
}

function disconnectRestrictedAccount(io, userId, reason, expiresAt = null) {
  const sockets = io?.in(`user:${userId}`);
  sockets?.emit(SOCKET_EVENTS.AUTH_BANNED, { reason, expiresAt });
  sockets?.disconnectSockets(true);
}

async function applyAdminRestriction({
  db,
  io,
  userId,
  action,
  reason,
  durationMinutes,
  adminUserId,
}) {
  const user = await db.withTransaction(async (_conn, q) => {
    const target = await readAdminPlayer(q, userId, { lock: true });
    if (!target) return null;
    if (action !== "unban" && isAccountBanned(target) && !target.ban_expires_at) {
      if (action === "suspend")
        throw httpError(409, "Unban this player before applying a temporary suspension");
      return target;
    }
    if (action === "unban" && Number(target.is_banned) !== 1) return target;
    const expiresAt = action === "suspend" ? new Date(Date.now() + durationMinutes * 60000) : null;
    await writeRestriction(q, { userId, action, reason, expiresAt, adminUserId });
    return readAdminPlayer(q, userId);
  });
  if (user && action !== "unban")
    disconnectRestrictedAccount(io, userId, user.ban_reason, user.ban_expires_at);
  return user;
}

module.exports = {
  bannedResult,
  recordAbuseEvent,
  writeRestriction,
  disconnectRestrictedAccount,
  applyAdminRestriction,
};
