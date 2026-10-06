const { getPlayerCardsCatalog } = require("../../services/cosmetics/playerCardsCatalog");
const { createRandom } = require("./random");

// Each row is a relative rarity weight at a lobby trophy count. The roll is
// stable for a bot's saved seed and trophy count across ready check and reload.
const RARITY_WEIGHTS = [
  [0, { common: 90, rare: 10, epic: 0, legendary: 0 }],
  [1750, { common: 50, rare: 38, epic: 12, legendary: 0 }],
  [4000, { common: 30, rare: 40, epic: 30, legendary: 0 }],
  [10000, { common: 10, rare: 25, epic: 40, legendary: 25 }],
];

function rarityWeights(trophies) {
  const rating = Math.max(0, Number(trophies) || 0);
  const upper = RARITY_WEIGHTS.findIndex(([threshold]) => threshold >= rating);
  const high = upper < 0 ? RARITY_WEIGHTS.at(-1) : RARITY_WEIGHTS[upper];
  const low = upper <= 0 ? high : RARITY_WEIGHTS[upper - 1];
  const fraction = high[0] === low[0] ? 0 : (rating - low[0]) / (high[0] - low[0]);
  return Object.fromEntries(Object.keys(high[1]).map((rarity) => [
    rarity,
    low[1][rarity] + (high[1][rarity] - low[1][rarity]) * fraction,
  ]));
}

function selectBotPlayerCard(seed, trophies) {
  const catalog = getPlayerCardsCatalog();
  const rating = Math.max(0, Number(trophies) || 0);
  const eligible = (catalog.cards || []).filter((card) =>
    card.id && card.rarity &&
    (card.unlock?.type !== "trophyRoad" || rating >= Number(card.unlock.min)),
  );
  const weights = rarityWeights(rating);
  const byRarity = eligible.reduce((groups, card) => {
    (groups[card.rarity] ||= []).push(card);
    return groups;
  }, {});
  const options = Object.entries(weights).filter(([rarity, weight]) => weight > 0 && byRarity[rarity]?.length);
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return catalog.defaultCardId || null;
  const random = createRandom(Number(seed) >>> 0);
  let roll = random() * total;
  for (const [rarity, weight] of options) {
    roll -= weight;
    if (roll < 0) {
      const cards = byRarity[rarity];
      return cards[Math.floor(random() * cards.length)].id;
    }
  }
  return catalog.defaultCardId || null;
}

module.exports = { selectBotPlayerCard };
