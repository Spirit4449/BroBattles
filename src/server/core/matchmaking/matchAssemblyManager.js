const { selectionToLegacyMode } = require("../../helpers/gameSelectionCatalog");
const { decorateParticipant } = require("../../services/matchRosterService");
const { createBotParticipants } = require("../bots/identity");

async function playersForPicks(q, picks, lock = false) {
  const players = [];
  for (const { ticket, flip, botSlots = [] } of picks) {
    const suffix = lock ? " FOR UPDATE" : "";
    const rows = ticket.party_id
      ? await q(
          `SELECT u.user_id, u.name, u.char_class, u.char_levels, u.trophies, u.selected_profile_icon_id AS profile_icon_id, u.selected_skin_id_by_char, pm.party_id, pm.team
          FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ? ORDER BY u.user_id${suffix}`,
          [ticket.party_id],
        )
      : await q(
          `SELECT user_id, name, char_class, char_levels, trophies, selected_profile_icon_id AS profile_icon_id, selected_skin_id_by_char FROM users WHERE user_id = ?${suffix}`,
          [ticket.user_id],
        );
    const counts = { team1: 0, team2: 0 };
    for (const row of rows) {
      let team =
        row.team || (Number(ticket.team1_count) === 1 ? "team1" : "team2");
      counts[team]++;
      if (flip) team = team === "team1" ? "team2" : "team1";
      players.push(
        decorateParticipant({
          ...row,
          party_id: ticket.party_id || null,
          team,
          char_class: row.char_class || "ninja",
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
      throw new Error("Queued party changed; queue again.");
  }
  if (new Set(players.map((p) => p.user_id)).size !== players.length)
    throw new Error("Duplicate match participant.");
  return players;
}

function createMatchAssemblyManager({
  db,
  io,
  partyStatus,
  lastProgress,
  readyCheckCoordinator,
}) {
  async function assembleAndReady(
    modeId,
    modeVariantId,
    map,
    picks,
    options = {},
  ) {
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
      const bots = options.fillBots
        ? createBotParticipants(humans, teamSize, {
            seed: options.seed,
            healthOverride: options.healthOverride,
            realNames: options.realNames,
          })
        : [];
      const configuredSlots = current.flatMap(({ botSlots = [], flip }) =>
        botSlots.map((slot) => ({
          ...slot,
          team: flip ? (slot.team === "team1" ? "team2" : "team1") : slot.team,
        })),
      );
      const shouldCreateConfiguredBots = configuredSlots.length > 0;
      const selectedBots = shouldCreateConfiguredBots
        ? createBotParticipants(humans, teamSize, {
            seed: options.seed,
            healthOverride: options.healthOverride,
            realNames: options.realNames,
          })
        : bots;
      const finalBots = shouldCreateConfiguredBots ? selectedBots : bots;
      // Keep staged identities/names, with final level and difficulty recalculated from locked humans.
      if (options.bots)
        finalBots.forEach((bot, i) => {
          const staged = options.bots[i];
          if (staged && staged.team === bot.team)
            Object.assign(bot, {
              participantId: staged.participantId,
              name: staged.name,
              char_class: staged.char_class,
              seed: staged.seed,
              profile_icon_id: staged.profile_icon_id,
            });
        });
      if (shouldCreateConfiguredBots) {
        for (const team of ["team1", "team2"]) {
          const specs = configuredSlots
            .filter((slot) => slot.team === team)
            .sort((a, b) => a.index - b.index);
          const teamBots = finalBots.filter((bot) => bot.team === team);
          teamBots.forEach((bot, index) => {
            const character = specs[index]?.character;
            if (character && character !== "shuffle") {
              bot.char_class = character;
              bot.profile_icon_id = character;
            }
          });
        }
      }
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
      const partyIds = [
        ...new Set(humans.map((p) => p.party_id).filter(Boolean)),
      ];
      for (const id of partyIds)
        await q("UPDATE parties SET status=? WHERE party_id=?", [
          partyStatus.READY_CHECK,
          id,
        ]);
      return {
        matchId,
        players,
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
      io.sockets.sockets
        .get(row.socket_id)
        ?.emit("match:found", {
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
module.exports = { createMatchAssemblyManager, playersForPicks };
