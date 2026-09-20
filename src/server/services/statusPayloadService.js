const {
  syncProfileIconOwnershipForUser,
} = require("../helpers/profileIconOwnership");
const { syncSkinOwnershipForUser } = require("../helpers/skinOwnership");

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

function parseMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function optionalStatusValue(load, fallback, onError) {
  try {
    return await load();
  } catch (error) {
    onError?.(error);
    return fallback;
  }
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

  if (Number(userNormalized?.is_banned || 0) === 1) {
    return {
      success: false,
      banned: true,
      message: String(
        userNormalized?.ban_reason || "Your account has been banned.",
      ),
    };
  }

  // These branches use independent fields. Keep each ownership helper's internal
  // write/lock ordering, but don't serialize unrelated account and routing reads.
  const userId = userNormalized?.user_id;
  const optionalUserValue = (load, fallback, onError) => userId
    ? optionalStatusValue(load, fallback, onError)
    : Promise.resolve(fallback);
  const [iconState, skinState, selectedCardId, ownedCardIds,
    preferredSelection, partyRows, liveMatchId] = await Promise.all([
    optionalUserValue(() => syncProfileIconOwnershipForUser(db, userNormalized), {}),
    optionalUserValue(() => syncSkinOwnershipForUser(db, userNormalized), {}),
    optionalUserValue(() => db.getUserSelectedCardId(userId), null),
    optionalUserValue(() => db.getUserOwnedCardIds(userId), []),
    optionalUserValue(() => db.getUserPreferredSelection(userId), null, error => {
      console.warn("[status] unable to load preferred selection:", error?.message || error);
    }),
    // Membership is authoritative: unlike optional customization, a failed
    // lookup must fail status rather than masquerade as "no party".
    db.runQuery("SELECT party_id FROM party_members WHERE name = ? LIMIT 1", [userNormalized?.name]),
    getUserLiveMatch(db, userId),
  ]);
  if (userNormalized) {
    userNormalized.selected_card_id = selectedCardId;
    userNormalized.owned_card_ids = ownedCardIds;
    userNormalized.selected_profile_icon_id = iconState?.selectedProfileIconId || null;
    userNormalized.owned_profile_icon_ids = Array.isArray(iconState?.ownedIconIds) ? iconState.ownedIconIds : [];
    userNormalized.selected_skin_id_by_char = skinState?.selectedSkinIdByCharacter || {};
    userNormalized.owned_skin_ids = Array.isArray(skinState?.ownedSkinIds) ? skinState.ownedSkinIds : [];
    userNormalized.preferred_selection = preferredSelection;
  }

  const mmSuspendedUntilMs = parseMs(userNormalized?.mm_suspended_until);
  const chatSuspendedUntilMs = parseMs(userNormalized?.chat_suspended_until);
  const now = Date.now();
  const suspension = {
    matchmaking: mmSuspendedUntilMs > now ? mmSuspendedUntilMs : null,
    chat: chatSuspendedUntilMs > now ? chatSuspendedUntilMs : null,
  };

  return {
    success: true,
    userData: userNormalized,
    mapCatalog: require("./mapRepository").mapRepository.list().map(({document})=>({...document.metadata,id:document.id,label:document.label})),
    suspension,
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
