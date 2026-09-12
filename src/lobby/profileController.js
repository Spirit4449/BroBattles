import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "../lib/profileIconAssets.js";
import {
  renderAccountAccess,
  wireAccountSettings,
} from "../lib/accountSettings.js";
import { renderBattleLog } from "../lib/battleLogView.js";
import { renderCharacterLevelGrid } from "../lib/profileCharacterLevelsView.js";
import { sonner } from "../lib/sonner.js";
import { playSound } from "../lib/uiSounds.js";
import { escapeHtml, profileFetchJson } from './ui';

export function createProfileController({ getUserData }) {
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

  function setProfilePopupMessage(text, isError = false) {
    const msg = document.getElementById("profile-message");
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.color = isError ? "#ff9aa9" : "#bfe2ff";
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
      avatarTrigger.setAttribute(
        "aria-label",
        lobbyProfileState.viewingSelf ? "Change profile icon" : "Profile icon",
      );
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
      renderAccountAccess(accountPanel, profile.guest === true);
    }
    const characterLevelsPanel = document.getElementById(
      "profile-character-levels-panel",
    );
    if (characterLevelsPanel) {
      characterLevelsPanel.classList.remove("is-hidden");
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

    const battleLogContainer = document.getElementById(
      "profile-popup-battle-log",
    );
    if (battleLogContainer) {
      renderBattleLog(battleLogContainer, profile.battles || [], {
        currentUserId: profile.userId,
        viewingSelf: lobbyProfileState.viewingSelf,
      });
    }

    renderProfileCharacterLevels();
  }

  function renderProfileCharacterLevels() {
    const panel = document.getElementById("profile-character-levels-panel");
    const grid = document.getElementById("profile-character-levels-grid");
    const profile = lobbyProfileState.profile || {};
    if (!panel || !grid) return;
    panel.classList.remove("is-hidden");
    renderCharacterLevelGrid(grid, profile.charLevels);
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

    const ownedCards = catalogCards.filter((card) =>
      owned.has(String(card?.id || "")),
    );

    if (!ownedCards.length) {
      grid.innerHTML =
        '<p class="profile-loadout-empty">No player cards owned yet. Find them in the Shop.</p>';
      return;
    }

    ownedCards.forEach((card) => {
      const id = String(card?.id || "");
      const isSelected = selected === id;
      const rarity = String(card?.rarity || "common").toLowerCase();

      const tile = document.createElement("article");
      tile.className = `profile-card-tile ${rarity}${isSelected ? " is-selected" : ""}`;
      tile.innerHTML = `
      <img src="${card.assetUrl}" alt="${card.name}" />
      <div class="profile-card-meta">
        <strong>${card.name}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
      </div>
      <div class="profile-card-actions">
        <span class="profile-card-state">${isSelected ? "Equipped" : "Owned"}</span>
        <button class="profile-card-btn pixel-menu-button" type="button" data-card-id="${id}">
          ${isSelected ? "Selected" : "Equip"}
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

            await profileFetchJson("/player-cards/select", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId }),
            });

            await loadProfilePopupData(true);
          } catch (err) {
            const msg = String(err?.message || "Card action failed.");
            sonner("Card action failed", msg, "error");
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
      return owned.has(iconId) || Boolean(icon?.unlock);
    });

    const sections = {};
    for (const [key, title, description] of [
      ["owned", "Owned", "Choose an icon to make it yours."],
      ["locked", "Locked", "Keep playing to unlock these icons."],
    ]) {
      const count = visibleIcons.filter((icon) =>
        key === "owned"
          ? owned.has(String(icon.id))
          : !owned.has(String(icon.id)),
      ).length;
      const section = document.createElement("section");
      section.className = `profile-icon-group is-${key}`;
      section.setAttribute("aria-labelledby", `profile-icons-${key}-title`);
      section.innerHTML = `
      <div class="profile-icon-group-heading">
        <h3 id="profile-icons-${key}-title">${title} <span>${count}</span></h3>
        <p>${description}</p>
      </div>
      <div class="profile-icon-group-grid"></div>
    `;
      sections[key] = section.querySelector(".profile-icon-group-grid");
      if (!count) {
        const empty = document.createElement("p");
        empty.className = "profile-loadout-empty";
        empty.textContent =
          key === "owned"
            ? "No icons owned yet. Unlock a character to get started."
            : "All progression icons unlocked!";
        sections[key].appendChild(empty);
      }
      grid.appendChild(section);
    }

    visibleIcons.forEach((icon) => {
      const id = String(icon?.id || "");
      const isOwned = owned.has(id);
      const isSelected = isOwned && selected === id;
      const isLocked = !isOwned;
      const unlock = icon?.unlock || {};
      const requirement =
        unlock.type === "trophies"
          ? `Reach ${Number(unlock.min) || 0} trophies`
          : unlock.type === "character"
            ? `Unlock ${String(unlock.character || icon.name).replace(/\b\w/g, (char) => char.toUpperCase())}`
            : "Progression reward";

      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `profile-icon-choice-tile${isSelected ? " is-selected" : ""}${!isOwned ? " is-unowned" : ""}${isLocked ? " is-locked" : ""}`;
      tile.dataset.iconId = id;
      tile.setAttribute("aria-pressed", String(isSelected));
      tile.setAttribute(
        "aria-label",
        `${icon.name}. ${isSelected ? "Selected" : isLocked ? `Locked. ${requirement}` : "Owned. Select icon"}`,
      );
      tile.innerHTML = `
      <span class="profile-icon-art">
        <img src="${escapeHtml(icon.assetUrl)}" alt="" />
        ${isSelected ? '<span class="profile-icon-selected-badge">Selected</span>' : ""}
        ${isLocked ? '<span class="profile-icon-lock-overlay"><img src="/assets/lock.webp" alt="" /></span>' : ""}
      </span>
      <span class="profile-icon-details">
        <strong>${escapeHtml(icon.name)}</strong>
        ${isLocked ? `<span class="profile-icon-requirement">${escapeHtml(requirement)}</span>` : ""}
      </span>
    `;

      if (isLocked) tile.disabled = true;

      tile.addEventListener("click", async () => {
        if (isSelected || isLocked) return;
        try {
          tile.disabled = true;
          const iconId = String(tile.dataset.iconId || "");
          if (!iconId) return;

          await profileFetchJson("/profile-icons/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iconId }),
          });

          await loadProfilePopupData(true);
        } catch (err) {
          const msg = String(err?.message || "Profile icon action failed.");
          sonner("Profile icon action failed", msg, "error");
          tile.disabled = false;
        }
      });

      sections[isOwned ? "owned" : "locked"].appendChild(tile);
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

          if (getUserData()) {
            getUserData().name = profile.username || getUserData().name;
            getUserData().coins = Number(profile.coins ?? getUserData().coins) || 0;
            getUserData().gems = Number(profile.gems ?? getUserData().gems) || 0;
            getUserData().trophies =
              Number(profile.trophies ?? getUserData().trophies) || 0;
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

    const accountSettings = wireAccountSettings(
      document.getElementById("profile-account-panel"),
    );

    const openLoadoutModal = (mode = "icons") => {
      if (!lobbyProfileState.viewingSelf || !loadoutOverlay) return;
      const showIcons = mode === "icons";
      if (loadoutTitle) {
        loadoutTitle.textContent = showIcons
          ? "Edit Profile Icon"
          : "Select Battle Card";
      }
      if (iconsPanel) iconsPanel.classList.toggle("is-hidden", !showIcons);
      if (cardsPanel) cardsPanel.classList.toggle("is-hidden", showIcons);
      loadoutOverlay.dataset.loadoutMode = showIcons ? "icons" : "cards";
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
      accountSettings.close();
      closeLoadoutModal();
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      setProfilePopupMessage("");
    };

    const open = async (options = {}) => {
      accountSettings.close();
      const targetUsername = String(options?.username || "").trim();
      lobbyProfileState.viewingSelf =
        !targetUsername || targetUsername === String(getUserData()?.name || "");
      lobbyProfileState.viewingUsername = lobbyProfileState.viewingSelf
        ? String(getUserData()?.name || "")
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
      if (
        !lobbyProfileState.viewingSelf ||
        lobbyProfileState.profile?.guest !== false
      )
        return;
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
        if (getUserData()) getUserData().name = data.username || username;

        const usernameText = document.getElementById("username-text");
        if (usernameText) usernameText.textContent = data.username || username;

        renderProfilePopupStats();
        setProfilePopupMessage("Username updated.");
        accountSettings.close("profile-username-form");
      } catch (err) {
        setProfilePopupMessage(err.message || "Unable to update username.", true);
      }
    });

    passwordForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (
        !lobbyProfileState.viewingSelf ||
        lobbyProfileState.profile?.guest !== false
      )
        return;
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
        accountSettings.close("profile-password-form");
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
  function updateWallet(wallet) {
    if (lobbyProfileState.profile && lobbyProfileState.viewingSelf) {
      lobbyProfileState.profile.coins = wallet.coins;
      lobbyProfileState.profile.gems = wallet.gems;
    }
  }
  function invalidate() { lobbyProfileState.loadingPromise = null; }

  return { initProfilePopup, updateWallet, invalidate };
}
