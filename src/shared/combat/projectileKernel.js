const { FIXED_DT_MS: STEP_MS } = require('../gameConstants');

// Segment against axis-aligned colliders: entry time and entry face normal.
function wallContact(a, b, rects) {
  let best = null;
  for (const rect of rects) {
    let lo = 0, hi = 1, normal = { x: 0, y: 0 }, miss = false;
    for (const [origin, delta, min, max, axis] of [[a.x, b.x - a.x, rect.left, rect.right, 'x'], [a.y, b.y - a.y, rect.top, rect.bottom, 'y']]) {
      if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) miss = true; continue; }
      const u = (min - origin) / delta, v = (max - origin) / delta;
      if (Math.min(u, v) > lo) {
        lo = Math.min(u, v);
        normal = axis === 'x' ? { x: delta > 0 ? -1 : 1, y: 0 } : { x: 0, y: delta > 0 ? -1 : 1 };
      }
      hi = Math.min(hi, Math.max(u, v));
    }
    if (!miss && lo <= hi && (!best || lo < best.t)) best = { t: lo, normal, collider: rect.id ?? null };
  }
  return best && { ...best, x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t };
}

module.exports = { STEP_MS, wallContact };
