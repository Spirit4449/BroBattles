import { warmEquippedPlayerCard } from "../views/playerCardAnimation.cjs";
import { revealLobby, watchLobbyLoading, showLobbyLoadError } from "../lobby/lobbyReveal.js";
import { setPartyButtonLabel } from "../lobby/party/partyButtonLabel.js";
import { createLazyInitializer, deferLobbySetup } from "../lobby/deferredSetup.js";
import { setNavigationGuard } from "../site/shell";
import "../site/shell.js";
import { closeOverlay, isOverlayOpen } from '../lobby/ui';
import { createProfileController } from '../lobby/profile/profileController';
import { createTrophyController } from '../lobby/profile/trophyController';
import { setSelectionProgressionUser } from '../lib/gameSelectionCatalog';
import { registerMapCatalog } from '../lib/gameSelectionCatalog';
import { registerMapMetadata } from '../game/maps/manifest';
import { sonner } from "../ui/sonner.js";
import { setSlotLevelBadge } from "../views/levelBadgeView.js";
import { ensurePartyPixelFrame, resetLobbyRoute, checkIfInParty, createParty, leaveParty, socketInit, applyLobbySelection, renderPartyMembers, getPartyInteractionContext, initializeModeDropdown, initReadyToggle, showPartyJoinRequestScreen } from "../lobby/party/party.js";
import { playLobbySpawnAnimation } from "../lobby/party/slotEffects.js";
import socket, { ensureSocketConnected, waitForConnect } from "../lib/socket.js";
import {
  initializeCharacterSelect,
  refreshCharacterRewards,
  openCharacterSelect,
} from "../lobby/profile/characterSelectController.js";
import { setLobbyBackground } from "../lobby/lobbyBackground.js";
import { initUISounds, playSound } from "../ui/uiSounds.js";
import { showUiConfirm } from "../ui/uiConfirm.js";
import {
  openPartyDiscoveryOverlay,
  openPartySettingsOverlay,
  syncPartySettingsButtonVisibility,
  wirePartyOverlayControls,
} from "../lobby/party/partyOverlays.js";
import { openLeaderboardOverlay } from "../lobby/profile/leaderboardOverlay.js";
import { openPartySlotMenu } from "../lobby/party/partySlotMenu.js";
import { animatePostMatchRewardsIfPresent } from "../lobby/profile/postMatchRewards.js";
import { initializeLobbyHints } from "../lobby/lobbyHints.js";
import { wireFullscreenToggles } from "../ui/fullscreen.js";

import { createLobbyChatController } from "../chat/lobbyChatController.js";
import { formatSuspensionTime } from "../chat/presentation.js";
import { createFriendsPanelController } from "../friends/friendsPanelController.js";

import { buildCharacterSkinBodyUrl } from "../views/skinAssets.js";

import { initializeShop } from "../lobby/shop/shop.js";
import "../styles/levelBadge.css";
import "../styles/characterSelect.css";
import "../styles/index.css";

// Images in the lobby and its menus are interactive artwork, not draggable
// content. Delegation also covers images rendered after a popup is opened.
document.addEventListener("dragstart", (event) => {
  if (event.target instanceof Element && event.target.closest("img")) {
    event.preventDefault();
  }
});
import "../styles/chat.css";
import "../styles/friends.css";
import "../styles/profile.css";
import "../styles/selectionPopup.css";
import "../styles/sonner.css";
import { DEFAULT_CHARACTER, resolveCharacterKey } from "../../shared/characters/characterStats.js";

wireFullscreenToggles();

const lobbyChatController = createLobbyChatController({
  socket,
  getPartyContext: getPartyInteractionContext,
  onOpenProfile: (username) => __lobbyProfilePopup?.open({ username }),
  getCurrentUserName: () =>
    document.getElementById("username-text")?.textContent || "",
});

const friendsController = createFriendsPanelController({
  socket,
  getPartyContext: getPartyInteractionContext,
  onOpenProfile: (username) => __lobbyProfilePopup?.open({ username }),
  // Only one right-side drawer is open at a time.
  onOpen: () => lobbyChatController?.close?.(),
});
document
  .querySelector(".bb-chat-lobby-launcher")
  ?.addEventListener("click", () => friendsController.close());

// Add Friend / Pending / Friends button in another player's profile header.
function syncProfileFriendButton(profile, viewingSelf) {
  const head = document.querySelector("#profile-overlay .profile-head-copy");
  if (!head) return;
  let btn = document.getElementById("profile-friend-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "profile-friend-btn";
    btn.type = "button";
    btn.className = "bb-friends-btn is-primary profile-friend-btn";
    head.appendChild(btn);
  }
  const name = String(profile?.username || "");
  const relation = viewingSelf ? "self" : friendsController.relationshipFor(name);
  btn.hidden = relation === "self" || relation === "unavailable" || !!profile?.guest;
  btn.disabled = relation !== "none" && relation !== "incoming";
  btn.textContent =
    relation === "friends" ? "Friends ✓"
      : relation === "outgoing" ? "Request Pending"
        : relation === "incoming" ? "Accept Friend"
          : "Add Friend";
  btn.onclick = async () => {
    btn.disabled = true;
    const result = await friendsController.addFriend({ username: name });
    syncProfileFriendButton(profile, viewingSelf);
    if (!result) btn.disabled = false;
  };
}

let userData = null;
setSelectionProgressionUser(() => userData);
const profileController = createProfileController({
  getUserData: () => userData,
  onProfileRendered: syncProfileFriendButton,
});
const { initProfilePopup } = profileController;
const trophyController = createTrophyController({ getUserData: () => userData, onRewardsClaimed: () => {
  profileController.invalidate();
  void refreshCharacterRewards().catch(() => {});
} });
const { openTrophyProgressionOverlay, refreshTrophyClaimAvailability, scrollTrophyTrack, updateTrophyTrackControls } = trophyController;
let guest = false;
let newGuestCreated = false;

let __lobbyProfilePopup = null;
// Stable reference so the party:members listener can be re-bound.
const syncPartySettingsButton = () => syncPartySettingsButtonVisibility(userData?.name);

function closeTransientLobbyUiOnEscape() {
  // The views dialog sits above chat; consume Escape before closing its parent.
  const viewers = document.querySelector(".bb-chat-viewers-popup:not(.hidden)");
  if (viewers) {
    viewers.querySelector("button[data-chat-viewers-close]")?.click();
    return true;
  }
  if (document.querySelector(".shop-reward-reveal:not(.is-leaving)")) return false;
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

  if (document.querySelector(".bb-friends-panel.is-open")) {
    friendsController?.close?.();
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

function showSuspensionPopupFromStatus(statusData) {
  const mmSuspendedUntilMs = Number(statusData?.suspension?.matchmaking) || 0;
  const chatSuspendedUntilMs = Number(statusData?.suspension?.chat) || 0;
  const mmText = formatSuspensionTime(mmSuspendedUntilMs);
  const chatText = formatSuspensionTime(chatSuspendedUntilMs);

  if (!mmText && !chatText) return;

  const parts = [];
  if (mmText) parts.push(`Matchmaking suspended for ${mmText}.`);
  if (chatText) parts.push(`Lobby chat suspended for ${chatText}.`);
  sonner("Account temporarily restricted", parts.join(" "), "OK", undefined, {
    duration: 7000,
    sound: "notification",
  });
}

let existingPartyId = checkIfInParty();

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

watchLobbyLoading();

// Results navigation already obtained fresh status. Consume it only in the
// destination scope; ordinary entry and failed returns use the usual request.
const returnStatus = window.__BB_NAVIGATION__?.consumeLobbyReturnStatus?.();
const statusPromise = (returnStatus ? Promise.resolve(returnStatus) : fetch("/status", {
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
  }))
  .then(async (data) => {
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
      warmEquippedPlayerCard(userData.selected_card_id || userData.selectedCardId);
      guest = data.guest;
      newGuestCreated = !!data.newlyCreated && !!data.guest;

      // A player still in a live match stays out of party routing; the match
      // page owns rejoining.
      if (data.live_match_id) return;

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

async function bootstrapPartyData(partyId, signal) {
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
      signal,
    });
    if (signal?.aborted) return;

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
    if (signal?.aborted || String(partyId) !== String(checkIfInParty())) return;
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
    syncPartySettingsButton();
    sonner("Joined party", undefined, undefined, undefined, {
      duration: 1500,
      sound: "notification",
    });
  } catch (error) {
    if (signal?.aborted) return;
    showLobbyLoadError();
    if (signal) throw error;
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

  const characterBodyElement = checkIfInParty()
    ? document.querySelector('.character-slot[data-is-current-user="true"] .character-sprite')
    : document.getElementById("sprite");
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
  const ensureProfilePopup = createLazyInitializer(initProfilePopup);
  const profilePopup = {
    open: (...args) => ensureProfilePopup()?.open(...args),
    close: () => ensureProfilePopup()?.close(),
  };
  __lobbyProfilePopup = profilePopup;
  const ensureShop = createLazyInitializer(() => initializeShop({
    userData,
    guest,
    onOpenProfile: () => profilePopup.open(),
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
  }));
  const shop = {
    open: (...args) => ensureShop().open(...args),
    openOffer: (...args) => ensureShop().openOffer(...args),
    getFeaturedSale: () => ensureShop().getFeaturedSale(),
  };
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
  deferLobbySetup([
    () => {
      ensureProfilePopup();
      if (new URLSearchParams(location.search).get('profile') === 'self') {
        profilePopup.open();
        const url = new URL(location.href);
        url.searchParams.delete('profile');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    },
    () => ensureShop().refreshNotifications(),
    refreshTrophyClaimAvailability,
    () =>
      initializeLobbyHints({
        shop,
        userData,
        guest,
        newGuestCreated,
        getExistingPartyId: () => existingPartyId,
      }),
  ]);
  const initialCharClass = resolveCharacterKey(userData.char_class);
  const initialSkinId = String(
    userData?.selected_skin_id_by_char?.[initialCharClass] || "",
  ).trim();
  if (characterBodyElement) characterBodyElement.src = buildCharacterSkinBodyUrl(
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
        openPartySlotMenu(slot, e, {
          profilePopup,
          currentUserName: userData?.name,
          friendsController,
        });
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

  createPartyButton.addEventListener('click', () => {
    if (checkIfInParty()) void leaveParty();
    else createParty();
  });
  // Delegated click handler so dynamically-updated Invite buttons work
  if (lobby) {
    lobby.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest && e.target.closest(".invite");
      if (!btn) return;
      // Only act when in a party
      if (!existingPartyId) return;
      const link = btn.dataset.inviteLink || window.location.href;
      navigator.clipboard.writeText(link);
      sonner(
        null,
        "Party invite link copied. Share it with your friends.",
        undefined,
        undefined,
        { duration: 2000 },
      );
    });
  }

  // Initialize socket events for both party and solo flows once DOM is ready

  if (existingPartyId) {
    setPartyButtonLabel(createPartyButton, "Leave Party");
    createPartyButton.style.background =
      "linear-gradient(135deg, #d63939, #cf4545)";

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

    // Bind Ready button in party flow
    try {
      initReadyToggle();
    } catch {}

    // Settings are fetched fresh when opened; the roster supplies permissions
    // needed to show the button without a separate startup request.
    syncPartySettingsButton();
  } else {
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
      ensurePartyPixelFrame(yourSlot);
      yourSlot.dataset.character = userData.char_class || DEFAULT_CHARACTER;
      const levelBadge = yourSlot.querySelector(".slot-level-badge");
      const charLevels =
        typeof userData.char_levels === "object" && userData.char_levels
          ? userData.char_levels
          : {};
      const level = Math.max(1, Number(charLevels?.[userData.char_class]) || 1);
      if (levelBadge) setSlotLevelBadge(yourSlot, level);
      playLobbySpawnAnimation(yourSlot, "enter");
      void revealLobby();
    }
    // Bind Ready button in solo flow
    try {
      initReadyToggle();
    } catch {}
    syncPartySettingsButton();
  }

  socket.off("party:members", syncPartySettingsButton);
  socket.on("party:members", syncPartySettingsButton);

  window.__BB_NAVIGATION__?.setLobbyNavigator(async (url, signal) => {
    existingPartyId = checkIfInParty();
    resetLobbyRoute(existingPartyId);
    lobbyChatController.close();
    closeOverlay('party-discovery-overlay');
    closeOverlay('party-settings-overlay');
    createPartyButton.disabled = false;
    setPartyButtonLabel(createPartyButton, existingPartyId ? 'Leave Party' : 'Create Party');
    createPartyButton.style.background = existingPartyId ? 'linear-gradient(135deg, #d63939, #cf4545)' : '';
    if (existingPartyId) createPartyButton.setAttribute('data-sound', 'cancel2');
    else createPartyButton.removeAttribute('data-sound');
    if (existingPartyId) {
      await bootstrapPartyData(existingPartyId, signal);
    } else {
      const response = await fetch('/status', { method: 'POST', credentials: 'same-origin', signal });
      if (!response.ok) throw new Error('Unable to load your lobby');
      const status = await response.json();
      if (signal.aborted) return;
      if (status.party_id) { window.location.href = `/party/${status.party_id}`; return; }
      if (status.userData) Object.assign(userData, status.userData);
      const character = userData.char_class || DEFAULT_CHARACTER;
      renderPartyMembers({ partyId: null, immediate: true, members: [{
        ...userData, team: 'team1', status: 'online',
        selected_skin_asset_url: buildCharacterSkinBodyUrl(character, userData.selected_skin_id_by_char?.[character]),
      }], botSlots: [] });
    }
    if (signal.aborted) return;
    syncPartySettingsButton();
    lobbyChatController.refresh();
    document.dispatchEvent(new Event('lobby:route-changed'));
  });
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
    signOut.style.display = "none";
    const profileSignOut = document.getElementById('profile-sign-out');
    profileSignOut?.addEventListener('click', async () => {
      profileSignOut.disabled = true;
      try {
        const response = await fetch('/logout', {method:'POST',credentials:'same-origin'});
        if (!response.ok) throw new Error('Unable to sign out.');
        window.location.assign('/login');
      } catch (_) {
        profileSignOut.disabled = false;
        profileSignOut.textContent = 'Retry sign out';
      }
    });
    login.style.display = "none";
  }
}

setNavigationGuard(async () => {
  if (!document.body.classList.contains('matchmaking-active')) return true;
  const confirmed = await showUiConfirm({title:'Leave matchmaking?', message:'Opening this page will cancel matchmaking.', confirmLabel:'Leave queue'});
  if (!confirmed) return false;
  try {
    await new Promise((resolve, reject) => socket.timeout(5000).emit('queue:leave', (error, reply) => {
      if (error || !reply?.ok) reject(new Error("We couldn't stop matchmaking. Please try again."));
      else resolve();
    }));
    return true;
  } catch (error) { sonner('Unable to leave queue', error.message, 'error'); return false; }
});
