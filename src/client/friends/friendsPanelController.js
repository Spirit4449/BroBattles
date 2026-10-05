import { createChatScrollController } from "../chat/scrollController.mjs";
import { createViewersPopup } from "../chat/viewersPopup.js";
import {
  bindComposerAutosize,
  bindChatProfile,
  buildAvatarUrl,
  escapeHtml,
  postJson,
  renderPartyChatMessage,
  showChatRequestError,
} from "../chat/presentation";
import { sonner } from "../ui/sonner.js";
import { showUiConfirm } from "../ui/uiConfirm.js";
import { pixelSprite } from "./pixelArt.js";

const TYPING_STOP_MS = 1500;
const TYPING_STALE_MS = 4000;
const STATUS_ORDER = { online: 0, "End Screen": 1, "In Battle": 2, offline: 3 };

// Never show raw network/server wording to players.
function showFriendError(error, title) {
  showChatRequestError(error, title);
}

function formatCooldown(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
}

async function getJson(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "Something went wrong. Please try again.");
    error.statusCode = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function statusLabel(status) {
  if (status === "In Battle") return "In Battle";
  if (status === "End Screen") return "Finishing match";
  return status === "online" ? "Online" : "Offline";
}

function statusClass(status) {
  if (status === "online") return "is-online";
  if (status === "In Battle" || status === "End Screen") return "is-battle";
  return "is-offline";
}

export function createFriendsPanelController({
  socket,
  getPartyContext,
  onOpenProfile,
  onOpen,
} = {}) {
  const state = {
    isOpen: false,
    guest: false,
    loaded: false,
    view: "friends",
    me: null,
    friendCode: "",
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
    localTyping: false,
    localTypingTimer: null,
    lastTypingEmitAt: 0,
    inviteCooldowns: {},
    // Friends who reacted to my messages while that chat wasn't in view.
    reactionFrom: new Set(),
  };

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
      <button type="button" data-sound="cancel" data-volume="0.3" class="bb-chat-mini-btn bb-friends-back" aria-label="Back to friends" title="Back" hidden>${pixelSprite("back", 2)}</button>
      <div class="bb-chat-heading">
        <h2 class="bb-chat-title">Friends</h2>
        <div class="bb-chat-header-status"><div class="bb-chat-subtitle"></div></div>
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
        <div class="bb-chat-typing is-idle" aria-live="polite">
          <div class="bb-chat-typing-label">
            <span class="bb-chat-typing-text"></span>
            <span class="bb-chat-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </div>
        </div>
        <button type="button" class="bb-chat-jump-latest" hidden aria-label="Jump to latest messages">↓</button>
        <div class="bb-chat-input-row">
          <textarea class="bb-chat-textarea" rows="1" maxlength="500" placeholder="Write a message..."></textarea>
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
  launcher.innerHTML = `${pixelSprite("friends", 2, "bb-friends-launcher-icon")}<span class="bb-chat-launcher-label">Friends</span><span class="bb-chat-badge hidden"></span><span class="bb-chat-badge bb-friends-request-badge hidden"></span><span class="bb-chat-reaction-badge hidden" title="New reaction"><img src="/assets/heart-filled.svg" alt="" width="14" height="14" /></span>`;
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
    subtitle: panel.querySelector(".bb-chat-subtitle"),
    back: panel.querySelector(".bb-friends-back"),
    close: panel.querySelector(".bb-chat-close"),
    tabs: panel.querySelector(".bb-friends-tabs"),
    friendsTabCount: panel.querySelector('[data-count="friends"]'),
    requestsTabCount: panel.querySelector('[data-count="requests"]'),
    content: panel.querySelector(".bb-friends-content"),
    chat: panel.querySelector(".bb-friends-chat"),
    messages: panel.querySelector(".bb-friends-chat .bb-chat-messages"),
    typing: panel.querySelector(".bb-friends-chat .bb-chat-typing"),
    typingText: panel.querySelector(".bb-friends-chat .bb-chat-typing-text"),
    textarea: panel.querySelector(".bb-friends-chat .bb-chat-textarea"),
    send: panel.querySelector(".bb-friends-chat .bb-chat-send"),
    badge: launcher.querySelector(".bb-chat-badge:not(.bb-friends-request-badge)"),
    requestBadge: launcher.querySelector(".bb-friends-request-badge"),
    heart: launcher.querySelector(".bb-chat-reaction-badge"),
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
    el.textContent = count > 99 ? "99+" : String(count);
    el.hidden = count === 0;
  }

  function syncBadge() {
    // Red = unread messages, yellow = friend requests waiting on me.
    const unread = totalUnread();
    ui.badge.textContent = unread > 99 ? "99+" : String(unread);
    ui.badge.classList.toggle("hidden", unread === 0);
    const requests = state.incoming.length;
    ui.requestBadge.textContent = requests > 99 ? "99+" : String(requests);
    ui.requestBadge.classList.toggle("hidden", requests === 0);
    ui.requestBadge.title = requests === 1 ? "1 friend request" : `${requests} friend requests`;
    // Per-tab counts show where the launcher badge is coming from.
    setCount(ui.friendsTabCount, totalUnread());
    setCount(ui.requestsTabCount, state.incoming.length);
    // Heart on the launcher like party chat; cleared once the drawer opens.
    ui.heart.classList.toggle("hidden", !state.reactionFrom.size || state.isOpen);
  }

  // ---------- data ----------
  async function refresh() {
    // Signing up reloads the page, so a guest stays a guest for this session.
    if (state.guest) return;
    try {
      const data = await getJson("/friends");
      state.guest = false;
      state.me = data.me || null;
      state.friendCode = data.friendCode || "";
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
    if (state.guest) return;
    state.suggestionsLoading = true;
    render();
    try {
      const data = await getJson("/friends/suggestions");
      state.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    } catch (error) {
      state.suggestions = [];
    }
    state.suggestionsLoading = false;
    if (state.view === "add") render();
  }

  async function act(url, body, errorTitle) {
    try {
      return await postJson(url, body);
    } catch (error) {
      showFriendError(error, errorTitle);
      return null;
    }
  }

  async function sendRequest(target) {
    const result = await act("/friends/request", target, "Could not send friend request");
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

  // ---------- rendering ----------
  function iconButton(sprite, label, className, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bb-friends-icon-btn ${className || ""}`.trim();
    b.innerHTML = pixelSprite(sprite, 2);
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(event);
    });
    return b;
  }

  function textButton(label, className, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bb-friends-btn ${className || ""}`.trim();
    b.textContent = label;
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(event);
    });
    return b;
  }

  // Clicking the avatar or the name opens the player's profile.
  function userRow(user, { subtitle, actions = [], dot = true, subtitleClass = "" } = {}) {
    const row = document.createElement("div");
    row.className = "bb-friends-row";
    const av = document.createElement("div");
    av.className = `bb-friends-avatar-wrap ${dot ? statusClass(user.status) : ""}`;
    const img = document.createElement("img");
    img.className = "bb-friends-avatar";
    img.src = buildAvatarUrl(user.charClass, user.profileIconId);
    img.alt = "";
    img.loading = "lazy";
    av.appendChild(img);
    bindChatProfile(av, user.name, openProfile);
    const text = document.createElement("div");
    text.className = "bb-friends-text";
    text.innerHTML = `<div class="bb-friends-name">${escapeHtml(user.name)}</div><div class="bb-friends-sub ${subtitleClass}">${escapeHtml(subtitle ?? statusLabel(user.status))}</div>`;
    bindChatProfile(text.querySelector(".bb-friends-name"), user.name, openProfile);
    const actionsEl = document.createElement("div");
    actionsEl.className = "bb-friends-actions";
    for (const action of actions) if (action) actionsEl.appendChild(action);
    row.append(av, text, actionsEl);
    return row;
  }

  function section(title) {
    const h = document.createElement("h3");
    h.className = "bb-friends-section";
    h.textContent = title;
    return h;
  }

  function emptyArt(art, title, text) {
    const wrap = document.createElement("div");
    wrap.className = "bb-friends-empty-art";
    wrap.innerHTML = `<div class="bb-friends-empty-sprite">${art}</div><div class="bb-friends-empty-title">${escapeHtml(title)}</div>${text ? `<p>${escapeHtml(text)}</p>` : ""}`;
    return wrap;
  }

  function loading() {
    const p = document.createElement("p");
    p.className = "bb-friends-loading";
    p.textContent = "Loading";
    return p;
  }

  function renderGuest() {
    const wrap = emptyArt(
      `${pixelSprite("heart", 4, "bb-friends-float")}${pixelSprite("friends", 6)}`,
      "Friends",
      "Create an account to add friends, chat, and invite them to your party.",
    );
    const link = document.createElement("a");
    link.className = "bb-friends-btn is-primary";
    link.href = "/signup";
    link.textContent = "Sign up";
    wrap.appendChild(link);
    ui.content.appendChild(wrap);
  }

  function setInviteCooldown(friendId, untilMs) {
    const until = Number(untilMs) || 0;
    if (until <= Date.now()) {
      delete state.inviteCooldowns[friendId];
      return;
    }
    state.inviteCooldowns[friendId] = until;
  }

  async function inviteFriend(friend) {
    try {
      const result = await postJson("/friends/party-invite", { friendId: friend.userId });
      setInviteCooldown(friend.userId, result.cooldownUntilMs);
      sonner(null, `You invited ${friend.name} to your party.`, "OK", undefined, { tone: "success", duration: 3000 });
    } catch (error) {
      setInviteCooldown(friend.userId, error?.payload?.cooldownUntilMs);
      showFriendError(error, "Could not invite friend");
    }
    render();
  }

  // Disabled with a countdown while the server's invite cooldown runs.
  function inviteButton(friend) {
    const remaining = (state.inviteCooldowns[friend.userId] || 0) - Date.now();
    const coolingDown = remaining > 0;
    const btn = iconButton(
      "invite",
      coolingDown ? `You can invite ${friend.name} again in ${formatCooldown(remaining)}` : `Invite ${friend.name} to your party`,
      "is-invite",
      async () => {
        btn.disabled = true;
        await inviteFriend(friend);
      },
    );
    if (coolingDown) {
      btn.disabled = true;
      btn.classList.add("is-cooling");
      const timer = document.createElement("span");
      timer.className = "bb-friends-cooldown";
      timer.textContent = formatCooldown(remaining);
      btn.appendChild(timer);
      scheduleCooldownTick();
    }
    return btn;
  }

  let cooldownTick = 0;
  function scheduleCooldownTick() {
    if (cooldownTick) return;
    cooldownTick = window.setTimeout(() => {
      cooldownTick = 0;
      if (state.isOpen && state.view === "friends") render();
    }, 1000);
  }

  async function confirmRemove(friend) {
    const ok = await showUiConfirm({
      title: "Remove friend",
      message: `Remove ${friend.name} from your friends?`,
      confirmLabel: "Remove",
    });
    if (ok && (await act("/friends/remove", { friendId: friend.userId }, "Could not remove friend"))) await refresh();
  }

  function renderFriends() {
    if (!state.friends.length) {
      const wrap = emptyArt(
        `${pixelSprite("heart", 4, "bb-friends-float")}${pixelSprite("friends", 6)}`,
        "No friends yet",
        "Share your friend code or add players you've battled with.",
      );
      wrap.appendChild(textButton("Add friends", "is-primary", () => setView("add")));
      ui.content.appendChild(wrap);
      return;
    }
    const sorted = [...state.friends].sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.name.localeCompare(b.name),
    );
    const online = sorted.filter((f) => f.status !== "offline");
    const offline = sorted.filter((f) => f.status === "offline");
    const inParty = currentPartyId() > 0;
    const addRows = (list) => {
      for (const friend of list) {
        const unread = Number(state.unread[friend.userId]) || 0;
        const chat = iconButton("chat", `Chat with ${friend.name}`, "is-chat", () => setView("chat", friend.userId));
        if (state.reactionFrom.has(friend.userId)) {
          const heart = document.createElement("span");
          heart.className = "bb-friends-heart";
          heart.title = `${friend.name} reacted to your message`;
          heart.innerHTML = `<img src="/assets/heart-filled.svg" alt="" width="10" height="10" />`;
          chat.appendChild(heart);
        }
        if (unread) {
          const dot = document.createElement("span");
          dot.className = "bb-friends-unread";
          dot.textContent = unread > 9 ? "9+" : String(unread);
          chat.appendChild(dot);
        }
        const invite = inParty && friend.status === "online"
          ? inviteButton(friend)
          : null;
        const remove = iconButton("trash", `Remove ${friend.name}`, "is-danger", () => void confirmRemove(friend));
        ui.content.appendChild(userRow(friend, {
          subtitleClass: statusClass(friend.status),
          actions: [invite, chat, remove],
        }));
      }
    };
    if (online.length) {
      ui.content.appendChild(section(`Online ${online.length}`));
      addRows(online);
    }
    if (offline.length) {
      ui.content.appendChild(section(`Offline ${offline.length}`));
      addRows(offline);
    }
  }

  function renderRequests() {
    if (!state.incoming.length && !state.outgoing.length) {
      ui.content.appendChild(emptyArt(
        pixelSprite("envelope", 5, "bb-friends-float"),
        "No requests",
        "Friend requests you send or receive show up here.",
      ));
      return;
    }
    for (const req of state.incoming) {
      ui.content.appendChild(userRow(req.user, {
        subtitle: "Wants to be friends",
        subtitleClass: "is-incoming",
        dot: false,
        actions: [
          iconButton("check", `Accept ${req.user.name}`, "is-accept", async (event) => {
            event.currentTarget.disabled = true;
            if (await act("/friends/respond", { requestId: req.requestId, accept: true }, "Could not update friend request")) await refresh();
          }),
          iconButton("cross", `Decline ${req.user.name}`, "is-danger", async (event) => {
            event.currentTarget.disabled = true;
            if (await act("/friends/respond", { requestId: req.requestId, accept: false }, "Could not update friend request")) await refresh();
          }),
        ],
      }));
    }
    // Sent requests: status reads under the name; one quiet Cancel action.
    for (const req of state.outgoing) {
      ui.content.appendChild(userRow(req.user, {
        subtitle: "Pending",
        subtitleClass: "is-pending",
        dot: false,
        actions: [
          textButton("Cancel", "is-quiet", async (event) => {
            event.currentTarget.disabled = true;
            if (await act("/friends/cancel", { requestId: req.requestId }, "Could not update friend request")) await refresh();
          }),
        ],
      }));
    }
  }

  function renderAdd() {
    const code = document.createElement("div");
    code.className = "bb-friends-code";
    code.innerHTML = `<div><div class="bb-friends-sub">Your friend code</div><div class="bb-friends-code-value">${escapeHtml(state.friendCode || "...")}</div></div>`;
    code.appendChild(textButton("Copy", "", async (event) => {
      const btn = event.currentTarget;
      try {
        await navigator.clipboard.writeText(state.friendCode);
        btn.textContent = "Copied";
      } catch (_) {
        btn.textContent = "Couldn't copy";
      }
      window.setTimeout(() => { btn.textContent = "Copy"; }, 1600);
    }));
    ui.content.appendChild(code);

    // Not a <form>, and a search-type input, so password managers leave it alone.
    const addRow = document.createElement("div");
    addRow.className = "bb-friends-add-form";
    addRow.innerHTML = `<input type="search" name="bb-friend-lookup" maxlength="50" placeholder="Code or username" aria-label="Friend code or username" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" />`;
    const input = addRow.querySelector("input");
    const submit = textButton("Add", "is-primary", () => void submitAdd());
    addRow.appendChild(submit);
    async function submitAdd() {
      const query = input.value.trim();
      if (!query || submit.disabled) return;
      submit.disabled = true;
      const result = await sendRequest({ query });
      submit.disabled = false;
      if (result) input.value = "";
    }
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void submitAdd();
    });
    ui.content.appendChild(addRow);

    ui.content.appendChild(section("Played with recently"));
    if (state.suggestionsLoading && !state.suggestions.length) {
      ui.content.appendChild(loading());
      return;
    }
    if (!state.suggestions.length) {
      ui.content.appendChild(emptyArt(
        pixelSprite("controller", 4, "bb-friends-float"),
        "No suggestions",
        "Play a few matches with the same people and they'll show up here.",
      ));
      return;
    }
    for (const s of state.suggestions) {
      ui.content.appendChild(userRow(s, {
        subtitle: `${s.gamesTogether} games together`,
        actions: [iconButton("invite", `Add ${s.name} as a friend`, "is-accept", async (event) => {
          event.currentTarget.disabled = true;
          if (!(await sendRequest({ userId: s.userId }))) event.currentTarget.disabled = false;
        })],
      }));
    }
  }

  function toChatMessage(m) {
    const mine = m.senderId === state.me?.userId;
    const friend = friendById(state.chatFriendId);
    const sender = mine
      ? { name: state.me?.name || "You", charClass: state.me?.charClass, profileIconId: state.me?.profileIconId || null }
      : { name: friend?.name || "Friend", charClass: friend?.charClass, profileIconId: friend?.profileIconId };
    // Shape reactions the way the shared party-chat renderer expects.
    const counts = new Map();
    const reactionUsers = {};
    let myReaction = null;
    for (const r of Array.isArray(m.reactions) ? m.reactions : []) {
      counts.set(r.reaction, (counts.get(r.reaction) || 0) + 1);
      (reactionUsers[r.reaction] ||= []).push({ name: r.name });
      if (r.userId === state.me?.userId) myReaction = r.reaction;
    }
    return {
      id: m.messageId,
      sender,
      body: m.body,
      createdAt: m.createdAt,
      reactions: [...counts].map(([reaction, count]) => ({ reaction, count })),
      reactionUsers,
      myReaction,
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

  // Friend read my messages: flip receipts in place without moving the scroll.
  function applyFriendRead(upToMessageId, readAt) {
    for (const m of state.messages) {
      if (m.senderId !== state.me?.userId || m.readAt || m.messageId > upToMessageId) continue;
      upsertMessage({ ...m, readAt });
    }
  }

  // Swap one row in place so reacting doesn't jump the scroll position.
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
      const data = await postJson("/friends/messages/react", { messageId, reaction });
      if (data.message) upsertMessage(data.message, { pulse: reaction });
    } catch (error) {
      showFriendError(error, "Could not update reaction");
    }
  }

  // Rebuilds the log; keeps the reader's place unless forced to the bottom.
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

  function render() {
    const inChat = state.view === "chat";
    const friend = inChat ? friendById(state.chatFriendId) : null;
    ui.tabs.hidden = inChat || state.guest;
    ui.back.hidden = !inChat;
    ui.chat.hidden = !inChat;
    ui.content.hidden = inChat;
    panel.classList.toggle("is-chatting", inChat);
    ui.title.textContent = inChat ? friend?.name || "Chat" : "Friends";
    ui.subtitle.textContent = inChat
      ? statusLabel(friend?.status)
      : state.guest
        ? "Registered players only"
        : `${state.friends.filter((f) => f.status !== "offline").length} online`;
    ui.subtitle.className = `bb-chat-subtitle ${inChat ? statusClass(friend?.status) : ""}`;
    for (const tab of ui.tabs.querySelectorAll("[data-view]")) {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (inChat) return;
    ui.content.replaceChildren();
    if (!state.loaded) {
      ui.content.appendChild(loading());
      return;
    }
    if (state.guest) return renderGuest();
    if (state.view === "requests") renderRequests();
    else if (state.view === "add") renderAdd();
    else renderFriends();
  }

  // ---------- conversation ----------
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
      const data = await postJson("/friends/messages/history", {
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
    try { await postJson("/friends/messages/read", { friendId }); } catch (_) {}
  }

  async function sendMessage() {
    const body = ui.textarea.value.trim();
    const friendId = state.chatFriendId;
    if (!body || !friendId || state.sending) return;
    state.sending = true;
    ui.send.disabled = true;
    try {
      const data = await postJson("/friends/messages/send", { friendId, body });
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

  function setLocalTyping(isTyping) {
    window.clearTimeout(state.localTypingTimer);
    if (!state.chatFriendId) {
      state.localTyping = false;
      return;
    }
    if (isTyping) {
      state.localTypingTimer = window.setTimeout(() => setLocalTyping(false), TYPING_STOP_MS);
      // Refresh the friend's indicator at most once a second while typing.
      if (state.localTyping && Date.now() - state.lastTypingEmitAt < 1000) return;
    } else if (!state.localTyping) {
      return;
    }
    state.localTyping = isTyping;
    state.lastTypingEmitAt = Date.now();
    socket?.emit?.("friends:typing", { friendId: state.chatFriendId, isTyping });
  }

  function setFriendTyping(isTyping) {
    window.clearTimeout(state.friendTypingTimer);
    state.friendTyping = isTyping;
    const friend = friendById(state.chatFriendId);
    ui.typingText.textContent = isTyping ? `${friend?.name || "Friend"} is typing` : "";
    ui.typing.classList.toggle("is-idle", !isTyping);
    if (isTyping) state.friendTypingTimer = window.setTimeout(() => setFriendTyping(false), TYPING_STALE_MS);
  }

  function openProfile(username) {
    if (typeof onOpenProfile !== "function") return;
    setOpen(false);
    onOpenProfile(username);
  }

  // ---------- events ----------
  launcher.addEventListener("click", () => setOpen(!state.isOpen));
  backdrop.addEventListener("click", () => setOpen(false));
  ui.close.addEventListener("click", () => setOpen(false));
  ui.back.addEventListener("click", () => setView("friends"));
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

  listen("friends:changed", () => {
    void refresh();
    if (state.view === "add" && state.isOpen) void loadSuggestions();
  });

  listen("friends:request", ({ from } = {}) => {
    sonner(null, `${from?.name || "Someone"} sent you a friend request.`, "View", (close) => {
      close();
      setOpen(true);
      setView("requests");
    }, { duration: 8000, sound: "notification" });
  });

  listen("friends:presence", ({ userId, status } = {}) => {
    const friend = friendById(userId);
    if (!friend || friend.status === status) return;
    friend.status = status;
    if (state.isOpen) render();
  });

  listen("friends:message", ({ message } = {}) => {
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

  listen("friends:reaction", ({ message, reactorId, reaction, added } = {}) => {
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
  listen("friends:read", ({ readerId, friendId, upToMessageId, readAt } = {}) => {
    if (readerId === state.chatFriendId && state.view === "chat") {
      applyFriendRead(Number(upToMessageId) || Infinity, readAt || new Date().toISOString());
      return;
    }
    if (readerId !== state.me?.userId || !friendId) return;
    state.unread[friendId] = 0;
    syncBadge();
    if (state.isOpen && state.view === "friends") render();
  });

  listen("friends:typing", ({ userId, isTyping } = {}) => {
    if (state.view !== "chat" || Number(userId) !== state.chatFriendId) return;
    setFriendTyping(!!isTyping);
  });

  listen("friends:party-invite", ({ partyId, from } = {}) => {
    if (!partyId || Number(partyId) === currentPartyId()) return;
    sonner(null, `${from?.name || "A friend"} invited you to their party.`, "Join", (close) => {
      close();
      window.location.href = `/party/${Number(partyId)}`;
    }, { duration: 15000, sound: "notification" });
  });

  // Socket reconnects can miss pushes, so resync.
  listen("connect", () => void refresh());

  void refresh();

  return {
    open: (view) => {
      setOpen(true);
      if (view) setView(view);
    },
    close: () => setOpen(false),
    isOpen: () => state.isOpen,
    refresh,
    isGuest: () => state.guest,
    // Used by the party slot menu and profile modal.
    relationshipFor(name) {
      const key = String(name || "").trim().toLowerCase();
      if (!key || state.guest) return "unavailable";
      if (state.me?.name?.toLowerCase() === key) return "self";
      if (state.friends.some((f) => f.name.toLowerCase() === key)) return "friends";
      if (state.outgoing.some((r) => r.user.name.toLowerCase() === key)) return "outgoing";
      if (state.incoming.some((r) => r.user.name.toLowerCase() === key)) return "incoming";
      return "none";
    },
    addFriend: (target) => sendRequest(target),
    destroy() {
      for (const [event, handler] of socketListeners) socket?.off?.(event, handler);
      window.clearTimeout(state.friendTypingTimer);
      window.clearTimeout(state.localTypingTimer);
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
