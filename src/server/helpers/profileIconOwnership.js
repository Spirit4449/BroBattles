const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("./profileIconsCatalog");

function parseCharLevels(charLevelsRaw) {
  if (!charLevelsRaw) return {};
  if (typeof charLevelsRaw === "object") return charLevelsRaw;
  try {
    return JSON.parse(String(charLevelsRaw || "{}"));
  } catch (_) {
    return {};
  }
}

function extractUnlockedCharacters(userRow) {
  const levels = parseCharLevels(userRow?.char_levels);
  const unlocked = new Set();
  for (const [key, value] of Object.entries(levels || {})) {
    if (Number(value) >= 1) unlocked.add(String(key));
  }
  return unlocked;
}

function isIconAutoUnlockedForUser(icon, userRow, unlockedCharacters = null) {
  const unlock =
    icon?.unlock && typeof icon.unlock === "object" ? icon.unlock : null;
  if (!unlock) return false;
  const type = String(unlock.type || "").toLowerCase();
  if (type === "starter") return true;

  if (type === "character") {
    const character = String(unlock.character || "").trim();
    if (!character) return false;
    const chars = unlockedCharacters || extractUnlockedCharacters(userRow);
    return chars.has(character);
  }

  if (type === "trophies") {
    const min = Math.max(0, Number(unlock.min) || 0);
    const trophies = Math.max(0, Number(userRow?.trophies) || 0);
    return trophies >= min;
  }

  return false;
}

function getAutoUnlockIconIds(userRow) {
  const catalog = getProfileIconsCatalog();
  const icons = Array.isArray(catalog?.icons) ? catalog.icons : [];
  const unlockedCharacters = extractUnlockedCharacters(userRow);
  const out = [];
  for (const icon of icons) {
    if (isIconAutoUnlockedForUser(icon, userRow, unlockedCharacters)) {
      out.push(String(icon.id));
    }
  }
  return out;
}

async function unlockProfileIconForUser(db, userId, iconId, source = "grant") {
  const normalizedUserId = Number(userId) || 0;
  const normalizedIconId = String(iconId || "").trim();
  if (!normalizedUserId || !normalizedIconId) {
    return { success: false, reason: "invalid_args" };
  }

  const icon = getProfileIconById(normalizedIconId);
  if (!icon) {
    return { success: false, reason: "unknown_icon" };
  }

  try {
    const insertResult = await db.runQuery(
      "INSERT IGNORE INTO user_profile_icons (user_id, icon_id, source) VALUES (?, ?, ?)",
      [normalizedUserId, normalizedIconId, String(source || "grant")],
    );
    const ownedRows = await db.runQuery(
      "SELECT selected_profile_icon_id FROM users WHERE user_id = ? LIMIT 1",
      [normalizedUserId],
    );
    const selected = ownedRows?.[0]?.selected_profile_icon_id || null;
    if (!selected) {
      await db.runQuery(
        "UPDATE users SET selected_profile_icon_id = ? WHERE user_id = ?",
        [normalizedIconId, normalizedUserId],
      );
    }
    return {
      success: true,
      inserted: Number(insertResult?.affectedRows) > 0,
      iconId: normalizedIconId,
    };
  } catch (error) {
    if (
      error?.code === "ER_NO_SUCH_TABLE" ||
      error?.code === "ER_BAD_FIELD_ERROR"
    ) {
      return { success: false, reason: "missing_schema" };
    }
    throw error;
  }
}

async function syncProfileIconOwnershipForUser(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  if (!userId) {
    return {
      ownedIconIds: [],
      selectedProfileIconId: null,
      defaultIconId: String(getProfileIconsCatalog()?.defaultIconId || "ninja"),
    };
  }

  const catalog = getProfileIconsCatalog();
  const defaultIconId = String(catalog?.defaultIconId || "ninja");
  const autoUnlockIds = getAutoUnlockIconIds(userRow);

  try {
    if (autoUnlockIds.length) {
      const placeholders = autoUnlockIds.map(() => "(?, ?, 'auto')").join(",");
      const params = autoUnlockIds.flatMap((iconId) => [userId, iconId]);
      await db.runQuery(
        `INSERT IGNORE INTO user_profile_icons (user_id, icon_id, source) VALUES ${placeholders}`,
        params,
      );
    }

    const ownedRows = await db.runQuery(
      "SELECT icon_id FROM user_profile_icons WHERE user_id = ?",
      [userId],
    );
    const ownedSet = new Set(
      ownedRows.map((row) => String(row.icon_id || "")).filter(Boolean),
    );
    if (ownedSet.size === 0 && defaultIconId) {
      await db.runQuery(
        "INSERT IGNORE INTO user_profile_icons (user_id, icon_id, source) VALUES (?, ?, 'default')",
        [userId, defaultIconId],
      );
      ownedSet.add(defaultIconId);
    }

    const selectedRaw =
      String(userRow?.selected_profile_icon_id || "").trim() || null;
    let selectedProfileIconId = selectedRaw;
    if (!selectedProfileIconId || !ownedSet.has(selectedProfileIconId)) {
      selectedProfileIconId = ownedSet.has(defaultIconId)
        ? defaultIconId
        : Array.from(ownedSet)[0] || null;
      if (selectedProfileIconId) {
        await db.runQuery(
          "UPDATE users SET selected_profile_icon_id = ? WHERE user_id = ?",
          [selectedProfileIconId, userId],
        );
      }
    }

    return {
      ownedIconIds: Array.from(ownedSet),
      selectedProfileIconId,
      defaultIconId,
    };
  } catch (error) {
    if (
      error?.code === "ER_NO_SUCH_TABLE" ||
      error?.code === "ER_BAD_FIELD_ERROR"
    ) {
      return {
        ownedIconIds: autoUnlockIds,
        selectedProfileIconId: autoUnlockIds[0] || defaultIconId || null,
        defaultIconId,
        schemaMissing: true,
      };
    }
    throw error;
  }
}

module.exports = {
  getAutoUnlockIconIds,
  isIconAutoUnlockedForUser,
  unlockProfileIconForUser,
  syncProfileIconOwnershipForUser,
};
