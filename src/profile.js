import "./styles/profile.css";
import "./styles/selectionPopup.css";
import { showUiConfirm } from "./lib/uiConfirm.js";
import { sonner } from "./lib/sonner.js";
import { wireFullscreenToggles } from "./lib/fullscreen.js";
import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "./lib/profileIconAssets.js";

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
}

function renderCardsGrid() {
  const grid = document.getElementById("cards-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const owned = new Set(
    (profileData?.ownedCardIds || []).map((x) => String(x)),
  );
  const selected = String(profileData?.selectedCardId || "");

  (cardsCatalog?.cards || []).forEach((card) => {
    const id = String(card.id);
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const rarity = String(card?.rarity || "common").toLowerCase();
    const coinCost = Math.max(0, Number(card?.cost?.coins || 0));
    const gemCost = Math.max(0, Number(card?.cost?.gems || 0));
    const useGems = gemCost > 0;
    const price = useGems ? gemCost : coinCost;
    const currencyIcon = useGems ? "/assets/gem.webp" : "/assets/coin.webp";
    const currencyLabel = useGems ? "gems" : "coins";

    const tile = document.createElement("div");
    tile.className = `card-tile ${rarity}`;
    tile.innerHTML = `
      <img src="${card.assetUrl}" alt="${card.name}" />
      <div class="card-meta">
        <strong>${card.name}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
        <span class="profile-cost"><img src="${currencyIcon}" alt="${currencyLabel}" /> ${price}</span>
      </div>
      <div class="card-actions">
        <span>${isSelected ? "Equipped" : isOwned ? "Owned" : "Locked"}</span>
        <button class="profile-btn" data-card-id="${id}" data-action="${isOwned ? "equip" : "buy"}">
          ${isOwned ? (isSelected ? "Selected" : "Equip") : "Buy"}
        </button>
      </div>
    `;

    const btn = tile.querySelector("button[data-card-id]");
    if (btn) {
      if (isSelected) btn.disabled = true;
      btn.addEventListener("click", async () => {
        try {
          if (btn.dataset.action === "buy") {
            const ok = await showUiConfirm({
              title: "Confirm Purchase",
              message: `Buy ${card.name} for ${price} ${currencyLabel}?`,
              confirmLabel: `${price}`,
              confirmIcon: currencyIcon,
            });
            if (!ok) return;
          }
          if (btn.dataset.action === "buy") {
            await fetchJson("/player-cards/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId: id }),
            });
          }
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
          if (btn.dataset.action === "buy") {
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
    return icon?.showInPicker !== false || owned.has(iconId);
  });

  visibleIcons.forEach((icon) => {
    const id = String(icon?.id || "");
    const isOwned = owned.has(id);
    const isSelected = isOwned && selected === id;
    const isLimited = icon?.limited === true;
    const rarity = String(icon?.rarity || "common").toLowerCase();
    const gemCost = Math.max(0, Number(icon?.cost?.gems || 0));

    let action = "";
    let actionLabel = "";
    if (isOwned) {
      action = "equip";
      actionLabel = isSelected ? "Selected" : "Equip";
    } else if (!isLimited) {
      action = "buy";
      actionLabel = gemCost > 0 ? "Buy" : "Unlock";
    } else {
      action = "locked";
      actionLabel = "Limited";
    }

    const tile = document.createElement("div");
    tile.className = `card-tile icon-tile ${rarity}`;
    tile.innerHTML = `
      <img src="${icon.assetUrl}" alt="${icon.name}" />
      <div class="card-meta">
        <strong>${icon.name}</strong>
        <span class="profile-card-rarity ${rarity}">${rarity}</span>
        <span class="profile-cost"><img src="/assets/gem.webp" alt="gems" /> ${gemCost}</span>
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
          if (currentAction === "buy") {
            const ok = await showUiConfirm({
              title: "Confirm Purchase",
              message:
                gemCost > 0
                  ? `Buy ${icon.name} for ${gemCost} gems?`
                  : `Unlock ${icon.name}?`,
              confirmLabel: `${gemCost}`,
              confirmIcon: "/assets/gem.webp",
            });
            if (!ok) return;
            await fetchJson("/profile-icons/buy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ iconId: id }),
            });
          }

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
          if (currentAction === "buy") {
            sonner("Profile icon purchased", undefined, "success");
          }
        } catch (error) {
          const msg = String(error?.message || "Profile icon action failed.");
          sonner(
            msg.includes("Not enough")
              ? "Not enough gems"
              : "Profile icon action failed",
            msg,
            "error",
          );
        }
      });
    }

    grid.appendChild(tile);
  });
}

async function boot() {
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
        } catch (err) {
          setMessage(err.message || "Unable to update username.", true);
        }
      });

    document
      .getElementById("password-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
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
        } catch (err) {
          setMessage(err.message || "Unable to change password.", true);
        }
      });
  } catch (error) {
    setMessage(error.message || "Failed to load profile.", true);
  }
}

document.addEventListener("DOMContentLoaded", boot);
