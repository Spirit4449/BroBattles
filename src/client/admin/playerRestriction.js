import { $, showToast, confirmDialog, formatAdminDate, fetchJson } from "./common";
import { state } from "./adminState";
import { isAccountBanned } from "../../shared/moderation/accountBan";
import { adminModerationPath, adminUserPath } from "../../shared/net/apiPaths.js";
import { renderPlayerSubtitle, renderPlayerDetails } from "./playerHistory";
export function updateRestrictionForm() {
  const temporary = $("#banType").value === "suspend";
  $("#suspensionDurationField").hidden = !temporary;
  $("#suspensionDuration").required = temporary;
  $("#banPlayer").textContent = temporary ? "Suspend player" : "Ban player";
}

export function renderBanStatus(user) {
  const banned = isAccountBanned(user);
  const temporary = banned && !!user.ban_expires_at;
  $("#banStatus").textContent = banned
    ? `${temporary ? `Suspended until ${formatAdminDate(user.ban_expires_at)}` : `Banned ${formatAdminDate(user.banned_at)}`} · ${user.ban_reason || "No reason recorded"}`
    : user.ban_expires_at
      ? `Suspension expired ${formatAdminDate(user.ban_expires_at)}`
      : "This account is not restricted.";
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

const suspensionMinutes = () =>
  Math.round((Number($("#suspensionDuration").value) || 0) * Number($("#suspensionUnit").value));

export async function changeRestriction(action) {
  const user = state.selectedUser;
  if (!user) return;
  const reason = $("#banReason").value.trim();
  const durationMinutes = suspensionMinutes();
  if (action === "suspend" && !(durationMinutes >= 1 && durationMinutes <= 525600)) {
    showToast("Choose a suspension between 1 minute and 365 days", true);
    return;
  }
  if (action !== "unban" && !reason) return;
  const confirmed =
    action === "unban"
      ? await confirmDialog({
          title: `Lift the restriction for ${user.name}?`,
          message: `#${user.user_id} can play again right away.`,
          confirmLabel: "Lift restriction",
        })
      : await confirmDialog({
          title: `${action === "suspend" ? `Suspend ${user.name} for ${describeDuration(durationMinutes)}` : `Permanently ban ${user.name}`}?`,
          message: "Their active sessions are disconnected right away.",
          details: [`Player #${user.user_id}`, `Reason: ${reason}`],
          confirmLabel: action === "suspend" ? "Suspend" : "Ban",
          danger: true,
        });
  if (!confirmed) return;
  $("#banPlayer").disabled = $("#unbanPlayer").disabled = true;
  try {
    const data = await fetchJson(adminModerationPath(action), {
      method: "POST",
      body: { userId: user.user_id, reason, ...(action === "suspend" ? { durationMinutes } : {}) },
    });
    if (state.selectedUser?.user_id === user.user_id) {
      Object.assign(state.selectedUser, {
        is_banned: data.user.is_banned,
        banned_at: data.user.banned_at,
        ban_expires_at: data.user.ban_expires_at,
        ban_reason: data.user.ban_reason,
      });
      renderBanStatus(state.selectedUser);
      renderPlayerSubtitle(user);
      try {
        const details = await fetchJson(adminUserPath(user.user_id));
        if (state.selectedUser?.user_id === user.user_id)
          renderPlayerDetails(details.user, details.history);
      } catch {
        /* The restriction changed; history refreshes when reopening the player. */
      }
    }
    showToast(
      `${user.name}: ${action === "unban" ? "restriction lifted" : action === "suspend" ? "temporarily suspended" : "banned"}`,
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    $("#banPlayer").disabled = $("#unbanPlayer").disabled = false;
  }
}
