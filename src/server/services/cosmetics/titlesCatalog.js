const path = require("path");
const { createCatalogLoader } = require("../../lib/catalogLoader");
const loader = createCatalogLoader({
  name: "titles", filePath: path.resolve(__dirname, "../../../shared/catalogs/titlesCatalog.json"),
  fallback: () => ({ version: 1, titles: [] }),
  build: catalog => ({ byId: new Map((catalog.titles || []).map(title => [title.id, title])) }),
});
module.exports = {
  getTitlesCatalog: () => loader.get(),
  getTitleById: id => loader.indexes().byId.get(String(id || "")) || null,
  getCatalogVersion: () => loader.version(),
  invalidateTitlesCatalog: () => loader.invalidate(),
};
