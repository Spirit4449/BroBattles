const test = require("node:test");
const assert = require("node:assert/strict");

const {
  characterDefinitions,
} = require("../src/shared/characters");
const skinsCatalog = require("../src/shared/skinsCatalog.json");
const trophySystemCatalog = require("../src/shared/trophySystem.catalog.json");

test("characters do not have rarities", () => {
  for (const [character, definition] of Object.entries(characterDefinitions)) {
    assert.equal(
      Object.hasOwn(definition, "rarity"),
      false,
      `${character} definition must not have a rarity`,
    );
    assert.equal(
      Object.hasOwn(definition.stats, "rarity"),
      false,
      `${character} stats must not have a rarity`,
    );
  }

  const catalogEntries = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "character") catalogEntries.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(trophySystemCatalog);

  for (const reward of catalogEntries) {
    assert.equal(
      Object.hasOwn(reward, "rarity"),
      false,
      `${reward.itemId} character reward must not have a rarity`,
    );
  }
});

test("every default skin has common rarity", () => {
  for (const [character, entry] of Object.entries(skinsCatalog.characters)) {
    const defaultSkin = entry.skins.find(
      (skin) => skin.id === entry.defaultSkinId,
    );

    assert.ok(defaultSkin, `${character} must have its default skin`);
    assert.equal(
      defaultSkin.rarity,
      "common",
      `${entry.defaultSkinId} must be common`,
    );
  }
});
