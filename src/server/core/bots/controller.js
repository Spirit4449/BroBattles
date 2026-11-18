const travel = require("./travel");
const ducking = require("./ducking");
const dodge = require("./dodge");
const combat = require("./combat");

const { tryBankInteraction, bankCombatEnemies } = require('./bankBust');
const { createRandom } = require('./random');
const { difficultyForTrophies, recoveryThreshold } = require('./config');
const { bounds, stepBody, movementGeometry } = require('../physics/bodySolver');
const { createRouteSearch, routeSearchTablesSteps, edgeKey, nearestSurface, safeWalkDirection, previewManeuver } = require('./navigation');
const { buildGraph } = require("./navigation");
const { staticGeometry } = require('../../../shared/maps/platformMotion');
const { advanceAmmo } = require('../../../shared/combat/combat.js');
const { observe, incomingThreat } = require('./perception');
const { healthFraction, selectTargetSteps, chooseDecisionSteps, finishSteps } = require('./tactics');
const { updateSuperPlan } = require('./supers');
const effects = require('../../../shared/combat/runtime/effects/effectManager.js');
const { isMovementSuppressed } = require('../../../shared/combat/runtime/abilityRuntimeManager.js');
const { updateTeamwork } = require('./teamwork');
const { resolveBotObjective } = require('./objectives');
const { tryDashSteps, recordDash } = require('./dash');
const movement = require('../../../shared/physics/movementPhysics.json');
const { DEATH_DROP_PICKUP_RADIUS } = require('../../../shared/combat/matchConfig.js');

const stomp = require('../gameRoom/stomp');
const { poisonYAt } = require('../gameRoom/timerManager');
class BotController {
  constructor(room, player) {
    this.room = room;
    this.player = player;
    this.random = createRandom(player.seed);
    this.profile = player.difficulty || difficultyForTrophies(player.trophies);
    this.profile.dodgeChance ??= 0.4 + (this.profile.prediction || 0) * 0.45;
    this.profile.tacticalAwareness ??= Math.min(1, 0.3 + (this.profile.prediction || 0) * 0.7);
    this.reactionMs = this.between(this.profile.reactionMinMs, this.profile.reactionMaxMs);
    this.aggression = this.between(0.9, 1.2);
    this.spacing = this.between(0.85, 1.1);
    this.openingDelay = this.between(350, 800);
    this.observations = [];
    this.projectileSamples = new WeakMap();
    this.nextThink = 0;
    this.nextSample = 0;
    this.nextOpportunity = 0;
    this.nextDecisionAt = 0;
    this.nextDodgeAt = 0;
    this.duckUntil = 0;
    this.duckDirection = 0;
    this.nextStrategicDuckAt = 0;
    this.nextFlavorDuckAt = 0;
    this.nextHopAt = 0;
    this.idleUntil = 0;
    this.pursuit = null;
    this.ineffectivePositions = [];
    this.intent = { direction: 0 };
    this.objective = resolveBotObjective(room, player);
    this.getGraph = room.navigation ? room.navigation.getGraph.bind(room.navigation) : buildGraph;
    this.graph = this.getGraph(staticGeometry(movementGeometry(room)), player.char_class);
    this.visited = new Map();
    this.blockedEdges = new Map();
    this.routePreferences = new Map();
    this.metrics = { thinks: 0, attacks: 0, specials: 0, recoveries: 0, falls: 0, unforcedFalls: 0,
      idleMs: 0, stuckMs: 0, dodges: 0, strategicDucks: 0, flavorDucks: 0, jumps: 0, optionalHops: 0, wallPauses: 0, targetSwitches: 0, retreats: 0, pickupGoals: 0,
      lootGoals: 0, lootCollected: 0, obstacleRecoveries: 0, superSaves: 0, superThreatMs: 0,
      dashes: 0, dashStomps: 0, dashEscapes: 0, dashChases: 0, dashDodges: 0, dashTravel: 0 };
  }

  between(min, max) { return min + this.random() * (max - min); }

  tick(dt, now) {
    const p = this.player, room = this.room;
    if (!p.isAlive || room.status !== 'active') {
      this.planning = null;
      if (!p.isAlive) { this.bankFlankUntil = null; this.bankCommit = null; this.bankGuardUntil = 0; }
      return;
    }
    if (this.openingUntil === undefined) {
      this.openingUntil = now + this.openingDelay;
      this.nextHopAt = now + this.between(4000, 8000);
      this.nextFlavorDuckAt = now + this.between(6500, 13000);
    }
    const chargesBeforeReload = Number(p.ammoState?.charges) || 0;
    advanceAmmo(p, dt);
    if ((Number(p.ammoState?.charges) || 0) > chargesBeforeReload) {
      this.ammoReadyAfter = Math.max(
        this.ammoReadyAfter || 0,
        now + this.attackHesitationMs(),
      );
    }
    if (this.superPlan?.charged) this.metrics.superThreatMs += dt;
    if (now >= this.nextSample) {
      this.nextSample = now + 100;
      this.observations.push(observe(room, p, now, this.projectileSamples));
      while (this.observations.length > 12) this.observations.shift();
    }
    const mods = effects.getModifiers(p, now);
    if ((this.maneuver?.dash || this.traversal?.dash) && p._knockbackUntil > now) {
      this.clearTravel();
      this.nextThink = 0;
    }
    if (p._controlLockUntil > now || isMovementSuppressed(p, now)) {
      p._dashUntil = 0;
      p._botDashCoastUntil = 0;
      this.intent = { direction: 0 };
      this.duckUntil = 0;
      this.duckDirection = 0;
      p.ducking = false;
      this.clearTravel();
      this.planning = null;
      return;
    }
    if (!this.planning && now >= this.nextThink) {
      this.nextThink = now + this.between(100, 145);
      const observed = this.observations.findLast((s) => s.at <= now - this.reactionMs);
      this.planning = { steps: this.thinkSteps(observed, mods, now), at: now, damageAt: p.lastDamagedAt };
    }
    this.advancePlanning(now);
    if (this.maneuver?.resumeWalk && p.grounded && now >= p._dashUntil && Math.abs(p.vx) <= movement.maxSpeed) {
      // The full stop was previewed for safety. On a long walk, resume normal
      // ledge-aware movement as soon as the extra dash speed has dissipated.
      this.maneuver = null;
      this.walkGoalX = this.decision?.goal?.x;
      this.nextThink = 0;
    }
    stomp.resolveStomp(room, p, now);
    p.ducking = p.grounded && now < this.duckUntil;
    if (p.ducking) {
      this.intent = { direction: this.getDuckDirection(), jumpPressed: false };
    }
    this.executeTravel(now, mods);
    if (p.ducking) {
      this.intent = { direction: this.getDuckDirection(), jumpPressed: false };
    }
    if (!this.maneuver?.dash && (this.traversal || this.maneuver || (this.intent.direction && p._botActionUntil <= now))) p.flip = this.intent.direction < 0;
    const result = stepBody(p, this.intent, this.movementGeometry(), dt, now, mods);
    this.intent.jumpPressed = false;
    this.intent.dash = null;
    p.lastInput = now;
    if (p.grounded && Math.abs(p.vx) < 12) this.metrics.idleMs += dt;
    this.checkProgress(now, dt, mods);
    if (result.fell) {
      this.metrics.falls++;
      if (now - (p.lastDamagedAt || 0) > 1500 && now - (p._controlLockUntil || 0) > 1000 && now - (p._knockbackUntil || 0) > 1000) this.metrics.unforcedFalls++;
      room.handlePlayerDeath(p, { cause: 'fall', at: now });
      return;
    }
    if (p.grounded && this.traversal && (this.traversal.cursor >= this.traversal.frames.length || now > this.traversal.until)) {
      this.traversal = null;
      this.intent = { direction: safeWalkDirection(p, 0, this.movementGeometry()) };
      this.nextThink = 0;
    }
    p.ducking = p.grounded && now < this.duckUntil;
    if (!p.ducking) this.duckDirection = 0;
    if (now < p._dashUntil) p.animation = 'dashing';
    else if (p._botActionUntil <= now) p.animation = p.ducking ? 'ducking' : p.grounded ? (Math.abs(p.vx) > 12 ? 'running' : 'idle') : (p.vy < 0 ? 'jumping' : 'falling');
    for (const event of result.events) {
      if (event === 'dash') { recordDash(this, 'dashTravel', now); continue; }
      if (event === 'jump' || event === 'wall-jump') { this.metrics.jumps++; this.lastJumpAt = now; }
      p.movementFxSeq = (p.movementFxSeq || 0) + 1;
      p.movementFxType = event;
      p.movementFxDirection = this.intent.direction;
      p.movementFxWallSide = p.wallSide;
    }
  }

  movementGeometry() {
    return movementGeometry(this.room);
  }

  context(mods, now) { return finishSteps(this.contextSteps(mods, now)); }

  *contextSteps(mods, now) {
    const p = this.player, room = this.room;
    const graph = this.getGraph(staticGeometry(this.movementGeometry()), p.char_class, { speedMult: mods.speedMult, jumpMult: mods.jumpMult });
    const tables = yield* routeSearchTablesSteps(graph);
    if (graph !== this.graph) { this.graph = graph; this.clearTravel(); this.nextDecisionAt = 0; }
    const current = graph.surfaces.find((s) => s.id === p.platformId) || nearestSurface(graph, { x: p.x, y: bounds(p).bottom });
    const actualPoisonY = room.suddenDeathActive ? poisonYAt(room, now) : Infinity;
    const gasSaturated = Number.isFinite(actualPoisonY) && actualPoisonY <= room.geometry.world.y + room.geometry.world.height * 0.1;
    const poisonY = gasSaturated ? Infinity : actualPoisonY;
    const poisonAt = (offset) => room.suddenDeathActive && !gasSaturated ? poisonYAt(room, now + offset) : Infinity;
    for (const [key, until] of this.blockedEdges) if (until <= now) this.blockedEdges.delete(key);
    const routes = new Map();
    const search = createRouteSearch(graph, current?.id, poisonY, {
        allowDash: now >= Math.max(p._dashReadyAt || 0, this.nextDashAt || 0),
        poisonAt,
        blocked: this.blockedEdges,
        startX: p.x,
        tables,
        edgeCost: (edge, from, pair) => {
          const key = pair ?? `${from}:${edge.to}`;
          if (!this.routePreferences.has(key)) this.routePreferences.set(key, this.random() * 240);
          return (edge.jump ? 70 : 0) + (edge.dash ? 140 : 0) + this.routePreferences.get(key);
        },
    });
    const routeTo = (id, goalX) => {
      const routeKey = `${id}:${goalX ?? ""}`;
      if (!routes.has(routeKey)) routes.set(routeKey, search(id, goalX));
      return routes.get(routeKey);
    };
    // routeTo for planning generators: a long search continues next frame.
    const routeSteps = function* (id, goalX) {
      const routeKey = `${id}:${goalX ?? ""}`;
      if (!routes.has(routeKey)) routes.set(routeKey, yield* search.steps(id, goalX));
      return routes.get(routeKey);
    };
    return { graph, current, poisonY, poisonAt, gasSaturated, routeTo, routeSteps };
  }

  advancePlanning(now) {
    const plan = this.planning;
    if (!plan) return;
    // Do not finish an obsolete attack/route after a respawn, hit or long stall.
    if (now - plan.at > 500 || this.player.lastDamagedAt !== plan.damageAt) {
      this.planning = null; this.nextThink = 0; return;
    }
    const deadline = Math.min(performance.now() + 1.5, this.room.botPlanningDeadline ?? Infinity);
    let units = 0;
    while (performance.now() < deadline && units++ < 128) {
      const start = performance.now();
      const result = plan.steps.next();
      this.metrics.planningUnitMaxMs = Math.max(this.metrics.planningUnitMaxMs || 0, performance.now() - start);
      if (result.done) { this.metrics.planningAgeMaxMs = Math.max(this.metrics.planningAgeMaxMs || 0, now-plan.at); this.planning = null; break; }
    }
    this.metrics.planningSlices = (this.metrics.planningSlices || 0) + 1;
  }

  think(...args) { return finishSteps(this.thinkSteps(...args)); }

  *thinkSteps(observed, mods, now) {
    this.metrics.thinks++;
    const p = this.player, enemies = observed?.enemies || [];
    this.collectNearbyDeathDrops(now);
    const context = yield* this.contextSteps(mods, now);
    this.objective = resolveBotObjective(this.room, p, {
      now,
      observed,
      navigation: context,
    });
    this.poisonY = context.poisonY;
    const suddenDeathStarted = this.room.suddenDeathActive && !this.suddenDeathActive;
    this.suddenDeathActive = !!this.room.suddenDeathActive;
    const saturationChanged = context.gasSaturated !== !!this.gasSaturated;
    this.gasSaturated = context.gasSaturated;
    if (suddenDeathStarted || saturationChanged) {
      // Drop stale combat, opening, and idle commitments as soon as the duel's
      // gas phase changes so the new routing policy applies this think.
      this.clearTravel();
      this.decision = null;
      this.openingUntil = 0;
      this.idleUntil = 0;
      this.nextDecisionAt = 0;
    }
    if (p.grounded && this.occupiedSurface !== p.platformId) {
      this.occupiedSurface = p.platformId;
      this.surfaceEnteredAt = now;
      this.visited.set(p.platformId, now);
    }
    const threatened = incomingThreat(observed, p, now);
    const recentlyHurt = p.lastDamagedAt > 0 && now - p.lastDamagedAt < 850;
    const previousRole = this.teamPlan?.role;
    this.teamPlan = updateTeamwork(this, observed, now);
    const bankMode = this.objective.behavior === 'bank-objectives';
    const roleChanged = !bankMode && previousRole !== this.teamPlan?.role;
    if (roleChanged) {
      this.nextDecisionAt = 0;
      this.approachEdge = null;
      this.metrics.roleChanges = (this.metrics.roleChanges || 0) + 1;
    }
    const wasRetreating = this.retreating;
    const awareness = this.profile.tacticalAwareness;
    this.retreating = this.teamPlan?.role === 'recover' || healthFraction(p) < recoveryThreshold(awareness, this.retreating, this.teamPlan?.morale);
    if (this.retreating && !wasRetreating) this.metrics.retreats++;
    tryBankInteraction(this, now);
    const combatEnemies = bankCombatEnemies(this, enemies, now);
    const target = yield* selectTargetSteps(this, combatEnemies, context.routeSteps, now);
    const targetChanged = target?.participantId !== this.targetId;
    if (targetChanged) {
      if (this.targetId && target) this.metrics.targetSwitches++;
      this.targetId = target?.participantId;
      this.nextDecisionAt = 0;
      this.pursuit = null;
      this.combatProgress = null;
      this.ineffectivePositions.length = 0;
    }
    this.target = target;
    yield;
    updateSuperPlan(this, enemies, now);
    this.trackCombatProgress(target, now);
    if (target) this.lastSeen = { ...target, at: observed.at };
    else if (this.teamPlan?.targetId) {
      const reports = this.room.botTeamwork.get(p.team)?.reports.values() || [];
      for (const report of reports) {
        const activity = report.enemies.find((enemy) => enemy.participantId === this.teamPlan.targetId);
        if (activity && (!this.lastSeen || report.at > this.lastSeen.at)) this.lastSeen = { ...activity, at: report.at };
      }
    }
    if (wasRetreating !== this.retreating || recentlyHurt || threatened) {
      this.idleUntil = 0;
      this.pursuit = null;
    }
    const newRetreatHit = this.retreating && p.lastDamagedAt > (this.lastRetreatDamageAt || 0);
    if (newRetreatHit) {
      this.lastRetreatDamageAt = p.lastDamagedAt;
      this.nextDecisionAt = 0;
      this.approachEdge = null;
    }
    if (wasRetreating !== this.retreating) {
      this.nextDecisionAt = 0;
      this.approachEdge = null;
    }
    if (now < this.openingUntil && !recentlyHurt && !threatened && p.grounded) {
      this.intent = { direction: 0 };
      this.wantsProgress = false;
      return;
    }
    if ((this.maneuver?.dash || this.traversal?.dash) && now >= (p._knockbackUntil || 0)) {
      yield* this.tryCombatSteps(enemies, target, observed, now);
      return;
    }
    if (yield* tryDashSteps(this, observed, target, threatened, mods, context, now)) return;
    if (threatened && p.grounded && !this.maneuver) {
      const dodge = yield* this.findDodgeSteps(observed, mods, now, context.poisonY);
      if (this.tryDodge(observed, mods, now, context.poisonY, dodge)) {
        yield* this.tryCombatSteps(enemies, target, observed, now);
        return;
      }
      if (!dodge.best && this.tryStrategicDuck(threatened, now)) {
        yield* this.tryCombatSteps(enemies, target, observed, now);
        return;
      }
    }
    const pickupGone = this.decision?.mode === 'pickup' && !this.room.powerups.has(this.decision.pickupId);
    const lootGone = this.decision?.mode === 'loot' && !this.room.deathDrops.has(this.decision.dropId);
    const emergency = wasRetreating !== this.retreating || newRetreatHit;
    if (p.grounded && emergency) { this.clearTravel(); this.duckUntil = 0; }
    const goalUnsafe = p.grounded && !this.traversal && this.decision?.goal && context.routeTo(this.decision.goal.surfaceId, this.decision.goal.x) === null;
    const committedRoute = !bankMode && (this.approachEdge || this.traversal) && !targetChanged && !roleChanged && !recentlyHurt && !threatened &&
      !newRetreatHit && !goalUnsafe && !(this.retreating && enemies.some((enemy) => Math.hypot(enemy.x - p.x, enemy.y - p.y) < 320)) && wasRetreating === this.retreating && bounds(p).bottom < context.poisonY - 100;
    if (!this.decision || (now >= this.nextDecisionAt && !committedRoute) || pickupGone || lootGone || emergency || goalUnsafe) {
      const previousGoal = this.decision?.goal?.surfaceId;
      this.decision = yield* chooseDecisionSteps(this, context, target, enemies, now);
      this.nextDecisionAt = now + this.between(800, 1400) * (1.08 - this.profile.tacticalAwareness * 0.18);
      if (this.decision.mode === 'pickup' && this.decision.pickupId !== this.lastPickupGoalId) {
        this.metrics.pickupGoals++;
        this.lastPickupGoalId = this.decision.pickupId;
      } else if (this.decision.mode !== 'pickup') this.lastPickupGoalId = null;
      if (this.decision.mode === 'loot' && this.decision.dropId !== this.lastLootGoalId) {
        this.metrics.lootGoals++;
        this.lastLootGoalId = this.decision.dropId;
      } else if (this.decision.mode !== 'loot') this.lastLootGoalId = null;
      if (previousGoal !== this.decision.goal?.surfaceId) this.approachEdge = null;
      if (this.decision.mode !== 'fight') this.pursuit = null;
    }
    yield;
    const immediatePressure = threatened || recentlyHurt || enemies.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 200);
    if (!this.wantsProgress && ['recover', 'fight'].includes(this.decision.mode) && this.maybeFlavorDuck(immediatePressure, now)) return;
    this.navigate(context, now);
    if (target && !this.intent.direction && p._botActionUntil <= now) {
      p.flip = target.x < p.x;
    }
    if (now < this.idleUntil && !this.decision.bankObjectiveId && !immediatePressure && p.grounded && !this.traversal && !this.maneuver) {
      this.intent = { direction: 0 };
      this.walkGoalX = null;
      this.approachEdge = null;
      this.wantsProgress = false;
    }
    if (p.grounded && !this.traversal && !this.approachEdge && !this.maneuver &&
        ['retreat', 'kite'].includes(this.decision.mode) && this.intent.direction && now >= this.nextHopAt) {
      this.nextHopAt = now + this.between(5000, 9000);
      if (this.random() < 0.35) {
        const hop = previewManeuver(p, { direction: this.intent.direction, jumpPressed: true }, this.movementGeometry(), mods, now, context.poisonY);
        if (hop) { this.maneuver = { ...hop, cursor: 0 }; this.metrics.optionalHops++; }
      }
    }
    yield* this.tryCombatSteps(enemies, target, observed, now);
  }

  tryCombat(...args) {
    return combat.tryCombat(this, ...args);
  }

  *tryCombatSteps(enemies, target, observed, now) {
    return yield* combat.tryCombatSteps(this, enemies, target, observed, now);
  }

  attackHesitationMs() {
    return combat.attackHesitationMs(this);
  }

  collectNearbyDeathDrops(now) {
    const p = this.player;
    if (!this.room.deathDrops?.size || !p.isAlive) return;
    const radius = DEATH_DROP_PICKUP_RADIUS;
    for (const drop of [...this.room.deathDrops.values()]) {
      if (!drop || drop.claimedBy || Number(drop.expiresAt || 0) <= now) continue;
      if (Math.hypot((Number(drop.x) || 0) - p.x, (Number(drop.y) || 0) - p.y) > radius) continue;
      const before = this.room.deathDrops.size;
      this.room.pickupDeathDrop(p.participantId, { id: drop.id, x: p.x, y: p.y });
      if (this.room.deathDrops.size < before) this.metrics.lootCollected++;
    }
  }

  trackCombatProgress(target, now) {
    this.ineffectivePositions = this.ineffectivePositions.filter((point) => point.until > now);
    if (!target || this.retreating || this.decision?.mode !== 'fight') {
      this.combatProgress = null;
      return;
    }
    const p = this.player;
    const distance = Math.hypot(target.x - p.x, target.y - p.y);
    const damage = this.room.rewardStats.get(p.name)?.damage || 0;
    const progress = this.combatProgress;
    if (!progress || damage > progress.damage || distance < progress.distance - 60) {
      this.combatProgress = { at: now, distance, damage, trail: [] };
      return;
    }
    const last = progress.trail.at(-1);
    if (p.grounded && (!last || last.surfaceId !== p.platformId || Math.abs(last.x - p.x) > 90)) {
      progress.trail.push({ x: p.x, surfaceId: p.platformId });
      if (progress.trail.length > 6) progress.trail.shift();
    }
    // Actual hits or closing distance count as progress; pacing back and forth
    // does not. Briefly avoid the unproductive positions and seek another angle.
    if (now - progress.at < 5000 || this.superPlan?.holding) return;
    for (const point of progress.trail) this.ineffectivePositions.push({ ...point, until: now + 8000 });
    this.ineffectivePositions = this.ineffectivePositions.slice(-8);
    this.combatProgress = null;
    this.pursuit = null;
    this.nextDecisionAt = 0;
  }

  pursuitDirection(x, now, takeoff = false) {
    return travel.pursuitDirection(this, x, now, takeoff);
  }

  navigate(context, now) {
    return travel.navigate(this, context, now);
  }

  groundObstacleDirection(direction) {
    return travel.groundObstacleDirection(this, direction);
  }

  startObstacleRecovery(context, direction, now) {
    return travel.startObstacleRecovery(this, context, direction, now);
  }

  walkDirection(x, takeoff = false) {
    return travel.walkDirection(this, x, takeoff);
  }

  // Routes cover static ground only. On a moving platform, edge toward the
  // goal side (combat continues; ledge braking keeps the footing) and hop off
  // once a previewed jump lands on static ground, preferring the goal side.
  ridePlatform(now, mods) {
    return travel.ridePlatform(this, now, mods);
  }

  // The same motions route edges use (hops, wall climbs, dashes), validated
  // from the bot's real state against forecast platform motion. Only landings
  // on static ground count.
  findRideExit(goalX, mods, now) {
    return travel.findRideExit(this, goalX, mods, now);
  }

  executeTravel(now, mods) {
    return travel.executeTravel(this, now, mods);
  }

  airRecovery(context, now) {
    return travel.airRecovery(this, context, now);
  }

  // Static landing targets can be out of reach when a jump toward a moving
  // platform is interrupted. Steer in a direction the forecast proves lands,
  // on static or moving ground: momentum first, then straight, then back.
  forecastLanding(now) {
    return travel.forecastLanding(this, now);
  }

  findDodgeManeuver(...args) {
    return dodge.findDodgeManeuver(this, ...args);
  }

  *findDodgeSteps(observed, mods, now, poisonY) {
    return yield* dodge.findDodgeSteps(this, observed, mods, now, poisonY);
  }

  tryDodge(observed, mods, now, poisonY, evaluated = null) {
    return dodge.tryDodge(this, observed, mods, now, poisonY, evaluated);
  }

  startDuck(now, duration, kind) {
    return ducking.startDuck(this, now, duration, kind);
  }

  getDuckDirection() {
    return ducking.getDuckDirection(this);
  }

  tryStrategicDuck(threat, now) {
    return ducking.tryStrategicDuck(this, threat, now);
  }

  maybeFlavorDuck(immediatePressure, now) {
    return ducking.maybeFlavorDuck(this, immediatePressure, now);
  }

  checkProgress(now, dt, mods) {
    const p = this.player;
    if (!this.lastPosition || Math.hypot(p.x - this.lastPosition.x, p.y - this.lastPosition.y) > 18) {
      this.lastPosition = { x: p.x, y: p.y };
      this.lastProgressAt = now;
    }
    if (!this.wantsProgress || now < this.idleUntil || now < this.openingUntil || mods.speedMult <= 0) {
      this.lastProgressAt = now;
      return;
    }
    if (Math.abs(p.vx) < 12 && p.grounded) this.metrics.stuckMs += dt;
    const approachTimedOut = this.approachEdge && now - this.approachEdge.startedAt > this.approachEdge.approachBudget;
    if (now - this.lastProgressAt < 2000 && !approachTimedOut) return;
    this.metrics.recoveries++;
    if (this.approachEdge) this.blockedEdges.set(edgeKey(this.approachEdge), now + 3500);
    this.clearTravel();
    const context = this.context(mods, now);
    // Recovery uses the same reachable, collision-free goals as exploration.
    // A raw platform center may be inside a wall and cannot be a fallback.
    // It is planned in slices like any think: run to completion here it took
    // up to ~100 ms of the game thread on the Pi in Bank Bust.
    this.planning = { steps: this.recoverySteps(context, now), at: now, damageAt: p.lastDamagedAt };
    this.lastProgressAt = now;
  }

  // Recovery has no combat target, so this only selects a reachable exploration
  // point; it does not run the expensive tactical aiming search.
  *recoverySteps(context, now) {
    this.decision = yield* chooseDecisionSteps(this, context, null, [], now);
    if (this.decision.goal) {
      this.nextDecisionAt = now + 2200;
      this.navigate(context, now);
    } else this.nextDecisionAt = 0;
  }

  clearTravel() { this.traversal = null; this.approachEdge = null; this.maneuver = null; this.walkGoalX = null; this.pursuit = null; }
  dispose() {
    this.planning = null;
    this.observations.length = 0;
    this.clearTravel();
    this.visited.clear();
    this.blockedEdges.clear();
    this.routePreferences.clear();
    this.ineffectivePositions.length = 0;
    this.combatProgress = null;
    this.projectileSamples = new WeakMap();
    this.decision = null;
    this.objective = null;
    this.duckDirection = 0;
    this.player.ducking = false;
  }
}
module.exports = { BotController };
