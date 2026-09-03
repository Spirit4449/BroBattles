const {
  getModeById,
  getVariantDescriptor,
  getMapById,
  normalizeSelectionFromRow,
} = require("./gameSelectionCatalog");

function formatModeLabel(modeId, modeVariantId) {
  const mId = String(modeId || "duels").toLowerCase();
  const vId = String(modeVariantId || "").toLowerCase();
  if (mId === "duels") {
    if (vId.includes("1v1")) return "1v1 Duel";
    if (vId.includes("2v2")) return "2v2 Duel";
    if (vId.includes("3v3")) return "3v3 Duel";
    return "Duel";
  }
  if (mId === "bank-bust") {
    return "Bank Bust 3v3";
  }
  const { mode, variant } = getVariantDescriptor(modeId, modeVariantId);
  if (variant?.name && mode?.name) {
    return `${variant.name} ${mode.name}`;
  }
  return mode?.name || "Battle";
}

function resolvePlayerIconId(player) {
  const icon =
    player.selected_profile_icon_id ||
    player.profile_icon_id ||
    player.profileIconId;
  if (icon && typeof icon === "string" && icon.trim()) {
    return icon.trim().toLowerCase();
  }
  return String(player.char_class || player.charClass || "ninja")
    .trim()
    .toLowerCase();
}

function nullableNumber(value) {
  return value == null || value === "" || !Number.isFinite(Number(value))
    ? null
    : Number(value);
}

async function recordMatchOutcome(db, room, winnerTeam, rewardSummary = []) {
  if (!db || !room || !room.matchId) return null;
  const matchId = Number(room.matchId);
  const rewardsMap = new Map();
  for (const r of rewardSummary || []) {
    if (r?.username) {
      rewardsMap.set(String(r.username), r);
    }
  }

  const playersList = [];
  const roomPlayers = room.players ? Array.from(room.players.values()) : [];

  for (const p of roomPlayers) {
    const r = rewardsMap.get(String(p.name)) || {};
    const combat = room.rewardStats?.get(String(p.name)) || {};
    const charClass = String(p.char_class || "ninja").toLowerCase();
    const profileIconId = resolvePlayerIconId(p);
    const trophiesDelta = nullableNumber(r.trophiesDelta);
    const kills = nullableNumber(r.kills ?? combat.kills);
    const damage = nullableNumber(r.damage ?? combat.damage);
    const hits = nullableNumber(r.hits ?? combat.hits);
    const coinsAwarded = nullableNumber(r.coinsAwarded);
    const gemsAwarded = nullableNumber(r.gemsAwarded);

    playersList.push({
      userId: p.user_id ? Number(p.user_id) : null,
      name: String(p.name || (p.isBot ? "Bot" : "Player")),
      team: String(p.team || "team1"),
      charClass,
      profileIconId,
      isBot: !!p.isBot,
      kills,
      damage,
      hits,
      trophiesDelta,
      coinsAwarded,
      gemsAwarded,
    });
  }

  const summary = {
    matchId,
    modeId: room.matchData?.modeId || "duels",
    modeVariantId: room.matchData?.modeVariantId || "duels-1v1",
    mapId: Number(room.matchData?.map) || 1,
    winnerTeam: winnerTeam || "draw",
    completedAt: new Date().toISOString(),
    players: playersList,
  };

  const summaryJson = JSON.stringify(summary);

  try {
    await db.runQuery(
      "UPDATE matches SET status = 'completed', winner_team = ?, summary = ? WHERE match_id = ?",
      [winnerTeam, summaryJson, matchId],
    );
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
    console.warn("[battleLog] Missing result columns; apply migrations/2026-09-03_match_battle_log.sql");
    // Fallback if summary column does not exist yet
    try {
      await db.runQuery(
        "UPDATE matches SET status = 'completed', winner_team = ? WHERE match_id = ?",
        [winnerTeam, matchId],
      );
    } catch (fallbackError) {
      if (fallbackError?.code !== "ER_BAD_FIELD_ERROR") throw fallbackError;
      await db.runQuery(
        "UPDATE matches SET status = 'completed' WHERE match_id = ?",
        [matchId],
      );
    }
  }

  // Update participant stats for humans if columns exist
  for (const p of playersList) {
    if (p.userId && !p.isBot) {
      try {
        await db.runQuery(
          `UPDATE match_participants
              SET trophies_delta = ?, kills = ?, damage = ?, hits = ?, coins_awarded = ?, gems_awarded = ?
            WHERE match_id = ? AND user_id = ?`,
          [
            p.trophiesDelta,
            p.kills,
            p.damage,
            p.hits,
            p.coinsAwarded,
            p.gemsAwarded,
            matchId,
            p.userId,
          ],
        );
      } catch (error) {
        if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
        // Safe to ignore if individual combat stat columns have not been added yet
      }
    }
  }

  return summary;
}

async function getBattleLogForUser(db, userId, limit = 10) {
  if (!db || !userId) return [];
  const uid = Number(userId);
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

  let matchRows = [];
  try {
    matchRows = await db.runQuery(
      `SELECT m.match_id, m.mode, m.mode_id, m.mode_variant_id, m.map, m.status, m.winner_team, m.created_at,
              m.summary,
              mp.team AS player_team, mp.char_class AS player_char_class,
              mp.trophies_delta AS player_trophies_delta,
              mp.kills AS player_kills,
              mp.damage AS player_damage,
              mp.hits AS player_hits,
              mp.coins_awarded AS player_coins_awarded,
              mp.gems_awarded AS player_gems_awarded
         FROM match_participants mp
         JOIN matches m ON m.match_id = mp.match_id
        WHERE mp.user_id = ?
          AND m.status = 'completed'
        ORDER BY m.created_at DESC, m.match_id DESC
        LIMIT ?`,
      [uid, safeLimit],
    );
  } catch (err) {
    if (err?.code !== "ER_BAD_FIELD_ERROR") throw err;
    // If optional columns (summary, trophies_delta, mode_id, winner_team) are missing
    try {
      matchRows = await db.runQuery(
        `SELECT m.*,
                mp.team AS player_team, mp.char_class AS player_char_class
           FROM match_participants mp
           JOIN matches m ON m.match_id = mp.match_id
          WHERE mp.user_id = ?
            AND m.status = 'completed'
          ORDER BY m.created_at DESC, m.match_id DESC
          LIMIT ?`,
        [uid, safeLimit],
      );
    } catch (fallbackErr) {
      console.warn(
        "[battleLog] Failed to query match rows",
        fallbackErr?.message,
      );
      return [];
    }
  }

  if (!matchRows || !matchRows.length) {
    return [];
  }

  // Find which matches need participant lookups (matches that do not have a summary JSON)
  const matchesNeedingLookup = [];
  for (const row of matchRows) {
    let summary = null;
    if (row.summary) {
      try {
        summary =
          typeof row.summary === "string"
            ? JSON.parse(row.summary)
            : row.summary;
      } catch (_) {
        summary = null;
      }
    }
    if (
      !summary ||
      !Array.isArray(summary.players) ||
      !summary.players.length
    ) {
      matchesNeedingLookup.push(row.match_id);
    }
  }

  const participantsByMatch = new Map();
  if (matchesNeedingLookup.length) {
    const ph = matchesNeedingLookup.map(() => "?").join(",");
    try {
      const partRows = await db.runQuery(
        `SELECT mp.*,
                u.name, u.selected_profile_icon_id AS profile_icon_id
           FROM match_participants mp
           LEFT JOIN users u ON u.user_id = mp.user_id
          WHERE mp.match_id IN (${ph})`,
        matchesNeedingLookup,
      );
      for (const pr of partRows || []) {
        const mid = pr.match_id;
        if (!participantsByMatch.has(mid)) participantsByMatch.set(mid, []);
        participantsByMatch.get(mid).push({
          userId: pr.user_id ? Number(pr.user_id) : null,
          name: pr.name || "Player",
          team: pr.team || "team1",
          charClass: String(pr.char_class || "ninja").toLowerCase(),
          profileIconId: resolvePlayerIconId(pr),
          isBot: false,
          kills: nullableNumber(pr.kills),
          damage: nullableNumber(pr.damage),
          hits: nullableNumber(pr.hits),
          trophiesDelta: nullableNumber(pr.trophies_delta),
          coinsAwarded: nullableNumber(pr.coins_awarded),
          gemsAwarded: nullableNumber(pr.gems_awarded),
        });
      }
    } catch (_) {}

    // Check if bots exist for any of these matches
    try {
      const botRows = await db.runQuery(
        `SELECT match_id, name, team, char_class, trophies
           FROM match_bot_participants
          WHERE match_id IN (${ph})`,
        matchesNeedingLookup,
      );
      for (const br of botRows || []) {
        const mid = br.match_id;
        if (!participantsByMatch.has(mid)) participantsByMatch.set(mid, []);
        participantsByMatch.get(mid).push({
          userId: null,
          name: br.name || "Bot",
          team: br.team || "team2",
          charClass: String(br.char_class || "ninja").toLowerCase(),
          profileIconId: resolvePlayerIconId(br),
          isBot: true,
          kills: null,
          damage: null,
          hits: null,
          trophiesDelta: null,
        });
      }
    } catch (_) {}
  }

  const battles = [];

  for (const row of matchRows) {
    let summary = null;
    if (row.summary) {
      try {
        summary =
          typeof row.summary === "string"
            ? JSON.parse(row.summary)
            : row.summary;
      } catch (_) {
        summary = null;
      }
    }

    const selection = normalizeSelectionFromRow(row);
    const modeId = summary?.modeId || selection.modeId || "duels";
    const modeVariantId =
      summary?.modeVariantId || selection.modeVariantId || "duels-1v1";
    const modeDef = getModeById(modeId);
    const modeArt = modeDef?.artAsset || "/assets/duels.webp";
    const modeLabel = formatModeLabel(modeId, modeVariantId);

    const mapId = Number(summary?.mapId || selection.mapId || row.map || 1);
    const mapDef = getMapById(mapId);
    const mapLabel = mapDef?.label || `Map ${mapId}`;
    const mapBanner =
      mapDef?.mapSelectPreviewAsset ||
      mapDef?.lobbyBgAsset ||
      "/assets/lushy/preview.webp";

    const winnerTeam = summary?.winnerTeam || row.winner_team || null;
    const playerTeam = String(row.player_team || "team1");

    let outcome = winnerTeam === "draw" ? "draw" : "unknown";
    if (["team1", "team2"].includes(winnerTeam)) {
      outcome = winnerTeam === playerTeam ? "victory" : "defeat";
    }

    let players = [];
    if (
      summary &&
      Array.isArray(summary.players) &&
      summary.players.length > 0
    ) {
      players = summary.players.map((p) => ({
        userId: p.userId ? Number(p.userId) : null,
        name: String(p.name || (p.isBot ? "Bot" : "Player")),
        team: String(p.team || "team1"),
        charClass: String(p.charClass || "ninja").toLowerCase(),
        profileIconId: resolvePlayerIconId(p),
        isBot: Boolean(p.isBot),
        isCurrentPlayer: Number(p.userId) === uid,
        kills: nullableNumber(p.kills),
        damage: nullableNumber(p.damage),
        hits: nullableNumber(p.hits),
        trophiesDelta: nullableNumber(p.trophiesDelta),
        coinsAwarded: nullableNumber(p.coinsAwarded),
        gemsAwarded: nullableNumber(p.gemsAwarded),
      }));
    } else {
      const fallbackList = participantsByMatch.get(row.match_id) || [];
      if (fallbackList.length > 0) {
        players = fallbackList.map((p) => ({
          ...p,
          isCurrentPlayer: Number(p.userId) === uid,
        }));
      } else {
        // Minimal fallback with the player
        players = [
          {
            userId: uid,
            name: "You",
            team: playerTeam,
            charClass: String(row.player_char_class || "ninja").toLowerCase(),
            profileIconId: String(
              row.player_char_class || "ninja",
            ).toLowerCase(),
            isBot: false,
            isCurrentPlayer: true,
            kills: nullableNumber(row.player_kills),
            damage: nullableNumber(row.player_damage),
            hits: nullableNumber(row.player_hits),
            trophiesDelta: nullableNumber(row.player_trophies_delta),
          },
        ];
      }
    }

    // Determine trophiesDelta for the current player
    const currentPlayerObj = players.find((p) => p.isCurrentPlayer);
    const trophiesDelta = currentPlayerObj?.trophiesDelta ??
      nullableNumber(row.player_trophies_delta);

    const team1 = players.filter((p) => p.team === "team1");
    const team2 = players.filter((p) => p.team === "team2");

    battles.push({
      matchId: Number(row.match_id),
      modeId,
      modeVariantId,
      modeLabel,
      modeArt,
      mapId,
      mapLabel,
      mapBanner,
      mapPreview: mapBanner,
      winnerTeam,
      playerTeam,
      outcome, // Missing historical results are not draws.
      trophiesDelta,
      createdAt: summary?.completedAt || row.created_at
        ? new Date(summary?.completedAt || row.created_at).toISOString()
        : new Date().toISOString(),
      player: {
        name: currentPlayerObj?.name || "You",
        charClass:
          currentPlayerObj?.charClass ||
          String(row.player_char_class || "ninja").toLowerCase(),
        profileIconId:
          currentPlayerObj?.profileIconId ||
          String(row.player_char_class || "ninja").toLowerCase(),
      },
      playerStats: {
        kills: currentPlayerObj?.kills ?? nullableNumber(row.player_kills),
        damage: currentPlayerObj?.damage ?? nullableNumber(row.player_damage),
        hits: currentPlayerObj?.hits ?? nullableNumber(row.player_hits),
        coinsAwarded:
          currentPlayerObj?.coinsAwarded ?? nullableNumber(row.player_coins_awarded),
        gemsAwarded:
          currentPlayerObj?.gemsAwarded ?? nullableNumber(row.player_gems_awarded),
      },
      teams: {
        team1,
        team2,
      },
    });
  }

  return battles;
}

module.exports = {
  formatModeLabel,
  resolvePlayerIconId,
  recordMatchOutcome,
  getBattleLogForUser,
};
