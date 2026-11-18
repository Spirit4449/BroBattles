const RARITIES = Object.freeze(["common", "rare", "epic", "legendary"]);

function rarityRank(rarity, fallback = RARITIES.length) {
  const index = RARITIES.indexOf(rarity);
  return index < 0 ? fallback : index;
}

module.exports = { RARITIES, rarityRank };
