const { sendEmail, template } = require("./emailService");

// A newer request may reserve a different code while delivery is pending.
// Restore only the failed reservation, including its previous cooldown.
const reservations = {
  profile: {
    table: "account_emails", token: "code_hash",
    fields: ["pending_email", "code_hash", "expires_at", "attempts", "sent_at", "window_start", "send_count", "correction_used"],
  },
  signup: {
    table: "pending_signups", token: "challenge_id",
    fields: ["challenge_id", "username", "password_hash", "email", "code_hash", "expires_at", "attempts", "sent_at", "window_start", "send_count", "marketing_consent", "terms_version", "privacy_version", "correction_used"],
  },
};

async function deliverReservedCode(db, kind, { userId, previous, token, email, code }, subject, message) {
  try {
    await sendEmail(email, template(subject, message, code));
  } catch (error) {
    const { table, fields, token: key } = reservations[kind];
    await db.runQuery(
      `UPDATE ${table} SET ${fields.map(field => field + "=?").join(",")} WHERE user_id=? AND ${key}=?`,
      [...fields.map(field => previous[field] ?? null), userId, token],
    );
    throw error;
  }
}

module.exports = { deliverReservedCode };
