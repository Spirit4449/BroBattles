// Owns one lobby's matchmaking session: queue context, the overlay's roster
// preview, the found-match lock and the timers that acknowledge a match or
// recover a stale queue. All browser/socket collaborators are injected so the
// lifecycle can be tested without a DOM.
export const MATCHMAKING_SUCCESS_HOLD_MS = 2400;
export const QUEUE_HEALTH_INTERVAL_MS = 5000;
const QUEUE_REQUEST_TIMEOUT_MS = 5000;

const rosterSignature = (players) =>
  JSON.stringify(players.map((p) => `${p?.botSlotKey || p?.name || ""}:${p?.char_class || ""}`));

/**
 * @param {object} deps
 * @param {object} deps.socket Socket.IO client.
 * @param {object} deps.view Overlay view from matchmakingOverlay.js.
 * @param {object} deps.selection { normalize, totalPlayers, current }.
 * @param {object} deps.party { activeId, players, currentTeam } for this lobby.
 * @param {(value: unknown) => string} deps.memberKey Normalizes a member name.
 * @param {() => string} deps.selfKey Normalized name of the current user.
 * @param {() => void} deps.onReadyReset Restores the local ready UI after a queue ends.
 */
export function createMatchmakingClient({
  socket,
  view,
  selection,
  party,
  memberKey,
  selfKey,
  onReadyReset = () => {},
  warmBattle = () => {},
  notify = () => {},
  maintenanceMessage = "",
  audio = () => null,
  isAdmin = () => false,
  navigate = () => {},
  rememberMatch = () => {},
  dispatchStart = () => {},
  suppressed = false,
  timers = globalThis,
  now = () => Date.now(),
  log = console,
}) {
  const state = {
    queue: null, // { selection, yourTeam }
    players: [],
    playersSig: "",
    total: 0,
    matchedId: null,
    readyAt: 0,
    // Set after returning from a battle until the user readies again, so
    // late queue events from the previous match cannot reopen the overlay.
    suppressed,
    readyAckTimer: null,
    healthTimer: null,
    healthPending: false,
    healthGeneration: 0,
  };

  const debugMeta = (extra) => ({ currentPartyId: party.activeId() || null, ...extra });

  function resetRoster() {
    state.players = [];
    state.playersSig = "";
    state.total = 0;
  }

  function resetQueue() {
    state.queue = null;
    resetRoster();
  }

  function successHoldRemaining() {
    return Math.max(0, MATCHMAKING_SUCCESS_HOLD_MS - (now() - (state.readyAt || now())));
  }

  function render({ found, total, selection: requested, players }) {
    const normalized = selection.normalize(requested || state.queue?.selection || selection.current());
    const foundCount = Math.max(0, Number(found) || 0);
    const totalCount = Number(total) || selection.totalPlayers(normalized) || 0;
    const full = !!state.matchedId && totalCount > 0 && foundCount >= totalCount;
    const list = Array.isArray(players) ? players : [];
    audio()?.updatePlayers(
      list.slice(0, totalCount).map((player) => String(player?.botSlotKey || player?.name || "").trim().toLowerCase()),
      selfKey(),
    );
    const result = view.render({
      found: foundCount, total: totalCount, selection: normalized, players: list,
      yourTeam: state.queue?.yourTeam, full,
    });
    if (result) {
      if (result.becameFull) {
        state.readyAt = now();
        audio()?.found();
      }
      if (!full) state.readyAt = 0;
    }
  }

  function renderCurrent(requested) {
    render({ found: state.players.length, total: state.total, selection: requested, players: state.players });
  }

  function lockCancel(matchId) {
    state.matchedId = Number(matchId);
    view.setCancelDisabled(true);
  }

  function checkHealth() {
    if (state.healthPending) return;
    state.healthPending = true;
    const generation = state.healthGeneration;
    const requestedMatchId = state.matchedId;
    socket.timeout(QUEUE_REQUEST_TIMEOUT_MS).emit("queue:status", (error, status) => {
      if (generation !== state.healthGeneration) return;
      state.healthPending = false;
      if (state.matchedId !== requestedMatchId) return;
      if (error || status?.state === "unavailable") return;
      if (status?.state === "live") {
        lockCancel(status.matchId);
        navigate(`/game/${status.matchId}`);
      } else if (status?.state === "matched") {
        lockCancel(status.matchId);
        socket.emit("ready:ack", { matchId: status.matchId });
      } else if (status?.state === "missing") {
        // Let the server reset party readiness and broadcast recovery to everyone.
        socket.emit("queue:leave");
        state.matchedId = null;
      }
    });
  }

  function requestCancel() {
    if (state.matchedId || view.isCancelDisabled()) return;
    view.setCancelDisabled(true);
    const generation = state.healthGeneration;
    socket.timeout(QUEUE_REQUEST_TIMEOUT_MS).emit("queue:leave", (error, result) => {
      if (state.matchedId || generation !== state.healthGeneration) return;
      if (result?.cancelled === false && result.matchId) {
        lockCancel(result.matchId);
        checkHealth();
        return;
      }
      if (error || !result?.ok) {
        view.setCancelDisabled(false);
        checkHealth();
        return;
      }
      hide();
    });
  }

  function show() {
    if (!view.exists() || state.suppressed) return;
    dispatchStart();
    audio()?.searching();
    // Everyone already standing in the lobby queued together: they keep their
    // seats from the start and only players matched in afterwards arrive.
    if (view.isHidden()) {
      const seatedPlayers = party.players();
      if (!state.players.length) state.players = state.total ? seatedPlayers.slice(0, state.total) : seatedPlayers;
      view.show({ seatedPlayers });
    } else {
      view.show();
    }
    renderCurrent();
    view.bindControls({
      onCancel: requestCancel,
      onFillBots: () => socket.emit("queue:fill-bots"),
      onFillBotsUnlimited: () =>
        socket.emit("queue:fill-bots", { mode: "unlimited-health", botHealthOverride: 9999999 }),
    });
    view.setCancelDisabled(!!state.matchedId);
    if (!state.healthTimer) state.healthTimer = timers.setInterval(checkHealth, QUEUE_HEALTH_INTERVAL_MS);
    view.setAdminControlsVisible(!!isAdmin());
  }

  function hide({ immediate = false } = {}) {
    audio()?.cancelSearch();
    state.matchedId = null;
    state.healthGeneration++;
    state.healthPending = false;
    if (state.healthTimer) timers.clearInterval(state.healthTimer);
    state.healthTimer = null;
    if (!view.exists()) return;
    if (state.readyAckTimer) {
      timers.clearTimeout(state.readyAckTimer);
      state.readyAckTimer = null;
    }
    state.readyAt = 0;
    // A closed queue's roster must not flash in the next session's overlay.
    resetRoster();
    view.hide({ immediate });
  }

  function startSolo(requested) {
    state.queue = { selection: requested, yourTeam: party.currentTeam() || null };
    state.total = selection.totalPlayers(requested);
    state.players = party.players().slice(0, state.total);
    state.playersSig = rosterSignature(state.players);
    socket.emit("queue:join", {
      selection: requested,
      modeId: requested.modeId,
      modeVariantId: requested.modeVariantId,
      map: Number(requested.mapId) || 1,
      side: "team1", // default; server may flip if needed
    });
    show();
  }

  function leaveSolo() {
    socket.emit("queue:leave");
    hide();
    state.queue = null;
  }

  function restoreAfterBattleReturn() {
    state.suppressed = true;
    resetQueue();
    hide({ immediate: true });
    socket.emit("lobby:heartbeat");
    onReadyReset();
  }

  const isForOtherParty = (partyId) => {
    const current = party.activeId();
    return current && String(partyId) !== String(current);
  };
  const blockedBeforeMatch = () => state.suppressed || !!state.matchedId;

  const handlers = {
    "party:matchmaking:start"({ partyId, selection: requested, botSlots }) {
      if (blockedBeforeMatch() || isForOtherParty(partyId)) return;
      const normalized = selection.normalize(requested || selection.current());
      if (Array.isArray(botSlots)) party.setBotSlots?.(botSlots);
      state.queue = { selection: normalized, yourTeam: party.currentTeam() || null };
      state.total = selection.totalPlayers(normalized);
      state.players = party.players().slice(0, state.total);
      state.playersSig = rosterSignature(state.players);
      show();
      renderCurrent(normalized);
    },

    "queue:joined"(payload) {
      if (blockedBeforeMatch()) return;
      log.log("[join-debug] queue:joined", debugMeta({
        payloadPartyId: payload?.partyId ?? null,
        selection: payload?.selection || null,
      }));
      const normalized = selection.normalize(payload?.selection || selection.current());
      state.queue = { selection: normalized, yourTeam: party.currentTeam() || null };
      state.players = party.players();
      state.playersSig = "";
      state.total = selection.totalPlayers(normalized);
      show();
      renderCurrent(normalized);
    },

    // When a match is found, hold the success state before acknowledging ready.
    "match:found"(payload) {
      if (state.suppressed || !payload?.matchId) return;
      lockCancel(payload.matchId);
      show();
      log.log("[join-debug] match:found", debugMeta({
        matchId: payload?.matchId ?? null,
        playerCount: Array.isArray(payload?.players) ? payload.players.length : 0,
        selection: payload?.selection || null,
      }));
      const normalized = selection.normalize(payload?.selection || selection.current());
      state.queue = { selection: normalized, yourTeam: payload?.yourTeam || null };
      const matchedPlayers = Array.isArray(payload?.players) ? payload.players.slice() : [];
      warmBattle(normalized, matchedPlayers);
      state.players = payload?.yourTeam
        ? matchedPlayers.sort((a, b) => (a?.team === payload.yourTeam ? 0 : 1) - (b?.team === payload.yourTeam ? 0 : 1))
        : matchedPlayers;
      state.playersSig = rosterSignature(state.players);
      state.total = selection.totalPlayers(normalized);
      renderCurrent(normalized);
      if (state.readyAckTimer) timers.clearTimeout(state.readyAckTimer);
      state.readyAckTimer = timers.setTimeout(() => {
        socket.emit("ready:ack", { matchId: payload.matchId });
        state.readyAckTimer = null;
      }, successHoldRemaining());
    },

    // When the match is ready to start, redirect to the game.
    async "match:gameReady"(payload) {
      if (state.suppressed) return;
      try {
        const { matchId } = payload;
        if (!matchId) {
          log.error("No matchId in gameReady payload");
          return;
        }
        log.log("[join-debug] match:gameReady redirecting", debugMeta({ matchId }));
        const remaining = successHoldRemaining();
        if (remaining > 0) await new Promise((resolve) => timers.setTimeout(resolve, remaining));
        rememberMatch(matchId);
        state.queue = null;
        navigate(`/game/${matchId}`);
      } catch (error) {
        log.error("Error handling match:gameReady:", error);
        notify("Could not join match", "Please refresh the page and try again.", "error");
      }
    },

    "queue:error"(err) {
      if (state.matchedId || err?.code === "MATCH_FOUND") return;
      log.error("[join-debug] queue:error", debugMeta({ message: err?.message || null, raw: err || null }));
      hide();
      resetQueue();
      if (err?.message) {
        const maintenance = err.code === "MAINTENANCE";
        notify(maintenance ? null : "Could not start matchmaking", maintenance ? maintenanceMessage : err.message, "error",
          { sound: "notification", maintenanceUntil: maintenance ? err.maintenanceUntil : null });
      }
      // Reset local ready state so the next click attempts to join again.
      onReadyReset();
    },

    "queue:fill-bots:error"(err) {
      notify("Could not add bots", err?.message || "Please try adding bots again.", "error");
    },

    // Match cancelled (e.g., ready timeout) -> hide overlay.
    "match:cancelled"(data) {
      if (state.matchedId && Number(data?.matchId) !== state.matchedId) return;
      log.warn("[join-debug] match:cancelled", debugMeta({ reason: data?.reason || null }));
      if (data?.reason && !view.isHidden()) {
        notify("Matchmaking stopped", data.reason, null, null, { duration: 3000, sound: "notification" });
      }
      hide();
      resetQueue();
      // Reset local ready state so the next click sets Ready (prevents double-click issue).
      onReadyReset();
    },

    // Progressive matching updates: incrementally update the found count.
    "match:progress"(data) {
      if (blockedBeforeMatch()) return;
      const target = selection.normalize(state.queue?.selection || selection.current());
      const incoming = selection.normalize(data?.selection || {
        modeId: data?.modeId, modeVariantId: data?.modeVariantId, mapId: data?.map,
      });
      if (incoming.modeId !== target.modeId || incoming.modeVariantId !== target.modeVariantId ||
        Number(incoming.mapId) !== Number(target.mapId)) return;

      // Keep overlay context aligned to the server payload while queued. The
      // lobby team stays: hydrated party members still carry lobby teams.
      state.queue = { selection: incoming, yourTeam: state.queue?.yourTeam ?? (party.currentTeam() || null) };
      if (view.isHidden()) show();
      const foundCount = Number(data?.found) || 0;
      const totalCount = Number(data?.total) || selection.totalPlayers(incoming);

      const incomingPlayers = Array.isArray(data?.players) ? data.players : [];
      const localPlayers = party.players();
      const localHumansByName = new Map(localPlayers
        .filter((player) => !player?.isConfiguredBot)
        .map((player) => [memberKey(player?.name), player]));
      const hydrated = incomingPlayers.map((player) => ({ ...(localHumansByName.get(memberKey(player?.name)) || {}), ...player }));
      const configuredBots = localPlayers.filter((player) => player?.isConfiguredBot);
      const visibleTarget = Math.min(foundCount, totalCount);
      const missingPreviews = Math.max(0, visibleTarget - hydrated.length);
      const nextPlayers = incomingPlayers.length
        ? [...hydrated, ...configuredBots.slice(0, missingPreviews)]
        : localPlayers.slice(0, visibleTarget);
      const nextSig = rosterSignature(nextPlayers);
      if (nextSig !== state.playersSig) {
        state.playersSig = nextSig;
        state.players = nextPlayers;
      }
      state.total = totalCount;
      render({ found: foundCount, total: state.total, selection: incoming, players: state.players });
    },
  };

  return {
    bindSocketEvents() {
      for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    },
    show,
    hide,
    startSolo,
    leaveSolo,
    restoreAfterBattleReturn,
    isQueued: () => !!state.queue,
    isSuppressed: () => state.suppressed,
    resumeQueueing() { state.suppressed = false; },
    // Exposed for focused lifecycle tests.
    checkHealth,
    lockCancel,
    requestCancel,
    get matchedId() { return state.matchedId; },
  };
}
