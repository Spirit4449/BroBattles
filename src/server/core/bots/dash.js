const { bounds, stepBody, startDash } = require('./physics');
const { maneuverDanger } = require('./perception');
const { healthFraction, preferredRange } = require('./tactics');
const { hasClearShot } = require('./combat');
const { isMovementSuppressed } = require('../gameRoom/abilityRuntimeManager');
const movement = require('../../../shared/movementPhysics.json');
const { STOMP_RADIUS } = require('../gameRoom/stomp');

const DT = 1000 / 60;

function recordDash(brain, kind, now) {
  brain.nextDashAt = brain.player._dashReadyAt + brain.between(250, 1100);
  brain.nextDashAttemptAt = brain.nextDashAt;
  brain.nextDodgeAt = now + movement.dashDurationMs + 450;
  brain.metrics.dashes++;
  brain.metrics[kind] = (brain.metrics[kind] || 0) + 1;
}

function canDash(brain, mods, now) {
  const p = brain.player;
  return p.isAlive && now >= (p._dashReadyAt || 0) &&
    now >= (p._botActionUntil || 0) && now >= (p._controlLockUntil || 0) &&
    now >= (p._knockbackUntil || 0) && (mods.speedMult ?? 1) > 0 && !isMovementSuppressed(p, now);
}

function previewDash(player, direction, geometry, mods, now, poisonAt = () => Infinity) {
  const p = { ...player }, frames = [];
  let stompImpact = null;
  if (direction && !startDash(p, direction, now)) return null;
  // Release input after launch and include braking/landing, not just the burst.
  for (let i = 0; i < 120; i++) {
    frames.push({ x: p.x, y: p.y, flip: p.flip, direction: 0, jumpPressed: false });
    const result = stepBody(p, { direction: 0 }, geometry, DT, now + i * DT, mods);
    if (!stompImpact && p.grounded && p._stompPendingUntil >= now + (i + 1) * DT) {
      const body = bounds(p);
      stompImpact = { x: p.x + body.offsetX, y: body.bottom, afterMs: (i + 1) * DT };
    }
    if (result.fell || bounds(p).bottom >= poisonAt((i + 1) * DT) - 12) return null;
    if (i >= (direction ? 10 : 62) && p.grounded && Math.abs(p.vx) < 12) return { frames, end: p, dash: !!direction, stompImpact };
  }
  return null;
}

// Use delayed observations and predict a short distance ahead at impact, rather
// than knowing live opponent positions. Match the actual stomp's body-edge radius.
function stompTargets(candidate, observed, now) {
  const impact = candidate?.stompImpact;
  if (!impact) return [];
  const dt = (Math.min(250, Math.max(0, now - observed.at)) + impact.afterMs) / 1000;
  return observed.enemies.filter(enemy => {
    const predicted = { ...enemy, x: enemy.x + (enemy.vx || 0) * dt,
      y: enemy.y + (enemy.grounded ? 0 : (enemy.vy || 0) * dt) };
    const body = bounds(predicted);
    const dx = Math.max(body.left - impact.x, impact.x - body.right, 0);
    const dy = Math.max(body.top - impact.y, impact.y - body.bottom, 0);
    return Math.hypot(dx, dy) <= STOMP_RADIUS;
  });
}

function *tryStompSteps(brain, observed, mods, context, now) {
  const p = brain.player;
  // Opportunistically convert ordinary jumps/falls, but preserve committed dash routes.
  if (p.grounded || brain.maneuver?.dash || brain.traversal?.dash || brain.approachEdge?.dash ||
      !observed.enemies.some(e => Math.abs(e.x - p.x) < STOMP_RADIUS + 100 &&
        e.y >= p.y - 60 && e.y - p.y < 600)) return false;
  brain.nextStompAttemptAt = brain.nextStompAttemptAt || 0;
  if (now < brain.nextStompAttemptAt) return false;
  brain.nextStompAttemptAt = now + brain.between(600, 1000);
  // Stomps are occasional tactics, not the default response to every nearby enemy.
  if (brain.random() >= 0.4) return false;
  const direction = { x: 0, y: 1 };
  yield;
  now = brain.room._botNow ?? now;
  if (p.grounded || !canDash(brain, mods, now)) return false;
  const candidate = previewDash(p, direction, brain.room.geometry, mods, now, context.poisonAt);
  if (!stompTargets(candidate, observed, now).length) return false;
  const baseline = previewDash(p, null, brain.room.geometry, mods, now, context.poisonAt);
  if (!baseline || maneuverDanger(candidate, observed, now, p.char_class) >
      maneuverDanger(baseline, observed, now, p.char_class) + 20) return false;
  if (!startDash(p, direction, now)) return false;
  brain.clearTravel();
  brain.maneuver = { ...candidate, cursor: 0 };
  brain.intent = { direction: 0 };
  brain.duckUntil = brain.idleUntil = 0;
  brain.nextDecisionAt = 0;
  recordDash(brain, 'dashStomps', now);
  return true;
}

function *tryDashSteps(brain, observed, target, threat, mods, context, now) {
  const p = brain.player, enemies = observed?.enemies || [];
  if (!observed || !canDash(brain, mods, now) || now < Math.max(brain.nextDashAt || 0, brain.nextDashAttemptAt || 0) ||
      brain.maneuver?.dash || brain.traversal?.dash || brain.approachEdge?.dash) return false;
  if (yield* tryStompSteps(brain, observed, mods, context, now)) return true;
  if (brain.maneuver || brain.traversal) return false;
  const nearest = enemies.slice().sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  const distance = enemy => Math.hypot(enemy.x - p.x, enemy.y - p.y);
  const escape = nearest && distance(nearest) < 380 && (brain.retreating ||
    (p.lastDamagedAt > 0 && now - p.lastDamagedAt < 1100 && healthFraction(p) < 0.7) ||
    (p.ammoState?.charges === 0 && distance(nearest) < 220));
  const chase = !brain.retreating && target && healthFraction(target) <= 0.5 && healthFraction(p) > 0.35 &&
    Math.abs(target.y - p.y) < 110 && distance(target) > preferredRange(brain, target) + 50 &&
    distance(target) < preferredRange(brain, target) + 500 && hasClearShot(brain.room, p, target);
  const dodge = threat && threat.impactIn <= 0.7;
  const goal = brain.decision?.goal;
  const travel = !escape && !chase && !dodge && !brain.retreating && p.grounded &&
    !brain.approachEdge && goal?.surfaceId === p.platformId && Math.abs(goal.x - p.x) > 380;
  if (!escape && !chase && !dodge && !travel) return false;
  // Roll once per opportunity, not once per physics frame. Even after the
  // mechanical cooldown expires, each bot waits a variable additional beat.
  brain.nextDashAttemptAt = now + brain.between(350, 700);
  const chance = dodge ? 0.67 + brain.profile.dodgeChance * 0.2 : escape ? 0.85 : chase ? 0.8 : 0.65;
  if (brain.random() >= chance) return false;
  const away = Math.sign(p.x - (nearest?.x ?? threat?.x ?? p.x)) || (p.flip ? -1 : 1);
  const toward = Math.sign((travel ? goal.x : target?.x ?? p.x) - p.x) || -away;
  const directions = dodge ? [{ x: away, y: 0 }, { x: 0, y: -1 },
    { x: away * Math.SQRT1_2, y: -Math.SQRT1_2 }, { x: -away * Math.SQRT1_2, y: -Math.SQRT1_2 }]
    : [{ x: escape ? away : toward, y: 0 }];
  const baseline = previewDash(p, null, brain.room.geometry, mods, now, context.poisonAt);
  if (!baseline) return false;
  const danger = maneuver => maneuverDanger(maneuver, observed, now, p.char_class);
  const baseDanger = danger(baseline);
  const separation = point => Math.min(...enemies.map(e => Math.hypot(e.x - point.x, e.y - point.y)));
  let best = null, bestScore = -Infinity;
  for (const direction of directions) {
    yield;
    const candidate = previewDash(p, direction, brain.room.geometry, mods, now, context.poisonAt);
    if (!candidate || !candidate.frames.some(frame => Math.hypot(frame.x - p.x, frame.y - p.y) >= 45)) continue;
    const risk = danger(candidate), avoided = baseDanger - risk;
    const escaped = escape ? separation(candidate.end) - separation(baseline.end) : 0;
    const gap = target ? Math.hypot(target.x - candidate.end.x, target.y - candidate.end.y) : 0;
    const closed = chase ? distance(target) - gap : travel ? Math.abs(goal.x - p.x) - Math.abs(goal.x - candidate.end.x) : 0;
    if (dodge ? avoided < Math.max(20, baseDanger * 0.18) : risk > baseDanger + 20) continue;
    if (!dodge && (escape ? escaped < 45 : closed < 65 || (!travel && gap < preferredRange(brain, target) * 0.6))) continue;
    const score = avoided + escaped + closed;
    if (score > bestScore) { best = { direction, candidate }; bestScore = score; }
  }
  now = brain.room._botNow ?? now;
  // Planning can span ticks: recheck availability and the landing at activation.
  if (!best || !canDash(brain, mods, now)) return false;
  const candidate = previewDash(p, best.direction, brain.room.geometry, mods, now, context.poisonAt);
  if (!candidate || !startDash(p, best.direction, now)) return false;
  brain.clearTravel();
  brain.maneuver = { ...candidate, cursor: 0, resumeWalk: travel };
  brain.intent = { direction: 0 };
  brain.duckUntil = 0;
  brain.idleUntil = 0;
  brain.nextDecisionAt = 0;
  recordDash(brain, dodge ? 'dashDodges' : escape ? 'dashEscapes' : travel ? 'dashTravel' : 'dashChases', now);
  return true;
}

module.exports = { previewDash, tryDashSteps, recordDash };
