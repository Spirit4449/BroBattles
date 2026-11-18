import { formatBadgeCount } from "../chat/badges.mjs";
import { CHAT_BODY_MAX, nameKey } from "../../shared/social/textRules.js";
import { SOCKET_EVENTS } from "../../shared/net/socketEvents.js";
import { createChatScrollController } from "../chat/scrollController.mjs";
import { createViewersPopup } from "../chat/viewersPopup.js";
import { bindComposerAutosize } from "../chat/presentation";
import { sonner } from "../ui/sonner.js";
import { showUiConfirm } from "../ui/uiConfirm.js";
import { formatOnlineCount, friendPresenceLabel, friendPresenceTitle, isFriendOnline } from "./friendPresence.mjs";
import { pixelSprite } from "./pixelArt.js";
import { normalizePrivacy, onPrivacyChange } from "./privacyClient.js";
import { friendsApi, showFriendError } from "./friendsApi.js";
import { createFriendsRender } from "./friendsRender.js";
import { createFriendConversation } from "./friendConversation.js";

const ONLINE_BATCH_MS = 4000;

export function createFriendsPanelController({
  socket,
  getPartyContext,
  onOpenProfile,
  onOpen,
  waitForAccount = false,
} = {}) {
  const state = {
    isOpen: false,
    guest: waitForAccount ? null : false,
    loaded: false,
    view: "friends",
    me: null,
    friendCode: "",
    privacy: normalizePrivacy(),
    friends: [],
    incoming: [],
    outgoing: [],
    unread: {},
    suggestions: [],
    suggestionsLoading: false,
    chatFriendId: null,
    messages: [],
    hasMore: false,
    chatLoading: false,
    sending: false,
    friendTyping: false,
    friendTypingTimer: null,
    inviteCooldowns: {},
    // Friends who reacted to my messages while that chat wasn't in view.
    reactionFrom: new Set(),
    // Recent teammates who just came online, waiting to be announced.
    cameOnline: new Set(),
    cameOnlineTimer: null,
  };
  const onlineListeners = new Set();

  // Same drawer shell classes as the lobby chat so both slide in identically.
  const root = document.createElement("div");
  root.className = "bb-chat-root bb-chat-lobby-wrap bb-friends-wrap";
  const backdrop = document.createElement("div");
  backdrop.className = "bb-chat-drawer-backdrop";
  const panel = document.createElement("section");
  panel.className = "bb-chat-shell bb-chat-lobby-panel bb-friends-panel";
  panel.setAttribute("aria-label", "Friends");
  panel.innerHTML = `
    <div class="bb-chat-header">
      <button type="button" data-sound="cancel" data-volume="0.3" class="bb-chat-mini-btn bb-friends-back" aria-label="Back to friends" title="Back" hidden><span class="bb-friends-back-icon" aria-hidden="true"></span></button>
      <div class="bb-friends-chat-profile">
        <span class="bb-friends-avatar-wrap bb-friends-chat-avatar-wrap" hidden><img class="bb-friends-chat-avatar" alt="" /></span>
        <div class="bb-chat-heading">
          <h2 class="bb-chat-title">Friends</h2>
          <div class="bb-chat-header-status"><div class="bb-chat-subtitle" aria-live="polite"></div></div>
        </div>
      </div>
      <div class="bb-chat-header-actions">
        <button type="button" data-sound="cancel" data-volume="0.3" class="bb-chat-mini-btn bb-chat-close" aria-label="Close friends">×</button>
      </div>
    </div>
    <nav class="bb-friends-tabs" role="tablist">
      <button type="button" role="tab" data-view="friends">Friends<span class="bb-friends-tab-count" data-count="friends" hidden></span></button>
      <button type="button" role="tab" data-view="requests">Requests<span class="bb-friends-tab-count is-request" data-count="requests" hidden></span></button>
      <button type="button" role="tab" data-view="add">Add</button>
    </nav>
    <div class="bb-friends-content"></div>
    <div class="bb-chat-body bb-friends-chat" hidden>
      <div class="bb-chat-messages"></div>
      <div class="bb-chat-composer">
        <button type="button" class="bb-chat-jump-latest" hidden aria-label="Jump to latest messages"></button>
        <div class="bb-chat-input-row">
          <textarea class="bb-chat-textarea" rows="1" maxlength="${CHAT_BODY_MAX}" placeholder="Write a message..."></textarea>
          <button type="button" class="bb-chat-send">Send</button>
        </div>
      </div>
    </div>
  `;
  root.appendChild(backdrop);
  root.appendChild(panel);
  document.body.appendChild(root);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "bb-chat-button bb-chat-launcher bb-friends-launcher";
  launcher.setAttribute("aria-label", "Friends");
  launcher.innerHTML = `${pixelSprite("friends", 2, "bb-friends-launcher-icon")}<span class="bb-chat-launcher-label">Friends</span><span class="bb-chat-badge hidden"></span><span class="bb-chat-badge bb-friends-request-badge hidden"></span><span class="bb-friends-online-badge hidden"><span class="bb-friends-online-dot" aria-hidden="true"></span><span class="bb-friends-online-count"></span></span><span class="bb-chat-reaction-badge hidden" title="New reaction"><img src="/assets/heart-filled.svg" alt="" width="14" height="14" /></span>`;
  document.body.appendChild(launcher);

  // Pair with the chat launcher when it is visible, otherwise take its spot.
  const chatLauncher = document.querySelector(".bb-chat-lobby-launcher");
  function syncLauncherSlot() {
    const chatVisible = !!chatLauncher && chatLauncher.style.display !== "none";
    launcher.classList.toggle("is-paired", chatVisible);
    chatLauncher?.classList.toggle("has-friends-pair", chatVisible);
  }
  const launcherObserver = chatLauncher ? new MutationObserver(syncLauncherSlot) : null;
  launcherObserver?.observe(chatLauncher, { attributes: true, attributeFilter: ["style"] });
  syncLauncherSlot();

  // Close the drawer when matchmaking starts (the lobby hides its side UI).
  const bodyObserver = new MutationObserver(() => {
    if (state.isOpen && document.body.classList.contains("matchmaking-active")) setOpen(false);
  });
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  const ui = {
    title: panel.querySelector(".bb-chat-title"),
    chatAvatar: panel.querySelector(".bb-friends-chat-avatar"),
    chatAvatarWrap: panel.querySelector(".bb-friends-chat-avatar-wrap"),
    chatProfile: panel.querySelector(".bb-friends-chat-profile"),
    subtitle: panel.querySelector(".bb-chat-subtitle"),
    back: panel.querySelector(".bb-friends-back"),
    close: panel.querySelector(".bb-chat-close"),
    tabs: panel.querySelector(".bb-friends-tabs"),
    friendsTabCount: panel.querySelector('[data-count="friends"]'),
    requestsTabCount: panel.querySelector('[data-count="requests"]'),
    content: panel.querySelector(".bb-friends-content"),
    chat: panel.querySelector(".bb-friends-chat"),
    messages: panel.querySelector(".bb-friends-chat .bb-chat-messages"),
    textarea: panel.querySelector(".bb-friends-chat .bb-chat-textarea"),
    send: panel.querySelector(".bb-friends-chat .bb-chat-send"),
    badge: launcher.querySelector(".bb-chat-badge:not(.bb-friends-request-badge)"),
    requestBadge: launcher.querySelector(".bb-friends-request-badge"),
    heart: launcher.querySelector(".bb-chat-reaction-badge"),
    onlineBadge: launcher.querySelector(".bb-friends-online-badge"),
    onlineCount: launcher.querySelector(".bb-friends-online-count"),
  };
  // Same "Viewed by" popover as party chat.
  const viewersPopup = createViewersPopup({
    getCurrentUserName: () => state.me?.name || "",
    onOpenProfile: (name) => openProfile(name),
    getFallbackFocus: () => (state.isOpen && state.view === "chat" ? ui.textarea : null),
  });

  // Same composer growth and jump-to-latest behavior as party chat.
  const composerSize = bindComposerAutosize(ui.textarea);
  const chatScroll = createChatScrollController(
    ui.messages,
    panel.querySelector(".bb-friends-chat .bb-chat-composer"),
    panel.querySelector(".bb-friends-chat .bb-chat-jump-latest"),
  );

  const socketListeners = [];
  function listen(event, handler) {
    socket?.on?.(event, handler);
    socketListeners.push([event, handler]);
  }

  function currentPartyId() {
    return Number(getPartyContext?.()?.partyId) || 0;
  }

  function friendById(id) {
    return state.friends.find((f) => f.userId === Number(id)) || null;
  }

  function totalUnread() {
    return Object.values(state.unread).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }

  function setCount(el, count) {
    el.textContent = formatBadgeCount(count);
    el.hidden = count === 0;
  }

  function syncBadge() {
    // Red = unread messages, yellow = friend requests waiting on me.
    const unread = totalUnread();
    ui.badge.textContent = formatBadgeCount(unread);
    ui.badge.classList.toggle("hidden", unread === 0);
    const requests = state.incoming.length;
    ui.requestBadge.textContent = formatBadgeCount(requests);
    ui.requestBadge.classList.toggle("hidden", requests === 0);
    ui.requestBadge.title = requests === 1 ? "1 friend request" : `${requests} friend requests`;
    // Per-tab counts show where the launcher badge is coming from.
    setCount(ui.friendsTabCount, totalUnread());
    setCount(ui.requestsTabCount, state.incoming.length);
    // Heart on the launcher like party chat; cleared once the drawer opens.
    ui.heart.classList.toggle("hidden", !state.reactionFrom.size || state.isOpen);
    // Green marker: how many friends are online right now.
    const online = state.friends.filter(isFriendOnline).length;
    ui.onlineCount.textContent = formatOnlineCount(online);
    ui.onlineBadge.classList.toggle("hidden", online === 0);
    ui.onlineBadge.title = online === 1 ? "1 friend online" : `${online} friends online`;
    launcher.setAttribute("aria-label", online ? `Friends, ${online} online` : "Friends");
  }

  function announceCameOnline() {
    state.cameOnlineTimer = null;
    const friends = [...state.cameOnline].map(friendById).filter(isFriendOnline);
    state.cameOnline.clear();
    if (!friends.length) return;
    for (const listener of onlineListeners) {
      try { listener(friends); } catch (_) {}
    }
  }

  // ---------- data ----------
  async function refresh() {
    // Signing up reloads the page, so a guest stays a guest for this session.
    if (state.guest !== false) return;
    try {
      const data = await friendsApi.load();
      state.guest = false;
      state.me = data.me || null;
      state.friendCode = data.friendCode || "";
      state.privacy = normalizePrivacy(data.privacy);
      state.friends = Array.isArray(data.friends) ? data.friends : [];
      state.incoming = Array.isArray(data.incoming) ? data.incoming : [];
      state.outgoing = Array.isArray(data.outgoing) ? data.outgoing : [];
      state.unread = data.unread || {};
      if (state.chatFriendId) state.unread[state.chatFriendId] = 0;
      // The friend was removed while we were chatting with them.
      if (state.view === "chat" && !friendById(state.chatFriendId)) setView("friends");
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 401) state.guest = true;
      else console.warn("[friends] refresh failed", error?.message);
    }
    state.loaded = true;
    syncBadge();
    render();
  }

  async function loadSuggestions() {
    if (state.guest !== false) return;
    state.suggestionsLoading = true;
    render();
    try {
      const data = await friendsApi.suggestions();
      state.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    } catch (error) {
      state.suggestions = [];
    }
    state.suggestionsLoading = false;
    if (state.view === "add") render();
  }

  async function act(action, body, errorTitle) {
    try {
      return await action(body);
    } catch (error) {
      showFriendError(error, errorTitle);
      return null;
    }
  }

  async function sendRequest(target) {
    const result = await act(friendsApi.request, target, "Could not send friend request");
    if (!result) return null;
    const name = result.user?.name || "player";
    sonner(
      null,
      result.status === "accepted" ? `You and ${name} are now friends.` : `You sent ${name} a friend request.`,
      "OK",
      undefined,
      { tone: "success", duration: 3500 },
    );
    state.suggestions = state.suggestions.filter((s) => s.userId !== result.user?.userId);
    await refresh();
    return result;
  }

  // ---------- view switching ----------
  function setView(view, friendId = null) {
    if (state.view === "chat" && view !== "chat") {
      setLocalTyping(false);
      state.chatFriendId = null;
      state.messages = [];
      setFriendTyping(false);
    }
    state.view = view;
    if (view === "chat") {
      state.chatFriendId = Number(friendId);
      state.unread[state.chatFriendId] = 0;
      state.reactionFrom.delete(state.chatFriendId);
      chatScroll.reset();
      syncBadge();
      void loadConversation();
    }
    if (view === "add") void loadSuggestions();
    render();
    if (view === "chat") focusComposer();
  }

  // Ready to type as soon as a chat is on screen (same as party chat).
  function focusComposer() {
    if (!state.isOpen || state.view !== "chat") return;
    // Synchronous: the chat view is already unhidden by render().
    ui.textarea.focus({ preventScroll: true });
  }

  function setOpen(open) {
    state.isOpen = !!open;
    panel.classList.toggle("is-open", state.isOpen);
    backdrop.classList.toggle("is-visible", state.isOpen);
    launcher.classList.toggle("is-active", state.isOpen);
    syncBadge();
    if (state.isOpen) {
      onOpen?.();
      void refresh();
      if (state.view === "chat") {
        void markRead();
        focusComposer();
      }
      if (state.view === "add") void loadSuggestions();
    } else {
      setLocalTyping(false);
      viewersPopup.close();
    }
  }

  // Clicking the avatar or the name opens the player's profile.
  // With onClick the whole card is the target and only the avatar opens the profile.

  // Disabled with a countdown while the server's invite cooldown runs.

  // Friend read my messages: flip receipts in place without moving the scroll.

  // Swap one row in place so reacting doesn't jump the scroll position.

  // Rebuilds the log; keeps the reader's place unless forced to the bottom.

  // Header status line; "Typing" replaces the presence while the friend types.

  function openProfile(username) {
    if (typeof onOpenProfile !== "function") return;
    setOpen(false);
    onOpenProfile(username);
  }

  const conversation = createFriendConversation({
    state, ui, socket, viewersPopup, chatScroll, composerSize, openProfile,
    friendById, focusComposer, syncBadge,
  });
  const {
    loadConversation, markRead, sendMessage, setLocalTyping, setFriendTyping,
    syncChatStatus, appendMessage, upsertMessage, applyFriendRead, destroyTyping,
  } = conversation;
  const renderer = createFriendsRender({
    state, ui, panel, currentPartyId, openProfile, setView, act, refresh, sendRequest,
    friendById, syncChatStatus,
  });
  const { render } = renderer;

  // ---------- events ----------
  launcher.addEventListener("click", () => setOpen(!state.isOpen));
  backdrop.addEventListener("click", () => setOpen(false));
  ui.close.addEventListener("click", () => setOpen(false));
  ui.back.addEventListener("click", () => setView("friends"));
  // Chat header avatar and name open the friend's profile.
  const openChatProfile = () => {
    const friend = state.view === "chat" ? friendById(state.chatFriendId) : null;
    if (friend) openProfile(friend.name);
  };
  ui.chatProfile.addEventListener("click", openChatProfile);
  ui.chatProfile.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openChatProfile();
  });
  ui.tabs.addEventListener("click", (event) => {
    const view = event.target.closest("[data-view]")?.dataset.view;
    if (view) setView(view);
  });
  ui.send.addEventListener("click", () => void sendMessage());
  ui.textarea.addEventListener("input", () => setLocalTyping(true));
  ui.textarea.addEventListener("blur", () => setLocalTyping(false));
  ui.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  });

  listen(SOCKET_EVENTS.FRIENDS_CHANGED, () => {
    void refresh();
    if (state.view === "add" && state.isOpen) void loadSuggestions();
  });

  listen(SOCKET_EVENTS.FRIENDS_REQUEST, ({ from } = {}) => {
    sonner(null, `${from?.name || "Someone"} sent you a friend request.`, "View", (close) => {
      close();
      setOpen(true);
      setView("requests");
    }, { duration: 8000, sound: "notification" });
  });

  listen(SOCKET_EVENTS.FRIENDS_PRESENCE, ({ userId, status, lastSeenAt, lastSeenHidden } = {}) => {
    const friend = friendById(userId);
    if (!friend) return;
    const wasOnline = isFriendOnline(friend);
    friend.status = status;
    if (!wasOnline && isFriendOnline(friend) && friend.gamesTogether > 0) {
      state.cameOnline.add(friend.userId);
      window.clearTimeout(state.cameOnlineTimer);
      state.cameOnlineTimer = window.setTimeout(announceCameOnline, ONLINE_BATCH_MS);
    }
    syncBadge();
    if (lastSeenAt !== undefined) friend.lastSeenAt = lastSeenAt;
    if (lastSeenHidden !== undefined) friend.lastSeenHidden = !!lastSeenHidden;
    if (state.isOpen) render();
  });

  listen(SOCKET_EVENTS.FRIENDS_MESSAGE, ({ message } = {}) => {
    if (!message) return;
    const mine = message.senderId === state.me?.userId;
    const otherId = mine ? message.recipientId : message.senderId;
    if (state.view === "chat" && state.chatFriendId === otherId) {
      appendMessage(message);
      if (!mine) {
        setFriendTyping(false);
        if (state.isOpen) void markRead();
        else {
          state.unread[otherId] = (Number(state.unread[otherId]) || 0) + 1;
          syncBadge();
        }
      }
      return;
    }
    if (mine) return;
    state.unread[otherId] = (Number(state.unread[otherId]) || 0) + 1;
    syncBadge();
    if (state.isOpen && state.view === "friends") render();
  });

  listen(SOCKET_EVENTS.FRIENDS_REACTION, ({ message, reactorId, reaction, added } = {}) => {
    if (!message) return;
    const me = state.me?.userId;
    const mine = message.senderId === me;
    const otherId = mine ? message.recipientId : message.senderId;
    const viewing = state.view === "chat" && otherId === state.chatFriendId;
    if (viewing) upsertMessage(message, { pulse: reactorId !== me && added ? reaction : null });
    // Heart notice when a friend reacts to my message somewhere I can't see it.
    if (added && mine && reactorId !== me && !(viewing && state.isOpen)) {
      state.reactionFrom.add(otherId);
      syncBadge();
      if (state.isOpen && state.view === "friends") render();
    }
  });

  // Reading in another tab clears the badge here too.
  listen(SOCKET_EVENTS.FRIENDS_READ, ({ readerId, friendId, upToMessageId, readAt } = {}) => {
    if (readerId === state.chatFriendId && state.view === "chat") {
      applyFriendRead(Number(upToMessageId) || Infinity, readAt || new Date().toISOString());
      return;
    }
    if (readerId !== state.me?.userId || !friendId) return;
    state.unread[friendId] = 0;
    syncBadge();
    if (state.isOpen && state.view === "friends") render();
  });

  listen(SOCKET_EVENTS.FRIENDS_TYPING, ({ userId, isTyping } = {}) => {
    if (state.view !== "chat" || Number(userId) !== state.chatFriendId) return;
    setFriendTyping(!!isTyping);
  });

  listen(SOCKET_EVENTS.FRIENDS_PARTY_INVITE, ({ partyId, from } = {}) => {
    if (!partyId || Number(partyId) === currentPartyId()) return;
    sonner(null, `${from?.name || "A friend"} invited you to their party.`, "Join", (close) => {
      close();
      window.location.href = `/party/${Number(partyId)}`;
    }, { duration: 15000, sound: "notification" });
  });

  // Saved here, in Settings, or in another tab.
  function applyPrivacy(privacy) {
    state.privacy = normalizePrivacy(privacy);
    if (state.isOpen && state.view === "add") render();
  }
  const offPrivacy = onPrivacyChange(applyPrivacy);
  listen(SOCKET_EVENTS.FRIENDS_PRIVACY, ({ privacy } = {}) => applyPrivacy(privacy));

  // Socket reconnects can miss pushes, so resync.
  listen(SOCKET_EVENTS.CONNECT, () => void refresh());

  // Refresh relative times without rebuilding rows or disturbing chat scroll/focus.
  const presenceTimer = window.setInterval(() => {
    if (!state.isOpen) return;
    for (const label of ui.content.querySelectorAll("[data-friend-presence-id]")) {
      const friend = friendById(Number(label.dataset.friendPresenceId));
      if (friend) {
        label.textContent = friendPresenceLabel(friend);
        label.title = friendPresenceTitle(friend);
      }
    }
    if (state.view === "chat") {
      const friend = friendById(state.chatFriendId);
      if (friend) syncChatStatus();
    }
  }, 30_000);

  void refresh();

  return {
    open: (view) => {
      setOpen(true);
      if (view) setView(view);
    },
    close: () => setOpen(false),
    isOpen: () => state.isOpen,
    refresh,
    setAccountGuest(isGuest) {
      state.guest = isGuest;
      if (!isGuest) return refresh();
      state.loaded = true;
      syncBadge();
      render();
    },
    isGuest: () => state.guest === true,
    // Used by the party slot menu and profile modal.
    relationshipFor(name) {
      const key = nameKey(name);
      if (!key || state.guest !== false) return "unavailable";
      if (nameKey(state.me?.name) === key) return "self";
      if (state.friends.some((f) => nameKey(f.name) === key)) return "friends";
      if (state.outgoing.some((r) => nameKey(r.user.name) === key)) return "outgoing";
      if (state.incoming.some((r) => nameKey(r.user.name) === key)) return "incoming";
      return "none";
    },
    addFriend: (target) => sendRequest(target),
    // Profile modal: asks first, resolves true once removed.
    async removeFriend(name) {
      const key = nameKey(name);
      const friend = state.friends.find((f) => nameKey(f.name) === key);
      if (!friend) return false;
      const ok = await showUiConfirm({
        title: "Remove friend",
        message: `Remove ${friend.name} from your friends?`,
        confirmLabel: "Remove",
      });
      if (!ok || !(await act(friendsApi.remove, { friendId: friend.userId }, "Could not remove friend"))) return false;
      await refresh();
      return true;
    },
    // Called with recent teammates who just came online, batched.
    onFriendsOnline(listener) {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    destroy() {
      window.clearInterval(presenceTimer);
      window.clearTimeout(state.cameOnlineTimer);
      onlineListeners.clear();
      offPrivacy();
      for (const [event, handler] of socketListeners) socket?.off?.(event, handler);
      window.clearTimeout(state.friendTypingTimer);
      destroyTyping();
      renderer.destroy();
      launcherObserver?.disconnect();
      composerSize.destroy();
      viewersPopup.destroy();
      chatScroll.destroy();
      bodyObserver.disconnect();
      root.remove();
      launcher.remove();
    },
  };
}
