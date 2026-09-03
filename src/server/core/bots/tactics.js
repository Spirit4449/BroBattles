const { basicAim } = require('./combat');
const { nearestSurface } = require('./navigation');
const { bounds } = require('./physics');
const effects = require('../gameRoom/effects/effectManager');

const STYLES = {
  thorg: { fraction: 0.65, cap: 125, clearance: 60, height: 20 },
  draven: { fraction: 0.65, cap: 220, clearance: 95, height: 45 },
  ninja: { fraction: 0.68, cap: 330, clearance: 145, height: 35 },
  wizard: { fraction: 0.7, cap: 480, clearance: 225, height: 100 },
  huntress: { fraction: 0.65, cap: 370, clearance: 200, height: 85 },
  gloop: { fraction: 0.65, cap: 330, clearance: 170, height: 70 },
};
const healthFraction = (p) => Math.max(0, Math.min(1, p.health / Math.max(1, p.maxHealth)));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function preferredRange(brain, target) {
  if (brain.superPlan?.charged && Number.isFinite(brain.superPlan.preferredRange)) {
    return brain.superPlan.preferredRange * brain.spacing;
  }
  const style = STYLES[brain.player.char_class] || STYLES.ninja;
  return Math.min(style.cap, basicAim(brain.player, target, brain.profile, () => 0.5).range * style.fraction) * brain.spacing;
}

function surfaceFor(graph, target) {
  if (target.platformId) return graph.surfaces.find((s) => s.id === target.platformId);
  return nearestSurface(graph, { x: target.x, y: bounds(target).bottom });
}

function selectTarget(brain, enemies, routeTo, now = Date.now()) {
  let best = null, bestScore = Infinity;
  const ownHealth = healthFraction(brain.player);
  for (const target of enemies) {
    const hp = healthFraction(target), range = distance(brain.player, target);
    const route = routeTo(surfaceFor(brain.graph, target)?.id);
    const awareness = brain.profile.tacticalAwareness ?? brain.profile.prediction ?? 0.5;
    let score = range * (0.7 - awareness * 0.2) + hp * (240 + awareness * 100);
    score -= (1 - hp) * (80 + awareness * 180);
    // A bot with a health lead recognizes the chance to finish a wounded enemy.
    score -= Math.max(0, ownHealth - hp) * (140 + awareness * 180);
    if (route === null && range > preferredRange(brain, target)) score += 220;
    if (target.participantId === brain.targetId) score -= 120;
    if (target.participantId === brain.player._lastAttackerParticipantId && now - brain.player.lastDamagedAt < 1400) score -= 100 + awareness * 100;
    // An attacker at melee range matters even while focusing a weaker opponent.
    if (target.attack && now - target.attack.at < 700) score -= range < 220 ? 150 : 60;
    if (score < bestScore) { best = target; bestScore = score; }
  }
  return best;
}

function chooseDecision(brain, context, target, enemies, now) {
  const p = brain.player, { graph, current, poisonY, routeTo } = context;
  const style = STYLES[p.char_class] || STYLES.ninja;
  const preferred = target ? preferredRange(brain, target) : style.cap;
  const hazard = bounds(p).bottom >= poisonY - 100;
  const near = enemies.filter((e) => distance(e, p) < 320).length;
  const healthLead = target ? healthFraction(p) - healthFraction(target) : 0;
  const pressAdvantage = !brain.retreating && healthLead >= 0.12;
  const combatRange = preferred * (pressAdvantage ? 0.75 : 1);
  const wantsSpace = brain.retreating || (near > 1 && healthFraction(p) < 0.65) || (!pressAdvantage && now < brain.kiteUntil);
  const reachable = graph.surfaces.map((surface) => ({ surface, route: routeTo(surface.id) }))
    .filter(({ surface, route }) => route !== null && surface.top < poisonY - 40);

  // Pickup value competes with fighting, distance, and pressure from every enemy.
  if (!hazard) {
    let bestPickup = null, value = -Infinity;
    for (const pickup of brain.room._powerups.values()) {
      if (Number(pickup.activeAt || 0) > now || Number(pickup.expiresAt || Infinity) <= now || pickup.y >= poisonY - 40) continue;
      const surface = nearestSurface(graph, pickup), route = routeTo(surface?.id);
      if (route === null) continue;
      const missing = 1 - healthFraction(p);
      const utility = pickup.type === 'health' ? missing * 850 :
        ['shield', 'invisibility'].includes(pickup.type) ? 240 + missing * 160 : 220;
      const pressure = enemies.reduce((sum, e) => sum + Math.max(0, 190 - distance(pickup, e)), 0);
      const awareness = brain.profile.tacticalAwareness ?? 0.5;
      const score = utility * (0.85 + awareness * 0.35) - distance(p, pickup) * 0.24 - route.length * 42 - pressure * (brain.retreating ? 1.2 : 0.5) -
        (effects.isActive(p, pickup.type, now) ? 200 : 0);
      if (score > value) { bestPickup = { ...pickup, surfaceId: surface.id }; value = score; }
    }
    if (bestPickup && value > (target ? 155 - (brain.profile.tacticalAwareness ?? 0.5) * 65 : 0)) {
      return { mode: 'pickup', goal: bestPickup, pickupId: bestPickup.id };
    }
  }

  if (brain.retreating && !target && !hazard) {
    return { mode: 'recover', goal: current ? { x: p.x, y: current.top, surfaceId: current.id } : null };
  }

  if (target || hazard) {
    let best = null, bestScore = Infinity;
    for (const { surface, route } of reachable) {
      const margin = Math.min((surface.right - surface.left) / 3, graph.body.halfWidth + 22);
      const clampX = (x) => Math.max(surface.left + margin, Math.min(surface.right - margin, x));
      const side = target && p.x < target.x ? -1 : 1;
      const xs = [clampX(p.x), clampX(surface.x)];
      if (target) xs.push(clampX(target.x + side * combatRange), clampX(target.x - side * combatRange));
      if (target && wantsSpace) xs.push(clampX(target.x + side * Math.max(500, preferred * 1.4)), clampX(target.x - side * Math.max(500, preferred * 1.4)));
      for (const x of xs) {
        const point = { x, y: surface.top - graph.body.offsetY - graph.body.halfHeight };
        const travel = route.reduce((sum, e) => sum + e.duration, 0) * 0.045 + Math.abs(p.x - x) * 0.13;
        const nearestEnemy = enemies.length ? Math.min(...enemies.map((e) => distance(point, e))) : Infinity;
        const crowding = enemies.reduce((sum, e) => sum + Math.max(0, (wantsSpace ? 500 : style.clearance) - distance(point, e)), 0);
        let score = travel + crowding * (wantsSpace ? 1.5 : 0.85);
        if (brain.retreating) {
          score += Math.max(0, 650 - nearestEnemy) * 1.8;
          score -= Math.min(650, nearestEnemy) * 0.2;
          if (surface.id === current?.id && nearestEnemy < 500) score += 140;
        }
        if (hazard) score += surface.top * 2;
        else if (target && !wantsSpace) {
          const aim = basicAim({ ...p, ...point }, target, brain.profile, () => 0.5);
          score += Math.abs(distance(point, target) - combatRange) * 0.75;
          if (pressAdvantage) score += Math.max(0, distance(point, target) - combatRange) * 0.45;
          score += Math.max(0, Math.abs(point.y - target.y) - style.height) * 1.3;
          if (!aim.canHit) score += 180;
          score -= Math.min(style.height, Math.max(0, target.y - point.y)) * 0.15;
        }
        if (surface.id === current?.id && !brain.retreating) score -= 55; // Keep useful ground instead of hopping between equal options.
        if (score < bestScore) { bestScore = score; best = { x, y: surface.top, surfaceId: surface.id }; }
      }
    }
    if (best) return { mode: hazard ? 'escape' : brain.retreating ? 'retreat' : wantsSpace ? 'kite' : 'fight', goal: best };
  }

  if (brain.lastSeen && now - brain.lastSeen.at < 3500) {
    const surface = surfaceFor(graph, brain.lastSeen);
    if (routeTo(surface?.id) !== null) return { mode: 'search', goal: { x: brain.lastSeen.x, y: surface.top, surfaceId: surface.id } };
  }
  const options = reachable.filter(({ surface }) => surface.id !== current?.id);
  const choices = options.length ? options : reachable;
  choices.sort((a, b) => (brain.visited.get(a.surface.id) || 0) - (brain.visited.get(b.surface.id) || 0));
  const choice = choices[Math.floor(brain.random() * Math.min(3, choices.length))];
  if (!choice) return { mode: 'wait', goal: null };
  const surface = choice.surface;
  const margin = Math.min((surface.right - surface.left) / 3, graph.body.halfWidth + 25);
  const x = options.length ? surface.x : surface.left + margin + brain.random() * Math.max(0, surface.right - surface.left - margin * 2);
  return { mode: 'patrol', goal: { x, y: surface.top, surfaceId: surface.id } };
}

module.exports = { STYLES, healthFraction, preferredRange, surfaceFor, selectTarget, chooseDecision };
