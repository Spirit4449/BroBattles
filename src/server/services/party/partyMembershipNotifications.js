const { logIgnored } = require("../../lib/logIgnored");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { emitRoster } = require("../party/party");

const { normalizeSelectionFromRow } = require("../match/gameSelectionCatalog");
const { partyBotSlotsFor } = require("../party/partyBotSlots");

async function presentJoinedParty({ db, io, socketApi, username, userId, partyId, result }) {
  await socketApi.moveUserSocketToParty(username, partyId);
  if (result.joinedNow) {
    console.log(`[party] ${username} joined party ${partyId}`);
    try {
      await socketApi.cancelPartyQueue(partyId, userId);
    } catch (error) {
      logIgnored("party: cancel queue after join", error);
    }
  }
  const membersForEmit = await emitRoster(io, partyId, result.party, result.members, db, {
    ownerName: result.ownerName,
  });
  const selection = normalizeSelectionFromRow(result.party || {});

  // Authoritative settings sync: ensure joiners adopt party mode/map.
  io.to(`party:${partyId}`).emit(SOCKET_EVENTS.MODE_CHANGE, {
    partyId,
    selectedValue: selection.modeVariantId,
    mode: result.party?.mode,
    modeId: selection.modeId,
    modeVariantId: selection.modeVariantId,
    selection,
    username,
    members: membersForEmit,
  });
  io.to(`party:${partyId}`).emit(SOCKET_EVENTS.MAP_CHANGE, {
    partyId,
    selectedValue: selection.mapId,
    map: selection.mapId,
    modeId: selection.modeId,
    modeVariantId: selection.modeVariantId,
    selection,
    username,
  });

  return {
    party: result.party,
    selection,
    capacity: result.capacity,
    members: membersForEmit,
    ownerName: result.ownerName || null,
    isOwner: String(result.ownerName || "") === String(username || ""),
    allowMemberSelection: Number(result.party?.allow_member_selection ?? 1) === 1,
    hideEnemyBros: Number(result.party?.hide_enemy_bros ?? 0) === 1,
    isPublic: Number(result.party?.is_public || 0) === 1,
    publicName: String(result.party?.public_name || "").trim(),
    viewer: username,
    botSlots: partyBotSlotsFor(io || db).getPartyBotSlots(partyId),
  };
}

async function notifyKickedMember({ db, io, socketApi, targetName, partyId, actorName }) {
  try {
    const rows = await db.runQuery("SELECT socket_id FROM users WHERE name = ? LIMIT 1", [
      targetName,
    ]);
    const sid = rows?.[0]?.socket_id;
    const sock = sid ? io.sockets.sockets.get(sid) : null;
    if (sock) {
      sock.emit(SOCKET_EVENTS.PARTY_KICKED, {
        partyId,
        actorName,
      });
    }
  } catch (error) {
    logIgnored("party: notify kicked member", error);
  }
  try {
    await socketApi.moveUserSocketToLobby(targetName);
  } catch (error) {
    logIgnored("party: move kicked member to lobby", error);
  }
}

module.exports = { presentJoinedParty, notifyKickedMember };
