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
module.exports = { sweepMovement };
