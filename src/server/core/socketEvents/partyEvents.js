function registerPartyEvents(
  socket,
  { db, io, mm, partyPresence, partyState, partyQueueTransition, PARTY_STATUS },
) {
  socket.on("ready:status", async (data) => {
    try {
      const uname = socket.data.user?.name;
      if (!uname) return;
      const isReady = !!data?.ready;
      const providedPartyId = data?.partyId ? Number(data.partyId) : null;
      const partyId = providedPartyId || (await db.getPartyIdByName(uname));
      if (!partyId) return;

      const partyRows = await db.runQuery(
        "SELECT status, mode, map FROM parties WHERE party_id = ? LIMIT 1",
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
          await db.setPartyStatus(partyId, PARTY_STATUS.QUEUED);
        } catch (_) {}
        io.to(`party:${partyId}`).emit("party:matchmaking:start", {
          partyId,
        });
        console.log(`[party:${partyId}] all-ready -> matchmaking`);
        try {
          const mode = partyRows[0]?.mode || 1;
          const map = partyRows[0]?.map || 1;
          await mm.queueJoin({ partyId, mode, map });
        } catch (err) {
          console.warn("enqueue failed:", err?.message);
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
      await partyState.setPartyMode({
        partyId: data.partyId,
        mode: data.selectedValue,
      });

      io.to(`party:${data.partyId}`).emit("mode-change", {
        partyId: data.partyId,
        selectedValue: data.selectedValue,
        mode: data.selectedValue,
        username: uname,
        members: data.members,
      });

      console.log(
        `[party:${data.partyId}] Mode changed to ${data.selectedValue} by ${uname}`,
      );
    } catch (e) {
      console.warn("mode-change error:", e?.message);
    }
  });

  socket.on("map-change", async (data) => {
    const uname = socket.data.user?.name;
    if (!uname || !data.partyId) return;

    try {
      await partyState.setPartyMap({
        partyId: data.partyId,
        map: data.selectedValue,
      });

      io.to(`party:${data.partyId}`).emit("map-change", {
        partyId: data.partyId,
        selectedValue: data.selectedValue,
        map: data.selectedValue,
        username: uname,
      });

      console.log(
        `[party:${data.partyId}] Map changed to ${data.selectedValue} by ${uname}`,
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
      .trim();
    if (!charClass || !/^[a-zA-Z_-]{2,20}$/.test(charClass)) return;

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
        await partyPresence.setTransientPresence({
          name: uname,
          status: "Selecting Character",
          restoreStatus: "online",
          partyId,
          durationMs: 1500,
        });
      }

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
