const { isDeepStrictEqual } = require("util");
const { isAutoUnlocked, unlockedCharacterSet } = require("./cosmeticUnlocks");
const {
  getSkinsCatalog,
  getCharacterSkins,
  getDefaultSkinId,
  getSkinById,
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
} = require("./skinsCatalog");


function isSkinAutoUnlockedForUser(skin, userRow, unlockedCharacters = null) {
  return isAutoUnlocked(skin?.unlockMethod, userRow, { fallbackCharacter: skin?.character, unlockedCharacters });
}

function getAutoUnlockSkinIds(userRow) {
  const catalog = getSkinsCatalog();
  const chars =
    catalog?.characters && typeof catalog.characters === "object"
      ? Object.keys(catalog.characters)
      : [];
  const unlockedCharacters = unlockedCharacterSet(userRow);
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

function parseStoredSkinMap(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

async function syncSkinOwnershipWithRunner(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  const autoUnlockIds = getAutoUnlockSkinIds(userRow);

  const loadOwnedSet = async () => {
    const ownedRows = await db.runQuery(
      "SELECT skin_id FROM user_skins WHERE user_id = ?",
      [userId],
    );
    return new Set(
      ownedRows.map((row) => String(row.skin_id || "")).filter(Boolean),
    );
  };

  let ownedSet = await loadOwnedSet();

  // Most syncs find every automatic unlock already granted; skip the insert
  // (and its locks) unless something is actually missing.
  const missingIds = autoUnlockIds.filter((skinId) => !ownedSet.has(skinId));
  if (missingIds.length) {
    const placeholders = missingIds.map(() => "(?, ?, 'auto')").join(",");
    const params = missingIds.flatMap((skinId) => [userId, skinId]);
    await db.runQuery(
      `INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES ${placeholders}`,
      params,
    );
    ownedSet = await loadOwnedSet();
  }

  const selectedMapRaw = normalizeSelectedSkinMap(
    userRow?.selected_skin_id_by_char,
  );

  const catalog = getSkinsCatalog();
  const characters =
    catalog?.characters && typeof catalog.characters === "object"
      ? Object.keys(catalog.characters)
      : [];

  const ownedSkinIds = Array.from(ownedSet);
  const nextSelectedMap = {};
  for (const character of characters) {
    const selected = resolveSelectedSkinId({
      character,
      selectedSkinMap: selectedMapRaw,
      ownedSkinIds,
    });
    if (selected) nextSelectedMap[character] = selected;
  }

  // Compare against the stored value (not the normalized one) so stale or
  // malformed entries are still rewritten.
  if (
    !isDeepStrictEqual(
      parseStoredSkinMap(userRow?.selected_skin_id_by_char),
      nextSelectedMap,
    )
  ) {
    await db.runQuery(
      "UPDATE users SET selected_skin_id_by_char = ? WHERE user_id = ?",
      [JSON.stringify(nextSelectedMap), userId],
    );
  }

  return {
    ownedSkinIds,
    selectedSkinIdByCharacter: nextSelectedMap,
  };
}

async function syncSkinOwnershipForUser(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  if (!userId) {
    return {
      ownedSkinIds: [],
      selectedSkinIdByCharacter: {},
    };
  }

  try {
    if (typeof db?.withTransaction === "function") {
      return await db.withTransaction(async (_conn, q) => {
        // Serialize normalization with skin/character selection writes. Using
        // the caller's earlier user snapshot here can otherwise undo a newer
        // selection when two lobby requests overlap.
        const rows = await q(
          "SELECT * FROM users WHERE user_id = ? FOR UPDATE",
          [userId],
        );
        const currentUser = rows?.[0] || userRow;
        return syncSkinOwnershipWithRunner({ runQuery: q }, currentUser);
      });
    }

    return await syncSkinOwnershipWithRunner(db, userRow);
  } catch (error) {
    if (
      error?.code === "ER_NO_SUCH_TABLE" ||
      error?.code === "ER_BAD_FIELD_ERROR"
    ) {
      return {
        ownedSkinIds: getAutoUnlockSkinIds(userRow),
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
  syncSkinOwnershipForUser,
};
