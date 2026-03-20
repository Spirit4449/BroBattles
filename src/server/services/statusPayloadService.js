const { getUserLiveMatch } = require("../helpers/match");

function normalizeUserForStatus(user) {
  const out = user ? { ...user } : null;
  if (out && typeof out.char_levels === "string") {
    try {
      out.char_levels = JSON.parse(out.char_levels || "{}");
    } catch (_) {
      out.char_levels = {};
    }
  }
  return out;
}

async function buildStatusPayload({
  db,
  getOrCreateCurrentUser,
  isGuest,
  req,
  res,
}) {
  const [user, userType] = await getOrCreateCurrentUser(req, res, {
    autoCreate: true,
  });
  const userNormalized = normalizeUserForStatus(user);

  let selectedCardId = null;
  let ownedCardIds = [];
  if (userNormalized?.user_id) {
    try {
      selectedCardId = await db.getUserSelectedCardId(userNormalized.user_id);
    } catch (_) {
      selectedCardId = null;
    }
    try {
      ownedCardIds = await db.getUserOwnedCardIds(userNormalized.user_id);
    } catch (_) {
      ownedCardIds = [];
    }
  }
  if (userNormalized) {
    userNormalized.selected_card_id = selectedCardId;
    userNormalized.owned_card_ids = ownedCardIds;
  }

  const partyRows = await db.runQuery(
    "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
    [userNormalized?.name],
  );

  const liveMatchId = await getUserLiveMatch(db, userNormalized?.user_id);

  return {
    success: true,
    userData: userNormalized,
    newlyCreated: userType === "new",
    guest: isGuest(userNormalized),
    party_id: partyRows[0]?.party_id ?? null,
    live_match_id: liveMatchId,
  };
}

module.exports = {
  normalizeUserForStatus,
  buildStatusPayload,
};
