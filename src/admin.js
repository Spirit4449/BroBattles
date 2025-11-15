import "./styles/admin.css";

const state = {
  stats: null,
  runtime: null,
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
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function renderStats(stats) {
  const mapping = [
    ["users", "users"],
    ["guests", "guests"],
    ["parties", "parties"],
    ["live_matches", "live"],
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
    li.innerHTML = `<strong>${
      item.name || `Match ${item.match_id}`
    }</strong><span>${
      item.status || `${item.mode || "?"}v${item.mode || "?"}`
    }</span>`;
    container.appendChild(li);
  });
}

function populateRuntimeForm(runtime) {
  if (!runtime) return;
  const maintenance = $("#maintenanceToggle");
  const announcement = $("#announcementField");
  const coins = $("#rewardCoinMultiplier");
  const gems = $("#rewardGemMultiplier");
  const floor = $("#rewardFloor");
  const ceiling = $("#rewardCeiling");
  if (maintenance) maintenance.checked = !!runtime.maintenanceMode;
  if (announcement) announcement.value = runtime.announcements || "";
  if (coins) coins.value = runtime?.rewardMultipliers?.coins?.toString() || "1";
  if (gems) gems.value = runtime?.rewardMultipliers?.gems?.toString() || "1";
  if (floor) floor.value = runtime?.rewardFloor ?? 5;
  if (ceiling) ceiling.value = runtime?.rewardCeiling ?? 500;
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
  $("#fieldCoins").value = user.coins ?? 0;
  $("#fieldGems").value = user.gems ?? 0;
  $("#fieldTrophies").value = user.trophies ?? 0;
  $("#fieldStatus").value = user.status || "offline";
  $("#fieldClass").value = user.char_class || "ninja";
}

async function handleBootstrap() {
  try {
    const data = await fetchJson("/api/admin/bootstrap");
    state.stats = data.stats;
    state.runtime = data.runtime;
    renderStats(data.stats);
    renderRecent(data.recentUsers, $("#recentUsers"));
    renderRecent(data.recentMatches, $("#recentMatches"));
    populateRuntimeForm(data.runtime);
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

async function handleUserSearch(e) {
  e.preventDefault();
  const query = $("#userSearch").value.trim();
  if (!query) return;
  try {
    const data = await fetchJson("/api/admin/user-search", {
      method: "POST",
      body: { query },
    });
    populateUserEditor(data.user);
    showToast("User loaded");
  } catch (err) {
    showToast(err.message || "Lookup failed", true);
  }
}

async function handleUserUpdate(e) {
  e.preventDefault();
  if (!state.selectedUser) return;
  const payload = {
    userId: state.selectedUser.user_id,
    changes: {
      coins: Number($("#fieldCoins").value),
      gems: Number($("#fieldGems").value),
      trophies: Number($("#fieldTrophies").value),
      char_class: $("#fieldClass").value.trim(),
      status: $("#fieldStatus").value.trim(),
    },
  };
  try {
    const data = await fetchJson("/api/admin/user-update", {
      method: "POST",
      body: payload,
    });
    populateUserEditor(data.user);
    showToast("User updated");
  } catch (err) {
    showToast(err.message || "Update failed", true);
  }
}

async function handleRuntimeSave(e) {
  e.preventDefault();
  const payload = {
    maintenanceMode: $("#maintenanceToggle").checked,
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
  const searchForm = $("#userSearchForm");
  if (searchForm) searchForm.addEventListener("submit", handleUserSearch);
  const userForm = $("#userEditForm");
  if (userForm) userForm.addEventListener("submit", handleUserUpdate);
  const runtimeForm = $("#runtimeForm");
  if (runtimeForm) runtimeForm.addEventListener("submit", handleRuntimeSave);
  handleBootstrap();
}

document.addEventListener("DOMContentLoaded", init);
