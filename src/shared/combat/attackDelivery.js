// How an attack reaches its target decides how it is networked. Every attack
// runtime belongs to one delivery, and the delivery owns the policy shared by
// the server and the attacker's client (docs/development/networking.md, "Attack
// delivery"). A character supplies data and, for attached attacks, a shape over
// time; it never writes its own netcode.
const { characterBody } = require('../physics/characterBody');
const { sweep } = require('../characters/huntressProjectile');
const { sampleThorgHitbox, THORG_SWEEP } = require('../characters/thorgSweep');

const DELIVERIES = Object.freeze({
  // The hitbox moves with the attacker: swings, sweeps, cones. Targets are
  // tested where the attacker saw them, within a shorter cap than shots so a
  // dodge still counts for the victim at high latency.
  attached: Object.freeze({ rewindCapMs: 150, predict: true, hitstopMs: 70, attackerHitstop: true }),
  // Something flies on its own: projectiles, returning shots, hooks. The
  // offset between the shot and the actors it was aimed at holds for the
  // whole flight.
  released: Object.freeze({ rewindCapMs: 300, predict: true, hitstopMs: 35, attackerHitstop: false }),
  // A warned area that resolves later. The target had time to react, so it is
  // tested where it is now (favor the target), and nothing is predicted.
  area: Object.freeze({ rewindCapMs: 0, predict: false, hitstopMs: 0, attackerHitstop: false }),
  // Effects on the user only: buffs, dashes.
  self: Object.freeze({ rewindCapMs: 0, predict: false, hitstopMs: 0, attackerHitstop: false }),
});

const RUNTIME_DELIVERY = Object.freeze({
  'attached-rect': 'attached',
  'attached-cone': 'attached',
  'attached-charge': 'attached',
  'path-rect': 'attached',
  'projectile-linear': 'released',
  'projectile-bounce': 'released',
  'returning-projectile': 'released',
  'hook-projectile': 'released',
});

function deliveryOf(runtimeKind) {
  return RUNTIME_DELIVERY[String(runtimeKind || '').toLowerCase()] || null;
}

function deliveryPolicy(delivery) {
  return DELIVERIES[delivery] || DELIVERIES.area;
}

// Bounds a view rewind to what the attack's delivery allows.
function clampDeliveryRewind(delivery, ms) {
  const value = Number(ms);
  return Number.isFinite(value) ? Math.max(0, Math.min(deliveryPolicy(delivery).rewindCapMs, value)) : 0;
}

// --- Attached shapes -------------------------------------------------------
// Pure functions of the attacker's pose and the time since the attack started.
// The server tests them against targets at the attacker's view; the attacker's
// client tests the same shapes against enemies as drawn.
//
// pose: { x, y, flip, height, scale = 1, legacy = false }; `height` is the body's
// display height (attackerPose).
// Shapes: { kind: 'rect', left, right, top, bottom }
//         { kind: 'capsule', a, b, radius }
//         { kind: 'sector', x, y, radius, innerRadius, angle, halfSpread }

// The pose a client draws its own character in, matching the server's.
function attackerPose(character, x, y, { flip = false, scale = 1, legacy = false } = {}) {
  return { x: Number(x), y: Number(y), flip: !!flip, scale, legacy,
    height: characterBody(character, !!flip).displayHeight };
}

function attachedRectShape(pose, runtime, elapsedMs) {
  const totalMs = Math.max(1, Number(runtime.activeWindowMs) || 1);
  const sampleMs = Math.min(elapsedMs, totalMs);
  if (sampleMs < Math.max(0, Number(runtime.damageStartMs) || 0)) return [];
  const direction = pose.flip ? -1 : 1;
  const width = Number(runtime.width) || 1;
  const height = Number(runtime.height) || 1;
  const minHeight = Math.max(1, Number(runtime.minHeight) || 1);
  const cx = Number(pose.x) + direction * (Number(runtime.tipOffset) || 0);
  const baseCenterY = Number(pose.y) - (Number(pose.height) || 120) * (Number(runtime.centerYFactor) || 0);
  const growT = Math.min(1, sampleMs / Math.max(1, Number(runtime.growDurationMs) || 1));
  const currentHeight = minHeight + (height - minHeight) * growT;
  const bottom = baseCenterY + height / 2;
  return [{ kind: 'rect', left: cx - width / 2, right: cx + width / 2, top: bottom - currentHeight, bottom }];
}

// Thorg's sweep between two progress values, subsampled so that neither side
// tunnels through a target after a long frame.
function pathSweepShapes(pose, direction, fromProgress, toProgress) {
  const steps = Math.max(1, Math.ceil((toProgress - fromProgress) * 96));
  const body = { x: Number(pose.x), y: Number(pose.y), direction, scale: pose.scale || 1, legacy: !!pose.legacy };
  const shapes = [];
  for (let i = 0; i <= steps; i++) {
    const hitbox = sampleThorgHitbox(body, fromProgress + (toProgress - fromProgress) * i / steps);
    shapes.push({ kind: 'capsule', a: hitbox.a, b: hitbox.b, radius: hitbox.radius });
  }
  return shapes;
}

function pathSweepProgress(elapsedMs) {
  if (elapsedMs < THORG_SWEEP.windupMs) return null;
  return Math.min(1, (elapsedMs - THORG_SWEEP.windupMs) / THORG_SWEEP.strikeMs);
}

function sectorShape(anchor, attack) {
  return { kind: 'sector', x: anchor.x, y: anchor.y, radius: attack.radius, innerRadius: attack.innerRadius,
    angle: attack.angle, halfSpread: attack.halfSpread };
}

function normalizeAngleDelta(a, b) {
  let delta = a - b;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

// Whether a shape touches an axis-aligned box. `reach` widens sectors for
// players, whose box is tested at its centre.
function shapeTouches(shape, bounds, { reach = 0 } = {}) {
  if (!shape || !bounds) return false;
  if (shape.kind === 'rect') {
    return shape.left <= bounds.right && shape.right >= bounds.left &&
      shape.top <= bounds.bottom && shape.bottom >= bounds.top;
  }
  if (shape.kind === 'capsule') return sweep(shape.a, shape.b, bounds, shape.radius) !== null;
  if (shape.kind === 'sector') {
    const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
    const dist = Math.hypot(cx - shape.x, cy - shape.y);
    if (dist < shape.innerRadius || dist > shape.radius + reach) return false;
    return Math.abs(normalizeAngleDelta(Math.atan2(cy - shape.y, cx - shape.x), shape.angle)) <= shape.halfSpread;
  }
  return false;
}

module.exports = { DELIVERIES, RUNTIME_DELIVERY, deliveryOf, deliveryPolicy, clampDeliveryRewind,
  attackerPose, attachedRectShape, pathSweepShapes, pathSweepProgress, sectorShape, shapeTouches, normalizeAngleDelta };
