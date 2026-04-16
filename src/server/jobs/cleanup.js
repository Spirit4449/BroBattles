const { updateOrDeleteParty } = require("../helpers/party");

function startCleanupJobs({ db, io }) {
  // Inactive member cleanup (every 30 minutes)
  let _cleanupRunning = false;
  async function cleanupInactiveMembers() {
    if (_cleanupRunning) return;
    _cleanupRunning = true;
    try {
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
      } catch {}
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

  setInterval(cleanupInactiveMembers, 1000 * 60 * 30);
  cleanupInactiveMembers();

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
  setInterval(inactiveStatus, 1000 * 15);
  inactiveStatus();

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

      const ids = old.map((r) => r.match_id);
      const ph = ids.map(() => "?").join(",");

      // Mark matches completed
      await db.runQuery(
        `UPDATE matches SET status='completed' WHERE match_id IN (${ph})`,
        ids,
      );

      // Reset any involved parties back to idle
      let partyIds = [];
      try {
        const parties = await db.runQuery(
          `SELECT DISTINCT party_id FROM match_participants WHERE match_id IN (${ph}) AND party_id IS NOT NULL`,
          ids,
        );
        partyIds = parties.map((p) => p.party_id).filter(Boolean);
        if (partyIds.length) {
          const ph2 = partyIds.map(() => "?").join(",");
          await db.runQuery(
            `UPDATE parties SET status='idle' WHERE party_id IN (${ph2})`,
            partyIds,
          );
        }
      } catch (_) {}

      // Remove participants for these matches to reflect completion
      await db.runQuery(
        `DELETE FROM match_participants WHERE match_id IN (${ph})`,
        ids,
      );

      console.log(
        `[match:cleanup] Completed ${ids.length} match(es) >5m; reset ${partyIds.length} party(ies)`,
      );
    } catch (e) {
      console.warn("match cleanup failed:", e?.message || e);
    } finally {
      _matchCleanupRunning = false;
    }
  }

  setInterval(cleanupLongMatches, 1000 * 60 * 30);
  cleanupLongMatches();

  return { cleanupInactiveMembers, inactiveStatus, cleanupLongMatches };
}

module.exports = { startCleanupJobs };
