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

function createMatchmaking({ io, db, teamSizeByMode, gameHub = null }) {
  let loop = null;
  const readyStates = new Map(); // matchId -> { userIds:Set, ready:Set, timer, deadline }
  const lastProgress = new Map(); // ticket_id -> lastFound
  const WORKER = `mm-${process.pid}`;

  // Fallback runner if db.withTransaction is unavailable
  async function runInTx(fn) {
    if (typeof db.withTransaction === "function") return db.withTransaction(fn);
    console.warn("[mm] withTransaction missing; running without transaction");
    const q = (sql, params = []) => db.runQuery(sql, params);
    return fn(null, q);
  }

  function teamSizeForMode(mode) {
    const m = Number(mode);
    if (teamSizeByMode && teamSizeByMode[String(m)])
      return teamSizeByMode[String(m)];
    // fallback: use mode as team size if looks sane; else default to 1
    const fallback = Number.isFinite(m) && m > 0 && m <= 5 ? m : 1;
    console.log(
      `[mm] unknown mode=${mode}, using fallback team size of ${fallback}`,
    );
    return fallback;
  }

  function computeUserMMRFromRow(user) {
    try {
      const levels = user?.char_levels ? JSON.parse(user.char_levels) : {};
      const vals = Object.values(levels).map((n) => Number(n) || 0);

      // Level 0 means not unlocked; count only level >= 1 as unlocked
      const unlocked = vals.filter((n) => n >= 1).length;

      const avg = vals.length
        ? vals.reduce((a, b) => a + b, 0) / vals.length
        : 0;
      // trophies reserved for future: (user.trophies||0) * 10
      return Math.round(avg * 100 + unlocked * 20);
    } catch (_) {
      return 0;
    }
  }

  async function getMatchDataForGameRoom(matchId) {
    const matchRows = await db.runQuery(
      "SELECT mode, map FROM matches WHERE match_id = ? LIMIT 1",
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
      map: matchRows[0].map,
      players: participantRows.map((p) => ({
        user_id: p.user_id,
        name: p.name,
        party_id: p.party_id,
        team: p.team,
        char_class: p.char_class,
      })),
    };
  }

  async function computePartyMMR(partyId) {
    const rows = await db.runQuery(
      "SELECT u.user_id, u.char_levels FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ?",
      [partyId],
    );
    if (!rows.length) return 0;
    const mmrs = rows.map(computeUserMMRFromRow);
    return Math.round(mmrs.reduce((a, b) => a + b, 0) / mmrs.length);
  }

  async function getPartyTeamCounts(partyId) {
    const rows = await db.runQuery(
      "SELECT team, COUNT(*) AS c FROM party_members WHERE party_id = ? GROUP BY team",
      [partyId],
    );
    const t1 = rows.find((r) => r.team === "team1")?.c || 0;
    const t2 = rows.find((r) => r.team === "team2")?.c || 0;
    return { t1: Number(t1), t2: Number(t2) };
  }

  async function queueJoin({
    partyId = null,
    userId = null,
    mode,
    map,
    side = null,
  }) {
    const S = teamSizeForMode(mode);
    let counts = { t1: 0, t2: 0 };
    let size = 0;
    let mmr = 0;
    if (partyId) {
      counts = await getPartyTeamCounts(partyId);
      if (counts.t1 > S || counts.t2 > S) {
        throw new Error("team overflow for mode");
      }
      size = counts.t1 + counts.t2;
      const rows = await db.runQuery(
        "SELECT 1 FROM party_members WHERE party_id=? LIMIT 1",
        [partyId],
      );
      if (!rows.length) throw new Error("empty party");
      if (size <= 0) throw new Error("no players assigned to teams");
      mmr = await computePartyMMR(partyId);
    } else {
      // Solo ticket: side optional. Default to team1, but ticket can be flipped during matching.
      if (side !== "team1" && side !== "team2") {
        counts = { t1: 1, t2: 0 };
      } else {
        counts = side === "team1" ? { t1: 1, t2: 0 } : { t1: 0, t2: 1 };
      }
      size = 1;
      const u = await db.getUserById(userId);
      if (!u) throw new Error("user not found");
      mmr = computeUserMMRFromRow(u);
    }

    // Upsert to avoid duplicate key races from multiple clients
    const res = await db.runQuery(
      "INSERT INTO match_tickets (party_id,user_id,mode,map,size,mmr,team1_count,team2_count) VALUES (?,?,?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE mode=VALUES(mode), map=VALUES(map), size=VALUES(size), mmr=VALUES(mmr), team1_count=VALUES(team1_count), team2_count=VALUES(team2_count), status='queued', claimed_by=NULL",
      [
        partyId || null,
        userId || null,
        Number(mode),
        Number(map),
        Number(size),
        Number(mmr),
        counts.t1,
        counts.t2,
      ],
    );

    if (partyId)
      await db.runQuery("UPDATE parties SET status=? WHERE party_id=?", [
        PARTY_STATUS.QUEUED,
        partyId,
      ]);
    console.log(
      `[queue] join ${
        partyId ? "p=" + partyId : "u=" + userId
      } mode=${mode} map=${map} t1=${counts.t1} t2=${counts.t2} mmr=${mmr}`,
    );
    // Reset per-ticket progress cache so fresh queue sessions always get updates.
    lastProgress.clear();
    await ensureLoop();
    return res.insertId || 0;
  }

  async function queueLeave({ partyId = null, userId = null }) {
    const field = partyId ? "party_id" : "user_id";
    const id = partyId || userId;
    const r = await db.runQuery(
      `DELETE FROM match_tickets WHERE ${field} = ?`,
      [id],
    );
    if (partyId)
      await db.runQuery("UPDATE parties SET status=? WHERE party_id=?", [
        PARTY_STATUS.IDLE,
        partyId,
      ]);
    console.log(
      `[queue] leave ${partyId ? "p=" + partyId : "u=" + userId} removed=${
        r?.affectedRows || 0
      }`,
    );
    // Avoid stale suppression across leave/rejoin cycles.
    lastProgress.clear();
    await maybeStopLoop();
  }

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

  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) {
      const k = keyFn(x);
      const g = m.get(k);
      if (g) g.push(x);
      else m.set(k, [x]);
    }
    return m;
  }

  function ageSeconds(row) {
    return Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000);
  }

  async function tick() {
    try {
      const queued = await db.runQuery(
        "SELECT * FROM match_tickets WHERE status='queued' AND (claimed_by IS NULL OR claimed_by='') ORDER BY created_at",
      );
      if (!queued.length) return maybeStopLoop();

      // bucket by (mode,map)
      const buckets = groupBy(queued, (t) => `${t.mode}:${t.map}`);
      for (const [key, items] of buckets.entries()) {
        const [modeStr, mapStr] = key.split(":");
        const S = teamSizeForMode(Number(modeStr));
        console.log(
          `[mm] consider mode=${modeStr} map=${mapStr} S=${S} tickets=${items
            .map(
              (t) =>
                `#${t.ticket_id}[${t.team1_count}/${t.team2_count},mmr=${t.mmr}]`,
            )
            .join(",")}`,
        );
        // Emit progressive updates so parties/solos see incremental filling
        await emitProgressForBucket(Number(modeStr), Number(mapStr), items, S);

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
          await assembleAndReady(Number(modeStr), Number(mapStr), group);
          // Update progress for remaining tickets in this bucket
          if (items.length) {
            await emitProgressForBucket(
              Number(modeStr),
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

  async function emitProgressForBucket(mode, map, items, S) {
    if (!items || !items.length) return;
    // Show total players queued for this (mode,map), capped at S*2
    const totalPlayers = Math.min(
      items.reduce(
        (acc, t) => acc + Number(t.size || t.team1_count + t.team2_count || 0),
        0,
      ),
      S * 2,
    );
    const payload = { mode, map, found: totalPlayers, total: S * 2 };
    const signature = `${mode}:${map}:${payload.found}:${payload.total}`;

    // Prepare solo sockets lookup once per bucket
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

    for (const t of items) {
      const prev = lastProgress.get(t.ticket_id);
      if (prev === signature) continue; // avoid spam if unchanged
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

  function pickCompositeGroup(items, S) {
    if (!items.length) return null;
    // Sort by age asc for stability
    const sorted = items
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    // compute dynamic window based on oldest item
    const oldest = sorted[0];
    // Expand MMR window by 15 per second of age, capped at 400. Takes 30s to reach max.
    const window = Math.min(400, 100 + Math.floor(ageSeconds(oldest) * 15));

    // Small DFS to pack counts exactly into S,S while keeping MMR diff <= window
    const used = new Set();
    const best = dfs(0, { t1: 0, t2: 0, t1mmr: 0, t2mmr: 0, picks: [] });
    if (!best) {
      console.log(
        `[mm] no-combo S=${S} window=${window} pool=${sorted
          .map((t) => `${t.team1_count}/${t.team2_count}`)
          .join("|")}`,
      );
    }
    return best;

    function dfs(startIdx, acc) {
      if (acc.t1 === S && acc.t2 === S) {
        const avg1 = acc.t1mmr / S;
        const avg2 = acc.t2mmr / S;
        if (Math.abs(avg1 - avg2) <= window) return acc.picks.slice();
        return null;
      }
      for (let i = startIdx; i < sorted.length; i++) {
        const t = sorted[i];
        if (used.has(t.ticket_id)) continue;
        // try both orientations: as-is and flipped
        const variants = [
          { flip: false, t1c: t.team1_count, t2c: t.team2_count },
          { flip: true, t1c: t.team2_count, t2c: t.team1_count },
        ];
        for (const v of variants) {
          if (acc.t1 + v.t1c > S || acc.t2 + v.t2c > S) continue; // cap
          const next = {
            t1: acc.t1 + v.t1c,
            t2: acc.t2 + v.t2c,
            t1mmr: acc.t1mmr + t.mmr * v.t1c,
            t2mmr: acc.t2mmr + t.mmr * v.t2c,
            picks: acc.picks.concat({ ticket: t, flip: v.flip }),
          };
          const res = dfs(i + 1, next);
          if (res) return res;
        }
      }
      return null;
    }
  }

  async function assembleAndReady(mode, map, picks) {
    // Claim atomically
    const ids = picks.map((p) => p.ticket.ticket_id);
    const placeholders = ids.map(() => "?").join(",");
    const r = await db.runQuery(
      `UPDATE match_tickets SET claimed_by = ? WHERE ticket_id IN (${placeholders}) AND status='queued' AND (claimed_by IS NULL OR claimed_by='')`,
      [WORKER, ...ids],
    );
    if ((r?.affectedRows || 0) !== ids.length) {
      // lost race
      return;
    }

    // Build participants, preserving team sides
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
        let team = t.team1_count === 1 ? "team1" : "team2"; // solo ticket encodes side
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
    const matchId = await commitMatch({ mode, map, tickets, players });
    // Clear progress cache for claimed tickets
    ids.forEach((id) => lastProgress.delete(id));
    const size1 = players.filter((p) => p.team === "team1").length;
    const size2 = players.filter((p) => p.team === "team2").length;
    const mmrDelta = Math.abs(
      averageTicketMMR(tickets, "team1") - averageTicketMMR(tickets, "team2"),
    );
    console.log(
      `[match:new] #${matchId} mode=${mode} map=${map} ${size1}v${size2} mmrΔ=${mmrDelta} tickets=${tickets.length}`,
    );

    // Notify participants and start ready-check window
    await emitMatchFound(matchId, mode, map, players);
    startReadyCheck(
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

  async function emitMatchFound(matchId, mode, map, players) {
    console.log("[match:found] notifying players...");
    // Fetch socket ids and emit to each user directly
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
        mode,
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

  function startReadyCheck(matchId, userIds) {
    const deadline = Date.now() + 10_000;
    const state = {
      userIds: new Set(userIds),
      ready: new Set(),
      deadline,
      timer: null,
    };
    const check = async () => {
      if (Date.now() >= state.deadline) {
        clearInterval(state.timer);
        readyStates.delete(matchId);
        if (state.ready.size !== state.userIds.size) {
          await cancelMatch(
            matchId,
            "One or more players disconnected or timed out",
          );
          console.log(
            `[ready:timeout] #${matchId} ready=${state.ready.size}/${state.userIds.size}`,
          );
        }
      } else if (state.ready.size === state.userIds.size) {
        clearInterval(state.timer);
        readyStates.delete(matchId);
        await db.runQuery(
          "UPDATE matches SET status='live' WHERE match_id= ?",
          [matchId],
        );
        try {
          const rows = await db.runQuery(
            "SELECT DISTINCT party_id FROM match_participants WHERE match_id = ? AND party_id IS NOT NULL",
            [matchId],
          );
          const ids = rows.map((r) => r.party_id);
          if (ids.length) await db.setPartiesStatus(ids, PARTY_STATUS.LIVE);
        } catch (_) {}
        console.log(`[match:live] #${matchId}`);
        // Defensive: remove any leftover tickets referencing these users (should already be deleted)
        try {
          const placeholders = userIds.map(() => "?").join(",");
          if (userIds.length) {
            const r = await db.runQuery(
              `DELETE FROM match_tickets WHERE user_id IN (${placeholders}) OR party_id IN (SELECT DISTINCT party_id FROM match_participants WHERE match_id=?)`,
              [...userIds, matchId],
            );
            if (r?.affectedRows) {
              console.log(
                `[match:live] cleaned stray tickets=${r.affectedRows}`,
              );
            }
          }
        } catch (_) {}

        // Create game room when match goes live
        if (gameHub) {
          try {
            // Get match data for the game room
            const matchData = await getMatchDataForGameRoom(matchId);
            await gameHub.createGameRoom(matchId, matchData);

            // Notify players to join game room
            const userIds = Array.from(state.userIds);
            const placeholders = userIds.map(() => "?").join(",");
            const socketRows = await db.runQuery(
              `SELECT user_id, socket_id FROM users WHERE user_id IN (${placeholders})`,
              userIds,
            );

            for (const row of socketRows) {
              if (row.socket_id) {
                const socket = io.sockets.sockets.get(row.socket_id);
                if (socket) {
                  socket.emit("match:gameReady", { matchId });
                }
              }
            }
          } catch (error) {
            console.error(
              `[match:live] Failed to create game room for match ${matchId}:`,
              error,
            );
          }
        }
      }
    };
    state.timer = setInterval(check, 250);
    readyStates.set(matchId, state);
  }

  async function handleReadyAck(userId, matchId) {
    const st = readyStates.get(Number(matchId));
    if (!st) return;
    if (st.userIds.has(Number(userId))) st.ready.add(Number(userId));
  }

  async function commitMatch({ mode, map, tickets, players }) {
    const ids = tickets.map((t) => t.ticket_id);
    const partyIds = tickets.filter((t) => !!t.party_id).map((t) => t.party_id);
    return runInTx(async (conn, q) => {
      const { insertId: matchId } = await q(
        "INSERT INTO matches (mode,map,status) VALUES (?,?, 'queued')",
        [mode, map],
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
      if (partyIds.length)
        await q(
          `UPDATE parties SET status=? WHERE party_id IN (${partyIds
            .map(() => "?")
            .join(",")})`,
          [PARTY_STATUS.READY_CHECK, ...partyIds],
        );
      return matchId;
    });
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
    // remove ticket for the user's party if any
    const rows = await db.runQuery(
      "SELECT party_id FROM party_members WHERE name=? LIMIT 1",
      [name],
    );
    const partyId = rows[0]?.party_id || null;
    if (partyId) {
      await db.runQuery("DELETE FROM match_tickets WHERE party_id=?", [
        partyId,
      ]);
      console.log(`[queue] remove p=${partyId} reason=disconnect name=${name}`);
      await maybeStopLoop();
    }

    // Also remove solo ticket for this user if present
    try {
      const u = await db.runQuery(
        "SELECT user_id FROM users WHERE name=? LIMIT 1",
        [name],
      );
      const userId = u[0]?.user_id || null;
      if (userId) {
        const r = await db.runQuery(
          "DELETE FROM match_tickets WHERE user_id=?",
          [userId],
        );
        if (r?.affectedRows) {
          console.log(
            `[queue] remove u=${userId} reason=disconnect name=${name}`,
          );
          await maybeStopLoop();
        }
      }
    } catch (_) {}
  }

  async function invalidatePartyTicket(partyId) {
    await db.runQuery("DELETE FROM match_tickets WHERE party_id=?", [partyId]);
    console.log(`[queue] invalidate p=${partyId} reason=team-change`);
    await maybeStopLoop();
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
