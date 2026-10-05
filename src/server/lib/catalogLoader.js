const fs = require("fs");

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Catalog JSON is read once and shared. Callers receive frozen data so one
// request cannot corrupt the catalog for every later lookup. `build` derives
// lookup indexes once per load; `version` advances on every successful load so
// derived caches (shop validation) can tell when a dependency changed,
// including recovery from a failed load.
function createCatalogLoader({ name, filePath, fallback, build = () => ({}) }) {
  let state = null;
  let generation = 0;

  function load() {
    if (state) return state;
    let catalog;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      catalog = raw && typeof raw === "object" ? raw : {};
    } catch (error) {
      // Failures are not cached: return the fallback and retry on next access.
      console.error(`[${name}] failed to load catalog`, error);
      const fallbackCatalog = deepFreeze(fallback());
      return { catalog: fallbackCatalog, indexes: build(fallbackCatalog), error };
    }
    deepFreeze(catalog);
    generation += 1;
    state = { catalog, indexes: build(catalog), generation };
    return state;
  }

  return {
    get: () => load().catalog,
    indexes: () => load().indexes,
    // 0 while the catalog is failing to load, so dependents never cache it.
    version: () => load().generation || 0,
    // { catalog, indexes, generation?, error? } from a single load attempt.
    snapshot: load,
    invalidate() {
      state = null;
    },
  };
}

module.exports = { createCatalogLoader, deepFreeze };
