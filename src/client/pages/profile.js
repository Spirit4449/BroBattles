import { escapeHtml } from "../../shared/site/html.cjs";
import { createPlayerCardTile, comparePlayerCardsByRarity } from "../views/playerCardTile.js";
import { warmEquippedPlayerCard, disposePlayerCardMediaWithin } from "../views/playerCardAnimation.cjs";
import { wireEmailSettings } from "../account/emailSettings.js";
import "../styles/profile.css";
import "../styles/levelBadge.css";
import "../styles/selectionPopup.css";
import { wireNameChangeDialog } from "../account/nameChangeDialog.js";
import { sonner } from "../ui/sonner.js";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import {
  renderAccountAccess,
  wireAccountSettings,
} from "../account/accountSettings.js";
import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "../views/profileIconAssets.js";
import { renderBattleLog } from "../views/battleLogView.js";
import { renderCharacterLevelGrid } from "../views/profileCharacterLevelsView.js";

wireFullscreenToggles();

let profileData = null;
let cardsCatalog = null;
let iconsCatalog = null;

function setMessage(text, isError = false) {
  const msg = document.getElementById("account-message");
  if (!msg) return;
  msg.textContent = text || "";
  msg.style.color = isError ? "#ff9aa9" : "#bfe2ff";
}

async function fetchJson(url, options) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...(options || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error || "Request failed");
    error.nextNameChangeAt = data?.nextNameChangeAt;
    throw error;
  }
  return data;
}

function renderProfile(profile) {
  renderAccountAccess(
    document.querySelector(".account"),
    profile.guest === true,
  );
  document.getElementById("profile-username").textContent = profile.username;
  document.getElementById("profile-trophies").textContent = String(
    profile.trophies || 0,
  );
  document.getElementById("profile-matches").textContent = String(
    profile.totalMatches || 0,
  );
  const profileIconPreview = document.getElementById("profile-icon-preview");
  if (profileIconPreview) {
    profileIconPreview.src = buildProfileIconUrl(
      profile.selectedProfileIconId || profile.profileIconId,
      profile.charClass,
    );
    profileIconPreview.alt = buildProfileIconAlt(
      profile.selectedProfileIconId || profile.profileIconId,
      profile.charClass,
    );
  }

  const battleLogContainer = document.getElementById("battle-log-container");
  if (battleLogContainer) {
    renderBattleLog(battleLogContainer, profile.battles || [], {
      currentUserId: profile.userId,
      viewingSelf: true,
    });
  }

  renderCharacterLevelGrid(
    document.getElementById("profile-character-levels-grid"),
    profile.charLevels,
  );
}

function renderCardsGrid() {
  const grid = document.getElementById("cards-grid");
  if (!grid) return;
  disposePlayerCardMediaWithin(grid);
  grid.innerHTML = "";

  const owned = new Set(
    (profileData?.ownedCardIds || []).map((x) => String(x)),
  );
  const selected = String(profileData?.selectedCardId || "");

  const ownedCards = (cardsCatalog?.cards || []).filter((card) =>
    owned.has(String(card?.id || "")),
  ).sort(comparePlayerCardsByRarity);
  if (!ownedCards.length) {
    grid.innerHTML = "<p>No player cards owned yet. Find them in the Shop.</p>";
    return;
  }

  ownedCards.forEach((card) => {
    const id = String(card.id);
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const tile = createPlayerCardTile(card, { selected: isSelected, lobby: false });

    const btn = tile.querySelector("button[data-card-id]");
    if (btn) {
      if (isSelected) btn.disabled = true;
      btn.addEventListener("click", async () => {
        try {
          await fetchJson("/player-cards/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId: id }),
          });

          const [profileRes, ownedRes] = await Promise.all([
            fetchJson("/profile/data"),
            fetchJson("/player-cards/owned"),
          ]);
          profileData = {
            ...profileRes.profile,
            ownedCardIds:
              ownedRes.ownedCardIds || profileRes.profile.ownedCardIds || [],
            selectedCardId:
              ownedRes.selectedCardId || profileRes.profile.selectedCardId,
          };
          warmEquippedPlayerCard(profileData.selectedCardId);
          renderProfile(profileData);
          renderCardsGrid();
        } catch (err) {
          const msg = String(err?.message || "Please try again.");
          sonner("Could not equip player card", msg, "error");
        }
      });
    }

    grid.appendChild(tile);
  });
}

function renderIconsGrid() {
  const grid = document.getElementById("icons-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const owned = new Set(
    (profileData?.ownedProfileIconIds || []).map((x) => String(x)),
  );
  const selected = String(
    profileData?.selectedProfileIconId || profileData?.profileIconId || "",
  );
  const icons = Array.isArray(iconsCatalog?.icons) ? iconsCatalog.icons : [];
  const visibleIcons = icons.filter((icon) => {
    const iconId = String(icon?.id || "");
    return owned.has(iconId) || Boolean(icon?.unlock);
  });

  visibleIcons.forEach((icon) => {
    const id = String(icon?.id || "");
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const isLimited = icon?.limited === true;
    const rarity = String(icon?.rarity || "common").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const unlock = icon?.unlock || {};
    const requirement =
      ["trophies", "trophyRoad"].includes(unlock.type)
        ? `Claim at ${(Number(unlock.min) || 0).toLocaleString()} trophies`
        : unlock.type === "character"
          ? `Unlock ${String(unlock.character || icon.name)}`
          : "Progression reward";
    const action = isOwned ? "equip" : "locked";
    const actionLabel = isOwned
      ? isSelected
        ? "Selected"
        : "Equip"
      : requirement;

    const tile = document.createElement("div");
    tile.className = `card-tile icon-tile ${rarity}`;
    tile.innerHTML = `
      <img src="${escapeHtml(buildProfileIconUrl(icon.id))}" alt="${escapeHtml(icon.name)}" />
      <div class="card-meta">
        <strong>${escapeHtml(icon.name)}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
        ${!isOwned ? `<span class="profile-cost">${escapeHtml(requirement)}</span>` : ""}
      </div>
      <div class="card-actions">
        <span>${isSelected ? "Equipped" : isOwned ? "Owned" : isLimited ? "Limited" : "Locked"}</span>
        <button class="profile-btn" type="button" data-icon-id="${escapeHtml(id)}" data-action="${action}">
          ${escapeHtml(actionLabel)}
        </button>
      </div>
    `;

    const btn = tile.querySelector("button[data-icon-id]");
    if (btn) {
      if (action === "locked" || isSelected) btn.disabled = true;
      btn.addEventListener("click", async () => {
        const currentAction = btn.dataset.action;
        if (!currentAction || currentAction === "locked") return;
        try {
          await fetchJson("/profile-icons/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iconId: id }),
          });

          const [profileRes, iconOwnedRes] = await Promise.all([
            fetchJson("/profile/data"),
            fetchJson("/profile-icons/owned"),
          ]);

          profileData = {
            ...profileRes.profile,
            selectedProfileIconId:
              iconOwnedRes.selectedProfileIconId ||
              profileRes.profile?.selectedProfileIconId ||
              profileRes.profile?.profileIconId ||
              null,
            ownedProfileIconIds:
              iconOwnedRes.ownedIconIds ||
              profileRes.profile?.ownedProfileIconIds ||
              [],
          };
          renderProfile(profileData);
          renderIconsGrid();
        } catch (error) {
          const msg = String(error?.message || "Please try again.");
          sonner("Could not equip profile icon", msg, "error");
        }
      });
    }

    grid.appendChild(tile);
  });
}

async function boot() {
  const accountSettings = wireAccountSettings(
    document.querySelector(".account"),
  );
  try {
    const [profileRes, catalogRes, ownedRes, iconsCatalogRes, iconsOwnedRes] =
      await Promise.all([
        fetchJson("/profile/data"),
        fetchJson("/player-cards/catalog"),
        fetchJson("/player-cards/owned"),
        fetchJson("/profile-icons/catalog"),
        fetchJson("/profile-icons/owned"),
      ]);

    cardsCatalog = catalogRes.catalog || { cards: [] };
    iconsCatalog = iconsCatalogRes.catalog || { icons: [] };
    profileData = {
      ...(profileRes.profile || {}),
      ownedCardIds:
        ownedRes.ownedCardIds || profileRes.profile?.ownedCardIds || [],
      selectedCardId:
        ownedRes.selectedCardId || profileRes.profile?.selectedCardId || null,
      selectedProfileIconId:
        iconsOwnedRes.selectedProfileIconId ||
        profileRes.profile?.selectedProfileIconId ||
        profileRes.profile?.profileIconId ||
        null,
      ownedProfileIconIds:
        iconsOwnedRes.ownedIconIds ||
        profileRes.profile?.ownedProfileIconIds ||
        [],
    };

    warmEquippedPlayerCard(profileData.selectedCardId);
    renderProfile(profileData);
    wireEmailSettings(fetchJson, profileData);
    renderCardsGrid();
    renderIconsGrid();

    wireNameChangeDialog(document.getElementById("change-name-btn"), {
      getProfile: () => profileData,
      fetchJson,
      beforeOpen: () => accountSettings.close(),
      onChanged: () => {
        renderProfile(profileData);
        setMessage("Username updated.");
      },
    });

    document.getElementById("back-btn")?.addEventListener("click", () => {
      window.location.href = "/";
    });

    document
      .querySelectorAll("#browse-shop-btn, .browse-shop-link")
      .forEach((button) => {
        button.addEventListener("click", () => {
          window.location.href = "/?shop=profile";
        });
      });

    document
      .getElementById("change-card-btn")
      ?.addEventListener("click", () => {
        document.getElementById("cards-modal")?.classList.remove("hidden");
      });
    document
      .getElementById("close-cards-modal")
      ?.addEventListener("click", () => {
        document.getElementById("cards-modal")?.classList.add("hidden");
      });
    document
      .getElementById("change-icon-btn")
      ?.addEventListener("click", () => {
        document.getElementById("icons-modal")?.classList.remove("hidden");
      });
    document
      .getElementById("close-icons-modal")
      ?.addEventListener("click", () => {
        document.getElementById("icons-modal")?.classList.add("hidden");
      });

    document
      .getElementById("password-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (profileData?.guest !== false) return;
        const currentPassword = String(
          document.getElementById("current-password")?.value || "",
        );
        const newPassword = String(
          document.getElementById("new-password")?.value || "",
        );
        try {
          await fetchJson("/profile/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword }),
          });
          document.getElementById("current-password").value = "";
          document.getElementById("new-password").value = "";
          setMessage("Password changed.");
          accountSettings.close("password-form");
        } catch (err) {
          setMessage(err.message || "Unable to change password.", true);
        }
      });
  } catch (error) {
    setMessage(error.message || "Failed to load profile.", true);
  }
}

document.addEventListener("DOMContentLoaded", boot);
