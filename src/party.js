import { sonner } from "./lib/sonner.js";
import socket, { ensureSocketConnected, waitForConnect } from "./socket";
import { getSharedSelectionPopupShell } from "./lib/selectionPopupShell.js";
import { wireFullscreenToggles } from "./lib/fullscreen.js";
import {
  getLobbyBgAsset,
  getLobbyCharacterOffsetY,
  getMapSelectPreviewAsset,
  getLobbyPlatformAsset,
} from "./maps/manifest";
import { buildCharacterSkinBodyUrl } from "./lib/skinAssets.js";
import {
  getAllGameModes,
  getCompatibleMapsForSelection,
  getMapLabel,
  getModeArtAsset,
  getModeFallbackArtAsset,
  getModeById,
  getModeLabel,
  getModeSelectionStyle,
  getModeSubtitle,
  getPlayersPerTeamForSelection,
  getSelectionBlockReason,
  getSelectionDisplayLabel,
  getTotalPlayersForSelection,
  isSelectionQueueable,
  normalizeGameSelection,
  selectionToLegacyMode,
} from "./lib/gameSelectionCatalog.js";

wireFullscreenToggles();

// Track last known party roster to detect joins/leaves
let __partyRosterNames = null; // Set<string> of member names
let __partyRosterPartyId = null;
let __partyRosterRenderSequence = 0;
let __partyRosterCommitTimer = null;
const __lobbySpawnCleanupTimers = new WeakMap();
const __lobbySpawnEndTimes = new WeakMap();
const __lobbyReadyEffectCleanupTimers = new WeakMap();
const LOBBY_SPAWN_ENTER_MS = 980;
const LOBBY_SPAWN_EXIT_MS = 820;
const SOLO_MODE_STORAGE_KEY = "bb_solo_mode";
const SOLO_MODE_ID_STORAGE_KEY = "bb_solo_mode_id";
const SOLO_MODE_VARIANT_STORAGE_KEY = "bb_solo_mode_variant_id";
const SOLO_MAP_STORAGE_KEY = "bb_solo_map";
const POST_BATTLE_LOBBY_RETURN_KEY = "bb_post_battle_lobby_return";
let activeQueueContext = null; // { selection }
let mmOverlayPlayers = [];
let mmOverlayPlayersSig = "";
let mmOverlayTotal = 0;
let __matchmakingHideTimer = null;
let __matchmakingCountTimer = null;
let __matchmakingReadyAckTimer = null;
let __matchmakingReadyAt = 0;
const MATCHMAKING_EXIT_MS = 190;
const MATCHMAKING_SUCCESS_HOLD_MS = 2400;
let __battleReturnPageshowBound = false;

function consumeBattleLobbyReturnFlag() {
  try {
    const shouldReset =
      sessionStorage.getItem(POST_BATTLE_LOBBY_RETURN_KEY) === "1";
    sessionStorage.removeItem(POST_BATTLE_LOBBY_RETURN_KEY);
    sessionStorage.removeItem("matchId");
    return shouldReset;
  } catch (_) {
    return false;
  }
}

let __postBattleLobbyReturn = consumeBattleLobbyReturnFlag();
let __lobbyOffsetResizeBound = false;
let __mapPopupUi = null;
let __modePopupUi = null;
let __partyContext = {
  partyId: null,
  ownerName: null,
  allowMemberSelection: true,
  isPublic: false,
  publicName: "",
  capacity: null,
  members: [],
};
let __joinRequestProfilePopup = null;
let __joinRequestRequesterState = {
  partyId: null,
  payload: null,
  visible: false,
  autoJoinTimer: null,
  pendingTimer: null,
};
let __joinRequestOwnerState = {
  partyId: null,
  requests: [],
  visible: false,
  expiryTimer: null,
};
const JOIN_REQUEST_TIMEOUT_MS = 15_000;

function getJoinRequestElements() {
  const requesterOverlay = document.getElementById(
    "party-join-request-overlay",
  );
  const ownerOverlay = document.getElementById(
    "party-join-request-owner-overlay",
  );
  return {
    requesterOverlay,
    requesterTitle: document.getElementById("party-join-request-title"),
    requesterBanner: document.getElementById("party-join-request-banner"),
    requesterOwnerName: document.getElementById("party-join-request-owner"),
    requesterPlayers: document.getElementById("party-join-request-players"),
    requesterSubmit: document.getElementById("party-join-request-submit"),
    requesterReturn: document.getElementById("party-join-request-return"),
    ownerOverlay,
    ownerTitle: document.getElementById("party-join-request-owner-title"),
    ownerList: document.getElementById("party-join-request-owner-list"),
    ownerIgnore: document.getElementById("party-join-request-owner-ignore"),
  };
}

function updateJoinRequestChatVisibility() {
  const hasOverlay =
    !!__joinRequestRequesterState.visible || !!__joinRequestOwnerState.visible;
  document.body.classList.toggle("join-request-overlay-open", hasOverlay);
}

function getRequesterPartyLabel(payload) {
  const party = payload?.party || {};
  const publicName = String(
    party?.public_name || party?.publicName || "",
  ).trim();
  const ownerName = String(payload?.ownerName || "").trim();
  return (
    publicName ||
    (ownerName ? `${ownerName}'s Party` : `Party ${payload?.partyId || ""}`)
  );
}

function clearRequesterAutoJoinTimer() {
  if (__joinRequestRequesterState.autoJoinTimer) {
    clearTimeout(__joinRequestRequesterState.autoJoinTimer);
    clearInterval(__joinRequestRequesterState.autoJoinTimer);
    __joinRequestRequesterState.autoJoinTimer = null;
  }
}

function clearRequesterPendingTimer() {
  if (__joinRequestRequesterState.pendingTimer) {
    clearTimeout(__joinRequestRequesterState.pendingTimer);
    __joinRequestRequesterState.pendingTimer = null;
  }
}

function setRequesterOverlayVisible(visible) {
  const { requesterOverlay } = getJoinRequestElements();
  if (!requesterOverlay) return;
  requesterOverlay.classList.toggle("hidden", !visible);
  requesterOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
  updateJoinRequestChatVisibility();
}

function setOwnerOverlayVisible(visible) {
  const { ownerOverlay } = getJoinRequestElements();
  if (!ownerOverlay) return;
  ownerOverlay.classList.toggle("hidden", !visible);
  ownerOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
  updateJoinRequestChatVisibility();
}

function clearOwnerExpiryTimer() {
  if (__joinRequestOwnerState.expiryTimer) {
    clearTimeout(__joinRequestOwnerState.expiryTimer);
    __joinRequestOwnerState.expiryTimer = null;
  }
}

function buildRequesterBannerText(payload, state) {
  const status = String(
    state?.status || payload?.status || "none",
  ).toLowerCase();
  if (status === "pending")
    return "Your request is waiting for the party owner.";
  if (status === "accepted") return "Your request was accepted.";
  if (Number(state?.attemptsRemaining) <= 0) {
    return "Please request later or ask the owner to invite you.";
  }
  return "This party is private. Request access to continue.";
}

function renderRequesterJoinRequestScreen(payload) {
  const {
    requesterTitle,
    requesterBanner,
    requesterOwnerName,
    requesterPlayers,
    requesterSubmit,
  } = getJoinRequestElements();

  const requestState = payload?.requestState || {};
  const state = {
    ...requestState,
    requestCount: Math.max(0, Number(requestState.requestCount) || 0),
    attemptsRemaining:
      requestState.attemptsRemaining == null
        ? 4
        : Math.max(0, Number(requestState.attemptsRemaining) || 0),
    canRequest:
      typeof requestState.canRequest === "boolean"
        ? requestState.canRequest
        : true,
    status: String(
      requestState.status || payload?.status || "none",
    ).toLowerCase(),
  };

  if (requesterTitle) {
    requesterTitle.textContent = getRequesterPartyLabel(payload);
  }
  if (requesterBanner) {
    requesterBanner.textContent = buildRequesterBannerText(payload, state);
    requesterBanner.dataset.status = state.status || "none";
  }
  if (requesterOwnerName) {
    requesterOwnerName.textContent = String(payload?.ownerName || "Unknown");
  }
  if (requesterPlayers) {
    const memberCount = Number(payload?.memberCount) || 0;
    const capacity = Number(payload?.capacity?.total) || 0;
    requesterPlayers.textContent =
      capacity > 0 ? `${memberCount}/${capacity}` : String(memberCount);
  }
  if (requesterSubmit) {
    const canRequest =
      state.status !== "pending" &&
      state.canRequest &&
      state.status !== "accepted";
    requesterSubmit.disabled = !canRequest;
    requesterSubmit.textContent =
      state.status === "accepted"
        ? "Accepted"
        : state.status === "pending"
          ? "Request Sent"
          : state.attemptsRemaining <= 0
            ? "Request Unavailable"
            : "Request to Join";
  }

  clearRequesterPendingTimer();
  if (state.status === "pending") {
    const requestedAtMs = payload?.requestState?.requestedAt
      ? new Date(payload.requestState.requestedAt).getTime()
      : Date.now();
    const msUntilTimeout = Math.max(
      0,
      JOIN_REQUEST_TIMEOUT_MS - (Date.now() - requestedAtMs),
    );
    __joinRequestRequesterState.pendingTimer = window.setTimeout(() => {
      const currentPayload = __joinRequestRequesterState.payload || {};
      renderRequesterJoinRequestScreen({
        ...currentPayload,
        requestState: {
          ...(currentPayload.requestState || {}),
          status: "none",
          canRequest: true,
        },
        status: "none",
      });
    }, msUntilTimeout || 0);
  }

  __joinRequestRequesterState.partyId =
    Number(
      payload?.party?.party_id || payload?.party?.partyId || payload?.partyId,
    ) || null;
  __joinRequestRequesterState.payload = payload || null;
  __joinRequestRequesterState.visible = true;
  setRequesterOverlayVisible(true);
}

async function submitJoinRequestForCurrentParty() {
  const partyId = Number(
    __joinRequestRequesterState.partyId || checkIfInParty(),
  );
  if (!partyId) return;
  const submitBtn = document.getElementById("party-join-request-submit");
  if (submitBtn) submitBtn.disabled = true;
  try {
    const response = await fetch("/party/join-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partyId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429 || response.status === 409) {
        renderRequesterJoinRequestScreen({
          ...(__joinRequestRequesterState.payload || {}),
          requestState: data?.requestState || {
            status: "none",
            attemptsRemaining: 0,
            requestCount: 4,
          },
          status: "none",
          message: data?.error || "Unable to request to join.",
        });
        return;
      }
      throw new Error(data?.error || "Unable to request to join.");
    }
    if (String(data?.requestState?.status || "").toLowerCase() === "accepted") {
      handleRequesterJoinRequestUpdate({
        partyId,
        requesterName: String(
          document.getElementById("username-text")?.textContent || "",
        ),
        status: "accepted",
        requestState: data.requestState,
        message: data?.message || "Your request was accepted.",
      });
    } else {
      renderRequesterJoinRequestScreen({
        ...(__joinRequestRequesterState.payload || {}),
        requestState: data?.requestState || {
          status: "pending",
          attemptsRemaining: 3,
          requestCount: 1,
        },
        status: data?.requestState?.status || "pending",
      });
    }
  } catch (error) {
    console.error("[party] submitJoinRequestForCurrentParty failed", error);
    sonner(
      "Join request",
      error?.message || "Unable to send request.",
      "error",
    );
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function handleRequesterJoinRequestUpdate(payload) {
  const currentPartyId = Number(
    __joinRequestRequesterState.partyId || checkIfInParty(),
  );
  const payloadPartyId = Number(payload?.partyId || payload?.party_id || 0);
  const currentUserName = String(
    document.getElementById("username-text")?.textContent || "",
  );
  const targetName = String(
    payload?.requesterName || payload?.requester_name || "",
  );
  if (!payloadPartyId || (currentPartyId && payloadPartyId !== currentPartyId))
    return;
  if (targetName && currentUserName && targetName !== currentUserName) return;

  clearRequesterAutoJoinTimer();
  const nextState = {
    ...(payload?.requestState || {}),
    status: String(
      payload?.status || payload?.requestState?.status || "accepted",
    ).toLowerCase(),
  };
  const nextPayload = {
    ...(__joinRequestRequesterState.payload || {}),
    partyId: payloadPartyId,
    requestState: nextState,
    status: nextState.status,
    message: payload?.message || null,
  };
  if (nextState.status === "rejected") {
    nextPayload.requestState = {
      ...nextState,
      status: "none",
    };
    nextPayload.status = "none";
  }
  renderRequesterJoinRequestScreen(nextPayload);
  if (nextState.status === "accepted") {
    const banner = document.getElementById("party-join-request-banner");
    if (banner) {
      let secondsLeft = 3;
      banner.textContent = `Accepted. Joining in ${secondsLeft} seconds.`;
      __joinRequestRequesterState.autoJoinTimer = window.setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearRequesterAutoJoinTimer();
          window.location.reload();
          return;
        }
        banner.textContent = `Accepted. Joining in ${secondsLeft} seconds.`;
      }, 1000);
    } else {
      __joinRequestRequesterState.autoJoinTimer = window.setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  }
}

function buildOwnerJoinRequestCard(request) {
  const card = document.createElement("article");
  card.className = "party-request-card";
  card.dataset.requestId = String(request.requestId || "");

  const header = document.createElement("div");
  header.className = "party-request-card-head";

  const copy = document.createElement("div");
  copy.className = "party-request-card-copy";
  const name = document.createElement("strong");
  name.textContent = String(request.requesterName || "Player");
  const meta = document.createElement("span");
  meta.textContent = "Wants to join your party.";
  copy.appendChild(name);
  copy.appendChild(meta);

  const status = document.createElement("div");
  status.className = "party-request-pill";
  status.textContent = String(request.userStatus || "online");

  header.appendChild(copy);
  header.appendChild(status);
  card.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "party-request-card-actions";

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "pixel-menu-button party-request-button";
  viewBtn.textContent = "View Profile";
  viewBtn.addEventListener("click", () => {
    if (__joinRequestProfilePopup?.open) {
      __joinRequestProfilePopup.open({
        username: String(request.requesterName || ""),
      });
    }
  });

  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className =
    "pixel-menu-button party-request-button party-request-accept";
  acceptBtn.textContent = "Accept";
  acceptBtn.addEventListener("click", async () => {
    await respondToJoinRequest(request.requestId, "accept");
  });

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className =
    "pixel-menu-button party-request-button party-request-reject";
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("click", async () => {
    await respondToJoinRequest(request.requestId, "reject");
  });

  actions.appendChild(viewBtn);
  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  card.appendChild(actions);

  return card;
}

function renderOwnerJoinRequestOverlay() {
  const { ownerList } = getJoinRequestElements();
  clearOwnerExpiryTimer();
  const requests = (
    Array.isArray(__joinRequestOwnerState.requests)
      ? __joinRequestOwnerState.requests
      : []
  ).filter((request) => {
    const requestedAtMs = request?.requestedAt
      ? new Date(request.requestedAt).getTime()
      : 0;
    return (
      !requestedAtMs || Date.now() - requestedAtMs < JOIN_REQUEST_TIMEOUT_MS
    );
  });
  __joinRequestOwnerState.requests = requests;
  const currentRequest = requests[0] || null;
  if (ownerList) {
    ownerList.innerHTML = "";
    if (currentRequest) {
      ownerList.appendChild(buildOwnerJoinRequestCard(currentRequest));
    }
  }

  if (currentRequest?.requestedAt) {
    const requestedAtMs = new Date(currentRequest.requestedAt).getTime();
    const msUntilExpiry = Math.max(
      0,
      JOIN_REQUEST_TIMEOUT_MS - (Date.now() - requestedAtMs),
    );
    __joinRequestOwnerState.expiryTimer = window.setTimeout(() => {
      renderOwnerJoinRequestOverlay();
    }, msUntilExpiry || 0);
  }

  __joinRequestOwnerState.visible = !!currentRequest;
  setOwnerOverlayVisible(!!currentRequest);
}

async function loadPendingJoinRequests(partyId) {
  const currentPartyId = Number(
    partyId || __joinRequestOwnerState.partyId || checkIfInParty(),
  );
  if (!currentPartyId) return;
  try {
    const response = await fetch("/party/join-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partyId: currentPartyId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    __joinRequestOwnerState.partyId = currentPartyId;
    __joinRequestOwnerState.requests = Array.isArray(data?.requests)
      ? data.requests
      : [];
    renderOwnerJoinRequestOverlay();
  } catch (error) {
    console.warn(
      "[party] loadPendingJoinRequests failed",
      error?.message || error,
    );
  }
}

async function respondToJoinRequest(requestId, response) {
  const partyId = Number(__joinRequestOwnerState.partyId || checkIfInParty());
  if (!partyId || !requestId) return;

  const existingRequest = __joinRequestOwnerState.requests.find(
    (request) => Number(request.requestId) === Number(requestId),
  );
  const existingRequestedAtMs = existingRequest?.requestedAt
    ? new Date(existingRequest.requestedAt).getTime()
    : 0;
  if (
    existingRequestedAtMs &&
    Date.now() - existingRequestedAtMs >= JOIN_REQUEST_TIMEOUT_MS
  ) {
    __joinRequestOwnerState.requests = __joinRequestOwnerState.requests.filter(
      (request) => Number(request.requestId) !== Number(requestId),
    );
    renderOwnerJoinRequestOverlay();
    return;
  }

  try {
    const result = await fetch("/party/join-request/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partyId, requestId, response }),
    });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) {
      if (result.status === 409) {
        __joinRequestOwnerState.requests =
          __joinRequestOwnerState.requests.filter(
            (request) => Number(request.requestId) !== Number(requestId),
          );
        renderOwnerJoinRequestOverlay();
        return;
      }
      throw new Error(data?.error || "Unable to update join request.");
    }
    __joinRequestOwnerState.requests = __joinRequestOwnerState.requests.filter(
      (request) => Number(request.requestId) !== Number(requestId),
    );
    renderOwnerJoinRequestOverlay();
  } catch (error) {
    sonner(
      "Join request",
      error?.message || "Unable to update join request.",
      "error",
    );
  }
}

function wireJoinRequestOverlayControls() {
  const { requesterSubmit, requesterReturn, ownerIgnore } =
    getJoinRequestElements();

  if (requesterSubmit && requesterSubmit.dataset.bound !== "1") {
    requesterSubmit.dataset.bound = "1";
    requesterSubmit.addEventListener("click", () => {
      void submitJoinRequestForCurrentParty();
    });
  }

  if (requesterReturn && requesterReturn.dataset.bound !== "1") {
    requesterReturn.dataset.bound = "1";
    requesterReturn.addEventListener("click", () => {
      hidePartyJoinRequestScreen();
      window.location.href = "/";
    });
  }

  if (ownerIgnore && ownerIgnore.dataset.bound !== "1") {
    ownerIgnore.dataset.bound = "1";
    ownerIgnore.addEventListener("click", () => {
      __joinRequestOwnerState.requests =
        __joinRequestOwnerState.requests.slice(1);
      renderOwnerJoinRequestOverlay();
    });
  }
}

export function showPartyJoinRequestScreen(payload) {
  clearRequesterAutoJoinTimer();
  __joinRequestRequesterState.partyId =
    Number(
      payload?.party?.party_id ||
        payload?.party?.partyId ||
        payload?.partyId ||
        checkIfInParty(),
    ) || null;
  __joinRequestRequesterState.payload = payload || null;
  renderRequesterJoinRequestScreen(payload || {});
}

export function hidePartyJoinRequestScreen() {
  clearRequesterAutoJoinTimer();
  clearRequesterPendingTimer();
  __joinRequestRequesterState.visible = false;
  setRequesterOverlayVisible(false);
}

function parseCharacterLevels(levels) {
  if (!levels) return {};
  if (typeof levels === "object") return levels;
  try {
    return JSON.parse(String(levels || "{}"));
  } catch (_) {
    return {};
  }
}

function getMemberLevel(member) {
  if (!member) return null;
  if (Number.isFinite(Number(member.level))) {
    return Math.max(1, Number(member.level));
  }
  const charClass = String(member.char_class || "ninja");
  const levels = parseCharacterLevels(member.char_levels);
  return Math.max(1, Number(levels?.[charClass]) || 1);
}

function setSlotLevelBadge(slot, level) {
  if (!slot) return;
  let badge = slot.querySelector(".slot-level-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "slot-level-badge";
    badge.setAttribute("aria-hidden", "true");
    slot.insertBefore(badge, slot.firstChild);
  }
  if (Number.isFinite(Number(level)) && Number(level) > 0) {
    const iconLevel = Math.max(1, Math.min(5, Number(level)));
    badge.innerHTML = `<img src="/assets/levels/${iconLevel}.webp" alt="" />`;
    badge.dataset.level = String(iconLevel);
    slot.classList.add("has-level");
  } else {
    badge.innerHTML = "";
    delete badge.dataset.level;
    slot.classList.remove("has-level");
  }
}

function prefersReducedLobbyMotion() {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
}

function ensureLobbySpawnEffect(slot) {
  let effect = slot?.querySelector(":scope > .lobby-spawn-fx");
  if (!slot || effect) return effect;

  effect = document.createElement("div");
  effect.className = "lobby-spawn-fx";
  effect.setAttribute("aria-hidden", "true");

  const column = document.createElement("span");
  column.className = "lobby-spawn-fx-column";
  effect.appendChild(column);

  const core = document.createElement("span");
  core.className = "lobby-spawn-fx-core";
  effect.appendChild(core);

  const floor = document.createElement("span");
  floor.className = "lobby-spawn-fx-floor";
  effect.appendChild(floor);

  const shardLayout = [
    [-50, 18, 5, 7, 0, -8, 430],
    [-44, 62, 4, 15, 110, 5, 520],
    [-37, 92, 8, 8, 40, -4, 390],
    [-31, 38, 3, 24, 190, 7, 560],
    [-25, 76, 6, 11, 70, -7, 470],
    [-19, 20, 9, 9, 230, 4, 410],
    [-13, 108, 4, 18, 130, -5, 540],
    [-7, 51, 7, 7, 20, 8, 420],
    [0, 84, 4, 27, 170, -3, 590],
    [7, 29, 8, 12, 90, 6, 450],
    [13, 119, 6, 6, 250, -8, 400],
    [19, 66, 5, 16, 30, 5, 510],
    [26, 15, 7, 7, 150, -6, 390],
    [32, 101, 3, 22, 210, 7, 570],
    [38, 46, 9, 10, 60, -4, 440],
    [44, 81, 5, 6, 270, 8, 380],
    [49, 27, 4, 18, 120, -5, 530],
    [54, 111, 7, 8, 180, 4, 420],
  ];

  shardLayout.forEach(
    ([x, y, width, height, delay, drift, duration], index) => {
      const shard = document.createElement("i");
      shard.className = "lobby-spawn-fx-shard";
      shard.style.setProperty("--spawn-x", `${x}px`);
      shard.style.setProperty("--spawn-y", `${y}px`);
      shard.style.setProperty("--spawn-width", `${width}px`);
      shard.style.setProperty("--spawn-height", `${height}px`);
      shard.style.setProperty("--spawn-delay", `${delay}ms`);
      shard.style.setProperty("--spawn-drift", `${drift}px`);
      shard.style.setProperty("--spawn-duration", `${duration}ms`);
      shard.style.setProperty("--spawn-shard-index", String(index));
      effect.appendChild(shard);
    },
  );

  slot.appendChild(effect);
  return effect;
}

function clearLobbySpawnAnimation(slot) {
  if (!slot) return;
  const cleanupTimer = __lobbySpawnCleanupTimers.get(slot);
  if (cleanupTimer) window.clearTimeout(cleanupTimer);
  __lobbySpawnCleanupTimers.delete(slot);
  __lobbySpawnEndTimes.delete(slot);
  slot.classList.remove("lobby-spawn-enter", "lobby-spawn-exit");
}

function getLobbySpawnTimeRemaining(slot) {
  return Math.max(0, (__lobbySpawnEndTimes.get(slot) || 0) - performance.now());
}

export function playLobbySpawnAnimation(slot, direction = "enter") {
  if (!slot) return 0;

  ensureLobbySpawnEffect(slot);
  clearLobbySpawnAnimation(slot);

  if (prefersReducedLobbyMotion()) return 0;

  const isExit = direction === "exit";
  const animationClass = isExit ? "lobby-spawn-exit" : "lobby-spawn-enter";
  const duration = isExit ? LOBBY_SPAWN_EXIT_MS : LOBBY_SPAWN_ENTER_MS;

  // Force a fresh animation even if a player leaves immediately after joining.
  void slot.offsetWidth;
  slot.classList.add(animationClass);

  const cleanupTimer = window.setTimeout(() => {
    slot.classList.remove(animationClass);
    __lobbySpawnCleanupTimers.delete(slot);
    __lobbySpawnEndTimes.delete(slot);
  }, duration);
  __lobbySpawnCleanupTimers.set(slot, cleanupTimer);
  __lobbySpawnEndTimes.set(slot, performance.now() + duration);
  return duration;
}

function triggerLobbyCharacterSplash(slot) {
  if (!slot) return;
  slot.classList.remove("character-splash");
  void slot.offsetWidth;
  slot.classList.add("character-splash");
  window.setTimeout(() => {
    slot.classList.remove("character-splash");
  }, 700);
}

function ensureLobbyReadyEffect(slot) {
  let effect = slot?.querySelector(":scope > .lobby-ready-fx");
  if (!slot || effect) return effect;

  effect = document.createElement("div");
  effect.className = "lobby-ready-fx";
  effect.setAttribute("aria-hidden", "true");

  const lineLayout = [
    [-26, -88, -32, 2, 22, "#50d9ff", "#ddf8ff", 270, 80],
    [-19, -72, -20, 4, 47, "#7dff68", "#e7ffdc", 350, 18],
    [-12, -104, -39, 3, 31, "#ffd95a", "#fff5c2", 300, 112],
    [-5, -91, -13, 5, 58, "#42efcf", "#d5fff6", 390, 0],
    [3, -76, -29, 2, 27, "#b68cff", "#eee2ff", 285, 57],
    [10, -98, -5, 4, 43, "#8dff45", "#ebffcf", 365, 33],
    [17, -68, -24, 3, 19, "#70b9ff", "#e0f1ff", 250, 126],
    [24, -86, -35, 2, 52, "#ffe879", "#fff9d4", 330, 91],
  ];

  lineLayout.forEach(
    ([x, startY, endY, width, height, color, bright, duration, delay]) => {
      const line = document.createElement("i");
      line.className = "lobby-ready-fx-line";
      line.style.setProperty("--ready-line-x", `${x}px`);
      line.style.setProperty("--ready-start-y", `${startY}px`);
      line.style.setProperty("--ready-end-y", `${endY}px`);
      line.style.setProperty("--ready-line-width", `${width}px`);
      line.style.setProperty("--ready-line-height", `${height}px`);
      line.style.setProperty("--ready-line-color", color);
      line.style.setProperty("--ready-line-bright", bright);
      line.style.setProperty("--ready-line-duration", `${duration}ms`);
      line.style.setProperty("--ready-line-delay", `${delay}ms`);
      line.style.setProperty(
        "--unready-line-duration",
        `${Math.round(duration * 0.72)}ms`,
      );
      line.style.setProperty(
        "--unready-line-delay",
        `${Math.round(delay * 0.45)}ms`,
      );
      effect.appendChild(line);
    },
  );

  slot.appendChild(effect);
  return effect;
}

function ensureLobbySelectingRing(slot) {
  let ring = slot?.querySelector(":scope > .lobby-selecting-ring");
  if (!slot || ring) return ring;
  ring = document.createElement("div");
  ring.className = "lobby-selecting-ring";
  ring.setAttribute("aria-hidden", "true");
  slot.appendChild(ring);
  return ring;
}

function playLobbyReadyEffect(slot, isReady) {
  if (!slot) return;
  ensureLobbyReadyEffect(slot);

  const previousTimer = __lobbyReadyEffectCleanupTimers.get(slot);
  if (previousTimer) window.clearTimeout(previousTimer);

  slot.classList.remove("lobby-ready-burst", "lobby-unready-burst");
  if (prefersReducedLobbyMotion()) return;

  void slot.offsetWidth;
  const effectClass = isReady ? "lobby-ready-burst" : "lobby-unready-burst";
  slot.classList.add(effectClass);
  const cleanupTimer = window.setTimeout(() => {
    slot.classList.remove(effectClass);
    __lobbyReadyEffectCleanupTimers.delete(slot);
  }, isReady ? 560 : 400);
  __lobbyReadyEffectCleanupTimers.set(slot, cleanupTimer);
}

function applyLobbyStatusVisualState(slot, previousStatus, nextStatus) {
  if (!slot) return;
  ensureLobbySelectingRing(slot);
  const previousClass = statusToClass(previousStatus);
  const nextClass = statusToClass(nextStatus);

  slot.classList.toggle("is-selecting-character", nextClass === "selecting-character");

  const wasAvailable = previousClass === "online" || previousClass === "not-ready";
  const isAvailable = nextClass === "online" || nextClass === "not-ready";
  if (nextClass === "ready" && wasAvailable) {
    playLobbyReadyEffect(slot, true);
  } else if (previousClass === "ready" && isAvailable) {
    playLobbyReadyEffect(slot, false);
  }
}

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

function getCurrentModeValue() {
  return String(getPlayersPerTeamForSelection(getCurrentSelection()));
}

function getCurrentSelection() {
  return normalizeGameSelection({
    modeId: document.getElementById("mode-id")?.value || "duels",
    modeVariantId:
      document.getElementById("mode-variant-id")?.value || "duels-1v1",
    mapId: document.getElementById("map")?.value || null,
  });
}

function canChangePartySelection() {
  if (!checkIfInParty()) return true;
  return (
    __partyContext.allowMemberSelection !== false ||
    __partyContext.ownerName === getCurrentLobbyUserName()
  );
}

function rebuildMapDropdown(selection) {
  const mapDropdown = document.getElementById("map");
  if (!mapDropdown) return [];

  const normalized = normalizeGameSelection(selection || getCurrentSelection());
  const compatibleMaps = getCompatibleMapsForSelection(normalized);
  mapDropdown.innerHTML = "";

  compatibleMaps.forEach((map) => {
    const opt = document.createElement("option");
    opt.value = String(map.id);
    opt.textContent = map.label || `Map ${map.id}`;
    mapDropdown.appendChild(opt);
  });

  mapDropdown.disabled = !canChangePartySelection() || compatibleMaps.length === 0;
  mapDropdown.value =
    compatibleMaps.find((map) => Number(map.id) === Number(normalized.mapId))
      ?.id != null
      ? String(normalized.mapId)
      : compatibleMaps[0]?.id != null
        ? String(compatibleMaps[0].id)
        : "";

  return compatibleMaps;
}

function syncModePickerUi(selection = getCurrentSelection()) {
  const normalized = normalizeGameSelection(selection);
  const mode = getModeById(normalized.modeId);
  const previewImg = document.getElementById("mode-preview-img");
  const previewName = document.getElementById("mode-preview-name");
  const previewSubtitle = document.getElementById("mode-preview-subtitle");
  const openBtn = document.getElementById("mode-picker-open");

  if (previewName) previewName.textContent = getModeLabel(normalized.modeId);
  if (previewSubtitle) {
    const label = getSelectionDisplayLabel(normalized);
    previewSubtitle.textContent = label.includes("•")
      ? label.split("•")[1].trim()
      : getModeSubtitle(normalized.modeId);
  }
  if (previewImg) {
    previewImg.src = getModeArtAsset(normalized.modeId);
    previewImg.onerror = () => {
      previewImg.onerror = null;
      previewImg.src = getModeFallbackArtAsset(normalized.modeId);
    };
  }
  if (openBtn) {
    openBtn.disabled = !canChangePartySelection();
    openBtn.classList.toggle(
      "is-disabled",
      openBtn.disabled ||
        (!isSelectionQueueable(normalized) && normalized.modeId !== "duels"),
    );
    openBtn.title = openBtn.disabled
      ? "Only the party owner can change the map and mode."
      : mode?.description || "";
    const modeDropdown = document.getElementById("mode");
    if (modeDropdown) modeDropdown.disabled = openBtn.disabled;
  }
}

function syncMapPickerUi(mapValue, selection = getCurrentSelection()) {
  const mapDropdown = document.getElementById("map");
  const previewImg = document.getElementById("map-preview-img");
  const previewName = document.getElementById("map-preview-name");
  const openBtn = document.getElementById("map-picker-open");
  if (!mapDropdown) return;

  const compatibleMaps = rebuildMapDropdown(selection);
  const normalized = String(
    mapValue || mapDropdown.value || compatibleMaps[0]?.id || "",
  );
  if (normalized && mapDropdown.value !== normalized) {
    mapDropdown.value = normalized;
  }

  const selectedOption = mapDropdown.querySelector(
    `option[value="${normalized}"]`,
  );
  if (previewName) {
    previewName.textContent =
      compatibleMaps.length > 0
        ? selectedOption?.textContent || getMapLabel(normalized)
        : "No Compatible Maps";
  }
  if (previewImg) {
    previewImg.src =
      compatibleMaps.length > 0
        ? getMapSelectPreviewAsset(normalized)
        : "/assets/map.webp";
  }
  if (openBtn) {
    openBtn.disabled = !canChangePartySelection() || compatibleMaps.length === 0;
    openBtn.classList.toggle("is-disabled", openBtn.disabled);
    openBtn.title = !canChangePartySelection()
      ? "Only the party owner can change the map and mode."
      : compatibleMaps.length === 0
        ? "No compatible maps are available for this mode yet."
        : "";
  }
}

function writeSelectionToDom(selection, { persist = false } = {}) {
  const normalized = normalizeGameSelection(selection);
  const modeIdInput = document.getElementById("mode-id");
  const modeVariantInput = document.getElementById("mode-variant-id");
  const modeDropdown = document.getElementById("mode");
  if (modeIdInput) modeIdInput.value = normalized.modeId;
  if (modeVariantInput) modeVariantInput.value = normalized.modeVariantId || "";
  if (modeDropdown) {
    modeDropdown.value = String(selectionToLegacyMode(normalized));
  }
  const compatibleMaps = rebuildMapDropdown(normalized);
  const mapDropdown = document.getElementById("map");
  if (mapDropdown) {
    const nextMapId =
      compatibleMaps.find((map) => Number(map.id) === Number(normalized.mapId))
        ?.id ??
      compatibleMaps[0]?.id ??
      null;
    mapDropdown.value = nextMapId != null ? String(nextMapId) : "";
  }
  syncModePickerUi(normalized);
  syncMapPickerUi(mapDropdown?.value || normalized.mapId, normalized);
  syncReadyAvailability({
    ...normalized,
    mapId: mapDropdown?.value ? Number(mapDropdown.value) : null,
  });
  if (persist) {
    setSoloSelection(SOLO_MODE_ID_STORAGE_KEY, normalized.modeId);
    setSoloSelection(
      SOLO_MODE_VARIANT_STORAGE_KEY,
      normalized.modeVariantId || "",
    );
    setSoloSelection(SOLO_MODE_STORAGE_KEY, selectionToLegacyMode(normalized));
    if (mapDropdown?.value) {
      setSoloSelection(SOLO_MAP_STORAGE_KEY, mapDropdown.value);
    }
  }
  return {
    ...normalized,
    mapId: mapDropdown?.value ? Number(mapDropdown.value) : null,
  };
}

function setupMapPickerControls(onSelect = null) {
  const mapDropdown = document.getElementById("map");
  const openBtn = document.getElementById("map-picker-open");
  if (!mapDropdown || !openBtn) return;

  const ensureMapPopup = () => {
    if (__mapPopupUi) return __mapPopupUi;

    const popupShell = getSharedSelectionPopupShell();
    const closePopup = () => {
      popupShell.hide();
    };

    const content = document.createElement("div");
    content.className = "selection-popup-scroll map-selection-popup-scroll";

    const grid = document.createElement("div");
    grid.className = "map-select-grid";

    __mapPopupUi = {
      popupShell,
      content,
      grid,
      closePopup,
    };

    return __mapPopupUi;
  };

  const openMapPopup = () => {
    if (!canChangePartySelection()) return;
    const popupUi = ensureMapPopup();
    const { popupShell, content, grid, closePopup } = popupUi;
    grid.innerHTML = "";

    const options = Array.from(mapDropdown.options || []);
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "mode-select-empty";
      empty.textContent = "No compatible maps are available for this mode yet.";
      grid.appendChild(empty);
    } else {
      options.forEach((opt) => {
        const value = String(opt.value);
        const card = document.createElement("button");
        card.type = "button";
        card.dataset.mapValue = value;
        card.className = `map-select-card pixel-menu-button${
          String(mapDropdown.value) === value ? " active" : ""
        }`;
        card.innerHTML = `
          <img src="${getMapSelectPreviewAsset(value)}" alt="${opt.textContent || "Map"}" />
          <div class="map-select-name">${opt.textContent || "Map"}</div>
        `;
        card.addEventListener("click", () => {
          mapDropdown.value = value;
          mapDropdown.dispatchEvent(new Event("change", { bubbles: true }));
          if (typeof onSelect === "function") {
            onSelect(getCurrentSelection());
          }
          closePopup();
        });
        grid.appendChild(card);
      });
    }

    // Keep active card in sync with latest dropdown value each open.
    const selected = String(mapDropdown.value || "1");
    for (const card of grid.querySelectorAll(".map-select-card")) {
      const isActive = String(card.dataset.mapValue || "") === selected;
      card.classList.toggle("active", isActive);
    }

    content.replaceChildren(grid);

    popupShell
      .mount({
        titleText: "Choose Map",
        onClose: closePopup,
        zIndex: 12020,
        contentNode: content,
        backgroundNode: null,
      })
      .show();
  };

  if (openBtn.dataset.bound !== "1") {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", openMapPopup);
  }

  syncMapPickerUi(mapDropdown.value);
}

function setupModePickerControls(onSelect = null) {
  const openBtn = document.getElementById("mode-picker-open");
  if (!openBtn) return;

  const ensureModePopup = () => {
    if (__modePopupUi) return __modePopupUi;
    const popupShell = getSharedSelectionPopupShell();
    const closePopup = () => popupShell.hide();
    const content = document.createElement("div");
    content.className = "selection-popup-scroll";
    __modePopupUi = { popupShell, closePopup, content };
    return __modePopupUi;
  };

  const openModeGrid = () => {
    if (!canChangePartySelection()) return;
    const popupUi = ensureModePopup();
    const { popupShell, closePopup, content } = popupUi;
    const grid = document.createElement("div");
    grid.className = "mode-select-grid";
    const selection = getCurrentSelection();

    getAllGameModes().forEach((mode) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `map-select-card mode-select-card pixel-menu-button${
        selection.modeId === mode.id ? " active" : ""
      }${mode.queueable ? "" : " is-disabled"}`;
      const artAsset =
        mode.artAsset || mode.fallbackArtAsset || "/assets/fightImage.webp";
      const badge = mode.queueable ? "Playable" : "Coming Soon";
      card.innerHTML = `
        <span class="mode-select-badge">${badge}</span>
        <img src="${artAsset}" alt="${mode.label}" />
        <div class="map-select-name">${mode.label}</div>
        <div class="mode-select-subtitle">${mode.description || ""}</div>
        <div class="mode-select-meta">${mode.topology || ""}</div>
      `;
      card.querySelector("img")?.addEventListener("error", (event) => {
        event.currentTarget.src =
          mode.fallbackArtAsset || "/assets/fightImage.webp";
      });
      card.addEventListener("click", () => {
        if (getModeSelectionStyle(mode.id) === "subcards") {
          openModeVariantGrid(mode.id);
          return;
        }
        const nextSelection = writeSelectionToDom(
          {
            ...selection,
            modeId: mode.id,
            modeVariantId: null,
            mapId: null,
          },
          { persist: !checkIfInParty() },
        );
        if (typeof onSelect === "function") onSelect(nextSelection);
        closePopup();
      });
      grid.appendChild(card);
    });

    content.replaceChildren(grid);
    popupShell
      .mount({
        titleText: "Choose Mode",
        onClose: closePopup,
        zIndex: 12020,
        contentNode: content,
        backgroundNode: null,
      })
      .show();
  };

  const openModeVariantGrid = (modeId) => {
    const popupUi = ensureModePopup();
    const { popupShell, closePopup, content } = popupUi;
    const mode = getModeById(modeId);
    const selection = getCurrentSelection();
    const wrapper = document.createElement("div");
    wrapper.className = "selection-popup-stack";
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "pixel-menu-button selection-popup-back";
    backButton.textContent = "Back";
    backButton.addEventListener("click", openModeGrid);
    wrapper.appendChild(backButton);

    const grid = document.createElement("div");
    grid.className = "mode-select-grid subcards";
    const variants = Array.isArray(mode?.variants) ? mode.variants : [];
    variants.forEach((variant) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `map-select-card mode-select-card pixel-menu-button${
        selection.modeVariantId === variant.id ? " active" : ""
      }`;
      card.innerHTML = `
        <img src="${getModeArtAsset(modeId)}" alt="${variant.label}" />
        <div class="map-select-name">${variant.label}</div>
        <div class="mode-select-subtitle">${variant.subtitle || getModeSubtitle(modeId)}</div>
      `;
      card.querySelector("img")?.addEventListener("error", (event) => {
        event.currentTarget.src = getModeFallbackArtAsset(modeId);
      });
      card.addEventListener("click", () => {
        const nextSelection = writeSelectionToDom(
          {
            ...selection,
            modeId,
            modeVariantId: variant.id,
            mapId: selection.mapId,
          },
          { persist: !checkIfInParty() },
        );
        if (typeof onSelect === "function") onSelect(nextSelection);
        closePopup();
      });
      grid.appendChild(card);
    });
    wrapper.appendChild(grid);
    content.replaceChildren(wrapper);
    popupShell
      .mount({
        titleText: `${mode?.label || "Mode"} Setup`,
        onClose: closePopup,
        zIndex: 12020,
        contentNode: content,
        backgroundNode: null,
      })
      .show();
  };

  if (openBtn.dataset.bound !== "1") {
    openBtn.dataset.bound = "1";
    openBtn.addEventListener("click", openModeGrid);
  }
  syncModePickerUi();
}

function getViewportOffsetScale() {
  // Gradually reduce vertical push on narrow layouts where elements stack tighter.
  const w = Number(window.innerWidth) || 1280;
  const minW = 420;
  const maxW = 1440;
  const t = Math.max(0, Math.min(1, (w - minW) / (maxW - minW)));
  return 0.56 + t * 0.44; // 420px => 0.56, 1440px+ => 1.0
}

function applyPlatformImageForMap(mapValue) {
  const platformUrl = getLobbyPlatformAsset(mapValue || getCurrentMapValue());
  const imageEls = document.querySelectorAll(".platform-image");
  for (const imageEl of imageEls) {
    if (!imageEl) continue;
    imageEl.style.backgroundImage = `url("${platformUrl}")`;
  }
}

function applyLobbyCharacterOffsetForMap(mapValue, modeValue) {
  const baseOffsetPx = getLobbyCharacterOffsetY(
    mapValue || getCurrentMapValue(),
    modeValue || getCurrentModeValue(),
  );
  const offsetPx =
    Math.round(baseOffsetPx * getViewportOffsetScale() * 100) / 100;
  const lobbyArea = document.getElementById("lobby-area");
  if (!lobbyArea) return;
  lobbyArea.style.setProperty("--lobby-character-offset-y", `${offsetPx}px`);
}

function bindLobbyOffsetResizeHandler() {
  if (__lobbyOffsetResizeBound) return;
  __lobbyOffsetResizeBound = true;

  let rafId = 0;
  window.addEventListener("resize", () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      applyLobbyCharacterOffsetForMap(
        getCurrentMapValue(),
        getCurrentModeValue(),
      );
      rafId = 0;
    });
  });
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
  try {
    const probeKey = "__bb_selection_probe__";
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    return true;
  } catch (_) {
    return false;
  }
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

function getSavedSelectionFromUserData() {
  const selection = window.__BRO_BATTLES_USERDATA__?.preferred_selection;
  if (!selection || typeof selection !== "object") return null;
  return normalizeGameSelection(selection);
}

async function persistSoloSelection(selection) {
  const normalized = normalizeGameSelection(selection);
  setSoloSelection(SOLO_MODE_ID_STORAGE_KEY, normalized.modeId);
  setSoloSelection(
    SOLO_MODE_VARIANT_STORAGE_KEY,
    normalized.modeVariantId || "",
  );
  setSoloSelection(SOLO_MODE_STORAGE_KEY, selectionToLegacyMode(normalized));
  if (normalized.mapId != null) {
    setSoloSelection(SOLO_MAP_STORAGE_KEY, normalized.mapId);
  }

  try {
    const response = await fetch("/selection-preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ selection: normalized }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to save selection");
    }
    if (window.__BRO_BATTLES_USERDATA__) {
      window.__BRO_BATTLES_USERDATA__.preferred_selection =
        normalizeGameSelection(data?.selection || normalized);
    }
  } catch (error) {
    console.warn("[party] failed to persist solo selection", {
      selection: normalized,
      message: error?.message || String(error),
    });
  }
}

function legacyModeToVariantId(mode) {
  const numeric = Number(mode);
  if (numeric === 2) return "duels-2v2";
  if (numeric === 3) return "duels-3v3";
  return "duels-1v1";
}

export function applyLobbySelection(selection, options = {}) {
  return writeSelectionToDom(selection, options);
}

export function checkIfInParty() {
  const pathname = window.location.pathname;
  if (pathname.includes("party")) {
    return pathname.split("/").filter(Boolean).pop();
  }
  return false;
}

function getActivePartyId() {
  const contextPartyId = Number(__partyContext.partyId || 0);
  if (Number.isFinite(contextPartyId) && contextPartyId > 0) {
    return contextPartyId;
  }
  const routePartyId = Number(checkIfInParty() || 0);
  if (Number.isFinite(routePartyId) && routePartyId > 0) {
    return routePartyId;
  }
  return null;
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

export async function leaveParty() {
  const selfSlot = document.querySelector(
    '.character-slot[data-is-current-user="true"]',
  );
  const departureDuration = selfSlot
    ? playLobbySpawnAnimation(selfSlot, "exit")
    : 0;
  const departureAnimation = new Promise((resolve) => {
    window.setTimeout(resolve, departureDuration);
  });

  try {
    const response = await fetch("/leave-party", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Unable to leave the party");
    }
    console.log(data);
    await departureAnimation;
    window.location.href = `/`;
  } catch (error) {
    console.error("Error:", error);
    clearLobbySpawnAnimation(selfSlot);
    sonner(
      "Could not leave party",
      error?.message || "Please try again.",
      "error",
    );
  }
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

export function socketInit(options = {}) {
  __joinRequestProfilePopup = options?.profilePopup || null;
  wireJoinRequestOverlayControls();
  let byeSent = false;

  // Safety: if code runs before index.js triggered connection (e.g., alternate entry), ensure connect once.
  if (!socket.connected) ensureSocketConnected();

  if (!__battleReturnPageshowBound) {
    __battleReturnPageshowBound = true;
    window.addEventListener("pageshow", () => {
      byeSent = false;
      if (!consumeBattleLobbyReturnFlag()) return;
      restoreLobbyAfterBattleReturn();
    });
  }

  if (__postBattleLobbyReturn) restoreLobbyAfterBattleReturn();

  // Connection lifecycle
  socket.on("connect", () => {
    const currentPartyId = getActivePartyId();
    console.log("[socket] connected", {
      socketId: socket.id,
      currentPartyId: currentPartyId || null,
      href: window.location.href,
      host: window.location.host,
    });
    if (currentPartyId) {
      void loadPendingJoinRequests(currentPartyId);
    }
  });

  socket.on("connect_error", (error) => {
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

  socket.on("reconnect_attempt", (attempt) => {
    const currentPartyId = getActivePartyId();
    console.warn("[socket] reconnect_attempt", {
      attempt,
      currentPartyId: currentPartyId || null,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected", reason);
    stopHeartbeat();
  });

  // Proactively notify server before tab closes or navigates away
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
  window.addEventListener("pagehide", sendByeOnce);

  // Server tells us which room we're in (party or lobby)
  socket.on("party:joined", ({ partyId }) => {
    const currentPartyId = getActivePartyId();
    console.log("[socket] joined room", {
      joinedPartyId: partyId ?? null,
      currentPartyId: currentPartyId || null,
      socketId: socket.id || null,
    });
    if (partyId) startHeartbeat(partyId);
    else stopHeartbeat();
    // Reset roster baseline when switching rooms
    __partyRosterNames = null;
    __partyRosterPartyId = partyId || null;
    __partyContext.partyId = partyId || null;
    if (!partyId) {
      __partyContext.ownerName = null;
      __partyContext.allowMemberSelection = true;
      __partyContext.isPublic = false;
      __partyContext.publicName = "";
      __partyContext.capacity = null;
      __partyContext.members = [];
    }
  });

  // Live roster updates for the party
  socket.on("party:members", (data) => {
    try {
      const currentPartyId = getActivePartyId();
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
      const selection = writeSelectionToDom(
        {
          modeId: data?.selection?.modeId || data?.modeId || "duels",
          modeVariantId:
            data?.selection?.modeVariantId ||
            data?.modeVariantId ||
            "duels-1v1",
          mapId: data?.selection?.mapId ?? data?.map ?? null,
        },
        { persist: false },
      );

      // Keep lobby visuals in sync with authoritative party map/mode.
      if (selection.mapId != null) {
        setLobbyBackground(String(selection.mapId));
        applyPlatformImageForMap(String(selection.mapId));
        applyLobbyCharacterOffsetForMap(
          String(selection.mapId),
          String(selectionToLegacyMode(selection)),
        );
      }
      updatePlatformsForMode(String(selectionToLegacyMode(selection)));

      // Render minimal 1v1 view into the existing two slots if available
      renderPartyMembers({
        ...data,
        selection,
        mode: selectionToLegacyMode(selection),
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

  socket.on("party:join-request", (request) => {
    const currentPartyId = getActivePartyId();
    const requestPartyId = Number(request?.partyId || request?.party_id || 0);
    if (
      !requestPartyId ||
      (currentPartyId && requestPartyId !== Number(currentPartyId))
    ) {
      return;
    }

    const requesterName = String(
      request?.requesterName || request?.requester_name || "",
    );
    if (!requesterName) return;

    const normalizedRequest = {
      requestId: Number(request?.requestId || request?.request_id) || null,
      partyId: requestPartyId,
      requesterUserId:
        Number(request?.requesterUserId || request?.requester_user_id) || null,
      requesterName,
      userStatus: String(
        request?.userStatus || request?.user_status || "online",
      ),
      status: String(request?.status || "pending"),
      requestedAt: request?.requestedAt || request?.requested_at || null,
      respondedAt: request?.respondedAt || request?.responded_at || null,
    };

    const existingIndex = __joinRequestOwnerState.requests.findIndex(
      (item) => Number(item.requestId) === Number(normalizedRequest.requestId),
    );
    if (existingIndex >= 0) {
      __joinRequestOwnerState.requests[existingIndex] = normalizedRequest;
    } else {
      __joinRequestOwnerState.requests = [
        normalizedRequest,
        ...__joinRequestOwnerState.requests,
      ];
    }

    __joinRequestOwnerState.partyId = requestPartyId;
    renderOwnerJoinRequestOverlay();
  });

  socket.on("party:join-request:status", (payload) => {
    handleRequesterJoinRequestUpdate(payload);
    const partyId = Number(payload?.partyId || 0);
    if (partyId && __joinRequestOwnerState.partyId === partyId) {
      __joinRequestOwnerState.requests =
        __joinRequestOwnerState.requests.filter(
          (request) => Number(request.requestId) !== Number(payload?.requestId),
        );
      renderOwnerJoinRequestOverlay();
    }
  });

  // Presence/status changes: update the matching slot if visible
  socket.on("status:update", (evt) => {
    const currentPartyId = getActivePartyId();
    if (currentPartyId && String(evt.partyId) !== String(currentPartyId))
      return;
    const normalized = normalizeStatusLabel(evt.status || "online");
    const targetName = String(evt.name || "").trim();
    if (targetName) {
      const member = Array.isArray(__partyContext.members)
        ? __partyContext.members.find(
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
    const slots = document.querySelectorAll(".character-slot");
    for (const slot of slots) {
      if (!slot) continue;
      const nameEl = slot.querySelector(".username");
      const statusEl = slot.querySelector(".status");
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
            .toLowerCase()
            .includes("ready");
          setReadyButtonState(!!isReady);
        }
      }
    }
  });

  socket.on("party:selection-denied", async (data) => {
    if (String(data?.partyId) !== String(getActivePartyId())) return;
    sonner("Could not change map or mode", data?.error, "error");
    try {
      const response = await fetch("/party-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyId: getActivePartyId() }),
      });
      if (!response.ok) return;
      const party = await response.json();
      if (String(party.partyId) !== String(getActivePartyId())) return;
      writeSelectionToDom(party.selection);
      setLobbyBackground(party.selection.mapId);
      applyPlatformImageForMap(party.selection.mapId);
      applyLobbyCharacterOffsetForMap(
        party.selection.mapId,
        getPlayersPerTeamForSelection(party.selection),
      );
      renderPartyMembers(party);
    } catch (error) {
      console.warn("Could not refresh party selection", error);
    }
  });

  // Mode change updates
  socket.on("mode-change", (data) => {
    const currentPartyId = getActivePartyId();
    if (currentPartyId && String(data.partyId) !== String(currentPartyId))
      return;

    const selection = writeSelectionToDom(
      {
        modeId: data?.selection?.modeId || data?.modeId || "duels",
        modeVariantId:
          data?.selection?.modeVariantId ||
          data?.modeVariantId ||
          data?.selectedValue ||
          "duels-1v1",
        mapId: data?.selection?.mapId ?? getCurrentMapValue(),
      },
      { persist: false },
    );

    // Update platforms for new mode
    updatePlatformsForMode(getPlayersPerTeamForSelection(selection));
    if (selection.mapId != null) {
      setLobbyBackground(selection.mapId);
      applyPlatformImageForMap(selection.mapId);
      applyLobbyCharacterOffsetForMap(
        selection.mapId,
        getPlayersPerTeamForSelection(selection),
      );
    }

    // Re-render members in new platform layout
    if (data.members) {
      renderPartyMembers({
        partyId: currentPartyId,
        members: data.members,
        selection,
        mode: getPlayersPerTeamForSelection(selection),
        map: selection.mapId,
      });
    }
  });

  // Map change updates
  socket.on("map-change", (data) => {
    const currentPartyId = getActivePartyId();
    if (currentPartyId && String(data.partyId) !== String(currentPartyId))
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
    applyLobbyCharacterOffsetForMap(
      selection.mapId,
      getPlayersPerTeamForSelection(selection),
    );
    animatePlatformsForMapSwitch();
  });

  socket.on("party:notice", (data) => {
    const currentPartyId = getActivePartyId();
    if (currentPartyId && String(data?.partyId) !== String(currentPartyId))
      return;
    const title = String(data?.title || "Party update").trim();
    const message = String(data?.message || "").trim();
    sonner(title, message || undefined, "OK", undefined, {
      duration: 2500,
      sound: "notification",
    });
  });

  // Party-wide: everyone ready -> show matchmaking overlay
  socket.on("party:matchmaking:start", ({ partyId, selection }) => {
    if (__postBattleLobbyReturn) return;
    const currentPartyId = getActivePartyId();
    if (currentPartyId && String(partyId) !== String(currentPartyId)) return;
    const normalized = normalizeGameSelection(
      selection || getCurrentSelection(),
    );
    activeQueueContext = { selection: normalized };
    mmOverlayPlayers = [];
    mmOverlayPlayersSig = "";
    mmOverlayTotal = getTotalPlayersForSelection(normalized);
    showMatchmakingOverlay();
    updateMMOverlay({
      found: 0,
      total: mmOverlayTotal,
      selection: normalized,
      players: [],
    });
  });

  socket.on("queue:joined", (payload) => {
    if (__postBattleLobbyReturn) return;
    const currentPartyId = getActivePartyId();
    console.log("[join-debug] queue:joined", {
      currentPartyId: currentPartyId || null,
      payloadPartyId: payload?.partyId ?? null,
      selection: payload?.selection || null,
    });
    const normalized = normalizeGameSelection(
      payload?.selection || getCurrentSelection(),
    );
    activeQueueContext = { selection: normalized };
    mmOverlayPlayers = [];
    mmOverlayPlayersSig = "";
    mmOverlayTotal = getTotalPlayersForSelection(normalized);
    showMatchmakingOverlay();
    updateMMOverlay({
      found: 0,
      total: mmOverlayTotal,
      selection: normalized,
      players: [],
    });
  });

  // When a match is found, hold the success state before acknowledging ready.
  socket.on("match:found", (payload) => {
    if (__postBattleLobbyReturn) return;
    const currentPartyId = getActivePartyId();
    console.log("[join-debug] match:found", {
      currentPartyId: currentPartyId || null,
      matchId: payload?.matchId ?? null,
      playerCount: Array.isArray(payload?.players) ? payload.players.length : 0,
      selection: payload?.selection || null,
    });
    const normalized = normalizeGameSelection(
      payload?.selection || getCurrentSelection(),
    );
    activeQueueContext = {
      selection: normalized,
      yourTeam: payload?.yourTeam || null,
    };
    const matchedPlayers = Array.isArray(payload?.players)
      ? payload.players.slice()
      : [];
    mmOverlayPlayers = payload?.yourTeam
      ? matchedPlayers.sort((a, b) => {
          const aIsYours = a?.team === payload.yourTeam ? 0 : 1;
          const bIsYours = b?.team === payload.yourTeam ? 0 : 1;
          return aIsYours - bIsYours;
        })
      : matchedPlayers;
    mmOverlayPlayersSig = JSON.stringify(
      mmOverlayPlayers.map((p) => `${p?.name || ""}:${p?.char_class || ""}`),
    );
    mmOverlayTotal = getTotalPlayersForSelection(normalized);
    updateMMOverlay({
      found: mmOverlayPlayers.length,
      total: mmOverlayTotal,
      selection: normalized,
      players: mmOverlayPlayers,
    });
    if (payload?.matchId) {
      if (__matchmakingReadyAckTimer) {
        window.clearTimeout(__matchmakingReadyAckTimer);
      }
      const successTimeRemaining = Math.max(
        0,
        MATCHMAKING_SUCCESS_HOLD_MS -
          (Date.now() - (__matchmakingReadyAt || Date.now())),
      );
      __matchmakingReadyAckTimer = window.setTimeout(() => {
        socket.emit("ready:ack", { matchId: payload.matchId });
        __matchmakingReadyAckTimer = null;
      }, successTimeRemaining);
    }
  });

  // When match is ready to start, redirect to game
  socket.on("match:gameReady", async (payload) => {
    if (__postBattleLobbyReturn) return;
    try {
      const { matchId } = payload;
      if (!matchId) {
        console.error("No matchId in gameReady payload");
        return;
      }

      const currentPartyId = getActivePartyId();
      console.log("[join-debug] match:gameReady redirecting", {
        matchId,
        currentPartyId: currentPartyId || null,
        href: window.location.href,
      });

      const successTimeRemaining = Math.max(
        0,
        MATCHMAKING_SUCCESS_HOLD_MS -
          (Date.now() - (__matchmakingReadyAt || Date.now())),
      );
      if (successTimeRemaining > 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, successTimeRemaining);
        });
      }

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
      const currentPartyId = getActivePartyId();
      console.error("[join-debug] queue:error", {
        currentPartyId: currentPartyId || null,
        message: err?.message || null,
        raw: err || null,
      });
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

  socket.on("queue:fill-bots:error", (err) => {
    sonner(
      "Bot fill failed",
      err?.message || "Unable to fill this queue with bots.",
      "error",
    );
  });

  socket.on("party:kicked", (data) => {
    sonner(
      "Removed from party",
      data?.actorName
        ? `${data.actorName} removed you from the party.`
        : "You were removed from the party.",
      "error",
    );
    hidePartyJoinRequestScreen();
    window.location.href = "/";
  });

  // Match cancelled (e.g., ready timeout) -> hide overlay
  socket.on("match:cancelled", (data) => {
    const currentPartyId = getActivePartyId();
    console.warn("[join-debug] match:cancelled", {
      currentPartyId: currentPartyId || null,
      reason: data?.reason || null,
    });
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
    if (__postBattleLobbyReturn) return;
    const currentSelection = getCurrentSelection();
    const targetSelection = normalizeGameSelection(
      activeQueueContext?.selection || currentSelection,
    );
    const incomingSelection = normalizeGameSelection(
      data?.selection || {
        modeId: data?.modeId,
        modeVariantId: data?.modeVariantId,
        mapId: data?.map,
      },
    );
    // Only update if it matches the current selection
    if (
      incomingSelection.modeId !== targetSelection.modeId ||
      incomingSelection.modeVariantId !== targetSelection.modeVariantId ||
      Number(incomingSelection.mapId) !== Number(targetSelection.mapId)
    )
      return;

    // Keep overlay context aligned to server payload while queued.
    activeQueueContext = { selection: incomingSelection };

    const overlay = document.getElementById("matchmaking-overlay");
    if (overlay && overlay.classList.contains("hidden")) {
      showMatchmakingOverlay();
    }
    const foundCount = Number(data?.found) || 0;
    const totalCount =
      Number(data?.total) || getTotalPlayersForSelection(incomingSelection);

    const incomingPlayers = Array.isArray(data?.players) ? data.players : [];
    const fallbackLocalPlayers = collectCurrentPartyMembers().slice(
      0,
      Math.min(foundCount, totalCount),
    );
    const nextPlayers = incomingPlayers.length
      ? incomingPlayers
      : fallbackLocalPlayers;
    if (Array.isArray(nextPlayers)) {
      const nextSig = JSON.stringify(
        nextPlayers.map((p) => `${p?.name || ""}:${p?.char_class || ""}`),
      );
      if (nextSig !== mmOverlayPlayersSig) {
        mmOverlayPlayersSig = nextSig;
        mmOverlayPlayers = nextPlayers;
      }
    }
    mmOverlayTotal = totalCount;
    updateMMOverlay({
      found: foundCount,
      total: mmOverlayTotal,
      selection: incomingSelection,
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

function getLobbyMemberKey(value) {
  const name = typeof value === "string" ? value : value?.name;
  return String(name || "")
    .trim()
    .toLowerCase();
}

function getCurrentLobbyUserName() {
  return String(
    document.getElementById("username-text")?.textContent ||
      window.__BRO_BATTLES_USERDATA__?.name ||
      "",
  ).trim();
}

function getRenderedLobbyMemberSlots() {
  const rendered = new Map();
  document.querySelectorAll(".character-slot").forEach((slot) => {
    const key = getLobbyMemberKey(slot.dataset.playerName);
    if (key) rendered.set(key, slot);
  });
  return rendered;
}

function commitPartyRosterLayout({
  members,
  currentUserName,
  layoutSlots,
  spawnMemberKeys,
}) {
  updatePlatformsForMode(layoutSlots);

  const team1Members = members.filter((member) => member.team === "team1");
  const team2Members = members.filter((member) => member.team === "team2");
  const currentUser = members.find(
    (member) => getLobbyMemberKey(member) === getLobbyMemberKey(currentUserName),
  );
  const currentUserTeam = currentUser ? currentUser.team : "team1";
  const yourTeamMembers =
    currentUserTeam === "team1" ? team1Members : team2Members;
  const opponentTeamMembers =
    currentUserTeam === "team1" ? team2Members : team1Members;
  const desiredSlots = new Map();

  yourTeamMembers.forEach((member, index) => {
    desiredSlots.set(`your-slot-${index + 1}`, {
      member,
      isYourTeam: true,
    });
  });
  opponentTeamMembers.forEach((member, index) => {
    desiredSlots.set(`op-slot-${index + 1}`, {
      member,
      isYourTeam: false,
    });
  });

  console.log("[party] team split", {
    yourTeam: currentUserTeam,
    team1: team1Members.map((member) => member.name),
    team2: team2Members.map((member) => member.name),
  });

  document.querySelectorAll(".character-slot").forEach((slot) => {
    const desired = desiredSlots.get(slot.id);
    const previousKey = getLobbyMemberKey(slot.dataset.playerName);

    if (!desired) {
      if (previousKey || !slot.classList.contains("empty")) {
        resetSlotToRandom(slot);
      }
      return;
    }

    const desiredKey = getLobbyMemberKey(desired.member);
    const shouldSpawn =
      spawnMemberKeys.has(desiredKey) || (!previousKey && Boolean(desiredKey));

    if (slot.classList.contains("lobby-spawn-exit")) {
      clearLobbySpawnAnimation(slot);
    }
    if (previousKey && previousKey !== desiredKey) {
      resetSlotToRandom(slot);
    }

    applyMemberToSlot(desired.member, slot.id, desired.isYourTeam);
    if (shouldSpawn) playLobbySpawnAnimation(slot, "enter");
  });
}

export function renderPartyMembers(data) {
  const members = Array.isArray(data.members) ? data.members : [];
  const capacity =
    data?.capacity && typeof data.capacity === "object" ? data.capacity : null;
  __partyContext = {
    partyId:
      data?.partyId || __partyContext.partyId || checkIfInParty() || null,
    ownerName: data?.ownerName || __partyContext.ownerName || null,
    allowMemberSelection:
      data?.allowMemberSelection ?? __partyContext.allowMemberSelection,
    isPublic: data?.isPublic ?? __partyContext.isPublic,
    publicName: String(data?.publicName ?? __partyContext.publicName).trim(),
    capacity,
    members,
  };

  syncModePickerUi();
  syncMapPickerUi(getCurrentMapValue());
  if (!canChangePartySelection()) {
    __mapPopupUi?.closePopup();
    __modePopupUi?.closePopup();
  }
  const currentUserName = getCurrentLobbyUserName();
  const currentSelection = normalizeGameSelection(
    data?.selection || getCurrentSelection(),
  );
  const requestedSlots = Math.max(
    1,
    getPlayersPerTeamForSelection(currentSelection),
    Number(data?.mode) || 0,
  );
  const team1Members = members.filter((member) => member.team === "team1");
  const team2Members = members.filter((member) => member.team === "team2");
  const layoutSlots = Math.max(
    1,
    requestedSlots,
    team1Members.length,
    team2Members.length,
  );
  const renderedSlots = getRenderedLobbyMemberSlots();
  const nextMemberKeys = new Set(members.map(getLobbyMemberKey).filter(Boolean));
  const spawnMemberKeys = new Set(
    [...nextMemberKeys].filter((key) => !renderedSlots.has(key)),
  );
  const exitingSlots = [...renderedSlots.entries()]
    .filter(([key]) => !nextMemberKeys.has(key))
    .map(([, slot]) => slot);
  const renderSequence = ++__partyRosterRenderSequence;

  if (__partyRosterCommitTimer) {
    window.clearTimeout(__partyRosterCommitTimer);
    __partyRosterCommitTimer = null;
  }

  console.log("[party] renderPartyMembers()", {
    partyId: data?.partyId,
    mode: requestedSlots,
    currentUserName,
    joining: [...spawnMemberKeys],
    leaving: exitingSlots.map((slot) => slot.dataset.playerName),
    members: members.map((member) => ({
      name: member?.name,
      team: member?.team,
      status: member?.status,
      char_class: member?.char_class,
    })),
  });

  const commit = () => {
    if (renderSequence !== __partyRosterRenderSequence) return;
    __partyRosterCommitTimer = null;
    commitPartyRosterLayout({
      members,
      currentUserName,
      layoutSlots,
      spawnMemberKeys,
    });
  };

  if (exitingSlots.length && !prefersReducedLobbyMotion()) {
    let exitDuration = 0;
    exitingSlots.forEach((slot) => {
      if (slot.classList.contains("lobby-spawn-exit")) {
        exitDuration = Math.max(
          exitDuration,
          getLobbySpawnTimeRemaining(slot),
        );
        return;
      }
      exitDuration = Math.max(
        exitDuration,
        playLobbySpawnAnimation(slot, "exit"),
      );
    });
    __partyRosterCommitTimer = window.setTimeout(commit, exitDuration);
    return;
  }

  commit();
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
  const previousPlayerKey = getLobbyMemberKey(slot.dataset.playerName);
  const previousCharacter = String(slot.dataset.character || "").trim();
  const currentUserName = getCurrentLobbyUserName();
  const isCurrentUser = member.name === currentUserName;
  const displayName = isCurrentUser ? `${member.name} (You)` : member.name;
  // Mark slot ownership for delegated handlers
  slot.dataset.isCurrentUser = isCurrentUser ? "true" : "false";
  slot.dataset.playerName = member.name || "";
  slot.dataset.playerTeam = member.team || "";
  slot.dataset.isOwner =
    member.name === __partyContext.ownerName ? "true" : "false";

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
    const skinAsset =
      String(member.selected_skin_asset_url || "").trim() ||
      buildCharacterSkinBodyUrl(cls, "");
    spriteEl.src = skinAsset;
    spriteEl.alt = cls;
    spriteEl.classList.remove("random");
    if (
      previousPlayerKey === getLobbyMemberKey(member) &&
      previousCharacter &&
      previousCharacter !== "Random" &&
      previousCharacter !== cls
    ) {
      triggerLobbyCharacterSplash(slot);
    }
  }

  if (statusEl) {
    ensureLobbySelectingRing(slot);
    const previousStatus = statusEl.textContent || "";
    const st = normalizeStatusLabel(member.status || "online");
    statusEl.textContent = st;
    statusEl.className = `status ${statusToClass(st)}`;
    if (checkIfInParty()) statusEl.style.display = "";
    if (previousPlayerKey === getLobbyMemberKey(member)) {
      applyLobbyStatusVisualState(slot, previousStatus, st);
    } else {
      slot.classList.toggle(
        "is-selecting-character",
        statusToClass(st) === "selecting-character",
      );
    }
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

  slot.classList.remove("empty", "player-display", "op-display");
  slot.classList.add(isYourTeam ? "player-display" : "op-display");
  slot.dataset.character = member.char_class || "ninja";
  setSlotLevelBadge(slot, getMemberLevel(member));

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

  if (!modeDropdown || !mapDropdown) return;
  bindLobbyOffsetResizeHandler();
  const applySelectionVisuals = (
    selection,
    { animateMap = false, updateBackground = true } = {},
  ) => {
    const normalized = writeSelectionToDom(selection, { persist: isSolo });
    const teamSize = getPlayersPerTeamForSelection(normalized);
    const legacyMode = selectionToLegacyMode(normalized);
    updatePlatformsForMode(String(teamSize));
    if (normalized.mapId != null) {
      if (updateBackground) setLobbyBackground(String(normalized.mapId));
      applyPlatformImageForMap(String(normalized.mapId));
      applyLobbyCharacterOffsetForMap(
        String(normalized.mapId),
        String(teamSize),
      );
      if (animateMap) animatePlatformsForMapSwitch();
    } else {
      syncMapPickerUi("", normalized);
    }
    return normalized;
  };

  let initialSelection = getCurrentSelection();
  if (isSolo) {
    const savedSelection = getSavedSelectionFromUserData();
    initialSelection = normalizeGameSelection({
      modeId:
        savedSelection?.modeId ||
        getSoloSelection(SOLO_MODE_ID_STORAGE_KEY) ||
        document.getElementById("mode-id")?.value ||
        "duels",
      modeVariantId:
        savedSelection?.modeVariantId ||
        getSoloSelection(SOLO_MODE_VARIANT_STORAGE_KEY) ||
        legacyModeToVariantId(getSoloSelection(SOLO_MODE_STORAGE_KEY)) ||
        document.getElementById("mode-variant-id")?.value ||
        "duels-1v1",
      mapId:
        savedSelection?.mapId ||
        getSoloSelection(SOLO_MAP_STORAGE_KEY) ||
        getCurrentMapValue(),
    });
  }
  // The party DOM starts with map 1 as placeholder content. Do not paint that
  // placeholder while the authoritative party selection is still loading.
  applySelectionVisuals(initialSelection, { updateBackground: isSolo });

  const handleModeSelection = async (selection) => {
    if (!canChangePartySelection()) return;
    const username = document.getElementById("username-text")?.textContent;
    const previousSelection = getCurrentSelection();
    const nextSelection = normalizeGameSelection(selection);

    if (partyId) {
      try {
        const response = await fetch("/party-members", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ partyId }),
        });
        if (!response.ok) throw new Error("Failed to fetch party members");
        const data = await response.json();
        const requiredSlots = getPlayersPerTeamForSelection(nextSelection) * 2;
        if (
          nextSelection.modeId === "duels" &&
          requiredSlots < Number(data.membersCount || 0)
        ) {
          sonner(
            "Too many players for this duel size!",
            "Please remove players before shrinking the duel format.",
            "error",
          );
          applySelectionVisuals(previousSelection);
          return;
        }

        if (!canChangePartySelection()) return;
        const applied = applySelectionVisuals(nextSelection);
        socket.emit("mode-change", {
          selection: applied,
          username,
          partyId,
          members: data.members,
        });
      } catch (error) {
        console.error("Error changing mode:", error);
        sonner(
          "Failed to change mode",
          "Please try again. If the problem persists, try refreshing the page.",
          "error",
        );
        applySelectionVisuals(previousSelection);
      }
      return;
    }

    const applied = applySelectionVisuals(nextSelection);
    await persistSoloSelection(applied);
  };

  setupModePickerControls(handleModeSelection);
  setupMapPickerControls();

  if (mapDropdown.dataset.bound !== "1") {
    mapDropdown.dataset.bound = "1";
    mapDropdown.addEventListener("change", (event) => {
      if (!canChangePartySelection()) return;
      const selectedValue = event.target.value;
      const username = document.getElementById("username-text")?.textContent;
      const applied = applySelectionVisuals(
        {
          ...getCurrentSelection(),
          mapId: selectedValue || null,
        },
        { animateMap: true },
      );

      if (partyId) {
        socket.emit("map-change", {
          selection: applied,
          username,
          partyId,
        });
      } else if (selectedValue) {
        void persistSoloSelection(applied);
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
  applyLobbyCharacterOffsetForMap(getCurrentMapValue(), mode);
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

  const levelBadge = document.createElement("div");
  levelBadge.className = "slot-level-badge";
  levelBadge.setAttribute("aria-hidden", "true");
  characterSlot.appendChild(levelBadge);

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
  status.style.display = checkIfInParty() ? "" : "none";
  status.style.cursor = "pointer";
  status.style.pointerEvents = "auto";

  // Add invite click functionality
  status.addEventListener("click", (event) => {
    event.stopPropagation();
    if (status.classList.contains("invite") && checkIfInParty()) {
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

  clearLobbySpawnAnimation(slot);

  username.textContent = "Random";
  sprite.src = "/assets/random.webp";
  sprite.alt = "Random";
  sprite.classList.add("random");
  statusEl.className = "status invite";
  statusEl.textContent = "Invite";
  statusEl.style.display = checkIfInParty() ? "" : "none";
  statusEl.style.cursor = "pointer";
  statusEl.style.pointerEvents = "auto";
  slot.classList.remove(
    "player-display",
    "op-display",
    "character-splash",
    "lobby-spawn-enter",
    "lobby-spawn-exit",
    "lobby-ready-burst",
    "lobby-unready-burst",
    "is-selecting-character",
  );
  slot.classList.add("empty");
  slot.dataset.character = "Random";
  slot.dataset.isCurrentUser = "false";
  slot.dataset.playerName = "";
  slot.dataset.playerTeam = "";
  slot.dataset.isOwner = "false";
  setSlotLevelBadge(slot, null);
  // Hide switch-character if present
  const switchEl = slot.querySelector(".switch-character");
  if (switchEl) switchEl.style.display = "none";
  // Preserve slot.id so future updates can target this slot reliably

  // Re-add invite functionality
  const newStatusEl = statusEl.cloneNode(true);
  statusEl.parentNode.replaceChild(newStatusEl, statusEl);

  newStatusEl.addEventListener("click", (event) => {
    event.stopPropagation();
    if (newStatusEl.classList.contains("invite") && checkIfInParty()) {
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
  const readyBtn = document.getElementById("ready");
  if (!readyBtn) return;
  // Avoid duplicate bindings when UI re-renders
  if (readyBtn.dataset.bound === "1") return;
  readyBtn.dataset.bound = "1";

  readyBtn.addEventListener("click", () => {
    __postBattleLobbyReturn = false;
    // Find current user's status element to update optimistically
    const selfSlot = Array.from(
      document.querySelectorAll(".character-slot"),
    ).find((s) => s.dataset.isCurrentUser === "true");
    const statusEl = selfSlot?.querySelector(".status");
    if (!statusEl) return;

    const cur = (statusEl.textContent || "").toLowerCase();
    const nextReady = !cur.includes("ready");
    const partyId = getActivePartyId();

    if (nextReady && !partyId) {
      const blockReason = getSelectionBlockReason(getCurrentSelection());
      if (blockReason) {
        sonner("Mode not ready", blockReason, "error");
        return;
      }
    }

    // Optimistic local update
    statusEl.textContent = nextReady ? "ready" : "online";
    statusEl.className = `status ${nextReady ? "ready" : "online"}`;
    applyLobbyStatusVisualState(
      selfSlot,
      cur,
      nextReady ? "ready" : "online",
    );
    // Update Ready button appearance/label
    setReadyButtonState(nextReady);

    if (partyId) {
      // Party flow: server will show overlay when all ready
      socket.emit("ready:status", { partyId, ready: nextReady });
    } else {
      // Solo flow: directly join/leave the queue and control overlay locally
      if (nextReady) {
        const selection = getCurrentSelection();
        const map = Number(selection.mapId) || 1;
        const side = "team1"; // default; server may flip if needed
        activeQueueContext = { selection };
        mmOverlayTotal = getTotalPlayersForSelection(selection);
        socket.emit("queue:join", {
          selection,
          modeId: selection.modeId,
          modeVariantId: selection.modeVariantId,
          map,
          side,
        });
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

function setLobbyChromeInert(shouldBeInert) {
  document
    .querySelectorAll(
      "#navbar, body > .party-button, .lobby-quick-actions, #lobby-area, #bottom-bar, .bb-chat-lobby-wrap",
    )
    .forEach((element) => {
      element.inert = shouldBeInert;
    });
}

function ensureMatchmakingParticles() {
  const field = document.getElementById("mm-particles");
  if (!field || field.childElementCount) return;

  // A deterministic field keeps the scene varied without changing between
  // overlay opens or consuming animation-frame JavaScript.
  for (let index = 0; index < 38; index += 1) {
    const particle = document.createElement("i");
    const lane = (index * 37 + 11) % 101;
    const size = 2 + ((index * 13) % 6);
    const duration = 4.2 + ((index * 17) % 42) / 10;
    const delay = -((index * 29) % 86) / 10;
    const drift = -42 + ((index * 31) % 85);
    const opacity = 0.2 + ((index * 19) % 55) / 100;

    particle.style.setProperty("--mm-particle-x", `${lane}%`);
    particle.style.setProperty("--mm-particle-size", `${size}px`);
    particle.style.setProperty("--mm-particle-duration", `${duration}s`);
    particle.style.setProperty("--mm-particle-delay", `${delay}s`);
    particle.style.setProperty("--mm-particle-drift", `${drift}px`);
    particle.style.setProperty("--mm-particle-opacity", String(opacity));
    field.appendChild(particle);
  }
}

export function showMatchmakingOverlay() {
  const overlay = ensureOverlay();
  if (!overlay) return;
  if (__postBattleLobbyReturn) return;
  if (__matchmakingHideTimer) {
    window.clearTimeout(__matchmakingHideTimer);
    __matchmakingHideTimer = null;
  }
  ensureMatchmakingParticles();
  const selection = normalizeGameSelection(
    activeQueueContext?.selection || getCurrentSelection(),
  );
  document.body.classList.remove("matchmaking-exiting");
  document.body.classList.add("matchmaking-active");
  setLobbyChromeInert(true);
  overlay.classList.remove("hidden");
  overlay.classList.remove("is-exiting");
  void overlay.offsetWidth;
  overlay.classList.add("is-visible");
  overlay.setAttribute("aria-hidden", "false");
  updateMMOverlay({
    found: mmOverlayPlayers.length,
    total: mmOverlayTotal || getTotalPlayersForSelection(selection),
    selection,
    players: mmOverlayPlayers,
  });
  wireCancelButton();
  wireAdminFillBotsButtons();
  const fillBtn = document.getElementById("mm-fill-bots");
  const fillUnlimitedBtn = document.getElementById("mm-fill-bots-unlimited");
  const isAdmin = !!window.__BRO_BATTLES_USERDATA__?.isAdmin;
  if (fillBtn) fillBtn.classList.toggle("hidden", !isAdmin);
  if (fillUnlimitedBtn) fillUnlimitedBtn.classList.toggle("hidden", !isAdmin);
}

export function hideMatchmakingOverlay({ immediate = false } = {}) {
  const overlay = ensureOverlay();
  if (!overlay) return;
  if (__matchmakingReadyAckTimer) {
    window.clearTimeout(__matchmakingReadyAckTimer);
    __matchmakingReadyAckTimer = null;
  }
  __matchmakingReadyAt = 0;
  if (immediate) {
    if (__matchmakingHideTimer) {
      window.clearTimeout(__matchmakingHideTimer);
      __matchmakingHideTimer = null;
    }
    overlay.setAttribute("aria-hidden", "true");
    overlay.classList.add("hidden");
    overlay.classList.remove("is-visible", "is-exiting");
    document.body.classList.remove(
      "matchmaking-active",
      "matchmaking-exiting",
    );
    setLobbyChromeInert(false);
    return;
  }
  if (overlay.classList.contains("hidden")) {
    document.body.classList.remove(
      "matchmaking-active",
      "matchmaking-exiting",
    );
    setLobbyChromeInert(false);
    return;
  }
  overlay.setAttribute("aria-hidden", "true");
  overlay.classList.remove("is-visible");
  overlay.classList.add("is-exiting");
  document.body.classList.remove("matchmaking-active");
  document.body.classList.add("matchmaking-exiting");
  setLobbyChromeInert(false);

  if (__matchmakingHideTimer) window.clearTimeout(__matchmakingHideTimer);
  __matchmakingHideTimer = window.setTimeout(() => {
    overlay.classList.add("hidden");
    overlay.classList.remove("is-exiting");
    document.body.classList.remove("matchmaking-exiting");
    __matchmakingHideTimer = null;
  }, MATCHMAKING_EXIT_MS);
}

function restoreLobbyAfterBattleReturn() {
  __postBattleLobbyReturn = true;
  activeQueueContext = null;
  mmOverlayPlayers = [];
  mmOverlayPlayersSig = "";
  mmOverlayTotal = 0;
  hideMatchmakingOverlay({ immediate: true });

  const partyId = getActivePartyId();
  if (partyId) socket.emit("ready:status", { partyId, ready: false });
  else socket.emit("queue:leave");

  const selfSlot = Array.from(
    document.querySelectorAll(".character-slot"),
  ).find((slot) => slot.dataset.isCurrentUser === "true");
  const statusEl = selfSlot?.querySelector(".status");
  if (statusEl) {
    statusEl.textContent = "online";
    statusEl.className = "status online";
  }
  setReadyButtonState(false);
}

function mapNameFromId(id) {
  return getMapLabel(id);
}

function modeNameFromSelection(selection) {
  return getSelectionDisplayLabel(
    normalizeGameSelection(selection || getCurrentSelection()),
  );
}

function updateMMOverlay({ found, total, selection, players }) {
  const overlay = ensureOverlay();
  const headingEl = document.getElementById("mm-heading");
  const labelEl = document.querySelector(".mm-progress .mm-label");
  const foundEl = document.getElementById("mm-found");
  const totalEl = document.getElementById("mm-total");
  const modeEl = document.getElementById("mm-mode");
  const mapEl = document.getElementById("mm-map");
  const grid = document.getElementById("mm-players");
  const normalized = normalizeGameSelection(
    selection || activeQueueContext?.selection || getCurrentSelection(),
  );
  const foundCount = Math.max(0, Number(found) || 0);
  const totalCount =
    Number(total) || getTotalPlayersForSelection(normalized) || 0;
  const isFull = totalCount > 0 && foundCount >= totalCount;

  if (overlay) {
    const previousState = overlay.dataset.state;
    overlay.dataset.state = isFull ? "ready" : "searching";
    overlay.style.setProperty(
      "--mm-map-background",
      `url("${getLobbyBgAsset(normalized.mapId)}")`,
    );
    if (isFull && previousState !== "ready") {
      __matchmakingReadyAt = Date.now();
    }
    if (!isFull) __matchmakingReadyAt = 0;
  }
  if (headingEl) headingEl.textContent = isFull ? "Match Found" : "Matchmaking";
  if (labelEl) labelEl.textContent = isFull ? "Starting" : "Players";
  if (foundEl && foundEl.textContent !== String(foundCount)) {
    foundEl.textContent = String(foundCount);
    foundEl.classList.remove("is-updating");
    void foundEl.offsetWidth;
    foundEl.classList.add("is-updating");
    if (__matchmakingCountTimer) {
      window.clearTimeout(__matchmakingCountTimer);
    }
    __matchmakingCountTimer = window.setTimeout(() => {
      foundEl.classList.remove("is-updating");
      __matchmakingCountTimer = null;
    }, 520);
  }
  if (totalEl) {
    totalEl.textContent = String(totalCount);
  }
  if (modeEl) modeEl.textContent = modeNameFromSelection(normalized);
  if (mapEl) {
    mapEl.textContent =
      normalized.mapId != null
        ? mapNameFromId(normalized.mapId)
        : "No Compatible Maps";
  }
  if (grid) {
    const playersArr = Array.isArray(players) ? players : [];
    const nextSig = JSON.stringify({
      total: totalCount,
      mapId: normalized.mapId,
      players: playersArr.map(
        (p) =>
          `${p?.name || ""}:${p?.char_class || ""}:${p?.selected_skin_id || ""}:${p?.selected_skin_asset_url || ""}`,
      ),
    });
    if (nextSig === grid.dataset.renderSig) return;
    grid.dataset.renderSig = nextSig;

    const previousPlayerKeys = new Set(
      Array.from(grid.querySelectorAll(".mm-player[data-player-key]")).map(
        (item) => item.dataset.playerKey,
      ),
    );
    grid.innerHTML = "";
    grid.style.setProperty("--mm-slot-count", String(totalCount));
    grid.dataset.slots = String(totalCount);
    grid.style.setProperty(
      "--mm-platform-image",
      `url("${getLobbyPlatformAsset(normalized.mapId)}")`,
    );

    for (let i = 0; i < totalCount; i++) {
      const p = playersArr[i];
      const item = document.createElement("div");
      item.className = "mm-player" + (p ? "" : " placeholder");
      item.style.setProperty("--mm-slot-index", String(i));
      item.style.setProperty("--mm-success-visual-delay", `${120 + i * 55}ms`);
      item.style.setProperty("--mm-success-name-delay", `${260 + i * 45}ms`);
      item.dataset.team = p?.team
        ? p.team === activeQueueContext?.yourTeam
          ? "blue"
          : "red"
        : i < Math.ceil(totalCount / 2)
          ? "blue"
          : "red";

      const visual = document.createElement("div");
      visual.className = "mm-player-visual";

      if (p) {
        const playerKey = `${String(p.name || "player").trim().toLowerCase()}:${i}`;
        item.dataset.playerKey = playerKey;
        if (!previousPlayerKeys.has(playerKey)) {
          item.classList.add("mm-player-arriving");
        }

        const arrival = document.createElement("div");
        arrival.className = "mm-arrival-fx";
        arrival.setAttribute("aria-hidden", "true");
        arrival.innerHTML =
          '<i></i><i></i><i></i><i></i><i></i><i></i><span></span>';

        const img = document.createElement("img");
        const cls = p.char_class || "ninja";
        img.src =
          String(p.selected_skin_asset_url || "").trim() ||
          buildCharacterSkinBodyUrl(cls, "");
        img.alt = cls;
        img.className = "mm-character";
        const name = document.createElement("div");
        name.className = "mm-name";
        name.textContent = p.name || "Player";
        const platform = document.createElement("div");
        platform.className = "mm-platform";
        platform.setAttribute("aria-hidden", "true");

        visual.appendChild(arrival);
        visual.appendChild(img);
        visual.appendChild(platform);
        item.appendChild(visual);
        item.appendChild(name);
        if (item.classList.contains("mm-player-arriving")) {
          window.setTimeout(() => {
            item.classList.remove("mm-player-arriving");
          }, 1100);
        }
      } else {
        const beacon = document.createElement("div");
        beacon.className = "mm-slot-beacon";
        beacon.setAttribute("aria-hidden", "true");
        beacon.innerHTML = "<i></i><i></i><i></i>";
        const name = document.createElement("div");
        name.className = "mm-name";
        name.textContent = "Searching";
        const platform = document.createElement("div");
        platform.className = "mm-platform";
        platform.setAttribute("aria-hidden", "true");
        visual.appendChild(beacon);
        visual.appendChild(platform);
        item.appendChild(visual);
        item.appendChild(name);
      }
      grid.appendChild(item);
    }
  }
}

function syncReadyAvailability(selection = getCurrentSelection()) {
  const btn = document.getElementById("ready");
  if (!btn) return { blocked: false, reason: "" };

  const normalized = normalizeGameSelection(selection);
  const reason = getSelectionBlockReason(normalized);
  const blocked = Boolean(reason);
  const isCancelState = btn.classList.contains("cancel");

  btn.disabled = blocked && !isCancelState;
  btn.title = blocked ? reason : "";
  btn.classList.toggle("is-disabled", blocked && !isCancelState);

  if (!isCancelState) {
    btn.value = blocked ? "Unavailable" : "Ready";
  }

  return { blocked, reason, selection: normalized };
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
    const partyId = getActivePartyId();
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
      syncReadyAvailability();
    } catch {}
  });
}

function wireAdminFillBotsButtons() {
  const btn = document.getElementById("mm-fill-bots");
  if (btn && btn.dataset.bound !== "1") {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      socket.emit("queue:fill-bots");
    });
  }

  const unlimitedBtn = document.getElementById("mm-fill-bots-unlimited");
  if (unlimitedBtn && unlimitedBtn.dataset.bound !== "1") {
    unlimitedBtn.dataset.bound = "1";
    unlimitedBtn.addEventListener("click", () => {
      socket.emit("queue:fill-bots", {
        mode: "unlimited-health",
        botHealthOverride: 9999999,
      });
    });
  }
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
  syncReadyAvailability();
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

export function getPartyInteractionContext() {
  return {
    partyId: __partyContext.partyId || checkIfInParty() || null,
    ownerName: __partyContext.ownerName || null,
    allowMemberSelection: __partyContext.allowMemberSelection !== false,
    isPublic: !!__partyContext.isPublic,
    publicName: String(__partyContext.publicName || "").trim(),
    capacity:
      __partyContext.capacity && typeof __partyContext.capacity === "object"
        ? { ...__partyContext.capacity }
        : null,
    members: Array.isArray(__partyContext.members)
      ? __partyContext.members.slice()
      : [],
  };
}

export { setSlotLevelBadge };
