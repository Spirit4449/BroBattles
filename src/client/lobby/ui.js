import { escapeHtml } from "../../shared/site/html.cjs";

export async function fetchLobbyJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export { fetchLobbyJson as profileFetchJson };

export function openOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

export function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

export function isOverlayOpen(id) {
  const overlay = document.getElementById(id);
  return !!overlay && !overlay.classList.contains("hidden");
}

export { escapeHtml };
