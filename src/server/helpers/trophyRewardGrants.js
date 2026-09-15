const { getSkinById } = require("./skinsCatalog");
const { getProfileIconById } = require("./profileIconsCatalog");
const { getPlayerCardById } = require("./playerCardsCatalog");
const { getCharacterStats } = require("../../shared/characterStats");

// The caller holds the users row lock and claim receipt in the same transaction.
async function grantTrophyItems(q, userId, rewards) {
  for (const reward of rewards) {
    const id = reward.itemId;
    if (reward.kind === "currency" || reward.kind === "mode") continue;
    if (reward.kind === "skin" && getSkinById(id)) {
      await q("INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES (?, ?, 'trophy-road')", [userId, id]);
    } else if (reward.kind === "card" && getPlayerCardById(id)) {
      await q("INSERT IGNORE INTO user_cards (user_id, card_id, source) VALUES (?, ?, 'trophy-road')", [userId, id]);
    } else if (reward.kind === "profileIcon" && getProfileIconById(id)) {
      await q("INSERT IGNORE INTO user_profile_icons (user_id, icon_id, source) VALUES (?, ?, 'trophy-road')", [userId, id]);
    } else if (reward.kind === "character" && getCharacterStats(id)) {
      const path = `$.${id}`;
      await q(`UPDATE users SET char_levels = JSON_SET(COALESCE(char_levels, JSON_OBJECT()), ?, GREATEST(1, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, ?)) AS UNSIGNED), 0))) WHERE user_id = ?`, [path, path, userId]);
      await q("INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES (?, ?, 'trophy-road')", [userId, `${id}-default`]);
      if (getProfileIconById(id)) await q("INSERT IGNORE INTO user_profile_icons (user_id, icon_id, source) VALUES (?, ?, 'trophy-road')", [userId, id]);
    } else {
      throw new Error(`Unknown trophy reward: ${reward.kind}:${id}`);
    }
  }
}
module.exports = { grantTrophyItems };
