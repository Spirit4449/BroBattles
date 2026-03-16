export function rectsOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

export function circleRectOverlap(cx, cy, radius, bx1, by1, bx2, by2) {
  const closestX = Phaser.Math.Clamp(cx, bx1, bx2);
  const closestY = Phaser.Math.Clamp(cy, by1, by2);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function getSpriteBounds(sprite) {
  if (!sprite) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    };
  }

  if (sprite.body) {
    const left = Number(sprite.body.x) || 0;
    const top = Number(sprite.body.y) || 0;
    const width = Number(sprite.body.width) || 0;
    const height = Number(sprite.body.height) || 0;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
    };
  }

  const halfW = (Number(sprite.displayWidth) || Number(sprite.width) || 0) / 2;
  const halfH =
    (Number(sprite.displayHeight) || Number(sprite.height) || 0) / 2;
  return {
    left: (Number(sprite.x) || 0) - halfW,
    top: (Number(sprite.y) || 0) - halfH,
    right: (Number(sprite.x) || 0) + halfW,
    bottom: (Number(sprite.y) || 0) + halfH,
  };
}
