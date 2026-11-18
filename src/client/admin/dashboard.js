import { API_PATHS } from "../../shared/net/apiPaths.js";
import { $, node, button, fmt, signed, currencyIcon, setAvatar, fetchJson, formatAdminDate, timeAgo, setStatus } from "./common";
import { state, playerTools } from "./adminState";
import { populateRuntimeForm, runtimeSnapshot, updateRuntimeState } from "./runtime";
import { openGrantDialog } from "./grants";
import { openPlayer } from "./players";

// ---- Overview ----
function renderStats(stats) {
  for (const key of ["users", "guests", "parties", "live_matches"]) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el && stats?.[key] !== undefined) el.textContent = fmt(stats[key]);
  }
}

const emptyItem = (text) => node("li", text, "muted empty");

function renderRecentUsers(list) {
  const host = $("#recentUsers");
  host.replaceChildren();
  if (!list?.length) return host.append(emptyItem("No players yet"));
  for (const user of list) {
    const li = node("li", null, "user-item");
    const open = button(null, "row-link", () => openPlayer(user.user_id));
    open.append(setAvatar(Object.assign(node("img", null, "row-avatar"), { alt: "" }), user), node("strong", user.name));
    li.append(open, node("span", `#${user.user_id} · ${user.status || "offline"}`, "muted row-sub"), button("+ Grant", "mini", () => openGrantDialog([user])));
    host.append(li);
  }
}

function renderRecentMatches(list) {
  const host = $("#recentMatches");
  host.replaceChildren();
  if (!list?.length) return host.append(emptyItem("No matches yet"));
  for (const match of list) {
    const li = node("li");
    li.append(node("strong", `Match #${match.match_id}`), node("span", `${match.mode} · ${match.map}`, "muted"), node("span", match.status, `tag tag-${match.status}`), node("span", timeAgo(match.created_at), "row-meta"));
    host.append(li);
  }
}

function renderShopSummary(shop) {
  const host = $("#shopSummary");
  host.replaceChildren();
  const add = (label, value, className = "") => host.append(node("dt", label), node("dd", value, className));
  if (!shop) return add("Status", "Unavailable");
  const problems = shop.catalogErrors?.length || 0;
  add("Catalog", shop.error ? shop.error : problems ? `${problems} problem${problems === 1 ? "" : "s"}. The shop is off until fixed.` : "Healthy", shop.error || problems ? "bad-text" : "good-text");
  add("Payments", shop.payment?.enabled ? "Stripe on" : "Stripe off", shop.payment?.enabled ? "good-text" : "");
  if (shop.rotations?.sales) add("Next sale reset", formatAdminDate(shop.rotations.sales.nextRefreshAt, true));
  if (shop.rotations?.dailies) add("Next daily reset", formatAdminDate(shop.rotations.dailies.nextRefreshAt, true));
  const orders = shop.recentOrders || [];
  add("Latest order", orders[0] ? `${timeAgo(orders[0].created_at)} · ${orders[0].status}` : "None yet");
}

async function loadGrants() {
  const host = $("#recentGrants");
  try {
    const { grants } = await fetchJson(API_PATHS.API_ADMIN_GRANTS);
    host.replaceChildren();
    if (!grants.length) return host.append(emptyItem("No grants yet. Press G to give coins or gems."));
    for (const grant of grants.slice(0, 8)) {
      const li = node("li");
      const amount = node("span", null, `amount ${grant.amount < 0 ? "is-negative" : ""}`);
      amount.append(currencyIcon(grant.currency, 16), document.createTextNode(signed(grant.amount)));
      li.append(button(grant.name || `#${grant.user_id}`, "row-link", () => openPlayer(grant.user_id)), amount, node("span", grant.note || "", "muted note"), node("span", timeAgo(grant.created_at), "row-meta"));
      host.append(li);
    }
  } catch (error) {
    host.replaceChildren(emptyItem(error.message));
  }
}

async function handleBootstrap() {
  try {
    const data = await fetchJson(API_PATHS.API_ADMIN_BOOTSTRAP);
    state.runtime = data.runtime;
    renderStats(data.stats);
    renderRecentUsers(data.recentUsers);
    renderRecentMatches(data.recentMatches);
    renderShopSummary(data.shop);
    populateRuntimeForm(data.runtime);
    playerTools.savedRuntime = runtimeSnapshot();
    updateRuntimeState();
    $("#adminName").textContent = data.admin?.name || "Admin";
    setStatus(`Dashboard loaded · ${formatAdminDate(new Date(), true)}`);
  } catch (err) {
    const banner = $("#errorBanner");
    banner.textContent = err.message || "Failed to load dashboard";
    banner.classList.remove("hidden");
    setStatus(banner.textContent, true);
  }
}

export { loadGrants, handleBootstrap };

