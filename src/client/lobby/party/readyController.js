import { getNavigation } from "../../lib/globals.cjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { postJson } from "../../lib/http.js";
import { getActivePartyId } from "./partyState.js";
import { getSelfSlot, slotField } from "./slotDom.js";
import { MAINTENANCE_MESSAGE } from "../../../shared/site/maintenance";
import { playButtonSpawnFx } from "./buttonSpawnFx.js";
import { ensureLegalAcceptance } from "../../site/shell";
import { sonner } from "../../ui/sonner.js";
import socket from "../../lib/socket";
import { applyLobbyStatusVisualState } from "./slotEffects.js";
import { getSelectionBlockReason, normalizeGameSelection } from "../../lib/gameSelectionCatalog.js";
import { MATCH_ID_KEY } from "../../lib/storageKeys.js";
import { getCurrentSelection } from "./selectionPickers.js";

export function createReadyController({ getMatchmaking, renderPartyMembers }) {
  let readyPending = false;

  let readyTarget = null;

  let readyRequestId = 0;

  const lockedRoots = new Map();

  let activeBattleMatchId = null;

  function initReadyToggle() {
    const readyBtn = document.getElementById("ready");
    if (!readyBtn) return;
    // Avoid duplicate bindings when UI re-renders
    if (readyBtn.dataset.bound === "1") return;
    readyBtn.dataset.bound = "1";

    readyBtn.addEventListener("click", async () => {
      if (getActivePartyId() && activeBattleMatchId) {
        sessionStorage.setItem(MATCH_ID_KEY, String(activeBattleMatchId));
        window.location.href = `/game/${activeBattleMatchId}`;
        return;
      }
      getMatchmaking().resumeQueueing();
      // Find current user's status element to update optimistically
      const selfSlot = getSelfSlot();
      const statusEl = slotField(selfSlot, "status");
      if (!statusEl) return;

      const cur = (statusEl.textContent || "").toLowerCase();
      const nextReady = cur.trim() !== "ready";
      const partyId = getActivePartyId();
      // Answer the click at once, before consent or the server reply.
      playButtonSpawnFx(readyBtn, {
        host: readyBtn.parentElement,
        direction: nextReady ? "enter" : "exit",
      });
      if (nextReady) {
        if (readyBtn.dataset.consentPending === '1') return;
        readyBtn.dataset.consentPending = '1';
        try { await ensureLegalAcceptance(); }
        catch (_) { return; }
        finally { delete readyBtn.dataset.consentPending; }
      }

      if (nextReady && !partyId) {
        const blockReason = getSelectionBlockReason(getCurrentSelection());
        if (blockReason) {
          sonner(null, blockReason, "error");
          return;
        }
      }

      if (partyId) {
        if (readyPending) return;
        if (!socket.connected) {
          sonner("Could not ready up", "Reconnecting to the server. Please try again shortly.", "error");
          return;
        }
        readyPending = true;
        readyTarget = nextReady;
        const requestId = ++readyRequestId;
        setSelfReadyState(nextReady);
        socket.timeout(8000).emit(SOCKET_EVENTS.READY_STATUS, { partyId, ready: nextReady }, async (error, reply) => {
          if (requestId !== readyRequestId || String(partyId) !== String(getActivePartyId())) return;
          readyPending = false;
          readyTarget = null;
          syncReadyAvailability();
          if (error || !reply?.ok) {
            setSelfReadyState(!nextReady);
            sonner(reply?.code === "MAINTENANCE" ? null : "Could not change ready status", reply?.code === "MAINTENANCE" ? MAINTENANCE_MESSAGE : reply?.error || "Your ready status could not be saved. Please try again.", "error", { maintenanceUntil: reply?.code === "MAINTENANCE" ? reply.maintenanceUntil : null });
          }
          if (!error && reply?.ok) return;
          // Refresh after a failed acknowledgement or timeout; never leave an unconfirmed
          // optimistic ready state on screen.
          try {
            const roster = await postJson(API_PATHS.PARTY_MEMBERS, { partyId });
            if (requestId === readyRequestId && String(partyId) === String(getActivePartyId())) {
              renderPartyMembers(roster);
              syncReadyButtonFromSelfSlot();
            }
          } catch (_) {}
        });
        return;
      }

      // Solo queue feedback is local until the matchmaking response arrives.
      setSelfReadyState(nextReady);
      // Solo flow: directly join/leave the queue and control overlay locally.
      if (nextReady) getMatchmaking().startSolo(getCurrentSelection());
      else getMatchmaking().leaveSolo();
    });
  }

  function syncReadyAvailability(selection = getCurrentSelection()) {
    const btn = document.getElementById("ready");
    if (!btn) return { blocked: false, reason: "" };

    const normalized = normalizeGameSelection(selection);
    const partyBattleInProgress = Boolean(getActivePartyId() && activeBattleMatchId);
    btn.classList.toggle("battle-in-progress", partyBattleInProgress);
    if (partyBattleInProgress) {
      btn.value = "Battle In Progress";
      btn.disabled = false;
      btn.title = "Return to your battle";
      btn.classList.remove("is-disabled", "cancel");
      return { blocked: false, reason: "", selection: normalized };
    }
    const reason = getSelectionBlockReason(normalized, { usePartyHostAccess: Boolean(getActivePartyId()) });
    const blocked = Boolean(reason);
    const isCancelState = btn.classList.contains("cancel");

    btn.disabled = readyPending || (blocked && !isCancelState);
    btn.title = blocked ? reason : "";
    btn.classList.toggle("is-disabled", blocked && !isCancelState);

    if (!isCancelState) {
      btn.value = blocked ? "Unavailable" : "Ready";
    }

    return { blocked, reason, selection: normalized };
  }

  function resetSelfReadyState() {
    try {
      setSelfReadyState(false);
    } catch (_) {}
  }

  function setSelfReadyState(ready) {
    const slot = getSelfSlot();
    const statusEl = slotField(slot, "status");
    const status = ready ? "ready" : "online";
    if (statusEl) {
      const previous = statusEl.textContent;
      statusEl.textContent = status;
      statusEl.className = `status ${status}`;
      applyLobbyStatusVisualState(slot, previous, status);
    }
    setReadyButtonState(ready);
  }

  function setReadyButtonState(isCancel) {
    // Inert also blocks keyboard activation and dynamically rendered controls.
    // Chat and friends live outside these lobby groups.
    document.body.classList.toggle("lobby-ready", isCancel);
    if (isCancel) {
      document.querySelectorAll("#navbar, .lobby-party-actions, .lobby-quick-actions, #bottom-bar .dropdown-group, #lobby-area").forEach((root) => {
        if (!lockedRoots.has(root)) lockedRoots.set(root, root.inert);
        root.inert = true;
      });
    } else {
      for (const [root, wasInert] of lockedRoots) root.inert = wasInert;
      lockedRoots.clear();
    }
    getNavigation()?.lobbyAudio?.setReady(isCancel);
    const btn = document.getElementById("ready");
    if (!btn) return;
    // Input[type=submit] uses value for its label
    btn.value = isCancel ? "Cancel" : "Ready";
    if (isCancel) btn.classList.add("cancel");
    else btn.classList.remove("cancel");
    syncReadyAvailability();
  }

  function syncReadyButtonFromSelfSlot() {
    if (readyPending && readyTarget !== null) {
      setSelfReadyState(readyTarget);
      return;
    }
    const selfSlot = getSelfSlot();
    const statusEl = slotField(selfSlot, "status");
    if (!statusEl) return;
    const isReady = (statusEl.textContent || "").trim().toLowerCase() === "ready";
    setReadyButtonState(isReady);
  }

  function resetReadyRequest() {
    readyPending = false;
    readyTarget = null;
    ++readyRequestId;
    activeBattleMatchId = null;
  }

  function setActiveBattleMatch(matchId) {
    activeBattleMatchId = Number(matchId) > 0 ? Number(matchId) : null;
  }

  return {
    initReadyToggle,
    resetReadyRequest,
    resetSelfReadyState,
    setReadyButtonState,
    syncReadyAvailability,
    syncReadyButtonFromSelfSlot,
    setActiveBattleMatch,
    isInBattle: () => Boolean(activeBattleMatchId),
  };
}
