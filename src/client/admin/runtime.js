import { API_PATHS } from "../../shared/net/apiPaths.js";
import { $, node, fetchJson, showToast, confirmDialog } from "./common";
import { state, playerTools } from "./adminState";

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

function updateRuntimeState() {
  const dirty = runtimeSnapshot() !== playerTools.savedRuntime;
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
    const data = await fetchJson(API_PATHS.API_ADMIN_RUNTIME, { method: "POST", body: payload });
    state.runtime = data.runtime;
    populateRuntimeForm(state.runtime);
    showToast("Runtime settings saved");
    playerTools.savedRuntime = runtimeSnapshot();
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
    const data = await fetchJson(API_PATHS.API_ADMIN_RUNTIME, { method: "POST", body: { maintenanceUntil: null } });
    state.runtime = data.runtime;
    $("#maintenanceUntil").value = "";
    playerTools.savedRuntime = runtimeSnapshot();
    updateRuntimeState();
    showToast("Maintenance turned off. Matchmaking enabled.");
  } catch (error) {
    showToast(error.message || "Could not turn off maintenance", true);
  } finally { clear.disabled = save.disabled = false; }
}

export { populateRuntimeForm, runtimeSnapshot, updateRuntimeState, handleRuntimeSave, clearMaintenance };

