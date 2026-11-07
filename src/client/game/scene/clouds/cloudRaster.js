// cloudRaster.js
// Turns simulated cloud blobs into chunky pixel art. Pure: it writes RGBA
// words into a Uint32Array, so it runs (and is tested) without a browser.
//
// Blobs are summed into a soft field, so touching blobs melt into one
// silhouette instead of stacking outlines. Each pixel is then shaded from the
// field itself: stepping toward the light (up-left) and finding *more* cloud
// means the pixel sits on a lobe's far side, so it is shadowed. That gives
// every bump and crease its own shading for free, whatever shape the blobs make.

// Field contribution reaches past the visible edge so neighbours merge.
const INFLUENCE = 1.5;
const THRESHOLD = (1 - 1 / (INFLUENCE * INFLUENCE)) ** 2; // edge of a lone blob
const SHADOW_SLOPE = 0.13;
const SPENT_TONE = 0.55;
// Opacity is stepped so merged clouds keep flat pixel-art fills, not gradients.
const OPACITY_STEPS = 8;

export const DEFAULT_CLOUD_PALETTE = Object.freeze({
  light: 0xffffff,
  body: 0xeef0f5,
  shadow: 0xc3c9d6,
  deep: 0x939db2,
  outline: 0x4f5a72,
  outlineAlpha: 0.62,
});

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Pack 0xRRGGBB + alpha (0..1) into a canvas ImageData word. */
export function packColor(hex, alpha = 1) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return littleEndian
    ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/** Replace the alpha of a packed colour word. */
function withAlpha(word, alpha) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return littleEndian
    ? ((word & 0x00ffffff) | (a << 24)) >>> 0
    : ((word & 0xffffff00) | a) >>> 0;
}

function packPalette(palette) {
  return {
    light: packColor(palette.light),
    body: packColor(palette.body),
    shadow: packColor(palette.shadow),
    deep: packColor(palette.deep),
    outline: packColor(palette.outline),
    outlineAlpha: palette.outlineAlpha,
  };
}

/**
 * A reusable pixel grid covering a world-space rectangle.
 * @param {number} width Cells.
 * @param {number} height Cells.
 * @param {number} cell World pixels per cell.
 */
export function createCloudGrid(width, height, cell, palette = DEFAULT_CLOUD_PALETTE) {
  const count = width * height;
  return {
    width,
    height,
    cell,
    originX: 0,
    originY: 0,
    field: new Float32Array(count),
    tone: new Float32Array(count),
    opacity: new Float32Array(count),
    pixels: new Uint32Array(count),
    colors: packPalette(palette),
    dirty: null, // last written rect, cleared before the next pass
  };
}

function clearRect(grid, rect) {
  if (!rect) return;
  const { width, field, tone, opacity, pixels } = grid;
  for (let y = rect.y0; y <= rect.y1; y++) {
    const row = y * width;
    field.fill(0, row + rect.x0, row + rect.x1 + 1);
    tone.fill(0, row + rect.x0, row + rect.x1 + 1);
    opacity.fill(0, row + rect.x0, row + rect.x1 + 1);
    pixels.fill(0, row + rect.x0, row + rect.x1 + 1);
  }
}

/**
 * Rasterize `blobs` into `grid.pixels`. Returns the rect (in cells) that
 * changed this pass, including anything cleared from the previous pass, or
 * null when nothing was or is drawn.
 */
export function rasterizeClouds(grid, blobs) {
  const { width, height, cell, originX, originY, field, tone, opacity, pixels, colors } = grid;
  const previous = grid.dirty;
  clearRect(grid, previous);

  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  for (const blob of blobs) {
    const reach = blob.radius * INFLUENCE;
    const reachSq = reach * reach;
    const bx0 = Math.max(0, Math.floor((blob.x - reach - originX) / cell));
    const bx1 = Math.min(width - 1, Math.floor((blob.x + reach - originX) / cell));
    const by0 = Math.max(0, Math.floor((blob.y - reach - originY) / cell));
    const by1 = Math.min(height - 1, Math.floor((blob.y + reach - originY) / cell));
    if (bx0 > bx1 || by0 > by1) continue;
    const blobTone = blob.tone || 0;
    const blobOpacity = Number.isFinite(blob.opacity) ? blob.opacity : 1;
    for (let cy = by0; cy <= by1; cy++) {
      const dy = originY + (cy + 0.5) * cell - blob.y;
      const dySq = dy * dy;
      if (dySq >= reachSq) continue;
      const row = cy * width;
      for (let cx = bx0; cx <= bx1; cx++) {
        const dx = originX + (cx + 0.5) * cell - blob.x;
        const dSq = dx * dx + dySq;
        if (dSq >= reachSq) continue;
        const falloff = 1 - dSq / reachSq;
        const weight = falloff * falloff;
        field[row + cx] += weight;
        tone[row + cx] += weight * blobTone;
        opacity[row + cx] += weight * blobOpacity;
      }
    }
    if (bx0 < x0) x0 = bx0;
    if (by0 < y0) y0 = by0;
    if (bx1 > x1) x1 = bx1;
    if (by1 > y1) y1 = by1;
  }

  if (x1 < 0) {
    grid.dirty = null;
    return previous;
  }

  // One cell of margin for outlines, which sit just outside the silhouette.
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(width - 1, x1 + 1);
  y1 = Math.min(height - 1, y1 + 1);

  const at = (cx, cy) =>
    cx < 0 || cy < 0 || cx >= width || cy >= height ? 0 : field[cy * width + cx];

  for (let cy = y0; cy <= y1; cy++) {
    const row = cy * width;
    for (let cx = x0; cx <= x1; cx++) {
      const i = row + cx;
      const value = field[i];
      // Blend the opacity of every blob reaching this pixel, then step it.
      const alpha = value > 0
        ? Math.round(Math.min(1, opacity[i] / value) * OPACITY_STEPS) / OPACITY_STEPS
        : 0;
      if (value >= THRESHOLD) {
        const towardLight = at(cx - 1, cy - 2) - value;
        const bottomEdge = at(cx, cy + 1) < THRESHOLD;
        const topEdge = at(cx, cy - 1) < THRESHOLD || at(cx - 1, cy) < THRESHOLD;
        let shade;
        if (bottomEdge) shade = 3;
        else if (towardLight > SHADOW_SLOPE) shade = 2;
        else if (topEdge && towardLight < 0) shade = 0;
        else shade = 1;
        // Spent pieces drift a step greyer before they vanish.
        if (tone[i] / value > SPENT_TONE && shade < 3) shade += 1;
        const color = shade === 0 ? colors.light
          : shade === 1 ? colors.body
          : shade === 2 ? colors.shadow
          : colors.deep;
        pixels[i] = alpha >= 1 ? color : withAlpha(color, alpha);
      } else {
        const above = at(cx, cy - 1) >= THRESHOLD;
        if (above || at(cx, cy + 1) >= THRESHOLD || at(cx - 1, cy) >= THRESHOLD || at(cx + 1, cy) >= THRESHOLD) {
          pixels[i] = withAlpha(colors.outline, colors.outlineAlpha * (above ? 1 : 0.55) * alpha);
        }
      }
    }
  }

  grid.dirty = { x0, y0, x1, y1 };
  if (!previous) return grid.dirty;
  return {
    x0: Math.min(x0, previous.x0),
    y0: Math.min(y0, previous.y0),
    x1: Math.max(x1, previous.x1),
    y1: Math.max(y1, previous.y1),
  };
}

export const CLOUD_RASTER_THRESHOLD = THRESHOLD;
