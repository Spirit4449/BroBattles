import { createModalFocus } from "./modalFocus.js";
import { playSound } from "./uiSounds.js";
import { dismissPopup } from "./popupMotion.js";

export function mountUiConfirm({ title, headerNode, bodyNode, actionsNode, variant, onDismiss }) {
  const backdrop = document.createElement("div");
  backdrop.className = "cs-confirm-backdrop";

  const dialog = document.createElement("div");
  dialog.className = variant ? `cs-confirm ${variant}` : "cs-confirm";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);

  const heading = headerNode || document.createElement("div");
  heading.classList.add("cs-confirm-title");
  if (!headerNode) heading.textContent = title;
  const body = document.createElement("div");
  body.className = "cs-confirm-body";
  body.append(bodyNode);
  dialog.append(heading, body);
  if (actionsNode) {
    actionsNode.classList.add("cs-confirm-actions");
    dialog.append(actionsNode);
  }

  backdrop.append(dialog);
  backdrop.addEventListener("click", event => {
    event.stopPropagation();
    if (event.target === backdrop) onDismiss();
  });
  document.body.append(backdrop);
  const focus = createModalFocus(dialog, { onEscape: onDismiss });
  focus.activate();
  return { backdrop, dialog, deactivate: focus.deactivate };
}

export function showUiConfirm({
  title = "Confirm",
  message = "Are you sure?",
  bodyNode,
  variant,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmIcon = null,
  confirmContent,
  confirmAriaLabel,
  confirmSound = "cursor4",
  cancelSound = "cursor4",
  cancelVolume = 0.24,
  onConfirm,
  onDismiss,
  releaseFocusOnDismiss = false,
} = {}) {
  return new Promise(resolve => {
    let closing = false;
    const cleanup = answer => {
      if (closing) return;
      closing = true;
      onDismiss?.();
      if (releaseFocusOnDismiss) modal.deactivate();
      dismissPopup(modal.backdrop, () => {
        modal.backdrop.remove();
        modal.deactivate();
        resolve(answer);
      });
      if (answer) onConfirm?.();
    };

    if (!bodyNode) {
      bodyNode = document.createElement("p");
      bodyNode.textContent = String(message || "Are you sure?");
    }
    const actions = document.createElement("div");
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cs-btn cancel pixel-menu-button";
    cancelBtn.type = "button";
    cancelBtn.textContent = String(cancelLabel || "Cancel");
    cancelBtn.onclick = () => {
      if (cancelSound) playSound(cancelSound, cancelVolume);
      cleanup(false);
    };
    actions.append(cancelBtn);

    if (confirmLabel !== null) {
      const okBtn = document.createElement("button");
      okBtn.className = "cs-btn confirm pixel-menu-button";
      okBtn.type = "button";
      if (confirmAriaLabel) okBtn.setAttribute("aria-label", confirmAriaLabel);
      if (confirmIcon) {
        const icon = document.createElement("img");
        icon.className = "cs-currency";
        icon.src = confirmIcon;
        icon.alt = "";
        okBtn.append(icon);
      }
      const okText = document.createElement("span");
      okText.textContent = String(confirmLabel || "Confirm");
      okBtn.append(...(confirmContent || [okText]));
      okBtn.onclick = () => {
        if (confirmSound) playSound(confirmSound, 0.32);
        cleanup(true);
      };
      actions.append(okBtn);
    }
    const modal = mountUiConfirm({
      title: String(title || "Confirm"),
      bodyNode,
      variant,
      actionsNode: actions,
      onDismiss: () => cleanup(false),
    });
  });
}
