import { sonner } from "./lib/sonner.js";
import socket, { ensureSocketConnected, waitForConnect } from "./socket";
import { getSharedSelectionPopupShell } from "./lib/selectionPopupShell.js";
import {
  getLobbyCharacterOffsetY,
  getMapSelectPreviewAsset,
  getLobbyPlatformAsset,
} from "./maps/manifest";
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

// Track last known party roster to detect joins/leaves
let __partyRosterNames = null; // Set<string> of member names
let __partyRosterPartyId = null;
const SOLO_MODE_STORAGE_KEY = "bb_solo_mode";
const SOLO_MODE_ID_STORAGE_KEY = "bb_solo_mode_id";
const SOLO_MODE_VARIANT_STORAGE_KEY = "bb_solo_mode_variant_id";
const SOLO_MAP_STORAGE_KEY = "bb_solo_map";
let activeQueueContext = null; // { selection }
let mmOverlayPlayers = [];
let mmOverlayPlayersSig = "";
let mmOverlayTotal = 0;
let __lobbyOffsetResizeBound = false;
let __mapPopupUi = null;
let __modePopupUi = null;
let __partyContext = {
  partyId: null,
  ownerName: null,
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

function triggerLobbyCharacterSplash(slot) {
  if (!slot) return;
  slot.classList.remove("character-splash");
  void slot.offsetWidth;
  slot.classList.add("character-splash");
  window.setTimeout(() => {
    slot.classList.remove("character-splash");
  }, 700);
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

  mapDropdown.disabled = compatibleMaps.length === 0;
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
    openBtn.classList.toggle(
      "is-disabled",
      !isSelectionQueueable(normalized) && normalized.modeId !== "duels",
    );
    openBtn.title = mode?.description || "";
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
    openBtn.disabled = compatibleMaps.length === 0;
    openBtn.classList.toggle("is-disabled", compatibleMaps.length === 0);
    openBtn.title =
      compatibleMaps.length === 0
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

export function socketInit(options = {}) {
  const currentPartyId = checkIfInParty();
  __joinRequestProfilePopup = options?.profilePopup || null;
  wireJoinRequestOverlayControls();

  // Safety: if code runs before index.js triggered connection (e.g., alternate entry), ensure connect once.
  if (!socket.connected) ensureSocketConnected();

  // Connection lifecycle
  socket.on("connect", () => {
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
      __partyContext.isPublic = false;
      __partyContext.publicName = "";
      __partyContext.capacity = null;
      __partyContext.members = [];
    }
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
    if (currentPartyId && String(evt.partyId) !== String(currentPartyId))
      return;
    const normalized = normalizeStatusLabel(evt.status || "online");
    const targetName = String(evt.name || "").trim();
    if (targetName) {
      const member = Array.isArray(__partyContext.members)
        ? __partyContext.members.find(
            (item) =>
              String(item?.name || "").trim().toLowerCase() ===
              targetName.toLowerCase(),
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

  // Party-wide: everyone ready -> show matchmaking overlay
  socket.on("party:matchmaking:start", ({ partyId, selection }) => {
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

  // When a match is found, update overlay and auto-ack ready for this client
  socket.on("match:found", (payload) => {
    console.log("[join-debug] match:found", {
      currentPartyId: currentPartyId || null,
      matchId: payload?.matchId ?? null,
      playerCount: Array.isArray(payload?.players) ? payload.players.length : 0,
      selection: payload?.selection || null,
    });
    const normalized = normalizeGameSelection(
      payload?.selection || getCurrentSelection(),
    );
    activeQueueContext = { selection: normalized };
    mmOverlayPlayers = Array.isArray(payload?.players) ? payload.players : [];
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

      console.log("[join-debug] match:gameReady redirecting", {
        matchId,
        currentPartyId: currentPartyId || null,
        href: window.location.href,
      });

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
    mmOverlayTotal =
      Number(data?.total) || getTotalPlayersForSelection(incomingSelection);
    updateMMOverlay({
      found: Number(data?.found) || 0,
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

export function renderPartyMembers(data) {
  const members = Array.isArray(data.members) ? data.members : [];
  const capacity =
    data?.capacity && typeof data.capacity === "object" ? data.capacity : null;
  __partyContext = {
    partyId:
      data?.partyId || __partyContext.partyId || checkIfInParty() || null,
    ownerName: data?.ownerName || __partyContext.ownerName || null,
    isPublic: Number(data?.isPublic ? 1 : 0) === 1,
    publicName: String(data?.publicName || "").trim(),
    capacity,
    members,
  };
  const currentUserName =
    document.getElementById("username-text")?.textContent || "";
  const currentSelection = normalizeGameSelection(
    data?.selection || getCurrentSelection(),
  );
  const requestedSlots = Math.max(
    1,
    getPlayersPerTeamForSelection(currentSelection),
    Number(data?.mode) || 0,
  );
  const team1Members = members.filter((m) => m.team === "team1");
  const team2Members = members.filter((m) => m.team === "team2");
  const layoutSlots = Math.max(
    1,
    requestedSlots,
    team1Members.length,
    team2Members.length,
  );

  // Ensure platforms match the current mode
  updatePlatformsForMode(layoutSlots);

  console.log("[party] renderPartyMembers()", {
    partyId: data?.partyId,
    mode: requestedSlots,
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
    const prevCharacter = String(slot.dataset.character || "").trim();
    spriteEl.src = `/assets/${cls}/body.webp`;
    spriteEl.alt = cls;
    spriteEl.classList.remove("random");
    spriteEl.className = "character-sprite";
    if (prevCharacter && prevCharacter !== cls) {
      triggerLobbyCharacterSplash(slot);
    }
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
  const applySelectionVisuals = (selection, { animateMap = false } = {}) => {
    const normalized = writeSelectionToDom(selection, { persist: isSolo });
    const teamSize = getPlayersPerTeamForSelection(normalized);
    const legacyMode = selectionToLegacyMode(normalized);
    updatePlatformsForMode(String(teamSize));
    if (normalized.mapId != null) {
      setLobbyBackground(String(normalized.mapId));
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
  applySelectionVisuals(initialSelection);

  const handleModeSelection = async (selection) => {
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
        const selection = getCurrentSelection();
        const blockReason = getSelectionBlockReason(selection);
        if (blockReason) {
          statusEl.textContent = "online";
          statusEl.className = "status online";
          setReadyButtonState(false);
          sonner("Mode not ready", blockReason, "error");
          return;
        }
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

export function showMatchmakingOverlay() {
  const overlay = ensureOverlay();
  if (!overlay) return;
  const selection = normalizeGameSelection(
    activeQueueContext?.selection || getCurrentSelection(),
  );
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  updateMMOverlay({
    found: mmOverlayPlayers.length,
    total: mmOverlayTotal || getTotalPlayersForSelection(selection),
    selection,
    players: mmOverlayPlayers,
  });
  wireCancelButton();
  wireAdminFillBotsButton();
  const fillBtn = document.getElementById("mm-fill-bots");
  const isAdmin = !!window.__BRO_BATTLES_USERDATA__?.isAdmin;
  if (fillBtn) fillBtn.classList.toggle("hidden", !isAdmin);
}

export function hideMatchmakingOverlay() {
  const overlay = ensureOverlay();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
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
  const foundEl = document.getElementById("mm-found");
  const totalEl = document.getElementById("mm-total");
  const modeEl = document.getElementById("mm-mode");
  const mapEl = document.getElementById("mm-map");
  const grid = document.getElementById("mm-players");
  const normalized = normalizeGameSelection(
    selection || activeQueueContext?.selection || getCurrentSelection(),
  );
  if (foundEl) foundEl.textContent = String(found ?? 0);
  if (totalEl) {
    totalEl.textContent = String(
      Number(total) || getTotalPlayersForSelection(normalized),
    );
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
      total: Number(total) || getTotalPlayersForSelection(normalized) || 0,
      players: playersArr.map((p) => `${p?.name || ""}:${p?.char_class || ""}`),
    });
    if (nextSig === grid.dataset.renderSig) return;
    grid.dataset.renderSig = nextSig;

    grid.innerHTML = "";
    const count = Number(total) || getTotalPlayersForSelection(normalized) || 0;
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
      syncReadyAvailability();
    } catch {}
  });
}

function wireAdminFillBotsButton() {
  const btn = document.getElementById("mm-fill-bots");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    socket.emit("queue:fill-bots");
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
