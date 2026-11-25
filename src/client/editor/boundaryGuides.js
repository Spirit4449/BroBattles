// Hit-test outlines in world units, with a constant screen-pixel tolerance.
function boundaryHints(point, arena, colliders, zoom) {
  const pad = 6 / zoom;
  const nearEdge = ({ x, y, width, height }) =>
    point.x >= x - pad && point.x <= x + width + pad &&
    point.y >= y - pad && point.y <= y + height + pad &&
    Math.min(Math.abs(point.x - x), Math.abs(point.x - x - width),
      Math.abs(point.y - y), Math.abs(point.y - y - height)) <= pad;
  const hints = [];
  if (nearEdge(arena.world)) hints.push('Physics world (blue-gray): the world boundary used by physics. Art does not need to end here.');
  if (nearEdge(arena.camera)) hints.push('Camera bounds (yellow): limits for the moving game camera, not the current screen view or a collision wall.');
  for (const c of colliders) {
    if (nearEdge({ x: c.left, y: c.top, width: c.right - c.left, height: c.bottom - c.top }))
      hints.push(`Collision hitbox: ${c.id}. Align collision faces with playable surfaces, not decorative image edges.`);
  }
  const w = arena.world;
  if (Math.abs(point.x - w.x - w.width / 2) <= pad && point.y >= w.y && point.y <= w.y + w.height)
    hints.push('World center (green): alignment guide only; no collision.');
  return hints;
}

module.exports = { boundaryHints };
