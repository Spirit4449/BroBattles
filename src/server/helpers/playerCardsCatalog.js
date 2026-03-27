const path = require("path");

const CATALOG_PATH = path.resolve(
  __dirname,
  "../../shared/playerCardsCatalog.json",
);

let _cache = null;

function _loadCatalog() {
  // Keep this dynamic in dev so edits to the catalog are picked up without restarts.
  delete require.cache[CATALOG_PATH];
  const raw = require(CATALOG_PATH);
  return raw && typeof raw === "object" ? raw : {};
}

function getPlayerCardsCatalog() {
  try {
    _cache = _loadCatalog();
  } catch (error) {
    console.error("[cards] failed to load catalog", error);
    _cache = { version: 1, defaultCardId: null, cards: [] };
  }
  return _cache;
}

function getPlayerCardById(cardId) {
  const id = String(cardId || "").trim();
  if (!id) return null;
  const catalog = getPlayerCardsCatalog();
  return (
    (Array.isArray(catalog.cards) ? catalog.cards : []).find(
      (card) => String(card?.id) === id,
    ) || null
  );
}

module.exports = {
  getPlayerCardsCatalog,
  getPlayerCardById,
};
