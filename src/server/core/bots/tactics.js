const { basicAim, hasClearShot, pressureAim } = require('./combat');
const { nearestSurface } = require('./navigation');
const { bounds } = require('./physics');
const { teamPosition } = require('./teamwork');
const effects = require('../gameRoom/effects/effectManager');
const { POWERUP_SHOCKWAVE_RADIUS } = require('../gameRoomConfig');

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

function shockwaveEvadeGoal(brain, pickup, reachable, enemies) {
  const radius = Number(POWERUP_SHOCKWAVE_RADIUS) || 420;
  let best = null, bestScore = Infinity;
  for (const { surface, route } of reachable) {
    const margin = Math.min((surface.right - surface.left) / 3, brain.graph.body.halfWidth + 25);
    for (const rawX of [brain.player.x, surface.x, surface.left + margin, surface.right - margin]) {
      const x = Math.max(surface.left + margin, Math.min(surface.right - margin, rawX));
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
    if (target.participantId === brain.teamPlan?.targetId) score -= brain.teamPlan.role === 'defend' ? 320 : 160;
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
  const formation = teamPosition(brain, target);
  const suddenDeath = Number.isFinite(poisonY);
  const hazard = bounds(p).bottom >= poisonY - 100;
  const near = enemies.filter((e) => distance(e, p) < 320).length;
  const healthLead = target ? healthFraction(p) - healthFraction(target) : 0;
  const pressAdvantage = !brain.retreating && (brain.teamPlan ? brain.teamPlan.role === 'vanguard' && brain.teamPlan.strategy === 'push' : healthLead >= 0.12);
  const combatRange = preferred * (pressAdvantage ? 0.75 : 1);
  const wantsSpace = brain.retreating || (near > 1 && healthFraction(p) < 0.65) || (!pressAdvantage && now < brain.kiteUntil);
  const reachable = graph.surfaces.map((surface) => ({ surface, route: routeTo(surface.id) }))
    .filter(({ surface, route }) => route !== null && surface.top < poisonY - 40);

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
        const goal = shockwaveEvadeGoal(brain, pickup, reachable, enemies);
        if (goal) return { mode: 'evade-powerup', goal, pickupId: pickup.id, contestTargetId: closest.enemy.participantId };
      }
    }

    let bestPickup = null, value = -Infinity;
    for (const pickup of brain.room._powerups?.values?.() || []) {
      if (Number(pickup.activeAt || 0) > now || Number(pickup.expiresAt || Infinity) <= now || pickup.y >= poisonY - 40) continue;
      const surface = nearestSurface(graph, pickup), route = routeTo(surface?.id);
      if (route === null) continue;
      const missing = 1 - healthFraction(p);
      const utility = pickup.type === 'health' ? missing * 850 :
        pickup.type === 'shockwave' ? shockwaveUtility(brain, pickup, enemies) :
        ['poison', 'freeze'].includes(pickup.type) ? -500 :
        ['shield', 'invisibility'].includes(pickup.type) ? 240 + missing * 160 : 220;
      const pressure = enemies.reduce((sum, e) => sum + Math.max(0, 190 - distance(pickup, e)), 0);
      const awareness = brain.profile.tacticalAwareness ?? 0.5;
      const score = utility * (0.85 + awareness * 0.35) - distance(p, pickup) * 0.24 - route.length * 42 - pressure * (brain.retreating ? 1.2 : 0.5) -
        (effects.isActive(p, pickup.type, now) ? 200 : 0);
      const contender = closestEnemyTo(pickup, enemies);
      if (score > value) {
        bestPickup = { ...pickup, surfaceId: surface.id, contestTargetId: contender.range < 430 ? contender.enemy?.participantId : null };
        value = score;
      }
    }

    // Loose rewards are a small, human-looking opportunity: nearby gems matter
    // more than coins, but danger and an active fight quickly outweigh either.
    for (const drop of brain.room._deathDrops?.values?.() || []) {
      if (!drop || drop.claimedBy || Number(drop.expiresAt || 0) <= now || drop.y >= poisonY - 40) continue;
      const surface = nearestSurface(graph, drop), route = routeTo(surface?.id);
      if (route === null) continue;
      const range = distance(p, drop);
      if (range > (drop.type === 'gem' ? 520 : 390)) continue;
      const contender = closestEnemyTo(drop, enemies);
      const danger = enemies.reduce((sum, enemy) => sum + Math.max(0, 230 - distance(drop, enemy)), 0);
      const utility = drop.type === 'gem' ? 185 : 105;
      const score = utility - range * 0.22 - route.length * 38 - danger * 0.65 - (target ? 65 : 0);
      if (score > value) {
        bestPickup = { ...drop, surfaceId: surface.id, loot: true, contestTargetId: contender.range < 360 ? contender.enemy?.participantId : null };
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
    let best = null, bestScore = Infinity;
    for (const { surface, route } of reachable) {
      const margin = Math.min((surface.right - surface.left) / 3, graph.body.halfWidth + 22);
      const clampX = (x) => Math.max(surface.left + margin, Math.min(surface.right - margin, x));
      const side = target && p.x < target.x ? -1 : 1;
      const xs = [clampX(p.x), clampX(surface.x)];
      if (formation) xs.push(clampX(formation.x));
      if (target && !wantsSpace) xs.push(clampX(p.x - 160), clampX(p.x + 160));
      if (target) xs.push(clampX(target.x + side * combatRange), clampX(target.x - side * combatRange));
      if (target && wantsSpace) xs.push(clampX(target.x + side * Math.max(500, preferred * 1.4)), clampX(target.x - side * Math.max(500, preferred * 1.4)));
      for (const x of xs) {
        const point = { x, y: surface.top - graph.body.offsetY - graph.body.halfHeight };
        const travel = route.reduce((sum, e) => sum + e.duration, 0) * 0.045 + Math.abs(p.x - x) * 0.13;
        const nearestEnemy = enemies.length ? Math.min(...enemies.map((e) => distance(point, e))) : Infinity;
        const crowding = enemies.reduce((sum, e) => sum + Math.max(0, (wantsSpace ? 500 : style.clearance) - distance(point, e)), 0);
        let score = travel + crowding * (wantsSpace ? 1.5 : 0.85);
        if (formation && !hazard && !brain.retreating) score += distance(point, formation) * formation.weight;
        if (brain.teamPlan && !hazard) {
          for (const ally of brain.room.players.values()) {
            if (ally !== p && ally.team === p.team && ally.isAlive) score += Math.max(0, 110 - distance(point, ally)) * 0.7;
          }
        }
        if (brain.retreating) {
          score += Math.max(0, 650 - nearestEnemy) * 1.8;
          score -= Math.min(650, nearestEnemy) * 0.2;
          if (surface.id === current?.id && nearestEnemy < 500) score += 140;
        }
        if (suddenDeath) {
          // Rising poison changes the duel objective immediately. Favor vertical
          // clearance even before the water is touching the current platform.
          score += surface.top * 3;
        }
        else if (target && !wantsSpace) {
          const aim = basicAim({ ...p, ...point }, target, brain.profile, () => 0.5, brain.room);
          const direct = aim.canHit && hasClearShot(brain.room, { ...p, ...point }, target, aim);
          const pressure = !direct && pressureAim(brain.room, { ...p, ...point }, target, brain.profile);
          score += Math.abs(distance(point, target) - combatRange) * (pressure ? 0.35 : 0.75);
          if (pressAdvantage) score += Math.max(0, distance(point, target) - combatRange) * 0.45;
          score += Math.max(0, Math.abs(point.y - target.y) - style.height) * (direct || pressure ? 0.25 : 1.3);
          if (!direct) score += pressure ? 65 : 300;
          // After holding one platform for a while, try another usable angle.
          // Travel and danger still compete with this preference.
          const dwell = now - (brain.surfaceEnteredAt ?? now);
          if (brain.teamPlan?.role !== 'anchor' && dwell > 6500 && surface.id !== current?.id && (direct || pressure)) {
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
        if (score < bestScore) { bestScore = score; best = { x, y: surface.top, surfaceId: surface.id }; }
      }
    }
    if (best) return { mode: suddenDeath ? 'escape' : brain.retreating ? 'retreat' : wantsSpace ? 'kite' : 'fight', goal: best };
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
