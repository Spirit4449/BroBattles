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
const { PARTY_STATUS } = require("../../server/helpers/constants");
const {
  teamSizeForSelection: resolveTeamSizeForSelection,
} = require("../../server/helpers/constants");
const {
  normalizeSelection,
  normalizeSelectionFromRow,
} = require("../../server/helpers/gameSelectionCatalog");
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
      `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name 
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
    handleDisconnect,
    invalidatePartyTicket,
  };
}

module.exports = { createMatchmaking };
