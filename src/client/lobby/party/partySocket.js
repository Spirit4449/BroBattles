import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { postJson } from "../../lib/http.js";
import { checkIfInParty, getActivePartyId, getCurrentLobbyUserName, getLobbyMemberKey, partyContext, replacePartyContext } from "./partyState.js";
import { SLOT_SELECTOR, slotField } from "./slotDom.js";
import { refreshPlatformGrounding } from "./platformGrounding.mjs";
import { setLobbyBackground } from "../lobbyBackground.js";
import { createJoinRequestController } from './joinRequestController';
import { sonner } from "../../ui/sonner.js";
import socket, { ensureSocketConnected } from "../../lib/socket";
import { applyLobbyStatusVisualState, normalizeStatusLabel, statusToClass } from "./slotEffects.js";
import { wirePartyBotSlotControls } from "./botSlotPicker.js";
import { getPlayersPerTeamForSelection } from "../../lib/gameSelectionCatalog.js";
import { MATCH_ID_KEY, POST_BATTLE_LOBBY_RETURN_KEY } from "../../lib/storageKeys.js";
import { getCurrentMapValue, applyPlatformImageForMap, animatePlatformsForMapSwitch, updatePlatformsForMode } from "./partyPlatforms.js";

export function consumeBattleLobbyReturnFlag() {
  try {
    const shouldReset =
      sessionStorage.getItem(POST_BATTLE_LOBBY_RETURN_KEY) === "1";
    sessionStorage.removeItem(POST_BATTLE_LOBBY_RETURN_KEY);
    sessionStorage.removeItem(MATCH_ID_KEY);
    return shouldReset;
  } catch (_) {
    return false;
  }
}

export function createPartySocket({ matchmaking, pickers, ready, roster }) {
  const { writeSelectionToDom } = pickers;
  const { renderPartyMembers } = roster;
  const { initReadyToggle, setActiveBattleMatch, setReadyButtonState, syncReadyAvailability, syncReadyButtonFromSelfSlot } = ready;

  let rosterNames = null;

  let rosterPartyId = null;

  let battleReturnPageshowBound = false;

  const joinRequests = createJoinRequestController({ socket, checkIfInParty, getActivePartyId });

  const { showPartyJoinRequestScreen, hidePartyJoinRequestScreen, loadPendingJoinRequests } = joinRequests;

  let heartbeatTimer;

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    const ping = () => { if (socket.connected) socket.emit(SOCKET_EVENTS.LOBBY_HEARTBEAT); };
    ping();
    heartbeatTimer = setInterval(ping, 4000);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
  }

  function socketInit(options = {}) {
    joinRequests.initialize(options?.profilePopup);
    wirePartyBotSlotControls({
      getActivePartyId,
      isPartyOwner: () => partyContext.ownerName === getCurrentLobbyUserName(),
    });
    let byeSent = false;

    // Safety: if code runs before index.js triggered connection (e.g., alternate entry), ensure connect once.
    if (!socket.connected) ensureSocketConnected();

    if (!battleReturnPageshowBound) {
      battleReturnPageshowBound = true;
      window.addEventListener("pageshow", () => {
        byeSent = false;
        // Browser Back can restore this page without the results screen's OK flag.
        setActiveBattleMatch(null);
        syncReadyButtonFromSelfSlot();
        syncReadyAvailability();
        if (socket.connected) startHeartbeat();
        else ensureSocketConnected();
        if (!consumeBattleLobbyReturnFlag()) return;
        matchmaking.restoreAfterBattleReturn();
      });
    }

    if (matchmaking.isSuppressed()) matchmaking.restoreAfterBattleReturn();

    socket.on(SOCKET_EVENTS.PRESENCE_SELF, ({ matchId }) => {
      setActiveBattleMatch(matchId);
      syncReadyButtonFromSelfSlot();
      syncReadyAvailability();
    });
    if (socket.connected) startHeartbeat();

    // Connection lifecycle
    socket.on(SOCKET_EVENTS.CONNECT, () => {
      const currentPartyId = getActivePartyId();
      startHeartbeat();
      if (currentPartyId) {
        void loadPendingJoinRequests(currentPartyId);
      }
    });

    socket.on(SOCKET_EVENTS.CONNECT_ERROR, (error) => {
      const currentPartyId = getActivePartyId();
      console.error("[socket] connect_error", {
        message: error?.message || String(error),
        description: error?.description || null,
        context: error?.context || null,
        currentPartyId: currentPartyId || null,
        href: window.location.href,
        cookieEnabled: navigator.cookieEnabled,
      });
    });

    socket.on(SOCKET_EVENTS.RECONNECT_ATTEMPT, (attempt) => {
      const currentPartyId = getActivePartyId();
      console.warn("[socket] reconnect_attempt", {
        attempt,
        currentPartyId: currentPartyId || null,
      });
    });

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
      setActiveBattleMatch(null);
      syncReadyAvailability();
      stopHeartbeat();
    });

    // Proactively notify server before tab closes or navigates away
    function sendByeOnce() {
      if (byeSent) return;
      byeSent = true;
      try {
        socket.emit(SOCKET_EVENTS.CLIENT_BYE);
      } catch {}
    }
    // beforeunload fires on close/refresh/navigation. Does not fire on switching tabs.
    window.addEventListener("beforeunload", sendByeOnce);
    // pagehide also indicates leaving the page (including bfcache), not just switching tabs
    window.addEventListener("pagehide", sendByeOnce);

    // Server tells us which room we're in (party or lobby)
    socket.on(SOCKET_EVENTS.PARTY_JOINED, ({ partyId }) => {
      startHeartbeat();
      // Reset roster baseline when switching rooms
      resetRosterNotifications(partyId);
      replacePartyContext(partyId, partyId
        ? { ...partyContext, partyId }
        : { hideEnemyBros: partyContext.hideEnemyBros });
    });

    // Live roster updates for the party
    socket.on(SOCKET_EVENTS.PARTY_MEMBERS, (data) => {
      try {
        // If this update isn't for our current party page, ignore
        if (String(data.partyId || '') !== String(checkIfInParty() || ''))
          return;

        // Toasts: detect joins/leaves vs previous roster
        try {
          const currentUserName = getCurrentLobbyUserName();
          const newNames = new Set(
            (Array.isArray(data?.members) ? data.members : [])
              .map((m) => m?.name)
              .filter(Boolean),
          );
          // Reset baseline on first render or party change
          if (
            !rosterNames ||
            rosterPartyId !== data?.partyId ||
            !(rosterNames instanceof Set)
          ) {
            rosterNames = new Set(newNames);
            rosterPartyId = data?.partyId || null;
          } else {
            // Additions
            for (const name of newNames) {
              if (!rosterNames.has(name) && getLobbyMemberKey(name) !== getLobbyMemberKey(currentUserName)) {
                sonner(`${name} joined your party`, null, "OK", null, {
                  duration: 2000,
                  sound: "playerJoin",
                });
              }
            }
            // Removals
            for (const old of rosterNames) {
              if (!newNames.has(old) && old !== currentUserName) {
                sonner(`${old} left your party`, null, "OK", null, {
                  duration: 2000,
                  sound: "notification",
                });
              }
            }
            // Update baseline
            rosterNames = new Set(newNames);
          }
        } catch (e) {
          console.warn("[party] roster diff failed", e);
        }

        // Sync mode/map dropdowns if present
        const selection = writeSelectionToDom(
          {
            modeId: data?.selection?.modeId || data?.modeId,
            modeVariantId:
              data?.selection?.modeVariantId ||
              data?.modeVariantId,
            mapId: data?.selection?.mapId ?? data?.map ?? null,
          },
          { persist: false },
        );

        // Keep lobby visuals in sync with authoritative party map/mode.
        if (selection.mapId != null) {
          setLobbyBackground(String(selection.mapId));
          applyPlatformImageForMap(String(selection.mapId));
          refreshPlatformGrounding();
        }
        // Use the real team size: the legacy mode is 1 for every non-duels mode,
        // which collapses the 3v3 Bank Bust platforms while a slot move settles.
        updatePlatformsForMode(getPlayersPerTeamForSelection(selection));

        // Render minimal 1v1 view into the existing two slots if available
        renderPartyMembers({
          ...data,
          selection,
          mode: getPlayersPerTeamForSelection(selection),
          map: selection.mapId,
        });
        // Re-bind ready toggle on your slot after DOM updates
        initReadyToggle();
        // Ensure the bottom Ready button reflects current user's status
        try {
          syncReadyButtonFromSelfSlot();
        } catch (_) {}
      } catch (e) {
        console.warn("[socket] party:members render failed", e);
      }
    });

    socket.on(SOCKET_EVENTS.PARTY_BOT_SLOTS, (data) => {
      if (String(data?.partyId) !== String(getActivePartyId())) return;
      partyContext.botSlots = Array.isArray(data?.botSlots) ? data.botSlots : [];
      renderPartyMembers({ ...partyContext, botSlots: partyContext.botSlots });
    });

    joinRequests.registerEvents();

    // Presence/status changes: update the matching slot if visible
    socket.on(SOCKET_EVENTS.STATUS_UPDATE, (evt) => {
      const currentPartyId = getActivePartyId();
      if (currentPartyId && String(evt.partyId) !== String(currentPartyId))
        return;
      const normalized = normalizeStatusLabel(evt.status || "online");
      const targetName = String(evt.name || "").trim();
      if (targetName) {
        const member = Array.isArray(partyContext.members)
          ? partyContext.members.find(
              (item) =>
                String(item?.name || "")
                  .trim()
                  .toLowerCase() === targetName.toLowerCase(),
            )
          : null;
        if (member) {
          member.status = normalized;
        }
      }
      const slots = document.querySelectorAll(SLOT_SELECTOR);
      for (const slot of slots) {
        if (!slot) continue;
        const nameEl = slotField(slot, "username");
        const statusEl = slotField(slot, "status");
        if (!nameEl || !statusEl) continue;
        const text = nameEl.textContent || "";
        if (text === evt.name || text === `${evt.name} (You)`) {
          const previousStatus = statusEl.textContent || "";
          statusEl.textContent = normalized;
          statusEl.className = `status ${statusToClass(normalized)}`;
          // This event reaches every socket in the party room before the full
          // roster refresh, so all clients play the transition on the same slot.
          applyLobbyStatusVisualState(slot, previousStatus, normalized);
          // If this status belongs to current user, reflect it on the Ready button
          const currentUserName =
            document.getElementById("username-text")?.textContent || "";
          const isSelf = evt.name === currentUserName;
          if (isSelf) {
            const isReady = String(normalized || "")
              .trim().toLowerCase() === "ready";
            setReadyButtonState(!!isReady);
          }
        }
      }
    });

    socket.on(SOCKET_EVENTS.PARTY_SELECTION_DENIED, async (data) => {
      if (String(data?.partyId) !== String(getActivePartyId())) return;
      sonner("Could not change map or mode", data?.error, "error");
      try {
        const party = await postJson(API_PATHS.PARTY_MEMBERS, { partyId: getActivePartyId() });
        if (String(party.partyId) !== String(getActivePartyId())) return;
        writeSelectionToDom(party.selection);
        setLobbyBackground(party.selection.mapId);
        applyPlatformImageForMap(party.selection.mapId);
        refreshPlatformGrounding();
        renderPartyMembers(party);
      } catch (error) {
        console.warn("Could not refresh party selection", error);
      }
    });

    // Mode change updates
    socket.on(SOCKET_EVENTS.MODE_CHANGE, (data) => {
      const currentPartyId = getActivePartyId();
      if (String(data.partyId || '') !== String(checkIfInParty() || ''))
        return;

      const selection = writeSelectionToDom(
        {
          modeId: data?.selection?.modeId || data?.modeId,
          modeVariantId:
            data?.selection?.modeVariantId ||
            data?.modeVariantId ||
            data?.selectedValue,
          mapId: data?.selection?.mapId ?? getCurrentMapValue(),
        },
        { persist: false },
      );

      // Update platforms for new mode
      updatePlatformsForMode(getPlayersPerTeamForSelection(selection));
      if (selection.mapId != null) {
        setLobbyBackground(selection.mapId);
        applyPlatformImageForMap(selection.mapId);
        refreshPlatformGrounding();
      }

      // Re-render members in new platform layout
      if (data.members) {
        renderPartyMembers({
          partyId: currentPartyId,
          members: data.members,
          botSlots: data.botSlots,
          selection,
          mode: getPlayersPerTeamForSelection(selection),
          map: selection.mapId,
        });
      }
    });

    // Map change updates
    socket.on(SOCKET_EVENTS.MAP_CHANGE, (data) => {
      if (String(data.partyId || '') !== String(checkIfInParty() || ''))
        return;

      const selection = writeSelectionToDom(
        {
          modeId:
            data?.selection?.modeId || document.getElementById("mode-id")?.value,
          modeVariantId:
            data?.selection?.modeVariantId ||
            document.getElementById("mode-variant-id")?.value,
          mapId: data?.selection?.mapId ?? data?.selectedValue ?? data?.map,
        },
        { persist: false },
      );

      // Update lobby background
      if (selection.mapId != null) {
        setLobbyBackground(selection.mapId);
        applyPlatformImageForMap(selection.mapId);
      }
      refreshPlatformGrounding();
      animatePlatformsForMapSwitch();
    });

    socket.on(SOCKET_EVENTS.PARTY_NOTICE, (data) => {
      const currentPartyId = getActivePartyId();
      if (currentPartyId && String(data?.partyId) !== String(currentPartyId))
        return;
      if (["map", "mode"].includes(data?.type) &&
          String(data?.actorName || "").trim().toLowerCase() === getCurrentLobbyUserName().toLowerCase()) return;
      const title = String(data?.title || "Party update").trim();
      const message = String(data?.message || "").trim();
      sonner(title, message || undefined, "OK", undefined, {
        duration: 2500,
        sound: "notification",
      });
    });

    // Party-wide: everyone ready -> show matchmaking overlay
    matchmaking.bindSocketEvents();

    socket.on(SOCKET_EVENTS.PARTY_KICKED, (data) => {
      sonner(
        null,
        data?.actorName
          ? `${data.actorName} removed you from the party.`
          : "You were removed from the party.",
        "error",
      );
      hidePartyJoinRequestScreen();
      window.location.href = "/";
    });
  }

  function resetRosterNotifications(partyId) {
    rosterNames = null;
    rosterPartyId = partyId || null;
  }

  return { socketInit, resetRosterNotifications, showPartyJoinRequestScreen, hidePartyJoinRequestScreen };
}
