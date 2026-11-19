import { API_PATHS } from "../../shared/net/apiPaths.js";
import { PASSWORD_MIN, PASSWORD_MAX } from "../../shared/social/textRules.js";
import { openModalDialog } from "../ui/nativeDialog.js";
import "../styles/accountDialog.css";
import "../styles/formFields.css";

export function renderAccountAccess(root, isGuest) {
  if (!root) return;
  const member = root.querySelector("[data-account-member]");
  const guestCard = root.querySelector("[data-account-guest]");
  if (member) {
    member.hidden = isGuest;
    member.querySelectorAll("button").forEach((button) => {
      button.disabled = isGuest;
    });
  }
  if (guestCard) guestCard.hidden = !isGuest;
}

export function wirePasswordChangeDialog(button, { canChange, fetchJson, onUpdated }) {
  let activeDialog;
  let saving = false;
  const close = () => activeDialog?.close();

  button?.addEventListener("click", () => {
    if (activeDialog || saving || !canChange()) return;

    const dialog = document.createElement("dialog");
    dialog.id = "password-change-dialog";
    dialog.className = "account-dialog bb-popup";
    dialog.setAttribute("aria-labelledby", "password-change-title");
    dialog.innerHTML = `
      <header class="bb-popup-header">
        <h2 id="password-change-title" class="bb-popup-title">Change Password</h2>
        <button type="button" class="bb-close pixel-menu-button" data-close aria-label="Close password change"><span aria-hidden="true">×</span></button>
      </header>
      <form id="profile-password-form" class="account-dialog-form">
        <div>
          <label class="form-label" for="profile-current-password">Current password</label>
          <input id="profile-current-password" name="currentPassword" class="form-input" type="password" autocomplete="current-password" required />
        </div>
        <div>
          <label class="form-label" for="profile-new-password">New password</label>
          <input id="profile-new-password" name="newPassword" class="form-input" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" aria-describedby="password-change-hint" required />
          <p id="password-change-hint" class="account-dialog-hint">${PASSWORD_MIN}–${PASSWORD_MAX} characters.</p>
        </div>
        <p class="account-dialog-error" role="alert" hidden></p>
        <div class="account-dialog-actions">
          <button type="button" class="bb-button" data-close>Cancel</button>
          <button type="submit" class="bb-button">Update Password</button>
        </div>
      </form>`;

    const form = dialog.querySelector("form");
    const current = form.querySelector("#profile-current-password");
    const next = form.querySelector("#profile-new-password");
    const submit = form.querySelector('[type="submit"]');
    const message = form.querySelector('[role="alert"]');
    dialog.querySelectorAll("[data-close]").forEach(control => control.addEventListener("click", close));
    form.addEventListener("input", () => { message.hidden = true; });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!dialog.hasAttribute("open") || saving || !canChange()) return;
      saving = submit.disabled = current.readOnly = next.readOnly = true;
      message.hidden = true;
      dialog.setAttribute("aria-busy", "true");
      try {
        await fetchJson(API_PATHS.PROFILE_CHANGE_PASSWORD, {
          method: "POST",
          body: { currentPassword: current.value, newPassword: next.value },
          fallbackMessage: "Unable to update password.",
        });
        if (dialog.hasAttribute("open")) {
          close();
          onUpdated();
        }
      } catch (error) {
        if (dialog.hasAttribute("open")) {
          message.textContent = error.message || "Unable to update password.";
          message.hidden = false;
        }
      } finally {
        saving = submit.disabled = current.readOnly = next.readOnly = false;
        dialog.removeAttribute("aria-busy");
      }
    });

    activeDialog = dialog;
    document.body.append(dialog);
    openModalDialog(dialog, {
      escape: true,
      trigger: button,
      onClose() {
        current.value = next.value = "";
        dialog.remove();
        activeDialog = null;
      },
    });
    current.focus();
  });

  return close;
}
