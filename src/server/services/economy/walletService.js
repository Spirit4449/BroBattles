function toWallet(row) {
  return { coins: Number(row?.coins) || 0, gems: Number(row?.gems) || 0 };
}

async function readWallet(q, userId) {
  const [row] = await q("SELECT coins, gems FROM users WHERE user_id = ?", [userId]);
  return toWallet(row);
}

async function recordWalletDeltas(q, userId, deltas, { sourceType, sourceId, idempotent = false }) {
  const insert = idempotent ? "INSERT IGNORE" : "INSERT";
  for (const currency of ["coins", "gems"]) {
    if (!deltas[currency]) continue;
    await q(
      `${insert} INTO shop_currency_ledger (user_id, currency, amount, source_type, source_id) VALUES (?, ?, ?, ?, ?)`,
      [userId, currency, deltas[currency], sourceType, typeof sourceId === "string" ? sourceId : sourceId[currency]],
    );
  }
}

// A caller that records a ledger entry owns the surrounding transaction and
// decides whether the receipt permits an adjustment.
async function adjustWallet(q, userId, { coins = 0, gems = 0 }, ledger) {
  if (!coins && !gems) return;
  await q("UPDATE users SET coins = coins + ?, gems = gems + ? WHERE user_id = ?", [coins, gems, userId]);
  if (ledger) await recordWalletDeltas(q, userId, { coins, gems }, ledger);
}

module.exports = { adjustWallet, readWallet, recordWalletDeltas, toWallet };
