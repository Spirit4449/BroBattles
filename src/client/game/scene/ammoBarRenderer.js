import { PIXEL_INK, drawPixelFill, drawPixelFrame, drawPixelTrough, snapPixel } from './pixelBar';

// Shared by the match HUD and embedded character previews.
export function drawAmmoChargeBar(graphics, background, { x, y, width = 52, ammo }) {
  background.clear(); graphics.clear();
  if (!ammo) return;
  const height = 6, barX = snapPixel(x), barY = snapPixel(y);
  const capacity = Math.max(1, ammo.capacity), gap = 1;
  drawPixelFrame(background, barX, barY, width, height);
  drawPixelTrough(background, barX, barY, width, height);
  const segmentWidth = (width - gap * (capacity - 1)) / capacity;
  for (let i = 0; i < capacity; i++) {
    const segX = barX + Math.round(i * (segmentWidth + gap));
    const nextX = barX + Math.round((i + 1) * (segmentWidth + gap)) - gap;
    const percent = i < ammo.charges ? 1 : i === ammo.charges
      ? Math.max(0, Math.min(1, ammo.reloadTimerMs / ammo.reloadMs)) : 0;
    if (percent > 0) drawPixelFill(graphics, segX, barY, (nextX - segX) * percent, height, percent >= 1 ? 0xff4040 : 0xa82424);
    if (i > 0) { graphics.fillStyle(PIXEL_INK, 1); graphics.fillRect(segX - gap, barY, gap, height); }
  }
  graphics.setDepth(41); background.setDepth(40);
}
