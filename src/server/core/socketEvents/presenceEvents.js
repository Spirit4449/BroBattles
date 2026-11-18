const { logIgnored } = require('../../lib/logIgnored');
const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');

function registerPresenceEvents(socket, { db, gameHub, playerActivity, partyQueueTransition, userSockets }) {
  async function heartbeat() {
    if (!socket.data.user) return;
    try { await playerActivity?.lobbyPing(socket); }
    catch (error) { logIgnored('lobby heartbeat', error); }
  }
  socket.on(SOCKET_EVENTS.LOBBY_HEARTBEAT, heartbeat);
  socket.on(SOCKET_EVENTS.HEARTBEAT, heartbeat);

  let releasing;
  async function release(announced) {
    const matchId = socket.data.gameMatchId;
    socket.data.gameMatchId = null;
    if (matchId) {
      try { await gameHub.handlePlayerLeave(socket, matchId); }
      catch (error) { logIgnored('socket leave match', error); }
    }
    const username = socket.data.user?.name;
    if (!username) return;
    const sockets = userSockets.get(username);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) userSockets.delete(username);
    playerActivity?.disconnect(socket);
    if (userSockets.get(username)?.size || playerActivity?.hasMatchPresence(username)) return;
    await partyQueueTransition.cancelForDisconnectedUser({
      username, socket: announced ? socket : null,
      reason: announced ? username + ' disconnected or went offline' : null, allowSoloEmit: announced,
    });
  }
  function releaseOnce(announced) {
    releasing ??= release(announced).catch(error => { releasing = null; throw error; });
    return releasing;
  }
  socket.on(SOCKET_EVENTS.CLIENT_BYE, () => releaseOnce(true));
  socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
    const id = socket.data.user?.user_id;
    try { if (id) await db.clearUserSocketIfMatch(id, socket.id); }
    catch (error) { logIgnored('socket disconnect persistence', error); }
    await releaseOnce(false);
  });
}
module.exports = { registerPresenceEvents };
