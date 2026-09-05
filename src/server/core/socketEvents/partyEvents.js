const {
  normalizeSelection,
  normalizeSelectionFromRow,
  isSelectionQueueable,
  getSelectionBlockReason,
  selectionToLegacyMode,
  getMapById,
  getVariantDescriptor,
} = require("../../helpers/gameSelectionCatalog");
const {
  getSkinById,
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
} = require("../../helpers/skinsCatalog");
const {
  syncSkinOwnershipForUser,
} = require("../../helpers/skinOwnership");
const { getAllCharacters } = require("../../../lib/characterStats");
const {
  getPartyBotSlots,
  setPartyBotSlot,
  prunePartyBotSlots,
} = require("../../helpers/partyBotSlots");

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

function getCharacterLevel(user, character) {
  let levels = user?.char_levels || {};
  if (typeof levels === "string") {
    try {
      levels = JSON.parse(levels || "{}");
    } catch (_) {
      levels = {};
    }
  }
  return Math.max(0, Number(levels?.[character]) || 0);
}

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
      let partyStatus = String(partyRows[0]?.status || "").toLowerCase();
      if (partyStatus === PARTY_STATUS.LIVE) {
        const liveRows = await db.runQuery(
          `SELECT m.match_id
             FROM matches m
             JOIN match_participants mp ON mp.match_id = m.match_id
            WHERE mp.party_id = ? AND m.status = 'live'
            LIMIT 1`,
          [partyId],
        );
        if (!liveRows.length) {
          await setPartyStatusSafe(partyId, PARTY_STATUS.IDLE);
          partyStatus = PARTY_STATUS.IDLE;
          console.warn(
            `[party:${partyId}] recovered stale live status during ready toggle`,
          );
        } else {
          const liveMatchId = Number(liveRows[0]?.match_id || 0);
          const participantRows = liveMatchId
            ? await db.runQuery(
                `SELECT u.name, u.status
                   FROM match_participants mp
                   JOIN users u ON u.user_id = mp.user_id
                  WHERE mp.match_id = ? AND mp.party_id = ?`,
                [liveMatchId, partyId],
              )
            : [];
          const hasActiveBattleParticipant = participantRows.some((row) =>
            String(row?.status || "")
              .trim()
              .toLowerCase()
              .includes("in battle"),
          );

          if (liveMatchId && !hasActiveBattleParticipant) {
            await db.runQuery(
              "UPDATE matches SET status = 'cancelled' WHERE match_id = ? AND status = 'live'",
              [liveMatchId],
            );
            await setPartyStatusSafe(partyId, PARTY_STATUS.IDLE);
            partyStatus = PARTY_STATUS.IDLE;
            console.warn(
              `[party:${partyId}] cancelled stale live match ${liveMatchId} during ready toggle`,
            );
          } else {
            return;
          }
        }
      }

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
          const botSlots = getPartyBotSlots(partyId);
          await setPartyStatusSafe(partyId, PARTY_STATUS.QUEUED);
          await mm.queueJoin({
            partyId,
            modeId: selection.modeId,
            modeVariantId: selection.modeVariantId,
            map: selection.mapId,
            botSlots,
          });
          io.to(`party:${partyId}`).emit("party:matchmaking:start", {
            partyId,
            selection,
            botSlots,
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

  socket.on("party:bot-slot:update", async (data, ack) => {
    const actorName = socket.data.user?.name;
    const partyId = Number(data?.partyId);
    try {
      if (!actorName || !partyId) throw new Error("Party ID required.");
      const ownerRows = await db.runQuery(
        `SELECT name FROM party_members WHERE party_id = ? ORDER BY joined_at ASC, name ASC LIMIT 1`,
        [partyId],
      );
      if (ownerRows?.[0]?.name !== actorName) {
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
      const occupied = (members || []).filter((member) => member.team === team).length;
      if (!Number.isInteger(index) || index < occupied || index >= teamSize) {
        throw new Error("That party slot is not available.");
      }
      setPartyBotSlot(partyId, {
        team,
        index,
        character: data?.character,
      });
      const botSlots = prunePartyBotSlots(partyId, { teamSize, members });
      io.to(`party:${partyId}`).emit("party:bot-slots", { partyId, botSlots });
      ack?.({ ok: true, botSlots });
    } catch (error) {
      ack?.({ ok: false, error: error?.message || "Could not update bot slot." });
    }
  });

  socket.on("mode-change", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname || !data?.partyId) return;

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
        actorName: uname,
      });

      const members = await db.fetchPartyMembersDetailed(data.partyId);
      const teamSize = getVariantDescriptor(
        savedSelection.modeId,
        savedSelection.modeVariantId,
      ).variant?.playersPerTeam || 1;
      const botSlots = prunePartyBotSlots(data.partyId, { teamSize, members });

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
        botSlots,
      });
      io.to(`party:${data.partyId}`).emit("party:bot-slots", {
        partyId: data.partyId,
        botSlots,
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
      socket.emit("party:selection-denied", {
        partyId: data.partyId,
        error: e?.message || "Could not change selection.",
      });
      console.warn("mode-change error:", e?.message);
    }
  });

  socket.on("map-change", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname || !data?.partyId) return;

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
        actorName: uname,
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
      socket.emit("party:selection-denied", {
        partyId: data.partyId,
        error: e?.message || "Could not change selection.",
      });
      console.warn("map-change error:", e?.message);
    }
  });

  socket.on("char-change", async (data, ack) => {
    const socketUser = socket.data.user;
    const uname = socketUser?.name;
    const userId = Number(socketUser?.user_id) || 0;
    if (!uname || !userId) {
      ack?.({ ok: false, error: "unauthorized" });
      return;
    }
    const partyId = data?.partyId ? Number(data.partyId) : null;
    const charClass = (data?.character || data?.charClass || "")
      .toString()
      .trim()
      .toLowerCase();
    const selectedSkinId = String(data?.selectedSkinId || "").trim();
    if (!charClass || !/^[a-zA-Z_-]{2,20}$/.test(charClass)) {
      ack?.({ ok: false, error: "invalid_character" });
      return;
    }
    if (!VALID_CHARACTER_IDS.has(charClass)) {
      console.warn(
        `[party:${partyId ?? "-"}] rejected unknown character ${charClass} for ${uname}`,
      );
      ack?.({ ok: false, error: "unknown_character" });
      return;
    }

    try {
      const userRows = await db.runQuery(
        "SELECT * FROM users WHERE user_id = ? LIMIT 1",
        [userId],
      );
      const freshUser = userRows?.[0];
      if (!freshUser) {
        ack?.({ ok: false, error: "user_not_found" });
        return;
      }
      if (getCharacterLevel(freshUser, charClass) < 1) {
        ack?.({ ok: false, error: "character_locked" });
        return;
      }

      const skinState = await syncSkinOwnershipForUser(db, freshUser);
      const ownedSkinIds = Array.isArray(skinState?.ownedSkinIds)
        ? skinState.ownedSkinIds.map(String)
        : [];
      const owned = new Set(ownedSkinIds);
      let nextSkinId = selectedSkinId;

      if (nextSkinId) {
        const skin = getSkinById(nextSkinId);
        if (
          !skin ||
          String(skin.character || "") !== charClass ||
          !owned.has(nextSkinId)
        ) {
          ack?.({ ok: false, error: "skin_not_unlocked" });
          return;
        }
      } else {
        nextSkinId =
          resolveSelectedSkinId({
            character: charClass,
            selectedSkinMap: skinState?.selectedSkinIdByCharacter,
            ownedSkinIds,
          }) || "";
      }

      let selectedMap;
      if (typeof db.withTransaction === "function") {
        selectedMap = await db.withTransaction(async (_conn, q) => {
          const rows = await q(
            "SELECT selected_skin_id_by_char FROM users WHERE user_id = ? FOR UPDATE",
            [userId],
          );
          const nextMap = normalizeSelectedSkinMap(
            rows?.[0]?.selected_skin_id_by_char,
          );
          if (nextSkinId && (selectedSkinId || !nextMap[charClass])) {
            nextMap[charClass] = nextSkinId;
          }
          await q(
            "UPDATE users SET char_class = ?, selected_skin_id_by_char = ? WHERE user_id = ?",
            [charClass, JSON.stringify(nextMap), userId],
          );
          return nextMap;
        });
      } else {
        selectedMap = normalizeSelectedSkinMap(
          skinState?.selectedSkinIdByCharacter ||
            freshUser.selected_skin_id_by_char,
        );
        if (nextSkinId && (selectedSkinId || !selectedMap[charClass])) {
          selectedMap[charClass] = nextSkinId;
        }
        await db.runQuery(
          "UPDATE users SET char_class = ?, selected_skin_id_by_char = ? WHERE user_id = ?",
          [charClass, JSON.stringify(selectedMap), userId],
        );
      }
      nextSkinId = selectedMap[charClass] || nextSkinId;
      socket.data.user = {
        ...socket.data.user,
        char_class: charClass,
        selected_skin_id_by_char: selectedMap,
      };

      // Always derive the broadcast target from authoritative membership. A
      // stale page URL must not prevent the user's real party from refreshing.
      const rosterPartyId = await db.getPartyIdByName(uname);
      if (rosterPartyId) {
        await partyPresence.emitPartyRosterById(rosterPartyId);
      }

      ack?.({
        ok: true,
        character: charClass,
        selectedSkinId: nextSkinId || null,
      });

      console.log(
        `[party:${rosterPartyId ?? "-"}] ${uname} selected ${charClass}:${nextSkinId || "default"}`,
      );
    } catch (e) {
      ack?.({ ok: false, error: "selection_failed" });
      console.warn("char-change error:", e?.message);
    }
  });
}

module.exports = { registerPartyEvents };
