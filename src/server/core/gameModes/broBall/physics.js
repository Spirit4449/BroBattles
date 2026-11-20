const { ballRules: rules } = require('../../../../shared/broBall');
const movement = require('../../../../shared/physics/movementPhysics.json');
const EPSILON = 0.001;

function normal(x, y, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(x, y);
  return length > EPSILON ? { x: x / length, y: y / length } : fallback;
}

// A circle sweeps against the four expanded faces and the four round corners.
function sweepCircle(x, y, dx, dy, rect, radius) {
  const { left, right, top, bottom } = rect;
  const nearX = Math.max(left, Math.min(right, x));
  const nearY = Math.max(top, Math.min(bottom, y));
  const gap = Math.hypot(x - nearX, y - nearY);
  if (gap < radius - EPSILON) {
    if (gap > EPSILON) {
      const n = normal(x - nearX, y - nearY);
      return { t: 0, ...n, depth: radius - gap };
    }
    const face = [
      { x: -1, y: 0, depth: radius + x - left },
      { x: 1, y: 0, depth: radius + right - x },
      { x: 0, y: -1, depth: radius + y - top },
      { x: 0, y: 1, depth: radius + bottom - y },
    ].reduce((a, b) => a.depth <= b.depth ? a : b);
    return { t: 0, ...face };
  }
  let first = null;
  function consider(t, nx, ny) {
    if (t >= -EPSILON && t <= 1 && dx * nx + dy * ny < 0 && (!first || t < first.t)) {
      first = { t: Math.max(0, t), x: nx, y: ny, depth: 0 };
    }
  }
  function face(t, along, low, high, nx, ny) {
    if (along >= low && along <= high) consider(t, nx, ny);
  }
  if (dx > 0) {
    const t = (left - radius - x) / dx;
    face(t, y + t * dy, top, bottom, -1, 0);
  } else if (dx < 0) {
    const t = (right + radius - x) / dx;
    face(t, y + t * dy, top, bottom, 1, 0);
  }
  if (dy > 0) {
    const t = (top - radius - y) / dy;
    face(t, x + t * dx, left, right, 0, -1);
  } else if (dy < 0) {
    const t = (bottom + radius - y) / dy;
    face(t, x + t * dx, left, right, 0, 1);
  }
  const a = dx * dx + dy * dy;
  if (!a) return first;
  for (const [cx, sideX] of [[left, -1], [right, 1]]) {
    for (const [cy, sideY] of [[top, -1], [bottom, 1]]) {
      const ox = x - cx, oy = y - cy;
      const b = ox * dx + oy * dy;
      const discriminant = b * b - a * (ox * ox + oy * oy - radius * radius);
      if (discriminant < 0) continue;
      const t = (-b - Math.sqrt(discriminant)) / a;
      const nx = (ox + dx * t) / radius, ny = (oy + dy * t) / radius;
      if (nx * sideX >= 0 && ny * sideY >= 0) consider(t, nx, ny);
    }
  }
  return first;
}

function goalCrossing(ball, dx, dy, goals) {
  for (const [defendingTeam, goal] of Object.entries(goals)) {
    const side = defendingTeam === 'team1' ? -1 : 1;
    if (dx * side <= 0) continue;
    const t = (goal.x + side * rules.radius - ball.x) / dx;
    const y = ball.y + dy * t;
    if (t >= 0 && t <= 1 && y - rules.radius >= goal.top - EPSILON &&
        y + rules.radius <= goal.bottom + EPSILON) return { t, defendingTeam };
  }
  return null;
}

// Which faces of a collider stop the ball: one-way platforms only catch it from above.
function faceBlocks(rect, hit, ball) {
  const sides = rect.collision;
  if (!sides || (sides.up && sides.down && sides.left && sides.right)) return true;
  // Rising through a one-way platform: ignore it until the ball is above it.
  if (!sides.down && ball.y + rules.radius > rect.top + EPSILON) return false;
  if (Math.abs(hit.y) >= Math.abs(hit.x)) return hit.y < 0 ? sides.up : sides.down;
  return hit.x < 0 ? sides.left : sides.right;
}

function limitSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= rules.maxSpeed) return;
  ball.vx *= rules.maxSpeed / speed;
  ball.vy *= rules.maxSpeed / speed;
}

function headDeflection(ball, body, bodyVx, elapsed, fresh) {
  const halfWidth = (body.right - body.left) / 2;
  const offset = (ball.x - (body.left + halfWidth + body.vx * elapsed)) / halfWidth;
  // A player running out from under the ball transfers less of their motion.
  const leading = Math.max(0, Math.min(1, 1 + 2 * Math.sign(bodyVx) * offset));
  const runSpeed = Math.sign(bodyVx) * Math.min(Math.abs(bodyVx), movement.maxSpeed);
  const carriedSpeed = runSpeed * rules.headRunTransfer * leading;
  const carry = fresh && carriedSpeed * ball.vx >= 0
    ? Math.sign(carriedSpeed) * Math.max(0, Math.abs(carriedSpeed) - Math.abs(ball.vx))
    : 0;

  // Add a small outward nudge only when the ball could linger over the head.
  const drift = ball.vx + carry;
  const slip = Math.max(0, rules.headSlipSpeed - Math.abs(drift - bodyVx));
  const side = Math.sign(drift + offset * rules.headSlipSpeed) || 1;
  return carry + side * slip;
}

// Where a strike sends the ball, how hard, and how it reads on the client.
function shotFor(kind, source, contact, floor, ball) {
  let direction, baseSpeed, effect;
  if (kind === 'smash') {
    const side = Math.sign(source.dash.x) ||
      (Math.abs(contact.x) > 0.16 ? Math.sign(contact.x) : source.dash.facing || 1);
    direction = normal(side, -rules.smashLiftRatio);
    baseSpeed = rules.smashSpeed;
    effect = 'smash';
  } else if (kind === 'super') {
    direction = source.dash;
    // Carry a level dash over the goal step instead of driving it along the turf.
    if (Math.abs(direction.y) < 0.14 && floor - ball.y <= rules.radius + rules.bodyLiftFloorRange) {
      direction = normal(direction.x, -rules.dashLift);
    }
    baseSpeed = rules.dashSpeed;
    effect = 'super';
  } else {
    const { special } = source.kick;
    direction = normal(contact.x, Math.min(contact.y, 0) - rules.kickLift);
    baseSpeed = special ? rules.superKickSpeed : rules.kickSpeed;
    effect = special ? 'super' : 'kick';
  }
  // Carry forward the incoming speed along the new shot direction.
  const forwardSpeed = ball.vx * direction.x + ball.vy * direction.y;
  const speed = Math.min(rules.maxSpeed, baseSpeed + Math.max(0, forwardSpeed));
  return { direction, speed, effect };
}

/**
 * Advances the ball one fixed step against the pitch and the players' bodies.
 * Returns the defending team when the whole ball crosses a goal line.
 * @param field {{ colliders, goals, floor }} from broBallField
 * @param scoredGoal The goal the ball has already entered, if any.
 */
function advanceBall(ball, dt, field, players, onImpact, scoredGoal = null) {
  const { radius } = rules;
  const { colliders, goals, floor } = field;
  let remaining = dt;
  // Resting on the pitch or on top of a platform: roll instead of falling.
  const support = ball.vy === 0 ? colliders.find(rect => Math.abs(rect.top - ball.y - radius) < 0.05 &&
    ball.x >= rect.left && ball.x <= rect.right && faceBlocks(rect, { x: 0, y: -1 }, ball)) : null;
  if (support) {
    ball.vx = Math.sign(ball.vx) * Math.max(0, Math.abs(ball.vx) - rules.rollingDrag * dt);
  } else {
    const drag = Math.exp(-rules.airDrag * dt);
    ball.vx *= drag;
    ball.vy = ball.vy * drag + rules.gravity * dt;
  }
  // One passive impulse per encounter. A player can stay pressed against a
  // pinned ball until there is room between them for another approach.
  ball.contacts ??= new Set();
  ball.pinnedBodies ??= new Set();
  for (const id of ball.contacts) {
    const body = players.find(player => player.id === id);
    if (!body || !sweepCircle(ball.x, ball.y, 0, 0, body, radius + 3)) {
      ball.contacts.delete(id);
      ball.pinnedBodies.delete(id);
    }
  }
  limitSpeed(ball);
  const struck = new Set();

  for (let iteration = 0; iteration < 12 && remaining > 0.00001; iteration++) {
    const dx = ball.vx * remaining, dy = ball.vy * remaining;
    let first = null;
    const consider = (hit, kind, priority, source) => {
      if (hit && (!first || hit.t < first.t - EPSILON ||
          (Math.abs(hit.t - first.t) <= EPSILON && priority < first.priority))) {
        first = { ...hit, kind, priority, source };
      }
    };
    for (const rect of colliders) {
      const hit = sweepCircle(ball.x, ball.y, dx, dy, rect, radius);
      if (hit && faceBlocks(rect, hit, ball)) consider(hit, 'wall', 0, rect);
    }
    for (const player of players) {
      const elapsed = dt - remaining;
      const rect = {
        left: player.left + player.vx * elapsed, right: player.right + player.vx * elapsed,
        top: player.top + player.vy * elapsed, bottom: player.bottom + player.vy * elapsed,
      };
      const relativeX = dx - player.vx * remaining, relativeY = dy - player.vy * remaining;
      // A directed shot can travel across the player who released it.
      // Restore collision as soon as the ball clears their body.
      const leavingStriker = ball.striker === player.id &&
        sweepCircle(ball.x, ball.y, 0, 0, rect, radius + rules.kickReach + 1);
      if (ball.striker === player.id && !leavingStriker) ball.striker = null;
      const contact = leavingStriker || struck.has(player.id) || ball.pinnedBodies.has(player.id) ? null : sweepCircle(ball.x, ball.y, relativeX, relativeY, rect, radius);
      if (!struck.has(player.id)) {
        if (player.dash && !leavingStriker) {
          const reach = sweepCircle(ball.x, ball.y, relativeX, relativeY, rect, radius + rules.dashReach);
          if (reach && player.dash.x * reach.x + player.dash.y * reach.y > 0.12) {
            consider(reach, player.dash.y > 0.65 ? 'smash' : 'super', 1, player);
          }
        }
        if (player.kick && !player.dash) {
          const reach = sweepCircle(ball.x, ball.y, relativeX, relativeY, rect, radius + rules.kickReach);
          consider(reach, 'kick', 2, player);
        }
      }
      consider(contact, 'body', 3, player);
    }
    const goal = scoredGoal ? null : goalCrossing(ball, dx, dy, goals);
    if (goal && (!first || goal.t <= first.t)) {
      ball.x += dx * goal.t;
      ball.y += dy * goal.t;
      return goal.defendingTeam;
    }
    if (!first) {
      ball.x += dx;
      ball.y += dy;
      break;
    }
    const { t, x: nx, y: ny, depth, source, kind } = first;
    ball.x += dx * t;
    ball.y += dy * t;
    // The net catches shots that reach the back on their own momentum.
    if (scoredGoal && kind === 'wall' && ny === 0 &&
        (nx > 0 ? source.right : source.left) === scoredGoal.backX) {
      ball.vx = ball.vy = 0;
      break;
    }
    remaining *= 1 - t;
    let impactStrength = 0;
    let effect = kind;
    const dashKick = kind === 'super' || kind === 'smash';
    if (kind === 'kick' || dashKick) {
      const shot = shotFor(kind, source, { x: nx, y: ny }, floor, ball);
      ball.vx = shot.direction.x * shot.speed;
      ball.vy = shot.direction.y * shot.speed;
      struck.add(source.id);
      ball.contacts.add(source.id);
      if (dashKick) {
        ball.striker = source.id;
        source.consumeDash();
        source.dash = null;
      }
      source.kick?.consume();
      source.kick = null;
      impactStrength = shot.speed;
      effect = shot.effect;
    } else {
      const wall = kind === 'wall';
      let push = depth + 0.05;
      let pinned = false;
      const fresh = wall || !ball.contacts.has(source.id);
      if (!wall) {
        struck.add(source.id);
        ball.contacts.add(source.id);
        // Accepted player positions can start deep inside the ball. Spread that
        // correction over time and give solid pitch geometry priority.
        const raisedHead = source.standingUp && -ny > Math.abs(nx);
        const closingSpeed = Math.max(0, (source.vx - ball.vx) * nx + (source.vy - ball.vy) * ny);
        const reach = push + closingSpeed * remaining + 0.1;
        let clearance = Infinity;
        for (const rect of colliders) {
          const hit = sweepCircle(ball.x, ball.y, nx * reach, ny * reach, rect, radius);
          if (hit && faceBlocks(rect, hit, ball)) {
            clearance = Math.min(clearance, reach * hit.t);
            pinned = true;
          }
        }
        // Once squeezed, the player can overlap the ball. Switching to the
        // opposite body face mid-contact would pull it back out of the corner.
        if (pinned || !raisedHead) push = Math.min(push, rules.bodySeparationSpeed * dt);
        push = Math.min(push, clearance);
        if (clearance <= push + EPSILON) ball.pinnedBodies.add(source.id);
      }
      ball.x += nx * push;
      ball.y += ny * push;
      const cap = velocity => Math.max(-movement.dashDownSpeed, Math.min(movement.dashDownSpeed, velocity));
      const vx = wall ? 0 : cap(source.vx), vy = wall ? 0 : cap(source.vy);
      const approach = (ball.vx - vx) * nx + (ball.vy - vy) * ny;
      const floorHit = wall && ny === -1;
      if (approach < 0 && !pinned) {
        let restitution = wall ? rules.wallRestitution : rules.bodyRestitution;
        if (floorHit) {
          const hardLanding = Math.max(0, Math.min(1, (-approach - rules.hardLandingMinSpeed) /
            (rules.hardLandingFullSpeed - rules.hardLandingMinSpeed)));
          restitution = rules.floorRestitution + hardLanding * (rules.hardLandingRestitution - rules.floorRestitution);
        }
        const impulse = -(1 + (fresh ? restitution : 0)) * approach;
        ball.vx += impulse * nx;
        ball.vy += impulse * ny;
        impactStrength = fresh ? -approach : 0;
        const headWeight = -ny - Math.abs(nx);
        if (!wall && headWeight > 0) {
          // Blend into the ordinary collision response as contact rounds the corner.
          const deflection = headWeight * headDeflection(ball, source, vx, dt - remaining, fresh);
          ball.vx += deflection;
          if (fresh) impactStrength = Math.max(impactStrength, Math.abs(deflection));
        }
        if (fresh && !wall && Math.abs(nx) > 0.42 && floor - ball.y <= radius + rules.bodyLiftFloorRange) {
          const lift = Math.min(rules.bodyLiftMax, rules.bodyLift + impactStrength * 0.15);
          ball.vy = Math.min(ball.vy, -lift);
        }
      }
      // Standing up can pop a ball that overlaps the newly raised head even
      // when the player was already touching it while crouched.
      if (!wall && !pinned && source.standingUp && depth > 0 && -ny > Math.abs(nx) &&
          ball.vy > -rules.unduckLift) {
        impactStrength = Math.max(impactStrength, ball.vy + rules.unduckLift);
        ball.vy = -rules.unduckLift;
      }
      if (floorHit && Math.abs(ball.vy) < rules.settleSpeed) {
        ball.y = source.top - radius;
        ball.vy = 0;
      }
    }
    limitSpeed(ball);
    if (impactStrength > (kind === 'body' ? 28 : rules.settleSpeed)) {
      if (kind === 'wall' && /crossbar|goal-base/.test(source.id)) effect = 'post';
      onImpact(effect, {
        x: ball.x, y: ball.y, angle: kind === 'wall' ? Math.atan2(ny, nx) : Math.atan2(ball.vy, ball.vx),
        strength: impactStrength,
        ...(kind !== 'wall' && {
          contact: { x: ball.x - nx * radius, y: ball.y - ny * radius, nx, ny },
        }),
      });
    }
  }
  return null;
}

module.exports = { advanceBall, sweepCircle, shotFor, faceBlocks };
