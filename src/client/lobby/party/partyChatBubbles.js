import { getSlotByPlayerName } from "./slotDom.js";
import { LOBBY_CHAT_BUBBLE_MS } from '../../chat/presentation.js';
import { nameKey } from "../../../shared/social/textRules.js";

export function createLobbyMessageBubbles() {
  const bubbleTimers = new Map();

  function showLobbyMessageBubble(message) {
    const bodyText = String(message?.body || "")
      .replace(/\s+/g, " ")
      .trim();
    const senderName = String(message?.sender?.name || "").trim();
    if (!bodyText || !senderName) return;
    const slot = getSlotByPlayerName(senderName);
    if (!slot) return;
    let bubble = slot.querySelector(".bb-lobby-chat-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "bb-lobby-chat-bubble";
      slot.appendChild(bubble);
    }
    let text = bubble.querySelector(".bb-lobby-chat-bubble-text");
    if (!text) {
      text = document.createElement("span");
      text.className = "bb-lobby-chat-bubble-text";
      bubble.replaceChildren(text);
    }
    text.textContent = bodyText;
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-label", `${senderName}: ${bodyText}`);
    bubble.classList.remove("is-visible");
    // Restart the entrance when a player sends another message mid-bubble.
    void bubble.offsetWidth;
    bubble.classList.add("is-visible");

    const key = nameKey(slot.dataset.playerName || senderName);
    const existingTimer = bubbleTimers.get(key);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      bubble.classList.remove("is-visible");
      bubbleTimers.delete(key);
    }, Math.min(9000, Math.max(LOBBY_CHAT_BUBBLE_MS, bodyText.length * 55)));
    bubbleTimers.set(key, timer);
  }

  function destroy() {
    for (const timer of bubbleTimers.values()) window.clearTimeout(timer);
    bubbleTimers.clear();
  }

  return { show: showLobbyMessageBubble, destroy };
}
