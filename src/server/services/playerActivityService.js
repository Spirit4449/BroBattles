// Presence is a lease backed by an authenticated game socket or a lobby ping.
// Match membership survives a lost lease so the lobby can offer reconnection.
const ACTIVITY_TTL_MS = 10_000;
const END_SCREEN_MS = 10_000;
function createPlayerActivityService({ db, io, setPresence, getGameRoom = () => null, now = Date.now, schedule = true }) {
  const users = new Map();
  function state(name) {
    if (!users.has(name)) users.set(name, { name, lobby: new Map(), game: null, matchId: null, endedAt: null, revision: 0, closedMatchId: null, status: null, writes: Promise.resolve() });
    return users.get(name);
  }
  function derive(s) {
    const time = now();
    const lobbyOnline = [...s.lobby.values()].some(at => time - at < ACTIVITY_TTL_MS);
    if (s.endedAt !== null) return time - s.endedAt < END_SCREEN_MS ? 'End Screen' : 'offline';
    if (s.game && s.game.at !== null && time - s.game.at < ACTIVITY_TTL_MS) return 'In Battle';
    return lobbyOnline ? 'online' : 'offline';
  }
  function returnMatchId(s) {
    if (!s.matchId || s.endedAt !== null) return null;
    const room = getGameRoom(s.matchId);
    if (!room || room._disposed || room.status === 'finished' || !room.hasConnectedHumanPlayers()) return null;
    // Bots and stale socket connections do not make a match worth returning to.
    const hasActiveHuman = [...users.values()].some(member =>
      member.matchId === s.matchId && member.game?.socket.connected &&
      member.game.at !== null && now() - member.game.at < ACTIVITY_TTL_MS,
    );
    return hasActiveHuman ? s.matchId : null;
  }
  function emitSelf(s) {
    const payload = { status: derive(s), matchId: returnMatchId(s) };
    for (const sid of s.lobby.keys()) io.to(sid).emit('presence:self', payload);
  }
  function publish(s) {
    // Button availability must not wait on a slow/failed presence database write.
    emitSelf(s);
    // Compute inside the per-user write chain: delayed DB writes cannot restore
    // an old battle/end-screen state after a lobby return or new match.
    s.writes = s.writes.catch(() => {}).then(async () => {
      const status = derive(s);
      if (status !== s.status) {
        const partyId = await db.getPartyIdByName(s.name);
        if (partyId && status !== 'offline') await db.updateLastSeen(partyId, s.name);
        await setPresence(s.name, status, partyId, { strict: true });
        s.status = status;
      }
      emitSelf(s);
    });
    s.writes.catch(error => console.warn('[presence] update failed:', error?.message));
    return s.writes;
  }
  function registerMatch(matchId, players) {
    for (const p of players || []) {
      if (p.isBot || !p.name) continue;
      const s = state(p.name);
      s.revision++;
      s.matchId = Number(matchId);
      s.endedAt = null;
      s.game = null;
      void publish(s);
    }
  }
  function joinGame(socket, matchId) {
    const s = state(socket.data.user.name);
    if (s.matchId !== Number(matchId)) return;
    s.lobby.delete(socket.id);
    s.game = { socket, at: null, probing: false };
    probe(s);
  }
  function gameActivity(socket, matchId) {
    const s = users.get(socket.data.user?.name);
    if (!s || s.matchId !== Number(matchId) || s.game?.socket !== socket || s.endedAt !== null) return;
    s.game.at = now();
    if (s.status !== 'In Battle') void publish(s);
  }
  function probe(s) {
    const game = s.game;
    if (!game || game.probing || !game.socket.connected || !s.matchId) return;
    game.probing = true;
    const matchId = s.matchId;
    game.socket.timeout(4000).emit('game:presence-probe', { matchId }, (error, reply) => {
      game.probing = false;
      if (!error && reply?.matchId === matchId && s.game === game) gameActivity(game.socket, matchId);
    });
  }
  async function lobbyPing(socket) {
    const s = state(socket.data.user.name);
    // A game socket cannot refresh its own end-screen lease as a lobby.
    if (socket.data.gameMatchId) return;
    s.lobby.set(socket.id, now());
    s.endedAt = null;
    // Recover the return target after server restart; never infer a live match
    // from a client's claimed match ID or its displayed status.
    const revision = s.revision;
    const rows = await db.runQuery(
      `SELECT m.match_id FROM matches m JOIN match_participants mp ON mp.match_id = m.match_id
       WHERE mp.user_id = ? AND m.status = 'live' ORDER BY m.match_id DESC LIMIT 1`,
      [socket.data.user.user_id],
    );
    if (s.revision === revision) {
      s.matchId = rows[0] && Number(rows[0].match_id) !== s.closedMatchId ? Number(rows[0].match_id) : null;
      if (!s.matchId) s.game = null;
    }
    const pid = await db.getPartyIdByName(s.name);
    if (pid) await db.updateLastSeen(pid, s.name);
    await publish(s);
  }
  function disconnect(socket) {
    const s = users.get(socket.data.user?.name);
    if (!s) return;
    s.lobby.delete(socket.id);
    if (s.game?.socket === socket) s.game = null;
    // Notify every lobby watching this match when its last human leaves.
    for (const member of users.values()) {
      if (member.matchId === s.matchId) emitSelf(member);
    }
    void publish(s);
  }
  function finishMatch(matchId, { endScreen = true } = {}) {
    for (const s of users.values()) {
      if (s.matchId !== Number(matchId)) continue;
      s.revision++;
      s.closedMatchId = s.matchId;
      s.matchId = null;
      s.game = null;
      s.endedAt = endScreen ? now() : null;
      // Recompute at the deadline; a later lobby ping/new match takes priority.
      if (schedule && endScreen) setTimeout(() => { void publish(s); }, END_SCREEN_MS).unref?.();
      void publish(s);
    }
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const results = await Promise.allSettled([...users.values()].map(async (s) => {
        probe(s);
        // Keep party roster freshness aligned with verified game activity.
        if (derive(s) === 'In Battle') {
          const pid = await db.getPartyIdByName(s.name);
          if (pid) await db.updateLastSeen(pid, s.name);
        }
        await publish(s);
      }));
      for (const result of results) {
        if (result.status === 'rejected') console.warn('[presence] refresh failed:', result.reason?.message);
      }
    } finally { ticking = false; }
  }
  const timer = schedule ? setInterval(() => { void tick().catch(error => console.warn('[presence] tick failed:', error?.message)); }, 2000) : null;
  timer?.unref?.();
  return { hasMatchPresence: name => { const s = users.get(name); return !!s && (s.matchId !== null || s.endedAt !== null); }, registerMatch, joinGame, gameActivity, lobbyPing, disconnect, finishMatch, tick, dispose: () => clearInterval(timer) };
}
module.exports = { createPlayerActivityService, ACTIVITY_TTL_MS, END_SCREEN_MS };
