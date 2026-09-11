
import { makeChatShell, formatSuspensionTime, escapeHtml, buildAvatarUrl, LOBBY_TYPING_HEARTBEAT_MS, LOBBY_TYPING_IDLE_STOP_MS, LOBBY_CHAT_BUBBLE_MS, messageIdOf, formatNameWithYou, formatChatTime, postJson, renderPartyChatMessage, showChatRequestError, buildInlineCooldownMessage, LOBBY_TYPING_STALE_MS } from './presentation';

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
    ui.launcher.style.display = visible ? "inline-flex" : "none";
    ui.launcher.disabled = !visible;
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
        <button type="button" class="bb-chat-mini-btn bb-close pixel-menu-button" data-chat-viewers-close aria-label="Close viewers">×</button>
      </div>
      <div class="bb-chat-viewers-list"></div>
    </div>
  `;
  document.body.appendChild(viewersPopup);
  const viewersListEl = viewersPopup.querySelector(".bb-chat-viewers-list");
  let viewersCloseTimer = null;
  const closeViewersPopup = () => {
    const card = viewersPopup.querySelector(".bb-chat-viewers-card");
    card?.classList.remove("is-visible");
    if (viewersCloseTimer) window.clearTimeout(viewersCloseTimer);
    viewersCloseTimer = window.setTimeout(() => {
      viewersPopup.classList.add("hidden");
      viewersCloseTimer = null;
    }, 150);
  };
  viewersPopup
    .querySelectorAll("[data-chat-viewers-close]")
    .forEach((el) => el.addEventListener("click", closeViewersPopup));

  function openViewersPopup(message, anchorEl) {
    if (!viewersListEl) return;
    if (viewersCloseTimer) {
      window.clearTimeout(viewersCloseTimer);
      viewersCloseTimer = null;
    }
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
      ui.launcher.remove();
      viewersPopup.remove();
    },
  };
}
