import {
  getCharacterStats,
  getAllCharacters,
  getHealth,
  getDamage,
  getSpecialDamage,
  LEVEL_CAP,
  upgradePrice,
} from "./lib/characterStats.js";
import { getSharedSelectionPopupShell } from "./lib/selectionPopupShell.js";
import socket from "./socket.js";
import { playSound } from "./lib/uiSounds.js";

// Keep a reference to user data for confirmations and currency display
let _userDataRef = null;
let _characterDetailsUi = null;

function getCharacterSkinList(character) {
  const stats = getCharacterStats(character) || {};
  const skins = Array.isArray(stats.skins) ? stats.skins : [];
  const normalized = skins
    .map((skin, index) => ({
      id:
        String(skin?.id || skin?.skinId || skin?.key || "").trim() ||
        (index === 0 ? "default" : `skin-${index + 1}`),
      label:
        String(skin?.label || skin?.name || skin?.title || "").trim() ||
        (index === 0 ? "Default" : `Skin ${index + 1}`),
      previewSrc:
        String(skin?.previewSrc || skin?.bodySrc || skin?.src || "").trim() ||
        `/assets/${character}/body.webp`,
    }))
    .filter((skin) => skin.id);

  if (normalized.length === 0) {
    normalized.push({
      id: "default",
      label: "Default",
      previewSrc: `/assets/${character}/body.webp`,
    });
  }

  return normalized;
}

function getSelectedSkin(character) {
  const skinId = String(
    _characterDetailsUi?.selectedSkinByCharacter?.[character] || "",
  ).trim();
  const skins = getCharacterSkinList(character);
  return skins.find((skin) => skin.id === skinId) || skins[0];
}

function setSelectedSkin(character, skinId) {
  if (!_characterDetailsUi) return;
  const skins = getCharacterSkinList(character);
  const nextSkin =
    skins.find((skin) => skin.id === String(skinId || "")) || skins[0];
  _characterDetailsUi.selectedSkinByCharacter[character] = nextSkin.id;
  if (_characterDetailsUi.currentCharacter === character) {
    renderCharacterDetails(character);
  }
}

function resolveCharacterPreviewAsset(character, skinId) {
  const skins = getCharacterSkinList(character);
  const skin =
    skins.find((entry) => entry.id === String(skinId || "")) || skins[0];
  return skin?.previewSrc || `/assets/${character}/body.webp`;
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
  const currentSpecial = getSpecialDamage(character, currentLevel);
  const maxHealth = getHealth(character, LEVEL_CAP);
  const maxDamage = getDamage(character, LEVEL_CAP);
  const maxSpecial = getSpecialDamage(character, LEVEL_CAP);
  const price = !isLocked && !isMaxed ? upgradePrice(level) : null;
  const coins = Number(userData?.coins || 0);
  const canUpgrade =
    !isLocked && !isMaxed && Number.isFinite(price) && coins >= price;

  return {
    stats,
    level,
    isLocked,
    isMaxed,
    currentLevel,
    currentHealth,
    currentDamage,
    currentSpecial,
    maxHealth,
    maxDamage,
    maxSpecial,
    price,
    canUpgrade,
    skin: getSelectedSkin(character),
  };
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
  _characterDetailsUi.overlay.style.display = "none";
  _characterDetailsUi.currentCharacter = null;
}

function ensureCharacterDetailsUi() {
  if (_characterDetailsUi) return _characterDetailsUi;

  const overlay = document.createElement("div");
  overlay.className = "character-details-overlay";
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

  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);

  const closeButton = document.createElement("button");
  closeButton.className = "close pixel-menu-button profile-close";
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
    if (overlay.style.display === "none" || !overlay.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    closeDetails();
  };

  document.addEventListener("keydown", state.keydownHandler);

  _characterDetailsUi = state;
  return state;
}

function renderCharacterDetails(character) {
  const ui = ensureCharacterDetailsUi();
  const stats = getCharacterStats(character);
  if (!stats) return;

  const cardState = getCharacterCardState(character, _userDataRef);
  const selectedSkin = getSelectedSkin(character);

  ui.currentCharacter = character;
  ui.selectedSkinByCharacter[character] = selectedSkin.id;

  ui.title.textContent = character.toUpperCase();
  ui.subtitle.textContent = stats.description || "";

  ui.preview.innerHTML = "";
  ui.info.innerHTML = "";
  ui.stickyFooter.innerHTML = "";

  // Smaller preview frame (game style - no rounded corners)
  const previewFrame = document.createElement("div");
  previewFrame.className =
    `character-details-preview-frame ${cardState.isLocked ? "is-locked" : ""}`.trim();

  const previewGlow = document.createElement("div");
  previewGlow.className = "character-details-preview-glow";

  const previewImg = document.createElement("img");
  previewImg.className = "character-details-preview-image";
  previewImg.src = resolveCharacterPreviewAsset(character, selectedSkin.id);
  previewImg.alt = `${character} ${selectedSkin.label}`;

  if (!cardState.isLocked && cardState.level > 0 && cardState.level <= 5) {
    const levelBadge = document.createElement("img");
    levelBadge.className = "character-details-preview-level-badge";
    levelBadge.src = `/assets/levels/${cardState.level}.webp`;
    levelBadge.alt = `Level ${cardState.level}`;
    previewFrame.appendChild(levelBadge);
  }

  previewFrame.appendChild(previewGlow);
  previewFrame.appendChild(previewImg);

  ui.preview.appendChild(previewFrame);
  ui.previewStage = previewFrame;

  // Three main stat boxes: Health (full width top), Attack and Special (side by side)
  const statsContainer = document.createElement("div");
  statsContainer.className = "character-details-stats-container";

  // Health box (full width)
  const healthBox = document.createElement("div");
  healthBox.className = "character-details-stat-box health-box";
  const healthMax = Math.max(1, Number(cardState.maxHealth || 1));
  healthBox.innerHTML = `
    <div class="stat-box-header">
      <img class="stat-box-icon" src="/assets/heart.webp" alt="Health" />
      <span class="stat-box-label">Health</span>
      <span class="stat-box-value">${cardState.currentHealth}</span>
    </div>
    <div class="stat-box-track"><div class="stat-box-fill" style="width:${Math.max(0, Math.min(100, (cardState.currentHealth / healthMax) * 100))}%"></div></div>
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
      <span class="stat-box-value">${cardState.currentDamage}</span>
    </div>
    <div class="stat-box-track"><div class="stat-box-fill" style="width:${Math.max(0, Math.min(100, (cardState.currentDamage / attackMax) * 100))}%"></div></div>
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
      <span class="stat-box-value">${cardState.currentSpecial}</span>
    </div>
    <div class="stat-box-track"><div class="stat-box-fill" style="width:${Math.max(0, Math.min(100, (cardState.currentSpecial / specialMax) * 100))}%"></div></div>
    <div class="stat-box-content">
      ${stats.specialDescription ? `<div class="stat-box-desc">${stats.specialDescription}</div>` : ""}
      <div class="stat-box-detail">Charge: ${stats.specialChargeHits || 0} hits</div>
    </div>
  `;
  attackSpecialRow.appendChild(specialBox);

  statsContainer.appendChild(attackSpecialRow);
  ui.info.appendChild(statsContainer);

  // Sticky footer: skins and actions in one line
  const footerLine = document.createElement("div");
  footerLine.className = "character-details-footer-line";

  const skinRow = document.createElement("div");
  skinRow.className = "character-details-inline-skin";

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
  prevButton.textContent = "◀";
  prevButton.disabled = skins.length <= 1;
  prevButton.addEventListener("click", () => {
    if (skins.length <= 1) return;
    playSound("cursor4", 0.2);
    setSelectedSkin(character, prevSkin.id);
  });

  const skinChip = document.createElement("div");
  skinChip.className = "character-details-skin-name-box";
  skinChip.textContent = selectedSkin.label;

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "character-details-skin-stepper";
  nextButton.textContent = "▶";
  nextButton.disabled = skins.length <= 1;
  nextButton.addEventListener("click", () => {
    if (skins.length <= 1) return;
    playSound("cursor4", 0.2);
    setSelectedSkin(character, nextSkin.id);
  });

  skinRow.appendChild(prevButton);
  skinRow.appendChild(skinChip);
  skinRow.appendChild(nextButton);

  const footer = document.createElement("div");
  footer.className = "character-details-inline-actions";

  if (cardState.isLocked) {
    const buyButton = document.createElement("button");
    buyButton.type = "button";
    buyButton.className =
      "character-details-action buy-button pixel-menu-button";
    buyButton.innerHTML = `<img class="upgrade-icon" src="/assets/lock.webp" alt="" /> <span>Buy</span> <span class="button-price"><img class="cs-currency" src="/assets/gem.webp" alt="" /> ${stats.unlockPrice || 0}</span>`;
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
      upgradeButton.className = `character-details-action upgrade-button pixel-menu-button${cardState.canUpgrade ? "" : " disabled"}`;
      upgradeButton.innerHTML = `<img class="upgrade-icon" src="/assets/upgrade.webp" alt="" /> <span>Upgrade</span> <span class="button-price"><img class="cs-currency" src="/assets/coin.webp" alt="" /> ${cardState.price}</span>`;
      if (!cardState.canUpgrade) {
        upgradeButton.title = "Not enough coins";
        upgradeButton.disabled = true;
      }
      upgradeButton.addEventListener("click", (e) => {
        e.stopPropagation();
        playSound("cursor4", 0.2);
        showConfirmDialog(
          {
            type: "upgrade",
            character,
            level: cardState.level,
            price: cardState.price,
          },
          () => applyUpgrade(character, cardState.level),
        );
      });
      footer.appendChild(upgradeButton);
    } else {
      const maxedLabel = document.createElement("div");
      maxedLabel.className = "character-details-maxed-label";
      maxedLabel.textContent = "Max Level";
      footer.appendChild(maxedLabel);
    }

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className =
      "character-details-action select-button pixel-menu-button";
    selectButton.textContent = "Select";
    selectButton.addEventListener("click", (e) => {
      e.stopPropagation();
      playSound("cursor4", 0.2);
      selectCharacter(character);
    });
    footer.appendChild(selectButton);
  }

  footerLine.appendChild(skinRow);
  footerLine.appendChild(footer);
  ui.stickyFooter.appendChild(footerLine);
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
    const iconLevel = Math.max(1, Math.min(5, Number(level)));
    badge.innerHTML = `<img src="/assets/levels/${iconLevel}.webp" alt="" />`;
    badge.dataset.level = String(iconLevel);
    slot.classList.add("has-level");
  } else {
    badge.innerHTML = "";
    delete badge.dataset.level;
    slot.classList.remove("has-level");
  }
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
  const popupShell = getSharedSelectionPopupShell();

  const particlesCanvas = document.createElement("canvas");
  particlesCanvas.className = "particles-canvas";

  const charactersGrid = document.createElement("div");
  charactersGrid.className = "characters-grid";

  const characters = getAllCharacters();
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
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    particlesCanvas.width = particlesCanvas.clientWidth * dpr;
    particlesCanvas.height = particlesCanvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function initParticles() {
    particles = new Array(P_COUNT).fill(0).map(() => ({
      x: Math.random() * particlesCanvas.clientWidth,
      y: Math.random() * particlesCanvas.clientHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5,
      c: Math.random() < 0.5 ? P_COLOR : P_COLOR2,
    }));
  }
  function step() {
    const w = particlesCanvas.clientWidth;
    const h = particlesCanvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
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
      particlesCanvas.clientWidth,
      particlesCanvas.clientHeight,
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

  // Card layout: fixed-size icon column + stacked info column
  const profileIconUrl = `/assets/profile-icons/${character}.webp`;

  const imageWrap = document.createElement("div");
  imageWrap.className = "character-card-image-wrap";

  const profileIcon = document.createElement("img");
  profileIcon.className = "character-profile-icon";
  profileIcon.src = profileIconUrl;
  profileIcon.alt = character;
  imageWrap.appendChild(profileIcon);

  if (!cardState.isLocked && cardState.level > 0 && cardState.level <= 5) {
    const levelIcon = document.createElement("img");
    levelIcon.className = "character-card-level-icon";
    levelIcon.src = `/assets/levels/${cardState.level}.webp`;
    levelIcon.alt = `Level ${cardState.level}`;
    card.appendChild(levelIcon);
  }

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
    statusText.innerHTML = `<img src="/assets/gem.webp" alt="" /> <span class="character-card-status-price">${stats.unlockPrice || 0}</span>`;
  } else if (cardState.isMaxed) {
    statusText.classList.add("maxed");
    statusText.textContent = "MAX";
  } else {
    statusText.classList.add("upgradable");
    statusText.classList.toggle("insufficient", !cardState.canUpgrade);
    statusText.innerHTML = `<img src="/assets/coin.webp" alt="" /> <span class="character-card-status-price">${cardState.price}</span>`;
  }

  statusSection.appendChild(statusText);
  imageWrap.appendChild(statusSection);

  // Info section: name, stats, status
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

  // HP and ATK blocks with value + bar
  const statsRow = document.createElement("div");
  statsRow.className = "character-card-stats-row";

  const healthStat = document.createElement("div");
  healthStat.className = "character-card-stat";
  healthStat.innerHTML = `
    <span class="stat-label"><img height="17" src="/assets/heart.webp" alt="Health" />HEALTH</span>
    <span class="stat-value health">${cardState.currentHealth}</span>
  `;

  const damageStat = document.createElement("div");
  damageStat.className = "character-card-stat";
  damageStat.innerHTML = `
    <span class="stat-label"><img height="17" src="/assets/attack.webp" alt="Attack" />ATTACK</span>
    <span class="stat-value damage">${cardState.currentDamage}</span>
  `;

  const specialStat = document.createElement("div");
  specialStat.className = "character-card-stat";
  specialStat.innerHTML = `
    <span class="stat-label"><img height="17" src="/assets/special.webp" alt="Special" />SPECIAL</span>
    <span class="stat-value special">${cardState.currentSpecial}</span>
  `;

  statsRow.appendChild(healthStat);
  statsRow.appendChild(damageStat);
  statsRow.appendChild(specialStat);

  info.appendChild(nameSection);
  info.appendChild(statsRow);

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
  overlay.style.display = "flex";
  emitCharacterMenuStatus(true);
}

function openCharacterDetails(character) {
  renderCharacterDetails(character);
  const ui = ensureCharacterDetailsUi();
  if (!ui.overlay.isConnected) {
    document.body.appendChild(ui.overlay);
  }
  ui.overlay.style.display = "flex";
}

function selectCharacter(character) {
  try {
    const charClass = String(character);
    // Optimistically update local user data
    if (_userDataRef) _userDataRef.char_class = charClass;

    // Update the main body sprite image immediately
    const mainSprite = document.getElementById("sprite");
    if (mainSprite) {
      mainSprite.src = `/assets/${charClass}/body.webp`;
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
        spriteEl.src = `/assets/${charClass}/body.webp`;
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

    // If in a party, emit socket event so others update
    const partyId = getActivePartyIdFromPath();
    if (partyId) {
      socket.emit("char-change", { partyId, character: charClass });
    } else {
      // Not in party: still persist to server so future sessions load it
      // Use the same socket channel without partyId; server will update only the user row
      socket.emit("char-change", { character: charClass });
    }

    // Restore presence immediately on successful selection so other clients
    // do not get stuck on "Selecting Character" until the next status update.
    emitCharacterMenuStatus(false);

    // Keep chooser card highlight synced immediately after selection.
    refreshUpgradeButtonAffordability();
  } catch (e) {
    console.warn("selectCharacter failed:", e?.message);
  } finally {
    playSound("cursor4", 0.4);

    hideCharacterDetails();

    const overlay = document.querySelector(".character-select-overlay");
    if (overlay) overlay.style.display = "none";
  }
}

// Small confirm modal helper
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
    heroImg.src = `/assets/${character}/body.webp`;
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

    backdrop.remove();
  };
  // Click-out to close confirm
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
    e.stopPropagation();
  });
  okBtn.onclick = () => {
    backdrop.remove();
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
  closeBtn.className = "close pixel-menu-button profile-close";
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => backdrop.remove();
  actions.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(body);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
    e.stopPropagation();
  });
  document.body.appendChild(backdrop);
}

// Generic error dialog for server-side errors
function showErrorDialog(message) {
  const backdrop = document.createElement("div");
  backdrop.className = "cs-confirm-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "cs-confirm";
  dialog.addEventListener("click", (e) => e.stopPropagation());
  const title = document.createElement("div");
  title.className = "cs-confirm-title";
  title.textContent = "Purchase failed";
  const body = document.createElement("div");
  body.className = "cs-confirm-body";
  const p = document.createElement("p");
  p.textContent = message || "Something went wrong. Please try again.";
  body.appendChild(p);
  const actions = document.createElement("div");
  actions.className = "cs-confirm-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "close pixel-menu-button profile-close";
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => backdrop.remove();
  actions.appendChild(closeBtn);
  dialog.appendChild(title);
  dialog.appendChild(body);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
    e.stopPropagation();
  });
  document.body.appendChild(backdrop);
}

// Replace a specific character card with a freshly rendered one and play a success animation
function rerenderCharacterCard(character, userData, animType) {
  const grid = document.querySelector(".characters-grid");
  const oldCard =
    grid &&
    grid.querySelector(`.character-card[data-char="${CSS.escape(character)}"]`);
  if (!oldCard || !grid) return;
  const newCard = createCharacterCard(character, userData);
  grid.replaceChild(newCard, oldCard);
  if (_characterDetailsUi?.currentCharacter === character) {
    renderCharacterDetails(character);
    playCharacterDetailsSuccessAnimation(animType);
  }
  // After any change, also refresh other cards' affordability/state
  try {
    refreshUpgradeButtonAffordability();
  } catch {}
}

// Upgrade / unlock stubs
function applyUpgrade(character, currentLevel) {
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
        showErrorDialog(data.message || "Upgrade failed.");
        return;
      }

      try {
        if (_userDataRef) {
          const spent = Number(data.spent || 0);
          const newLevel = Number(data.newLevel);
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
          if (!Number.isNaN(newLevel)) {
            _userDataRef.char_levels[character] = newLevel;
          }
        }
      } catch {}

      rerenderCharacterCard(character, _userDataRef, "upgrade");
      refreshUpgradeButtonAffordability();
      playCharacterDetailsSuccessAnimation("upgrade");
    })
    .catch((error) => {
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

      rerenderCharacterCard(character, _userDataRef, "unlock");
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
      card.classList.toggle("locked", state.isLocked);
      card.classList.toggle("is-maxed", state.isMaxed);
      card.classList.toggle("is-upgrade-ready", state.canUpgrade);

      if (state.isLocked) {
        statusText.className = "character-card-status-text";
        statusText.innerHTML = `<img src="/assets/gem.webp" alt="" /> <span class="character-card-status-price">${state.stats?.unlockPrice || 0}</span>`;
        return;
      }

      if (state.isMaxed) {
        statusText.className = "character-card-status-text maxed";
        statusText.textContent = "MAX";
        return;
      }

      statusText.className =
        `character-card-status-text upgradable ${state.canUpgrade ? "" : "insufficient"}`.trim();
      statusText.innerHTML = `<img src="/assets/coin.webp" alt="" /> <span class="character-card-status-price">${state.price || 0}</span>`;
    } catch {}
  });
}
