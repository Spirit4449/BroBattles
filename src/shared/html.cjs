// Escape plain text and quoted HTML attributes. This does not validate URLs.
const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

// Catalog artwork is served from our assets directory, never arbitrary URLs.
function assetUrl(value, fallback = "/assets/player-cards/default.webp") {
  const raw = String(value ?? "");
  if (!raw.startsWith("/assets/") || /[\\\x00-\x20]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "https://assets.invalid");
    return url.origin === "https://assets.invalid" && url.pathname.startsWith("/assets/")
      ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { escapeHtml, assetUrl };
