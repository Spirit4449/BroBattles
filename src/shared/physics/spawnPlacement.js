// Coordinates describe a landing surface, never an arbitrary sprite center.
function resolveLanding(point, anchor, colliders, body) {
  const surfaces = colliders.filter(p => p.enabled !== false && p.collision?.none !== true && p.collision?.up !== false && p.right - p.left >= body.width + 4);
  if (!surfaces.length) throw new Error('Map has no walkable spawn surface');
  const x = Number.isFinite(point?.x) ? point.x : (anchor ? (anchor.left + anchor.right) / 2 : (surfaces[0].left + surfaces[0].right) / 2) + (point?.dx || 0);
  const y = Number.isFinite(point?.y) ? point.y : anchor?.top ?? surfaces[0].top;
  const clampX = p => Math.max(p.left + body.width / 2 + 2, Math.min(p.right - body.width / 2 - 2, x));
  const clear = p => {
    const cx = clampX(p);
    return !colliders.some(q => q !== p && q.enabled !== false && q.collision?.none !== true && cx + body.width / 2 > q.left && cx - body.width / 2 < q.right && p.top - 2 > q.top && p.top - body.height - 2 < q.bottom);
  };
  const ranked = surfaces.filter(clear).sort((a, b) => {
    const score = p => Math.abs(clampX(p) - x) * 4 + Math.abs(p.top - y);
    return score(a) - score(b);
  });
  const surface = ranked.includes(anchor) ? anchor : ranked[0];
  if (!surface) throw new Error('Spawn has no clear landing space');
  return { x: clampX(surface), y: surface.top - 2, surface };
}
module.exports = { resolveLanding };
