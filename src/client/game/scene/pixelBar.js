// Shared drawing for the fighter bars (health, ammo, super). Everything is
// hard-edged rectangles on whole pixels so the bars read as pixel art: a
// stepped ink frame with clipped corners, flat fills, and 1px bevel bands.
export const PIXEL_INK = 0x0c0a14;

// Bars sit above sprites that move on subpixels; snap so edges stay crisp.
export function snapPixel(value) {
  return Math.round(value);
}

// A rectangle with each corner pixel step removed.
export function fillNotchedRect(graphics, x, y, width, height, step = 1) {
  if (width <= 0 || height <= 0) return;
  const notch = Math.min(step, Math.floor(width / 2), Math.floor(height / 2));
  graphics.fillRect(x + notch, y, width - notch * 2, height);
  graphics.fillRect(x, y + notch, width, height - notch * 2);
}

export function drawPixelFrame(graphics, x, y, width, height, {
  ink = PIXEL_INK, thickness = 2, alpha = 1,
} = {}) {
  graphics.fillStyle(ink, alpha);
  fillNotchedRect(graphics, x - thickness, y - thickness,
    width + thickness * 2, height + thickness * 2, thickness);
}

// Stepped halo: blocky rings instead of a soft rounded glow.
export function drawPixelGlow(graphics, x, y, width, height, color, strength = 1) {
  for (const [spread, alpha] of [[6, 0.14], [4, 0.24], [3, 0.4]]) {
    graphics.fillStyle(color, strength * alpha);
    fillNotchedRect(graphics, x - spread, y - spread,
      width + spread * 2, height + spread * 2, spread - 1);
  }
}

// Flat fill with a lighter top band and darker bottom band.
export function drawPixelFill(graphics, x, y, width, height, color, alpha = 1) {
  const w = Math.round(width);
  if (w <= 0) return;
  graphics.fillStyle(color, alpha);
  graphics.fillRect(x, y, w, height);
  if (height < 3) return;
  graphics.fillStyle(shade(color, 0.45), alpha);
  graphics.fillRect(x, y, w, 1);
  graphics.fillStyle(shade(color, -0.35), alpha);
  graphics.fillRect(x, y + height - 1, w, 1);
}

// Inset trough the fill sits in; its top row is a shadow line.
export function drawPixelTrough(graphics, x, y, width, height, color = 0x2a2633, alpha = 1) {
  graphics.fillStyle(color, alpha);
  graphics.fillRect(x, y, width, height);
  graphics.fillStyle(shade(color, -0.4), alpha);
  graphics.fillRect(x, y, width, 1);
}

// Divider marks splitting a bar into `count` equal cells, drawn over the fill.
export function drawPixelTicks(graphics, x, y, width, height, count, alpha = 0.45) {
  if (count < 2) return;
  graphics.fillStyle(PIXEL_INK, alpha);
  for (let i = 1; i < count; i++) {
    graphics.fillRect(x + Math.round((width * i) / count), y + 1, 1, Math.max(1, height - 2));
  }
}

// Positive amount lightens toward white, negative darkens toward black.
export function shade(color, amount) {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (channel) => Math.round(channel + (target - channel) * t);
  const r = mix((color >> 16) & 0xff);
  const g = mix((color >> 8) & 0xff);
  const b = mix(color & 0xff);
  return (r << 16) | (g << 8) | b;
}
