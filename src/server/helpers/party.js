const { capacityFromMode } = require("./utils");

async function selectPartyById(db, partyId) {
  const rows = await db.runQuery(
    "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
    [partyId],
  );
  return rows?.[0] || null;
}

async function emitRoster(io, partyId, party, members, db = null) {
  let selectedByName = {};
  try {
    if (db && typeof db.fetchSelectedCardsByNames === "function") {
      selectedByName = await db.fetchSelectedCardsByNames(
        (Array.isArray(members) ? members : []).map((m) => m?.name),
      );
    }
  } catch (_) {
    selectedByName = {};
  }

  const roster = (Array.isArray(members) ? members : []).map((m) => {
    const fallback = m?.selected_card_id ?? null;
    return {
      ...m,
      selected_card_id: selectedByName[m?.name] ?? fallback,
    };
  });
  const capacity = capacityFromMode(party.mode);
  io.to(`party:${partyId}`).emit("party:members", {
    partyId,
    mode: party.mode,
    map: party.map,
    capacity,
    members: roster,
  });
}

async function updateOrDeleteParty(io, db, partyId) {
  const members = await db.fetchPartyMembersDetailed(partyId);
  const party = await selectPartyById(db, partyId);
  if (!party) return true; // already gone
  if (!members || members.length === 0) {
    await db.runQuery("DELETE FROM parties WHERE party_id = ?", [partyId]);
    return true;
  }
  await emitRoster(io, partyId, party, members, db);
  return false;
}

module.exports = { selectPartyById, emitRoster, updateOrDeleteParty };
