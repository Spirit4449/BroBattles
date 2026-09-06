const { basicAim, hasClearShot, pressureAim } = require('./combat');
const { nearestSurface, walkLimits, canStandAt, canWalkBetween, standOn, previewManeuver, routePoisonDamage } = require('./navigation');
const { bounds } = require('./physics');
const { teamPosition } = require('./teamwork');
const effects = require('../gameRoom/effects/effectManager');
const { POWERUP_SHOCKWAVE_RADIUS, POWERUP_PICKUP_RADIUS, DEATH_DROP_PICKUP_RADIUS } = require('../gameRoomConfig');

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

function routeCost(route) {
  return route?.reduce((sum, edge) => sum + Number(edge.duration || 0), 0) || 0;
}

function pickupTravel(brain, pickup, route) {
  return distance(brain.player, pickup) + routeCost(route) * 0.32;
}

function collectionDestination(brain, context, pickup, now, radius = POWERUP_PICKUP_RADIUS) {
  let best = null, cost = Infinity;
  for (const surface of context.graph.surfaces) {
    const limits = walkLimits(surface, brain.player.char_class);
    const x = Math.max(limits.left, Math.min(limits.right, pickup.x));
    const stance = standOn(surface, brain.player.char_class, x);
    if (Math.abs(x - pickup.x) >= radius ||
        !canStandAt(brain.room.geometry, surface, brain.player.char_class, x)) continue;
    // Only pursue a pickup this stance (or a safe hop from it) can collect.
    if (distance(stance, pickup) >= radius - 2) {
      if (pickup.y >= stance.y || stance.y - pickup.y > 240) continue;
      const hop = previewManeuver(stance, { direction: 0, jumpPressed: true }, brain.room.geometry,
        effects.getModifiers(brain.player, now), now, context.poisonY);
      if (!hop || !hop.frames.some((f) => distance(f, pickup) < radius - 5)) continue;
    }
    const route = context.routeTo(surface.id, x);
    if (route === null) continue;
    const travel = Math.abs(brain.player.x - x) + routeCost(route) * 0.32;
    if (travel < cost) { best = { surface, route, x }; cost = travel; }
  }
  return best;
}

function closestEnemyTo(point, enemies) {
  let enemy = null, range = Infinity;
  for (const candidate of enemies) {
    const next = distance(point, candidate);
    if (next < range) { enemy = candidate; range = next; }
  }
  return { enemy, range };
}

function shockwaveUtility(brain, pickup, enemies) {
  const radius = Number(POWERUP_SHOCKWAVE_RADIUS) || 420;
  let enemyValue = 0, allyCost = 0;
  for (const enemy of enemies) {
    const range = distance(pickup, enemy);
    if (range < radius) enemyValue += 170 + (1 - range / radius) * 210;
  }
  for (const ally of brain.room.players.values()) {
    if (ally === brain.player || ally.team !== brain.player.team || !ally.isAlive) continue;
    const range = distance(pickup, ally);
    if (range < radius) allyCost += 140 + (1 - range / radius) * 170;
  }
  return 90 + enemyValue - allyCost;
}

function shockwaveEvadeGoal(brain, pickup, reachable, enemies, routeTo) {
  const radius = Number(POWERUP_SHOCKWAVE_RADIUS) || 420;
  let best = null, bestScore = Infinity;
  for (const { surface, route } of reachable) {
    const margin = Math.min((surface.right - surface.left) / 3, brain.graph.body.halfWidth + 25);
    for (const rawX of [brain.player.x, surface.x, surface.left + margin, surface.right - margin]) {
      const x = Math.max(surface.left + margin, Math.min(surface.right - margin, rawX));
      if (!canStandAt(brain.room.geometry, surface, brain.player.char_class, x) || routeTo(surface.id, x) === null) continue;
      const point = { x, y: surface.top, surfaceId: surface.id };
      const blastRange = distance(point, pickup);
      const enemyRange = enemies.length ? Math.min(...enemies.map((enemy) => distance(point, enemy))) : Infinity;
      const travel = routeCost(route) * 0.06 + Math.abs(brain.player.x - x) * 0.12;
      const blastDanger = Math.max(0, radius + 90 - blastRange) * 3;
      const combatDanger = Math.max(0, 190 - enemyRange) * 0.5;
      const score = travel + blastDanger + combatDanger;
      if (score < bestScore) { best = point; bestScore = score; }
    }
  }
  return best;
}

function preferredRange(brain, target) {
  if (brain.superPlan?.charged && Number.isFinite(brain.superPlan.preferredRange)) {
    // A reserved super influences spacing without disabling basic attacks.
    const style = STYLES[brain.player.char_class] || STYLES.ninja;
    return Math.min(brain.superPlan.preferredRange, style.cap) * brain.spacing;
  }
  const style = STYLES[brain.player.char_class] || STYLES.ninja;
  return Math.min(style.cap, basicAim(brain.player, target, brain.profile, () => 0.5).range * style.fraction) * brain.spacing;
}

function surfaceFor(graph, target) {
  if (target.grounded && target.platformId) {
    const surface = graph.surfaces.find((s) => s.id === target.platformId);
    if (surface) return surface;
  }
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
    if (route === null && !basicAim(brain.player, target, brain.profile, () => 0.5, brain.room).canHit) score += 450;
    else score += routeCost(route) * 0.025 * awareness;
    const distracted = Number.isFinite(target.attack?.angle) && Math.sign(Math.cos(target.attack.angle)) !== Math.sign(brain.player.x - target.x);
    if (distracted) score -= 90 * awareness;
    if (target.participantId === brain.teamPlan?.targetId) score -= (brain.teamPlan.role === 'defend' ? 320 : 160) * awareness;
    if (target.participantId === brain.targetId) score -= 120;
    if (target.participantId === brain.player._lastAttackerParticipantId && now - brain.player.lastDamagedAt < 1400) score -= 100 + awareness * 100;
    // An attacker at melee range matters even while focusing a weaker opponent.
    if (target.attack && now - target.attack.at < 700) score -= range < 220 ? 150 : 60;
    if (score < bestScore) { best = target; bestScore = score; }
  }
  return best;
}

// Retreat safety includes the journey: a distant destination is not safe if
// getting there requires walking back through the pursuer.
function retreatExposure(player, point, route, enemies) {
  let exposure = 0;
  for (const enemy of enemies) {
    let previous = player, closest = distance(player, enemy);
    const inspect = (next) => {
      const dx = next.x - previous.x, dy = next.y - previous.y;
      const t = Math.max(0, Math.min(1, ((enemy.x - previous.x) * dx + (enemy.y - previous.y) * dy) / (dx * dx + dy * dy || 1)));
      closest = Math.min(closest, distance(enemy, { x: previous.x + dx * t, y: previous.y + dy * t }));
      previous = next;
    };
    for (const edge of route || []) {
      for (let i = 0; i < (edge.frames?.length || 0); i += 6) inspect(edge.frames[i]);
      if (edge.frames?.length) inspect(edge.frames.at(-1));
    }
    inspect(point);
    const initial = distance(player, enemy);
    exposure += Math.max(0, Math.min(320, initial) - Math.min(320, closest));
    if (closest < initial - 20) exposure += Math.max(0, 160 - closest);
  }
  return exposure * (4 + (1 - healthFraction(player)) * 4);
}

function chooseDecision(brain, context, target, enemies, now) {
  const p = brain.player, { graph, current, poisonY, routeTo } = context;
  const style = STYLES[p.char_class] || STYLES.ninja;
  const preferred = target ? preferredRange(brain, target) : style.cap;
  const formation = teamPosition(brain, target, preferred);
  const suddenDeath = Number.isFinite(poisonY);
  const hazard = bounds(p).bottom >= poisonY - 100;
  const near = enemies.filter((e) => distance(e, p) < 320).length;
  const friends = [...brain.room.players.values()].filter((ally) => ally !== p && ally.team === p.team && ally.isAlive && distance(ally, p) < 500).length;
  const healthLead = target ? healthFraction(p) - healthFraction(target) : 0;
  const pressAdvantage = !brain.retreating && (brain.teamPlan ? brain.teamPlan.role === 'vanguard' && brain.teamPlan.strategy === 'push' : healthLead >= 0.12);
  const combatRange = preferred * (pressAdvantage ? 0.75 : 1) / Math.sqrt(brain.aggression || 1);
  const nearestRange = enemies.length ? Math.min(...enemies.map((e) => distance(e, p))) : Infinity;
  const reloading = p.ammoState?.charges === 0;
  const pressured = nearestRange < preferred * (brain.decision?.mode === 'kite' ? 0.95 : 0.7);
  const wantsSpace = brain.retreating || (near > friends + 1 && healthFraction(p) < 0.65) ||
    (!pressAdvantage && pressured && (style.clearance >= 145 || reloading));
  const reachable = graph.surfaces.map((surface) => ({ surface, route: routeTo(surface.id) }))
    .filter(({ route }) => route !== null);

  // Pickup value competes with fighting, distance, and pressure from every enemy.
  if (!suddenDeath) {
    // A shockwave detonates immediately. If an opponent has clearly won the race,
    // concede it and leave the blast radius instead of feeding the pickup.
    for (const pickup of brain.room._powerups?.values?.() || []) {
      if (pickup.type !== 'shockwave' || Number(pickup.expiresAt || Infinity) <= now || pickup.y >= poisonY - 40) continue;
      const surface = nearestSurface(graph, pickup), route = routeTo(surface?.id);
      if (route === null) continue;
      const ownTravel = pickupTravel(brain, pickup, route);
      const closest = closestEnemyTo(pickup, enemies);
      const activatesIn = Math.max(0, Number(pickup.activeAt || 0) - now);
      const enemyWillClaim = closest.enemy && closest.range < Math.min(280, ownTravel - 110) && activatesIn < 1300;
      if (enemyWillClaim && distance(p, pickup) < (Number(POWERUP_SHOCKWAVE_RADIUS) || 420) + 170) {
        const goal = shockwaveEvadeGoal(brain, pickup, reachable, enemies, routeTo);
        if (goal) return { mode: 'evade-powerup', goal, pickupId: pickup.id, contestTargetId: closest.enemy.participantId };
      }
    }

    let bestPickup = null, value = -Infinity;
    for (const pickup of brain.room._powerups?.values?.() || []) {
      if (Number(pickup.activeAt || 0) > now || Number(pickup.expiresAt || Infinity) <= now || pickup.y >= poisonY - 40) continue;
      const destination = collectionDestination(brain, context, pickup, now);
      if (!destination) continue;
      const { surface, route } = destination;
      const missing = 1 - healthFraction(p);
      const utility = pickup.type === 'health' ? missing * 850 :
        pickup.type === 'shockwave' ? shockwaveUtility(brain, pickup, enemies) :
        ['poison', 'freeze'].includes(pickup.type) ? -500 :
        ['shield', 'invisibility'].includes(pickup.type) ? 240 + missing * 160 : 220;
      const pickupStance = standOn(surface, p.char_class, destination.x);
      const escapeCost = brain.retreating ? retreatExposure(p, pickupStance, route, enemies) : 0;
      const pressure = enemies.reduce((sum, e) => sum + Math.max(0, 190 - distance(pickup, e)), 0);
      const awareness = brain.profile.tacticalAwareness ?? 0.5;
      let score = utility * (0.85 + awareness * 0.35) - escapeCost - distance(p, pickup) * 0.24 - route.length * 42 - pressure * (brain.retreating ? 1.2 : 0.5) -
        (effects.isActive(p, pickup.type, now) ? 200 : 0);
      // Prefer the teammate already collecting it, or the closer teammate who
      // needs it more. Shared pickups remain contestable when that ally retreats.
      for (const ally of brain.room.players.values()) {
        if (ally === p || ally.team !== p.team || !ally.isAlive || !ally.loaded) continue;
        const other = brain.room.botControllers?.get(ally.participantId);
        const healingPriority = pickup.type === 'health' && healthFraction(p) + 0.15 < healthFraction(ally);
        if (healingPriority || (other?.retreating && pickup.type !== 'health')) continue;
        const committed = other?.decision?.pickupId === pickup.id;
        const closer = distance(ally, pickup) + 60 < distance(p, pickup);
        if (committed || closer) { score -= 280 * awareness; break; }
      }
      if (brain.decision?.mode === 'pickup' && brain.decision.pickupId === pickup.id) score += 50;
      const contender = closestEnemyTo(pickup, enemies);
      if (score > value) {
        bestPickup = { ...pickup, x: destination.x, surfaceId: surface.id, contestTargetId: contender.range < 430 ? contender.enemy?.participantId : null };
        value = score;
      }
    }

    // Loose rewards are a small, human-looking opportunity: nearby gems matter
    // more than coins, but danger and an active fight quickly outweigh either.
    for (const drop of brain.room._deathDrops?.values?.() || []) {
      if (brain.retreating && enemies.some((enemy) => distance(p, enemy) < 650)) continue;
      if (!drop || drop.claimedBy || Number(drop.expiresAt || 0) <= now || drop.y >= poisonY - 40) continue;
      const destination = collectionDestination(brain, context, drop, now, DEATH_DROP_PICKUP_RADIUS);
      if (!destination) continue;
      const { surface, route } = destination;
      const range = distance(p, drop);
      if (range > (drop.type === 'gem' ? 520 : 390)) continue;
      const contender = closestEnemyTo(drop, enemies);
      const danger = enemies.reduce((sum, enemy) => sum + Math.max(0, 230 - distance(drop, enemy)), 0);
      const utility = drop.type === 'gem' ? 185 : 105;
      const score = utility - range * 0.22 - route.length * 38 - danger * 0.65 - (target ? 65 : 0);
      if (score > value) {
        bestPickup = { ...drop, x: destination.x, surfaceId: surface.id, loot: true, contestTargetId: contender.range < 360 ? contender.enemy?.participantId : null };
        value = score;
      }
    }
    // Finish an engagement before taking a long detour for an incidental buff.
    // Healing and defensive pickups still win when the bot needs to recover.
    const roleCost = brain.teamPlan && ['defend', 'support'].includes(brain.teamPlan.role) && bestPickup?.type !== 'health' ? 180 : 0;
    const pursuitCost = target && !brain.retreating && bestPickup?.type !== 'health'
      ? (bestPickup?.contestTargetId ? 30 : 120) : 0;
    const threshold = bestPickup?.loot
      ? (target ? 60 : 25)
      : (target ? 155 - (brain.profile.tacticalAwareness ?? 0.5) * 65 + pursuitCost + roleCost : 0);
    if (bestPickup && value > threshold) {
      return { mode: bestPickup.loot ? 'loot' : 'pickup', goal: bestPickup,
        pickupId: bestPickup.loot ? null : bestPickup.id,
        dropId: bestPickup.loot ? bestPickup.id : null,
        contestTargetId: bestPickup.contestTargetId || null };
    }
  }

  if (brain.retreating && !target && !hazard) {
    return { mode: 'recover', goal: current ? { x: p.x, y: current.top, surfaceId: current.id } : null };
  }

  if (target || hazard) {
    let best = null, bestScore = Infinity, incumbent = null;
    const mode = hazard ? 'escape' : brain.retreating ? 'retreat' : wantsSpace ? 'kite' : 'fight';
    for (const { surface, route } of reachable) {
      const limits = walkLimits(surface, p.char_class, 22);
      const clampX = (x) => Math.max(limits.left, Math.min(limits.right, x));
      const side = target && p.x < target.x ? -1 : 1;
      const xs = [clampX(p.x), clampX(surface.x)];
      const previous = brain.decision?.mode === mode && brain.decision.goal?.surfaceId === surface.id ? brain.decision.goal : null;
      if (previous) xs.push(clampX(previous.x));
      if (formation) xs.push(clampX(formation.x));
      if (target && !wantsSpace) xs.push(clampX(p.x - 160), clampX(p.x + 160));
      if (target) xs.push(clampX(target.x + side * combatRange), clampX(target.x - side * combatRange));
      if (target && wantsSpace) xs.push(clampX(target.x + side * Math.max(500, preferred * 1.4)), clampX(target.x - side * Math.max(500, preferred * 1.4)));
      for (const x of new Set(xs)) {
        if (!canStandAt(brain.room.geometry, surface, p.char_class, x)) continue;
        const landingX = route.length ? route.at(-1).landingX : p.x;
        const pointRoute = !Number.isFinite(landingX) || canWalkBetween(brain.room.geometry, surface, p.char_class, landingX, x)
          ? route : routeTo(surface.id, x);
        if (pointRoute === null) continue;
        const point = { x, y: surface.top - graph.body.offsetY - graph.body.halfHeight };
        const travel = pointRoute.reduce((sum, e) => sum + e.duration, 0) * 0.045 + Math.abs(p.x - x) * 0.13;
        const nearestEnemy = enemies.length ? Math.min(...enemies.map((e) => distance(point, e))) : Infinity;
        const crowding = enemies.reduce((sum, e) => sum + Math.max(0, (wantsSpace ? 500 : style.clearance) - distance(point, e)), 0);
        let score = travel + crowding * (wantsSpace ? 1.5 : 0.85);
        if (formation && !hazard && !brain.retreating) score += distance(point, formation) * formation.weight;
        if (brain.teamPlan && !hazard) {
          for (const ally of brain.room.players.values()) {
            if (ally !== p && ally.team === p.team && ally.isAlive) score += Math.max(0, 110 - distance(point, ally)) * (brain.profile.tacticalAwareness ?? 0.5);
          }
        }
        if (brain.retreating) {
          const escapeRange = 650 + Math.max(0, 0.4 - healthFraction(p)) * 500;
          score += Math.max(0, escapeRange - nearestEnemy) * 1.8;
          score -= Math.min(escapeRange, nearestEnemy) * 0.2;
          score += retreatExposure(p, point, pointRoute, enemies);
          if (surface.id === current?.id && nearestEnemy < 500) score += 140;
        }
        if (suddenDeath) {
          // Compare poison exposure along the trip and a short stay against
          // combat pressure, using current health to price the survival risk.
          const damage = routePoisonDamage(p, point, pointRoute, poisonY, context.poisonAt);
          score += damage / Math.max(1, p.health) * 1200;
          // Observed velocity gives a short warning of a charge; do not
          // assume that a currently clear stance will stay clear while holding.
          for (const enemy of hazard || damage > 0 ? enemies : []) {
            const projected = { x: enemy.x + (enemy.vx || 0) * 0.6, y: enemy.y + (enemy.vy || 0) * 0.3 };
            const dx = projected.x - enemy.x, dy = projected.y - enemy.y;
            const t = Math.max(0, Math.min(1, ((point.x - enemy.x) * dx + (point.y - enemy.y) * dy) / (dx * dx + dy * dy || 1)));
            const closest = distance(point, { x: enemy.x + dx * t, y: enemy.y + dy * t });
            const closing = Math.max(0, distance(point, enemy) - closest);
            score += Math.max(0, 320 - closest) * Math.min(1, closing / 60) * 2;
          }
          if (damage >= p.health) score += 2400;
          // Prefer clearance, but do not let elevation outweigh an attacker
          // charging a trapped bot on the highest platform.
          if (hazard) score += surface.top * 0.6;
          if (hazard || damage > 0) score += retreatExposure(p, point, pointRoute, enemies) * (brain.retreating ? 0 : 0.5);
        }
        if (target && !wantsSpace) {
          const aim = basicAim({ ...p, ...point }, target, brain.profile, () => 0.5, brain.room);
          const direct = aim.canHit && hasClearShot(brain.room, { ...p, ...point }, target, aim);
          const pressure = !direct && pressureAim(brain.room, { ...p, ...point }, target, brain.profile);
          score += Math.abs(distance(point, target) - combatRange) * (pressure ? 0.5 : 0.75);
          if (pressAdvantage) score += Math.max(0, distance(point, target) - combatRange) * 0.45;
          score += Math.max(0, Math.abs(point.y - target.y) - style.height) * (direct ? 0.25 : pressure ? 0.65 : 1.3);
          if (!direct) score += pressure ? 120 : 300;
          // After holding one platform for a while, try another usable angle.
          // Travel and danger still compete with this preference.
          const dwell = now - (brain.surfaceEnteredAt ?? now);
          if (dwell > 6500 && surface.id !== current?.id && (direct || pressure)) {
            const lastVisit = brain.visited.get(surface.id);
            if (!lastVisit || now - lastVisit > 10000) score -= Math.min(260, (dwell - 6500) * 0.06);
          }
          for (const failed of brain.ineffectivePositions || []) {
            if (failed.until > now && failed.surfaceId === surface.id) {
              score += Math.max(0, 1 - Math.abs(x - failed.x) / 180) * 340;
            }
          }
          score -= Math.min(style.height, Math.max(0, target.y - point.y)) * 0.15;
        }
        if (surface.id === current?.id && !brain.retreating) score -= 25; // Briefly hold useful ground before considering another angle.
        if (previous && Math.abs(x - previous.x) < 1) incumbent = { goal: previous, score };
        if (score < bestScore) { bestScore = score; best = { x, y: surface.top, surfaceId: surface.id }; }
      }
    }
    // Compare both destinations in the current situation. Commitment survives
    // small score changes, but a newly unsafe or ineffective goal loses normally.
    if (incumbent && !hazard && incumbent.score <= bestScore + 60) best = incumbent.goal;
    if (best) return { mode, goal: best };
  }

  if (brain.lastSeen && now - brain.lastSeen.at < 3500) {
    const surface = surfaceFor(graph, brain.lastSeen);
    if (surface) {
      const limits = walkLimits(surface, p.char_class);
      const x = Math.max(limits.left, Math.min(limits.right, brain.lastSeen.x));
      if (canStandAt(brain.room.geometry, surface, p.char_class, x) && routeTo(surface.id, x) !== null)
        return { mode: 'search', goal: { x, y: surface.top, surfaceId: surface.id } };
    }
  }
  const exploration = reachable.flatMap(({ surface }) => {
    const limits = walkLimits(surface, p.char_class, 22);
    const center = Math.max(limits.left, Math.min(limits.right, surface.x));
    const xs = [center, limits.left, limits.right].filter((x) =>
      canStandAt(brain.room.geometry, surface, p.char_class, x) && routeTo(surface.id, x) !== null);
    return xs.length ? [{ surface, x: xs[0] }] : [];
  });
  const options = exploration.filter(({ surface }) => surface.id !== current?.id);
  const choices = options.length ? options : exploration;
  choices.sort((a, b) => (brain.visited.get(a.surface.id) || 0) - (brain.visited.get(b.surface.id) || 0));
  const choice = choices[Math.floor(brain.random() * Math.min(3, choices.length))];
  if (!choice) return { mode: 'wait', goal: null };
  const surface = choice.surface;
  const margin = Math.min((surface.right - surface.left) / 3, graph.body.halfWidth + 25);
  const proposedX = surface.left + margin + brain.random() * Math.max(0, surface.right - surface.left - margin * 2);
  const x = !options.length && canStandAt(brain.room.geometry, surface, p.char_class, proposedX) && routeTo(surface.id, proposedX) !== null ? proposedX : choice.x;
  return { mode: 'patrol', goal: { x, y: surface.top, surfaceId: surface.id } };
}

module.exports = { STYLES, healthFraction, preferredRange, surfaceFor, selectTarget, chooseDecision };
