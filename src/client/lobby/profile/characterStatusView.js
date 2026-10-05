function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

// Used for initial cards and subsequent wallet/level refreshes.
export function renderCharacterStatus(element, state) {
  element.className = "character-card-status-text";
  if (state.isLocked) {
    const stats = state.stats || {};
    const trophyReward = stats.unlockMethod?.type === "trophyRoad";
    const price = nonNegativeNumber(trophyReward ? stats.unlockMethod.min : stats.unlockPrice);
    element.innerHTML = trophyReward
      ? `<img src="/assets/trophy.webp" alt="" /> <span class="character-card-status-price">${price.toLocaleString()}</span>`
      : `<span class="character-card-status-label">Unlock</span> <img src="/assets/gem.webp" alt="" /> <span class="character-card-status-price">${price}</span>`;
  } else if (state.isMaxed) {
    element.classList.add("maxed");
    element.innerHTML = '<img src="/assets/crown.webp" alt="" /> <span>Max Level</span>';
  } else {
    element.classList.add("upgradable");
    element.innerHTML = `<img class="character-card-upgrade-icon" src="/assets/upgrade.webp" alt="" /> <span class="character-card-status-label">Upgrade</span> <img src="/assets/coin.webp" alt="" /> <span class="character-card-status-price">${nonNegativeNumber(state.price)}</span>`;
  }
}
