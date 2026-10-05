// Owner-only picker for filling an empty party slot with a bot fighter.
import socket from "../../lib/socket.js";
import { sonner } from "../../ui/sonner.js";
import { getSharedSelectionPopupShell } from "../../ui/selectionPopupShell.js";
import { getAllCharacters } from "../../../shared/characters/characterStats.js";
import { buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";

let __botPopupUi = null;

export function getBotSlotTarget(slot) {
  const match = String(slot?.id || "").match(/^(your|op)-slot-(\d+)$/);
  if (!match) return null;
  const team = match[1] === "your" ? "team1" : "team2";
  return { team, index: Number(match[2]) - 1 };
}

function ensureBotPicker() {
  if (__botPopupUi) return __botPopupUi;

  const popupShell = getSharedSelectionPopupShell();
  const closePopup = () => popupShell.hide();
  const content = document.createElement("div");
  content.id = "party-bot-picker";
  content.className = "selection-popup-scroll party-bot-picker-scroll";

  const description = document.createElement("p");
  description.className = "party-bot-picker-description";
  description.textContent = "Leave the slot random, or add a bot fighter.";

  const grid = document.createElement("div");
  grid.className = "party-bot-picker-grid";
  content.append(description, grid);

  __botPopupUi = { popupShell, closePopup, content, grid };
  return __botPopupUi;
}

function openBotPicker(slot, partyId) {
  const target = getBotSlotTarget(slot);
  if (!target) return;
  const { popupShell, closePopup, content, grid } = ensureBotPicker();
  const selectedCharacter = String(slot.dataset.botCharacter || "random");
  const choices = [
    { id: "random", label: "Random", image: "/assets/random.webp" },
    { id: "shuffle", label: "Bot", image: "/assets/shuffle/shuffle1.svg" },
    ...getAllCharacters().map((id) => ({
      id,
      label: `Bot · ${id[0].toUpperCase()}${id.slice(1)}`,
      image: buildCharacterSkinBodyUrl(id, ""),
    })),
  ];
  grid.innerHTML = "";
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `party-bot-choice map-select-card pixel-menu-button${
      selectedCharacter === choice.id ? " active" : ""
    }`;
    button.dataset.botCharacter = choice.id;

    const image = document.createElement("img");
    image.src = choice.image;
    image.alt = "";
    if (choice.id === "shuffle") image.classList.add("bot-shuffle-icon");

    const label = document.createElement("span");
    label.className = "map-select-name";
    label.textContent = choice.label;
    button.append(image, label);
    button.addEventListener("click", () => {
      button.disabled = true;
      socket.emit(
        "party:bot-slot:update",
        { partyId, ...target, character: choice.id },
        (result) => {
          button.disabled = false;
          if (!result?.ok) {
            sonner("Could not update bot", result?.error || "Please try again.", "error");
            return;
          }
          closePopup();
        },
      );
    });
    grid.appendChild(button);
  }

  popupShell
    .mount({
      titleText: "Configure Slot",
      onClose: closePopup,
      zIndex: 12020,
      contentNode: content,
      backgroundNode: null,
    })
    .show();
}

// `isPartyOwner()` gates the picker; members only see bot slots.
export function wirePartyBotSlotControls({ getActivePartyId, isPartyOwner }) {
  const lobby = document.getElementById("lobby-area");
  if (!lobby || lobby.dataset.botSlotsBound === "1") return;
  lobby.dataset.botSlotsBound = "1";
  lobby.addEventListener("click", (event) => {
    const slot = event.target?.closest?.(".character-slot");
    if (!slot || !getActivePartyId() || slot.dataset.isCurrentUser === "true") return;
    if (event.target?.closest?.(".status.invite")) return;
    if (!isPartyOwner()) return;
    if (slot.dataset.playerName) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openBotPicker(slot, getActivePartyId());
  }, true);
}
