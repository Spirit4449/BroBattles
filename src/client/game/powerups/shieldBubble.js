// Shared spherical shell for spawn protection and Draven's Inferno shield.
export function drawShieldBubble(g, spr, { x, y, radius: r }, nowSec, remainingMs, reflections) {
  const breathe = 0.5 + 0.5 * Math.sin(nowSec * 2.4);
  const shieldRadius = Math.max(22, r + 9 + breathe * 1.2);
  const opacity = Math.min(1, remainingMs / 180);
  // Shade the curved shell from upper-left light to lower-right shadow.
  // Keep the center clear; most of the volume lives near the silhouette.
  g.fillStyle(0xffffff, (0.1 + breathe * 0.015) * opacity);
  g.fillCircle(x, y, shieldRadius);
  const shellWidth = Math.min(23, shieldRadius * 0.44);
  for (let segment = 0; segment < 48; segment += 1) {
    const start = segment / 48 * Math.PI * 2;
    const end = (segment + 1) / 48 * Math.PI * 2;
    const light = (1 + Math.cos((start + end) / 2 - Math.PI * 1.25)) / 2;
    const shade = Math.round(125 + 130 * light);
    const shellColor = (shade << 16) | (shade << 8) | shade;
    for (let band = 0; band < 4; band += 1) {
      const outer = shieldRadius - band * shellWidth / 4;
      const inner = outer - shellWidth / 4;
      g.fillStyle(shellColor,
        (0.18 + Math.abs(light - 0.5) * 0.72) *
        (1 - band / 4) * opacity);
      g.beginPath();
      g.moveTo(x + Math.cos(start) * outer, y + Math.sin(start) * outer);
      g.lineTo(x + Math.cos(end) * outer, y + Math.sin(end) * outer);
      g.lineTo(x + Math.cos(end) * inner, y + Math.sin(end) * inner);
      g.lineTo(x + Math.cos(start) * inner, y + Math.sin(start) * inner);
      g.closePath();
      g.fillPath();
    }
  }
  g.lineStyle(9, 0xffffff, 0.09 * opacity);
  g.strokeCircle(x, y, shieldRadius);
  g.lineStyle(5.5, 0xbfc3cb, 0.68 * opacity);
  g.strokeCircle(x, y, shieldRadius);
  g.lineStyle(3.5, 0xffffff, (0.92 + breathe * 0.06) * opacity);
  g.strokeCircle(x - 0.7, y - 0.9, shieldRadius);

  // Track rendered movement so local and interpolated remote players both
  // shift the reflection, easing it back into place when they stop.
  let shine = reflections.get(spr);
  if (!shine || nowSec - shine.time > 0.2) {
    shine = { x, y, time: nowSec, dx: 0, dy: 0 };
    reflections.set(spr, shine);
  }
  const dt = Math.max(1 / 240, nowSec - shine.time);
  const blend = 1 - Math.exp(-dt * 12);
  shine.dx += (Math.max(-1, Math.min(1, (x - shine.x) / dt / 260)) - shine.dx) * blend;
  shine.dy += (Math.max(-1, Math.min(1, (y - shine.y) / dt / 360)) - shine.dy) * blend;
  shine.x = x;
  shine.y = y;
  shine.time = nowSec;
  const drift = shine.dx * 0.2 - shine.dy * 0.12;
  const reflection = (radius, start, end, width, alpha) => {
    g.lineStyle(width, 0xffffff, alpha * opacity);
    g.beginPath();
    g.arc(x, y, radius, start + drift, end + drift);
    g.strokePath();
  };
  reflection(shieldRadius, Math.PI * 1.04, Math.PI * 1.7, 4.5, 1);
  reflection(shieldRadius - 7, Math.PI * 1.12, Math.PI * 1.65, 8, 0.25);
  reflection(shieldRadius - 6, Math.PI * 1.16, Math.PI * 1.59, 4, 0.95);
  reflection(shieldRadius - 12, Math.PI * 1.24, Math.PI * 1.48, 2.5, 0.6);
  reflection(shieldRadius - 4, Math.PI * 0.12, Math.PI * 0.37, 2.5, 0.65);
  const shineX = x - shieldRadius * (0.3 + shine.dx * 0.09);
  const shineY = y - shieldRadius * (0.47 + shine.dy * 0.07);
  g.fillStyle(0xffffff, 0.65 * opacity);
  g.fillEllipse(shineX, shineY, shieldRadius * 0.3, shieldRadius * 0.11);
  g.fillStyle(0xffffff, 0.9 * opacity);
  g.fillEllipse(shineX - shieldRadius * 0.025, shineY - shieldRadius * 0.012,
    shieldRadius * 0.19, shieldRadius * 0.045);
}
