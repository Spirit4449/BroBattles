// DOM view for the static #matchmaking-overlay in index.html. Queue state and
// socket handling live in matchmakingClient.mjs; this module only renders.
import { getLobbyBgAsset, getLobbyPlatformAsset } from "../maps/manifest";
import { buildCharacterSkinBodyUrl } from "../lib/skinAssets.js";
import { DEFAULT_CHARACTER } from "../shared/characterStats.js";
import { refreshPlatformGrounding } from "./platformGrounding.mjs";

const MATCHMAKING_EXIT_MS = 190;
const LOBBY_CHROME_SELECTOR =
  "#navbar, body > .party-button, .lobby-quick-actions, #lobby-area, #bottom-bar, .bb-chat-lobby-wrap";

export function createMatchmakingOverlay() {
  let hideTimer = null;
  let countTimer = null;
  const overlay = () => document.getElementById("matchmaking-overlay");
  const cancelButton = () => document.getElementById("mm-cancel");

  function setLobbyChromeInert(shouldBeInert) {
    document.querySelectorAll(LOBBY_CHROME_SELECTOR).forEach((element) => {
      element.inert = shouldBeInert;
    });
  }

  function ensureParticles() {
    const field = document.getElementById("mm-particles");
    if (!field || field.childElementCount) return;

    // A deterministic field keeps the scene varied without changing between
    // overlay opens or consuming animation-frame JavaScript.
    for (let index = 0; index < 38; index += 1) {
      const particle = document.createElement("i");
      const lane = (index * 37 + 11) % 101;
      const size = 2 + ((index * 13) % 6);
      const duration = 4.2 + ((index * 17) % 42) / 10;
      const delay = -((index * 29) % 86) / 10;
      const drift = -42 + ((index * 31) % 85);
      const opacity = 0.2 + ((index * 19) % 55) / 100;

      particle.style.setProperty("--mm-particle-x", `${lane}%`);
      particle.style.setProperty("--mm-particle-size", `${size}px`);
      particle.style.setProperty("--mm-particle-duration", `${duration}s`);
      particle.style.setProperty("--mm-particle-delay", `${delay}s`);
      particle.style.setProperty("--mm-particle-drift", `${drift}px`);
      particle.style.setProperty("--mm-particle-opacity", String(opacity));
      field.appendChild(particle);
    }
  }

  function show() {
    const element = overlay();
    if (!element) return;
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    ensureParticles();
    document.body.classList.remove("matchmaking-exiting");
    document.body.classList.add("matchmaking-active");
    setLobbyChromeInert(true);
    element.classList.remove("hidden");
    element.classList.remove("is-exiting");
    void element.offsetWidth;
    element.classList.add("is-visible");
    element.setAttribute("aria-hidden", "false");
  }

  function hide({ immediate = false } = {}) {
    const element = overlay();
    if (!element) return;
    if (immediate) {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      element.setAttribute("aria-hidden", "true");
      element.classList.add("hidden");
      element.classList.remove("is-visible", "is-exiting");
      document.body.classList.remove("matchmaking-active", "matchmaking-exiting");
      setLobbyChromeInert(false);
      return;
    }
    if (element.classList.contains("hidden")) {
      document.body.classList.remove("matchmaking-active", "matchmaking-exiting");
      setLobbyChromeInert(false);
      return;
    }
    element.setAttribute("aria-hidden", "true");
    element.classList.remove("is-visible");
    element.classList.add("is-exiting");
    document.body.classList.remove("matchmaking-active");
    document.body.classList.add("matchmaking-exiting");
    setLobbyChromeInert(false);

    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      element.classList.add("hidden");
      element.classList.remove("is-exiting");
      document.body.classList.remove("matchmaking-exiting");
      hideTimer = null;
    }, MATCHMAKING_EXIT_MS);
  }

  function renderPlayer(p, index, previousPlayerKeys) {
    const item = document.createElement("div");
    item.className = "mm-player";
    const visual = document.createElement("div");
    visual.className = "mm-player-visual";
    const playerKey = `${String(p.botSlotKey || p.name || "player").trim().toLowerCase()}:${index}`;
    item.dataset.playerKey = playerKey;
    if (!previousPlayerKeys.has(playerKey)) item.classList.add("mm-player-arriving");

    const arrival = document.createElement("div");
    arrival.className = "mm-arrival-fx";
    arrival.setAttribute("aria-hidden", "true");
    arrival.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><span></span>';

    const img = document.createElement("img");
    const cls = p.char_class || DEFAULT_CHARACTER;
    const isShuffleBot = p.isConfiguredBot && cls === "shuffle";
    img.src = isShuffleBot
      ? "/assets/shuffle/shuffle1.svg"
      : String(p.selected_skin_asset_url || "").trim() || buildCharacterSkinBodyUrl(cls, "");
    img.alt = isShuffleBot ? "Shuffle bot" : cls;
    img.className = `mm-character${isShuffleBot ? " bot-shuffle-icon mm-bot-shuffle-icon" : ""}`;
    const name = document.createElement("div");
    name.className = "mm-name";
    name.textContent = p.name || "Player";
    const platform = document.createElement("div");
    platform.className = "mm-platform";
    platform.setAttribute("aria-hidden", "true");

    visual.appendChild(arrival);
    visual.appendChild(img);
    visual.appendChild(platform);
    item.appendChild(visual);
    item.appendChild(name);
    if (item.classList.contains("mm-player-arriving")) {
      window.setTimeout(() => {
        item.classList.remove("mm-player-arriving");
      }, 1100);
    }
    return item;
  }

  function renderPlaceholder() {
    const item = document.createElement("div");
    item.className = "mm-player placeholder";
    const visual = document.createElement("div");
    visual.className = "mm-player-visual";
    const beacon = document.createElement("div");
    beacon.className = "mm-slot-beacon";
    beacon.setAttribute("aria-hidden", "true");
    beacon.innerHTML = "<i></i><i></i><i></i>";
    const name = document.createElement("div");
    name.className = "mm-name";
    name.textContent = "Searching";
    const platform = document.createElement("div");
    platform.className = "mm-platform";
    platform.setAttribute("aria-hidden", "true");
    visual.appendChild(beacon);
    visual.appendChild(platform);
    item.appendChild(visual);
    item.appendChild(name);
    return item;
  }

  function renderGrid(grid, { total, selection, players, yourTeam }) {
    const nextSig = JSON.stringify({
      total,
      mapId: selection.mapId,
      players: players.map(
        (p) =>
          `${p?.name || ""}:${p?.char_class || ""}:${p?.selected_skin_id || ""}:${p?.selected_skin_asset_url || ""}`,
      ),
    });
    if (nextSig === grid.dataset.renderSig) return;
    grid.dataset.renderSig = nextSig;

    const previousPlayerKeys = new Set(
      Array.from(grid.querySelectorAll(".mm-player[data-player-key]")).map((item) => item.dataset.playerKey),
    );
    grid.innerHTML = "";
    grid.style.setProperty("--mm-slot-count", String(total));
    grid.dataset.slots = String(total);
    grid.style.setProperty("--mm-platform-image", `url("${getLobbyPlatformAsset(selection.mapId)}")`);

    for (let i = 0; i < total; i++) {
      const p = players[i];
      const item = p ? renderPlayer(p, i, previousPlayerKeys) : renderPlaceholder();
      item.style.setProperty("--mm-slot-index", String(i));
      item.dataset.team = p?.team
        ? p.team === yourTeam ? "blue" : "red"
        : i < Math.ceil(total / 2) ? "blue" : "red";
      grid.appendChild(item);
    }
    refreshPlatformGrounding();
  }

  /**
   * Renders the current queue snapshot. Returns null without an overlay
   * element, otherwise whether this render switched it into the found state.
   */
  function render({ found, total, selection, players, yourTeam, full }) {
    const element = overlay();
    let result = null;
    if (element) {
      const previousState = element.dataset.state;
      element.dataset.state = full ? "ready" : "searching";
      element.style.setProperty("--mm-map-background", `url("${getLobbyBgAsset(selection.mapId)}")`);
      result = { becameFull: full && previousState !== "ready" };
    }
    const headingEl = document.getElementById("mm-heading");
    const labelEl = document.querySelector(".mm-progress .mm-label");
    const foundEl = document.getElementById("mm-found");
    const totalEl = document.getElementById("mm-total");
    const grid = document.getElementById("mm-players");
    if (headingEl) headingEl.textContent = full ? "Match Found" : "Matchmaking";
    if (labelEl) labelEl.textContent = full ? "Starting" : "Players";
    if (foundEl && foundEl.textContent !== String(found)) {
      foundEl.textContent = String(found);
      foundEl.classList.remove("is-updating");
      void foundEl.offsetWidth;
      foundEl.classList.add("is-updating");
      if (countTimer) window.clearTimeout(countTimer);
      countTimer = window.setTimeout(() => {
        foundEl.classList.remove("is-updating");
        countTimer = null;
      }, 520);
    }
    if (totalEl) totalEl.textContent = String(total);
    if (grid) renderGrid(grid, { total, selection, players, yourTeam });
    return result;
  }

  function bindOnce(id, handler) {
    const button = document.getElementById(id);
    if (!button || button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", handler);
  }

  return {
    exists: () => !!overlay(),
    isHidden: () => {
      const element = overlay();
      return !element || element.classList.contains("hidden");
    },
    show,
    hide,
    render,
    isCancelDisabled: () => !!cancelButton()?.disabled,
    setCancelDisabled(disabled) {
      const button = cancelButton();
      if (button) button.disabled = disabled;
    },
    bindControls({ onCancel, onFillBots, onFillBotsUnlimited }) {
      bindOnce("mm-cancel", onCancel);
      bindOnce("mm-fill-bots", onFillBots);
      bindOnce("mm-fill-bots-unlimited", onFillBotsUnlimited);
    },
    setAdminControlsVisible(visible) {
      document.getElementById("mm-fill-bots")?.classList.toggle("hidden", !visible);
      document.getElementById("mm-fill-bots-unlimited")?.classList.toggle("hidden", !visible);
    },
  };
}
