
import { makeChatShell, renderGameChatLineMessage, GAME_CHAT_RECENT_LIMIT } from './presentation';

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
    inputCaptureActive: false,
    audience: "team",
    hovering: false,
    hoverUntil: 0,
    typingUntil: 0,
    noticeUntil: 0,
    sentUntil: 0,
    unreadByScope: {
      team: 0,
      all: 0,
    },
    cooldownTimer: null,
    cooldownDraftValue: "",
    messagesByScope: {
      team: [],
      all: [],
    },
    opacityTimer: null,
  };

  const ui = makeChatShell({
    rootClassName: "bb-chat-game-wrap",
    panelClassName: "bb-chat-game-panel",
    launcherLabel: "Chat",
    launcherClassName: "bb-chat-game-launcher",
  });
  ui.clearReplyBtn.style.display = "none";
  ui.replyBanner.style.display = "none";
  ui.titleEl.textContent = "Team Chat";
  if (ui.subtitleEl) ui.subtitleEl.style.display = "none";
  ui.textarea.placeholder = 'Write a message... (Press "/" to focus)';

  const headerActions = ui.panel.querySelector(".bb-chat-header-actions");
  const audienceSelect = document.createElement("select");
  audienceSelect.className = "bb-chat-audience-select";
  audienceSelect.setAttribute("aria-label", "Chat audience");
  audienceSelect.innerHTML = `
    <option value="team">Team</option>
    <option value="all">All Players</option>
  `;
  if (headerActions) {
    headerActions.insertBefore(audienceSelect, ui.closeBtn || null);
  }

  function normalizeScope(scope) {
    return String(scope || "team").toLowerCase() === "all" ? "all" : "team";
  }

  function setUnreadBadge(count) {
    const total = Math.max(0, Number(count) || 0);
    if (total > 0) {
      ui.badge.textContent = String(total);
      ui.badge.classList.remove("hidden");
    } else {
      ui.badge.textContent = "";
      ui.badge.classList.add("hidden");
    }
  }

  function syncUnreadUi() {
    const teamCount = Math.max(0, Number(state.unreadByScope.team) || 0);
    const allCount = Math.max(0, Number(state.unreadByScope.all) || 0);
    const teamOpt = audienceSelect.querySelector('option[value="team"]');
    const allOpt = audienceSelect.querySelector('option[value="all"]');
    if (teamOpt) {
      teamOpt.textContent = teamCount > 0 ? `Team (${teamCount})` : "Team";
    }
    if (allOpt) {
      allOpt.textContent =
        allCount > 0 ? `All Players (${allCount})` : "All Players";
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
    audienceSelect.value = state.audience;
    ui.titleEl.textContent =
      state.audience === "all" ? "All Players Chat" : "Team Chat";
    syncUnreadUi();
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
    syncGameChatOpacity();
    scheduleOpacityTick();
  }

  function clearOpacityTimer() {
    if (state.opacityTimer) {
      window.clearTimeout(state.opacityTimer);
      state.opacityTimer = null;
    }
  }

  function scheduleOpacityTick() {
    clearOpacityTimer();
    const now = Date.now();
    const deadlines = [
      Number(state.hoverUntil) || 0,
      Number(state.typingUntil) || 0,
      Number(state.noticeUntil) || 0,
      Number(state.sentUntil) || 0,
    ].filter((ts) => ts > now);
    if (!deadlines.length) return;
    const nextAt = Math.min(...deadlines);
    const waitMs = Math.max(16, nextAt - now + 8);
    state.opacityTimer = window.setTimeout(() => {
      state.opacityTimer = null;
      syncGameChatOpacity();
      scheduleOpacityTick();
    }, waitMs);
  }

  function bumpOpacity(kind = "notice", durationMs = 500) {
    const until = Date.now() + Math.max(0, Number(durationMs) || 0);
    if (kind === "hover") {
      state.hoverUntil = Math.max(Number(state.hoverUntil) || 0, until);
    } else if (kind === "typing") {
      state.typingUntil = Math.max(Number(state.typingUntil) || 0, until);
    } else if (kind === "sent") {
      state.sentUntil = Math.max(Number(state.sentUntil) || 0, until);
    } else {
      state.noticeUntil = Math.max(Number(state.noticeUntil) || 0, until);
    }
    syncGameChatOpacity();
    scheduleOpacityTick();
  }

  function syncGameChatOpacity() {
    const now = Date.now();
    const shouldBeFull =
      !!state.inputCaptureActive ||
      !!state.hovering ||
      now < Number(state.hoverUntil || 0) ||
      now < Number(state.typingUntil || 0) ||
      now < Number(state.sentUntil || 0);
    const shouldBeNoticed =
      !shouldBeFull && state.isOpen && now < Number(state.noticeUntil || 0);
    ui.panel.classList.toggle("is-active", shouldBeFull);
    ui.panel.classList.toggle("is-notice", shouldBeNoticed);
    ui.panel.classList.toggle(
      "is-idle",
      state.isOpen && !shouldBeFull && !shouldBeNoticed && !state.suppressed,
    );
  }

  function setActive(active) {
    state.isOpen = !!active;
    ui.panel.classList.toggle("is-open", state.isOpen);
    ui.panel.classList.toggle("is-muted", !state.isOpen && state.suppressed);
    ui.panel.classList.toggle("is-idle", !state.isOpen && !state.suppressed);
    syncGameChatOpacity();
    if (state.isOpen) {
      clearUnread(state.audience);
      ui.textarea.focus();
      setInputCapture(true);
      return;
    }
    setInputCapture(false);
    ui.textarea.blur();
  }

  function setSuppressed(suppressed) {
    state.suppressed = !!suppressed;
    if (state.suppressed) {
      state.isOpen = false;
      setInputCapture(false);
      ui.textarea.blur();
      ui.panel.classList.add("is-muted");
      ui.panel.classList.remove("is-open");
      syncGameChatOpacity();
    } else {
      ui.panel.classList.remove("is-muted");
      syncGameChatOpacity();
    }
  }

  function renderMessages() {
    ui.messagesEl.innerHTML = "";
    const currentUser = String(getUsername?.() || "");
    const localTeam = getGameData?.()?.yourTeam || "team1";
    const selectedAudience = String(state.audience || "team").toLowerCase();
    const list =
      selectedAudience === "all"
        ? state.messagesByScope.all
        : state.messagesByScope.team;
    for (const message of list) {
      ui.messagesEl.appendChild(
        renderGameChatLineMessage(message, currentUser, localTeam),
      );
    }
    ui.messagesEl.scrollTop = ui.messagesEl.scrollHeight;
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
    ui.textarea.value = String(state.cooldownDraftValue || "");
    ui.textarea.placeholder = 'Write a message... (Press "/" to focus)';
    state.cooldownDraftValue = "";
  }

  function applyInlineRateLimitMessage(message, durationMs = 2200) {
    const duration = Math.max(900, Number(durationMs) || 2200);
    if (!ui.textarea.disabled) {
      state.cooldownDraftValue = String(ui.textarea.value || "");
    }
    ui.textarea.disabled = true;
    ui.sendBtn.disabled = true;
    ui.textarea.value = String(message || "Slow down.");
    ui.textarea.placeholder = ui.textarea.value;

    if (state.cooldownTimer) {
      window.clearTimeout(state.cooldownTimer);
      state.cooldownTimer = null;
    }
    state.cooldownTimer = window.setTimeout(() => {
      state.cooldownTimer = null;
      ui.textarea.disabled = false;
      ui.sendBtn.disabled = false;
      ui.textarea.value = String(state.cooldownDraftValue || "");
      ui.textarea.placeholder = 'Write a message... (Press "/" to focus)';
      state.cooldownDraftValue = "";
    }, duration);
  }

  async function sendMessage() {
    const body = String(ui.textarea.value || "").trim();
    if (!body) return;
    const payload = {
      body,
      matchId: Number(getGameData?.()?.gameId || 0) || null,
      scope: state.audience,
    };
    ui.sendBtn.disabled = true;
    try {
      const ack = await new Promise((resolve, reject) => {
        socket?.emit?.("game:chat:send", payload, (result) => {
          if (result?.ok) {
            resolve(result.message);
            return;
          }
          const error = new Error(result?.error || "Failed to send chat");
          error.payload = result || {};
          reject(error);
        });
      });
      ui.textarea.value = "";
      addMessage(ack);
      renderMessages();
      clearUnread(state.audience);
      bumpOpacity("sent", 2000);
    } catch (error) {
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
      if (!ui.textarea.disabled) {
        ui.sendBtn.disabled = false;
      }
      ui.textarea.blur();
      setInputCapture(false);
    }
  }

  function openComposer() {
    setSuppressed(false);
    setActive(true);
  }

  function closeComposer() {
    setActive(false);
  }

  ui.launcher.addEventListener("click", () => {
    if (state.suppressed) {
      setSuppressed(false);
      openComposer();
      return;
    }
    if (state.isOpen) closeComposer();
    else openComposer();
  });
  ui.sendBtn.addEventListener("click", () => void sendMessage());
  ui.closeBtn.addEventListener("click", () => setSuppressed(true));
  ui.clearReplyBtn.addEventListener("click", () => {});
  audienceSelect.addEventListener("change", () => {
    state.audience = normalizeScope(audienceSelect.value);
    syncAudienceUi();
    renderMessages();
    if (state.isOpen && !state.suppressed) {
      clearUnread(state.audience);
    }
    bumpOpacity("notice", 500);
  });
  ui.panel.addEventListener("mouseenter", () => {
    state.hovering = true;
    bumpOpacity("hover", 500);
  });
  ui.panel.addEventListener("mouseleave", () => {
    state.hovering = false;
    bumpOpacity("hover", 500);
  });
  ui.textarea.addEventListener("focus", () => {
    setInputCapture(true);
    bumpOpacity("typing", 500);
  });
  ui.textarea.addEventListener("blur", () => {
    setInputCapture(false);
  });
  ui.textarea.addEventListener("input", () => {
    bumpOpacity("typing", 500);
  });
  ui.textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
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
    syncGameChatOpacity();
  };
  document.addEventListener("pointerdown", outsidePointerHandler, true);

  const keyHandler = (event) => {
    const target = event.target;
    if (event.key === "/" || event.code === "Slash") {
      const isChatTextarea =
        target === ui.textarea || (target && target.tagName === "TEXTAREA");
      if (isChatTextarea) return;
      event.preventDefault();
      if (!state.isOpen || state.suppressed) {
        setSuppressed(false);
        openComposer();
      } else {
        ui.textarea.focus();
        setInputCapture(true);
      }
      bumpOpacity("typing", 500);
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

  socket?.on?.("game:chat:message", (message) => {
    const added = addMessage(message);
    if (!added) return;
    const incomingScope = normalizeScope(message?.scope);
    const currentScope = normalizeScope(state.audience);
    if (state.suppressed) {
      incrementUnread(incomingScope);
      bumpOpacity("notice", 500);
      return;
    }
    if (incomingScope === currentScope) {
      renderMessages();
      clearUnread(currentScope);
      bumpOpacity("notice", 500);
      return;
    }
    incrementUnread(incomingScope);
  });

  syncAudienceUi();
  setSuppressed(true);
  syncGameChatOpacity();

  return {
    open: openComposer,
    suppress: () => setSuppressed(true),
    destroy: () => {
      document.removeEventListener("keydown", keyHandler, true);
      document.removeEventListener("pointerdown", outsidePointerHandler, true);
      setInputCapture(false);
      clearCooldownFeedback();
      clearOpacityTimer();
      ui.root.remove();
      ui.launcher.remove();
    },
  };
}
