const { getConfig } = require("../../config");
const crypto = require("node:crypto");
const { template } = require("./emailTemplates");

const { sendEmail } = require("./resendClient");
function hashCode(userId, email, code) {
  return crypto
    .createHmac("sha256", getConfig().email.verificationSecret)
    .update(`${userId}:${email}:${code}`)
    .digest("hex");
}
async function deliverNotification(db) {
  const { apiKey, notificationsTo } = getConfig().email;
  if (!apiKey || !notificationsTo) return;
  const row = await db.withTransaction(async (_conn, q) => {
    const [job] = await q(
      `SELECT o.id,o.request_id,r.kind,r.subject,r.category FROM email_outbox o JOIN site_requests r ON r.id=o.request_id WHERE o.sent_at IS NULL AND o.attempts<8 AND o.next_attempt_at<=NOW(3) ORDER BY o.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (job)
      await q(
        "UPDATE email_outbox SET next_attempt_at=DATE_ADD(NOW(3),INTERVAL 10 MINUTE) WHERE id=?",
        [job.id],
      );
    return job;
  });
  if (!row) return;
  try {
    await sendEmail(
      notificationsTo,
      template(
        row.kind === "feedback" ? "New feedback" : "New help request",
        `Request #${row.request_id}\nCategory: ${row.category}\nSubject: ${row.subject}\n\nOpen the Bro Battles admin area to review and respond.`,
      ),
      `site-request-${row.request_id}`,
    );
  } catch (error) {
    await db.runQuery(
      "UPDATE email_outbox SET attempts=attempts+1 WHERE id=? AND sent_at IS NULL",
      [row.id],
    );
    throw error;
  }
  await db.runQuery("UPDATE email_outbox SET sent_at=NOW(3) WHERE id=?", [row.id]);
}
module.exports = { template, sendEmail, hashCode, deliverNotification };
