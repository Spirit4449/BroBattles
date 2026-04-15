import { sonner } from "./lib/sonner.js";
import {
  checkIfInParty,
  createParty,
  leaveParty,
  socketInit,
  applyLobbySelection,
  renderPartyMembers,
  getPartyInteractionContext,
  initializeModeDropdown,
  showMatchmakingOverlay,
  initReadyToggle,
  setSlotLevelBadge,
  showPartyJoinRequestScreen,
} from "./party.js";
import socket, { ensureSocketConnected, waitForConnect } from "./socket.js";
import {
  initializeCharacterSelect,
  openCharacterSelect,
} from "./characterLogic.js";
import { getLobbyBgAsset } from "./maps/manifest";
import {
  getMapLabel,
  getSelectionDisplayLabel,
  normalizeGameSelection,
} from "./lib/gameSelectionCatalog.js";
import { initUISounds, playSound } from "./lib/uiSounds.js";
import { showUiConfirm } from "./lib/uiConfirm.js";
import { wireFullscreenToggles } from "./lib/fullscreen.js";
import { createLobbyChatController } from "./lib/chatController.js";
import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "./lib/profileIconAssets.js";
import "./styles/characterSelect.css";
import "./styles/index.css";
import "./styles/chat.css";
import "./styles/profile.css";
import "./styles/selectionPopup.css";
import "./styles/sonner.css";

wireFullscreenToggles();

createLobbyChatController({
  socket,
  getPartyContext: getPartyInteractionContext,
  getCurrentUserName: () =>
    document.getElementById("username-text")?.textContent || "",
});

let userData = null;
let guest = false;
const POST_MATCH_REWARD_STORAGE_KEY = "bb_post_match_rewards_v1";
let trophyRoadLastScrollLeft = 0;
const lobbyProfileState = {
  profile: null,
  catalog: null,
  iconCatalog: null,
  ownedCardIds: [],
  selectedCardId: null,
  ownedProfileIconIds: [],
  selectedProfileIconId: null,
  loadingPromise: null,
  viewingSelf: true,
  viewingUsername: null,
};

let partySlotMenu = null;
let __partyDiscoveryState = {
  query: "",
  loading: false,
  lastResult: [],
};
let __partySettingsState = {
  isOwner: false,
  isPublic: false,
  publicName: "",
  visibilitySupported: true,
};
let __lobbyProfilePopup = null;

function escapeHtml(value) {
  const raw = String(value ?? "");
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getDiscoveryModeLabel(party) {
  const selection = normalizeGameSelection({
    modeId: party?.modeId,
    modeVariantId: party?.modeVariantId,
    mapId: party?.map,
  });
  return getSelectionDisplayLabel(selection);
}

function setProfilePopupMessage(text, isError = false) {
  const msg = document.getElementById("profile-message");
  if (!msg) return;
  msg.textContent = text || "";
  msg.style.color = isError ? "#ff9aa9" : "#bfe2ff";
}

async function profileFetchJson(url, options) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...(options || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "Request failed");
  }
  return data;
}

function ensurePartySlotMenu() {
  if (partySlotMenu) return partySlotMenu;
  const menu = document.createElement("div");
  menu.className = "profile-slot-menu";
  menu.hidden = true;
  menu.innerHTML = `
    <div class="profile-slot-menu-head" id="party-slot-menu-name">Player</div>
    <div class="profile-slot-menu-actions">
      <button type="button" class="profile-slot-menu-btn kick pixel-menu-button" data-action="kick">Kick</button>
      <button type="button" class="profile-slot-menu-btn owner pixel-menu-button" data-action="owner">Make Owner</button>
      <button type="button" class="profile-slot-menu-btn view pixel-menu-button" data-action="view">View Profile</button>
    </div>
  `;
  document.body.appendChild(menu);
  document.addEventListener("click", (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target)) return;
    menu.hidden = true;
  });
  partySlotMenu = menu;
  return menu;
}

function renderProfilePopupStats() {
  const profile = lobbyProfileState.profile;
  if (!profile) return;

  const resolveSelectedCard = () => {
    const cards = Array.isArray(lobbyProfileState.catalog?.cards)
      ? lobbyProfileState.catalog.cards
      : [];
    const selectedId = String(
      lobbyProfileState.selectedCardId || profile.selectedCardId || "",
    );
    const selectedCard = cards.find(
      (card) => String(card?.id || "") === selectedId,
    );
    if (selectedCard?.assetUrl) return selectedCard;
    const defaultCard = cards.find(
      (card) => String(card?.id || "") === "default",
    );
    if (defaultCard?.assetUrl) return defaultCard;
    return {
      name: "Player Card",
      assetUrl: "/assets/player-cards/default.webp",
    };
  };

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? "");
  };

  setText("profile-username", profile.username || "-");
  setText("profile-hero-coins", Number(profile.coins) || 0);
  setText("profile-hero-gems", Number(profile.gems) || 0);
  setText("profile-trophies", Number(profile.trophies) || 0);
  setText("profile-avg-level", Number(profile.avgCharLevel) || 1);
  setText("profile-wins", Number(profile.wins) || 0);
  setText("profile-hero-name", profile.username || "-");
  setText("profile-hero-class", String(profile.charClass || "ninja"));
  const heroAvatar = document.getElementById("profile-hero-avatar");
  if (heroAvatar) {
    heroAvatar.src = buildProfileIconUrl(
      profile.profileIconId,
      profile.charClass,
    );
    heroAvatar.alt = buildProfileIconAlt(
      profile.profileIconId,
      profile.charClass,
    );
  }
  const heroCardFrame = document.getElementById("profile-hero-card-frame");
  if (heroCardFrame) {
    const selectedCard = resolveSelectedCard();
    heroCardFrame.src =
      selectedCard?.assetUrl || "/assets/player-cards/default.webp";
    heroCardFrame.alt = selectedCard?.name || "Selected player card";
  }
  const avatarTrigger = document.getElementById("profile-hero-avatar-trigger");
  const cardTrigger = document.getElementById("profile-hero-card-trigger");
  if (avatarTrigger) {
    avatarTrigger.disabled = !lobbyProfileState.viewingSelf;
    avatarTrigger.style.cursor = lobbyProfileState.viewingSelf
      ? "pointer"
      : "default";
  }
  if (cardTrigger) {
    cardTrigger.disabled = !lobbyProfileState.viewingSelf;
    cardTrigger.hidden = !lobbyProfileState.viewingSelf;
  }
  const editBadge = document.getElementById("profile-icon-edit-badge");
  if (editBadge) {
    editBadge.hidden = !lobbyProfileState.viewingSelf;
  }
  const cardEditBadge = document.querySelector(".profile-card-edit-badge");
  if (cardEditBadge) {
    cardEditBadge.hidden = !lobbyProfileState.viewingSelf;
  }
  const subtitle = document.getElementById("profile-popup-subtitle");
  if (subtitle) {
    subtitle.textContent = "Loadout and progression overview";
  }
  const title = document.getElementById("profile-popup-title");
  if (title) {
    title.textContent = `${profile.username || "Player"} Profile`;
  }
  const accountPanel = document.getElementById("profile-account-panel");
  if (accountPanel) {
    accountPanel.classList.toggle("is-hidden", !lobbyProfileState.viewingSelf);
  }
  const characterLevelsPanel = document.getElementById(
    "profile-character-levels-panel",
  );
  if (characterLevelsPanel) {
    characterLevelsPanel.classList.toggle(
      "is-hidden",
      lobbyProfileState.viewingSelf,
    );
  }
  const cardsPanel = document.getElementById("profile-cards-panel");
  const iconsPanel = document.getElementById("profile-icons-panel");
  const loadoutOverlay = document.getElementById("profile-loadout-overlay");
  if (loadoutOverlay && !lobbyProfileState.viewingSelf) {
    loadoutOverlay.classList.add("hidden");
    loadoutOverlay.setAttribute("aria-hidden", "true");
    if (cardsPanel) cardsPanel.classList.add("is-hidden");
    if (iconsPanel) iconsPanel.classList.add("is-hidden");
  }

  const usernameInput = document.getElementById("profile-new-username");
  if (usernameInput && lobbyProfileState.viewingSelf && !usernameInput.value) {
    usernameInput.value = profile.username || "";
  }

  // Keep navbar resource counters in sync after buy operations.
  const coinCount = document.getElementById("coin-count");
  const gemCount = document.getElementById("gem-count");
  const trophyCount = document.getElementById("trophy-count");
  if (lobbyProfileState.viewingSelf) {
    if (coinCount) coinCount.textContent = String(Number(profile.coins) || 0);
    if (gemCount) gemCount.textContent = String(Number(profile.gems) || 0);
    if (trophyCount)
      trophyCount.textContent = String(Number(profile.trophies) || 0);
  }

  renderProfileCharacterLevels();
}

function renderProfileCharacterLevels() {
  const panel = document.getElementById("profile-character-levels-panel");
  const grid = document.getElementById("profile-character-levels-grid");
  const profile = lobbyProfileState.profile || {};
  if (!panel || !grid) return;
  grid.innerHTML = "";

  if (lobbyProfileState.viewingSelf) {
    panel.classList.add("is-hidden");
    return;
  }

  panel.classList.remove("is-hidden");

  const toDisplayName = (id) =>
    String(id || "")
      .split(/[_-]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const entries = Object.entries(profile.charLevels || {})
    .map(([charId, rawLevel]) => ({
      charId: String(charId || "").trim(),
      level: Number(rawLevel) || 0,
    }))
    .filter((entry) => entry.charId && entry.level > 0)
    .sort((a, b) => b.level - a.level || a.charId.localeCompare(b.charId));

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "profile-character-level-empty";
    empty.textContent = "No unlocked characters available.";
    grid.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const iconLevel = Math.max(1, Math.min(5, Number(entry.level) || 1));
    const card = document.createElement("article");
    card.className = "profile-character-level-card";
    card.innerHTML = `
      <div class="profile-character-level-badge" aria-hidden="true">
        <img src="/assets/levels/${iconLevel}.webp" alt="" />
      </div>
      <img src="/assets/${entry.charId}/body.webp" alt="${toDisplayName(entry.charId)}" />
      <div class="profile-character-level-name">${toDisplayName(entry.charId)}</div>
    `;
    grid.appendChild(card);
  });
}

function renderProfilePopupCards() {
  const grid = document.getElementById("profile-cards-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const catalogCards = Array.isArray(lobbyProfileState.catalog?.cards)
    ? lobbyProfileState.catalog.cards
    : [];
  const owned = new Set((lobbyProfileState.ownedCardIds || []).map(String));
  const selected = String(lobbyProfileState.selectedCardId || "");

  catalogCards.forEach((card) => {
    const id = String(card?.id || "");
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const rarity = String(card?.rarity || "common").toLowerCase();
    const coinCost = Math.max(0, Number(card?.cost?.coins || 0));
    const gemCost = Math.max(0, Number(card?.cost?.gems || 0));
    const useGems = gemCost > 0;
    const price = useGems ? gemCost : coinCost;
    const currencyIcon = useGems ? "/assets/gem.webp" : "/assets/coin.webp";
    const currencyLabel = useGems ? "gems" : "coins";

    const tile = document.createElement("article");
    tile.className = `profile-card-tile ${rarity}`;
    tile.innerHTML = `
      <img src="${card.assetUrl}" alt="${card.name}" />
      <div class="profile-card-meta">
        <strong>${card.name}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
        <span class="profile-cost"><img src="${currencyIcon}" alt="${currencyLabel}" /> ${price}</span>
      </div>
      <div class="profile-card-actions">
        <span class="profile-card-state">${isSelected ? "Equipped" : isOwned ? "Owned" : "Locked"}</span>
        <button class="profile-card-btn pixel-menu-button" type="button" data-card-id="${id}" data-action="${isOwned ? "equip" : "buy"}">
          ${isOwned ? (isSelected ? "Selected" : "Equip") : "Buy"}
        </button>
      </div>
    `;

    const actionBtn = tile.querySelector("button[data-card-id]");
    if (actionBtn) {
      if (isSelected) actionBtn.disabled = true;
      actionBtn.addEventListener("click", async () => {
        try {
          actionBtn.disabled = true;
          const cardId = String(actionBtn.dataset.cardId || "");
          const action = String(actionBtn.dataset.action || "equip");

          if (action === "buy") {
            const ok = await showUiConfirm({
              title: "Confirm Purchase",
              message: `Buy ${card.name} for ${price} ${currencyLabel}?`,
              confirmLabel: `${price}`,
              confirmIcon: currencyIcon,
            });
            if (!ok) {
              actionBtn.disabled = false;
              return;
            }
          }

          if (action === "buy") {
            await profileFetchJson("/player-cards/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId }),
            });
          }

          await profileFetchJson("/player-cards/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId }),
          });

          await loadProfilePopupData(true);
          if (action === "buy") {
            sonner("Card purchased", undefined, "success");
          }
        } catch (err) {
          const msg = String(err?.message || "Card action failed.");
          sonner(
            msg.includes("Not enough")
              ? "Not enough coins/gems"
              : "Card action failed",
            msg,
            "error",
          );
          actionBtn.disabled = false;
        }
      });
    }

    grid.appendChild(tile);
  });
}

function renderProfilePopupIcons() {
  const grid = document.getElementById("profile-icons-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const catalogIcons = Array.isArray(lobbyProfileState.iconCatalog?.icons)
    ? lobbyProfileState.iconCatalog.icons
    : [];
  const owned = new Set(
    (lobbyProfileState.ownedProfileIconIds || []).map(String),
  );
  const selected = String(
    lobbyProfileState.selectedProfileIconId ||
      lobbyProfileState.profile?.profileIconId ||
      "",
  );

  const visibleIcons = catalogIcons.filter((icon) => {
    const iconId = String(icon?.id || "");
    return icon?.showInPicker !== false || owned.has(iconId);
  });

  visibleIcons.forEach((icon) => {
    const id = String(icon?.id || "");
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const isLimited = icon?.limited === true;
    const gemCost = Math.max(0, Number(icon?.cost?.gems || 0));
    const isLocked = !isOwned && isLimited;

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `profile-icon-choice-tile${isSelected ? " is-selected" : ""}${!isOwned ? " is-unowned" : ""}${isLocked ? " is-locked" : ""}`;
    tile.dataset.iconId = id;
    tile.innerHTML = `
      <img src="${icon.assetUrl}" alt="${icon.name}" />
      <span class="profile-icon-name-badge">${icon.name}</span>
      ${gemCost > 0 && !isOwned ? `<span class="profile-icon-gem-badge"><img src="/assets/gem.webp" alt="gems" /> ${gemCost}</span>` : ""}
      ${isLimited ? '<span class="profile-icon-limited-tag">LIMITED</span>' : ""}
      ${!isOwned ? '<span class="profile-icon-lock-overlay"><img src="/assets/lock.webp" alt="Locked" /></span>' : ""}
    `;

    if (isLocked || isSelected) tile.disabled = true;

    tile.addEventListener("click", async () => {
      try {
        tile.disabled = true;
        const iconId = String(tile.dataset.iconId || "");
        if (!iconId) return;

        if (!isOwned) {
          const ok = await showUiConfirm({
            title: "Confirm Purchase",
            message:
              gemCost > 0
                ? `Buy ${icon.name} for ${gemCost} gems?`
                : `Unlock ${icon.name}?`,
            confirmLabel: `${gemCost}`,
            confirmIcon: "/assets/gem.webp",
          });
          if (!ok) {
            tile.disabled = false;
            return;
          }
          await profileFetchJson("/profile-icons/buy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iconId }),
          });
        }

        await profileFetchJson("/profile-icons/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ iconId }),
        });

        await loadProfilePopupData(true);
        if (!isOwned) {
          sonner("Profile icon purchased", undefined, "success");
        }
      } catch (err) {
        const msg = String(err?.message || "Profile icon action failed.");
        sonner(
          msg.includes("Not enough")
            ? "Not enough gems"
            : "Profile icon action failed",
          msg,
          "error",
        );
        tile.disabled = false;
      }
    });

    grid.appendChild(tile);
  });
}

async function loadProfilePopupData(force = false) {
  if (!lobbyProfileState.viewingSelf && lobbyProfileState.viewingUsername) {
    const profileRes = await profileFetchJson(
      `/profile/view?username=${encodeURIComponent(lobbyProfileState.viewingUsername)}`,
    );
    if (!lobbyProfileState.catalog) {
      const catalogRes = await profileFetchJson("/player-cards/catalog");
      lobbyProfileState.catalog =
        catalogRes?.catalog && Array.isArray(catalogRes.catalog.cards)
          ? catalogRes.catalog
          : { cards: [] };
    }
    lobbyProfileState.profile = profileRes?.profile || {};
    lobbyProfileState.selectedCardId =
      lobbyProfileState.profile?.selectedCardId || null;
    renderProfilePopupStats();
    const grid = document.getElementById("profile-cards-grid");
    if (grid) grid.innerHTML = "";
    const iconGrid = document.getElementById("profile-icons-grid");
    if (iconGrid) iconGrid.innerHTML = "";
    return;
  }
  if (!force && lobbyProfileState.profile && lobbyProfileState.catalog) {
    renderProfilePopupStats();
    renderProfilePopupCards();
    renderProfilePopupIcons();
    return;
  }
  if (lobbyProfileState.loadingPromise) return lobbyProfileState.loadingPromise;

  lobbyProfileState.loadingPromise = Promise.all([
    profileFetchJson("/profile/data"),
    profileFetchJson("/player-cards/catalog"),
    profileFetchJson("/player-cards/owned"),
    profileFetchJson("/profile-icons/catalog"),
    profileFetchJson("/profile-icons/owned"),
  ])
    .then(
      ([profileRes, catalogRes, ownedRes, iconCatalogRes, iconOwnedRes]) => {
        const profile = profileRes?.profile || {};
        lobbyProfileState.profile = profile;
        lobbyProfileState.catalog =
          catalogRes?.catalog && Array.isArray(catalogRes.catalog.cards)
            ? catalogRes.catalog
            : { cards: [] };
        lobbyProfileState.iconCatalog =
          iconCatalogRes?.catalog && Array.isArray(iconCatalogRes.catalog.icons)
            ? iconCatalogRes.catalog
            : { icons: [] };
        lobbyProfileState.ownedCardIds = Array.isArray(ownedRes?.ownedCardIds)
          ? ownedRes.ownedCardIds
          : [];
        lobbyProfileState.selectedCardId =
          ownedRes?.selectedCardId || profile?.selectedCardId || null;
        lobbyProfileState.ownedProfileIconIds = Array.isArray(
          iconOwnedRes?.ownedIconIds,
        )
          ? iconOwnedRes.ownedIconIds
          : Array.isArray(profile?.ownedProfileIconIds)
            ? profile.ownedProfileIconIds
            : [];
        lobbyProfileState.selectedProfileIconId =
          iconOwnedRes?.selectedProfileIconId ||
          profile?.selectedProfileIconId ||
          profile?.profileIconId ||
          null;

        if (userData) {
          userData.name = profile.username || userData.name;
          userData.coins = Number(profile.coins ?? userData.coins) || 0;
          userData.gems = Number(profile.gems ?? userData.gems) || 0;
          userData.trophies =
            Number(profile.trophies ?? userData.trophies) || 0;
        }

        const usernameText = document.getElementById("username-text");
        if (usernameText) usernameText.textContent = profile.username || "";

        renderProfilePopupStats();
        renderProfilePopupCards();
        renderProfilePopupIcons();
      },
    )
    .finally(() => {
      lobbyProfileState.loadingPromise = null;
    });

  return lobbyProfileState.loadingPromise;
}

function initProfilePopup() {
  const overlay = document.getElementById("profile-overlay");
  const closeBtn = document.getElementById("profile-close");
  const backdrop = overlay?.querySelector(".profile-overlay-backdrop");
  const usernameForm = document.getElementById("profile-username-form");
  const passwordForm = document.getElementById("profile-password-form");
  const usernameInput = document.getElementById("profile-new-username");
  const currentPasswordInput = document.getElementById(
    "profile-current-password",
  );
  const newPasswordInput = document.getElementById("profile-new-password");
  const avatarTrigger = document.getElementById("profile-hero-avatar-trigger");
  const cardTrigger = document.getElementById("profile-hero-card-trigger");
  const loadoutClose = document.getElementById("profile-loadout-close");
  const loadoutOverlay = document.getElementById("profile-loadout-overlay");
  const loadoutBackdrop = loadoutOverlay?.querySelector(
    ".profile-loadout-backdrop",
  );
  const loadoutTitle = document.getElementById("profile-loadout-title");
  const iconsPanel = document.getElementById("profile-icons-panel");
  const cardsPanel = document.getElementById("profile-cards-panel");

  if (!overlay) return;

  const openLoadoutModal = (mode = "icons") => {
    if (!lobbyProfileState.viewingSelf || !loadoutOverlay) return;
    const showIcons = mode === "icons";
    if (loadoutTitle) {
      loadoutTitle.textContent = showIcons
        ? "Edit Profile Icon"
        : "Edit Player Card";
    }
    if (iconsPanel) iconsPanel.classList.toggle("is-hidden", !showIcons);
    if (cardsPanel) cardsPanel.classList.toggle("is-hidden", showIcons);
    loadoutOverlay.classList.remove("hidden");
    loadoutOverlay.setAttribute("aria-hidden", "false");
  };

  const closeLoadoutModal = () => {
    if (!loadoutOverlay) return;
    loadoutOverlay.classList.add("hidden");
    loadoutOverlay.setAttribute("aria-hidden", "true");
  };

  const close = () => {
    playSound("cancel", 0.4);
    closeLoadoutModal();
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    setProfilePopupMessage("");
  };

  const open = async (options = {}) => {
    const targetUsername = String(options?.username || "").trim();
    lobbyProfileState.viewingSelf =
      !targetUsername || targetUsername === String(userData?.name || "");
    lobbyProfileState.viewingUsername = lobbyProfileState.viewingSelf
      ? String(userData?.name || "")
      : targetUsername;
    playSound("cursor4", 0.4);
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    closeLoadoutModal();
    setProfilePopupMessage("Loading profile...");
    try {
      await loadProfilePopupData(true);
      overlay.classList.remove("hidden");
      overlay.setAttribute("aria-hidden", "false");
      setProfilePopupMessage("");
    } catch (err) {
      overlay.classList.remove("hidden");
      overlay.setAttribute("aria-hidden", "false");
      setProfilePopupMessage(err.message || "Failed to load profile.", true);
    }
  };

  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (loadoutOverlay && !loadoutOverlay.classList.contains("hidden")) {
      closeLoadoutModal();
      return;
    }
    if (!overlay.classList.contains("hidden")) close();
  });

  usernameForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = String(usernameInput?.value || "").trim();
    if (!username) return;
    try {
      const data = await profileFetchJson("/profile/change-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      if (!lobbyProfileState.profile) lobbyProfileState.profile = {};
      lobbyProfileState.profile.username = data.username || username;
      if (userData) userData.name = data.username || username;

      const usernameText = document.getElementById("username-text");
      if (usernameText) usernameText.textContent = data.username || username;

      renderProfilePopupStats();
      setProfilePopupMessage("Username updated.");
    } catch (err) {
      setProfilePopupMessage(err.message || "Unable to update username.", true);
    }
  });

  passwordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = String(currentPasswordInput?.value || "");
    const newPassword = String(newPasswordInput?.value || "");
    if (!newPassword) return;
    try {
      await profileFetchJson("/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (currentPasswordInput) currentPasswordInput.value = "";
      if (newPasswordInput) newPasswordInput.value = "";
      setProfilePopupMessage("Password updated.");
    } catch (err) {
      setProfilePopupMessage(err.message || "Unable to update password.", true);
    }
  });

  avatarTrigger?.addEventListener("click", () => {
    openLoadoutModal("icons");
  });
  cardTrigger?.addEventListener("click", () => {
    openLoadoutModal("cards");
  });
  loadoutClose?.addEventListener("click", () => {
    closeLoadoutModal();
  });
  loadoutBackdrop?.addEventListener("click", () => {
    closeLoadoutModal();
  });

  return { open, close };
}

async function handlePartyMemberAction(action, playerName, profilePopup) {
  const party = getPartyInteractionContext();
  const partyId = Number(party.partyId);
  if (!action || !playerName) return;
  if (action === "view") {
    await profilePopup?.open?.({ username: playerName });
    return;
  }
  if (!Number.isFinite(partyId) || partyId <= 0) return;
  const endpoint =
    action === "owner"
      ? "/party/make-owner"
      : action === "kick"
        ? "/party/kick"
        : "";
  if (!endpoint) return;
  try {
    await profileFetchJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partyId, targetName: playerName }),
    });
    sonner(
      action === "owner" ? "Party owner updated" : "Player removed",
      action === "owner"
        ? `${playerName} is now the party owner.`
        : `${playerName} was kicked from the party.`,
      "success",
    );
  } catch (err) {
    sonner(
      action === "owner"
        ? "Could not transfer ownership"
        : "Could not kick player",
      err?.message || "Please try again.",
      "error",
    );
  }
}

function openPartySlotMenu(slot, anchorEvent, profilePopup) {
  const menu = ensurePartySlotMenu();
  const playerName = String(slot?.dataset?.playerName || "").trim();
  if (!playerName) return;
  const currentUserName = String(userData?.name || "");
  const party = getPartyInteractionContext();
  const isOwner = String(party.ownerName || "") === currentUserName;
  const isSelf = playerName === currentUserName;
  const ownerBtn = menu.querySelector('[data-action="owner"]');
  const kickBtn = menu.querySelector('[data-action="kick"]');
  const viewBtn = menu.querySelector('[data-action="view"]');
  const title = menu.querySelector("#party-slot-menu-name");
  if (title) {
    title.textContent =
      playerName === party.ownerName ? `${playerName} 👑` : playerName;
  }
  if (viewBtn) {
    viewBtn.hidden = false;
    viewBtn.onclick = async () => {
      menu.hidden = true;
      await handlePartyMemberAction("view", playerName, profilePopup);
    };
  }
  if (ownerBtn) {
    ownerBtn.hidden = !isOwner || isSelf;
    ownerBtn.onclick = async () => {
      menu.hidden = true;
      await handlePartyMemberAction("owner", playerName, profilePopup);
    };
  }
  if (kickBtn) {
    kickBtn.hidden = !isOwner || isSelf;
    kickBtn.onclick = async () => {
      menu.hidden = true;
      await handlePartyMemberAction("kick", playerName, profilePopup);
    };
  }
  menu.style.left = `${Math.min(window.innerWidth - 220, anchorEvent.clientX + 12)}px`;
  menu.style.top = `${Math.min(window.innerHeight - 180, anchorEvent.clientY + 12)}px`;
  menu.hidden = false;
}

function animateNumber(el, from, to, durationMs) {
  if (!el) return;
  const start = performance.now();
  const run = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = String(value);
    if (t < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function animatePostMatchRewardsIfPresent(
  coinEl,
  gemEl,
  trophyEl,
  coinsNow,
  gemsNow,
  trophiesNow,
) {
  if (!coinEl || !gemEl || !trophyEl) return;
  let payload = null;
  try {
    payload = JSON.parse(
      sessionStorage.getItem(POST_MATCH_REWARD_STORAGE_KEY) || "null",
    );
  } catch (_) {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return;
  const ageMs = Date.now() - Number(payload.at || 0);
  const coinsAwarded = Math.max(0, Number(payload.coinsAwarded) || 0);
  const gemsAwarded = Math.max(0, Number(payload.gemsAwarded) || 0);
  const trophiesDelta = Number(payload.trophiesDelta) || 0;
  try {
    sessionStorage.removeItem(POST_MATCH_REWARD_STORAGE_KEY);
  } catch (_) {}
  if (ageMs < 0 || ageMs > 2 * 60 * 1000) return;
  if (coinsAwarded <= 0 && gemsAwarded <= 0 && trophiesDelta === 0) return;

  const coinsFrom = Math.max(0, Number(coinsNow) - coinsAwarded);
  const gemsFrom = Math.max(0, Number(gemsNow) - gemsAwarded);
  const trophiesFrom = Math.max(0, Number(trophiesNow) - trophiesDelta);
  coinEl.textContent = String(coinsFrom);
  gemEl.textContent = String(gemsFrom);
  trophyEl.textContent = String(trophiesFrom);
  animateNumber(coinEl, coinsFrom, Number(coinsNow), 1600);
  animateNumber(gemEl, gemsFrom, Number(gemsNow), 1600);
  animateNumber(trophyEl, trophiesFrom, Number(trophiesNow), 1600);
}

async function fetchLobbyJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

function openOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

function setPartyDiscoveryStatus(text, isError = false) {
  const status = document.getElementById("party-discovery-status");
  if (!status) return;
  status.textContent = text || "";
  status.style.color = isError ? "#ffb0b8" : "#b7d8ff";
}

function renderPartyDiscoveryList(parties) {
  const container = document.getElementById("party-discovery-list");
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(parties) || parties.length === 0) {
    container.innerHTML =
      '<p class="trophy-overlay-loading">No public parties found right now.</p>';
    return;
  }

  parties.forEach((party) => {
    const members = Array.isArray(party?.members) ? party.members : [];
    const card = document.createElement("article");
    card.className = "party-discovery-card";
    const partyTitle = String(party?.publicName || "").trim();
    const ownerName = String(party?.ownerName || "Unknown");
    card.innerHTML = `
      <div class="party-discovery-card-head">
        <div>
          <h3 class="party-discovery-title">${escapeHtml(
            partyTitle || `${ownerName}'s Party`,
          )}</h3>
          <div class="party-discovery-info-row">
            <div>
              <div class="party-discovery-meta-label">Owner</div>
              <div class="party-discovery-meta">
                <img src="/assets/crown.webp" alt="" width="12" height="12" />
                ${escapeHtml(ownerName)}
              </div>
            </div>
            <div>
              <div class="party-discovery-meta-label">Mode</div>
              <div class="party-discovery-meta-value">${escapeHtml(
                getDiscoveryModeLabel(party),
              )}</div>
            </div>
            <div>
              <div class="party-discovery-meta-label">Map</div>
              <div class="party-discovery-meta-value">${escapeHtml(
                getMapLabel(party?.map),
              )}</div>
            </div>
            <div>
              <div class="party-discovery-meta-label">Players</div>
              <div class="party-discovery-meta-value">${members.length}</div>
            </div>
          </div>
        </div>
        <button type="button" class="pixel-menu-button party-discovery-join" data-party-id="${Number(
          party?.partyId,
        )}">Join</button>
      </div>
      <div class="party-discovery-members"></div>
    `;

    const memberWrap = card.querySelector(".party-discovery-members");
    members.forEach((member) => {
      const name = String(member?.name || "Player");
      const charClass = String(member?.char_class || "ninja");
      const profileIconId = String(member?.profile_icon_id || "") || null;
      const entry = document.createElement("div");
      entry.className = "party-discovery-member";
      entry.innerHTML = `
        <img src="${escapeHtml(buildProfileIconUrl(profileIconId, charClass))}" alt="${escapeHtml(
          buildProfileIconAlt(profileIconId, charClass),
        )}" />
        <div>
          <div class="party-discovery-member-name">${escapeHtml(name)}</div>
          <div class="party-discovery-member-char">${escapeHtml(charClass)}</div>
        </div>
      `;
      memberWrap?.appendChild(entry);
    });

    const joinBtn = card.querySelector(".party-discovery-join");
    joinBtn?.addEventListener("click", async () => {
      const targetPartyId = Number(joinBtn.dataset.partyId);
      if (!Number.isFinite(targetPartyId) || targetPartyId <= 0) return;
      const currentPartyId = Number(checkIfInParty());
      if (Number.isFinite(currentPartyId) && currentPartyId > 0) {
        const ok = await showUiConfirm({
          title: "Leave current party?",
          message:
            "Joining this party will move you out of your current party.",
          confirmLabel: "Join Party",
        });
        if (!ok) return;
      }
      window.location.href = `/party/${targetPartyId}`;
    });

    container.appendChild(card);
  });
}

async function loadPartyDiscovery(query = "") {
  if (__partyDiscoveryState.loading) return;
  __partyDiscoveryState.loading = true;
  setPartyDiscoveryStatus("Loading public parties...");
  try {
    const payload = await fetchLobbyJson("/party/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: String(query || "").trim() }),
    });
    if (payload?.visibilitySupported === false) {
      setPartyDiscoveryStatus(
        "Party discovery is unavailable until the latest DB migration is applied.",
        true,
      );
      renderPartyDiscoveryList([]);
      return;
    }
    const parties = Array.isArray(payload?.parties) ? payload.parties : [];
    __partyDiscoveryState.lastResult = parties;
    setPartyDiscoveryStatus(
      parties.length
        ? `Found ${parties.length} public ${parties.length === 1 ? "party" : "parties"}.`
        : "",
    );
    renderPartyDiscoveryList(parties);
  } catch (error) {
    setPartyDiscoveryStatus(
      error?.message || "Failed to load party list.",
      true,
    );
    renderPartyDiscoveryList([]);
  } finally {
    __partyDiscoveryState.loading = false;
  }
}

async function openPartyDiscoveryOverlay() {
  const input = document.getElementById("party-discovery-input");
  const query = String(
    input?.value || __partyDiscoveryState.query || "",
  ).trim();
  __partyDiscoveryState.query = query;
  openOverlay("party-discovery-overlay");
  await loadPartyDiscovery(query);
}

function setPartySettingsStatus(text, isError = false) {
  const status = document.getElementById("party-settings-status");
  if (!status) return;
  status.textContent = text || "";
  status.style.color = isError ? "#ffb0b8" : "#b7d8ff";
}

function syncPartySettingsButtonVisibility() {
  const button = document.getElementById("party-settings-button");
  if (!button) return;
  const inParty = !!checkIfInParty();
  if (!inParty) {
    button.classList.add("hidden");
    return;
  }
  const context = getPartyInteractionContext();
  const currentUserName = String(userData?.name || "");
  const isOwner =
    String(context?.ownerName || "") === currentUserName && !!currentUserName;
  __partySettingsState.isOwner = isOwner;
  button.classList.toggle("hidden", !isOwner);
}

async function loadPartySettings() {
  const partyId = Number(checkIfInParty());
  if (!Number.isFinite(partyId) || partyId <= 0) return null;

  const payload = await fetchLobbyJson("/party/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partyId }),
  });

  __partySettingsState = {
    isOwner: !!payload?.isOwner,
    isPublic: !!payload?.isPublic,
    publicName: String(payload?.publicName || ""),
    visibilitySupported: payload?.visibilitySupported !== false,
  };

  const toggle = document.getElementById("party-public-toggle");
  const nameInput = document.getElementById("party-public-name");
  const saveBtn = document.getElementById("party-settings-save");
  if (toggle) toggle.checked = __partySettingsState.isPublic;
  if (nameInput) nameInput.value = __partySettingsState.publicName;
  const canEdit =
    __partySettingsState.isOwner && __partySettingsState.visibilitySupported;
  if (toggle) toggle.disabled = !canEdit;
  if (nameInput) nameInput.disabled = !canEdit || !toggle?.checked;
  if (saveBtn) saveBtn.disabled = !canEdit;

  if (!__partySettingsState.visibilitySupported) {
    setPartySettingsStatus(
      "Party visibility requires the latest DB migration before this can be used.",
      true,
    );
  } else if (!__partySettingsState.isOwner) {
    setPartySettingsStatus(
      "Only the party owner can edit these settings.",
      true,
    );
  } else {
    setPartySettingsStatus("");
  }

  return payload;
}

async function openPartySettingsOverlay() {
  if (!checkIfInParty()) return;
  openOverlay("party-settings-overlay");
  try {
    await loadPartySettings();
  } catch (error) {
    setPartySettingsStatus(
      error?.message || "Failed to load party settings.",
      true,
    );
  }
}

async function savePartySettings() {
  const partyId = Number(checkIfInParty());
  if (!Number.isFinite(partyId) || partyId <= 0) return;
  const toggle = document.getElementById("party-public-toggle");
  const nameInput = document.getElementById("party-public-name");
  const isPublic = !!toggle?.checked;
  const publicName = String(nameInput?.value || "").trim();

  if (isPublic && publicName.length < 3) {
    setPartySettingsStatus(
      "Public party names need at least 3 characters.",
      true,
    );
    return;
  }

  try {
    const payload = await fetchLobbyJson("/party/settings/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partyId,
        isPublic,
        publicName,
      }),
    });
    __partySettingsState.isPublic = !!payload?.settings?.isPublic;
    __partySettingsState.publicName = String(
      payload?.settings?.publicName || "",
    );
    setPartySettingsStatus("Party settings updated.");
    sonner("Party settings updated", undefined, "success");
  } catch (error) {
    setPartySettingsStatus(error?.message || "Could not save settings.", true);
  }
}

function wirePartyOverlayControls() {
  const discoveryClose = document.getElementById("party-discovery-close");
  discoveryClose?.addEventListener("click", () =>
    closeOverlay("party-discovery-overlay"),
  );
  document
    .querySelector("#party-discovery-overlay .trophy-overlay-backdrop")
    ?.addEventListener("click", () => closeOverlay("party-discovery-overlay"));

  const discoveryRefresh = document.getElementById("party-discovery-refresh");
  discoveryRefresh?.addEventListener("click", () => {
    const input = document.getElementById("party-discovery-input");
    __partyDiscoveryState.query = String(input?.value || "").trim();
    void loadPartyDiscovery(__partyDiscoveryState.query);
  });
  const discoveryInput = document.getElementById("party-discovery-input");
  discoveryInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    __partyDiscoveryState.query = String(discoveryInput.value || "").trim();
    void loadPartyDiscovery(__partyDiscoveryState.query);
  });

  const settingsClose = document.getElementById("party-settings-close");
  settingsClose?.addEventListener("click", () =>
    closeOverlay("party-settings-overlay"),
  );
  document
    .querySelector("#party-settings-overlay .trophy-overlay-backdrop")
    ?.addEventListener("click", () => closeOverlay("party-settings-overlay"));

  const settingsSave = document.getElementById("party-settings-save");
  settingsSave?.addEventListener("click", () => {
    void savePartySettings();
  });

  const partyPublicToggle = document.getElementById("party-public-toggle");
  const partyPublicName = document.getElementById("party-public-name");
  partyPublicToggle?.addEventListener("change", () => {
    if (partyPublicName) {
      partyPublicName.disabled = !partyPublicToggle.checked;
    }
  });
}

function setTrophyClaimBadge(count) {
  const badge = document.getElementById("trophy-claim-badge");
  const button = document.getElementById("trophy-resource-button");
  const value = Math.max(0, Number(count) || 0);
  if (!badge || !button) return;
  if (value > 0) {
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.classList.remove("hidden");
    button.classList.add("has-claimable");
  } else {
    badge.textContent = "0";
    badge.classList.add("hidden");
    button.classList.remove("has-claimable");
  }
}

function renderTrophyTrack(state) {
  const container = document.getElementById("trophy-track-list");
  const summary = document.getElementById("trophy-track-summary");
  const shouldPreserveScroll = !!state?.__preserveScroll;
  const previousScrollLeft = Number.isFinite(Number(state?.__scrollLeft))
    ? Number(state.__scrollLeft)
    : trophyRoadLastScrollLeft;
  if (!container || !summary) return;

  const player = state?.player || {};
  const tiers = Array.isArray(state?.tiers) ? state.tiers : [];
  const trophies = Number(player.trophies) || 0;
  const availableClaimCount = Math.max(
    0,
    Number(state?.availableClaimCount) || 0,
  );
  setTrophyClaimBadge(availableClaimCount);
  summary.textContent = `${trophies} trophies`;
  container.innerHTML = "";

  const maxTierRequirement = Math.max(
    1,
    ...tiers.map((tier) => Number(tier?.trophiesRequired) || 0),
  );
  const overallRatio = Math.max(0, Math.min(1, trophies / maxTierRequirement));
  const trackWidth = Math.max(980, tiers.length * 240);
  const laneInset = 28;
  const laneWidth = Math.max(1, trackWidth - laneInset * 2);

  const canvas = document.createElement("div");
  canvas.className = "trophy-track-canvas";
  canvas.style.width = `${trackWidth}px`;
  canvas.innerHTML = `
    <div class="trophy-track-line-bg"></div>
    <div class="trophy-track-line-fill" style="width:${Math.round(overallRatio * 100)}%"></div>
    <div class="trophy-track-card-row" id="trophy-track-card-row"></div>
    <div class="trophy-track-marker-row" id="trophy-track-marker-row"></div>
    <div class="trophy-track-player-pin" style="left:${Math.round(overallRatio * 100)}%">
      <img src="/assets/trophy.webp" alt="current trophies" />
      <span>${trophies}</span>
    </div>
  `;
  container.appendChild(canvas);

  const cardRow = canvas.querySelector("#trophy-track-card-row");
  const markerRow = canvas.querySelector("#trophy-track-marker-row");

  const ratioToX = (ratio) => laneInset + ratio * laneWidth;

  for (const tier of tiers) {
    const tierRatio = Math.max(
      0,
      Math.min(1, (Number(tier.trophiesRequired) || 0) / maxTierRequirement),
    );
    const statusClass = tier.claimed
      ? "claimed"
      : tier.canClaim
        ? "claimable"
        : "locked";

    const rewards = Array.isArray(tier.rewards) ? tier.rewards : [];
    const primaryReward = rewards[0] || {
      image: "/assets/coin.webp",
      name: "Reward",
      amount: 0,
    };
    const extraRewards = Math.max(0, rewards.length - 1);
    const primaryName = String(primaryReward?.name || "Reward");
    const primaryImage = String(primaryReward?.image || "/assets/coin.webp");
    const primaryAmount = Math.max(0, Number(primaryReward?.amount) || 0);

    const card = document.createElement("article");
    card.className = `trophy-lane-card ${statusClass}`;
    card.style.left = `${Math.round(ratioToX(tierRatio))}px`;
    card.innerHTML = `
      <div class="trophy-lane-item-glow"></div>
      <img class="trophy-lane-item" src="${primaryImage}" alt="${primaryName}" />
      <div class="trophy-lane-meta">
        <strong>${primaryAmount} ${primaryName}</strong>
        <span>${tier.title || "Reward"}${extraRewards > 0 ? ` +${extraRewards} more` : ""}</span>
      </div>
      <button class="pixel-menu-button trophy-tier-claim" data-tier-id="${tier.tierId}" ${
        tier.canClaim ? "" : "disabled"
      }>${tier.claimed ? "Claimed" : tier.canClaim ? "Claim" : "Locked"}</button>
    `;

    const marker = document.createElement("div");
    marker.className = `trophy-lane-marker ${statusClass}`;
    marker.style.left = `${Math.round(ratioToX(tierRatio))}px`;
    marker.innerHTML = `
      <span class="trophy-lane-marker-dot"></span>
      <span class="trophy-lane-marker-label">${tier.trophiesRequired}</span>
    `;

    const claimBtn = card.querySelector(".trophy-tier-claim");
    claimBtn?.addEventListener("click", async (event) => {
      event?.stopPropagation?.();
      const tierId = String(claimBtn.dataset.tierId || "");
      if (!tierId || claimBtn.disabled) return;
      claimBtn.disabled = true;
      try {
        const result = await fetchLobbyJson("/trophies/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierId }),
        });
        sonner("Reward claimed", "Trophy reward delivered.", "success");

        if (userData) {
          userData.coins = Number(result?.player?.coins ?? userData.coins) || 0;
          userData.gems = Number(result?.player?.gems ?? userData.gems) || 0;
          userData.trophies =
            Number(result?.player?.trophies ?? userData.trophies) || 0;
        }

        const coinCount = document.getElementById("coin-count");
        const gemCount = document.getElementById("gem-count");
        const trophyCount = document.getElementById("trophy-count");
        if (coinCount) coinCount.textContent = String(userData?.coins || 0);
        if (gemCount) gemCount.textContent = String(userData?.gems || 0);
        if (trophyCount)
          trophyCount.textContent = String(userData?.trophies || 0);

        await openTrophyProgressionOverlay({ preserveScroll: true });
      } catch (error) {
        sonner("Reward claim failed", error?.message || "Try again.", "error");
        claimBtn.disabled = false;
      }
    });

    cardRow?.appendChild(card);
    markerRow?.appendChild(marker);
  }

  const ratioCenterTarget = Math.max(
    0,
    Math.min(
      Math.max(0, canvas.scrollWidth - container.clientWidth),
      ratioToX(overallRatio) - container.clientWidth / 2,
    ),
  );
  const nextScrollLeft = shouldPreserveScroll
    ? Math.max(
        0,
        Math.min(
          Math.max(0, canvas.scrollWidth - container.clientWidth),
          Number(previousScrollLeft) || 0,
        ),
      )
    : ratioCenterTarget;
  container.scrollLeft = nextScrollLeft;
  trophyRoadLastScrollLeft = nextScrollLeft;
}

async function openTrophyProgressionOverlay(options = {}) {
  openOverlay("trophy-track-overlay");
  const list = document.getElementById("trophy-track-list");
  const summary = document.getElementById("trophy-track-summary");
  const preserveScroll = !!options?.preserveScroll;
  if (list) {
    trophyRoadLastScrollLeft =
      Number(list.scrollLeft) || trophyRoadLastScrollLeft;
    list.innerHTML = '<p class="trophy-overlay-loading">Loading rewards...</p>';
  }
  if (summary) summary.textContent = "Loading...";
  const progression = await fetchLobbyJson("/trophies/progression");
  progression.__preserveScroll = preserveScroll;
  progression.__scrollLeft = trophyRoadLastScrollLeft;
  renderTrophyTrack(progression);
}

function renderLeaderboardRows(rows, profilePopup) {
  const container = document.getElementById("leaderboard-list");
  if (!container) return;
  container.innerHTML = "";

  for (const row of rows) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "leaderboard-row";
    if (Number(row.rank) <= 3) {
      item.classList.add(`top-${Number(row.rank)}`);
    }
    const winRate =
      Number(row.totalMatches) > 0
        ? `${Math.round((Number(row.wins || 0) / Number(row.totalMatches || 1)) * 100)}%`
        : "0%";
    const charClass = String(row.charClass || "ninja");
    const profileIconId = String(row.profileIconId || "") || null;
    item.innerHTML = `
      <span class="leaderboard-rank">#${row.rank}</span>
      <img class="leaderboard-avatar" src="${buildProfileIconUrl(profileIconId, charClass)}" alt="${buildProfileIconAlt(profileIconId, charClass)}" />
      <span class="leaderboard-main">
        <span class="leaderboard-name">${row.username}</span>
        <span class="leaderboard-wins">${row.wins}W / ${row.totalMatches}M (${winRate})</span>
      </span>
      <span class="leaderboard-trophies"><img src="/assets/trophy.webp" alt="trophies" />${row.trophies}</span>
    `;
    item.addEventListener("click", () => {
      profilePopup?.open?.({ username: row.username });
    });
    container.appendChild(item);
  }
}

async function openLeaderboardOverlay(profilePopup) {
  openOverlay("leaderboard-overlay");
  const container = document.getElementById("leaderboard-list");
  if (container)
    container.innerHTML =
      '<p class="trophy-overlay-loading">Loading leaderboard...</p>';
  const data = await fetchLobbyJson("/leaderboard/trophies?limit=100");
  renderLeaderboardRows(
    Array.isArray(data?.leaderboard) ? data.leaderboard : [],
    profilePopup,
  );
}

async function refreshTrophyClaimAvailability() {
  try {
    const progression = await fetchLobbyJson("/trophies/progression");
    setTrophyClaimBadge(Number(progression?.availableClaimCount) || 0);
  } catch (_) {
    setTrophyClaimBadge(0);
  }
}

/**
 * Check if user has a live match and redirect to it
 * @param {Object} statusData - Response from /status endpoint
 */
function checkForLiveMatch(statusData) {
  if (statusData?.live_match_id) {
    console.log(`User has live match: ${statusData.live_match_id}`);
    // For testing, comment out the redirect
    // window.location.href = `/game/${statusData.live_match_id}`;

    // Temporarily just log for testing
    console.log(`Would redirect to: /game/${statusData.live_match_id}`);

    // sonner("Live Match Found", `Redirecting to match ${statusData.live_match_id}`, "info");
    return true;
  }
  return false;
}

function formatSuspensionTime(suspendedUntilMs) {
  const ms = Number(suspendedUntilMs) || 0;
  if (!ms) return "";
  const delta = Math.max(0, ms - Date.now());
  const seconds = Math.ceil(delta / 1000);
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

function showSuspensionPopupFromStatus(statusData) {
  const mmSuspendedUntilMs = Number(statusData?.suspension?.matchmaking) || 0;
  const chatSuspendedUntilMs = Number(statusData?.suspension?.chat) || 0;
  const mmText = formatSuspensionTime(mmSuspendedUntilMs);
  const chatText = formatSuspensionTime(chatSuspendedUntilMs);

  if (!mmText && !chatText) return;

  const parts = [];
  if (mmText) parts.push(`Matchmaking suspended for ${mmText}.`);
  if (chatText) parts.push(`Lobby chat suspended for ${chatText}.`);
  sonner("Account suspension active", parts.join(" "), "OK", undefined, {
    duration: 7000,
    sound: "notification",
  });
}

const existingPartyId = checkIfInParty();

function getJoinDebugMeta(extra = {}) {
  return {
    href: window.location.href,
    origin: window.location.origin,
    host: window.location.host,
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    existingPartyId: existingPartyId || null,
    hasUserData: !!userData,
    ...extra,
  };
}

// Fetch user status upfront
const statusPromise = fetch("/status", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin",
})
  .then((res) => {
    console.log(
      "[join-debug] /status response",
      getJoinDebugMeta({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
      }),
    );
    return res.json();
  })
  .then((data) => {
    console.log(
      "[join-debug] /status payload",
      getJoinDebugMeta({
        userId: data?.userData?.user_id ?? null,
        username: data?.userData?.name ?? null,
        guest: data?.guest ?? null,
        partyId: data?.party_id ?? null,
        liveMatchId: data?.live_match_id ?? null,
        isAdmin: data?.isAdmin ?? null,
      }),
    );
    if (data?.banned) {
      window.location.href = "/banned";
      return;
    }

    if (data?.suspension) {
      window.__BRO_BATTLES_SUSPENSION__ = {
        ...(window.__BRO_BATTLES_SUSPENSION__ || {}),
        ...data.suspension,
      };
      showSuspensionPopupFromStatus(data);
    }

    if (data?.userData) {
      userData = data.userData;
      userData.isAdmin = !!data.isAdmin;
      window.__BRO_BATTLES_USERDATA__ = userData;
      guest = data.guest;

      // Check for live match first
      if (checkForLiveMatch(data)) {
        return; // Stop processing if redirecting to live match
      }

      if (data.party_id && !existingPartyId) {
        // If user is in a party but not at the url, send them to it
        console.log("User is in party:", data.party_id);
        window.location.href = `/party/${data.party_id}`;
      }
    }
  })
  .catch((err) =>
    console.error(
      "[join-debug] Error fetching /status",
      getJoinDebugMeta({
        message: err?.message || String(err),
      }),
    ),
  );

// Wait for status before trying to bootstrap party data
if (existingPartyId) {
  statusPromise.then(() => {
    if (userData) {
      bootstrapPartyData(existingPartyId);
    }
  });
}

async function bootstrapPartyData(partyId) {
  console.log(
    "[join-debug] bootstrapPartyData starting",
    getJoinDebugMeta({
      partyId,
      userId: userData?.user_id ?? null,
      username: userData?.name ?? null,
      cookieEnabled: navigator.cookieEnabled,
    }),
  );
  try {
    const resp = await fetch("/partydata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partyId }),
    });

    console.log(
      "[join-debug] /partydata response",
      getJoinDebugMeta({
        partyId,
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
      }),
    );

    if (!resp.ok) {
      let errorData = null;
      try {
        errorData = await resp.json();
      } catch (_) {}

      if (resp.status === 403 && errorData?.requestRequired) {
        if (typeof showPartyJoinRequestScreen === "function") {
          showPartyJoinRequestScreen(errorData);
        }
        return;
      }

      if (resp.status === 409) {
        // Party might be full, try to get JSON response
        try {
          const fullErrorData =
            errorData || (await resp.json().catch(() => null));
          if (fullErrorData?.redirect) {
            window.location.href = fullErrorData.redirect;
            return;
          }
        } catch (e) {
          // If JSON parsing fails, fall back to generic error
        }
      }
      throw new Error(errorData?.error || "Failed to fetch party data");
    }

    const data = await resp.json();
    console.log(
      "[join-debug] /partydata payload",
      getJoinDebugMeta({
        partyId,
        responsePartyId: data?.party?.party_id ?? data?.party?.partyId ?? null,
        ownerName: data?.ownerName ?? null,
        membersCount: Array.isArray(data?.members) ? data.members.length : 0,
        selection: data?.selection || null,
        viewer: data?.viewer ?? null,
      }),
    );
    if (data?.party) {
      const selection = applyLobbySelection(
        data?.selection || {
          modeId: data?.party?.mode_id || data?.party?.modeId || "duels",
          modeVariantId:
            data?.party?.mode_variant_id || data?.party?.modeVariantId || null,
          mapId: data?.party?.map ?? null,
        },
        { persist: false },
      );
      try {
        localStorage.setItem(
          "bb_solo_mode",
          String(document.getElementById("mode")?.value || "1"),
        );
        localStorage.setItem("bb_solo_mode_id", selection.modeId);
        localStorage.setItem(
          "bb_solo_mode_variant_id",
          selection.modeVariantId || "",
        );
        if (selection.mapId != null) {
          localStorage.setItem("bb_solo_map", String(selection.mapId));
        }
      } catch (_) {}
      if (selection.mapId != null) {
        setLobbyBackground(String(selection.mapId));
      }
    }
    // Immediately render roster so UI isn't empty before socket pushes
    if (data?.members)
      renderPartyMembers({
        partyId,
        members: data.members,
        selection: data?.selection || null,
        mode: data?.party?.mode,
        map: data?.selection?.mapId ?? data?.party?.map,
        ownerName: data?.ownerName || null,
      });
    syncPartySettingsButtonVisibility();
    sonner("Joined party", undefined, undefined, undefined, {
      duration: 1500,
      sound: "notification",
    });
  } catch (error) {
    console.error(
      "[join-debug] bootstrapPartyData failed",
      getJoinDebugMeta({
        partyId,
        message: error?.message || String(error),
        stack: error?.stack || null,
      }),
    );
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await statusPromise;
  if (!userData) return;

  // Initialize UI sounds
  initUISounds();

  signUpOut(guest);

  const characterBodyElement = document.getElementById("sprite");
  const characterSelect = document.getElementById("your-slot-1");
  const createPartyButton = document.getElementById("create-party");
  const searchPartiesButton = document.getElementById("search-parties");
  const partySettingsButton = document.getElementById("party-settings-button");
  const inviteStatus = document.querySelectorAll(".invite");

  const coinCount = document.getElementById("coin-count");
  const gemCount = document.getElementById("gem-count");
  const trophyCount = document.getElementById("trophy-count");
  const usernameButton = document.getElementById("username-button");
  const trophyResourceButton = document.getElementById(
    "trophy-resource-button",
  );
  const leaderboardButton = document.getElementById("leaderboard-button");

  document.getElementById("username-text").textContent = userData.name;
  const profilePopup = initProfilePopup();
  __lobbyProfilePopup = profilePopup;
  if (usernameButton) {
    usernameButton.addEventListener("click", () => {
      if (profilePopup?.open) {
        profilePopup.open();
      }
    });
  }
  setLobbyBackground("1");
  characterBodyElement.src = `/assets/${userData.char_class}/body.webp`;
  // Ensure non-random styling on initial sprite
  try {
    characterBodyElement.classList.remove("random");
  } catch {}
  coinCount.textContent = userData.coins;
  gemCount.textContent = userData.gems;
  trophyCount.textContent = userData.trophies || 0;
  animatePostMatchRewardsIfPresent(
    coinCount,
    gemCount,
    trophyCount,
    Number(userData.coins) || 0,
    Number(userData.gems) || 0,
    Number(userData.trophies) || 0,
  );

  trophyResourceButton?.addEventListener("click", async () => {
    playSound("cursor4", 0.4);
    try {
      await openTrophyProgressionOverlay();
    } catch (error) {
      sonner(
        "Could not load rewards",
        error?.message || "Please try again.",
        "error",
      );
      closeOverlay("trophy-track-overlay");
    }
  });

  leaderboardButton?.addEventListener("click", async () => {
    playSound("cursor4", 0.4);
    try {
      await openLeaderboardOverlay(profilePopup);
    } catch (error) {
      sonner(
        "Could not load leaderboard",
        error?.message || "Please try again.",
        "error",
      );
      closeOverlay("leaderboard-overlay");
    }
  });

  document
    .getElementById("trophy-track-close")
    ?.addEventListener("click", () => closeOverlay("trophy-track-overlay"));
  document
    .querySelector("#trophy-track-overlay .trophy-overlay-backdrop")
    ?.addEventListener("click", () => closeOverlay("trophy-track-overlay"));
  document
    .getElementById("leaderboard-close")
    ?.addEventListener("click", () => closeOverlay("leaderboard-overlay"));
  document
    .querySelector("#leaderboard-overlay .trophy-overlay-backdrop")
    ?.addEventListener("click", () => closeOverlay("leaderboard-overlay"));

  refreshTrophyClaimAvailability();
  wirePartyOverlayControls();

  searchPartiesButton?.addEventListener("click", () => {
    playSound("cursor4", 0.4);
    void openPartyDiscoveryOverlay();
  });
  partySettingsButton?.addEventListener("click", () => {
    playSound("cursor4", 0.4);
    void openPartySettingsOverlay();
  });

  // Initialize character select UI
  initializeCharacterSelect(userData);

  // Delegated click: open selector only for the current user's slot
  const lobby = document.getElementById("lobby-area");
  if (lobby) {
    lobby.addEventListener("click", (e) => {
      const slot = e.target.closest && e.target.closest(".character-slot");
      if (!slot) return;
      if (slot.dataset.isCurrentUser === "true") {
        playSound("cursor5", 0.4);
        openCharacterSelect();
        return;
      }
      const playerName = String(slot.dataset.playerName || "").trim();
      if (!playerName || playerName.toLowerCase().startsWith("random")) return;
      const inParty = !!checkIfInParty();
      if (inParty) {
        e.preventDefault();
        e.stopPropagation();
        playSound("cursor4", 0.35);
        openPartySlotMenu(slot, e, profilePopup);
        return;
      }
      playSound("cursor4", 0.35);
      profilePopup?.open?.({ username: playerName });
    });
  }

  // Hide any pre-existing switch controls; party.js will show it on your slot
  document.querySelectorAll(".switch-character").forEach((el) => {
    el.style.display = "none";
  });

  initializeModeDropdown(); // Initialize mode dropdown functionality for both party and lobby

  // Initialize socket events for both party and solo flows once DOM is ready

  if (existingPartyId) {
    createPartyButton.textContent = "Leave Party";
    createPartyButton.style.background =
      "linear-gradient(135deg, #d63939, #cf4545)";
    createPartyButton.addEventListener("click", leaveParty);
    createPartyButton.setAttribute("data-sound", "cancel2");

    // Ensure current Invite badges are visible and clickable in party
    inviteStatus.forEach((status) => {
      if (status.textContent.trim() === "Invite") {
        status.style.display = "";
        status.style.cursor = "pointer";
        // Use current page URL as invite link
        status.dataset.inviteLink = window.location.href;
      }
    });

    // Delegated click handler so dynamically-updated Invite buttons work
    const lobby = document.getElementById("lobby-area");
    if (lobby) {
      lobby.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest && e.target.closest(".invite");
        if (!btn) return;
        // Only act when in a party
        if (!existingPartyId) return;
        const link = btn.dataset.inviteLink || window.location.href;
        navigator.clipboard.writeText(link);
        sonner(
          "Invite link copied to clipboard",
          "Share this with your friends to invite them to the party",
          undefined,
          undefined,
          { duration: 2000 },
        );
      });
    }
    // Bind Ready button in party flow
    try {
      initReadyToggle();
    } catch {}

    try {
      await loadPartySettings();
    } catch (_) {}
    syncPartySettingsButtonVisibility();
  } else {
    createPartyButton.addEventListener("click", createParty);

    // Not in a party: hide Invite badges entirely
    inviteStatus.forEach((status) => {
      status.style.display = "none";
      status.style.cursor = "default";
    });

    // Not in a party: ensure your-slot-1 is marked as current user and switch visible
    const yourSlot = document.getElementById("your-slot-1");
    if (yourSlot) {
      yourSlot.dataset.isCurrentUser = "true";
      const switchEl = yourSlot.querySelector(".switch-character");
      if (switchEl) switchEl.style.display = "";
      // Show username instead of "Random" and mark active visuals
      const nameEl = yourSlot.querySelector(".username");
      if (nameEl) nameEl.textContent = userData.name;
      const spriteEl = yourSlot.querySelector(".character-sprite");
      if (spriteEl) spriteEl.classList.remove("random");
      yourSlot.className = "character-slot player-display";
      yourSlot.dataset.character = userData.char_class || "ninja";
      const levelBadge = yourSlot.querySelector(".slot-level-badge");
      const charLevels =
        typeof userData.char_levels === "object" && userData.char_levels
          ? userData.char_levels
          : {};
      const level = Math.max(1, Number(charLevels?.[userData.char_class]) || 1);
      if (levelBadge) setSlotLevelBadge(yourSlot, level);
    }
    // Bind Ready button in solo flow
    try {
      initReadyToggle();
    } catch {}
    syncPartySettingsButtonVisibility();
  }

  socket.off("party:members", syncPartySettingsButtonVisibility);
  socket.on("party:members", syncPartySettingsButtonVisibility);
});

document.addEventListener("DOMContentLoaded", async () => {
  await statusPromise; // ensures guest user created + cookies set
  // NEW: connect socket now, deterministically after cookies are present
  try {
    const connectStarted = ensureSocketConnected();
    console.log(
      "[join-debug] socket connect requested after status",
      getJoinDebugMeta({
        connectStarted,
      }),
    );
    if (connectStarted) await waitForConnect();
  } catch (error) {
    console.error(
      "[join-debug] socket connection bootstrap failed",
      getJoinDebugMeta({
        message: error?.message || String(error),
      }),
    );
  }
  if (!userData) return;

  socketInit({ profilePopup: __lobbyProfilePopup }); // this can assume socket is connected or connecting with cookies
});

function signUpOut(guest) {
  const signOut = document.getElementById("sign-out");
  const login = document.getElementById("login");
  if (guest) {
    signOut.addEventListener("click", () => (window.location.href = "/signup"));
    login.addEventListener("click", () => (window.location.href = "/login"));
  } else {
    signOut.textContent = "Sign Out";
    signOut.style.background = "linear-gradient(135deg, #d63939, #cf4545)";
    signOut.addEventListener("click", () => {
      window.location.href = "/signed-out";
    });
    login.style.display = "none";
  }
}

export function setLobbyBackground(mapValue) {
  const nextUrl = getLobbyBgAsset(mapValue);
  const current = document.body.style.backgroundImage || "";
  const target = `url("${nextUrl}")`;
  if (current === target) return;

  let overlay = document.getElementById("lobby-bg-fade");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "lobby-bg-fade";
    document.body.appendChild(overlay);
  }

  overlay.style.backgroundImage = target;
  overlay.classList.add("active");

  setTimeout(() => {
    document.body.style.backgroundImage = target;
    overlay.classList.remove("active");
  }, 240);
}
