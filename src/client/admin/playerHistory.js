import { $, node, titleCase, timeAgo, formatAdminDate } from "./common";
import { isAccountBanned } from "../../shared/moderation/accountBan";
export function renderPlayerSubtitle(user) {
  const tags = [node("span", user.expires_at ? "Guest" : "Account", "player-meta-tag")];
  const status = user.status || "offline";
  const presence = node("span", null, "player-meta-tag");
  presence.append(
    node("span", null, `presence presence-${status}`),
    document.createTextNode(titleCase(status)),
  );
  tags.push(presence);
  if (isAccountBanned(user))
    tags.push(
      node("span", user.ban_expires_at ? "Suspended" : "Banned", "player-meta-tag is-restricted"),
    );
  const joined = node(
    "span",
    `Joined ${formatAdminDate(user.created_at, true)}`,
    "player-meta-tag",
  );
  joined.title = formatAdminDate(user.created_at);
  const seen = node(
    "span",
    `Last seen ${user.last_seen_at ? timeAgo(user.last_seen_at) : "unknown"}`,
    "player-meta-tag",
  );
  seen.title = user.last_seen_at ? formatAdminDate(user.last_seen_at) : "No activity recorded";
  tags.push(joined, seen);
  $("#playerSubtitle").replaceChildren(...tags);
}

function detailList(title, rows) {
  const section = node("article", null, "panel");
  section.append(node("div", title, "panel-title"));
  const list = node("dl", null, "detail-list");
  for (const [label, value] of rows)
    list.append(node("dt", label), node("dd", value == null || value === "" ? "—" : String(value)));
  section.append(list);
  return section;
}

export function historyTable(title, data) {
  const section = node("article", null, "panel");
  section.append(
    node("div", `${title}${data?.rows ? ` · ${data.rows.length}` : ""}`, "panel-title"),
  );
  if (data?.error || !data?.rows?.length) {
    section.append(node("p", data?.error || "No records yet.", "muted"));
    return section;
  }
  const wrap = node("div", null, "table-wrap");
  const table = node("table");
  const columns = Object.keys(data.rows[0]);
  const head = node("tr");
  for (const column of columns) head.append(node("th", column.replaceAll("_", " ")));
  table.append(node("thead"), node("tbody"));
  table.tHead.append(head);
  for (const row of data.rows) {
    const tr = node("tr");
    for (const column of columns) {
      const value = row[column];
      const cell = node(
        "td",
        column.endsWith("_at") ? formatAdminDate(value, true) : value == null ? "—" : String(value),
      );
      if (column === "amount" && Number(value) < 0) cell.className = "is-negative";
      if (column === "amount" && Number(value) > 0) cell.className = "is-positive";
      tr.append(cell);
    }
    table.tBodies[0].append(tr);
  }
  wrap.append(table);
  section.append(wrap);
  return section;
}

export function renderPlayerDetails(user, history) {
  $("#currencyHistory").replaceChildren(historyTable("Currency activity", history.currency));
  $("#playerDetails").replaceChildren(
    historyTable("Recent matches", history.matches),
    historyTable("Recent orders", history.orders),
    historyTable("Moderation events", history.moderation),
  );
  $("#playerOverview").replaceChildren(
    detailList("Account & profile", [
      ["Account type", user.expires_at ? "Guest" : "Permanent"],
      ["Created", formatAdminDate(user.created_at)],
      ["Updated", formatAdminDate(user.updated_at)],
      ["Guest expiry", formatAdminDate(user.expires_at)],
      ["Peak trophies", user.trophy_peak],
      ["Profile icon", user.selected_profile_icon_id],
      ["Player card", user.selected_card_id],
    ]),
    detailList("Moderation status", [
      [
        "Restricted",
        isAccountBanned(user)
          ? user.ban_expires_at
            ? "Temporarily suspended"
            : "Permanently banned"
          : "No",
      ],
      ["Expires", formatAdminDate(user.ban_expires_at)],
      ["Ban reason", user.ban_reason],
      ["Banned at", formatAdminDate(user.banned_at)],
      ["Chat suspended until", formatAdminDate(user.chat_suspended_until)],
      ["Matchmaking suspended until", formatAdminDate(user.mm_suspended_until)],
    ]),
  );
}
