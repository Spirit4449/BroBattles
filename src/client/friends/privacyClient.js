import privacyShared from "../../shared/social/privacy.cjs";
import { createPixelSelect } from "../ui/pixelSelect.js";

export const { PRIVACY_FIELDS, normalizePrivacy } = privacyShared;

// The friends panel and the Settings dialog live in separate bundles, so a
// window event keeps both in step with the saved values.
const EVENT = "bb:privacy-changed";

export function announcePrivacy(privacy) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalizePrivacy(privacy) }));
}

export function onPrivacyChange(handler) {
  const listener = (event) => handler(event.detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// Resolves to null for guests and signed-out visitors.
export async function loadPrivacy() {
  const response = await fetch("/friends/privacy", { credentials: "same-origin" });
  if (response.status === 401 || response.status === 403) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Couldn't load privacy settings.");
  return normalizePrivacy(data.privacy);
}

export async function savePrivacy(update) {
  const response = await fetch("/friends/privacy", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ privacy: update }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.error || "Couldn't save privacy settings."), { statusCode: response.status });
  const privacy = normalizePrivacy(data.privacy);
  announcePrivacy(privacy);
  return privacy;
}

// A pixel dropdown or checkbox for one field; calls onChange(value).
export function privacyControl(field, value, onChange, { compact = false } = {}) {
  if (field.boolean) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;
    input.setAttribute("aria-label", field.label);
    input.addEventListener("change", () => onChange(input.checked));
    return { element: input, setValue: (next) => { input.checked = !!next; }, setDisabled: (off) => { input.disabled = off; } };
  }
  return createPixelSelect({ options: field.options, value, label: field.label, onChange, className: compact ? "is-compact" : "" });
}
