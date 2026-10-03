import { createChatScrollController } from './scrollController.mjs';
import { composerHeight } from './composerSize.mjs';
import { buildProfileIconUrl } from "../lib/profileIconAssets.js";
import { sonner } from "../lib/sonner.js";
const GAME_CHAT_RECENT_LIMIT = 40;
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
function bindChatProfile(element, username, onOpenProfile) {
  const name = String(username || "").trim();
  if (!element || !name || typeof onOpenProfile !== "function") return;
  element.classList.add("bb-chat-profile-link");
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `View ${name}'s profile`);
  element.addEventListener("click", (event) => {
    // Dragging across a name should still let the user select/copy it.
    if (window.getSelection()?.toString()) return;
    event.stopPropagation();
    onOpenProfile(name);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onOpenProfile(name);
  });
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
// "You, Spirit, Bolt +2" — compact one-line list of who reacted.
function formatReactorSummary(reactors, currentUserName, maxNames = 3) {
  const current = String(currentUserName || "").trim().toLowerCase();
  const names = [];
  let includesYou = false;
  for (const user of reactors) {
    const name = String(user?.name || "").trim();
    if (!name) continue;
    if (name.toLowerCase() === current) includesYou = true;
    else names.push(name);
  }
  if (includesYou) names.unshift("You");
  const shown = names.slice(0, maxNames).join(", ");
  const extra = names.length - maxNames;
  return extra > 0 ? `${shown} +${extra}` : shown;
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
function showChatRequestError(error, fallbackTitle = "Could not send message") {
  const status = Number(error?.statusCode) || 0;
  const message = !status
    ? "Couldn't reach the server. Check your connection and try again."
    : status >= 500
      ? "Something went wrong. Please try again in a moment."
      : String(error?.message || "Please try again.");
  const suspendedUntilMs = Number(error?.payload?.suspendedUntilMs) || 0;
  const timeLeft = formatSuspensionTime(suspendedUntilMs);
  const finalMessage = timeLeft
    ? `${message} (${timeLeft} remaining)`
    : message;
  // Expected restrictions already explain what happened in a complete sentence.
  sonner(status >= 400 && status < 500 ? null : fallbackTitle, finalMessage, "OK", undefined, {
    duration: 4500,
    tone: "error",
    sound: "notification",
  });
}
function buildInlineCooldownMessage(error, fallback = "Slow down.") {
  const message = String(error?.message || fallback);
  const extra = String(error?.payload?.banWarning || "").trim();
  return extra ? `${message} ${extra}` : message;
}
// Grows the message box with its content (up to five lines).
function bindComposerAutosize(textarea) {
  function resize() {
    if (!textarea.clientWidth) return;
    textarea.style.height = "0px";
    const style = window.getComputedStyle(textarea);
    textarea.style.height = `${composerHeight(textarea.scrollHeight, style)}px`;
  }
  textarea.addEventListener("input", resize);
  textarea.addEventListener("focus", resize);
  let width = 0;
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (textarea.clientWidth === width || frame) return;
    // Height writes during observer delivery can trigger an undelivered loop.
    frame = requestAnimationFrame(() => {
      frame = 0;
      width = textarea.clientWidth;
      resize();
    });
  });
  observer.observe(textarea);
  return { resize, destroy: () => { observer.disconnect(); cancelAnimationFrame(frame); } };
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
  reactionBadge.innerHTML = `<img src="/assets/heart-filled.svg" alt="" width="14" height="14" draggable="false" />`;
  launcher.appendChild(reactionBadge);

  const panel = document.createElement("section");
  panel.className = `bb-chat-shell ${panelClassName}`;
  panel.innerHTML = `
    <div class="bb-chat-header">
      <div class="bb-chat-heading">
        <h2 class="bb-chat-title">Chat (/)</h2>
        <div class="bb-chat-header-status">
          <div class="bb-chat-subtitle">Party only</div>
        </div>
      </div>
      <div class="bb-chat-header-actions">
        <button type="button" class="bb-chat-mini-btn bb-chat-reply-cancel" aria-label="Clear reply">↩</button>
        <button type="button" class="bb-chat-mini-btn bb-chat-close" aria-label="Close chat">×</button>
      </div>
    </div>
    <div class="bb-chat-body">
      <div class="bb-chat-messages"></div>
      <div class="bb-chat-composer">
        <div class="bb-chat-typing is-idle" aria-live="polite">
          <div class="bb-chat-typing-icons"></div>
          <div class="bb-chat-typing-label">
            <span class="bb-chat-typing-text"></span>
            <span class="bb-chat-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </div>
        </div>
        <button type="button" class="bb-chat-jump-latest" hidden aria-label="Jump to latest messages">↓</button>
        <div class="bb-chat-reply-banner hidden"></div>
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
  document.body.appendChild(launcher);

  const textarea = panel.querySelector(".bb-chat-textarea");
  const composerSize = bindComposerAutosize(textarea);
  const resizeComposer = composerSize.resize;

  const scroll = createChatScrollController(
    panel.querySelector(".bb-chat-messages"),
    panel.querySelector(".bb-chat-composer"),
    panel.querySelector(".bb-chat-jump-latest"),
  );
  return {
    scroll,
    resizeComposer,
    destroyComposer: () => { composerSize.destroy(); scroll.destroy(); },
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
    onOpenProfile,
    canReact = true,
    compact = false,
    // Direct messages have reactions but no replies or "viewed by" counts.
    showReply = true,
    showViewCount = true,
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

  bindChatProfile(header.querySelector(".bb-chat-author"), message?.sender?.name, onOpenProfile);
  bindChatProfile(avatar, message?.sender?.name, onOpenProfile);
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
    // Players can't react to their own messages; existing chips stay readable.
    const canReactHere = canReact && !isSelf;
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

    // Hover toolbar sits on the bubble's top edge so it never covers the
    // reaction chips (or their "who reacted" tooltips) along the bottom.
    const actions = document.createElement("div");
    actions.className = "bb-chat-hover-actions";
    // Your own messages get no hover toolbar at all.
    if (showReply && !isSelf) {
      const replyButton = document.createElement("button");
      replyButton.type = "button";
      replyButton.className = "bb-chat-hover-btn";
      replyButton.textContent = "Reply";
      replyButton.disabled = !canReact;
      replyButton.addEventListener("click", () => onReply?.(message));
      actions.appendChild(replyButton);
    }
    if (canReactHere) {
      const reactionRow = document.createElement("div");
      reactionRow.className = "bb-chat-hover-reactions";
      for (const reaction of presetReactions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `bb-chat-hover-btn${message?.myReaction === reaction ? " is-active" : ""}`;
        button.textContent = reaction;
        button.title = message?.myReaction === reaction ? "Remove reaction" : "React";
        button.addEventListener("click", () => onReact?.(message, reaction));
        reactionRow.appendChild(button);
      }
      actions.appendChild(reactionRow);
    }
    if (actions.childElementCount) bubble.appendChild(actions);

    const meta = document.createElement("div");
    meta.className = "bb-chat-message-meta";
    const inlineReactions = document.createElement("div");
    inlineReactions.className = "bb-chat-inline-reactions";
    for (const reaction of usedReactions) {
      const count = Number(reactionCounts.get(reaction)) || 0;
      // Read-only chips are plain elements: hover/focus tooltip, no click.
      const button = document.createElement(canReactHere ? "button" : "span");
      if (canReactHere) button.type = "button";
      else button.tabIndex = 0;
      button.className = `bb-chat-inline-reaction${message?.myReaction === reaction ? " is-active" : ""}${
        message?._reactionPulse === reaction ? " is-pop" : ""
      }${canReactHere ? "" : " is-readonly"}`;
      button.textContent = `${reaction} ${count}`;
      const reactors = Array.isArray(reactionUsers?.[reaction])
        ? reactionUsers[reaction]
        : [];
      if (reactors.length) {
        button.dataset.tooltip = formatReactorSummary(reactors, currentUserName);
        button.setAttribute("aria-label", `${reaction} ${button.dataset.tooltip}`);
      }
      if (canReactHere) button.addEventListener("click", () => onReact?.(message, reaction));
      inlineReactions.appendChild(button);
    }
    if (usedReactions.length) meta.appendChild(inlineReactions);

    if (showViewCount) {
      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = `bb-chat-view-count${Number(message?.viewCount) > 0 ? " is-read" : ""}`;
      viewButton.textContent = `${Number(message?.viewCount) || 0}`;
      viewButton.title = "Viewed by";
      viewButton.addEventListener("click", (event) =>
        onOpenViewers?.(message, event.currentTarget),
      );
      meta.appendChild(viewButton);
    }
    if (meta.childElementCount) bubble.appendChild(meta);
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
function normalizeGameTeam(team) {
  const raw = String(team || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (raw === "1" || raw === "team1" || raw === "blue") return "team1";
  if (raw === "2" || raw === "team2" || raw === "red") return "team2";
  return raw;
}
function renderGameChatLineMessage(message, currentUserName, localTeam) {
  const row = document.createElement("article");
  row.dataset.messageId = String(message?.id || "");
  const senderName = String(message?.sender?.name || "Player");
  const bodyText = String(message?.body || "").trim();
  const scope =
    String(message?.scope || "team").toLowerCase() === "all" ? "all" : "team";
  const isSelf =
    senderName.trim().toLowerCase() ===
    String(currentUserName || "")
      .trim()
      .toLowerCase();
  const senderTeam = normalizeGameTeam(message?.sender?.team);
  const userTeam = normalizeGameTeam(localTeam || "team1") || "team1";
  const teamClass =
    scope === "all"
      ? senderTeam && senderTeam === userTeam
        ? " is-team-blue"
        : isSelf
          ? " is-team-blue"
          : " is-team-red"
      : " is-team-blue";
  row.className = `bb-chat-game-line${isSelf ? " is-self" : ""}${teamClass}`;

  const name = document.createElement("span");
  name.className = "bb-chat-game-line-name";
  name.textContent = isSelf ? `${senderName} (You):` : `${senderName}:`;
  name.title = isSelf ? `${senderName} (You)` : senderName;

  const body = document.createElement("span");
  body.className = "bb-chat-game-line-body";
  body.textContent = bodyText;

  row.appendChild(name);
  row.appendChild(body);
  return row;
}
export { formatReactorSummary, bindComposerAutosize, bindChatProfile, escapeHtml, formatChatTime, buildAvatarUrl, createAvatarEl, messageIdOf, formatNameWithYou, postJson, formatSuspensionTime, showChatRequestError, buildInlineCooldownMessage, makeChatShell, renderPartyChatMessage, normalizeGameTeam, renderGameChatLineMessage, GAME_CHAT_RECENT_LIMIT, LOBBY_TYPING_IDLE_STOP_MS, LOBBY_TYPING_HEARTBEAT_MS, LOBBY_TYPING_STALE_MS, LOBBY_CHAT_BUBBLE_MS };
