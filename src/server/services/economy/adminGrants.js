const { httpError } = require("../httpError");
const { toWallet, recordWalletDeltas } = require("./walletService");
// Adds (or removes) coins and gems for one or more players in one
// transaction. Balances never drop below zero; the ledger records the
// amount actually applied, tagged with the admin and an optional note.
const GRANT_LIMIT = 10_000_000;
const MAX_GRANT_RECIPIENTS = 50;
async function adminGrant(db, adminUserId, body) {
  const userIds = [...new Set(Array.isArray(body.userIds) ? body.userIds : [body.userId])];
  if (
    !userIds.length ||
    userIds.length > MAX_GRANT_RECIPIENTS ||
    userIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw httpError(400, `Choose between 1 and ${MAX_GRANT_RECIPIENTS} players`);
  }
  const amounts = {};
  for (const currency of ["coins", "gems"]) {
    const value = body[currency] ?? 0;
    if (!Number.isInteger(value) || Math.abs(value) > GRANT_LIMIT) {
      throw httpError(
        400,
        `${currency} must be a whole number up to ${GRANT_LIMIT.toLocaleString("en-US")}`,
      );
    }
    if (value) amounts[currency] = value;
  }
  if (!Object.keys(amounts).length) throw httpError(400, "Enter an amount of coins or gems");
  const note =
    typeof body.note === "string"
      ? body.note
          .replace(/[\x00-\x1f\x7f]/g, " ")
          .trim()
          .slice(0, 40)
      : "";
  const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return db.withTransaction(async (_conn, q) => {
    const rows = await q(
      `SELECT user_id, name, coins, gems FROM users WHERE user_id IN (${userIds.map(() => "?").join(", ")}) FOR UPDATE`,
      userIds,
    );
    if (rows.length !== userIds.length) {
      const found = new Set(rows.map((row) => Number(row.user_id)));
      const error = new Error(
        `Player not found: #${userIds.filter((id) => !found.has(id)).join(", #")}`,
      );
      error.status = 404;
      throw error;
    }
    const results = [];
    for (const row of rows) {
      const current = toWallet(row);
      const applied = {};
      const next = {};
      for (const currency of ["coins", "gems"]) {
        const before = current[currency];
        next[currency] = Math.min(2147483647, Math.max(0, before + (amounts[currency] || 0)));
        applied[currency] = next[currency] - before;
      }
      await q("UPDATE users SET coins = ?, gems = ?, updated_at = NOW() WHERE user_id = ?", [
        next.coins,
        next.gems,
        row.user_id,
      ]);
      await recordWalletDeltas(q, row.user_id, applied, {
        sourceType: "admin_grant",
        sourceId: `${adminUserId}:${batch}:${row.user_id}${note ? `:${note}` : ""}`.slice(0, 96),
      });
      results.push({
        user_id: row.user_id,
        name: row.name,
        coins: next.coins,
        gems: next.gems,
        applied,
      });
    }
    return results;
  });
}

async function recentAdminGrants(db) {
  const rows = await db.runQuery(
    `SELECT l.ledger_id, l.user_id, u.name, l.currency, l.amount, l.source_id, l.created_at
       FROM shop_currency_ledger l LEFT JOIN users u ON u.user_id = l.user_id
      WHERE l.source_type = 'admin_grant'
      ORDER BY l.ledger_id DESC LIMIT 30`,
  );
  return rows.map(({ source_id, ...row }) => ({
    ...row,
    note: String(source_id || "")
      .split(":")
      .slice(3)
      .join(":"),
  }));
}

module.exports = { adminGrant, recentAdminGrants };
