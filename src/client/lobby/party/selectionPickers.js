import { getUser } from "../session.mjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { postJson } from "../../lib/http.js";
import { checkIfInParty, getActivePartyId, getCurrentLobbyUserName, partyContext } from "./partyState.js";
import { escapeHtml } from "../../../shared/site/html.cjs";
import { warmBattleSelection } from '../preloadBattle';
import { refreshPlatformGrounding } from "./platformGrounding.mjs";
import { setLobbyBackground } from "../lobbyBackground.js";
import { playButtonSpawnFxOnChange } from "./buttonSpawnFx.js";
import { createMapEditorLink } from '../../lib/mapEditorLink';
import { sonner } from "../../ui/sonner.js";
import socket from "../../lib/socket";
import { getSharedSelectionPopupShell } from "../../ui/selectionPopupShell.js";
import { getMapSelectPreviewAsset, getMapFullPreviewAsset } from "../../game/maps/manifest";
import { openMapPreviewLightbox } from "./mapPreviewLightbox.js";
import { openModeInfoDialog } from "./modeInfoDialog.js";
import {
  SOLO_MAP_STORAGE_KEY,
  SOLO_MODE_ID_STORAGE_KEY,
  SOLO_MODE_STORAGE_KEY,
  SOLO_MODE_VARIANT_STORAGE_KEY,
  getSavedSelectionFromUserData,
  getSoloSelection,
  persistSoloSelection,
  rememberSoloSelection,
} from "./soloSelection.js";
import { getAllGameModes, getCompatibleMapsForSelection, getMapLabel, getModeArtAsset, getModeFallbackArtAsset, getModeById, getModeLabel, getModeSelectionStyle, getModeSubtitle, getModeProgressionBlockReason, getPlayersPerTeamForSelection, getSelectionDisplayLabel, isSelectionQueueable, legacyModeToVariantId, normalizeGameSelection, DEFAULT_VARIANT_ID, selectionToLegacyMode } from "../../lib/gameSelectionCatalog.js";
import { applyPlatformImageForMap, animatePlatformsForMapSwitch, bindLobbyOffsetResizeHandler, getCurrentMapValue, updatePlatformsForMode } from "./partyPlatforms.js";

export function getCurrentSelection() {
  return normalizeGameSelection({
    modeId: document.getElementById("mode-id")?.value,
    modeVariantId:
      document.getElementById("mode-variant-id")?.value,
    mapId: document.getElementById("map")?.value || null,
  });
}

export function createSelectionPickers({ syncReadyAvailability }) {
  let mapPopupUi = null;

  let modePopupUi = null;

  function canChangePartySelection() {
    if (!checkIfInParty()) return true;
    return (
      partyContext.allowMemberSelection !== false ||
      partyContext.ownerName === getCurrentLobbyUserName()
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
      const unlockReason = getActivePartyId() ? "" : getModeProgressionBlockReason(normalized.modeId);
      previewSubtitle.textContent = unlockReason || (label.includes("•")
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
      playButtonSpawnFxOnChange(
        openBtn,
        `${normalized.modeId}:${normalized.modeVariantId || ""}`,
      );
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
      playButtonSpawnFxOnChange(openBtn, compatibleMaps.length > 0 ? normalized : "");
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
    const applied = {
      ...normalized,
      mapId: mapDropdown?.value ? Number(mapDropdown.value) : null,
    };
    if (persist) rememberSoloSelection(applied);
    return applied;
  }

  function setupMapPickerControls(onSelect = null) {
    const mapDropdown = document.getElementById("map");
    const openBtn = document.getElementById("map-picker-open");
    if (!mapDropdown || !openBtn) return;

    const ensureMapPopup = () => {
      if (mapPopupUi) return mapPopupUi;

      const popupShell = getSharedSelectionPopupShell();
      const closePopup = () => {
        popupShell.hide();
      };

      const content = document.createElement("div");
      content.className = "selection-popup-scroll map-selection-popup-scroll";

      const grid = document.createElement("div");
      grid.className = "map-select-grid";

      mapPopupUi = {
        popupShell,
        content,
        grid,
        closePopup,
      };

      return mapPopupUi;
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
          card.setAttribute('aria-pressed', String(String(mapDropdown.value) === value));
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
            user: getUser(), mapId: value,
            mapLabel: opt.textContent, teamSize: getPlayersPerTeamForSelection(getCurrentSelection()),
          });
          const expand = document.createElement('button');
          expand.type = 'button';
          expand.className = 'map-select-expand mode-info-button';
          expand.setAttribute('aria-label', `Expand ${opt.textContent || 'map'} preview`);
          expand.title = 'View full map';
          expand.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="#ffffff" d="M0 0h1v1h-1zM0 1h1v1h-1zM0 2h1v1h-1zM0 3h1v1h-1zM0 7h1v1h-1zM0 8h1v1h-1zM0 9h1v1h-1zM0 10h1v1h-1zM1 0h1v1h-1zM1 10h1v1h-1zM2 0h1v1h-1zM2 10h1v1h-1zM3 0h1v1h-1zM3 10h1v1h-1zM7 0h1v1h-1zM7 10h1v1h-1zM8 0h1v1h-1zM8 10h1v1h-1zM9 0h1v1h-1zM9 10h1v1h-1zM10 0h1v1h-1zM10 1h1v1h-1zM10 2h1v1h-1zM10 3h1v1h-1zM10 7h1v1h-1zM10 8h1v1h-1zM10 9h1v1h-1zM10 10h1v1h-1z"/><path fill="#cfe8ff" d="M1 1h1v1h-1zM1 9h1v1h-1zM2 2h1v1h-1zM2 8h1v1h-1zM3 3h1v1h-1zM3 7h1v1h-1zM7 3h1v1h-1zM7 7h1v1h-1zM8 2h1v1h-1zM8 8h1v1h-1zM9 1h1v1h-1zM9 9h1v1h-1z"/><path fill="#0b1a33" d="M1 2h1v1h-1zM1 3h1v1h-1zM1 4h1v1h-1zM1 8h1v1h-1zM1 11h1v1h-1zM2 1h1v1h-1zM2 11h1v1h-1zM3 1h1v1h-1zM3 9h1v1h-1zM3 11h1v1h-1zM4 1h1v1h-1zM4 4h1v1h-1zM4 8h1v1h-1zM4 11h1v1h-1zM8 1h1v1h-1zM8 4h1v1h-1zM8 11h1v1h-1zM9 3h1v1h-1zM9 11h1v1h-1zM10 11h1v1h-1zM11 1h1v1h-1zM11 2h1v1h-1zM11 3h1v1h-1zM11 4h1v1h-1zM11 8h1v1h-1zM11 9h1v1h-1zM11 10h1v1h-1zM11 11h1v1h-1z"/></svg>';
          expand.addEventListener('click', (event) => {
            event.stopPropagation();
            openMapPreviewLightbox({ src: getMapFullPreviewAsset(value), title: opt.textContent || 'Map' });
          });
          const choice = document.createElement('div');
          choice.className = 'map-choice';
          choice.append(card, expand);
          if (editLink) choice.append(editLink);
          grid.appendChild(choice);
        });
      }

      // Keep active card in sync with latest dropdown value each open.
      const selected = String(mapDropdown.value || "1");
      for (const card of grid.querySelectorAll(".map-select-card")) {
        const isActive = String(card.dataset.mapValue || "") === selected;
        card.classList.toggle("active", isActive);
        card.setAttribute('aria-pressed', String(isActive));
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

  function collapseModeCards(grid, except = null) {
    grid.querySelectorAll(".mode-select-card.is-expanded").forEach((card) => {
      if (card === except) return;
      card.classList.remove("is-expanded");
      card.setAttribute("aria-expanded", "false");
    });
    grid.classList.toggle("has-expanded", !!grid.querySelector(".mode-select-card.is-expanded"));
  }

  let modeCardOutsidePressBound = false;

  function bindModeCardOutsidePress() {
    if (modeCardOutsidePressBound) return;
    modeCardOutsidePressBound = true;
    document.addEventListener("pointerdown", (event) => {
      const grid = document.querySelector(".mode-select-grid.has-expanded");
      if (!grid) return;
      const openCard = grid.querySelector(".mode-select-card.is-expanded");
      if (openCard && !openCard.contains(event.target)) collapseModeCards(grid);
    }, true);
  }

  function setupModePickerControls(onSelect = null) {
    const openBtn = document.getElementById("mode-picker-open");
    if (!openBtn) return;

    const ensureModePopup = () => {
      if (modePopupUi) return modePopupUi;
      const popupShell = getSharedSelectionPopupShell();
      const closePopup = () => popupShell.hide();
      const content = document.createElement("div");
      content.className = "selection-popup-scroll";
      modePopupUi = { popupShell, closePopup, content };
      return modePopupUi;
    };

    const openModeGrid = () => {
      if (!canChangePartySelection()) return;
      const popupUi = ensureModePopup();
      const { popupShell, closePopup, content } = popupUi;
      const grid = document.createElement("div");
      grid.className = "mode-select-grid";
      const selection = getCurrentSelection();

      const selectSelection = (next) => {
        const nextSelection = writeSelectionToDom(
          { ...selection, ...next },
          { persist: !checkIfInParty() },
        );
        if (typeof onSelect === "function") onSelect(nextSelection);
        closePopup();
      };

      [...getAllGameModes()].sort((a, b) => (a.unlockTrophies || 0) - (b.unlockTrophies || 0)).forEach((mode) => {
        // Modes with team sizes reveal their variant options inside the card
        // instead of opening a second screen, so the card can't be a <button>.
        const hasVariants = getModeSelectionStyle(mode.id) === "subcards";
        const card = document.createElement(hasVariants ? "div" : "button");
        if (hasVariants) {
          card.setAttribute("role", "button");
          card.setAttribute("aria-expanded", "false");
          card.tabIndex = 0;
        } else {
          card.type = "button";
        }
        card.className = `map-select-card mode-select-card pixel-menu-button${
          selection.modeId === mode.id ? " active" : ""
        }${mode.queueable ? "" : " is-disabled"}${hasVariants ? " has-variants" : ""}`;
        const artAsset =
          mode.artAsset || mode.fallbackArtAsset || "/assets/fightImage.webp";
        const unlockReason = getModeProgressionBlockReason(mode.id);
        const teamSizes = (Array.isArray(mode.variants) ? mode.variants : [])
          .map((variant) => variant.label).filter(Boolean).join(" \u00b7 ");
        card.classList.toggle("is-trophy-locked", !!unlockReason);
        if (hasVariants) card.setAttribute("aria-disabled", String(!!unlockReason));
        else card.disabled = !!unlockReason;
        card.innerHTML = `
          <div class="mode-select-art"><img src="${escapeHtml(artAsset)}" alt="${escapeHtml(mode.label)}" />${unlockReason ? '<span class="mode-select-lock" aria-hidden="true"><img src="/assets/icons/lock.webp" alt="" /></span>' : ""}</div>
          <div class="map-select-name">${escapeHtml(mode.label)}</div>
          ${teamSizes ? `<div class="mode-select-teams">${escapeHtml(teamSizes)}</div>` : ""}
          <div class="mode-select-meta">${unlockReason && mode.unlockTrophies ? `<span>Unlock at</span><span class="mode-select-trophy-cost"><img src="/assets/icons/trophy.webp" alt="Trophies" /><span>${mode.unlockTrophies.toLocaleString()}</span></span>` : ""}</div>
        `;
        card.querySelector("img")?.addEventListener("error", (event) => {
          event.currentTarget.src =
            mode.fallbackArtAsset || "/assets/fightImage.webp";
        });

        // Cards can be <button>s, so the info trigger is a span with button role.
        const infoBtn = document.createElement("span");
        infoBtn.className = "mode-info-button";
        infoBtn.setAttribute("role", "button");
        infoBtn.setAttribute("aria-label", `About ${mode.label}`);
        infoBtn.tabIndex = 0;
        infoBtn.innerHTML = '<svg viewBox="0 0 6 10" fill="currentColor" aria-hidden="true"><path d="M2 0h2v2H2zM1 3h3v5h1v2H1V8h1V5H1z"/></svg>';
        const openInfo = (event) => {
          event.preventDefault();
          event.stopPropagation();
          openModeInfoDialog(mode);
        };
        infoBtn.addEventListener("click", openInfo);
        infoBtn.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") openInfo(event);
        });
        card.appendChild(infoBtn);

        if (hasVariants) {
          // The wrapper collapses to zero height, so the card only grows when opened.
          const optionsWrap = document.createElement("div");
          optionsWrap.className = "mode-variant-reveal";
          const options = document.createElement("div");
          options.className = "mode-variant-options";
          optionsWrap.appendChild(options);
          const variants = Array.isArray(mode?.variants) ? mode.variants : [];
          variants.forEach((variant) => {
            // Maps are made for one team size; a size without maps is coming soon.
            const comingSoon = !getCompatibleMapsForSelection({ modeId: mode.id, modeVariantId: variant.id }).length;
            const option = document.createElement("button");
            option.type = "button";
            option.className = `mode-variant-option pixel-menu-button${
              selection.modeId === mode.id && selection.modeVariantId === variant.id ? " active" : ""
            }`;
            option.disabled = comingSoon;
            option.title = comingSoon ? "Coming soon" : variant.subtitle || "";
            option.textContent = variant.label;
            option.addEventListener("click", (event) => {
              event.stopPropagation();
              selectSelection({ modeId: mode.id, modeVariantId: variant.id, mapId: selection.mapId });
            });
            options.appendChild(option);
          });
          card.appendChild(optionsWrap);

          const toggle = () => {
            if (unlockReason) return;
            const expanded = card.classList.toggle("is-expanded");
            card.setAttribute("aria-expanded", String(expanded));
            grid.classList.toggle("has-expanded", expanded);
          };
          card.addEventListener("click", toggle);
          card.addEventListener("keydown", (event) => {
            if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            toggle();
          });
        } else {
          card.addEventListener("click", () => {
            selectSelection({ modeId: mode.id, modeVariantId: null, mapId: null });
          });
        }
        grid.appendChild(card);
      });

      content.replaceChildren(grid);
      bindModeCardOutsidePress();
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

    if (openBtn.dataset.bound !== "1") {
      openBtn.dataset.bound = "1";
      openBtn.addEventListener("click", openModeGrid);
    }
    syncModePickerUi();
  }

  function initializeModeDropdown() {
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
        updatePlatformsForMode(String(teamSize));
      if (normalized.mapId != null) {
        if (updateBackground) setLobbyBackground(String(normalized.mapId));
        applyPlatformImageForMap(String(normalized.mapId));
        refreshPlatformGrounding();
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
          DEFAULT_VARIANT_ID,
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
          const data = await postJson(API_PATHS.PARTY_MEMBERS, { partyId }, {
            fallbackMessage: "Failed to fetch party members",
          });
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
          socket.emit(SOCKET_EVENTS.MODE_CHANGE, {
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
          socket.emit(SOCKET_EVENTS.MAP_CHANGE, {
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

  function syncSelectionPickers() {
    syncModePickerUi();
    syncMapPickerUi(getCurrentMapValue());
    if (!canChangePartySelection()) {
      mapPopupUi?.closePopup();
      modePopupUi?.closePopup();
    }
  }

  return { writeSelectionToDom, initializeModeDropdown, syncSelectionPickers };
}
