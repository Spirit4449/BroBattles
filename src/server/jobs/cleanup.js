const { retireInterruptedMatch } = require("../services/match/matchLifecycleService");
const { updateOrDeleteParty } = require("../services/party/party");

function startCleanupJobs({ scheduler, db, io, matchResults = null, getGameRoom = () => null }) {
  // Inactive member cleanup (every 30 minutes)
  let _cleanupRunning = false;
  async function cleanupInactiveMembers() {
    if (_cleanupRunning) return;
    _cleanupRunning = true;
    try {
      await db.runQuery("DELETE FROM auth_sessions WHERE expires_at <= NOW(3) LIMIT 10000");
      const removed = await db.findAndRemoveInactiveMembers(30);
      const byParty = new Map();
      for (const row of removed) {
        const list = byParty.get(row.party_id) || [];
        list.push(row.name);
        byParty.set(row.party_id, list);
      }
      for (const [partyId, names] of byParty.entries()) {
        console.log(
          `[inactive] Removed ${
            names.length
          } member(s) from party ${partyId}: ${names.join(", ")}`,
        );
      }
      console.log(`[cleanup] Processing ${byParty.size} affected parties`);
      for (const [partyId] of byParty.entries()) {
        await updateOrDeleteParty(io, db, partyId);
      }
      try {
        const count = await db.deleteEmptyParties();
        if (count && count > 0) {
          console.log(`[inactive] Deleted ${count} empty parties`);
        }
      } catch (error) { console.warn("[cleanup] empty parties", error.message); }
      try {
        const expired = await db.deleteExpiredGuestsAndMemberships();
        if (expired && expired.count > 0) {
          console.log(
            `[inactive] Deleted ${
              expired.count
            } expired guest account(s): ${expired.names.join(", ")}`,
          );
          for (const partyId of expired.partyIds || []) {
            await updateOrDeleteParty(io, db, partyId);
          }
        }
      } catch (e) {
        console.warn("expired guest cleanup failed:", e?.message || e);
      }
    } catch (e) {
      console.warn("inactive cleanup failed:", e?.message || e);
    } finally {
      _cleanupRunning = false;
    }
  }

  scheduler.every("inactive members", 1000 * 60 * 30, cleanupInactiveMembers, { immediate: true });

  // Update status to offline (every 15 seconds)
  let _offlineMarkRunning = false;
  async function inactiveStatus() {
    if (_offlineMarkRunning) return;
    _offlineMarkRunning = true;
    try {
      const marked = await db.setOfflineIfLastSeenOlderThan(1);
      if (Array.isArray(marked) && marked.length > 0) {
        const partyIds = [
          ...new Set(marked.map((row) => Number(row.party_id)).filter(Boolean)),
        ];
        console.log(
          `[inactive] Marked ${marked.length} user(s) offline due to last_seen > 1 minute`,
        );
        for (const partyId of partyIds) {
          await updateOrDeleteParty(io, db, partyId);
        }
      }
    } catch (e) {
      console.warn("offline status mark failed:", e?.message || e);
    } finally {
      _offlineMarkRunning = false;
    }
  }
  scheduler.every("inactive statuses", 15000, inactiveStatus, { immediate: true });

  // Cleanup long-running matches (> 5 minutes) every 30 minutes and on start
  let _matchCleanupRunning = false;
  async function cleanupLongMatches() {
    if (_matchCleanupRunning) return;
    _matchCleanupRunning = true;
    try {
      // Find live matches older than 5 minutes
      const old = await db.runQuery(
        "SELECT match_id FROM matches WHERE status='live' AND created_at < (NOW() - INTERVAL 5 MINUTE)",
      );
      if (!old || !old.length) return;

      const ids = old.map((r) => r.match_id)
        .filter(id => !matchResults?.isPending(id) && !getGameRoom(id));
      if (!ids.length) return;
      for (const id of ids) await retireInterruptedMatch(db, id);
    } catch (e) {
      console.warn("match cleanup failed:", e?.message || e);
    } finally {
      _matchCleanupRunning = false;
    }
  }

  scheduler.every("long matches", 1000 * 60 * 30, cleanupLongMatches, { immediate: true });
  async function cleanupStaleBots() {
    // Live matches are handled by cleanupLongMatches, which checks for both an
    // active room and an unsettled result before touching participant records.
    try {
      await db.runQuery(`DELETE b FROM match_bot_participants b JOIN matches m ON m.match_id = b.match_id
        WHERE m.status IN ('completed','cancelled')
           OR (m.status = 'queued' AND m.created_at < NOW() - INTERVAL 10 MINUTE)`);
    } catch (error) { console.warn('[bots] stale cleanup failed:', error.message); }
  }
  scheduler.every("stale bots", 60000, cleanupStaleBots, { immediate: true });

  return { cleanupInactiveMembers, inactiveStatus, cleanupLongMatches };
}

module.exports = { startCleanupJobs };
