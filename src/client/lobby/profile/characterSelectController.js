import { getUser, setUser, updateUser } from "../session.mjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { postJson } from "../../lib/http.js";
import { getSelfSlot, slotField } from "../party/slotDom.js";
import { getRoutePartyId } from "../party/partyState.js";
import { ensureLobbySelectingRing, triggerLobbyCharacterSplash } from "../party/slotEffects.js";
import { subscribeWallet } from "../wallet.mjs";
import { renderWalletBalances } from "../walletView.js";
import { renderCharacterStatus } from "./characterStatusView.js";
import {
  getCharacterStats,
  getCharacterDisplayName,
  getAllCharacters,
  getHealth,
  getDamage,
  getSuperChargeHits,
  getSpecialDamage,
  LEVEL_CAP,
  upgradePrice,
} from "../../../shared/characters/characterStats.js";
import { getSharedSelectionPopupShell } from "../../ui/selectionPopupShell.js";
import { warmPopupImages } from "../../ui/popupImages.js";
import socket from "../../lib/socket.js";
import { warmBattleSelection } from '../preloadBattle';
import { playSound } from "../../ui/uiSounds.js";
import { buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { sonner } from "../../ui/sonner.js";
import { buildFramedBodyPortrait } from "../../views/bodyPortraitAssets.js";
import { createLevelBadge, setSlotLevelBadge } from "../../views/levelBadgeView.js";
import { createCharacterSkins, normalizeCharacterId } from "./characterSkins.js";
import { createCharacterPurchases, showErrorDialog } from "./characterPurchases.js";
import { createCharacterDetailsPopup } from "./characterDetailsPopup.js";

const state = {
  get userData() { return getUser(); },
  detailsUi: null,
  selectionPromise: null,
  confirmedSkinSelections: Object.create(null),
  deferredSkinRender: null,
  upgradePreview: null,
  pendingUpgradeAnimation: null,
};
let picker;

const skins = createCharacterSkins(state, {
  selectCharacter,
  blockCharacterChangeWhileReady,
  updateSkinDetails: (character, direction) => details.updateSkinDetails(character, direction),
});
const { resetSkinOwnership, bootstrapSkinState, getSelectedSkin, resolveCharacterPreviewAsset } = skins;

const purchases = createCharacterPurchases(state, {
  getSelectedSkin,
  getCharacterCardState,
  rerenderCharacterCard,
  refreshUpgradeButtonAffordability,
  renderCharacterDetails: character => details.renderCharacterDetails(character),
  playCharacterDetailsSuccessAnimation: type => details.playCharacterDetailsSuccessAnimation(type),
});
const details = createCharacterDetailsPopup(state, {
  skins,
  getCharacterCardState,
  closeCharacterSelectAfterSelection,
  selectCharacter,
  purchases,
});
const { openCharacterDetails, hideCharacterDetails, renderCharacterDetails } = details;

let charactersGridEl = null;

function equippedCharacterPortrait(character, userData) {
  return buildFramedBodyPortrait(character, buildCharacterSkinBodyUrl(
    character, userData?.selected_skin_id_by_char?.[character],
  ));
}

function getCharacterCardState(character, userData) {
  const stats = getCharacterStats(character);
  const level =
    (userData?.char_levels && (userData.char_levels[character] ?? 0)) ?? 0;
  const isLocked = level === 0;
  const isMaxed = level >= LEVEL_CAP;
  const currentLevel = Math.max(1, level);
  const currentHealth = getHealth(character, currentLevel);
  const currentDamage = getDamage(character, currentLevel);
  const currentSuperChargeHits = getSuperChargeHits(character);
  const currentSpecial = getSpecialDamage(character, currentLevel);
  const maxHealth = getHealth(character, LEVEL_CAP);
  const maxDamage = getDamage(character, LEVEL_CAP);
  const maxSpecial = getSpecialDamage(character, LEVEL_CAP);
  const price = !isLocked && !isMaxed ? upgradePrice(level) : null;
  const coins = Number(userData?.coins || 0);
  const canUpgrade =
    !isLocked && !isMaxed && Number.isFinite(price) && coins >= price;
  const canUnlock = stats.unlockMethod?.type !== "trophyRoad" && isLocked && Number(userData?.gems || 0) >= Number(stats.unlockPrice || 0);

  return {
    stats,
    level,
    isLocked,
    isMaxed,
    currentLevel,
    currentHealth,
    currentDamage,
    currentSuperChargeHits,
    currentSpecial,
    maxHealth,
    maxDamage,
    maxSpecial,
    price,
    canUpgrade,
    canUnlock,
    skin: getSelectedSkin(character),
  };
}

function getSortedCharacters(userData) {
  const characters = getAllCharacters();
  return characters.slice().sort((a, b) => {
    const aState = getCharacterCardState(a, userData);
    const bState = getCharacterCardState(b, userData);

    // Show unlocked first, then locked.
    if (aState.isLocked !== bState.isLocked) {
      return aState.isLocked ? 1 : -1;
    }

    // Within each ownership group, preserve the catalog's unlock-price order.
    const aUnlock = Number(aState?.stats?.unlockPrice || 0);
    const bUnlock = Number(bState?.stats?.unlockPrice || 0);
    if (aUnlock !== bUnlock) return aUnlock - bUnlock;
    return String(a).localeCompare(String(b));
  });
}

function sortCharacterCardsInGrid(userData) {
  const grid = document.querySelector(".characters-grid");
  if (!grid) return;
  const existing = new Map();
  for (const child of Array.from(grid.children)) {
    const char = String(child?.dataset?.char || "").trim();
    if (char) existing.set(char, child);
  }
  for (const character of getSortedCharacters(userData)) {
    const card = existing.get(character) || createCharacterCard(character, userData);
    grid.appendChild(card);
  }
}

function isCurrentUserReady() {
  const selfSlot = getSelfSlot({ fallback: true });
  const status = String(slotField(selfSlot, "status")?.textContent || "")
    .trim()
    .toLowerCase();
  return status === "ready";
}

function blockCharacterChangeWhileReady() {
  if (!isCurrentUserReady()) return false;
  sonner(
    null,
    "Unready before changing your character or skin.",
    "OK",
    undefined,
    { tone: "error", duration: 3000 },
  );
  return true;
}

function emitCharacterMenuStatus(open) {
  try {
    const selfSlot = getSelfSlot({ fallback: true });
    ensureLobbySelectingRing(selfSlot);
    selfSlot?.classList.toggle("is-selecting-character", !!open);

    const partyId = getRoutePartyId();
    if (!partyId) return;
    socket.emit(SOCKET_EVENTS.CHAR_MENU_STATUS, {
      partyId,
      open: !!open,
    });
  } catch (_) {}
}

let unsubscribeWallet;

export function initializeCharacterSelect(userData) {
  unsubscribeWallet?.();
  unsubscribeWallet = subscribeWallet((wallet, user) => {
    if (user !== state.userData) return;
    refreshUpgradeButtonAffordability();
    if (state.detailsUi?.currentCharacter) renderCharacterDetails(state.detailsUi.currentCharacter);
  });
  if (getUser() !== userData) setUser(userData);
  renderWalletBalances(userData);
  resetSkinOwnership(userData);
  bootstrapSkinState().then(() => {
    try {
      refreshUpgradeButtonAffordability();
      if (state.detailsUi?.currentCharacter) {
        renderCharacterDetails(state.detailsUi.currentCharacter);
      }
    } catch (_) {}
  });
  const popupShell = getSharedSelectionPopupShell();

  // Keep the starfield decorative: a full-viewport canvas used to redraw at
  // display refresh rate, even behind details or after another picker mounted.
  const starfield = document.createElement("div");
  starfield.className = "character-select-starfield";
  starfield.setAttribute("aria-hidden", "true");

  const charactersGrid = document.createElement("div");
  charactersGrid.className = "characters-grid";
  charactersGridEl = charactersGrid;

  const characters = getSortedCharacters(userData);
  characters.forEach((char) =>
    charactersGrid.appendChild(createCharacterCard(char, userData)),
  );

  const mountCharacterPopup = () => {
    popupShell.mount({
      titleText: "Choose Your Bro",
      onClose: () => closeCharacterSelect(),
      closeButtonAttrs: { "data-sound": "cancel" },
      closeButtonText: "×",
      contentNode: charactersGrid,
      backgroundNode: starfield,
      showWallet: true,
    });
  };

  function openCharacterSelect() {
    if (blockCharacterChangeWhileReady()) return false;
    mountCharacterPopup();
    // Sync classes (selected/locked/maxed/pricing) whenever chooser opens.
    refreshUpgradeButtonAffordability();
    popupShell.show();
    warmPopupImages(characters.map(character =>
      resolveCharacterPreviewAsset(character, getSelectedSkin(character).id),
    ), { background: true });
    emitCharacterMenuStatus(true);
    return true;
  }
  function closeCharacterSelect() {
    hideCharacterDetails();
    popupShell.hide();
    emitCharacterMenuStatus(false);
  }
  picker = { open: openCharacterSelect, close: closeCharacterSelect };
}

function createCharacterCard(character, userData) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "character-card";
  card.dataset.char = character;

  const cardState = getCharacterCardState(character, userData);

  card.classList.toggle(
    "selected",
    String(userData?.char_class || "").toLowerCase() ===
      String(character).toLowerCase(),
  );
  card.classList.toggle("locked", cardState.isLocked);
  card.classList.toggle("is-maxed", cardState.isMaxed);
  card.classList.toggle("is-upgrade-ready", cardState.canUpgrade);
  card.classList.toggle("is-unlock-ready", cardState.canUnlock);
  const isSelected =
    String(userData?.char_class || "").toLowerCase() ===
    String(character).toLowerCase();
  card.setAttribute("aria-pressed", String(isSelected));

  // Compact card layout: portrait, name, and progression state. Detailed
  // combat stats live in the expanded character view.
  const profileIconUrl = equippedCharacterPortrait(character, userData);

  const imageWrap = document.createElement("div");
  imageWrap.className = "character-card-image-wrap";

  const profileIcon = document.createElement("img");
  profileIcon.className = "character-profile-icon";
  profileIcon.src = profileIconUrl;
  profileIcon.decode?.().catch(() => {});
  profileIcon.alt = character;
  imageWrap.appendChild(profileIcon);

  if (!cardState.isLocked && cardState.level > 0 && cardState.level <= LEVEL_CAP) {
    // Attach the plaque to the card so it can overlap the portrait's clipped
    // corner frame in the same way as the Selected tag.
    card.appendChild(createLevelBadge(cardState.level, {
      className: "level-badge--framed character-level character-card-level",
    }));
  }


  const selectedBadge = document.createElement("span");
  selectedBadge.className = "character-card-selected-badge";
  selectedBadge.textContent = "Selected";
  selectedBadge.hidden = !isSelected;
  card.appendChild(selectedBadge);

  if (cardState.isLocked) {
    const lockOverlay = document.createElement("div");
    lockOverlay.className = "character-card-lock-overlay";
    lockOverlay.innerHTML = '<img src="/assets/icons/lock.webp" alt="Locked" />';
    imageWrap.appendChild(lockOverlay);
  }

  const statusSection = document.createElement("div");
  statusSection.className = "character-card-status";

  const statusText = document.createElement("div");
  statusText.className = "character-card-status-text";

  renderCharacterStatus(statusText, cardState);

  statusSection.appendChild(statusText);

  // Info section: name and progression state
  const info = document.createElement("div");
  info.className = "character-card-info";

  const nameSection = document.createElement("div");
  nameSection.className = "character-card-name-section";

  const nameRow = document.createElement("div");
  nameRow.className = "character-card-name-row";

  const name = document.createElement("h3");
  name.className = "character-card-name";
  name.textContent = getCharacterDisplayName(character).toUpperCase();
  nameRow.appendChild(name);
  nameSection.appendChild(nameRow);

  info.appendChild(nameSection);
  info.appendChild(statusSection);

  card.appendChild(imageWrap);
  card.appendChild(info);

  const warmDetails = () => warmPopupImages([
    resolveCharacterPreviewAsset(character, getSelectedSkin(character).id),
  ]);
  card.addEventListener("pointerenter", warmDetails);
  card.addEventListener("focus", warmDetails);
  card.addEventListener("click", () => {
    playSound("cursor5", 0.3);
    openCharacterDetails(character);
  });



  return card;
}

export function openCharacterSelect() {
  return picker?.open() ?? false;
}

async function persistActiveCharacterSelection(character, skinId) {
  const fallbackMessage = "Unable to save this character and skin.";
  const payload = await postJson(API_PATHS.SKINS_SELECT, { character, skinId, activateCharacter: true }, { fallbackMessage });
  if (payload?.success !== true) {
    throw new Error(payload?.error || fallbackMessage);
  }
  return payload;
}

function closeCharacterSelectAfterSelection() {
  picker?.close();
}

async function selectCharacter(character, { closeAfterSelection = true } = {}) {
  if (state.selectionPromise) return false;
  if (blockCharacterChangeWhileReady()) return false;
  const charClass = normalizeCharacterId(character);
  const selectedSkin = getSelectedSkin(charClass);
  const selectedSkinId = String(selectedSkin?.id || "").trim();
  if (!charClass || !selectedSkinId || selectedSkin?.locked) return false;

  state.selectionPromise = persistActiveCharacterSelection(
    charClass,
    selectedSkinId,
  );

  try {
    const persisted = await state.selectionPromise;
    const selectedSkinAsset = resolveCharacterPreviewAsset(
      charClass,
      selectedSkinId,
    );

    // Update local state only after the server has atomically saved both the
    // active character and its selected skin.
    if (state.userData) {
      updateUser({ char_class: charClass, selected_skin_id_by_char: {
        ...state.userData.selected_skin_id_by_char, ...persisted?.selectedSkinIdByCharacter, [charClass]: selectedSkinId,
      } });
    }
    state.confirmedSkinSelections[charClass] = selectedSkinId;
    warmBattleSelection();

    const updateSelectionView = () => {
    // Update current user's visible slot, if present
    const yourSlot = getSelfSlot({ fallback: true });
    if (yourSlot) {
      const spriteEl = yourSlot.querySelector(".character-sprite");
      const prevCharacter = String(yourSlot.dataset.character || "").trim();
      if (spriteEl) {
        spriteEl.src = selectedSkinAsset;
        spriteEl.alt = getCharacterDisplayName(charClass);
        spriteEl.classList.remove("random");
      }
      yourSlot.dataset.character = charClass;
      yourSlot.classList.remove("empty");
      const charLevels =
        typeof state.userData?.char_levels === "object" &&
        state.userData?.char_levels
          ? state.userData.char_levels
          : {};
      setSlotLevelBadge(
        yourSlot,
        Math.max(1, Number(charLevels?.[charClass]) || 1),
      );
      if (prevCharacter && prevCharacter !== charClass) {
        triggerLobbyCharacterSplash(yourSlot);
      }
    }

    // Broadcast the already-persisted selection so party rosters update now.
    const partyId = getRoutePartyId();
    if (partyId) {
      socket.emit(SOCKET_EVENTS.CHAR_CHANGE, {
        partyId,
        character: charClass,
        selectedSkinId,
      });
    } else {
      socket.emit(SOCKET_EVENTS.CHAR_CHANGE, { character: charClass, selectedSkinId });
    }

    // Keep chooser card highlight synced immediately after selection.
    refreshUpgradeButtonAffordability();
    };
    if (!closeAfterSelection && state.detailsUi?.currentCharacter) {
      state.deferredSkinRender = updateSelectionView;
    } else {
      state.deferredSkinRender = null;
      updateSelectionView();
    }
    if (closeAfterSelection) closeCharacterSelectAfterSelection();
    return true;
  } catch (e) {
    console.warn("selectCharacter failed:", e?.message);
    showErrorDialog(
      e?.message || "Unable to save this character and skin.",
      "Selection Not Saved",
    );
    return false;
  } finally {
    state.selectionPromise = null;
  }
}

function rerenderCharacterCard(character, userData) {
  const grid = charactersGridEl;
  const oldCard =
    grid &&
    grid.querySelector(`.character-card[data-char="${CSS.escape(character)}"]`);
  if (!oldCard || !grid) return;
  const newCard = createCharacterCard(character, userData);
  grid.replaceChild(newCard, oldCard);
  if (state.detailsUi?.currentCharacter === character) {
    renderCharacterDetails(character);
  }
  sortCharacterCardsInGrid(userData);
  // After any change, also refresh other cards' affordability/state
  try {
    refreshUpgradeButtonAffordability();
  } catch {}
}

function refreshUpgradeButtonAffordability() {
  const user = getUser();
  const cards = charactersGridEl?.querySelectorAll(".character-card") || [];
  cards.forEach((card) => {
    try {
      const character = card.dataset.char;
      if (!character) return;
      const cardState = getCharacterCardState(character, user);
      const portrait = card.querySelector(".character-profile-icon");
      if (portrait) portrait.src = equippedCharacterPortrait(character, user);
      const statusText = card.querySelector(".character-card-status-text");
      if (!statusText) return;

      card.classList.toggle(
        "selected",
        String(user?.char_class || "").toLowerCase() ===
          String(character).toLowerCase(),
      );
      const selected = card.classList.contains("selected");
      card.setAttribute("aria-pressed", String(selected));
      const selectedBadge = card.querySelector(".character-card-selected-badge");
      if (selectedBadge) selectedBadge.hidden = !selected;
      card.classList.toggle("locked", cardState.isLocked);
      const imageWrap = card.querySelector(".character-card-image-wrap");
      const lockOverlay = imageWrap?.querySelector(".character-card-lock-overlay");
      if (cardState.isLocked && imageWrap && !lockOverlay) {
        const overlay = document.createElement("div");
        overlay.className = "character-card-lock-overlay";
        overlay.innerHTML = '<img src="/assets/icons/lock.webp" alt="Locked" />';
        imageWrap.appendChild(overlay);
      } else if (!cardState.isLocked) lockOverlay?.remove();
      card.classList.toggle("is-maxed", cardState.isMaxed);
      card.classList.toggle("is-upgrade-ready", cardState.canUpgrade);
      card.classList.toggle("is-unlock-ready", cardState.canUnlock);

      renderCharacterStatus(statusText, cardState);
    } catch {}
  });
  sortCharacterCardsInGrid(user);
}

export async function refreshCharacterRewards() {
  // The claim response has already updated char_levels. Reflect ownership
  // before the separate skin request completes so newly owned Bros lose their lock.
  for (const character of Object.keys(state.userData?.char_levels || {})) rerenderCharacterCard(character, state.userData);
  refreshUpgradeButtonAffordability();
  if (state.detailsUi?.currentCharacter) renderCharacterDetails(state.detailsUi.currentCharacter);
  await bootstrapSkinState();
  for (const character of Object.keys(state.userData?.char_levels || {})) rerenderCharacterCard(character, state.userData);
  refreshUpgradeButtonAffordability();
  if (state.detailsUi?.currentCharacter) renderCharacterDetails(state.detailsUi.currentCharacter);
}
