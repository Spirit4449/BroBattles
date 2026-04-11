const GAME_CHAT_RECENT_LIMIT = 8;

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

function formatChatDate(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function buildAvatarUrl(charClass) {
  const cls = String(charClass || "ninja")
    .trim()
    .toLowerCase();
  return `/assets/${cls}/body.webp`;
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
      throw new Error(data?.error || "Request failed");
    }
    return data;
  });
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
  launcher.textContent = launcherLabel;

  const badge = document.createElement("span");
  badge.className = "bb-chat-badge hidden";
  launcher.appendChild(badge);

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
    panel,
    messagesEl: panel.querySelector(".bb-chat-messages"),
    textarea: panel.querySelector(".bb-chat-textarea"),
    sendBtn: panel.querySelector(".bb-chat-send"),
    closeBtn: panel.querySelector(".bb-chat-close"),
    clearReplyBtn: panel.querySelector(".bb-chat-reply-cancel"),
    replyBanner: panel.querySelector(".bb-chat-reply-banner"),
  };
}

function renderPartyChatMessage(
  message,
  { currentUserName, onReply, onReact, compact = false } = {},
) {
  const row = document.createElement("article");
  const isSelf =
    String(message?.sender?.name || "") === String(currentUserName || "");
  row.className = `bb-chat-message${isSelf ? " is-self" : ""}`;

  const avatar = document.createElement("div");
  avatar.className = "bb-chat-avatar";
  const img = document.createElement("img");
  img.src = buildAvatarUrl(message?.sender?.charClass);
  img.alt = message?.sender?.name || "Player";
  avatar.appendChild(img);

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
    bubble.appendChild(reply);
  }

  const body = document.createElement("div");
  body.className = "bb-chat-body-text";
  body.textContent = String(message?.body || "");
  bubble.appendChild(body);

  if (!compact) {
    const actions = document.createElement("div");
    actions.className = "bb-chat-meta-row";
    const read = document.createElement("span");
    read.textContent = `Views: ${Number(message?.viewCount) || 0}`;
    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "bb-chat-reaction";
    replyButton.textContent = "Reply";
    replyButton.addEventListener("click", () => onReply?.(message));
    actions.appendChild(read);
    actions.appendChild(replyButton);
    bubble.appendChild(actions);

    const reactionRow = document.createElement("div");
    reactionRow.className = "bb-chat-reactions";
    const presetReactions = ["👍", "❤️", "😂", "🔥"];
    const reactionCounts = new Map(
      (Array.isArray(message?.reactions) ? message.reactions : []).map(
        (item) => [String(item?.reaction || ""), Number(item?.count) || 0],
      ),
    );
    for (const reaction of presetReactions) {
      const count = reactionCounts.get(reaction) || 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bb-chat-reaction${message?.myReaction === reaction ? " is-active" : ""}`;
      button.textContent = count > 0 ? `${reaction} ${count}` : reaction;
      button.addEventListener("click", () => onReact?.(message, reaction));
      reactionRow.appendChild(button);
    }
    bubble.appendChild(reactionRow);
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
    lastReadMessageId: 0,
    unreadCount: 0,
    replyTo: null,
    loading: false,
  };

  const ui = makeChatShell({
    rootClassName: "bb-chat-lobby-wrap",
    panelClassName: "bb-chat-lobby-panel",
    launcherLabel: "Chat",
    launcherClassName: "bb-chat-lobby-launcher",
  });

  function currentPartyId() {
    const context =
      typeof getPartyContext === "function" ? getPartyContext() : null;
    const fromContext = Number(context?.partyId) || 0;
    if (fromContext > 0) return fromContext;
    return Number(state.partyId) || 0;
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

  function setOpen(open) {
    state.isOpen = !!open;
    if (state.isOpen) {
      state.lastReadMessageId = 0;
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
      return;
    }
    ui.replyBanner.classList.remove("hidden");
    ui.replyBanner.innerHTML = `<span>Replying to <strong>${escapeHtml(state.replyTo.sender?.name || state.replyTo.sender || "")}</strong>: ${escapeHtml(state.replyTo.body || "")}</span>`;
  }

  function renderMessages() {
    const existingScroll = ui.messagesEl.scrollTop;
    ui.messagesEl.innerHTML = "";
    let dividerInserted = false;
    for (const message of state.messages) {
      const messageId = Number(message?.id) || 0;
      if (
        !dividerInserted &&
        state.lastReadMessageId &&
        messageId > state.lastReadMessageId
      ) {
        dividerInserted = true;
        const divider = document.createElement("div");
        divider.className = "bb-chat-divider";
        divider.innerHTML = `<span>New since last open</span>`;
        ui.messagesEl.appendChild(divider);
      }
      ui.messagesEl.appendChild(
        renderPartyChatMessage(message, {
          currentUserName: getCurrentUserName?.(),
          onReply: setReplyTo,
          onReact: (target, reaction) =>
            void reactToMessage(target?.id, reaction),
          compact: false,
        }),
      );
    }
    ui.messagesEl.scrollTop = existingScroll
      ? ui.messagesEl.scrollHeight
      : ui.messagesEl.scrollHeight;
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
      state.partyId = partyId;
      state.messages = Array.isArray(data?.messages) ? data.messages : [];
      if (!state.isOpen || !state.lastReadMessageId) {
        state.lastReadMessageId = Number(data?.lastReadMessageId) || 0;
      }
      renderMessages();
      const latestId =
        Number(state.messages[state.messages.length - 1]?.id) || 0;
      if (latestId > 0) {
        window.setTimeout(() => {
          void postJson("/party-chat/read", {
            partyId,
            lastMessageId: latestId,
          }).catch(() => {});
        }, 250);
      }
      if (!state.isOpen) {
        setUnreadBadge(Number(data?.unreadCount) || 0);
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
    if (!partyId || !body) return;
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
        const exists = state.messages.some(
          (item) => Number(item?.id) === Number(message.id),
        );
        if (!exists) {
          state.messages = [...state.messages, message].slice(-100);
          if (state.isOpen) {
            renderMessages();
          }
        }
      }
    } catch (error) {
      console.warn("[chat] send failed", error?.message || error);
    } finally {
      ui.sendBtn.disabled = false;
      ui.textarea.focus();
    }
  }

  async function reactToMessage(messageId, reaction) {
    const partyId = currentPartyId();
    if (!partyId || !messageId) return;
    try {
      await postJson("/party-chat/react", {
        partyId,
        messageId,
        reaction,
      });
      await loadHistory();
    } catch (error) {
      console.warn("[chat] reaction failed", error?.message || error);
    }
  }

  ui.launcher.addEventListener("click", async () => {
    const nextOpen = !state.isOpen;
    setOpen(nextOpen);
    if (!nextOpen) return;
    if (currentPartyId()) {
      await loadHistory();
      ui.textarea.focus();
    } else {
      state.messages = [];
      renderMessages();
    }
  });
  ui.backdrop.addEventListener("click", () => setOpen(false));
  ui.closeBtn.addEventListener("click", () => setOpen(false));
  ui.clearReplyBtn.addEventListener("click", () => setReplyTo(null));
  ui.sendBtn.addEventListener("click", () => void sendMessage());
  ui.textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });

  socket?.on?.("party:joined", ({ partyId }) => {
    state.partyId = Number(partyId) || null;
    if (!state.partyId) {
      setOpen(false);
      setUnreadBadge(0);
      state.messages = [];
      renderMessages();
      return;
    }
  });

  socket?.on?.("party-chat:message", (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (partyId !== currentPartyId()) return;
    const message = payload?.message || null;
    if (!message) return;
    const exists = state.messages.some(
      (item) => Number(item?.id) === Number(message.id),
    );
    if (!exists) {
      state.messages = [...state.messages, message].slice(-100);
    }
    if (state.isOpen) {
      renderMessages();
      const latestId =
        Number(state.messages[state.messages.length - 1]?.id) || 0;
      if (latestId > 0) {
        void postJson("/party-chat/read", {
          partyId,
          lastMessageId: latestId,
        }).catch(() => {});
      }
    } else if (!message?.isMine) {
      setUnreadBadge(state.unreadCount + 1);
    }
  });

  socket?.on?.("party-chat:invalidate", (payload = {}) => {
    const partyId = Number(payload?.partyId) || 0;
    if (partyId !== currentPartyId()) return;
    if (state.isOpen) {
      void loadHistory();
    }
  });

  socket?.on?.("party:members", () => {
    const partyId = currentPartyId();
    if (!partyId) {
      setOpen(false);
      setUnreadBadge(0);
      return;
    }
  });

  const initialPartyId = currentPartyId();
  ui.root.style.display = "block";
  if (initialPartyId) {
    state.partyId = initialPartyId;
    void loadHistory();
  }

  return {
    refresh: () => void loadHistory(),
    open: () => setOpen(true),
    close: () => setOpen(false),
    destroy: () => ui.root.remove(),
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
