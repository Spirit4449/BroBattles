// Pixel-art versions of the round shapes used by powerup effects. Everything
// snaps to a world-space grid of PIXEL_FX_SIZE so it matches the pixel art.
export const PIXEL_FX_SIZE = 2;

// Rasterizes a closed polygon onto a world-aligned grid. Each covered cell
// stores its 4-neighbour depth from the edge (1 = outline), up to ringCount.
// `grow` pushes the outline outward so the stepped edge covers the same area
// a smooth stroke would have.
export function rasterizePixelBlob(
  sourcePoints,
  { ringCount = 2, cell = PIXEL_FX_SIZE, grow = PIXEL_FX_SIZE } = {},
) {
  let centerX = 0;
  let centerY = 0;
  for (const p of sourcePoints) {
    centerX += p.x / sourcePoints.length;
    centerY += p.y / sourcePoints.length;
  }
  const points = sourcePoints.map((p) => {
    const distance = Math.hypot(p.x - centerX, p.y - centerY) || 1;
    const scale = (distance + grow) / distance;
    return { x: centerX + (p.x - centerX) * scale, y: centerY + (p.y - centerY) * scale };
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const originX = Math.floor(minX / cell) * cell - cell;
  const originY = Math.floor(minY / cell) * cell - cell;
  const cols = Math.ceil((maxX - originX) / cell) + 2;
  const rows = Math.ceil((maxY - originY) / cell) + 2;
  const depth = new Uint8Array(cols * rows);
  const crossings = [];
  for (let row = 0; row < rows; row += 1) {
    const sy = originY + (row + 0.5) * cell;
    crossings.length = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      if (p.y <= sy !== q.y <= sy) {
        crossings.push(p.x + ((sy - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
    }
    crossings.sort((m, n) => m - n);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const first = Math.max(0, Math.ceil((crossings[i] - originX) / cell - 0.5));
      const last = Math.min(cols - 1, Math.floor((crossings[i + 1] - originX) / cell - 0.5));
      for (let col = first; col <= last; col += 1) depth[row * cols + col] = 255;
    }
  }
  const depthAt = (col, row) =>
    col < 0 || row < 0 || col >= cols || row >= rows ? 0 : depth[row * cols + col];
  for (let ring = 1; ring <= ringCount; ring += 1) {
    const prev = ring - 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (depth[row * cols + col] !== 255) continue;
        if (
          depthAt(col - 1, row) === prev ||
          depthAt(col + 1, row) === prev ||
          depthAt(col, row - 1) === prev ||
          depthAt(col, row + 1) === prev
        ) {
          depth[row * cols + col] = ring;
        }
      }
    }
  }
  return { cell, originX, originY, cols, rows, depth };
}

// Depth of the blob cell under a world point (0 = outside).
export function pixelBlobDepthAt(blob, x, y) {
  const col = Math.floor((x - blob.originX) / blob.cell);
  const row = Math.floor((y - blob.originY) / blob.cell);
  if (col < 0 || row < 0 || col >= blob.cols || row >= blob.rows) return 0;
  return blob.depth[row * blob.cols + col];
}

// Fills the blob cells whose depth and centre pass `test`, in horizontal runs
// to keep draw calls low.
export function fillPixelBlob(g, blob, color, alpha, test = () => true) {
  const { cell, originX, originY, cols, rows, depth } = blob;
  g.fillStyle(color, alpha);
  for (let row = 0; row < rows; row += 1) {
    const cy = originY + (row + 0.5) * cell;
    let runStart = -1;
    for (let col = 0; col <= cols; col += 1) {
      const d = col < cols ? depth[row * cols + col] : 0;
      const on = d > 0 && test(d, originX + (col + 0.5) * cell, cy);
      if (on && runStart < 0) runStart = col;
      if (!on && runStart >= 0) {
        g.fillRect(originX + runStart * cell, originY + row * cell, (col - runStart) * cell, cell);
        runStart = -1;
      }
    }
  }
}

// Stepped ellipse drawn straight into a Graphics object.
export function fillPixelEllipse(g, x, y, width, height, color, alpha, cell = PIXEL_FX_SIZE) {
  const rx = width / 2;
  const ry = height / 2;
  if (rx <= 0 || ry <= 0) return;
  g.fillStyle(color, alpha);
  const top = Math.floor((y - ry) / cell);
  const bottom = Math.ceil((y + ry) / cell);
  for (let row = top; row < bottom; row += 1) {
    const dy = (row + 0.5) * cell - y;
    if (Math.abs(dy) > ry) continue;
    const half = rx * Math.sqrt(1 - (dy / ry) ** 2);
    const first = Math.ceil((x - half) / cell - 0.5);
    const last = Math.floor((x + half) / cell - 0.5);
    if (last >= first) g.fillRect(first * cell, row * cell, (last - first + 1) * cell, cell);
  }
}

function pixelEllipseTexture(scene, cols, rows, ringCells, cell) {
  const key = `pixel-fx-ellipse-${cols}x${rows}-${ringCells}-${cell}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, cols * cell, rows * cell);
  const ctx = texture.getContext();
  ctx.fillStyle = "#ffffff";
  const inside = (col, row) => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    const nx = (col + 0.5 - cols / 2) / (cols / 2);
    const ny = (row + 0.5 - rows / 2) / (rows / 2);
    return nx * nx + ny * ny <= 1.08;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!inside(col, row)) continue;
      if (ringCells > 0) {
        let edge = false;
        for (let k = 1; k <= ringCells && !edge; k += 1) {
          edge =
            !inside(col - k, row) ||
            !inside(col + k, row) ||
            !inside(col, row - k) ||
            !inside(col, row + k);
        }
        if (!edge) continue;
      }
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  texture.refresh();
  return key;
}

// Drop-in replacement for scene.add.ellipse/circle: a tinted image of a
// stepped ellipse, so tweens on alpha, scale and display size still work.
// `ring` draws only an outline that many cells thick.
export function addPixelEllipse(scene, x, y, width, height, color, alpha = 1, { ring = 0, cell = PIXEL_FX_SIZE } = {}) {
  const cols = Math.max(1, Math.round(width / cell));
  const rows = Math.max(1, Math.round(height / cell));
  const image = scene.add.image(x, y, pixelEllipseTexture(scene, cols, rows, ring, cell));
  image.setTint(color);
  image.setAlpha(alpha);
  return image;
}

export function addPixelCircle(scene, x, y, radius, color, alpha = 1, options) {
  return addPixelEllipse(scene, x, y, radius * 2, radius * 2, color, alpha, options);
}
