const { isAccountBanned } = require('../../../shared/moderation/accountBan');
const BAN_HOLD_DURATION_MS = 24 * 60 * 60 * 1000;
const BAN_HOLD_UNTIL_COOKIE = "bb_ban_hold_until";
const BAN_HOLD_REASON_COOKIE = "bb_ban_reason";
const BAN_HOLD_USER_COOKIE = "bb_ban_user";

function parseBanHoldUntil(raw) {
  const untilMs = Number(raw) || 0;
  return untilMs > Date.now() ? untilMs : 0;
}

function clearBanHoldCookies(res) {
  if (!res) return;
  for (const name of [BAN_HOLD_UNTIL_COOKIE, BAN_HOLD_REASON_COOKIE, BAN_HOLD_USER_COOKIE, 'bb_ban_expires_at']) {
    res.clearCookie(name, { path: '/' });
  }
}

async function getBanHoldFromRequest(req, { db, res } = {}) {
  const userId = Number(req?.signedCookies?.[BAN_HOLD_USER_COOKIE]);
  // Old browser-only holds cannot establish an account restriction. Login and
  // authenticated requests still enforce the authoritative account state.
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    if (req?.cookies?.[BAN_HOLD_UNTIL_COOKIE]) clearBanHoldCookies(res);
    return null;
  }
  const [user] = await db.runQuery('SELECT user_id, is_banned, ban_expires_at, ban_reason FROM users WHERE user_id = ? LIMIT 1', [userId]);
  if (!isAccountBanned(user)) {
    clearBanHoldCookies(res);
    return null;
  }
  return {
    userId,
    expiresAt: user.ban_expires_at || null,
    untilMs: user.ban_expires_at ? new Date(user.ban_expires_at).getTime() : Date.now() + BAN_HOLD_DURATION_MS,
    reason: String(user.ban_reason || 'Your account has been banned.').trim(),
  };
}

function setBanHoldCookies({ req, res, reason, userId, expiresAt }) {
  if (!res) return;
  const secure = !!req?.app?.locals?.DISPLAY_COOKIE_OPTS?.secure;
  const duration = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : BAN_HOLD_DURATION_MS;
  const untilMs = Date.now() + duration;
  const safeReason = String(reason || 'Your account has been banned.').replace(/\s+/g, ' ').trim().slice(0, 220);
  const cookieOpts = { sameSite: 'lax', secure, path: '/', maxAge: duration };
  res.cookie(BAN_HOLD_UNTIL_COOKIE, String(untilMs), cookieOpts);
  res.cookie(BAN_HOLD_REASON_COOKIE, safeReason, cookieOpts);
  res.cookie('bb_ban_expires_at', expiresAt ? String(new Date(expiresAt).getTime()) : '', cookieOpts);
  if (Number.isSafeInteger(Number(userId)) && Number(userId) > 0) {
    res.cookie(BAN_HOLD_USER_COOKIE, String(userId), { ...cookieOpts, signed: true, httpOnly: true });
  }
}

module.exports = { BAN_HOLD_DURATION_MS, BAN_HOLD_UNTIL_COOKIE, BAN_HOLD_REASON_COOKIE, BAN_HOLD_USER_COOKIE, parseBanHoldUntil, getBanHoldFromRequest, setBanHoldCookies, clearBanHoldCookies };
