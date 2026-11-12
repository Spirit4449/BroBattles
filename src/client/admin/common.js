// Small DOM and network helpers shared by the admin page modules.
import { DEFAULT_CHARACTER } from "../../shared/characters/characterStats";

export const $ = (selector, root = document) => root.querySelector(selector);
export const fmt = (value) => Number(value || 0).toLocaleString("en-US");
export const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value))}`;
export const titleCase = (text) => String(text || "").charAt(0).toUpperCase() + String(text || "").slice(1);

export function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

export function button(text, className, onClick) {
  const el = node("button", text, className);
  el.type = "button";
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

export function field(labelText, control, hint) {
  const label = node("label", null, "field");
  label.append(node("span", labelText), control);
  if (hint) label.append(node("small", hint, "hint"));
  return label;
}

export function input(type, value, attrs = {}) {
  const el = node("input");
  el.type = type;
  if (value != null) el.value = value;
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  return el;
}

export function select(options, value) {
  const el = node("select");
  for (const option of options) {
    const [val, label] = Array.isArray(option) ? option : [option, titleCase(option)];
    const opt = node("option", label);
    opt.value = val;
    el.append(opt);
  }
  if (value != null) el.value = value;
  return el;
}

export function currencyIcon(currency, size = 16) {
  const img = node("img", null, "currency-icon");
  img.src = `/assets/icons/${currency === "coins" ? "coin" : "gem"}.webp`;
  img.alt = currency === "coins" ? "Coins" : "Gems";
  img.width = img.height = size;
  return img;
}

export function avatarFor(user) {
  const icon = String(user?.selected_profile_icon_id || user?.userIcon || "").replace(/[^a-z0-9_-]/gi, "");
  return `/assets/profile-icons/${icon || user?.char_class || DEFAULT_CHARACTER}.webp`;
}

export function setAvatar(img, user) {
  img.src = avatarFor(user);
  img.onerror = () => { img.onerror = null; img.src = `/assets/profile-icons/${DEFAULT_CHARACTER}.webp`; };
  return img;
}

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

export function formatAdminDate(value, short = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", short
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

export function timeAgo(value) {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 30) return `${Math.round(minutes / 1440)}d ago`;
  return formatAdminDate(value, true);
}

export function setStatus(message, isError = false) {
  const el = $("#status");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", isError);
}

let toastTimer = 0;
export function showToast(message, isError = false) {
  const host = $("#toast");
  $("#toastText").textContent = message;
  // A popover sits in the top layer, so the toast also shows above dialogs.
  try { if (host.matches(":popover-open")) host.hidePopover(); host.showPopover(); } catch { /* Older browsers keep the fixed toast. */ }
  host.classList.toggle("error", isError);
  host.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove("visible"), isError ? 5000 : 2600);
  setStatus(message, isError);
}

// One reusable modal for forms: returns { body, close } and resolves actions.
export function openModal(title, { wide = false, onSubmit, submitLabel = "Done", extraActions = [] } = {}) {
  const dialog = node("dialog", null, `modal${wide ? " is-wide" : ""}`);
  const form = node("form", null, "modal-frame");
  form.method = "dialog";
  const header = node("header");
  header.append(node("h2", title), button("×", "dialog-close", () => close()));
  const body = node("div", null, "modal-body");
  const error = node("p", null, "modal-error");
  error.hidden = true;
  const actions = node("div", null, "modal-actions");
  for (const extra of extraActions) actions.append(button(extra.label, extra.className || "", () => extra.run(close)));
  actions.append(node("span", null, "spacer"), button("Cancel", "", () => close()));
  const submit = node("button", submitLabel, "primary");
  submit.type = "submit";
  actions.append(submit);
  form.append(header, body, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  function close() { dialog.close(); dialog.remove(); }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      if (onSubmit?.() === false) return;
      close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.showModal();
  return { body, close, dialog };
}
