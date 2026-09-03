const { createRandom } = require("./random");
const { difficultyForTrophies } = require("./config");
const { bounds, stepBody } = require("./physics");
const { buildGraph, findRoute, nearestSurface, safeWalkDirection } = require("./navigation");
const { advanceAmmo, basicAim, requestBasic, requestSpecial } = require("./combat");
const effects = require("../gameRoom/effects/effectManager");
const { isMovementSuppressed } = require("../gameRoom/abilityRuntimeManager");

class BotController {
  constructor(room, player) {
    this.room = room; this.player = player;
    this.random = createRandom(player.seed);
    this.profile = player.difficulty || difficultyForTrophies(player.trophies);
    this.reactionMs = this.profile.reactionMinMs + this.random() * (this.profile.reactionMaxMs - this.profile.reactionMinMs);
    this.aggression = 0.8 + this.random() * 0.4;
    this.spacing = 0.75 + this.random() * 0.3;
    this.observations = []; this.nextThink = 0; this.nextSample = 0;
    this.intent = { direction: 0 }; this.nextOpportunity = 0; this.lastProgressAt = 0;
    this.graph = buildGraph(room.geometry, player.char_class);
    this.metrics = { thinks: 0, attacks: 0, specials: 0, recoveries: 0, falls: 0, unforcedFalls: 0 };
  }

  tick(dt, now) {
    const p = this.player, room = this.room;
    if (!p.isAlive || room.status !== "active") return;
    advanceAmmo(p, dt);
    if (now >= this.nextSample) {
      this.nextSample = now + 100;
      const enemies = [...room.players.values()].filter((e) => e !== p && e.team !== p.team && e.isAlive && e.loaded && e.connected !== false && !effects.isActive(e, "invisibility", now) && Math.hypot(e.x - p.x, e.y - p.y) < 1400)
        .map((e) => ({ participantId: e.participantId, char_class: e.char_class, x: e.x, y: e.y, vx: e.vx, vy: e.vy, health: e.health, maxHealth: e.maxHealth, grounded: e.grounded, platformId: e.platformId }));
      const projectiles = (room._activeAttacks || []).filter((a) => a.attackerName !== p.name && Number.isFinite(a.x) && Number.isFinite(a.y))
        .map((a) => ({ x: a.x, y: a.y, vx: a.vx || 0, vy: a.vy || 0 }));
      this.observations.push({ at: now, enemies, projectiles });
      while (this.observations.length > 10) this.observations.shift();
    }
    const mods = effects.getModifiers(p, now);
    if (p._controlLockUntil > now || isMovementSuppressed(p, now)) { this.intent = { direction: 0 }; this.traversal = null; this.approachEdge = null; return; }
    if (now >= this.nextThink) {
      this.nextThink = now + 90 + this.random() * 35;
      const observed = this.observations.filter((s) => s.at <= now - this.reactionMs).at(-1);
      this.think(observed, mods, now);
    }
    // Approach takeoff with frame-level braking. A look-ahead ledge guard must not
    // prevent reaching a verified takeoff point near the edge of a platform.
    if (this.approachEdge && p.grounded && !this.traversal) {
      const edge = this.approachEdge;
      const dx = edge.takeoffX - p.x;
      const speed = Math.abs(p.vx || 0);
      if (Math.abs(dx) <= 4 && speed < 12 && now >= (p._nextWallJump || 0)) {
        this.traversal = { ...edge, cursor: 0, until: now + edge.duration + 800 };
        this.approachEdge = null;
      } else {
        const stopping = speed * speed / (2 * 1200);
        const coasting = Math.sign(p.vx) === Math.sign(dx) && Math.abs(dx) <= stopping + 3;
        this.intent = { direction: coasting || Math.abs(dx) <= 3 ? 0 : Math.sign(dx) };
      }
    } else if (!p.grounded) this.approachEdge = null;
    // Execute the same input sequence that verified this edge in the physics solver.
    if (this.traversal) {
      const frame = this.traversal.frames[this.traversal.cursor++];
      if (!frame || Math.hypot(p.x - frame.x, p.y - frame.y) > 65) {
        this.traversal = null; this.nextThink = 0;
      } else this.intent = { direction: frame.direction, jumpPressed: frame.jumpPressed };
    }
    if (p._botActionUntil <= now && this.intent.direction) p.flip = this.intent.direction < 0;
    const result = stepBody(p, this.intent, room.geometry, dt, now, mods);
    this.intent.jumpPressed = false;
    p.lastInput = now;
    if (result.fell) {
      this.metrics.falls++;
      if (now - (p.lastDamagedAt || 0) > 1500 && now - (p._controlLockUntil || 0) > 1000 && now - (p._knockbackUntil || 0) > 1000) this.metrics.unforcedFalls++;
      room._handlePlayerDeath(p, { cause: "fall", at: now }); return;
    }
    if (p.grounded && this.traversal && (p.platformId === this.traversal.to || now > this.traversal.until)) this.traversal = null;
    if (p._botActionUntil <= now) p.animation = p.grounded ? (Math.abs(p.vx) > 12 ? "running" : "idle") : (p.vy < 0 ? "jumping" : "falling");
    for (const event of result.events) {
      p.movementFxSeq = (p.movementFxSeq || 0) + 1; p.movementFxType = event;
      p.movementFxDirection = this.intent.direction; p.movementFxWallSide = p.wallSide;
    }
  }

  think(observed, mods, now) {
    this.metrics.thinks++;
    const p = this.player, room = this.room;
    const enemies = observed?.enemies || [];
    const target = enemies.sort((a, b) => this.targetScore(a) - this.targetScore(b))[0];
    const poisonY = room._suddenDeathActive ? room._computePoisonY(now - room._loopStartWallTime - room.gameMode.getMatchDurationMs()) : Infinity;
    let goal = target;
    const needsHealth = p.health / p.maxHealth < 0.3;
    const pickups = [...room._powerups.values()].filter((v) => v.activeAt <= now && v.y < poisonY - 30);
    const useful = pickups.sort((a, b) => this.pickupScore(a, needsHealth) - this.pickupScore(b, needsHealth))[0];
    if (useful && (needsHealth || !target || Math.hypot(useful.x - p.x, useful.y - p.y) < 160)) goal = useful;
    if (!goal && this.lastSeen && now - this.lastSeen.at < 1600) goal = this.lastSeen;
    if (target) this.lastSeen = { ...target, at: now };
    const graph = buildGraph(room.geometry, p.char_class, { speedMult: mods.speedMult, jumpMult: mods.jumpMult });
    this.graph = graph;
    const foot = bounds(p);
    const current = graph.surfaces.find((s) => s.id === p.platformId) || nearestSurface(graph, { x: p.x, y: foot.bottom });
    if (foot.bottom >= poisonY - 100 || (needsHealth && target && !useful)) {
      goal = [...graph.surfaces].filter((s) => s.top < poisonY - 40 && findRoute(graph, current?.id, s.id, poisonY) !== null)
        .sort((a, b) => (a.top - b.top) + (target ? (Math.abs(b.x - target.x) - Math.abs(a.x - target.x)) * 0.5 : 0))[0];
      if (goal) goal = { x: goal.x, y: goal.top };
    }
    if (!goal) {
      if (!this.patrol || now > this.patrol.until) {
        const reachable = graph.surfaces.filter((s) => findRoute(graph, current?.id, s.id, poisonY) !== null);
        const choice = reachable[Math.floor(this.random() * reachable.length)];
        if (choice) this.patrol = { x: choice.x, y: choice.top, until: now + 2500 };
      }
      goal = this.patrol;
    }
    let direction = 0, jumpPressed = false;
    const destination = goal && nearestSurface(graph, { x: goal.x, y: goal.char_class ? goal.y + bounds({ ...goal, flip: false }).offsetY + bounds({ ...goal, flip: false }).halfHeight : goal.y });
    if (goal && p.grounded && !this.traversal) {
      const route = findRoute(graph, current?.id, destination?.id, poisonY);
      if (route?.length) {
        this.approachEdge = route[0];
      } else if (route && !route.length) {
        this.approachEdge = null;
        direction = Math.sign(goal.x - p.x);
        if (target && goal === target) {
          const preferred = Math.min(450, basicAim(p, target, this.profile, () => 0.5).range * 0.65) * this.spacing;
          if (Math.abs(target.x - p.x) < preferred - 45) direction *= -1;
          else if (Math.abs(target.x - p.x) < preferred + 35) direction = 0;
        }
        direction = safeWalkDirection(p, direction, room.geometry);
      }
    } else if (!p.grounded && !this.traversal) {
      // Air recovery aims for a platform below, instead of blindly pursuing the opponent.
      const landing = graph.surfaces.filter((s) => s.top >= foot.bottom - 10 && s.top < poisonY - 20)
        .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      direction = landing ? Math.sign(landing.x - p.x) : 0;
      jumpPressed = !!p.wallSide && now >= (p._nextWallJump || 0);
    }
    if (!this.lastPosition || Math.hypot(p.x - this.lastPosition.x, p.y - this.lastPosition.y) > 18) {
      this.lastPosition = { x: p.x, y: p.y }; this.lastProgressAt = now;
    } else if (direction && now - this.lastProgressAt > 1600) {
      this.metrics.recoveries++; this.traversal = null; this.patrol = null;
      jumpPressed = p.grounded || !!p.wallSide; this.lastProgressAt = now;
    }
    if (target && now >= this.nextOpportunity && !needsHealth) {
      this.nextOpportunity = now + 180 + this.random() * 220;
      if (this.random() >= this.profile.mistakeChance / this.aggression) {
        if (requestSpecial(room, p, target, now)) this.metrics.specials++;
        else if (requestBasic(room, p, target, this.profile, this.random, now)) this.metrics.attacks++;
      } else { this.nextOpportunity += 200 + this.random() * 300; }
    }
    if (p.grounded && this.profile.prediction > 0.5 && observed?.projectiles.some((a) => Math.hypot(a.x + a.vx * 0.15 - p.x, a.y + a.vy * 0.15 - p.y) < 65) && this.random() < this.profile.prediction) jumpPressed = true;
    this.intent = { direction, jumpPressed };
  }
  targetScore(t) { return Math.hypot(t.x - this.player.x, t.y - this.player.y) + (t.health / t.maxHealth) * 80; }
  pickupScore(p, hurt) { return Math.hypot(p.x - this.player.x, p.y - this.player.y) - (hurt && p.type === "health" ? 400 : 0); }
  dispose() { this.observations.length = 0; this.traversal = null; }
}
module.exports = { BotController };
