const { RANDOM_GOLD_PICKUP_RADIUS, RANDOM_GOLD_ARRIVE_MS, RANDOM_GOLD_CLAIMABLE_MS, CENTER_GOLD_INTERVAL_MS, CENTER_GOLD_ANNOUNCE_LEAD_MS, CENTER_GOLD_LIFETIME_MS, CENTER_GOLD_SPILL_PILES, CENTER_GOLD_SPILL_SPACING, CENTER_GOLD_SPILL_LIFT } = require("./state");

// Skip a drop that would arrive too late to contest.
const MIN_REMAINING_TIME_MS = 4000;

function tickCenterGold(mode, now) {
  const state = mode.getModeState();
  const site = state?.centerGold;
  if (!site?.enabled) return;

  if (site.phase === "scheduled" && now >= Number(site.announceAt || 0)) {
    mode.stateVersion++;
    site.phase = "announced";
  }

  if (
    (site.phase === "scheduled" || site.phase === "announced") &&
    now >= Number(site.spawnAt || 0)
  ) {
    mode.stateVersion++;
    site.phase = "active";
    site.round = (Number(site.round) || 0) + 1;
    site.expiresAt = now + CENTER_GOLD_LIFETIME_MS;
    site.health = site.maxHealth;
    site.lastHit = null;
  }

  if (site.phase === "active" && now >= Number(site.expiresAt || 0)) {
    mode._resolveCenterGold(now, "expired");
  }
}

function getCenterCrate(mode) {
  const site = mode.getModeState()?.centerGold;
  if (!site?.enabled || site.phase !== "active" || !(site.health > 0)) return null;
  return site;
}

function damageCenterCrate(mode, rawDamage, meta = {}) {
  const site = mode.getCenterCrate();
  const damage = Math.max(0, Math.round(Number(rawDamage) || 0));
  if (!site || damage <= 0) return 0;
  const now = Number(meta?.at) || Date.now();
  const applied = Math.min(site.health, damage);
  mode.stateVersion++;
  site.health -= applied;
  // Where the blow came from, so the crate can rock away from it.
  site.lastHit = {
    at: now,
    x: Number.isFinite(Number(meta?.x)) ? Number(meta.x) : site.x,
    damage: applied,
    team: meta?.sourceTeam || null,
  };
  if (site.health <= 0) {
    site.lastBreak = {
      team: meta?.sourceTeam || null,
      player: meta?.sourcePlayer || null,
      round: site.round,
      at: now,
    };
    mode._spillCenterCrate(site, now);
    mode._resolveCenterGold(now, "broken");
  }
  return applied;
}

function spillCenterCrate(mode, site, now) {
  const randomGold = mode.getModeState()?.randomGold;
  if (!randomGold) return;
  if (!Array.isArray(randomGold.pickups)) randomGold.pickups = [];
  mode.stateVersion++;
  const piles = CENTER_GOLD_SPILL_PILES;
  const floorY = site.y + site.height / 2;
  const value = Math.floor(site.reward / piles);
  for (let i = 0; i < piles; i++) {
    randomGold.pickups.push({
      id: `center-gold-${site.round}-${i}`,
      x: site.x + (i - (piles - 1) / 2) * CENTER_GOLD_SPILL_SPACING,
      y: floorY - CENTER_GOLD_SPILL_LIFT,
      // Division leftovers go in the first pile, so the crate pays in full.
      value: i === 0 ? site.reward - value * (piles - 1) : value,
      radius: RANDOM_GOLD_PICKUP_RADIUS,
      spawnedAt: now,
      arrivalMs: RANDOM_GOLD_ARRIVE_MS,
      claimableMs: RANDOM_GOLD_CLAIMABLE_MS,
      reason: "centerGold",
      fromX: site.x,
      fromY: site.y,
    });
  }
}

function resolveCenterGold(mode, now, outcome) {
  const state = mode.getModeState();
  const site = state?.centerGold;
  if (!site) return;
  mode.stateVersion++;
  site.phase = "cooldown";
  site.lastResolvedAt = now;
  site.lastOutcome = outcome;
  site.expiresAt = null;
  site.health = 0;
  const nextSpawnAt = now + CENTER_GOLD_INTERVAL_MS;
  const matchEndsAt = Number(state?.endsAt) || 0;
  // Do not schedule a drop that cannot be reached before the clock runs out.
  if (matchEndsAt && nextSpawnAt + MIN_REMAINING_TIME_MS >= matchEndsAt) {
    site.phase = "done";
    site.spawnAt = null;
    site.announceAt = null;
    return;
  }
  site.spawnAt = nextSpawnAt;
  site.announceAt = nextSpawnAt - CENTER_GOLD_ANNOUNCE_LEAD_MS;
  site.phase = "scheduled";
}

module.exports = { tickCenterGold, getCenterCrate, damageCenterCrate, spillCenterCrate, resolveCenterGold };
