// Actors are buffered; combat remains on the current server timeline so hit
// feedback is not delayed. Bridge a fresh remote launch from its displayed
// actor to the authoritative flight path, then converge over 100 ms.
function remoteLaunchCorrection(actor, origin, ageMs, now) {
  if (!actor || !origin || ageMs < 0 || ageMs > 120) return null;
  const x = actor.x - origin.x, y = actor.y - origin.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 200) return null;
  return { x, y, at: now, duration: 100 };
}
module.exports = { remoteLaunchCorrection };
