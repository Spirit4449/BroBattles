const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const skinsCatalog = require("../src/server/services/cosmetics/skinsCatalog");
const { getPlayerCardById } = require("../src/server/services/cosmetics/playerCardsCatalog");
const { getProfileIconById } = require("../src/server/services/cosmetics/profileIconsCatalog");
const shopCatalog = require("../src/server/services/shop/shopCatalog");
const { syncSkinOwnershipForUser } = require("../src/server/services/cosmetics/skinOwnership");
const { MapRepository } = require("../src/server/services/maps/mapRepository");
const { clone, mapSummary } = require("../src/shared/maps/mapDocument");
const defaults = require("../src/shared/maps").mapDefaults;

function countReads(t) {
  const original = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function (file, ...rest) {
    if (String(file).endsWith("Catalog.json")) reads.push(path.basename(String(file)));
    return original.call(this, file, ...rest);
  };
  t.after(() => { fs.readFileSync = original; });
  return reads;
}

test("cosmetic and shop catalogs load once, index by id, and reload after invalidation", (t) => {
  shopCatalog.invalidateCatalog();
  const reads = countReads(t);
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/shared/catalogs/skinsCatalog.json"), "utf8"));
  reads.length = 0;

  for (const [character, entry] of Object.entries(raw.characters)) {
    for (const skin of entry.skins) {
      assert.deepEqual(skinsCatalog.getSkinById(skin.id), { ...skin, character });
      skinsCatalog.buildSkinAssetUrl(character, skin.id);
      skinsCatalog.getSkinGameAssets(character, skin.id);
    }
  }
  shopCatalog.getShopCatalog();
  shopCatalog.getShopCatalogErrors();
  getPlayerCardById("missing");
  getProfileIconById("missing");
  assert.deepEqual(reads.sort(), [
    "playerCardsCatalog.json",
    "profileIconsCatalog.json",
    "shopCatalog.json",
    "skinsCatalog.json",
  ]);

  const before = shopCatalog.getShopCatalog();
  assert.equal(shopCatalog.getShopCatalog(), before);
  assert.ok(Object.isFrozen(before.offers[0]));
  const offer = before.offers[0];
  assert.equal(shopCatalog.getShopOfferById(offer.id), offer);

  shopCatalog.invalidateCatalog();
  assert.notEqual(shopCatalog.getShopCatalog(), before);
  assert.deepEqual(shopCatalog.getShopCatalog(), before);

  // A cosmetic-only reload must still revalidate the shop against it.
  const validated = shopCatalog.getShopCatalog();
  skinsCatalog.invalidateSkinsCatalog();
  assert.notEqual(shopCatalog.getShopCatalog(), validated);
});

function fakeSkinDb(userRow) {
  const owned = new Set();
  const writes = [];
  return {
    writes,
    owned,
    runQuery: async (sql, params) => {
      if (sql.startsWith("SELECT skin_id")) return [...owned].map((skin_id) => ({ skin_id }));
      if (sql.startsWith("INSERT IGNORE INTO user_skins")) {
        writes.push("insert");
        for (let i = 1; i < params.length; i += 2) owned.add(params[i]);
        return { affectedRows: params.length / 2 };
      }
      if (sql.startsWith("UPDATE users SET selected_skin_id_by_char")) {
        writes.push("update");
        userRow.selected_skin_id_by_char = params[0];
        return {};
      }
      throw new Error(`unexpected query ${sql}`);
    },
  };
}

test("skin ownership sync writes only when unlocks or selections change", async () => {
  const userRow = { user_id: 7, char_levels: JSON.stringify({ ninja: 1, thorg: 1 }), selected_skin_id_by_char: null };
  const db = fakeSkinDb(userRow);
  const first = await syncSkinOwnershipForUser(db, userRow);
  assert.ok(first.ownedSkinIds.length > 0);
  assert.deepEqual(db.writes, ["insert", "update"]);

  db.writes.length = 0;
  const second = await syncSkinOwnershipForUser(db, userRow);
  assert.deepEqual(db.writes, []);
  assert.deepEqual(second, first);

  // A stale entry for an unknown character is still cleaned up.
  const stored = JSON.parse(userRow.selected_skin_id_by_char);
  userRow.selected_skin_id_by_char = JSON.stringify({ ...stored, nobody: "ghost" });
  await syncSkinOwnershipForUser(db, userRow);
  assert.deepEqual(db.writes, ["update"]);
});

test("map metadata is cached, cloned on read, and invalidated by save", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-maps-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = new MapRepository(dir);
  const expected = repo.list().map(({ document }) => mapSummary(document));
  assert.deepEqual(repo.listMetadata(), expected);

  const read = repo.listMetadata();
  read[0].label = "mutated";
  assert.deepEqual(repo.listMetadata(), expected);

  const original = repo.get(1);
  const doc = clone(original.document);
  doc.label = "Renamed Peaks";
  repo.save(doc, original.revision);
  assert.equal(repo.listMetadata().find((map) => map.id === 1).label, "Renamed Peaks");

  // Another process writing a new map file is picked up once the recheck window passes.
  const extra = clone(defaults[0]);
  extra.id = 9;
  fs.writeFileSync(path.join(dir, "9.json"), JSON.stringify(extra));
  repo._metadataCheckedAt = 0;
  assert.ok(repo.listMetadata().some((map) => map.id === 9));
});
