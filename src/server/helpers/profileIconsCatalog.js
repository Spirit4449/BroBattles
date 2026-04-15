const path = require("path");

const CATALOG_PATH = path.resolve(
  __dirname,
  "../../shared/profileIconsCatalog.json",
);

let _cache = null;

function _loadCatalog() {
  delete require.cache[CATALOG_PATH];
  const raw = require(CATALOG_PATH);
  return raw && typeof raw === "object" ? raw : {};
}

function getProfileIconsCatalog() {
  try {
    _cache = _loadCatalog();
  } catch (error) {
    console.error("[profile-icons] failed to load catalog", error);
    _cache = { version: 1, defaultIconId: "ninja", icons: [] };
  }
  return _cache;
}

function getProfileIconById(iconId) {
  const id = String(iconId || "").trim();
  if (!id) return null;
  const catalog = getProfileIconsCatalog();
  const icons = Array.isArray(catalog?.icons) ? catalog.icons : [];
  return icons.find((icon) => String(icon?.id || "") === id) || null;
}

module.exports = {
  getProfileIconsCatalog,
  getProfileIconById,
};
