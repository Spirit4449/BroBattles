import { getNavigation, getPageScope } from "../../lib/globals.cjs";
import { describeKiller } from "../../../shared/net/matchPresentation.js";
import { createModeHud } from "../modes/modeHud";
import { BRO_BALL_MODE } from "../../../shared/broBall";
import { replayClass } from "../../ui/domMotion";
import { COUNTDOWN_MS, COUNTDOWN_RISER_MS } from "../../../shared/matchIntroTiming.js";
import { renderTitle } from "../../views/titleView.js";
import { getSettings, subscribeSettings } from '../../site/preferences';
import { updateControlsGuide } from '../../site/controlsGuide.mjs';
// HUD controller for battle overlays, timer, keybind help, and team status.
// The page scope releases mounted window/document listeners and timers.
// Socket listeners and Phaser resources need teardown through their owners.

import { playSound, preloadSound } from "../../ui/uiSounds.js";
import { playCountdownRiser, playCountdownThump, playFightBoom } from "./countdownSfx.js";
import {
  getModeById,
  legacyModeToVariantId,
  normalizeGameSelection,
  selectionToLegacyMode,
} from "../../lib/gameSelectionCatalog.js";
import { bodyDisplayUrl, buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { LEVEL_CAP, DEFAULT_CHARACTER, getCharacterDisplayName } from "../../../shared/characters/characterStats.js";
import { renderLevelBadge } from "../../views/levelBadgeView.js";
import { pausePlayerCardPreparation, disposePlayerCardMedia, disposePlayerCardMediaWithin, layerPlayerCardMedia, createPlayerCardMedia, mirrorPlayerCardMedia, positionPlayerCardCanvas, warmEquippedPlayerCard } from "../../views/playerCardAnimation.cjs";
import playerCardsCatalog from "../../../shared/catalogs/playerCardsCatalog.cjs";

const DEFAULT_CARD_ASSET = "/assets/player-cards/default/default.webp";

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
  onCountdownStart,
  onCountdownFight,
  onSpectatePrevious,
  onSpectateNext,
  getScene,
  controlsHudStateKey = "bb_controls_hud_state_v2",
} = {}) {
  const teamRows = new Map(); // name -> { row }
  // cardId -> media decoded ahead of the countdown; one per distinct card.
  const preparedCards = new Map();
  let cardsDisposed = false;
  let preparingCards = false;
  let releaseIntroDownloads;
  function clearPreparedCards() {
    preparingCards = false;
    for (const media of preparedCards.values()) disposePlayerCardMedia(media);
    preparedCards.clear();
  }
  getPageScope()?.onDispose(() => {
    cardsDisposed = true;
    clearPreparedCards();
    releaseIntroDownloads?.();
  });
  let countdownRunning = false;
  let pregameActive = false;
  let currentCardNodes = [];
  let modeHud;
  let hudType;
  let playerGoals = {};
  function syncModeState(modeState, yourTeam) {
    const type = modeState?.type;
    if (type !== hudType) {
      modeHud?.destroy();
      modeHud = createModeHud(type, () => countdownRunning || _isOverlayVisible());
      hudType = type;
    }
    modeHud?.sync(modeState, yourTeam);
    playerGoals = type === BRO_BALL_MODE ? (modeState.playerGoals || {}) : {};
    for (const [name, entry] of teamRows) updateGoalBadge(entry, playerGoals[name]);
  }
  getPageScope()?.onDispose(() => modeHud?.destroy());
  let noticeAutoCloseTimer = null;
  let keybindAutoDismissTimer = null;
  let collapseKeybindHud = null;
  let spectatedPlayerName = null;
  let spectateHudHideTimer = null;

  // The catalog ships in the bundle; resolving a card never waits on the network.
  function _resolveCard(selectedCardId) {
    const list = Array.isArray(playerCardsCatalog?.cards) ? playerCardsCatalog.cards : [];
    const byId = (id) => {
      const wanted = String(id || "").trim();
      return wanted ? list.find((card) => String(card?.id) === wanted) : null;
    };
    return byId(selectedCardId) || byId(playerCardsCatalog?.defaultCardId) || list[0] ||
      { id: "default", name: "Default Card", assetUrl: DEFAULT_CARD_ASSET };
  }

  function _idle(callback) {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: 500 });
    else setTimeout(callback, 0);
  }

  /**
   * Start each distinct roster card's download and decoder before the
   * loading screen lifts, one card per idle period. Unfinished preparation
   * pauses during the walkthrough. Matching cards share one decoder.
   */
  function prepareBattleCards(players = _gameData()?.players || []) {
    if (cardsDisposed || countdownRunning || preparingCards || preparedCards.size) return;
    const self = players.find((player) => player.name === _username());
    if (self) warmEquippedPlayerCard(_resolveCard(self.selected_card_id));
    const pending = [...new Map(players.map((player) => {
      const card = _resolveCard(player.selected_card_id);
      return [card.id, card];
    })).values()];
    preparingCards = true;
    const next = () => {
      if (!preparingCards || cardsDisposed || countdownRunning || pregameActive) return;
      const card = pending.shift();
      if (!card) { preparingCards = false; return; }
      if (!preparedCards.has(card.id)) preparedCards.set(card.id, createPlayerCardMedia(card, { prepare: true }));
      _idle(next);
    };
    _idle(next);
  }

  // The first player with a card takes the prepared decoder; later players
  // with the same card mirror its frames instead of decoding it again.
  function _cardMedia(card, shown) {
    const source = shown.get(card.id);
    const mirror = source && mirrorPlayerCardMedia(source);
    if (mirror) return mirror;
    const prepared = preparedCards.get(card.id);
    preparedCards.delete(card.id);
    const media = prepared || createPlayerCardMedia(card);
    if (!source) shown.set(card.id, media);
    return media;
  }

  function _createPlayerCardElement({ player, side, shown, index = 0 }) {
    const root = document.createElement("div");
    root.className = `bs-player-card ${side === "your" ? "your" : "opp"}`;

    const card = _resolveCard(player?.selected_card_id);

    root.style.setProperty("--card-delay", `${index * 70}ms`);

    const frame = layerPlayerCardMedia(_cardMedia(card, shown));
    frame.className = "bs-card-frame";
    frame.alt = card?.name || "Player Card";
    positionPlayerCardCanvas(frame, card, { battle: true });
    // A filter on the card would re-render with every video frame, so the
    // drop shadow is a static silhouette of the still artwork instead.
    const shadow = document.createElement("img");
    shadow.className = "bs-card-shadow";
    shadow.src = frame.querySelector?.("img")?.src || card?.assetUrl || DEFAULT_CARD_ASSET;
    shadow.alt = "";
    shadow.setAttribute("aria-hidden", "true");
    positionPlayerCardCanvas(shadow, card, { battle: true });

    const nameEl = document.createElement("div");
    nameEl.className = "bs-card-player-name";
    const nm = String(player?.name || "Player");
    nameEl.textContent = nm;
    nameEl.title = nm;

    const trophyRow = document.createElement("div");
    trophyRow.className = "bs-card-trophies";
    const trophyIcon = document.createElement("img");
    trophyIcon.className = "bs-card-trophy-icon";
    trophyIcon.src = "/assets/icons/trophy.webp";
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
    const level = Math.max(1, Math.min(LEVEL_CAP, Number(player?.level) || 1));
    renderLevelBadge(levelBadge, level, {
      ariaLabel: `Character level ${level}`,
    });

    const charNameEl = document.createElement("div");
    charNameEl.className = "bs-card-character-name";
    renderTitle(charNameEl, player?.selected_title_id);

    const spriteWrap = document.createElement("div");
    spriteWrap.className = "bs-card-sprite-wrap";
    const sprite = document.createElement("img");
    sprite.className = "bs-card-sprite";
    const cls = String(player?.char_class || "").toLowerCase();
    const selectedSkinAsset = String(
      player?.selected_skin_asset_url || "",
    ).trim();
    if (selectedSkinAsset) {
      sprite.src = bodyDisplayUrl(selectedSkinAsset);
      sprite.alt = cls || "character";
    } else if (cls) {
      sprite.src = bodyDisplayUrl(buildCharacterSkinBodyUrl(cls, ""));
      sprite.alt = cls;
    } else {
      sprite.src = card?.assetUrl || DEFAULT_CARD_ASSET;
      sprite.alt = "default";
    }
    sprite.onerror = () => {
      sprite.onerror = null;
      sprite.src = card?.assetUrl || DEFAULT_CARD_ASSET;
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
        <img src="/assets/icons/heart.webp" alt="Health" class="bs-card-stat-icon">
        <span class="bs-card-stat-number">${healthValue}</span>
        <span class="bs-card-stat-label" aria-hidden="true">HP</span>
      </div>
      <div class="bs-card-stat-pill" title="Attack">
        <img src="/assets/icons/attack.webp" alt="Attack" class="bs-card-stat-icon">
        <span class="bs-card-stat-number">${damageValue}</span>
        <span class="bs-card-stat-label" aria-hidden="true">ATK</span>
      </div>
      <div class="bs-card-stat-pill" title="Special">
        <img src="/assets/icons/special.webp" alt="Special" class="bs-card-stat-icon">
        <span class="bs-card-stat-number">${specialValue}</span>
        <span class="bs-card-stat-label" aria-hidden="true">SP</span>
      </div>`;

    root.appendChild(shadow);
    root.appendChild(frame);
    root.appendChild(nameEl);
    root.appendChild(trophyRow);
    root.appendChild(levelBadge);
    root.appendChild(charNameEl);
    root.appendChild(spriteWrap);
    root.appendChild(statsRow);
    statsRow.querySelectorAll("img").forEach(image => {
      image.addEventListener("error", () => { image.style.display = "none"; }, { once: true });
    });
    root.draggable = false;
    root.addEventListener("dragstart", (event) => event.preventDefault());
    root.querySelectorAll("img").forEach((image) => { image.draggable = false; });
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
    for (const col of columns) {
      const cards = Array.from(col.querySelectorAll(".bs-player-card"));
      if (!cards.length) continue;
      const styles = window.getComputedStyle(col);
      const padding = (key) => Number.parseFloat(styles[key]) || 0;
      const width = col.clientWidth - padding("paddingLeft") - padding("paddingRight");
      const height = col.clientHeight - padding("paddingTop") - padding("paddingBottom") - 10;
      const stacked = styles.flexDirection === "column";
      const gap = padding(stacked ? "rowGap" : "columnGap");
      const count = cards.length;
      const widthLimit = stacked ? width : (width - gap * (count - 1)) / count;
      const heightLimit = (stacked ? (height - gap * (count - 1)) / count : height) * 650 / 1250;
      const candidate = Math.min(widthLimit, heightLimit);
      if (!Number.isFinite(candidate) || candidate <= 0) continue;
      resolvedSize = resolvedSize == null ? candidate : Math.min(resolvedSize, candidate);
    }

    if (resolvedSize == null) {
      root.style.removeProperty("--bs-card-size");
      return;
    }

    const px = Math.max(1, Math.min(270, Math.floor(resolvedSize)));
    root.style.setProperty("--bs-card-size", `${px}px`);
  }

  function _syncVisibleOverlayCardSize() {
    const root = document.getElementById("battle-start-overlay");
    if (!root || root.classList.contains("hidden")) return;
    _syncCardWrapState(root);
  }

  function _isOverlayVisible() {
    const overlay = document.getElementById("battle-start-overlay");
    return !!overlay && !overlay.classList.contains("hidden");
  }

  function _cardsRevealed(root) {
    return !!root?.classList.contains("phase-cards");
  }

  // Darken the arena and bring in the player cards alongside the countdown.
  function _revealCards() {
    const root = document.getElementById("battle-start-overlay");
    if (!root) return;
    root.classList.add("phase-cinematic", "phase-darkened", "phase-cards");
    showTopHudFade();
    _animateCardsIn(currentCardNodes);
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
      mapMode.textContent = getModeById(selection.modeId)?.label || "Duels";
    }

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
    for (const col of [yourCol, oppCol]) {
      disposePlayerCardMediaWithin(col);
      if (col) col.innerHTML = "";
    }

    const yourTeam = (players || []).filter(
      (p) => p.team === gameData?.yourTeam,
    );
    const oppTeam = (players || []).filter(
      (p) => p.team !== gameData?.yourTeam,
    );

    const self = (players || []).find(player => player.name === _username());
    if (self) warmEquippedPlayerCard(_resolveCard(self.selected_card_id));
    const shown = new Map();
    const yourNodes = [];
    const oppNodes = [];

    yourTeam.forEach((p, index) => {
      if (!yourCol) return;
      const node = _createPlayerCardElement({ player: p, side: "your", shown, index });
      yourCol.appendChild(node);
      yourNodes.push(node);
    });
    oppTeam.forEach((p, index) => {
      if (!oppCol) return;
      const node = _createPlayerCardElement({ player: p, side: "opp", shown, index });
      oppCol.appendChild(node);
      oppNodes.push(node);
    });
    // Anything prepared for a player who is no longer in the roster.
    clearPreparedCards();

    currentCardNodes = [...yourNodes, ...oppNodes];
    if (_cardsRevealed(root)) _animateCardsIn(currentCardNodes);

    const c = document.getElementById("countdown-display");
    if (c) c.textContent = String(Math.ceil(COUNTDOWN_MS / 1000));

    root.classList.remove("hidden");
    root.classList.remove("phase-darkened", "phase-cards", "is-dismissing");
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
      if (label) label.textContent = "Time Remaining";
    }
  }

  function showSuddenDeathBanner() {
    const existing = document.getElementById("sd-flash-banner");
    if (existing) return;
    const banner = document.createElement("div");
    banner.id = "sd-flash-banner";
    banner.textContent = "SUDDEN DEATH";
    document.body.appendChild(banner);
    requestAnimationFrame(() => replayClass(banner, "is-visible"));
    setTimeout(() => {
      banner.classList.replace("is-visible", "is-leaving");
      setTimeout(() => banner.remove(), 600);
    }, 2500);
  }

  // Red edge glow and killer card, shown from death until respawn or match end.
  // `info` (the player:dead payload) may arrive after the death begins.
  function showLocalDeath(info = null) {
    const root = document.getElementById("death-screen");
    if (!root) return;
    if (root.classList.contains("hidden")) {
      // Sit just below the top HUD, whose height varies with roster size.
      // Name labels can overflow their cards, so measure every descendant.
      const topHud = document.getElementById("team-status-hud");
      let hudBottom = 0;
      if (topHud && !topHud.classList.contains("hidden")) {
        for (const el of [topHud, ...topHud.querySelectorAll("*")]) {
          hudBottom = Math.max(hudBottom, el.getBoundingClientRect().bottom);
        }
      }
      root.style.setProperty("--death-screen-top", `${Math.round(Math.max(hudBottom, 48) + 48)}px`);
      root.classList.remove("hidden");
      root.setAttribute("aria-hidden", "false");
      document.getElementById("death-screen-killer")?.classList.add("hidden");
      // Restart the flash animation for back-to-back deaths (respawn modes).
      replayClass(root, "show");
    }
    if (!info) return;
    const killer = describeKiller(info);
    const killerEl = document.getElementById("death-screen-killer");
    if (!killer || !killerEl) return;
    killerEl.querySelector(".death-screen-killer-label").textContent = killer.label;
    document.getElementById("death-screen-killer-name").textContent = killer.name;
    killerEl.classList.remove("hidden");
  }

  function hideLocalDeath() {
    const root = document.getElementById("death-screen");
    if (!root) return;
    root.classList.remove("show");
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
  }

  function setSpectatingPlayer(name, { canSwitch = false } = {}) {
    const root = document.getElementById("spectate-hud");
    const nameEl = document.getElementById("spectate-player-name");
    if (!root || !nameEl) return;

    const wasVisible = !!spectatedPlayerName;
    spectatedPlayerName = name ? String(name) : null;
    root.setAttribute("aria-hidden", spectatedPlayerName ? "false" : "true");
    nameEl.textContent = spectatedPlayerName || "No player available";
    root.querySelectorAll(".spectate-arrow").forEach((button) => {
      button.disabled = !canSwitch;
    });
    document.body.classList.toggle("spectating-active", !!spectatedPlayerName);

    if (spectatedPlayerName) {
      clearTimeout(spectateHudHideTimer);
      const wasHidden = root.classList.contains("hidden");
      root.classList.remove("hidden");
      if (!wasVisible) {
        if (wasHidden) replayClass(root, "show");
        else root.classList.add("show");
      }
    } else if (wasVisible) {
      root.classList.remove("show");
      clearTimeout(spectateHudHideTimer);
      spectateHudHideTimer = setTimeout(() => {
        if (!spectatedPlayerName) root.classList.add("hidden");
      }, 320);
    }

    for (const [playerName, entry] of teamRows) {
      entry.row?.classList?.toggle(
        "is-spectated",
        !!spectatedPlayerName && playerName === spectatedPlayerName,
      );
    }
  }

  function hideSpectatingPlayer() {
    setSpectatingPlayer(null);
  }

  let spectateHudInitialized = false;
  function initSpectateHud() {
    if (spectateHudInitialized) return;
    spectateHudInitialized = true;
    const previous = document.getElementById("spectate-previous");
    const next = document.getElementById("spectate-next");
    previous?.addEventListener("click", () => onSpectatePrevious?.());
    next?.addEventListener("click", () => onSpectateNext?.());
    document.addEventListener("keydown", (event) => {
      if (!spectatedPlayerName || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSpectatePrevious?.();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onSpectateNext?.();
      }
    });
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

  let noticeKeyHandler = null;
  let systemNoticeOpen = false;

  function hideSystemNotice() {
    const overlay = document.getElementById("game-notice-overlay");
    if (!overlay) return;
    overlay.classList.remove("show", "tone-error", "tone-info");
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    systemNoticeOpen = false;
    if (noticeKeyHandler) {
      document.removeEventListener("keydown", noticeKeyHandler, true);
      noticeKeyHandler = null;
    }
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

    // The notice blocks the match, so give the mouse back and let the
    // keyboard press its button.
    systemNoticeOpen = true;
    if (document.pointerLockElement) document.exitPointerLock?.();
    document.body?.classList?.remove("battle-cursor-hidden");
    const canvas = document.querySelector("canvas");
    if (canvas?.style?.cursor === "none") canvas.style.cursor = "";
    noticeKeyHandler = (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Escape") return;
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    };
    document.addEventListener("keydown", noticeKeyHandler, true);
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

  let keybindHudInitialized = false;
  function initKeybindHud() {
    if (keybindHudInitialized) return;
    const hud = document.getElementById("battle-keybind-hud");
    const toggleBtn = document.getElementById("battle-keybind-toggle");
    const closeBtn = document.getElementById("battle-keybind-close");
    if (!hud) return;
    keybindHudInitialized = true;

    const applyExpandedState = (expanded, persist = true) => {
      if (expanded) document.querySelector(".site-settings-side")?.close();
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

    collapseKeybindHud = () => applyExpandedState(false, false);

    const updateGuide = settings => updateControlsGuide(hud, settings);
    updateGuide(getSettings());
    const stopGuideUpdates = subscribeSettings(updateGuide);
    getPageScope()?.onDispose(stopGuideUpdates);
    window.addEventListener("pagehide", stopGuideUpdates, { once: true });
    hud.querySelectorAll('kbd:not([data-binding])').forEach(key => {
      if(key.textContent.trim()==='ESC')key.dataset.code='Escape';
    });

    const setPressed = (code, pressed) => {
      hud.querySelectorAll(`kbd[data-code="${code}"]`).forEach((key) => {
        key.classList.toggle("is-pressed", pressed);
      });
    };
    window.addEventListener("keydown", (event) => setPressed(event.code, true), true);
    window.addEventListener("keyup", (event) => setPressed(event.code, false), true);

    const actionRows = hud.querySelectorAll(".bs-help-action-row");
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button === 0) actionRows[0]?.classList.add("is-pressed");
        if (event.button === 2) actionRows[1]?.classList.add("is-pressed");
      },
      true,
    );
    window.addEventListener(
      "pointerup",
      (event) => {
        if (event.button === 0) actionRows[0]?.classList.remove("is-pressed");
        if (event.button === 2) actionRows[1]?.classList.remove("is-pressed");
      },
      true,
    );
  }

  function scheduleKeybindAutoDismiss() {
    if (keybindAutoDismissTimer) clearTimeout(keybindAutoDismissTimer);
    keybindAutoDismissTimer = setTimeout(() => {
      keybindAutoDismissTimer = null;
      collapseKeybindHud?.();
    }, 5000);
  }

  function updateGoalBadge(entry, count) {
    const goals = Number(count) || 0;
    entry.goalBadge.hidden = goals <= 0;
    if (goals > 0) {
      entry.goalBadge.lastChild.textContent = String(goals);
      entry.goalBadge.setAttribute("aria-label", `${goals} ${goals === 1 ? "goal" : "goals"}`);
    }
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
      const cls = (p?.char_class || DEFAULT_CHARACTER).toLowerCase();
      img.src = bodyDisplayUrl(
        String(p?.selected_skin_asset_url || "").trim() ||
        buildCharacterSkinBodyUrl(cls, ""));
      img.alt = `${getCharacterDisplayName(cls)} body`;
      img.onerror = () => {
        img.onerror = null;
        img.src = "/assets/ninja/portrait.webp";
      };
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

      const nameWrap = document.createElement("div");
      nameWrap.className = "team-hud-player-name-wrap";
      const spectateMarker = document.createElement("img");
      spectateMarker.className = "team-hud-spectate-icon";
      spectateMarker.src = "/assets/icons/spectate.webp";
      spectateMarker.alt = "Currently spectating";
      nameWrap.appendChild(spectateMarker);
      nameWrap.appendChild(nameEl);

      avatarCore.appendChild(img);
      avatarCore.appendChild(cross);
      if (name === username) {
        avatarCore.appendChild(youTag);
      }
      avatarRing.appendChild(avatarCore);
      const goalBadge = document.createElement("span");
      goalBadge.className = "team-hud-goal-badge";
      goalBadge.hidden = true;
      const ballIcon = document.createElement("span");
      ballIcon.className = "team-hud-goal-ball";
      ballIcon.setAttribute("aria-hidden", "true");
      goalBadge.append(ballIcon, document.createElement("span"));
      avatarRing.appendChild(goalBadge);
      row.appendChild(avatarRing);
      row.appendChild(nameWrap);

      const entry = {
        name,
        row,
        goalBadge,
        maxHealth: Number(p?.stats?.health) || Number(p?.health) || 1,
        currentHealth:
          typeof p?.health === "number"
            ? Number(p.health)
            : Number(p?.stats?.health) || 1,
      };
      teamRows.set(name, entry);
      updateGoalBadge(entry, playerGoals[name]);
      row.classList.toggle("is-spectated", name === spectatedPlayerName);

      if (p?.connected === false) row.classList.add("disconnected");
      if (p?.loaded !== true) row.classList.add("loading");
      setTeamHudPlayerHealth(name, entry.currentHealth, entry.maxHealth);
      return row;
    };

    yourTeam.forEach((playerData) => {
      leftStack.appendChild(buildPlayerNode(playerData));
    });
    oppTeam.forEach((playerData) => {
      rightStack.appendChild(buildPlayerNode(playerData));
    });

    if (sorted.length <= 0) {
      root.classList.add("hidden");
    }
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
      replayClass(entry.row, "death-pop");
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
    clearPreparedCards();
    const overlay = document.getElementById("battle-start-overlay");
    if (!overlay) return;
    const mountedCards = currentCardNodes;
    currentCardNodes = [];
    const wrap = overlay.querySelector(".bs-wrap");
    overlay.classList.add("is-dismissing");
    if (wrap) wrap.style.opacity = "0";
    setTimeout(() => {
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      overlay.classList.remove(
        "phase-cinematic",
        "phase-darkened",
        "phase-cards",
        "is-beat",
        "is-final",
        "is-fight",
      );
      // The cards are offscreen for the rest of the match; free their decoders.
      mountedCards.forEach(disposePlayerCardMediaWithin);
      try {
        const timerHud = document.getElementById("game-timer-hud");
        const teamHud = document.getElementById("team-status-hud");
        timerHud?.classList.remove("hidden");
        teamHud?.classList.remove("hidden");
        requestAnimationFrame(() => {
          timerHud?.classList.add("in");
          teamHud?.classList.add("in");
        });
        scheduleKeybindAutoDismiss();
      } catch (_) {}
    }, 300);
  }

  // The pregame flythrough owns the screen: hide gameplay chrome and keep
  // intro-gated systems (tutorial tips, poison, input) paused.
  function setPregameActive(active) {
    pregameActive = !!active;
    document.body?.classList.toggle("match-pregame", pregameActive);
    if (pregameActive) {
      releaseIntroDownloads ||= getNavigation()?.holdGameplayDownloads?.();
    } else {
      releaseIntroDownloads?.();
      releaseIntroDownloads = null;
    }
    for (const media of preparedCards.values()) pausePlayerCardPreparation(media, pregameActive);
  }

  /**
   * Rejoins start at the current number. Each displayed number gets a full
   * beat so a delayed browser callback cannot bunch up the sounds.
   */
  let fightBurstTimer = null;
  function hideFightBurst() {
    clearTimeout(fightBurstTimer);
    fightBurstTimer = null;
    const fightBurst = document.getElementById("fight-burst");
    fightBurst?.classList?.remove("is-on");
    fightBurst?.classList?.add("hidden");
  }

  function prepareCountdownAudio() {
    preloadSound("beep");
    preloadSound(_gameData()?.modeId === "soccer" ? "kickoffWhistle" : "start");
  }

  function startCountdown(seconds = COUNTDOWN_MS / 1000, { elapsedMs = 0 } = {}) {
    if (countdownRunning) return;
    countdownRunning = true;
    // A burst left over from an earlier countdown must not cut this one short.
    hideFightBurst();

    const countdownEl = document.getElementById("countdown-display");
    if (!countdownEl) {
      countdownRunning = false;
      return;
    }
    prepareCountdownAudio();
    const isBroBall = _gameData()?.modeId === "soccer";
    const startCue = isBroBall ? "kickoffWhistle" : "start";

    try {
      if (typeof onCountdownStart === "function") onCountdownStart();
    } catch (_) {}

    if (!_isOverlayVisible()) showBattleStartOverlay(_gameData()?.players || []);
    _revealCards();

    const totalMs = Math.max(1, Number(seconds) || COUNTDOWN_MS / 1000) * 1000;
    const skippedMs = Math.min(totalMs, Math.max(0, Number(elapsedMs) || 0));

    const overlay = document.getElementById("battle-start-overlay");
    const fightBurst = document.getElementById("fight-burst");
    const count = Math.ceil(totalMs / 1000);
    const riserSeconds = COUNTDOWN_RISER_MS / 1000;

    const showNumber = (num) => {
      // 0 for the first number, 1 for the last: drives colour, size and shake.
      const heat = count > 1 ? (count - num) / (count - 1) : 1;
      countdownEl.textContent = num;
      countdownEl.style.transform = "";
      countdownEl.style.transition = "";
      if (countdownEl.dataset) countdownEl.dataset.num = String(num);
      countdownEl.style.setProperty?.("--heat", heat.toFixed(3));
      overlay?.style?.setProperty?.("--heat", heat.toFixed(3));
      if (overlay?.dataset) overlay.dataset.count = String(num);
      overlay?.classList?.toggle("is-final", num <= riserSeconds);
      replayClass(countdownEl, "is-beat");
      replayClass(overlay, "is-beat");
      playSound("beep", 0.18 + heat * 0.12, {
        playbackRate: 1 + (count - num) * 0.06,
        requireReady: true,
      });
      playCountdownThump(heat);
    };

    function showFight() {
      countdownEl.textContent = "FIGHT!";
      playSound(startCue, isBroBall ? 0.12 : 0.33, { requireReady: true });
      if (!isBroBall) playFightBoom();
      overlay?.classList?.add("is-fight");
      if (fightBurst) {
        fightBurst.classList.remove("hidden");
        replayClass(fightBurst, "is-on");
        clearTimeout(fightBurstTimer);
        fightBurstTimer = setTimeout(hideFightBurst, 1100);
      }

      try {
        if (typeof onCountdownFight === "function") {
          onCountdownFight();
        }
      } catch (_) {}

      // Immediately hide overlay, enable input
      hideBattleStartOverlay();
      countdownRunning = false;
      _enableInput();
    }

    const firstNumber = Math.ceil((totalMs - skippedMs) / 1000);
    function playBeat(num) {
      if (num <= 0) {
        showFight();
        return;
      }
      setTimeout(() => playBeat(num - 1), 1000);
      showNumber(num);
      if (num === Math.min(firstNumber, riserSeconds)) playCountdownRiser(num * 1000);
    }
    playBeat(firstNumber);
  }

  window.addEventListener("resize", _syncVisibleOverlayCardSize);

  return {
    showBattleStartOverlay,
    initTimerHud,
    updateTimerHud,
    showSuddenDeathBanner,
    showLocalDeath,
    hideLocalDeath,
    initSpectateHud,
    setSpectatingPlayer,
    hideSpectatingPlayer,
    showTopHudFade,
    hideTopHudFade,
    showSystemNotice,
    hideSystemNotice,
    isSystemNoticeOpen: () => systemNoticeOpen,
    initKeybindHud,
    initTeamStatusHud,
    setTeamHudPlayerAlive,
    setTeamHudPlayerHealth,
    setTeamHudPlayerPresence,
    setTeamHudPlayerLoaded,
    syncTeamHudFromSnapshot,
    syncModeState,
    isBattleIntroActive: () => pregameActive || countdownRunning || _isOverlayVisible(),
    setPregameActive,
    prepareBattleCards,
    prepareCountdownAudio,
    isCountdownRunning: () => countdownRunning,
    startCountdown,
    hideBattleStartOverlay,
  };
}
