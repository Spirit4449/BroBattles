async function buildGameDataForMatch({
  db,
  requireCurrentUser,
  isAdminUser,
  req,
  res,
}) {
  const user = await requireCurrentUser(req, res);
  if (!user) return { ok: false, handled: true };

  const { matchId } = req.body || {};
  if (!matchId) {
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Match ID required" },
    };
  }

  const participantRows = await db.runQuery(
    "SELECT mp.*, m.mode, m.map, m.status FROM match_participants mp JOIN matches m ON m.match_id = mp.match_id WHERE mp.match_id = ? AND mp.user_id = ?",
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
  if (participant.status !== "live") {
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Match is not live yet" },
    };
  }

  const allParticipants = await db.runQuery(
    `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name, u.char_levels
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
    map: participant.map,
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
      return {
        user_id: p.user_id,
        name: p.name,
        team: p.team,
        char_class: p.char_class,
        selected_card_id: selectedByName[p.name] ?? null,
        level,
        stats: {
          health: getHealth(p.char_class, level),
          damage: getDamage(p.char_class, level),
          specialDamage: getSpecialDamage(p.char_class, level),
        },
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
