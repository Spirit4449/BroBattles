const { getSkinById, normalizeSelectedSkinMap, resolveSelectedSkinId } = require('./skinsCatalog');
const { syncSkinOwnershipForUser } = require('./skinOwnership');
const { getAllCharacters, getCharacterLevel } = require('../../../shared/characters/characterStats');
const VALID_CHARACTER_IDS = new Set(getAllCharacters());

async function selectCharacter(db, socketUser, data, isTracedUser) {
  const uname = socketUser?.name;
  const userId = Number(socketUser?.user_id) || 0;
  if (!uname || !userId) return { ok: false, error: "unauthorized" };
  const charClass = String(data?.character || data?.charClass || '').trim().toLowerCase();
  const selectedSkinId = String(data?.selectedSkinId || '').trim();
  if (!/^[a-zA-Z_-]{2,20}$/.test(charClass)) return { ok: false, error: 'invalid_character' };
  if (!VALID_CHARACTER_IDS.has(charClass)) return { ok: false, error: 'unknown_character' };

  const userRows = await db.runQuery(
    "SELECT * FROM users WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const freshUser = userRows?.[0];
  if (!freshUser) {
    return { ok: false, error: "user_not_found" };
  }
  if (String(freshUser.status || "").trim().toLowerCase() === "ready") {
    return { ok: false, error: "unready_before_character_change" };
  }
  // Token-verified probe accounts (netTraceRecorder) may test any character;
  // a locked character plays at level 1.
  if (getCharacterLevel(freshUser, charClass) < 1 && !isTracedUser(freshUser.name)) {
    return { ok: false, error: "character_locked" };
  }

  const skinState = await syncSkinOwnershipForUser(db, freshUser);
  const ownedSkinIds = Array.isArray(skinState?.ownedSkinIds)
    ? skinState.ownedSkinIds.map(String)
    : [];
  const owned = new Set(ownedSkinIds);
  let nextSkinId = selectedSkinId;

  if (nextSkinId) {
    const skin = getSkinById(nextSkinId);
    if (
      !skin ||
      String(skin.character || "") !== charClass ||
      !owned.has(nextSkinId)
    ) {
      return { ok: false, error: "skin_not_unlocked" };
    }
  } else {
    nextSkinId =
      resolveSelectedSkinId({
        character: charClass,
        selectedSkinMap: skinState?.selectedSkinIdByCharacter,
        ownedSkinIds,
      }) || "";
  }

  const selectedMap = await db.withTransaction(async (_conn, q) => {
    const [row] = await q('SELECT status, selected_skin_id_by_char FROM users WHERE user_id = ? FOR UPDATE', [userId]);
    if (!row || String(row.status).toLowerCase() === 'ready') return null;
    const map = normalizeSelectedSkinMap(row.selected_skin_id_by_char);
    if (nextSkinId && (selectedSkinId || !map[charClass])) map[charClass] = nextSkinId;
    await q('UPDATE users SET char_class = ?, selected_skin_id_by_char = ? WHERE user_id = ?', [charClass, JSON.stringify(map), userId]);
    return map;
  });
  if (!selectedMap) return { ok: false, error: 'unready_before_character_change' };
  nextSkinId = selectedMap[charClass] || nextSkinId;
  return { ok: true, character: charClass, selectedSkinId: nextSkinId || null, selectedMap };
}

module.exports = { selectCharacter };
