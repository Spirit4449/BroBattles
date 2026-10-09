// What a shot can touch, shared by the server's projectile runtimes and the
// shooter's predicted contacts against displayed actors. Both sides must agree
// on boxes and collision centres, or a predicted hit becomes a visible miss.
const { characterBody } = require('../physics/characterBody');
const { DUCK_HEIGHT_RATIO } = require('../physics/ducking');
const { sweep, insetBounds } = require('../characters/huntressProjectile');

// The same box the server derives from a player's position (updateBodyGeometry).
function characterHitBounds(character, x, y, { flip = false, ducking = false } = {}) {
  const body = characterBody(character, flip);
  const height = body.height * (ducking ? DUCK_HEIGHT_RATIO : 1);
  const cx = Number(x) + body.offsetX;
  const cy = Number(y) + body.offsetY + (body.height - height) / 2;
  return { left: cx - body.halfWidth, right: cx + body.halfWidth, top: cy - height / 2, bottom: cy + height / 2 };
}

function circleAabbOverlap(cx, cy, radius, bounds) {
  const nearestX = Math.max(bounds.left, Math.min(Number(cx), bounds.right));
  const nearestY = Math.max(bounds.top, Math.min(Number(cy), bounds.bottom));
  return Math.hypot(Number(cx) - nearestX, Number(cy) - nearestY) <= radius;
}

function attackCollisionCenter(attack, runtime = {}) {
  const angle = Number(attack?.angle) || 0;
  let forwardOffset = Number.isFinite(Number(attack?.collisionForwardOffset))
    ? Number(attack.collisionForwardOffset)
    : Number(runtime?.collisionForwardOffset) || 0;
  // A rearward art-center correction must never put a new projectile's damage
  // behind its launch point. Hold it at the muzzle until travel exceeds the
  // configured correction, then preserve the requested offset in flight.
  if (forwardOffset < 0 && Number.isFinite(Number(attack?.traveled))) {
    forwardOffset = Math.max(forwardOffset, -Math.max(0, Number(attack.traveled)));
  }
  return {
    x: (Number(attack?.x) || 0) + Math.cos(angle) * forwardOffset,
    y:
      (Number(attack?.y) || 0) +
      Math.sin(angle) * forwardOffset +
      (Number(attack?.collisionOffsetY) || Number(runtime?.collisionOffsetY) || 0),
  };
}

// Earliest target a circle of `radius` touches moving from a to b. Targets are
// { name, bounds, inset? }; `inset` applies Huntress's body inset to players
// (objects such as vaults opt out with inset: false). Names break ties so every
// client resolves the same target.
function firstTargetContact(a, b, radius, targets, { inset = false, skip = null } = {}) {
  let hit = null;
  for (const target of targets) {
    if (skip?.has(target.name)) continue;
    const bounds = inset && target.inset !== false ? insetBounds(target.bounds) : target.bounds;
    const t = sweep(a, b, bounds, radius);
    if (t === null) continue;
    if (!hit || t < hit.t || (t === hit.t && target.name < hit.target.name)) hit = { t, target, bounds };
  }
  return hit && { ...hit, x: a.x + (b.x - a.x) * hit.t, y: a.y + (b.y - a.y) * hit.t };
}

module.exports = { characterHitBounds, circleAabbOverlap, attackCollisionCenter, firstTargetContact };
