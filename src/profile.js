import "./styles/profile.css";
import "./styles/selectionPopup.css";
import { sonner } from "./lib/sonner.js";
import { wireFullscreenToggles } from "./lib/fullscreen.js";
import {
  renderAccountAccess,
  wireAccountSettings,
} from "./lib/accountSettings.js";
import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "./lib/profileIconAssets.js";
import { renderBattleLog } from "./lib/battleLogView.js";

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
    throw new Error(data?.error || "Request failed");
  }
  return data;
}

function renderProfile(profile) {
  renderAccountAccess(
    document.querySelector(".account"),
    profile.guest === true,
  );
  document.getElementById("profile-username").textContent = profile.username;
  document.getElementById("profile-coins").textContent = String(
    profile.coins || 0,
  );
  document.getElementById("profile-gems").textContent = String(
    profile.gems || 0,
  );
  document.getElementById("profile-trophies").textContent = String(
    profile.trophies || 0,
  );
  document.getElementById("profile-matches").textContent = String(
    profile.totalMatches || 0,
  );
  document.getElementById("profile-avg-level").textContent = String(
    profile.avgCharLevel || 1,
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
}

function renderCardsGrid() {
  const grid = document.getElementById("cards-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const owned = new Set(
    (profileData?.ownedCardIds || []).map((x) => String(x)),
  );
  const selected = String(profileData?.selectedCardId || "");

  const ownedCards = (cardsCatalog?.cards || []).filter((card) =>
    owned.has(String(card?.id || "")),
  );
  if (!ownedCards.length) {
    grid.innerHTML = "<p>No player cards owned yet. Find them in the Shop.</p>";
    return;
  }

  ownedCards.forEach((card) => {
    const id = String(card.id);
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const rarity = String(card?.rarity || "common").toLowerCase();

    const tile = document.createElement("div");
    tile.className = `card-tile ${rarity}`;
    tile.innerHTML = `
      <img src="${card.assetUrl}" alt="${card.name}" />
      <div class="card-meta">
        <strong>${card.name}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
      </div>
      <div class="card-actions">
        <span>${isSelected ? "Equipped" : "Owned"}</span>
        <button class="profile-btn" data-card-id="${id}">
          ${isSelected ? "Selected" : "Equip"}
        </button>
      </div>
    `;

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
          renderProfile(profileData);
          renderCardsGrid();
        } catch (err) {
          const msg = String(err?.message || "Card action failed.");
          sonner("Card action failed", msg, "error");
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
    const rarity = String(icon?.rarity || "common").toLowerCase();
    const unlock = icon?.unlock || {};
    const requirement =
      unlock.type === "trophies"
        ? `Reach ${Number(unlock.min) || 0} trophies`
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
      <img src="${icon.assetUrl}" alt="${icon.name}" />
      <div class="card-meta">
        <strong>${icon.name}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
        ${!isOwned ? `<span class="profile-cost">${requirement}</span>` : ""}
      </div>
      <div class="card-actions">
        <span>${isSelected ? "Equipped" : isOwned ? "Owned" : isLimited ? "Limited" : "Locked"}</span>
        <button class="profile-btn" data-icon-id="${id}" data-action="${action}">
          ${actionLabel}
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
          const msg = String(error?.message || "Profile icon action failed.");
          sonner("Profile icon action failed", msg, "error");
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

    renderProfile(profileData);
    renderCardsGrid();
    renderIconsGrid();

    document.getElementById("new-username").value = profileData.username || "";

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
      .getElementById("username-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (profileData?.guest !== false) return;
        const username = String(
          document.getElementById("new-username")?.value || "",
        ).trim();
        if (!username) return;
        try {
          const data = await fetchJson("/profile/change-username", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username }),
          });
          profileData.username = data.username || username;
          renderProfile(profileData);
          setMessage("Username updated.");
          accountSettings.close("username-form");
        } catch (err) {
          setMessage(err.message || "Unable to update username.", true);
        }
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
