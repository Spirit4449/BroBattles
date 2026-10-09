// DOM view for the static #matchmaking-overlay in index.html. Queue state and
// socket handling live in matchmakingClient.mjs; this module only renders.
import { getLobbyBgAsset, getLobbyPlatformAsset } from "../../game/maps/manifest";
import { buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { DEFAULT_CHARACTER } from "../../../shared/characters/characterStats.js";
import { refreshPlatformGrounding } from "../party/platformGrounding.mjs";

const MATCHMAKING_EXIT_MS = 190;
const ARRIVAL_MS = 1100;
const LOBBY_CHROME_SELECTOR =
  "#navbar, .lobby-party-actions, .lobby-quick-actions, #lobby-area, #bottom-bar, .bb-chat-lobby-wrap";

const isBotPlayer = (p) => !!(p?.isConfiguredBot || p?.isBot || p?.botSlotKey);
const humanKey = (p) => String(p?.name || "").trim().toLowerCase();
const SEAT_MOVE_MS = 420;

// "ally" / "enemy" relative to the viewer, or null while the team is unknown.
// Comparing against yourTeam keeps this right when the server flips a party.
const sideOf = (p, yourTeam) => (p?.team && yourTeam ? (p.team === yourTeam ? "ally" : "enemy") : null);
const halfOf = (index, total) => (index < Math.ceil(total / 2) ? "ally" : "enemy");

/** Stable identities for a roster. Bots are keyed per side, since lobby bot
    previews are renamed by the server once the match is assembled. */
function describeRoster(players, yourTeam) {
  const counts = new Map();
  return players.filter(Boolean).map((player) => {
    const side = sideOf(player, yourTeam);
    const bot = isBotPlayer(player);
    const base = bot ? `bot:${side || "any"}` : `player:${humanKey(player)}`;
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return { key: `${base}#${n}`, player, side, bot };
  });
}

export function createMatchmakingOverlay() {
  let hideTimer = null;
  let countTimer = null;
  // Per queue session: who has been seen (only later joiners play the
  // arrival), who queued from this lobby, and which seat each player holds.
  // Bots are counted rather than named for arrivals, as the server renames them.
  const session = { humans: new Set(), bots: 0, lobby: new Set(), seats: [] };
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

  function resetSession(seatedPlayers) {
    const humans = seatedPlayers.filter((p) => p && !isBotPlayer(p)).map(humanKey);
    session.humans = new Set(humans);
    session.bots = seatedPlayers.filter(isBotPlayer).length;
    session.lobby = new Set(humans);
    session.seats = [];
    const grid = document.getElementById("mm-players");
    if (grid) {
      grid.replaceChildren();
      delete grid.dataset.renderSig;
    }
  }

  /** Returns the keys of roster entries that are new this session. */
  function claimArrivals(entries) {
    const arriving = new Set();
    let bots = 0;
    for (const entry of entries) {
      if (entry.bot) {
        bots += 1;
        if (bots > session.bots) arriving.add(entry.key);
        continue;
      }
      const name = humanKey(entry.player);
      if (!session.humans.has(name)) {
        session.humans.add(name);
        arriving.add(entry.key);
      }
    }
    session.bots = Math.max(session.bots, bots);
    return arriving;
  }

  /**
   * Keeps every player in the seat they first took. Players only move when
   * their team becomes known and they sit on the wrong half; newcomers take
   * the first free seat on their side (lobby players default to the viewer's
   * side, unknown players to the emptier half).
   */
  function assignSeats(entries, total) {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    if (session.seats.length !== total) session.seats = Array(total).fill(null);
    const seats = session.seats.map((key, index) => {
      const entry = key && byKey.get(key);
      return entry && (!entry.side || entry.side === halfOf(index, total)) ? key : null;
    });
    const seated = new Set(seats.filter(Boolean));
    const freeSeat = (side) => seats.findIndex((key, index) => !key && (!side || halfOf(index, total) === side));
    const freeCount = (side) => seats.filter((key, index) => !key && halfOf(index, total) === side).length;

    const guesses = [];
    // Confirmed sides first, so a guess never holds a seat a known player needs.
    for (const entry of entries) {
      if (seated.has(entry.key)) continue;
      if (!entry.side) {
        guesses.push(entry);
        continue;
      }
      let index = freeSeat(entry.side);
      if (index < 0) {
        index = seats.findIndex((key, i) => key && halfOf(i, total) === entry.side && !byKey.get(key).side);
        if (index < 0) continue;
        guesses.push(byKey.get(seats[index]));
      }
      seats[index] = entry.key;
    }
    for (const entry of guesses) {
      const preferred = session.lobby.has(humanKey(entry.player)) && !entry.bot
        ? "ally"
        : freeCount("enemy") >= freeCount("ally") ? "enemy" : "ally";
      const index = freeSeat(preferred) >= 0 ? freeSeat(preferred) : freeSeat();
      if (index >= 0) seats[index] = entry.key;
    }
    session.seats = seats;
    return seats.map((key) => (key ? byKey.get(key) : null));
  }

  /**
   * Opens the overlay. Players in `seatedPlayers` (the lobby roster that just
   * queued together) are already on screen, so they never play the arrival.
   */
  function show({ seatedPlayers = [] } = {}) {
    const element = overlay();
    if (!element) return;
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    ensureParticles();
    if (element.classList.contains("hidden")) resetSession(seatedPlayers);
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

  function renderPlayer(p, arriving) {
    const item = document.createElement("div");
    item.className = "mm-player";
    const visual = document.createElement("div");
    visual.className = "mm-player-visual";

    const arrival = document.createElement("div");
    arrival.className = "mm-arrival-fx";
    arrival.setAttribute("aria-hidden", "true");
    arrival.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><span></span>';

    const img = document.createElement("img");
    const cls = p.char_class || DEFAULT_CHARACTER;
    const isShuffleBot = p.isConfiguredBot && cls === "shuffle";
    img.src = isShuffleBot
      ? "/assets/shuffle/shuffle1.svg"
      : String(p.selected_skin_asset_url || "").trim() || buildCharacterSkinBodyUrl(cls, p.selected_skin_id);
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
    if (arriving) {
      item.classList.add("mm-player-arriving");
      window.setTimeout(() => item.classList.remove("mm-player-arriving"), ARRIVAL_MS);
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

  const contentSig = (p) =>
    p
      ? [p.name, p.char_class, p.selected_skin_id, p.selected_skin_asset_url, p.isConfiguredBot].join(":")
      : "placeholder";

  // Seats are reconciled by identity rather than rebuilt, so re-renders never
  // restart a seat's arrival, float or success animation.
  function renderGrid(grid, { total, selection, players, yourTeam }) {
    const entries = describeRoster(players.slice(0, total), yourTeam);
    const nextSig = JSON.stringify({
      total,
      mapId: selection.mapId,
      roster: entries.map((entry) => `${entry.key}:${entry.side}:${contentSig(entry.player)}`),
    });
    if (nextSig === grid.dataset.renderSig) return;
    grid.dataset.renderSig = nextSig;

    grid.style.setProperty("--mm-slot-count", String(total));
    grid.dataset.slots = String(total);
    grid.style.setProperty("--mm-platform-image", `url("${getLobbyPlatformAsset(selection.mapId)}")`);

    const arriving = claimArrivals(entries);
    const seats = assignSeats(entries, total);
    const existing = new Map();
    const before = new Map();
    for (const item of grid.children) {
      existing.set(item.dataset.seatKey, item);
      before.set(item, item.getBoundingClientRect?.());
    }

    const items = seats.map((entry, i) => {
      const seatKey = entry ? entry.key : `placeholder@${i}`;
      const sig = contentSig(entry?.player);
      let item = existing.get(seatKey);
      if (!item || item.dataset.contentSig !== sig) {
        item = entry ? renderPlayer(entry.player, arriving.has(entry.key)) : renderPlaceholder();
        item.dataset.seatKey = seatKey;
        item.dataset.contentSig = sig;
        item.style.setProperty("--mm-slot-index", String(i));
      }
      item.dataset.team = halfOf(i, total) === "ally" ? "blue" : "red";
      return item;
    });

    // Only touch nodes that are out of place; moving a node restarts its animations.
    items.forEach((item, i) => {
      if (grid.children[i] !== item) grid.insertBefore(item, grid.children[i] || null);
    });
    while (grid.children.length > items.length) grid.lastElementChild.remove();
    glideMovedSeats(items, before);
    refreshPlatformGrounding();
  }

  // A player who switches sides once teams are final slides to the new seat.
  function glideMovedSeats(items, before) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const item of items) {
      const from = before.get(item);
      const to = item.getBoundingClientRect?.();
      if (!from || !to) continue;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      item.animate?.(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: SEAT_MOVE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
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
