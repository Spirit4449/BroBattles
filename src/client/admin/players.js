import { createLatestRequest } from "./latestRequest";
import { renderPager } from "../ui/pager";
import { API_PATHS, adminUserPath } from "../../shared/net/apiPaths.js";
import { renderLevelFields, normalizedLevels, levelChanges } from "./playerLevels";
import { renderPlayerSubtitle, renderPlayerDetails, historyTable } from "./playerHistory";
import { updateRestrictionForm, renderBanStatus, changeRestriction } from "./playerRestriction";
import { isAccountBanned } from "../../shared/moderation/accountBan";
import { DEFAULT_CHARACTER } from "../../shared/characters/characterStats";
import {
  $,
  node,
  button,
  fmt,
  titleCase,
  setAvatar,
  fetchJson,
  formatAdminDate,
  timeAgo,
  setStatus,
  showToast,
  confirmDialog,
} from "./common";
import { PAGE_SIZE, state, playerTools } from "./adminState";
import { switchView, syncHash } from "./adminNavigation";

function renderLevels() {
  renderLevelFields(updateSaveBar);
}

// ---- Player directory ----
const startSearch = createLatestRequest();
const startDetails = createLatestRequest();
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
  type.append(
    node(
      "span",
      isAccountBanned(user)
        ? user.ban_expires_at
          ? "Suspended"
          : "Banned"
        : user.expires_at
          ? "Guest"
          : "Account",
      `tag ${isAccountBanned(user) ? "tag-banned" : user.expires_at ? "" : "tag-account"}`,
    ),
  );
  const status = node("span", null, "cell presence-cell");
  status.append(
    node("span", null, `presence presence-${user.status || "offline"}`),
    document.createTextNode(user.status || "offline"),
  );
  const lastSeen = node(
    "span",
    user.last_seen_at ? timeAgo(user.last_seen_at) : "Unknown",
    "cell muted",
  );
  lastSeen.title = user.last_seen_at ? formatAdminDate(user.last_seen_at) : "No activity recorded";
  row.append(who, type, status, node("span", fmt(user.trophies), "cell"), lastSeen);
  row.addEventListener("click", () => openPlayer(user.user_id));
  return row;
}

async function searchPlayers() {
  const isCurrent = startSearch();
  const host = $("#playerResults");
  host.classList.add("is-loading");
  try {
    const data = await fetchJson(API_PATHS.API_ADMIN_USER_SEARCH, {
      method: "POST",
      body: { query: $("#userSearch").value.trim(), page: playerTools.playerPage },
    });
    if (!isCurrent()) return;
    host.replaceChildren(...data.users.map(playerRow));
    if (!data.users.length)
      host.append(node("p", "No players found. Try another name or ID.", "muted pad"));
    $("#playerCount").textContent = `${fmt(data.total)} players`;
    const pager = $("#playerPager");
    renderPager(pager, {
      page: playerTools.playerPage,
      pages: Math.max(1, Math.ceil(data.total / PAGE_SIZE)),
      text: true,
      onPage: (page) => {
        playerTools.playerPage = page;
        searchPlayers();
      },
    });
  } catch (error) {
    if (isCurrent()) {
      host.replaceChildren(node("p", error.message, "muted pad"));
      $("#playerPager").replaceChildren();
    }
  } finally {
    if (isCurrent()) host.classList.remove("is-loading");
  }
}

function queuePlayerSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    playerTools.playerPage = 1;
    searchPlayers();
  }, 200);
}

// ---- Player page ----
function renderBalances(user) {
  $("#balCoins").textContent = fmt(user.coins);
  $("#balGems").textContent = fmt(user.gems);
  $("#balTrophies").textContent = fmt(user.trophies);
}

function selectPlayerTab(tab) {
  document.querySelectorAll("[data-player-panel]").forEach((el) => {
    el.hidden = el.dataset.playerPanel !== tab;
  });
  document
    .querySelectorAll("[data-player-tab]")
    .forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.playerTab === tab)));
}

const accountFields = {
  name: "#fieldName",
  trophies: "#fieldTrophies",
  coins: "#fieldCoins",
  gems: "#fieldGems",
  char_class: "#fieldClass",
  status: "#fieldStatus",
};

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

const isPlayerDirty = () =>
  Object.keys(pendingChanges()).length > 0 ||
  playerTools.inventoryEditor?.isDirty() ||
  playerTools.streakSaving ||
  (playerTools.playerStats &&
    !playerTools.playerStats.error &&
    $("#fieldStreak").value !== String(playerTools.playerStats.winStreak));

function describeChanges(changes) {
  const parts = Object.entries(changes)
    .filter(([k]) => k !== "char_levels")
    .map(([key, value]) => `${key.replace("char_class", "character")} → ${value}`);
  for (const [character, level] of Object.entries(changes.char_levels || {}))
    parts.push(`${titleCase(character)} ${level ? `lv ${level}` : "locked"}`);
  return parts;
}

function updateSaveBar() {
  const parts = describeChanges(pendingChanges());
  $("#playerSaveBar").hidden = !parts.length;
  $("#playerSaveSummary").textContent = parts.length
    ? `${parts.length} unsaved change${parts.length === 1 ? "" : "s"}: ${parts.join(" · ")}`
    : "";
}

async function confirmLeavePlayer() {
  if (!state.selectedUser || !isPlayerDirty()) return true;
  return confirmDialog({
    title: "Leave without saving?",
    message: `You have unsaved changes to ${state.selectedUser.name}.`,
    details: describeChanges(pendingChanges()),
    confirmLabel: "Discard changes",
    danger: true,
  });
}

async function savePlayer() {
  const changes = pendingChanges();
  if (!state.selectedUser || !Object.keys(changes).length) return;
  if (
    (changes.name || changes.coins !== undefined || changes.gems !== undefined) &&
    !(await confirmDialog({
      title: `Save changes to ${state.selectedUser.name}?`,
      details: describeChanges(changes),
      confirmLabel: "Save",
    }))
  )
    return;
  const save = $("#playerSave");
  save.disabled = true;
  try {
    const data = await fetchJson(API_PATHS.API_ADMIN_USER_UPDATE, {
      method: "POST",
      body: { userId: state.selectedUser.user_id, changes },
    });
    populatePlayer(data.user);
    try {
      await refreshPlayerDetails(data.user.user_id, !playerTools.inventoryEditor?.isDirty());
    } catch {
      showToast("Player saved. Reopen the player to refresh the details.", true);
      return;
    }
    showToast(`Saved ${data.user.name}`);
  } catch (error) {
    showToast(error.message || "Save failed", true);
  } finally {
    save.disabled = false;
  }
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
  playerTools.inlineGrant?.update();
  renderBanStatus(user);
}

function renderPlayerStats(user, stats, preserveStreakDraft = false) {
  const streakDraft =
    preserveStreakDraft &&
    playerTools.playerStats &&
    !playerTools.playerStats.error &&
    $("#fieldStreak").value !== String(playerTools.playerStats.winStreak)
      ? $("#fieldStreak").value
      : null;
  playerTools.playerStats = stats;
  const host = $("#playerStats");
  host.replaceChildren();
  renderPlayerSubtitle(user);
  $("#fieldStreak").disabled = $("#saveStreak").disabled = !stats || !!stats.error;
  if (!stats || stats.error) {
    host.append(node("p", stats?.error || "Statistics unavailable", "muted"));
    return;
  }
  const grid = node("div", null, "player-stats-grid");
  for (const [label, value] of [
    ["Matches", fmt(stats.totalMatches)],
    ["Wins", fmt(stats.wins)],
    ["Losses", fmt(stats.losses)],
    ["Draws", fmt(stats.draws)],
    ["Win rate", `${Number(stats.winRate).toFixed(1)}%`],
    ["Win streak", fmt(stats.winStreak)],
    ["Highest streak", fmt(user.highest_win_streak)],
  ]) {
    const card = node("div", null, "stat-card");
    card.append(node("span", label), node("strong", value));
    grid.append(card);
  }
  host.append(grid);
  $("#fieldStreak").value = streakDraft ?? stats.winStreak;
}

async function refreshPlayerDetails(id, refreshInventory = false, preserveStreakDraft = true) {
  const data = await fetchJson(adminUserPath(id));
  if (state.selectedUser?.user_id !== id) return;
  renderPlayerDetails(data.user, data.history);
  renderPlayerStats(data.user, data.stats, preserveStreakDraft);
  for (const key of [
    "selected_skin_id_by_char",
    "selected_profile_icon_id",
    "selected_card_id",
    "highest_win_streak",
    "last_seen_at",
  ])
    state.selectedUser[key] = data.user[key];
  setAvatar($("#playerAvatar"), state.selectedUser);
  if (refreshInventory) playerTools.inventoryEditor.set(id, data.inventory);
}

async function saveStreak(event) {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user || playerTools.streakSaving || !$("#playerStreakForm").reportValidity()) return;
  const streak = Number($("#fieldStreak").value);
  if (streak === playerTools.playerStats?.winStreak) return;
  if (
    !(await confirmDialog({
      title: `Set ${user.name}’s streak to ${streak}?`,
      message:
        "This changes past shared battle results, including teammates’ and opponents’ records. Awarded currency and trophies stay unchanged.",
      confirmLabel: "Set streak",
      danger: true,
    }))
  )
    return;
  playerTools.streakSaving = true;
  $("#saveStreak").disabled = true;
  try {
    const result = await fetchJson(adminUserPath(user.user_id, "streak"), {
      method: "POST",
      body: { streak },
    });
    try {
      await refreshPlayerDetails(user.user_id, false, false);
    } catch {
      showToast(`Streak saved to ${streak}. Reopen the player to refresh the details.`, true);
      return;
    }
    showToast(`Set streak to ${streak} · ${result.changedMatches} battle results changed`);
  } catch (error) {
    showToast(error.message || "Unable to set streak", true);
  } finally {
    playerTools.streakSaving = false;
    $("#saveStreak").disabled = !playerTools.playerStats || !!playerTools.playerStats.error;
  }
}

async function refreshCurrencyHistory(id) {
  try {
    const data = await fetchJson(adminUserPath(id));
    if (state.selectedUser?.user_id === id)
      $("#currencyHistory").replaceChildren(
        historyTable("Currency activity", data.history.currency),
      );
  } catch {
    /* The grant already succeeded; the table refreshes next time. */
  }
}

async function openPlayer(id) {
  if (state.selectedUser && state.selectedUser.user_id !== id && !(await confirmLeavePlayer()))
    return;
  if (state.view !== "players" && !(await switchView("players", { updateHash: false }))) return;
  const isCurrent = startDetails();
  setStatus(`Loading player #${id}…`);
  try {
    const data = await fetchJson(adminUserPath(id));
    if (!isCurrent() || state.view !== "players") return;
    populatePlayer(data.user);
    renderPlayerDetails(data.user, data.history);
    renderPlayerStats(data.user, data.stats);
    playerTools.inventoryEditor.set(data.user.user_id, data.inventory);
    $("#playerDirectory").hidden = true;
    $("#playerWorkspace").hidden = false;
    selectPlayerTab("currency");
    $("#adminMain").scrollTop = 0;
    setStatus(`${data.user.name} · #${data.user.user_id}`);
    syncHash();
  } catch (error) {
    if (isCurrent() && state.view === "players") {
      showToast(error.message, true);
      syncHash();
    }
  }
}

function resetPlayer() {
  startDetails();
  state.selectedUser = null;
  $("#playerWorkspace").hidden = true;
  $("#playerDirectory").hidden = false;
  $("#playerSaveBar").hidden = true;
}

async function closePlayer() {
  if (!(await confirmLeavePlayer())) return;
  resetPlayer();
  syncHash();
  searchPlayers();
}

export {
  searchTimer,
  searchPlayers,
  queuePlayerSearch,
  renderBalances,
  selectPlayerTab,
  renderLevels,
  isPlayerDirty,
  updateSaveBar,
  confirmLeavePlayer,
  savePlayer,
  updateRestrictionForm,
  renderBanStatus,
  changeRestriction,
  refreshPlayerDetails,
  saveStreak,
  refreshCurrencyHistory,
  openPlayer,
  resetPlayer,
  closePlayer,
};
