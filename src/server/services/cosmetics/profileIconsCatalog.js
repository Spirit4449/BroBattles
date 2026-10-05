const path = require("path");
const { DEFAULT_CHARACTER } = require("../../../shared/characters/characterStats.js");
const { createCatalogLoader } = require("../../lib/catalogLoader");

const CATALOG_PATH = path.resolve(
  __dirname,
  "../../../shared/catalogs/profileIconsCatalog.json",
);

function buildIconIndexes(catalog) {
  const iconById = new Map();
  for (const icon of Array.isArray(catalog?.icons) ? catalog.icons : []) {
    const id = String(icon?.id || "");
    if (!iconById.has(id)) iconById.set(id, icon);
  }
  return { iconById };
}

const loader = createCatalogLoader({
  name: "profile-icons",
  filePath: CATALOG_PATH,
  fallback: () => ({ version: 1, defaultIconId: DEFAULT_CHARACTER, icons: [] }),
  build: buildIconIndexes,
});

function getProfileIconsCatalog() {
  return loader.get();
}

function invalidateProfileIconsCatalog() {
  loader.invalidate();
}

function getCatalogVersion() {
  return loader.version();
}

function getProfileIconById(iconId) {
  const id = String(iconId || "").trim();
  if (!id) return null;
  return loader.indexes().iconById.get(id) || null;
}

module.exports = {
  getCatalogVersion,
  getProfileIconsCatalog,
  getProfileIconById,
  invalidateProfileIconsCatalog,
};
