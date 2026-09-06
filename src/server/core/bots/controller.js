const { createRandom } = require('./random');
const { difficultyForTrophies, recoveryThreshold } = require('./config');
const { bounds, stepBody } = require('./physics');
const { buildGraph, findRoute, prepareTraversal, edgeKey, nearestSurface, safeWalkDirection, previewManeuver, walkLimits, poisonDamage } = require('./navigation');
const { advanceAmmo, basicAim, hasClearShot, pressureAim, requestBasic, requestSpecial } = require('./combat');
const { observe, incomingThreat, maneuverDanger } = require('./perception');
const { healthFraction, preferredRange, selectTarget, chooseDecision } = require('./tactics');
const { updateSuperPlan, shouldUseSuper } = require('./supers');
const effects = require('../gameRoom/effects/effectManager');
const { isMovementSuppressed } = require('../gameRoom/abilityRuntimeManager');
const { updateTeamwork } = require('./teamwork');
const { resolveBotObjective } = require('./objectives');
const movement = require('../../../shared/movementPhysics.json');
const { DEATH_DROP_PICKUP_RADIUS, POWERUP_PICKUP_RADIUS, WORLD_BOUNDS } = require('../gameRoomConfig');

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
    this.graph = buildGraph(room.geometry, player.char_class);
    this.visited = new Map();
    this.blockedEdges = new Map();
    this.routePreferences = new Map();
    this.metrics = { thinks: 0, attacks: 0, specials: 0, recoveries: 0, falls: 0, unforcedFalls: 0,
      idleMs: 0, stuckMs: 0, dodges: 0, strategicDucks: 0, flavorDucks: 0, jumps: 0, optionalHops: 0, wallPauses: 0, targetSwitches: 0, retreats: 0, pickupGoals: 0,
      lootGoals: 0, lootCollected: 0, obstacleRecoveries: 0, superSaves: 0, superThreatMs: 0 };
  }

  between(min, max) { return min + this.random() * (max - min); }

  tick(dt, now) {
    const p = this.player, room = this.room;
    if (!p.isAlive || room.status !== 'active') return;
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
    if (p._controlLockUntil > now || isMovementSuppressed(p, now)) {
      this.intent = { direction: 0 };
      this.duckUntil = 0;
      this.duckDirection = 0;
      p.ducking = false;
      this.clearTravel();
      return;
    }
    if (now >= this.nextThink) {
      this.nextThink = now + this.between(100, 145);
      const observed = this.observations.findLast((s) => s.at <= now - this.reactionMs);
      this.think(observed, mods, now);
    }
    p.ducking = p.grounded && now < this.duckUntil;
    if (p.ducking) {
      this.intent = { direction: this.getDuckDirection(), jumpPressed: false };
    }
    this.executeTravel(now, mods);
    if (p.ducking) {
      this.intent = { direction: this.getDuckDirection(), jumpPressed: false };
    }
    if (this.traversal || this.maneuver || (p._botActionUntil <= now && this.intent.direction)) p.flip = this.intent.direction < 0;
    const result = stepBody(p, this.intent, room.geometry, dt, now, mods);
    this.intent.jumpPressed = false;
    p.lastInput = now;
    if (p.grounded && Math.abs(p.vx) < 12) this.metrics.idleMs += dt;
    this.checkProgress(now, dt, mods);
    if (result.fell) {
      this.metrics.falls++;
      if (now - (p.lastDamagedAt || 0) > 1500 && now - (p._controlLockUntil || 0) > 1000 && now - (p._knockbackUntil || 0) > 1000) this.metrics.unforcedFalls++;
      room._handlePlayerDeath(p, { cause: 'fall', at: now });
      return;
    }
    if (p.grounded && this.traversal && (this.traversal.cursor >= this.traversal.frames.length || now > this.traversal.until)) {
      this.traversal = null;
      this.intent = { direction: safeWalkDirection(p, 0, room.geometry) };
      this.nextThink = 0;
    }
    p.ducking = p.grounded && now < this.duckUntil;
    if (!p.ducking) this.duckDirection = 0;
    if (p._botActionUntil <= now) p.animation = p.ducking ? 'ducking' : p.grounded ? (Math.abs(p.vx) > 12 ? 'running' : 'idle') : (p.vy < 0 ? 'jumping' : 'falling');
    for (const event of result.events) {
      if (event === 'jump' || event === 'wall-jump') { this.metrics.jumps++; this.lastJumpAt = now; }
      p.movementFxSeq = (p.movementFxSeq || 0) + 1;
      p.movementFxType = event;
      p.movementFxDirection = this.intent.direction;
      p.movementFxWallSide = p.wallSide;
    }
  }

  context(mods, now) {
    const p = this.player, room = this.room;
    const graph = buildGraph(room.geometry, p.char_class, { speedMult: mods.speedMult, jumpMult: mods.jumpMult });
    if (graph !== this.graph) { this.graph = graph; this.clearTravel(); this.nextDecisionAt = 0; }
    const current = graph.surfaces.find((s) => s.id === p.platformId) || nearestSurface(graph, { x: p.x, y: bounds(p).bottom });
    const actualPoisonY = room._suddenDeathActive ? room._computePoisonY(now - room._loopStartWallTime - room.gameMode.getMatchDurationMs()) : Infinity;
    const gasSaturated = Number.isFinite(actualPoisonY) && actualPoisonY <= WORLD_BOUNDS.height * 0.1;
    const poisonY = gasSaturated ? Infinity : actualPoisonY;
    const poisonAt = (offset) => room._suddenDeathActive && !gasSaturated ? room._computePoisonY(now + offset - room._loopStartWallTime - room.gameMode.getMatchDurationMs()) : Infinity;
    for (const [key, until] of this.blockedEdges) if (until <= now) this.blockedEdges.delete(key);
    const routes = new Map();
    const routeTo = (id, goalX) => {
      const routeKey = `${id}:${goalX ?? ""}`;
      if (!routes.has(routeKey)) routes.set(routeKey, findRoute(graph, current?.id, id, poisonY, {
        poisonAt,
        blocked: this.blockedEdges,
        startX: p.x,
        goalX,
        edgeCost: (edge, from) => {
          const key = `${from}:${edge.to}`;
          if (!this.routePreferences.has(key)) this.routePreferences.set(key, this.random() * 240);
          return (edge.jump ? 70 : 0) + this.routePreferences.get(key);
        },
      }));
      return routes.get(routeKey);
    };
    return { graph, current, poisonY, poisonAt, gasSaturated, routeTo };
  }

  think(observed, mods, now) {
    this.metrics.thinks++;
    const p = this.player, enemies = observed?.enemies || [];
    this.collectNearbyDeathDrops(now);
    const context = this.context(mods, now);
    this.objective = resolveBotObjective(this.room, p, {
      now,
      observed,
      navigation: context,
    });
    this.poisonY = context.poisonY;
    const suddenDeathStarted = this.room._suddenDeathActive && !this.suddenDeathActive;
    this.suddenDeathActive = !!this.room._suddenDeathActive;
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
    const roleChanged = previousRole !== this.teamPlan?.role;
    if (roleChanged) {
      this.nextDecisionAt = 0;
      this.approachEdge = null;
      this.metrics.roleChanges = (this.metrics.roleChanges || 0) + 1;
    }
    const wasRetreating = this.retreating;
    const awareness = this.profile.tacticalAwareness;
    this.retreating = this.teamPlan?.role === 'recover' || healthFraction(p) < recoveryThreshold(awareness, this.retreating, this.teamPlan?.morale);
    if (this.retreating && !wasRetreating) this.metrics.retreats++;
    const target = selectTarget(this, enemies, context.routeTo, now);
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
    updateSuperPlan(this, enemies, now);
    this.trackCombatProgress(target, now);
    if (target) this.lastSeen = { ...target, at: observed.at };
    else if (this.teamPlan?.targetId) {
      const reports = this.room._botTeamwork.get(p.team)?.reports.values() || [];
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
    if (threatened && p.grounded && !this.maneuver) {
      const dodge = this.findDodgeManeuver(observed, mods, now, context.poisonY);
      if (this.tryDodge(observed, mods, now, context.poisonY, dodge)) {
        this.tryCombat(enemies, target, observed, now);
        return;
      }
      if (!dodge.best && this.tryStrategicDuck(threatened, now)) {
        this.tryCombat(enemies, target, observed, now);
        return;
      }
    }
    const pickupGone = this.decision?.mode === 'pickup' && !this.room._powerups.has(this.decision.pickupId);
    const lootGone = this.decision?.mode === 'loot' && !this.room._deathDrops.has(this.decision.dropId);
    const emergency = wasRetreating !== this.retreating || newRetreatHit;
    if (p.grounded && emergency) { this.clearTravel(); this.duckUntil = 0; }
    const goalUnsafe = p.grounded && !this.traversal && this.decision?.goal && context.routeTo(this.decision.goal.surfaceId, this.decision.goal.x) === null;
    const committedRoute = (this.approachEdge || this.traversal) && !targetChanged && !roleChanged && !recentlyHurt && !threatened &&
      !newRetreatHit && !goalUnsafe && !(this.retreating && enemies.some((enemy) => Math.hypot(enemy.x - p.x, enemy.y - p.y) < 320)) && wasRetreating === this.retreating && bounds(p).bottom < context.poisonY - 100;
    if (!this.decision || (now >= this.nextDecisionAt && !committedRoute) || pickupGone || lootGone || emergency || goalUnsafe) {
      const previousGoal = this.decision?.goal?.surfaceId;
      this.decision = chooseDecision(this, context, target, enemies, now);
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
    const immediatePressure = threatened || recentlyHurt || enemies.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 200);
    if (!this.wantsProgress && ['recover', 'fight'].includes(this.decision.mode) && this.maybeFlavorDuck(immediatePressure, now)) return;
    this.navigate(context, now);
    if (target && !this.intent.direction && p._botActionUntil <= now) {
      p.flip = target.x < p.x;
    }
    if (now < this.idleUntil && !immediatePressure && p.grounded && !this.traversal && !this.maneuver) {
      this.intent = { direction: 0 };
      this.walkGoalX = null;
      this.approachEdge = null;
      this.wantsProgress = false;
    }
    if (p.grounded && !this.traversal && !this.approachEdge && !this.maneuver &&
        ['retreat', 'kite'].includes(this.decision.mode) && this.intent.direction && now >= this.nextHopAt) {
      this.nextHopAt = now + this.between(5000, 9000);
      if (this.random() < 0.35) {
        const hop = previewManeuver(p, { direction: this.intent.direction, jumpPressed: true }, this.room.geometry, mods, now, context.poisonY);
        if (hop) { this.maneuver = { ...hop, cursor: 0 }; this.metrics.optionalHops++; }
      }
    }
    this.tryCombat(enemies, target, observed, now);
  }

  tryCombat(enemies, target, observed, now) {
    if (!target || now < this.nextOpportunity) return;
    const p = this.player;
    if (now < (this.ammoReadyAfter || 0) && p.superCharge < p.maxSuperCharge) return;
    const nearest = Math.min(...enemies.map((e) => Math.hypot(e.x - p.x, e.y - p.y)));
    // Use ordinary ammo/cooldown limits to push back a pursuer. Once clear of
    // pressure, stop firing so regeneration can begin.
    let counterfire = true;
    if (this.retreating) {
      const closePressure = Math.max(300, preferredRange(this, target) * 1.25);
      if (nearest > closePressure && now - (p.lastDamagedAt || 0) > 550) counterfire = false;
    }
    const candidates = [target, ...enemies.filter((e) => e !== target)]
      .filter((e) => {
        if (!counterfire) return false;
        const aim = basicAim(p, e, this.profile, () => 0.5, this.room);
        return (aim.canHit && hasClearShot(this.room, p, e, aim)) ||
          (p.ammoState?.charges >= 2 && now >= (p._botPressureUntil || 0) && pressureAim(this.room, p, e, this.profile));
      })
      .sort((a, b) => {
        if (this.retreating) return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y);
        const contestId = this.decision?.contestTargetId;
        if (contestId && a.participantId === contestId) return -1;
        if (contestId && b.participantId === contestId) return 1;
        const value = (enemy) => healthFraction(enemy) - (enemy.participantId === target.participantId ? 0.6 : 0);
        return value(a) - value(b);
      });
    const age = Math.min(0.3, Math.max(0, now - (observed?.at || now)) / 1000) * this.profile.prediction;
    const predict = (enemy) => ({ ...enemy, x: enemy.x + (enemy.vx || 0) * age, y: enemy.y + (enemy.vy || 0) * age });
    // Supers have their own ranges and targeting rules. A missing basic shot
    // must not prevent a hook, swarm, or self buff from being considered.
    const superTarget = [target, ...enemies.filter((e) => e !== target)].map(predict)
      .find((enemy) => shouldUseSuper(this, enemy, enemies, now));
    const candidate = candidates[0];
    if (!candidate && !superTarget) return;
    this.nextOpportunity = now + this.between(180, 320) * (1.1 - this.profile.tacticalAwareness * 0.28);
    if (this.random() < this.profile.mistakeChance / (this.aggression * (this.teamPlan ? 0.7 + this.teamPlan.morale * 0.6 : 1))) { this.nextOpportunity += this.between(180, 400); return; }
    if (superTarget && requestSpecial(this.room, p, superTarget, now)) {
      this.metrics.specials++;
      this.superPlan = { charged: false, preferredRange: null };
    } else if (candidate && now >= (this.ammoReadyAfter || 0) && requestBasic(this.room, p, predict(candidate), this.profile, this.random, now)) {
      this.metrics.attacks++;
      // Wait after the mechanical cooldown/reload completes. This prevents the
      // bot from firing on the exact frame ammo becomes available every cycle.
      this.ammoReadyAfter = now + (Number(p.ammoState?.cooldownMs) || 0) + this.attackHesitationMs();
    }
  }

  attackHesitationMs() {
    const awareness = this.profile.tacticalAwareness ?? 0.5;
    const aggression = Math.max(0.8, this.aggression || 1);
    const urgency = this.retreating ? 0.55 : 1;
    if (this.player.char_class === 'huntress') {
      // Her three-arrow spread is already forgiving, so give opponents a
      // readable punish window instead of chaining every available charge.
      return (this.between(360, 620) + (1 - awareness) * 120) * urgency;
    }
    const min = 65 + (1 - awareness) * 55;
    const max = 190 + (1 - awareness) * 170;
    // A rare quick follow-up creates bursts without returning to frame-perfect spam.
    if (this.random() < 0.12 * aggression) return this.between(35, 90);
    return this.between(min, max) / Math.min(1.2, aggression) * urgency;
  }

  collectNearbyDeathDrops(now) {
    const p = this.player;
    if (!this.room._deathDrops?.size || !p.isAlive) return;
    const radius = Number(DEATH_DROP_PICKUP_RADIUS) || 110;
    for (const drop of [...this.room._deathDrops.values()]) {
      if (!drop || drop.claimedBy || Number(drop.expiresAt || 0) <= now) continue;
      if (Math.hypot((Number(drop.x) || 0) - p.x, (Number(drop.y) || 0) - p.y) > radius) continue;
      const before = this.room._deathDrops.size;
      this.room._handleDeathDropPickup(p.participantId, { id: drop.id, x: p.x, y: p.y });
      if (this.room._deathDrops.size < before) this.metrics.lootCollected++;
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
    const p = this.player, direction = Math.sign(x - p.x);
    if (takeoff || this.decision?.mode !== 'fight' || !this.target || Math.abs(x - p.x) < 80 ||
        !basicAim(p, this.target, this.profile, () => 0.5, this.room).canHit) {
      this.pursuit = null;
      return this.walkDirection(x, takeoff);
    }
    let stage = this.pursuit;
    if (!stage || stage.surfaceId !== p.platformId || stage.direction !== direction) {
      stage = this.pursuit = { surfaceId: p.platformId, direction,
        x: p.x + direction * Math.min(Math.abs(x - p.x), this.between(190, 280)), holdUntil: null };
    }
    if (Math.abs(stage.x - p.x) <= 24 && Math.abs(p.vx) < 35 && stage.holdUntil === null) {
      stage.holdUntil = now + this.between(220, 380);
    }
    if (stage.holdUntil !== null) {
      if (now < stage.holdUntil) { this.wantsProgress = false; return 0; }
      this.pursuit = null;
      return this.pursuitDirection(x, now, takeoff);
    }
    // Never overshoot a target/goal that moved closer while taking this step.
    const stepX = direction > 0 ? Math.min(x, stage.x) : Math.max(x, stage.x);
    return this.walkDirection(stepX, takeoff);
  }

  navigate(context, now) {
    const p = this.player, goal = this.decision?.goal;
    this.walkGoalX = null;
    if (this.traversal || this.maneuver) { this.wantsProgress = true; return; }
    if (!p.grounded) { this.airRecovery(context, now); this.wantsProgress = true; return; }
    // Keep backing up to a sampled takeoff once an obstruction recovery has
    // begun. The wall contact disappears as soon as the bot steps away, but
    // abandoning the recovery then would send it straight back into the wall.
    if (this.approachEdge?.obstacleRecovery && this.approachEdge.from === context.current?.id) {
      this.wantsProgress = true;
      return;
    }
    this.intent = { direction: 0 };
    if (!goal) { this.wantsProgress = false; return; }
    const intendedX = Number.isFinite(this.approachEdge?.takeoffX) ? this.approachEdge.takeoffX : goal.x;
    const intendedDirection = Math.sign(intendedX - p.x);
    const wallDirection = p.wallSide === 'right' ? 1 : p.wallSide === 'left' ? -1 : 0;
    const obstacleDirection = this.groundObstacleDirection(intendedDirection);
    if (!this.approachEdge && intendedDirection && (intendedDirection === wallDirection || intendedDirection === obstacleDirection) &&
        this.startObstacleRecovery(context, intendedDirection, now)) return;
    const route = context.routeTo(goal.surfaceId, goal.x);
    this.wantsProgress = route === null || route.length > 0 || Math.abs(goal.x - p.x) > 28;
    if (route?.length) {
      const edge = route[0];
      if (!this.approachEdge || this.approachEdge.to !== edge.to) {
        this.approachEdge = { ...edge, from: context.current.id, startedAt: now, approachBudget: 2200 + Math.abs(edge.takeoffX - p.x) / Math.max(80, movement.maxSpeed * 0.65) * 1000 };
      }
    } else if (route) {
      this.approachEdge = null;
      this.walkGoalX = goal.x;
      if (['pickup', 'loot'].includes(this.decision.mode)) {
        const pickup = this.decision.mode === 'pickup' ? this.room._powerups.get(this.decision.pickupId) : this.room._deathDrops.get(this.decision.dropId);
        const radius = this.decision.mode === 'pickup' ? POWERUP_PICKUP_RADIUS : DEATH_DROP_PICKUP_RADIUS;
        if (pickup && Math.abs(p.x - pickup.x) < radius / 2 &&
            Math.hypot(p.x - pickup.x, p.y - pickup.y) >= radius - 2 && pickup.y < p.y) {
          const hop = previewManeuver(p, { direction: 0, jumpPressed: true }, this.room.geometry,
            effects.getModifiers(p, now), now, context.poisonY);
          if (hop?.frames.some((frame) => Math.hypot(frame.x - pickup.x, frame.y - pickup.y) < radius - 5)) {
            this.maneuver = { ...hop, cursor: 0 };
            this.wantsProgress = true;
            return;
          }
        }
      }
      this.intent.direction = this.pursuitDirection(goal.x, now);
      if (!this.wantsProgress && ['patrol', 'search'].includes(this.decision.mode) && !this.decision.arrived) {
        this.visited.set(context.current.id, now);
        this.decision.arrived = true;
        this.idleUntil = now + this.between(300, 650);
        this.nextDecisionAt = this.idleUntil;
      }
      if (this.decision.mode === 'fight' && this.target && !(this.pursuit?.holdUntil > now)) {
        const aim = basicAim(p, this.target, this.profile, () => 0.5, this.room);
        const blockedFight = (!aim.canHit || !hasClearShot(this.room, p, this.target, aim)) &&
          !pressureAim(this.room, p, this.target, this.profile);
        if (blockedFight) {
          this.wantsProgress = true;
          const targetDirection = Math.sign(this.target.x - p.x);
          if (targetDirection === this.groundObstacleDirection(targetDirection) &&
              this.startObstacleRecovery(context, targetDirection, now)) return;
        }
      }
    }
  }

  groundObstacleDirection(direction) {
    const p = this.player;
    if (!p.grounded || !direction) return 0;
    const body = bounds(p);
    const blocked = this.room.geometry.colliders.some((rect) => {
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

  startObstacleRecovery(context, direction, now) {
    const p = this.player, current = context.current;
    if (!p.grounded || !current || !direction) return false;
    // Small steps and low walls can be cleared immediately. Only commit when
    // the real movement solver proves that the hop lands safely.
    const hop = previewManeuver(p, { direction, jumpPressed: true }, this.room.geometry,
      effects.getModifiers(p, now), now, context.poisonY);
    if (hop && (hop.end.platformId !== current.id || (hop.end.x - p.x) * direction > 35)) {
      this.clearTravel();
      this.maneuver = { ...hop, cursor: 0, obstacleRecovery: true };
      this.wantsProgress = true;
      this.metrics.obstacleRecoveries++;
      return true;
    }
    const body = bounds(p);
    const candidates = (context.graph.edges.get(current.id) || [])
      .filter((edge) => Math.sign(edge.direction) === direction &&
        !this.blockedEdges.has(edgeKey(edge, current.id)) &&
        Math.abs(edge.takeoffX - p.x) <= 420 &&
        (p.x - edge.takeoffX) * direction >= -8)
      .map((edge) => ({ edge, surface: context.graph.surfaces.find((surface) => surface.id === edge.to) }))
      .filter(({ surface }) => surface &&
        (direction > 0 ? surface.right > body.right + 8 : surface.left < body.left - 8))
      .sort((a, b) =>
        Math.abs(a.edge.takeoffX - p.x) + a.edge.duration * 0.08 + (a.edge.jump ? 20 : 0) -
        (Math.abs(b.edge.takeoffX - p.x) + b.edge.duration * 0.08 + (b.edge.jump ? 20 : 0)));
    const edge = candidates[0]?.edge;
    if (!edge) return false;
    this.approachEdge = { ...edge, from: current.id, startedAt: now,
      approachBudget: 2200 + Math.abs(edge.takeoffX - p.x) / Math.max(80, movement.maxSpeed * 0.65) * 1000,
      obstacleRecovery: true };
    this.pursuit = null;
    this.wantsProgress = true;
    this.metrics.obstacleRecoveries++;
    return true;
  }

  walkDirection(x, takeoff = false) {
    const p = this.player;
    if (!takeoff) {
      const surface = this.graph.surfaces.find((s) => s.id === p.platformId);
      if (surface) { const limits = walkLimits(surface, p.char_class); x = Math.max(limits.left, Math.min(limits.right, x)); }
    }
    const dx = x - p.x, speed = Math.abs(p.vx || 0);
    const pickup = this.decision?.mode === 'pickup' ? this.room._powerups.get(this.decision.pickupId) :
      this.decision?.mode === 'loot' ? this.room._deathDrops.get(this.decision.dropId) : null;
    const radius = this.decision?.mode === 'loot' ? DEATH_DROP_PICKUP_RADIUS : POWERUP_PICKUP_RADIUS;
    const pickupTolerance = pickup ? Math.max(1, Math.sqrt(Math.max(0,
      radius ** 2 - (p.y - pickup.y) ** 2)) * 0.5) : 20;
    const deadband = takeoff ? 3 : Math.min(20, pickupTolerance);
    const stopping = speed * speed / (2 * movement.dragGround);
    const coasting = Math.sign(p.vx) === Math.sign(dx) && Math.abs(dx) <= stopping + deadband;
    const direction = coasting || Math.abs(dx) <= deadband ? 0 : Math.sign(dx);
    return takeoff ? direction : safeWalkDirection(p, direction, this.room.geometry);
  }

  executeTravel(now, mods) {
    const p = this.player;
    if (this.approachEdge && p.grounded && !this.traversal && !this.maneuver) {
      const edge = this.approachEdge;
      if (Math.abs(edge.takeoffX - p.x) <= 4 && Math.abs(p.vx || 0) < 12 && now >= (p._nextWallJump || 0)) {
        const prepared = prepareTraversal(p, edge, this.room.geometry, mods, now, this.poisonY);
        this.approachEdge = null;
        if (!prepared) {
          this.blockedEdges.set(edgeKey(edge), now + 2500);
          this.intent = { direction: safeWalkDirection(p, 0, this.room.geometry) };
          this.nextThink = 0;
          return;
        }
        this.traversal = { ...prepared, cursor: 0, until: now + prepared.duration + 800 };
      } else this.intent = { direction: this.pursuitDirection(edge.takeoffX, now, true) };
    } else if (p.grounded && Number.isFinite(this.walkGoalX) && !this.traversal && !this.maneuver) {
      this.intent = { direction: this.pursuitDirection(this.walkGoalX, now) };
    } else if (!p.grounded) this.approachEdge = null;
    const travel = this.maneuver || this.traversal;
    if (!travel) return;
    const frame = travel.frames[travel.cursor++];
    if (!frame || Math.hypot(p.x - frame.x, p.y - frame.y) > 65) {
      if (frame && this.traversal) this.blockedEdges.set(edgeKey(this.traversal), now + 2500);
      this.maneuver = null;
      this.traversal = null;
      this.nextThink = 0;
      return;
    }
    this.intent = { direction: frame.direction, jumpPressed: frame.jumpPressed };
  }

  airRecovery(context, now) {
    const p = this.player, foot = bounds(p);
    const landing = context.graph.surfaces.filter((s) => s.top >= foot.bottom - 12)
      .sort((a, b) => Math.max(a.left - p.x, 0, p.x - a.right) - Math.max(b.left - p.x, 0, p.x - b.right))[0];
    if (p.wallSide) {
      if (this.lastWallSide !== p.wallSide) {
        this.wallWaitUntil = now + this.between(100, 320) + (this.random() < this.profile.mistakeChance ? 220 : 0);
        this.metrics.wallPauses++;
      }
      this.lastWallSide = p.wallSide;
      const urgent = !landing || foot.bottom >= context.poisonY - 100;
      const jump = (urgent || now >= this.wallWaitUntil) && now >= (p._nextWallJump || 0);
      this.intent = { direction: (p.wallSide === 'left' ? -1 : 1) * (jump ? -1 : 1), jumpPressed: jump };
    } else {
      this.lastWallSide = null;
      const x = landing ? Math.max(landing.left + foot.halfWidth + 8, Math.min(landing.right - foot.halfWidth - 8, p.x)) : p.x;
      this.intent = { direction: Math.abs(x - p.x) > 8 ? Math.sign(x - p.x) : 0 };
    }
  }

  findDodgeManeuver(observed, mods, now, poisonY) {
    const p = this.player;
    const baseline = previewManeuver(p, { direction: this.intent.direction }, this.room.geometry, mods, now, poisonY);
    if (!baseline) return { best: null, baseDanger: Infinity, bestScore: Infinity };
    const poisonAt = this.context(mods, now).poisonAt;
    const hazardCost = (maneuver) => poisonDamage(maneuver.frames, maneuver.frames.length * 1000 / 60, poisonY, poisonAt) * 1200 / Math.max(1, p.health);
    const baseDanger = maneuverDanger(baseline, observed, now, p.char_class) + hazardCost(baseline);
    let best = null, bestScore = baseDanger - 20;
    for (const direction of [-1, 0, 1]) for (const jumpPressed of [false, true]) {
      if (jumpPressed && now - (this.lastJumpAt || 0) < 1800) continue;
      const candidate = previewManeuver(p, { direction, jumpPressed }, this.room.geometry, mods, now, poisonY);
      if (!candidate) continue;
      const score = maneuverDanger(candidate, observed, now, p.char_class) + hazardCost(candidate) + (jumpPressed ? 35 : 0);
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    return { best, baseDanger, bestScore };
  }

  tryDodge(observed, mods, now, poisonY, evaluated = null) {
    if (now < this.nextDodgeAt) return false;
    this.nextDodgeAt = now + this.between(900, 1500);
    if (this.random() > this.profile.dodgeChance) return false;
    const { best } = evaluated || this.findDodgeManeuver(observed, mods, now, poisonY);
    if (!best) return false;
    this.clearTravel();
    this.maneuver = { ...best, cursor: 0 };
    this.idleUntil = 0;
    this.metrics.dodges++;
    this.nextDecisionAt = 0;
    return true;
  }

  startDuck(now, duration, kind) {
    const p = this.player;
    if (!p.grounded || p._controlLockUntil > now || isMovementSuppressed(p, now)) return false;
    const priorDirection = Math.sign(this.intent.direction || 0);
    const longHold = this.random() < 0.28;
    const resolvedDuration = longHold
      ? Math.max(duration, this.between(750, 1300))
      : duration;
    const movingChance = kind === 'strategic' ? 0.34 : 0.6;
    this.duckDirection = this.random() < movingChance
      ? priorDirection || (p.flip ? -1 : 1)
      : 0;
    this.clearTravel();
    this.intent = { direction: this.getDuckDirection(), jumpPressed: false };
    this.duckUntil = now + resolvedDuration;
    p.ducking = true;
    this.idleUntil = Math.max(this.idleUntil || 0, this.duckUntil);
    this.metrics[kind === 'strategic' ? 'strategicDucks' : 'flavorDucks']++;
    return true;
  }

  getDuckDirection() {
    if (!this.duckDirection) return 0;
    const safeDirection = safeWalkDirection(
      this.player,
      this.duckDirection,
      this.room.geometry,
    );
    if (safeDirection) this.duckDirection = safeDirection;
    return safeDirection;
  }

  tryStrategicDuck(threat, now) {
    if (now < this.nextStrategicDuckAt || Number(threat?.impactIn) > 0.42) return false;
    const awareness = this.profile.tacticalAwareness ?? 0.5;
    // Even strong bots occasionally mistime a block; this keeps ducking from
    // becoming a guaranteed response to every unavoidable hit.
    if (this.random() > 0.74 + awareness * 0.22) return false;
    const duration = Math.max(300, Math.min(680, Number(threat.impactIn || 0) * 1000 + 260));
    if (!this.startDuck(now, duration, 'strategic')) return false;
    this.nextStrategicDuckAt = this.duckUntil + this.between(1400, 2600);
    this.nextFlavorDuckAt = Math.max(this.nextFlavorDuckAt, this.duckUntil + this.between(4000, 7000));
    return true;
  }

  maybeFlavorDuck(immediatePressure, now) {
    if (now < this.nextFlavorDuckAt) return false;
    const p = this.player;
    if (immediatePressure || !p.grounded || this.traversal || this.maneuver || this.approachEdge ||
        p._botActionUntil > now || Math.abs(p.vx || 0) > 18) {
      this.nextFlavorDuckAt = now + this.between(1200, 2600);
      return false;
    }
    this.nextFlavorDuckAt = now + this.between(7500, 15000);
    if (this.random() > 0.46) return false;
    return this.startDuck(now, this.between(220, 560), 'flavor');
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
    this.decision = chooseDecision(this, context, null, [], now);
    if (this.decision.goal) {
      this.nextDecisionAt = now + 2200;
      this.navigate(context, now);
    } else this.nextDecisionAt = 0;
    this.lastProgressAt = now;
  }

  clearTravel() { this.traversal = null; this.approachEdge = null; this.maneuver = null; this.walkGoalX = null; this.pursuit = null; }
  dispose() {
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
