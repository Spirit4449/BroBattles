// Bro Ball bots. The ball is only kicked (attacks, body contact, dashes), so a
// bot plays it by getting behind it and kicking it upfield. Each team keeps one
// ball chaser; the other bot takes a support strategy that rotates with the
// game: a goalie stint, pushing up to attack, or hunting opponents. Human
// teammates count when roles are chosen. Bots read the public ball state and
// predict its flight with the server's own physics.
const { advanceBall, shotFor, sweepCircle } = require('../gameModes/broBall/physics');
const { ballRules: rules } = require('../../../shared/broBall');
const { requestBasic, requestSpecial } = require('../../../shared/combat/combat.js');
const movement = require('../../../shared/physics/movementPhysics.json');
const { FIXED_DT_MS } = require('../../../shared/gameConstants');
const { createRandom } = require('./random');

const DT = FIXED_DT_MS / 1000;
const PREDICT_STEPS = 72;
const JUMP_REACH = (movement.jumpSpeed * movement.jumpSpeed) / (2 * movement.gravity);
// A chaser keeps the ball unless a teammate is clearly better placed.
const CHASER_HOLD_MS = 3500;
// A support strategy lasts this long before it is reconsidered.
const SUPPORT_MS = [7000, 12000];
const SUPPORT_ROLES = ['keeper', 'advancer', 'hunter'];

const other = team => (team === 'team1' ? 'team2' : 'team1');

function seedFor(text) {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function bodyOf(player) {
  const x = player.x + (player._bodyCenterOffsetX || 0);
  const y = player.y + (player._bodyCenterOffsetY || 0);
  const halfWidth = player._bodyHalfWidth || 26, halfHeight = player._bodyHalfHeight || 42;
  return { x, y, halfWidth, halfHeight, left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight };
}

function gapTo(body, point) {
  const dx = Math.max(body.left - point.x, point.x - body.right, 0);
  const dy = Math.max(body.top - point.y, point.y - body.bottom, 0);
  return Math.hypot(dx, dy);
}

// Seconds after takeoff that a jump lifts the body by `height`, or null if it can't.
function jumpTime(height) {
  if (height <= 0) return 0;
  const v = movement.jumpSpeed, g = movement.gravity;
  const root = v * v - 2 * g * height;
  return root < 0 ? null : (v - Math.sqrt(root)) / g;
}

// How high a jump must lift the body's top to put the ball within kick reach.
const riseFor = (body, ball) => body.top - (ball.y + rules.radius + rules.kickReach * 0.6);

/** The ball's flight with nobody touching it, one point per fixed step. */
function predictBall(ball, field, steps = PREDICT_STEPS) {
  const copy = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  const points = [];
  let settled = false;
  for (let i = 1; i <= steps; i++) {
    const goal = settled ? null : advanceBall(copy, DT, field, [], () => {});
    settled ||= copy.vx === 0 && copy.vy === 0 && field.colliders.some(rect =>
      rect.collision?.up !== false && Math.abs(rect.top - copy.y - rules.radius) < 0.05 &&
      copy.x >= rect.left && copy.x <= rect.right);
    points.push({ x: copy.x, y: copy.y, vx: copy.vx, vy: copy.vy, t: i * DT, goal });
    if (goal) break;
  }
  return points;
}

const scores = (flight, team) => flight.at(-1)?.goal === other(team);

// Running and rising happen together. Account for both before committing to a touch.
function reachableAt(point, body) {
  const rise = jumpTime(riseFor(body, point));
  if (rise === null) return false;
  const run = Math.max(0, Math.abs(point.x - body.x) - body.halfWidth - rules.radius) / movement.maxSpeed;
  const drop = Math.max(0, point.y - body.bottom - rules.radius - rules.kickReach);
  return Math.max(rise, run, Math.sqrt(2 * drop / movement.gravity)) <= point.t + DT;
}

function interceptPoint(flight, body) {
  return flight.find(point => reachableAt(point, body)) || flight.at(-1);
}

function liveFlight(room, ball, field) {
  const cached = room._broBallForecast;
  if (cached?.tick === room.tickId && cached.ball === ball && cached.field === field) return cached.points;
  const points = predictBall(ball, field);
  room._broBallForecast = { tick: room.tickId, ball, field, points };
  return points;
}

// Check touches in flight order. A player can collect a pass before a defender
// further downfield, even when the same shot would never reach the goal.
function readDelivery(flight, ball, ctx) {
  for (let i = 0; i < flight.length; i += 2) {
    const point = flight[i];
    if (ctx.enemies.some(enemy => gapTo(enemy, point) <= rules.radius + Math.min(75, point.t * movement.maxSpeed))) break;
    if ((point.x - ball.x) * ctx.forward < 170) continue;
    const receiver = ctx.mates.find(mate => (mate.x - ball.x) * ctx.forward > 160 &&
      Math.abs(mate.x - point.x) < 110 && reachableAt(point, mate));
    if (receiver) return { player: receiver.player, x: point.x, t: point.t };
  }
  return null;
}

function* tryDelivery(brain, ball, body, ctx, plan, now) {
  const p = brain.player;
  const { field, team, forward } = ctx;
  const ahead = (ball.x - body.x) * forward;
  if (ahead < 0 || ahead > body.halfWidth + rules.radius + 100) return false;
  const canDash = now >= Math.max(p._dashReadyAt || 0, p._botActionUntil || 0, brain.broBall.nextDashAt || 0);
  let pass;
  const options = [null, ...(canDash ? [0, 0.35, 0.6] : [])];
  for (const lift of options) {
    let contact, source, dash;
    if (lift === null) {
      if (now < (p._broBallKickAt || 0) + rules.botKickCooldownMs) continue;
      contact = sweepCircle(ball.x, ball.y, 0, 0, body, rules.radius + rules.kickReach);
      if (!contact) continue;
      source = { kick: { special: false } };
    } else {
      const length = Math.hypot(1, lift);
      dash = { x: forward / length, y: -lift / length };
      const reach = rules.radius + rules.dashReach;
      const duration = movement.dashDurationMs / 1000;
      contact = sweepCircle(ball.x, ball.y, (ball.vx - dash.x * movement.dashHorizontalSpeed) * duration,
        (ball.vy - dash.y * movement.dashHorizontalSpeed) * duration, body, reach);
      if (!contact || dash.x * contact.x + dash.y * contact.y <= 0.12) continue;
      source = { dash };
    }
    const shot = shotFor(dash ? 'super' : 'kick', source, contact, field.floor, ball);
    const flight = predictBall({ x: ball.x, y: ball.y, vx: shot.direction.x * shot.speed,
      vy: shot.direction.y * shot.speed }, field, 90);
    const blocked = scores(flight, team) && ctx.enemies.some(enemy =>
      flight.some(point => gapTo(enemy, point) < rules.radius));
    if (scores(flight, team) && !blocked) {
      pass = { dash };
      break;
    }
    const receiver = !pass && readDelivery(flight, ball, ctx);
    if (receiver) pass = { dash, receiver };
    yield;
  }
  if (!pass) return false;
  if (pass.dash) {
    brain.intent = { direction: forward, dash: pass.dash };
    brain.broBall.nextDashAt = now + brain.room.FIXED_DT_MS + movement.dashDurationMs;
    brain.metrics.dashes++;
  } else if (brain.room.gameMode.botKick(p)) {
    brain.metrics.kicks = (brain.metrics.kicks || 0) + 1;
  } else return false;
  plan.receiver = null;
  if (pass.receiver) {
    plan.receiver = pass.receiver.player.participantId;
    plan.receiveX = pass.receiver.x;
    plan.passUntil = now + (pass.receiver.t + movement.dashDurationMs / 1000 + 0.25) * 1000;
    plan.launchedAt = now;
    plan.reset = brain.room.gameMode.getModeState().reset;
  }
  return true;
}

// The team's plan: one ball chaser, and a support strategy for the other bot.
function teamPlan(brain, ball, ctx, now) {
  const room = brain.room, team = brain.player.team;
  room._broBallPlans ||= {};
  const plan = room._broBallPlans[team] ||= { chaser: null, chaserUntil: 0, support: new Map() };
  const mates = [...room.players.values()].filter(a => a.team === team && a.isAlive && a.connected !== false);
  const reach = player => {
    const body = bodyOf(player);
    // Being behind the ball (between it and our goal) is worth a head start.
    const behind = (ball.x - body.x) * ctx.forward > 0 ? -90 : 90;
    return Math.abs(body.x - ball.x) + Math.max(0, body.bottom - ball.y - 160) * 0.4 + behind;
  };
  const receiver = mates.find(a => a.participantId === plan.receiver);
  if (receiver && now < plan.passUntil && plan.reset === room.gameMode.getModeState().reset &&
      (ball.vx * ctx.forward > 80 || now <= plan.launchedAt + movement.dashDurationMs)) {
    plan.chaser = receiver.participantId;
    plan.chaserUntil = plan.passUntil;
    return plan;
  }
  plan.receiver = null;
  const current = mates.find(a => a.participantId === plan.chaser);
  const best = mates.slice().sort((a, b) => reach(a) - reach(b) || String(a.participantId).localeCompare(String(b.participantId)))[0];
  if (!current || now > plan.chaserUntil || (best && reach(best) < reach(current) - 220)) {
    plan.chaser = best?.participantId;
    plan.chaserUntil = now + CHASER_HOLD_MS;
  }
  return plan;
}

// A support bot's strategy: weighted by its personality and the game state,
// held for a while so it commits to it.
function supportRole(brain, plan, ball, ctx, now) {
  const p = brain.player, id = p.participantId;
  const held = plan.support.get(id);
  if (held && now < held.until) return held.role;
  brain.broBall.random ||= createRandom(seedFor(`bro-ball:${id}:${p.seed}`));
  const random = brain.broBall.random;
  brain.broBall.personality ||= SUPPORT_ROLES[Math.floor(random() * SUPPORT_ROLES.length)];
  const state = brain.room.gameMode.getModeState();
  const ours = state.score[p.team], theirs = state.score[other(p.team)];
  const danger = Math.abs(ball.x - ctx.own.x) < Math.abs(ball.x - ctx.attack.x);
  const weights = {
    keeper: (danger ? 3 : 1) + (ours > theirs ? 1.5 : 0),
    advancer: (danger ? 0.6 : 2.2) + (ours < theirs ? 1.5 : 0),
    hunter: 1.2 + (ctx.enemies.length ? 0.6 : -1),
  };
  weights[brain.broBall.personality] += 1.8;
  // Do not repeat the same goalie stint back to back.
  if (held?.role === 'keeper') weights.keeper *= 0.35;
  const total = Object.values(weights).reduce((sum, w) => sum + Math.max(0, w), 0);
  let pick = random() * total, role = 'advancer';
  for (const [name, weight] of Object.entries(weights)) {
    pick -= Math.max(0, weight);
    if (pick <= 0) { role = name; break; }
  }
  plan.support.set(id, { role, until: now + SUPPORT_MS[0] + random() * (SUPPORT_MS[1] - SUPPORT_MS[0]) });
  brain.metrics[`role:${role}`] = (brain.metrics[`role:${role}`] || 0) + 1;
  return role;
}

function fight(brain, ball, ctx, now, { anywhere = false } = {}) {
  const p = brain.player;
  if (now < (brain.nextOpportunity || 0)) return;
  const targets = ctx.enemies
    .filter(e => anywhere || Math.hypot(e.x - ball.x, e.y - ball.y) < 280 || Math.abs(e.x - ctx.own.x) < 360)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  const target = targets[0];
  if (!target) return;
  brain.nextOpportunity = now + brain.between(220, 480) * (1.1 - brain.profile.tacticalAwareness * 0.3);
  if (p.superCharge >= p.maxSuperCharge && requestSpecial(brain.room, p, target.player, now)) {
    brain.metrics.specials++;
    return;
  }
  if (now >= (brain.ammoReadyAfter || 0) && requestBasic(brain.room, p, target.player, brain.profile, brain.random, now)) {
    brain.metrics.attacks++;
    brain.ammoReadyAfter = now + (Number(p.ammoState?.cooldownMs) || 0) + brain.attackHesitationMs();
  }
}

// Kick a ball in reach when it would go upfield: the kick sends it away from
// the kicker, so only when the ball is on the attacking side of the body (or
// overhead, where the kick pops it up).
function tryKick(brain, ball, body, ctx) {
  if (gapTo(body, ball) > rules.radius + rules.kickReach - 4) return false;
  const ahead = (ball.x - body.x) * ctx.forward;
  const overhead = ball.y < body.top && Math.abs(ball.x - body.x) < body.halfWidth;
  if (ahead < -4 && !overhead) return false;
  if (brain.random() > 0.55 + (brain.profile.tacticalAwareness ?? 0.5) * 0.4) return false;
  if (!brain.room.gameMode.botKick(brain.player)) return false;
  brain.metrics.kicks = (brain.metrics.kicks || 0) + 1;
  return true;
}

/** One think for a Bro Ball bot. Sets brain.intent, kicks, dashes and fights. */
function* broBallThinkSteps(brain, now, context) {
  const p = brain.player, room = brain.room, mode = room.gameMode;
  const state = mode.getModeState();
  brain.wantsProgress = false;
  brain.broBall ||= { targetX: p.x };
  if (!state || state.goal) {
    brain.clearTravel();
    brain.broBall.deck = null;
    brain.intent = { direction: 0 };
    brain.broBall.targetX = p.x;
    return;
  }
  const field = mode.field;
  const team = p.team;
  const own = field.goals[team], attack = field.goals[other(team)];
  const forward = Math.sign(attack.x - own.x);
  const body = bodyOf(p);
  const awareness = brain.profile.tacticalAwareness ?? 0.5;
  const enemies = [...room.players.values()].filter(e => e.team !== team && e.isAlive)
    .map(e => ({ ...bodyOf(e), player: e }));
  const mates = [...room.players.values()].filter(m => m !== p && m.team === team && m.isAlive && m.connected !== false)
    .map(m => ({ ...bodyOf(m), player: m }));
  const ctx = { field, team, own, attack, forward, enemies, mates };
  const ball = state.ball;
  const flight = liveFlight(room, ball, field);
  yield;

  const plan = teamPlan(brain, ball, ctx, now);
  let role = 'chaser';
  if (plan.chaser !== p.participantId) {
    const danger = flight.some(point => point.goal === team);
    const chaser = mates.find(m => m.player.participantId === plan.chaser);
    const buildingAttack = chaser && gapTo(chaser, ball) < 160 && (ball.x - own.x) * forward > 320;
    role = danger ? 'keeper' : buildingAttack ? 'advancer' : supportRole(brain, plan, ball, ctx, now);
  }
  brain.broBall.role = role;
  p._broBallRole = role;
  let targetX = p.x, jump = false;
  const last = flight.at(-1);
  const deck = role === 'chaser' && last.vy === 0 && context.graph.surfaces.find(s =>
    s.top < field.floor && Math.abs(s.top - last.y - rules.radius) < 1 && last.x >= s.left && last.x <= s.right);
  if (brain.broBall.deck && brain.broBall.deck !== deck?.id) brain.clearTravel();
  brain.broBall.deck = deck?.id;
  if (role !== 'chaser') tryKick(brain, ball, body, ctx);
  const behindBall = point => point.x - forward * (body.halfWidth + rules.radius - 6);

  if (role === 'chaser') {
    const receiving = plan.receiver === p.participantId && now < plan.passUntil &&
      plan.reset === state.reset;
    const delivery = receiving && flight.find(point => (point.x - plan.receiveX) * forward >= 0);
    const intercept = delivery || interceptPoint(flight, body);
    targetX = receiving ? behindBall({ x: plan.receiveX }) : behindBall(intercept);
    if (yield* tryDelivery(brain, ball, body, ctx, plan, now)) {
      brain.broBall.targetX = targetX;
      return;
    }
    const kicked = tryKick(brain, ball, body, ctx);
    if (kicked) plan.receiver = null;
    if (!kicked && deck && deck.id !== p.platformId && (p.grounded || brain.traversal || brain.maneuver)) {
      const x = Math.max(deck.left, Math.min(deck.right, behindBall(last)));
      const route = yield* context.routeSteps(deck.id, x);
      if (route?.length || brain.traversal || brain.maneuver) {
        brain.decision = { mode: 'bro-ball', goal: { surfaceId: deck.id, x, y: deck.top } };
        brain.navigate(context, now);
        return;
      }
    }
    const rise = jumpTime(riseFor(body, intercept));
    const close = Math.abs(intercept.x - body.x) < body.halfWidth + rules.radius + movement.maxSpeed * (rise || 0);
    if (rise && (close || delivery) && p.grounded && intercept.t <= rise + 0.14) jump = true;
    // On the wrong side of a low ball: hop over it to get behind.
    const wrongSide = (ball.x - body.x) * forward < 0 && Math.abs(ball.x - body.x) < 110 && ball.y > body.top;
    if (wrongSide && p.grounded) jump = true;
    if (!kicked) fight(brain, ball, ctx, now);
  } else if (role === 'keeper') {
    // Hold close to the line, where a jump covers most of the raised mouth.
    const distance = Math.abs(ball.x - own.x);
    targetX = own.x + forward * (body.halfWidth + 30 + Math.min(120, Math.max(0, 900 - distance) * 0.16));
    const threat = flight.find(point => point.goal === team) ||
      flight.find(point => Math.abs(point.x - own.x) < 170 && (point.vx || 0) * forward < -80);
    if (threat) {
      const save = flight.find(point => Math.abs(point.x - own.x) < 120 + awareness * 60) || threat;
      targetX = save.x + forward * (body.halfWidth * 0.5);
      const rise = jumpTime(riseFor(body, save));
      if (rise && p.grounded && save.t <= rise + 0.07 && Math.abs(save.x - body.x) < 90) jump = true;
    }
    // A loose ball near goal gets cleared from behind it.
    if (distance < 320 && Math.abs(ball.vx) < 320) targetX = behindBall(ball);
    fight(brain, ball, ctx, now);
  } else if (role === 'advancer') {
    // Push up ahead of the ball, ready for the next touch toward goal.
    targetX = ball.x + forward * (260 + awareness * 120);
    if ((attack.x - targetX) * forward < 160) targetX = attack.x - forward * 160;
    // Close in when the ball runs loose nearby.
    if ((ball.vx * forward > 80 || !mates.some(m => gapTo(m, ball) < 160)) &&
        Math.abs(ball.x - body.x) < 200 && ball.y > body.top - JUMP_REACH) targetX = behindBall(ball);
    fight(brain, ball, ctx, now);
  } else {
    // Hunter: go after the opponent nearest the ball, and fight.
    const prey = enemies.slice().sort((a, b) =>
      Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
    if (prey) {
      targetX = prey.x - Math.sign(prey.x - body.x || 1) * (170 + awareness * 60);
      if (prey.top < body.top - 60 && Math.abs(prey.x - body.x) < 180 && p.grounded) jump = true;
      fight(brain, ball, ctx, now, { anywhere: true });
    } else targetX = behindBall(ball);
  }

  const lo = Math.min(own.x, attack.x) + body.halfWidth + 2, hi = Math.max(own.x, attack.x) - body.halfWidth - 2;
  targetX = Math.max(lo, Math.min(hi, targetX));
  brain.broBall.targetX = targetX + (1 - awareness) * (brain.random() - 0.5) * 24;
  brain.intent = { direction: 0, jumpPressed: jump };
  if (jump) brain.metrics.jumps++;
}

/** Per-tick walk toward the planned spot, so bots do not overshoot between thinks. */
function steerBroBall(brain) {
  const plan = brain.broBall;
  if (!plan || brain.intent.dash || brain.traversal || brain.maneuver || brain.approachEdge) return;
  const gap = plan.targetX - brain.player.x;
  brain.intent.direction = Math.abs(gap) > 6 ? Math.sign(gap) : 0;
}

module.exports = { broBallThinkSteps, steerBroBall, predictBall };
