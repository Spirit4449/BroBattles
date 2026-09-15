import "./styles/admin.css";
import { maintenanceClock, maintenanceRemaining } from "./shared/maintenance";
import { LEVEL_CAP } from "./shared/characterStats";
import { characterDefinitions } from "./shared/characters";
import { wireFullscreenToggles } from "./lib/fullscreen.js";

wireFullscreenToggles();

const state = {
  stats: null,
  runtime: null,
  shop: null,
  selectedUser: null,
};

function $(selector) {
  return document.querySelector(selector);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function renderStats(stats) {
  const mapping = [
    ["users", "users"],
    ["guests", "guests"],
    ["parties", "parties"],
    ["live_matches", "live_matches"],
  ];
  for (const [key, dataKey] of mapping) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el && typeof stats?.[dataKey] !== "undefined") {
      el.textContent = stats[dataKey];
    }
  }
}

function renderRecent(list, container) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(list) || !list.length) {
    container.innerHTML = '<li class="muted">No entries</li>';
    return;
  }
  list.forEach((item) => {
    const li = document.createElement("li");
    const title = document.createElement(item.user_id ? "button" : "strong");
    title.textContent = item.name || `Match ${item.match_id}`;
    if (item.user_id) { title.className = "player-link"; title.onclick = () => { switchView("players"); loadPlayer(item.user_id); }; }
    const detail = document.createElement("span");
    detail.textContent = [item.status, item.mode ? `Mode ${item.mode} · Map ${item.map}` : "", formatAdminDate(item.created_at)].filter(Boolean).join(" · ");
    li.append(title, detail);
    container.appendChild(li);
  });
}

function populateRuntimeForm(runtime) {
  if (!runtime) return;
  const maintenance = $("#maintenanceUntil");
  const announcement = $("#announcementField");
  const coins = $("#rewardCoinMultiplier");
  const gems = $("#rewardGemMultiplier");
  const floor = $("#rewardFloor");
  const ceiling = $("#rewardCeiling");
  if (maintenance) {
    const date = new Date(runtime.maintenanceUntil);
    maintenance.value = runtime.maintenanceMode && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  }
  if (announcement) announcement.value = runtime.announcements || "";
  if (coins) coins.value = runtime?.rewardMultipliers?.coins?.toString() || "1";
  if (gems) gems.value = runtime?.rewardMultipliers?.gems?.toString() || "1";
  if (floor) floor.value = runtime?.rewardFloor ?? 5;
  if (ceiling) ceiling.value = runtime?.rewardCeiling ?? 500;
}

function formatAdminDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function renderShopAdmin(shop) {
  state.shop = shop || null;
  const error = $("#shopAdminError");
  if (error) {
    error.textContent = shop?.error || "";
    error.classList.toggle("hidden", !shop?.error);
  }

  const payment = shop?.payment || {};
  const paymentStatus = $("#shopPaymentStatus");
  if (paymentStatus) {
    paymentStatus.textContent = payment.enabled
      ? "Stripe enabled"
      : `Stripe disabled${payment.missing?.length ? ` · ${payment.missing.join(", ")}` : ""}`;
    paymentStatus.classList.toggle("is-enabled", !!payment.enabled);
  }

  const rotations = shop?.rotations || {};
  const dailies = rotations.dailies || {};
  const sales = rotations.sales || {};
  if ($("#shopDailiesCycle")) {
    $("#shopDailiesCycle").textContent = dailies.cycleKey || "Unavailable";
  }
  if ($("#shopSalesCycle")) {
    $("#shopSalesCycle").textContent = sales.cycleKey || "Unavailable";
  }
  if ($("#shopDailiesReset")) {
    $("#shopDailiesReset").textContent = `Next reset: ${formatAdminDate(dailies.nextRefreshAt)}`;
  }
  if ($("#shopSalesReset")) {
    $("#shopSalesReset").textContent = `Next reset: ${formatAdminDate(sales.nextRefreshAt)}`;
  }
  if ($("#shopTimezone")) {
    $("#shopTimezone").textContent = `Reset timezone: ${rotations.timezone || "America/New_York"}`;
  }
  const catalogErrors = Array.isArray(shop?.catalogErrors)
    ? shop.catalogErrors
    : [];
  if ($("#shopCatalogHealth")) {
    $("#shopCatalogHealth").textContent = catalogErrors.length
      ? `Catalog: ${catalogErrors.length} invalid offer(s) failed closed`
      : "Catalog: healthy";
  }

  const orderList = $("#recentShopOrders");
  if (!orderList) return;
  orderList.innerHTML = "";
  const orders = Array.isArray(shop?.recentOrders) ? shop.recentOrders : [];
  if (!orders.length) {
    orderList.innerHTML = '<li class="muted">No shop orders</li>';
    return;
  }
  orders.forEach((order) => {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = `${order.offer_id} · user #${order.user_id}`;
    detail.textContent = `${order.status} · $${(Number(order.amount_cents || 0) / 100).toFixed(2)} ${String(order.currency || "usd").toUpperCase()}`;
    li.append(title, detail);
    orderList.appendChild(li);
  });
}

function populateUserEditor(user) {
  state.selectedUser = user;
  const card = $("#userEditor");
  const placeholder = $("#userPlaceholder");
  const form = $("#userEditForm");
  if (form) form.classList.remove("hidden");
  if (card) card.classList.remove("hidden");
  if (placeholder) placeholder.classList.add("hidden");
  $("#userName").textContent = `${user.name} (#${user.user_id})`;
  $("#fieldName").value = user.name;
  $("#fieldCoins").value = user.coins ?? 0;
  $("#fieldGems").value = user.gems ?? 0;
  $("#fieldTrophies").value = user.trophies ?? 0;
  $("#fieldStatus").value = user.status || "offline";
  $("#fieldClass").value = user.char_class || "ninja";
  const levels = parseLevels(user.char_levels);
  const host = $("#levelFields"); host.replaceChildren();
  for (const character of Object.keys(characterDefinitions)) {
    const label = node("label", character); const input = node("input"); input.type = "number"; input.min = "0"; input.max = String(LEVEL_CAP); input.required = true; input.dataset.character = character; input.value = levels[character] || 0; label.append(input); host.append(label);
  }
}

async function handleBootstrap() {
  try {
    const data = await fetchJson("/api/admin/bootstrap");
    state.stats = data.stats;
    state.runtime = data.runtime;
    state.shop = data.shop;
    renderStats(data.stats);
    renderRecent(data.recentUsers, $("#recentUsers"));
    renderRecent(data.recentMatches, $("#recentMatches"));
    populateRuntimeForm(data.runtime);
    renderShopAdmin(data.shop);
    if ($("#adminName")) {
      $("#adminName").textContent = data.admin?.name || "Admin";
    }
  } catch (err) {
    console.error(err);
    const banner = $("#errorBanner");
    if (banner) {
      banner.textContent = err.message || "Failed to load dashboard";
      banner.classList.remove("hidden");
    }
  }
}

async function handleShopRefresh(event) {
  const button = event.currentTarget;
  const section = String(button?.dataset?.shopRefresh || "");
  if (!section) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    await fetchJson("/api/admin/shop/refresh", {
      method: "POST",
      body: { section },
    });
    showToast(section === "sales" ? "Sales refreshed" : "Dailies refreshed");
    await handleBootstrap();
  } catch (err) {
    showToast(err.message || "Shop refresh failed", true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

let playerPage = 1;
let searchGeneration = 0;
let detailGeneration = 0;
function switchView(view) {
  document.querySelectorAll("[data-view]").forEach(node => { node.hidden = node.dataset.view !== view; });
  document.querySelectorAll("[data-nav]").forEach(node => node.setAttribute("aria-pressed", String(node.dataset.nav === view)));
  const inbox = document.querySelector(`[data-view="${view}"] .inbox-content`);
  if (inbox && !inbox.dataset.loaded) { inbox.dataset.loaded = "true"; renderInbox(inbox, { admin: true, kind: view }); }
}
function node(tag, text, className) {
  const el = document.createElement(tag); if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function searchPlayers() {
  const generation = ++searchGeneration;
  const host = $("#playerResults"); host.textContent = "Loading players…";
  try {
    const data = await fetchJson("/api/admin/user-search", { method: "POST", body: { query: $("#userSearch").value.trim(), page: playerPage } });
    if (generation !== searchGeneration) return;
    host.replaceChildren();
    if (!data.users.length) host.textContent = "No players found. Try another name or ID.";
    for (const user of data.users) {
      const button = node("button", null, "player-result"); button.type = "button";
      button.append(node("strong", user.name), node("span", `#${user.user_id} · ${user.expires_at ? "Guest" : "Account"} · ${user.is_banned ? "Banned" : user.status || "offline"}`), node("small", `${user.trophies ?? 0} trophies · ${user.coins ?? 0} coins · ${user.gems ?? 0} gems`));
      button.onclick = () => loadPlayer(user.user_id); host.append(button);
    }
    const pager = $("#playerPager"); pager.replaceChildren();
    for (const [label, page, disabled] of [["Previous", playerPage - 1, playerPage <= 1], ["Next", playerPage + 1, playerPage * 20 >= data.total]]) {
      const button = node("button", label); button.disabled = disabled; button.onclick = () => { playerPage = page; searchPlayers(); }; pager.append(button);
    }
    pager.append(node("span", `Page ${playerPage} · ${data.total} players`));
  } catch (error) { if (generation === searchGeneration) { host.textContent = error.message; $("#playerPager").replaceChildren(); } }
}
async function handleUserSearch(event) { event.preventDefault(); playerPage = 1; await searchPlayers(); }
function detailSection(title, rows) {
  const section = node("details", null, "player-detail"); section.append(node("summary", title));
  const list = node("dl");
  for (const [label, value] of rows) { list.append(node("dt", label), node("dd", value == null || value === "" ? "—" : String(value))); }
  section.append(list); return section;
}
function renderPlayerDetails(user, history) {
  const historyHost = $("#playerDetails"); historyHost.replaceChildren();
  const host = $("#playerOverview"); host.replaceChildren();
  $("#playerSubtitle").textContent = `${user.expires_at ? "Guest" : "Permanent account"} · ${user.status || "offline"} · ${user.trophies ?? 0} trophies`;
  host.append(detailSection("Account & profile", [["Account type", user.expires_at ? "Guest" : "Permanent"], ["Created", formatAdminDate(user.created_at)], ["Updated", formatAdminDate(user.updated_at)], ["Guest expiry", formatAdminDate(user.expires_at)], ["Peak trophies", user.trophy_peak], ["Profile icon", user.selected_profile_icon_id], ["Player card", user.selected_card_id]]));
  let levels = user.char_levels;
  try { if (typeof levels === "string") levels = JSON.parse(levels); } catch { levels = null; }
  host.append(detailSection("Character levels", Object.entries(levels || {}).length ? Object.entries(levels) : [["Levels", "No levels recorded"]]));
  host.append(detailSection("Moderation status", [["Banned", user.is_banned ? "Yes" : "No"], ["Ban reason", user.ban_reason], ["Banned at", formatAdminDate(user.banned_at)], ["Chat suspended until", formatAdminDate(user.chat_suspended_until)], ["Matchmaking suspended until", formatAdminDate(user.mm_suspended_until)]]));
  for (const [key, title] of [["matches", "Recent matches"], ["orders", "Recent orders"], ["currency", "Currency activity"], ["moderation", "Moderation events"]]) {
    const data = history[key]; const section = node("details", null, "player-detail"); section.append(node("summary", `${title} · ${data?.rows?.length ?? "Unavailable"}`));
    section.append(node("p", "Latest 20 records", "muted"));
    if (data?.error || !data?.rows?.length) section.append(node("p", data?.error || "No records yet."));
    else for (const row of data.rows) section.append(detailSection(key === "matches" ? `Match #${row.match_id} · ${row.status}` : key === "orders" ? `${row.offer_id} · ${row.status}` : `${row.source_type || row.category} · ${formatAdminDate(row.created_at)}`, Object.entries(row).map(([label, value]) => [label.replaceAll("_", " "), label.endsWith("_at") ? formatAdminDate(value) : value])));
    historyHost.append(section);
  }
  host.querySelector("details").open = true;
}
function selectPlayerTab(tab) {
  document.querySelectorAll("[data-player-panel]").forEach(el => el.hidden = el.dataset.playerPanel !== tab);
  document.querySelectorAll("[data-player-tab]").forEach(el => el.setAttribute("aria-pressed", String(el.dataset.playerTab === tab)));
}
async function loadPlayer(id) {
  if (state.selectedUser && isPlayerDirty() && !window.confirm("Discard unsaved player changes?")) return;
  const generation = ++detailGeneration;
  $("#userEditForm").classList.add("hidden"); $("#playerDetails").textContent = "Loading account…";
  try {
    const data = await fetchJson(`/api/admin/users/${id}`);
    if (generation !== detailGeneration) return;
    populateUserEditor(data.user); renderPlayerDetails(data.user, data.history);
    $("#playerDirectory").hidden = true;
    $("#playerWorkspace").hidden = false;
    selectPlayerTab("overview");
    $("#userName").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) { if (generation === detailGeneration) { showToast(error.message, true); if (state.selectedUser) $("#userEditForm").classList.remove("hidden"); } }
}
function parseLevels(value) { try { return (typeof value === "string" ? JSON.parse(value) : value) || {}; } catch { return {}; } }
function playerChanges() {
  const values = { name: $("#fieldName").value.trim(), coins: Number($("#fieldCoins").value), gems: Number($("#fieldGems").value), trophies: Number($("#fieldTrophies").value), char_class: $("#fieldClass").value, status: $("#fieldStatus").value };
  const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== (state.selectedUser?.[key] ?? (["coins", "gems", "trophies"].includes(key) ? 0 : ""))));
  const previousLevels = parseLevels(state.selectedUser?.char_levels);
  const levels = Object.fromEntries([...document.querySelectorAll("[data-character]")].map(input => [input.dataset.character, Number(input.value)]).filter(([key, value]) => value !== (previousLevels[key] || 0)));
  if (Object.keys(levels).length) changes.char_levels = levels;
  return changes;
}
function isPlayerDirty() { return Object.keys(playerChanges()).length > 0; }

async function handleUserUpdate(e) {
  e.preventDefault();
  if (!state.selectedUser) return;
  const payload = {
    userId: state.selectedUser.user_id,
    changes: playerChanges(),
  };
  if (!Object.keys(payload.changes).length) return showToast("No changes to save");
  if (!window.confirm(`Save changes to ${state.selectedUser.name}?\n${Object.entries(payload.changes).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join("\n")}`)) return;
  const button = e.submitter; if (button) button.disabled = true;
  try {
    const data = await fetchJson("/api/admin/user-update", {
      method: "POST",
      body: payload,
    });
    populateUserEditor(data.user);
    showToast("User updated");
    await searchPlayers();
    await loadPlayer(data.user.user_id);
  } catch (err) {
    showToast(err.message || "Update failed", true);
  } finally { if (button) button.disabled = false; }
}

async function handleRuntimeSave(e) {
  e.preventDefault();
  const payload = {
    maintenanceUntil: $("#maintenanceUntil").value ? new Date($("#maintenanceUntil").value).toISOString() : null,
    announcements: $("#announcementField").value,
    rewardMultipliers: {
      coins: Number($("#rewardCoinMultiplier").value),
      gems: Number($("#rewardGemMultiplier").value),
    },
    rewardFloor: Number($("#rewardFloor").value),
    rewardCeiling: Number($("#rewardCeiling").value),
  };
  try {
    const data = await fetchJson("/api/admin/runtime", {
      method: "POST",
      body: payload,
    });
    state.runtime = data.runtime;
    populateRuntimeForm(state.runtime);
    showToast("Runtime overrides saved");
  } catch (err) {
    showToast(err.message || "Save failed", true);
  }
}

function showToast(message, isError = false) {
  const host = $("#toast");
  if (!host) return;
  host.textContent = message;
  host.classList.remove("hidden");
  host.classList.toggle("error", !!isError);
  host.classList.add("visible");
  setTimeout(() => host.classList.remove("visible"), 2400);
}

function init() {
  $("#clearMaintenance").onclick = async () => {
    const button = $("#clearMaintenance");
    const save = $("#runtimeForm button[type=submit]");
    button.disabled = true;
    save.disabled = true;
    try {
      const data = await fetchJson("/api/admin/runtime", {
        method: "POST", body: { maintenanceUntil: null },
      });
      state.runtime = data.runtime;
      $("#maintenanceUntil").value = "";
      $("#maintenanceCountdown").textContent = "Matchmaking enabled";
      showToast("Maintenance turned off. Matchmaking enabled.");
    } catch (error) {
      showToast(error.message || "Could not turn off maintenance", true);
    } finally {
      button.disabled = false;
      save.disabled = false;
    }
  };
  setInterval(() => { const until = state.runtime?.maintenanceUntil; $("#maintenanceCountdown").textContent = maintenanceRemaining(until) > 0 ? `◷ ${maintenanceClock(until)} remaining in maintenance` : "Matchmaking enabled"; }, 1000);
  const searchForm = $("#userSearchForm");
  if (searchForm) searchForm.addEventListener("submit", handleUserSearch);
  const userForm = $("#userEditForm");
  if (userForm) userForm.addEventListener("submit", handleUserUpdate);
  const runtimeForm = $("#runtimeForm");
  if (runtimeForm) runtimeForm.addEventListener("submit", handleRuntimeSave);
  document.querySelectorAll("[data-shop-refresh]").forEach((button) => {
    button.addEventListener("click", handleShopRefresh);
  });
  document.querySelectorAll("[data-nav]").forEach(button => button.onclick = () => switchView(button.dataset.nav));
  document.querySelectorAll("[data-player-tab]").forEach(button => button.onclick = () => selectPlayerTab(button.dataset.playerTab));
  $("#backToPlayers").onclick = () => {
    if (state.selectedUser && isPlayerDirty() && !window.confirm("Discard unsaved player changes?")) return;
    state.selectedUser = null;
    $("#playerDirectory").hidden = false; $("#playerWorkspace").hidden = true;
    $("#userSearch").focus();
  };
  window.addEventListener("beforeunload", event => { if (state.selectedUser && isPlayerDirty()) { event.preventDefault(); event.returnValue = ""; } });
  switchView("overview");
  searchPlayers();
  handleBootstrap();
}

document.addEventListener("DOMContentLoaded", init);

// Support and feedback share storage, with separate admin inboxes.
import { renderInbox } from './site/supportUI';
for (const kind of ['feedback', 'support']) {
  const section = document.createElement('section');
  section.className = 'panel site-admin-inbox';
  section.dataset.view = kind; section.hidden = true;
  const title = document.createElement('h2');
  title.textContent = kind === 'feedback' ? 'Feedback' : 'Support requests';
  const contents = document.createElement('div'); contents.className = 'inbox-content';
  section.append(title, contents);
  (document.querySelector('.admin-shell') || document.body).append(section);

}
