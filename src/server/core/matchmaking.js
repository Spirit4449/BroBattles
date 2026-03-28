// matchmaking.js
// Simple, robust matchmaking tuned for <=200 users with team-side preservation.
// Uses minimal states: queued, live, completed, cancelled (for matches/parties),
// tickets only use queued/cancelled. Map is enforced at queue time.

/**
 * @typedef {Object} MatchmakingDeps
 * @property {import('socket.io').Server} io
 * @property {object} db - sql helpers (runQuery, withTransaction, getUserById)
 * @property {Record<string, number>} teamSizeByMode - e.g., { '1':1, '2':2, '4':4 }
 */

/**
 * Create matchmaking controller.
 * @param {MatchmakingDeps} deps
 */
const { PARTY_STATUS } = require("../../server/helpers/partyRules");
const {
  teamSizeForSelection: resolveTeamSizeForSelection,
} = require("../../server/helpers/partyRules");
const {
  normalizeSelection,
  normalizeSelectionFromRow,
  getCapacityForSelection,
  selectionToLegacyMode,
} = require("../../server/helpers/gameSelectionCatalog");
const { getAllCharacters } = require("../../lib/characterStats.js");
const {
  createReadyCheckCoordinator,
} = require("./matchmaking/readyCheckCoordinator");
const {
  createMatchAssemblyManager,
} = require("./matchmaking/matchAssemblyManager");
const {
  computeUserMMRFromRow,
  computePartyMMR,
  getPartyTeamCounts,
} = require("./matchmaking/mmrUtils");
const {
  createQueueTicketManager,
} = require("./matchmaking/queueTicketManager");
const { createProgressEmitter } = require("./matchmaking/progressEmitter");
const { groupBy, pickCompositeGroup } = require("./matchmaking/teamBalancer");

function createMatchmaking({ io, db, teamSizeByMode, gameHub = null }) {
  let loop = null;
  const lastProgress = new Map(); // ticket_id -> lastFound
  const WORKER = `mm-${process.pid}`;

  // Fallback runner if db.withTransaction is unavailable
  async function runInTx(fn) {
    if (typeof db.withTransaction === "function") return db.withTransaction(fn);
    console.warn("[mm] withTransaction missing; running without transaction");
    const q = (sql, params = []) => db.runQuery(sql, params);
    return fn(null, q);
  }

  function teamSizeForSelection(selection) {
    const normalized = normalizeSelection(selection);
    return resolveTeamSizeForSelection({
      ...selection,
      ...normalized,
    });
  }

  async function getMatchDataForGameRoom(matchId) {
    const matchRows = await db.runQuery(
      "SELECT * FROM matches WHERE match_id = ? LIMIT 1",
      [matchId],
    );

    const participantRows = await db.runQuery(
      `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name,
              CASE WHEN u.name LIKE 'BOT %' THEN 1 ELSE 0 END AS is_bot
       FROM match_participants mp 
       JOIN users u ON u.user_id = mp.user_id 
       WHERE mp.match_id = ?`,
      [matchId],
    );

    if (!matchRows.length || !participantRows.length) {
      throw new Error(`No match data found for match ${matchId}`);
    }

    return {
      mode: matchRows[0].mode,
      modeId:
        matchRows[0].mode_id ||
        normalizeSelectionFromRow(matchRows[0]).modeId,
      modeVariantId:
        matchRows[0].mode_variant_id ||
        normalizeSelectionFromRow(matchRows[0]).modeVariantId,
      map: normalizeSelectionFromRow(matchRows[0]).mapId,
      players: participantRows.map((p) => ({
        user_id: p.user_id,
        name: p.name,
        party_id: p.party_id,
        team: p.team,
        char_class: p.char_class,
        isBot: !!Number(p.is_bot),
      })),
    };
  }

  let queueTicketManager = null;
  let progressEmitter = null;

  async function ensureLoop() {
    if (loop) return;
    const [{ c }] = await db.runQuery(
      "SELECT COUNT(*) AS c FROM match_tickets WHERE status='queued'",
    );
    if (Number(c) === 0) return; // nothing to do
    console.log(`[mm] loop:start queued=${c}`);
    loop = setInterval(tick, 1000);
  }

  async function maybeStopLoop() {
    // Only count unclaimed queued tickets; claimed tickets are in-progress and should not keep loop alive
    const [{ c }] = await db.runQuery(
      "SELECT COUNT(*) AS c FROM match_tickets WHERE status='queued' AND (claimed_by IS NULL OR claimed_by='')",
    );
    if (Number(c) === 0 && loop) {
      clearInterval(loop);
      loop = null;
      console.log("[mm] loop:stop");
    }
  }

  async function tick() {
    try {
      const queued = await db.runQuery(
        "SELECT * FROM match_tickets WHERE status='queued' AND (claimed_by IS NULL OR claimed_by='') ORDER BY created_at",
      );
      if (!queued.length) return maybeStopLoop();

      // bucket by (mode,map)
      const buckets = groupBy(
        queued,
        (t) =>
          `${t.mode_id || "duels"}:${t.mode_variant_id || "duels-1v1"}:${t.map}`,
      );
      for (const [key, items] of buckets.entries()) {
        const [modeId, modeVariantId, mapStr] = key.split(":");
        const S = teamSizeForSelection({
          modeId,
          modeVariantId,
          mapId: Number(mapStr),
        });
        console.log(
          `[mm] consider mode=${modeId}:${modeVariantId} map=${mapStr} S=${S} tickets=${items
            .map(
              (t) =>
                `#${t.ticket_id}[${t.team1_count}/${t.team2_count},mmr=${t.mmr}]`,
            )
            .join(",")}`,
        );
        // Emit progressive updates so parties/solos see incremental filling
        await progressEmitter.emitProgressForBucket(
          modeId,
          modeVariantId,
          Number(mapStr),
          items,
          S,
        );

        // try repeatedly while possible in this bucket
        // Avoid tight loop: cap attempts
        let attempts = 0;
        while (attempts++ < 8) {
          const group = pickCompositeGroup(items, S);
          if (!group) break;
          // Remove claimed from local items list to avoid duplicate attempts
          group.forEach((g) => {
            const idx = items.findIndex((x) => x.ticket_id === g.ticket_id);
            if (idx >= 0) items.splice(idx, 1);
          });
          await assembleAndReady(modeId, modeVariantId, Number(mapStr), group);
          // Update progress for remaining tickets in this bucket
          if (items.length) {
            await progressEmitter.emitProgressForBucket(
              modeId,
              modeVariantId,
              Number(mapStr),
              items,
              S,
            );
          }
        }
      }
      // Best-effort cleanup of any stale claimed tickets (claimed but never deleted due to crash/race)
      try {
        const stale = await db.runQuery(
          "DELETE FROM match_tickets WHERE status='queued' AND claimed_by IS NOT NULL AND claimed_by<>'' AND created_at < (NOW() - INTERVAL 60 SECOND)",
        );
        if (stale?.affectedRows) {
          console.log(
            `[mm] cleanup removed stale claimed tickets=${stale.affectedRows}`,
          );
        }
      } catch (_) {}
    } catch (e) {
      console.warn("[mm] tick error:", e?.message);
    }
  }

  const readyCheckCoordinator = createReadyCheckCoordinator({
    db,
    io,
    partyStatus: PARTY_STATUS,
    cancelMatch,
    getMatchDataForGameRoom,
    gameHub,
  });

  const matchAssemblyManager = createMatchAssemblyManager({
    db,
    io,
    worker: WORKER,
    runInTx,
    partyStatus: PARTY_STATUS,
    lastProgress,
    readyCheckCoordinator,
  });

  async function assembleAndReady(modeId, modeVariantId, map, picks) {
    return matchAssemblyManager.assembleAndReady(
      modeId,
      modeVariantId,
      map,
      picks,
    );
  }

  progressEmitter = createProgressEmitter({ db, io, lastProgress });
  queueTicketManager = createQueueTicketManager({
    db,
    partyStatus: PARTY_STATUS,
    teamSizeForSelection,
    computeUserMMRFromRow,
    computePartyMMR,
    getPartyTeamCounts,
    lastProgress,
    ensureLoop,
    maybeStopLoop,
  });

  async function queueJoin(args) {
    return queueTicketManager.queueJoin(args);
  }

  async function queueLeave(args) {
    return queueTicketManager.queueLeave(args);
  }

  async function handleReadyAck(userId, matchId) {
    readyCheckCoordinator.handleReadyAck(userId, matchId);
  }

  async function createBotFilledMatch({ userId, partyId = null }) {
    const ticketRows = await db.runQuery(
      `SELECT * FROM match_tickets
        WHERE status='queued'
          AND ((party_id IS NOT NULL AND party_id = ?) OR (party_id IS NULL AND user_id = ?))
        ORDER BY created_at
        LIMIT 1`,
      [partyId || 0, userId || 0],
    );
    const ticket = ticketRows[0];
    if (!ticket) {
      throw new Error("Queue ticket not found.");
    }

    const selection = normalizeSelection({
      modeId: ticket.mode_id,
      modeVariantId: ticket.mode_variant_id,
      legacyMode: ticket.mode,
      mapId: ticket.map,
    });
    const capacity = getCapacityForSelection(selection);
    const targetPerTeam = Math.max(1, Number(capacity?.perTeam) || 1);
    const availableChars = getAllCharacters();

    const players = [];
    if (ticket.party_id) {
      const members = await db.runQuery(
        "SELECT u.user_id, u.name, u.char_class, pm.party_id, pm.team FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ? ORDER BY pm.joined_at, pm.name",
        [ticket.party_id],
      );
      players.push(...members.map((member) => ({ ...member, isBot: false })));
    } else {
      const user = await db.getUserById(ticket.user_id);
      if (!user) throw new Error("Queued player not found.");
      players.push({
        user_id: user.user_id,
        name: user.name,
        party_id: null,
        team: ticket.team1_count === 1 ? "team1" : "team2",
        char_class: user.char_class || "ninja",
        isBot: false,
      });
    }

    const teamCounts = {
      team1: players.filter((player) => player.team === "team1").length,
      team2: players.filter((player) => player.team === "team2").length,
    };
    let botIndex = 0;
    for (const team of ["team1", "team2"]) {
      while (teamCounts[team] < targetPerTeam) {
        const botName = `BOT ${Date.now().toString().slice(-6)} ${botIndex + 1}`;
        const charClass =
          availableChars[
            (botIndex + teamCounts.team1 + teamCounts.team2) %
              availableChars.length
          ] || "ninja";
        const result = await db.runQuery(
          "INSERT INTO users (name, char_class, status, expires_at, char_levels) VALUES (?, ?, 'offline', NULL, ?)",
          [botName, charClass, "{}"],
        );
        players.push({
          user_id: result.insertId,
          name: botName,
          party_id: null,
          team,
          char_class: charClass,
          isBot: true,
        });
        teamCounts[team] += 1;
        botIndex += 1;
      }
    }

    const mode = selectionToLegacyMode(selection.modeId, selection.modeVariantId);
    const matchId = await runInTx(async (conn, q) => {
      const matchResult = await q(
        "INSERT INTO matches (mode,mode_id,mode_variant_id,map,status) VALUES (?,?,?,?, 'queued')",
        [mode, selection.modeId, selection.modeVariantId, selection.mapId],
      );
      const insertedMatchId = matchResult.insertId;
      if (players.length) {
        const placeholders = players.map(() => "(?,?,?,?,?)").join(",");
        const values = players.flatMap((player) => [
          insertedMatchId,
          player.user_id,
          player.party_id,
          player.team,
          player.char_class || null,
        ]);
        await q(
          `INSERT INTO match_participants (match_id,user_id,party_id,team,char_class) VALUES ${placeholders}`,
          values,
        );
      }
      await q("DELETE FROM match_tickets WHERE ticket_id = ?", [ticket.ticket_id]);
      if (ticket.party_id) {
        await q("UPDATE parties SET status=? WHERE party_id = ?", [
          PARTY_STATUS.READY_CHECK,
          ticket.party_id,
        ]);
      }
      return insertedMatchId;
    });

    const humans = players.filter((player) => !player.isBot);
    if (humans.length) {
      const placeholders = humans.map(() => "?").join(",");
      const socketRows = await db.runQuery(
        `SELECT user_id, socket_id FROM users WHERE user_id IN (${placeholders})`,
        humans.map((player) => player.user_id),
      );
      const socketByUser = new Map(
        socketRows.map((row) => [row.user_id, row.socket_id]),
      );
      for (const player of humans) {
        const sid = socketByUser.get(player.user_id);
        if (!sid) continue;
        const sock = io.sockets.sockets.get(sid);
        if (!sock) continue;
        sock.emit("match:found", {
          matchId,
          modeId: selection.modeId,
          modeVariantId: selection.modeVariantId,
          selection,
          map: selection.mapId,
          yourTeam: player.team,
          players: players.map((entry) => ({
            user_id: entry.user_id,
            name: entry.name,
            team: entry.team,
            char_class: entry.char_class,
            isBot: !!entry.isBot,
          })),
        });
      }
    }

    readyCheckCoordinator.startReadyCheck(
      matchId,
      humans.map((player) => player.user_id),
    );
    return { matchId, players, selection };
  }

  async function cancelMatch(matchId, reason) {
    await db.runQuery(
      "UPDATE matches SET status='cancelled' WHERE match_id=?",
      [matchId],
    );
    // Reset any involved parties to idle
    try {
      const rows = await db.runQuery(
        "SELECT DISTINCT party_id FROM match_participants WHERE match_id = ? AND party_id IS NOT NULL",
        [matchId],
      );
      const ids = rows.map((r) => r.party_id);
      if (ids.length) await db.setPartiesStatus(ids, PARTY_STATUS.IDLE);
    } catch (_) {}
    // Notify participants (best-effort)
    try {
      const rows = await db.runQuery(
        "SELECT mp.user_id, u.socket_id FROM match_participants mp JOIN users u ON u.user_id = mp.user_id WHERE mp.match_id=?",
        [matchId],
      );
      for (const r of rows) {
        const sock = r.socket_id ? io.sockets.sockets.get(r.socket_id) : null;
        if (sock) sock.emit("match:cancelled", { matchId, reason });
      }
    } catch (_) {}
    console.log(`[match:cancel] #${matchId} reason=${reason}`);
  }

  async function handleDisconnect(name) {
    return queueTicketManager.handleDisconnect(name);
  }

  async function invalidatePartyTicket(partyId) {
    return queueTicketManager.invalidatePartyTicket(partyId);
  }

  return {
    queueJoin,
    queueLeave,
    handleReadyAck,
    createBotFilledMatch,
    handleDisconnect,
    invalidatePartyTicket,
  };
}

module.exports = { createMatchmaking };
