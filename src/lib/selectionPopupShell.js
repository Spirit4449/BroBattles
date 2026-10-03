import { createModalFocus } from "./modalFocus.js";

const TITLE_SEQUENCE = Symbol.for("bro-battles.selection-title-sequence");
let __sharedShell = null;

export function getSharedSelectionPopupShell() {
  if (__sharedShell) return __sharedShell;

  const overlay = document.createElement("div");
  overlay.className = "character-select-overlay is-hidden";

  const titleNumber = document[TITLE_SEQUENCE] = (document[TITLE_SEQUENCE] || 0) + 1;
  const titleId = `selection-popup-title-${titleNumber}`;
  const popup = document.createElement("div");
  popup.className = "character-select-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");
  popup.setAttribute("aria-labelledby", titleId);

  const headerBar = document.createElement("div");
  headerBar.className = "popup-header";

  const title = document.createElement("h2");
  title.className = "popup-title";
  title.id = titleId;
  title.textContent = "Choose";

  const closeButton = document.createElement("button");
  closeButton.className = "close-popup bb-close pixel-menu-button";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close picker");

  const state = {
    onClose: null,
    contentNode: null,
    backgroundNode: null,
    closeAttrKeys: [],
  };

  const doClose = () => {
    if (typeof state.onClose === "function") {
      state.onClose();
      return;
    }
    hide();
  };

  closeButton.onclick = doClose;
  overlay.addEventListener("click", (e) => {
    if (!popup.contains(e.target)) doClose();
  });
  popup.addEventListener("click", (e) => e.stopPropagation());
  const focus = createModalFocus(popup, {
    initialFocus: () => closeButton,
    onEscape: doClose,
  });

  headerBar.appendChild(title);
  headerBar.appendChild(closeButton);
  popup.appendChild(headerBar);
  overlay.appendChild(popup);

  const mount = ({
    titleText,
    onClose,
    zIndex,
    closeButtonAttrs,
    closeButtonText,
    contentNode,
    backgroundNode,
  } = {}) => {
    state.onClose = typeof onClose === "function" ? onClose : null;

    if (zIndex != null) overlay.style.zIndex = String(zIndex);
    else overlay.style.removeProperty("z-index");

    title.textContent = titleText || "Choose";

    for (const key of state.closeAttrKeys) {
      closeButton.removeAttribute(key);
    }
    state.closeAttrKeys = [];
    closeButton.setAttribute("aria-label", "Close picker");
    if (closeButtonAttrs && typeof closeButtonAttrs === "object") {
      Object.entries(closeButtonAttrs).forEach(([key, val]) => {
        if (val == null) return;
        const attr = String(key);
        closeButton.setAttribute(attr, String(val));
        state.closeAttrKeys.push(attr);
      });
    }

    const closeText = String(closeButtonText || "×");
    closeButton.textContent = closeText;
    closeButton.classList.toggle(
      "profile-close",
      closeText.toLowerCase() !== "×",
    );

    if (state.backgroundNode && state.backgroundNode !== backgroundNode) {
      try {
        state.backgroundNode.remove();
      } catch (_) {}
      state.backgroundNode = null;
    }
    if (backgroundNode && state.backgroundNode !== backgroundNode) {
      state.backgroundNode = backgroundNode;
      overlay.insertBefore(backgroundNode, popup);
    }

    if (state.contentNode && state.contentNode !== contentNode) {
      try {
        state.contentNode.remove();
      } catch (_) {}
      state.contentNode = null;
    }
    if (contentNode && state.contentNode !== contentNode) {
      state.contentNode = contentNode;
      popup.appendChild(contentNode);
    }

    return api;
  };

  const show = () => {
    const wasDetached = !overlay.isConnected;
    if (!overlay.isConnected) {
      document.body.appendChild(overlay);
    }
    if (wasDetached) void overlay.offsetWidth;
    overlay.classList.remove("is-hidden");
    overlay.setAttribute("aria-hidden", "false");
    focus.activate();
    return api;
  };

  const hide = () => {
    overlay.classList.add("is-hidden");
    overlay.setAttribute("aria-hidden", "true");
    focus.deactivate();
    return api;
  };

  const api = {
    overlay,
    popup,
    headerBar,
    title,
    closeButton,
    mount,
    show,
    hide,
    close: doClose,
  };

  __sharedShell = api;
  return api;
}
