import {
  getCharacterStats,
  getAllCharacters,
  getHealth,
  getDamage,
  getSuperChargeHits,
  getSpecialDamage,
  LEVEL_CAP,
  upgradePrice,
} from "./lib/characterStats.js";
import { getSharedSelectionPopupShell } from "./lib/selectionPopupShell.js";
import socket from "./socket.js";
import { playSound } from "./lib/uiSounds.js";
import { buildCharacterSkinBodyUrl } from "./lib/skinAssets.js";
import { dismissPopup } from "./lib/popupMotion.js";
import SKINS_CATALOG from "./shared/skinsCatalog.json";

// Keep a reference to user data for confirmations and currency display
let _userDataRef = null;
let _characterDetailsUi = null;
let _skinsCatalog = SKINS_CATALOG;
let _ownedSkinIds = new Set();
let _skinBootstrapPromise = null;
let _characterSelectionPromise = null;
let _confirmedSkinSelections = Object.create(null);
let _upgradePreview = null;
let _pendingUpgradeAnimation = null;

const SUPPORTED_RARITIES = new Set([
  "common",
  "rare",
  "epic",
  "legendary",
]);

function normalizeRarity(rarity) {
  const normalized = String(rarity || "common").trim().toLowerCase();
  return SUPPORTED_RARITIES.has(normalized) ? normalized : "common";
}

async function fetchJsonSafe(path) {
  try {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function bootstrapSkinState() {
  if (_skinBootstrapPromise) return _skinBootstrapPromise;
  _skinBootstrapPromise = fetchJsonSafe("/skins/owned")
    .then((ownedRes) => {
      const ownedSkinIds = Array.isArray(ownedRes?.ownedSkinIds)
        ? ownedRes.ownedSkinIds
        : Array.isArray(_userDataRef?.owned_skin_ids)
          ? _userDataRef.owned_skin_ids
          : [];
      _ownedSkinIds = new Set(
        ownedSkinIds.map((skinId) => String(skinId || "").trim()).filter(Boolean),
      );

      const selectedMap =
        ownedRes?.selectedSkinIdByCharacter &&
        typeof ownedRes.selectedSkinIdByCharacter === "object"
          ? ownedRes.selectedSkinIdByCharacter
          : _userDataRef?.selected_skin_id_by_char || {};
      const currentSelectedMap = {
        ...selectedMap,
        // A selection POST may finish while this earlier GET is still in
        // flight. Confirmed local writes must win over that stale response.
        ..._confirmedSkinSelections,
      };

      if (_characterDetailsUi) {
        _characterDetailsUi.selectedSkinByCharacter = {
          ...currentSelectedMap,
          // Never replace a skin the user is actively previewing with a late
          // bootstrap response from before the picker was opened.
          ..._characterDetailsUi.selectedSkinByCharacter,
        };
      }
      if (_userDataRef) {
        _userDataRef.selected_skin_id_by_char = {
          ...(_userDataRef.selected_skin_id_by_char || {}),
          ...currentSelectedMap,
        };
        _userDataRef.owned_skin_ids = Array.from(_ownedSkinIds);
      }
    })
    .finally(() => {
      _skinBootstrapPromise = null;
    });
  return _skinBootstrapPromise;
}

function getCatalogCharacterSkins(character) {
  const chars = _skinsCatalog?.characters;
  if (!chars || typeof chars !== "object") return [];
  const entry = chars[String(character || "").toLowerCase()] || {};
  return Array.isArray(entry.skins) ? entry.skins : [];
}

function normalizeCharacterId(character) {
  return String(character || "")
    .trim()
    .toLowerCase();
}

function getCharacterSkinList(character) {
  const characterId = normalizeCharacterId(character);
  const catalogSkins = getCatalogCharacterSkins(characterId);
  const characterUnlocked =
    Number(_userDataRef?.char_levels?.[characterId] ??
      _userDataRef?.char_levels?.[character] ??
      0) >= 1;
  let normalized = catalogSkins
    .map((skin, index) => {
      const id =
        String(skin?.id || skin?.skinId || skin?.key || "").trim() ||
        (index === 0 ? "default" : `skin-${index + 1}`);
      const available = skin?.available !== false;
      // Always allow the base/default skin once the character is unlocked,
      // even if the skins service hasn't refreshed ownership yet.
      const owned = (index === 0 && characterUnlocked) || _ownedSkinIds.has(id);
      if (!owned && !available) return null;
      return {
        id,
        label:
          String(skin?.label || skin?.name || skin?.title || "").trim() ||
          (index === 0 ? "Default" : `Skin ${index + 1}`),
        previewSrc:
          String(
            skin?.assetUrl ||
              skin?.previewSrc ||
              skin?.bodySrc ||
              skin?.src ||
              "",
        ).trim() || buildCharacterSkinBodyUrl(characterId, id),
        owned,
        locked: !owned,
        rarity: String(skin?.rarity || "common").trim().toLowerCase(),
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    const stats = getCharacterStats(character) || {};
    const skins = Array.isArray(stats.skins) ? stats.skins : [];
    normalized = skins
      .map((skin, index) => ({
        id:
          String(skin?.id || skin?.skinId || skin?.key || "").trim() ||
          (index === 0 ? "default" : `skin-${index + 1}`),
        label:
          String(skin?.label || skin?.name || skin?.title || "").trim() ||
          (index === 0 ? "Default" : `Skin ${index + 1}`),
        previewSrc:
          String(skin?.previewSrc || skin?.bodySrc || skin?.src || "").trim() ||
          buildCharacterSkinBodyUrl(characterId, ""),
        owned: true,
        locked: false,
        rarity: String(skin?.rarity || "common").trim().toLowerCase(),
      }))
      .filter((skin) => skin.id);
  }

  if (normalized.length === 0) {
    normalized.push({
      id: "default",
      label: "Default",
      previewSrc: buildCharacterSkinBodyUrl(characterId, ""),
      owned: true,
      locked: false,
      rarity: "common",
    });
  }

  return normalized;
}

function getSelectedSkin(character) {
  const characterId = normalizeCharacterId(character);
  const selectedByUserData = String(
    _userDataRef?.selected_skin_id_by_char?.[characterId] || "",
  ).trim();
  const skinId = String(
    _characterDetailsUi?.selectedSkinByCharacter?.[characterId] ||
      selectedByUserData,
  ).trim();
  const skins = getCharacterSkinList(characterId);
  return skins.find((skin) => skin.id === skinId) || skins[0];
}

function setSelectedSkin(character, skinId) {
  if (!_characterDetailsUi) return;
  const characterId = normalizeCharacterId(character);
  const skins = getCharacterSkinList(characterId);
  const nextSkin =
    skins.find((skin) => skin.id === String(skinId || "")) || skins[0];
  _characterDetailsUi.selectedSkinByCharacter[characterId] = nextSkin.id;
  if (_characterDetailsUi.currentCharacter === characterId) {
    renderCharacterDetails(characterId);
  }
}

function resolveCharacterPreviewAsset(character, skinId) {
  const skins = getCharacterSkinList(character);
  const skin =
    skins.find((entry) => entry.id === String(skinId || "")) || skins[0];
  return skin?.previewSrc || buildCharacterSkinBodyUrl(character, skin?.id);
}

function getCharacterCardState(character, userData) {
  const stats = getCharacterStats(character);
  const level =
    (userData?.char_levels && (userData.char_levels[character] ?? 0)) ?? 0;
  const isLocked = level === 0;
  const isMaxed = level >= LEVEL_CAP;
  const currentLevel = Math.max(1, level);
  const currentHealth = getHealth(character, currentLevel);
  const currentDamage = getDamage(character, currentLevel);
  const currentSuperChargeHits = getSuperChargeHits(character);
  const currentSpecial = getSpecialDamage(character, currentLevel);
  const maxHealth = getHealth(character, LEVEL_CAP);
  const maxDamage = getDamage(character, LEVEL_CAP);
  const maxSpecial = getSpecialDamage(character, LEVEL_CAP);
  const price = !isLocked && !isMaxed ? upgradePrice(level) : null;
  const coins = Number(userData?.coins || 0);
  const canUpgrade =
    !isLocked && !isMaxed && Number.isFinite(price) && coins >= price;
  const canUnlock = isLocked && Number(userData?.gems || 0) >= Number(stats.unlockPrice || 0);

  return {
    stats,
    level,
    isLocked,
    isMaxed,
    currentLevel,
    currentHealth,
    currentDamage,
    currentSuperChargeHits,
    currentSpecial,
    maxHealth,
    maxDamage,
    maxSpecial,
    price,
    canUpgrade,
    canUnlock,
    skin: getSelectedSkin(character),
  };
}

function getSortedCharacters(userData) {
  const characters = getAllCharacters();
  return characters.slice().sort((a, b) => {
    const aState = getCharacterCardState(a, userData);
    const bState = getCharacterCardState(b, userData);

    // Show unlocked first, then locked.
    if (aState.isLocked !== bState.isLocked) {
      return aState.isLocked ? 1 : -1;
    }

    // Within each ownership group, preserve the catalog's unlock-price order.
    const aUnlock = Number(aState?.stats?.unlockPrice || 0);
    const bUnlock = Number(bState?.stats?.unlockPrice || 0);
    if (aUnlock !== bUnlock) return aUnlock - bUnlock;
    return String(a).localeCompare(String(b));
  });
}

function sortCharacterCardsInGrid(userData) {
  const grid = document.querySelector(".characters-grid");
  if (!grid) return;
  const existing = new Map();
  for (const child of Array.from(grid.children)) {
    const char = String(child?.dataset?.char || "").trim();
    if (char) existing.set(char, child);
  }
  for (const character of getSortedCharacters(userData)) {
    const card = existing.get(character) || createCharacterCard(character, userData);
    grid.appendChild(card);
  }
}

function getCharacterDetailStatBounds() {
  const characters = getAllCharacters();
  let maxHealth = 1;
  let maxDamage = 1;
  let maxAmmo = 1;
  let maxReload = 1;

  characters.forEach((character) => {
    const stats = getCharacterStats(character);
    if (!stats) return;
    maxHealth = Math.max(maxHealth, getHealth(character, LEVEL_CAP));
    maxDamage = Math.max(maxDamage, getDamage(character, LEVEL_CAP));
    maxAmmo = Math.max(maxAmmo, Number(stats.ammoCapacity || 0));
    maxReload = Math.max(maxReload, Number(stats.ammoReloadMs || 0));
  });

  return { maxHealth, maxDamage, maxAmmo, maxReload };
}

function createStatBar({ label, value, percent, detail, className }) {
  const section = document.createElement("div");
  section.className = `character-detail-stat ${className || ""}`.trim();
  section.innerHTML = `
    <div class="character-detail-stat-header">
      <span class="character-detail-stat-label">${label}</span>
      <span class="character-detail-stat-value">${value}</span>
    </div>
    <div class="character-detail-stat-bar"><span style="width: ${Math.max(0, Math.min(100, percent))}%"></span></div>
    <div class="character-detail-stat-detail">${detail}</div>
  `;
  return section;
}

function getCharacterDetailsTarget(character) {
  if (!_characterDetailsUi) return null;
  if (_characterDetailsUi.currentCharacter !== character) return null;
  return _characterDetailsUi.previewStage || _characterDetailsUi.popup;
}

function hideCharacterDetails() {
  if (!_characterDetailsUi) return;
  _upgradePreview = null;
  _pendingUpgradeAnimation = null;
  _characterDetailsUi.popup.classList.remove("is-upgrade-confirming");
  if (_characterDetailsUi.currentCharacter) {
    delete _characterDetailsUi.selectedSkinByCharacter[
      _characterDetailsUi.currentCharacter
    ];
  }
  _characterDetailsUi.overlay.classList.add("is-hidden");
  _characterDetailsUi.overlay.setAttribute("aria-hidden", "true");
  _characterDetailsUi.currentCharacter = null;
}

function ensureCharacterDetailsUi() {
  if (_characterDetailsUi) return _characterDetailsUi;

  const overlay = document.createElement("div");
  overlay.className = "character-details-overlay is-hidden";
  overlay.setAttribute("aria-hidden", "true");
  const popup = document.createElement("div");
  popup.className = "character-details-popup";

  const header = document.createElement("div");
  header.className = "character-details-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "character-details-title-wrap";
  const title = document.createElement("h3");
  title.className = "character-details-title";

  const subtitle = document.createElement("p");
  subtitle.className = "character-details-header-description";

  const wallet = document.createElement("div");
  wallet.className = "character-details-wallet";
  wallet.setAttribute("aria-label", "Your wallet");
  wallet.innerHTML = `
    <span><small>COINS</small><img src="/assets/coin.webp" alt="" /><strong data-character-wallet="coins">0</strong></span>
    <span><small>GEMS</small><img src="/assets/gem.webp" alt="" /><strong data-character-wallet="gems">0</strong></span>
  `;

  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);

  const closeButton = document.createElement("button");
  closeButton.className =
    "close character-details-close bb-close pixel-menu-button";
  closeButton.type = "button";
  closeButton.innerHTML = "×";

  const content = document.createElement("div");
  content.className = "character-details-content";

  const preview = document.createElement("div");
  preview.className = "character-details-preview";

  const info = document.createElement("div");
  info.className = "character-details-info";

  const stickyFooter = document.createElement("div");
  stickyFooter.className = "character-details-sticky-footer";

  content.appendChild(preview);
  content.appendChild(info);
  header.appendChild(titleWrap);
  header.appendChild(wallet);
  header.appendChild(closeButton);
  popup.appendChild(header);
  popup.appendChild(content);
  popup.appendChild(stickyFooter);
  overlay.appendChild(popup);

  const state = {
    overlay,
    popup,
    header,
    title,
    subtitle,
    wallet,
    closeButton,
    content,
    preview,
    info,
    stickyFooter,
    previewStage: null,
    selectedSkinByCharacter: {},
    currentCharacter: null,
    keydownHandler: null,
  };

  const closeDetails = () => {
    playSound("cursor4", 0.3);
    hideCharacterDetails();
  };

  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDetails();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDetails();
  });

  popup.addEventListener("click", (e) => e.stopPropagation());

  // Remove any old keyboard handler to avoid duplicates
  if (state.keydownHandler) {
    document.removeEventListener("keydown", state.keydownHandler);
  }

  state.keydownHandler = (e) => {
    if (e.key !== "Escape") return;
    if (overlay.classList.contains("is-hidden") || !overlay.isConnected) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeDetails();
  };

  document.addEventListener("keydown", state.keydownHandler, true);

  _characterDetailsUi = state;
  return state;
}

function renderCharacterDetails(character) {
  const ui = ensureCharacterDetailsUi();
  const stats = getCharacterStats(character);
  if (!stats) return;

  const cardState = getCharacterCardState(character, _userDataRef);
  const selectedSkin = getSelectedSkin(character);
  const selectedSkinRarity = normalizeRarity(selectedSkin.rarity);
  const isUpgradePreview =
    _upgradePreview?.character === character &&
    _upgradePreview?.level === cardState.level &&
    !cardState.isMaxed;

  ui.currentCharacter = character;
  ui.popup.classList.toggle("is-character-locked", cardState.isLocked);
  ui.selectedSkinByCharacter[character] = selectedSkin.id;

  ui.title.textContent = isUpgradePreview
    ? `UPGRADE ${character.toUpperCase()}`
    : character.toUpperCase();
  ui.subtitle.textContent = stats.description || "";
  ui.wallet.querySelector('[data-character-wallet="coins"]').textContent =
    Math.max(0, Number(_userDataRef?.coins) || 0).toLocaleString();
  ui.wallet.querySelector('[data-character-wallet="gems"]').textContent =
    Math.max(0, Number(_userDataRef?.gems) || 0).toLocaleString();

  ui.preview.innerHTML = "";
  ui.info.innerHTML = "";
  ui.stickyFooter.innerHTML = "";

  // Smaller preview frame (game style - no rounded corners)
  const previewFrame = document.createElement("div");
  previewFrame.className =
    `character-details-preview-frame skin-rarity-${selectedSkinRarity} ${cardState.isLocked ? "is-locked" : ""} ${cardState.isMaxed ? "is-maxed" : ""}`.trim();

  const previewGlow = document.createElement("div");
  previewGlow.className = "character-details-preview-glow";

  const previewImg = document.createElement("img");
  previewImg.className = "character-details-preview-image";
  previewImg.src = resolveCharacterPreviewAsset(character, selectedSkin.id);
  previewImg.alt = `${character} ${selectedSkin.label}`;

  if (!cardState.isLocked && cardState.level > 0 && cardState.level <= LEVEL_CAP) {
    const levelBadge = document.createElement("img");
    levelBadge.className = "character-details-preview-level-badge";
    levelBadge.src = `/assets/levels/${cardState.level}.webp`;
    levelBadge.alt = `Level ${cardState.level}`;
    previewFrame.appendChild(levelBadge);
  }

  previewFrame.appendChild(previewGlow);
  previewFrame.appendChild(previewImg);
  if (cardState.isLocked) {
    const lockOverlay = document.createElement("div");
    lockOverlay.className = "character-details-lock-overlay";
    lockOverlay.innerHTML = '<img src="/assets/lock.webp" alt="Locked" />';
    previewFrame.appendChild(lockOverlay);
  }

  ui.preview.appendChild(previewFrame);
  ui.previewStage = previewFrame;

  // Three main stat boxes: Health (full width top), Attack and Special (side by side)
  const statsContainer = document.createElement("div");
  statsContainer.className = "character-details-stats-container";

  ui.popup.classList.toggle("is-upgrade-confirming", isUpgradePreview);
  const nextLevel = Math.min(cardState.currentLevel + 1, LEVEL_CAP);
  const nextHealth = getHealth(character, nextLevel);
  const nextDamage = getDamage(character, nextLevel);
  const nextSpecial = getSpecialDamage(character, nextLevel);
  const upgradeAnimation =
    _pendingUpgradeAnimation?.character === character
      ? _pendingUpgradeAnimation
      : null;
  const animatedStart = upgradeAnimation?.from || {};

  const statValueMarkup = (stat, value, nextValue) => {
    const displayValue = Number(animatedStart[stat] ?? value);
    const gain = Math.max(0, Number(nextValue) - Number(value));
    return `<span class="stat-box-value-stack"><span class="stat-box-value" data-stat-value="${stat}" data-stat-target="${value}">${displayValue}</span>${isUpgradePreview ? `<span class="stat-box-gain">+${gain}</span>` : ""}</span>`;
  };
  const statTrackMarkup = (stat, value, maxValue, nextValue) => {
    const displayedValue = Number(animatedStart[stat] ?? value);
    const shownWidth = Math.max(0, Math.min(100, (displayedValue / maxValue) * 100));
    const targetWidth = Math.max(0, Math.min(100, (value / maxValue) * 100));
    const nextWidth = Math.max(0, Math.min(100, (nextValue / maxValue) * 100));
    const previewWidth = Math.max(0, nextWidth - targetWidth);
    return `<div class="stat-box-track" role="progressbar" aria-label="${stat}" aria-valuemin="0" aria-valuemax="${maxValue}" aria-valuenow="${value}"><div class="stat-box-fill" data-stat-fill="${stat}" data-stat-target-width="${targetWidth}" style="width:${shownWidth}%"></div>${isUpgradePreview ? `<div class="stat-box-preview-fill" style="left:${targetWidth}%;width:${previewWidth}%"></div>` : ""}</div>`;
  };

  // Health box (full width)
  const healthBox = document.createElement("div");
  healthBox.className = "character-details-stat-box health-box";
  const healthMax = Math.max(1, Number(cardState.maxHealth || 1));
  healthBox.innerHTML = `
    <div class="stat-box-header">
      <img class="stat-box-icon" src="/assets/heart.webp" alt="Health" />
      <span class="stat-box-label">Health</span>
      ${statValueMarkup("health", cardState.currentHealth, nextHealth)}
    </div>
    ${statTrackMarkup("health", cardState.currentHealth, healthMax, nextHealth)}
  `;
  statsContainer.appendChild(healthBox);

  // Attack and Special boxes (side by side)
  const attackSpecialRow = document.createElement("div");
  attackSpecialRow.className = "character-details-stat-boxes-row";

  // Attack box
  const attackBox = document.createElement("div");
  attackBox.className = "character-details-stat-box attack-box";
  const attackMax = Math.max(1, Number(cardState.maxDamage || 1));
  attackBox.innerHTML = `
    <div class="stat-box-header">
      <img class="stat-box-icon" src="/assets/attack.webp" alt="Attack" />
      <span class="stat-box-label">Attack</span>
      ${statValueMarkup("damage", cardState.currentDamage, nextDamage)}
    </div>
    ${statTrackMarkup("damage", cardState.currentDamage, attackMax, nextDamage)}
    <div class="stat-box-content">
      ${stats.attackDescription ? `<div class="stat-box-desc">${stats.attackDescription}</div>` : ""}
      <div class="stat-box-detail">Reload: ${(Number(stats.ammoReloadMs || 0) / 1000).toFixed(1)}s</div>
      <div class="stat-box-detail">Ammo: ${stats.ammoCapacity || 0}</div>
    </div>
  `;
  attackSpecialRow.appendChild(attackBox);

  // Special box
  const specialBox = document.createElement("div");
  specialBox.className = "character-details-stat-box special-box";
  const specialMax = Math.max(1, Number(cardState.maxSpecial || 1));
  specialBox.innerHTML = `
    <div class="stat-box-header">
      <img class="stat-box-icon" src="/assets/special.webp" alt="Special" />
      <span class="stat-box-label">Special</span>
      ${statValueMarkup("special", cardState.currentSpecial, nextSpecial)}
    </div>
    ${statTrackMarkup("special", cardState.currentSpecial, specialMax, nextSpecial)}
    <div class="stat-box-content">
      ${stats.specialDescription ? `<div class="stat-box-desc">${stats.specialDescription}</div>` : ""}
      <div class="stat-box-detail">Charge: ${cardState.currentSuperChargeHits} hits</div>
    </div>
  `;
  attackSpecialRow.appendChild(specialBox);

  statsContainer.appendChild(attackSpecialRow);
  ui.info.appendChild(statsContainer);

  // Sticky footer: skins and actions in one line
  const footerLine = document.createElement("div");
  footerLine.className = "character-details-footer-line";

  const skinRow = document.createElement("div");
  skinRow.className = `character-details-inline-skin skin-rarity-${selectedSkinRarity}${selectedSkin.locked ? " is-locked" : ""}`;

  const skinLabel = document.createElement("div");
  skinLabel.className = "character-details-skin-label";
  skinLabel.innerHTML = `
    <svg class="character-details-hanger-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M13 7.5a3 3 0 1 1 4.7 2.5c-1.1.8-1.7 1.3-1.7 2.5v1.1" />
      <path d="M16 13.6 4.3 22.2c-1.3 1-.6 3.1 1.1 3.1h21.2c1.7 0 2.4-2.1 1.1-3.1L16 13.6Z" />
    </svg>
    <span>Skin</span>
  `;

  const skinControls = document.createElement("div");
  skinControls.className = "character-details-skin-controls";

  const skins = getCharacterSkinList(character);
  const activeSkinIndex = Math.max(
    0,
    skins.findIndex((skin) => skin.id === selectedSkin.id),
  );
  const prevSkin = skins[(activeSkinIndex - 1 + skins.length) % skins.length];
  const nextSkin = skins[(activeSkinIndex + 1) % skins.length];

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.className = "character-details-skin-stepper";
  prevButton.textContent = "‹";
  prevButton.setAttribute("aria-label", "Previous skin");
  prevButton.disabled = skins.length <= 1;
  prevButton.addEventListener("click", () => {
    if (skins.length <= 1) return;
    playSound("cursor4", 0.2);
    setSelectedSkin(character, prevSkin.id);
  });

  const skinChip = document.createElement("div");
  skinChip.className = "character-details-skin-name-box";
  skinChip.setAttribute("aria-live", "polite");
  const skinName = document.createElement("strong");
  if (selectedSkin.locked) {
    const lockIcon = document.createElement("img");
    lockIcon.className = "character-details-skin-lock";
    lockIcon.src = "/assets/lock.webp";
    lockIcon.alt = "Locked";
    skinName.appendChild(lockIcon);
  }
  skinName.appendChild(document.createTextNode(selectedSkin.label));
  const skinRarity = document.createElement("span");
  skinRarity.className = "character-details-skin-rarity";
  skinRarity.textContent = selectedSkinRarity;
  skinChip.appendChild(skinName);
  skinChip.appendChild(skinRarity);

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "character-details-skin-stepper";
  nextButton.textContent = "›";
  nextButton.setAttribute("aria-label", "Next skin");
  nextButton.disabled = skins.length <= 1;
  nextButton.addEventListener("click", () => {
    if (skins.length <= 1) return;
    playSound("cursor4", 0.2);
    setSelectedSkin(character, nextSkin.id);
  });

  skinControls.appendChild(prevButton);
  skinControls.appendChild(skinChip);
  skinControls.appendChild(nextButton);
  skinRow.appendChild(skinLabel);
  skinRow.appendChild(skinControls);

  const footer = document.createElement("div");
  footer.className = "character-details-inline-actions";

  if (cardState.isLocked) {
    const buyButton = document.createElement("button");
    buyButton.type = "button";
    buyButton.setAttribute("aria-label", `Unlock ${character} for ${stats.unlockPrice || 0} gems`);
    buyButton.className =
      `character-details-action buy-button pixel-menu-button${cardState.canUnlock ? " is-ready" : ""}`;
    buyButton.innerHTML = `<span class="character-details-buy-label"><img class="upgrade-icon" src="/assets/lock.webp" alt="" /> <span>Buy</span></span><span class="button-price"><img class="cs-currency" src="/assets/gem.webp" alt="" /> ${stats.unlockPrice || 0}</span>`;
    buyButton.addEventListener("click", (e) => {
      e.stopPropagation();
      playSound("cursor4", 0.2);
      showConfirmDialog(
        {
          type: "unlock",
          character,
          level: cardState.level,
          price: stats.unlockPrice,
        },
        () => applyUnlock(character, stats.unlockPrice),
      );
    });
    footer.appendChild(buyButton);
  } else {
    if (!cardState.isMaxed) {
      const upgradeButton = document.createElement("button");
      upgradeButton.type = "button";
      upgradeButton.setAttribute("aria-label", `Upgrade ${character} for ${cardState.price} coins`);
      upgradeButton.className = `character-details-action upgrade-button pixel-menu-button${cardState.canUpgrade ? " is-ready" : ""}`;
      upgradeButton.innerHTML = `<img class="upgrade-icon" src="/assets/upgrade.webp" alt="" /> <span>Upgrade</span> <span class="button-price"><img class="cs-currency" src="/assets/coin.webp" alt="" /> ${cardState.price}</span>`;
      if (!cardState.canUpgrade) {
        upgradeButton.title = "Not enough coins — select to view the balance needed";
      }
      upgradeButton.addEventListener("click", (e) => {
        e.stopPropagation();
        playSound("cursor4", 0.2);
        if (!isUpgradePreview) {
          _upgradePreview = {
            character,
            level: cardState.level,
            minimumButtonWidth: Math.ceil(upgradeButton.getBoundingClientRect().width),
          };
          renderCharacterDetails(character);
          return;
        }
        if (!cardState.canUpgrade) {
          showInsufficientDialog("coins");
          return;
        }
        upgradeButton.disabled = true;
        upgradeButton.textContent = "Upgrading…";
        applyUpgrade(character, cardState.level);
      });
      if (isUpgradePreview) {
        upgradeButton.classList.add("is-confirming");
        upgradeButton.style.minWidth = `${_upgradePreview.minimumButtonWidth || 0}px`;
        upgradeButton.setAttribute("aria-label", `Confirm upgrade ${character} for ${cardState.price} coins`);
        upgradeButton.textContent = "CONFIRM?";
      }
      footer.appendChild(upgradeButton);
    } else {
      const maxedLabel = document.createElement("div");
      maxedLabel.className = "character-details-maxed-label";
      maxedLabel.innerHTML =
        '<img src="/assets/crown.webp" alt="" /> <span>Max Level</span>';
      footer.appendChild(maxedLabel);
    }

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className =
      "character-details-action select-button pixel-menu-button";
    selectButton.textContent = selectedSkin.locked ? "Locked" : "Select";
    selectButton.disabled = !!selectedSkin.locked;
    selectButton.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (selectedSkin.locked) return;
      playSound("cursor4", 0.2);
      selectButton.disabled = true;
      selectButton.textContent = "Selecting...";
      const selected = await selectCharacter(character);
      if (!selected && _characterDetailsUi?.currentCharacter === character) {
        renderCharacterDetails(character);
      }
    });
    footer.appendChild(selectButton);
  }

  footerLine.appendChild(skinRow);
  footerLine.appendChild(footer);
  ui.stickyFooter.appendChild(footerLine);

  if (upgradeAnimation) {
    _pendingUpgradeAnimation = null;
    animateCharacterDetailStats(upgradeAnimation);
  }
}

function animateCharacterDetailStats({ from }) {
  const ui = _characterDetailsUi;
  if (!ui?.popup) return;
  const durationMs = 760;
  const values = [...ui.popup.querySelectorAll("[data-stat-value]")];
  const fills = [...ui.popup.querySelectorAll("[data-stat-fill]")];
  const boxes = [...ui.popup.querySelectorAll(".character-details-stat-box")];

  boxes.forEach((box) => box.classList.add("is-leveling-up"));
  requestAnimationFrame(() => {
    fills.forEach((fill) => {
      fill.classList.add("is-stat-leveling");
      fill.style.width = `${fill.dataset.statTargetWidth}%`;
    });
  });

  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = 1 - (1 - progress) ** 3;
    values.forEach((value) => {
      const start = Number(from?.[value.dataset.statValue] ?? value.textContent);
      const target = Number(value.dataset.statTarget);
      value.textContent = String(Math.round(start + (target - start) * eased));
    });
    if (progress < 1) {
      requestAnimationFrame(step);
      return;
    }
    window.setTimeout(() => {
      boxes.forEach((box) => box.classList.remove("is-leveling-up"));
      fills.forEach((fill) => fill.classList.remove("is-stat-leveling"));
    }, 500);
  };
  requestAnimationFrame(step);
}

function playCharacterDetailsSuccessAnimation(type) {
  if (!_characterDetailsUi || !_characterDetailsUi.currentCharacter) return;
  const target = getCharacterDetailsTarget(
    _characterDetailsUi.currentCharacter,
  );
  if (!target) return;

  const overlay = document.createElement("div");
  overlay.className = "character-details-success";
  const beams = document.createElement("div");
  beams.className = `character-details-success-beams ${type === "unlock" ? "gem" : "coin"}`;
  const label = document.createElement("div");
  label.className = "character-details-success-label";
  label.textContent = type === "unlock" ? "Unlocked!" : "Upgraded!";
  overlay.appendChild(beams);
  overlay.appendChild(label);
  target.appendChild(overlay);
  playSound("success", 0.6);
  setTimeout(() => {
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 350);
  }, 900);
}

function setLobbySlotLevelIcon(slot, level) {
  if (!slot) return;
  let badge = slot.querySelector(".slot-level-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "slot-level-badge";
    badge.setAttribute("aria-hidden", "true");
    slot.insertBefore(badge, slot.firstChild);
  }
  if (Number.isFinite(Number(level)) && Number(level) > 0) {
    const iconLevel = Math.max(1, Math.min(LEVEL_CAP, Number(level)));
    badge.innerHTML = `<img src="/assets/levels/${iconLevel}.webp" alt="" />`;
    badge.dataset.level = String(iconLevel);
    slot.classList.add("has-level");
  } else {
    badge.innerHTML = "";
    delete badge.dataset.level;
    slot.classList.remove("has-level");
  }
}

function syncCurrentUserLobbyLevel(character, level) {
  if (
    String(_userDataRef?.char_class || "").toLowerCase() !==
    String(character || "").toLowerCase()
  ) {
    return;
  }
  const slot =
    document.querySelector('.character-slot[data-is-current-user="true"]') ||
    document.getElementById("your-slot-1");
  if (slot) setLobbySlotLevelIcon(slot, level);
}

function triggerLobbyCharacterSplash(slot) {
  if (!slot) return;
  slot.classList.remove("character-splash");
  void slot.offsetWidth;
  slot.classList.add("character-splash");
  window.setTimeout(() => {
    slot.classList.remove("character-splash");
  }, 700);
}

function getActivePartyIdFromPath() {
  const pathname = window.location.pathname || "";
  if (!pathname.includes("/party/")) return null;
  const last = pathname.split("/").filter(Boolean).pop();
  if (last && /^\d+$/.test(last)) return Number(last);
  return last || null;
}

function emitCharacterMenuStatus(open) {
  try {
    const selfSlot =
      document.querySelector('.character-slot[data-is-current-user="true"]') ||
      document.getElementById("your-slot-1");
    if (selfSlot && !selfSlot.querySelector(":scope > .lobby-selecting-ring")) {
      const ring = document.createElement("div");
      ring.className = "lobby-selecting-ring";
      ring.setAttribute("aria-hidden", "true");
      selfSlot.appendChild(ring);
    }
    selfSlot?.classList.toggle("is-selecting-character", !!open);

    const partyId = getActivePartyIdFromPath();
    if (!partyId) return;
    socket.emit("char-menu:status", {
      partyId,
      open: !!open,
    });
  } catch (_) {}
}

export function initializeCharacterSelect(userData) {
  _userDataRef = userData;
  _skinsCatalog = SKINS_CATALOG;
  _ownedSkinIds = new Set(
    (Array.isArray(userData?.owned_skin_ids) ? userData.owned_skin_ids : [])
      .map((skinId) => String(skinId || "").trim())
      .filter(Boolean),
  );
  _confirmedSkinSelections = Object.create(null);
  bootstrapSkinState().then(() => {
    try {
      refreshUpgradeButtonAffordability();
      if (_characterDetailsUi?.currentCharacter) {
        renderCharacterDetails(_characterDetailsUi.currentCharacter);
      }
    } catch (_) {}
  });
  const popupShell = getSharedSelectionPopupShell();

  const particlesCanvas = document.createElement("canvas");
  particlesCanvas.className = "particles-canvas";

  const charactersGrid = document.createElement("div");
  charactersGrid.className = "characters-grid";

  const characters = getSortedCharacters(userData);
  characters.forEach((char) =>
    charactersGrid.appendChild(createCharacterCard(char, userData)),
  );

  const mountCharacterPopup = () => {
    popupShell.mount({
      titleText: "Choose Your Bro",
      onClose: () => closeCharacterSelect(),
      closeButtonAttrs: { "data-sound": "cancel" },
      closeButtonText: "×",
      contentNode: charactersGrid,
      backgroundNode: particlesCanvas,
    });
  };

  // --- Particles background behind popup ---
  let rafId = null;
  const ctx = particlesCanvas.getContext("2d");
  let particles = [];
  const P_COUNT = 100;
  const P_COLOR = "rgba(255,255,255,0.35)";
  const P_COLOR2 = "rgba(120,180,255,0.25)";
  let canvasWidth = 0;
  let canvasHeight = 0;
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = particlesCanvas.clientWidth;
    canvasHeight = particlesCanvas.clientHeight;
    particlesCanvas.width = canvasWidth * dpr;
    particlesCanvas.height = canvasHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function initParticles() {
    particles = new Array(P_COUNT).fill(0).map(() => ({
      x: Math.random() * canvasWidth,
      y: Math.random() * canvasHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5,
      c: Math.random() < 0.5 ? P_COLOR : P_COLOR2,
    }));
  }
  function step() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvasWidth) p.vx *= -1;
      if (p.y < 0 || p.y > canvasHeight) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.c;
      ctx.fill();
    }
    rafId = requestAnimationFrame(step);
  }
  function startParticles() {
    resizeCanvas();
    initParticles();
    if (!rafId) rafId = requestAnimationFrame(step);
  }
  function stopParticles() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    ctx.clearRect(
      0,
      0,
      canvasWidth,
      canvasHeight,
    );
  }
  window.addEventListener("resize", resizeCanvas);

  function openCharacterSelect() {
    mountCharacterPopup();
    // Sync classes (selected/locked/maxed/pricing) whenever chooser opens.
    refreshUpgradeButtonAffordability();
    popupShell.show();
    emitCharacterMenuStatus(true);
    startParticles();
  }
  function closeCharacterSelect() {
    hideCharacterDetails();
    popupShell.hide();
    emitCharacterMenuStatus(false);
    stopParticles();
  }
  window.__openCharacterSelect = openCharacterSelect;
  window.__closeCharacterSelect = closeCharacterSelect;
}

// Build a single character card
function createCharacterCard(character, userData) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "character-card";
  card.dataset.char = character;

  const cardState = getCharacterCardState(character, userData);
  const stats = cardState.stats || getCharacterStats(character) || {};

  card.classList.toggle(
    "selected",
    String(userData?.char_class || "").toLowerCase() ===
      String(character).toLowerCase(),
  );
  card.classList.toggle("locked", cardState.isLocked);
  card.classList.toggle("is-maxed", cardState.isMaxed);
  card.classList.toggle("is-upgrade-ready", cardState.canUpgrade);
  card.classList.toggle("is-unlock-ready", cardState.canUnlock);
  const isSelected =
    String(userData?.char_class || "").toLowerCase() ===
    String(character).toLowerCase();
  card.setAttribute("aria-pressed", String(isSelected));

  // Compact card layout: portrait, name, and progression state. Detailed
  // combat stats live in the expanded character view.
  const profileIconUrl = `/assets/profile-icons/${character}.webp`;

  const imageWrap = document.createElement("div");
  imageWrap.className = "character-card-image-wrap";

  const profileIcon = document.createElement("img");
  profileIcon.className = "character-profile-icon";
  profileIcon.src = profileIconUrl;
  profileIcon.alt = character;
  imageWrap.appendChild(profileIcon);

  if (!cardState.isLocked && cardState.level > 0 && cardState.level <= LEVEL_CAP) {
    const levelIcon = document.createElement("img");
    levelIcon.className = "character-card-level-icon";
    levelIcon.src = `/assets/levels/${cardState.level}.webp`;
    levelIcon.alt = `Level ${cardState.level}`;
    card.appendChild(levelIcon);
  }

  const selectedBadge = document.createElement("span");
  selectedBadge.className = "character-card-selected-badge";
  selectedBadge.textContent = "Selected";
  selectedBadge.hidden = !isSelected;
  card.appendChild(selectedBadge);

  if (cardState.isLocked) {
    const lockOverlay = document.createElement("div");
    lockOverlay.className = "character-card-lock-overlay";
    lockOverlay.innerHTML = '<img src="/assets/lock.webp" alt="Locked" />';
    imageWrap.appendChild(lockOverlay);
  }

  const statusSection = document.createElement("div");
  statusSection.className = "character-card-status";

  const statusText = document.createElement("div");
  statusText.className = "character-card-status-text";

  if (cardState.isLocked) {
    statusText.innerHTML = `<span class="character-card-status-label">Unlock</span> <img src="/assets/gem.webp" alt="" /> <span class="character-card-status-price">${stats.unlockPrice || 0}</span>`;
  } else if (cardState.isMaxed) {
    statusText.classList.add("maxed");
    statusText.innerHTML =
      '<img src="/assets/crown.webp" alt="" /> <span>Max Level</span>';
  } else {
    statusText.classList.add("upgradable");
    statusText.innerHTML = `<img class="character-card-upgrade-icon" src="/assets/upgrade.webp" alt="" /> <span class="character-card-status-label">Upgrade</span> <img src="/assets/coin.webp" alt="" /> <span class="character-card-status-price">${cardState.price}</span>`;
  }

  statusSection.appendChild(statusText);

  // Info section: name and progression state
  const info = document.createElement("div");
  info.className = "character-card-info";

  const nameSection = document.createElement("div");
  nameSection.className = "character-card-name-section";

  const nameRow = document.createElement("div");
  nameRow.className = "character-card-name-row";

  const name = document.createElement("h3");
  name.className = "character-card-name";
  name.textContent = character.toUpperCase();
  nameRow.appendChild(name);
  nameSection.appendChild(nameRow);

  info.appendChild(nameSection);
  info.appendChild(statusSection);

  card.appendChild(imageWrap);
  card.appendChild(info);

  card.addEventListener("click", () => {
    playSound("cursor5", 0.3);
    openCharacterDetails(character);
  });

  card.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openCharacterDetails(character);
  });

  return card;
}

export function openCharacterSelect() {
  if (window.__openCharacterSelect) return window.__openCharacterSelect();
  const overlay = document.querySelector(".character-select-overlay");
  overlay?.classList.remove("is-hidden");
  overlay?.setAttribute("aria-hidden", "false");
  emitCharacterMenuStatus(true);
}

function openCharacterDetails(character) {
  renderCharacterDetails(character);
  const ui = ensureCharacterDetailsUi();
  const wasDetached = !ui.overlay.isConnected;
  if (!ui.overlay.isConnected) {
    document.body.appendChild(ui.overlay);
  }
  if (wasDetached) void ui.overlay.offsetWidth;
  ui.overlay.classList.remove("is-hidden");
  ui.overlay.setAttribute("aria-hidden", "false");
}

async function persistActiveCharacterSelection(character, skinId) {
  const response = await fetch("/skins/select", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      character,
      skinId,
      activateCharacter: true,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error(
      String(payload?.error || "Unable to save this character and skin."),
    );
  }
  return payload;
}

function closeCharacterSelectAfterSelection() {
  if (typeof window.__closeCharacterSelect === "function") {
    window.__closeCharacterSelect();
    return;
  }
  hideCharacterDetails();
  const overlay = document.querySelector(".character-select-overlay");
  if (overlay) {
    overlay.classList.add("is-hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
  emitCharacterMenuStatus(false);
}

async function selectCharacter(character) {
  if (_characterSelectionPromise) return false;
  const charClass = normalizeCharacterId(character);
  const selectedSkin = getSelectedSkin(charClass);
  const selectedSkinId = String(selectedSkin?.id || "").trim();
  if (!charClass || !selectedSkinId || selectedSkin?.locked) return false;

  _characterSelectionPromise = persistActiveCharacterSelection(
    charClass,
    selectedSkinId,
  );

  try {
    const persisted = await _characterSelectionPromise;
    const selectedSkinAsset = resolveCharacterPreviewAsset(
      charClass,
      selectedSkinId,
    );

    // Update local state only after the server has atomically saved both the
    // active character and its selected skin.
    if (_userDataRef) {
      _userDataRef.char_class = charClass;
      _userDataRef.selected_skin_id_by_char =
        _userDataRef.selected_skin_id_by_char || {};
      Object.assign(
        _userDataRef.selected_skin_id_by_char,
        persisted?.selectedSkinIdByCharacter || {},
        { [charClass]: selectedSkinId },
      );
    }
    _confirmedSkinSelections[charClass] = selectedSkinId;

    // Update the main body sprite image immediately
    const mainSprite = document.getElementById("sprite");
    if (mainSprite) {
      mainSprite.src = selectedSkinAsset;
      mainSprite.alt = charClass;
      try {
        mainSprite.classList.remove("random");
      } catch {}
    }

    // Update current user's visible slot, if present
    const yourSlot =
      document.querySelector('.character-slot[data-is-current-user="true"]') ||
      document.getElementById("your-slot-1");
    if (yourSlot) {
      const spriteEl = yourSlot.querySelector(".character-sprite");
      const prevCharacter = String(yourSlot.dataset.character || "").trim();
      if (spriteEl) {
        spriteEl.src = selectedSkinAsset;
        spriteEl.alt = charClass;
        spriteEl.classList.remove("random");
      }
      yourSlot.dataset.character = charClass;
      yourSlot.classList.remove("empty");
      const charLevels =
        typeof _userDataRef?.char_levels === "object" &&
        _userDataRef?.char_levels
          ? _userDataRef.char_levels
          : {};
      setLobbySlotLevelIcon(
        yourSlot,
        Math.max(1, Number(charLevels?.[charClass]) || 1),
      );
      if (prevCharacter && prevCharacter !== charClass) {
        triggerLobbyCharacterSplash(yourSlot);
      }
    }

    // Broadcast the already-persisted selection so party rosters update now.
    const partyId = getActivePartyIdFromPath();
    if (partyId) {
      socket.emit("char-change", {
        partyId,
        character: charClass,
        selectedSkinId,
      });
    } else {
      socket.emit("char-change", { character: charClass, selectedSkinId });
    }

    // Keep chooser card highlight synced immediately after selection.
    refreshUpgradeButtonAffordability();
    closeCharacterSelectAfterSelection();
    playSound("cursor4", 0.4);
    return true;
  } catch (e) {
    console.warn("selectCharacter failed:", e?.message);
    showErrorDialog(
      e?.message || "Unable to save this character and skin.",
      "Selection Not Saved",
    );
    return false;
  } finally {
    _characterSelectionPromise = null;
  }
}

function closeConfirmationBackdrop(backdrop) {
  if (!backdrop || backdrop.dataset.dismissPending === "true") return;
  backdrop.dataset.dismissPending = "true";
  backdrop.__removePriorityEscape?.();
  dismissPopup(backdrop, () => backdrop.remove());
}

// Confirmation dialogs receive Escape at window capture phase so they close
// before the expanded character view or the shared selection overlay.
function installPriorityEscape(backdrop) {
  const handleEscape = (event) => {
    if (event.key !== "Escape" || !backdrop.isConnected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeConfirmationBackdrop(backdrop);
  };
  window.addEventListener("keydown", handleEscape, true);
  backdrop.__removePriorityEscape = () => {
    window.removeEventListener("keydown", handleEscape, true);
    backdrop.__removePriorityEscape = null;
  };
}

// Render a small confirmation dialog for upgrades or unlocks
function showConfirmDialog(opts, onConfirm) {
  const { type, character, level, price } = opts;
  const overlay = document.querySelector(".character-select-overlay");
  if (!overlay) return onConfirm && onConfirm();

  const coins = Number(_userDataRef?.coins ?? 0);
  const gems = Number(_userDataRef?.gems ?? 0);
  const isUpgrade = type === "upgrade";
  const current = isUpgrade ? coins : gems;
  const remaining = current - Number(price || 0);

  if (remaining < 0) {
    return showInsufficientDialog(isUpgrade ? "coins" : "gems");
  }

  const backdrop = document.createElement("div");
  backdrop.className = "cs-confirm-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "cs-confirm";
  // prevent clicks inside dialog from closing parent
  dialog.addEventListener("click", (e) => e.stopPropagation());
  const title = document.createElement("div");
  title.className = "cs-confirm-title";
  title.textContent = isUpgrade ? "Confirm Upgrade" : "Confirm Unlock";

  const msg = document.createElement("div");
  msg.className = "cs-confirm-body";
  // Character hero visual only for unlock (buy)
  if (!isUpgrade) {
    const hero = document.createElement("div");
    hero.className = "cs-hero";
    const heroBeams = document.createElement("div");
    heroBeams.className = "cs-hero-beams gem"; // gem theme (bluish)
    const heroImg = document.createElement("img");
    heroImg.className = "cs-hero-img";
    heroImg.src = resolveCharacterPreviewAsset(character, getSelectedSkin(character)?.id);
    heroImg.alt = character;
    hero.appendChild(heroBeams);
    hero.appendChild(heroImg);
    msg.appendChild(hero);
  }
  // Level line focus for upgrades
  if (isUpgrade) {
    const levelLine = document.createElement("div");
    levelLine.className = "cs-level-line";
    const currImg = document.createElement("img");
    currImg.className = "cs-level-img";
    currImg.src = `/assets/levels/${level}.webp`;
    currImg.alt = `Level ${level}`;
    const arrow = document.createElement("img");
    arrow.className = "cs-arrow";
    arrow.src = "/assets/arrow.webp";
    arrow.alt = ">";
    const nextWrap = document.createElement("div");
    nextWrap.className = "cs-next-wrap";
    const beams = document.createElement("div");
    beams.className = "cs-beams coin"; // coin theme (golden rays)
    const nextImg = document.createElement("img");
    nextImg.className = "cs-next-badge";
    nextImg.src = `/assets/levels/${Math.min(level + 1, LEVEL_CAP)}.webp`;
    nextImg.alt = `Level ${Math.min(level + 1, LEVEL_CAP)}`;
    nextWrap.appendChild(beams);
    nextWrap.appendChild(nextImg);
    levelLine.appendChild(currImg);
    levelLine.appendChild(arrow);
    levelLine.appendChild(nextWrap);
    msg.appendChild(levelLine);
  }

  const priceRow = document.createElement("p");
  priceRow.className = "cs-price-row";
  const remainingIcon = document.createElement("img");
  remainingIcon.className = "cs-currency";
  remainingIcon.src = isUpgrade ? "/assets/coin.webp" : "/assets/gem.webp";
  remainingIcon.alt = isUpgrade ? "Coins" : "Gems";
  const remainingText = document.createElement("span");
  remainingText.textContent = `Remaining after purchase: ${Math.max(
    remaining,
    0,
  )}`;
  priceRow.appendChild(remainingIcon);
  priceRow.appendChild(remainingText);
  msg.appendChild(priceRow);

  const actions = document.createElement("div");
  actions.className = "cs-confirm-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cs-btn cancel pixel-menu-button";
  cancelBtn.textContent = "Cancel";
  const okBtn = document.createElement("button");
  okBtn.className = "cs-btn confirm pixel-menu-button";
  okBtn.innerHTML = `<img class="cs-currency" src="${
    isUpgrade ? "/assets/coin.webp" : "/assets/gem.webp"
  }" alt=""/> <span>${price}</span>`;

  cancelBtn.onclick = () => {
    playSound("cursor4", 0.2);
    closeConfirmationBackdrop(backdrop);
  };
  // Click-out to close confirm
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeConfirmationBackdrop(backdrop);
    }
    e.stopPropagation();
  });
  okBtn.onclick = () => {
    closeConfirmationBackdrop(backdrop);
    playSound("cursor4", 0.2);

    onConfirm && onConfirm();
  };

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  dialog.appendChild(title);
  dialog.appendChild(msg);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);
  // attach to body so overlay click-out doesn't also fire
  document.body.appendChild(backdrop);
  installPriorityEscape(backdrop);
}

function showInsufficientDialog(currency) {
  const overlay = document.querySelector(".character-select-overlay");
  if (!overlay) return;
  const backdrop = document.createElement("div");
  backdrop.className = "cs-confirm-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "cs-confirm";
  dialog.addEventListener("click", (e) => e.stopPropagation());
  const title = document.createElement("div");
  title.className = "cs-confirm-title";
  title.textContent = "Not enough funds";
  const body = document.createElement("div");
  body.className = "cs-confirm-body";
  const p = document.createElement("p");
  const icon = document.createElement("img");
  icon.className = "cs-currency";
  icon.src = currency === "coins" ? "/assets/coin.webp" : "/assets/gem.webp";
  icon.alt = currency;
  p.appendChild(icon);
  const txt = document.createElement("span");
  txt.textContent = ` Not enough ${currency} to complete this purchase.`;
  p.appendChild(txt);
  body.appendChild(p);
  const actions = document.createElement("div");
  actions.className = "cs-confirm-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "cs-btn cancel pixel-menu-button";
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => {
    closeConfirmationBackdrop(backdrop);
  };
  actions.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(body);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeConfirmationBackdrop(backdrop);
    }
    e.stopPropagation();
  });
  document.body.appendChild(backdrop);
  installPriorityEscape(backdrop);
}

// Generic error dialog for server-side errors
function showErrorDialog(message, titleText = "Purchase failed") {
  const backdrop = document.createElement("div");
  backdrop.className = "cs-confirm-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "cs-confirm";
  dialog.addEventListener("click", (e) => e.stopPropagation());
  const title = document.createElement("div");
  title.className = "cs-confirm-title";
  title.textContent = titleText;
  const body = document.createElement("div");
  body.className = "cs-confirm-body";
  const p = document.createElement("p");
  p.textContent = message || "Something went wrong. Please try again.";
  body.appendChild(p);
  const actions = document.createElement("div");
  actions.className = "cs-confirm-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "cs-btn cancel pixel-menu-button";
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => {
    closeConfirmationBackdrop(backdrop);
  };
  actions.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(body);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeConfirmationBackdrop(backdrop);
    }
    e.stopPropagation();
  });
  document.body.appendChild(backdrop);
  installPriorityEscape(backdrop);
}

// Replace a specific character card with a freshly rendered one.
function rerenderCharacterCard(character, userData) {
  const grid = document.querySelector(".characters-grid");
  const oldCard =
    grid &&
    grid.querySelector(`.character-card[data-char="${CSS.escape(character)}"]`);
  if (!oldCard || !grid) return;
  const newCard = createCharacterCard(character, userData);
  grid.replaceChild(newCard, oldCard);
  if (_characterDetailsUi?.currentCharacter === character) {
    renderCharacterDetails(character);
  }
  sortCharacterCardsInGrid(userData);
  // After any change, also refresh other cards' affordability/state
  try {
    refreshUpgradeButtonAffordability();
  } catch {}
}

// Upgrade / unlock stubs
function applyUpgrade(character, currentLevel) {
  const previousState = getCharacterCardState(character, _userDataRef);
  fetch("/upgrade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ character }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) {
        _upgradePreview = null;
        if (_characterDetailsUi?.currentCharacter === character) {
          renderCharacterDetails(character);
        }
        showErrorDialog(data.message || "Upgrade failed.");
        return;
      }

      try {
        const upgradedLevel = Number(data.newLevel);
        if (_userDataRef) {
          const spent = Number(data.spent || 0);
          _userDataRef.coins = Math.max(
            0,
            Number(_userDataRef.coins || 0) - spent,
          );
          if (
            !_userDataRef.char_levels ||
            typeof _userDataRef.char_levels !== "object"
          ) {
            _userDataRef.char_levels = {};
          }
          if (!Number.isNaN(upgradedLevel)) {
            _userDataRef.char_levels[character] = upgradedLevel;
          }
        }
        if (!Number.isNaN(upgradedLevel)) {
          syncCurrentUserLobbyLevel(character, upgradedLevel);
        }
      } catch {}

      _upgradePreview = null;
      _pendingUpgradeAnimation = {
        character,
        from: {
          health: previousState.currentHealth,
          damage: previousState.currentDamage,
          special: previousState.currentSpecial,
        },
      };
      playSound("upgrade", 0.6);
      rerenderCharacterCard(character, _userDataRef);
      refreshUpgradeButtonAffordability();
      playCharacterDetailsSuccessAnimation("upgrade");
    })
    .catch((error) => {
      _upgradePreview = null;
      if (_characterDetailsUi?.currentCharacter === character) {
        renderCharacterDetails(character);
      }
      showErrorDialog(error?.message || "Network error.");
    });
}

function applyUnlock(character, price) {
  fetch("/buy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ character }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) {
        showErrorDialog(data.message || "Unlock failed.");
        return;
      }

      try {
        if (_userDataRef) {
          const spent = Number(data.spent || price || 0);
          const unlockedLevel = Number(data.newLevel || 1);
          _userDataRef.gems = Math.max(
            0,
            Number(_userDataRef.gems || 0) - spent,
          );
          if (
            !_userDataRef.char_levels ||
            typeof _userDataRef.char_levels !== "object"
          ) {
            _userDataRef.char_levels = {};
          }
          _userDataRef.char_levels[character] = unlockedLevel;
        }
      } catch {}

      playSound("unlock", 0.6);
      rerenderCharacterCard(character, _userDataRef);
      refreshUpgradeButtonAffordability();
      playCharacterDetailsSuccessAnimation("unlock");
    })
    .catch((error) => {
      showErrorDialog(error?.message || "Network error.");
    });
}

// Re-evaluate visible cards against current coin balance
function refreshUpgradeButtonAffordability() {
  const cards = document.querySelectorAll(".character-card");
  cards.forEach((card) => {
    try {
      const character = card.dataset.char;
      if (!character) return;
      const state = getCharacterCardState(character, _userDataRef);
      const statusText = card.querySelector(".character-card-status-text");
      if (!statusText) return;

      card.classList.toggle(
        "selected",
        String(_userDataRef?.char_class || "").toLowerCase() ===
          String(character).toLowerCase(),
      );
      const selected = card.classList.contains("selected");
      card.setAttribute("aria-pressed", String(selected));
      const selectedBadge = card.querySelector(".character-card-selected-badge");
      if (selectedBadge) selectedBadge.hidden = !selected;
      card.classList.toggle("locked", state.isLocked);
      card.classList.toggle("is-maxed", state.isMaxed);
      card.classList.toggle("is-upgrade-ready", state.canUpgrade);
      card.classList.toggle("is-unlock-ready", state.canUnlock);

      if (state.isLocked) {
        statusText.className = "character-card-status-text";
        statusText.innerHTML = `<span class="character-card-status-label">Unlock</span> <img src="/assets/gem.webp" alt="" /> <span class="character-card-status-price">${state.stats?.unlockPrice || 0}</span>`;
        return;
      }

      if (state.isMaxed) {
        statusText.className = "character-card-status-text maxed";
        statusText.innerHTML =
          '<img src="/assets/crown.webp" alt="" /> <span>Max Level</span>';
        return;
      }

      statusText.className =
        "character-card-status-text upgradable";
      statusText.innerHTML = `<img class="character-card-upgrade-icon" src="/assets/upgrade.webp" alt="" /> <span class="character-card-status-label">Upgrade</span> <img src="/assets/coin.webp" alt="" /> <span class="character-card-status-price">${state.price || 0}</span>`;
    } catch {}
  });
  sortCharacterCardsInGrid(_userDataRef);
}
