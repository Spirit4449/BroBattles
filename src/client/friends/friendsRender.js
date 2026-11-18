import { formatBadgeCount } from "../chat/badges.mjs";
import { API_PATHS } from "../../shared/net/apiPaths.js";
import { formatDurationShort as formatCooldown } from "../../shared/format.js";
import { bindChatProfile, buildAvatarUrl, escapeHtml } from "../chat/presentation";
import { sonner } from "../ui/sonner.js";
import { friendPresenceLabel, friendPresenceTitle } from "./friendPresence.mjs";
import { pixelSprite } from "./pixelArt.js";
import { PRIVACY_FIELDS, privacyControl, savePrivacy } from "./privacyClient.js";
import { friendsApi, showFriendError } from "./friendsApi.js";

const FRIEND_REQUESTS_FIELD = PRIVACY_FIELDS.find((field) => field.key === "friendRequests");

const STATUS_ORDER = { online: 0, "End Screen": 1, "In Battle": 2, offline: 3 };

function statusLabel(status) {
  if (status === "In Battle") return "In Battle";
  if (status === "End Screen") return "Finishing match";
  return status === "online" ? "Online" : "Offline";
}

export function statusClass(status) {
  if (status === "online") return "is-online";
  if (status === "In Battle" || status === "End Screen") return "is-battle";
  return "is-offline";
}

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

export function textButton(label, className, onClick) {
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

function section(title) {
  const h = document.createElement("h3");
  h.className = "bb-friends-section";
  h.textContent = title;
  return h;
}

export function emptyArt(art, title, text) {
  const wrap = document.createElement("div");
  wrap.className = "bb-friends-empty-art";
  wrap.innerHTML = `<div class="bb-friends-empty-sprite">${art}</div><div class="bb-friends-empty-title">${escapeHtml(title)}</div>${text ? `<p>${escapeHtml(text)}</p>` : ""}`;
  return wrap;
}

export function loading() {
  const p = document.createElement("p");
  p.className = "bb-friends-loading";
  p.textContent = "Loading";
  return p;
}

export function createFriendsRender({
  state, ui, panel, currentPartyId, openProfile, setView, act, refresh, sendRequest, friendById, syncChatStatus
}) {
  function userRow(user, { subtitle, actions = [], dot = true, subtitleClass = "", onClick = null } = {}) {
    const row = document.createElement("div");
    row.className = "bb-friends-row";
    if (onClick) {
      row.classList.add("is-clickable");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.addEventListener("click", () => onClick());
      row.addEventListener("keydown", (event) => {
        if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onClick();
      });
    }
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
    if (subtitle === undefined) {
      const label = text.querySelector(".bb-friends-sub");
      label.dataset.friendPresenceId = String(user.userId);
      label.textContent = friendPresenceLabel(user);
      label.title = friendPresenceTitle(user);
    }
    if (!onClick) bindChatProfile(text.querySelector(".bb-friends-name"), user.name, openProfile);
    const actionsEl = document.createElement("div");
    actionsEl.className = "bb-friends-actions";
    for (const action of actions) if (action) actionsEl.appendChild(action);
    row.append(av, text, actionsEl);
    return row;
  }

  function renderGuest() {
    const wrap = emptyArt(
      `${pixelSprite("heart", 4, "bb-friends-float")}${pixelSprite("friends", 6)}`,
      "Friends",
      "Create an account to add friends, chat, and invite them to your party.",
    );
    const link = document.createElement("a");
    link.className = "bb-friends-btn is-primary";
    link.href = API_PATHS.SIGNUP;
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
      const result = await friendsApi.invite({ friendId: friend.userId });
      setInviteCooldown(friend.userId, result.cooldownUntilMs);
      sonner(null, `You invited ${friend.name} to your party.`, "OK", undefined, { tone: "success", duration: 3000 });
    } catch (error) {
      setInviteCooldown(friend.userId, error?.payload?.cooldownUntilMs);
      showFriendError(error, "Could not invite friend");
    }
    render();
  }

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
        const indicators = document.createElement("div");
        indicators.className = "bb-friends-indicators";
        if (state.reactionFrom.has(friend.userId)) {
          const heart = document.createElement("span");
          heart.className = "bb-friends-heart";
          heart.title = `${friend.name} reacted to your message`;
          heart.innerHTML = `<img src="/assets/heart-filled.svg" alt="" width="10" height="10" />`;
          indicators.appendChild(heart);
        }
        if (unread) {
          const dot = document.createElement("span");
          dot.className = "bb-friends-unread";
          dot.textContent = formatBadgeCount(unread, 9);
          indicators.appendChild(dot);
        }
        const invite = inParty && friend.status === "online" && friend.acceptsPartyInvites !== false
          ? inviteButton(friend)
          : null;
        const row = userRow(friend, {
          subtitleClass: statusClass(friend.status),
          actions: [indicators.childElementCount ? indicators : null, invite],
          onClick: () => setView("chat", friend.userId),
        });
        row.setAttribute("aria-label", `Chat with ${friend.name}`);
        ui.content.appendChild(row);
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
            if (await act(friendsApi.respond, { requestId: req.requestId, accept: true }, "Could not update friend request")) await refresh();
          }),
          iconButton("cross", `Decline ${req.user.name}`, "is-danger", async (event) => {
            event.currentTarget.disabled = true;
            if (await act(friendsApi.respond, { requestId: req.requestId, accept: false }, "Could not update friend request")) await refresh();
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
            if (await act(friendsApi.cancel, { requestId: req.requestId }, "Could not update friend request")) await refresh();
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

    const requestsRow = document.createElement("div");
    requestsRow.className = "bb-friends-privacy-row";
    requestsRow.innerHTML = `<div class="bb-friends-privacy-label">Accept requests from</div>`;
    const requestsSelect = privacyControl(FRIEND_REQUESTS_FIELD, state.privacy.friendRequests, async (value) => {
      requestsSelect.setDisabled(true);
      try {
        await savePrivacy({ friendRequests: value });
      } catch (error) {
        requestsSelect.setValue(state.privacy.friendRequests);
        showFriendError(error, "Could not save setting");
      }
      requestsSelect.setDisabled(false);
    }, { compact: true });
    requestsRow.appendChild(requestsSelect.element);
    ui.content.appendChild(requestsRow);

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

  function render() {
    const inChat = state.view === "chat";
    const friend = inChat ? friendById(state.chatFriendId) : null;
    ui.tabs.hidden = inChat || state.guest;
    ui.back.hidden = !inChat;
    ui.chat.hidden = !inChat;
    ui.content.hidden = inChat;
    panel.classList.toggle("is-chatting", inChat);
    ui.title.textContent = inChat ? friend?.name || "Chat" : "Friends";
    ui.chatAvatarWrap.hidden = !inChat || !friend;
    ui.chatAvatarWrap.className = `bb-friends-avatar-wrap bb-friends-chat-avatar-wrap ${inChat ? statusClass(friend?.status) : ""}`;
    const profileLink = inChat && !!friend;
    ui.chatProfile.classList.toggle("is-link", profileLink);
    ui.chatProfile.tabIndex = profileLink ? 0 : -1;
    if (profileLink) {
      ui.chatProfile.setAttribute("role", "button");
      ui.chatProfile.setAttribute("aria-label", `View ${friend.name}'s profile`);
    } else {
      ui.chatProfile.removeAttribute("role");
      ui.chatProfile.removeAttribute("aria-label");
    }
    if (inChat && friend) ui.chatAvatar.src = buildAvatarUrl(friend.charClass, friend.profileIconId);
    if (inChat) syncChatStatus();
    else {
      ui.subtitle.textContent = state.guest
        ? "Registered players only"
        : `${state.friends.filter((f) => f.status !== "offline").length} online`;
      ui.subtitle.title = "";
      ui.subtitle.className = "bb-chat-subtitle";
    }
    // History stays readable when the friend has turned messages off.
    const canMessage = !inChat || friend?.acceptsMessages !== false;
    ui.textarea.disabled = !canMessage;
    ui.send.disabled = !canMessage || state.sending;
    ui.textarea.placeholder = canMessage ? "Write a message..." : `${friend?.name || "This friend"} isn't accepting messages`;
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

  return { render, destroy: () => window.clearTimeout(cooldownTick) };
}
