const { loadOwnedIds } = require("./cosmeticCollections");
const { getTitleById } = require("./titlesCatalog");
async function getTitleOwnership(db, user) {
  const ids = await loadOwnedIds(db.runQuery, user.user_id, "title");
  const ownedTitleIds = ids.filter(id => getTitleById(id));
  return { ownedTitleIds, selectedTitleId: ownedTitleIds.includes(user.selected_title_id) ? user.selected_title_id : null };
}
module.exports = { getTitleOwnership };
