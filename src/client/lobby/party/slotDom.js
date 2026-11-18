import { nameKey } from "../../../shared/social/textRules.js";

export const SLOT_SELECTOR = ".character-slot";

const fieldSelectors = {
  username: ".username",
  status: ".status",
  sprite: ".character-sprite",
};

export function getSelfSlot({ fallback = false } = {}) {
  return document.querySelector(`${SLOT_SELECTOR}[data-is-current-user="true"]`)
    || (fallback ? document.getElementById("your-slot-1") : null);
}

export function getSlotByPlayerName(name) {
  const key = nameKey(name);
  return [...document.querySelectorAll(`${SLOT_SELECTOR}[data-player-name]`)]
    .find(slot => nameKey(slot.dataset.playerName) === key);
}

export function slotField(slot, name) {
  return slot?.querySelector(fieldSelectors[name]) || null;
}
