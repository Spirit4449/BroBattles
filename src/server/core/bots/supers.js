const effects = require('../gameRoom/effects/effectManager');

const SUPER_RANGES = Object.freeze({
  ninja: 340,
  thorg: 145,
  draven: 165,
  wizard: null,
  huntress: 600,
  gloop: 520,
});

function healthFraction(player) {
  return Math.max(0, Math.min(1, Number(player.health) / Math.max(1, Number(player.maxHealth))));
}

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
    preferredRange: SUPER_RANGES[player.char_class] ?? null,
    holding: now < brain.superHoldUntil,
    enemies: enemies.length,
  };
  return brain.superPlan;
}

function shouldUseSuper(brain, target, enemies, now) {
  const plan = brain.superPlan;
  const player = brain.player;
  if (!plan?.charged || !target || brain.retreating) return false;
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  const heldMs = now - (brain.superReadyAt || now);
  const emergency = healthFraction(player) < 0.18 && ['thorg', 'wizard'].includes(player.char_class);
  if (plan.holding && !emergency) return false;
  const nearby = (radius) => enemies.filter((enemy) => Math.hypot(enemy.x - player.x, enemy.y - player.y) <= radius);

  switch (player.char_class) {
    case 'ninja': {
      const linedUp = enemies.filter((enemy) =>
        Math.abs(enemy.y - player.y) < 105 && Math.hypot(enemy.x - player.x, enemy.y - player.y) <= 470);
      return linedUp.length >= 2 || (distance <= 440 && Math.abs(target.y - player.y) < 105 &&
        (healthFraction(target) < 0.58 || heldMs > 2600));
    }
    case 'thorg':
      // Rage lasts several seconds, so activate at the start of a real melee
      // engagement rather than after the opponent has already escaped.
      return distance <= 235 && (healthFraction(player) > 0.28 || emergency);
    case 'draven':
      // Inferno anchors Draven in place. Require a close/clustered target that
      // is grounded or moving toward the radius.
      return nearby(235).length >= 2 ||
        (distance <= 190 && (target.grounded || Math.sign(target.vx || 0) !== Math.sign(target.x - player.x)));
    case 'wizard': {
      const allies = [...brain.room.players.values()].filter((ally) =>
        ally.team === player.team && ally.isAlive && ally.loaded && ally.connected !== false);
      const allyNeedsHelp = allies.some((ally) => healthFraction(ally) < 0.62);
      const alreadyBuffed = effects.isActive(player, 'rage', now) || effects.isActive(player, 'shield', now);
      return allyNeedsHelp || (!alreadyBuffed && (allies.length > 1 || heldMs > 3500));
    }
    case 'huntress': {
      const clustered = enemies.filter((enemy) => Math.hypot(enemy.x - target.x, enemy.y - target.y) < 180).length;
      return distance >= 180 && distance <= 930 &&
        (clustered >= 2 || target.grounded || Math.abs(target.vy || 0) < 140);
    }
    case 'gloop': {
      const movingAway = Math.sign(target.vx || 0) === Math.sign(target.x - player.x) && Math.abs(target.vx || 0) > 35;
      return distance >= 210 && distance <= 730 &&
        (movingAway || healthFraction(target) < 0.55 || heldMs > 3000);
    }
    default:
      return false;
  }
}

module.exports = { SUPER_RANGES, updateSuperPlan, shouldUseSuper };
