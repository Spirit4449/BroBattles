const PIXEL = 3;
const SHED_EVERY_MS = 14;
const TRAIL_LIFETIME_MS = 100;

// Draw in flight space (+x forward) and keep the leading edge attached to the shot.
export function createProjectileComet(scene, sprite, {
  nose, radius, tail, color, trailThickness = 1.5, brightness = 1,
}) {
  const bow = scene.add.graphics().setDepth(sprite.depth - 0.1).setVisible(false);
  const front = Math.round(nose / PIXEL) * PIXEL;
  const rows = Math.round(radius / PIXEL);
  const shoulder = front - (rows - 1) * PIXEL;
  const edgeWidth = Math.max(PIXEL, trailThickness);
  const trailAlpha = Math.min(1, 0.43 * brightness);
  let startedAt;

  sprite.once('destroy', () => bow.destroy());
  return {
    update(angle, speed, now) {
      startedAt ??= now;
      const elapsed = Math.max(0, now - startedAt);
      const wakeLength = tail + Math.min(tail * 1.5, speed * 0.045);
      const sweep = (shoulder + wakeLength) / TRAIL_LIFETIME_MS;
      bow.setPosition(sprite.x, sprite.y).setRotation(angle).setVisible(true).clear();

      // Connect successive pixels into thin rails that taper and fade as
      // they sweep inward toward the flight path.
      for (const side of [-1, 1]) {
        const laneTime = elapsed - (side > 0 ? SHED_EVERY_MS / 2 : 0);
        const y = (side < 0 ? -rows : rows - 1) * PIXEL;
        for (let age = laneTime % SHED_EVERY_MS; age <= laneTime && age < TRAIL_LIFETIME_MS; age += SHED_EVERY_MS) {
          const progress = age / TRAIL_LIFETIME_MS;
          const x = shoulder - Math.round(age * sweep / PIXEL) * PIXEL;
          const nextX = shoulder - Math.round(Math.max(0, age - SHED_EVERY_MS) * sweep / PIXEL) * PIXEL;
          const width = Math.max(PIXEL, nextX - x);
          const thickness = trailThickness * (progress < 0.45 ? 1 : 2 / 3);
          const drift = Math.round(progress * (rows - 1)) * -side * PIXEL;
          const centerY = y + drift + PIXEL / 2;
          bow.fillStyle(color, trailAlpha * (1 - progress)).fillRect(x - PIXEL, centerY - thickness / 2, width, thickness);
        }
      }

      // Draw the stepped bow over the newest pixels to connect it to the wake.
      for (let row = -rows; row < rows; row++) {
        const arc = Math.abs(row + 0.5) / rows;
        const x = front - Math.round(arc * arc * rows) * PIXEL;
        const y = row * PIXEL;
        const width = arc < 0.4 ? 1.5 * edgeWidth : edgeWidth;
        bow.fillStyle(color, 0.09 * brightness).fillRect(x + width, y, PIXEL, PIXEL);
        bow.fillStyle(color, Math.min(1, (0.66 - arc * 0.38) * brightness)).fillRect(x, y, width, PIXEL);
        if (arc < 0.4) {
          bow.fillStyle(0xfff8e8, Math.min(1, 0.46 * brightness)).fillRect(x + edgeWidth, y, edgeWidth / 2, PIXEL);
        }
      }
    },
    hide() {
      bow.setVisible(false);
      startedAt = undefined;
    },
  };
}
