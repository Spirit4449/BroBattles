const { BOT_PROFILES, botProfile, healthFraction } = require('./characterProfiles');

// Derived for callers/tests that read a character's advertised super range.
const SUPER_RANGES = Object.freeze(Object.fromEntries(
  Object.entries(BOT_PROFILES).map(([character, profile]) => [character, profile.superRange ?? null])));

function updateSuperPlan(brain, enemies, now) {
  const player = brain.player;
  const charged = Number(player.superCharge) >= Number(player.maxSuperCharge) && Number(player.maxSuperCharge) > 0;
  if (!charged) {
    brain.superPlan = { charged: false, preferredRange: null };
    brain._superWasCharged = false;
    return brain.superPlan;
  }
  if (!brain._superWasCharged) {
    const awareness = brain.profile.tacticalAwareness ?? 0.5;
    brain.superReadyAt = now;
    // Strong bots still reveal a charged super briefly instead of spending it
    // on the first legal frame. Lower tiers vary the hold longer.
    brain.superHoldUntil = now + brain.between(550, 1150 + (1 - awareness) * 900);
    brain._superWasCharged = true;
    brain.metrics.superSaves++;
  }
  brain.superPlan = {
    charged: true,
    preferredRange: botProfile(player.char_class).superRange ?? null,
    holding: now < brain.superHoldUntil,
    enemies: enemies.length,
  };
  return brain.superPlan;
}

function shouldUseSuper(brain, target, enemies, now) {
  const plan = brain.superPlan;
  const player = brain.player;
  if (!plan?.charged || !target) return false;
  const profile = botProfile(player.char_class);
  // Defensive self/team buffs remain available during recovery.
  if (brain.retreating && !profile.buffSuper) return false;
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  const heldMs = now - (brain.superReadyAt || now);
  const emergency = healthFraction(player) < 0.18 && !!profile.buffSuper;
  if (plan.holding && !emergency) return false;
  const nearby = (radius) => enemies.filter((enemy) => Math.hypot(enemy.x - player.x, enemy.y - player.y) <= radius);
  return !!profile.shouldUseSuper?.({ brain, player, target, enemies, now, distance, heldMs, emergency, nearby });
}

module.exports = { SUPER_RANGES, updateSuperPlan, shouldUseSuper };
