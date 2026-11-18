import { drawPixelRing, fillPixelEllipse, PIXEL_FX_SIZE } from "../../scene/fx/pixelShapes";

function snapToPixel(value) {
  return Math.round(value / PIXEL_FX_SIZE) * PIXEL_FX_SIZE;
}

// Downward pixel arrow: a short shaft over a stepped triangular head.
function drawPixelDownArrow(g, x, y, headColor, shaftColor) {
  const cell = PIXEL_FX_SIZE;
  g.fillStyle(shaftColor, 0.75);
  g.fillRect(x - cell, y - cell * 5, cell * 2, cell * 5);
  g.fillStyle(headColor, 0.9);
  const headRows = 7;
  for (let row = 0; row < headRows; row += 1) {
    const half = Math.max(1, Math.round(((headRows - row) / headRows) * 3)) * cell;
    g.fillRect(x - half, y + row * cell, half * 2, cell);
  }
}

export function drawSlowAura({ graphics: g, effects: fx, x, y, r, pulse, frame, nowSec }) {
  const slime = (fx.gloopSlimeSlow || 0) > 0;
  const slowColor = slime ? 0x12bbaa : 0x54c7ff;
  if (slime) {
    fillPixelEllipse(g, x, frame.bottom - 2, r * 1.8, 9, 0x0868b6, 0.55);
    const cell = PIXEL_FX_SIZE;
    for (let i = 0; i < 7; i++) {
      const sx = snapToPixel(x + (i - 3) * r * 0.23 + Math.sin(i) - cell);
      const sy = snapToPixel(y - r * 0.45 + Math.sin(i * 2.4) * r * 0.28);
      const length = snapToPixel(8 + 11 * (0.5 + 0.5 * Math.sin(nowSec * 3 + i)));
      g.fillStyle(0x12bbaa, 0.8);
      g.fillRect(sx, sy, cell * 2, length);
      g.fillRect(sx + cell * 0.5, sy + length, cell, cell);
      g.fillStyle(0x99e9c9, 0.65);
      g.fillRect(sx, sy + cell, cell, cell * 2);
    }
  }
  drawPixelRing(g, x, y, Math.max(16, r + 5 + 4 * pulse), {
    fillColor: slowColor,
    fillAlpha: 0.16 + 0.06 * pulse,
    lineColor: 0xa6e8ff,
    lineAlpha: 0.8 * pulse,
  });

  const arrowCount = 3;
  const arrowTop = frame.top - 18 - 5 * pulse;
  const spacing = 14;
  for (let i = 0; i < arrowCount; i += 1) {
    const ax = snapToPixel(x + (i - 1) * spacing);
    const ay = snapToPixel(arrowTop - Math.sin(nowSec * 7 + i * 0.9) * 3);
    drawPixelDownArrow(g, ax, ay, slime ? 0x25cbb4 : 0x7ad9ff, 0xc9f3ff);
  }
}
