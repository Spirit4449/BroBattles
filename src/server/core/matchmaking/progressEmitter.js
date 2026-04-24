function createProgressEmitter({ db, io, lastProgress }) {
  const {
    normalizeSelectedSkinMap,
    resolveSelectedSkinId,
    buildSkinAssetUrl,
  } = require("../../helpers/skinsCatalog");

  function ageSeconds(row) {
    return Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000);
  }

  function mmrWindowForTicket(ticket) {
    return Math.min(400, 100 + Math.floor(ageSeconds(ticket) * 15));
  }

  function mmrOf(ticket) {
    return Number(ticket?.mmr) || 0;
  }

  function ticketSize(ticket) {
    return Number(ticket.size || ticket.team1_count + ticket.team2_count || 0);
  }

  async function emitProgressForBucket(
    modeId,
    modeVariantId,
    map,
    items,
    teamSize,
    options = {},
  ) {
    if (!items || !items.length) return;

    const totalRequired = teamSize * 2;
    const sortedItems = items
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const soloIds = sortedItems.filter((t) => t.user_id).map((t) => t.user_id);
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

    const partyMembersCache = new Map();
    const soloUserCache = new Map();

    async function previewPlayersForTicket(ticket) {
      if (ticket.party_id) {
        if (partyMembersCache.has(ticket.party_id)) {
          return partyMembersCache.get(ticket.party_id);
        }
        try {
          const members = await db.fetchPartyMembersDetailed(ticket.party_id);
          const normalized = (members || [])
            .filter((m) => !!m?.name)
            .map((m) => {
              const character = m.char_class || "ninja";
              const selectedSkinId = resolveSelectedSkinId({
                character,
                selectedSkinMap: normalizeSelectedSkinMap(
                  m.selected_skin_id_by_char,
                ),
              });
              return {
                name: m.name,
                char_class: character,
                selected_skin_id: selectedSkinId,
                selected_skin_asset_url: buildSkinAssetUrl(
                  character,
                  selectedSkinId,
                ),
                profile_icon_id: String(m.profile_icon_id || "") || null,
              };
            });
          partyMembersCache.set(ticket.party_id, normalized);
          return normalized;
        } catch (_) {
          partyMembersCache.set(ticket.party_id, []);
          return [];
        }
      }

      if (ticket.user_id) {
        if (soloUserCache.has(ticket.user_id)) {
          return soloUserCache.get(ticket.user_id);
        }
        try {
          const rows = await db.runQuery(
            "SELECT name, char_class, selected_profile_icon_id AS profile_icon_id, selected_skin_id_by_char FROM users WHERE user_id = ? LIMIT 1",
            [ticket.user_id],
          );
          const u = rows?.[0];
          const normalized = u?.name
            ? [
                {
                  name: u.name,
                  char_class: u.char_class || "ninja",
                  selected_skin_id: resolveSelectedSkinId({
                    character: u.char_class || "ninja",
                    selectedSkinMap: normalizeSelectedSkinMap(
                      u.selected_skin_id_by_char,
                    ),
                  }),
                  selected_skin_asset_url: buildSkinAssetUrl(
                    u.char_class || "ninja",
                    resolveSelectedSkinId({
                      character: u.char_class || "ninja",
                      selectedSkinMap: normalizeSelectedSkinMap(
                        u.selected_skin_id_by_char,
                      ),
                    }),
                  ),
                  profile_icon_id: String(u.profile_icon_id || "") || null,
                },
              ]
            : [];
          soloUserCache.set(ticket.user_id, normalized);
          return normalized;
        } catch (_) {
          soloUserCache.set(ticket.user_id, []);
          return [];
        }
      }

      return [];
    }

    for (const viewerTicket of sortedItems) {
      const window = mmrWindowForTicket(viewerTicket);
      const visibleItems = sortedItems.filter(
        (candidate) =>
          Math.abs(mmrOf(candidate) - mmrOf(viewerTicket)) <= window,
      );

      const foundPlayers = Math.min(
        visibleItems.reduce((acc, t) => acc + ticketSize(t), 0),
        totalRequired,
      );

      const players = [];
      const seenNames = new Set();
      for (const ticket of visibleItems) {
        if (players.length >= totalRequired) break;
        const entries = await previewPlayersForTicket(ticket);
        for (const entry of entries) {
          if (!entry?.name || seenNames.has(entry.name)) continue;
          seenNames.add(entry.name);
          players.push(entry);
          if (players.length >= totalRequired) break;
        }
      }

      const payload = {
        modeId,
        modeVariantId,
        selection: { modeId, modeVariantId, mapId: Number(map) },
        map,
        found: foundPlayers,
        total: totalRequired,
        players,
      };

      const rosterSig = players
        .map((p) => `${p.name}:${p.char_class || ""}`)
        .join("|");
      const signature = `${modeId}:${modeVariantId}:${map}:${payload.found}:${payload.total}:${rosterSig}`;

      const prev = lastProgress.get(viewerTicket.ticket_id);
      if (prev === signature) continue;
      lastProgress.set(viewerTicket.ticket_id, signature);

      if (viewerTicket.party_id) {
        io.to(`party:${viewerTicket.party_id}`).emit("match:progress", payload);
      } else if (viewerTicket.user_id) {
        const sid = soloSockets.get(viewerTicket.user_id);
        if (!sid) continue;
        const sock = io.sockets.sockets.get(sid);
        if (sock) sock.emit("match:progress", payload);
      }
    }
  }

  return { emitProgressForBucket };
}

module.exports = { createProgressEmitter };
