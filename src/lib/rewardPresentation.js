// Shared art scale for Shop, Trophy Road and the claim stage.
export function currencyRewardImage(currency, amount) {
  const type = currency === 'gems' ? 'gems' : 'coins';
  const value = Math.max(0, Number(amount) || 0);
  const bands = type === 'gems' ? [20, 60, 150, 400, 1000] : [400, 1000, 2500, 5000, 10000];
  const level = bands.filter(limit => value >= limit).length;
  return `/assets/currency/${type}-${['small', 'stack', 'bag', 'chest', 'chests', 'cart'][level]}.webp`;
}

// More valuable rewards produce a fuller burst, bounded for mobile devices.
export function currencyParticleCount(currency, amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  const unit = currency === 'gems' ? 2.5 : 50;
  return Math.min(value, 96, Math.ceil(2 * Math.pow(value / unit, .63)));
}

export function currencyFlightPlan({ sourceRect, targetRect, index, count, random = Math.random }) {
  const start = {
    x: sourceRect.left + sourceRect.width / 2 - 16 + (random() - .5) * Math.min(60, sourceRect.width * .35),
    y: sourceRect.top + sourceRect.height / 2 - 16 + (random() - .5) * Math.min(40, sourceRect.height * .3),
  };
  const end = { x: targetRect.left + targetRect.width / 2 - 16, y: targetRect.top + targetRect.height / 2 - 16 };
  const angle = random() * Math.PI * 2;
  const radius = 100 + random() * 160;
  const bend = (random() - .5) * 220;
  const controls = [
    start,
    { x: start.x + Math.cos(angle) * radius, y: start.y + Math.sin(angle) * radius },
    { x: end.x + bend, y: start.y + (end.y - start.y) * (.35 + random() * .3) },
    end,
  ];
  const turn = (random() - .5) * 100;
  const size = .8 + random() * .35;
  const keyframes = Array.from({ length: 25 }, (_, step) => {
    const t = step / 24;
    const u = 1 - t;
    const weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
    const x = controls.reduce((sum, point, i) => sum + point.x * weights[i], 0);
    const y = controls.reduce((sum, point, i) => sum + point.y * weights[i], 0);
    const scale = t < .16 ? .45 + t / .16 * (size - .45) : size - (t - .16) / .84 * (size - .35);
    return { offset: t, opacity: Math.min(1, t * 12), transform: `translate3d(${x}px,${y}px,0) rotate(${Math.sin(t * Math.PI) * turn}deg) scale(${scale})` };
  });
  return {
    keyframes,
    duration: 680 + random() * 340,
    delay: index / Math.max(1, count - 1) * (150 + count * 22) + random() * 65,
  };
}

// Sum bundle currency value so splitting a grant does not change its reveal tier.
export function rewardSound(grants, rarity) {
  const value = grants.reduce((sum, grant) => sum + (grant.kind === 'currency'
    ? Math.max(0, Number(grant.amount) || 0) * (grant.currency === 'gems' ? 20 : 1) : 0), 0);
  let tier = [400, 1500, 5000, 10000].filter(limit => value >= limit).length;
  if (grants.some(grant => grant.kind !== 'currency')) tier = Math.max(tier, 2);
  if (rarity === 'epic' || grants.some(grant => ['skin', 'character'].includes(grant.kind))) tier = Math.max(tier, 3);
  if (rarity === 'legendary') tier = 4;
  return ['rewardCoins', 'rewardGems', 'rewardUnlock', 'rewardEpic', 'rewardLegendary'][tier];
}
