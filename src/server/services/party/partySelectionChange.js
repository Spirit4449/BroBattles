const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');
const { inPartyOrder } = require('./partyOperations');
const { teamSizeForSelection } = require('./partyRules');

const { selectPartyById } = require('./party');
const { partyBotSlotsFor } = require('./partyBotSlots');
const { normalizeSelection, normalizeSelectionFromRow, selectionToLegacyMode, getMapById, getVariantDescriptor } = require('../match/gameSelectionCatalog');

function formatSelectionLabel(selection) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  if (!mode) return "Unknown mode";
  return variant ? `${mode.label} ${variant.label}` : mode.label;
}

async function applySelectionChange({ db, io, partyState, partyPresence }, actorName, data, kind) {
  const partyId = data?.partyId;
  if (!actorName || !partyId) return;
  return inPartyOrder(db, partyId, async () => {
    const current = normalizeSelectionFromRow(await selectPartyById(db, partyId) || {});
    const mode = kind === 'mode';
    const selection = await partyState.setPartySelection({
      partyId, actorName,
      selection: normalizeSelection({
        modeId: data.selection?.modeId || (mode && data.modeId) || current.modeId,
        modeVariantId: data.selection?.modeVariantId || (mode && (data.modeVariantId || data.selectedValue)) || current.modeVariantId,
        mapId: data.selection?.mapId ?? (mode ? current.mapId : data.selectedValue ?? current.mapId),
      }),
    });
    const info = { partyId, modeId: selection.modeId, modeVariantId: selection.modeVariantId, selection, username: actorName };
    if (mode) {
      const members = await db.fetchPartyMembersDetailed(partyId);
      const botSlots = partyBotSlotsFor(io || db).prunePartyBotSlots(partyId, { teamSize: teamSizeForSelection(selection), members });
      io.to('party:' + partyId).emit(SOCKET_EVENTS.MODE_CHANGE, { ...info, members, botSlots,
        selectedValue: selection.modeVariantId, mode: selectionToLegacyMode(selection.modeId, selection.modeVariantId) });
      io.to('party:' + partyId).emit(SOCKET_EVENTS.PARTY_BOT_SLOTS, { partyId, botSlots });
    } else {
      io.to('party:' + partyId).emit(SOCKET_EVENTS.MAP_CHANGE, { ...info, selectedValue: selection.mapId, map: selection.mapId });
    }
    const changed = mode ? selection.modeId !== current.modeId || selection.modeVariantId !== current.modeVariantId
      : String(selection.mapId) !== String(current.mapId);
    if (changed) {
      const label = mode ? 'mode to ' + formatSelectionLabel(selection) : 'map to ' + (getMapById(selection.mapId)?.label || String(selection.mapId || 'unknown'));
      await partyPresence.emitPartyNotice?.(partyId, { type: kind, actorName, title: actorName + ' changed ' + label, message: '', selection });
    }
  });
}

module.exports = { applySelectionChange };
