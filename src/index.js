import { sonner } from "./lib/sonner.js";
import {
  checkIfInParty,
  createParty,
  leaveParty,
  socketInit,
  renderPartyMembers,
  initializeModeDropdown,
  showMatchmakingOverlay,
  initReadyToggle,
} from "./party.js";
import { ensureSocketConnected } from "./socket.js";
import {
  initializeCharacterSelect,
  openCharacterSelect,
} from "./characterLogic.js";
import { initUISounds, playSound } from "./lib/uiSounds.js";
import "./styles/characterSelect.css";
import "./styles/index.css";
import "./styles/sonner.css";

let userData = null;
let guest = false;

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

// Fetch user status upfront
const statusPromise = fetch("/status", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin",
})
  .then((res) => res.json())
  .then((data) => {
    if (data?.userData) {
      userData = data.userData;
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
  .catch((err) => console.error("Error fetching /status:", err));

// Wait for status before trying to bootstrap party data
if (existingPartyId) {
  statusPromise.then(() => {
    if (userData) {
      bootstrapPartyData(existingPartyId);
    }
  });
}

async function bootstrapPartyData(partyId) {
  console.log("In a party:", partyId);
  try {
    const resp = await fetch("/partydata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partyId }),
    });

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
    // Immediately render roster so UI isn't empty before socket pushes
    if (data?.members)
      renderPartyMembers({
        partyId,
        members: data.members,
        mode: data?.party?.mode,
        map: data?.party?.map,
      });
    sonner("Joined party", undefined, undefined, undefined, {
      duration: 1500,
      sound: "notification",
    });
  } catch (error) {
    console.error("Error:", error);
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

  document.getElementById("username-text").textContent = userData.name;
  setLobbyBackground("1");
  characterBodyElement.src = `/assets/${userData.char_class}/body.webp`;
  // Ensure non-random styling on initial sprite
  try {
    characterBodyElement.classList.remove("random");
  } catch {}
  coinCount.textContent = userData.coins;
  gemCount.textContent = userData.gems;

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
      }
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
          { duration: 2000 }
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
    if (!ensureSocketConnected()) await waitForConnect();
  } catch {}
  if (!userData) return;

  socketInit(); // this can assume socket is connected or connecting with cookies
});

function signUpOut(guest) {
  const signOut = document.getElementById("sign-out");
  const login = document.getElementById("login");
  if (guest) {
    signOut.textContent = "Sign Up";
    signOut.addEventListener("click", () => (window.location.href = "/signup"));
    login.addEventListener("click", () => (window.location.href = "/login"));
  } else {
    signOut.addEventListener("click", () => {
      window.location.href = "/signed-out";
    });
    login.style.display = "none";
  }
}

export function setLobbyBackground(mapValue) {
  const map = String(mapValue);
  if (map === "2") {
    // Mangrove Meadow
    document.body.style.backgroundImage =
      'url("/assets/mangrove/lobbyBg.webp")';
  } else {
    // Default map
    document.body.style.backgroundImage = 'url("/assets/lushy/lobbyBg.webp")';
  }
}
