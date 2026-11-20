// Bro Ball bots. The ball is only kicked (attacks, body contact, dashes), so a
// bot plays it by getting behind it and kicking it upfield. Each team keeps one
// ball chaser; the other bot takes a support strategy that rotates with the
// game: a goalie stint, pushing up to attack, or hunting opponents. Human
// teammates count when roles are chosen. Bots read the public ball state and
// predict its flight with the server's own physics.
const { advanceBall, shotFor } = require('../gameModes/broBall/physics');
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
  for (let i = 1; i <= steps; i++) {
    const goal = advanceBall(copy, DT, field, [], () => {});
    points.push({ x: copy.x, y: copy.y, vx: copy.vx, vy: copy.vy, t: i * DT, goal });
    if (goal) break;
  }
  return points;
}

const scores = (flight, team) => flight.at(-1)?.goal === other(team);

function interceptPoint(flight, body) {
  for (const point of flight) {
    if (riseFor(body, point) > JUMP_REACH) continue;
    const run = Math.max(0, Math.abs(point.x - body.x) - body.halfWidth - rules.radius) / movement.maxSpeed;
    if (run <= point.t + 0.05) return point;
  }
  return flight.at(-1);
}

// A dash through the ball sends it along the dash. Only take one the server's
// physics says goes in, past every opponent.
function tryDashShot(brain, ball, body, ctx, now) {
  const p = brain.player;
  const { field, team, forward } = ctx;
  if (now < (p._dashReadyAt || 0) || now < (p._botActionUntil || 0) || now < (brain.broBall.nextDashAt || 0)) return false;
  const ahead = (ball.x - body.x) * forward;
  if (ahead < body.halfWidth + rules.radius - 4 || ahead > 200) return false;
  for (const lift of [0, 0.35, 0.6]) {
    const length = Math.hypot(1, lift);
    const dash = { x: forward / length, y: -lift / length, facing: forward };
    if (Math.abs(ball.y - (body.y + dash.y * ahead)) > body.halfHeight + rules.radius + rules.dashReach) continue;
    const shot = shotFor('super', { dash }, { x: forward, y: 0 }, field.floor, ball);
    const flight = predictBall({ x: ball.x, y: ball.y, vx: shot.direction.x * shot.speed, vy: shot.direction.y * shot.speed }, field, 90);
    if (!scores(flight, team)) continue;
    const blocked = ctx.enemies.some(enemy => flight.some(point =>
      Math.abs(point.x - enemy.x) < enemy.halfWidth + rules.radius && point.y > enemy.top - rules.radius && point.y < enemy.bottom + rules.radius));
    if (blocked) continue;
    brain.intent = { direction: forward, jumpPressed: false, dash: { x: dash.x, y: dash.y } };
    brain.broBall.nextDashAt = now + 1500;
    brain.metrics.dashes++;
    return true;
  }
  return false;
}

// The team's plan: one ball chaser, and a support strategy for the other bot.
function teamPlan(brain, ball, ctx, now) {
  const room = brain.room, team = brain.player.team;
  room._broBallPlans ||= {};
  const plan = room._broBallPlans[team] ||= { chaser: null, chaserUntil: 0, support: new Map() };
  const mates = [...room.players.values()].filter(a => a.team === team && a.isAlive);
  const reach = player => {
    const body = bodyOf(player);
    // Being behind the ball (between it and our goal) is worth a head start.
    const behind = (ball.x - body.x) * ctx.forward > 0 ? -90 : 90;
    return Math.abs(body.x - ball.x) + Math.max(0, body.bottom - ball.y - 160) * 0.4 + behind;
  };
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
function* broBallThinkSteps(brain, now) {
  const p = brain.player, room = brain.room, mode = room.gameMode;
  const state = mode.getModeState();
  brain.clearTravel();
  brain.wantsProgress = false;
  brain.broBall ||= { targetX: p.x };
  if (!state || state.goal) {
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
  const ctx = { field, team, own, attack, forward, enemies };
  const ball = state.ball;
  const flight = predictBall(ball, field);
  yield;

  const plan = teamPlan(brain, ball, ctx, now);
  const role = plan.chaser === p.participantId ? 'chaser' : supportRole(brain, plan, ball, ctx, now);
  brain.broBall.role = role;
  p._broBallRole = role;
  let targetX = p.x, jump = false;
  // Any role kicks a ball that comes to it the right way round.
  tryKick(brain, ball, body, ctx);
  const behindBall = point => point.x - forward * (body.halfWidth + rules.radius - 6);

  if (role === 'chaser') {
    const intercept = interceptPoint(flight, body);
    targetX = behindBall(intercept);
    if (tryDashShot(brain, ball, body, ctx, now)) {
      brain.broBall.targetX = targetX;
      return;
    }
    const rise = jumpTime(riseFor(body, intercept));
    const close = Math.abs(intercept.x - body.x) < body.halfWidth + rules.radius + 30;
    if (rise && close && p.grounded && intercept.t <= rise + 0.07) jump = true;
    // On the wrong side of a low ball: hop over it to get behind.
    const wrongSide = (ball.x - body.x) * forward < 0 && Math.abs(ball.x - body.x) < 110 && ball.y > body.top;
    if (wrongSide && p.grounded) jump = true;
    fight(brain, ball, ctx, now);
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
    if (Math.abs(ball.x - body.x) < 200 && ball.y > body.top - JUMP_REACH) targetX = behindBall(ball);
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
  if (!plan || brain.intent.dash) return;
  const gap = plan.targetX - brain.player.x;
  brain.intent.direction = Math.abs(gap) > 6 ? Math.sign(gap) : 0;
}

module.exports = { broBallThinkSteps, steerBroBall, predictBall };
