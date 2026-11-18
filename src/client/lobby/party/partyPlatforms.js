import { checkIfInParty } from "./partyState.js";
import { refreshPlatformGrounding } from "./platformGrounding.mjs";
import { getLobbyPlatformAsset } from "../../game/maps/manifest";

let lobbyOffsetResizeBound = false;

export function getCurrentMapValue() {
  return String(document.getElementById("map")?.value || "1");
}

export function applyPlatformImageForMap(mapValue) {
  const platformUrl = getLobbyPlatformAsset(mapValue || getCurrentMapValue());
  const imageEls = document.querySelectorAll(".platform-image");
  for (const imageEl of imageEls) {
    if (!imageEl) continue;
    imageEl.style.backgroundImage = `url("${platformUrl}")`;
  }
  refreshPlatformGrounding();
}

export function bindLobbyOffsetResizeHandler() {
  if (lobbyOffsetResizeBound) return;
  lobbyOffsetResizeBound = true;

  let rafId = 0;
  window.addEventListener("resize", () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      refreshPlatformGrounding();
      rafId = 0;
    });
  });
}

export function animatePlatformsForMapSwitch() {
  const lobbyArea = document.getElementById("lobby-area");
  if (lobbyArea) {
    lobbyArea.classList.add("map-switching");
    setTimeout(() => lobbyArea.classList.remove("map-switching"), 260);
  }
  for (const imageEl of document.querySelectorAll(".platform-image")) {
    imageEl.classList.remove("map-switch");
    void imageEl.offsetWidth;
    imageEl.classList.add("map-switch");
    setTimeout(() => imageEl.classList.remove("map-switch"), 260);
  }
}

export function updatePlatformsForMode(mode) {
  const lobbyArea = document.getElementById("lobby-area");
  if (!lobbyArea) return;

  const targetCount = Number(mode) || 1;

  // Preserve the live hover animation and transient lobby state when roster
  // packets repeat the current mode. Replacing className restarts every
  // platform's animation on the same frame, making them drop in lockstep.
  const targetModeClass = `mode-${targetCount}`;
  for (const className of [...lobbyArea.classList]) {
    if (/^mode-\d+$/.test(className) && className !== targetModeClass) {
      lobbyArea.classList.remove(className);
    }
  }
  lobbyArea.classList.add(targetModeClass);

  // Get existing platforms
  const yourPlatforms = lobbyArea.querySelectorAll(
    '.platform[data-team="your-team"]',
  );
  const opPlatforms = lobbyArea.querySelectorAll(
    '.platform[data-team="op-team"]',
  );

  // Remove excess platforms
  if (yourPlatforms.length > targetCount) {
    for (let i = yourPlatforms.length - 1; i >= targetCount; i--) {
      yourPlatforms[i].remove();
      opPlatforms[i].remove();
    }
  }

  // Add missing platforms
  if (yourPlatforms.length < targetCount) {
    for (let i = yourPlatforms.length + 1; i <= targetCount; i++) {
      createPlatform("your-team", i);
      createPlatform("op-team", i);
    }
  }

  applyPlatformImageForMap(getCurrentMapValue());
  refreshPlatformGrounding();
}

function createPlatform(team, slotNumber) {
  const lobbyArea = document.getElementById("lobby-area");
  if (!lobbyArea) return;

  // Create platform container
  const platform = document.createElement("div");
  platform.className = `platform ${team}-${slotNumber}`;
  platform.setAttribute("data-team", team);
  platform.setAttribute("data-slot", slotNumber);

  // Create character slot
  const characterSlot = document.createElement("div");
  characterSlot.className = "character-slot empty";
  characterSlot.id = `${
    team === "your-team" ? "your" : "op"
  }-slot-${slotNumber}`;
  characterSlot.dataset.isCurrentUser = "false";

  const levelBadge = document.createElement("div");
  levelBadge.className = "slot-level-badge";
  levelBadge.setAttribute("aria-hidden", "true");
  characterSlot.appendChild(levelBadge);

  // Add switch-character control (hidden by default), only on your-team side
  if (team === "your-team") {
    const switchDiv = document.createElement("div");
    switchDiv.className = "switch-character";
    switchDiv.style.display = "none";
    const img = document.createElement("img");
    img.src = "/assets/switch.svg";
    img.alt = "";
    img.height = 18;
    switchDiv.appendChild(img);
    characterSlot.appendChild(switchDiv);
  }

  // Create username element
  const username = document.createElement("div");
  username.className = team === "op-team" ? "username op-player" : "username";
  username.textContent = "Random";

  // Create character sprite
  const sprite = document.createElement("img");
  sprite.className = "character-sprite random";
  sprite.src = "/assets/icons/random.webp";
  sprite.alt = "Random";

  // Create status element with invite functionality
  const status = document.createElement("div");
  status.className = "status invite";
  status.dataset.inviteFeedback = "inline";
  status.dataset.sound = "cursor4";
  status.dataset.volume = "0.3";
  status.textContent = "Invite";
  status.style.display = checkIfInParty() ? "" : "none";
  status.style.cursor = "pointer";
  status.style.pointerEvents = "auto";

  // Assemble the structure
  characterSlot.appendChild(username);
  characterSlot.appendChild(sprite);
  characterSlot.appendChild(status);
  platform.appendChild(characterSlot);

  // Add platform image
  const platformImage = document.createElement("div");
  platformImage.className = "platform-image";
  platformImage.style.backgroundImage = `url("${getLobbyPlatformAsset(
    getCurrentMapValue(),
  )}")`;
  platform.appendChild(platformImage);

  lobbyArea.appendChild(platform);
  refreshPlatformGrounding();
}
