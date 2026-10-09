import { escapeHtml } from "../../../shared/site/html.cjs";
import { MAINTENANCE_MESSAGE } from "../../../shared/site/maintenance";
import { warmBattleSelection } from '../preloadBattle';
import "../../styles/levelBadge.css";
import { revealLobby } from "../lobbyReveal.js";
import { refreshPlatformGrounding } from "./platformGrounding.mjs";
import { playPartyMoveEffect } from "./partyMoveEffect.js";
import { setLobbyBackground } from "../lobbyBackground.js";
import { createMatchmakingClient } from "../matchmaking/matchmakingClient.mjs";
import { createMatchmakingOverlay } from "../matchmaking/matchmakingOverlay.js";
import { createPartySlotDrag } from "./partySlotDrag.js";
import { setPartyButtonLabel } from "./partyButtonLabel.js";
import { ensureLegalAcceptance } from "../../site/shell";
import { createJoinRequestController } from './joinRequestController';
import { createMapEditorLink } from '../../lib/mapEditorLink';
import { sonner } from "../../ui/sonner.js";
import socket, { ensureSocketConnected } from "../../lib/socket";
import { getSharedSelectionPopupShell } from "../../ui/selectionPopupShell.js";
import { wireFullscreenToggles } from "../../ui/fullscreen.js";
import {
  getMapSelectPreviewAsset,
  getLobbyPlatformAsset,
} from "../../game/maps/manifest";
import { buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { DEFAULT_CHARACTER, resolveCharacterKey, parseCharacterLevels } from "../../../shared/characters/characterStats.js";
import { setSlotLevelBadge } from "../../views/levelBadgeView.js";
import {
  applyLobbyStatusVisualState,
  clearLobbySpawnAnimation,
  ensureLobbySelectingRing,
  getLobbySpawnTimeRemaining,
  normalizeStatusLabel,
  playLobbySpawnAnimation,
  prefersReducedLobbyMotion,
  statusToClass,
  triggerLobbyCharacterSplash,
} from "./slotEffects.js";
import {
  SOLO_MAP_STORAGE_KEY,
  SOLO_MODE_ID_STORAGE_KEY,
  SOLO_MODE_STORAGE_KEY,
  SOLO_MODE_VARIANT_STORAGE_KEY,
  getSavedSelectionFromUserData,
  getSoloSelection,
  persistSoloSelection,
  setSoloSelection,
} from "./soloSelection.js";
import { getBotSlotTarget, wirePartyBotSlotControls } from "./botSlotPicker.js";
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
  getModeProgressionBlockReason,
  getPlayersPerTeamForSelection,
  getSelectionBlockReason,
  getSelectionDisplayLabel,
  getTotalPlayersForSelection,
  isSelectionQueueable,
  legacyModeToVariantId,
  normalizeGameSelection,
  selectionToLegacyMode,
} from "../../lib/gameSelectionCatalog.js";
import { POST_BATTLE_LOBBY_RETURN_KEY } from "../../lib/storageKeys.js";

wireFullscreenToggles();
window.__BB_NAVIGATION__?.lobbyAudio?.enterLobby();

// Track last known party roster to detect joins/leaves
let __partyRosterNames = null; // Set<string> of member names
let __partyRosterPartyId = null;
let __partyRosterRenderSequence = 0;
let __partyRosterCommitTimer = null;
const __partyMoveAnimations = new WeakMap();
let __partyReadyPending = false;
let __partyReadyTarget = null;
let __partyReadyRequestId = 0;
const __readyLockedRoots = new Map();
let __activeBattleMatchId = null;
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
  botSlots: [],
};
const joinRequests = createJoinRequestController({ socket, checkIfInParty, getActivePartyId });
const { showPartyJoinRequestScreen, hidePartyJoinRequestScreen, loadPendingJoinRequests } = joinRequests;
export { showPartyJoinRequestScreen, hidePartyJoinRequestScreen };
const matchmaking = createMatchmakingClient({
  socket,
  view: createMatchmakingOverlay(),
  selection: {
    normalize: normalizeGameSelection,
    totalPlayers: getTotalPlayersForSelection,
    current: getCurrentSelection,
  },
  party: {
    activeId: getActivePartyId,
    players: collectCurrentPartyMembers,
    currentTeam: () => getCurrentPartyMember()?.team || null,
    setBotSlots: (botSlots) => { __partyContext.botSlots = botSlots; },
  },
  memberKey: getLobbyMemberKey,
  selfKey: () => getLobbyMemberKey(getCurrentLobbyUserName()),
  onReadyReset: resetSelfReadyState,
  warmBattle: warmBattleSelection,
  notify: sonner,
  maintenanceMessage: MAINTENANCE_MESSAGE,
  audio: () => window.__BB_NAVIGATION__?.lobbyAudio,
  isAdmin: () => !!window.__BRO_BATTLES_USERDATA__?.isAdmin,
  navigate: (url) => { window.location.href = url; },
  rememberMatch: (matchId) => sessionStorage.setItem("matchId", matchId),
  dispatchStart: () => window.dispatchEvent(new CustomEvent("bb:matchmaking-start")),
  suppressed: consumeBattleLobbyReturnFlag(),
});

function getMemberLevel(member) {
  if (!member) return null;
  if (Number.isFinite(Number(member.level))) {
    return Math.max(1, Number(member.level));
  }
  const charClass = resolveCharacterKey(member.char_class);
  const levels = parseCharacterLevels(member.char_levels);
  return Math.max(1, Number(levels?.[charClass]) || 1);
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
    previewSubtitle.textContent = getModeProgressionBlockReason(normalized.modeId) || (label.includes("•")
      ? label.split("•")[1].trim()
      : getModeSubtitle(normalized.modeId));
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
        : "/assets/icons/map.webp";
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
  warmBattleSelection(normalizeGameSelection(selection));
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
        const image = document.createElement('img');
        image.src = getMapSelectPreviewAsset(value);
        image.alt = opt.textContent || 'Map';
        const name = document.createElement('div');
        name.className = 'map-select-name';
        name.textContent = opt.textContent || 'Map';
        card.append(image, name);
        card.addEventListener("click", () => {
          mapDropdown.value = value;
          mapDropdown.dispatchEvent(new Event("change", { bubbles: true }));
          if (typeof onSelect === "function") {
            onSelect(getCurrentSelection());
          }
          closePopup();
        });
        const editLink = createMapEditorLink({
          user: window.__BRO_BATTLES_USERDATA__, mapId: value,
          mapLabel: opt.textContent, teamSize: getPlayersPerTeamForSelection(getCurrentSelection()),
        });
        if (editLink) {
          const choice = document.createElement('div');
          choice.className = 'map-choice';
          const debugLabel = document.createElement('label');
          debugLabel.className = 'map-choice-edit';
          const debugCheck = document.createElement('input');
          debugCheck.type = 'checkbox';
          debugCheck.addEventListener('change', () => {
            const url = new URL(editLink.href, location.origin);
            if (debugCheck.checked) url.searchParams.set('debug', '1');
            else url.searchParams.delete('debug');
            editLink.href = url.pathname + url.search;
          });
          debugLabel.append(debugCheck, document.createTextNode('Debug hitboxes'));
          choice.append(card, editLink, debugLabel);
          grid.appendChild(choice);
        } else grid.appendChild(card);
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

    [...getAllGameModes()].sort((a, b) => (a.unlockTrophies || 0) - (b.unlockTrophies || 0)).forEach((mode) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `map-select-card mode-select-card pixel-menu-button${
        selection.modeId === mode.id ? " active" : ""
      }${mode.queueable ? "" : " is-disabled"}`;
      const artAsset =
        mode.artAsset || mode.fallbackArtAsset || "/assets/fightImage.webp";
      const unlockReason = getModeProgressionBlockReason(mode.id);
      card.classList.toggle("is-trophy-locked", !!unlockReason);
      card.disabled = !!unlockReason;
      card.innerHTML = `
        <div class="mode-select-art"><img src="${escapeHtml(artAsset)}" alt="${escapeHtml(mode.label)}" />${unlockReason ? '<span class="mode-select-lock" aria-hidden="true"><img src="/assets/icons/lock.webp" alt="" /></span>' : ""}</div>
        <div class="map-select-name">${escapeHtml(mode.label)}</div>
        <div class="mode-select-subtitle">${escapeHtml(mode.description || "")}</div>
        <div class="mode-select-meta">${unlockReason && mode.unlockTrophies ? `<span>Unlock at</span><span class="mode-select-trophy-cost"><img src="/assets/icons/trophy.webp" alt="Trophies" /><span>${mode.unlockTrophies.toLocaleString()}</span></span>` : ""}</div>
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
      // Maps are made for one team size; a size without maps is coming soon.
      const comingSoon = !getCompatibleMapsForSelection({ modeId, modeVariantId: variant.id }).length;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `map-select-card mode-select-card pixel-menu-button${
        selection.modeVariantId === variant.id ? " active" : ""
      }${comingSoon ? " is-disabled" : ""}`;
      card.disabled = comingSoon;
      card.innerHTML = `
        <img src="${escapeHtml(getModeArtAsset(modeId))}" alt="${escapeHtml(variant.label)}" />
        <div class="map-select-name">${escapeHtml(variant.label)}</div>
        <div class="mode-select-subtitle">${escapeHtml(comingSoon ? "Coming soon" : variant.subtitle || getModeSubtitle(modeId))}</div>
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

function applyPlatformImageForMap(mapValue) {
  const platformUrl = getLobbyPlatformAsset(mapValue || getCurrentMapValue());
  const imageEls = document.querySelectorAll(".platform-image");
  for (const imageEl of imageEls) {
    if (!imageEl) continue;
    imageEl.style.backgroundImage = `url("${platformUrl}")`;
  }
  refreshPlatformGrounding();
}

function applyLobbyCharacterOffsetForMap(mapValue, modeValue) {
  refreshPlatformGrounding();
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

function syncInviteBadges() {
  const inParty = !!checkIfInParty();
  document.querySelectorAll("#lobby-area .status.invite").forEach((badge) => {
    badge.style.display = inParty ? "" : "none";
    badge.style.cursor = inParty ? "pointer" : "default";
    if (inParty) badge.dataset.inviteLink = window.location.href;
    else delete badge.dataset.inviteLink;
  });
}

// Switching lobby routes changes state, not the screen or its connection.
export function resetLobbyRoute(partyId) {
  partyDeparturePending = false;
  __partyReadyPending = false;
  __partyReadyTarget = null;
  ++__partyReadyRequestId;
  __activeBattleMatchId = null;
  __partyRosterNames = null;
  __partyRosterPartyId = partyId || null;
  ++__partyRosterRenderSequence;
  window.clearTimeout(__partyRosterCommitTimer);
  __partyRosterCommitTimer = null;
  __partyContext = { partyId: partyId || null, ownerName: null,
    allowMemberSelection: true, isPublic: false, publicName: '',
    capacity: null, members: [], botSlots: [] };
  hidePartyJoinRequestScreen();
  document.querySelectorAll('.character-slot').forEach(clearLobbySpawnAnimation);
  syncInviteBadges();
  setReadyButtonState(false);
  syncReadyAvailability();
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
  const button = document.getElementById('create-party');
  if (button?.disabled) return;
  if (button) { button.disabled = true; setPartyButtonLabel(button, 'Creating…'); }
  const selection = normalizeGameSelection(getCurrentSelection());
  fetch("/create-party", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ selection }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create party");
      }
      return data;
    })
    .then((data) => {
      window.location.href = `/party/${data.partyId}`;
    })
    .catch((error) => {
      console.error("Error:", error);
      if (button) { button.disabled = false; setPartyButtonLabel(button, 'Create Party'); }
    });
}

let partyDeparturePending = false;
export async function leaveParty() {
  if (partyDeparturePending) return;
  partyDeparturePending = true;
  const leaveButton = document.getElementById("create-party");
  const previousLabel = leaveButton?.textContent;
  if (leaveButton) { leaveButton.disabled = true; setPartyButtonLabel(leaveButton, "Leaving…"); }

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
    window.location.href = `/`;
  } catch (error) {
    console.error("Error:", error);
    partyDeparturePending = false;
    if (leaveButton) { leaveButton.disabled = false; setPartyButtonLabel(leaveButton, previousLabel); }
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
  const ping = () => { if (socket.connected) socket.emit("lobby:heartbeat"); };
  ping();
  hbTimer = setInterval(ping, 4000);
}
export function stopHeartbeat() {
  clearInterval(hbTimer);
}

// ---------------------------
// Socket
// ---------------------------

export function socketInit(options = {}) {
  joinRequests.initialize(options?.profilePopup);
  wirePartyBotSlotControls({
    getActivePartyId,
    isPartyOwner: () => __partyContext.ownerName === getCurrentLobbyUserName(),
  });
  let byeSent = false;

  // Safety: if code runs before index.js triggered connection (e.g., alternate entry), ensure connect once.
  if (!socket.connected) ensureSocketConnected();

  if (!__battleReturnPageshowBound) {
    __battleReturnPageshowBound = true;
    window.addEventListener("pageshow", () => {
      byeSent = false;
      // Browser Back can restore this page without the results screen's OK flag.
      __activeBattleMatchId = null;
      syncReadyButtonFromSelfSlot();
      syncReadyAvailability();
      if (socket.connected) startHeartbeat(getActivePartyId());
      else ensureSocketConnected();
      if (!consumeBattleLobbyReturnFlag()) return;
      matchmaking.restoreAfterBattleReturn();
    });
  }

  if (matchmaking.isSuppressed()) matchmaking.restoreAfterBattleReturn();

  socket.on("presence:self", ({ matchId }) => {
    __activeBattleMatchId = Number(matchId) > 0 ? Number(matchId) : null;
    syncReadyButtonFromSelfSlot();
    syncReadyAvailability();
  });
  if (socket.connected) startHeartbeat(getActivePartyId());

  // Connection lifecycle
  socket.on("connect", () => {
    const currentPartyId = getActivePartyId();
    console.log("[socket] connected", {
      socketId: socket.id,
      currentPartyId: currentPartyId || null,
      href: window.location.href,
      host: window.location.host,
    });
    startHeartbeat(currentPartyId);
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
    __activeBattleMatchId = null;
    syncReadyAvailability();
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
    startHeartbeat(partyId);
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
      __partyContext.botSlots = [];
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
          !__partyRosterNames ||
          __partyRosterPartyId !== data?.partyId ||
          !(__partyRosterNames instanceof Set)
        ) {
          __partyRosterNames = new Set(newNames);
          __partyRosterPartyId = data?.partyId || null;
        } else {
          // Additions
          for (const name of newNames) {
            if (!__partyRosterNames.has(name) && getLobbyMemberKey(name) !== getLobbyMemberKey(currentUserName)) {
              sonner(`${name} joined your party`, null, "OK", null, {
                duration: 2000,
                sound: "playerJoin",
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

  socket.on("party:bot-slots", (data) => {
    if (String(data?.partyId) !== String(getActivePartyId())) return;
    __partyContext.botSlots = Array.isArray(data?.botSlots) ? data.botSlots : [];
    renderPartyMembers({ ...__partyContext, botSlots: __partyContext.botSlots });
  });

  joinRequests.registerEvents();

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
            .trim().toLowerCase() === "ready";
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
    if (String(data.partyId || '') !== String(checkIfInParty() || ''))
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
        botSlots: data.botSlots,
        selection,
        mode: getPlayersPerTeamForSelection(selection),
        map: selection.mapId,
      });
    }
  });

  // Map change updates
  socket.on("map-change", (data) => {
    const currentPartyId = getActivePartyId();
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

  socket.on("party:kicked", (data) => {
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

let partySlotDrag = null;
function ensurePartySlotDrag() {
  if (partySlotDrag) return partySlotDrag;
  partySlotDrag = createPartySlotDrag({
    canMove: () => !!getActivePartyId() && __partyContext.ownerName === getCurrentLobbyUserName() && !matchmaking.isQueued() && !__activeBattleMatchId && !__partyContext.members.some(m => String(m.status).toLowerCase() === 'ready'),
    move: (name, slot) => new Promise((resolve, reject) => {
      socket.timeout(5000).emit('party:slot:move', { partyId: getActivePartyId(), name, ...getBotSlotTarget(slot) }, (error, result) => {
        if (error || !result?.ok) reject(new Error(result?.error || 'Connection interrupted. Please try again.'));
        else resolve();
      });
    }),
    render: renderPartyMembers,
    onError: message => sonner('Could not move player', message, 'error'),
  });
  return partySlotDrag;
}

function commitPartyRosterLayout({
  members,
  currentUserName,
  layoutSlots,
  spawnMemberKeys,
}) {
  const previousSlots = getRenderedLobbyMemberSlots();
  const previousPositions = new Map([...previousSlots].map(([key, slot]) => [key, slot.getBoundingClientRect()]));
  const movedSlots = [];
  updatePlatformsForMode(layoutSlots);

  const team1Members = members.filter((member) => member.team === "team1");
  const team2Members = members.filter((member) => member.team === "team2");
  const currentUser = members.find(
    (member) => getLobbyMemberKey(member) === getLobbyMemberKey(currentUserName),
  );
  const currentUserTeam = currentUser ? currentUser.team : "team1";
  const yourTeamMembers = team1Members;
  const opponentTeamMembers = team2Members;
  const desiredSlots = new Map();

  yourTeamMembers.forEach((member, index) => {
    desiredSlots.set(`your-slot-${(member.slot_index ?? index) + 1}`, {
      member,
      isYourTeam: currentUserTeam === "team1",
    });
  });
  opponentTeamMembers.forEach((member, index) => {
    desiredSlots.set(`op-slot-${(member.slot_index ?? index) + 1}`, {
      member,
      isYourTeam: currentUserTeam === "team2",
    });
  });

  console.log("[party] team split", {
    yourTeam: currentUserTeam,
    team1: team1Members.map((member) => member.name),
    team2: team2Members.map((member) => member.name),
  });

  document.querySelectorAll(".character-slot").forEach((slot) => {
    const target = getBotSlotTarget(slot);
    slot.dataset.slotLabel = `Team ${target?.team === 'team1' ? 1 : 2}, slot ${(target?.index || 0) + 1}`;
    const desired = desiredSlots.get(slot.id);
    const previousKey = getLobbyMemberKey(slot.dataset.playerName);

    if (!desired) {
      if (previousKey || !slot.classList.contains("empty") || !slot.querySelector(".character-sprite")?.getAttribute("src")) {
        resetSlotToRandom(slot);
      }
      return;
    }

    const desiredKey = getLobbyMemberKey(desired.member);
    // Screen coordinates include platform float, drag and active move animations.
    // Only a change of seat should start a roster movement animation.
    const changedSeat = previousSlots.has(desiredKey) && previousSlots.get(desiredKey) !== slot;
    const shouldSpawn =
      spawnMemberKeys.has(desiredKey);

    if (slot.classList.contains("lobby-spawn-exit")) {
      clearLobbySpawnAnimation(slot);
    }
    if (previousKey && previousKey !== desiredKey) {
      resetSlotToRandom(slot);
    }

    applyMemberToSlot(desired.member, slot.id, desired.isYourTeam);
    const localOrigin = partySlotDrag?.takeOrigin(desiredKey);
    if (shouldSpawn) playLobbySpawnAnimation(slot, "enter");
    else if ((changedSeat || localOrigin) && !prefersReducedLobbyMotion()) {
      movedSlots.push({ slot, before: localOrigin || previousPositions.get(desiredKey), localOrigin });
    }
  });

  for (const bot of __partyContext.botSlots || []) {
    const isYourTeam = bot.team === currentUserTeam;
    const slotId = `${bot.team === "team1" ? "your" : "op"}-slot-${Number(bot.index) + 1}`;
    const slot = document.getElementById(slotId);
    if (slot && !slot.dataset.playerName) applyBotToSlot(bot, slot, isYourTeam);
  }
  syncInviteBadges();
  // Measure destinations after all occupants and badges have been updated.
  for (const { slot, before, localOrigin } of movedSlots) {
    __partyMoveAnimations.get(slot)?.cancel();
    const after = slot.getBoundingClientRect();
    if (before && (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1)) {
      if (!localOrigin) playPartyMoveEffect(before, after);
      __partyMoveAnimations.set(slot, slot.animate([
        { translate: `${before.x - after.x}px ${before.y - after.y}px` },
        { translate: '0px 0px' },
      ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    }
  }
}

export function renderPartyMembers(data) {
  if (ensurePartySlotDrag().defer(data)) return;
  const members = Array.isArray(data.members) ? data.members : [];
  warmBattleSelection(normalizeGameSelection(data?.selection || getCurrentSelection()), members);
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
    botSlots: Array.isArray(data?.botSlots)
      ? data.botSlots
      : __partyContext.botSlots || [],
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
    ensurePartySlotDrag().sync();
    void revealLobby();
  };

  if (!data.immediate && exitingSlots.length && !prefersReducedLobbyMotion()) {
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

export function ensurePartyPixelFrame(slot) {
  if (slot.querySelector(':scope > .party-pixel-frame')) return;
  const frame = document.createElement('span');
  frame.className = 'party-pixel-frame';
  frame.setAttribute('aria-hidden', 'true');
  slot.append(frame);
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

  ensurePartyPixelFrame(slot);

  // Fill with member info
  const previousPlayerKey = getLobbyMemberKey(slot.dataset.playerName);
  const previousCharacter = String(slot.dataset.character || "").trim();
  const currentUserName = getCurrentLobbyUserName();
  const isCurrentUser = member.name === currentUserName;
  const displayName = member.name;
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
    const cls = member.char_class || DEFAULT_CHARACTER;
    const skinAsset =
      String(member.selected_skin_asset_url || "").trim() ||
      buildCharacterSkinBodyUrl(cls, member.selected_skin_id ?? member.selected_skin_id_by_char?.[resolveCharacterKey(cls)]);
    if (spriteEl.getAttribute("src") !== skinAsset) spriteEl.src = skinAsset;
    spriteEl.alt = cls;
    spriteEl.classList.remove("random", "bot-shuffle-icon");
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
  slot.dataset.character = member.char_class || DEFAULT_CHARACTER;
  setSlotLevelBadge(slot, getMemberLevel(member));

  // Set interaction properties
  slot.style.pointerEvents = "auto";
  // Only current user’s slot should look clickable
  slot.style.cursor = isCurrentUser ? "pointer" : "default";
}

function applyBotToSlot(bot, slot, isYourTeam) {
  ensurePartyPixelFrame(slot);
  const character = String(bot?.character || "shuffle").toLowerCase();
  const isShuffle = character === "shuffle";
  const usernameEl = slot.querySelector(".username");
  const spriteEl = slot.querySelector(".character-sprite");
  const statusEl = slot.querySelector(".status");
  if (!usernameEl || !spriteEl || !statusEl) return;

  usernameEl.textContent = isShuffle
    ? "Bot"
    : `Bot · ${character[0].toUpperCase()}${character.slice(1)}`;
  usernameEl.className = `username${isYourTeam ? "" : " op-player"}`;
  spriteEl.src = isShuffle
    ? "/assets/shuffle/shuffle1.svg"
    : buildCharacterSkinBodyUrl(character, "");
  spriteEl.alt = isShuffle ? "Shuffle bot" : `${character} bot`;
  spriteEl.classList.remove("random");
  spriteEl.classList.toggle("bot-shuffle-icon", isShuffle);
  statusEl.textContent =
    __partyContext.ownerName === getCurrentLobbyUserName() ? "Change Bot" : "Bot";
  statusEl.className = "status bot-status";
  statusEl.style.display = "";
  statusEl.style.pointerEvents = "none";
  slot.classList.remove("empty", "player-display", "op-display");
  slot.classList.add("bot-display", isYourTeam ? "player-display" : "op-display");
  slot.dataset.botCharacter = character;
  slot.dataset.character = isShuffle ? "Random" : character;
  slot.dataset.playerName = "";
  slot.dataset.isCurrentUser = "false";
  slot.style.cursor =
    __partyContext.ownerName === getCurrentLobbyUserName() ? "pointer" : "default";
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
    const normalized = writeSelectionToDom(selection, { persist: !checkIfInParty() });
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

  // These controls survive lobby navigation, so resolve the party at click time.
  const handleModeSelection = async (selection) => {
    if (!canChangePartySelection()) return;
    const partyId = checkIfInParty();
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
        if (checkIfInParty() !== partyId || !canChangePartySelection()) return;
        const requiredSlots = getPlayersPerTeamForSelection(nextSelection) * 2;
        if (
          nextSelection.modeId === "duels" &&
          requiredSlots < Number(data.membersCount || 0)
        ) {
          sonner(
            "Too many players for this duel size",
            "Remove players or choose a larger duel size.",
            "error",
          );
          applySelectionVisuals(previousSelection);
          return;
        }

        // Resize only when the server supplies the roster for the new mode.
        socket.emit("mode-change", {
          selection: nextSelection,
          username,
          partyId,
        });
      } catch (error) {
        console.error("Error changing mode:", error);
        sonner(
          "Could not change game mode",
          "Please try again. If the problem persists, try refreshing the page.",
          "error",
        );
        if (checkIfInParty() === partyId) applySelectionVisuals(previousSelection);
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
      const partyId = checkIfInParty();
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

  // Preserve the live hover animation and transient lobby state when roster
  // packets repeat the current mode. Replacing className restarts every
  // platform's animation on the same frame, making them drop in lockstep.
  const targetModeClass = `mode-${targetCount}`;
  for (const className of [...lobbyArea.classList]) {
    if (/^mode-\d+$/.test(className) && className !== targetModeClass) {
      lobbyArea.classList.remove(className);
    }
  }
  lobbyArea.classList.add(targetModeClass);

  // Get existing platforms
  const yourPlatforms = lobbyArea.querySelectorAll(
    '.platform[data-team="your-team"]',
  );
  const opPlatforms = lobbyArea.querySelectorAll(
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
  sprite.src = "/assets/icons/random.webp";
  sprite.alt = "Random";

  // Create status element with invite functionality
  const status = document.createElement("div");
  status.className = "status invite";
  status.dataset.sound = "cursor4";
  status.dataset.volume = "0.3";
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
  refreshPlatformGrounding();
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
  __partyMoveAnimations.get(slot)?.cancel();
  __partyMoveAnimations.delete(slot);
  // Don't destroy stable IDs; just reset content
  const originalId = slot.id;
  console.log("[party] resetSlotToRandom", { id: originalId });
  const username = slot.querySelector(".username");
  const sprite = slot.querySelector(".character-sprite");
  const statusEl = slot.querySelector(".status");

  if (!username || !sprite || !statusEl) return;

  clearLobbySpawnAnimation(slot);

  username.textContent = "Random";
  sprite.src = "/assets/icons/random.webp";
  sprite.alt = "Random";
  sprite.classList.add("random");
  sprite.classList.remove("bot-shuffle-icon");
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
    "bot-display",
  );
  slot.classList.add("empty");
  slot.dataset.character = "Random";
  slot.dataset.isCurrentUser = "false";
  slot.dataset.playerName = "";
  slot.dataset.playerTeam = "";
  slot.dataset.isOwner = "false";
  delete slot.dataset.botCharacter;
  setSlotLevelBadge(slot, null);
  // Hide switch-character if present
  const switchEl = slot.querySelector(".switch-character");
  if (switchEl) switchEl.style.display = "none";
  // Preserve slot.id so future updates can target this slot reliably

  // Re-add invite functionality
  const newStatusEl = statusEl.cloneNode(true);
  newStatusEl.dataset.sound = "cursor4";
  newStatusEl.dataset.volume = "0.3";
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

  readyBtn.addEventListener("click", async () => {
    if (getActivePartyId() && __activeBattleMatchId) {
      sessionStorage.setItem("matchId", String(__activeBattleMatchId));
      window.location.href = `/game/${__activeBattleMatchId}`;
      return;
    }
    matchmaking.resumeQueueing();
    // Find current user's status element to update optimistically
    const selfSlot = getSelfSlot();
    const statusEl = selfSlot?.querySelector(".status");
    if (!statusEl) return;

    const cur = (statusEl.textContent || "").toLowerCase();
    const nextReady = cur.trim() !== "ready";
    const partyId = getActivePartyId();
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
      if (__partyReadyPending) return;
      if (!socket.connected) {
        sonner("Could not ready up", "Reconnecting to the server. Please try again shortly.", "error");
        return;
      }
      __partyReadyPending = true;
      __partyReadyTarget = nextReady;
      const requestId = ++__partyReadyRequestId;
      setSelfReadyState(nextReady);
      socket.timeout(8000).emit("ready:status", { partyId, ready: nextReady }, async (error, reply) => {
        if (requestId !== __partyReadyRequestId || String(partyId) !== String(getActivePartyId())) return;
        __partyReadyPending = false;
        __partyReadyTarget = null;
        syncReadyAvailability();
        if (error || !reply?.ok) {
          setSelfReadyState(!nextReady);
          sonner(reply?.code === "MAINTENANCE" ? null : "Could not change ready status", reply?.code === "MAINTENANCE" ? MAINTENANCE_MESSAGE : reply?.error || "Your ready status could not be saved. Please try again.", "error", { maintenanceUntil: reply?.code === "MAINTENANCE" ? reply.maintenanceUntil : null });
        }
        if (!error && reply?.ok) return;
        // Refresh after a failed acknowledgement or timeout; never leave an unconfirmed
        // optimistic ready state on screen.
        try {
          const response = await fetch("/party-members", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partyId }),
          });
          const roster = await response.json();
          if (response.ok && requestId === __partyReadyRequestId && String(partyId) === String(getActivePartyId())) {
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
    if (nextReady) matchmaking.startSolo(getCurrentSelection());
    else matchmaking.leaveSolo();
  });
}

function syncReadyAvailability(selection = getCurrentSelection()) {
  const btn = document.getElementById("ready");
  if (!btn) return { blocked: false, reason: "" };

  const normalized = normalizeGameSelection(selection);
  const partyBattleInProgress = Boolean(getActivePartyId() && __activeBattleMatchId);
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

  btn.disabled = __partyReadyPending || (blocked && !isCancelState);
  btn.title = blocked ? reason : "";
  btn.classList.toggle("is-disabled", blocked && !isCancelState);

  if (!isCancelState) {
    btn.value = blocked ? "Unavailable" : "Ready";
  }

  return { blocked, reason, selection: normalized };
}

function getCurrentPartyMember() {
  const selfKey = getLobbyMemberKey(getCurrentLobbyUserName());
  return (__partyContext.members || []).find((member) => getLobbyMemberKey(member) === selfKey);
}

function getSelfSlot() {
  return Array.from(document.querySelectorAll(".character-slot")).find(
    (slot) => slot.dataset.isCurrentUser === "true",
  );
}

// Return the local slot and Ready button to "online" after a queue ends.
function resetSelfReadyState() {
  try {
    setSelfReadyState(false);
  } catch (_) {}
}

function setSelfReadyState(ready) {
  const slot = getSelfSlot();
  const statusEl = slot?.querySelector(".status");
  const status = ready ? "ready" : "online";
  if (statusEl) {
    const previous = statusEl.textContent;
    statusEl.textContent = status;
    statusEl.className = `status ${status}`;
    applyLobbyStatusVisualState(slot, previous, status);
  }
  setReadyButtonState(ready);
}

function collectCurrentPartyMembers() {
  const contextMembers = Array.isArray(__partyContext.members)
    ? __partyContext.members
    : [];
  const players = contextMembers.map((member) => ({
    name: member?.name || "Player",
    char_class: member?.char_class || DEFAULT_CHARACTER,
    selected_skin_id: member?.selected_skin_id ?? member?.selected_skin_id_by_char?.[resolveCharacterKey(member?.char_class)] ?? null,
    selected_skin_asset_url: member?.selected_skin_asset_url || "",
    team: member?.team || null,
  }));

  // Solo mode may not have party context, so retain the DOM fallback there.
  if (!players.length) {
    const slots = document.querySelectorAll(".character-slot");
    for (const slot of slots) {
      if (slot.dataset.botCharacter) continue;
      const uname = slot.querySelector(".username")?.textContent || "";
      if (uname.trim().toLowerCase().startsWith("random")) continue;
      const name = uname.replace(" (You)", "");
      const cls =
        slot.dataset.character && slot.dataset.character !== "Random"
          ? slot.dataset.character
          : DEFAULT_CHARACTER;
      players.push({
        name, char_class: cls,
        selected_skin_asset_url: slot.querySelector(".character-sprite")?.getAttribute("src") || "",
      });
    }
  }

  const botPreviews = (__partyContext.botSlots || []).map((slot) => {
    const character = String(slot?.character || "shuffle").toLowerCase();
    const isShuffle = character === "shuffle";
    return {
      name: isShuffle
        ? "Bot"
        : `Bot · ${character[0].toUpperCase()}${character.slice(1)}`,
      char_class: character,
      selected_skin_asset_url: isShuffle
        ? "/assets/shuffle/shuffle1.svg"
        : buildCharacterSkinBodyUrl(character, ""),
      team: slot?.team || null,
      isConfiguredBot: true,
      botSlotKey: `bot:${slot?.team || "team"}:${Number(slot?.index) || 0}`,
    };
  });

  const yourTeam = getCurrentPartyMember()?.team || null;
  return [...players, ...botPreviews].sort((a, b) => {
    if (!yourTeam) return 0;
    return Number(b?.team === yourTeam) - Number(a?.team === yourTeam);
  });
}

// ---------------------------
// Ready button helpers
// ---------------------------
function setReadyButtonState(isCancel) {
  // Inert also blocks keyboard activation and dynamically rendered controls.
  // Chat and friends live outside these lobby groups.
  document.body.classList.toggle("lobby-ready", isCancel);
  if (isCancel) {
    document.querySelectorAll("#navbar, .lobby-party-actions, .lobby-quick-actions, #bottom-bar .dropdown-group, #lobby-area").forEach((root) => {
      if (!__readyLockedRoots.has(root)) __readyLockedRoots.set(root, root.inert);
      root.inert = true;
    });
  } else {
    for (const [root, wasInert] of __readyLockedRoots) root.inert = wasInert;
    __readyLockedRoots.clear();
  }
  window.__BB_NAVIGATION__?.lobbyAudio?.setReady(isCancel);
  const btn = document.getElementById("ready");
  if (!btn) return;
  // Input[type=submit] uses value for its label
  btn.value = isCancel ? "Cancel" : "Ready";
  if (isCancel) btn.classList.add("cancel");
  else btn.classList.remove("cancel");
  syncReadyAvailability();
}

function syncReadyButtonFromSelfSlot() {
  if (__partyReadyPending && __partyReadyTarget !== null) {
    setSelfReadyState(__partyReadyTarget);
    return;
  }
  const selfSlot = getSelfSlot();
  const statusEl = selfSlot?.querySelector(".status");
  if (!statusEl) return;
  const isReady = (statusEl.textContent || "").trim().toLowerCase() === "ready";
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

