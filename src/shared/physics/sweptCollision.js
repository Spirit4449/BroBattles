// Continuous AABB collision: find the first enabled face along the complete
// movement segment, then slide the remaining distance along that face.
function sweepMovement(rect, dx, dy, surfaces) {
  let x = rect.x, y = rect.y;
  const hits = { left: false, right: false, up: false, down: false };
  for (let pass = 0; pass < 3 && (dx || dy); pass++) {
    let earliest = 1, faces = [];
    for (const s of surfaces) {
      if (s.enable === false || s.enabled === false || s.checkCollision?.none || s.collision?.none) continue;
      const c = s.checkCollision || s.collision || {};
      const left = s.left ?? s.x, top = s.top ?? s.y;
      const right = s.right ?? left + s.width, bottom = s.bottom ?? top + s.height;
      const candidates = [];
      if (dx > 0 && x + rect.width <= left + 1e-6 && c.left !== false) candidates.push([(left - x - rect.width) / dx, 'right']);
      if (dx < 0 && x >= right - 1e-6 && c.right !== false) candidates.push([(right - x) / dx, 'left']);
      if (dy > 0 && y + rect.height <= top + 1e-6 && c.up !== false) candidates.push([(top - y - rect.height) / dy, 'down']);
      if (dy < 0 && y >= bottom - 1e-6 && c.down !== false) candidates.push([(bottom - y) / dy, 'up']);
      for (const [rawTime, face] of candidates) {
        if (rawTime < -1e-6 || rawTime > earliest + 1e-8 || rawTime > 1) continue;
        const time = Math.max(0, rawTime);
        const px = x + dx * time, py = y + dy * time;
        const horizontal = face === 'left' || face === 'right';
        // Strict overlap keeps travel along a floor/wall from catching its edge.
        const overlaps = horizontal ? py + rect.height > top + 1e-7 && py < bottom - 1e-7
          : px + rect.width > left + 1e-7 && px < right - 1e-7;
        // Exact diagonal corner entry must still block both axes.
        const corner = horizontal ? dy && py + dy * 1e-6 + rect.height > top && py + dy * 1e-6 < bottom
          : dx && px + dx * 1e-6 + rect.width > left && px + dx * 1e-6 < right;
        if (!overlaps && !corner) continue;
        if (time < earliest - 1e-8) faces = [];
        earliest = time;
        faces.push(face);
      }
    }
    x += dx * earliest; y += dy * earliest;
    if (!faces.length) break;
    dx *= 1 - earliest; dy *= 1 - earliest;
    for (const face of faces) {
      hits[face] = true;
      if (face === 'left' || face === 'right') dx = 0; else dy = 0;
    }
  }
  return { x, y, hits };
}
// The way out of a surface a body has ended up inside that a wall would have
// produced. Only faces the body crossed since `before` (its rect at the start
// of the step, relative to the surface's current position) can stop it, and
// only if that face collides, so passing up through an open underside is not
// turned into a shove out of a side. A body that crossed a side with its feet
// within `stepUp` of the top may step onto the top instead. Rects are edge
// rects. Returns { dx, dy, face }, where face is the side of the body that was
// blocked, or null when the body did not cross a colliding face.
function resolveOverlap(body, surface, stepUp, before) {
  const c = surface.checkCollision || surface.collision || {};
  const edge = 0.5;
  const fromLeft = before.right <= surface.left + edge, fromRight = before.left >= surface.right - edge;
  const exits = [
    c.left !== false && fromLeft && { dx: surface.left - body.right, dy: 0, face: 'right' },
    c.right !== false && fromRight && { dx: surface.right - body.left, dy: 0, face: 'left' },
    c.down !== false && before.top >= surface.bottom - edge && { dx: 0, dy: surface.bottom - body.top, face: 'up' },
    c.up !== false && (before.bottom <= surface.top + edge ||
      ((fromLeft || fromRight) && body.bottom - surface.top <= stepUp)) &&
      { dx: 0, dy: surface.top - body.bottom, face: 'down' },
  ].filter(Boolean);
  exits.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - Math.abs(b.dx) - Math.abs(b.dy));
  return exits[0] || null;
}
module.exports = { sweepMovement, resolveOverlap };
