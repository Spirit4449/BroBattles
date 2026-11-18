const { resolveOwnedSelection, loadOwnedIds, grantCosmetic, grantCosmetics } = require("./cosmeticCollections");
const { DEFAULT_CHARACTER } = require("../../../shared/characters/characterStats.js");
const { isAutoUnlocked, unlockedCharacterSet } = require("./cosmeticUnlocks");
const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("./profileIconsCatalog");

function isIconAutoUnlockedForUser(icon, userRow, unlockedCharacters = null) {
  return isAutoUnlocked(icon?.unlock, userRow, { unlockedCharacters });
}

function getAutoUnlockIconIds(userRow) {
  const catalog = getProfileIconsCatalog();
  const icons = Array.isArray(catalog?.icons) ? catalog.icons : [];
  const unlockedCharacters = unlockedCharacterSet(userRow);
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

  const insertResult = await grantCosmetic(
    db.runQuery, normalizedUserId, "profileIcon", normalizedIconId, String(source || "grant"),
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
}

async function syncProfileIconOwnershipForUser(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  if (!userId) {
    return {
      ownedIconIds: [],
      selectedProfileIconId: null,
      defaultIconId: String(getProfileIconsCatalog()?.defaultIconId || DEFAULT_CHARACTER),
    };
  }

  const catalog = getProfileIconsCatalog();
  const defaultIconId = String(catalog?.defaultIconId || DEFAULT_CHARACTER);
  const autoUnlockIds = getAutoUnlockIconIds(userRow);

  await grantCosmetics(db.runQuery, userId, "profileIcon", autoUnlockIds, "auto");

  const ownedIds = await loadOwnedIds(db.runQuery, userId, "profileIcon");
  const validIds = new Set(catalog.icons.map(icon => icon.id));
  const ownedSet = new Set(ownedIds.filter(id => validIds.has(id)));
  if (ownedSet.size === 0 && defaultIconId) {
    await grantCosmetic(db.runQuery, userId, "profileIcon", defaultIconId, "default");
    ownedSet.add(defaultIconId);
  }

  const selectedRaw =
    String(userRow?.selected_profile_icon_id || "").trim() || null;
  const selectedProfileIconId = resolveOwnedSelection(selectedRaw, ownedSet, defaultIconId);
  if (selectedRaw !== selectedProfileIconId) {
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
}

module.exports = {
  getAutoUnlockIconIds,
  unlockProfileIconForUser,
  syncProfileIconOwnershipForUser,
};
