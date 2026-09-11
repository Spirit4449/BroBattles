import { escapeHtml, profileFetchJson, fetchLobbyJson, openOverlay, closeOverlay, isOverlayOpen } from './lobby/ui';
import { createProfileController } from './lobby/profileController';
import { createTrophyController } from './lobby/trophyController';
import { registerMapCatalog } from './lib/gameSelectionCatalog';
import { registerMapMetadata } from './maps/manifest';
import { sonner } from "./lib/sonner.js";
import { checkIfInParty, createParty, leaveParty, socketInit, applyLobbySelection, renderPartyMembers, getPartyInteractionContext, initializeModeDropdown, initReadyToggle, setSlotLevelBadge, showPartyJoinRequestScreen, playLobbySpawnAnimation } from "./party.js";
import socket, { ensureSocketConnected, waitForConnect } from "./socket.js";
import {
  initializeCharacterSelect,
  openCharacterSelect,
} from "./lobby/characterSelectController.js";
import { getLobbyBgAsset } from "./maps/manifest";
import {
  getMapLabel,
  getSelectionDisplayLabel,
  normalizeGameSelection,
} from "./lib/gameSelectionCatalog.js";
import { initUISounds, playSound } from "./lib/uiSounds.js";
import { showUiConfirm } from "./lib/uiConfirm.js";
import { wireFullscreenToggles } from "./lib/fullscreen.js";

import { createLobbyChatController } from "./chat/lobbyChatController.js";
import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "./lib/profileIconAssets.js";

import { buildCharacterSkinBodyUrl } from "./lib/skinAssets.js";

import { initializeShop } from "./shop.js";
import "./styles/characterSelect.css";
import "./styles/index.css";

// Images in the lobby and its menus are interactive artwork, not draggable
// content. Delegation also covers images rendered after a popup is opened.
document.addEventListener("dragstart", (event) => {
  if (event.target instanceof Element && event.target.closest("img")) {
    event.preventDefault();
  }
});
import "./styles/chat.css";
import "./styles/profile.css";
import "./styles/selectionPopup.css";
import "./styles/sonner.css";

wireFullscreenToggles();

const lobbyChatController = createLobbyChatController({
  socket,
  getPartyContext: getPartyInteractionContext,
  getCurrentUserName: () =>
    document.getElementById("username-text")?.textContent || "",
});

let userData = null;
const profileController = createProfileController({ getUserData: () => userData });
const { initProfilePopup } = profileController;
const trophyController = createTrophyController({ getUserData: () => userData });
const { openTrophyProgressionOverlay, refreshTrophyClaimAvailability, scrollTrophyTrack, updateTrophyTrackControls } = trophyController;
let guest = false;
const POST_MATCH_REWARD_STORAGE_KEY = "bb_post_match_rewards_v1";

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
  allowMemberSelection: true,
  memberSelectionSupported: true,
};
let __lobbyProfilePopup = null;
let lobbyBackgroundRequestSequence = 0;

function getDiscoveryModeLabel(party) {
  const selection = normalizeGameSelection({
    modeId: party?.modeId,
    modeVariantId: party?.modeVariantId,
    mapId: party?.map,
  });
  return getSelectionDisplayLabel(selection);
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

function closeTransientLobbyUiOnEscape() {
  const loadoutOverlay = document.getElementById("profile-loadout-overlay");
  if (loadoutOverlay && !loadoutOverlay.classList.contains("hidden")) {
    loadoutOverlay.classList.add("hidden");
    loadoutOverlay.setAttribute("aria-hidden", "true");
    return true;
  }

  const profileOverlay = document.getElementById("profile-overlay");
  if (profileOverlay && !profileOverlay.classList.contains("hidden")) {
    profileOverlay.classList.add("hidden");
    profileOverlay.setAttribute("aria-hidden", "true");
    return true;
  }

  const overlayIds = [
    "party-settings-overlay",
    "party-discovery-overlay",
    "trophy-track-overlay",
    "leaderboard-overlay",
  ];
  for (const overlayId of overlayIds) {
    if (!isOverlayOpen(overlayId)) continue;
    closeOverlay(overlayId);
    return true;
  }

  if (document.querySelector(".bb-chat-lobby-panel.is-open")) {
    lobbyChatController?.close?.();
    return true;
  }

  return false;
}

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (!closeTransientLobbyUiOnEscape()) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

function setPartyDiscoveryStatus(text, isError = false) {
  const status = document.getElementById("party-discovery-status");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("is-error", isError);
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
          <div class="party-discovery-meta" title="${escapeHtml(ownerName)}">
            <img src="/assets/crown.webp" alt="Owner" width="12" height="12" />
            <span>Hosted by ${escapeHtml(ownerName)}</span>
          </div>
        </div>
        <button type="button" class="pixel-menu-button party-discovery-join" data-party-id="${Number(
          party?.partyId,
        )}">Join</button>
      </div>
      <div class="party-discovery-info-row">
        <span class="party-discovery-detail"><span class="party-discovery-meta-label">Mode</span> ${escapeHtml(getDiscoveryModeLabel(party))}</span>
        <span class="party-discovery-detail"><span class="party-discovery-meta-label">Map</span> ${escapeHtml(getMapLabel(party?.map))}</span>
      </div>
      <div class="party-discovery-roster">
        <div class="party-discovery-meta-label">${members.length} ${members.length === 1 ? "player" : "players"}</div>
        <div class="party-discovery-members"></div>
      </div>
    `;

    const memberWrap = card.querySelector(".party-discovery-members");
    members.forEach((member) => {
      const name = String(member?.name || "Player");
      const charClass = String(member?.char_class || "ninja");
      const profileIconId = String(member?.profile_icon_id || "") || null;
      const entry = document.createElement("div");
      entry.className = "party-discovery-member";
      entry.title = `${name} · ${charClass}`;
      entry.innerHTML = `
        <img src="${escapeHtml(buildProfileIconUrl(profileIconId, charClass))}" alt="${escapeHtml(
          buildProfileIconAlt(profileIconId, charClass),
        )}" />
        <div>
          <div class="party-discovery-member-name">${escapeHtml(name)}</div>
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
  status.classList.toggle("is-error", isError);
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
    allowMemberSelection: payload?.allowMemberSelection !== false,
    memberSelectionSupported: payload?.memberSelectionSupported !== false,
  };

  const toggle = document.getElementById("party-public-toggle");
  const nameInput = document.getElementById("party-public-name");
  const saveBtn = document.getElementById("party-settings-save");
  const memberToggle = document.getElementById("party-member-selection-toggle");
  if (memberToggle) {
    memberToggle.checked = __partySettingsState.allowMemberSelection;
    memberToggle.disabled =
      !__partySettingsState.isOwner ||
      !__partySettingsState.memberSelectionSupported;
  }
  if (toggle) toggle.checked = __partySettingsState.isPublic;
  if (nameInput) nameInput.value = __partySettingsState.publicName;
  const canEdit =
    __partySettingsState.isOwner && __partySettingsState.visibilitySupported;
  if (toggle) toggle.disabled = !canEdit;
  syncPublicPartyNameVisibility();
  if (saveBtn) saveBtn.disabled = !canEdit;

  if (!__partySettingsState.visibilitySupported) {
    setPartySettingsStatus(
      "Party visibility requires the latest DB migration before this can be used.",
      true,
    );
  } else if (!__partySettingsState.memberSelectionSupported) {
    setPartySettingsStatus(
      "Map and mode permissions require the latest party migration.",
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
        ...(__partySettingsState.memberSelectionSupported
          ? {
              allowMemberSelection: !!document.getElementById(
                "party-member-selection-toggle",
              )?.checked,
            }
          : {}),
      }),
    });
    __partySettingsState.allowMemberSelection =
      payload?.settings?.allowMemberSelection !== false;
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

function syncPublicPartyNameVisibility() {
  const toggle = document.getElementById("party-public-toggle");
  const isPublic = !!toggle?.checked;
  document
    .getElementById("party-public-name-group")
    ?.classList.toggle("hidden", !isPublic);
  const input = document.getElementById("party-public-name");
  if (input) input.disabled = !isPublic || !!toggle?.disabled;
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
  partyPublicToggle?.addEventListener("change", syncPublicPartyNameVisibility);
}

function renderLeaderboardRows(rows, profilePopup) {
  const container = document.getElementById("leaderboard-list");
  if (!container) return;
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = `
      <div class="leaderboard-state leaderboard-empty-state">
        <span class="leaderboard-state-icon" aria-hidden="true">?</span>
        <strong>No ranked players yet</strong>
        <span>Finish a battle to claim the first spot.</span>
      </div>
    `;
    return;
  }

  rows.forEach((row, index) => {
    const rank = Math.max(1, Number.parseInt(row.rank, 10) || index + 1);
    const wins = Math.max(0, Number(row.wins) || 0);
    const trophies = Math.max(0, Number(row.trophies) || 0);
    const username = String(row.username || "Unknown Player");
    const item = document.createElement("button");
    item.type = "button";
    item.className = "leaderboard-row";
    item.style.setProperty(
      "--leaderboard-row-index",
      String(Math.min(index, 10)),
    );
    item.setAttribute("aria-label", `View ${username}'s profile`);
    if (rank <= 3) {
      item.classList.add(`top-${rank}`);
    }
    const charClass = String(row.charClass || "ninja");
    const profileIconId = String(row.profileIconId || "") || null;
    item.innerHTML = `
      <span class="leaderboard-rank">#${rank}</span>
      <span class="leaderboard-player">
        <span class="leaderboard-avatar-frame">
          <img class="leaderboard-avatar" src="${escapeHtml(buildProfileIconUrl(profileIconId, charClass))}" alt="${escapeHtml(buildProfileIconAlt(profileIconId, charClass))}" />
        </span>
        <span class="leaderboard-main">
          <span class="leaderboard-name">${escapeHtml(username)}</span>
          <span class="leaderboard-character">${escapeHtml(charClass)} fighter</span>
        </span>
      </span>
      <span class="leaderboard-wins" aria-label="${wins.toLocaleString()} wins">
        <strong>${wins.toLocaleString()}</strong>
        <small>Wins</small>
      </span>
      <span class="leaderboard-trophies">
        <img src="/assets/trophy.webp" alt="" />
        <span><strong>${trophies.toLocaleString()}</strong><small>Trophies</small></span>
      </span>
    `;
    item.addEventListener("click", () => {
      profilePopup?.open?.({ username });
    });
    container.appendChild(item);
  });
}

async function openLeaderboardOverlay(profilePopup) {
  openOverlay("leaderboard-overlay");
  const container = document.getElementById("leaderboard-list");
  if (container)
    container.innerHTML = `<div class="leaderboard-state leaderboard-loading-state">
        <span class="leaderboard-loading-mark" aria-hidden="true"></span>
        <strong>Loading standings</strong>
        <span>Checking the latest rankings...</span>
      </div>`;
  const data = await fetchLobbyJson("/leaderboard/trophies?limit=100");
  renderLeaderboardRows(
    Array.isArray(data?.leaderboard) ? data.leaderboard : [],
    profilePopup,
  );
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

    if (data?.mapCatalog) { registerMapCatalog(data.mapCatalog); registerMapMetadata(data.mapCatalog); }
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
        allowMemberSelection: data?.allowMemberSelection !== false,
        isPublic: data?.isPublic,
        publicName: data?.publicName,
        botSlots: data?.botSlots,
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
  const shopButton = document.getElementById("shop-button");
  const coinResourceButton = document.getElementById("coin-resource-button");
  const gemResourceButton = document.getElementById("gem-resource-button");

  document.getElementById("username-text").textContent = userData.name;
  const profilePopup = initProfilePopup();
  __lobbyProfilePopup = profilePopup;
  const shop = initializeShop({
    userData,
    guest,
    onWalletChange: (wallet) => {
      userData.coins = wallet.coins;
      userData.gems = wallet.gems;
      if (coinCount) coinCount.textContent = String(wallet.coins);
      if (gemCount) gemCount.textContent = String(wallet.gems);
      profileController.updateWallet(wallet);
    },
    onProfileInvalidate: () => {
      profileController.invalidate();
    },
  });
  shopButton?.addEventListener("click", () => void shop.open("sales"));
  coinResourceButton?.addEventListener(
    "click",
    () => void shop.open("currency"),
  );
  gemResourceButton?.addEventListener(
    "click",
    () => void shop.open("currency"),
  );
  document
    .getElementById("profile-loadout-shop")
    ?.addEventListener("click", () => {
      profilePopup?.close?.();
      void shop.open("profile");
    });
  if (usernameButton) {
    usernameButton.addEventListener("click", () => {
      if (profilePopup?.open) {
        profilePopup.open();
      }
    });
  }
  const initialCharClass = String(userData.char_class || "ninja").toLowerCase();
  const initialSkinId = String(
    userData?.selected_skin_id_by_char?.[initialCharClass] || "",
  ).trim();
  characterBodyElement.src = buildCharacterSkinBodyUrl(
    initialCharClass,
    initialSkinId,
  );
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

  const trophyTrackList = document.getElementById("trophy-track-list");
  document
    .getElementById("trophy-track-prev")
    ?.addEventListener("click", () => scrollTrophyTrack(-1));
  document
    .getElementById("trophy-track-next")
    ?.addEventListener("click", () => scrollTrophyTrack(1));
  trophyTrackList?.addEventListener(
    "scroll",
    () => {
      trophyController.rememberScroll(trophyTrackList);
    },
    { passive: true },
  );
  trophyTrackList?.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (trophyTrackList.scrollWidth <= trophyTrackList.clientWidth) return;
      event.preventDefault();
      trophyTrackList.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
  trophyTrackList?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    scrollTrophyTrack(event.key === "ArrowLeft" ? -1 : 1);
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
      playLobbySpawnAnimation(yourSlot, "enter");
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
  const current = document.body.dataset.lobbyBackgroundUrl || "";
  const target = `url("${nextUrl}")`;
  const requestId = String(++lobbyBackgroundRequestSequence);
  const existingOverlay = document.getElementById("lobby-bg-fade");
  if (current === nextUrl) {
    if (existingOverlay) {
      existingOverlay.dataset.backgroundRequestId = requestId;
      existingOverlay.classList.remove("active");
    }
    return;
  }

  let overlay = existingOverlay;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "lobby-bg-fade";
    document.body.appendChild(overlay);
  }

  const preload = new Image();
  let applied = false;
  overlay.dataset.backgroundRequestId = requestId;

  const applyLoadedBackground = () => {
    if (applied || overlay.dataset.backgroundRequestId !== requestId) return;
    applied = true;
    overlay.style.backgroundImage = target;
    overlay.classList.add("active");

    setTimeout(() => {
      if (overlay.dataset.backgroundRequestId !== requestId) return;
      document.body.style.backgroundImage = target;
      document.body.dataset.lobbyBackgroundUrl = nextUrl;
      try {
        const partyMatch =
          window.location.pathname.match(/^\/party\/([^/?#]+)/);
        const backgroundScope = partyMatch ? `party:${partyMatch[1]}` : "solo";
        localStorage.setItem(
          `bb_lobby_background_url:${backgroundScope}`,
          nextUrl,
        );
      } catch (_) {}
      overlay.classList.remove("active");
    }, 240);
  };

  preload.onload = applyLoadedBackground;
  preload.src = nextUrl;
  if (preload.complete) queueMicrotask(applyLoadedBackground);
}
