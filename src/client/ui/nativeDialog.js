import { getPageScope } from "../lib/globals.cjs";
import { wireBackdropDismiss } from "../site/dialogDismiss.mjs";

const DIALOG_STACK = Symbol.for("bro-battles.native-dialogs");

export function wireDismiss(dialog, {
  backdrop = true,
  onClose,
  trigger,
  escape = false,
  dismiss = () => dialog.close(),
  onEscape = dismiss,
} = {}) {
  const { ownerDocument: document } = dialog;
  const eventTarget = document.defaultView;
  const stack = document[DIALOG_STACK] ||= [];
  const isOpen = candidate => candidate.isConnected && candidate.hasAttribute("open");
  let disposed = false;
  let unregisterScope;
  const removeBackdrop = backdrop === true
    ? wireBackdropDismiss(dialog, dismiss)
    : null;
  const onBackdropClick = event => {
    if (event.target !== dialog) return;
    if (backdrop === "target") {
      dismiss();
      return;
    }
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
  };

  const onKeyDown = event => {
    if (event.key !== "Escape" || event.defaultPrevented ||
        stack.findLast(isOpen) !== dialog) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onEscape();
  };
  const onCancel = event => {
    event.preventDefault();
    onEscape();
  };
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    unregisterScope?.();
    const index = stack.lastIndexOf(dialog);
    if (index >= 0) stack.splice(index, 1);
    removeBackdrop?.();
    eventTarget?.removeEventListener("keydown", onKeyDown, true);
    dialog.removeEventListener("click", onBackdropClick);
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("close", onClosed);
    return true;
  };
  const onClosed = () => {
    if (!dispose()) return;
    try {
      onClose?.();
    } finally {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  };

  stack.push(dialog);
  if (escape) eventTarget?.addEventListener("keydown", onKeyDown, true);
  if (backdrop === "target" || backdrop === "click") dialog.addEventListener("click", onBackdropClick);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("close", onClosed, { once: true });
  if (typeof window !== "undefined") {
    unregisterScope = getPageScope()?.onDispose(() => {
      if (!dispose()) return;
      // Native close events are asynchronous. Release the retired page's UI
      // and listeners now, without moving focus back to it.
      dialog.close();
      onClose?.();
    });
  }
  return dispose;
}

export function openModalDialog(dialog, options = {}) {
  const dispose = wireDismiss(dialog, options);
  try {
    dialog.showModal();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
