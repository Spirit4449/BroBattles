import { escapeHtml } from "../../shared/site/html.cjs";
import { requestJson } from "../lib/http.js";
import { createModalFocus } from "../ui/modalFocus.js";

export { requestJson as fetchLobbyJson, requestJson as profileFetchJson };

const overlays = new Map();
const openOverlays = new Set();

export function registerOverlay({ id, closeButtonId, backdropSelector, onClose }) {
  const overlay = document.getElementById(id);
  if (!overlay || overlays.has(id)) return;
  const close = () => closeOverlay(id);
  document.getElementById(closeButtonId)?.addEventListener("click", close);
  if (backdropSelector) overlay.querySelector(backdropSelector)?.addEventListener("click", close);
  const root = overlay.querySelector('[role="dialog"][aria-modal="true"]');
  const focus = root ? createModalFocus(root, { onEscape: close }) : null;
  overlays.set(id, { onClose, focus });
  if (isOverlayOpen(id)) openOverlays.add(id);
}

export function openOverlay(id, trigger = document.activeElement) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  openOverlays.delete(id);
  openOverlays.add(id);
  overlays.get(id)?.focus?.activate(trigger);
}

export function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  openOverlays.delete(id);
  if (!overlay.classList.contains("hidden")) overlays.get(id)?.onClose?.();
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  overlays.get(id)?.focus?.deactivate();
}

export function isOverlayOpen(id) {
  const overlay = document.getElementById(id);
  return !!overlay && !overlay.classList.contains("hidden");
}

export function closeTopLobbyOverlay() {
  const top = [...openOverlays].findLast(id => isOverlayOpen(id));
  if (!top) return false;
  closeOverlay(top);
  return true;
}

export { escapeHtml };
