import { createModalFocus } from "../ui/modalFocus.js";
import { positionChatPopover } from "./popoverPosition.mjs";
import {
  bindChatProfile,
  buildAvatarUrl,
  escapeHtml,
  formatChatTime,
  formatNameWithYou,
} from "./presentation";

// "Viewed by" read-receipt popover shared by party chat and friend chats.
export function createViewersPopup({ getCurrentUserName, onOpenProfile, getFallbackFocus } = {}) {
  const popup = document.createElement("div");
  popup.className = "bb-chat-viewers-popup hidden";
  popup.innerHTML = `
    <div class="bb-chat-viewers-backdrop" data-chat-viewers-close></div>
    <div class="bb-chat-viewers-card" role="dialog" aria-modal="true" aria-label="Message views">
      <div class="bb-chat-viewers-head">
        <div class="bb-chat-viewers-title">Viewed by</div>
        <button type="button" class="bb-chat-mini-btn bb-chat-close" data-chat-viewers-close aria-label="Close viewers">×</button>
      </div>
      <div class="bb-chat-viewers-list"></div>
    </div>
  `;
  document.body.appendChild(popup);
  const listEl = popup.querySelector(".bb-chat-viewers-list");
  const card = popup.querySelector(".bb-chat-viewers-card");
  let closeTimer = null;
  const focus = createModalFocus(card, {
    initialFocus: () => popup.querySelector("button[data-chat-viewers-close]"),
    onEscape: close,
    fallbackFocus: getFallbackFocus,
  });

  const isOpen = () => !popup.classList.contains("hidden") && !closeTimer;

  function close({ restoreFocus = true } = {}) {
    if (popup.classList.contains("hidden") || closeTimer) return;
    card.classList.remove("is-visible");
    focus.deactivate({ restoreFocus });
    closeTimer = window.setTimeout(() => {
      popup.classList.add("hidden");
      closeTimer = null;
    }, 120);
  }

  const openProfile = typeof onOpenProfile === "function" ? name => {
    close({ restoreFocus: false });
    onOpenProfile(name);
  } : undefined;

  function open(message, anchorEl) {
    const trigger = anchorEl || document.activeElement;
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    const currentName = getCurrentUserName?.() || "";
    const viewers = Array.isArray(message?.viewers) ? message.viewers : [];
    listEl.innerHTML = "";
    if (!viewers.length) {
      const empty = document.createElement("div");
      empty.className = "bb-chat-viewers-empty";
      empty.textContent = "No views yet";
      listEl.appendChild(empty);
    } else {
      const fragment = document.createDocumentFragment();
      for (const viewer of viewers) {
        const row = document.createElement("div");
        row.className = "bb-chat-viewer-row";
        row.innerHTML = `
          <span class="bb-chat-viewer-avatar"><img src="${escapeHtml(buildAvatarUrl(viewer?.charClass, viewer?.profileIconId))}" alt="${escapeHtml(viewer?.name || "Player")}" loading="lazy" decoding="async" /></span>
          <span class="bb-chat-viewer-name">${escapeHtml(formatNameWithYou(viewer?.name || "Player", currentName))}</span>
          <span class="bb-chat-viewer-time">${escapeHtml(formatChatTime(viewer?.readAt))}</span>
        `;
        bindChatProfile(row.querySelector(".bb-chat-viewer-name"), viewer?.name, openProfile);
        bindChatProfile(row.querySelector(".bb-chat-viewer-avatar"), viewer?.name, openProfile);
        fragment.appendChild(row);
      }
      listEl.appendChild(fragment);
    }
    popup.classList.remove("hidden");
    card.classList.remove("is-visible");
    if (anchorEl?.getBoundingClientRect) {
      const rect = anchorEl.getBoundingClientRect();
      const position = positionChatPopover(rect, card.offsetWidth, card.offsetHeight, window.innerWidth, window.innerHeight);
      card.style.left = `${Math.round(position.left)}px`;
      card.style.top = `${Math.round(position.top)}px`;
      card.style.setProperty("--chat-popover-offset", position.above ? "3px" : "-3px");
    }
    void card.offsetWidth;
    card.classList.add("is-visible");
    focus.activate(trigger);
  }

  popup.querySelectorAll("[data-chat-viewers-close]").forEach((el) => el.addEventListener("click", close));
  window.addEventListener("resize", close);

  return {
    open,
    close,
    isOpen,
    destroy() {
      focus.deactivate();
      window.removeEventListener("resize", close);
      if (closeTimer) window.clearTimeout(closeTimer);
      popup.remove();
    },
  };
}
