const { bounds, stepBody, onClimbableWall, forecastGeometry } = require("../physics/bodySolver");
const { prepareTraversal, edgeKey, safeWalkDirection, previewManeuver, walkLimits } = require("./navigation");
const { basicAim, hasClearShot, pressureAim } = require("../../../shared/combat/combat.js");
const effects = require("../../../shared/combat/runtime/effects/effectManager.js");
const movement = require("../../../shared/physics/movementPhysics.json");
const { DEATH_DROP_PICKUP_RADIUS } = require("../../../shared/combat/matchConfig.js");
const { powerupGap, powerupReachX } = require("../../../shared/physics/powerupContact");
const { FIXED_DT_MS } = require("../../../shared/gameConstants");
const { RIDE_EXIT_CHECK_MS, AIR_LANDING_CHECK_MS } = require("./movementCadence");

function pursuitDirection(brain, x, now, takeoff = false) {
  const p = brain.player, direction = Math.sign(x - p.x);
  if (takeoff || brain.decision?.mode !== 'fight' || !brain.target || Math.abs(x - p.x) < 80 ||
      !basicAim(p, brain.target, brain.profile, () => 0.5, brain.room).canHit) {
    brain.pursuit = null;
    return brain.walkDirection(x, takeoff);
  }
  let stage = brain.pursuit;
  if (!stage || stage.surfaceId !== p.platformId || stage.direction !== direction) {
    stage = brain.pursuit = { surfaceId: p.platformId, direction,
      x: p.x + direction * Math.min(Math.abs(x - p.x), brain.between(190, 280)), holdUntil: null };
  }
  if (Math.abs(stage.x - p.x) <= 24 && Math.abs(p.vx) < 35 && stage.holdUntil === null) {
    stage.holdUntil = now + brain.between(220, 380);
  }
  if (stage.holdUntil !== null) {
    if (now < stage.holdUntil) { brain.wantsProgress = false; return 0; }
    brain.pursuit = null;
    return brain.pursuitDirection(x, now, takeoff);
  }
  // Never overshoot a target/goal that moved closer while taking brain step.
  const stepX = direction > 0 ? Math.min(x, stage.x) : Math.max(x, stage.x);
  return brain.walkDirection(stepX, takeoff);
}

function navigate(brain, context, now) {
  const p = brain.player, goal = brain.decision?.goal;
  brain.walkGoalX = null;
  if (brain.traversal || brain.maneuver) { brain.wantsProgress = true; return; }
  if (!p.grounded) { brain.airRecovery(context, now); brain.wantsProgress = true; return; }
  // Keep backing up to a sampled takeoff once an obstruction recovery has
  // begun. The wall contact disappears as soon as the bot steps away, but
  // abandoning the recovery then would send it straight back into the wall.
  if (brain.approachEdge?.obstacleRecovery && brain.approachEdge.from === context.current?.id) {
    brain.wantsProgress = true;
    return;
  }
  brain.intent = { direction: 0 };
  if (!goal) { brain.wantsProgress = false; return; }
  const intendedX = Number.isFinite(brain.approachEdge?.takeoffX) ? brain.approachEdge.takeoffX : goal.x;
  const intendedDirection = Math.sign(intendedX - p.x);
  const wallDirection = p.wallSide === 'right' ? 1 : p.wallSide === 'left' ? -1 : 0;
  const obstacleDirection = brain.groundObstacleDirection(intendedDirection);
  const route = context.routeTo(goal.surfaceId, goal.x);
  // A wall towards the goal is only an obstacle with no route. A goal can lie
  // beyond it on a lower level, and the route may lead the other way.
  if (!brain.approachEdge && !route?.length && intendedDirection && (intendedDirection === wallDirection || intendedDirection === obstacleDirection) &&
      brain.startObstacleRecovery(context, intendedDirection, now)) return;
  brain.wantsProgress = route === null || route.length > 0 || Math.abs(goal.x - p.x) > 28;
  if (route?.length) {
    const edge = route[0];
    if (!brain.approachEdge || brain.approachEdge.to !== edge.to) {
      brain.approachEdge = { ...edge, from: context.current.id, startedAt: now, approachBudget: 2200 + Math.abs(edge.takeoffX - p.x) / Math.max(80, movement.maxSpeed * 0.65) * 1000 };
    }
  } else if (route) {
    brain.approachEdge = null;
    brain.walkGoalX = goal.x;
    if (['pickup', 'loot'].includes(brain.decision.mode)) {
      const pickup = brain.decision.mode === 'pickup' ? brain.room.powerups.get(brain.decision.pickupId) : brain.room.deathDrops.get(brain.decision.dropId);
      const powerup = brain.decision.mode === 'pickup';
      const reachX = powerup ? powerupReachX(p) : DEATH_DROP_PICKUP_RADIUS;
      const gap = (at) => powerup ? powerupGap(p, pickup, at) : Math.hypot(at.x - pickup.x, at.y - pickup.y) - DEATH_DROP_PICKUP_RADIUS;
      if (pickup && Math.abs(p.x - pickup.x) < reachX / 2 && gap(p) >= -2 && pickup.y < p.y) {
        const hop = previewManeuver(p, { direction: 0, jumpPressed: true }, brain.movementGeometry(),
          effects.getModifiers(p, now), now, context.poisonY);
        if (hop?.frames.some((frame) => gap(frame) < -5)) {
          brain.maneuver = { ...hop, cursor: 0 };
          brain.wantsProgress = true;
          return;
        }
      }
    }
    brain.intent.direction = brain.pursuitDirection(goal.x, now);
    if (!brain.wantsProgress && ['patrol', 'search'].includes(brain.decision.mode) && !brain.decision.arrived) {
      brain.visited.set(context.current.id, now);
      brain.decision.arrived = true;
      brain.idleUntil = now + brain.between(300, 650);
      brain.nextDecisionAt = brain.idleUntil;
    }
    if (brain.decision.mode === 'fight' && brain.target && !(brain.pursuit?.holdUntil > now)) {
      const aim = basicAim(p, brain.target, brain.profile, () => 0.5, brain.room);
      const blockedFight = (!aim.canHit || !hasClearShot(brain.room, p, brain.target, aim)) &&
        !pressureAim(brain.room, p, brain.target, brain.profile);
      if (blockedFight) {
        brain.wantsProgress = true;
        const targetDirection = Math.sign(brain.target.x - p.x);
        if (targetDirection === brain.groundObstacleDirection(targetDirection) &&
            brain.startObstacleRecovery(context, targetDirection, now)) return;
      }
    }
  }
}

function groundObstacleDirection(brain, direction) {
  const p = brain.player;
  if (!p.grounded || !direction) return 0;
  const body = bounds(p);
  const blocked = brain.movementGeometry().colliders.some((rect) => {
    if (rect.id === p.platformId || body.bottom <= rect.top + 2 || body.top >= rect.bottom - 2) return false;
    if (direction > 0 && rect.collision.left) {
      const gap = rect.left - body.right;
      return gap >= -1 && gap <= 30;
    }
    if (direction < 0 && rect.collision.right) {
      const gap = body.left - rect.right;
      return gap >= -1 && gap <= 30;
    }
    return false;
  });
  return blocked ? direction : 0;
}

function startObstacleRecovery(brain, context, direction, now) {
  const p = brain.player, current = context.current;
  if (!p.grounded || !current || !direction) return false;
  // Small steps and low walls can be cleared immediately. Only commit when
  // the real movement solver proves that the hop lands safely.
  const hop = previewManeuver(p, { direction, jumpPressed: true }, brain.movementGeometry(),
    effects.getModifiers(p, now), now, context.poisonY);
  if (hop && (hop.end.platformId !== current.id || (hop.end.x - p.x) * direction > 35)) {
    brain.clearTravel();
    brain.maneuver = { ...hop, cursor: 0, obstacleRecovery: true };
    brain.wantsProgress = true;
    brain.metrics.obstacleRecoveries++;
    return true;
  }
  const body = bounds(p);
  const candidates = (context.graph.edges.get(current.id) || [])
    .filter((edge) => Math.sign(edge.direction) === direction &&
      !brain.blockedEdges.has(edgeKey(edge, current.id)) &&
      Math.abs(edge.takeoffX - p.x) <= 120 &&
      (p.x - edge.takeoffX) * direction >= -8)
    .map((edge) => ({ edge, surface: context.graph.surfaces.find((surface) => surface.id === edge.to) }))
    .filter(({ surface }) => surface &&
      (direction > 0 ? surface.right > body.right + 8 : surface.left < body.left - 8))
    .sort((a, b) =>
      Math.abs(a.edge.takeoffX - p.x) + a.edge.duration * 0.08 + (a.edge.jump ? 20 : 0) -
      (Math.abs(b.edge.takeoffX - p.x) + b.edge.duration * 0.08 + (b.edge.jump ? 20 : 0)));
  const edge = candidates[0]?.edge;
  if (!edge) return false;
  brain.approachEdge = { ...edge, from: current.id, startedAt: now,
    approachBudget: 2200 + Math.abs(edge.takeoffX - p.x) / Math.max(80, movement.maxSpeed * 0.65) * 1000,
    obstacleRecovery: true };
  brain.pursuit = null;
  brain.wantsProgress = true;
  brain.metrics.obstacleRecoveries++;
  return true;
}

function walkDirection(brain, x, takeoff = false) {
  const p = brain.player;
  if (!takeoff) {
    const surface = brain.graph.surfaces.find((s) => s.id === p.platformId);
    if (surface) { const limits = walkLimits(surface, p.char_class); x = Math.max(limits.left, Math.min(limits.right, x)); }
  }
  const dx = x - p.x, speed = Math.abs(p.vx || 0);
  const pickup = brain.decision?.mode === 'pickup' ? brain.room.powerups.get(brain.decision.pickupId) :
    brain.decision?.mode === 'loot' ? brain.room.deathDrops.get(brain.decision.dropId) : null;
  const reachX = !pickup ? 0 : brain.decision.mode === 'loot'
    ? Math.sqrt(Math.max(0, DEATH_DROP_PICKUP_RADIUS ** 2 - (p.y - pickup.y) ** 2))
    : powerupReachX(p, pickup);
  const pickupTolerance = pickup ? Math.max(1, reachX * 0.5) : 20;
  // A few pixels can change whether a jump clears a platform edge.
  const deadband = takeoff ? 0.5 : Math.min(20, pickupTolerance);
  const stopping = speed * speed / (2 * movement.dragGround);
  const coasting = Math.sign(p.vx) === Math.sign(dx) && Math.abs(dx) <= stopping + deadband;
  const direction = coasting || Math.abs(dx) <= deadband ? 0 : Math.sign(dx);
  return takeoff ? direction : safeWalkDirection(p, direction, brain.movementGeometry());
}

function ridePlatform(brain, now, mods) {
  const p = brain.player;
  if (!p.grounded || brain.maneuver || brain.traversal) return false;
  const support = brain.movementGeometry().movingColliders?.find((c) => c.id === p.platformId);
  if (!support) return false;
  brain.approachEdge = null;
  const goalX = brain.decision?.goal?.x ?? brain.target?.x ?? p.x;
  if (now >= (brain.nextRideExitAt || 0)) {
    brain.nextRideExitAt = now + RIDE_EXIT_CHECK_MS;
    const exit = brain.findRideExit(goalX, mods, now);
    if (exit) {
      brain.traversal = { ...exit, cursor: 0, until: now + exit.duration + 800 };
      if (exit.dash) { brain.duckUntil = 0; p.ducking = false; }
      brain.metrics.rideExits = (brain.metrics.rideExits || 0) + 1;
      return false;
    }
  }
  const limits = walkLimits(support, p.char_class);
  brain.intent = { direction: brain.walkDirection(goalX < p.x ? limits.left : limits.right) };
  return true;
}

function findRideExit(brain, goalX, mods, now) {
  const p = brain.player, toward = Math.sign(goalX - p.x) || 1;
  const staticIds = new Set(brain.graph.surfaces.map((s) => s.id));
  for (const direction of [toward, 0, -toward]) {
    const diagonal = { x: direction * Math.SQRT1_2, y: direction ? -Math.SQRT1_2 : -1 };
    const edges = [
      { direction, jump: true, wallClimb: false },
      { direction, jump: true, wallClimb: true },
      { direction, jump: false, wallClimb: false, dash: diagonal, dashFrame: 0 },
      ...(direction ? [{ direction, jump: true, wallClimb: false, dash: { x: direction, y: 0 }, dashFrame: 18 }] : []),
    ];
    for (const edge of edges) {
      const prepared = prepareTraversal(p, edge, brain.movementGeometry(), mods, now, brain.poisonY);
      if (prepared && staticIds.has(prepared.to)) return { ...prepared, from: p.platformId, takeoffX: p.x };
    }
  }
  return null;
}

function executeTravel(brain, now, mods) {
  const p = brain.player;
  if (brain.ridePlatform(now, mods)) return;
  if (brain.approachEdge && p.grounded && !brain.traversal && !brain.maneuver) {
    const edge = brain.approachEdge;
    if (Math.abs(edge.takeoffX - p.x) <= 1 && Math.abs(p.vx || 0) < 12 && now >= (p._nextWallJump || 0)) {
      if (edge.dash && (now < Math.max(p._dashReadyAt || 0, brain.nextDashAt || 0, p._botActionUntil || 0, p._knockbackUntil || 0))) {
        brain.intent = { direction: 0 };
        return;
      }
      const prepared = prepareTraversal(p, edge, brain.movementGeometry(), mods, now, brain.poisonY);
      brain.approachEdge = null;
      if (!prepared) {
        brain.blockedEdges.set(edgeKey(edge), now + 2500);
        brain.intent = { direction: safeWalkDirection(p, 0, brain.movementGeometry()) };
        brain.nextThink = 0;
        return;
      }
      brain.traversal = { ...prepared, cursor: 0, until: now + prepared.duration + 800 };
      if (edge.dash) { brain.duckUntil = 0; p.ducking = false; }
    } else brain.intent = { direction: brain.pursuitDirection(edge.takeoffX, now, true) };
  } else if (p.grounded && Number.isFinite(brain.walkGoalX) && !brain.traversal && !brain.maneuver) {
    brain.intent = { direction: brain.pursuitDirection(brain.walkGoalX, now) };
  } else if (!p.grounded) brain.approachEdge = null;
  const travel = brain.maneuver || brain.traversal;
  if (!travel) return;
  const frame = travel.frames[travel.cursor++];
  if (!frame || Math.hypot(p.x - frame.x, p.y - frame.y) > 65) {
    if (frame && brain.traversal) brain.blockedEdges.set(edgeKey(brain.traversal), now + 2500);
    brain.maneuver = null;
    brain.traversal = null;
    brain.nextThink = 0;
    return;
  }
  brain.intent = { direction: frame.direction, jumpPressed: frame.jumpPressed, dash: frame.dash };
}

function airRecovery(brain, context, now) {
  const p = brain.player, foot = bounds(p);
  const landing = context.graph.surfaces.filter((s) => s.top >= foot.bottom - 12)
    .sort((a, b) => Math.max(a.left - p.x, 0, p.x - a.right) - Math.max(b.left - p.x, 0, p.x - b.right))[0];
  if (p.wallSide) {
    if (brain.lastWallSide !== p.wallSide) {
      brain.wallWaitUntil = now + brain.between(100, 320) + (brain.random() < brain.profile.mistakeChance ? 220 : 0);
      brain.metrics.wallPauses++;
    }
    brain.lastWallSide = p.wallSide;
    const urgent = !landing || foot.bottom >= context.poisonY - 100;
    const jump = (urgent || now >= brain.wallWaitUntil) && now >= (p._nextWallJump || 0) && onClimbableWall(p, brain.movementGeometry());
    brain.intent = { direction: (p.wallSide === 'left' ? -1 : 1) * (jump ? -1 : 1), jumpPressed: jump };
  } else {
    brain.lastWallSide = null;
    const steer = brain.movementGeometry().movingColliders?.length ? brain.forecastLanding(now) : null;
    if (steer !== null) { brain.intent = { direction: steer }; return; }
    const x = landing ? Math.max(landing.left + foot.halfWidth + 8, Math.min(landing.right - foot.halfWidth - 8, p.x)) : p.x;
    brain.intent = { direction: Math.abs(x - p.x) > 8 ? Math.sign(x - p.x) : 0 };
  }
}

function forecastLanding(brain, now) {
  if (now < (brain.landingCheckAt || 0)) return brain.landingDirection;
  brain.landingCheckAt = now + AIR_LANDING_CHECK_MS;
  const p = brain.player, mods = effects.getModifiers(p, now), forward = Math.sign(p.vx) || 1;
  brain.landingDirection = null;
  for (const direction of [forward, 0, -forward]) {
    const sim = { ...p }, forecast = forecastGeometry(brain.movementGeometry());
    for (let i = 0; i < 120; i++) {
      forecast.step(sim, i * FIXED_DT_MS);
      const result = stepBody(sim, { direction }, forecast.geometry, FIXED_DT_MS, now + i * FIXED_DT_MS, mods);
      if (result.fell || bounds(sim).bottom >= (brain.poisonY ?? Infinity)) break;
      if (sim.grounded) { brain.landingDirection = direction; return direction; }
    }
  }
  return null;
}

module.exports = { pursuitDirection, navigate, groundObstacleDirection, startObstacleRecovery, walkDirection, ridePlatform, findRideExit, executeTravel, airRecovery, forecastLanding };
