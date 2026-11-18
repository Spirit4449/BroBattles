import "../styles/ui-system.css";
import "../styles/toolShell.css";
import { isAccountBanned } from "../../shared/moderation/accountBan";
import { maintenanceClock, maintenanceRemaining } from "../../shared/site/maintenance";
import { LEVEL_CAP, getCharacterDisplayName } from "../../shared/characters/characterStats";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import { $, node } from "../admin/common";
import { isStoreDirty, setStorePlayerOpener, onStoreDirtyChange } from "../admin/shop";
import { refreshInboxBadges, setInboxPlayerOpener } from "../admin/inbox";
import { createInventoryEditor } from "../admin/playerInventory";
import { CHARACTERS, state, playerTools } from "../admin/adminState";
import { VIEWS, switchView, syncHash, openFromHash } from "../admin/adminNavigation";
import { loadGrants, handleBootstrap } from "../admin/dashboard";
import { buildGrantForm, openGrantDialog, wireGrantDialog } from "../admin/grants";
import {
  searchTimer,
  searchPlayers,
  queuePlayerSearch,
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
  openPlayer,
  resetPlayer,
  closePlayer,
} from "../admin/players";
import { updateRuntimeState, handleRuntimeSave, clearMaintenance } from "../admin/runtime";

import "../styles/chat.css";

import "../styles/admin.css";

import { initSiteShell } from "../site/shell.js";
import "../styles/ui-components.css";

initSiteShell();

wireFullscreenToggles();

// ---- Keyboard ----
const isTyping = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

function wireKeyboard() {
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#jumpSearch").focus();
      $("#jumpSearch").select();
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "s" &&
      state.selectedUser &&
      state.view === "players"
    ) {
      event.preventDefault();
      savePlayer();
      return;
    }
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isTyping(event.target) ||
      document.querySelector("dialog[open]")
    )
      return;
    if (event.key === "/") {
      event.preventDefault();
      (state.view === "players" && !state.selectedUser
        ? $("#userSearch")
        : $("#jumpSearch")
      ).focus();
    } else if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      openGrantDialog();
    } else if (/^[1-6]$/.test(event.key)) switchView(VIEWS[Number(event.key) - 1]);
  });
}

function populateCharacterSelect() {
  const choose = $("#fieldClass");
  choose.replaceChildren(
    ...CHARACTERS.map((id) =>
      Object.assign(node("option", getCharacterDisplayName(id)), { value: id }),
    ),
  );
}

function init() {
  populateCharacterSelect();
  setInboxPlayerOpener(openPlayer);
  setStorePlayerOpener(openPlayer);
  onStoreDirtyChange((dirty) => $('[data-nav="store"]').classList.toggle("has-changes", dirty));
  playerTools.inlineGrant = buildGrantForm($("#inlineGrant"), {
    getRecipients: () => (state.selectedUser ? [state.selectedUser] : []),
  });
  wireGrantDialog();
  wireKeyboard();

  $("#clearMaintenance").addEventListener("click", clearMaintenance);
  setInterval(() => {
    const until = state.runtime?.maintenanceUntil;
    const active = maintenanceRemaining(until) > 0;
    const el = $("#maintenanceCountdown");
    el.textContent = active
      ? `Maintenance · ${maintenanceClock(until)} left`
      : "Matchmaking is open";
    el.classList.toggle("is-active", active);
    $("#clearMaintenance").disabled = !active;
  }, 1000);

  $("#userSearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    playerTools.playerPage = 1;
    searchPlayers();
  });
  $("#userSearch").addEventListener("input", queuePlayerSearch);
  $("#jumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = $("#jumpSearch").value.trim();
    if (!(await confirmLeavePlayer())) return;
    if (state.view !== "players" && !(await switchView("players"))) return;
    resetPlayer();
    syncHash();
    $("#userSearch").value = query;
    playerTools.playerPage = 1;
    await searchPlayers();
    const rows = document.querySelectorAll("#playerResults .player-row");
    if (rows.length === 1 || (rows.length && /^[0-9]+$/.test(query))) rows[0].click();
    $("#jumpSearch").blur();
  });
  $("#jumpSearch").addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.currentTarget.blur();
  });

  $("#openGrant").addEventListener("click", () => openGrantDialog());
  $("#refreshGrants").addEventListener("click", loadGrants);
  $("#backToPlayers").addEventListener("click", closePlayer);
  $("#banType").addEventListener("change", updateRestrictionForm);
  $("#banPlayerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    changeRestriction($("#banType").value);
  });
  $("#unbanPlayer").addEventListener("click", () => changeRestriction("unban"));
  setInterval(() => {
    const user = state.selectedUser;
    if (user?.ban_expires_at && !isAccountBanned(user) && !$("#unbanPlayer").hidden)
      renderBanStatus(user);
  }, 1000);
  $("#userEditForm").addEventListener("input", updateSaveBar);
  $("#userEditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    savePlayer();
  });
  $("#playerSave").addEventListener("click", savePlayer);
  playerTools.inventoryEditor = createInventoryEditor($("#playerInventory"), {
    onSaved: (id) => refreshPlayerDetails(id, true),
  });
  $("#playerStreakForm").addEventListener("submit", saveStreak);
  $("#runtimeForm").addEventListener("submit", handleRuntimeSave);
  $("#runtimeForm").addEventListener("input", updateRuntimeState);
  $("#runtimeForm").addEventListener("change", updateRuntimeState);
  document.querySelectorAll("[data-levels-all]").forEach((el) =>
    el.addEventListener("click", () => {
      for (const character of CHARACTERS) {
        const current = state.levelDraft[character] ?? 0;
        // "Unlock all" keeps existing levels and only opens locked characters.
        state.levelDraft[character] = { max: LEVEL_CAP, unlock: Math.max(current, 1), lock: 0 }[
          el.dataset.levelsAll
        ];
      }
      renderLevels();
      updateSaveBar();
    }),
  );
  document
    .querySelectorAll("[data-nav]")
    .forEach((el) => el.addEventListener("click", () => switchView(el.dataset.nav)));
  document
    .querySelectorAll("[data-nav-link]")
    .forEach((el) => el.addEventListener("click", () => switchView(el.dataset.navLink)));
  document
    .querySelectorAll("[data-player-tab]")
    .forEach((el) => el.addEventListener("click", () => selectPlayerTab(el.dataset.playerTab)));
  window.addEventListener("beforeunload", (event) => {
    if ((state.selectedUser && isPlayerDirty()) || isStoreDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  window.addEventListener("hashchange", openFromHash);
  openFromHash();
  searchPlayers();
  handleBootstrap();
  loadGrants();
  refreshInboxBadges();
}

document.addEventListener("DOMContentLoaded", init);
