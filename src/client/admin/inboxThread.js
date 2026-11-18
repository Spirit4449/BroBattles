import { STATUSES, MESSAGE_MIN, MESSAGE_MAX } from "../../shared/site/supportRules.js";
import { createLatestRequest } from "./latestRequest";
import {
  node,
  button,
  fetchJson,
  formatAdminDate,
  titleCase,
  setAvatar,
  showToast,
} from "./common";
import { adminInboxPath } from "../../shared/net/apiPaths.js";

export function createInboxThread({
  kind,
  STATUS_LABEL,
  loadList,
  refreshInboxBadges,
  state,
  list,
  thread,
  openPlayer,
  selectThread,
  submissionKey,
}) {
  const startThread = createLatestRequest();

  function dayLabel(value) {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function chatMessage(message, request) {
    const self = message.sender === "admin";
    const row = node("div", null, `bb-chat-message${self ? " is-self" : ""}`);
    const avatar = node("div", null, "bb-chat-avatar");
    const img = node("img");
    img.alt = "";
    if (self) img.src = "/assets/logos/logo-small.webp";
    else setAvatar(img, { userIcon: request.userIcon });
    avatar.append(img);
    const bubble = node("div", null, "bb-chat-bubble");
    const header = node("div", null, "bb-chat-message-header");
    header.append(
      node(
        "span",
        self ? "Bro Battles team" : request.userName || `Player #${request.userId}`,
        "bb-chat-author",
      ),
      node(
        "span",
        new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
          new Date(message.created_at),
        ),
        "bb-chat-time",
      ),
    );
    bubble.append(header, node("div", message.body, "bb-chat-body-text"));
    if (self) row.append(bubble, avatar);
    else row.append(avatar, bubble);
    return row;
  }

  async function setStatus(id, status, statusButtonsRow) {
    try {
      await fetchJson(adminInboxPath(kind, id, "status"), { method: "POST", body: { status } });
      statusButtonsRow?.forEach((b) =>
        b.classList.toggle("is-active", b.dataset.status === status),
      );
      showToast(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
      loadList();
      refreshInboxBadges();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function loadThread(id, { keepScroll = false } = {}) {
    const isCurrent = startThread();
    state.selectedId = id;
    list
      .querySelectorAll(".inbox-item")
      .forEach((el) => el.classList.toggle("is-active", Number(el.dataset.requestId) === id));
    if (!keepScroll) thread.classList.add("is-loading");
    try {
      const { request, messages, reportReview } = await fetchJson(adminInboxPath(kind, id));
      if (!isCurrent() || state.selectedId !== id) return;
      const card = list.querySelector(`[data-request-id="${id}"]`);
      card?.classList.remove("is-unread");
      card?.querySelector(".unread-dot")?.remove();

      const shell = node("div", null, "bb-chat-shell inbox-chat");
      const header = node("div", null, "bb-chat-header");
      const heading = node("div", null, "inbox-chat-heading");
      heading.append(
        node("h2", request.subject, "bb-chat-title"),
        node(
          "div",
          [
            `#${request.id}`,
            request.category !== "feedback" && titleCase(request.category),
            request.version,
            `opened ${formatAdminDate(request.created_at, true)}`,
          ]
            .filter(Boolean)
            .join(" · "),
          "bb-chat-subtitle",
        ),
      );
      const actions = node("div", null, "bb-chat-header-actions");
      const player = button(null, "inbox-player", () => openPlayer(request.userId));
      player.title =
        request.category === "reports"
          ? "Open the reporter's account"
          : "Open this player's account";
      player.append(
        setAvatar(Object.assign(node("img"), { alt: "" }), { userIcon: request.userIcon }),
        node("span", request.userName || `#${request.userId}`),
      );
      const statusRow = node("div", null, "segmented");
      const statusButtonsRow = STATUSES.map((status) => {
        const el = button(STATUS_LABEL[status], status === request.status ? "is-active" : "", () =>
          setStatus(id, status, statusButtonsRow),
        );
        el.dataset.status = status;
        statusRow.append(el);
        return el;
      });
      actions.append(player, statusRow);
      header.append(heading, actions);

      const log = node("div", null, "bb-chat-messages");
      if (reportReview) log.append(reportReviewPanel(reportReview, id));
      let lastDay = "";
      for (const message of messages) {
        const day = dayLabel(message.created_at);
        if (day !== lastDay) {
          const divider = node("div", null, "bb-chat-divider");
          divider.append(node("span", day));
          log.append(divider);
          lastDay = day;
        }
        log.append(chatMessage(message, request));
      }
      shell.append(header, log);

      if (kind === "support") shell.append(composer(id));
      else
        shell.append(
          node(
            "p",
            "Feedback is one-way, so it can't be replied to. Mark it In progress or Closed once it's handled.",
            "inbox-note",
          ),
        );
      thread.replaceChildren(shell);
      log.scrollTop = log.scrollHeight;
      refreshInboxBadges();
    } catch (error) {
      if (isCurrent() && state.selectedId === id)
        thread.replaceChildren(node("p", error.message, "muted pad"));
    } finally {
      if (isCurrent()) thread.classList.remove("is-loading");
    }
  }

  function reportReviewPanel(review, selectedId) {
    const panel = node("section", null, "report-review");
    panel.setAttribute("aria-label", "Reported player history");
    const heading = node("div", null, "report-review-heading");
    const identity = node("div");
    identity.append(
      node("span", "Reported player", "report-review-eyebrow"),
      node("h3", `${review.targetName} · #${review.targetUserId}`),
    );
    const account = button("Open player account", "", () => openPlayer(review.targetUserId));
    account.disabled = !review.targetExists;
    if (!review.targetExists) account.title = "This account no longer exists";
    heading.append(identity, account);
    const stats = node("dl", null, "report-review-stats");
    for (const [label, value] of [
      ["Saved reports", review.totalReports],
      ["Reporters", review.uniqueReporters],
      [`Last ${review.windowDays} days`, review.recentReports],
      [`Registered (${review.windowDays}d)`, review.recentMemberReporters],
    ]) {
      const stat = node("div");
      stat.append(node("dt", label), node("dd", Number(value).toLocaleString()));
      stats.append(stat);
    }
    const suggestion = node("div", null, "report-review-suggestion");
    suggestion.dataset.recommendation = review.recommendation.code;
    const suggestionHead = node("div", null, "report-review-suggestion-head");
    const advisory = node("span", "Advisory", "report-review-advisory");
    advisory.title = `Based on ${review.reviewThreshold} distinct registered reporters within ${review.windowDays} days. No automatic punishment.`;
    suggestionHead.append(node("span", "Suggested action", "report-review-eyebrow"), advisory);
    suggestion.append(
      suggestionHead,
      node("h4", review.recommendation.title),
      node("p", review.recommendation.explanation),
    );
    stats.title =
      "Counts cover saved reports. Registered means distinct registered reporters in the recent window.";
    panel.append(heading, suggestion, stats);
    if (review.history.length) {
      const history = node("details", null, "report-review-history");
      history.append(
        node(
          "summary",
          `Latest ${review.history.length} report${review.history.length === 1 ? "" : "s"}`,
        ),
      );
      const items = node("div", null, "report-review-history-items");
      for (const item of review.history) {
        const entry = button(null, "report-review-history-item", () => selectThread(item.id));
        entry.disabled = String(item.id) === String(selectedId);
        entry.append(
          node("strong", `#${item.id} · ${item.reason}`),
          node(
            "span",
            `${item.reporterName || `Account #${item.reporterId}`} · ${formatAdminDate(item.created_at, true)} · ${STATUS_LABEL[item.status] || item.status}`,
          ),
        );
        items.append(entry);
      }
      history.append(items);
      panel.append(history);
    }
    return panel;
  }

  function composer(id) {
    const box = node("form", null, "bb-chat-composer");
    const row = node("div", null, "bb-chat-input-row");
    const text = node("input", null, "inbox-reply-input");
    text.type = "text";
    text.name = "message";
    text.setAttribute("aria-label", "Reply message");
    text.placeholder = "Write a reply…";
    text.maxLength = MESSAGE_MAX;
    const send = node("button", "Send", "bb-chat-send");
    send.type = "submit";
    row.append(text, send);
    box.append(row);
    let key = submissionKey();
    text.addEventListener("input", () => {
      key = submissionKey();
    });
    box.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (send.disabled) return;
      const message = text.value.trim();
      if (message.length < MESSAGE_MIN) return showToast(`Replies need at least ${MESSAGE_MIN} characters`, true);
      send.disabled = true;
      try {
        await fetchJson(adminInboxPath("support", id, "messages"), {
          method: "POST",
          body: { message, submissionKey: key },
        });
        showToast("Reply sent");
        if (state.selectedId === id) await loadThread(id, { keepScroll: true });
        loadList();
      } catch (error) {
        showToast(error.message, true);
      } finally {
        send.disabled = false;
      }
    });
    setTimeout(() => text.focus({ preventScroll: true }), 0);
    return box;
  }

  return { loadThread };
}
