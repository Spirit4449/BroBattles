function createMatchAssemblyManager({
  db,
  io,
  worker,
  runInTx,
  partyStatus,
  lastProgress,
  readyCheckCoordinator,
}) {
  const { selectionToLegacyMode } = require("../../helpers/gameSelectionCatalog");

  async function assembleAndReady(modeId, modeVariantId, map, picks) {
    const ids = picks.map((p) => p.ticket.ticket_id);
    const placeholders = ids.map(() => "?").join(",");
    const r = await db.runQuery(
      `UPDATE match_tickets SET claimed_by = ? WHERE ticket_id IN (${placeholders}) AND status='queued' AND (claimed_by IS NULL OR claimed_by='')`,
      [worker, ...ids],
    );
    if ((r?.affectedRows || 0) !== ids.length) {
      return;
    }

    const players = [];
    for (const pick of picks) {
      const t = pick.ticket;
      const flipped = !!pick.flip;
      if (t.party_id) {
        const rows = await db.runQuery(
          "SELECT u.user_id, u.name, u.char_class, pm.party_id, pm.team FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ?",
          [t.party_id],
        );
        rows.forEach((u) => {
          let team = u.team;
          if (flipped) team = team === "team1" ? "team2" : "team1";
          players.push({
            user_id: u.user_id,
            name: u.name,
            party_id: u.party_id,
            team,
            char_class: u.char_class || null,
          });
        });
      } else if (t.user_id) {
        const u = await db.getUserById(t.user_id);
        if (!u) continue;
        let team = t.team1_count === 1 ? "team1" : "team2";
        if (flipped) team = team === "team1" ? "team2" : "team1";
        players.push({
          user_id: u.user_id,
          name: u.name,
          party_id: null,
          team,
          char_class: u.char_class || null,
        });
      }
    }

    const tickets = picks.map((p) => p.ticket);
    const matchId = await commitMatch({
      mode: selectionToLegacyMode(modeId, modeVariantId),
      modeId,
      modeVariantId,
      map,
      tickets,
      players,
    });

    ids.forEach((id) => lastProgress.delete(id));
    const size1 = players.filter((p) => p.team === "team1").length;
    const size2 = players.filter((p) => p.team === "team2").length;
    const mmrDelta = Math.abs(
      averageTicketMMR(tickets, "team1") - averageTicketMMR(tickets, "team2"),
    );
    console.log(
      `[match:new] #${matchId} mode=${modeId}:${modeVariantId} map=${map} ${size1}v${size2} mmrDelta=${mmrDelta} tickets=${tickets.length}`,
    );

    await emitMatchFound(matchId, modeId, modeVariantId, map, players);
    readyCheckCoordinator.startReadyCheck(
      matchId,
      players.map((p) => p.user_id),
    );
  }

  function averageTicketMMR(tickets, which) {
    let sum = 0;
    let count = 0;
    for (const t of tickets) {
      const c = which === "team1" ? t.team1_count : t.team2_count;
      sum += t.mmr * c;
      count += c;
    }
    return count ? sum / count : 0;
  }

  async function emitMatchFound(matchId, modeId, modeVariantId, map, players) {
    console.log("[match:found] notifying players...");
    const userIds = players.map((p) => p.user_id);
    if (!userIds.length) return;
    const placeholders = userIds.map(() => "?").join(",");
    const rows = await db.runQuery(
      `SELECT user_id, socket_id FROM users WHERE user_id IN (${placeholders})`,
      userIds,
    );
    const socketByUser = new Map(rows.map((r) => [r.user_id, r.socket_id]));
    for (const p of players) {
      const sid = socketByUser.get(p.user_id);
      if (!sid) continue;
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      sock.emit("match:found", {
        matchId,
        modeId,
        modeVariantId,
        selection: { modeId, modeVariantId, mapId: Number(map) },
        map,
        yourTeam: p.team,
        players: players.map((x) => ({
          user_id: x.user_id,
          name: x.name,
          team: x.team,
          char_class: x.char_class,
        })),
      });
    }
  }

  async function commitMatch({
    mode,
    modeId,
    modeVariantId,
    map,
    tickets,
    players,
  }) {
    const ids = tickets.map((t) => t.ticket_id);
    const partyIds = tickets.filter((t) => !!t.party_id).map((t) => t.party_id);
    return runInTx(async (conn, q) => {
      const { insertId: matchId } = await q(
        "INSERT INTO matches (mode,mode_id,mode_variant_id,map,status) VALUES (?,?,?,?, 'queued')",
        [mode, modeId, modeVariantId, map],
      );
      if (players.length) {
        const placeholders = players.map(() => "(?,?,?,?,?)").join(",");
        const values = players.flatMap((p) => [
          matchId,
          p.user_id,
          p.party_id,
          p.team,
          p.char_class || null,
        ]);
        await q(
          `INSERT INTO match_participants (match_id,user_id,party_id,team,char_class) VALUES ${placeholders}`,
          values,
        );
      }
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        await q(`DELETE FROM match_tickets WHERE ticket_id IN (${ph})`, ids);
      }
      if (partyIds.length) {
        await q(
          `UPDATE parties SET status=? WHERE party_id IN (${partyIds
            .map(() => "?")
            .join(",")})`,
          [partyStatus.READY_CHECK, ...partyIds],
        );
      }
      return matchId;
    });
  }

  return {
    assembleAndReady,
  };
}

module.exports = { createMatchAssemblyManager };
