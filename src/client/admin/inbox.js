// Feedback and support inboxes. Conversations reuse the in-game chat look
// (bb-chat-* classes from styles/chat.css): player on the left, staff on the right.
import { pixelArrow } from "../ui/pixelArrow.js";
import { $, node, button, fetchJson, formatAdminDate, timeAgo, titleCase, setAvatar, showToast } from "./common";

const CATEGORIES = ["bug", "idea", "gameplay", "account", "purchase", "safety", "privacy", "other"];
const STATUSES = [["", "All"], ["open", "Open"], ["in_progress", "In progress"], ["closed", "Closed"]];
const STATUS_LABEL = { open: "Open", in_progress: "In progress", closed: "Closed" };
let openPlayer = () => {};

export function setInboxPlayerOpener(fn) { openPlayer = fn; }

export async function refreshInboxBadges() {
  await Promise.all(["feedback", "support"].map(async (kind) => {
    const badge = document.querySelector(`[data-inbox-badge="${kind}"]`);
    try {
      const data = await fetchJson(`/api/admin/${kind}?status=open`);
      badge.textContent = data.total > 99 ? "99+" : String(data.total);
      badge.hidden = !data.total;
    } catch { badge.hidden = true; }
  }));
}

const submissionKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function initInbox(root, kind) {
  const state = { status: kind === "support" ? "open" : "", category: "", page: 1, total: 0, items: [], selectedId: null, generation: 0 };
  root.className = "inbox";

  // ---- Toolbar ----
  const toolbar = node("div", null, "inbox-toolbar");
  const title = node("h1", kind === "support" ? "Support requests" : "Player feedback", "view-title");
  const count = node("span", null, "count-chip");
  title.append(count);
  const statusStrip = node("div", null, "segmented");
  const statusButtons = STATUSES.map(([value, label]) => {
    const el = button(label, value === state.status ? "is-active" : "", () => {
      state.status = value; state.page = 1;
      statusButtons.forEach((b) => b.classList.toggle("is-active", b === el));
      loadList();
    });
    statusStrip.append(el);
    return el;
  });
  const category = node("select", null, "inbox-category");
  category.setAttribute("aria-label", "Category");
  for (const value of ["", ...CATEGORIES, ...(kind === "support" ? ["reports"] : [])]) category.append(Object.assign(node("option", value ? titleCase(value) : "All categories"), { value }));
  category.addEventListener("change", () => { state.category = category.value; state.page = 1; loadList(); });
  const refresh = button("Refresh", "", () => { loadList(); if (state.selectedId) loadThread(state.selectedId, { keepScroll: true }); });
  // New feedback has no topic, so only support requests filter by category.
  toolbar.append(title, node("span", null, "spacer"), statusStrip, ...(kind === "support" ? [category] : []), refresh);

  // ---- Layout ----
  const layout = node("div", null, "inbox-layout");
  const listPane = node("div", null, "inbox-list");
  const list = node("div", null, "inbox-items");
  const pager = node("div", null, "inbox-pager");
  listPane.append(list, pager);
  const thread = node("div", null, "inbox-thread");
  layout.append(listPane, thread);
  root.replaceChildren(toolbar, layout);
  renderEmptyThread();

  function renderEmptyThread() {
    const empty = node("div", null, "inbox-empty");
    empty.append(Object.assign(node("img"), { src: "/assets/icons/chat.webp", alt: "", width: 48, height: 48 }), node("p", kind === "support" ? "Pick a request to read the conversation and reply." : "Pick a feedback entry to read it."));
    thread.replaceChildren(empty);
  }

  function itemCard(item) {
    const card = button(null, `inbox-item${item.id === state.selectedId ? " is-active" : ""}${item.unread ? " is-unread" : ""}`, () => loadThread(item.id));
    card.dataset.requestId = item.id;
    const avatar = setAvatar(Object.assign(node("img", null, "inbox-avatar"), { alt: "" }), { userIcon: item.userIcon });
    const body = node("span", null, "inbox-item-body");
    const top = node("span", null, "inbox-item-top");
    top.append(node("strong", item.userName || `Player #${item.userId ?? "?"}`), node("span", timeAgo(item.updated_at), "muted"));
    const subject = node("span", item.subject, "inbox-subject");
    const preview = node("span", item.preview || "", "inbox-preview");
    const tags = node("span", null, "inbox-tags");
    if (item.category !== "feedback") tags.append(node("span", item.category, "tag"));
    tags.append(node("span", STATUS_LABEL[item.status] || item.status, `tag tag-status-${item.status}`));
    if (item.reportSummary) {
      const { totalReports, uniqueReporters } = item.reportSummary;
      tags.append(node("span", `${totalReports} report${totalReports === 1 ? "" : "s"} on player · ${uniqueReporters} reporter${uniqueReporters === 1 ? "" : "s"}`, "tag tag-report-count"));
    }
    if (item.messageCount > 1) tags.append(node("span", `${item.messageCount} messages`, "muted"));
    body.append(top, subject, preview, tags);
    card.append(avatar, body);
    if (item.unread) card.append(node("span", null, "unread-dot"));
    return card;
  }

  async function loadList() {
    const generation = ++state.generation;
    list.classList.add("is-loading");
    try {
      const params = new URLSearchParams({ page: String(state.page), status: state.status, category: state.category });
      const data = await fetchJson(`/api/admin/${kind}?${params}`);
      if (generation !== state.generation) return;
      state.items = data.items;
      state.total = data.total;
      count.textContent = `${data.total}`;
      list.replaceChildren(...data.items.map(itemCard));
      if (!data.items.length) list.append(node("p", "Nothing here. Nice.", "muted pad"));
      const pages = Math.max(1, Math.ceil(data.total / 20));
      const prev = button(null, "icon-button", () => { state.page -= 1; loadList(); });
      const next = button(null, "icon-button", () => { state.page += 1; loadList(); });
      prev.append(pixelArrow("left"));
      next.append(pixelArrow("right"));
      prev.setAttribute("aria-label", "Previous page");
      next.setAttribute("aria-label", "Next page");
      prev.disabled = state.page <= 1;
      next.disabled = state.page >= pages;
      pager.replaceChildren(prev, node("span", `Page ${state.page} of ${pages}`), next);
    } catch (error) {
      if (generation === state.generation) list.replaceChildren(node("p", error.message, "muted pad"));
    } finally { list.classList.remove("is-loading"); }
  }

  function dayLabel(value) {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
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
    header.append(node("span", self ? "Bro Battles team" : request.userName || `Player #${request.userId}`, "bb-chat-author"), node("span", new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(message.created_at)), "bb-chat-time"));
    bubble.append(header, node("div", message.body, "bb-chat-body-text"));
    if (self) row.append(bubble, avatar); else row.append(avatar, bubble);
    return row;
  }

  async function setStatus(id, status, statusButtonsRow) {
    try {
      await fetchJson(`/api/admin/${kind}/${id}/status`, { method: "POST", body: { status } });
      statusButtonsRow?.forEach((b) => b.classList.toggle("is-active", b.dataset.status === status));
      showToast(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
      loadList();
      refreshInboxBadges();
    } catch (error) { showToast(error.message, true); }
  }

  async function loadThread(id, { keepScroll = false } = {}) {
    state.selectedId = id;
    list.querySelectorAll(".inbox-item").forEach((el) => el.classList.toggle("is-active", Number(el.dataset.requestId) === id));
    if (!keepScroll) thread.classList.add("is-loading");
    try {
      const { request, messages, reportReview } = await fetchJson(`/api/admin/${kind}/${id}`);
      if (state.selectedId !== id) return;
      const card = list.querySelector(`[data-request-id="${id}"]`);
      card?.classList.remove("is-unread");
      card?.querySelector(".unread-dot")?.remove();

      const shell = node("div", null, "bb-chat-shell inbox-chat");
      const header = node("div", null, "bb-chat-header");
      const heading = node("div", null, "inbox-chat-heading");
      heading.append(node("h2", request.subject, "bb-chat-title"), node("div", [`#${request.id}`, request.category !== "feedback" && titleCase(request.category), request.version, `opened ${formatAdminDate(request.created_at, true)}`].filter(Boolean).join(" · "), "bb-chat-subtitle"));
      const actions = node("div", null, "bb-chat-header-actions");
      const player = button(null, "inbox-player", () => openPlayer(request.userId));
      player.title = request.category === "reports" ? "Open the reporter's account" : "Open this player's account";
      player.append(setAvatar(Object.assign(node("img"), { alt: "" }), { userIcon: request.userIcon }), node("span", request.userName || `#${request.userId}`));
      const statusRow = node("div", null, "segmented");
      const statusButtonsRow = ["open", "in_progress", "closed"].map((status) => {
        const el = button(STATUS_LABEL[status], status === request.status ? "is-active" : "", () => setStatus(id, status, statusButtonsRow));
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
      else shell.append(node("p", "Feedback is one-way, so it can't be replied to. Mark it In progress or Closed once it's handled.", "inbox-note"));
      thread.replaceChildren(shell);
      log.scrollTop = log.scrollHeight;
      refreshInboxBadges();
    } catch (error) {
      thread.replaceChildren(node("p", error.message, "muted pad"));
    } finally { thread.classList.remove("is-loading"); }
  }

  function reportReviewPanel(review, selectedId) {
    const panel = node("section", null, "report-review");
    panel.setAttribute("aria-label", "Reported player history");
    const heading = node("div", null, "report-review-heading");
    const identity = node("div");
    identity.append(node("span", "Reported player", "report-review-eyebrow"), node("h3", `${review.targetName} · #${review.targetUserId}`));
    const account = button("Open player account", "", () => openPlayer(review.targetUserId));
    account.disabled = !review.targetExists;
    if (!review.targetExists) account.title = "This account no longer exists";
    heading.append(identity, account);
    const stats = node("dl", null, "report-review-stats");
    for (const [label, value] of [["Saved reports", review.totalReports], ["Reporters", review.uniqueReporters], [`Last ${review.windowDays} days`, review.recentReports], [`Registered (${review.windowDays}d)`, review.recentMemberReporters]]) {
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
    suggestion.append(suggestionHead, node("h4", review.recommendation.title), node("p", review.recommendation.explanation));
    stats.title = 'Counts cover saved reports. Registered means distinct registered reporters in the recent window.';
    panel.append(heading, suggestion, stats);
    if (review.history.length) {
      const history = node("details", null, "report-review-history");
      history.append(node("summary", `Latest ${review.history.length} report${review.history.length === 1 ? "" : "s"}`));
      const items = node("div", null, "report-review-history-items");
      for (const item of review.history) {
        const entry = button(null, "report-review-history-item", () => loadThread(item.id));
        entry.disabled = String(item.id) === String(selectedId);
        entry.append(node("strong", `#${item.id} · ${item.reason}`), node("span", `${item.reporterName || `Account #${item.reporterId}`} · ${formatAdminDate(item.created_at, true)} · ${STATUS_LABEL[item.status] || item.status}`));
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
    text.maxLength = 4000;
    const send = node("button", "Send", "bb-chat-send");
    send.type = "submit";
    row.append(text, send);
    box.append(row);
    let key = submissionKey();
    text.addEventListener("input", () => { key = submissionKey(); });
    box.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (send.disabled) return;
      const message = text.value.trim();
      if (message.length < 5) return showToast("Replies need at least 5 characters", true);
      send.disabled = true;
      try {
        await fetchJson(`/api/admin/support/${id}/messages`, { method: "POST", body: { message, submissionKey: key } });
        showToast("Reply sent");
        await loadThread(id, { keepScroll: true });
        loadList();
      } catch (error) {
        showToast(error.message, true);
      } finally { send.disabled = false; }
    });
    setTimeout(() => text.focus({ preventScroll: true }), 0);
    return box;
  }

  loadList();
}
