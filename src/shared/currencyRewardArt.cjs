// Shared art scale for Shop, Trophy Road, the claim stage and the About page:
// bigger amounts show bigger piles of coins or gems.
function currencyRewardImage(currency, amount) {
  const type = currency === 'gems' ? 'gems' : 'coins';
  const value = Math.max(0, Number(amount) || 0);
  const bands = type === 'gems' ? [20, 60, 150, 400, 1000] : [400, 1000, 2500, 5000, 10000];
  const level = bands.filter(limit => value >= limit).length;
  return `/assets/currency/${type}-${['small', 'stack', 'bag', 'chest', 'chests', 'cart'][level]}.webp`;
}

module.exports = { currencyRewardImage };
