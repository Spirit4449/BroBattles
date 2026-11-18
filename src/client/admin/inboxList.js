import { INBOX_PAGE_SIZE } from "../../shared/site/supportRules.js";
import { createLatestRequest } from "./latestRequest";
import { renderPager } from "../ui/pager";
import { node, button, fetchJson, timeAgo, setAvatar } from "./common";
import { adminInboxPath } from "../../shared/net/apiPaths.js";

export function createInboxList({ state, selectThread, STATUS_LABEL, list, kind, count, pager }) {
  const startList = createLatestRequest();

  function itemCard(item) {
    const card = button(
      null,
      `inbox-item${item.id === state.selectedId ? " is-active" : ""}${item.unread ? " is-unread" : ""}`,
      () => selectThread(item.id),
    );
    card.dataset.requestId = item.id;
    const avatar = setAvatar(Object.assign(node("img", null, "inbox-avatar"), { alt: "" }), {
      userIcon: item.userIcon,
    });
    const body = node("span", null, "inbox-item-body");
    const top = node("span", null, "inbox-item-top");
    top.append(
      node("strong", item.userName || `Player #${item.userId ?? "?"}`),
      node("span", timeAgo(item.updated_at), "muted"),
    );
    const subject = node("span", item.subject, "inbox-subject");
    const preview = node("span", item.preview || "", "inbox-preview");
    const tags = node("span", null, "inbox-tags");
    if (item.category !== "feedback") tags.append(node("span", item.category, "tag"));
    tags.append(
      node("span", STATUS_LABEL[item.status] || item.status, `tag tag-status-${item.status}`),
    );
    if (item.reportSummary) {
      const { totalReports, uniqueReporters } = item.reportSummary;
      tags.append(
        node(
          "span",
          `${totalReports} report${totalReports === 1 ? "" : "s"} on player · ${uniqueReporters} reporter${uniqueReporters === 1 ? "" : "s"}`,
          "tag tag-report-count",
        ),
      );
    }
    if (item.messageCount > 1) tags.append(node("span", `${item.messageCount} messages`, "muted"));
    body.append(top, subject, preview, tags);
    card.append(avatar, body);
    if (item.unread) card.append(node("span", null, "unread-dot"));
    return card;
  }

  async function loadList() {
    const isCurrent = startList();
    list.classList.add("is-loading");
    try {
      const params = new URLSearchParams({
        page: String(state.page),
        status: state.status,
        category: state.category,
      });
      const data = await fetchJson(`${adminInboxPath(kind)}?${params}`);
      if (!isCurrent()) return;
      state.items = data.items;
      state.total = data.total;
      count.textContent = `${data.total}`;
      list.replaceChildren(...data.items.map(itemCard));
      if (!data.items.length) list.append(node("p", "Nothing here. Nice.", "muted pad"));
      const pages = Math.max(1, Math.ceil(data.total / INBOX_PAGE_SIZE));
      renderPager(pager, {
        page: state.page,
        pages,
        className: "icon-button",
        arrowSize: "",
        onPage: (page) => {
          state.page = page;
          loadList();
        },
      });
    } catch (error) {
      if (isCurrent()) list.replaceChildren(node("p", error.message, "muted pad"));
    } finally {
      if (isCurrent()) list.classList.remove("is-loading");
    }
  }

  return { loadList };
}
