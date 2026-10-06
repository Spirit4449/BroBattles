const { loadMatchRoster } = require('./matchRosterService');
const { parseCharacterLevels } = require("../../../shared/characters/characterStats.js");
const {
  normalizeSelectionFromRow,
} = require("./gameSelectionCatalog");
const { failure } = require("../serviceResult");

async function buildGameDataForMatch({
  db,
  requireCurrentUser,
  isAdminUser,
  abuseControl,
  req,
  res,
}) {
  const user = await requireCurrentUser(req, res);
  if (!user) return { ok: false, handled: true };

  if (abuseControl && Number(user?.user_id) > 0) {
    const penalties = await abuseControl.getActivePenaltyState(
      Number(user.user_id),
    );
    const mmSuspendedUntilMs = Number(penalties?.mmSuspendedUntilMs || 0);
    if (penalties?.isBanned) {
      return {
        ok: false,
        statusCode: 403,
        payload: {
          success: false,
          error: penalties?.banReason || "Your account has been banned.",
        },
      };
    }
    if (mmSuspendedUntilMs && mmSuspendedUntilMs > Date.now()) {
      return {
        ok: false,
        statusCode: 429,
        payload: {
          success: false,
          error:
            "Matchmaking suspension is active. You cannot join matches right now.",
          type: "mm_suspended",
          suspendedUntilMs: mmSuspendedUntilMs,
        },
      };
    }
  }

  const { matchId } = req.body || {};
  if (!matchId) {
    return failure(400, { success: false, error: "Match ID required" });
  }

  const participantRows = await db.runQuery(
    "SELECT mp.*, m.*, m.status FROM match_participants mp JOIN matches m ON m.match_id = mp.match_id WHERE mp.match_id = ? AND mp.user_id = ?",
    [matchId, user.user_id],
  );

  if (!participantRows.length) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        success: false,
        error: "You are not a participant in this match",
        code: "MATCH_UNAVAILABLE",
      },
    };
  }

  const participant = participantRows[0];
  const selection = normalizeSelectionFromRow(participant || {});
  if (participant.status !== "live") {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        success: false,
        error: ['completed', 'cancelled'].includes(participant.status) ? "Match has ended" : "Match is not live yet",
        code: ['completed', 'cancelled'].includes(participant.status) ? "MATCH_ENDED" : "MATCH_NOT_READY",
      },
    };
  }

  const allParticipants = await loadMatchRoster(db, matchId);

  const selectedByName = await db.fetchSelectedCardsByNames(
    allParticipants.filter((p) => !p.isBot).map((p) => p.name),
  );

  const {
    getHealth,
    getDamage,
    getSpecialDamage,
  } = require("../../../shared/characters/characterStats.js");

  const gameData = {
    matchId: Number(matchId),
    mode: participant.mode,
    modeId: selection.modeId,
    modeVariantId: selection.modeVariantId,
    selection,
    map: selection.mapId,
    mapSnapshot: require("../maps/mapRepository").mapRepository.forMatch(matchId, selection.mapId, selection.modeVariantId || participant.mode),
    yourName: user.name,
    isGuest: !!user.expires_at,
    isAdmin: typeof isAdminUser === "function" ? !!isAdminUser(user) : false,
    yourTeam: participant.team,
    yourCharacter: participant.char_class,
    players: allParticipants.map((p) => {
      let level = p.level || 1;
      try {
        const lv = parseCharacterLevels(p.char_levels)[p.char_class];
        level = p.isBot ? p.level : Number(lv) > 0 ? Number(lv) : 1;
      } catch (_) {
        level = 1;
      }
      const baseHealth = getHealth(p.char_class, level);
      return {
        user_id: p.user_id,
        participantId: p.participantId,
        isBot: p.isBot,
        name: p.name,
        team: p.team,
        char_class: p.char_class,
        // Skin fields are resolved once by loadMatchRoster's decoration.
        selected_skin_id: p.selected_skin_id,
        profile_icon_id: String(p.profile_icon_id || "") || null,
        selected_card_id: p.isBot ? p.selected_card_id : selectedByName[p.name] ?? null,
        trophies: Number(p.trophies) || 0,
        level,
        stats: {
          health: p.isBot && p.botHealthOverride ? p.botHealthOverride : baseHealth,
          damage: getDamage(p.char_class, level),
          specialDamage: getSpecialDamage(p.char_class, level),
        },
        selected_skin_asset_url: p.selected_skin_asset_url,
        selected_skin_game_assets: p.selected_skin_game_assets,
      };
    }),
  };

  return {
    ok: true,
    payload: {
      success: true,
      gameData,
    },
  };
}

module.exports = { buildGameDataForMatch };
