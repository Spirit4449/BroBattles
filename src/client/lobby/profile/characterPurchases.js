import { BROWSER_EVENTS } from "../../lib/browserEvents.js";
import { updateUser } from "../session.mjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { postJson } from "../../lib/http.js";
import { getSelfSlot } from "../party/slotDom.js";
import { pixelArrow } from "../../ui/pixelArrow.js";
import { applyWallet } from "../wallet.mjs";
import { showUiConfirm } from "../../ui/uiConfirm.js";
import { getCharacterDisplayName, LEVEL_CAP } from "../../../shared/characters/characterStats.js";
import { playSound } from "../../ui/uiSounds.js";
import { buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { showCharacterShowcaseBody } from "./characterShowcase.js";
import { resolveBodyPortrait } from "../../views/bodyPortraitAssets.js";
import { createLevelBadge, setSlotLevelBadge } from "../../views/levelBadgeView.js";

export function showErrorDialog(message, titleText = "Purchase failed") {
  return showUiConfirm({
    title: titleText,
    message: message || "Something went wrong. Please try again.",
    confirmLabel: null,
    cancelLabel: "Close",
    cancelSound: null,
    releaseFocusOnDismiss: true,
  });
}

export function showInsufficientDialog(currency, missing) {
  document.dispatchEvent(new CustomEvent(BROWSER_EVENTS.CHARACTER_CURRENCY_SHORTFALL, {
    detail: { currency, missing },
  }));
}

export function createCharacterPurchases(state, { getSelectedSkin, getCharacterCardState, rerenderCharacterCard, refreshUpgradeButtonAffordability, renderCharacterDetails, playCharacterDetailsSuccessAnimation }) {
  function showConfirmDialog(opts, onConfirm) {
    const { type, character, level, price } = opts;
    const overlay = document.querySelector(".character-select-overlay");
    if (!overlay) return onConfirm && onConfirm();

    const coins = Number(state.userData?.coins ?? 0);
    const gems = Number(state.userData?.gems ?? 0);
    const isUpgrade = type === "upgrade";
    const current = isUpgrade ? coins : gems;
    const remaining = current - Number(price || 0);

    if (remaining < 0) {
      return showInsufficientDialog(isUpgrade ? "coins" : "gems", -remaining);
    }

    const previewFrame = state.detailsUi?.previewStage;
    if (previewFrame) {
      previewFrame.dataset.confirming = "true";
      showCharacterShowcaseBody(previewFrame);
    }

    const msg = document.createDocumentFragment();
    // Character hero visual only for unlock (buy)
    if (!isUpgrade) {
      const hero = document.createElement("div");
      hero.className = "cs-hero";
      const heroBeams = document.createElement("div");
      heroBeams.className = "cs-hero-beams gem"; // gem theme (bluish)
      const heroImg = document.createElement("img");
      heroImg.className = "cs-hero-img";
      heroImg.src = resolveBodyPortrait(buildCharacterSkinBodyUrl(character, getSelectedSkin(character)?.id));
      heroImg.alt = character;
      hero.appendChild(heroBeams);
      hero.appendChild(heroImg);
      msg.appendChild(hero);
      const name = document.createElement("div");
      name.className = "cs-unlock-name";
      name.textContent = getCharacterDisplayName(character);
      msg.appendChild(name);
    }
    // Level line focus for upgrades
    if (isUpgrade) {
      const levelLine = document.createElement("div");
      levelLine.className = "cs-level-line";
      const currImg = createLevelBadge(level, {
        className: "level-badge--framed character-level cs-level-img",
      });
      const arrow = pixelArrow("right", "lg");
      arrow.classList.add("cs-arrow");
      const nextWrap = document.createElement("div");
      nextWrap.className = "cs-next-wrap";
      const beams = document.createElement("div");
      beams.className = "cs-beams coin"; // coin theme (golden rays)
      const nextImg = createLevelBadge(Math.min(level + 1, LEVEL_CAP), {
        className: "level-badge--framed character-level cs-next-badge",
      });
      nextWrap.appendChild(beams);
      nextWrap.appendChild(nextImg);
      levelLine.appendChild(currImg);
      levelLine.appendChild(arrow);
      levelLine.appendChild(nextWrap);
      msg.appendChild(levelLine);
    }

    const cost = document.createElement("span");
    cost.textContent = String(price);
    const currency = document.createElement("img");
    currency.className = "cs-currency";
    currency.src = isUpgrade ? "/assets/icons/coin.webp" : "/assets/icons/gem.webp";
    currency.alt = "";
    const upgradeLabel = document.createElement("span");
    upgradeLabel.textContent = "Upgrade";
    const confirmContent = [...(isUpgrade ? [upgradeLabel] : []), currency, " ", cost];

    return showUiConfirm({
      title: isUpgrade ? "Confirm Upgrade" : "Confirm Unlock",
      variant: isUpgrade ? "cs-purchase-confirm" : "cs-purchase-confirm cs-unlock-confirm",
      bodyNode: msg,
      confirmAriaLabel: `${isUpgrade ? "Upgrade" : "Unlock"} ${getCharacterDisplayName(character)} for ${price} ${isUpgrade ? "coins" : "gems"}`,
      confirmContent,
      confirmSound: null,
      cancelVolume: 0.2,
      releaseFocusOnDismiss: true,
      onDismiss() {
        if (previewFrame) delete previewFrame.dataset.confirming;
      },
      onConfirm() {
        playSound("cursor4", 0.2);
        onConfirm?.();
      },
    });
  }

  function applyUpgrade(character) {
    const previousState = getCharacterCardState(character, state.userData);
    postJson(API_PATHS.UPGRADE, { character }, { fallbackMessage: "Upgrade failed." })
      .then((data) => {
        if (!data?.success) throw new Error(data?.error || data?.message || "Upgrade failed.");

        try {
          const upgradedLevel = Number(data.newLevel);
          if (state.userData) {
            const spent = Number(data.spent || 0);
            applyWallet(state.userData, { coins: data.coins ?? Math.max(0, Number(state.userData.coins || 0) - spent) });
            if (!Number.isNaN(upgradedLevel)) {
              updateUser({ char_levels: { ...state.userData.char_levels, [character]: upgradedLevel } });
            }
          }
          if (!Number.isNaN(upgradedLevel)) {
            syncCurrentUserLobbyLevel(character, upgradedLevel);
          }
        } catch {}

        state.upgradePreview = null;
        state.pendingUpgradeAnimation = {
          character,
          fromLevel: previousState.currentLevel,
          from: {
            health: previousState.currentHealth,
            damage: previousState.currentDamage,
            special: previousState.currentSpecial,
          },
        };
        playSound("upgrade", 0.6);
        rerenderCharacterCard(character, state.userData);
        refreshUpgradeButtonAffordability();
        playCharacterDetailsSuccessAnimation("upgrade");
      })
      .catch((error) => {
        state.upgradePreview = null;
        if (state.detailsUi?.currentCharacter === character) {
          renderCharacterDetails(character);
        }
        showErrorDialog(error?.message || "Network error.");
      });
  }

  function applyUnlock(character, price) {
    postJson(API_PATHS.BUY, { character }, { fallbackMessage: "Unlock failed." })
      .then((data) => {
        if (!data?.success) throw new Error(data?.error || data?.message || "Unlock failed.");

        try {
          if (state.userData) {
            const spent = Number(data.spent || price || 0);
            const unlockedLevel = Number(data.newLevel || 1);
            applyWallet(state.userData, { gems: data.gems ?? Math.max(0, Number(state.userData.gems || 0) - spent) });
            updateUser({ char_levels: { ...state.userData.char_levels, [character]: unlockedLevel } });
          }
        } catch {}

        playSound("unlock", 0.6);
        rerenderCharacterCard(character, state.userData);
        refreshUpgradeButtonAffordability();
        playCharacterDetailsSuccessAnimation("unlock");
      })
      .catch((error) => {
        showErrorDialog(error?.message || "Network error.");
      });
  }

  function syncCurrentUserLobbyLevel(character, level) {
    if (
      String(state.userData?.char_class || "").toLowerCase() !==
      String(character || "").toLowerCase()
    ) {
      return;
    }
    const slot = getSelfSlot({ fallback: true });
    if (slot) setSlotLevelBadge(slot, level);
  }

  return { showConfirmDialog, applyUpgrade, applyUnlock, showInsufficientDialog };
}
