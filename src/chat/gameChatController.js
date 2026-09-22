
import { makeChatShell, renderGameChatLineMessage, GAME_CHAT_RECENT_LIMIT } from './presentation';
import {
  GAME_CHAT_FOCUS_MS,
  GAME_CHAT_UNFOCUSED_MS,
  gameChatVisibilityPhase,
} from './gameChatVisibility.mjs';

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
    sending: false,
    destroyed: false,
    suppressed: false,
    inputCaptureActive: false,
    audience: "team",
    lastActivityAt: 0,
    visibilityPhase: "hidden",
    unreadByScope: {
      team: 0,
      all: 0,
    },
    draftsByScope: {
      team: "",
      all: "",
    },
    cooldownTimer: null,
    cooldownDraftValue: "",
    messagesByScope: {
      team: [],
      all: [],
    },
    visibilityTimer: null,
  };

  const ui = makeChatShell({
    rootClassName: "bb-chat-game-wrap",
    panelClassName: "bb-chat-game-panel",
    launcherLabel: "Chat",
    launcherClassName: "bb-chat-game-launcher",
  });
  ui.textarea.maxLength = 220;
  ui.clearReplyBtn.style.display = "none";
  ui.replyBanner.style.display = "none";
  ui.titleEl.textContent = "Battle Chat";
  if (ui.subtitleEl) ui.subtitleEl.style.display = "none";
  ui.textarea.placeholder = "Message your team…  / to focus";
  ui.closeBtn.setAttribute("aria-label", "Hide battle chat");
  ui.closeBtn.setAttribute("title", "Hide battle chat");
  ui.messagesEl.id = "bb-game-chat-messages";
  ui.messagesEl.setAttribute("role", "log");
  ui.messagesEl.setAttribute("aria-live", "polite");
  ui.messagesEl.setAttribute("aria-relevant", "additions");

  const headerActions = ui.panel.querySelector(".bb-chat-header-actions");
  const audienceTabs = document.createElement("div");
  audienceTabs.className = "bb-chat-audience-tabs";
  audienceTabs.setAttribute("role", "tablist");
  audienceTabs.setAttribute("aria-label", "Chat channel");
  audienceTabs.innerHTML = `
    <button type="button" class="bb-chat-audience-tab" role="tab" data-chat-scope="team" aria-controls="bb-game-chat-messages">
      <span>Team</span><span class="bb-chat-tab-count hidden" aria-hidden="true"></span>
    </button>
    <button type="button" class="bb-chat-audience-tab" role="tab" data-chat-scope="all" aria-controls="bb-game-chat-messages">
      <span>All</span><span class="bb-chat-tab-count hidden" aria-hidden="true"></span>
    </button>
  `;
  const audienceButtons = Array.from(
    audienceTabs.querySelectorAll(".bb-chat-audience-tab"),
  );
  if (headerActions) {
    headerActions.insertBefore(audienceTabs, ui.closeBtn || null);
  }

  function normalizeScope(scope) {
    return String(scope || "team").toLowerCase() === "all" ? "all" : "team";
  }

  function setUnreadBadge(count) {
    const total = Math.max(0, Number(count) || 0);
    if (total > 0) {
      ui.badge.textContent = total > 99 ? "99+" : String(total);
      ui.badge.classList.remove("hidden");
    } else {
      ui.badge.textContent = "";
      ui.badge.classList.add("hidden");
    }
  }

  function syncUnreadUi() {
    const teamCount = Math.max(0, Number(state.unreadByScope.team) || 0);
    const allCount = Math.max(0, Number(state.unreadByScope.all) || 0);
    for (const button of audienceButtons) {
      const scope = normalizeScope(button.dataset.chatScope);
      const count = scope === "all" ? allCount : teamCount;
      const countEl = button.querySelector(".bb-chat-tab-count");
      if (!countEl) continue;
      countEl.textContent = count > 99 ? "99+" : String(count || "");
      countEl.classList.toggle("hidden", count <= 0);
      button.setAttribute(
        "aria-label",
        `${scope === "all" ? "All" : "Team"} chat${count > 0 ? `, ${count} unread` : ""}`,
      );
    }
    setUnreadBadge(teamCount + allCount);
  }

  function incrementUnread(scope) {
    const key = normalizeScope(scope);
    state.unreadByScope[key] = Math.max(
      0,
      (Number(state.unreadByScope[key]) || 0) + 1,
    );
    syncUnreadUi();
  }

  function clearUnread(scope) {
    const key = normalizeScope(scope);
    if ((Number(state.unreadByScope[key]) || 0) <= 0) return;
    state.unreadByScope[key] = 0;
    syncUnreadUi();
  }

  function syncAudienceUi() {
    for (const button of audienceButtons) {
      const isActive = normalizeScope(button.dataset.chatScope) === state.audience;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    }
    ui.textarea.placeholder =
      state.audience === "all"
        ? "Message everyone…  / to focus"
        : "Message your team…  / to focus";
    syncUnreadUi();
  }

  function switchAudience(scope, { focusTab = false } = {}) {
    if (ui.textarea.disabled) return;
    const nextScope = normalizeScope(scope);
    const previousScope = normalizeScope(state.audience);
    state.draftsByScope[previousScope] = String(ui.textarea.value || "");
    state.audience = nextScope;
    ui.textarea.value = String(state.draftsByScope[nextScope] || "");
    ui.resizeComposer();
    syncAudienceUi();
    renderMessages({ force: true });
    if (state.isOpen && !state.suppressed) clearUnread(nextScope);
    if (focusTab) {
      audienceButtons
        .find((button) => normalizeScope(button.dataset.chatScope) === nextScope)
        ?.focus();
    }
    wakeChat();
  }

  function cycleAudience(direction = 1, options) {
    const scopes = ["team", "all"];
    const currentIndex = scopes.indexOf(normalizeScope(state.audience));
    const nextIndex = (currentIndex + direction + scopes.length) % scopes.length;
    switchAudience(scopes[nextIndex], options);
  }

  function syncSceneKeyboardEnabled() {
    const scene = typeof getScene === "function" ? getScene() : null;
    if (scene?.input?.keyboard) {
      scene.input.keyboard.enabled = !isChatInputActive?.();
    }
  }

  function setInputCapture(active) {
    state.inputCaptureActive = !!active;
    if (setChatInputActive) setChatInputActive(state.inputCaptureActive);
    syncSceneKeyboardEnabled();
  }

  function clearVisibilityTimer() {
    if (state.visibilityTimer) {
      window.clearTimeout(state.visibilityTimer);
      state.visibilityTimer = null;
    }
  }

  function scheduleVisibilityTick() {
    clearVisibilityTimer();
    if (!state.isOpen || state.suppressed || state.visibilityPhase === "hidden") {
      return;
    }
    const now = Date.now();
    const nextAt = state.lastActivityAt +
      (state.visibilityPhase === "active"
        ? GAME_CHAT_FOCUS_MS
        : GAME_CHAT_FOCUS_MS + GAME_CHAT_UNFOCUSED_MS);
    state.visibilityTimer = window.setTimeout(() => {
      state.visibilityTimer = null;
      syncGameChatVisibility();
      scheduleVisibilityTick();
    }, Math.max(1, nextAt - now));
  }

  function wakeChat() {
    if (!state.isOpen || state.suppressed) return;
    state.lastActivityAt = Date.now();
    syncGameChatVisibility();
    scheduleVisibilityTick();
  }

  function syncGameChatVisibility() {
    const phase = gameChatVisibilityPhase({
      open: state.isOpen,
      suppressed: state.suppressed,
      lastActivityAt: state.lastActivityAt,
      now: Date.now(),
    });
    state.visibilityPhase = phase;
    if (phase !== "active") {
      if (ui.panel.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (state.inputCaptureActive) setInputCapture(false);
    }
    ui.panel.classList.toggle("is-active", phase === "active");
    ui.panel.classList.toggle("is-unfocused", phase === "unfocused");
    ui.panel.classList.toggle("is-auto-hidden", phase === "hidden" && !state.suppressed);
    ui.panel.classList.toggle("is-muted", state.suppressed);
    ui.panel.inert = phase === "hidden";
    ui.panel.setAttribute("aria-hidden", String(phase === "hidden"));
  }

  function setActive(active) {
    state.isOpen = !!active;
    ui.panel.classList.toggle("is-open", state.isOpen);
    if (state.isOpen) {
      renderMessages();
      ui.scroll.showPending(state.unreadByScope[state.audience]);
      if (ui.scroll.atBottom()) clearUnread(state.audience);
      wakeChat();
      ui.textarea.focus();
      setInputCapture(true);
      return;
    }
    clearVisibilityTimer();
    setInputCapture(false);
    ui.textarea.blur();
    syncGameChatVisibility();
  }

  function setSuppressed(suppressed) {
    state.suppressed = !!suppressed;
    if (state.suppressed) {
      state.isOpen = false;
      clearVisibilityTimer();
      setInputCapture(false);
      ui.textarea.blur();
      ui.panel.classList.remove("is-open");
    }
    syncGameChatVisibility();
  }

  function renderMessages({ added = 0, force = false } = {}) {
    const scrollSnapshot = ui.scroll.capture();
    ui.messagesEl.innerHTML = "";
    const currentUser = String(getUsername?.() || "");
    const localTeam = getGameData?.()?.yourTeam || "team1";
    const selectedAudience = String(state.audience || "team").toLowerCase();
    const list =
      selectedAudience === "all"
        ? state.messagesByScope.all
        : state.messagesByScope.team;
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "bb-chat-game-empty";
      empty.innerHTML = `
        <span class="bb-chat-game-empty-title">No messages yet</span>
        <span>${selectedAudience === "all" ? "Say something to everyone in the match." : "Coordinate with your team."}</span>
      `;
      ui.messagesEl.appendChild(empty);
      return;
    }
    for (const message of list) {
      ui.messagesEl.appendChild(
        renderGameChatLineMessage(message, currentUser, localTeam),
      );
    }
    ui.scroll.restore(scrollSnapshot, { added, force });
  }

  function addMessage(message) {
    const id = String(message?.id || "");
    if (!id) return false;
    const scope =
      String(message?.scope || "team").toLowerCase() === "all" ? "all" : "team";
    const bucket =
      scope === "all" ? state.messagesByScope.all : state.messagesByScope.team;
    const exists = bucket.some((item) => String(item?.id || "") === id);
    if (exists) return false;
    bucket.push({ ...message, scope });
    if (bucket.length > GAME_CHAT_RECENT_LIMIT) {
      bucket.splice(0, bucket.length - GAME_CHAT_RECENT_LIMIT);
    }
    return true;
  }

  function clearCooldownFeedback() {
    if (state.cooldownTimer) {
      window.clearTimeout(state.cooldownTimer);
      state.cooldownTimer = null;
    }
    if (!ui.textarea.disabled) return;
    ui.textarea.disabled = false;
    ui.sendBtn.disabled = false;
    for (const button of audienceButtons) button.disabled = false;
    ui.textarea.value = String(state.cooldownDraftValue || "");
    ui.resizeComposer();
    syncAudienceUi();
    state.cooldownDraftValue = "";
  }

  function applyInlineRateLimitMessage(message, durationMs = 2200) {
    const duration = Math.max(900, Number(durationMs) || 2200);
    if (!ui.textarea.disabled) {
      state.cooldownDraftValue = String(ui.textarea.value || "");
    }
    ui.textarea.disabled = true;
    ui.sendBtn.disabled = true;
    for (const button of audienceButtons) button.disabled = true;
    ui.textarea.value = String(message || "Slow down.");
    ui.resizeComposer();
    ui.textarea.placeholder = ui.textarea.value;

    if (state.cooldownTimer) {
      window.clearTimeout(state.cooldownTimer);
      state.cooldownTimer = null;
    }
    state.cooldownTimer = window.setTimeout(() => {
      state.cooldownTimer = null;
      ui.textarea.disabled = false;
      ui.sendBtn.disabled = false;
      for (const button of audienceButtons) button.disabled = false;
      ui.textarea.value = String(state.cooldownDraftValue || "");
      ui.resizeComposer();
      syncAudienceUi();
      state.cooldownDraftValue = "";
    }, duration);
  }

  async function sendMessage() {
    if (state.sending || ui.textarea.disabled || state.destroyed) return;
    const draft = ui.textarea.value;
    const scope = state.audience;
    const body = String(draft || "").trim();
    if (!body) return;
    const payload = {
      body,
      matchId: Number(getGameData?.()?.gameId || 0) || null,
      scope: state.audience,
    };
    state.sending = true;
    ui.sendBtn.disabled = true;
    try {
      const ack = await new Promise((resolve, reject) => {
        if (!socket?.connected) { reject(new Error("Chat disconnected. Try again when connected.")); return; }
        socket.timeout(8000).emit("game:chat:send", payload, (timeoutError, result) => {
          if (timeoutError) { reject(new Error("Chat send timed out. Check chat before retrying.")); return; }
          if (result?.ok) {
            resolve(result.message);
            return;
          }
          const error = new Error(result?.error || "Failed to send chat");
          error.payload = result || {};
          reject(error);
        });
      });
      if (state.destroyed) return;
      if (state.audience === scope && ui.textarea.value === draft) ui.textarea.value = "";
      ui.resizeComposer();
      if (state.draftsByScope[scope] === draft) state.draftsByScope[scope] = "";
      addMessage(ack);
      renderMessages();
      clearUnread(state.audience);
    } catch (error) {
      if (state.destroyed) return;
      const errType = String(error?.payload?.type || "").toLowerCase();
      const banWarning = String(error?.payload?.banWarning || "").trim();
      const base = String(error?.message || "Failed to send chat");
      const finalMessage = banWarning ? `${base} ${banWarning}` : base;
      if (errType === "warn" || errType === "chat_limited") {
        applyInlineRateLimitMessage(finalMessage, 2200);
      } else {
        applyInlineRateLimitMessage(base, 1800);
      }
      console.warn("[chat] game send failed", error?.message || error);
    } finally {
      state.sending = false;
      if (state.destroyed) return;
      if (!ui.textarea.disabled) {
        ui.sendBtn.disabled = false;
      }
      ui.textarea.blur();
      setInputCapture(false);
      wakeChat();
    }
  }

  function openComposer() {
    setSuppressed(false);
    setActive(true);
  }

  ui.launcher.addEventListener("click", () => {
    openComposer();
  });
  ui.sendBtn.addEventListener("click", () => void sendMessage());
  ui.closeBtn.addEventListener("click", () => setSuppressed(true));
  ui.clearReplyBtn.addEventListener("click", () => {});
  audienceTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".bb-chat-audience-tab");
    if (!button) return;
    switchAudience(button.dataset.chatScope);
    if (state.isOpen) ui.textarea.focus();
  });
  audienceTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (event.key === "Home") switchAudience("team", { focusTab: true });
    else if (event.key === "End") switchAudience("all", { focusTab: true });
    else {
      cycleAudience(event.key === "ArrowLeft" ? -1 : 1, {
        focusTab: true,
      });
    }
  });
  ui.panel.addEventListener("pointerdown", wakeChat);
  ui.panel.addEventListener("pointermove", wakeChat);
  ui.panel.addEventListener("focusin", wakeChat);
  ui.textarea.addEventListener("focus", () => {
    setInputCapture(true);
    wakeChat();
  });
  ui.textarea.addEventListener("blur", () => {
    setInputCapture(false);
    if (state.visibilityPhase === "active") wakeChat();
  });
  ui.textarea.addEventListener("input", () => {
    state.draftsByScope[state.audience] = String(ui.textarea.value || "");
    wakeChat();
  });
  ui.textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
    wakeChat();
    if (event.key === "Tab") {
      event.preventDefault();
      cycleAudience(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSuppressed(true);
    }
  });
  ui.textarea.addEventListener("keyup", (event) => {
    event.stopPropagation();
  });

  const outsidePointerHandler = (event) => {
    if (!state.isOpen) return;
    const target = event.target;
    if (ui.panel.contains(target) || ui.launcher.contains(target)) return;
    if (document.activeElement === ui.textarea) {
      ui.textarea.blur();
    }
    setInputCapture(false);
    wakeChat();
  };
  document.addEventListener("pointerdown", outsidePointerHandler, true);

  const keyHandler = (event) => {
    const target = event.target;
    if (event.key === "/" || event.code === "Slash") {
      const isChatTextarea =
        target === ui.textarea || (target && target.tagName === "TEXTAREA");
      if (isChatTextarea || target?.tagName === "INPUT" || target?.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      if (!state.isOpen || state.suppressed) {
        setSuppressed(false);
        openComposer();
      } else {
        ui.textarea.focus();
        setInputCapture(true);
      }
      wakeChat();
      return;
    }
    if (
      event.key === "Tab" &&
      state.isOpen &&
      !state.suppressed &&
      target !== ui.textarea &&
      (!target ||
        ui.panel.contains(target) ||
        !(
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable
        ))
    ) {
      event.preventDefault();
      cycleAudience(event.shiftKey ? -1 : 1, {
        focusTab: !!target && audienceTabs.contains(target),
      });
      return;
    }
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
    if (event.key === "Escape" && state.isOpen) {
      event.preventDefault();
      setSuppressed(true);
    }
  };
  document.addEventListener("keydown", keyHandler, true);

  const onChatMessage = (message) => {
    const added = addMessage(message);
    if (!added) return;
    const incomingScope = normalizeScope(message?.scope);
    const currentScope = normalizeScope(state.audience);
    if (state.suppressed) {
      incrementUnread(incomingScope);
      return;
    }
    if (incomingScope === currentScope && state.visibilityPhase !== "hidden") {
      renderMessages({ added: 1 });
      if (ui.scroll.atBottom()) clearUnread(currentScope);
      else incrementUnread(incomingScope);
      return;
    }
    incrementUnread(incomingScope);
  };
  socket?.on?.("game:chat:message", onChatMessage);

  ui.messagesEl.addEventListener("scroll", () => {
    if (state.isOpen && ui.scroll.atBottom()) clearUnread(state.audience);
  });
  syncAudienceUi();
  renderMessages();
  setSuppressed(true);

  return {
    open: openComposer,
    suppress: () => setSuppressed(true),
    destroy: () => {
      ui.destroyComposer();
      state.destroyed = true;
      socket?.off?.("game:chat:message", onChatMessage);
      document.removeEventListener("keydown", keyHandler, true);
      document.removeEventListener("pointerdown", outsidePointerHandler, true);
      setInputCapture(false);
      clearCooldownFeedback();
      clearVisibilityTimer();
      ui.root.remove();
      ui.launcher.remove();
    },
  };
}
