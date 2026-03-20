// HUD controller for battle overlays, timer, keybind help, and team status.
// Keeps DOM/UI concerns out of game scene orchestration.

import { playSound } from "../lib/uiSounds.js";

export function createGameHudController({
  getGameData,
  getUsername,
  getMapBgAsset,
  onEnableInput,
  onCountdownFight,
  getScene,
  battleHelpDismissedKey = "bb_hide_keybind_hud_v1",
} = {}) {
  const teamRows = new Map(); // name -> { row }
  let cardCatalog = null;
  let cardCatalogFetchPromise = null;
  let introSequencePromise = null;
  let countdownRunning = false;
  let deferGameplayHudReveal = false;
  let currentCardNodes = [];

  function _fallbackCatalog() {
    return {
      defaultCardId: "default",
      cards: [
        {
          id: "default",
          name: "Default Card",
          assetUrl: "/assets/player-cards/default.webp",
        },
      ],
    };
  }

  async function _ensureCardCatalog() {
    if (cardCatalog) return cardCatalog;
    if (cardCatalogFetchPromise) return cardCatalogFetchPromise;

    cardCatalogFetchPromise = fetch("/player-cards/catalog", {
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const catalog = data?.catalog;
        if (catalog && Array.isArray(catalog.cards) && catalog.cards.length) {
          cardCatalog = catalog;
        } else {
          cardCatalog = _fallbackCatalog();
        }
        return cardCatalog;
      })
      .catch(() => {
        cardCatalog = _fallbackCatalog();
        return cardCatalog;
      })
      .finally(() => {
        cardCatalogFetchPromise = null;
      });

    return cardCatalogFetchPromise;
  }

  function _resolveCard(catalog, selectedCardId) {
    const list = Array.isArray(catalog?.cards) ? catalog.cards : [];
    const wanted = String(selectedCardId || "").trim();
    const bySelected = wanted
      ? list.find((card) => String(card?.id) === wanted)
      : null;
    if (bySelected) return bySelected;
    const def = String(catalog?.defaultCardId || "").trim();
    if (def) {
      const byDefault = list.find((card) => String(card?.id) === def);
      if (byDefault) return byDefault;
    }
    return list[0] || _fallbackCatalog().cards[0];
  }

  function _createPlayerCardElement({ player, username, side, catalog }) {
    const root = document.createElement("div");
    root.className = `bs-player-card ${side === "your" ? "your" : "opp"}`;

    const card = _resolveCard(catalog, player?.selected_card_id);

    const floatDuration = 3.8 + Math.random() * 2.2;
    const floatDelay = Math.random() * 1.9;
    root.style.setProperty("--float-duration", `${floatDuration.toFixed(2)}s`);
    root.style.setProperty("--float-delay", `${floatDelay.toFixed(2)}s`);

    const frame = document.createElement("img");
    frame.className = "bs-card-frame";
    frame.src = card?.assetUrl || "/assets/player-cards/default.webp";
    frame.alt = card?.name || "Player Card";

    const nameEl = document.createElement("div");
    nameEl.className = "bs-card-player-name";
    const nm = String(player?.name || "Player");
    nameEl.textContent = nm + (nm === username ? " (You)" : "");

    const charNameEl = document.createElement("div");
    charNameEl.className = "bs-card-character-name";
    charNameEl.textContent = String(player?.char_class || "default");

    const spriteWrap = document.createElement("div");
    spriteWrap.className = "bs-card-sprite-wrap";
    const sprite = document.createElement("img");
    sprite.className = "bs-card-sprite";
    const cls = String(player?.char_class || "").toLowerCase();
    if (cls) {
      sprite.src = `/assets/${cls}/body.webp`;
      sprite.alt = cls;
    } else {
      sprite.src = card?.assetUrl || "/assets/player-cards/default.webp";
      sprite.alt = "default";
    }
    sprite.onerror = () => {
      sprite.onerror = null;
      sprite.src = card?.assetUrl || "/assets/player-cards/default.webp";
    };
    spriteWrap.appendChild(sprite);

    const statsRow = document.createElement("div");
    statsRow.className = "bs-card-stats";
    statsRow.innerHTML = `<div class="bs-card-stat-label">Character Level</div><div class="bs-card-stat-value">${Number(player?.level) || 1}</div>`;

    root.appendChild(frame);
    root.appendChild(nameEl);
    root.appendChild(charNameEl);
    root.appendChild(spriteWrap);
    root.appendChild(statsRow);
    return root;
  }

  function _animateCardsIn(entries) {
    entries.forEach((node) => node.classList.remove("is-in"));
    requestAnimationFrame(() => {
      entries.forEach((node) => node.classList.add("is-in"));
    });
  }

  function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function _isOverlayVisible() {
    const overlay = document.getElementById("battle-start-overlay");
    return !!overlay && !overlay.classList.contains("hidden");
  }

  async function _runIntroSequence() {
    if (introSequencePromise) return introSequencePromise;

    const root = document.getElementById("battle-start-overlay");
    if (!root) return;

    introSequencePromise = (async () => {
      root.classList.add("phase-cinematic");
      root.classList.remove("phase-darkened", "phase-cards");

      // 1 second of darkness before cards appear
      await _sleep(1000);

      root.classList.add("phase-darkened", "phase-cards");
      await _sleep(40);
      _animateCardsIn(currentCardNodes);
    })();

    return introSequencePromise;
  }

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

    root.dataset.teamSize = String(Number(gameData?.mode) || 1);

    const mapMode = document.getElementById("bs-map-mode");
    if (mapMode) {
      const mapId = Number(gameData?.map) || 1;
      const mapName =
        mapId === 1
          ? "Lushy Peaks"
          : mapId === 2
            ? "Mangrove Meadow"
            : mapId === 3
              ? "Serenity"
              : `Map ${mapId}`;
      const teamMode = `${Math.max(1, Number(gameData?.mode) || 1)}v${Math.max(
        1,
        Number(gameData?.mode) || 1,
      )}`;
      mapMode.textContent = `${mapName} • ${teamMode}`;
    }

    deferGameplayHudReveal = true;

    try {
      const timerHud = document.getElementById("game-timer-hud");
      const teamHud = document.getElementById("team-status-hud");
      timerHud?.classList.add("hidden", "hud-intro-enter");
      teamHud?.classList.add("hidden", "hud-intro-enter");
      timerHud?.classList.remove("in");
      teamHud?.classList.remove("in");
    } catch (_) {}

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

    const renderPlayers = (catalog) => {
      if (yourCol) yourCol.innerHTML = "";
      if (oppCol) oppCol.innerHTML = "";

      const yourNodes = [];
      const oppNodes = [];

      yourTeam.forEach((p) => {
        if (!yourCol) return;
        const node = _createPlayerCardElement({
          player: p,
          username,
          side: "your",
          catalog,
        });
        yourCol.appendChild(node);
        yourNodes.push(node);
      });
      oppTeam.forEach((p) => {
        if (!oppCol) return;
        const node = _createPlayerCardElement({
          player: p,
          username,
          side: "opp",
          catalog,
        });
        oppCol.appendChild(node);
        oppNodes.push(node);
      });

      currentCardNodes = [...yourNodes, ...oppNodes];
    };

    renderPlayers(cardCatalog || _fallbackCatalog());
    _ensureCardCatalog().then((catalog) => {
      const stillVisible = !root.classList.contains("hidden");
      if (!stillVisible) return;
      renderPlayers(catalog || _fallbackCatalog());
    });

    const c = document.getElementById("countdown-display");
    if (c) c.textContent = "5";

    root.classList.remove("hidden");
    root.classList.remove("phase-darkened", "phase-cards");
    root.classList.add("phase-cinematic");
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
    if (!deferGameplayHudReveal) {
      hud.classList.remove("hidden");
    }
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

    if (deferGameplayHudReveal) {
      root.classList.add("hidden");
    } else {
      root.classList.toggle("hidden", sorted.length === 0);
    }
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
      overlay.classList.remove(
        "phase-cinematic",
        "phase-darkened",
        "phase-cards",
      );

      deferGameplayHudReveal = false;
      try {
        const timerHud = document.getElementById("game-timer-hud");
        const teamHud = document.getElementById("team-status-hud");
        timerHud?.classList.remove("hidden");
        teamHud?.classList.remove("hidden");
        requestAnimationFrame(() => {
          timerHud?.classList.add("in");
          teamHud?.classList.add("in");
        });
      } catch (_) {}
    }, 300);
  }

  function startCountdown(seconds = 7) {
    if (countdownRunning) return;
    countdownRunning = true;

    const countdownEl = document.getElementById("countdown-display");
    if (!countdownEl) {
      countdownRunning = false;
      return;
    }

    // Start intro sequence in parallel so countdown stays aligned to server start.
    // Intro runs for 1 second (darkness), then shows cards and countdown starts
    _runIntroSequence().catch(() => {});

    const totalSeconds = Math.max(1, Number(seconds) || 7);
    const introDuration = 1000; // 1 second of darkness before countdown
    const countdownDuration = totalSeconds - introDuration / 1000; // 6 seconds for countdown (5, 4, 3, 2, 1, FIGHT)

    const runCountdown = () => {
      // Wait for intro darkness to complete, then start countdown
      setTimeout(() => {
        // Countdown: 5, 4, 3, 2, 1, FIGHT
        const numbers = [5, 4, 3, 2, 1];
        let displayIndex = 0;

        const displayNext = () => {
          if (displayIndex < numbers.length) {
            const num = numbers[displayIndex];

            // Animate in
            countdownEl.style.transform = "translate(-50%, -50%) scale(0.5)";
            countdownEl.style.opacity = "0.5";

            setTimeout(() => {
              countdownEl.textContent = num;
              playSound("beep", 0.6);
              countdownEl.style.transform = "translate(-50%, -50%) scale(1.2)";
              countdownEl.style.opacity = "1";
              countdownEl.style.transition =
                "transform 0.3s ease, opacity 0.3s ease";

              setTimeout(() => {
                countdownEl.style.transform = "translate(-50%, -50%) scale(1)";
              }, 150);
            }, 50);

            displayIndex++;
            setTimeout(displayNext, 1000);
          } else {
            // Show FIGHT
            countdownEl.textContent = "FIGHT!";
            countdownEl.style.color = "#ef4444";
            countdownEl.style.transform = "translate(-50%, -50%) scale(1.5)";
            playSound("start", 0.8);

            try {
              if (typeof onCountdownFight === "function") {
                onCountdownFight();
              }
            } catch (_) {}

            // Immediately hide overlay, enable input
            hideBattleStartOverlay();
            _enableInput();
            introSequencePromise = null;
            countdownRunning = false;
          }
        };

        displayNext();
      }, introDuration);
    };

    runCountdown();
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
    isBattleIntroActive: () => countdownRunning || _isOverlayVisible(),
    startCountdown,
    hideBattleStartOverlay,
  };
}
