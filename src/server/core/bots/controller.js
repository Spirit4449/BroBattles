const { createRandom } = require('./random');
const { difficultyForTrophies } = require('./config');
const { bounds, stepBody } = require('./physics');
const { buildGraph, findRoute, nearestSurface, safeWalkDirection, previewManeuver } = require('./navigation');
const { advanceAmmo, basicAim, hasClearShot, requestBasic, requestSpecial } = require('./combat');
const { observe, incomingThreat, maneuverDanger } = require('./perception');
const { healthFraction, preferredRange, selectTarget, chooseDecision } = require('./tactics');
const { updateSuperPlan, shouldUseSuper } = require('./supers');
const effects = require('../gameRoom/effects/effectManager');
const { isMovementSuppressed } = require('../gameRoom/abilityRuntimeManager');
const movement = require('../../../shared/movementPhysics.json');

class BotController {
  constructor(room, player) {
    this.room = room;
    this.player = player;
    this.random = createRandom(player.seed);
    this.profile = player.difficulty || difficultyForTrophies(player.trophies);
    this.profile.dodgeChance ??= 0.4 + (this.profile.prediction || 0) * 0.45;
    this.profile.tacticalAwareness ??= Math.min(1, 0.3 + (this.profile.prediction || 0) * 0.7);
    this.reactionMs = this.between(this.profile.reactionMinMs, this.profile.reactionMaxMs);
    this.aggression = this.between(0.9, 1.2) + this.profile.tacticalAwareness * 0.12;
    this.spacing = this.between(0.85, 1.1);
    this.openingDelay = this.between(350, 800);
    this.observations = [];
    this.projectileSamples = new WeakMap();
    this.nextThink = 0;
    this.nextSample = 0;
    this.nextOpportunity = 0;
    this.nextDecisionAt = 0;
    this.nextDodgeAt = 0;
    this.nextHopAt = 0;
    this.nextWallPlayAt = 0;
    this.kiteUntil = 0;
    this.nextKiteAt = 0;
    this.idleUntil = 0;
    this.pursuit = null;
    this.ineffectivePositions = [];
    this.intent = { direction: 0 };
    this.graph = buildGraph(room.geometry, player.char_class);
    this.visited = new Map();
    this.blockedEdges = new Map();
    this.routePreferences = new Map();
    this.metrics = { thinks: 0, attacks: 0, specials: 0, recoveries: 0, falls: 0, unforcedFalls: 0,
      idleMs: 0, stuckMs: 0, dodges: 0, jumps: 0, optionalHops: 0, wallPauses: 0, targetSwitches: 0, retreats: 0, pickupGoals: 0,
      superSaves: 0, superThreatMs: 0 };
  }

  between(min, max) { return min + this.random() * (max - min); }

  tick(dt, now) {
    const p = this.player, room = this.room;
    if (!p.isAlive || room.status !== 'active') return;
    if (this.openingUntil === undefined) {
      this.openingUntil = now + this.openingDelay;
      this.nextIdleAt = now + this.between(7000, 12000);
      this.nextHopAt = now + this.between(4000, 8000);
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
      this.clearTravel();
      return;
    }
    if (now >= this.nextThink) {
      this.nextThink = now + this.between(100, 145);
      const observed = this.observations.findLast((s) => s.at <= now - this.reactionMs);
      this.think(observed, mods, now);
    }
    this.executeTravel(now, mods);
    if (p._botActionUntil <= now && this.intent.direction) p.flip = this.intent.direction < 0;
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
    if (p.grounded && this.traversal && (p.platformId === this.traversal.to || now > this.traversal.until)) this.traversal = null;
    if (p._botActionUntil <= now) p.animation = p.grounded ? (Math.abs(p.vx) > 12 ? 'running' : 'idle') : (p.vy < 0 ? 'jumping' : 'falling');
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
    const poisonY = room._suddenDeathActive ? room._computePoisonY(now - room._loopStartWallTime - room.gameMode.getMatchDurationMs()) : Infinity;
    for (const [key, until] of this.blockedEdges) if (until <= now) this.blockedEdges.delete(key);
    const routes = new Map();
    const routeTo = (id) => {
      if (!routes.has(id)) routes.set(id, findRoute(graph, current?.id, id, poisonY, {
        blocked: this.blockedEdges,
        edgeCost: (edge, from) => {
          const key = `${from}:${edge.to}`;
          if (!this.routePreferences.has(key)) this.routePreferences.set(key, this.random() * 240);
          return (edge.jump ? 220 : 0) + this.routePreferences.get(key);
        },
      }));
      return routes.get(id);
    };
    return { graph, current, poisonY, routeTo };
  }

  think(observed, mods, now) {
    this.metrics.thinks++;
    const p = this.player, enemies = observed?.enemies || [];
    const context = this.context(mods, now);
    this.poisonY = context.poisonY;
    const threatened = incomingThreat(observed, p, now);
    const recentlyHurt = p.lastDamagedAt > 0 && now - p.lastDamagedAt < 850;
    const wasRetreating = this.retreating;
    const awareness = this.profile.tacticalAwareness;
    this.retreating = healthFraction(p) < (this.retreating ? 0.65 + awareness * 0.1 : 0.35 + awareness * 0.08);
    if (this.retreating && !wasRetreating) this.metrics.retreats++;
    const target = selectTarget(this, enemies, context.routeTo, now);
    if (target?.participantId !== this.targetId) {
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
    if (wasRetreating !== this.retreating || bounds(p).bottom >= context.poisonY - 100) {
      this.nextDecisionAt = 0;
      this.approachEdge = null;
    }
    if (now < this.openingUntil && !recentlyHurt && !threatened && p.grounded) {
      this.intent = { direction: 0 };
      this.wantsProgress = false;
      return;
    }
    if (threatened && p.grounded && !this.maneuver && this.tryDodge(observed, mods, now, context.poisonY)) {
      this.tryCombat(enemies, target, observed, now);
      return;
    }
    const pickupGone = this.decision?.mode === 'pickup' && !this.room._powerups.has(this.decision.pickupId);
    if (!this.decision || now >= this.nextDecisionAt || pickupGone) {
      // Occasionally fight while backing away; keep the choice long enough to read clearly.
      if (target && !this.retreating && healthFraction(p) < healthFraction(target) + 0.12 &&
          now >= this.nextKiteAt && now >= this.kiteUntil && this.random() < 0.16 &&
          Math.hypot(p.x - target.x, p.y - target.y) < preferredRange(this, target) * 0.85) {
        this.kiteUntil = now + this.between(900, 1800);
        this.nextKiteAt = this.kiteUntil + this.between(5000, 8500);
      }
      const previousGoal = this.decision?.goal?.surfaceId;
      this.decision = chooseDecision(this, context, target, enemies, now);
      this.nextDecisionAt = now + this.between(800, 1400) * (1.08 - this.profile.tacticalAwareness * 0.18);
      if (this.decision.mode === 'pickup' && this.decision.pickupId !== this.lastPickupGoalId) {
        this.metrics.pickupGoals++;
        this.lastPickupGoalId = this.decision.pickupId;
      } else if (this.decision.mode !== 'pickup') this.lastPickupGoalId = null;
      if (previousGoal !== this.decision.goal?.surfaceId) this.approachEdge = null;
      if (this.decision.mode !== 'fight') this.pursuit = null;
    }
    const immediatePressure = threatened || recentlyHurt || enemies.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 200);
    if (p.grounded && !this.traversal && !this.maneuver && !immediatePressure &&
        ['patrol', 'search'].includes(this.decision.mode) && now >= this.nextIdleAt) {
      this.idleUntil = now + this.between(180, 420);
      this.nextIdleAt = now + this.between(7000, 12000);
      this.approachEdge = null;
    }
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
    // Retreating takes priority over damage output. Counterfire is occasional and
    // limited to close pressure so the bot can create space and begin regenerating.
    if (this.retreating) {
      if (now < (this.retreatFireCooldownUntil || 0)) return;
      const closePressure = Math.max(150, preferredRange(this, target) * 0.65);
      if (nearest > closePressure && now - (p.lastDamagedAt || 0) > 550) return;
    }
    const candidates = [target, ...enemies.filter((e) => e !== target)]
      .filter((e) => {
        const aim = basicAim(p, e, this.profile, () => 0.5);
        return aim.canHit && hasClearShot(this.room, p, e, aim);
      })
      .sort((a, b) => (a.health / a.maxHealth) - (b.health / b.maxHealth));
    const age = Math.min(0.3, Math.max(0, now - (observed?.at || now)) / 1000) * this.profile.prediction;
    const predict = (enemy) => ({ ...enemy, x: enemy.x + (enemy.vx || 0) * age, y: enemy.y + (enemy.vy || 0) * age });
    // Supers have their own ranges and targeting rules. A missing basic shot
    // must not prevent a hook, swarm, or self buff from being considered.
    const superTarget = [target, ...enemies.filter((e) => e !== target)].map(predict)
      .find((enemy) => shouldUseSuper(this, enemy, enemies, now));
    const candidate = candidates[0];
    if (!candidate && !superTarget) return;
    this.nextOpportunity = now + this.between(180, 320) * (1.1 - this.profile.tacticalAwareness * 0.28);
    if (this.random() < this.profile.mistakeChance / this.aggression) { this.nextOpportunity += this.between(180, 400); return; }
    if (superTarget && requestSpecial(this.room, p, superTarget, now)) {
      this.metrics.specials++;
      this.superPlan = { charged: false, preferredRange: null };
    } else if (candidate && now >= (this.ammoReadyAfter || 0) && requestBasic(this.room, p, predict(candidate), this.profile, this.random, now)) {
      this.metrics.attacks++;
      // Wait after the mechanical cooldown/reload completes. This prevents the
      // bot from firing on the exact frame ammo becomes available every cycle.
      this.ammoReadyAfter = now + (Number(p.ammoState?.cooldownMs) || 0) + this.attackHesitationMs();
    }
    if (this.retreating) this.retreatFireCooldownUntil = now + this.between(900, 1400);
  }

  attackHesitationMs() {
    const awareness = this.profile.tacticalAwareness ?? 0.5;
    const aggression = Math.max(0.8, this.aggression || 1);
    const min = 65 + (1 - awareness) * 55;
    const max = 190 + (1 - awareness) * 170;
    // A rare quick follow-up creates bursts without returning to frame-perfect spam.
    if (this.random() < 0.12 * aggression) return this.between(35, 90);
    return this.between(min, max) / Math.min(1.2, aggression);
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
    if (this.decision?.mode !== 'fight' || !this.target || Math.abs(x - p.x) < 80) {
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
    this.intent = { direction: 0 };
    if (!goal) { this.wantsProgress = false; return; }
    const route = context.routeTo(goal.surfaceId);
    this.wantsProgress = route === null || route.length > 0 || Math.abs(goal.x - p.x) > 28;
    if (route?.length) {
      const edge = route[0];
      if (!this.approachEdge || this.approachEdge.to !== edge.to) {
        this.approachEdge = { ...edge, from: context.current.id, startedAt: now };
      }
    } else if (route) {
      this.approachEdge = null;
      this.walkGoalX = goal.x;
      this.intent.direction = this.pursuitDirection(goal.x, now);
      if (!this.wantsProgress && ['patrol', 'search'].includes(this.decision.mode) && !this.decision.arrived) {
        this.visited.set(context.current.id, now);
        this.decision.arrived = true;
        this.idleUntil = now + this.between(300, 650);
        this.nextDecisionAt = this.idleUntil;
      }
      if (this.decision.mode === 'fight' && this.target && !(this.pursuit?.holdUntil > now)) {
        const aim = basicAim(p, this.target, this.profile, () => 0.5);
        if (!aim.canHit || !hasClearShot(this.room, p, this.target, aim)) this.wantsProgress = true;
      }
    }
  }

  walkDirection(x, takeoff = false) {
    const p = this.player, dx = x - p.x, speed = Math.abs(p.vx || 0);
    const deadband = takeoff ? 3 : 20;
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
        this.traversal = { ...edge, cursor: 0, until: now + edge.duration + 800 };
        this.approachEdge = null;
      } else this.intent = { direction: this.pursuitDirection(edge.takeoffX, now, true) };
    } else if (p.grounded && Number.isFinite(this.walkGoalX) && !this.traversal && !this.maneuver) {
      this.intent = { direction: this.pursuitDirection(this.walkGoalX, now) };
    } else if (!p.grounded) this.approachEdge = null;
    const travel = this.maneuver || this.traversal;
    if (!travel) return;
    const frame = travel.frames[travel.cursor++];
    if (!frame || Math.hypot(p.x - frame.x, p.y - frame.y) > 65) {
      if (frame && this.traversal) this.blockedEdges.set(`${this.traversal.from}:${this.traversal.to}`, now + 2500);
      this.maneuver = null;
      this.traversal = null;
      this.nextThink = 0;
      return;
    }
    if (this.traversal && frame.jumpPressed && p.wallSide && now >= this.nextWallPlayAt &&
        bounds(p).bottom < this.poisonY - 160 && this.graph.surfaces.some((s) => s.top > bounds(p).bottom) && this.random() < 0.2) {
      this.traversal = null;
      this.wallWaitUntil = now + this.between(120, 350);
      this.nextWallPlayAt = now + this.between(7000, 11000);
      this.metrics.wallPauses++;
      this.airRecovery(this.context(mods, now), now);
      return;
    }
    this.intent = { direction: frame.direction, jumpPressed: frame.jumpPressed };
  }

  airRecovery(context, now) {
    const p = this.player, foot = bounds(p);
    const landing = context.graph.surfaces.filter((s) => s.top >= foot.bottom - 12 && s.top < context.poisonY - 25)
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

  tryDodge(observed, mods, now, poisonY) {
    if (now < this.nextDodgeAt) return false;
    this.nextDodgeAt = now + this.between(900, 1500);
    if (this.random() > this.profile.dodgeChance) return false;
    const p = this.player;
    const baseline = previewManeuver(p, { direction: this.intent.direction }, this.room.geometry, mods, now, poisonY);
    if (!baseline) return false;
    const baseDanger = maneuverDanger(baseline, observed, now, p.char_class);
    let best = null, bestScore = baseDanger - 20;
    for (const direction of [-1, 0, 1]) for (const jumpPressed of [false, true]) {
      if (jumpPressed && now - (this.lastJumpAt || 0) < 1800) continue;
      const candidate = previewManeuver(p, { direction, jumpPressed }, this.room.geometry, mods, now, poisonY);
      if (!candidate) continue;
      const score = maneuverDanger(candidate, observed, now, p.char_class) + (jumpPressed ? 35 : 0);
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) return false;
    this.clearTravel();
    this.maneuver = { ...best, cursor: 0 };
    this.idleUntil = 0;
    this.metrics.dodges++;
    this.nextDecisionAt = 0;
    return true;
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
    const approachTimedOut = this.approachEdge && now - this.approachEdge.startedAt > 2600;
    if (now - this.lastProgressAt < 2000 && !approachTimedOut) return;
    this.metrics.recoveries++;
    if (this.approachEdge) this.blockedEdges.set(`${this.approachEdge.from}:${this.approachEdge.to}`, now + 3500);
    this.clearTravel();
    const context = this.context(mods, now);
    const reachable = context.graph.surfaces.filter((s) => s.id !== context.current?.id && context.routeTo(s.id)?.length);
    reachable.sort((a, b) => (this.visited.get(a.id) || 0) - (this.visited.get(b.id) || 0));
    const surface = reachable[Math.floor(this.random() * Math.min(2, reachable.length))] || context.current;
    if (surface) {
      let x = surface.x;
      if (surface.id === context.current?.id) {
        const margin = context.graph.body.halfWidth + 25;
        const clamp = (value) => Math.max(surface.left + margin, Math.min(surface.right - margin, value));
        const direction = this.random() < 0.5 ? -1 : 1;
        x = clamp(p.x + direction * 220);
        if (Math.abs(x - p.x) < 40) x = clamp(p.x - direction * 220);
      }
      this.decision = { mode: 'reposition', goal: { x, y: surface.top, surfaceId: surface.id } };
      this.visited.set(surface.id, now);
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
  }
}
module.exports = { BotController };
