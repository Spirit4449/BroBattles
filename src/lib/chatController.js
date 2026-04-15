import { buildProfileIconUrl } from "./profileIconAssets.js";
import { sonner } from "./sonner.js";

const GAME_CHAT_RECENT_LIMIT = 8;
const LOBBY_TYPING_IDLE_STOP_MS = 1000;
const LOBBY_TYPING_HEARTBEAT_MS = 850;
const LOBBY_TYPING_STALE_MS = 4000;
const LOBBY_CHAT_BUBBLE_MS = 3800;

function escapeHtml(value) {
  const raw = String(value ?? "");
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatChatTime(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildAvatarUrl(charClass, profileIconId = null) {
  return buildProfileIconUrl(profileIconId, charClass || "ninja");
}

function createAvatarEl(name, charClass, profileIconId = null) {
  const avatar = document.createElement("div");
  avatar.className = "bb-chat-avatar";
  const img = document.createElement("img");
  img.src = buildAvatarUrl(charClass, profileIconId);
  img.alt = String(name || "Player");
  img.loading = "lazy";
  img.decoding = "async";
  avatar.appendChild(img);
  return avatar;
}

function messageIdOf(message) {
  return Number(message?.id) || 0;
}

function formatNameWithYou(name, currentUserName) {
  const raw = String(name || "").trim();
  const current = String(currentUserName || "").trim();
  if (!raw) return "Player";
  if (raw.toLowerCase() === current.toLowerCase()) return `${raw} (You)`;
  return raw;
}

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || "Request failed");
      error.statusCode = Number(response.status) || 0;
      error.payload = data || {};
      throw error;
    }
    return data;
  });
}

function formatSuspensionTime(suspendedUntilMs) {
  const ms = Number(suspendedUntilMs) || 0;
  if (!ms) return "";
  const delta = Math.max(0, ms - Date.now());
  const seconds = Math.ceil(delta / 1000);
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

function showChatRequestError(error, fallbackTitle = "Chat") {
  const message = String(error?.message || "Request failed");
  const suspendedUntilMs = Number(error?.payload?.suspendedUntilMs) || 0;
  const timeLeft = formatSuspensionTime(suspendedUntilMs);
  const finalMessage = timeLeft
    ? `${message} (${timeLeft} remaining)`
    : message;
  sonner(fallbackTitle, finalMessage, "OK", undefined, {
    duration: 4500,
    sound: "notification",
  });
}

function buildInlineCooldownMessage(error, fallback = "Slow down.") {
  const message = String(error?.message || fallback);
  const extra = String(error?.payload?.banWarning || "").trim();
  return extra ? `${message} ${extra}` : message;
}

function makeChatShell({
  rootClassName,
  panelClassName,
  launcherLabel,
  launcherClassName,
}) {
  const root = document.createElement("div");
  root.className = `bb-chat-root ${rootClassName}`;

  const backdrop = document.createElement("div");
  backdrop.className = "bb-chat-drawer-backdrop";

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "bb-chat-button bb-chat-launcher";
  if (launcherClassName) launcher.classList.add(launcherClassName);
  launcher.innerHTML = `
    <img class="bb-chat-launcher-icon" src="/assets/chat.webp" alt="" width="20" height="20" />
    <span class="bb-chat-launcher-label">${escapeHtml(launcherLabel || "Chat")}</span>
  `;

  const badge = document.createElement("span");
  badge.className = "bb-chat-badge hidden";
  launcher.appendChild(badge);

  const reactionBadge = document.createElement("span");
  reactionBadge.className = "bb-chat-reaction-badge hidden";
  reactionBadge.title = "New reaction";
  reactionBadge.innerHTML = `<img src="/assets/heart-filled.svg" alt="" width="14" height="14" />`;
  launcher.appendChild(reactionBadge);

  const panel = document.createElement("section");
  panel.className = `bb-chat-shell ${panelClassName}`;
  panel.innerHTML = `
    <div class="bb-chat-header">
      <div>
        <h2 class="bb-chat-title">Chat</h2>
        <div class="bb-chat-subtitle">Party only</div>
      </div>
      <div class="bb-chat-header-actions">
        <button type="button" class="bb-chat-mini-btn bb-chat-reply-cancel" aria-label="Clear reply">↩</button>
        <button type="button" class="bb-chat-mini-btn bb-chat-close" aria-label="Close chat">X</button>
      </div>
    </div>
    <div class="bb-chat-body">
      <div class="bb-chat-messages"></div>
      <div class="bb-chat-composer">
        <div class="bb-chat-reply-banner hidden"></div>
        <div class="bb-chat-input-row">
          <textarea class="bb-chat-textarea" rows="2" maxlength="500" placeholder="Write a message..."></textarea>
          <button type="button" class="bb-chat-send">Send</button>
        </div>
        <div class="bb-chat-typing hidden" aria-live="polite">
          <div class="bb-chat-typing-icons"></div>
          <div class="bb-chat-typing-label">
            <span class="bb-chat-typing-text"></span>
            <img class="bb-chat-typing-dots" src="/assets/typing.svg" alt="" width="18" height="12" />
          </div>
        </div>
      </div>
    </div>
  `;

  root.appendChild(backdrop);
  root.appendChild(launcher);
  root.appendChild(panel);
  document.body.appendChild(root);

  return {
    root,
    backdrop,
    launcher,
    badge,
    reactionBadge,
    panel,
    titleEl: panel.querySelector(".bb-chat-title"),
    subtitleEl: panel.querySelector(".bb-chat-subtitle"),
    messagesEl: panel.querySelector(".bb-chat-messages"),
    textarea: panel.querySelector(".bb-chat-textarea"),
    sendBtn: panel.querySelector(".bb-chat-send"),
    closeBtn: panel.querySelector(".bb-chat-close"),
    clearReplyBtn: panel.querySelector(".bb-chat-reply-cancel"),
    replyBanner: panel.querySelector(".bb-chat-reply-banner"),
    typingEl: panel.querySelector(".bb-chat-typing"),
    typingIconsEl: panel.querySelector(".bb-chat-typing-icons"),
    typingTextEl: panel.querySelector(".bb-chat-typing-text"),
  };
}

function renderPartyChatMessage(
  message,
  {
    currentUserName,
    onReply,
    onReact,
    onOpenViewers,
    onJumpToMessage,
    canReact = true,
    compact = false,
  } = {},
) {
  const row = document.createElement("article");
  const isSelf =
    String(message?.sender?.name || "") === String(currentUserName || "");
  row.className = `bb-chat-message${isSelf ? " is-self" : ""}`;
  row.dataset.messageId = String(messageIdOf(message));
  row.dataset.messageMine = message?.isMine ? "true" : "false";

  const avatar = createAvatarEl(
    message?.sender?.name,
    message?.sender?.charClass,
    message?.sender?.profileIconId,
  );

  const bubble = document.createElement("div");
  bubble.className = "bb-chat-bubble";

  const header = document.createElement("div");
  header.className = "bb-chat-message-header";
  header.innerHTML = `
    <div class="bb-chat-author">${escapeHtml(message?.sender?.name || "Player")}</div>
    <div class="bb-chat-time">${escapeHtml(formatChatTime(message?.createdAt))}</div>
  `;

  bubble.appendChild(header);

  if (!compact && message?.replyTo) {
    const reply = document.createElement("div");
    reply.className = "bb-chat-reply-preview";
    reply.innerHTML = `<strong>${escapeHtml(message.replyTo.sender || "")}</strong><br />${escapeHtml(message.replyTo.body || "")}`;
    if (Number(message?.replyTo?.id) > 0) {
      reply.classList.add("is-link");
      reply.title = "Jump to replied message";
      reply.addEventListener("click", () =>
        onJumpToMessage?.(Number(message?.replyTo?.id)),
      );
    }
    bubble.appendChild(reply);
  }

  const body = document.createElement("div");
  body.className = "bb-chat-body-text";
  body.textContent = String(message?.body || "");
  bubble.appendChild(body);

  if (!compact) {
    const meta = document.createElement("div");
    meta.className = "bb-chat-message-meta";

    const actions = document.createElement("div");
    actions.className = "bb-chat-hover-actions";

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "bb-chat-hover-btn";
    replyButton.textContent = "Reply";
    replyButton.disabled = !canReact;
    replyButton.addEventListener("click", () => onReply?.(message));
    actions.appendChild(replyButton);

    const reactionRow = document.createElement("div");
    reactionRow.className = "bb-chat-hover-reactions";
    const presetReactions = ["👍", "❤️", "😂", "🔥"];
    const reactionCounts = new Map(
      (Array.isArray(message?.reactions) ? message.reactions : []).map(
        (item) => [String(item?.reaction || ""), Number(item?.count) || 0],
      ),
    );
    const reactionUsers =
      message &&
      typeof message.reactionUsers === "object" &&
      message.reactionUsers
        ? message.reactionUsers
        : {};
    const usedReactions = Array.from(reactionCounts.entries())
      .filter(([, count]) => Number(count) > 0)
      .map(([reaction]) => reaction);
    const hoverReactions = presetReactions.filter(
      (reaction) => !usedReactions.includes(reaction),
    );
    const shownHoverReactions = hoverReactions.length
      ? hoverReactions
      : presetReactions;

    for (const reaction of shownHoverReactions) {
      const count = reactionCounts.get(reaction) || 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bb-chat-hover-btn${message?.myReaction === reaction ? " is-active" : ""}`;
      button.textContent = reaction;
      button.disabled = !canReact;
      button.addEventListener("click", () => onReact?.(message, reaction));
      reactionRow.appendChild(button);
    }
    actions.appendChild(reactionRow);

    const inlineReactions = document.createElement("div");
    inlineReactions.className = "bb-chat-inline-reactions";
    for (const reaction of usedReactions) {
      const count = Number(reactionCounts.get(reaction)) || 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bb-chat-inline-reaction${message?.myReaction === reaction ? " is-active" : ""}${
        message?._reactionPulse === reaction ? " is-pop" : ""
      }`;
      button.textContent = `${reaction} ${count}`;
      button.disabled = !canReact;
      const reactors = Array.isArray(reactionUsers?.[reaction])
        ? reactionUsers[reaction]
        : [];
      if (reactors.length) {
        button.dataset.tooltip = reactors
          .map((user) => formatNameWithYou(user?.name, currentUserName))
          .join("\n");
      }
      button.addEventListener("click", () => onReact?.(message, reaction));
      inlineReactions.appendChild(button);
    }

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = `bb-chat-view-count${Number(message?.viewCount) > 0 ? " is-read" : ""}`;
    viewButton.textContent = `✓✓ ${Number(message?.viewCount) || 0}`;
    viewButton.title = "Viewed by";
    viewButton.addEventListener("click", (event) =>
      onOpenViewers?.(message, event.currentTarget),
    );

    meta.appendChild(actions);
    meta.appendChild(inlineReactions);
    meta.appendChild(viewButton);
    bubble.appendChild(meta);
  }

  if (isSelf) {
    row.appendChild(bubble);
    row.appendChild(avatar);
  } else {
    row.appendChild(avatar);
    row.appendChild(bubble);
  }

  return row;
}

export function createLobbyChatController({
  socket,
  getPartyContext,
  getCurrentUserName,
} = {}) {
  const state = {
    partyId: null,
    isOpen: false,
    messages: [],
    messageMap: new Map(),
    lastReadMessageId: 0,
    lastReadSentMessageId: 0,
    openReadAnchorMessageId: 0,
    unreadCount: 0,
    hasReactionNotice: false,
    replyTo: null,
    loading: false,
    typingByUser: new Map(),
    typingStopTimer: null,
    typingHeartbeatTimer: null,
    typingSweepTimer: null,
    isLocalTyping: false,
    bubbleTimers: new Map(),
    chatSuspendedUntilMs: 0,
    cooldownTimer: null,
    localCooldownUntilMs: 0,
    cooldownDraftValue: "",
  };

  const ui = makeChatShell({
    rootClassName: "bb-chat-lobby-wrap",
    panelClassName: "bb-chat-lobby-panel",
    launcherLabel: "Chat",
    launcherClassName: "bb-chat-lobby-launcher",
  });
  ui.clearReplyBtn.style.display = "none";

  function currentPartyId() {
    const context =
      typeof getPartyContext === "function" ? getPartyContext() : null;
    const fromContext = Number(context?.partyId) || 0;
    if (fromContext > 0) return fromContext;
    return Number(state.partyId) || 0;
  }

  function getGlobalChatSuspensionMs() {
    return Number(window.__BRO_BATTLES_SUSPENSION__?.chat) || 0;
  }

  function getActiveChatSuspensionMs() {
    const now = Date.now();
    const localMs = Number(state.chatSuspendedUntilMs) || 0;
    const globalMs = getGlobalChatSuspensionMs();
    const active = Math.max(localMs, globalMs);
    return active > now ? active : 0;
  }

  function isChatSuspended() {
    return getActiveChatSuspensionMs() > 0;
  }

  function isLocalCooldownActive() {
    return Number(state.localCooldownUntilMs) > Date.now();
  }

  function applyLocalCooldown(message, durationMs = 2000) {
    const duration = Math.max(250, Number(durationMs) || 2000);
    const now = Date.now();
    if (!isLocalCooldownActive()) {
      state.cooldownDraftValue = String(ui.textarea.value || "");
    }
    state.localCooldownUntilMs = now + duration;
    ui.textarea.value = String(message || "Slow down.");
    ui.textarea.placeholder = ui.textarea.value;
    ui.textarea.disabled = true;
    ui.sendBtn.disabled = true;

    if (state.cooldownTimer) {
      window.clearTimeout(state.cooldownTimer);
      state.cooldownTimer = null;
    }

    state.cooldownTimer = window.setTimeout(() => {
      state.cooldownTimer = null;
      state.localCooldownUntilMs = 0;
      if (isChatSuspended()) {
        syncChatSuspensionUi();
        return;
      }
      ui.textarea.disabled = false;
      ui.sendBtn.disabled = false;
      ui.textarea.value = String(state.cooldownDraftValue || "");
      ui.textarea.placeholder = "Write a message...";
      ui.textarea.focus();
      state.cooldownDraftValue = "";
    }, duration);
  }

  function syncChatSuspensionUi() {
    const activeMs = getActiveChatSuspensionMs();
    if (!activeMs) {
      if (isLocalCooldownActive()) {
        return;
      }
      ui.textarea.disabled = false;
      ui.sendBtn.disabled = false;
      if (ui.textarea.dataset.suspensionText === "1") {
        ui.textarea.value = "";
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
    ui.textarea.dataset.suspensionText = "1";
    ui.textarea.placeholder = text;
    ui.root.classList.add("bb-chat-is-suspended");
  }

  function getPartyContextSnapshot() {
    return typeof getPartyContext === "function" ? getPartyContext() : null;
  }

  function isOnlineStatus(status) {
    const normalized = String(status || "online")
      .trim()
      .toLowerCase();
    return normalized !== "offline";
  }

  function buildPartyTitle(context) {
    const publicName = String(context?.publicName || "").trim();
    const ownerName = String(context?.ownerName || "").trim();
    const isPublic = !!context?.isPublic;
    if (isPublic && publicName) return publicName;
    if (ownerName) return `${ownerName}'s Party`;
    return "Party";
  }

  function syncHeader() {
    const context = getPartyContextSnapshot();
    const partyId = Number(context?.partyId) || 0;
    if (!partyId) {
      ui.titleEl.textContent = "Chat";
      ui.subtitleEl.textContent = "Party only";
      return;
    }
    const members = Array.isArray(context?.members) ? context.members : [];
    const onlineCount = members.reduce(
      (count, member) => count + (isOnlineStatus(member?.status) ? 1 : 0),
      0,
    );
    const capacity = Math.max(
      Number(context?.capacity?.total) || 0,
      members.length,
      1,
    );
    ui.titleEl.textContent = buildPartyTitle(context);
    ui.subtitleEl.textContent = `${onlineCount}/${capacity} online`;
  }

  function hideTypingIndicator() {
    state.typingByUser.clear();
    ui.typingEl.classList.add("hidden");
    ui.typingIconsEl.innerHTML = "";
    ui.typingTextEl.textContent = "";
  }

  function renderTypingIndicator() {
    const now = Date.now();
    for (const [key, entry] of state.typingByUser.entries()) {
      if (!entry || Number(entry.expiresAt) <= now) {
        state.typingByUser.delete(key);
      }
    }
    const typers = Array.from(state.typingByUser.values());
    if (!typers.length) {
      ui.typingEl.classList.add("hidden");
      ui.typingIconsEl.innerHTML = "";
      ui.typingTextEl.textContent = "";
      return;
    }
    ui.typingEl.classList.remove("hidden");
    ui.typingIconsEl.innerHTML = typers
      .map(
        (typer) =>
          `<span class="bb-chat-typing-icon"><img src="${escapeHtml(buildAvatarUrl(typer?.charClass, typer?.profileIconId))}" alt="${escapeHtml(typer?.name || "Player")}" loading="lazy" decoding="async" /></span>`,
      )
      .join("");
    if (typers.length === 1) {
      ui.typingTextEl.textContent = `${typers[0]?.name || "Player"} is typing`;
      return;
    }
    if (typers.length === 2) {
      ui.typingTextEl.textContent = `${typers[0]?.name || "Player"} and ${typers[1]?.name || "Player"} are typing`;
      return;
    }
    ui.typingTextEl.textContent = `${typers.length} people are typing`;
  }

  function emitTyping(isTyping) {
    const partyId = currentPartyId();
    if (!partyId) return;
    socket?.emit?.("party-chat:typing", {
      partyId,
      isTyping: !!isTyping,
    });
  }

  function setLocalTyping(isTyping) {
    const next = !!isTyping;
    if (!next) {
      if (state.typingStopTimer) {
        window.clearTimeout(state.typingStopTimer);
        state.typingStopTimer = null;
      }
      if (state.typingHeartbeatTimer) {
        window.clearInterval(state.typingHeartbeatTimer);
        state.typingHeartbeatTimer = null;
      }
      if (state.isLocalTyping) {
        state.isLocalTyping = false;
        emitTyping(false);
      }
      return;
    }

    if (state.typingStopTimer) {
      window.clearTimeout(state.typingStopTimer);
      state.typingStopTimer = null;
    }

    if (!state.isLocalTyping) {
      state.isLocalTyping = true;
      emitTyping(true);
    }
    if (!state.typingHeartbeatTimer) {
      state.typingHeartbeatTimer = window.setInterval(() => {
        if (!state.isLocalTyping) return;
        emitTyping(true);
      }, LOBBY_TYPING_HEARTBEAT_MS);
    }
  }

  function scheduleTypingStop() {
    if (state.typingStopTimer) {
      window.clearTimeout(state.typingStopTimer);
    }
    state.typingStopTimer = window.setTimeout(() => {
      setLocalTyping(false);
    }, LOBBY_TYPING_IDLE_STOP_MS);
  }

  function showLobbyMessageBubble(message) {
    const bodyText = String(message?.body || "")
      .replace(/\s+/g, " ")
      .trim();
    const senderName = String(message?.sender?.name || "").trim();
    if (!bodyText || !senderName) return;
    const slot = Array.from(
      document.querySelectorAll(".character-slot[data-player-name]"),
    ).find((candidate) => sameName(candidate?.dataset?.playerName, senderName));
    if (!slot) return;
    let bubble = slot.querySelector(".bb-lobby-chat-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "bb-lobby-chat-bubble";
      slot.appendChild(bubble);
    }
    bubble.textContent = bodyText;
    bubble.classList.add("is-visible");

    const key = String(slot?.dataset?.playerName || senderName)
      .trim()
      .toLowerCase();
    const existingTimer = state.bubbleTimers.get(key);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      bubble.classList.remove("is-visible");
      state.bubbleTimers.delete(key);
    }, LOBBY_CHAT_BUBBLE_MS);
    state.bubbleTimers.set(key, timer);
  }

  function syncLobbyChatVisibility() {
    const visible = currentPartyId() > 0;
    ui.root.style.display = visible ? "block" : "none";
    if (visible) return;
    setOpen(false);
    setUnreadBadge(0);
    setReactionBadge(false);
    setLocalTyping(false);
    state.messages = [];
    renderMessages();
    hideTypingIndicator();
  }

  function setUnreadBadge(count) {
    const next = Math.max(0, Number(count) || 0);
    state.unreadCount = next;
    if (next > 0) {
      ui.badge.textContent = String(next);
      ui.badge.classList.remove("hidden");
    } else {
      ui.badge.textContent = "";
      ui.badge.classList.add("hidden");
    }
  }

  function setReactionBadge(show) {
    state.hasReactionNotice = !!show;
    ui.reactionBadge.classList.toggle("hidden", !state.hasReactionNotice);
  }

  function isMessageMineForCurrentUser(message) {
    const senderName = String(message?.sender?.name || "");
    const currentName = String(getCurrentUserName?.() || "");
    if (!senderName || !currentName) return !!message?.isMine;
    return senderName.trim().toLowerCase() === currentName.trim().toLowerCase();
  }

  function normalizeIncomingMessage(message) {
    if (!message || typeof message !== "object") return message;
    return {
      ...message,
      isMine: isMessageMineForCurrentUser(message),
    };
  }

  function getUnreadMessageCount() {
    const lastReadId = Number(state.lastReadMessageId) || 0;
    return state.messages.reduce((count, message) => {
      const messageId = messageIdOf(message);
      if (!messageId || messageId <= lastReadId) return count;
      if (isMessageMineForCurrentUser(message)) return count;
      if (message?.type) return count;
      return count + 1;
    }, 0);
  }

  function syncUnreadBadge() {
    setUnreadBadge(getUnreadMessageCount());
  }

  function setOpen(open) {
    const wasOpen = state.isOpen;
    state.isOpen = !!open;
    if (state.isOpen && !wasOpen) {
      state.openReadAnchorMessageId = Number(state.lastReadMessageId) || 0;
      setReactionBadge(false);
    }
    if (!state.isOpen && wasOpen) {
      state.openReadAnchorMessageId = 0;
      const latestId = messageIdOf(state.messages[state.messages.length - 1]);
      if (latestId > 0) {
        void markMessagesRead(latestId);
      }
      setLocalTyping(false);
    }
    ui.panel.classList.toggle("is-open", state.isOpen);
    ui.backdrop.classList.toggle("is-visible", state.isOpen);
    ui.launcher.classList.toggle("is-active", state.isOpen);
    if (state.isOpen) {
      setUnreadBadge(0);
    }
  }

  function setReplyTo(message) {
    state.replyTo = message || null;
    if (!state.replyTo) {
      ui.replyBanner.classList.add("hidden");
      ui.replyBanner.textContent = "";
      ui.clearReplyBtn.style.display = "none";
      return;
    }
    ui.replyBanner.classList.remove("hidden");
    ui.clearReplyBtn.style.display = "inline-flex";
    ui.replyBanner.innerHTML = `<span>Replying to <strong>${escapeHtml(state.replyTo.sender?.name || state.replyTo.sender || "")}</strong>: ${escapeHtml(state.replyTo.body || "")}</span>`;
    ui.textarea.focus();
  }

  const viewersPopup = document.createElement("div");
  viewersPopup.className = "bb-chat-viewers-popup hidden";
  viewersPopup.innerHTML = `
    <div class="bb-chat-viewers-backdrop" data-chat-viewers-close></div>
    <div class="bb-chat-viewers-card" role="dialog" aria-modal="true" aria-label="Message views">
      <div class="bb-chat-viewers-head">
        <div class="bb-chat-viewers-title">Viewed by</div>
        <button type="button" class="bb-chat-mini-btn" data-chat-viewers-close aria-label="Close viewers">X</button>
      </div>
      <div class="bb-chat-viewers-list"></div>
    </div>
  `;
  document.body.appendChild(viewersPopup);
  const viewersListEl = viewersPopup.querySelector(".bb-chat-viewers-list");
  viewersPopup
    .querySelectorAll("[data-chat-viewers-close]")
    .forEach((el) =>
      el.addEventListener("click", () => viewersPopup.classList.add("hidden")),
    );

  function openViewersPopup(message, anchorEl) {
    if (!viewersListEl) return;
    const currentName = getCurrentUserName?.() || "";
    const viewers = Array.isArray(message?.viewers) ? message.viewers : [];
    viewersListEl.innerHTML = "";
    if (!viewers.length) {
      const empty = document.createElement("div");
      empty.className = "bb-chat-viewers-empty";
      empty.textContent = "No views yet";
      viewersListEl.appendChild(empty);
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
        fragment.appendChild(row);
      }
      viewersListEl.appendChild(fragment);
    }
    const card = viewersPopup.querySelector(".bb-chat-viewers-card");
    if (card && anchorEl?.getBoundingClientRect) {
      const rect = anchorEl.getBoundingClientRect();
      const cardWidth = 280;
      const cardHeight = 220;
      let left = rect.left + rect.width - cardWidth;
      let top = rect.bottom + 8;
      left = Math.max(8, Math.min(left, window.innerWidth - cardWidth - 8));
      if (top + cardHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - cardHeight - 8);
      }
      card.style.left = `${Math.round(left)}px`;
      card.style.top = `${Math.round(top)}px`;
      card.classList.remove("is-visible");
      window.requestAnimationFrame(() => card.classList.add("is-visible"));
    }
    viewersPopup.classList.remove("hidden");
  }

  function jumpToMessage(messageId) {
    const targetId = Number(messageId) || 0;
    if (!targetId) return;
    const row = getMessageRow(targetId);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("bb-chat-message-target");
    window.setTimeout(
      () => row.classList.remove("bb-chat-message-target"),
      750,
    );
  }

  function sameName(a, b) {
    return (
      String(a || "")
        .trim()
        .toLowerCase() ===
      String(b || "")
        .trim()
        .toLowerCase()
    );
  }

  function reactionCountMap(message) {
    const map = new Map();
    const reactions = Array.isArray(message?.reactions)
      ? message.reactions
      : [];
    for (const item of reactions) {
      map.set(String(item?.reaction || ""), Number(item?.count) || 0);
    }
    return map;
  }

  function findChangedReaction(previousMessage, nextMessage) {
    const prev = reactionCountMap(previousMessage);
    const next = reactionCountMap(nextMessage);
    const keys = new Set([...prev.keys(), ...next.keys()]);
    for (const key of keys) {
      if ((prev.get(key) || 0) !== (next.get(key) || 0)) return key;
    }
    return null;
  }

  async function markMessagesRead(lastMessageId) {
    const partyId = currentPartyId();
    const targetId = Number(lastMessageId) || 0;
    if (!partyId || targetId <= 0) return null;
    if (targetId <= state.lastReadSentMessageId) return null;
    state.lastReadSentMessageId = targetId;
    try {
      const result = await postJson("/party-chat/read", {
        partyId,
        lastMessageId: targetId,
      });
      const serverLastRead = Number(result?.lastReadMessageId) || targetId;
      state.lastReadMessageId = Math.max(
        state.lastReadMessageId || 0,
        serverLastRead,
      );
      syncUnreadBadge();
      return result;
    } catch (_) {
      return null;
    }
  }

  function getMessageRow(messageId) {
    return ui.messagesEl.querySelector(`[data-message-id="${messageId}"]`);
  }

  function isScrolledNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = ui.messagesEl;
    return scrollHeight - (scrollTop + clientHeight) < 64;
  }

  function scrollToBottom(force = false) {
    if (force || isScrolledNearBottom()) {
      ui.messagesEl.scrollTop = ui.messagesEl.scrollHeight;
    }
  }

  function replaceMessageMeta(row, message) {
    if (!row) return null;
    const replacement = renderPartyChatMessage(message, {
      currentUserName: getCurrentUserName?.(),
      onReply: setReplyTo,
      onReact: (target, reaction) => void reactToMessage(target?.id, reaction),
      onOpenViewers: openViewersPopup,
      onJumpToMessage: jumpToMessage,
      canReact: !isChatSuspended(),
      compact: false,
    });
    row.replaceWith(replacement);
    return replacement;
  }

  function upsertMessage(message, { forceScroll = false } = {}) {
    const messageId = messageIdOf(message);
    if (!messageId) return;
    const existing = state.messageMap.get(messageId);
    state.messageMap.set(messageId, message);
    const index = state.messages.findIndex(
      (item) => messageIdOf(item) === messageId,
    );
    if (index >= 0) state.messages[index] = message;
    else state.messages.push(message);
    state.messages = state.messages.slice(-100);

    const existingRow = getMessageRow(messageId);
    if (existingRow) {
      replaceMessageMeta(existingRow, message);
    } else if (state.isOpen) {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(
        renderPartyChatMessage(message, {
          currentUserName: getCurrentUserName?.(),
          onReply: setReplyTo,
          onReact: (target, reaction) =>
            void reactToMessage(target?.id, reaction),
          onOpenViewers: openViewersPopup,
          onJumpToMessage: jumpToMessage,
          canReact: !isChatSuspended(),
          compact: false,
        }),
      );
      ui.messagesEl.appendChild(fragment);
    }

    if (state.isOpen) scrollToBottom(forceScroll);
  }

  function rebuildMessages(messages = []) {
    const nearBottom = isScrolledNearBottom();
    const fragment = document.createDocumentFragment();
    state.messages = Array.isArray(messages) ? messages.slice(-100) : [];
    state.messageMap = new Map();
    ui.messagesEl.innerHTML = "";
    let dividerInserted = false;
    for (const message of state.messages) {
      const messageId = messageIdOf(message);
      if (
        state.isOpen &&
        !dividerInserted &&
        state.openReadAnchorMessageId &&
        messageId > state.openReadAnchorMessageId
      ) {
        dividerInserted = true;
        const divider = document.createElement("div");
        divider.className = "bb-chat-divider";
        divider.innerHTML = `<span>New messages</span>`;
        fragment.appendChild(divider);
      }
      state.messageMap.set(messageId, message);
      fragment.appendChild(
        renderPartyChatMessage(message, {
          currentUserName: getCurrentUserName?.(),
          onReply: setReplyTo,
          onReact: (target, reaction) =>
            void reactToMessage(target?.id, reaction),
          onOpenViewers: openViewersPopup,
          onJumpToMessage: jumpToMessage,
          canReact: !isChatSuspended(),
          compact: false,
        }),
      );
    }
    ui.messagesEl.appendChild(fragment);
    if (nearBottom || state.isOpen) {
      ui.messagesEl.scrollTop = ui.messagesEl.scrollHeight;
    }
  }

  function renderMessages() {
    rebuildMessages(state.messages);
  }

  async function loadHistory() {
    const partyId = currentPartyId();
    if (!partyId) {
      state.messages = [];
      state.lastReadMessageId = 0;
      renderMessages();
      return;
    }
    state.loading = true;
    try {
      const data = await postJson("/party-chat/history", {
        partyId,
        limit: 80,
      });
      const serverLastReadMessageId = Number(data?.lastReadMessageId) || 0;
      state.partyId = partyId;
      state.messages = Array.isArray(data?.messages) ? data.messages : [];
      state.messageMap = new Map(
        state.messages.map((message) => [messageIdOf(message), message]),
      );
      state.lastReadMessageId = serverLastReadMessageId;
      if (state.isOpen && !state.openReadAnchorMessageId) {
        state.openReadAnchorMessageId = serverLastReadMessageId;
      }
      renderMessages();
      if (state.isOpen) {
        const latestId = messageIdOf(state.messages[state.messages.length - 1]);
        if (latestId > 0) void markMessagesRead(latestId);
      }
      if (!state.isOpen) {
        state.lastReadMessageId = Number(data?.lastReadMessageId) || 0;
        syncUnreadBadge();
      }
    } catch (error) {
      console.warn("[chat] lobby history failed", error?.message || error);
    } finally {
      state.loading = false;
    }
  }

  async function sendMessage() {
    const partyId = currentPartyId();
    const body = String(ui.textarea.value || "").trim();
    if (isChatSuspended()) {
      syncChatSuspensionUi();
      return;
    }
    if (isLocalCooldownActive()) return;
    if (!partyId || !body) return;
    setLocalTyping(false);
    const payload = {
      partyId,
      body,
      replyToMessageId: state.replyTo?.id || null,
    };
    ui.sendBtn.disabled = true;
    try {
      const result = await postJson("/party-chat/send", payload);
      ui.textarea.value = "";
      setReplyTo(null);
      const message = result?.message || null;
      if (message) {
        upsertMessage(message, { forceScroll: true });
      }
    } catch (error) {
      console.warn("[chat] send failed", error?.message || error);
      const suspendedUntilMs = Number(error?.payload?.suspendedUntilMs) || 0;
      if (suspendedUntilMs > Date.now()) {
        state.chatSuspendedUntilMs = Math.max(
          state.chatSuspendedUntilMs || 0,
          suspendedUntilMs,
        );
        syncChatSuspensionUi();
        renderMessages();
        showChatRequestError(error, "Chat blocked");
        return;
      }
      const type = String(error?.payload?.type || "").toLowerCase();
      if (type === "warn" || type === "chat_limited") {
        applyLocalCooldown(buildInlineCooldownMessage(error), 2000);
        return;
      }
      showChatRequestError(error, "Chat blocked");
    } finally {
      if (!isChatSuspended() && !isLocalCooldownActive()) {
        ui.sendBtn.disabled = false;
        ui.textarea.focus();
      }
    }
  }

  async function reactToMessage(messageId, reaction) {
    const partyId = currentPartyId();
    if (isChatSuspended()) {
      syncChatSuspensionUi();
      return;
    }
    if (isLocalCooldownActive()) return;
    if (!partyId || !messageId) return;
    try {
      await postJson("/party-chat/react", {
        partyId,
        messageId,
        reaction,
      });
      // Socket event is the source of truth so all clients animate/resolve consistently.
    } catch (error) {
      console.warn("[chat] reaction failed", error?.message || error);
      const suspendedUntilMs = Number(error?.payload?.suspendedUntilMs) || 0;
      if (suspendedUntilMs > Date.now()) {
        state.chatSuspendedUntilMs = Math.max(
          state.chatSuspendedUntilMs || 0,
          suspendedUntilMs,
        );
        syncChatSuspensionUi();
        renderMessages();
        showChatRequestError(error, "Reaction blocked");
        return;
      }
      const type = String(error?.payload?.type || "").toLowerCase();
      if (type === "warn" || type === "chat_limited") {
        applyLocalCooldown(buildInlineCooldownMessage(error), 2000);
        return;
      }
      showChatRequestError(error, "Reaction blocked");
    }
  }

  ui.launcher.addEventListener("click", async () => {
    const nextOpen = !state.isOpen;
    setOpen(nextOpen);
    if (!nextOpen) return;
    if (currentPartyId()) {
      await loadHistory();
      syncChatSuspensionUi();
      if (!isChatSuspended()) {
        ui.textarea.focus();
      }
    } else {
      state.messages = [];
      renderMessages();
    }
  });
  ui.backdrop.addEventListener("click", () => setOpen(false));
  ui.closeBtn.addEventListener("click", () => setOpen(false));
  ui.clearReplyBtn.addEventListener("click", () => setReplyTo(null));
  ui.sendBtn.addEventListener("click", () => void sendMessage());
  ui.textarea.addEventListener("input", () => {
    if (!currentPartyId()) return;
    setLocalTyping(true);
    scheduleTypingStop();
  });
  ui.textarea.addEventListener("blur", () => {
    setLocalTyping(false);
  });
  ui.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });

  socket?.on?.("party:joined", ({ partyId }) => {
    state.partyId = Number(partyId) || null;
    syncHeader();
    syncLobbyChatVisibility();
    if (!state.partyId) {
      setOpen(false);
      setUnreadBadge(0);
      setReactionBadge(false);
      setLocalTyping(false);
      state.messages = [];
      renderMessages();
      hideTypingIndicator();
      return;
    }
  });

  socket?.on?.("party-chat:message", (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (partyId !== currentPartyId()) return;
    const rawMessage = payload?.message || null;
    const message = normalizeIncomingMessage(rawMessage);
    if (!message) return;
    const incomingId = messageIdOf(message);
    const existing = state.messageMap.get(incomingId);
    const changedReaction = existing
      ? findChangedReaction(existing, message)
      : null;
    const isExistingMessageUpdate = !!existing;
    const nextMessage = changedReaction
      ? { ...message, _reactionPulse: changedReaction }
      : message;
    if (!existing && !message?.type) {
      const appendAtBottom = state.isOpen;
      upsertMessage(nextMessage, { forceScroll: appendAtBottom });
      showLobbyMessageBubble(message);
    } else if (existing) {
      upsertMessage(nextMessage);
    }

    if (changedReaction && message?.isMine && !state.isOpen) {
      setReactionBadge(true);
    }

    if (changedReaction) {
      window.setTimeout(() => {
        const latest = state.messageMap.get(incomingId);
        if (!latest || latest._reactionPulse !== changedReaction) return;
        const cleaned = { ...latest };
        delete cleaned._reactionPulse;
        upsertMessage(cleaned);
      }, 260);
    }

    if (state.isOpen) {
      void markMessagesRead(incomingId);
    } else if (!message?.isMine && !isExistingMessageUpdate) {
      syncUnreadBadge();
    }
  });

  socket?.on?.("party-chat:read", (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (partyId !== currentPartyId()) return;
    const viewerName = String(payload?.viewerName || "");
    const lastMessageId = Number(payload?.messageId) || 0;
    if (!lastMessageId || !viewerName) return;
    for (const message of state.messages) {
      const messageId = messageIdOf(message);
      if (messageId > lastMessageId) continue;
      const senderUserId = Number(message?.sender?.userId) || 0;
      const viewerUserId = Number(payload?.viewerUserId) || 0;
      if (
        senderUserId > 0 &&
        viewerUserId > 0 &&
        senderUserId === viewerUserId
      ) {
        continue;
      }
      const viewers = Array.isArray(message.viewers)
        ? [...message.viewers]
        : [];
      const viewerExists = viewers.some((viewer) => {
        const existingId = Number(viewer?.userId) || 0;
        if (existingId > 0 && viewerUserId > 0)
          return existingId === viewerUserId;
        return sameName(viewer?.name, viewerName);
      });
      if (!viewerExists) {
        viewers.push({
          name: viewerName,
          userId: Number(payload?.viewerUserId) || null,
          charClass: String(payload?.viewerCharClass || "ninja"),
          profileIconId: String(payload?.viewerProfileIconId || "") || null,
          readAt: new Date().toISOString(),
        });
      }
      message.viewers = viewers;
      message.viewCount = viewers.length;
      state.messageMap.set(messageId, message);
      const row = getMessageRow(messageId);
      if (row) replaceMessageMeta(row, message);
    }
  });

  socket?.on?.("party-chat:typing", (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (!partyId || partyId !== currentPartyId()) return;
    const now = Date.now();
    const typers = Array.isArray(payload?.typers) ? payload.typers : [];
    const currentName = String(getCurrentUserName?.() || "").trim();
    const next = new Map();
    for (const typer of typers) {
      const name = String(typer?.name || "").trim();
      if (!name) continue;
      if (currentName && sameName(name, currentName)) continue;
      const userId = Number(typer?.userId) || 0;
      const key = userId > 0 ? `u:${userId}` : `n:${name.toLowerCase()}`;
      next.set(key, {
        userId: userId || null,
        name,
        charClass: String(typer?.charClass || "ninja"),
        profileIconId: String(typer?.profileIconId || "") || null,
        expiresAt: now + LOBBY_TYPING_STALE_MS,
      });
    }
    state.typingByUser = next;
    renderTypingIndicator();
  });

  socket?.on?.("party:members", () => {
    syncHeader();
    syncLobbyChatVisibility();
    syncChatSuspensionUi();
    const partyId = currentPartyId();
    if (!partyId) {
      setOpen(false);
      setUnreadBadge(0);
      hideTypingIndicator();
      return;
    }
    if (!state.isOpen) {
      syncUnreadBadge();
    }
  });

  socket?.on?.("status:update", (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (partyId && partyId !== currentPartyId()) return;
    syncHeader();
  });

  const initialPartyId = currentPartyId();
  syncHeader();
  syncLobbyChatVisibility();
  syncChatSuspensionUi();
  state.typingSweepTimer = window.setInterval(() => {
    syncChatSuspensionUi();
    renderTypingIndicator();
  }, 500);
  if (initialPartyId) {
    state.partyId = initialPartyId;
    void loadHistory();
  }

  ui.messagesEl.addEventListener("scroll", () => {
    if (
      state.isOpen &&
      isScrolledNearBottom() &&
      state.lastReadMessageId <
        (messageIdOf(state.messages[state.messages.length - 1]) || 0)
    ) {
      const latestId = messageIdOf(state.messages[state.messages.length - 1]);
      void markMessagesRead(latestId);
    }
  });

  return {
    refresh: () => void loadHistory(),
    open: () => setOpen(true),
    close: () => setOpen(false),
    destroy: () => {
      setLocalTyping(false);
      if (state.typingSweepTimer) {
        window.clearInterval(state.typingSweepTimer);
        state.typingSweepTimer = null;
      }
      if (state.cooldownTimer) {
        window.clearTimeout(state.cooldownTimer);
        state.cooldownTimer = null;
      }
      for (const timerId of state.bubbleTimers.values()) {
        window.clearTimeout(timerId);
      }
      state.bubbleTimers.clear();
      ui.root.remove();
      viewersPopup.remove();
    },
  };
}

export function createGameChatController({
  socket,
  getGameData,
  getUsername,
  setChatInputActive,
  isChatInputActive,
  getScene,
} = {}) {
  const state = {
    isOpen: false,
    suppressed: false,
    unreadCount: 0,
    messages: [],
    idleTimer: null,
    pruneTimer: null,
  };

  const ui = makeChatShell({
    rootClassName: "bb-chat-game-wrap",
    panelClassName: "bb-chat-game-panel",
    launcherLabel: "Chat",
    launcherClassName: "bb-chat-game-launcher",
  });
  ui.clearReplyBtn.style.display = "none";
  ui.replyBanner.style.display = "none";

  function setUnreadBadge(count) {
    state.unreadCount = Math.max(0, Number(count) || 0);
    if (state.unreadCount > 0) {
      ui.badge.textContent = String(state.unreadCount);
      ui.badge.classList.remove("hidden");
    } else {
      ui.badge.textContent = "";
      ui.badge.classList.add("hidden");
    }
  }

  function syncSceneKeyboardEnabled() {
    const scene = typeof getScene === "function" ? getScene() : null;
    if (scene?.input?.keyboard) {
      scene.input.keyboard.enabled = !isChatInputActive?.();
    }
  }

  function setActive(active) {
    state.isOpen = !!active;
    ui.panel.classList.toggle("is-open", state.isOpen);
    ui.panel.classList.toggle("is-muted", !state.isOpen && state.suppressed);
    ui.panel.classList.toggle("is-idle", !state.isOpen && !state.suppressed);
    if (setChatInputActive) setChatInputActive(state.isOpen);
    syncSceneKeyboardEnabled();
    if (state.isOpen) {
      ui.textarea.focus();
      ui.panel.classList.remove("is-idle");
      ui.panel.classList.remove("is-muted");
    }
  }

  function setSuppressed(suppressed) {
    state.suppressed = !!suppressed;
    if (state.suppressed) {
      state.isOpen = false;
      if (setChatInputActive) setChatInputActive(false);
      ui.panel.classList.add("is-muted");
      ui.panel.classList.remove("is-open");
      setUnreadBadge(0);
    } else {
      ui.panel.classList.remove("is-muted");
      if (!state.isOpen) {
        ui.panel.classList.add("is-idle");
      }
    }
    syncSceneKeyboardEnabled();
  }

  function resetIdleTimer() {
    clearTimeout(state.idleTimer);
    clearTimeout(state.pruneTimer);
    if (state.suppressed) {
      ui.panel.classList.add("is-muted");
      ui.panel.classList.remove("is-open", "is-idle");
      return;
    }
    ui.panel.classList.remove("is-idle");
    ui.panel.classList.remove("is-muted");
    state.idleTimer = setTimeout(() => {
      if (state.suppressed) return;
      if (!state.isOpen) {
        ui.panel.classList.add("is-idle");
      }
    }, 3000);
    state.pruneTimer = setTimeout(() => {
      if (!state.suppressed) {
        ui.panel.classList.add("is-idle");
      }
    }, 4500);
  }

  function renderMessages() {
    ui.messagesEl.innerHTML = "";
    const now = Date.now();
    const currentUser = String(getUsername?.() || "");
    const visibleMessages = state.messages.filter(
      (message) => Number(message?.expiresAt || 0) > now,
    );
    state.messages = visibleMessages;
    for (const message of visibleMessages) {
      ui.messagesEl.appendChild(
        renderPartyChatMessage(message, {
          currentUserName: currentUser,
          compact: true,
        }),
      );
    }
    ui.messagesEl.scrollTop = ui.messagesEl.scrollHeight;
  }

  function addMessage(message) {
    const id = String(message?.id || "");
    if (!id) return;
    const exists = state.messages.some((item) => String(item?.id || "") === id);
    if (exists) return;
    state.messages.push({
      ...message,
      expiresAt: Date.now() + 12000,
    });
    state.messages = state.messages.slice(-GAME_CHAT_RECENT_LIMIT);
    renderMessages();
    if (!state.suppressed) {
      resetIdleTimer();
    }
  }

  async function sendMessage() {
    const body = String(ui.textarea.value || "").trim();
    if (!body) return;
    const payload = {
      body,
      matchId: Number(getGameData?.()?.gameId || 0) || null,
    };
    ui.sendBtn.disabled = true;
    try {
      const ack = await new Promise((resolve, reject) => {
        socket?.emit?.("game:chat:send", payload, (result) => {
          if (result?.ok) resolve(result.message);
          else reject(new Error(result?.error || "Failed to send chat"));
        });
      });
      ui.textarea.value = "";
      addMessage(ack);
    } catch (error) {
      console.warn("[chat] game send failed", error?.message || error);
    } finally {
      ui.sendBtn.disabled = false;
    }
  }

  function openComposer() {
    setSuppressed(false);
    setActive(true);
    resetIdleTimer();
  }

  function closeComposer() {
    setActive(false);
    if (setChatInputActive) setChatInputActive(false);
    syncSceneKeyboardEnabled();
    resetIdleTimer();
  }

  ui.launcher.addEventListener("click", () => {
    if (state.suppressed) {
      setSuppressed(false);
      setUnreadBadge(0);
      openComposer();
      return;
    }
    if (state.isOpen) closeComposer();
    else openComposer();
  });
  ui.sendBtn.addEventListener("click", () => void sendMessage());
  ui.closeBtn.addEventListener("click", () => setSuppressed(true));
  ui.clearReplyBtn.addEventListener("click", () => {});
  ui.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSuppressed(true);
    }
  });

  const keyHandler = (event) => {
    const target = event.target;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.defaultPrevented) return;
    if ((event.key === "/" || event.code === "Slash") && !state.isOpen) {
      event.preventDefault();
      if (state.suppressed) {
        setSuppressed(false);
        setUnreadBadge(0);
      }
      openComposer();
      return;
    }
    if (event.key === "Escape" && state.isOpen) {
      event.preventDefault();
      setSuppressed(true);
    }
  };
  document.addEventListener("keydown", keyHandler, true);

  socket?.on?.("game:chat:message", (message) => {
    addMessage(message);
    if (state.suppressed) {
      setUnreadBadge(state.unreadCount + 1);
      return;
    }
    if (!state.isOpen) {
      ui.panel.classList.add("is-idle");
    }
  });

  setSuppressed(false);
  resetIdleTimer();

  return {
    open: openComposer,
    suppress: () => setSuppressed(true),
    destroy: () => {
      document.removeEventListener("keydown", keyHandler, true);
      ui.root.remove();
    },
  };
}
