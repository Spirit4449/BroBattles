import { getSuspension } from "../lobby/session.mjs";
import { formatSuspensionTime, showChatRequestError, buildInlineCooldownMessage } from './presentation';
import { createComposerCooldown } from "./composerCooldown.js";

export function createChatRestrictions(ui, { isSending, onSuspension }) {
  let chatSuspendedUntilMs = 0;

  const cooldown = createComposerCooldown(ui, {
    defaultMs: 2000,
    minimumMs: 250,
    onRelease() {
      syncChatSuspensionUi();
      if (!isChatSuspended()) ui.textarea.focus();
    },
  });

  function getGlobalChatSuspensionMs() {
    return Number(getSuspension()?.chat) || 0;
  }

  function getActiveChatSuspensionMs() {
    const now = Date.now();
    const localMs = Number(chatSuspendedUntilMs) || 0;
    const globalMs = getGlobalChatSuspensionMs();
    const active = Math.max(localMs, globalMs);
    return active > now ? active : 0;
  }

  function isChatSuspended() {
    return getActiveChatSuspensionMs() > 0;
  }

  function syncChatSuspensionUi() {
    const activeMs = getActiveChatSuspensionMs();
    if (!activeMs) {
      if (cooldown.isActive()) {
        return;
      }
      ui.textarea.disabled = false;
      ui.sendBtn.disabled = isSending();
      if (ui.textarea.dataset.suspensionText === "1") {
        ui.textarea.value = "";
        ui.resizeComposer();
        ui.textarea.dataset.suspensionText = "0";
      }
      ui.textarea.placeholder = "Write a message...";
      ui.root.classList.remove("bb-chat-is-suspended");
      return;
    }

    const timeLeft = formatSuspensionTime(activeMs);
    const text = timeLeft
      ? `Chat suspended (${timeLeft} remaining)`
      : "Chat suspended";
    ui.textarea.disabled = true;
    ui.sendBtn.disabled = true;
    ui.textarea.value = text;
    ui.resizeComposer();
    ui.textarea.dataset.suspensionText = "1";
    ui.textarea.placeholder = text;
    ui.root.classList.add("bb-chat-is-suspended");
  }

  function handleError(error, title) {
    const suspendedUntilMs = Number(error?.payload?.suspendedUntilMs) || 0;
    if (suspendedUntilMs > Date.now()) {
      chatSuspendedUntilMs = Math.max(chatSuspendedUntilMs, suspendedUntilMs);
      syncChatSuspensionUi();
      onSuspension();
    } else {
      const type = String(error?.payload?.type || "").toLowerCase();
      if (type === "warn" || type === "chat_limited") {
        cooldown.apply(buildInlineCooldownMessage(error));
        return;
      }
    }
    showChatRequestError(error, title);
  }

  return { isChatSuspended, syncChatSuspensionUi, cooldown, handleError };
}
