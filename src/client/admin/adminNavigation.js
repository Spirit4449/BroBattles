import { $ } from "./common";
import { initStore } from "./shop";
import { initInbox } from "./inbox";
import { state } from "./adminState";
import { isPlayerDirty, confirmLeavePlayer, openPlayer, resetPlayer } from "./players";

const VIEWS = ["overview", "players", "store", "runtime", "feedback", "support"];

const viewInit = { store: initStore, feedback: (root) => initInbox(root, "feedback"), support: (root) => initInbox(root, "support") };

const initialized = new Set();

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

export { VIEWS, switchView, syncHash, openFromHash };

