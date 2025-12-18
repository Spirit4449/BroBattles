import {
  getCharacterStats,
  getAllCharacters,
  getHealth,
  getDamage,
  getSpecialDamage,
  LEVEL_CAP,
  upgradePrice,
} from "./lib/characterStats.js";
import socket from "./socket.js";
import { playSound } from "./lib/uiSounds.js";

// Keep a reference to user data for confirmations and currency display
let _userDataRef = null;

export function initializeCharacterSelect(userData) {
  _userDataRef = userData;
  const overlay = document.createElement("div");
  overlay.className = "character-select-overlay";

  const particlesCanvas = document.createElement("canvas");
  particlesCanvas.className = "particles-canvas";
  overlay.appendChild(particlesCanvas);

  const popup = document.createElement("div");
  popup.className = "character-select-popup";

  const headerBar = document.createElement("div");
  headerBar.className = "popup-header";

  const title = document.createElement("h2");
  title.className = "popup-title";
  title.textContent = "Choose Your Fighter";

  const closeButton = document.createElement("button");
  closeButton.className = "close-popup";
  closeButton.innerHTML = "×";
  closeButton.onclick = () => closeCharacterSelect();
  closeButton.setAttribute("data-sound", "cancel");

  const charactersGrid = document.createElement("div");
  charactersGrid.className = "characters-grid";

  const characters = getAllCharacters();
  characters.forEach((char) =>
    charactersGrid.appendChild(createCharacterCard(char, userData))
  );

  headerBar.appendChild(title);
  headerBar.appendChild(closeButton);
  popup.appendChild(headerBar);
  popup.appendChild(charactersGrid);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Close character select when clicking outside the popup
  overlay.addEventListener("click", (e) => {
    if (!popup.contains(e.target)) closeCharacterSelect();
  });
  // Prevent clicks inside popup from bubbling to overlay
  popup.addEventListener("click", (e) => e.stopPropagation());

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
      particlesCanvas.clientHeight
    );
  }
  window.addEventListener("resize", resizeCanvas);

  function openCharacterSelect() {
    overlay.style.display = "flex";
    startParticles();
  }
  function closeCharacterSelect() {
    overlay.style.display = "none";
    stopParticles();
  }
  window.__openCharacterSelect = openCharacterSelect;
  window.__closeCharacterSelect = closeCharacterSelect;
}

// Build a single character card
function createCharacterCard(character, userData) {
  const card = document.createElement("div");
  card.className = "character-card";
  // Tag card for easy lookup/re-render later
  card.dataset.char = character;

  const stats = getCharacterStats(character);
  const level =
    (userData?.char_levels && (userData.char_levels[character] ?? 0)) ?? 0;
  const isLocked = level === 0;
  const isMaxed = level >= LEVEL_CAP;

  const currentHealth = getHealth(character, Math.max(1, level));
  const currentDamage = getDamage(character, Math.max(1, level));
  const currentSpecial = getSpecialDamage(character, Math.max(1, level));
  const maxHealth = getHealth(character, LEVEL_CAP);
  const maxDamage = getDamage(character, LEVEL_CAP);
  const maxSpecial = getSpecialDamage(character, LEVEL_CAP);

  // Header
  const header = document.createElement("div");
  header.className = "character-header";
  const img = document.createElement("img");
  img.className = "character-image";
  img.src = `/assets/${character}/body.webp`;
  img.alt = character;
  const info = document.createElement("div");
  info.className = "character-info";
  const name = document.createElement("h3");
  name.className = "character-name";
  name.textContent = character;
  const description = document.createElement("p");
  description.className = "character-description";
  description.textContent = stats.description;
  info.appendChild(name);
  info.appendChild(description);
  header.appendChild(img);
  header.appendChild(info);

  // Level badge
  const levelBadge = document.createElement("img");
  levelBadge.className = "level-badge";
  levelBadge.src = `/assets/levels/${level}.webp`;
  levelBadge.alt = `Level ${level}`;
  levelBadge.onerror = function () {
    this.style.display = "none";
  };
  card.appendChild(levelBadge);

  // Stats
  const statsDiv = document.createElement("div");
  statsDiv.className = "character-stats";
  const healthPercent = Math.min(100, (currentHealth / maxHealth) * 100);
  const damagePercent = Math.min(100, (currentDamage / maxDamage) * 100);
  const specialPercent = Math.min(100, (currentSpecial / maxSpecial) * 100);

  const healthSection = document.createElement("div");
  healthSection.className = "stat-section";
  healthSection.innerHTML = `
    <img src="/assets/heart.webp" alt="Health" class="stat-icon" onerror="this.style.display='none'">
    <div class="stat-section-title">Health</div>
    <div class="stat-main-value">${currentHealth}</div>
    <div class="stat-bar health-bar"><div class="stat-fill" style="width: ${healthPercent}%"></div></div>`;

  const attackSection = document.createElement("div");
  attackSection.className = "stat-section";
  attackSection.innerHTML = `
    <img src="/assets/attack.webp" alt="Attack" class="stat-icon" onerror="this.style.display='none'">
    <div class="stat-section-title">Attack</div>
    <div class="stat-main-value">${currentDamage}</div>
    <div class="stat-bar attack-bar"><div class="stat-fill" style="width: ${damagePercent}%"></div></div>
    <div class="stat-details">${stats.ammoCapacity} ammo<br>${(
    stats.ammoReloadMs / 1000
  ).toFixed(1)}s reload</div>`;

  const specialSection = document.createElement("div");
  specialSection.className = "stat-section";
  specialSection.innerHTML = `
    <img src="/assets/special.webp" alt="Special" class="stat-icon" onerror="this.style.display='none'">
    <div class="stat-section-title">Special</div>
    <div class="stat-main-value">${currentSpecial}</div>
    <div class="stat-bar special-bar"><div class="stat-fill" style="width: ${specialPercent}%"></div></div>
    <div class="stat-details">${stats.specialChargeHits} hits to charge</div>`;

  // Actions
  const actionRow = document.createElement("div");
  actionRow.className = "action-row";
  if (isLocked) {
    const price = stats.unlockPrice;
    const lockBtn = document.createElement("button");
    lockBtn.className = "locked-button";
    const priceHtml =
      typeof price === "number"
        ? `<span class="button-price"><img class="cs-currency" src="/assets/gem.webp" alt=""/> ${price}</span>`
        : "";
    lockBtn.innerHTML = `<img class="lock-icon" src="/assets/lock.webp" alt="" onerror="this.style.display='none'"/> <span>Locked</span> ${priceHtml}`;
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showConfirmDialog({ type: "unlock", character, level, price }, () =>
        applyUnlock(character, price)
      );
    });
    actionRow.appendChild(lockBtn);
    card.classList.add("locked");
  } else if (!isMaxed) {
    const price = upgradePrice(level);
    const coins = Number(userData?.coins || 0);
    const affordable = coins >= price;
    const upgradeBtn = document.createElement("button");
    upgradeBtn.className = `upgrade-button${
      affordable ? " gleam" : " disabled"
    }`;
    upgradeBtn.innerHTML = `<img class="upgrade-icon" src="/assets/upgrade.webp" alt="" onerror="this.style.display='none'"/> <span>Upgrade</span> <span class="button-price"><img class="cs-currency" src="/assets/coin.webp" alt=""/> ${price}</span>`;
    if (!affordable) {
      // Keep clickable to show insufficient funds dialog; only change visuals
      upgradeBtn.title = "Not enough coins";
    }
    upgradeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playSound("cursor4", 0.2);
      showConfirmDialog({ type: "upgrade", character, level, price }, () =>
        applyUpgrade(character, level)
      );
    });
    actionRow.appendChild(upgradeBtn);
  } else {
    const maxed = document.createElement("div");
    maxed.className = "maxed-button";
    maxed.textContent = "Maxed Out";
    actionRow.appendChild(maxed);
  }

  // Assemble card
  statsDiv.appendChild(healthSection);
  statsDiv.appendChild(attackSection);
  statsDiv.appendChild(specialSection);
  card.appendChild(header);
  card.appendChild(statsDiv);
  card.appendChild(actionRow);

  // Card click selects unless locked
  if (!isLocked) {
    card.addEventListener("click", () => selectCharacter(character));
  }

  return card;
}

export function openCharacterSelect() {
  if (window.__openCharacterSelect) return window.__openCharacterSelect();
  const overlay = document.querySelector(".character-select-overlay");
  overlay.style.display = "flex";
}
playSound("click", 0.4);

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
      if (spriteEl) {
        spriteEl.src = `/assets/${charClass}/body.webp`;
        spriteEl.alt = charClass;
        spriteEl.classList.remove("random");
      }
      yourSlot.dataset.character = charClass;
      yourSlot.classList.remove("empty");
    }

    // If in a party, emit socket event so others update
    const partyId = (function () {
      const pathname = window.location.pathname || "";
      if (pathname.includes("/party/")) {
        const last = pathname.split("/").filter(Boolean).pop();
        if (last && /^\d+$/.test(last)) return Number(last);
        return last; // fallback allow non-numeric ids if used
      }
      return null;
    })();
    if (partyId) {
      socket.emit("char-change", { partyId, character: charClass });
    } else {
      // Not in party: still persist to server so future sessions load it
      // Use the same socket channel without partyId; server will update only the user row
      socket.emit("char-change", { character: charClass });
    }
  } catch (e) {
    console.warn("selectCharacter failed:", e?.message);
  } finally {
    playSound("cursor4", 0.4);

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
    0
  )}`;
  priceRow.appendChild(remainingIcon);
  priceRow.appendChild(remainingText);
  msg.appendChild(priceRow);

  const actions = document.createElement("div");
  actions.className = "cs-confirm-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cs-btn cancel";
  cancelBtn.textContent = "Cancel";
  const okBtn = document.createElement("button");
  okBtn.className = "cs-btn confirm";
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
  closeBtn.className = "cs-btn cancel";
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
  closeBtn.className = "cs-btn cancel";
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
  playCardSuccessAnimation(newCard, animType);
  // After any change, also refresh other buttons' affordability
  try {
    refreshUpgradeButtonAffordability();
  } catch {}
}

function playCardSuccessAnimation(cardEl, type) {
  if (!cardEl) return;
  // Overlay with rays + label
  const overlay = document.createElement("div");
  overlay.className = "cs-card-success";
  const beams = document.createElement("div");
  beams.className = `cs-card-beams ${type === "unlock" ? "gem" : "coin"}`;
  const label = document.createElement("div");
  label.className = "cs-card-success-label";
  label.textContent = type === "unlock" ? "Unlocked!" : "Upgraded!";
  overlay.appendChild(beams);
  overlay.appendChild(label);
  cardEl.appendChild(overlay);
  // Auto-remove after animation
  setTimeout(() => {
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 350);
  }, 900);
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
      if (data.success) {
        // Update client state
        try {
          if (_userDataRef) {
            const spent = Number(data.spent || 0);
            const newLevel = Number(data.newLevel);
            _userDataRef.coins = Math.max(
              0,
              Number(_userDataRef.coins || 0) - spent
            );
            _userDataRef.char_levels = _userDataRef.char_levels || {};
            _userDataRef.char_levels[character] = newLevel;
          }
        } catch (_) {}
        // Re-render the specific card and play animation
        rerenderCharacterCard(character, _userDataRef || {}, "upgrade");
        document.getElementById("coin-count").textContent = _userDataRef.coins;
        // After coins change, ensure other upgrade buttons reflect affordability
        try {
          refreshUpgradeButtonAffordability();
        } catch {}
      } else {
        showErrorDialog(data.error || "Upgrade failed.");
      }
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
      if (data.success) {
        try {
          if (_userDataRef) {
            // server returns new gems balance and new level
            if (typeof data.gems !== "undefined") {
              _userDataRef.gems = Number(data.gems);
            } else {
              // fallback: subtract spent
              _userDataRef.gems = Math.max(
                0,
                Number(_userDataRef.gems || 0) - Number(data.spent || 0)
              );
            }
            _userDataRef.char_levels = _userDataRef.char_levels || {};
            _userDataRef.char_levels[character] = Number(data.newLevel || 1);
          }
        } catch (_) {}
        rerenderCharacterCard(character, _userDataRef || {}, "unlock");
        document.getElementById("gem-count").textContent = _userDataRef.gems;
        // Unlock can change coins indirectly in some flows; refresh anyway
        try {
          refreshUpgradeButtonAffordability();
        } catch {}
      } else {
        showErrorDialog(data.error || "Unlock failed.");
      }
    })
    .catch((error) => {
      showErrorDialog(error?.message || "Network error.");
    });
}

// Re-evaluate all visible upgrade buttons against current coin balance
function refreshUpgradeButtonAffordability() {
  const coins = Number(_userDataRef?.coins || 0);
  const grid = document.querySelector(".characters-grid");
  if (!grid) return;
  const cards = grid.querySelectorAll(".character-card");
  cards.forEach((card) => {
    try {
      const char = card.dataset.char;
      if (!char) return;
      const levels = (_userDataRef && _userDataRef.char_levels) || {};
      const level = Number(levels[char] ?? 0);
      if (level <= 0) return; // locked handled by its own button
      if (level >= LEVEL_CAP) return; // maxed, no upgrade button
      const price = upgradePrice(level);
      const btn = card.querySelector(".upgrade-button");
      if (!btn) return;
      const affordable = coins >= price;
      if (affordable) {
        btn.classList.add("gleam");
        btn.classList.remove("disabled");
        btn.title = "";
      } else {
        btn.classList.remove("gleam");
        btn.classList.add("disabled");
        btn.title = "Not enough coins";
      }
    } catch {}
  });
}
