import { createLocalTypingEmitter, TYPING_STALE_MS } from "../chat/typingTracker.js";
import { summarizeDirectReactions } from "../chat/reactions.js";
import { SOCKET_EVENTS } from "../../shared/net/socketEvents.js";
import { renderPartyChatMessage } from "../chat/presentation";
import { friendPresenceLabel, friendPresenceTitle } from "./friendPresence.mjs";
import { pixelSprite } from "./pixelArt.js";
import { friendsApi, showFriendError } from "./friendsApi.js";
import { emptyArt, loading, statusClass, textButton } from "./friendsRender.js";

const TYPING_STOP_MS = 1500;

export function createFriendConversation({
  state, ui, socket, viewersPopup, chatScroll, composerSize, openProfile, friendById, focusComposer, syncBadge
}) {
  function toChatMessage(m) {
    const mine = m.senderId === state.me?.userId;
    const friend = friendById(state.chatFriendId);
    const sender = mine
      ? { name: state.me?.name || "You", charClass: state.me?.charClass, profileIconId: state.me?.profileIconId || null }
      : { name: friend?.name || "Friend", charClass: friend?.charClass, profileIconId: friend?.profileIconId };
    return {
      id: m.messageId,
      sender,
      body: m.body,
      createdAt: m.createdAt,
      ...summarizeDirectReactions(m.reactions, state.me?.userId),
      _reactionPulse: m._reactionPulse || null,
      // Read receipt: in a 1:1 chat the only possible viewer is the friend.
      viewCount: mine && m.readAt ? 1 : 0,
      viewers: mine && m.readAt
        ? [{ userId: friend?.userId, name: friend?.name || "Friend", charClass: friend?.charClass, profileIconId: friend?.profileIconId, readAt: m.readAt }]
        : [],
    };
  }

  function renderMessageRow(m) {
    return renderPartyChatMessage(toChatMessage(m), {
      currentUserName: state.me?.name,
      onOpenProfile: openProfile,
      onReact: (target, reaction) => void reactToMessage(target?.id, reaction),
      onOpenViewers: (message, anchor) => viewersPopup.open(message, anchor),
      showReply: false,
      // Receipts only matter on messages I sent.
      showViewCount: m.senderId === state.me?.userId,
    });
  }

  function applyFriendRead(upToMessageId, readAt) {
    for (const m of state.messages) {
      if (m.senderId !== state.me?.userId || m.readAt || m.messageId > upToMessageId) continue;
      upsertMessage({ ...m, readAt });
    }
  }

  function upsertMessage(next, { pulse = null } = {}) {
    const index = state.messages.findIndex((m) => m.messageId === next.messageId);
    if (index < 0) return false;
    state.messages[index] = { ...next, _reactionPulse: pulse };
    const row = ui.messages.querySelector(`[data-message-id="${next.messageId}"]`);
    row?.replaceWith(renderMessageRow(state.messages[index]));
    // Pop once; later full re-renders shouldn't replay it.
    state.messages[index]._reactionPulse = null;
    return true;
  }

  async function reactToMessage(messageId, reaction) {
    if (!messageId) return;
    try {
      const data = await friendsApi.react({ messageId, reaction });
      if (data.message) upsertMessage(data.message, { pulse: reaction });
    } catch (error) {
      showFriendError(error, "Could not update reaction");
    }
  }

  function renderMessages({ force = true, snapshot = null } = {}) {
    const snap = snapshot || chatScroll.capture();
    ui.messages.replaceChildren();
    if (state.chatLoading && !state.messages.length) ui.messages.appendChild(loading());
    else if (!state.messages.length) {
      ui.messages.appendChild(emptyArt(pixelSprite("chat", 5, "bb-friends-float"), "Say hi!", "Messages are saved so you can pick up later."));
    }
    if (state.hasMore) {
      ui.messages.appendChild(textButton("Load older", "bb-friends-older", () => void loadConversation({ older: true })));
    }
    for (const m of state.messages) ui.messages.appendChild(renderMessageRow(m));
    chatScroll.restore(snap, { force });
  }

  function appendMessage(message) {
    if (state.messages.some((m) => m.messageId === message.messageId)) return;
    const mine = message.senderId === state.me?.userId;
    const snap = chatScroll.capture();
    state.messages.push(message);
    // The first message replaces the empty-state art.
    if (state.messages.length === 1) return renderMessages();
    ui.messages.appendChild(renderMessageRow(message));
    chatScroll.restore(snap, { force: mine, added: mine ? 0 : 1 });
  }

  function syncChatStatus() {
    const friend = friendById(state.chatFriendId);
    if (state.friendTyping) {
      ui.subtitle.innerHTML = `<span class="bb-chat-typing-dot" aria-hidden="true"></span>Typing`;
      ui.subtitle.title = `${friend?.name || "Friend"} is typing`;
      ui.subtitle.className = "bb-chat-subtitle is-typing";
      return;
    }
    ui.subtitle.textContent = friendPresenceLabel(friend);
    ui.subtitle.title = friendPresenceTitle(friend);
    ui.subtitle.className = `bb-chat-subtitle ${statusClass(friend?.status)}`;
  }

  async function loadConversation({ older = false } = {}) {
    const friendId = state.chatFriendId;
    if (!friendId) return;
    state.chatLoading = true;
    if (!older) {
      state.messages = [];
      renderMessages();
    }
    const snapshot = chatScroll.capture();
    try {
      const data = await friendsApi.history({
        friendId,
        beforeMessageId: older ? state.messages[0]?.messageId : undefined,
      });
      if (state.chatFriendId !== friendId) return;
      const incoming = Array.isArray(data.messages) ? data.messages : [];
      state.messages = older ? [...incoming, ...state.messages] : incoming;
      state.hasMore = !!data.hasMore;
    } catch (error) {
      showFriendError(error, "Could not load messages");
    }
    state.chatLoading = false;
    renderMessages({ force: !older, snapshot });
    if (!older && state.isOpen) {
      void markRead();
      focusComposer();
    }
  }

  async function markRead() {
    const friendId = state.chatFriendId;
    if (!friendId) return;
    state.unread[friendId] = 0;
    syncBadge();
    try { await friendsApi.read({ friendId }); } catch (_) {}
  }

  async function sendMessage() {
    const body = ui.textarea.value.trim();
    const friendId = state.chatFriendId;
    if (!body || !friendId || state.sending) return;
    state.sending = true;
    ui.send.disabled = true;
    try {
      const data = await friendsApi.send({ friendId, body });
      ui.textarea.value = "";
      composerSize.resize();
      setLocalTyping(false);
      // The socket echo may arrive first; appendMessage dedupes by id.
      if (data.message) appendMessage(data.message);
    } catch (error) {
      showFriendError(error, "Message not sent");
    }
    state.sending = false;
    ui.send.disabled = false;
    ui.textarea.focus();
  }

  const typing = createLocalTypingEmitter({
    emit: isTyping => {
      if (state.chatFriendId) socket?.emit?.(SOCKET_EVENTS.FRIENDS_TYPING, {
        friendId: state.chatFriendId, isTyping,
      });
    },
    idleMs: TYPING_STOP_MS,
    heartbeatMs: 1000,
  });

  function setLocalTyping(isTyping) {
    if (isTyping && state.chatFriendId) typing.noteInput();
    else typing.stop();
  }

  function setFriendTyping(isTyping) {
    window.clearTimeout(state.friendTypingTimer);
    state.friendTyping = isTyping;
    if (state.view === "chat") syncChatStatus();
    if (isTyping) state.friendTypingTimer = window.setTimeout(() => setFriendTyping(false), TYPING_STALE_MS);
  }

  return { loadConversation, markRead, sendMessage, setLocalTyping, setFriendTyping, syncChatStatus, appendMessage, upsertMessage, applyFriendRead, destroyTyping: typing.destroy };
}
