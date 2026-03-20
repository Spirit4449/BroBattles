import "./styles/profile.css";
import "./styles/selectionPopup.css";
import { showUiConfirm } from "./lib/uiConfirm.js";
import { sonner } from "./lib/sonner.js";

let profileData = null;
let cardsCatalog = null;

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
          sonner(
            btn.dataset.action === "buy" ? "Card purchased" : "Card equipped",
            undefined,
            "success",
          );
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

async function boot() {
  try {
    const [profileRes, catalogRes, ownedRes] = await Promise.all([
      fetchJson("/profile/data"),
      fetchJson("/player-cards/catalog"),
      fetchJson("/player-cards/owned"),
    ]);

    cardsCatalog = catalogRes.catalog || { cards: [] };
    profileData = {
      ...(profileRes.profile || {}),
      ownedCardIds:
        ownedRes.ownedCardIds || profileRes.profile?.ownedCardIds || [],
      selectedCardId:
        ownedRes.selectedCardId || profileRes.profile?.selectedCardId || null,
    };

    renderProfile(profileData);
    renderCardsGrid();

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
