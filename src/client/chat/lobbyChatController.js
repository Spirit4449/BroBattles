import { API_PATHS } from "../../shared/net/apiPaths.js";
import { SOCKET_EVENTS } from "../../shared/net/socketEvents.js";
import { renderSystemLog } from './systemLog.mjs';
import { createPartyPresenceTracker, countOnlineMembers } from './partyPresence.mjs';
import { createViewersPopup } from './viewersPopup.js';
import { makeChatShell, escapeHtml, LOBBY_TYPING_HEARTBEAT_MS, LOBBY_TYPING_IDLE_STOP_MS, messageIdOf, postJson, renderPartyChatMessage } from './presentation';
import { resolveCharacterKey } from "../../shared/characters/characterStats.js";
import { nameKey } from "../../shared/social/textRules.js";
import { createLocalTypingEmitter, TYPING_STALE_MS } from "./typingTracker.js";
import { findChangedReaction } from "./reactions.js";
import { renderUnreadBadge } from "./badges.mjs";
import { createLobbyMessageBubbles } from "../lobby/party/partyChatBubbles.js";
import { createChatRestrictions } from "./chatRestrictions.js";

export function createLobbyChatController({
  socket,
  getPartyContext,
  getCurrentUserName,
  onOpenProfile,
} = {}) {
  const state = {
    partyId: null,
    sending: false,
    destroyed: false,
    historyRequest: 0,
    restoreUnreadOnOpen: false,
    isOpen: false,
    messages: [],
    systemLogs: new Map(),
    lastViewedMessageId: 0,
    messageMap: new Map(),
    lastReadMessageId: 0,
    lastReadSentMessageId: 0,
    openReadAnchorMessageId: 0,
    unreadCount: 0,
    hasReactionNotice: false,
    replyTo: null,
    loading: false,
    typingByUser: new Map(),
    typingSweepTimer: null,
  };

  const presence = createPartyPresenceTracker(getPartyContext?.());

  const ui = makeChatShell({
    rootClassName: "bb-chat-lobby-wrap",
    panelClassName: "bb-chat-lobby-panel",
    launcherLabel: "Chat",
    launcherClassName: "bb-chat-lobby-launcher",
  });
  const restrictions = createChatRestrictions(ui, {
    isSending: () => state.sending,
    onSuspension: renderMessages,
  });
  const { isChatSuspended, syncChatSuspensionUi, cooldown } = restrictions;
  const bubbles = createLobbyMessageBubbles();
  const typing = createLocalTypingEmitter({
    emit: isTyping => {
      const partyId = currentPartyId();
      if (partyId) socket?.emit?.(SOCKET_EVENTS.PARTY_CHAT_TYPING, { partyId, isTyping });
    },
    idleMs: LOBBY_TYPING_IDLE_STOP_MS,
    heartbeatMs: LOBBY_TYPING_HEARTBEAT_MS,
    periodic: true,
  });
  const socketListeners = [];
  function listen(event, handler) {
    socket?.on?.(event, handler);
    socketListeners.push([event, handler]);
  }
  ui.clearReplyBtn.style.display = "none";

  function currentPartyId() {
    return Number(presence.get()?.partyId) || 0;
  }

  function getPartyContextSnapshot() {
    return typeof getPartyContext === "function" ? getPartyContext() : null;
  }

  function typingLabel(typers) {
    const names = typers.map((typer) => typer?.name || "Player");
    if (names.length === 1) return `${names[0]} is typing`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
    if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing`;
    return `${names.length} people are typing`;
  }

  // The header status line shows who is typing, otherwise the online count.
  function syncHeader() {
    const context = presence.get();
    const partyId = Number(context?.partyId) || 0;
    ui.titleEl.textContent = "Party Chat";
    const typers = partyId ? Array.from(state.typingByUser.values()) : [];
    if (typers.length) {
      const label = typingLabel(typers);
      ui.subtitleEl.innerHTML = `<span class="bb-chat-typing-dot" aria-hidden="true"></span><span class="bb-chat-typing-text"></span>`;
      ui.subtitleEl.querySelector(".bb-chat-typing-text").textContent = label;
      ui.subtitleEl.title = label;
      ui.subtitleEl.classList.add("is-typing");
      return;
    }
    ui.subtitleEl.classList.remove("is-typing");
    ui.subtitleEl.title = "";
    if (!partyId) {
      ui.subtitleEl.textContent = "Party only";
      return;
    }
    const members = Array.isArray(context?.members) ? context.members : [];
    const onlineCount = countOnlineMembers(members);
    const capacity = Math.max(
      Number(context?.capacity?.total) || 0,
      members.length,
      1,
    );
    ui.subtitleEl.textContent = `${onlineCount}/${capacity} online`;
  }

  function hideTypingIndicator() {
    state.typingByUser.clear();
    syncHeader();
  }

  function renderTypingIndicator() {
    const now = Date.now();
    for (const [key, entry] of state.typingByUser.entries()) {
      if (!entry || Number(entry.expiresAt) <= now) {
        state.typingByUser.delete(key);
      }
    }
    syncHeader();
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
    typing.stop();
    state.messages = [];
    renderMessages();
    hideTypingIndicator();
  }

  function setUnreadBadge(count) {
    const next = Math.max(0, Number(count) || 0);
    state.unreadCount = next;
    renderUnreadBadge(ui.badge, next);
  }

  function setReactionBadge(show) {
    state.hasReactionNotice = !!show;
    ui.reactionBadge.classList.toggle("hidden", !state.hasReactionNotice);
  }

  function isMessageMineForCurrentUser(message) {
    const senderName = String(message?.sender?.name || "");
    const currentName = String(getCurrentUserName?.() || "");
    if (!senderName || !currentName) return !!message?.isMine;
    return nameKey(senderName) === nameKey(currentName);
  }

  function normalizeIncomingMessage(message) {
    if (!message || typeof message !== "object") return message;
    return {
      ...message,
      isMine: isMessageMineForCurrentUser(message),
      myReaction: Object.entries(message.reactionUsers || {}).find(([, users]) =>
        Array.isArray(users) && users.some((user) => nameKey(user.name) === nameKey(getCurrentUserName?.())),
      )?.[0] || null,
    };
  }

  function getUnreadMessageCount() {
    const lastReadId = Math.max(Number(state.lastReadMessageId) || 0, state.lastViewedMessageId);
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
      state.openReadAnchorMessageId = Math.max(Number(state.lastReadMessageId) || 0, state.lastViewedMessageId);
      state.restoreUnreadOnOpen = ui.scroll.atBottom();
      setReactionBadge(false);
    }
    if (!state.isOpen && wasOpen) {
      state.openReadAnchorMessageId = 0;
      const latestId = messageIdOf(state.messages[state.messages.length - 1]);
      if (latestId > 0 && ui.scroll.atBottom()) {
        void markMessagesRead(latestId);
      }
      ui.messagesEl.querySelector(".bb-chat-divider")?.remove();
      typing.stop();
    }
    ui.panel.classList.toggle("is-open", state.isOpen);
    ui.backdrop.classList.toggle("is-visible", state.isOpen);
    ui.launcher.classList.toggle("is-active", state.isOpen);
    if (!state.isOpen) closeViewersPopup();
    if (state.isOpen) {
      setUnreadBadge(0);
    }
  }

  function openMemberProfile(username) {
    if (typeof onOpenProfile !== "function") return;
    setOpen(false);
    onOpenProfile(username);
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

  const viewersPopup = createViewersPopup({
    getCurrentUserName,
    onOpenProfile: openMemberProfile,
    getFallbackFocus: () => (state.isOpen ? ui.textarea : null),
  });
  const closeViewersPopup = viewersPopup.close;
  const openViewersPopup = viewersPopup.open;

  const escapeHandler = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (viewersPopup.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      closeViewersPopup();
    } else if (state.isOpen) {
      event.preventDefault();
      setOpen(false);
    }
  };
  document.addEventListener("keydown", escapeHandler);

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

  async function markMessagesRead(lastMessageId) {
    const partyId = currentPartyId();
    const targetId = Number(lastMessageId) || 0;
    if (!partyId || targetId <= 0) return null;
    state.lastViewedMessageId = Math.max(state.lastViewedMessageId, targetId);
    syncUnreadBadge();
    if (targetId <= state.lastReadSentMessageId) return null;
    state.lastReadSentMessageId = targetId;
    try {
      const result = await postJson(API_PATHS.PARTY_CHAT_READ, {
        partyId,
        lastMessageId: targetId,
      });
      if (state.destroyed || partyId !== currentPartyId()) return null;
      const serverLastRead = Number(result?.lastReadMessageId) || targetId;
      state.lastReadMessageId = Math.max(
        state.lastReadMessageId || 0,
        serverLastRead,
      );
      syncUnreadBadge();
      return result;
    } catch (_) {
      if (partyId === currentPartyId() && state.lastReadSentMessageId === targetId) {
        state.lastReadSentMessageId = state.lastReadMessageId;
      }
      return null;
    }
  }

  function getMessageRow(messageId) {
    return ui.messagesEl.querySelector(`[data-message-id="${messageId}"]`);
  }

  function isScrolledNearBottom() {
    const { scrollTop, scrollHeight, clientHeight } = ui.messagesEl;
    return scrollHeight - (scrollTop + clientHeight) <= 24;
  }

  function replaceMessageMeta(row, message) {
    if (!row) return null;
    const replacement = renderPartyChatMessage(message, {
      currentUserName: getCurrentUserName?.(),
      onReply: setReplyTo,
      onReact: (target, reaction) => void reactToMessage(target?.id, reaction),
      onOpenViewers: openViewersPopup,
      onJumpToMessage: jumpToMessage,
      onOpenProfile: openMemberProfile,
      canReact: !isChatSuspended(),
      compact: false,
    });
    row.replaceWith(replacement);
    return replacement;
  }

  function upsertMessage(message, { forceScroll = false } = {}) {
    const messageId = messageIdOf(message);
    if (!messageId) return;
    const scrollSnapshot = ui.scroll.capture();
    state.messageMap.set(messageId, message);
    const index = state.messages.findIndex(
      (item) => messageIdOf(item) === messageId,
    );
    if (index >= 0) state.messages[index] = message;
    else state.messages.push(message);
    state.messages.sort((a, b) => messageIdOf(a) - messageIdOf(b));
    const removed = state.messages.splice(0, Math.max(0, state.messages.length - 100));
    for (const old of removed) {
      state.messageMap.delete(messageIdOf(old));
      getMessageRow(messageIdOf(old))?.remove();
    }

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
      onOpenProfile: openMemberProfile,
          canReact: !isChatSuspended(),
          compact: false,
        }),
      );
      ui.messagesEl.appendChild(fragment);
    }

    if (state.isOpen) ui.scroll.restore(scrollSnapshot, { force: forceScroll, added: index < 0 && !message.isMine ? 1 : 0 });
  }

  function rebuildMessages(messages = []) {
    const scrollSnapshot = ui.scroll.capture();
    const fragment = document.createDocumentFragment();
    state.messages = Array.isArray(messages) ? messages.slice(-100) : [];
    state.messageMap = new Map();
    ui.messagesEl.innerHTML = "";
    let dividerInserted = false;
    const timeline = [...state.messages, ...state.systemLogs.values()].sort((a, b) =>
      (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    for (const message of timeline) {
      if (message.system) {
        fragment.appendChild(renderSystemLog(message, getCurrentUserName?.()));
        continue;
      }
      const messageId = messageIdOf(message);
      if (
        state.isOpen &&
        !dividerInserted &&
        !isMessageMineForCurrentUser(message) &&
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
      onOpenProfile: openMemberProfile,
          canReact: !isChatSuspended(),
          compact: false,
        }),
      );
    }
    ui.messagesEl.appendChild(fragment);
    ui.scroll.restore(scrollSnapshot);
    if (state.isOpen && state.restoreUnreadOnOpen && state.messages.length) {
      state.restoreUnreadOnOpen = false;
      const unread = state.messages.filter(message => !isMessageMineForCurrentUser(message) && messageIdOf(message) > Math.max(state.lastReadMessageId, state.lastViewedMessageId));
      const first = unread[0] && getMessageRow(messageIdOf(unread[0]));
      if (first) {
        ui.messagesEl.scrollTop += first.getBoundingClientRect().top - ui.messagesEl.getBoundingClientRect().top - 32;
        ui.scroll.showPending(unread.length);
      }
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
    const request = ++state.historyRequest;
    const beforeRequest = new Map(state.messageMap);
    state.loading = true;
    try {
      const data = await postJson(API_PATHS.PARTY_CHAT_HISTORY, {
        partyId,
        limit: 80,
      });
      if (state.destroyed || partyId !== currentPartyId() || request !== state.historyRequest) return;
      for (const event of data?.systemLogs || []) rememberSystemLog(event);
      const serverLastReadMessageId = Number(data?.lastReadMessageId) || 0;
      state.partyId = partyId;
      const merged = new Map((data?.messages || []).map((message) => [messageIdOf(message), normalizeIncomingMessage(message)]));
      for (const message of state.messages) {
        if (beforeRequest.get(messageIdOf(message)) !== message) merged.set(messageIdOf(message), message);
      }
      state.messages = [...merged.values()].sort((a, b) => messageIdOf(a) - messageIdOf(b));
      state.messageMap = new Map(
        state.messages.map((message) => [messageIdOf(message), message]),
      );
      state.lastReadMessageId = Math.max(state.lastReadMessageId, serverLastReadMessageId);
      if (state.isOpen && !state.openReadAnchorMessageId) {
        state.openReadAnchorMessageId = serverLastReadMessageId;
      }
      renderMessages();
      if (state.isOpen && ui.scroll.atBottom()) {
        const latestId = messageIdOf(state.messages[state.messages.length - 1]);
        if (latestId > 0) void markMessagesRead(latestId);
      }
      if (!state.isOpen) {
        state.lastReadMessageId = Math.max(state.lastReadMessageId, Number(data?.lastReadMessageId) || 0);
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
    if (state.sending || cooldown.isActive()) return;
    if (!partyId || !body) return;
    state.sending = true;
    const draft = ui.textarea.value;
    const reply = state.replyTo;
    typing.stop();
    const payload = {
      partyId,
      body,
      replyToMessageId: state.replyTo?.id || null,
    };
    ui.sendBtn.disabled = true;
    try {
      const result = await postJson(API_PATHS.PARTY_CHAT_SEND, payload);
      if (state.destroyed || partyId !== currentPartyId()) return;
      if (ui.textarea.value === draft) ui.textarea.value = "";
      ui.resizeComposer();
      if (state.replyTo === reply) setReplyTo(null);
      const message = result?.message || null;
      if (message) {
        upsertMessage(message, { forceScroll: true });
      }
    } catch (error) {
      if (state.destroyed || partyId !== currentPartyId()) return;
      console.warn("[chat] send failed", error?.message || error);
      restrictions.handleError(error, "Message not sent");
    } finally {
      state.sending = false;
      if (!state.destroyed && !isChatSuspended() && !cooldown.isActive()) {
        ui.sendBtn.disabled = state.sending;
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
    if (cooldown.isActive()) return;
    if (!partyId || !messageId) return;
    try {
      await postJson(API_PATHS.PARTY_CHAT_REACT, {
        partyId,
        messageId,
        reaction,
      });
      // Socket event is the source of truth so all clients animate/resolve consistently.
    } catch (error) {
      console.warn("[chat] reaction failed", error?.message || error);
      restrictions.handleError(error, "Could not update reaction");
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
    typing.noteInput();
  });
  ui.textarea.addEventListener("blur", () => {
    typing.stop();
  });
  ui.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  });

  listen(SOCKET_EVENTS.PARTY_JOINED, ({ partyId }) => {
    presence.join(partyId);
    typing.stop();
    state.historyRequest++;
    state.messages = [];
    state.messageMap.clear();
    state.systemLogs.clear();
    state.lastViewedMessageId = 0;
    ui.scroll.reset();
    state.lastReadMessageId = 0;
    state.lastReadSentMessageId = 0;
    state.openReadAnchorMessageId = 0;
    setReplyTo(null);
    hideTypingIndicator();
    closeViewersPopup();
    state.partyId = Number(partyId) || null;
    renderMessages();
    if (state.partyId) void loadHistory();
    syncHeader();
    syncLobbyChatVisibility();
    if (!state.partyId) {
      setOpen(false);
      setUnreadBadge(0);
      setReactionBadge(false);
      typing.stop();
      state.messages = [];
      renderMessages();
      hideTypingIndicator();
      return;
    }
  });

  function rememberSystemLog(event) {
    if (!event?.id || !event?.body) return;
    state.systemLogs.set(event.id, { ...event, system: true });
    while (state.systemLogs.size > 100) state.systemLogs.delete(state.systemLogs.keys().next().value);
  }

  listen(SOCKET_EVENTS.PARTY_CHAT_SYSTEM, (payload = {}) => {
    if (Number(payload.partyId) !== currentPartyId()) return;
    rememberSystemLog(payload.event);
    if (state.isOpen) renderMessages();
  });

  listen(SOCKET_EVENTS.PARTY_CHAT_MESSAGE, (payload = {}) => {
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
      const appendAtBottom = state.isOpen && ui.scroll.atBottom();
      upsertMessage(nextMessage, { forceScroll: appendAtBottom });
      bubbles.show(message);
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

    if (state.isOpen && ui.scroll.atBottom()) {
      void markMessagesRead(incomingId);
    } else if (!message?.isMine && !isExistingMessageUpdate) {
      syncUnreadBadge();
    }
  });

  listen(SOCKET_EVENTS.PARTY_CHAT_READ, (payload = {}) => {
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
        return nameKey(viewer?.name) === nameKey(viewerName);
      });
      if (!viewerExists) {
        viewers.push({
          name: viewerName,
          userId: Number(payload?.viewerUserId) || null,
          charClass: resolveCharacterKey(payload?.viewerCharClass),
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

  listen(SOCKET_EVENTS.PARTY_CHAT_TYPING, (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (!partyId || partyId !== currentPartyId()) return;
    const now = Date.now();
    const typers = Array.isArray(payload?.typers) ? payload.typers : [];
    const currentName = String(getCurrentUserName?.() || "").trim();
    const next = new Map();
    for (const typer of typers) {
      const name = String(typer?.name || "").trim();
      if (!name) continue;
      if (currentName && nameKey(name) === nameKey(currentName)) continue;
      const userId = Number(typer?.userId) || 0;
      const key = userId > 0 ? `u:${userId}` : `n:${name.toLowerCase()}`;
      next.set(key, {
        userId: userId || null,
        name,
        charClass: resolveCharacterKey(typer?.charClass),
        profileIconId: String(typer?.profileIconId || "") || null,
        expiresAt: now + TYPING_STALE_MS,
      });
    }
    state.typingByUser = next;
    renderTypingIndicator();
  });

  listen(SOCKET_EVENTS.PARTY_MEMBERS, (payload = {}) => {
    if (!presence.roster(payload)) return;
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

  listen(SOCKET_EVENTS.STATUS_UPDATE, (payload = {}) => {
    if (presence.status(payload)) syncHeader();
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
    refresh: () => {
      const context = getPartyContextSnapshot();
      presence.join(context?.partyId);
      if (context) presence.roster(context);
      syncHeader();
      syncLobbyChatVisibility();
      if (currentPartyId()) void loadHistory();
    },
    open: () => { setOpen(true); void loadHistory(); },
    close: () => setOpen(false),
    destroy: () => {
      ui.destroyComposer();
      state.destroyed = true;
      document.removeEventListener("keydown", escapeHandler);
      for (const [event, handler] of socketListeners) socket?.off?.(event, handler);
      typing.stop();
      if (state.typingSweepTimer) {
        window.clearInterval(state.typingSweepTimer);
        state.typingSweepTimer = null;
      }
      cooldown.destroy();
      bubbles.destroy();
      ui.root.remove();
      ui.launcher.remove();
      viewersPopup.destroy();
    },
  };
}
