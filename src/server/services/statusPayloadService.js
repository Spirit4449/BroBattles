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

async function getUserLiveMatch(db, userId) {
  if (!userId) return null;

  try {
    const rows = await db.runQuery(
      "SELECT m.match_id FROM matches m JOIN match_participants mp ON m.match_id = mp.match_id WHERE mp.user_id = ? AND m.status = 'live' LIMIT 1",
      [userId],
    );
    return rows.length > 0 ? rows[0].match_id : null;
  } catch (error) {
    console.error("Error checking user live match:", error);
    return null;
  }
}

async function buildStatusPayload({
  db,
  getOrCreateCurrentUser,
  isGuest,
  isAdminUser,
  req,
  res,
}) {
  const [user, userType] = await getOrCreateCurrentUser(req, res, {
    autoCreate: true,
  });
  const userNormalized = normalizeUserForStatus(user);

  let selectedCardId = null;
  let ownedCardIds = [];
  let preferredSelection = null;
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
    try {
      preferredSelection = await db.getUserPreferredSelection(
        userNormalized.user_id,
      );
    } catch (error) {
      console.warn(
        "[status] unable to load preferred selection:",
        error?.message || error,
      );
      preferredSelection = null;
    }
  }
  if (userNormalized) {
    userNormalized.selected_card_id = selectedCardId;
    userNormalized.owned_card_ids = ownedCardIds;
    userNormalized.preferred_selection = preferredSelection;
  }

  const partyRows = await db.runQuery(
    "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
    [userNormalized?.name],
  );

  const liveMatchId = await getUserLiveMatch(db, userNormalized?.user_id);

  return {
    success: true,
    userData: userNormalized,
    isAdmin:
      typeof isAdminUser === "function" ? !!isAdminUser(userNormalized) : false,
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
