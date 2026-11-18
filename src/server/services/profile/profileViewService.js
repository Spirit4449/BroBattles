const { getTitleOwnership } = require("../cosmetics/titleOwnership");
const { toWallet } = require("../economy/walletService");

const { getFavoriteCharacter } = require("../match/favoriteCharacter");

const { NAME_CHANGE_COST } = require("../auth/accountNameService");
const {
  getAllCharacters,
  resolveCharacterKey,
  canonicalCharacterKey,
  parseCharacterLevels,
} = require("../../../shared/characters/characterStats.js");
const { syncProfileIconOwnershipForUser } = require("../cosmetics/profileIconOwnership");
const { syncPlayerCardOwnershipForUser } = require("../cosmetics/playerCardOwnership");
const { getBattleLogForUser, getCurrentWinStreak } = require("../match/battleLog");

const { getPlayerCardsCatalog } = require("../cosmetics/playerCardsCatalog");
const { getProfileIconsCatalog } = require("../cosmetics/profileIconsCatalog");
const { getAutoUnlockIconIds } = require("../cosmetics/profileIconOwnership");
const { loadOwnedIds, resolveOwnedSelection } = require("../cosmetics/cosmeticCollections");
const { createTtlCache } = require("../../lib/ttlCache");

const caches = new WeakMap();
function getProfileStats(db, userId) {
  if (!caches.has(db)) caches.set(db, createTtlCache({ ttlMs: 20000, maxEntries: 1024 }));
  return caches.get(db)(userId, async () => {
    const [winsRows, favoriteCharacter] = await Promise.all([
      db.runQuery(`SELECT COUNT(*) AS wins FROM match_participants mp JOIN matches m ON m.match_id = mp.match_id
                   WHERE mp.user_id = ? AND m.status = 'completed' AND m.winner_team = mp.team`, [userId]),
      getFavoriteCharacter(db, userId),
    ]);
    return { wins: Number(winsRows[0]?.wins) || 0, favoriteCharacter };
  });
}

async function getPublicCosmetics(db, user) {
  const cards = getPlayerCardsCatalog(), icons = getProfileIconsCatalog();
  const [ownedCards, ownedIcons, titles] = await Promise.all([
    loadOwnedIds(db.runQuery, user.user_id, "card"),
    loadOwnedIds(db.runQuery, user.user_id, "profileIcon"),
    getTitleOwnership(db, user),
  ]);
  const validCards = new Set(cards.cards.map(card => card.id));
  const validIcons = new Set(icons.icons.map(icon => icon.id));
  // Private ownership sync grants the default card and auto-unlocks before
  // resolving a selection. Project those grants here without writing them.
  const cardIds = new Set([...ownedCards, cards.defaultCardId].filter(id => validCards.has(id)));
  const iconIds = new Set([...ownedIcons, ...getAutoUnlockIconIds(user)].filter(id => validIcons.has(id)));
  if (!iconIds.size && icons.defaultIconId) iconIds.add(icons.defaultIconId);
  return {
    selectedCardId: resolveOwnedSelection(user.selected_card_id, cardIds, cards.defaultCardId),
    profileIconId: resolveOwnedSelection(user.selected_profile_icon_id, iconIds, icons.defaultIconId),
    selectedTitleId: titles.selectedTitleId,
  };
}

async function getPrivateFields(db, userRow) {
  const profileIconState = await syncProfileIconOwnershipForUser(db, userRow);
  const cardState = await syncPlayerCardOwnershipForUser(db, userRow);
  const titleState = await getTitleOwnership(db, userRow);
  return {
    ...toWallet(userRow), nameChangeCost: NAME_CHANGE_COST, nextNameChangeAt: userRow.next_name_change_at || null,
    winStreak: await getCurrentWinStreak(db, userRow.user_id),
    selectedTitleId: titleState.selectedTitleId, ownedTitleIds: titleState.ownedTitleIds,
    selectedCardId: cardState.selectedCardId || null, ownedCardIds: cardState.ownedCardIds || [],
    profileIconId: profileIconState.selectedProfileIconId || null,
    ownedProfileIconIds: profileIconState.ownedIconIds || [],
  };
}

async function buildProfileViewForUser(db, userRow, { publicView = false } = {}) {
  let charLevels = parseCharacterLevels(userRow.char_levels);

  if (charLevels && typeof charLevels === "object") {
    const normalizedCharLevels = {};
    const validChars = new Set(getAllCharacters());
    for (const [key, val] of Object.entries(charLevels)) {
      const normalizedKey = canonicalCharacterKey(key);
      if (!validChars.has(normalizedKey)) continue;
      const levelNum = Number(val) || 0;
      normalizedCharLevels[normalizedKey] = Math.max(
        normalizedCharLevels[normalizedKey] || 0,
        levelNum,
      );
    }
    charLevels = normalizedCharLevels;
  }

  const charClass = resolveCharacterKey(userRow.char_class);

  const battles = await getProfileBattles(db, userRow.user_id, 10);

  return {
    userId: userRow.user_id,
    username: userRow.name,
    guest: !!userRow.expires_at,
    trophies: Number(userRow.trophies) || 0,
    charClass, charLevels,
    highestWinStreak: Number(userRow.highest_win_streak) || 0,
    ...await getProfileStats(db, userRow.user_id),
    ...await (publicView ? getPublicCosmetics(db, userRow) : getPrivateFields(db, userRow)),
    battles,
  };
}

async function getProfileBattles(db, userId, limit) {
  const battles = await getBattleLogForUser(db, userId, limit);
  return battles.map(({ matchId, outcome, trophiesDelta, createdAt, mapLabel, modeLabel }) => ({
    matchId, outcome, trophiesDelta, createdAt, mapLabel, modeLabel,
  }));
}

async function findProfileByName(db, username) {
  const [user] = await db.runQuery("SELECT user_id, name, char_levels, char_class, trophies, expires_at, highest_win_streak, selected_card_id, selected_profile_icon_id, selected_title_id FROM users WHERE name = ? LIMIT 1", [username]);
  return user || null;
}

async function findProfileIdByName(db, username) {
  const [user] = await db.runQuery("SELECT user_id FROM users WHERE name = ? LIMIT 1", [username]);
  return user?.user_id;
}

module.exports = { getProfileBattles, buildProfileViewForUser, findProfileByName, findProfileIdByName };
