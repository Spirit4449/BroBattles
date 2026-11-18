const collections = {
  skin: { table: "user_skins", idColumn: "skin_id", ownershipKey: "skins" },
  card: { table: "user_cards", idColumn: "card_id", ownershipKey: "cards" },
  profileIcon: { table: "user_profile_icons", idColumn: "icon_id", ownershipKey: "profileIcons" },
  title: { table: "user_titles", idColumn: "title_id", ownershipKey: "titles" },
};

async function loadOwnedIds(q, userId, kind) {
  const { table, idColumn } = collections[kind];
  const rows = await q(`SELECT ${idColumn} FROM ${table} WHERE user_id = ?`, [userId]);
  return rows.map(row => String(row[idColumn] || "")).filter(Boolean);
}

function grantCosmetics(q, userId, kind, ids, source) {
  if (!ids.length) return;
  const { table, idColumn } = collections[kind];
  const values = ids.map(() => "(?, ?, ?)").join(",");
  return q(
    `INSERT IGNORE INTO ${table} (user_id, ${idColumn}, source) VALUES ${values}`,
    ids.flatMap(id => [userId, String(id), source]),
  );
}

function grantCosmetic(q, userId, kind, id, source) {
  return grantCosmetics(q, userId, kind, [id], source);
}

async function ownershipSnapshot(q, userId) {
  const ownership = await Promise.all(
    Object.entries(collections).map(async ([kind, { ownershipKey }]) =>
      [ownershipKey, new Set(await loadOwnedIds(q, userId, kind))]),
  );
  return Object.fromEntries(ownership);
}

function resolveOwnedSelection(selected, owned, defaultId) {
  const current = String(selected || "").trim();
  if (owned.has(current)) return current;
  return owned.has(defaultId) ? defaultId : owned.values().next().value || null;
}

module.exports = { resolveOwnedSelection, loadOwnedIds, grantCosmetic, grantCosmetics, ownershipSnapshot };
