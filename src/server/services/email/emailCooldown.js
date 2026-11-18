const { EMAIL_RESEND_SECONDS } = require("../../../shared/social/verificationCode");
const EMAIL_SEND_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_SEND_WINDOW_LIMIT = 5;

function emailResendRemaining(sentAt, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(sentAt || 0).getTime() + EMAIL_RESEND_SECONDS * 1000 - now) / 1000));
}

function emailCooldown(row, nextEmail, previousEmail, now = Date.now()) {
  const fresh = !row.window_start || now - new Date(row.window_start).getTime() >= EMAIL_SEND_WINDOW_MS;
  const correction = !!previousEmail && previousEmail !== nextEmail;
  const correctionUsed = !!row.correction_used;
  const waive = correction && !correctionUsed;
  const remaining = emailResendRemaining(row.sent_at, now);
  return { fresh, remaining, correctionUsed: correctionUsed || correction,
    error: !fresh && row.send_count >= EMAIL_SEND_WINDOW_LIMIT ? 'Too many codes requested. Try again in an hour.' : remaining && !waive ? `Wait ${remaining} seconds before requesting another code.` : null };
}
module.exports = { EMAIL_RESEND_SECONDS, emailResendRemaining, emailCooldown };
