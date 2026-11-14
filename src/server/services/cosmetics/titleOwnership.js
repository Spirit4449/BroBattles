const { getTitleById } = require("./titlesCatalog");
async function getTitleOwnership(db, user) {
  try {
    const rows = await db.runQuery("SELECT title_id FROM user_titles WHERE user_id = ?", [user.user_id]);
    const ownedTitleIds = rows.map(row => String(row.title_id)).filter(id => getTitleById(id));
    return { ownedTitleIds, selectedTitleId: ownedTitleIds.includes(user.selected_title_id) ? user.selected_title_id : null };
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR") {
      return { ownedTitleIds: [], selectedTitleId: null, schemaMissing: true };
    }
    throw error;
  }
}
module.exports = { getTitleOwnership };
