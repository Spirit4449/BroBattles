const {
  normalizeSelection,
  normalizeSelectionFromRow,
  isSelectionQueueable,
  getSelectionBlockReason,
  selectionToLegacyMode,
  getMapById,
  getVariantDescriptor,
} = require("../../helpers/gameSelectionCatalog");
const { getAllCharacters } = require("../../../lib/characterStats");

function formatSelectionLabel(selection) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  if (!mode) return "Unknown mode";
  return variant ? `${mode.label} ${variant.label}` : mode.label;
}

const VALID_CHARACTER_IDS = new Set(
  (Array.isArray(getAllCharacters?.()) ? getAllCharacters() : [])
    .map((entry) =>
      String(entry || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean),
);

function registerPartyEvents(
  socket,
  { db, io, mm, partyPresence, partyState, partyQueueTransition, PARTY_STATUS },
) {
  async function setPartyStatusSafe(partyId, status) {
    if (!partyId) return;
    if (typeof db.setPartyStatus === "function") {
      await db.setPartyStatus(partyId, status);
      return;
    }
    await db.runQuery("UPDATE parties SET status = ? WHERE party_id = ?", [
      status,
      partyId,
    ]);
  }

  async function broadcastSelectionNotice(partyId, actorName, selection, kind) {
    const label =
      kind === "map"
        ? `map to ${getMapById(selection?.mapId)?.label || String(selection?.mapId || "unknown")}`
        : `mode to ${formatSelectionLabel(selection)}`;
    await partyPresence.emitPartyNotice?.(partyId, {
      type: kind,
      actorName,
      title: `${actorName} changed ${label}`,
      message: "",
      selection,
    });
  }

  socket.on("char-menu:status", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname) return;
    const partyId = data?.partyId ? Number(data.partyId) : null;
    const open = data?.open === true;
    if (!partyId) return;

    try {
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
        socket.data.charMenuPrevStatus =
          current === "selecting character"
            ? socket.data.charMenuPrevStatus || "online"
            : statusRows[0]?.status || "online";
        await partyPresence.setUserPresence(
          uname,
          "Selecting Character",
          partyId,
        );
        return;
      }

      const previous = String(socket.data.charMenuPrevStatus || "online");
      socket.data.charMenuPrevStatus = null;
      const restore =
        String(previous).toLowerCase() === "selecting character"
          ? "online"
          : previous;
      await partyPresence.setUserPresence(uname, restore, partyId);
    } catch (e) {
      console.warn("char-menu:status error:", e?.message);
    }
  });

  socket.on("ready:status", async (data) => {
    try {
      const uname = socket.data.user?.name;
      if (!uname) return;
      const isReady = !!data?.ready;
      const providedPartyId = data?.partyId ? Number(data.partyId) : null;
      const partyId = providedPartyId || (await db.getPartyIdByName(uname));
      if (!partyId) return;

      const partyRows = await db.runQuery(
        "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
        [partyId],
      );
      const partyStatus = String(partyRows[0]?.status || "").toLowerCase();
      if (partyStatus === PARTY_STATUS.LIVE) return;

      await partyPresence.setUserPresence(
        uname,
        isReady ? "ready" : "online",
        partyId,
      );

      if (!isReady) {
        if (
          partyStatus === PARTY_STATUS.QUEUED ||
          partyStatus === PARTY_STATUS.READY_CHECK
        ) {
          await partyQueueTransition.cancelPartyQueue({
            partyId,
            userId: null,
            reason: `${uname} cancelled matchmaking`,
          });
        }
      }

      const members = await db.fetchPartyMembersDetailed(partyId);
      const allReady =
        members.length > 0 &&
        members.every((m) => String(m.status || "").toLowerCase() === "ready");
      if (
        allReady &&
        (partyStatus === PARTY_STATUS.IDLE ||
          partyStatus === PARTY_STATUS.QUEUED)
      ) {
        try {
          const selection = normalizeSelectionFromRow(partyRows[0] || {});
          if (!isSelectionQueueable(selection)) {
            throw new Error(getSelectionBlockReason(selection));
          }
          await setPartyStatusSafe(partyId, PARTY_STATUS.QUEUED);
          await mm.queueJoin({
            partyId,
            modeId: selection.modeId,
            modeVariantId: selection.modeVariantId,
            map: selection.mapId,
          });
          io.to(`party:${partyId}`).emit("party:matchmaking:start", {
            partyId,
            selection,
          });
          console.log(`[party:${partyId}] all-ready -> matchmaking`);
        } catch (err) {
          console.warn("enqueue failed:", err?.message);
          try {
            await setPartyStatusSafe(partyId, PARTY_STATUS.IDLE);
          } catch (_) {}
          io.to(`party:${partyId}`).emit("match:cancelled", {
            reason: err?.message || "Failed to join matchmaking",
          });
        }
      }
    } catch (e) {
      console.warn("ready:status error:", e?.message);
    }
  });

  socket.on("mode-change", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname || !data.partyId) return;

    try {
      const rows = await db.runQuery(
        "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
        [data.partyId],
      );
      const currentSelection = normalizeSelectionFromRow(rows[0] || {});
      const nextSelection = normalizeSelection({
        modeId:
          data?.selection?.modeId || data?.modeId || currentSelection.modeId,
        modeVariantId:
          data?.selection?.modeVariantId ||
          data?.modeVariantId ||
          data?.selectedValue ||
          currentSelection.modeVariantId,
        mapId: data?.selection?.mapId ?? currentSelection.mapId,
      });
      const savedSelection = await partyState.setPartySelection({
        partyId: data.partyId,
        selection: nextSelection,
      });

      io.to(`party:${data.partyId}`).emit("mode-change", {
        partyId: data.partyId,
        selectedValue: savedSelection.modeVariantId,
        mode: selectionToLegacyMode(
          savedSelection.modeId,
          savedSelection.modeVariantId,
        ),
        modeId: savedSelection.modeId,
        modeVariantId: savedSelection.modeVariantId,
        selection: savedSelection,
        username: uname,
        members: data.members,
      });

      await broadcastSelectionNotice(
        data.partyId,
        uname,
        savedSelection,
        "mode",
      );

      console.log(
        `[party:${data.partyId}] Mode changed to ${savedSelection.modeId}:${savedSelection.modeVariantId} by ${uname}`,
      );
    } catch (e) {
      console.warn("mode-change error:", e?.message);
    }
  });

  socket.on("map-change", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname || !data.partyId) return;

    try {
      const rows = await db.runQuery(
        "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
        [data.partyId],
      );
      const currentSelection = normalizeSelectionFromRow(rows[0] || {});
      const nextSelection = normalizeSelection({
        modeId: data?.selection?.modeId || currentSelection.modeId,
        modeVariantId:
          data?.selection?.modeVariantId || currentSelection.modeVariantId,
        mapId:
          data?.selection?.mapId ??
          data?.selectedValue ??
          currentSelection.mapId,
      });
      const savedSelection = await partyState.setPartySelection({
        partyId: data.partyId,
        selection: nextSelection,
      });

      io.to(`party:${data.partyId}`).emit("map-change", {
        partyId: data.partyId,
        selectedValue: savedSelection.mapId,
        map: savedSelection.mapId,
        modeId: savedSelection.modeId,
        modeVariantId: savedSelection.modeVariantId,
        selection: savedSelection,
        username: uname,
      });

      await broadcastSelectionNotice(
        data.partyId,
        uname,
        savedSelection,
        "map",
      );

      console.log(
        `[party:${data.partyId}] Map changed to ${savedSelection.mapId} by ${uname}`,
      );
    } catch (e) {
      console.warn("map-change error:", e?.message);
    }
  });

  socket.on("char-change", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname) return;
    const partyId = data?.partyId ? Number(data.partyId) : null;
    const charClass = (data?.character || data?.charClass || "")
      .toString()
      .trim()
      .toLowerCase();
    if (!charClass || !/^[a-zA-Z_-]{2,20}$/.test(charClass)) return;
    if (!VALID_CHARACTER_IDS.has(charClass)) {
      console.warn(
        `[party:${partyId ?? "-"}] rejected unknown character ${charClass} for ${uname}`,
      );
      return;
    }

    try {
      if (partyId) {
        const mem = await db.runQuery(
          "SELECT 1 FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
          [partyId, uname],
        );
        if (!mem?.length) {
          await db.runQuery("UPDATE users SET char_class = ? WHERE name = ?", [
            charClass,
            uname,
          ]);
          return;
        }
      }

      await db.runQuery("UPDATE users SET char_class = ? WHERE name = ?", [
        charClass,
        uname,
      ]);

      if (partyId) {
        await partyPresence.emitPartyRosterById(partyId);
      }

      console.log(`[party:${partyId ?? "-"}] ${uname} selected ${charClass}`);
    } catch (e) {
      console.warn("char-change error:", e?.message);
    }
  });
}

module.exports = { registerPartyEvents };
