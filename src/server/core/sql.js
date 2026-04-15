// Database
const mysql = require("mysql2/promise"); // Just mysql doesn't work
const { normalizeSelection } = require("../helpers/gameSelectionCatalog");
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Akshardhamsql",
  database: "game",
  connectionLimit: 10,
  queueLimit: 0,
});

// Reusable MySQL query function
async function runQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error("MySQL query error:", error);
    throw error;
  }
}

// Run a query using an existing connection (for transactions)
async function runQueryConn(conn, sql, params = []) {
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } catch (error) {
    console.error("MySQL query (conn) error:", error);
    throw error;
  }
}

// Helper to run a function within a transaction on a single connection
// Usage: await withTransaction(async (conn, q) => { await q("SQL", [..]); })
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn, (sql, params = []) =>
      runQueryConn(conn, sql, params),
    );
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

async function getUserById(userId) {
  const rows = await runQuery("SELECT * FROM users WHERE user_id = ? LIMIT 1", [
    userId,
  ]);
  return rows[0] || null;
}

async function getPartyIdByName(name) {
  const rows = await runQuery(
    "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
    [name],
  );
  return rows[0]?.party_id ?? null;
}

async function fetchPartyMembersDetailed(partyId) {
  return runQuery(
    `SELECT pm.name, pm.team, u.char_class, u.status, u.char_levels, u.selected_profile_icon_id AS profile_icon_id
       FROM party_members pm
       LEFT JOIN users u ON u.name = pm.name
      WHERE pm.party_id = ?
      ORDER BY pm.joined_at, pm.name`,
    [partyId],
  );
}

async function setUserStatus(name, status) {
  return runQuery("UPDATE users SET status = ? WHERE name = ?", [status, name]);
}

async function setUserSocketId(userId, socketId) {
  return runQuery(
    "UPDATE users SET socket_id = ?, status = 'online' WHERE user_id = ?",
    [socketId, userId],
  );
}

async function clearUserSocketIfMatch(userId, socketId) {
  const rows = await runQuery(
    "SELECT socket_id FROM users WHERE user_id = ? LIMIT 1",
    [userId],
  );
  if (rows[0]?.socket_id === socketId) {
    await runQuery("UPDATE users SET socket_id = NULL WHERE user_id = ?", [
      userId,
    ]);
  }
}

// Set a party's status to a given value
async function setPartyStatus(partyId, status) {
  return runQuery("UPDATE parties SET status = ? WHERE party_id = ?", [
    status,
    partyId,
  ]);
}

// Get a user's socket_id by userId
async function getUserSocketId(userId) {
  const rows = await runQuery(
    "SELECT socket_id FROM users WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return rows[0]?.socket_id || null;
}

// Set the same status for multiple parties at once
async function setPartiesStatus(partyIds, status) {
  const ids = Array.from(
    new Set((partyIds || []).map((x) => Number(x)).filter(Boolean)),
  );
  if (!ids.length) return { affectedRows: 0 };
  const ph = ids.map(() => "?").join(",");
  return runQuery(`UPDATE parties SET status = ? WHERE party_id IN (${ph})`, [
    status,
    ...ids,
  ]);
}

async function getUserSelectedCardId(userId) {
  try {
    const rows = await runQuery(
      "SELECT selected_card_id FROM users WHERE user_id = ? LIMIT 1",
      [userId],
    );
    return rows[0]?.selected_card_id ?? null;
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return null;
    throw error;
  }
}

async function getUserOwnedCardIds(userId) {
  try {
    const rows = await runQuery(
      "SELECT card_id FROM user_cards WHERE user_id = ?",
      [userId],
    );
    return rows.map((r) => String(r.card_id));
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

async function userOwnsCard(userId, cardId) {
  try {
    const rows = await runQuery(
      "SELECT 1 AS ok FROM user_cards WHERE user_id = ? AND card_id = ? LIMIT 1",
      [userId, String(cardId)],
    );
    return !!rows[0];
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return false;
    throw error;
  }
}

async function setUserSelectedCardId(userId, cardId) {
  try {
    return await runQuery(
      "UPDATE users SET selected_card_id = ? WHERE user_id = ?",
      [String(cardId), userId],
    );
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") {
      throw new Error(
        "selected_card_id column missing in users table. Apply the player-cards migration.",
      );
    }
    throw error;
  }
}

async function getUserSelectedProfileIconId(userId) {
  try {
    const rows = await runQuery(
      "SELECT selected_profile_icon_id FROM users WHERE user_id = ? LIMIT 1",
      [userId],
    );
    return rows[0]?.selected_profile_icon_id ?? null;
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return null;
    throw error;
  }
}

async function getUserOwnedProfileIconIds(userId) {
  try {
    const rows = await runQuery(
      "SELECT icon_id FROM user_profile_icons WHERE user_id = ?",
      [userId],
    );
    return rows.map((row) => String(row.icon_id));
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

async function userOwnsProfileIcon(userId, iconId) {
  try {
    const rows = await runQuery(
      "SELECT 1 AS ok FROM user_profile_icons WHERE user_id = ? AND icon_id = ? LIMIT 1",
      [userId, String(iconId)],
    );
    return !!rows[0];
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return false;
    throw error;
  }
}

async function setUserSelectedProfileIconId(userId, iconId) {
  try {
    return await runQuery(
      "UPDATE users SET selected_profile_icon_id = ? WHERE user_id = ?",
      [String(iconId), userId],
    );
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") {
      throw new Error(
        "selected_profile_icon_id column missing in users table. Apply the profile-icons migration.",
      );
    }
    throw error;
  }
}

async function fetchSelectedCardsByNames(names) {
  const unique = Array.from(
    new Set((Array.isArray(names) ? names : []).map((n) => String(n || ""))),
  ).filter(Boolean);
  if (!unique.length) return {};
  try {
    const placeholders = unique.map(() => "?").join(",");
    const rows = await runQuery(
      `SELECT name, selected_card_id FROM users WHERE name IN (${placeholders})`,
      unique,
    );
    const out = {};
    for (const row of rows) {
      out[row.name] = row.selected_card_id ?? null;
    }
    return out;
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return {};
    throw error;
  }
}

async function getUserPreferredSelection(userId) {
  try {
    const rows = await runQuery(
      `SELECT preferred_mode_id, preferred_mode_variant_id, preferred_map_id
         FROM users
        WHERE user_id = ?
        LIMIT 1`,
      [userId],
    );
    return normalizeSelection({
      modeId: rows[0]?.preferred_mode_id || null,
      modeVariantId: rows[0]?.preferred_mode_variant_id || null,
      mapId: rows[0]?.preferred_map_id ?? null,
    });
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") {
      throw new Error(
        "preferred selection columns missing in users table. Apply the solo-selection migration.",
      );
    }
    throw error;
  }
}

async function setUserPreferredSelection(userId, selection) {
  const normalized = normalizeSelection(selection);
  try {
    return await runQuery(
      `UPDATE users
          SET preferred_mode_id = ?,
              preferred_mode_variant_id = ?,
              preferred_map_id = ?
        WHERE user_id = ?`,
      [normalized.modeId, normalized.modeVariantId, normalized.mapId, userId],
    );
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") {
      throw new Error(
        "preferred selection columns missing in users table. Apply the solo-selection migration.",
      );
    }
    throw error;
  }
}

async function updateLastSeen(partyId, username) {
  const result = await runQuery(
    "UPDATE party_members SET last_seen = NOW() WHERE party_id = ? AND name = ?",
    [partyId, username],
  );
}

// Delete all parties that currently have zero members
async function deleteEmptyParties() {
  const sql = `
    DELETE FROM parties
    WHERE party_id IN (
      SELECT party_id FROM (
        SELECT p.party_id
        FROM parties p
        LEFT JOIN party_members m ON m.party_id = p.party_id
        GROUP BY p.party_id
        HAVING COUNT(m.name) = 0
      ) AS t
    )
  `;
  const result = await runQuery(sql);
  // mysql2 returns an OkPacket only via execute; with query we mapped to rows. Use affectedRows via runQuery return? Not available.
  // As we used pool.query(sql) above, rows is an object in DML with affectedRows. Adjust runQuery to return rows.
  // If driver returns an array, we handle undefined gracefully.
  return result?.affectedRows || 0;
}

// Remove members whose last_seen is older than N minutes; return list of removed { party_id, name }
async function findAndRemoveInactiveMembers(olderThanMinutes = 30) {
  const mins = Number(olderThanMinutes) || 30;
  // Fetch candidates first so we can return who was removed per party
  const candidates = await runQuery(
    `SELECT pm.party_id, pm.name
       FROM party_members pm
      WHERE pm.last_seen < DATE_SUB(NOW(), INTERVAL ? MINUTE)
        AND NOT EXISTS (
          SELECT 1
            FROM users u
            JOIN match_participants mp ON mp.user_id = u.user_id
            JOIN matches m ON m.match_id = mp.match_id
           WHERE u.name = pm.name
             AND m.status = 'live'
        )`,
    [mins],
  );
  if (!candidates.length) return [];

  const pairs = candidates.map((row) => [row.party_id, row.name]);
  const wherePairs = pairs
    .map(() => "(party_id = ? AND name = ?)")
    .join(" OR ");
  const bind = pairs.flatMap((p) => [p[0], p[1]]);
  await runQuery(`DELETE FROM party_members WHERE ${wherePairs}`, bind);
  return candidates;
}

// Delete expired guest accounts (expires_at < NOW()) and their memberships.
// Returns { count, names, partyIds }
async function deleteExpiredGuestsAndMemberships() {
  const expired = await runQuery(
    `SELECT name FROM users WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
  );
  if (!expired.length) return { count: 0, names: [], partyIds: [] };

  const names = expired.map((r) => r.name);
  // Build placeholders for IN clause
  const placeholders = names.map(() => "?").join(",");

  // Parties impacted by these users
  const partyRows = await runQuery(
    `SELECT DISTINCT party_id FROM party_members WHERE name IN (${placeholders})`,
    names,
  );
  const partyIds = partyRows.map((r) => r.party_id);

  // Remove their memberships first
  await runQuery(
    `DELETE FROM party_members WHERE name IN (${placeholders})`,
    names,
  );
  // Delete the users
  const result = await runQuery(
    `DELETE FROM users WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
  );
  const count = result?.affectedRows || 0;
  return { count, names, partyIds };
}

// Set status to 'offline' for users whose last_seen in party_members is older than N minutes.
// Returns the number of rows affected.
async function setOfflineIfLastSeenOlderThan(minutes = 3) {
  const mins = Math.max(1, Number(minutes) || 3);
  const result = await runQuery(
    `UPDATE users u
       LEFT JOIN party_members pm ON pm.name = u.name
        SET u.status = 'offline'
      WHERE u.status <> 'offline'
        AND (
          pm.last_seen IS NULL OR pm.last_seen < DATE_SUB(NOW(), INTERVAL ? MINUTE)
        )`,
    [mins],
  );
  return result?.affectedRows || 0;
}

module.exports = {
  pool,
  runQuery,
  runQueryConn,
  withTransaction,
  updateLastSeen,
  deleteEmptyParties,
  deleteExpiredGuestsAndMemberships,
  setOfflineIfLastSeenOlderThan,
  findAndRemoveInactiveMembers,
  getUserById,
  getPartyIdByName,
  fetchPartyMembersDetailed,
  setUserStatus,
  setUserSocketId,
  clearUserSocketIfMatch,
  setPartyStatus,
  setPartiesStatus,
  getUserSocketId,
  getUserSelectedCardId,
  getUserOwnedCardIds,
  userOwnsCard,
  setUserSelectedCardId,
  fetchSelectedCardsByNames,
  getUserSelectedProfileIconId,
  getUserOwnedProfileIconIds,
  userOwnsProfileIcon,
  setUserSelectedProfileIconId,
  getUserPreferredSelection,
  setUserPreferredSelection,
};
