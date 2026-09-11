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
function showChatRequestError(error, fallbackTitle = "Chat") {
  const message = String(error?.message || "Request failed");
  const suspendedUntilMs = Number(error?.payload?.suspendedUntilMs) || 0;
  const timeLeft = formatSuspensionTime(suspendedUntilMs);
  const finalMessage = timeLeft
    ? `${message} (${timeLeft} remaining)`
    : message;
  sonner(fallbackTitle, finalMessage, "OK", undefined, {
    duration: 4500,
    sound: "notification",
  });
}
function buildInlineCooldownMessage(error, fallback = "Slow down.") {
  const message = String(error?.message || fallback);
  const extra = String(error?.payload?.banWarning || "").trim();
  return extra ? `${message} ${extra}` : message;
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
  reactionBadge.innerHTML = `<img src="/assets/heart-filled.svg" alt="" width="14" height="14" />`;
  launcher.appendChild(reactionBadge);

  const panel = document.createElement("section");
  panel.className = `bb-chat-shell ${panelClassName}`;
  panel.innerHTML = `
    <div class="bb-chat-header">
      <div>
        <h2 class="bb-chat-title">Chat (/)</h2>
        <div class="bb-chat-subtitle">Party only</div>
      </div>
      <div class="bb-chat-header-actions">
        <button type="button" class="bb-chat-mini-btn bb-chat-reply-cancel" aria-label="Clear reply">↩</button>
        <button type="button" class="bb-chat-mini-btn bb-chat-close" aria-label="Close chat">×</button>
      </div>
    </div>
    <div class="bb-chat-body">
      <div class="bb-chat-messages"></div>
      <div class="bb-chat-composer">
        <div class="bb-chat-reply-banner hidden"></div>
        <div class="bb-chat-input-row">
          <textarea class="bb-chat-textarea" rows="1" maxlength="500" placeholder="Write a message..."></textarea>
          <button type="button" class="bb-chat-send">Send</button>
        </div>
        <div class="bb-chat-typing hidden" aria-live="polite">
          <div class="bb-chat-typing-icons"></div>
          <div class="bb-chat-typing-label">
            <span class="bb-chat-typing-text"></span>
            <img class="bb-chat-typing-dots" src="/assets/typing.svg" alt="" width="18" height="12" />
          </div>
        </div>
      </div>
    </div>
  `;

  root.appendChild(backdrop);
  root.appendChild(panel);
  document.body.appendChild(root);
  document.body.appendChild(launcher);

  return {
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
    canReact = true,
    compact = false,
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
    const meta = document.createElement("div");
    meta.className = "bb-chat-message-meta";

    const actions = document.createElement("div");
    actions.className = "bb-chat-hover-actions";

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "bb-chat-hover-btn";
    replyButton.textContent = "Reply";
    replyButton.disabled = !canReact;
    replyButton.addEventListener("click", () => onReply?.(message));
    actions.appendChild(replyButton);

    const reactionRow = document.createElement("div");
    reactionRow.className = "bb-chat-hover-reactions";
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
    const hoverReactions = presetReactions.filter(
      (reaction) => !usedReactions.includes(reaction),
    );
    const shownHoverReactions = hoverReactions.length
      ? hoverReactions
      : presetReactions;

    for (const reaction of shownHoverReactions) {
      const count = reactionCounts.get(reaction) || 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bb-chat-hover-btn${message?.myReaction === reaction ? " is-active" : ""}`;
      button.textContent = reaction;
      button.disabled = !canReact;
      button.addEventListener("click", () => onReact?.(message, reaction));
      reactionRow.appendChild(button);
    }
    actions.appendChild(reactionRow);

    const inlineReactions = document.createElement("div");
    inlineReactions.className = "bb-chat-inline-reactions";
    for (const reaction of usedReactions) {
      const count = Number(reactionCounts.get(reaction)) || 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bb-chat-inline-reaction${message?.myReaction === reaction ? " is-active" : ""}${
        message?._reactionPulse === reaction ? " is-pop" : ""
      }`;
      button.textContent = `${reaction} ${count}`;
      button.disabled = !canReact;
      const reactors = Array.isArray(reactionUsers?.[reaction])
        ? reactionUsers[reaction]
        : [];
      if (reactors.length) {
        button.dataset.tooltip = reactors
          .map((user) => formatNameWithYou(user?.name, currentUserName))
          .join("\n");
      }
      button.addEventListener("click", () => onReact?.(message, reaction));
      inlineReactions.appendChild(button);
    }

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = `bb-chat-view-count${Number(message?.viewCount) > 0 ? " is-read" : ""}`;
    viewButton.textContent = `✓✓ ${Number(message?.viewCount) || 0}`;
    viewButton.title = "Viewed by";
    viewButton.addEventListener("click", (event) =>
      onOpenViewers?.(message, event.currentTarget),
    );

    meta.appendChild(actions);
    meta.appendChild(inlineReactions);
    meta.appendChild(viewButton);
    bubble.appendChild(meta);
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

  const body = document.createElement("span");
  body.className = "bb-chat-game-line-body";
  body.textContent = bodyText;

  row.appendChild(name);
  row.appendChild(body);
  return row;
}
export { escapeHtml, formatChatTime, buildAvatarUrl, createAvatarEl, messageIdOf, formatNameWithYou, postJson, formatSuspensionTime, showChatRequestError, buildInlineCooldownMessage, makeChatShell, renderPartyChatMessage, normalizeGameTeam, renderGameChatLineMessage, GAME_CHAT_RECENT_LIMIT, LOBBY_TYPING_IDLE_STOP_MS, LOBBY_TYPING_HEARTBEAT_MS, LOBBY_TYPING_STALE_MS, LOBBY_CHAT_BUBBLE_MS };
