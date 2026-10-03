const path = require("path");
const { createCatalogLoader } = require("./catalogLoader");

const CATALOG_PATH = path.resolve(
  __dirname,
  "../../shared/playerCardsCatalog.json",
);

function buildCardIndexes(catalog) {
  const cardById = new Map();
  for (const card of Array.isArray(catalog?.cards) ? catalog.cards : []) {
    const id = String(card?.id);
    if (!cardById.has(id)) cardById.set(id, card);
  }
  return { cardById };
}

// Cached after the first read; dev edits are picked up by nodemon restarting
// the server (it watches src/shared JSON) or by invalidatePlayerCardsCatalog().
const loader = createCatalogLoader({
  name: "cards",
  filePath: CATALOG_PATH,
  fallback: () => ({ version: 1, defaultCardId: null, cards: [] }),
  build: buildCardIndexes,
});

function getPlayerCardsCatalog() {
  return loader.get();
}

function invalidatePlayerCardsCatalog() {
  loader.invalidate();
}

function getCatalogVersion() {
  return loader.version();
}

function getPlayerCardById(cardId) {
  const id = String(cardId || "").trim();
  if (!id) return null;
  return loader.indexes().cardById.get(id) || null;
}

module.exports = {
  getCatalogVersion,
  getPlayerCardsCatalog,
  getPlayerCardById,
  invalidatePlayerCardsCatalog,
};
