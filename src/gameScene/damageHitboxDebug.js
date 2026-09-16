// One renderer for server-authoritative damage volumes; no sprite-size guesses.
export function installDamageHitboxDebug(scene, socket) {
  const graphics = scene.add.graphics().setDepth(100000);
  let shapes = [], receivedAt = 0;
  const receive = snapshot => {
    shapes = snapshot.damageHitboxes || [];
    receivedAt = Date.now();
  };
  const draw = () => {
    graphics.clear();
    if (!scene.physics?.world?.drawDebug || Date.now() - receivedAt > 250) return;
    graphics.lineStyle(2 / (scene.cameras.main.zoom || 1), 0xff5577, 1);
    for (const shape of shapes) {
      if (shape.kind === 'rect') {
        graphics.strokeRect(shape.left, shape.top, shape.right - shape.left, shape.bottom - shape.top);
      } else if (shape.kind === 'circle') {
        graphics.strokeCircle(shape.x, shape.y, shape.radius);
      } else if (shape.kind === 'sweep') {
        // Sweeps test a moving circle against expanded target rectangles.
        const { a, b, radius } = shape;
        graphics.strokeCircle(b.x, b.y, radius);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const dx = -Math.sin(angle) * radius, dy = Math.cos(angle) * radius;
        graphics.lineBetween(a.x + dx, a.y + dy, b.x + dx, b.y + dy);
        graphics.lineBetween(a.x - dx, a.y - dy, b.x - dx, b.y - dy);
        graphics.strokeCircle(a.x, a.y, radius);
      } else if (shape.kind === 'sector') {
        const points = [], steps = 32;
        for (let i = 0; i <= steps; i++) {
          const angle = shape.angle - shape.halfSpread + 2 * shape.halfSpread * i / steps;
          points.push({ x: shape.x + Math.cos(angle) * shape.radius, y: shape.y + Math.sin(angle) * shape.radius });
        }
        for (let i = steps; i >= 0; i--) {
          const angle = shape.angle - shape.halfSpread + 2 * shape.halfSpread * i / steps;
          points.push({ x: shape.x + Math.cos(angle) * shape.innerRadius, y: shape.y + Math.sin(angle) * shape.innerRadius });
        }
        graphics.strokePoints(points, true);
      }
    }
  };
  socket.on('game:snapshot', receive);
  scene.events.on('postupdate', draw);
  scene.events.once('shutdown', () => {
    socket.off('game:snapshot', receive);
    scene.events.off('postupdate', draw);
    graphics.destroy();
  });
}
