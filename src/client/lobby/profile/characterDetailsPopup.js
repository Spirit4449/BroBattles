import { mountWallet, releaseWallet, renderWalletBalances } from "../walletView.js";
import { escapeHtml } from "../../../shared/site/html.cjs";
import { createModalFocus } from "../../ui/modalFocus.js";
import { getCharacterStats, getCharacterDisplayName, getHealth, getDamage, getSpecialDamage, LEVEL_CAP } from "../../../shared/characters/characterStats.js";
import { playSound, preloadSound } from "../../ui/uiSounds.js";
import { disposeSkinCarousel, switchSkinPreview } from "./skinCarousel.mjs";
import { hideCharacterShowcase, showCharacterShowcaseBody, mountCharacterShowcase, updateCharacterShowcaseSkin } from "./characterShowcase.js";
import { BRO_PORTRAIT_PALETTES, buildPortraitChromaTile } from "../../views/broPortrait.mjs";
import { createLevelBadge } from "../../views/levelBadgeView.js";

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

export function createCharacterDetailsPopup(selectionState, { skins, getCharacterCardState, closeCharacterSelectAfterSelection, selectCharacter, purchases }) {
  const { getSelectedSkin, getCharacterSkinList, resolveCharacterPreviewAsset, cycleSkin } = skins;

  const { showConfirmDialog, applyUnlock, showInsufficientDialog, applyUpgrade } = purchases;

  function updateSkinDetails(character, direction = 1) {
    const ui = selectionState.detailsUi;
    if (!ui || ui.currentCharacter !== character) return;
    const skin = getSelectedSkin(character);
    const rarity = normalizeRarity(skin.rarity);
    switchSkinPreview(ui.previewStage, {
      src: resolveCharacterPreviewAsset(character, skin.id),
      alt: `${getCharacterDisplayName(character)} ${skin.label}`,
      direction,
    });
    updateCharacterShowcaseSkin(ui.previewStage, character, skin.id);
    const row = ui.stickyFooter.querySelector('.character-details-inline-skin');
    for (const element of [row, ui.previewStage]) {
      for (const value of SUPPORTED_RARITIES) element.classList.toggle(`skin-rarity-${value}`, value === rarity);
    }
    row.classList.toggle('is-locked', !!skin.locked);
    row.querySelector('.character-details-skin-name-text').textContent = skin.label;
    row.querySelector('.character-details-skin-rarity').textContent = rarity;
    const name = row.querySelector('strong');
    let lock = name.querySelector('.character-details-skin-lock');
    if (skin.locked && !lock) {
      lock = document.createElement('img');
      lock.className = 'character-details-skin-lock';
      lock.src = '/assets/icons/lock.webp';
      lock.alt = 'Locked';
      name.prepend(lock);
    } else if (!skin.locked) lock?.remove();
    row.querySelectorAll('.character-details-skin-stepper').forEach(button => {
      button.disabled = getCharacterSkinList(character).length <= 1 || !!selectionState.selectionPromise;
    });
    const select = ui.stickyFooter.querySelector('.select-button');
    if (select) {
      select.disabled = !!skin.locked || !!selectionState.selectionPromise;
      select.textContent = skin.locked ? 'Locked' : 'Select';
    }
  }

  function getCharacterDetailsTarget(character) {
    if (!selectionState.detailsUi) return null;
    if (selectionState.detailsUi.currentCharacter !== character) return null;
    return selectionState.detailsUi.previewStage || selectionState.detailsUi.popup;
  }

  function hideCharacterDetails() {
    if (!selectionState.detailsUi) return;
    disposeSkinCarousel(selectionState.detailsUi.previewStage);
    hideCharacterShowcase();
    selectionState.upgradePreview = null;
    selectionState.pendingUpgradeAnimation = null;
    selectionState.detailsUi.popup.classList.remove("is-upgrade-confirming");
    if (selectionState.detailsUi.currentCharacter) {
      delete selectionState.detailsUi.selectedSkinByCharacter[
        selectionState.detailsUi.currentCharacter
      ];
    }
    selectionState.detailsUi.overlay.classList.add("is-hidden");
    selectionState.detailsUi.overlay.setAttribute("aria-hidden", "true");
    releaseWallet(selectionState.detailsUi.wallet);
    selectionState.detailsUi.focus.deactivate();
    selectionState.detailsUi.currentCharacter = null;
    const render = selectionState.deferredSkinRender;
    selectionState.deferredSkinRender = null;
    render?.();
  }

  function ensureCharacterDetailsUi() {
    if (selectionState.detailsUi) return selectionState.detailsUi;

    const overlay = document.createElement("div");
    overlay.className = "character-details-overlay is-hidden";
    overlay.setAttribute("aria-hidden", "true");
    const popup = document.createElement("div");
    popup.className = "character-details-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-modal", "true");
    popup.setAttribute("aria-labelledby", "character-details-title");

    const header = document.createElement("div");
    header.className = "character-details-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "character-details-title-wrap";
    const title = document.createElement("h3");
    title.className = "character-details-title";
    title.id = "character-details-title";

    const subtitle = document.createElement("p");
    subtitle.className = "character-details-header-description";

    const wallet = document.createElement("div");
    wallet.className = "character-details-wallet";

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const closeButton = document.createElement("button");
    closeButton.className =
      "close character-details-close bb-close pixel-menu-button";
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close character details");

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
      focus: null,
    };

    const closeDetails = () => {
      playSound("cancel", 0.3);
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

    state.focus = createModalFocus(popup, {
      initialFocus: () => closeButton,
      onEscape: closeDetails,
    });

    selectionState.detailsUi = state;
    return state;
  }

  function renderCharacterDetails(character) {
    const ui = ensureCharacterDetailsUi();
    const stats = getCharacterStats(character);
    if (!stats) return;

    const cardState = getCharacterCardState(character, selectionState.userData);
    const selectedSkin = getSelectedSkin(character);
    const upgradeAnimation =
      selectionState.pendingUpgradeAnimation?.character === character
        ? selectionState.pendingUpgradeAnimation
        : null;
    const selectedSkinRarity = normalizeRarity(selectedSkin.rarity);
    const isUpgradePreview =
      selectionState.upgradePreview?.character === character &&
      selectionState.upgradePreview?.level === cardState.level &&
      !cardState.isMaxed;

    ui.currentCharacter = character;
    ui.popup.classList.toggle("is-character-locked", cardState.isLocked);
    ui.selectedSkinByCharacter[character] = selectedSkin.id;

    ui.title.textContent = isUpgradePreview
      ? `UPGRADE ${getCharacterDisplayName(character).toUpperCase()}`
      : getCharacterDisplayName(character).toUpperCase();
    ui.subtitle.textContent = stats.description || "";
    renderWalletBalances(selectionState.userData);

    disposeSkinCarousel(ui.previewStage);
    ui.preview.innerHTML = "";
    ui.info.innerHTML = "";
    ui.stickyFooter.innerHTML = "";

    // Smaller preview frame (game style - no rounded corners)
    const previewFrame = document.createElement("div");
    previewFrame.className =
      `character-details-preview-frame skin-rarity-${selectedSkinRarity} ${cardState.isLocked ? "is-locked" : ""} ${cardState.isMaxed ? "is-maxed" : ""}`.trim();
    previewFrame.dataset.character = character;
    for (let corner = 0; corner < 4; corner++) {
      const tile = buildPortraitChromaTile(BRO_PORTRAIT_PALETTES[character] || BRO_PORTRAIT_PALETTES.ninja, corner);
      previewFrame.style.setProperty(`--portrait-chroma-${corner}`, `url("data:image/svg+xml,${encodeURIComponent(tile)}")`);
    }

    const previewGlow = document.createElement("div");
    previewGlow.className = "character-details-preview-glow";

    const previewImg = document.createElement("img");
    previewImg.className = "character-details-preview-image";
    previewImg.src = resolveCharacterPreviewAsset(character, selectedSkin.id);
    previewImg.alt = `${getCharacterDisplayName(character)} ${selectedSkin.label}`;

    if (!cardState.isLocked && cardState.level > 0 && cardState.level <= LEVEL_CAP) {
      previewFrame.classList.add("has-character-level");
      const badge = createLevelBadge(cardState.level, {
        className: "level-badge--framed character-level character-details-preview-level-badge",
      });
      previewFrame.appendChild(badge);
      if (upgradeAnimation && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const previousBadge = createLevelBadge(upgradeAnimation.fromLevel, {
          className: badge.className,
          ariaHidden: true,
        });
        previewFrame.appendChild(previousBadge);
        const outgoing = previousBadge.animate([
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(-12px) scale(0.8)" },
        ], { duration: 320, easing: "ease-in", fill: "forwards" });
        outgoing.onfinish = outgoing.oncancel = () => previousBadge.remove();
        badge.animate([
          { opacity: 0, transform: "translateY(12px) scale(0.8)" },
          { opacity: 1, transform: "translateY(0) scale(1.12)", offset: 0.7 },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ], { duration: 580, delay: 180, easing: "ease-out", fill: "backwards" });
      }
    }

    previewFrame.appendChild(previewGlow);
    previewFrame.appendChild(previewImg);
    if (cardState.isLocked) {
      const lockOverlay = document.createElement("div");
      lockOverlay.className = "character-details-lock-overlay";
      lockOverlay.innerHTML = '<img src="/assets/icons/lock.webp" alt="Locked" />';
      previewFrame.appendChild(lockOverlay);
    }

    ui.preview.appendChild(previewFrame);
    ui.previewStage = previewFrame;
    mountCharacterShowcase(previewFrame, {
      character,
      skinId: selectedSkin.id,
      level: cardState.currentLevel,
      name: String(selectionState.userData?.name || "You"),
    });

    if (isUpgradePreview) {
      previewFrame.dataset.confirming = "true";
      showCharacterShowcaseBody(previewFrame);
    }

    // Three main stat boxes: Health (full width top), Attack and Special (side by side)
    const statsContainer = document.createElement("div");
    statsContainer.className = "character-details-stats-container";

    ui.popup.classList.toggle("is-upgrade-confirming", isUpgradePreview);
    const nextLevel = Math.min(cardState.currentLevel + 1, LEVEL_CAP);
    const nextHealth = getHealth(character, nextLevel);
    const nextDamage = getDamage(character, nextLevel);
    const nextSpecial = getSpecialDamage(character, nextLevel);
    const animatedStart = upgradeAnimation?.from || {};

    const statValueMarkup = (stat, value, nextValue) => {
      const displayValue = Number(animatedStart[stat] ?? value);
      const gain = Math.max(0, Number(nextValue) - Number(value));
      return `<span class="stat-box-value-stack"><span class="stat-box-value" data-stat-value="${stat}" data-stat-target="${escapeHtml(value)}">${displayValue}</span><span class="stat-box-gain"${isUpgradePreview ? "" : ' aria-hidden="true"'}>+${gain}</span></span>`;
    };
    const statTrackMarkup = (stat, value, maxValue, nextValue) => {
      const displayedValue = Number(animatedStart[stat] ?? value);
      const shownWidth = Math.max(0, Math.min(100, (displayedValue / maxValue) * 100));
      const targetWidth = Math.max(0, Math.min(100, (value / maxValue) * 100));
      const nextWidth = Math.max(0, Math.min(100, (nextValue / maxValue) * 100));
      const previewWidth = Math.max(0, nextWidth - targetWidth);
      return `<div class="stat-box-track" role="progressbar" aria-label="${stat}" aria-valuemin="0" aria-valuemax="${maxValue}" aria-valuenow="${escapeHtml(value)}"><div class="stat-box-fill" data-stat-fill="${stat}" data-stat-target-width="${targetWidth}" style="width:${shownWidth}%"></div>${isUpgradePreview ? `<div class="stat-box-preview-fill" style="left:${targetWidth}%;width:${previewWidth}%"></div>` : ""}</div>`;
    };

    // Health box (full width)
    const healthBox = document.createElement("div");
    healthBox.className = "character-details-stat-box health-box";
    const healthMax = Math.max(1, Number(cardState.maxHealth || 1));
    healthBox.innerHTML = `
      <div class="stat-box-header">
        <img class="stat-box-icon" src="/assets/icons/heart.webp" alt="Health" />
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
        <img class="stat-box-icon" src="/assets/icons/attack.webp" alt="Attack" />
        <span class="stat-box-label">Attack</span>
        ${statValueMarkup("damage", cardState.currentDamage, nextDamage)}
      </div>
      ${statTrackMarkup("damage", cardState.currentDamage, attackMax, nextDamage)}
      <div class="stat-box-content">
        ${stats.attackDescription ? `<div class="stat-box-desc">${escapeHtml(stats.attackDescription)}</div>` : ""}
        <div class="stat-box-metrics attack-metrics" aria-label="Attack details">
          <div class="stat-box-metric reload-metric">
            <img src="/assets/ui/stat-reload.webp" alt="" aria-hidden="true" />
            <span class="stat-box-metric-copy">
              <span class="stat-box-metric-label">Reload</span>
              <strong>${(Number(stats.ammoReloadMs || 0) / 1000).toFixed(1)}s</strong>
            </span>
          </div>
          <div class="stat-box-metric ammo-metric">
            <img src="/assets/ui/stat-ammo.webp" alt="" aria-hidden="true" />
            <span class="stat-box-metric-copy">
              <span class="stat-box-metric-label">Ammo</span>
              <strong>${escapeHtml(stats.ammoCapacity || 0)}</strong>
            </span>
          </div>
        </div>
      </div>
    `;
    attackSpecialRow.appendChild(attackBox);

    // Special box
    const specialBox = document.createElement("div");
    specialBox.className = "character-details-stat-box special-box";
    const specialMax = Math.max(1, Number(cardState.maxSpecial || 1));
    specialBox.innerHTML = `
      <div class="stat-box-header">
        <img class="stat-box-icon" src="/assets/icons/special.webp" alt="Special" />
        <span class="stat-box-label">Special</span>
        ${statValueMarkup("special", cardState.currentSpecial, nextSpecial)}
      </div>
      ${statTrackMarkup("special", cardState.currentSpecial, specialMax, nextSpecial)}
      <div class="stat-box-content">
        ${stats.specialDescription ? `<div class="stat-box-desc">${escapeHtml(stats.specialDescription)}</div>` : ""}
        <div class="stat-box-metrics special-metrics" aria-label="Special charge details">
          <div class="stat-box-metric hits-metric">
            <img src="/assets/ui/stat-hits.webp" alt="" aria-hidden="true" />
            <span class="stat-box-metric-copy">
              <span class="stat-box-metric-label">Charge</span>
              <strong>${cardState.currentSuperChargeHits} <small>hits</small></strong>
            </span>
          </div>
        </div>
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
      <img class="character-details-hanger-icon" src="/assets/shop/icons/skins-hanger.webp" alt="" aria-hidden="true" />
      <span>Skin</span>
    `;

    const skinControls = document.createElement("div");
    skinControls.className = "character-details-skin-controls";

    const skins = getCharacterSkinList(character);
    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "character-details-skin-stepper";
    prevButton.textContent = "";
    prevButton.setAttribute("aria-label", "Previous skin");
    prevButton.setAttribute("data-sound", "none");
    prevButton.disabled = skins.length <= 1 || !!selectionState.selectionPromise;
    prevButton.addEventListener("click", () => {
      if (skins.length <= 1) return;
      cycleSkin(character, -1);
    });

    const skinChip = document.createElement("div");
    skinChip.className = "character-details-skin-name-box";
    skinChip.setAttribute("aria-live", "polite");
    const skinName = document.createElement("strong");
    if (selectedSkin.locked) {
      const lockIcon = document.createElement("img");
      lockIcon.className = "character-details-skin-lock";
      lockIcon.src = "/assets/icons/lock.webp";
      lockIcon.alt = "Locked";
      skinName.appendChild(lockIcon);
    }
    const skinNameText = document.createElement("span");
    skinNameText.className = "character-details-skin-name-text";
    skinNameText.textContent = selectedSkin.label;
    skinName.appendChild(skinNameText);
    const skinRarity = document.createElement("span");
    skinRarity.className = "character-details-skin-rarity";
    skinRarity.textContent = selectedSkinRarity;
    skinChip.appendChild(skinName);
    skinChip.appendChild(skinRarity);

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "character-details-skin-stepper";
    nextButton.textContent = "";
    nextButton.setAttribute("aria-label", "Next skin");
    nextButton.setAttribute("data-sound", "none");
    nextButton.disabled = skins.length <= 1 || !!selectionState.selectionPromise;
    nextButton.addEventListener("click", () => {
      if (skins.length <= 1) return;
      cycleSkin(character, 1);
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
      buyButton.setAttribute("aria-label", `Unlock ${getCharacterDisplayName(character)} for ${stats.unlockPrice || 0} gems`);
      buyButton.className =
        `character-details-action buy-button pixel-menu-button${cardState.canUnlock ? " is-ready" : ""}`;
      buyButton.innerHTML = `<span class="character-details-action-label"><img class="character-details-action-icon" src="/assets/icons/lock.webp" alt="" /><span>Buy</span></span><span class="button-price"><img class="cs-currency" src="/assets/icons/gem.webp" alt="" /><span>${escapeHtml(stats.unlockPrice || 0)}</span></span>`;
      if (stats.unlockMethod?.type === "trophyRoad") {
        buyButton.innerHTML = `<span class="character-details-action-label character-details-trophy-label"><img class="character-details-action-icon" src="/assets/icons/lock.webp" alt="" /><span>Trophy Reward</span></span><span class="button-price"><img class="cs-currency" src="/assets/icons/trophy.webp" alt="" /><span>${stats.unlockMethod.min.toLocaleString()}</span></span>`;
        buyButton.setAttribute("aria-label", `Claim ${getCharacterDisplayName(character)} on Trophy Road at ${stats.unlockMethod.min} trophies`);
      }
      buyButton.addEventListener("click", (e) => {
        e.stopPropagation();
        playSound("cursor4", 0.2);
        if (stats.unlockMethod?.type === "trophyRoad") {
          // Closing through the picker lifecycle clears the party's
          // "Selecting Character" presence before Trophy Road opens.
          closeCharacterSelectAfterSelection();
          document.getElementById("trophy-resource-button")?.click();
          return;
        }
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
        upgradeButton.setAttribute("aria-label", `Upgrade ${getCharacterDisplayName(character)} for ${cardState.price} coins`);
        upgradeButton.className = `character-details-action upgrade-button pixel-menu-button${cardState.canUpgrade ? " is-ready" : ""}`;
        upgradeButton.innerHTML = `<span class="character-details-action-label"><img class="character-details-action-icon upgrade-icon" src="/assets/icons/upgrade.webp" alt="" /><span>Upgrade</span></span><span class="button-price"><img class="cs-currency" src="/assets/icons/coin.webp" alt="" /><span>${escapeHtml(cardState.price)}</span></span>`;
        if (!cardState.canUpgrade) {
          upgradeButton.title = "Not enough coins — select to view the balance needed";
        }
        upgradeButton.addEventListener("click", (e) => {
          e.stopPropagation();
          playSound("cursor4", 0.2);
          if (!cardState.canUpgrade) {
            showInsufficientDialog("coins", cardState.price - Number(selectionState.userData?.coins || 0));
            return;
          }
          if (!isUpgradePreview) {
            selectionState.upgradePreview = {
              character,
              level: cardState.level,
              minimumButtonWidth: Math.ceil(upgradeButton.getBoundingClientRect().width),
            };
            renderCharacterDetails(character);
            return;
          }
          upgradeButton.disabled = true;
          upgradeButton.textContent = "Upgrading…";
          applyUpgrade(character);
        });
        if (isUpgradePreview) {
          upgradeButton.classList.add("is-confirming");
          upgradeButton.style.minWidth = `${selectionState.upgradePreview.minimumButtonWidth || 0}px`;
          upgradeButton.setAttribute("aria-label", `Confirm upgrade ${getCharacterDisplayName(character)} for ${cardState.price} coins`);
          upgradeButton.innerHTML = `<span class="character-details-action-label">Confirm</span><span class="button-price"><img class="cs-currency" src="/assets/icons/coin.webp" alt="coins"> ${cardState.price}</span>`;

        }
        footer.appendChild(upgradeButton);
      } else {
        const maxedLabel = document.createElement("div");
        maxedLabel.className = "character-details-maxed-label";
        maxedLabel.innerHTML =
          '<img src="/assets/icons/crown.webp" alt="" /> <span>Max Level</span>';
        footer.appendChild(maxedLabel);
      }

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className =
        "character-details-action select-button pixel-menu-button";
      selectButton.textContent = selectedSkin.locked ? "Locked" : "Select";
      selectButton.disabled = !!selectedSkin.locked || !!selectionState.selectionPromise;
      selectButton.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (getSelectedSkin(character)?.locked) return;
        playSound("cursor4", 0.2);
        selectButton.disabled = true;
        selectButton.textContent = "Selecting...";
        const selected = await selectCharacter(character);
        if (!selected && selectionState.detailsUi?.currentCharacter === character) {
          renderCharacterDetails(character);
        }
      });
      footer.appendChild(selectButton);
    }

    footerLine.appendChild(skinRow);
    footerLine.appendChild(footer);
    ui.stickyFooter.appendChild(footerLine);

    if (upgradeAnimation) {
      selectionState.pendingUpgradeAnimation = null;
      animateCharacterDetailStats(upgradeAnimation);
    }
  }

  function animateCharacterDetailStats({ from }) {
    const ui = selectionState.detailsUi;
    if (!ui?.popup) return;
    const durationMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
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
      const progress = Math.min(1, durationMs === 0 ? 1 : (now - startedAt) / durationMs);
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
    if (!selectionState.detailsUi || !selectionState.detailsUi.currentCharacter) return;
    const target = getCharacterDetailsTarget(
      selectionState.detailsUi.currentCharacter,
    );
    if (!target) return;
    showCharacterShowcaseBody(target);

    const overlay = document.createElement("div");
    target.querySelectorAll(".character-details-success").forEach((previous) => previous.remove());
    overlay.className = `character-details-success is-${type}`;
    overlay.setAttribute("role", "status");
    if (type === "unlock") {
      const ring = document.createElement("div");
      ring.className = "character-details-success-ring";
      ring.setAttribute("aria-hidden", "true");
      overlay.appendChild(ring);
      for (let index = 0; index < 16; index += 1) {
        const spark = document.createElement("i");
        spark.className = "character-details-success-spark";
        const angle = (index / 16) * Math.PI * 2;
        const distance = 90 + (index % 3) * 24;
        spark.style.setProperty("--spark-x", `${Math.cos(angle) * distance}px`);
        spark.style.setProperty("--spark-y", `${Math.sin(angle) * distance}px`);
        spark.style.setProperty("--spark-delay", `${index % 4 * 35}ms`);
        spark.setAttribute("aria-hidden", "true");
        overlay.appendChild(spark);
      }
    }
    const beams = document.createElement("div");
    beams.className = `character-details-success-beams ${type === "unlock" ? "gem" : "coin"}`;
    const label = document.createElement("div");
    label.className = "character-details-success-label";
    const headline = document.createElement("strong");
    headline.textContent = type === "unlock" ? "Unlocked!" : "Level Up";
    label.appendChild(headline);
    if (type === "unlock") {
      const shackles = document.createElement("div");
      shackles.className = "unlock-shackles";
      shackles.setAttribute("aria-hidden", "true");
      for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
        const chain = document.createElement("div");
        chain.className = `unlock-chain unlock-chain-${corner}`;
        shackles.appendChild(chain);
      }
      const lock = document.createElement("img");
      lock.className = "unlock-breaking-lock";
      lock.src = "/assets/icons/lock.webp";
      lock.alt = "";
      shackles.appendChild(lock);
      overlay.appendChild(shackles);
    }
    let halo = null;
    if (type === "upgrade") {
      target.querySelectorAll(".character-upgrade-halo").forEach((previous) => previous.remove());
      halo = document.createElement("div");
      halo.className = "character-upgrade-halo";
      halo.setAttribute("aria-hidden", "true");
      target.appendChild(halo);
    } else {
      overlay.appendChild(beams);
    }
    overlay.appendChild(label);
    target.appendChild(overlay);
    playSound("success", 0.6);
    setTimeout(() => {
      overlay.classList.add("fade-out");
      halo?.classList.add("fade-out");
      setTimeout(() => { overlay.remove(); halo?.remove(); }, 350);
    }, 1750);
  }

  function openCharacterDetails(character) {
    preloadSound("skinSwitch");
    renderCharacterDetails(character);
    const ui = ensureCharacterDetailsUi();
    const wasDetached = !ui.overlay.isConnected;
    if (!ui.overlay.isConnected) {
      document.body.appendChild(ui.overlay);
    }
    if (wasDetached) void ui.overlay.offsetWidth;
    ui.overlay.classList.remove("is-hidden");
    ui.overlay.setAttribute("aria-hidden", "false");
    mountWallet(ui.wallet);
    ui.focus.activate();
  }

  return { openCharacterDetails, hideCharacterDetails, renderCharacterDetails, updateSkinDetails, playCharacterDetailsSuccessAnimation };
}
