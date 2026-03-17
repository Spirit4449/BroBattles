// HUD controller for battle overlays, timer, keybind help, and team status.
// Keeps DOM/UI concerns out of game scene orchestration.

export function createGameHudController({
  getGameData,
  getUsername,
  getMapBgAsset,
  onEnableInput,
  battleHelpDismissedKey = "bb_hide_keybind_hud_v1",
} = {}) {
  const teamRows = new Map(); // name -> { row }

  function _gameData() {
    return typeof getGameData === "function" ? getGameData() : null;
  }

  function _username() {
    return typeof getUsername === "function" ? getUsername() : null;
  }

  function _enableInput() {
    if (typeof onEnableInput === "function") onEnableInput();
  }

  function showBattleStartOverlay(players) {
    const root = document.getElementById("battle-start-overlay");
    if (!root) return null;

    const gameData = _gameData();
    const username = _username();

    const mapBgAsset =
      typeof getMapBgAsset === "function"
        ? getMapBgAsset(gameData?.map)
        : "/assets/lushy/gameBg.webp";

    const bg = document.getElementById("bs-bg");
    if (bg) bg.src = mapBgAsset;

    const backdrop = root.querySelector(".bs-backdrop");
    if (backdrop) {
      backdrop.style.setProperty("--bs-map-bg", `url("${mapBgAsset}")`);
    }

    const modeEl = document.getElementById("bs-mode");
    if (modeEl) {
      modeEl.textContent = `${gameData?.mode || 1}v${gameData?.mode || 1}`;
    }
    const mapEl = document.getElementById("bs-map");
    if (mapEl) mapEl.textContent = `Map ${gameData?.map || 1}`;

    const yourCol = document.getElementById("bs-your");
    const oppCol = document.getElementById("bs-opp");
    if (yourCol) yourCol.innerHTML = "";
    if (oppCol) oppCol.innerHTML = "";

    const yourTeam = (players || []).filter(
      (p) => p.team === gameData?.yourTeam,
    );
    const oppTeam = (players || []).filter(
      (p) => p.team !== gameData?.yourTeam,
    );

    const appendTile = (container, p) => {
      if (!container) return;
      const tile = document.createElement("div");
      tile.className = "bs-player";
      const img = document.createElement("img");
      const cls = (p?.char_class || "ninja").toLowerCase();
      img.src = `/assets/${cls}/body.webp`;
      img.alt = cls;
      const name = document.createElement("div");
      name.className = "bs-name";
      const nm = p?.name || "Player";
      name.textContent = nm + (nm === username ? " (You)" : "");
      tile.appendChild(img);
      tile.appendChild(name);
      container.appendChild(tile);
    };

    yourTeam.forEach((p) => appendTile(yourCol, p));
    oppTeam.forEach((p) => appendTile(oppCol, p));

    const c = document.getElementById("countdown-display");
    if (c) c.textContent = "3";

    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    const wrap = root.querySelector(".bs-wrap");
    if (wrap) requestAnimationFrame(() => (wrap.style.opacity = "1"));
    return root;
  }

  function initTimerHud() {
    const hud = document.getElementById("game-timer-hud");
    if (hud) hud.classList.add("hidden");
  }

  function updateTimerHud(remainingMs, suddenDeath) {
    const hud = document.getElementById("game-timer-hud");
    const display = document.getElementById("game-timer-display");
    const label = document.getElementById("game-timer-label");
    if (!hud) return;
    hud.classList.remove("hidden");
    const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (display) {
      display.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    }
    if (suddenDeath) {
      hud.classList.add("sudden-death");
      if (label) label.textContent = "SUDDEN DEATH";
    } else {
      hud.classList.remove("sudden-death");
      if (label) label.textContent = "Time Reamining";
    }
  }

  function showSuddenDeathBanner() {
    const existing = document.getElementById("sd-flash-banner");
    if (existing) return;
    const banner = document.createElement("div");
    banner.id = "sd-flash-banner";
    banner.textContent = "SUDDEN DEATH";
    Object.assign(banner.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%) scale(0.3)",
      fontFamily: "'Press Start 2P', cursive",
      fontSize: "clamp(28px, 6vw, 52px)",
      color: "#f87171",
      textShadow: "0 4px 0 #7f1d1d, 0 0 30px rgba(248,113,113,0.85)",
      zIndex: "10000",
      letterSpacing: "4px",
      pointerEvents: "none",
      transition:
        "transform 0.5s cubic-bezier(0.34,1.56,0.64,1), opacity 0.7s ease",
      opacity: "0",
      whiteSpace: "nowrap",
    });
    document.body.appendChild(banner);
    requestAnimationFrame(() => {
      banner.style.transform = "translate(-50%, -50%) scale(1)";
      banner.style.opacity = "1";
    });
    setTimeout(() => {
      banner.style.opacity = "0";
      banner.style.transform = "translate(-50%, -50%) scale(1.3)";
      setTimeout(() => banner.remove(), 600);
    }, 2500);
  }

  function initKeybindHud() {
    const hud = document.getElementById("battle-keybind-hud");
    const dismissBtn = document.getElementById("battle-keybind-dismiss");
    if (!hud) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(battleHelpDismissedKey) === "1";
    } catch (_) {}
    hud.classList.toggle("hidden", dismissed);

    if (!dismissBtn) return;
    dismissBtn.addEventListener("click", () => {
      hud.classList.add("hidden");
      try {
        localStorage.setItem(battleHelpDismissedKey, "1");
      } catch (_) {}
    });
  }

  function initTeamStatusHud(players) {
    const root = document.getElementById("team-status-hud");
    const grid = document.getElementById("team-status-grid");
    if (!root || !grid) return;

    const gameData = _gameData();
    const username = _username();

    grid.innerHTML = "";
    teamRows.clear();

    const list = Array.isArray(players) ? players : [];
    const sorted = [...list].sort((a, b) => {
      if (a?.name === username) return -1;
      if (b?.name === username) return 1;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });

    const makeCell = (p) => {
      const cell = document.createElement("div");
      cell.className = "team-hud-cell";
      if (!p) return cell;

      const row = document.createElement("li");
      row.className = "team-hud-player";
      if (p?.isAlive === false) row.classList.add("dead");

      const img = document.createElement("img");
      const cls = (p?.char_class || "ninja").toLowerCase();
      img.src = `/assets/${cls}/body.webp`;
      img.alt = cls;

      const nameEl = document.createElement("div");
      nameEl.className = "team-hud-player-name";
      const name = String(p?.name || "Player");
      nameEl.textContent = name + (name === username ? " (You)" : "");

      row.appendChild(img);
      row.appendChild(nameEl);
      cell.appendChild(row);
      teamRows.set(name, { row });
      return cell;
    };

    const yourTeam = sorted.filter((p) => p?.team === gameData?.yourTeam);
    const oppTeam = sorted.filter((p) => p?.team !== gameData?.yourTeam);

    const yourHeader = document.createElement("div");
    yourHeader.className = "team-hud-title";
    yourHeader.textContent = "Your Team";
    const oppHeader = document.createElement("div");
    oppHeader.className = "team-hud-title";
    oppHeader.textContent = "Other Team";
    grid.appendChild(yourHeader);
    grid.appendChild(oppHeader);

    const rows = Math.max(yourTeam.length, oppTeam.length);
    for (let i = 0; i < rows; i++) {
      grid.appendChild(makeCell(yourTeam[i]));
      grid.appendChild(makeCell(oppTeam[i]));
    }

    root.classList.toggle("hidden", sorted.length === 0);
  }

  function setTeamHudPlayerAlive(name, isAlive) {
    if (!name) return;
    const entry = teamRows.get(String(name));
    if (!entry?.row) return;
    entry.row.classList.toggle("dead", !isAlive);
  }

  function setTeamHudPlayerPresence(name, connected) {
    if (!name) return;
    const entry = teamRows.get(String(name));
    if (!entry?.row) return;
    entry.row.classList.toggle("disconnected", !connected);
  }

  function setTeamHudPlayerLoaded(name, loaded) {
    if (!name) return;
    const entry = teamRows.get(String(name));
    if (!entry?.row) return;
    entry.row.classList.toggle("loading", !loaded);
  }

  function syncTeamHudFromSnapshot(playersByName) {
    if (!playersByName || typeof playersByName !== "object") return;
    for (const [name, data] of Object.entries(playersByName)) {
      if (typeof data?.health === "number") {
        setTeamHudPlayerAlive(name, data.health > 0);
      }
      if (typeof data?.connected === "boolean") {
        setTeamHudPlayerPresence(name, data.connected);
      }
      if (typeof data?.loaded === "boolean") {
        setTeamHudPlayerLoaded(name, data.loaded);
      }
    }
  }

  function hideBattleStartOverlay() {
    const overlay = document.getElementById("battle-start-overlay");
    if (!overlay) return;
    const wrap = overlay.querySelector(".bs-wrap");
    if (wrap) wrap.style.opacity = "0";
    setTimeout(() => {
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
    }, 300);
    try {
      document.getElementById("game-timer-hud")?.classList.remove("hidden");
    } catch (_) {}
  }

  function startCountdown() {
    const countdownEl = document.getElementById("countdown-display");
    if (!countdownEl) return;

    let count = 3;

    const updateCountdown = () => {
      if (count > 0) {
        countdownEl.style.transform = "scale(0.5)";
        countdownEl.style.opacity = "0.5";

        setTimeout(() => {
          countdownEl.textContent = count;
          countdownEl.style.transform = "scale(1.2)";
          countdownEl.style.opacity = "1";
          countdownEl.style.transition =
            "transform 0.3s ease, opacity 0.3s ease";

          setTimeout(() => {
            countdownEl.style.transform = "scale(1)";
          }, 150);
        }, 50);

        count--;
        setTimeout(updateCountdown, 1000);
      } else {
        countdownEl.textContent = "FIGHT!";
        countdownEl.style.color = "#ef4444";
        countdownEl.style.transform = "scale(1.5)";

        setTimeout(() => {
          hideBattleStartOverlay();
          _enableInput();
        }, 1000);
      }
    };

    updateCountdown();
  }

  return {
    showBattleStartOverlay,
    initTimerHud,
    updateTimerHud,
    showSuddenDeathBanner,
    initKeybindHud,
    initTeamStatusHud,
    setTeamHudPlayerAlive,
    setTeamHudPlayerPresence,
    setTeamHudPlayerLoaded,
    syncTeamHudFromSnapshot,
    startCountdown,
    hideBattleStartOverlay,
  };
}
