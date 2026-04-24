const {
  getSkinsCatalog,
  getCharacterSkins,
  getDefaultSkinId,
  getSkinById,
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
} = require("./skinsCatalog");

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

function isSkinAutoUnlockedForUser(skin, userRow, unlockedCharacters = null) {
  const unlock =
    skin?.unlockMethod && typeof skin.unlockMethod === "object"
      ? skin.unlockMethod
      : null;
  if (!unlock) return false;

  const type = String(unlock.type || "").toLowerCase();
  if (type === "starter") return true;

  if (type === "character") {
    const character = String(unlock.character || skin.character || "").trim();
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

function getAutoUnlockSkinIds(userRow) {
  const catalog = getSkinsCatalog();
  const chars =
    catalog?.characters && typeof catalog.characters === "object"
      ? Object.keys(catalog.characters)
      : [];
  const unlockedCharacters = extractUnlockedCharacters(userRow);
  const out = new Set();

  for (const character of chars) {
    const skins = getCharacterSkins(character);
    const defaultSkinId = getDefaultSkinId(character);
    if (defaultSkinId) {
      // Character defaults should unlock with character ownership.
      if (unlockedCharacters.has(character)) out.add(defaultSkinId);
    }
    for (const skin of skins) {
      if (isSkinAutoUnlockedForUser(skin, userRow, unlockedCharacters)) {
        out.add(String(skin.id));
      }
    }
  }

  return Array.from(out);
}

async function unlockSkinForUser(db, userId, skinId, source = "grant") {
  const normalizedUserId = Number(userId) || 0;
  const normalizedSkinId = String(skinId || "").trim();
  if (!normalizedUserId || !normalizedSkinId) {
    return { success: false, reason: "invalid_args" };
  }

  const skin = getSkinById(normalizedSkinId);
  if (!skin) {
    return { success: false, reason: "unknown_skin" };
  }

  try {
    const insertResult = await db.runQuery(
      "INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES (?, ?, ?)",
      [normalizedUserId, normalizedSkinId, String(source || "grant")],
    );
    return {
      success: true,
      inserted: Number(insertResult?.affectedRows) > 0,
      skinId: normalizedSkinId,
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

async function syncSkinOwnershipForUser(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  if (!userId) {
    return {
      ownedSkinIds: [],
      selectedSkinIdByCharacter: {},
    };
  }

  const autoUnlockIds = getAutoUnlockSkinIds(userRow);

  try {
    if (autoUnlockIds.length) {
      const placeholders = autoUnlockIds.map(() => "(?, ?, 'auto')").join(",");
      const params = autoUnlockIds.flatMap((skinId) => [userId, skinId]);
      await db.runQuery(
        `INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES ${placeholders}`,
        params,
      );
    }

    const ownedRows = await db.runQuery(
      "SELECT skin_id FROM user_skins WHERE user_id = ?",
      [userId],
    );

    const ownedSet = new Set(
      ownedRows.map((row) => String(row.skin_id || "")).filter(Boolean),
    );

    const selectedMapRaw = normalizeSelectedSkinMap(
      userRow?.selected_skin_id_by_char,
    );

    const catalog = getSkinsCatalog();
    const characters =
      catalog?.characters && typeof catalog.characters === "object"
        ? Object.keys(catalog.characters)
        : [];

    const nextSelectedMap = {};
    for (const character of characters) {
      const selected = resolveSelectedSkinId({
        character,
        selectedSkinMap: selectedMapRaw,
        ownedSkinIds: Array.from(ownedSet),
      });
      if (selected) nextSelectedMap[character] = selected;
    }

    await db.runQuery(
      "UPDATE users SET selected_skin_id_by_char = ? WHERE user_id = ?",
      [JSON.stringify(nextSelectedMap), userId],
    );

    return {
      ownedSkinIds: Array.from(ownedSet),
      selectedSkinIdByCharacter: nextSelectedMap,
    };
  } catch (error) {
    if (
      error?.code === "ER_NO_SUCH_TABLE" ||
      error?.code === "ER_BAD_FIELD_ERROR"
    ) {
      return {
        ownedSkinIds: autoUnlockIds,
        selectedSkinIdByCharacter: {},
        schemaMissing: true,
      };
    }
    throw error;
  }
}

module.exports = {
  getAutoUnlockSkinIds,
  isSkinAutoUnlockedForUser,
  unlockSkinForUser,
  syncSkinOwnershipForUser,
};
