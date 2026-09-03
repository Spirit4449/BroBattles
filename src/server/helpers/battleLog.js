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
    const charClass = String(p.char_class || "ninja").toLowerCase();
    const profileIconId = resolvePlayerIconId(p);
    const trophiesDelta = Number(r.trophiesDelta) || 0;
    const kills = Number(r.kills) || 0;
    const damage = Number(r.damage) || 0;
    const hits = Number(r.hits) || 0;
    const coinsAwarded = Number(r.coinsAwarded) || 0;
    const gemsAwarded = Number(r.gemsAwarded) || 0;

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
    // Fallback if summary column does not exist yet
    try {
      await db.runQuery(
        "UPDATE matches SET status = 'completed', winner_team = ? WHERE match_id = ?",
        [winnerTeam, matchId],
      );
    } catch (_) {
      await db.runQuery(
        "UPDATE matches SET status = 'completed' WHERE match_id = ?",
        [matchId],
      );
    }
  }

  // Update participant stats for humans if columns exist
  for (const p of roomPlayers) {
    if (p.user_id && !p.isBot) {
      const r = rewardsMap.get(String(p.name)) || {};
      try {
        await db.runQuery(
          `UPDATE match_participants
              SET trophies_delta = ?, kills = ?, damage = ?, hits = ?, coins_awarded = ?, gems_awarded = ?
            WHERE match_id = ? AND user_id = ?`,
          [
            Number(r.trophiesDelta) || 0,
            Number(r.kills) || 0,
            Number(r.damage) || 0,
            Number(r.hits) || 0,
            Number(r.coinsAwarded) || 0,
            Number(r.gemsAwarded) || 0,
            matchId,
            Number(p.user_id),
          ],
        );
      } catch (_) {
        // Safe to ignore if individual combat stat columns have not been added yet
      }
    }
  }

  return summary;
}

async function getBattleLogForUser(db, userId, limit = 10) {
  if (!db || !userId) return [];
  const uid = Number(userId);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));

  let matchRows = [];
  try {
    matchRows = await db.runQuery(
      `SELECT m.match_id, m.mode, m.mode_id, m.mode_variant_id, m.map, m.status, m.winner_team, m.created_at,
              m.summary,
              mp.team AS player_team, mp.char_class AS player_char_class,
              COALESCE(mp.trophies_delta, 0) AS player_trophies_delta,
              COALESCE(mp.kills, 0) AS player_kills,
              COALESCE(mp.damage, 0) AS player_damage,
              COALESCE(mp.hits, 0) AS player_hits,
              COALESCE(mp.coins_awarded, 0) AS player_coins_awarded,
              COALESCE(mp.gems_awarded, 0) AS player_gems_awarded
         FROM match_participants mp
         JOIN matches m ON m.match_id = mp.match_id
        WHERE mp.user_id = ?
          AND m.status = 'completed'
        ORDER BY m.created_at DESC, m.match_id DESC
        LIMIT ?`,
      [uid, safeLimit],
    );
  } catch (err) {
    // If optional columns (summary, trophies_delta, mode_id, winner_team) are missing
    try {
      matchRows = await db.runQuery(
        `SELECT m.match_id, m.mode, m.map, m.status, m.created_at,
                mp.team AS player_team, mp.char_class AS player_char_class,
                0 AS player_trophies_delta,
                0 AS player_kills,
                0 AS player_damage,
                0 AS player_hits,
                0 AS player_coins_awarded,
                0 AS player_gems_awarded
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
        `SELECT mp.match_id, mp.user_id, mp.team, mp.char_class,
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
          kills: 0,
          damage: 0,
          hits: 0,
          trophiesDelta: 0,
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
          kills: 0,
          damage: 0,
          hits: 0,
          trophiesDelta: 0,
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

    let outcome = "draw";
    if (winnerTeam && winnerTeam !== "draw") {
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
        kills: Number(p.kills) || 0,
        damage: Number(p.damage) || 0,
        hits: Number(p.hits) || 0,
        trophiesDelta: Number(p.trophiesDelta) || 0,
        coinsAwarded: Number(p.coinsAwarded) || 0,
        gemsAwarded: Number(p.gemsAwarded) || 0,
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
            kills: Number(row.player_kills) || 0,
            damage: Number(row.player_damage) || 0,
            hits: Number(row.player_hits) || 0,
            trophiesDelta: Number(row.player_trophies_delta) || 0,
          },
        ];
      }
    }

    // Determine trophiesDelta for the current player
    const currentPlayerObj = players.find((p) => p.isCurrentPlayer);
    let trophiesDelta = 0;
    if (
      currentPlayerObj &&
      typeof currentPlayerObj.trophiesDelta === "number" &&
      currentPlayerObj.trophiesDelta !== 0
    ) {
      trophiesDelta = currentPlayerObj.trophiesDelta;
    } else if (Number(row.player_trophies_delta) !== 0) {
      trophiesDelta = Number(row.player_trophies_delta);
    } else {
      // Historical fallback calculation
      if (outcome === "victory") trophiesDelta = 20;
      else if (outcome === "defeat") trophiesDelta = -10;
      else trophiesDelta = 0;
    }

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
      outcome, // "victory" | "defeat" | "draw"
      trophiesDelta,
      createdAt: row.created_at
        ? new Date(row.created_at).toISOString()
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
        kills: currentPlayerObj?.kills || Number(row.player_kills) || 0,
        damage: currentPlayerObj?.damage || Number(row.player_damage) || 0,
        hits: currentPlayerObj?.hits || Number(row.player_hits) || 0,
        coinsAwarded:
          currentPlayerObj?.coinsAwarded ||
          Number(row.player_coins_awarded) ||
          0,
        gemsAwarded:
          currentPlayerObj?.gemsAwarded || Number(row.player_gems_awarded) || 0,
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
