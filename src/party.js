import { sonner } from "./lib/sonner.js";
import socket, { ensureSocketConnected, waitForConnect } from "./socket";
import { getLobbyPlatformAsset } from "./maps/manifest";

// Track last known party roster to detect joins/leaves
let __partyRosterNames = null; // Set<string> of member names
let __partyRosterPartyId = null;
const SOLO_MODE_STORAGE_KEY = "bb_solo_mode";
const SOLO_MAP_STORAGE_KEY = "bb_solo_map";
let activeQueueContext = null; // { mode, map }
let mmOverlayPlayers = [];
let mmOverlayPlayersSig = "";
let mmOverlayTotal = 0;

function normalizeStatusLabel(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "offline") return "offline";
  if (s === "ready") return "ready";
  if (s === "online" || s === "idle") return "online";
  if (s === "in battle") return "In Battle";
  if (s === "end screen") return "End Screen";
  if (s === "selecting character") return "Selecting Character";
  if (s.startsWith("not ")) return "not ready";
  return status || "online";
}

function getCurrentMapValue() {
  return String(document.getElementById("map")?.value || "1");
}

function applyPlatformImageForMap(mapValue) {
  const platformUrl = getLobbyPlatformAsset(mapValue || getCurrentMapValue());
  const imageEls = document.querySelectorAll(".platform-image");
  for (const imageEl of imageEls) {
    if (!imageEl) continue;
    imageEl.style.backgroundImage = `url("${platformUrl}")`;
  }
}

function animatePlatformsForMapSwitch() {
  const lobbyArea = document.getElementById("lobby-area");
  if (lobbyArea) {
    lobbyArea.classList.add("map-switching");
    setTimeout(() => lobbyArea.classList.remove("map-switching"), 260);
  }
  for (const imageEl of document.querySelectorAll(".platform-image")) {
    imageEl.classList.remove("map-switch");
    void imageEl.offsetWidth;
    imageEl.classList.add("map-switch");
    setTimeout(() => imageEl.classList.remove("map-switch"), 260);
  }
}

function canPersistSoloSelections() {
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

function setSoloSelection(key, value) {
  if (!canPersistSoloSelections()) return;
  try {
    localStorage.setItem(key, String(value));
  } catch (_) {}
}

function getSoloSelection(key) {
  if (!canPersistSoloSelections()) return null;
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

export function checkIfInParty() {
  const pathname = window.location.pathname;
  if (pathname.includes("party")) {
    return pathname.split("/").filter(Boolean).pop();
  }
  return false;
}

export function createParty() {
  fetch("/create-party", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      window.location.href = `/party/${data.partyId}`;
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

export function leaveParty() {
  fetch("/leave-party", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      console.log(data);
      window.location.href = `/`;
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

// Socket heartbeat
let hbTimer;
export function startHeartbeat(partyId) {
  clearInterval(hbTimer);
  if (!partyId) return;
  hbTimer = setInterval(() => socket.emit("heartbeat", partyId), 10000);
}
export function stopHeartbeat() {
  clearInterval(hbTimer);
}

// ---------------------------
// Socket
// ---------------------------

export function socketInit() {
  const currentPartyId = checkIfInParty();

  // Safety: if code runs before index.js triggered connection (e.g., alternate entry), ensure connect once.
  if (!socket.connected) ensureSocketConnected();

  // Connection lifecycle
  socket.on("connect", () => {
    console.log("[socket] connected", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected", reason);
    stopHeartbeat();
  });

  // Proactively notify server before tab closes or navigates away
  let byeSent = false;
  function sendByeOnce() {
    if (byeSent) return;
    byeSent = true;
    try {
      socket.emit("client:bye");
    } catch {}
  }
  // beforeunload fires on close/refresh/navigation. Does not fire on switching tabs.
  window.addEventListener("beforeunload", sendByeOnce);
  // pagehide also indicates leaving the page (including bfcache), not just switching tabs
  window.addEventListener("pagehide", sendByeOnce, { once: true });

  // Server tells us which room we're in (party or lobby)
  socket.on("party:joined", ({ partyId }) => {
    console.log("[socket] joined room", partyId ?? "lobby");
    if (partyId) startHeartbeat(partyId);
    else stopHeartbeat();
    // Reset roster baseline when switching rooms
    __partyRosterNames = null;
    __partyRosterPartyId = partyId || null;
  });

  // Live roster updates for the party
  socket.on("party:members", (data) => {
    try {
      console.log("[party] party:members", {
        partyId: data?.partyId,
        mode: data?.mode,
        membersCount: Array.isArray(data?.members) ? data.members.length : 0,
      });
      // If this update isn't for our current party page, ignore
      if (currentPartyId && String(data.partyId) !== String(currentPartyId))
        return;

      // Toasts: detect joins/leaves vs previous roster
      try {
        const currentUserName =
          document.getElementById("username-text")?.textContent || "";
        const newNames = new Set(
          (Array.isArray(data?.members) ? data.members : [])
            .map((m) => m?.name)
            .filter(Boolean),
        );
        // Reset baseline on first render or party change
        if (
          !__partyRosterNames ||
          __partyRosterPartyId !== data?.partyId ||
          !(__partyRosterNames instanceof Set)
        ) {
          __partyRosterNames = new Set(newNames);
          __partyRosterPartyId = data?.partyId || null;
        } else {
          // Additions
          for (const name of newNames) {
            if (!__partyRosterNames.has(name) && name !== currentUserName) {
              sonner(`${name} joined your party`, null, "OK", null, {
                duration: 2000,
                sound: "notification",
              });
            }
          }
          // Removals
          for (const old of __partyRosterNames) {
            if (!newNames.has(old) && old !== currentUserName) {
              sonner(`${old} left your party`, null, "OK", null, {
                duration: 2000,
                sound: "notification",
              });
            }
          }
          // Update baseline
          __partyRosterNames = new Set(newNames);
        }
      } catch (e) {
        console.warn("[party] roster diff failed", e);
      }

      // Sync mode/map dropdowns if present
      const modeSel = document.getElementById("mode");
      if (modeSel && data.mode) {
        modeSel.value = String(data.mode);
        setSoloSelection(SOLO_MODE_STORAGE_KEY, modeSel.value);
      }
      const mapSel = document.getElementById("map");
      if (mapSel && data.map) {
        mapSel.value = String(data.map);
        setSoloSelection(SOLO_MAP_STORAGE_KEY, mapSel.value);
      }

      // Keep lobby visuals in sync with authoritative party map/mode.
      if (data.map) {
        setLobbyBackground(String(data.map));
        applyPlatformImageForMap(String(data.map));
      }
      if (data.mode) {
        updatePlatformsForMode(String(data.mode));
      }

      // Render minimal 1v1 view into the existing two slots if available
      renderPartyMembers(data);
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

  // Presence/status changes: update the matching slot if visible
  socket.on("status:update", (evt) => {
    if (currentPartyId && String(evt.partyId) !== String(currentPartyId))
      return;
    const slots = document.querySelectorAll(".character-slot");
    for (const slot of slots) {
      if (!slot) continue;
      const nameEl = slot.querySelector(".username");
      const statusEl = slot.querySelector(".status");
      if (!nameEl || !statusEl) continue;
      const text = nameEl.textContent || "";
      if (text === evt.name || text === `${evt.name} (You)`) {
        const normalized = normalizeStatusLabel(evt.status || "online");
        statusEl.textContent = normalized;
        statusEl.className = `status ${statusToClass(normalized)}`;
        // If this status belongs to current user, reflect it on the Ready button
        const currentUserName =
          document.getElementById("username-text")?.textContent || "";
        const isSelf = evt.name === currentUserName;
        if (isSelf) {
          const isReady = String(normalized || "")
            .toLowerCase()
            .includes("ready");
          setReadyButtonState(!!isReady);
        }
      }
    }
  });

  // Mode change updates
  socket.on("mode-change", (data) => {
    if (currentPartyId && String(data.partyId) !== String(currentPartyId))
      return;

    const modeDropdown = document.getElementById("mode");
    if (modeDropdown) {
      modeDropdown.value = data.selectedValue || data.mode;
      setSoloSelection(SOLO_MODE_STORAGE_KEY, modeDropdown.value);
    }

    // Update platforms for new mode
    updatePlatformsForMode(data.selectedValue || data.mode);

    // Re-render members in new platform layout
    if (data.members) {
      renderPartyMembers({
        partyId: currentPartyId,
        members: data.members,
        mode: data.selectedValue || data.mode,
        map: data.map,
      });
    }
  });

  // Map change updates
  socket.on("map-change", (data) => {
    if (currentPartyId && String(data.partyId) !== String(currentPartyId))
      return;

    const mapDropdown = document.getElementById("map");
    if (mapDropdown) {
      mapDropdown.value = data.selectedValue || data.map;
      setSoloSelection(SOLO_MAP_STORAGE_KEY, mapDropdown.value);
    }

    // Update lobby background
    setLobbyBackground(data.selectedValue || data.map);
    applyPlatformImageForMap(data.selectedValue || data.map);
    animatePlatformsForMapSwitch();
  });

  // Party-wide: everyone ready -> show matchmaking overlay
  socket.on("party:matchmaking:start", ({ partyId }) => {
    if (currentPartyId && String(partyId) !== String(currentPartyId)) return;
    const mode = Number(document.getElementById("mode")?.value) || 1;
    const map = Number(document.getElementById("map")?.value) || 1;
    activeQueueContext = { mode, map };
    mmOverlayPlayers = [];
    mmOverlayPlayersSig = "";
    mmOverlayTotal = mode * 2;
    showMatchmakingOverlay();
    updateMMOverlay({
      found: 0,
      total: mode * 2,
      mode,
      map,
      players: [],
    });
  });

  socket.on("queue:joined", (payload) => {
    const mode = Number(payload?.mode) || 1;
    const map = Number(payload?.map) || 1;
    activeQueueContext = { mode, map };
    mmOverlayPlayers = [];
    mmOverlayPlayersSig = "";
    mmOverlayTotal = mode * 2;
    showMatchmakingOverlay();
    updateMMOverlay({
      found: 0,
      total: mode * 2,
      mode,
      map,
      players: [],
    });
  });

  // When a match is found, update overlay and auto-ack ready for this client
  socket.on("match:found", (payload) => {
    // payload: { matchId, mode, map, yourTeam, players }
    const payloadMode = Number(payload?.mode) || 1;
    const payloadMap = Number(payload?.map) || 1;
    activeQueueContext = { mode: payloadMode, map: payloadMap };
    mmOverlayPlayers = Array.isArray(payload?.players) ? payload.players : [];
    mmOverlayPlayersSig = JSON.stringify(
      mmOverlayPlayers.map((p) => `${p?.name || ""}:${p?.char_class || ""}`),
    );
    mmOverlayTotal = payloadMode * 2;
    updateMMOverlay({
      found: mmOverlayPlayers.length,
      total: payloadMode * 2,
      mode: payloadMode,
      map: payloadMap,
      players: mmOverlayPlayers,
    });
    if (payload?.matchId) {
      socket.emit("ready:ack", { matchId: payload.matchId });
    }
  });

  // When match is ready to start, redirect to game
  socket.on("match:gameReady", async (payload) => {
    try {
      const { matchId } = payload;
      if (!matchId) {
        console.error("No matchId in gameReady payload");
        return;
      }

      console.log("Match ready! Redirecting to game...", matchId);

      // Store match info for game page
      sessionStorage.setItem("matchId", matchId);
      activeQueueContext = null;

      // Redirect to game page using new URL format
      window.location.href = `/game/${matchId}`;
    } catch (error) {
      console.error("Error handling match:gameReady:", error);
      sonner("Game Error", "Failed to join game", "error");
    }
  });

  // Queue error -> notify and hide overlay (useful for solo flow)
  socket.on("queue:error", (err) => {
    try {
      hideMatchmakingOverlay();
      mmOverlayPlayers = [];
      mmOverlayPlayersSig = "";
      mmOverlayTotal = 0;
      if (err?.message) {
        sonner("Queue error", err.message, "error", { sound: "notification" });
      }
      // Reset local ready state so next click attempts to join again
      const selfSlot = Array.from(
        document.querySelectorAll(".character-slot"),
      ).find((s) => s.dataset.isCurrentUser === "true");
      const statusEl = selfSlot?.querySelector(".status");
      if (statusEl) {
        statusEl.textContent = "online";
        statusEl.className = "status online";
      }
      // Reset bottom Ready button
      setReadyButtonState(false);
    } catch (_) {}
  });

  // Match cancelled (e.g., ready timeout) -> hide overlay
  socket.on("match:cancelled", (data) => {
    const overlay = document.getElementById("matchmaking-overlay");
    if (data?.reason && overlay && !overlay.classList.contains("hidden")) {
      sonner("Cancelled matchmaking", data.reason, null, null, {
        duration: 3000,
        sound: "notification",
      });
    }
    hideMatchmakingOverlay();
    activeQueueContext = null;
    mmOverlayPlayers = [];
    mmOverlayPlayersSig = "";
    mmOverlayTotal = 0;
    // Reset your local ready state so next click sets Ready (prevents double-click issue)
    try {
      const selfSlot = Array.from(
        document.querySelectorAll(".character-slot"),
      ).find((s) => s.dataset.isCurrentUser === "true");
      const statusEl = selfSlot?.querySelector(".status");
      if (statusEl) {
        statusEl.textContent = "online";
        statusEl.className = "status online";
      }
      setReadyButtonState(false);
    } catch {}
  });

  // Progressive matching updates: incrementally update overlay found count
  socket.on("match:progress", (data) => {
    const currentMode = Number(document.getElementById("mode")?.value) || 1;
    const currentMap = Number(document.getElementById("map")?.value) || 1;
    const targetMode = Number(activeQueueContext?.mode) || currentMode;
    const targetMap = Number(activeQueueContext?.map) || currentMap;
    // Only update if it matches the current selection
    if (Number(data?.mode) !== targetMode || Number(data?.map) !== targetMap)
      return;

    // Keep overlay context aligned to server payload while queued.
    activeQueueContext = {
      mode: Number(data?.mode) || targetMode,
      map: Number(data?.map) || targetMap,
    };

    const overlay = document.getElementById("matchmaking-overlay");
    if (overlay && overlay.classList.contains("hidden")) {
      showMatchmakingOverlay();
    }
    const incomingPlayers = Array.isArray(data?.players) ? data.players : null;
    if (incomingPlayers) {
      const nextSig = JSON.stringify(
        incomingPlayers.map((p) => `${p?.name || ""}:${p?.char_class || ""}`),
      );
      if (nextSig !== mmOverlayPlayersSig) {
        mmOverlayPlayersSig = nextSig;
        mmOverlayPlayers = incomingPlayers;
      }
    }
    mmOverlayTotal = Number(data?.total) || targetMode * 2;
    updateMMOverlay({
      found: Number(data?.found) || 0,
      total: mmOverlayTotal,
      mode: Number(data?.mode) || targetMode,
      map: Number(data?.map) || targetMap,
      players: mmOverlayPlayers,
    });
  });

  // // Member join/leave events
  // socket.on("user-joined", (data) => {
  //   if (currentPartyId && String(data.partyId) !== String(currentPartyId)) {
  //     return;
  //   }

  //   console.log(`[party] ${data.name} joined the party`);

  //   // Fetch updated party data to refresh the view
  //   if (currentPartyId) {
  //     fetch("/partydata", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       credentials: "same-origin",
  //       body: JSON.stringify({ partyId: currentPartyId }),
  //     })
  //       .then((resp) => resp.json())
  //       .then((partyData) => {
  //         if (partyData?.members) {
  //           renderPartyMembers({
  //             partyId: currentPartyId,
  //             members: partyData.members,
  //             mode: partyData?.party?.mode,
  //             map: partyData?.party?.map,
  //           });
  //         }
  //       })
  //       .catch((err) =>
  //         console.warn("Failed to fetch party data after user join:", err)
  //       );
  //   }
  // });

  // socket.on("user-disconnected", (data) => {
  //   if (currentPartyId && String(data.partyId) !== String(currentPartyId))
  //     return;

  //   console.log(`[party] ${data.name} left the party`);

  //   // Find and reset the slot for the disconnected user
  //   const userSlots = document.querySelectorAll(".character-slot");
  //   for (const slot of userSlots) {
  //     const usernameElement = slot.querySelector(".username");
  //     if (
  //       usernameElement &&
  //       (usernameElement.textContent === data.name ||
  //         usernameElement.textContent === `${data.name} (You)`)
  //     ) {
  //       resetSlotToRandom(slot);
  //       break;
  //     }
  //   }
  // });
}

export function renderPartyMembers(data) {
  const members = Array.isArray(data.members) ? data.members : [];
  const currentUserName =
    document.getElementById("username-text")?.textContent || "";

  // Ensure platforms match the current mode
  if (data.mode) {
    updatePlatformsForMode(data.mode);
  }

  console.log("[party] renderPartyMembers()", {
    partyId: data?.partyId,
    mode: data?.mode,
    currentUserName,
    members: members.map((m) => ({
      name: m?.name,
      team: m?.team,
      status: m?.status,
      char_class: m?.char_class,
    })),
  });

  // Get all character slots
  const allSlots = document.querySelectorAll(".character-slot");
  console.log("[party] slots found:", allSlots.length);

  // Reset all slots to Random first
  allSlots.forEach((slot) => {
    resetSlotToRandom(slot);
  });

  // If we have members, place them in slots
  if (members.length > 0) {
    // Find the current user to determine their team
    const currentUser = members.find((m) => m.name === currentUserName);
    const currentUserTeam = currentUser ? currentUser.team : "team1";

    // Separate members by teams
    const team1Members = members.filter((m) => m.team === "team1");
    const team2Members = members.filter((m) => m.team === "team2");
    console.log("[party] team split", {
      yourTeam: currentUserTeam,
      team1: team1Members.map((m) => m.name),
      team2: team2Members.map((m) => m.name),
    });

    // Determine which team is "your team" and which is "opponent team"
    let yourTeamMembers, opponentTeamMembers;

    if (currentUserTeam === "team1") {
      yourTeamMembers = team1Members;
      opponentTeamMembers = team2Members;
    } else {
      yourTeamMembers = team2Members;
      opponentTeamMembers = team1Members;
    }

    // Place your team members
    yourTeamMembers.forEach((member, index) => {
      const slotId = `your-slot-${index + 1}`;
      applyMemberToSlot(member, slotId, true);
    });

    // Place opponent team members
    opponentTeamMembers.forEach((member, index) => {
      const slotId = `op-slot-${index + 1}`;
      applyMemberToSlot(member, slotId, false);
    });
  }
}

function applyMemberToSlot(member, slotId, isYourTeam = null) {
  const slot = document.getElementById(slotId);
  if (!slot) {
    console.warn("[party] applyMemberToSlot: slot not found", {
      slotId,
      member,
    });
    return;
  }
  // Helpful debug
  console.log("[party] applyMemberToSlot", {
    slotId,
    memberName: member?.name,
    isYourTeam,
  });
  if (!slot) return;

  const usernameEl = slot.querySelector(".username");
  const spriteEl = slot.querySelector(".character-sprite");
  const statusEl = slot.querySelector(".status");

  if (!member) {
    // Reset to Random state if empty
    resetSlotToRandom(slot);
    return;
  }

  // Fill with member info
  const currentUserName =
    document.getElementById("username-text")?.textContent || "";
  const isCurrentUser = member.name === currentUserName;
  const displayName = isCurrentUser ? `${member.name} (You)` : member.name;
  // Mark slot ownership for delegated handlers
  slot.dataset.isCurrentUser = isCurrentUser ? "true" : "false";

  if (usernameEl) {
    usernameEl.textContent = displayName;
    // Set username styling based on team
    if (isYourTeam) {
      usernameEl.className = "username";
    } else {
      usernameEl.className = "username op-player";
    }
  }

  if (spriteEl) {
    const cls = member.char_class || "ninja";
    spriteEl.src = `/assets/${cls}/body.webp`;
    spriteEl.alt = cls;
    spriteEl.classList.remove("random");
    spriteEl.className = "character-sprite";
  }

  if (statusEl) {
    const st = normalizeStatusLabel(member.status || "online");
    statusEl.textContent = st;
    statusEl.className = `status ${statusToClass(st)}`;
    // Remove any previous event listeners
    statusEl.style.pointerEvents = "";
    statusEl.style.cursor = "";
  }

  // Toggle switch-character visibility for current user only
  let switchEl = slot.querySelector(".switch-character");
  if (isCurrentUser) {
    if (!switchEl) {
      switchEl = document.createElement("div");
      switchEl.className = "switch-character";
      const img = document.createElement("img");
      img.src = "/assets/switch.svg";
      img.alt = "";
      img.height = 18;
      switchEl.appendChild(img);
      // Prefer it as first child
      slot.insertBefore(switchEl, slot.firstChild);
    }
    switchEl.style.display = "";
  } else if (switchEl) {
    switchEl.style.display = "none";
  }

  // Set slot style class for outline/visuals and border colors
  if (isYourTeam === null) {
    // Auto-detect based on current user
    isYourTeam = isCurrentUser;
  }

  slot.className = `character-slot ${
    isYourTeam ? "player-display" : "op-display"
  }`;
  slot.dataset.character = member.char_class || "ninja";

  // Set interaction properties
  slot.style.pointerEvents = "auto";
  // Only current user’s slot should look clickable
  slot.style.cursor = isCurrentUser ? "pointer" : "default";
}

function statusToClass(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "offline") return "offline";
  if (s === "in battle") return "in-battle";
  if (s === "end screen") return "end-screen";
  if (s === "selecting character") return "selecting-character";
  // Explicit checks first
  if (s === "online" || s === "idle") return "online";
  if (s === "ready") return "ready";
  if (s === "not ready" || s === "not-ready" || s.startsWith("not "))
    return "not-ready";
  // Semantic hints
  if (s.includes("battle") || s.includes("live")) return "ready";
  if (s.includes("queue")) return "online";
  // Fallbacks
  if (s.includes("ready")) return "ready";
  return "online";
}

// ---------------------------
// Mode & Platform Management
// ---------------------------

export function initializeModeDropdown() {
  const modeDropdown = document.getElementById("mode");
  const mapDropdown = document.getElementById("map");
  const partyId = checkIfInParty();
  const isSolo = !partyId;

  if (!modeDropdown) return;

  if (isSolo) {
    const savedMode = getSoloSelection(SOLO_MODE_STORAGE_KEY);
    if (
      savedMode &&
      modeDropdown.querySelector(`option[value="${savedMode}"]`)
    ) {
      modeDropdown.value = savedMode;
    }
    if (mapDropdown) {
      const savedMap = getSoloSelection(SOLO_MAP_STORAGE_KEY);
      if (
        savedMap &&
        mapDropdown.querySelector(`option[value="${savedMap}"]`)
      ) {
        mapDropdown.value = savedMap;
      }
      setLobbyBackground(mapDropdown.value);
    }
    updatePlatformsForMode(modeDropdown.value);
  }

  let previousModeValue = modeDropdown.value;

  modeDropdown.addEventListener("change", async (event) => {
    const selectedValue = event.target.value;
    const username = document.getElementById("username-text")?.textContent;

    // If in a party, validate and emit socket events
    if (partyId) {
      try {
        // Fetch current party members to validate mode change
        const response = await fetch("/party-members", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ partyId }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch party members");
        }

        const data = await response.json();
        const requiredSlots = Number(selectedValue) * 2;

        if (requiredSlots < data.membersCount) {
          // Too many players for this mode
          sonner(
            "Too many players for this mode!",
            "Please remove 1 or more players before changing to this mode",
            "error",
          );
          modeDropdown.value = previousModeValue;
          return;
        }

        // Update platforms locally first for immediate feedback
        updatePlatformsForMode(selectedValue);

        // Emit mode change to server
        socket.emit("mode-change", {
          selectedValue,
          username,
          partyId,
          members: data.members,
        });

        previousModeValue = selectedValue;
      } catch (error) {
        console.error("Error changing mode:", error);
        sonner(
          "Failed to change mode",
          "Please try again. If the problem persists, try refreshing the page.",
          "error",
        );
        modeDropdown.value = previousModeValue;
      }
    } else {
      // Not in a party - just update platforms locally
      updatePlatformsForMode(selectedValue);
      setSoloSelection(SOLO_MODE_STORAGE_KEY, selectedValue);
      previousModeValue = selectedValue;
    }
  });

  // Map change handler
  if (mapDropdown) {
    mapDropdown.addEventListener("change", (event) => {
      const selectedValue = event.target.value;
      const username = document.getElementById("username-text")?.textContent;

      // Update lobby background immediately
      setLobbyBackground(selectedValue);
      applyPlatformImageForMap(selectedValue);
      animatePlatformsForMapSwitch();

      // If in a party, emit to server
      if (partyId) {
        socket.emit("map-change", {
          selectedValue,
          username,
          partyId,
        });
      } else {
        setSoloSelection(SOLO_MAP_STORAGE_KEY, selectedValue);
      }
    });
  }
}

export function updatePlatformsForMode(mode) {
  const lobbyArea = document.getElementById("lobby-area");
  if (!lobbyArea) return;

  const targetCount = Number(mode) || 1;
  console.log("[party] updatePlatformsForMode", { mode, targetCount });

  // Update lobby area class
  lobbyArea.className = `mode-${targetCount}`;

  // Get existing platforms
  const yourPlatforms = document.querySelectorAll(
    '.platform[data-team="your-team"]',
  );
  const opPlatforms = document.querySelectorAll(
    '.platform[data-team="op-team"]',
  );
  console.log("[party] platform counts", {
    your: yourPlatforms.length,
    op: opPlatforms.length,
  });

  // Remove excess platforms
  if (yourPlatforms.length > targetCount) {
    for (let i = yourPlatforms.length - 1; i >= targetCount; i--) {
      console.log("[party] removing platform index", i + 1);
      yourPlatforms[i].remove();
      opPlatforms[i].remove();
    }
  }

  // Add missing platforms
  if (yourPlatforms.length < targetCount) {
    for (let i = yourPlatforms.length + 1; i <= targetCount; i++) {
      console.log("[party] creating platforms for slot", i);
      createPlatform("your-team", i);
      createPlatform("op-team", i);
    }
  }

  applyPlatformImageForMap(getCurrentMapValue());
}

function createPlatform(team, slotNumber) {
  const lobbyArea = document.getElementById("lobby-area");
  if (!lobbyArea) return;
  console.log("[party] createPlatform", { team, slotNumber });

  // Create platform container
  const platform = document.createElement("div");
  platform.className = `platform ${team}-${slotNumber}`;
  platform.setAttribute("data-team", team);
  platform.setAttribute("data-slot", slotNumber);

  // Create character slot
  const characterSlot = document.createElement("div");
  characterSlot.className = "character-slot empty";
  characterSlot.id = `${
    team === "your-team" ? "your" : "op"
  }-slot-${slotNumber}`;
  characterSlot.dataset.isCurrentUser = "false";

  // Add switch-character control (hidden by default), only on your-team side
  if (team === "your-team") {
    const switchDiv = document.createElement("div");
    switchDiv.className = "switch-character";
    switchDiv.style.display = "none";
    const img = document.createElement("img");
    img.src = "/assets/switch.svg";
    img.alt = "";
    img.height = 18;
    switchDiv.appendChild(img);
    characterSlot.appendChild(switchDiv);
  }

  // Create username element
  const username = document.createElement("div");
  username.className = team === "op-team" ? "username op-player" : "username";
  username.textContent = "Random";

  // Create character sprite
  const sprite = document.createElement("img");
  sprite.className = "character-sprite random";
  sprite.src = "/assets/random.webp";
  sprite.alt = "Random";

  // Create status element with invite functionality
  const status = document.createElement("div");
  status.className = "status invite";
  status.textContent = "Invite";
  status.style.cursor = "pointer";
  status.style.pointerEvents = "auto";

  // Add invite click functionality
  status.addEventListener("click", (event) => {
    event.stopPropagation();
    if (status.classList.contains("invite")) {
      copyInviteToClipboard();
      status.textContent = "Copied!";
      setTimeout(() => {
        status.textContent = "Invite";
      }, 1000);
    }
  });

  // Assemble the structure
  characterSlot.appendChild(username);
  characterSlot.appendChild(sprite);
  characterSlot.appendChild(status);
  platform.appendChild(characterSlot);

  // Add platform image
  const platformImage = document.createElement("div");
  platformImage.className = "platform-image";
  platformImage.style.backgroundImage = `url("${getLobbyPlatformAsset(
    getCurrentMapValue(),
  )}")`;
  platform.appendChild(platformImage);

  lobbyArea.appendChild(platform);
}

function copyInviteToClipboard() {
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        console.log("Invite link copied to clipboard");
      })
      .catch((error) => {
        console.error("Failed to copy text:", error);
      });
  }
}

function resetSlotToRandom(slot) {
  if (!slot) return;
  // Don't destroy stable IDs; just reset content
  const originalId = slot.id;
  console.log("[party] resetSlotToRandom", { id: originalId });
  const username = slot.querySelector(".username");
  const sprite = slot.querySelector(".character-sprite");
  const statusEl = slot.querySelector(".status");

  if (!username || !sprite || !statusEl) return;

  username.textContent = "Random";
  sprite.src = "/assets/random.webp";
  sprite.alt = "Random";
  sprite.classList.add("random");
  statusEl.className = "status invite";
  statusEl.textContent = "Invite";
  statusEl.style.cursor = "pointer";
  statusEl.style.pointerEvents = "auto";
  slot.className = "character-slot empty";
  slot.dataset.character = "Random";
  slot.dataset.isCurrentUser = "false";
  // Hide switch-character if present
  const switchEl = slot.querySelector(".switch-character");
  if (switchEl) switchEl.style.display = "none";
  // Preserve slot.id so future updates can target this slot reliably

  // Re-add invite functionality
  const newStatusEl = statusEl.cloneNode(true);
  statusEl.parentNode.replaceChild(newStatusEl, statusEl);

  newStatusEl.addEventListener("click", (event) => {
    event.stopPropagation();
    if (newStatusEl.classList.contains("invite")) {
      copyInviteToClipboard();
      newStatusEl.textContent = "Copied!";
      setTimeout(() => {
        newStatusEl.textContent = "Invite";
      }, 1000);
    }
  });
}

// Import setLobbyBackground function
import { setLobbyBackground } from "./index.js";

// ---------------------------
// Ready toggle + overlay UI
// ---------------------------

// Attach a click handler to current user's status to toggle ready.
export function initReadyToggle() {
  const partyId = checkIfInParty();
  const readyBtn = document.getElementById("ready");
  if (!readyBtn) return;
  // Avoid duplicate bindings when UI re-renders
  if (readyBtn.dataset.bound === "1") return;
  readyBtn.dataset.bound = "1";

  readyBtn.addEventListener("click", () => {
    // Find current user's status element to update optimistically
    const selfSlot = Array.from(
      document.querySelectorAll(".character-slot"),
    ).find((s) => s.dataset.isCurrentUser === "true");
    const statusEl = selfSlot?.querySelector(".status");
    if (!statusEl) return;

    const cur = (statusEl.textContent || "").toLowerCase();
    const nextReady = !cur.includes("ready");

    // Optimistic local update
    statusEl.textContent = nextReady ? "ready" : "online";
    statusEl.className = `status ${nextReady ? "ready" : "online"}`;
    // Update Ready button appearance/label
    setReadyButtonState(nextReady);

    if (partyId) {
      // Party flow: server will show overlay when all ready
      socket.emit("ready:status", { partyId, ready: nextReady });
    } else {
      // Solo flow: directly join/leave the queue and control overlay locally
      if (nextReady) {
        const mode = Number(document.getElementById("mode")?.value) || 1;
        const map = Number(document.getElementById("map")?.value) || 1;
        const side = "team1"; // default; server may flip if needed
        activeQueueContext = { mode, map };
        socket.emit("queue:join", { mode, map, side });
        showMatchmakingOverlay();
      } else {
        socket.emit("queue:leave");
        hideMatchmakingOverlay();
        activeQueueContext = null;
      }
    }
  });
}

// Static overlay present in HTML; helpers to show/hide and update it
function ensureOverlay() {
  return document.getElementById("matchmaking-overlay");
}

export function showMatchmakingOverlay() {
  const overlay = ensureOverlay();
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  updateMMOverlay({
    found: 0,
    total:
      mmOverlayTotal ||
      (Number(document.getElementById("mode")?.value) || 1) * 2,
    mode: Number(document.getElementById("mode")?.value) || 1,
    map: Number(document.getElementById("map")?.value) || 1,
    players: mmOverlayPlayers,
  });
  wireCancelButton();
}

export function hideMatchmakingOverlay() {
  const overlay = ensureOverlay();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

function mapNameFromId(id) {
  const mapSel = document.getElementById("map");
  if (!mapSel) return String(id);
  const opt = Array.from(mapSel.options).find(
    (o) => Number(o.value) === Number(id),
  );
  return opt ? opt.textContent : String(id);
}

function modeNameFromId(id) {
  const modeSel = document.getElementById("mode");
  if (!modeSel) return `${id}v${id}`;
  const opt = Array.from(modeSel.options).find(
    (o) => Number(o.value) === Number(id),
  );
  return opt ? opt.textContent : `${id}v${id}`;
}

function updateMMOverlay({ found, total, mode, map, players }) {
  const foundEl = document.getElementById("mm-found");
  const totalEl = document.getElementById("mm-total");
  const modeEl = document.getElementById("mm-mode");
  const mapEl = document.getElementById("mm-map");
  const grid = document.getElementById("mm-players");
  if (foundEl) foundEl.textContent = String(found ?? 0);
  if (totalEl) totalEl.textContent = String(total ?? 0);
  if (modeEl) modeEl.textContent = modeNameFromId(mode ?? 1);
  if (mapEl) mapEl.textContent = mapNameFromId(map ?? 1);
  if (grid) {
    const playersArr = Array.isArray(players) ? players : [];
    const nextSig = JSON.stringify({
      total: Number(total ?? 0) || 0,
      players: playersArr.map((p) => `${p?.name || ""}:${p?.char_class || ""}`),
    });
    if (nextSig === grid.dataset.renderSig) return;
    grid.dataset.renderSig = nextSig;

    grid.innerHTML = "";
    const count = Number(total ?? 0) || 0;
    for (let i = 0; i < count; i++) {
      const p = playersArr[i];
      const item = document.createElement("div");
      item.className = "mm-player" + (p ? "" : " placeholder");
      if (p) {
        const img = document.createElement("img");
        const cls = p.char_class || "ninja";
        img.src = `/assets/${cls}/body.webp`;
        img.alt = cls;
        const name = document.createElement("div");
        name.className = "mm-name";
        name.textContent = p.name || "Player";
        item.appendChild(img);
        item.appendChild(name);
      } else {
        const name = document.createElement("div");
        name.className = "mm-name";
        name.textContent = "Waiting...";
        item.appendChild(name);
      }
      grid.appendChild(item);
    }
  }
}

function collectCurrentPartyMembers() {
  // Build a list from current DOM-rendered party roster if available
  const cards = [];
  const slots = document.querySelectorAll(".character-slot");
  for (const slot of slots) {
    const uname = slot.querySelector(".username")?.textContent || "";
    const isRandom = uname.trim().toLowerCase().startsWith("random");
    if (isRandom) continue;
    const name = uname.replace(" (You)", "");
    const cls =
      slot.dataset.character && slot.dataset.character !== "Random"
        ? slot.dataset.character
        : null;
    cards.push({ name, char_class: cls || "ninja" });
  }
  return cards;
}

function wireCancelButton() {
  const btn = document.getElementById("mm-cancel");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    hideMatchmakingOverlay();
    const partyId = checkIfInParty();
    if (partyId) {
      socket.emit("ready:status", { partyId, ready: false });
    } else {
      socket.emit("queue:leave");
    }
    activeQueueContext = null;
    mmOverlayPlayers = [];
    mmOverlayPlayersSig = "";
    mmOverlayTotal = 0;
    // Also reset local ready state immediately
    try {
      const selfSlot = Array.from(
        document.querySelectorAll(".character-slot"),
      ).find((s) => s.dataset.isCurrentUser === "true");
      const statusEl = selfSlot?.querySelector(".status");
      if (statusEl) {
        statusEl.textContent = "online";
        statusEl.className = "status online";
      }
      setReadyButtonState(false);
    } catch {}
  });
}

// ---------------------------
// Ready button helpers
// ---------------------------
function setReadyButtonState(isCancel) {
  const btn = document.getElementById("ready");
  if (!btn) return;
  // Input[type=submit] uses value for its label
  btn.value = isCancel ? "Cancel" : "Ready";
  if (isCancel) btn.classList.add("cancel");
  else btn.classList.remove("cancel");
}

function syncReadyButtonFromSelfSlot() {
  const selfSlot = Array.from(
    document.querySelectorAll(".character-slot"),
  ).find((s) => s.dataset.isCurrentUser === "true");
  const statusEl = selfSlot?.querySelector(".status");
  if (!statusEl) return;
  const isReady = (statusEl.textContent || "").toLowerCase().includes("ready");
  setReadyButtonState(isReady);
}
