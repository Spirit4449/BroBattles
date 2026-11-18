const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { selectionToLegacyMode } = require("../../services/match/gameSelectionCatalog");
const { decorateParticipant } = require("../../services/match/matchRosterService");
const { buildMatchBots } = require("../../services/match/bots/identity");
const { DEFAULT_CHARACTER } = require("../../../shared/characters/characterStats.js");

// Preview and connectivity checks share one roster snapshot per tick. Assembly
// still locks and validates the live rows before committing the match.
async function readQueuedRosters(db, tickets) {
  const rowsByTicket = new Map(tickets.map((t) => [t.ticket_id, []]));
  for (const party of [true, false]) {
    const field = party ? "party_id" : "user_id";
    const owners = new Map(
      tickets.filter((t) => !!t.party_id === party).map((t) => [Number(t[field]), t.ticket_id]),
    );
    if (!owners.size) continue;
    const ids = [...owners.keys()];
    const fields =
      "u.user_id, u.socket_id, u.name, u.char_class, u.char_levels, u.trophies, u.selected_profile_icon_id AS profile_icon_id, u.selected_skin_id_by_char, u.selected_title_id, u.selected_card_id";
    const sql = party
      ? `SELECT ${fields}, pm.party_id, pm.team FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id IN`
      : `SELECT ${fields} FROM users u WHERE u.user_id IN`;
    const rows = await db.runQuery(
      `${sql} (${ids.map(() => "?").join(",")}) ORDER BY u.user_id`,
      ids,
    );
    for (const row of rows) rowsByTicket.get(owners.get(Number(row[field])))?.push(row);
  }
  return rowsByTicket;
}

async function readActiveTicketMatches(db, tickets) {
  if (!tickets.length) return new Map();
  const filters = [],
    ids = [];
  for (const field of ["party_id", "user_id"]) {
    const values = tickets
      .filter((t) => (field === "party_id" ? t.party_id : !t.party_id))
      .map((t) => t[field]);
    if (!values.length) continue;
    filters.push(`mp.${field} IN (${values.map(() => "?").join(",")})`);
    ids.push(...values);
  }
  const matches = await db.runQuery(
    `SELECT m.match_id, m.status, mp.party_id, mp.user_id FROM matches m JOIN match_participants mp ON mp.match_id=m.match_id
     WHERE m.status IN ('queued','live') AND (${filters.join(" OR ")}) ORDER BY m.match_id DESC`,
    ids,
  );
  const byOwner = new Map();
  for (const row of matches)
    for (const field of ["party_id", "user_id"]) {
      const key = field + ":" + row[field];
      if (row[field] && !byOwner.has(key)) byOwner.set(key, row);
    }
  return new Map(
    tickets.map((ticket) => {
      const field = ticket.party_id ? "party_id" : "user_id";
      return [ticket.ticket_id, byOwner.get(field + ":" + ticket[field])];
    }),
  );
}

async function playersForPicks(q, picks, lock = false, cachedRows = null) {
  const players = [];
  for (const { ticket, flip, botSlots = [] } of picks) {
    const suffix = lock ? " FOR UPDATE" : "";
    const rows = cachedRows
      ? cachedRows.get(ticket.ticket_id)
      : ticket.party_id
        ? await q(
            `SELECT u.user_id, u.socket_id, u.name, u.char_class, u.char_levels, u.trophies, u.selected_profile_icon_id AS profile_icon_id, u.selected_skin_id_by_char, u.selected_title_id, u.selected_card_id, pm.party_id, pm.team
          FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ? ORDER BY u.user_id${suffix}`,
            [ticket.party_id],
          )
        : await q(
            `SELECT user_id, socket_id, name, char_class, char_levels, trophies, selected_profile_icon_id AS profile_icon_id, selected_skin_id_by_char, selected_title_id, selected_card_id FROM users WHERE user_id = ?${suffix}`,
            [ticket.user_id],
          );
    const counts = { team1: 0, team2: 0 };
    for (const row of rows) {
      let team = row.team || (Number(ticket.team1_count) === 1 ? "team1" : "team2");
      counts[team]++;
      if (flip) team = team === "team1" ? "team2" : "team1";
      players.push(
        decorateParticipant({
          ...row,
          party_id: ticket.party_id || null,
          team,
          char_class: row.char_class || DEFAULT_CHARACTER,
        }),
      );
    }
    const botCounts = {
      team1: botSlots.filter((slot) => slot.team === "team1").length,
      team2: botSlots.filter((slot) => slot.team === "team2").length,
    };
    if (
      rows.length + botSlots.length !== Number(ticket.size) ||
      counts.team1 + botCounts.team1 !== Number(ticket.team1_count) ||
      counts.team2 + botCounts.team2 !== Number(ticket.team2_count)
    )
      throw Object.assign(new Error("Queued party changed; queue again."), {
        code: "STALE_TICKET",
      });
  }
  if (new Set(players.map((p) => p.user_id)).size !== players.length)
    throw new Error("Duplicate match participant.");
  return players;
}

function createMatchAssemblyManager({ db, io, partyStatus, lastProgress, readyCheckCoordinator }) {
  async function assembleAndReady(modeId, modeVariantId, map, picks, options = {}) {
    if (!picks.length) return null;
    const ids = picks.map((p) => p.ticket.ticket_id).sort((a, b) => a - b);
    const ph = ids.map(() => "?").join(",");
    const result = await db.withTransaction(async (_conn, q) => {
      const tickets = await q(
        `SELECT * FROM match_tickets WHERE ticket_id IN (${ph}) ORDER BY ticket_id FOR UPDATE`,
        ids,
      );
      if (
        tickets.length !== ids.length ||
        tickets.some((t) => t.status !== "queued" || t.claimed_by)
      )
        return null;
      const current = picks.map((p) => ({
        ...p,
        ticket: tickets.find((t) => t.ticket_id === p.ticket.ticket_id),
      }));
      if (
        current.some(
          ({ ticket: t }) =>
            t.mode_id !== modeId ||
            t.mode_variant_id !== modeVariantId ||
            Number(t.map) !== Number(map),
        )
      )
        return null;
      const humans = await playersForPicks(q, current, true);
      if (!humans.length) return null;
      const teamSize = options.teamSize;
      for (const team of ["team1", "team2"])
        if (humans.filter((p) => p.team === team).length > teamSize)
          throw new Error("Team capacity changed.");
      const configuredSlots = current.flatMap(({ botSlots = [], flip }) =>
        botSlots.map((slot) => ({
          ...slot,
          team: flip ? (slot.team === "team1" ? "team2" : "team1") : slot.team,
        })),
      );
      const finalBots = buildMatchBots(humans, teamSize, configuredSlots, options);
      const players = [...humans, ...finalBots.map(decorateParticipant)];
      if (players.length !== teamSize * 2) return null;
      const mode = selectionToLegacyMode(modeId, modeVariantId);
      const { insertId: matchId } = await q(
        "INSERT INTO matches (mode,mode_id,mode_variant_id,map,status) VALUES (?,?,?,?, 'queued')",
        [mode, modeId, modeVariantId, map],
      );
      for (const p of humans)
        await q(
          "INSERT INTO match_participants (match_id,user_id,party_id,team,char_class) VALUES (?,?,?,?,?)",
          [matchId, p.user_id, p.party_id, p.team, p.char_class],
        );
      for (const b of finalBots)
        await q(
          `INSERT INTO match_bot_participants (participant_id,match_id,name,team,char_class,level,trophies,seed,difficulty,health_override) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            b.participantId,
            matchId,
            b.name,
            b.team,
            b.char_class,
            b.level,
            b.trophies,
            b.seed,
            JSON.stringify(b.difficulty),
            b.botHealthOverride,
          ],
        );
      await q(`DELETE FROM match_tickets WHERE ticket_id IN (${ph})`, ids);
      const partyIds = [...new Set(humans.map((p) => p.party_id).filter(Boolean))];
      for (const id of partyIds)
        await q("UPDATE parties SET status=? WHERE party_id=?", [partyStatus.READY_CHECK, id]);
      return {
        matchId,
        players: players.map(({ socket_id: _socketId, ...player }) => player),
        selection: { modeId, modeVariantId, mapId: Number(map) },
      };
    });
    if (!result) return null;
    ids.forEach((id) => lastProgress.delete(id));
    const humans = result.players.filter((p) => !p.isBot);
    // Install the ready state before notifying browsers, so an immediate ACK is retained.
    readyCheckCoordinator.startReadyCheck(
      result.matchId,
      humans.map((p) => p.user_id),
    );
    const rows = await db.runQuery(
      `SELECT user_id, socket_id FROM users WHERE user_id IN (${humans.map(() => "?").join(",")})`,
      humans.map((p) => p.user_id),
    );
    for (const row of rows) {
      const p = humans.find((p) => p.user_id === row.user_id);
      io.sockets.sockets.get(row.socket_id)?.emit(SOCKET_EVENTS.MATCH_FOUND, {
        ...result,
        modeId,
        modeVariantId,
        map,
        yourTeam: p.team,
      });
    }
    console.log(
      "[match:assembled]",
      JSON.stringify({
        matchId: result.matchId,
        humans: humans.length,
        bots: result.players.length - humans.length,
        waitMs: Date.now() - new Date(picks[0].ticket.created_at).getTime(),
      }),
    );
    return result;
  }
  return { assembleAndReady };
}
module.exports = {
  createMatchAssemblyManager,
  playersForPicks,
  readQueuedRosters,
  readActiveTicketMatches,
};
