import { INBOX_CATEGORIES, STATUS_LABEL } from "../../shared/site/supportRules.js";
import { createInboxList } from "./inboxList";
import { createInboxThread } from "./inboxThread";
import { formatBadgeCount } from "../chat/badges.mjs";
import { adminInboxPath } from "../../shared/net/apiPaths.js";
// Feedback and support inboxes. Conversations reuse the in-game chat look
// (bb-chat-* classes from styles/chat.css): player on the left, staff on the right.

import { node, button, fetchJson, titleCase } from "./common";

const statusFilters = [["", "All"], ...Object.entries(STATUS_LABEL)];
let onPlayerSelected = () => {};
const openPlayer = (id) => onPlayerSelected(id);

export function setInboxPlayerOpener(fn) {
  onPlayerSelected = fn;
}

export async function refreshInboxBadges() {
  await Promise.all(
    ["feedback", "support"].map(async (kind) => {
      const badge = document.querySelector(`[data-inbox-badge="${kind}"]`);
      try {
        const data = await fetchJson(`${adminInboxPath(kind)}?status=open`);
        badge.textContent = formatBadgeCount(data.total);
        badge.hidden = !data.total;
      } catch {
        badge.hidden = true;
      }
    }),
  );
}

const submissionKey = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function initInbox(root, kind) {
  const state = {
    status: kind === "support" ? "open" : "",
    category: "",
    page: 1,
    total: 0,
    items: [],
    selectedId: null,
  };
  root.className = "inbox";

  // ---- Toolbar ----
  const toolbar = node("div", null, "inbox-toolbar");
  const title = node(
    "h1",
    kind === "support" ? "Support requests" : "Player feedback",
    "view-title",
  );
  const count = node("span", null, "count-chip");
  title.append(count);
  const statusStrip = node("div", null, "segmented");
  const statusButtons = statusFilters.map(([value, label]) => {
    const el = button(label, value === state.status ? "is-active" : "", () => {
      state.status = value;
      state.page = 1;
      statusButtons.forEach((b) => b.classList.toggle("is-active", b === el));
      loadList();
    });
    statusStrip.append(el);
    return el;
  });
  const category = node("select", null, "inbox-category");
  category.setAttribute("aria-label", "Category");
  for (const value of ["", ...INBOX_CATEGORIES])
    category.append(
      Object.assign(node("option", value ? titleCase(value) : "All categories"), { value }),
    );
  category.addEventListener("change", () => {
    state.category = category.value;
    state.page = 1;
    loadList();
  });
  const refresh = button("Refresh", "", () => {
    loadList();
    if (state.selectedId) loadThread(state.selectedId, { keepScroll: true });
  });
  // New feedback has no topic, so only support requests filter by category.
  toolbar.append(
    title,
    node("span", null, "spacer"),
    statusStrip,
    ...(kind === "support" ? [category] : []),
    refresh,
  );

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
    empty.append(
      Object.assign(node("img"), {
        src: "/assets/icons/chat.webp",
        alt: "",
        width: 48,
        height: 48,
      }),
      node(
        "p",
        kind === "support"
          ? "Pick a request to read the conversation and reply."
          : "Pick a feedback entry to read it.",
      ),
    );
    thread.replaceChildren(empty);
  }

  const selectThread = (id) => loadThread(id);

  const { loadList } = createInboxList({
    state,
    selectThread,
    STATUS_LABEL,
    list,
    kind,
    count,
    pager,
  });
  const { loadThread } = createInboxThread({
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
  });

  loadList();
}
