const BAN_HOLD_DURATION_MS = 24 * 60 * 60 * 1000;
const BAN_HOLD_UNTIL_COOKIE = "bb_ban_hold_until";
const BAN_HOLD_REASON_COOKIE = "bb_ban_reason";

function parseBanHoldUntil(raw) {
  const untilMs = Number(raw) || 0;
  return untilMs > Date.now() ? untilMs : 0;
}

function getBanHoldFromRequest(req) {
  const cookies = req?.cookies || {};
  const untilMs = parseBanHoldUntil(cookies[BAN_HOLD_UNTIL_COOKIE]);
  if (!untilMs) return null;
  return {
    untilMs,
    reason: String(cookies[BAN_HOLD_REASON_COOKIE] || "Your account has been banned.").trim(),
  };
}

function setBanHoldCookies({ req, res, reason }) {
  if (!res) return;
  const secure = String(req?.app?.locals?.DISPLAY_COOKIE_OPTS?.secure || "").toLowerCase() === "true";
  const untilMs = Date.now() + BAN_HOLD_DURATION_MS;
  const safeReason = String(reason || "Your account has been banned.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  const cookieOpts = {
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: BAN_HOLD_DURATION_MS,
  };

  res.cookie(BAN_HOLD_UNTIL_COOKIE, String(untilMs), cookieOpts);
  res.cookie(BAN_HOLD_REASON_COOKIE, safeReason, cookieOpts);
}

module.exports = {
  BAN_HOLD_DURATION_MS,
  BAN_HOLD_UNTIL_COOKIE,
  BAN_HOLD_REASON_COOKIE,
  parseBanHoldUntil,
  getBanHoldFromRequest,
  setBanHoldCookies,
};
