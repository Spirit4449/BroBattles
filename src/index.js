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
} from "./party.js";
import { ensureSocketConnected, waitForConnect } from "./socket.js";
import {
  initializeCharacterSelect,
  openCharacterSelect,
} from "./characterLogic.js";
import { getLobbyBgAsset } from "./maps/manifest";
import { initUISounds, playSound } from "./lib/uiSounds.js";
import { showUiConfirm } from "./lib/uiConfirm.js";
import "./styles/characterSelect.css";
import "./styles/index.css";
import "./styles/profile.css";
import "./styles/selectionPopup.css";
import "./styles/sonner.css";

let userData = null;
let guest = false;
const POST_MATCH_REWARD_STORAGE_KEY = "bb_post_match_rewards_v1";
const lobbyProfileState = {
  profile: null,
  catalog: null,
  ownedCardIds: [],
  selectedCardId: null,
  loadingPromise: null,
  viewingSelf: true,
  viewingUsername: null,
};

let partySlotMenu = null;

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
      <button type="button" class="profile-slot-menu-btn view pixel-menu-button" data-action="view">View Profile</button>
      <button type="button" class="profile-slot-menu-btn owner pixel-menu-button" data-action="owner">Make Owner</button>
      <button type="button" class="profile-slot-menu-btn kick pixel-menu-button" data-action="kick">Kick</button>
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

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? "");
  };

  setText("profile-username", profile.username || "-");
  setText("profile-coins", Number(profile.coins) || 0);
  setText("profile-gems", Number(profile.gems) || 0);
  setText("profile-trophies", Number(profile.trophies) || 0);
  setText("profile-stats-trophies", Number(profile.trophies) || 0);
  setText("profile-matches", Number(profile.totalMatches) || 0);
  setText("profile-avg-level", Number(profile.avgCharLevel) || 1);
  setText("profile-wins", Number(profile.wins) || 0);
  setText("profile-stats-wins", Number(profile.wins) || 0);
  setText("profile-main-class", String(profile.charClass || "ninja"));
  setText("profile-hero-name", profile.username || "-");
  setText("profile-hero-class", String(profile.charClass || "ninja"));
  setText(
    "profile-hero-tag",
    lobbyProfileState.viewingSelf ? "Your Player Profile" : "Public Player Profile",
  );
  const heroAvatar = document.getElementById("profile-hero-avatar");
  if (heroAvatar) {
    const cls = String(profile.charClass || "ninja");
    heroAvatar.src = `/assets/${cls}/body.webp`;
    heroAvatar.alt = cls;
  }
  const subtitle = document.getElementById("profile-popup-subtitle");
  if (subtitle) {
    subtitle.textContent = lobbyProfileState.viewingSelf
      ? "Loadout, progression, and account overview"
      : `${profile.username || "Player"}'s public stats`;
  }
  const title = document.getElementById("profile-popup-title");
  if (title) {
    title.textContent = lobbyProfileState.viewingSelf
      ? "Your Profile"
      : `${profile.username || "Player"} Profile`;
  }
  const accountPanel = document.getElementById("profile-account-panel");
  if (accountPanel) {
    accountPanel.classList.toggle("is-hidden", !lobbyProfileState.viewingSelf);
  }
  const cardsPanel = document.getElementById("profile-cards-panel");
  if (cardsPanel) {
    cardsPanel.classList.toggle("is-hidden", !lobbyProfileState.viewingSelf);
  }
  const coinsRow = document.getElementById("profile-coins-row");
  if (coinsRow) {
    coinsRow.classList.toggle("is-hidden", !lobbyProfileState.viewingSelf);
  }
  const gemsRow = document.getElementById("profile-gems-row");
  if (gemsRow) {
    gemsRow.classList.toggle("is-hidden", !lobbyProfileState.viewingSelf);
  }

  const usernameInput = document.getElementById("profile-new-username");
  if (usernameInput && lobbyProfileState.viewingSelf && !usernameInput.value) {
    usernameInput.value = profile.username || "";
  }

  // Keep navbar resource counters in sync after buy operations.
  const coinCount = document.getElementById("coin-count");
  const gemCount = document.getElementById("gem-count");
  if (lobbyProfileState.viewingSelf) {
    if (coinCount) coinCount.textContent = String(Number(profile.coins) || 0);
    if (gemCount) gemCount.textContent = String(Number(profile.gems) || 0);
  }
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
          sonner(
            action === "buy" ? "Card purchased" : "Card equipped",
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
          actionBtn.disabled = false;
        }
      });
    }

    grid.appendChild(tile);
  });
}

async function loadProfilePopupData(force = false) {
  if (!lobbyProfileState.viewingSelf && lobbyProfileState.viewingUsername) {
    const profileRes = await profileFetchJson(
      `/profile/view?username=${encodeURIComponent(lobbyProfileState.viewingUsername)}`,
    );
    lobbyProfileState.profile = profileRes?.profile || {};
    renderProfilePopupStats();
    const grid = document.getElementById("profile-cards-grid");
    if (grid) grid.innerHTML = "";
    return;
  }
  if (!force && lobbyProfileState.profile && lobbyProfileState.catalog) {
    renderProfilePopupStats();
    renderProfilePopupCards();
    return;
  }
  if (lobbyProfileState.loadingPromise) return lobbyProfileState.loadingPromise;

  lobbyProfileState.loadingPromise = Promise.all([
    profileFetchJson("/profile/data"),
    profileFetchJson("/player-cards/catalog"),
    profileFetchJson("/player-cards/owned"),
  ])
    .then(([profileRes, catalogRes, ownedRes]) => {
      const profile = profileRes?.profile || {};
      lobbyProfileState.profile = profile;
      lobbyProfileState.catalog =
        catalogRes?.catalog && Array.isArray(catalogRes.catalog.cards)
          ? catalogRes.catalog
          : { cards: [] };
      lobbyProfileState.ownedCardIds = Array.isArray(ownedRes?.ownedCardIds)
        ? ownedRes.ownedCardIds
        : [];
      lobbyProfileState.selectedCardId =
        ownedRes?.selectedCardId || profile?.selectedCardId || null;

      if (userData) {
        userData.name = profile.username || userData.name;
        userData.coins = Number(profile.coins ?? userData.coins) || 0;
        userData.gems = Number(profile.gems ?? userData.gems) || 0;
      }

      const usernameText = document.getElementById("username-text");
      if (usernameText) usernameText.textContent = profile.username || "";

      renderProfilePopupStats();
      renderProfilePopupCards();
    })
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

  if (!overlay) return;

  const close = () => {
    playSound("cancel", 0.4);
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
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    setProfilePopupMessage("Loading profile...");
    try {
      await loadProfilePopupData(true);
      setProfilePopupMessage("");
    } catch (err) {
      setProfilePopupMessage(err.message || "Failed to load profile.", true);
    }
  };

  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
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
    action === "owner" ? "/party/make-owner" : action === "kick" ? "/party/kick" : "";
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
      action === "owner" ? "Could not transfer ownership" : "Could not kick player",
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
      playerName === party.ownerName ? `${playerName} (Owner)` : playerName;
  }
  if (viewBtn) {
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

function animatePostMatchRewardsIfPresent(coinEl, gemEl, coinsNow, gemsNow) {
  if (!coinEl || !gemEl) return;
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
  try {
    sessionStorage.removeItem(POST_MATCH_REWARD_STORAGE_KEY);
  } catch (_) {}
  if (ageMs < 0 || ageMs > 2 * 60 * 1000) return;
  if (coinsAwarded <= 0 && gemsAwarded <= 0) return;

  const coinsFrom = Math.max(0, Number(coinsNow) - coinsAwarded);
  const gemsFrom = Math.max(0, Number(gemsNow) - gemsAwarded);
  coinEl.textContent = String(coinsFrom);
  gemEl.textContent = String(gemsFrom);
  animateNumber(coinEl, coinsFrom, Number(coinsNow), 1600);
  animateNumber(gemEl, gemsFrom, Number(gemsNow), 1600);
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
    console.log("[join-debug] /status response", getJoinDebugMeta({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
    }));
    return res.json();
  })
  .then((data) => {
    console.log("[join-debug] /status payload", getJoinDebugMeta({
      userId: data?.userData?.user_id ?? null,
      username: data?.userData?.name ?? null,
      guest: data?.guest ?? null,
      partyId: data?.party_id ?? null,
      liveMatchId: data?.live_match_id ?? null,
      isAdmin: data?.isAdmin ?? null,
    }));
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
    console.error("[join-debug] Error fetching /status", getJoinDebugMeta({
      message: err?.message || String(err),
    })),
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
  console.log("[join-debug] bootstrapPartyData starting", getJoinDebugMeta({
    partyId,
    userId: userData?.user_id ?? null,
    username: userData?.name ?? null,
    cookieEnabled: navigator.cookieEnabled,
  }));
  try {
    const resp = await fetch("/partydata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partyId }),
    });

    console.log("[join-debug] /partydata response", getJoinDebugMeta({
      partyId,
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
    }));

    if (!resp.ok) {
      if (resp.status === 409) {
        // Party might be full, try to get JSON response
        try {
          const errorData = await resp.json();
          if (errorData.redirect) {
            window.location.href = errorData.redirect;
            return;
          }
        } catch (e) {
          // If JSON parsing fails, fall back to generic error
        }
      }
      throw new Error("Failed to fetch party data");
    }

    const data = await resp.json();
    console.log("[join-debug] /partydata payload", getJoinDebugMeta({
      partyId,
      responsePartyId: data?.party?.party_id ?? data?.party?.partyId ?? null,
      ownerName: data?.ownerName ?? null,
      membersCount: Array.isArray(data?.members) ? data.members.length : 0,
      selection: data?.selection || null,
      viewer: data?.viewer ?? null,
    }));
    if (data?.party) {
      const selection = applyLobbySelection(
        data?.selection || {
          modeId: data?.party?.mode_id || data?.party?.modeId || "duels",
          modeVariantId:
            data?.party?.mode_variant_id ||
            data?.party?.modeVariantId ||
            null,
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
      });
    sonner("Joined party", undefined, undefined, undefined, {
      duration: 1500,
      sound: "notification",
    });
  } catch (error) {
    console.error("[join-debug] bootstrapPartyData failed", getJoinDebugMeta({
      partyId,
      message: error?.message || String(error),
      stack: error?.stack || null,
    }));
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
  const inviteStatus = document.querySelectorAll(".invite");

  const coinCount = document.getElementById("coin-count");
  const gemCount = document.getElementById("gem-count");
  const usernameButton = document.getElementById("username-button");

  document.getElementById("username-text").textContent = userData.name;
  const profilePopup = initProfilePopup();
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
  animatePostMatchRewardsIfPresent(
    coinCount,
    gemCount,
    Number(userData.coins) || 0,
    Number(userData.gems) || 0,
  );

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
      const wantsProfile =
        !!e.target.closest(".character-sprite, .username, .slot-level-badge");
      if (wantsProfile) {
        playSound("cursor4", 0.35);
        profilePopup?.open?.({ username: playerName });
        return;
      }
      const inParty = !!checkIfInParty();
      if (inParty) {
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
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await statusPromise; // ensures guest user created + cookies set
  // NEW: connect socket now, deterministically after cookies are present
  try {
    const connectStarted = ensureSocketConnected();
    console.log("[join-debug] socket connect requested after status", getJoinDebugMeta({
      connectStarted,
    }));
    if (connectStarted) await waitForConnect();
  } catch (error) {
    console.error("[join-debug] socket connection bootstrap failed", getJoinDebugMeta({
      message: error?.message || String(error),
    }));
  }
  if (!userData) return;

  socketInit(); // this can assume socket is connected or connecting with cookies
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
