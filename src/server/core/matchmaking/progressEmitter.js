const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
function createProgressEmitter({ io, lastProgress }) {
  const { ratingWindow: mmrWindowForTicket } = require('./mmrUtils');

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
    { previews, roster },
  ) {
    if (!items || !items.length) return;

    const totalRequired = teamSize * 2;
    const sortedItems = items
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const visibleRosters = new Map();
    for (const ticket of sortedItems) {
      visibleRosters.set(ticket.ticket_id, (previews.get(ticket.ticket_id) || []).map(player => ({
        name: player.name,
        char_class: player.char_class,
        selected_skin_id: player.selected_skin_id,
        selected_skin_asset_url: player.selected_skin_asset_url,
        profile_icon_id: player.profile_icon_id || null,
      })));
    }

    for (const viewerTicket of sortedItems) {
      const window = mmrWindowForTicket(viewerTicket);
      const visibleItems = sortedItems.filter(
        (candidate) =>
          Math.abs(mmrOf(candidate) - mmrOf(viewerTicket)) <= window,
      );

      let foundPlayers = Math.min(
        visibleItems.reduce((acc, t) => acc + ticketSize(t), 0),
        totalRequired,
      );

      let players = [];
      const seenNames = new Set();
      for (const ticket of visibleItems) {
        if (players.length >= totalRequired) break;
        const entries = visibleRosters.get(ticket.ticket_id);
        for (const entry of entries) {
          if (!entry?.name || seenNames.has(entry.name)) continue;
          seenNames.add(entry.name);
          players.push(entry);
          if (players.length >= totalRequired) break;
        }
      }

      if (roster) { players = roster; foundPlayers = players.length; }

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
        .map((p) => JSON.stringify([p.name, p.char_class, p.selected_skin_id, p.selected_skin_asset_url]))
        .join("|");
      const signature = `${modeId}:${modeVariantId}:${map}:${payload.found}:${payload.total}:${rosterSig}`;

      const prev = lastProgress.get(viewerTicket.ticket_id);
      if (prev === signature) continue;
      lastProgress.set(viewerTicket.ticket_id, signature);

      if (viewerTicket.party_id) {
        io.to(`party:${viewerTicket.party_id}`).emit(SOCKET_EVENTS.MATCH_PROGRESS, payload);
      } else if (viewerTicket.user_id) {
        const sid = previews.get(viewerTicket.ticket_id)?.[0]?.socket_id;
        if (!sid) continue;
        const sock = io.sockets.sockets.get(sid);
        if (sock) sock.emit(SOCKET_EVENTS.MATCH_PROGRESS, payload);
      }
    }
  }

  return { emitProgressForBucket };
}

module.exports = { createProgressEmitter };
