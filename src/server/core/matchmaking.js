const { PARTY_STATUS, teamSizeForSelection } = require('../helpers/partyRules');
const { normalizeSelection } = require('../helpers/gameSelectionCatalog');
const { loadMatchData, deleteMatchBots } = require('../services/matchRosterService');
const { createReadyCheckCoordinator } = require('./matchmaking/readyCheckCoordinator');
const { createMatchAssemblyManager, playersForPicks } = require('./matchmaking/matchAssemblyManager');
const { createQueueTicketManager } = require('./matchmaking/queueTicketManager');
const { createProgressEmitter } = require('./matchmaking/progressEmitter');
const { computeUserMMRFromRow, computePartyMMR, getPartyTeamCounts } = require('./matchmaking/mmrUtils');
const { groupBy, pickCompositeGroup, pickGroup } = require('./matchmaking/teamBalancer');
const { createBotParticipants } = require('./bots/identity');
const { getBotConfig, stagedSeatCount } = require('./bots/config');

function createMatchmaking({ io, db, gameHub = null, runtimeConfig = null }) {
  let loop = null, ticking = false, activity = 0;
  const lastProgress = new Map(), drafts = new Map();
  const readyCheckCoordinator = createReadyCheckCoordinator({ db, io, partyStatus: PARTY_STATUS,
    cancelMatch, getMatchDataForGameRoom: (id) => loadMatchData(db, id), gameHub });
  const assembly = createMatchAssemblyManager({ db, io, partyStatus: PARTY_STATUS, lastProgress, readyCheckCoordinator });
  const progress = createProgressEmitter({ db, io, lastProgress });
  const queueTicketManager = createQueueTicketManager({ db, partyStatus: PARTY_STATUS,
    teamSizeForSelection, computeUserMMRFromRow, computePartyMMR, getPartyTeamCounts,
    lastProgress, ensureLoop, maybeStopLoop });

  async function ensureLoop() {
    activity++;
    if (!loop) { loop = setInterval(tick, 1000); loop.unref?.(); }
  }
  async function maybeStopLoop() {
    const observedActivity = activity;
    const [{ c }] = await db.runQuery("SELECT COUNT(*) AS c FROM match_tickets WHERE status='queued'");
    if (!Number(c) && loop && activity === observedActivity) { clearInterval(loop); loop = null; drafts.clear(); }
  }
  function removePicks(items, picks) {
    const ids = new Set(picks.map((p) => p.ticket.ticket_id));
    for (let i = items.length - 1; i >= 0; i--) if (ids.has(items[i].ticket_id)) items.splice(i, 1);
  }
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const queued = await db.runQuery("SELECT * FROM match_tickets WHERE status='queued' AND (claimed_by IS NULL OR claimed_by='') ORDER BY created_at");
      const activeIds = new Set(queued.map((t) => t.ticket_id));
      for (const id of drafts.keys()) if (!activeIds.has(id)) drafts.delete(id);
      if (!queued.length) return await maybeStopLoop();
      for (const items of groupBy(queued, (t) => `${t.mode_id}:${t.mode_variant_id}:${t.map}`).values()) {
        const selection = normalizeSelection({ modeId: items[0].mode_id, modeVariantId: items[0].mode_variant_id, mapId: items[0].map });
        const { modeId, modeVariantId, mapId } = selection;
        const teamSize = teamSizeForSelection(selection);
        let picks;
        while ((picks = pickCompositeGroup(items, teamSize))) {
          await assembly.assembleAndReady(modeId, modeVariantId, mapId, picks, { teamSize });
          removePicks(items, picks);
        }
        const config = getBotConfig(runtimeConfig);
        const claimedPreview = new Set();
        if (modeId === 'duels' && config.enabled) for (const anchor of [...items]) {
          if (claimedPreview.has(anchor.ticket_id) || !stagedSeatCount(anchor)) continue;
          const cohort = ((Number(anchor.party_id || anchor.user_id) * 2654435761) >>> 0) % 100;
          if (cohort >= config.rolloutPercent) continue;
          picks = pickGroup(items.filter((t) => !claimedPreview.has(t.ticket_id)), teamSize, { partial: true, anchorId: anchor.ticket_id });
          if (!picks) continue;
          const humans = await playersForPicks(db.runQuery.bind(db), picks);
          const signature = humans.map((p) => `${p.user_id}:${p.team}:${p.char_class}:${p.level}:${p.trophies}`).join('|');
          let draft = drafts.get(anchor.ticket_id);
          if (!draft || draft.signature !== signature) {
            const seed = Number(anchor.ticket_id) >>> 0;
            draft = { signature, seed, bots: createBotParticipants(humans, teamSize, { seed }) };
            drafts.set(anchor.ticket_id, draft);
          }
          const count = stagedSeatCount(anchor);
          const staged = draft.bots.slice(0, count);
          if (staged.length === draft.bots.length) {
            await assembly.assembleAndReady(modeId, modeVariantId, mapId, picks, { teamSize, fillBots: true, ...draft });
            drafts.delete(anchor.ticket_id); removePicks(items, picks);
          } else {
            await progress.emitProgressForBucket(modeId, modeVariantId, mapId, picks.map((p) => p.ticket), teamSize, { roster: [...humans, ...staged] });
            picks.forEach((p) => claimedPreview.add(p.ticket.ticket_id));
          }
        }
        await progress.emitProgressForBucket(modeId, modeVariantId, mapId, items.filter((t) => !claimedPreview.has(t.ticket_id)), teamSize);
      }
    } catch (error) { console.warn('[mm] tick failed:', error.message); }
    finally { ticking = false; }
  }
  async function queueJoin(args) { return queueTicketManager.queueJoin(args); }
  async function queueLeave(args) { const result = await queueTicketManager.queueLeave(args); drafts.clear(); return result; }
  async function handleReadyAck(userId, matchId) { readyCheckCoordinator.handleReadyAck(userId, matchId); }
  async function createBotFilledMatch({ userId, partyId = null, botHealthOverride = null }) {
    const tickets = await db.runQuery("SELECT * FROM match_tickets WHERE status='queued' AND (claimed_by IS NULL OR claimed_by='') ORDER BY created_at");
    const anchor = tickets.find((t) => partyId ? Number(t.party_id) === Number(partyId) : !t.party_id && Number(t.user_id) === Number(userId));
    if (!anchor) throw new Error('Queue ticket not found.');
    const selection = normalizeSelection({ modeId: anchor.mode_id, modeVariantId: anchor.mode_variant_id, mapId: anchor.map });
    if (selection.modeId !== 'duels') throw new Error('Playing bots currently support Duels only.');
    const teamSize = teamSizeForSelection(selection);
    const items = tickets.filter((t) => t.mode_id === anchor.mode_id && t.mode_variant_id === anchor.mode_variant_id && t.map === anchor.map);
    const picks = pickGroup(items, teamSize, { partial: true, anchorId: anchor.ticket_id });
    const result = await assembly.assembleAndReady(selection.modeId, selection.modeVariantId, selection.mapId, picks, { teamSize, fillBots: true, healthOverride: Number(botHealthOverride) === 9999999 ? 9999999 : null });
    if (!result) throw new Error('Queue changed; please try again.');
    return result;
  }
  async function cancelMatch(matchId, reason) {
    await db.runQuery(
      "UPDATE matches SET status='cancelled' WHERE match_id=?",
      [matchId],
    );
    try { await deleteMatchBots(db, matchId); } catch (error) { console.warn("[bots] cancellation cleanup deferred:", error.message); }
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

  void ensureLoop(); // Resume persisted queues after a server restart.

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
