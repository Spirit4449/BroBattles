// Presence is a lease backed by an authenticated game socket or a lobby ping.
// Match membership survives a lost lease so the lobby can offer reconnection.
const ACTIVITY_TTL_MS = 10_000;
const END_SCREEN_MS = 10_000;
const IDLE_RETENTION_MS = 60_000;
const REFRESH_MS = 10_000;
function createPlayerActivityService({ db, io, setPresence, getGameRoom = () => null, now = Date.now, schedule = true }) {
  const users = new Map();
  const matches = new Map();
  function setMatch(s, id) {
    const previous = matches.get(s.matchId);
    previous?.delete(s);
    if (previous?.size === 0) matches.delete(s.matchId);
    s.matchId = id;
    if (id !== null) {
      if (!matches.has(id)) matches.set(id, new Set());
      matches.get(id).add(s);
    }
  }
  function state(name) {
    if (!users.has(name)) users.set(name, { name, lobby: new Map(), game: null, matchId: null, endedAt: null, revision: 0, closedMatchId: null, status: null, writes: Promise.resolve(), publishing: null, dirty: false, lastSeen: now(), lastLookupAt: -Infinity, lobbyPending: null, expiryTimer: null });
    const s = users.get(name);
    s.lastSeen = now();
    return s;
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
    const hasActiveHuman = [...(matches.get(s.matchId) || [])].some(member =>
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
    s.dirty = true;
    if (s.publishing) return s.publishing;
    s.publishing = (async () => {
      while (s.dirty) {
        s.dirty = false;
        const status = derive(s);
        if (status !== s.status) {
          const partyId = await db.getPartyIdByName(s.name);
          if (partyId && status !== 'offline') await db.updateLastSeen(partyId, s.name);
          await setPresence(s.name, status, partyId, { strict: true });
          s.status = status;
        }
        emitSelf(s);
      }
    })().finally(() => { s.publishing = null; });
    s.publishing.catch(error => console.warn('[presence] update failed:', error?.message));
    s.writes = s.publishing;
    return s.writes;
  }

  function registerMatch(matchId, players) {
    for (const p of players || []) {
      if (p.isBot || !p.name) continue;
      const s = state(p.name);
      s.revision++;
      setMatch(s, Number(matchId));
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
    s.lastSeen = now();
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
    if (s.lobbyPending) return s.lobbyPending;
    if (now() - s.lastLookupAt < REFRESH_MS) return publish(s);
    s.lastLookupAt = now();
    s.lobbyPending = (async () => {
      const revision = s.revision;
      const rows = await db.runQuery(
        `SELECT m.match_id FROM matches m JOIN match_participants mp ON mp.match_id = m.match_id
         WHERE mp.user_id = ? AND m.status = 'live' ORDER BY m.match_id DESC LIMIT 1`,
        [socket.data.user.user_id]);
      if (s.revision === revision) {
        setMatch(s, rows[0] && Number(rows[0].match_id) !== s.closedMatchId ? Number(rows[0].match_id) : null);
        if (!s.matchId) s.game = null;
      }
      const pid = await db.getPartyIdByName(s.name);
      if (pid) await db.updateLastSeen(pid, s.name);
      await publish(s);
    })().catch(error => { s.lastLookupAt = -Infinity; throw error; })
      .finally(() => { s.lobbyPending = null; });
    return s.lobbyPending;
  }

  function disconnect(socket) {
    const s = users.get(socket.data.user?.name);
    if (!s) return;
    s.lobby.delete(socket.id);
    if (s.game?.socket === socket) s.game = null;
    // Notify every lobby watching this match when its last human leaves.
    for (const member of matches.get(s.matchId) || []) emitSelf(member);
    void publish(s);
  }
  function finishMatch(matchId, { endScreen = true } = {}) {
    for (const s of [...(matches.get(Number(matchId)) || [])]) {
      s.revision++;
      s.closedMatchId = s.matchId;
      setMatch(s, null);
      s.game = null;
      s.endedAt = endScreen ? now() : null;
      // Recompute at the deadline; a later lobby ping/new match takes priority.
      clearTimeout(s.expiryTimer);
      if (schedule && endScreen) {
        s.expiryTimer = setTimeout(() => { void publish(s); }, END_SCREEN_MS);
        s.expiryTimer.unref?.();
      }
      void publish(s);
    }
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const activeNames = [];
      for (const s of users.values()) {
        for (const [id, at] of s.lobby) if (now() - at >= ACTIVITY_TTL_MS) s.lobby.delete(id);
        probe(s);
        if (derive(s) === 'In Battle') activeNames.push(s.name);
      }
      // One indexed update replaces two queries per active player.
      if (activeNames.length && db.refreshPartyPresence) await db.refreshPartyPresence(activeNames);
      const states = [...users.values()];
      for (let i = 0; i < states.length; i += 8) {
        const results = await Promise.allSettled(states.slice(i, i + 8).map(async s => {
          await publish(s);
          if (derive(s) === 'offline' && s.lobby.size === 0 && !s.game?.socket.connected &&
              !s.lobbyPending && now() - s.lastSeen >= IDLE_RETENTION_MS) {
            setMatch(s, null);
            clearTimeout(s.expiryTimer);
            users.delete(s.name);
          }
        }));
        for (const result of results) if (result.status === 'rejected') console.warn('[presence] refresh failed:', result.reason?.message);
      }

    } finally { ticking = false; }
  }
  const timer = schedule ? setInterval(() => { void tick().catch(error => console.warn('[presence] tick failed:', error?.message)); }, 2000) : null;
  timer?.unref?.();
  return { hasMatchPresence: name => { const s = users.get(name); return !!s && (s.matchId !== null || s.endedAt !== null); }, registerMatch, joinGame, gameActivity, lobbyPing, disconnect, finishMatch, tick, getStats: () => ({ users: users.size, matches: matches.size }), dispose: () => { clearInterval(timer); for (const s of users.values()) clearTimeout(s.expiryTimer); users.clear(); matches.clear(); } };
}
module.exports = { createPlayerActivityService, ACTIVITY_TTL_MS, END_SCREEN_MS };
