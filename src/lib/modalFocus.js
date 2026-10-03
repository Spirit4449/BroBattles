// A document-scoped stack also works when separate page bundles import this module.
const STACK_KEY = Symbol.for("bro-battles.modal-focus");
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';

function canFocus(element) {
  return element?.isConnected && !element.matches(':disabled, [hidden]') &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

export function createModalFocus(root, { initialFocus, onEscape, fallbackFocus } = {}) {
  const document = root.ownerDocument;
  const stack = document[STACK_KEY] ||= [];
  let active = false;
  let returnFocus = null;
  let redirecting = false;
  let detachObserver = null;
  const entry = { root };
  root.tabIndex = -1;

  const ownsFocus = () => {
    // Navigation can remove a modal without calling its component's close method.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].root.isConnected) stack.splice(i, 1);
    }
    if (!active || stack.at(-1) !== entry) return false;
    // Native dialogs own the browser's top layer and its focus management.
    const nativeModal = document.querySelector('dialog:modal');
    return !nativeModal || nativeModal.contains(root);
  };
  const focusable = () => [...root.querySelectorAll(FOCUSABLE)]
    .filter(element => element.tabIndex >= 0 && canFocus(element));
  const focusFirst = () => {
    const preferred = initialFocus?.();
    const target = canFocus(preferred) ? preferred : focusable()[0] || root;
    target.focus({ preventScroll: true });
  };
  const onKeyDown = event => {
    if (!ownsFocus() || event.defaultPrevented) return;
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    } else if (event.key === "Tab") {
      const items = focusable();
      const index = items.indexOf(document.activeElement);
      if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) || root : items[0] || root).focus({ preventScroll: true });
      }
    }
  };
  const onFocusIn = event => {
    if (!ownsFocus() || root.contains(event.target) || redirecting) return;
    redirecting = true;
    focusFirst();
    redirecting = false;
  };

  const controller = {
    activate(trigger = document.activeElement) {
      if (active) {
        if (ownsFocus() && !root.contains(document.activeElement)) focusFirst();
        return;
      }
      returnFocus = trigger;
      active = true;
      stack.push(entry);
      detachObserver = new MutationObserver(() => {
        if (!root.isConnected) controller.deactivate({ restoreFocus: false });
      });
      detachObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("focusin", onFocusIn, true);
      if (ownsFocus()) focusFirst();
    },
    deactivate({ restoreFocus = true } = {}) {
      if (!active) return;
      const wasTop = stack.at(-1) === entry;
      active = false;
      detachObserver?.disconnect();
      detachObserver = null;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      if (restoreFocus && wasTop) {
        const target = canFocus(returnFocus) ? returnFocus : fallbackFocus?.();
        if (canFocus(target)) target.focus({ preventScroll: true });
        else if (canFocus(stack.at(-1)?.root)) stack.at(-1).root.focus({ preventScroll: true });
      }
      returnFocus = null;
    },
  };
  return controller;
}
