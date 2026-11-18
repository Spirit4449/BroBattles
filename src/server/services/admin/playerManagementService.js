const { httpError } = require("../httpError");
const { renameUser } = require("../auth/accountNameService");
const { getPlayerStats, getPlayerInventory } = require("./playerAdminService");
const { userFields, readAdminPlayer } = require("./adminPlayerRow");
const { LEVEL_CAP } = require("../../../shared/characters/characterStats");
const { characterDefinitions } = require("../../../shared/characters");

async function searchPlayers(db, params) {
  const query = String(params.query || "")
    .trim()
    .slice(0, 100);
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page, 10) || 1));
  const where = /^[0-9]+$/.test(query) ? "user_id = ?" : "name LIKE ? ESCAPE '!'";
  const value = /^[0-9]+$/.test(query) ? Number(query) : `%${query.replace(/[!%_]/g, "!$&")}%`;
  const [count] = await db.runQuery(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, [value]);
  const users = await db.runQuery(
    `SELECT ${userFields} FROM users WHERE ${where} ORDER BY updated_at DESC, user_id DESC LIMIT 20 OFFSET ?`,
    [value, (page - 1) * 20],
  );
  return { success: true, users, total: count.total, page };
}

async function getPlayer(db, id) {
  const user = await readAdminPlayer(db.runQuery.bind(db), id);
  if (!user) return null;
  const queries = {
    matches: `SELECT m.match_id, m.mode, m.map, m.status, m.created_at, m.winner_team, p.team, p.char_class, p.kills, p.damage, p.trophies_delta, p.coins_awarded, p.gems_awarded FROM match_participants p JOIN matches m ON m.match_id = p.match_id WHERE p.user_id = ? ORDER BY m.match_id DESC LIMIT 20`,
    orders: `SELECT order_id, offer_id, status, amount_cents, currency, created_at, fulfilled_at, last_error FROM shop_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    currency: `SELECT currency, amount, source_type, created_at FROM shop_currency_ledger WHERE user_id = ? ORDER BY ledger_id DESC LIMIT 20`,
    moderation: `SELECT category, source, action_taken, offense_level, created_at FROM user_abuse_events WHERE user_id = ? ORDER BY event_id DESC LIMIT 20`,
  };
  const history = {};
  await Promise.all(
    Object.entries(queries).map(async ([key, sql]) => {
      try {
        history[key] = { rows: await db.runQuery(sql, [id]) };
      } catch (error) {
        console.error(`[admin] ${key}`, error);
        history[key] = { error: "This history is temporarily unavailable" };
      }
    }),
  );
  const [stats, inventory] = await Promise.all([
    getPlayerStats(db, id).catch((error) => {
      console.error("[admin] player stats", error);
      return { error: "Match statistics are temporarily unavailable" };
    }),
    getPlayerInventory(db, user).catch((error) => {
      console.error("[admin] inventory", error);
      return { error: "Inventory is temporarily unavailable" };
    }),
  ]);
  return { success: true, user, history, stats, inventory };
}

async function updatePlayer(db, userId, changes) {
  const sets = [],
    values = [];
  for (const [key, value] of Object.entries(changes)) {
    if (key === "char_levels") {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.keys(value).length ||
        Object.entries(value).some(
          ([character, level]) =>
            !Object.hasOwn(characterDefinitions, character) ||
            !Number.isInteger(level) ||
            level < 0 ||
            level > LEVEL_CAP,
        )
      )
        throw httpError(400, "Invalid character levels");
      sets.push(
        `char_levels = JSON_SET(COALESCE(char_levels, '{}'), ${Object.keys(value)
          .map(() => "?, ?")
          .join(", ")})`,
      );
      for (const [character, level] of Object.entries(value)) values.push(`$.${character}`, level);
      continue;
    }
    let valid = false;
    if (["coins", "gems", "trophies"].includes(key))
      valid = Number.isInteger(value) && value >= 0 && value <= 2147483647;
    if (key === "name")
      valid =
        typeof value === "string" &&
        value.trim() === value &&
        value.length >= 3 &&
        value.length <= 50 &&
        !/[\x00-\x1f\x7f]/.test(value);
    if (key === "char_class") valid = Object.hasOwn(characterDefinitions, value);
    if (key === "status") valid = ["online", "idle", "ready", "offline"].includes(value);
    if (!valid) throw httpError(400, `Invalid value for ${key}`);
    if (key === "name") continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (!sets.length && !changes.name) throw httpError(400, "No changes supplied");
  return db.withTransaction(async (_conn, q) => {
    if (changes.name) {
      const [current] = await q("SELECT name FROM users WHERE user_id = ? FOR UPDATE", [userId]);
      if (!current) return null;
      if (changes.name !== current.name)
        await renameUser(q, { userId, oldName: current.name, newName: changes.name });
    }
    if (sets.length) {
      await q(`UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE user_id = ?`, [
        ...values,
        userId,
      ]);
    }
    return readAdminPlayer(q, userId);
  });
}

module.exports = { searchPlayers, getPlayer, updatePlayer };
