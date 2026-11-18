import { wireDismiss } from "../ui/nativeDialog";
import { wireOutsideDismiss } from "./dialogDismiss.mjs";
import { element } from "../ui/dom";

export function isSiteDialogOpen() {
  return Boolean(document.querySelector("dialog.site-dialog[open]"));
}

function openDialog(title, { dismissible = true, side = false } = {}) {
  const previous = document.activeElement;
  const dialog = element(
    "dialog",
    null,
    "site-dialog bb-popup" + (side ? " site-settings-side" : ""),
  );
  const header = element("header", null, "bb-popup-header");
  const heading = element("h2", title, "bb-popup-title");
  heading.tabIndex = -1;
  heading.id = `site-dialog-title-${Date.now()}`;
  header.append(heading);
  dialog.setAttribute("aria-labelledby", heading.id);
  const body = element("div", null, "site-dialog-body");
  const close = element("button", "×");
  close.type = "button";
  close.className = "site-close bb-close";
  close.setAttribute("aria-label", "Close");
  if (dismissible) header.append(close);
  dialog.append(header, body);
  document.body.append(dialog);
  close.onclick = () => dialog.close();
  if (dismissible && side) wireOutsideDismiss(dialog);
  wireDismiss(dialog, {
    backdrop: dismissible && !side,
    trigger: previous,
    onEscape: () => {
      if (dismissible && !dialog.dataset.remapping) dialog.close();
    },
    onClose: () => dialog.remove(),
  });
  document.exitPointerLock?.();
  if (side) {
    dialog.show();
    const escape = (event) => {
      if (
        event.key === "Escape" &&
        !dialog.dataset.remapping &&
        !document.querySelector("dialog:modal")
      ) {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
      }
    };
    document.addEventListener("keydown", escape, true);
    dialog.addEventListener("close", () => document.removeEventListener("keydown", escape, true), {
      once: true,
    });
  } else dialog.showModal();
  heading.focus();
  return { dialog, body };
}

export { openDialog };
