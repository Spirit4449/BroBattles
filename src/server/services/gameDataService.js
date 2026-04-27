const {
  normalizeSelectionFromRow,
} = require("../helpers/gameSelectionCatalog");
const {
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
  buildSkinAssetUrl,
  getSkinGameAssets,
} = require("../helpers/skinsCatalog");

const UNLIMITED_HEALTH_BOT_NAME_PREFIX = "BOT ULTRA";
const UNLIMITED_HEALTH_BOT_HP = 9999999;

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
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Match ID required" },
    };
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
      },
    };
  }

  const participant = participantRows[0];
  const selection = normalizeSelectionFromRow(participant || {});
  if (participant.status !== "live") {
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Match is not live yet" },
    };
  }

  const allParticipants = await db.runQuery(
    `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name, u.char_levels, u.trophies, u.selected_profile_icon_id AS profile_icon_id, u.selected_skin_id_by_char
       FROM match_participants mp
       JOIN users u ON u.user_id = mp.user_id
      WHERE mp.match_id = ?`,
    [matchId],
  );

  const selectedByName = await db.fetchSelectedCardsByNames(
    allParticipants.map((p) => p.name),
  );

  const {
    getHealth,
    getDamage,
    getSpecialDamage,
  } = require("../../lib/characterStats.js");

  const gameData = {
    matchId: Number(matchId),
    mode: participant.mode,
    modeId: selection.modeId,
    modeVariantId: selection.modeVariantId,
    selection,
    map: selection.mapId,
    yourName: user.name,
    isAdmin: typeof isAdminUser === "function" ? !!isAdminUser(user) : false,
    yourTeam: participant.team,
    yourCharacter: participant.char_class,
    players: allParticipants.map((p) => {
      let level = 1;
      try {
        const levels =
          typeof p.char_levels === "string"
            ? JSON.parse(p.char_levels || "{}")
            : p.char_levels || {};
        const lv = levels && levels[p.char_class];
        level = Number(lv) > 0 ? Number(lv) : 1;
      } catch (_) {
        level = 1;
      }
      const baseHealth = getHealth(p.char_class, level);
      const isUnlimitedHealthBot =
        String(p?.name || "")
          .trim()
          .toUpperCase()
          .startsWith(`${UNLIMITED_HEALTH_BOT_NAME_PREFIX} `) &&
        Number(p?.user_id) > 0;
      return {
        user_id: p.user_id,
        name: p.name,
        team: p.team,
        char_class: p.char_class,
        selected_skin_id: resolveSelectedSkinId({
          character: p.char_class,
          selectedSkinMap: normalizeSelectedSkinMap(p.selected_skin_id_by_char),
        }),
        profile_icon_id: String(p.profile_icon_id || "") || null,
        selected_card_id: selectedByName[p.name] ?? null,
        trophies: Number(p.trophies) || 0,
        level,
        stats: {
          health: isUnlimitedHealthBot ? UNLIMITED_HEALTH_BOT_HP : baseHealth,
          damage: getDamage(p.char_class, level),
          specialDamage: getSpecialDamage(p.char_class, level),
        },
        selected_skin_asset_url: buildSkinAssetUrl(
          p.char_class,
          resolveSelectedSkinId({
            character: p.char_class,
            selectedSkinMap: normalizeSelectedSkinMap(
              p.selected_skin_id_by_char,
            ),
          }),
        ),
        selected_skin_game_assets: getSkinGameAssets(
          p.char_class,
          resolveSelectedSkinId({
            character: p.char_class,
            selectedSkinMap: normalizeSelectedSkinMap(
              p.selected_skin_id_by_char,
            ),
          }),
        ),
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
