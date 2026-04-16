const { capacityFromSelection } = require("./utils");
const { normalizeSelectionFromRow } = require("./gameSelectionCatalog");

async function selectPartyById(db, partyId) {
  const rows = await db.runQuery(
    "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
    [partyId],
  );
  return rows?.[0] || null;
}

async function getPartyOwnerName(db, partyId) {
  const rows = await db.runQuery(
    `SELECT name
       FROM party_members
      WHERE party_id = ?
      ORDER BY joined_at ASC, name ASC
      LIMIT 1`,
    [partyId],
  );
  return rows?.[0]?.name || null;
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
  const selection = normalizeSelectionFromRow(party || {});
  const capacity = capacityFromSelection(selection);
  const ownerName = db ? await getPartyOwnerName(db, partyId) : null;
  io.to(`party:${partyId}`).emit("party:members", {
    partyId,
    ownerName,
    isPublic: Number(party?.is_public || 0) === 1,
    publicName: String(party?.public_name || "").trim(),
    mode: party.mode,
    modeId: selection.modeId,
    modeVariantId: selection.modeVariantId,
    selection,
    map: selection.mapId,
    capacity,
    members: roster,
  });
}

async function emitPartyNotice(io, partyId, notice) {
  if (!partyId) return;
  io.to(`party:${partyId}`).emit("party:notice", {
    partyId,
    type: String(notice?.type || "update"),
    actorName: String(notice?.actorName || "").trim(),
    title: String(notice?.title || "Party update"),
    message: String(notice?.message || ""),
    selection: notice?.selection || null,
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

module.exports = {
  selectPartyById,
  getPartyOwnerName,
  emitRoster,
  emitPartyNotice,
  updateOrDeleteParty,
};
