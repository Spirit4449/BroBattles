// Animates coin/gem/trophy counters after returning from a match.

// Written by the game page, read once by the lobby.
export const POST_MATCH_REWARD_STORAGE_KEY = "bb_post_match_rewards_v1";

function animateNumber(el, from, to, durationMs) {
  if (!el) return;
  const start = performance.now();
  const run = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = String(value);
    if (t < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

export function animatePostMatchRewardsIfPresent(
  coinEl,
  gemEl,
  trophyEl,
  coinsNow,
  gemsNow,
  trophiesNow,
) {
  if (!coinEl || !gemEl || !trophyEl) return;
  let payload = null;
  try {
    payload = JSON.parse(
      sessionStorage.getItem(POST_MATCH_REWARD_STORAGE_KEY) || "null",
    );
  } catch (_) {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return;
  const ageMs = Date.now() - Number(payload.at || 0);
  const coinsAwarded = Math.max(0, Number(payload.coinsAwarded) || 0);
  const gemsAwarded = Math.max(0, Number(payload.gemsAwarded) || 0);
  const trophiesDelta = Number(payload.trophiesDelta) || 0;
  try {
    sessionStorage.removeItem(POST_MATCH_REWARD_STORAGE_KEY);
  } catch (_) {}
  if (ageMs < 0 || ageMs > 2 * 60 * 1000) return;
  if (coinsAwarded <= 0 && gemsAwarded <= 0 && trophiesDelta === 0) return;

  const coinsFrom = Math.max(0, Number(coinsNow) - coinsAwarded);
  const gemsFrom = Math.max(0, Number(gemsNow) - gemsAwarded);
  const trophiesFrom = Math.max(0, Number(trophiesNow) - trophiesDelta);
  coinEl.textContent = String(coinsFrom);
  gemEl.textContent = String(gemsFrom);
  // Trophy losses are already reflected in the lobby balance; do not replay
  // them as a reward animation after a battle.
  trophyEl.textContent = String(trophiesDelta < 0 ? trophiesNow : trophiesFrom);
  animateNumber(coinEl, coinsFrom, Number(coinsNow), 1600);
  animateNumber(gemEl, gemsFrom, Number(gemsNow), 1600);
  if (trophiesDelta >= 0) {
    animateNumber(trophyEl, trophiesFrom, Number(trophiesNow), 1600);
  }
}
