import { PIXEL_FX_SIZE, fillPixelBlob, pixelBlobDepthAt, rasterizePixelBlob } from "./pixelShapes";

// Shell depth in cells: the outline plus the glassy bands inside it.
const RIM_CELLS = 4;
const SHELL_CELLS = 7;
const SHELL_SHADES = [0x7d8494, 0xb4bac6, 0xe4e8ef];

// Shared pixel-art shell for spawn protection and Draven's Inferno shield,
// rasterized onto the same world grid as the powerup membranes.
export function drawShieldBubble(g, spr, { x, y, radius: r }, nowSec, remainingMs, reflections) {
  const breathe = 0.5 + 0.5 * Math.sin(nowSec * 2.4);
  const shieldRadius = Math.max(24, r + 11 + breathe * 1.2);
  const opacity = Math.min(1, remainingMs / 180);

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

  const points = [];
  for (let i = 0; i < 36; i += 1) {
    const a = (i / 36) * Math.PI * 2;
    points.push({ x: x + Math.cos(a) * shieldRadius, y: y + Math.sin(a) * shieldRadius });
  }
  const blob = rasterizePixelBlob(points, { ringCount: RIM_CELLS + SHELL_CELLS });
  // One-cell dark line just outside the rim so the bubble reads on bright maps.
  const outline = rasterizePixelBlob(points, { ringCount: 1, grow: PIXEL_FX_SIZE * 2 });
  // 0 at the lower-right, 1 at the upper-left.
  const lightAt = (cx, cy) => (1 + Math.cos(Math.atan2(cy - y, cx - x) - Math.PI * 1.25)) / 2;
  const angleIn = (cx, cy, start, end) => {
    let a = Math.atan2(cy - y, cx - x) - drift;
    if (a < 0) a += Math.PI * 2;
    return a >= start && a <= end;
  };

  // Mostly clear centre; the volume lives in banded shading near the rim.
  fillPixelBlob(g, blob, 0xffffff, (0.12 + breathe * 0.02) * opacity, (d) => d > RIM_CELLS);
  for (let band = 1; band <= SHELL_CELLS; band += 1) {
    const depth = RIM_CELLS + band;
    const fade = 1 - (band - 1) / SHELL_CELLS;
    SHELL_SHADES.forEach((shade, level) => {
      const alpha = (0.22 + Math.abs(level - 1) * 0.2) * fade * opacity;
      fillPixelBlob(g, blob, shade, alpha, (d, cx, cy) =>
        d === depth && Math.min(2, Math.floor(lightAt(cx, cy) * 3)) === level,
      );
    });
  }

  // Stepped rim, lit at the upper-left and shaded at the lower-right.
  fillPixelBlob(g, outline, 0x1c2230, 0.4 * opacity, (d, cx, cy) =>
    d === 1 && pixelBlobDepthAt(blob, cx, cy) === 0,
  );
  fillPixelBlob(g, blob, 0xc9ced8, 0.92 * opacity, (d) => d <= RIM_CELLS);
  fillPixelBlob(g, blob, 0xffffff, (0.92 + breathe * 0.08) * opacity, (d, cx, cy) =>
    d <= 2 && lightAt(cx, cy) > 0.35,
  );
  fillPixelBlob(g, blob, 0x5f6675, 0.6 * opacity, (d, cx, cy) =>
    d <= 2 && lightAt(cx, cy) < 0.15,
  );
  fillPixelBlob(g, blob, 0xffffff, 0.5 * opacity, (d) => d === RIM_CELLS);

  // Curved reflection streaks that slide around the shell with movement.
  fillPixelBlob(g, blob, 0xffffff, 0.95 * opacity, (d, cx, cy) =>
    d === RIM_CELLS + 2 && angleIn(cx, cy, Math.PI * 1.14, Math.PI * 1.6),
  );
  fillPixelBlob(g, blob, 0xffffff, 0.45 * opacity, (d, cx, cy) =>
    d === RIM_CELLS + 3 && angleIn(cx, cy, Math.PI * 1.1, Math.PI * 1.66),
  );
  fillPixelBlob(g, blob, 0xffffff, 0.6 * opacity, (d, cx, cy) =>
    d === RIM_CELLS + 1 && angleIn(cx, cy, Math.PI * 0.12, Math.PI * 0.36),
  );

  // Blocky specular glint, snapped to the grid.
  const cell = PIXEL_FX_SIZE;
  const snap = (value) => Math.round(value / cell) * cell;
  const shineX = snap(x - shieldRadius * (0.4 + shine.dx * 0.09));
  const shineY = snap(y - shieldRadius * (0.64 + shine.dy * 0.07));
  const shineCells = Math.max(3, Math.round((shieldRadius * 0.26) / cell));
  g.fillStyle(0xffffff, 0.9 * opacity);
  g.fillRect(shineX + cell, shineY, shineCells * cell, cell);
  g.fillRect(shineX, shineY + cell, cell, cell * 2);
  g.fillStyle(0xffffff, 0.45 * opacity);
  g.fillRect(shineX + cell, shineY + cell, Math.ceil(shineCells / 2) * cell, cell);
}
