const { grantCosmetic } = require("../cosmetics/cosmeticCollections");
const { getDefaultSkinId, getSkinById } = require("../cosmetics/skinsCatalog");
const { getProfileIconById } = require("../cosmetics/profileIconsCatalog");
const { getPlayerCardById } = require("../cosmetics/playerCardsCatalog");
const { getCharacterStats } = require("../../../shared/characters/characterStats");

// The caller holds the users row lock and claim receipt in the same transaction.
async function grantTrophyItems(q, userId, rewards) {
  for (const reward of rewards) {
    const id = reward.itemId;
    if (reward.kind === "currency" || reward.kind === "mode") continue;
    if (reward.kind === "skin" && getSkinById(id)) {
      await grantCosmetic(q, userId, "skin", id, "trophy-road");
    } else if (reward.kind === "card" && getPlayerCardById(id)) {
      await grantCosmetic(q, userId, "card", id, "trophy-road");
    } else if (reward.kind === "profileIcon" && getProfileIconById(id)) {
      await grantCosmetic(q, userId, "profileIcon", id, "trophy-road");
    } else if (reward.kind === "character" && getCharacterStats(id)) {
      const path = `$.${id}`;
      await q(`UPDATE users SET char_levels = JSON_SET(COALESCE(char_levels, JSON_OBJECT()), ?, GREATEST(1, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, ?)) AS UNSIGNED), 0))) WHERE user_id = ?`, [path, path, userId]);
      const defaultSkinId = getDefaultSkinId(id);
      if (defaultSkinId) await grantCosmetic(q, userId, "skin", defaultSkinId, "trophy-road");
      if (getProfileIconById(id)) await grantCosmetic(q, userId, "profileIcon", id, "trophy-road");
    } else {
      throw new Error(`Unknown trophy reward: ${reward.kind}:${id}`);
    }
  }
}
module.exports = { grantTrophyItems };
