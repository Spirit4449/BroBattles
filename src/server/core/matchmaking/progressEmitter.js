function createProgressEmitter({ db, io, lastProgress }) {
  async function emitProgressForBucket(mode, map, items, teamSize) {
    if (!items || !items.length) return;

    const totalPlayers = Math.min(
      items.reduce(
        (acc, t) => acc + Number(t.size || t.team1_count + t.team2_count || 0),
        0,
      ),
      teamSize * 2,
    );
    const payload = { mode, map, found: totalPlayers, total: teamSize * 2 };
    const signature = `${mode}:${map}:${payload.found}:${payload.total}`;

    const soloIds = items.filter((t) => t.user_id).map((t) => t.user_id);
    let soloSockets = new Map();
    if (soloIds.length) {
      try {
        const placeholders = soloIds.map(() => "?").join(",");
        const rows = await db.runQuery(
          `SELECT user_id, socket_id FROM users WHERE user_id IN (${placeholders})`,
          soloIds,
        );
        soloSockets = new Map(rows.map((r) => [r.user_id, r.socket_id]));
      } catch (_) {}
    }

    // Lightweight roster preview for overlay rendering.
    // Keep bounded by bucket capacity so payloads stay small.
    try {
      const players = [];
      const seen = new Set();

      for (const t of items) {
        if (players.length >= teamSize * 2) break;

        if (t.party_id) {
          try {
            const members = await db.fetchPartyMembersDetailed(t.party_id);
            for (const m of members || []) {
              if (!m?.name || seen.has(m.name)) continue;
              seen.add(m.name);
              players.push({
                name: m.name,
                char_class: m.char_class || "ninja",
              });
              if (players.length >= teamSize * 2) break;
            }
          } catch (_) {}
          continue;
        }

        if (t.user_id) {
          try {
            const rows = await db.runQuery(
              "SELECT name, char_class FROM users WHERE user_id = ? LIMIT 1",
              [t.user_id],
            );
            const u = rows?.[0];
            if (u?.name && !seen.has(u.name)) {
              seen.add(u.name);
              players.push({
                name: u.name,
                char_class: u.char_class || "ninja",
              });
            }
          } catch (_) {}
        }
      }

      payload.players = players;
    } catch (_) {}

    for (const t of items) {
      const prev = lastProgress.get(t.ticket_id);
      if (prev === signature) continue;
      lastProgress.set(t.ticket_id, signature);
      if (t.party_id) {
        io.to(`party:${t.party_id}`).emit("match:progress", payload);
      } else if (t.user_id) {
        const sid = soloSockets.get(t.user_id);
        if (!sid) continue;
        const sock = io.sockets.sockets.get(sid);
        if (sock) sock.emit("match:progress", payload);
      }
    }
  }

  return { emitProgressForBucket };
}

module.exports = { createProgressEmitter };
