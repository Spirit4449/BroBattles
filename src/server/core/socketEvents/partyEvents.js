const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');
const { defineSocketHandler, respondWithError } = require('./handler');
const { setReady } = require('../../services/party/partyReadyService');
const { setCharacterMenu, moveMember, configureBot } = require('../../services/party/partySlotSelectionService');
const { applySelectionChange } = require('../../services/party/partySelectionChange');
const { selectCharacter } = require('../../services/cosmetics/characterSelectionService');
const { netTrace } = require('../gameRoom/netTraceRecorder');
const { logIgnored } = require('../../lib/logIgnored');

function registerPartyEvents(socket, services) {
  const { db, partyPresence } = services;
  socket.on(SOCKET_EVENTS.CHAR_MENU_STATUS, data => setCharacterMenu(services, socket.data, data));
  socket.on(SOCKET_EVENTS.READY_STATUS, defineSocketHandler(async (data, ack) => {
    try {
      const result = await setReady(services, socket.data, data);
      ack?.(result);
    } catch (error) {
      ack?.({ ok: false, error: error.message || 'Could not update readiness.', code: error.code, maintenanceUntil: error.maintenanceUntil });
      const id = socket.data.user?.name && await db.getPartyIdByName(socket.data.user.name);
      if (id) await partyPresence.emitPartyRosterById(id).catch(e => logIgnored('ready roster recovery', e));
      console.warn('ready:status error:', error.message);
    }
  }));
  for (const [event, action, fallback] of [
    [SOCKET_EVENTS.PARTY_SLOT_MOVE, moveMember, 'Could not move player.'],
    [SOCKET_EVENTS.PARTY_BOT_SLOT_UPDATE, configureBot, 'Could not update bot slot.'],
  ]) {
    socket.on(event, defineSocketHandler(async (data, ack) => {
      const result = await action(services, socket.data.user?.name, data);
      ack?.(result);
    }, { onError: respondWithError(fallback) }));
  }
  for (const [event, kind] of [[SOCKET_EVENTS.MODE_CHANGE, 'mode'], [SOCKET_EVENTS.MAP_CHANGE, 'map']]) {
    socket.on(event, async data => {
      try { await applySelectionChange(services, socket.data.user?.name, data, kind); }
      catch (error) { socket.emit(SOCKET_EVENTS.PARTY_SELECTION_DENIED, { partyId: data.partyId, error: error.message || 'Could not change selection.' }); }
    });
  }
  socket.on(SOCKET_EVENTS.CHAR_CHANGE, defineSocketHandler(async (data, ack) => {
    const { selectedMap, ...result } = await selectCharacter(db, socket.data.user, data, name => netTrace.isTracedUser(name));
    if (result.ok) {
      socket.data.user = { ...socket.data.user, char_class: result.character, selected_skin_id_by_char: selectedMap };
      const partyId = await db.getPartyIdByName(socket.data.user.name);
      if (partyId) await partyPresence.emitPartyRosterById(partyId);
    }
    ack?.(result);
  }, { onError: (error, ack) => {
    ack?.({ ok: false, error: 'selection_failed' });
    console.warn('char-change error:', error.message);
  } }));
}
module.exports = { registerPartyEvents };
