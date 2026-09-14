const crypto = require("node:crypto");
const config = require("../../shared/siteConfig.json");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function publicAsset(pathname) {
  const base = String(
    process.env.PUBLIC_BASE_URL || "https://classchats.net",
  ).replace(/\/$/, "");
  return `${base}${pathname}`;
}

function template(title, message, code) {
  const safeTitle = escape(title);
  const safeMessage = escape(message);
  const codeBlock = code
    ? `
    <tr><td style="padding:4px 34px 0">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate">
        <tr><td bgcolor="#03060b" style="height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td align="center" bgcolor="#071120" style="border:4px solid #03060b;border-top:0;padding:22px 12px 18px;color:#f7f9ff;font-family:'Courier New',monospace;font-size:34px;font-weight:900;letter-spacing:10px;line-height:1.15;text-shadow:3px 3px 0 #03060b">${escape(code)}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:19px 34px 4px;color:#91a5c2;font-family:Arial,sans-serif;font-size:13px;line-height:1.65">
      <strong style="color:#efc86e">EXPIRES IN 10 MINUTES</strong><br>Never share this code. If you didn't request it, you can safely ignore this email.
    </td></tr>`
    : "";

  return {
    subject: `${title} · Bro Battles`,
    text: `BRO BATTLES\n\n${title}\n\n${message}${code ? `\n\n${code}\n\nThis code expires in 10 minutes. Never share it.` : ""}\n\nBro Battles · ${config.supportEmail}`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${safeTitle}</title></head>
<body bgcolor="#050914" style="margin:0;padding:0;background:#050914;color:#f7f9ff">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${safeTitle} — ${safeMessage}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#050914" style="width:100%;background:#050914;border-collapse:collapse">
    <tr><td align="center" style="padding:38px 14px 48px">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;border-collapse:separate">
        <tr><td bgcolor="#03060b" style="padding:5px 7px 9px 5px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#111f37" style="width:100%;border:3px solid #385478;border-collapse:separate;background:#111f37">
            <tr><td style="padding:0;border-bottom:4px solid #03060b">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">
                <tr>
                  <td width="14%" bgcolor="#159dc9" height="12" style="height:12px;font-size:0;line-height:0">&nbsp;</td>
                  <td width="14%" bgcolor="#22afd2" style="font-size:0;line-height:0">&nbsp;</td>
                  <td width="14%" bgcolor="#2865c5" style="font-size:0;line-height:0">&nbsp;</td>
                  <td width="14%" bgcolor="#3d91eb" style="font-size:0;line-height:0">&nbsp;</td>
                  <td width="14%" bgcolor="#5d4dcd" style="font-size:0;line-height:0">&nbsp;</td>
                  <td width="14%" bgcolor="#6a43bd" style="font-size:0;line-height:0">&nbsp;</td>
                  <td width="16%" bgcolor="#3926a4" style="font-size:0;line-height:0">&nbsp;</td>
                </tr>
              </table>
            </td></tr>
            <tr><td align="center" bgcolor="#0b1629" style="padding:25px 30px 21px;background:#0b1629;border-bottom:2px solid #263b59">
              <img src="${escape(publicAsset("/assets/logos/wordmark.png"))}" width="238" alt="Bro Battles" style="display:block;width:238px;max-width:78%;height:auto;border:0;image-rendering:pixelated">
            </td></tr>
            <tr><td style="padding:30px 34px 8px">
              <h1 style="margin:0;color:#ffffff;font-family:'Courier New',monospace;font-size:25px;font-weight:900;line-height:1.35;text-shadow:3px 3px 0 #03060b;text-transform:uppercase">${safeTitle}</h1>
            </td></tr>
            <tr><td style="padding:10px 34px 24px;color:#c9d6e8;font-family:Arial,sans-serif;font-size:16px;line-height:1.7;white-space:pre-wrap">${safeMessage}</td></tr>
            ${codeBlock}
            <tr><td style="padding:28px 34px 30px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse"><tr><td bgcolor="#263b59" height="2" style="height:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>
              <p style="margin:18px 0 0;color:#7f95b3;font-family:Arial,sans-serif;font-size:12px;line-height:1.6">BRO BATTLES &nbsp;·&nbsp; <a href="mailto:${escape(config.supportEmail)}" style="color:#9fcaff;text-decoration:none">${escape(config.supportEmail)}</a></p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
}
function apiKey() {
  return process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
}
async function sendEmail(to, content, idempotencyKey) {
  if (!apiKey()) throw new Error("Email is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Bro Battles <noreply@classchats.net>",
      to: [to],
      reply_to: config.supportEmail,
      ...content,
      headers: { ...(content.headers || {}) },
    }),
  });
  if (!response.ok)
    throw new Error(`Email provider returned ${response.status}`);
}
function hashCode(userId, email, code) {
  return crypto
    .createHmac(
      "sha256",
      process.env.EMAIL_VERIFICATION_SECRET || process.env.COOKIE_SECRET,
    )
    .update(`${userId}:${email}:${code}`)
    .digest("hex");
}
function startEmailWorker(db) {
  let running = false;
  const tick = async () => {
    if (running || !apiKey() || !process.env.EMAIL_NOTIFICATIONS_TO) return;
    running = true;
    try {
      await db.withTransaction(async (_conn, q) => {
        const rows = await q(
          `SELECT o.id,o.request_id,r.kind,r.subject,r.category FROM email_outbox o JOIN site_requests r ON r.id=o.request_id WHERE o.sent_at IS NULL AND o.attempts<8 AND o.next_attempt_at<=NOW(3) ORDER BY o.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        if (!rows.length) return;
        const row = rows[0];
        try {
          await sendEmail(
            process.env.EMAIL_NOTIFICATIONS_TO,
            template(
              row.kind === "feedback" ? "New feedback" : "New help request",
              `Request #${row.request_id}\nCategory: ${row.category}\nSubject: ${row.subject}\n\nOpen the Bro Battles admin area to review and respond.`,
            ),
            `site-request-${row.request_id}`,
          );
          await q("UPDATE email_outbox SET sent_at=NOW(3) WHERE id=?", [
            row.id,
          ]);
        } catch (error) {
          console.warn("[email] Notification delivery failed:", error.message);
          await q(
            "UPDATE email_outbox SET attempts=attempts+1,next_attempt_at=DATE_ADD(NOW(3),INTERVAL 10 MINUTE) WHERE id=?",
            [row.id],
          );
        }
      });
    } catch (error) {
      console.warn("[email] Outbox unavailable:", error.code || error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  return timer;
}
module.exports = { template, sendEmail, hashCode, startEmailWorker };
