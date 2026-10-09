// cookies.js

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
