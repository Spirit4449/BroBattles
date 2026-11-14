import { pixelArrow } from "../ui/pixelArrow.js";
import { isAccountBanned } from "../../shared/moderation/accountBan";
import "../styles/chat.css";
import "../styles/admin.css";
import "../site/shell.js";
import { maintenanceClock, maintenanceRemaining } from "../../shared/site/maintenance";
import { LEVEL_CAP, STANDARD_LEVEL_CAP, DEFAULT_CHARACTER, parseCharacterLevels, getCharacterDisplayName } from "../../shared/characters/characterStats";
import { characterDefinitions } from "../../shared/characters";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import { $, node, button, fmt, signed, titleCase, currencyIcon, setAvatar, fetchJson, formatAdminDate, timeAgo, setStatus, showToast, confirmDialog } from "../admin/common";
import { initStore, isStoreDirty, setStorePlayerOpener, onStoreDirtyChange } from "../admin/shop";
import { initInbox, refreshInboxBadges, setInboxPlayerOpener } from "../admin/inbox";
import { createInventoryEditor } from "../admin/playerInventory";

wireFullscreenToggles();

const CHARACTERS = Object.keys(characterDefinitions);
const VIEWS = ["overview", "players", "store", "runtime", "feedback", "support"];
// Preset buttons add to the amount; shift-click subtracts.
const PRESETS = { coins: [100, 500, 1000, 5000, 25000], gems: [10, 50, 100, 500, 1000] };
const PAGE_SIZE = 20;

const state = { runtime: null, selectedUser: null, levelDraft: {}, view: "overview" };
const viewInit = { store: initStore, feedback: (root) => initInbox(root, "feedback"), support: (root) => initInbox(root, "support") };
const initialized = new Set();
let inventoryEditor = null;
let playerStats = null;
let streakSaving = false;

// ---- Navigation ----
async function switchView(view, { updateHash = true } = {}) {
  if (!VIEWS.includes(view)) view = "overview";
  // Leaving Players keeps the open player unless it has unsaved edits the admin discards.
  if (state.view === "players" && view !== "players" && state.selectedUser && isPlayerDirty()) {
    if (!await confirmLeavePlayer()) return false;
    resetPlayer();
  }
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((el) => { el.hidden = el.dataset.view !== view; });
  document.querySelectorAll("[data-nav]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.nav === view)));
  if (viewInit[view] && !initialized.has(view)) {
    initialized.add(view);
    viewInit[view](document.querySelector(`[data-view="${view}"] > div`));
  }
  $("#adminMain").scrollTop = 0;
  if (updateHash) syncHash();
  return true;
}

// The address bar mirrors the open section (and player), so reloads and
// shared links land in the same place: #store, #players/42.
function syncHash() {
  const hash = state.view === "players" && state.selectedUser ? `#players/${state.selectedUser.user_id}` : `#${state.view}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

async function openFromHash() {
  const [view, id] = location.hash.replace(/^#/, "").split("/");
  if (view === "players" && /^[0-9]+$/.test(id || "")) return openPlayer(Number(id));
  if (VIEWS.includes(view)) return switchView(view);
  return switchView("overview");
}

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
    const { grants } = await fetchJson("/api/admin/grants");
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

function populateRuntimeForm(runtime) {
  if (!runtime) return;
  const date = new Date(runtime.maintenanceUntil);
  $("#maintenanceUntil").value = runtime.maintenanceMode && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  $("#announcementField").value = runtime.announcements || "";
  $("#rewardCoinMultiplier").value = runtime.rewardMultipliers?.coins?.toString() || "1";
  $("#rewardGemMultiplier").value = runtime.rewardMultipliers?.gems?.toString() || "1";
  $("#rewardFloor").value = runtime.rewardFloor ?? 5;
  $("#rewardCeiling").value = runtime.rewardCeiling ?? 500;
}

async function handleBootstrap() {
  try {
    const data = await fetchJson("/api/admin/bootstrap");
    state.runtime = data.runtime;
    renderStats(data.stats);
    renderRecentUsers(data.recentUsers);
    renderRecentMatches(data.recentMatches);
    renderShopSummary(data.shop);
    populateRuntimeForm(data.runtime);
    savedRuntime = runtimeSnapshot();
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

// ---- Grant form (used on a player's Currency tab and in the grant dialog) ----
async function grantCurrency(users, amounts, note) {
  const data = await fetchJson("/api/admin/grant", { method: "POST", body: { userIds: users.map((u) => u.user_id), coins: amounts.coins || 0, gems: amounts.gems || 0, note } });
  for (const updated of data.users) applyBalances(updated);
  loadGrants();
  return data.users;
}

const describeAmounts = (amounts) => ["coins", "gems"].filter((c) => amounts[c]).map((c) => `${signed(amounts[c])} ${c}`).join(" and ");

function grantSummary(results) {
  const name = results.length === 1 ? results[0].name : `${results.length} players`;
  const applied = results.reduce((sum, r) => ({ coins: sum.coins + r.applied.coins, gems: sum.gems + r.applied.gems }), { coins: 0, gems: 0 });
  return `${describeAmounts(applied) || "No change"} → ${name}`;
}

function buildGrantForm(host, { getRecipients, onGranted }) {
  const form = node("form", null, "grant-form");
  form.autocomplete = "off";
  const mode = { sign: 1 };
  const modeStrip = node("div", null, "segmented");
  const addMode = button("Add", "is-active");
  const removeMode = button("Remove");
  for (const [el, sign] of [[addMode, 1], [removeMode, -1]]) {
    el.addEventListener("click", () => { mode.sign = sign; addMode.classList.toggle("is-active", sign === 1); removeMode.classList.toggle("is-active", sign === -1); form.classList.toggle("is-removing", sign === -1); update(); });
  }
  modeStrip.append(addMode, removeMode);

  const inputs = {};
  const rows = [];
  for (const currency of ["coins", "gems"]) {
    const row = node("div", null, `grant-row grant-${currency}`);
    const label = node("label", null, "grant-amount");
    const amount = node("input");
    amount.type = "number"; amount.min = "0"; amount.step = "1"; amount.inputMode = "numeric"; amount.placeholder = "0";
    amount.setAttribute("aria-label", `${titleCase(currency)} amount`);
    inputs[currency] = amount;
    label.append(currencyIcon(currency, 26), amount);
    const presets = node("div", null, "presets");
    for (const value of PRESETS[currency]) {
      const chip = button(`+${value >= 1000 ? `${value / 1000}K` : value}`, "chip");
      chip.title = "Click to add · Shift-click to subtract";
      chip.addEventListener("click", (event) => {
        amount.value = String(Math.max(0, (Number(amount.value) || 0) + (event.shiftKey ? -value : value)));
        update();
      });
      presets.append(chip);
    }
    presets.append(button("Clear", "chip chip-clear", () => { amount.value = ""; update(); amount.focus(); }));
    row.append(label, presets);
    rows.push(row);
  }

  const note = node("input", null, "grant-note");
  note.type = "text"; note.maxLength = 40; note.placeholder = "Note (optional), e.g. bug comp or giveaway";
  note.setAttribute("aria-label", "Grant note");

  const footer = node("div", null, "grant-footer");
  const summary = node("span", null, "grant-summary");
  const submit = node("button", "Grant", "primary grant-submit");
  submit.type = "submit";
  footer.append(summary, submit);
  form.append(modeStrip, ...rows, note, footer);
  host.replaceChildren(form);

  const amounts = () => Object.fromEntries(["coins", "gems"].map((c) => [c, mode.sign * Math.max(0, Math.floor(Number(inputs[c].value) || 0))]));
  function update() {
    const recipients = getRecipients();
    const value = amounts();
    const any = value.coins || value.gems;
    submit.disabled = !any || !recipients.length;
    submit.textContent = mode.sign < 0 ? "Remove" : "Grant";
    summary.textContent = !recipients.length ? "Add a player first" : !any ? "Pick an amount" : `${describeAmounts(value)} → ${recipients.length === 1 ? recipients[0].name : `${recipients.length} players`}`;
  }
  form.addEventListener("input", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const recipients = getRecipients();
    const value = amounts();
    if (!recipients.length || !(value.coins || value.gems)) return;
    if (recipients.length > 1 && !await confirmDialog({ title: `${mode.sign < 0 ? "Remove from" : "Grant to"} ${recipients.length} players?`, message: `${describeAmounts(value)} for each player.`, details: recipients.map((u) => u.name), confirmLabel: mode.sign < 0 ? "Remove" : "Grant", danger: mode.sign < 0 })) return;
    submit.disabled = true;
    try {
      const results = await grantCurrency(recipients, value, note.value.trim());
      showToast(grantSummary(results));
      inputs.coins.value = ""; inputs.gems.value = ""; note.value = "";
      onGranted?.(results);
    } catch (error) {
      showToast(error.message || "Grant failed", true);
    } finally { update(); }
  });
  update();
  return { update, focus: () => inputs.coins.focus() };
}

function applyBalances(updated) {
  if (state.selectedUser?.user_id !== updated.user_id) return;
  Object.assign(state.selectedUser, { coins: updated.coins, gems: updated.gems });
  renderBalances(state.selectedUser);
  $("#fieldCoins").value = updated.coins;
  $("#fieldGems").value = updated.gems;
  updateSaveBar();
  refreshCurrencyHistory(updated.user_id);
}

// ---- Grant dialog ----
const dialogState = { recipients: [], suggestions: [], active: -1, generation: 0 };
let dialogForm = null;
let inlineGrant = null;

function renderRecipientChips() {
  const host = $("#recipientChips");
  host.replaceChildren();
  for (const user of dialogState.recipients) {
    const chip = node("span", null, "recipient-chip");
    chip.append(setAvatar(Object.assign(node("img"), { alt: "" }), user), node("span", user.name), node("small", `${fmt(user.coins)}c · ${fmt(user.gems)}g`));
    chip.append(button("×", "chip-remove", () => { dialogState.recipients = dialogState.recipients.filter((u) => u.user_id !== user.user_id); renderRecipientChips(); }));
    host.append(chip);
  }
  dialogForm?.update();
}

function addRecipient(user) {
  if (!dialogState.recipients.some((u) => u.user_id === user.user_id)) dialogState.recipients.push(user);
  $("#recipientSearch").value = "";
  hideSuggestions();
  renderRecipientChips();
}

function hideSuggestions() { $("#recipientSuggestions").hidden = true; dialogState.suggestions = []; dialogState.active = -1; }

function renderSuggestions() {
  const host = $("#recipientSuggestions");
  host.replaceChildren();
  host.hidden = !dialogState.suggestions.length;
  dialogState.suggestions.forEach((user, index) => {
    const option = button(null, `suggestion ${index === dialogState.active ? "is-active" : ""}`, () => addRecipient(user));
    option.setAttribute("role", "option");
    option.append(setAvatar(Object.assign(node("img"), { alt: "" }), user), node("strong", user.name), node("span", `#${user.user_id} · ${user.expires_at ? "Guest" : "Account"}`, "muted"), node("span", `${fmt(user.coins)}c · ${fmt(user.gems)}g`, "row-meta"));
    host.append(option);
  });
}

let suggestTimer = 0;
function queueSuggestions() {
  clearTimeout(suggestTimer);
  const query = $("#recipientSearch").value.trim();
  if (!query) return hideSuggestions();
  suggestTimer = setTimeout(async () => {
    const generation = ++dialogState.generation;
    try {
      const data = await fetchJson("/api/admin/user-search", { method: "POST", body: { query, page: 1 } });
      if (generation !== dialogState.generation) return;
      dialogState.suggestions = data.users.filter((u) => !dialogState.recipients.some((r) => r.user_id === u.user_id)).slice(0, 8);
      dialogState.active = dialogState.suggestions.length ? 0 : -1;
      renderSuggestions();
    } catch (error) { setStatus(error.message, true); }
  }, 160);
}

function openGrantDialog(initial = null) {
  const dialog = $("#grantDialog");
  dialogState.recipients = initial ? [...initial] : state.selectedUser ? [state.selectedUser] : [];
  renderRecipientChips();
  hideSuggestions();
  $("#recipientSearch").value = "";
  if (!dialog.open) dialog.showModal();
  if (dialogState.recipients.length) dialogForm.focus(); else $("#recipientSearch").focus();
}

function wireGrantDialog() {
  const dialog = $("#grantDialog");
  dialogForm = buildGrantForm($("#dialogGrant"), {
    getRecipients: () => dialogState.recipients,
    onGranted: (results) => {
      for (const r of results) { const user = dialogState.recipients.find((u) => u.user_id === r.user_id); if (user) Object.assign(user, { coins: r.coins, gems: r.gems }); }
      renderRecipientChips();
    },
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  const search = $("#recipientSearch");
  search.addEventListener("input", queueSuggestions);
  search.addEventListener("keydown", (event) => {
    const { suggestions } = dialogState;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      dialogState.active = (dialogState.active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      renderSuggestions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (suggestions[dialogState.active]) addRecipient(suggestions[dialogState.active]);
      else if (dialogState.recipients.length) dialogForm.focus();
    } else if (event.key === "Backspace" && !search.value && dialogState.recipients.length) {
      dialogState.recipients.pop();
      renderRecipientChips();
    }
  });
}

// ---- Player directory ----
let playerPage = 1;
let searchGeneration = 0;
let detailGeneration = 0;
let searchTimer = 0;

function playerRow(user) {
  const row = button(null, "player-row");
  row.dataset.userRow = user.user_id;
  const who = node("span", null, "player-who");
  who.append(setAvatar(Object.assign(node("img", null, "row-avatar"), { alt: "" }), user));
  const names = node("span", null, "player-names");
  names.append(node("strong", user.name), node("small", `#${user.user_id}`));
  who.append(names);
  const type = node("span", null, "cell");
  type.append(node("span", isAccountBanned(user) ? user.ban_expires_at ? "Suspended" : "Banned" : user.expires_at ? "Guest" : "Account", `tag ${isAccountBanned(user) ? "tag-banned" : user.expires_at ? "" : "tag-account"}`));
  const status = node("span", null, "cell presence-cell");
  status.append(node("span", null, `presence presence-${user.status || "offline"}`), document.createTextNode(user.status || "offline"));
  const lastSeen = node("span", user.last_seen_at ? timeAgo(user.last_seen_at) : "Unknown", "cell muted");
  lastSeen.title = user.last_seen_at ? formatAdminDate(user.last_seen_at) : "No activity recorded";
  row.append(who, type, status, node("span", fmt(user.trophies), "cell"), lastSeen);
  row.addEventListener("click", () => openPlayer(user.user_id));
  return row;
}

async function searchPlayers() {
  const generation = ++searchGeneration;
  const host = $("#playerResults");
  host.classList.add("is-loading");
  try {
    const data = await fetchJson("/api/admin/user-search", { method: "POST", body: { query: $("#userSearch").value.trim(), page: playerPage } });
    if (generation !== searchGeneration) return;
    host.replaceChildren(...data.users.map(playerRow));
    if (!data.users.length) host.append(node("p", "No players found. Try another name or ID.", "muted pad"));
    $("#playerCount").textContent = `${fmt(data.total)} players`;
    const pager = $("#playerPager");
    const prev = button(null, "", () => { playerPage -= 1; searchPlayers(); });
    const next = button(null, "", () => { playerPage += 1; searchPlayers(); });
    prev.append(pixelArrow("left", "sm"), " Previous");
    next.append("Next ", pixelArrow("right", "sm"));
    prev.disabled = playerPage <= 1;
    next.disabled = playerPage * PAGE_SIZE >= data.total;
    pager.replaceChildren(prev, node("span", `Page ${playerPage} of ${Math.max(1, Math.ceil(data.total / PAGE_SIZE))}`), next);
  } catch (error) {
    if (generation === searchGeneration) { host.replaceChildren(node("p", error.message, "muted pad")); $("#playerPager").replaceChildren(); }
  } finally { if (generation === searchGeneration) host.classList.remove("is-loading"); }
}

function queuePlayerSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { playerPage = 1; searchPlayers(); }, 200);
}

// ---- Player page ----
function renderBalances(user) {
  $("#balCoins").textContent = fmt(user.coins);
  $("#balGems").textContent = fmt(user.gems);
  $("#balTrophies").textContent = fmt(user.trophies);
}

function selectPlayerTab(tab) {
  document.querySelectorAll("[data-player-panel]").forEach((el) => { el.hidden = el.dataset.playerPanel !== tab; });
  document.querySelectorAll("[data-player-tab]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.playerTab === tab)));
}

function normalizedLevels(user) {
  const levels = parseCharacterLevels(user?.char_levels) || {};
  return Object.fromEntries(CHARACTERS.map((c) => [c, Number(levels[c]) || 0]));
}

function levelChanges() {
  const saved = normalizedLevels(state.selectedUser);
  return Object.fromEntries(CHARACTERS.filter((c) => state.levelDraft[c] !== saved[c]).map((c) => [c, state.levelDraft[c]]));
}

function setLevel(character, level) {
  state.levelDraft[character] = Math.max(0, Math.min(LEVEL_CAP, level));
  renderLevels();
  updateSaveBar();
}

function renderLevels() {
  const host = $("#levelFields");
  const saved = normalizedLevels(state.selectedUser);
  host.replaceChildren();
  for (const character of CHARACTERS) {
    const level = state.levelDraft[character] ?? 0;
    const card = node("div", null, `level-card ${level ? "" : "is-locked"} ${level !== saved[character] ? "is-dirty" : ""}`);
    const img = node("img");
    img.src = `/assets/profile-icons/${character}.webp`; img.alt = ""; img.width = img.height = 52;
    const head = node("div", null, "level-head");
    const label = node("div", null, "level-label");
    label.append(node("strong", titleCase(character)), node("span", level ? `Level ${level}${level > STANDARD_LEVEL_CAP ? " · Mastery" : ""}` : "Locked", "muted"));
    head.append(img, label, node("span", level ? String(level) : "—", "level-value"));
    const pips = node("div", null, "pips");
    const lock = button(null, `pip pip-lock ${level === 0 ? "is-on" : ""}`, () => setLevel(character, 0));
    lock.title = "Lock character"; lock.setAttribute("aria-label", `Lock ${character}`);
    lock.append(Object.assign(node("img"), { src: "/assets/icons/lock.webp", alt: "" }));
    pips.append(lock);
    for (let n = 1; n <= LEVEL_CAP; n += 1) {
      const pip = button(String(n), `pip ${n <= level ? "is-on" : ""} ${n > STANDARD_LEVEL_CAP ? "is-mastery" : ""}`, () => setLevel(character, n));
      pip.title = `Set ${titleCase(character)} to level ${n}`;
      pips.append(pip);
    }
    card.append(head, pips);
    host.append(card);
  }
}

const accountFields = { name: "#fieldName", trophies: "#fieldTrophies", coins: "#fieldCoins", gems: "#fieldGems", char_class: "#fieldClass", status: "#fieldStatus" };
function accountChanges() {
  const user = state.selectedUser;
  if (!user) return {};
  const changes = {};
  for (const [key, selector] of Object.entries(accountFields)) {
    const raw = $(selector).value;
    const numeric = ["coins", "gems", "trophies"].includes(key);
    const value = numeric ? Number(raw) : key === "name" ? raw.trim() : raw;
    const current = user[key] ?? (numeric ? 0 : "");
    if (value !== (numeric ? Number(current) : current)) changes[key] = value;
  }
  return changes;
}

function pendingChanges() {
  const changes = accountChanges();
  const levels = levelChanges();
  if (Object.keys(levels).length) changes.char_levels = levels;
  return changes;
}
const isPlayerDirty = () => Object.keys(pendingChanges()).length > 0 || inventoryEditor?.isDirty() || streakSaving || (playerStats && !playerStats.error && $("#fieldStreak").value !== String(playerStats.winStreak));

function describeChanges(changes) {
  const parts = Object.entries(changes).filter(([k]) => k !== "char_levels").map(([key, value]) => `${key.replace("char_class", "character")} → ${value}`);
  for (const [character, level] of Object.entries(changes.char_levels || {})) parts.push(`${titleCase(character)} ${level ? `lv ${level}` : "locked"}`);
  return parts;
}

function updateSaveBar() {
  const parts = describeChanges(pendingChanges());
  $("#playerSaveBar").hidden = !parts.length;
  $("#playerSaveSummary").textContent = parts.length ? `${parts.length} unsaved change${parts.length === 1 ? "" : "s"}: ${parts.join(" · ")}` : "";
}

async function confirmLeavePlayer() {
  if (!state.selectedUser || !isPlayerDirty()) return true;
  return confirmDialog({ title: "Leave without saving?", message: `You have unsaved changes to ${state.selectedUser.name}.`, details: describeChanges(pendingChanges()), confirmLabel: "Discard changes", danger: true });
}

async function savePlayer() {
  const changes = pendingChanges();
  if (!state.selectedUser || !Object.keys(changes).length) return;
  if ((changes.name || changes.coins !== undefined || changes.gems !== undefined) && !await confirmDialog({ title: `Save changes to ${state.selectedUser.name}?`, details: describeChanges(changes), confirmLabel: "Save" })) return;
  const save = $("#playerSave");
  save.disabled = true;
  try {
    const data = await fetchJson("/api/admin/user-update", { method: "POST", body: { userId: state.selectedUser.user_id, changes } });
    populatePlayer(data.user);
    try { await refreshPlayerDetails(data.user.user_id, !inventoryEditor?.isDirty()); }
    catch { showToast("Player saved. Reopen the player to refresh the details.", true); return; }
    showToast(`Saved ${data.user.name}`);
  } catch (error) {
    showToast(error.message || "Save failed", true);
  } finally { save.disabled = false; }
}

function renderPlayerSubtitle(user) {
  const tags = [node("span", user.expires_at ? "Guest" : "Account", "player-meta-tag")];
  const status = user.status || "offline";
  const presence = node("span", null, "player-meta-tag");
  presence.append(node("span", null, `presence presence-${status}`), document.createTextNode(titleCase(status)));
  tags.push(presence);
  if (isAccountBanned(user)) tags.push(node("span", user.ban_expires_at ? "Suspended" : "Banned", "player-meta-tag is-restricted"));
  const joined = node("span", `Joined ${formatAdminDate(user.created_at, true)}`, "player-meta-tag");
  joined.title = formatAdminDate(user.created_at);
  const seen = node("span", `Last seen ${user.last_seen_at ? timeAgo(user.last_seen_at) : "unknown"}`, "player-meta-tag");
  seen.title = user.last_seen_at ? formatAdminDate(user.last_seen_at) : "No activity recorded";
  tags.push(joined, seen);
  $("#playerSubtitle").replaceChildren(...tags);
}

function populatePlayer(user) {
  state.selectedUser = user;
  state.levelDraft = normalizedLevels(user);
  $("#userName").textContent = user.name;
  renderPlayerSubtitle(user);
  setAvatar($("#playerAvatar"), user);
  renderBalances(user);
  $("#fieldName").value = user.name;
  $("#fieldCoins").value = user.coins ?? 0;
  $("#fieldGems").value = user.gems ?? 0;
  $("#fieldTrophies").value = user.trophies ?? 0;
  $("#fieldStatus").value = user.status || "offline";
  $("#fieldClass").value = user.char_class || DEFAULT_CHARACTER;
  renderLevels();
  updateSaveBar();
  inlineGrant?.update();
  renderBanStatus(user);
}

function updateRestrictionForm() {
  const temporary = $("#banType").value === "suspend";
  $("#suspensionDurationField").hidden = !temporary;
  $("#suspensionDuration").required = temporary;
  $("#banPlayer").textContent = temporary ? "Suspend player" : "Ban player";
}

function renderBanStatus(user) {
  const banned = isAccountBanned(user);
  const temporary = banned && !!user.ban_expires_at;
  $("#banStatus").textContent = banned
    ? `${temporary ? `Suspended until ${formatAdminDate(user.ban_expires_at)}` : `Banned ${formatAdminDate(user.banned_at)}`} · ${user.ban_reason || "No reason recorded"}`
    : user.ban_expires_at ? `Suspension expired ${formatAdminDate(user.ban_expires_at)}` : "This account is not restricted.";
  $("#banReason").value = "";
  $("#banPlayerForm").hidden = banned;
  $("#unbanPlayer").hidden = !banned;
  $("#unbanPlayer").textContent = temporary ? "Lift suspension" : "Unban player";
  updateRestrictionForm();
}

function describeDuration(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const suspensionMinutes = () => Math.round((Number($("#suspensionDuration").value) || 0) * Number($("#suspensionUnit").value));

async function changeRestriction(action) {
  const user = state.selectedUser;
  if (!user) return;
  const reason = $("#banReason").value.trim();
  const durationMinutes = suspensionMinutes();
  if (action === "suspend" && !(durationMinutes >= 1 && durationMinutes <= 525600)) { showToast("Choose a suspension between 1 minute and 365 days", true); return; }
  if (action !== "unban" && !reason) return;
  const confirmed = action === "unban"
    ? await confirmDialog({ title: `Lift the restriction for ${user.name}?`, message: `#${user.user_id} can play again right away.`, confirmLabel: "Lift restriction" })
    : await confirmDialog({ title: `${action === "suspend" ? `Suspend ${user.name} for ${describeDuration(durationMinutes)}` : `Permanently ban ${user.name}`}?`, message: "Their active sessions are disconnected right away.", details: [`Player #${user.user_id}`, `Reason: ${reason}`], confirmLabel: action === "suspend" ? "Suspend" : "Ban", danger: true });
  if (!confirmed) return;
  $("#banPlayer").disabled = $("#unbanPlayer").disabled = true;
  try {
    const data = await fetchJson(`/api/admin/user-${action}`, { method: "POST", body: { userId: user.user_id, reason, ...(action === "suspend" ? { durationMinutes } : {}) } });
    if (state.selectedUser?.user_id === user.user_id) {
      Object.assign(state.selectedUser, { is_banned: data.user.is_banned, banned_at: data.user.banned_at, ban_expires_at: data.user.ban_expires_at, ban_reason: data.user.ban_reason });
      renderBanStatus(state.selectedUser);
      renderPlayerSubtitle(user);
      try {
        const details = await fetchJson(`/api/admin/users/${user.user_id}`);
        if (state.selectedUser?.user_id === user.user_id) renderPlayerDetails(details.user, details.history);
      } catch { /* The restriction changed; history refreshes when reopening the player. */ }
    }
    showToast(`${user.name}: ${action === "unban" ? "restriction lifted" : action === "suspend" ? "temporarily suspended" : "banned"}`);
  } catch (error) {
    showToast(error.message, true);
  } finally { $("#banPlayer").disabled = $("#unbanPlayer").disabled = false; }
}

function detailList(title, rows) {
  const section = node("article", null, "panel");
  section.append(node("div", title, "panel-title"));
  const list = node("dl", null, "detail-list");
  for (const [label, value] of rows) list.append(node("dt", label), node("dd", value == null || value === "" ? "—" : String(value)));
  section.append(list);
  return section;
}

function historyTable(title, data) {
  const section = node("article", null, "panel");
  section.append(node("div", `${title}${data?.rows ? ` · ${data.rows.length}` : ""}`, "panel-title"));
  if (data?.error || !data?.rows?.length) { section.append(node("p", data?.error || "No records yet.", "muted")); return section; }
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
      const cell = node("td", column.endsWith("_at") ? formatAdminDate(value, true) : value == null ? "—" : String(value));
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

function renderPlayerDetails(user, history) {
  $("#currencyHistory").replaceChildren(historyTable("Currency activity", history.currency));
  $("#playerDetails").replaceChildren(historyTable("Recent matches", history.matches), historyTable("Recent orders", history.orders), historyTable("Moderation events", history.moderation));
  $("#playerOverview").replaceChildren(
    detailList("Account & profile", [["Account type", user.expires_at ? "Guest" : "Permanent"], ["Created", formatAdminDate(user.created_at)], ["Updated", formatAdminDate(user.updated_at)], ["Guest expiry", formatAdminDate(user.expires_at)], ["Peak trophies", user.trophy_peak], ["Profile icon", user.selected_profile_icon_id], ["Player card", user.selected_card_id]]),
    detailList("Moderation status", [["Restricted", isAccountBanned(user) ? user.ban_expires_at ? "Temporarily suspended" : "Permanently banned" : "No"], ["Expires", formatAdminDate(user.ban_expires_at)], ["Ban reason", user.ban_reason], ["Banned at", formatAdminDate(user.banned_at)], ["Chat suspended until", formatAdminDate(user.chat_suspended_until)], ["Matchmaking suspended until", formatAdminDate(user.mm_suspended_until)]]),
  );
}

function renderPlayerStats(user, stats, preserveStreakDraft = false) {
  const streakDraft = preserveStreakDraft && playerStats && !playerStats.error && $("#fieldStreak").value !== String(playerStats.winStreak) ? $("#fieldStreak").value : null;
  playerStats = stats;
  const host = $("#playerStats");
  host.replaceChildren();
  renderPlayerSubtitle(user);
  $("#fieldStreak").disabled = $("#saveStreak").disabled = !stats || !!stats.error;
  if (!stats || stats.error) { host.append(node("p", stats?.error || "Statistics unavailable", "muted")); return; }
  const grid = node("div", null, "player-stats-grid");
  for (const [label, value] of [["Matches", fmt(stats.totalMatches)], ["Wins", fmt(stats.wins)], ["Losses", fmt(stats.losses)], ["Draws", fmt(stats.draws)], ["Win rate", `${Number(stats.winRate).toFixed(1)}%`], ["Win streak", fmt(stats.winStreak)], ["Highest streak", fmt(user.highest_win_streak)]]) {
    const card = node("div", null, "stat-card");
    card.append(node("span", label), node("strong", value));
    grid.append(card);
  }
  host.append(grid);
  $("#fieldStreak").value = streakDraft ?? stats.winStreak;
}

async function refreshPlayerDetails(id, refreshInventory = false, preserveStreakDraft = true) {
  const data = await fetchJson(`/api/admin/users/${id}`);
  if (state.selectedUser?.user_id !== id) return;
  renderPlayerDetails(data.user, data.history);
  renderPlayerStats(data.user, data.stats, preserveStreakDraft);
  for (const key of ["selected_skin_id_by_char", "selected_profile_icon_id", "selected_card_id", "highest_win_streak", "last_seen_at"]) state.selectedUser[key] = data.user[key];
  setAvatar($("#playerAvatar"), state.selectedUser);
  if (refreshInventory) inventoryEditor.set(id, data.inventory);
}

async function saveStreak(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user || streakSaving || !$("#playerStreakForm").reportValidity()) return;
  const streak = Number($("#fieldStreak").value);
  if (streak === playerStats?.winStreak) return;
  if (!await confirmDialog({ title: `Set ${user.name}’s streak to ${streak}?`, message: "This changes past shared battle results, including teammates’ and opponents’ records. Awarded currency and trophies stay unchanged.", confirmLabel: "Set streak", danger: true })) return;
  streakSaving = true;
  $("#saveStreak").disabled = true;
  try {
    const result = await fetchJson(`/api/admin/users/${user.user_id}/streak`, { method: "POST", body: { streak } });
    try { await refreshPlayerDetails(user.user_id, false, false); }
    catch { showToast(`Streak saved to ${streak}. Reopen the player to refresh the details.`, true); return; }
    showToast(`Set streak to ${streak} · ${result.changedMatches} battle results changed`);
  } catch (error) { showToast(error.message || "Unable to set streak", true); }
  finally { streakSaving = false; $("#saveStreak").disabled = !playerStats || !!playerStats.error; }
}

async function refreshCurrencyHistory(id) {
  try {
    const data = await fetchJson(`/api/admin/users/${id}`);
    if (state.selectedUser?.user_id === id) $("#currencyHistory").replaceChildren(historyTable("Currency activity", data.history.currency));
  } catch { /* The grant already succeeded; the table refreshes next time. */ }
}

async function openPlayer(id) {
  if (state.selectedUser && state.selectedUser.user_id !== id && !await confirmLeavePlayer()) return;
  if (state.view !== "players" && !await switchView("players", { updateHash: false })) return;
  const generation = ++detailGeneration;
  setStatus(`Loading player #${id}…`);
  try {
    const data = await fetchJson(`/api/admin/users/${id}`);
    if (generation !== detailGeneration) return;
    populatePlayer(data.user);
    renderPlayerDetails(data.user, data.history);
    renderPlayerStats(data.user, data.stats);
    inventoryEditor.set(data.user.user_id, data.inventory);
    $("#playerDirectory").hidden = true;
    $("#playerWorkspace").hidden = false;
    selectPlayerTab("currency");
    $("#adminMain").scrollTop = 0;
    setStatus(`${data.user.name} · #${data.user.user_id}`);
    syncHash();
  } catch (error) {
    if (generation === detailGeneration) { showToast(error.message, true); syncHash(); }
  }
}

function resetPlayer() {
  state.selectedUser = null;
  $("#playerWorkspace").hidden = true;
  $("#playerDirectory").hidden = false;
  $("#playerSaveBar").hidden = true;
}

async function closePlayer() {
  if (!await confirmLeavePlayer()) return;
  resetPlayer();
  syncHash();
  searchPlayers();
}

// ---- Runtime ----
function runtimeProblems() {
  const problems = [];
  for (const [selector, label] of [["#rewardCoinMultiplier", "Coin multiplier"], ["#rewardGemMultiplier", "Gem multiplier"]]) {
    const value = Number($(selector).value);
    if (!(value > 0 && value <= 10)) problems.push(`${label} must be above 0 and at most 10.`);
  }
  const floor = Number($("#rewardFloor").value), ceiling = Number($("#rewardCeiling").value);
  if (!Number.isInteger(floor) || floor < 0) problems.push("Coin floor must be a whole number of at least 0.");
  if (!Number.isInteger(ceiling) || ceiling < 1) problems.push("Coin ceiling must be a whole number of at least 1.");
  if (floor > ceiling) problems.push("Coin floor can't be above the ceiling.");
  const until = $("#maintenanceUntil").value;
  if (until && new Date(until).getTime() <= Date.now()) problems.push("Maintenance must end in the future. Clear the time to turn it off.");
  return problems;
}

function runtimeSnapshot() {
  return JSON.stringify(["#maintenanceUntil", "#announcementField", "#rewardCoinMultiplier", "#rewardGemMultiplier", "#rewardFloor", "#rewardCeiling"].map((selector) => $(selector).value));
}
let savedRuntime = "";

function updateRuntimeState() {
  const dirty = runtimeSnapshot() !== savedRuntime;
  const problems = runtimeProblems();
  $("#runtimeProblems").replaceChildren(...problems.map((problem) => node("li", problem)));
  $("#runtimeProblems").hidden = !problems.length;
  const save = $("#runtimeForm button[type=submit]");
  save.disabled = !dirty || problems.length > 0;
  $("#runtimeState").textContent = dirty ? "Unsaved changes" : "All changes saved";
  $("#runtimeState").classList.toggle("is-dirty", dirty);
  $("#announcementCount").textContent = `${$("#announcementField").value.length}/500`;
}

async function handleRuntimeSave(event) {
  event.preventDefault();
  if (runtimeProblems().length) return updateRuntimeState();
  const payload = {
    maintenanceUntil: $("#maintenanceUntil").value ? new Date($("#maintenanceUntil").value).toISOString() : null,
    announcements: $("#announcementField").value,
    rewardMultipliers: { coins: Number($("#rewardCoinMultiplier").value), gems: Number($("#rewardGemMultiplier").value) },
    rewardFloor: Number($("#rewardFloor").value),
    rewardCeiling: Number($("#rewardCeiling").value),
  };
  try {
    const data = await fetchJson("/api/admin/runtime", { method: "POST", body: payload });
    state.runtime = data.runtime;
    populateRuntimeForm(state.runtime);
    showToast("Runtime settings saved");
    savedRuntime = runtimeSnapshot();
    updateRuntimeState();
  } catch (err) {
    showToast(err.message || "Save failed", true);
  }
}

async function clearMaintenance() {
  if (!await confirmDialog({ title: "End maintenance now?", message: "Matchmaking opens again for every player right away.", confirmLabel: "End maintenance" })) return;
  const clear = $("#clearMaintenance");
  const save = $("#runtimeForm button[type=submit]");
  clear.disabled = save.disabled = true;
  try {
    const data = await fetchJson("/api/admin/runtime", { method: "POST", body: { maintenanceUntil: null } });
    state.runtime = data.runtime;
    $("#maintenanceUntil").value = "";
    savedRuntime = runtimeSnapshot();
    updateRuntimeState();
    showToast("Maintenance turned off. Matchmaking enabled.");
  } catch (error) {
    showToast(error.message || "Could not turn off maintenance", true);
  } finally { clear.disabled = save.disabled = false; }
}

// ---- Keyboard ----
const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

function wireKeyboard() {
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#jumpSearch").focus(); $("#jumpSearch").select(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && state.selectedUser && state.view === "players") { event.preventDefault(); savePlayer(); return; }
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || document.querySelector("dialog[open]")) return;
    if (event.key === "/") { event.preventDefault(); (state.view === "players" && !state.selectedUser ? $("#userSearch") : $("#jumpSearch")).focus(); }
    else if (event.key.toLowerCase() === "g") { event.preventDefault(); openGrantDialog(); }
    else if (/^[1-6]$/.test(event.key)) switchView(VIEWS[Number(event.key) - 1]);
  });
}

function populateCharacterSelect() {
  const choose = $("#fieldClass");
  choose.replaceChildren(...CHARACTERS.map((id) => Object.assign(node("option", getCharacterDisplayName(id)), { value: id })));
}

function init() {
  populateCharacterSelect();
  setInboxPlayerOpener(openPlayer);
  setStorePlayerOpener(openPlayer);
  onStoreDirtyChange((dirty) => $('[data-nav="store"]').classList.toggle("has-changes", dirty));
  inlineGrant = buildGrantForm($("#inlineGrant"), { getRecipients: () => (state.selectedUser ? [state.selectedUser] : []) });
  wireGrantDialog();
  wireKeyboard();

  $("#clearMaintenance").addEventListener("click", clearMaintenance);
  setInterval(() => {
    const until = state.runtime?.maintenanceUntil;
    const active = maintenanceRemaining(until) > 0;
    const el = $("#maintenanceCountdown");
    el.textContent = active ? `Maintenance · ${maintenanceClock(until)} left` : "Matchmaking is open";
    el.classList.toggle("is-active", active);
    $("#clearMaintenance").disabled = !active;
  }, 1000);

  $("#userSearchForm").addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(searchTimer); playerPage = 1; searchPlayers(); });
  $("#userSearch").addEventListener("input", queuePlayerSearch);
  $("#jumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = $("#jumpSearch").value.trim();
    if (!await confirmLeavePlayer()) return;
    if (state.view !== "players" && !await switchView("players")) return;
    resetPlayer();
    syncHash();
    $("#userSearch").value = query;
    playerPage = 1;
    await searchPlayers();
    const rows = document.querySelectorAll("#playerResults .player-row");
    if (rows.length === 1 || (rows.length && /^[0-9]+$/.test(query))) rows[0].click();
    $("#jumpSearch").blur();
  });
  $("#jumpSearch").addEventListener("keydown", (event) => { if (event.key === "Escape") event.currentTarget.blur(); });

  $("#openGrant").addEventListener("click", () => openGrantDialog());
  $("#refreshGrants").addEventListener("click", loadGrants);
  $("#backToPlayers").addEventListener("click", closePlayer);
  $("#banType").addEventListener("change", updateRestrictionForm);
  $("#banPlayerForm").addEventListener("submit", (event) => { event.preventDefault(); changeRestriction($("#banType").value); });
  $("#unbanPlayer").addEventListener("click", () => changeRestriction("unban"));
  setInterval(() => {
    const user = state.selectedUser;
    if (user?.ban_expires_at && !isAccountBanned(user) && !$("#unbanPlayer").hidden) renderBanStatus(user);
  }, 1000);
  $("#userEditForm").addEventListener("input", updateSaveBar);
  $("#userEditForm").addEventListener("submit", (event) => { event.preventDefault(); savePlayer(); });
  $("#playerSave").addEventListener("click", savePlayer);
  inventoryEditor = createInventoryEditor($("#playerInventory"), { onSaved: id => refreshPlayerDetails(id, true) });
  $("#playerStreakForm").addEventListener("submit", saveStreak);
  $("#runtimeForm").addEventListener("submit", handleRuntimeSave);
  $("#runtimeForm").addEventListener("input", updateRuntimeState);
  $("#runtimeForm").addEventListener("change", updateRuntimeState);
  document.querySelectorAll("[data-levels-all]").forEach((el) => el.addEventListener("click", () => {
    for (const character of CHARACTERS) {
      const current = state.levelDraft[character] ?? 0;
      // "Unlock all" keeps existing levels and only opens locked characters.
      state.levelDraft[character] = { max: LEVEL_CAP, unlock: Math.max(current, 1), lock: 0 }[el.dataset.levelsAll];
    }
    renderLevels();
    updateSaveBar();
  }));
  document.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => switchView(el.dataset.nav)));
  document.querySelectorAll("[data-nav-link]").forEach((el) => el.addEventListener("click", () => switchView(el.dataset.navLink)));
  document.querySelectorAll("[data-player-tab]").forEach((el) => el.addEventListener("click", () => selectPlayerTab(el.dataset.playerTab)));
  window.addEventListener("beforeunload", (event) => {
    if ((state.selectedUser && isPlayerDirty()) || isStoreDirty()) { event.preventDefault(); event.returnValue = ""; }
  });

  window.addEventListener("hashchange", openFromHash);
  openFromHash();
  searchPlayers();
  handleBootstrap();
  loadGrants();
  refreshInboxBadges();
}

document.addEventListener("DOMContentLoaded", init);
