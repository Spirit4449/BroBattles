// HUD controller for battle overlays, timer, keybind help, and team status.
// Keeps DOM/UI concerns out of game scene orchestration.

import { playSound } from "../lib/uiSounds.js";
import {
  getMapLabel,
  getSelectionDisplayLabel,
  normalizeGameSelection,
  selectionToLegacyMode,
} from "../lib/gameSelectionCatalog.js";
import {
  buildProfileIconAlt,
  buildProfileIconUrl,
} from "../lib/profileIconAssets.js";

function legacyModeToVariantId(mode) {
  const numeric = Number(mode);
  if (numeric === 2) return "duels-2v2";
  if (numeric === 3) return "duels-3v3";
  return "duels-1v1";
}

function getSelectionFromGameData(gameData) {
  return normalizeGameSelection({
    modeId: gameData?.modeId || "duels",
    modeVariantId:
      gameData?.modeVariantId ||
      (gameData?.modeId ? null : legacyModeToVariantId(gameData?.mode)),
    mapId: gameData?.map ?? null,
  });
}

export function createGameHudController({
  getGameData,
  getUsername,
  getMapBgAsset,
  onEnableInput,
  onCountdownFight,
  getScene,
  controlsHudStateKey = "bb_controls_hud_state_v2",
} = {}) {
  const teamRows = new Map(); // name -> { row }
  let cardCatalog = null;
  let cardCatalogFetchPromise = null;
  let introSequencePromise = null;
  let countdownRunning = false;
  let deferGameplayHudReveal = false;
  let currentCardNodes = [];
  let timerPaused = false;
  let lastModeAlertAt = 0;
  let lastModeAlertEventAt = 0;
  let noticeAutoCloseTimer = null;

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

    const trophyRow = document.createElement("div");
    trophyRow.className = "bs-card-trophies";
    const trophyIcon = document.createElement("img");
    trophyIcon.className = "bs-card-trophy-icon";
    trophyIcon.src = "/assets/trophy.webp";
    trophyIcon.alt = "Trophies";
    trophyIcon.onerror = () => {
      trophyIcon.onerror = null;
      trophyIcon.style.display = "none";
    };
    const trophyValue = document.createElement("span");
    trophyValue.className = "bs-card-trophy-value";
    trophyValue.textContent = String(Number(player?.trophies) || 0);
    trophyRow.appendChild(trophyIcon);
    trophyRow.appendChild(trophyValue);

    const levelBadge = document.createElement("div");
    levelBadge.className = "bs-card-level-badge";
    const levelIcon = document.createElement("img");
    const level = Math.max(1, Math.min(5, Number(player?.level) || 1));
    levelIcon.src = `/assets/levels/${level}.webp`;
    levelIcon.alt = `Character level ${level}`;
    levelIcon.onerror = () => {
      levelIcon.onerror = null;
      levelIcon.style.display = "none";
      levelBadge.textContent = String(level);
    };
    levelBadge.appendChild(levelIcon);

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
    const healthValue = Math.max(
      0,
      Math.round(Number(player?.stats?.health) || 0),
    );
    const damageValue = Math.max(
      0,
      Math.round(Number(player?.stats?.damage) || 0),
    );
    const specialValue = Math.max(
      0,
      Math.round(Number(player?.stats?.specialDamage) || 0),
    );

    statsRow.innerHTML = `
      <div class="bs-card-stat-pill" title="Health">
        <img src="/assets/heart.webp" alt="Health" class="bs-card-stat-icon" onerror="this.style.display='none'">
        <span class="bs-card-stat-number">${healthValue}</span>
      </div>
      <div class="bs-card-stat-pill" title="Attack">
        <img src="/assets/attack.webp" alt="Attack" class="bs-card-stat-icon" onerror="this.style.display='none'">
        <span class="bs-card-stat-number">${damageValue}</span>
      </div>
      <div class="bs-card-stat-pill" title="Special">
        <img src="/assets/special.webp" alt="Special" class="bs-card-stat-icon" onerror="this.style.display='none'">
        <span class="bs-card-stat-number">${specialValue}</span>
      </div>`;

    root.appendChild(frame);
    root.appendChild(nameEl);
    root.appendChild(trophyRow);
    root.appendChild(levelBadge);
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

  function _syncCardWrapState(root) {
    if (!root) return;
    const columns = Array.from(root.querySelectorAll(".bs-col"));
    let resolvedSize = null;
    const targetSlots = 3;

    for (const col of columns) {
      const cards = Array.from(col.querySelectorAll(".bs-player-card"));
      if (!cards.length) continue;

      const colWidth =
        Number(col.clientWidth) ||
        Number(col.getBoundingClientRect().width) ||
        0;
      if (colWidth <= 0) continue;

      const styles = window.getComputedStyle(col);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
      const candidate =
        (colWidth - gap * (targetSlots - 1)) / Math.max(1, targetSlots);
      if (!Number.isFinite(candidate) || candidate <= 0) continue;

      resolvedSize =
        resolvedSize == null ? candidate : Math.min(resolvedSize, candidate);
    }

    if (resolvedSize == null) {
      root.style.removeProperty("--bs-card-size");
      return;
    }

    const px = Math.max(88, Math.min(245, Math.floor(resolvedSize)));
    root.style.setProperty("--bs-card-size", `${px}px`);
  }

  function _syncVisibleOverlayCardSize() {
    const root = document.getElementById("battle-start-overlay");
    if (!root || root.classList.contains("hidden")) return;
    _syncCardWrapState(root);
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
      showTopHudFade();
      showWaitingForPlayersBanner();
      try {
        const teamHud = document.getElementById("team-status-hud");
        teamHud?.classList.remove("hidden");
        teamHud?.classList.add("hud-intro-enter");
        requestAnimationFrame(() => {
          teamHud?.classList.add("in");
        });
      } catch (_) {}
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
    const selection = getSelectionFromGameData(gameData);

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

    root.dataset.teamSize = String(selectionToLegacyMode(selection));

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
      mapMode.textContent = `${mapName} - ${teamMode}`;
    }

    if (mapMode) {
      mapMode.textContent = `${getMapLabel(selection.mapId || gameData?.map)} - ${getSelectionDisplayLabel(selection)}`;
    }

    deferGameplayHudReveal = false;

    try {
      const timerHud = document.getElementById("game-timer-hud");
      const teamHud = document.getElementById("team-status-hud");
      timerHud?.classList.add("hidden", "hud-intro-enter");
      teamHud?.classList.add("hidden");
      teamHud?.classList.remove("in");
      teamHud?.classList.add("hud-intro-enter");
      timerHud?.classList.remove("in");
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
      requestAnimationFrame(() => _syncCardWrapState(root));
      requestAnimationFrame(() => _syncCardWrapState(root));
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
    requestAnimationFrame(_syncVisibleOverlayCardSize);
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
    if (timerPaused) {
      if (label) label.textContent = "Paused (Editor)";
      return;
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
      if (label) label.textContent = "Time Remaining";
    }
  }

  function _setVaultRow(teamKey, vault, yourTeam) {
    const row = document.getElementById(`bank-bust-${teamKey}`);
    if (!row || !vault) return;
    row.classList.toggle("friendly", yourTeam === teamKey);
    row.classList.toggle("enemy", yourTeam && yourTeam !== teamKey);
    const label = row.querySelector(".bank-bust-vault-label");
    const value = row.querySelector(".bank-bust-vault-value");
    const fill = row.querySelector(".bank-bust-vault-fill");
    const hp = Math.max(0, Number(vault?.health) || 0);
    const maxHp = Math.max(1, Number(vault?.maxHealth) || 1);
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    if (label) {
      label.textContent = yourTeam === teamKey ? "Vault" : "Vault";
    }
    if (value) value.textContent = `${hp} / ${maxHp}`;
    if (fill) {
      fill.style.width = hp <= 0 ? "0%" : `${(ratio * 100).toFixed(1)}%`;
    }
  }

  function _setTeamGold(teamKey, amount) {
    const row = document.getElementById(`bank-bust-${teamKey}`);
    const value = row?.querySelector(".bank-bust-gold-value");
    if (value) value.textContent = `${Math.max(0, Number(amount) || 0)}`;
  }

  function _showVaultAlert(event, yourTeam) {
    const root = document.getElementById("bank-bust-alert");
    if (!root || !event) return;
    const eventAt = Number(event?.at) || 0;
    if (eventAt && eventAt <= lastModeAlertEventAt) return;
    const now = Date.now();
    if (now - lastModeAlertAt < 20000) return;
    lastModeAlertAt = now;
    lastModeAlertEventAt = eventAt || now;
    const attackedOwnVault = yourTeam && event?.targetTeam === yourTeam;
    root.textContent = attackedOwnVault
      ? "Your Vault is under attack!"
      : "Enemy Vault under attack!";
    root.classList.remove("hidden", "enemy-alert", "friendly-alert");
    root.classList.add(attackedOwnVault ? "friendly-alert" : "enemy-alert");
    root.classList.add("show");
    setTimeout(() => {
      root.classList.remove("show");
      root.classList.add("hidden");
    }, 1600);
  }

  function syncModeState(modeState, yourTeam = null) {
    const hud = document.getElementById("bank-bust-hud");
    if (!hud) return;
    if (!modeState || String(modeState?.type) !== "bank-bust") {
      hud.classList.add("hidden");
      return;
    }
    hud.classList.remove("hidden");
    _setVaultRow("team1", modeState?.vaults?.team1, yourTeam);
    _setVaultRow("team2", modeState?.vaults?.team2, yourTeam);
    _setTeamGold("team1", modeState?.teamGold?.team1);
    _setTeamGold("team2", modeState?.teamGold?.team2);
    if (modeState?.lastVaultDamageEvent?.at) {
      _showVaultAlert(modeState.lastVaultDamageEvent, yourTeam);
    }
  }

  function showSuddenDeathBanner() {
    if (window.__BB_MAP_EDIT_ACTIVE) return;
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

  function showStatusBanner(text, { variant = "info" } = {}) {
    if (window.__BB_MAP_EDIT_ACTIVE) return;
    const banner = document.getElementById("game-status-banner");
    const textEl = document.getElementById("game-status-banner-text");
    if (!banner || !textEl) return;
    textEl.textContent = String(text || "");
    banner.classList.remove("hidden", "variant-info", "variant-danger");
    banner.classList.add(
      variant === "danger" ? "variant-danger" : "variant-info",
    );
    requestAnimationFrame(() => {
      banner.classList.add("show");
    });
  }

  function hideStatusBanner() {
    const banner = document.getElementById("game-status-banner");
    if (!banner) return;
    banner.classList.remove("show");
    setTimeout(() => {
      if (!banner.classList.contains("show")) {
        banner.classList.add("hidden");
      }
    }, 220);
  }

  function showWaitingForPlayersBanner() {
    showStatusBanner("Waiting for other players...", { variant: "info" });
  }

  function hideWaitingForPlayersBanner() {
    const banner = document.getElementById("game-status-banner");
    const textEl = document.getElementById("game-status-banner-text");
    if (!banner || !textEl) return;
    if (textEl.textContent === "Waiting for other players...") {
      hideStatusBanner();
    }
  }

  function showSpectatingBanner() {
    showStatusBanner("You Died", { variant: "danger" });
  }

  function hideSpectatingBanner() {
    const textEl = document.getElementById("game-status-banner-text");
    if (!textEl) return;
    if (textEl.textContent === "You Died") {
      hideStatusBanner();
    }
  }

  function _setTopHudFadeVisible(visible, { immediate = false } = {}) {
    const fade = document.getElementById("top-hud-fade");
    if (!fade) return;
    if (immediate) fade.classList.add("no-transition");
    else fade.classList.remove("no-transition");
    fade.classList.toggle("is-faded", !visible);
    if (immediate) {
      requestAnimationFrame(() => {
        fade.classList.remove("no-transition");
      });
    }
  }

  function showTopHudFade(options = {}) {
    _setTopHudFadeVisible(true, options);
  }

  function hideTopHudFade(options = {}) {
    _setTopHudFadeVisible(false, options);
  }

  function hideSystemNotice() {
    const overlay = document.getElementById("game-notice-overlay");
    if (!overlay) return;
    overlay.classList.remove("show", "tone-error", "tone-info");
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    if (noticeAutoCloseTimer) {
      clearTimeout(noticeAutoCloseTimer);
      noticeAutoCloseTimer = null;
    }
  }

  function showSystemNotice({
    title,
    message,
    buttonText = "OK",
    tone = "info",
    autoCloseMs = 0,
    onConfirm = null,
    confirmOnAutoClose = false,
  } = {}) {
    if (window.__BB_MAP_EDIT_ACTIVE) return null;
    const overlay = document.getElementById("game-notice-overlay");
    const titleEl = document.getElementById("game-notice-title");
    const messageEl = document.getElementById("game-notice-message");
    const buttonEl = document.getElementById("game-notice-button");
    if (!overlay || !titleEl || !messageEl || !buttonEl) return null;

    hideSystemNotice();

    titleEl.textContent = String(title || "Notice");
    messageEl.textContent = String(message || "");
    buttonEl.textContent = String(buttonText || "OK");
    overlay.classList.remove("hidden", "tone-error", "tone-info");
    overlay.classList.add(tone === "error" ? "tone-error" : "tone-info");
    overlay.setAttribute("aria-hidden", "false");

    const finish = () => {
      hideSystemNotice();
      if (typeof onConfirm === "function") {
        try {
          onConfirm();
        } catch (_) {}
      }
    };

    buttonEl.onclick = finish;
    requestAnimationFrame(() => {
      overlay.classList.add("show");
    });

    if (autoCloseMs > 0) {
      noticeAutoCloseTimer = setTimeout(
        () => {
          if (confirmOnAutoClose) {
            finish();
            return;
          }
          hideSystemNotice();
        },
        Math.max(400, Number(autoCloseMs) || 0),
      );
    }

    return { close: hideSystemNotice };
  }

  function initKeybindHud() {
    const hud = document.getElementById("battle-keybind-hud");
    const toggleBtn = document.getElementById("battle-keybind-toggle");
    const closeBtn = document.getElementById("battle-keybind-close");
    if (!hud) return;

    const applyExpandedState = (expanded, persist = true) => {
      hud.classList.remove("hidden");
      hud.dataset.state = expanded ? "expanded" : "collapsed";
      if (toggleBtn) {
        toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
        toggleBtn.setAttribute(
          "aria-label",
          expanded ? "Controls expanded" : "Show controls",
        );
      }
      if (!persist) return;
      try {
        localStorage.setItem(
          controlsHudStateKey,
          expanded ? "expanded" : "collapsed",
        );
      } catch (_) {}
    };

    let expanded = true;
    try {
      expanded = localStorage.getItem(controlsHudStateKey) !== "collapsed";
    } catch (_) {}
    applyExpandedState(expanded, false);

    toggleBtn?.addEventListener("click", () => {
      applyExpandedState(hud.dataset.state !== "expanded");
    });
    closeBtn?.addEventListener("click", () => {
      applyExpandedState(false);
    });
  }

  function initTeamStatusHud(players) {
    const root = document.getElementById("team-status-hud");
    const leftStack = document.getElementById("team-status-left");
    const rightStack = document.getElementById("team-status-right");
    if (!root || !leftStack || !rightStack) return;

    const gameData = _gameData();
    const username = _username();

    leftStack.innerHTML = "";
    rightStack.innerHTML = "";
    teamRows.clear();

    const list = Array.isArray(players) ? players : [];
    const sorted = [...list].sort((a, b) => {
      if (a?.name === username) return -1;
      if (b?.name === username) return 1;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });

    const healthColorForRatio = (ratio) => {
      if (ratio <= 0.24) return "#f87171";
      if (ratio <= 0.55) return "#fbbf24";
      return "#34d399";
    };

    const applyHealthState = (entry, health, maxHealth = null) => {
      if (!entry?.row) return;
      if (Number.isFinite(Number(maxHealth)) && Number(maxHealth) > 0) {
        entry.maxHealth = Number(maxHealth);
      }
      if (Number.isFinite(Number(health))) {
        entry.currentHealth = Number(health);
      }
      const current = Math.max(0, Number(entry.currentHealth) || 0);
      const max = Math.max(1, Number(entry.maxHealth) || 1);
      const ratio = Math.max(0, Math.min(1, current / max));
      entry.row.style.setProperty("--health-ratio", String(ratio));
      entry.row.style.setProperty(
        "--health-accent",
        healthColorForRatio(ratio),
      );
      setTeamHudPlayerAlive(entry.name, current > 0);
    };

    const yourTeam = sorted.filter((p) => p?.team === gameData?.yourTeam);
    const oppTeam = sorted.filter((p) => p?.team !== gameData?.yourTeam);

    const buildPlayerNode = (p) => {
      const row = document.createElement("div");
      row.className = "team-hud-player";
      const isFriendly = p?.team === gameData?.yourTeam;
      row.classList.add(isFriendly ? "friendly" : "enemy");
      const avatarRing = document.createElement("div");
      avatarRing.className = "team-hud-avatar-ring";
      const avatarCore = document.createElement("div");
      avatarCore.className = "team-hud-avatar-core";
      const img = document.createElement("img");
      const cls = (p?.char_class || "ninja").toLowerCase();
      const profileIconId = String(p?.profile_icon_id || "") || null;
      img.src = buildProfileIconUrl(profileIconId, cls);
      img.alt = buildProfileIconAlt(profileIconId, cls);
      const cross = document.createElement("div");
      cross.className = "team-hud-cross";
      cross.textContent = "X";
      const youTag = document.createElement("div");
      youTag.className = "team-hud-you-tag";
      youTag.textContent = "You";
      const nameEl = document.createElement("div");
      nameEl.className = "team-hud-player-name";
      const name = String(p?.name || "Player");
      nameEl.textContent = name;

      avatarCore.appendChild(img);
      avatarCore.appendChild(cross);
      if (name === username) {
        avatarCore.appendChild(youTag);
      }
      avatarRing.appendChild(avatarCore);
      row.appendChild(avatarRing);
      row.appendChild(nameEl);

      const entry = {
        name,
        row,
        maxHealth: Number(p?.stats?.health) || Number(p?.health) || 1,
        currentHealth:
          typeof p?.health === "number"
            ? Number(p.health)
            : Number(p?.stats?.health) || 1,
      };
      teamRows.set(name, entry);

      if (p?.connected === false) row.classList.add("disconnected");
      if (p?.loaded !== true) row.classList.add("loading");
      applyHealthState(entry, entry.currentHealth, entry.maxHealth);
      return row;
    };

    yourTeam.forEach((playerData) => {
      leftStack.appendChild(buildPlayerNode(playerData));
    });
    oppTeam.forEach((playerData) => {
      rightStack.appendChild(buildPlayerNode(playerData));
    });

    root.classList.toggle("hidden", sorted.length === 0);
  }

  function setTeamHudPlayerAlive(name, isAlive) {
    if (!name) return;
    const entry = teamRows.get(String(name));
    if (!entry?.row) return;
    const shouldBeDead = !isAlive;
    const wasDead = entry.row.classList.contains("dead");
    entry.row.classList.toggle("dead", shouldBeDead);
    if (shouldBeDead) {
      entry.row.style.setProperty("--health-ratio", "0");
    }
    if (shouldBeDead && !wasDead) {
      entry.row.classList.remove("death-pop");
      void entry.row.offsetWidth;
      entry.row.classList.add("death-pop");
      setTimeout(() => {
        entry.row?.classList?.remove("death-pop");
      }, 360);
    }
  }

  function setTeamHudPlayerHealth(name, health, maxHealth = null) {
    if (!name) return;
    const entry = teamRows.get(String(name));
    if (!entry?.row) return;
    if (Number.isFinite(Number(maxHealth)) && Number(maxHealth) > 0) {
      entry.maxHealth = Number(maxHealth);
    }
    if (!Number.isFinite(Number(health))) return;
    entry.currentHealth = Number(health);
    const current = Math.max(0, entry.currentHealth);
    const max = Math.max(1, Number(entry.maxHealth) || 1);
    const ratio = Math.max(0, Math.min(1, current / max));
    let accent = "#34d399";
    if (ratio <= 0.24) accent = "#f87171";
    else if (ratio <= 0.55) accent = "#fbbf24";
    entry.row.style.setProperty("--health-ratio", String(ratio));
    entry.row.style.setProperty("--health-accent", accent);
    setTeamHudPlayerAlive(name, current > 0);
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
        setTeamHudPlayerHealth(name, data.health);
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
        hideWaitingForPlayersBanner();
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

  function setTimerPaused(paused) {
    timerPaused = !!paused;
    if (!timerPaused) {
      const label = document.getElementById("game-timer-label");
      if (label) label.textContent = "Time Remaining";
    }
  }

  window.addEventListener("resize", _syncVisibleOverlayCardSize);

  return {
    showBattleStartOverlay,
    initTimerHud,
    updateTimerHud,
    showSuddenDeathBanner,
    showStatusBanner,
    hideStatusBanner,
    showWaitingForPlayersBanner,
    hideWaitingForPlayersBanner,
    showSpectatingBanner,
    hideSpectatingBanner,
    showTopHudFade,
    hideTopHudFade,
    showSystemNotice,
    hideSystemNotice,
    initKeybindHud,
    initTeamStatusHud,
    setTeamHudPlayerAlive,
    setTeamHudPlayerHealth,
    setTeamHudPlayerPresence,
    setTeamHudPlayerLoaded,
    syncTeamHudFromSnapshot,
    syncModeState,
    isBattleIntroActive: () => countdownRunning || _isOverlayVisible(),
    startCountdown,
    hideBattleStartOverlay,
    setTimerPaused,
  };
}
