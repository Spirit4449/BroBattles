const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');
const { inPartyOrder } = require('./partyOperations');
const { PARTY_STATUS, teamSizeForSelection } = require('./partyRules');

const { getPartyOwnerName } = require('./party');
const { partyBotSlotsFor } = require('./partyBotSlots');
const { normalizeSelectionFromRow, getVariantDescriptor } = require('../match/gameSelectionCatalog');

async function setCharacterMenu({ db, partyPresence }, session, data) {
  const uname = session.user?.name;
  if (!uname) return;
  const partyId = data?.partyId ? Number(data.partyId) : null;
  const open = data?.open === true;
  if (!partyId) return;

  try {
    await inPartyOrder(db, partyId, async () => {
      const mem = await db.runQuery(
        "SELECT 1 FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
        [partyId, uname],
      );
      if (!mem?.length) return;

      if (open) {
        const statusRows = await db.runQuery(
          "SELECT status FROM users WHERE name = ? LIMIT 1",
          [uname],
        );
        const current = String(statusRows[0]?.status || "").toLowerCase();
        if (["ready", "in battle", "end screen"].includes(current)) return;
        session.charMenuPrevStatus =
          current === "selecting character"
            ? session.charMenuPrevStatus || "online"
            : statusRows[0]?.status || "online";
        await partyPresence.setUserPresence(
          uname,
          "Selecting Character",
          partyId,
        );
        return;
      }

      const statusRows = await db.runQuery(
        "SELECT status FROM users WHERE name = ? LIMIT 1", [uname],
      );
      if (String(statusRows[0]?.status || "").toLowerCase() !== "selecting character") return;
      const previous = String(session.charMenuPrevStatus || "online");
      session.charMenuPrevStatus = null;
      const restore =
        String(previous).toLowerCase() === "selecting character"
          ? "online"
          : previous;
      await partyPresence.setUserPresence(uname, restore, partyId);
    });
  } catch (e) {
    console.warn("char-menu:status error:", e?.message);
  }
}

async function moveMember({ db, io, partyPresence }, actorName, data) {
  const partyId = Number(data?.partyId);
  if (!Number.isSafeInteger(partyId) || partyId <= 0 || !actorName) throw new Error('Party ID required.');
  return inPartyOrder(db, partyId, async () => {
    await db.withTransaction(async (_conn, q) => {
      const parties = await q("SELECT * FROM parties WHERE party_id = ? FOR UPDATE", [partyId]);
      if (!parties.length) throw new Error("Party not found.");
      if (String(parties[0].status).toLowerCase() !== PARTY_STATUS.IDLE) throw new Error("Finish matchmaking or battle before moving players.");
      const members = await q("SELECT name, team, slot_index FROM party_members WHERE party_id = ? ORDER BY joined_at ASC, name ASC FOR UPDATE", [partyId]);
      if (members[0]?.name !== actorName) throw new Error("Only the party owner can move players.");
      const ready = await q("SELECT u.name FROM users u JOIN party_members pm ON pm.name = u.name WHERE pm.party_id = ? AND LOWER(u.status) = 'ready'", [partyId]);
      if (ready.length) throw new Error("Everyone must unready before moving players.");
      const selection = normalizeSelectionFromRow(parties[0]);
      const teamSize = teamSizeForSelection(selection);
      if (partyBotSlotsFor(io || db).getPartyBotSlots(partyId).some(bot => bot.team === data.team && bot.index === data.index)) throw new Error("Remove the bot before moving a player into that slot.");
      const next = require('./partySlots').movePartyMember(members, data, teamSize);
      for (const member of next) await q("UPDATE party_members SET team = ?, slot_index = ? WHERE party_id = ? AND name = ?", [member.team, member.slot_index, partyId, member.name]);
    });
    await partyPresence.emitPartyRosterById(partyId);
    return { ok: true };
  });
}

async function configureBot({ db, io }, actorName, data) {
  const partyId = Number(data?.partyId);
  return inPartyOrder(db, partyId, async () => {
    if (!actorName || !partyId) throw new Error("Party ID required.");
    if (await getPartyOwnerName(db, partyId) !== actorName) {
      throw new Error("Only the party owner can configure bots.");
    }
    const [partyRows, members] = await Promise.all([
      db.runQuery("SELECT * FROM parties WHERE party_id = ? LIMIT 1", [partyId]),
      db.fetchPartyMembersDetailed(partyId),
    ]);
    if (!partyRows.length) throw new Error("Party not found.");
    const selection = normalizeSelectionFromRow(partyRows[0]);
    const teamSize = getVariantDescriptor(
      selection.modeId,
      selection.modeVariantId,
    ).variant?.playersPerTeam || Number(partyRows[0].mode) || 1;
    const team = data?.team;
    const index = Number(data?.index);
    const occupied = (members || []).some((member) => member.team === team && member.slot_index === index);
    if (!Number.isInteger(index) || index < 0 || occupied || index >= teamSize) {
      throw new Error("That party slot is not available.");
    }
    partyBotSlotsFor(io || db).setPartyBotSlot(partyId, {
      team,
      index,
      character: data?.character,
    });
    const botSlots = partyBotSlotsFor(io || db).prunePartyBotSlots(partyId, { teamSize, members });
    io.to(`party:${partyId}`).emit(SOCKET_EVENTS.PARTY_BOT_SLOTS, { partyId, botSlots });
    return { ok: true, botSlots };
  });
}

module.exports = { setCharacterMenu, moveMember, configureBot };
