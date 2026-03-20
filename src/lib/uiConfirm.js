import { playSound } from "./uiSounds.js";

export function showUiConfirm({
  title = "Confirm",
  message = "Are you sure?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmIcon = null,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "cs-confirm-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "cs-confirm";
    dialog.addEventListener("click", (e) => e.stopPropagation());

    const titleEl = document.createElement("div");
    titleEl.className = "cs-confirm-title";
    titleEl.textContent = String(title || "Confirm");

    const body = document.createElement("div");
    body.className = "cs-confirm-body";
    const p = document.createElement("p");
    p.textContent = String(message || "Are you sure?");
    body.appendChild(p);

    const actions = document.createElement("div");
    actions.className = "cs-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cs-btn cancel pixel-menu-button";
    cancelBtn.type = "button";
    cancelBtn.textContent = String(cancelLabel || "Cancel");

    const okBtn = document.createElement("button");
    okBtn.className = "cs-btn confirm pixel-menu-button";
    okBtn.type = "button";

    if (confirmIcon) {
      const icon = document.createElement("img");
      icon.className = "cs-currency";
      icon.src = confirmIcon;
      icon.alt = "";
      okBtn.appendChild(icon);
    }
    const okText = document.createElement("span");
    okText.textContent = String(confirmLabel || "Confirm");
    okBtn.appendChild(okText);

    const cleanup = (answer) => {
      try {
        backdrop.remove();
      } catch (_) {}
      resolve(!!answer);
    };

    cancelBtn.onclick = () => {
      playSound("cursor4", 0.2);
      cleanup(false);
    };
    okBtn.onclick = () => {
      playSound("cursor4", 0.2);
      cleanup(true);
    };

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup(false);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(titleEl);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
  });
}
