// cookies.js

const DEFAULT_PATH = "/";
const DEFAULT_SAMESITE = "Lax";

/**
 * Set a non-HttpOnly cookie from the browser.
 * NOTE: You cannot set/clear the signed HttpOnly identity cookie (guest_id/user_id) from JS.
 * Use a server endpoint (e.g., POST /logout) to clear identity cookies.
 */
export function setCookie(
  name,
  value,
  {
    days = 30,           // default 30 days
    path = DEFAULT_PATH,
    sameSite = DEFAULT_SAMESITE, // "Lax" by default
    secure,              // auto-true on HTTPS if not provided
  } = {}
) {
  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60)); // seconds
  const isHttps =
    typeof window !== "undefined" &&
    window.location &&
    window.location.protocol === "https:";
  const useSecure = secure ?? isHttps;

  let cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ` +
    `Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}`;

  if (useSecure) cookie += "; Secure";

  document.cookie = cookie;
}

/**
 * Get a cookie value by name. Returns "" if not found (backward compatible).
 */
export function getCookie(name) {
  const needle = `${encodeURIComponent(name)}=`;
  const raw = document.cookie || "";
  if (!raw) return "";
  const parts = raw.split("; ");
  for (const part of parts) {
    if (part.startsWith(needle)) {
      return decodeURIComponent(part.slice(needle.length));
    }
  }
  return "";
}

/** Convenience helper for your UI banner */
export function getDisplayName() {
  return getCookie("display_name") || "Guest";
}
