function emailCooldown(row, nextEmail, previousEmail, now = Date.now()) {
  const fresh = !row.window_start || now - new Date(row.window_start).getTime() >= 3600000;
  const correction = !!previousEmail && previousEmail !== nextEmail;
  const correctionUsed = !!row.correction_used;
  const waive = correction && !correctionUsed;
  const remaining = Math.max(0, Math.ceil((new Date(row.sent_at || 0).getTime() + 60000 - now) / 1000));
  return { fresh, remaining, correctionUsed: correctionUsed || correction,
    error: !fresh && row.send_count >= 5 ? 'Too many codes requested. Try again in an hour.' : remaining && !waive ? `Wait ${remaining} seconds before requesting another code.` : null };
}
module.exports = { emailCooldown };
