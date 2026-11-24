// Procedural pixel fireball, shaded per art cell in hard palette bands: a big
// white-hot centre with a bright bow of light ahead of it, layered flame
// streaks streaming behind, lightning crackling around its sides, dashes of
// light flung off it, and a dithered glow. Frames are baked once per game.
//
// Frame "up" is the trailing side: the sprite is rotated by baseAngleDeg
// (-90) on top of its travel angle, so the round hot face leads and the flame
// tongues stream behind. Frames fire00-15 grow the ball on the staff tip: a
// round orb that swells in place. Release frames stretch the tail into the flight loop.

// Field maths runs in "cells" (the old art grid) and is sampled at every
// texture pixel, so the shape matches the previous footprint exactly.
const CELL = 4;
const COLS = 40;
const ROWS = 60;
const CENTER_X = 20;
const CENTER_Y = 43;
const FRAME_W = COLS * CELL;
const FRAME_H = ROWS * CELL;
export const FIREBALL_ORIGIN = { x: (CENTER_X + 0.5) / COLS, y: (CENTER_Y + 0.5) / ROWS };

// Palette indices: 1 glow (the old outline colour), 2 edge, 3 mid, 4 light, 5 core.
export const FIREBALL_PALETTES = {
  blue: ["", "#0b1452", "#1d46e8", "#2f9bff", "#7fe6ff", "#effdff"],
  red: ["", "#4a0b16", "#c8262f", "#ff6a2a", "#ffc65a", "#fff4d8"],
};

const RADIUS = 11.5;
// Ball radius on screen at activeScale 0.5.
export const FIREBALL_RADIUS_PX = RADIUS * CELL * 0.5;
const SPAWN = 16;
export const FIREBALL_LOOP_FRAMES = 24;
export const RELEASE_FRAMES = 8;
export const FLIGHT_START = SPAWN + RELEASE_FRAMES;
export const FIREBALL_FRAME_COUNT = FLIGHT_START + FIREBALL_LOOP_FRAMES;
export const fireballFrameName = f => `fire${String(f).padStart(2, "0")}`;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Value noise that wraps every `period` lattice cells along v, so scrolling it
// by one period over a loop repeats seamlessly.
function noise(u, v, size, period) {
  const x = u / size, y = v / size;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = n => ((n % period) + period) % period;
  const a = hash(x0, w(y0)), b = hash(x0 + 1, w(y0));
  const c = hash(x0, w(y0 + 1)), d = hash(x0 + 1, w(y0 + 1));
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (a, b, n) => {
  const t = clamp01((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

const TAU = Math.PI * 2;
const LANES = 5;
const wrap01 = n => n - Math.floor(n);

// Heat at a point: > 0 is inside the flame. u runs across the travel line,
// v runs backwards along the trail (v < 0 is the leading face). `phase` is the
// loop position in [0, 1); everything moves by whole cycles of it, so the
// flight loop is seamless. `tail` (0-1) grows the flame streaks out of a round
// orb.
function heat(u, v, phase, grow, tail = 1) {
  const R = RADIUS * grow;
  const d = Math.hypot(u, v);
  if (v <= 0) {
    // Leading face: a round front with a slight shimmer on its rim.
    const shimmer = (noise(Math.atan2(u, -v) * 6 + 40, phase * 32, 2, 16) - 0.5) * 0.5 * clamp01(-v / 3);
    return 1 - d / (R + shimmer * grow);
  }
  // The back of the ball is a short, broad teardrop (a circle before the tail)...
  let h = 1 - Math.hypot(u * 1.02, v * (1 - 0.2 * tail)) / R;
  if (tail <= 0) return h;
  // ...that splits into flame streaks: the middle one longest, the outer
  // ones shorter, each tapering to a point that curves in towards the middle.
  // They only breathe a little in length; the tail never sways.
  for (let k = 0; k < LANES; k++) {
    const offset = k - (LANES - 1) / 2;
    const length = R * (3.2 - 0.55 * Math.abs(offset)) * (1 + 0.05 * Math.sin(TAU * (phase + k * 0.2))) * tail;
    if (v >= length) continue;
    const s = v / length;
    const centre = offset * R * 0.4 * (1 - s * s * 0.45);
    const width = R * 0.34 * Math.pow(1 - s, 0.85);
    const inLane = 1 - Math.abs(u - centre) / width;
    h = Math.max(h, inLane * 0.55);
  }
  return h;
}

// Returns straight-alpha RGBA for one frame, FRAME_W x FRAME_H. The field is
// shaded once per art cell, snapped to the palette and a few alpha steps, then
// drawn as CELL x CELL blocks so the ball keeps the game's pixel scale.
export function fireballFramePixels(frame, palette = FIREBALL_PALETTES.blue) {
  return expandCells(fireballFrameCells(frame, palette), COLS, ROWS, CELL);
}

export function fireballFrameCells(frame, palette = FIREBALL_PALETTES.blue) {
  const [, glow, edge, mid, light, core] = palette.map(c => (c ? hex(c) : null));
  const charge = clamp01((frame + 1) / SPAWN);
  const release = smooth(0, RELEASE_FRAMES, frame - SPAWN + 1);
  const grow = 0.1 + 0.55 * smooth(0, 1, charge) + 0.35 * release;
  const tail = release;
  const forming = 1 - release;
  const phase = frame < FLIGHT_START ? (frame - FLIGHT_START) / FLIGHT_START : (frame - FLIGHT_START) / FIREBALL_LOOP_FRAMES;
  const R = RADIUS * grow;
  const out = new Uint8ClampedArray(COLS * ROWS * 4);
  // A charging ball pulses brighter as it fills.
  const spawnFlash = frame < SPAWN ? 0.25 * (1 - grow) : 0;
  const GLOW = 0.3;
  const heats = new Float32Array(COLS * ROWS).fill(-1);
  const scroll = phase * 48;
  for (let py = 1; py < ROWS - 1; py++) {
    const v = CENTER_Y - py;
    for (let px = 1; px < COLS - 1; px++) {
      const u = px - CENTER_X;
      const h = heat(u, v, phase, grow, tail);
      heats[py * COLS + px] = h;
      if (h <= -GLOW) {
        // A continuous pool of coloured light spills onto the staff at ignition.
        if (!forming) continue;
        const spill = forming * (1 - smooth(R, R + 3 + 5 * charge, Math.hypot(u, v)));
        if (spill > 0.03) {
          const o = (py * COLS + px) * 4;
          out.set([mid[0], mid[1], mid[2], Math.round(85 * spill)], o);
        }
        continue;
      }
      const reach = v > 0 ? Math.min(1, v / (R * 3)) : 0;
      let c, a;
      if (h <= 0) {
        // Dithered halo hugging the flame, strongest around the ball.
        const k = 1 + h / GLOW;
        // Behind the ball only the cells right at the flame's edge glow, so
        // the gaps between streaks stay clean.
        if (tail && v > R * 0.8 && k < 0.75) continue;
        a = k * k * (0.6 - 0.35 * reach);
        c = k > 0.6 ? mid : glow;
      } else {
        // A big white-hot centre, pushed a little forward and wobbling.
        const ahead = v + 2.4 * grow * tail;
        const wobble = (noise(u * 0.9 + 7, (v - scroll) * 0.25, 2, 6) - 0.5) * 0.22;
        const hot = 1 - Math.hypot(u * 1.05, ahead * (ahead > 0 ? 1 - 0.38 * tail : 1)) / R + wobble;
        // The flame body behind keeps a mid band down its middle so the tail
        // cools from the ball to dark tips.
        const t = Math.max(Math.min(h + 0.1, hot + 0.14), h * 0.45, 0) + spawnFlash;
        const index = t > 0.6 ? 5 : t > 0.4 ? 4 : t > 0.2 ? 3 : 2;
        c = [, , edge, mid, light, core][index];
        a = 1;
      }
      const o = (py * COLS + px) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = a * 255;
    }
  }
  if (!forming) snapCells(out, [glow, edge, mid, light, core], frame);
  const set = (x, y, c, alpha = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 1 || y < 1 || x >= COLS - 1 || y >= ROWS - 1) return;
    const o = (y * COLS + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = alpha;
  };
  // Edges: the ball's outline is light, the streaks are traced in mid.
  const inside = i => heats[i] > 0;
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      const i = y * COLS + x;
      if (!inside(i)) continue;
      if (!inside(i - 1) || !inside(i + 1) || !inside(i - COLS) || !inside(i + COLS)) set(x, y, CENTER_Y - y > R * 0.7 ? mid : light);
    }
  }
  if (forming > 0) chargeLightning(set, frame, R, forming, light, core);
  // A bright bow of light rides just ahead of the face once it has a heading.
  if (grow > 0.3 && tail > 0.3) {
    for (let k = -14; k <= 14; k++) {
      const theta = (k / 14) * 1.05;
      const r = R + 2.2 + 0.5 * Math.cos(theta * 3 + TAU * phase * 2);
      const colour = Math.abs(k) < 9 ? core : light;
      set(CENTER_X + Math.sin(theta) * r, CENTER_Y + Math.cos(theta) * r, colour);
    }
  }
  if (tail > 0.7) crackle(set, frame, grow, light, core);
  if (grow > 0.6 && tail > 0.5) dashes(set, heats, phase, grow, light, mid);
  return out;
}

// Fixed strike directions avoid an orbit. Each channel kinks at its elbow,
// then conducts a bright pulse inwards; every sample touches the next.
function chargeLightning(set, frame, radius, forming, light, core) {
  const strikes = [[-1, -0.4], [0.65, -1], [0.8, 0.65]];
  for (const [i, [dx, dy]] of strikes.entries()) {
    const beat = (frame + i * 3) % 8;
    if (beat >= 6) continue;
    const length = Math.hypot(dx, dy);
    const nx = dx / length, ny = dy / length;
    const reach = radius + forming * (4 + (5 - beat) * 0.7);
    const bend = (i === 1 ? -1 : 1) * forming;
    for (let d = Math.ceil(reach * 2); d >= 0; d--) {
      const along = d / 2;
      const t = along / reach;
      const kink = bend * (2.4 * Math.max(0, 1 - Math.abs(t - 0.65) * 6)
        - 1.4 * Math.max(0, 1 - Math.abs(t - 0.38) * 7));
      const bright = Math.abs(t - (1 - beat / 5)) < 0.23;
      set(CENTER_X + nx * along - ny * kink, CENTER_Y + ny * along + nx * kink,
        bright || along < radius * 0.35 ? core : light, along <= radius ? 255 : 255 * forming);
    }
  }
}

// Jagged arcs of lightning wrapping the ball's sides and back, re-rolled every
// other frame the way lightning flickers.
function crackle(set, frame, grow, light, core) {
  const R = RADIUS * grow;
  const seed = Math.floor(frame / 2) * 13 + 5;
  for (let b = 0; b < 2; b++) {
    const rnd = k => hash(seed + b * 41, k);
    // Arcs start on a flank (never across the face) and sweep backwards.
    const side = rnd(0) < 0.5 ? -1 : 1;
    // Kept to the flanks so no arc cuts across the flame body behind.
    const start = (0.55 + rnd(1) * 0.5) * side;
    const span = (0.7 + rnd(2) * 0.6) * side;
    const steps = 4 + Math.floor(rnd(3) * 3);
    let prev = null;
    for (let s = 0; s <= steps; s++) {
      const theta = start + (span * s) / steps;
      // Zigzag in and out of the rim.
      const r = R * (0.97 + rnd(4) * 0.08) + (s % 2 ? 2.4 : -1.8) * (0.6 + rnd(10 + s) * 0.6);
      // theta is measured from the leading direction (+v points back).
      const point = { x: CENTER_X + Math.sin(theta) * r, y: CENTER_Y + Math.cos(theta) * r };
      if (prev) {
        const n = Math.ceil(Math.max(Math.abs(point.x - prev.x), Math.abs(point.y - prev.y)));
        for (let k = 0; k <= n; k++) {
          const t = n ? k / n : 0;
          set(prev.x + (point.x - prev.x) * t, prev.y + (point.y - prev.y) * t, (s + k) % 4 ? core : light);
        }
      }
      prev = point;
    }
  }
}

// Short dashes of light flung off the flanks and drifting back.
function dashes(set, heats, phase, grow, light, mid) {
  const R = RADIUS * grow;
  for (let j = 0; j < 3; j++) {
    const t = wrap01(phase + j / 3);
    const v = -R * 0.6 + t * R * 3;
    const side = j % 2 ? 1 : -1;
    const u = side * (R * (0.95 + 0.45 * hash(j, 3)) + t * 2.5);
    const x = Math.round(CENTER_X + u), y = Math.round(CENTER_Y - v);
    if (y < 3 || y >= ROWS - 3 || heats[y * COLS + x] > 0) continue;
    const colour = t < 0.6 ? light : mid;
    set(x, y, colour); set(x, y + 1, colour);
  }
}

// Snaps each cell to the nearest palette colour and to one of a few alpha
// steps; the faintest glow is dithered so it stays crisp pixel art.
function snapCells(out, colours, frame) {
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    if (a <= 0.04) { out[i + 3] = 0; continue; }
    let best = colours[0], bestD = Infinity;
    for (const c of colours) {
      const d = (c[0] - out[i]) ** 2 + (c[1] - out[i + 1]) ** 2 + (c[2] - out[i + 2]) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    out[i] = best[0]; out[i + 1] = best[1]; out[i + 2] = best[2];
    const cell = i / 4, x = cell % COLS, y = Math.floor(cell / COLS);
    let step = a > 0.8 ? 1 : a > 0.45 ? 0.7 : a > 0.22 ? 0.45 : 0.3;
    if (a <= 0.22 && (x + y + frame) % 2) step = 0;
    out[i + 3] = step * 255;
  }
}

// Draws each art cell as a block x block square of texture pixels.
function expandCells(cells, cols, rows, block) {
  const out = new Uint8ClampedArray(cols * block * rows * block * 4);
  const rowBytes = cols * block * 4;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      if (!cells[i + 3]) continue;
      for (let dy = 0; dy < block; dy++) {
        let o = (y * block + dy) * rowBytes + x * block * 4;
        for (let dx = 0; dx < block; dx++, o += 4) {
          out[o] = cells[i]; out[o + 1] = cells[i + 1]; out[o + 2] = cells[i + 2]; out[o + 3] = cells[i + 3];
        }
      }
    }
  }
  return out;
}

export const FIREBALL_FRAME_SIZE = { w: FRAME_W, h: FRAME_H };

const SHEET_COLS = 8;

function bake(scene, key, frames, fw, fh, render, name) {
  const rows = Math.ceil(frames / SHEET_COLS);
  const texture = scene.textures.createCanvas(key, fw * SHEET_COLS, fh * rows);
  if (!texture) return;
  const ctx = texture.getContext();
  for (let f = 0; f < frames; f++) {
    const ox = (f % SHEET_COLS) * fw, oy = Math.floor(f / SHEET_COLS) * fh;
    const image = ctx.createImageData(fw, fh);
    image.data.set(render(f));
    ctx.putImageData(image, ox, oy);
    texture.add(name(f), 0, ox, oy, fw, fh);
  }
  texture.refresh();
  // Nearest sampling keeps the cells crisp at any angle.
  texture.setFilter?.(1);
}

// ---------------------------------------------------------------------------
// Impact explosion. The ball bursts into a white-hot pop, swells into a ring
// of flame tongues that rises as it cools, then breaks apart into sparks and
// soft smoke. Same palettes as the ball.

export const EXPLOSION_FRAMES = 12;
const BOOM_COLS = 64;
const BOOM_ROWS = 72;
const BOOM_CX = 32;
const BOOM_CY = 43;
// The burst is short-lived and soft, so it is baked at half the ball's
// density and drawn at EXPLOSION_TEXTURE_SCALE to keep load time down.
const BOOM_CELL = 1;
const BOOM_BLOCK = 2;
export const EXPLOSION_TEXTURE_SCALE = CELL / BOOM_BLOCK;
const BOOM_W = BOOM_COLS * BOOM_CELL;
const BOOM_H = BOOM_ROWS * BOOM_CELL;
export const EXPLOSION_ORIGIN = { x: (BOOM_CX + 0.5) / BOOM_COLS, y: (BOOM_CY + 0.5) / BOOM_ROWS };
export const EXPLOSION_SMOKE = { blue: "#26305e", red: "#3b2a33" };

// Seamless noise around the ring: sample on a circle so angle 0 meets 2*PI.
const ringNoise = (theta, radius, size, seed) =>
  noise(Math.cos(theta) * radius + seed, Math.sin(theta) * radius + seed, size, 1 << 20);

export function explosionFramePixels(frame, palette = FIREBALL_PALETTES.blue, smokeColour = EXPLOSION_SMOKE.blue) {
  const cells = explosionShade(frame, palette, smokeColour);
  const colours = [...palette.slice(1), smokeColour].map(hex);
  for (let i = 0; i < cells.length; i += 4) {
    const a = cells[i + 3] / 255;
    if (a < 0.12) { cells[i + 3] = 0; continue; }
    let best = colours[0], bestD = Infinity;
    for (const c of colours) {
      const d = (c[0] - cells[i]) ** 2 + (c[1] - cells[i + 1]) ** 2 + (c[2] - cells[i + 2]) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    cells[i] = best[0]; cells[i + 1] = best[1]; cells[i + 2] = best[2];
    cells[i + 3] = (a > 0.75 ? 1 : a > 0.4 ? 0.65 : 0.35) * 255;
  }
  return expandCells(cells, BOOM_COLS, BOOM_ROWS, BOOM_BLOCK);
}

function explosionShade(frame, palette, smokeColour) {
  const [, glow, edge, mid, light, core] = palette.map(c => (c ? hex(c) : null));
  const smoke = hex(smokeColour);
  const t = Math.min(1, Math.max(0, frame / (EXPLOSION_FRAMES - 1)));
  const swell = 1 - (1 - t) * (1 - t) * (1 - t);
  const outer = 7 + 15 * swell;
  // The middle burns out after the pop, leaving a ring that thins as it cools.
  const hollow = t < 0.2 ? 0 : outer * Math.min(0.85, (t - 0.2) * 1.15);
  const rise = t * t * 7;
  const fade = 1 - smooth(0.6, 1, t);
  const out = new Uint8ClampedArray(BOOM_W * BOOM_H * 4);
  const puffs = [];
  if (t >= 0.4) {
    for (let i = 0; i < 5; i++) {
      const theta = -Math.PI / 2 + (i - 2) * 0.55;
      const r = outer * (0.55 + 0.2 * (i % 2));
      puffs.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r - rise * 1.3, size: 2.4 + (t - 0.4) * 5 - (i % 2) * 0.6 });
    }
  }
  const sparks = [];
  for (let i = 0; i < 10; i++) {
    const theta = i * 2.39 + 0.4;
    const r = outer * (0.95 + 0.6 * t) + (i % 3) * 2;
    sparks.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r - rise * 1.4 });
  }
  const sparkLife = t > 0.1 && t < 0.95 ? 1 - smooth(0.5, 0.95, t) : 0;
  const blend = (o, c, a) => {
    // "over" compositing in straight alpha.
    const da = out[o + 3] / 255, na = a + da * (1 - a);
    if (na <= 0) return;
    for (let k = 0; k < 3; k++) out[o + k] = (c[k] * a + out[o + k] * da * (1 - a)) / na;
    out[o + 3] = na * 255;
  };
  // Only the box that can hold flame, sparks or smoke this frame is painted.
  const reach = outer * 1.65 + 6;
  const x0 = Math.max(0, Math.floor((BOOM_CX - reach) * BOOM_CELL)), x1 = Math.min(BOOM_W, Math.ceil((BOOM_CX + reach) * BOOM_CELL));
  const y0Px = Math.max(0, Math.floor((BOOM_CY - reach - rise * 1.4) * BOOM_CELL)), y1 = Math.min(BOOM_H, Math.ceil((BOOM_CY + reach) * BOOM_CELL));
  for (let py = y0Px; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const x = (px + 0.5) / BOOM_CELL - (BOOM_CX + 0.5), y0 = (py + 0.5) / BOOM_CELL - (BOOM_CY + 0.5);
      const o = (py * BOOM_W + px) * 4;
      for (const p of puffs) {
        const d = Math.hypot(x - p.x, y0 - p.y) / p.size;
        if (d < 1.4) blend(o, smoke, 0.55 * (1 - smooth(0.6, 1.4, d)) * (1 - smooth(0.7, 1, t) * 0.8));
      }
      const u = x, v = y0 + rise;
      const theta = Math.atan2(v, u);
      const up = Math.max(0, -Math.sin(theta));
      // Tongues lick outward, longest upward, and churn frame to frame.
      const lick = ringNoise(theta, 3, 1, frame * 0.6) * 0.55 + ringNoise(theta, 6, 1, 40 + frame * 0.8) * 0.45;
      const edgeR = outer * (0.72 + 0.42 * lick + 0.3 * up * t);
      const d = Math.hypot(u, v * (1 + 0.15 * (1 - up)));
      const inner = hollow * (0.85 + 0.35 * ringNoise(theta, 4, 1, 90 + frame * 0.8));
      const tear = noise(u * 0.9 + frame * 1.4, v * 0.9 - frame * 1.9, 3, 1 << 20);
      const torn = t > 0.55 ? (t - 0.55) * 1.5 - tear : -1;
      // Signed distance-ish inside value; positive inside the ring.
      const inside = Math.min(edgeR - d, inner > 0 ? d - inner : 99, -torn * 4);
      if (inside > -3.5) {
        const depth = inner < d ? (d - inner) / Math.max(1, edgeR - inner) : 0;
        let hv = 1 - Math.abs(depth - 0.45) * 1.4 - t * 0.85 + (t < 0.15 ? 0.7 : 0);
        hv = Math.max(hv, (1 - smooth(0, 1.2, inside)) * 0.35);
        if (inside > 0) {
          const stops = [edge, mid, light, core, core];
          const xx = clamp01(hv / 0.7) * 3;
          const i = Math.min(3, Math.floor(xx)), f = smooth(0, 1, xx - i);
          const c = [0, 1, 2].map(k => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f);
          blend(o, c, smooth(0, 1, inside) * (0.95 * fade + 0.05));
        } else {
          const k = 1 + inside / 3.5;
          blend(o, glow, k * k * 0.45 * fade);
        }
      }
      if (sparkLife > 0) {
        for (const s of sparks) {
          const sd = Math.hypot(x - s.x, y0 - s.y);
          if (sd < 1.6) blend(o, sd < 0.6 ? light : mid, sparkLife * (1 - smooth(0.4, 1.6, sd)));
        }
      }
    }
  }
  return out;
}

export const explosionTextureKey = team => `ozzy-explosion-${team === "red" ? "red" : "blue"}`;

// Bake the burning eight ball at its logical pixel resolution. Its ebony face
// and the flame share a fixed pivot, including while the charge grows.
export const EIGHT_BALL_SCALE = CELL * 1.4;
const EIGHT = ['01110', '11011', '11011', '01110', '11011', '11011', '01110'];
export const EIGHT_BALL_PALETTE = ['', '#671737', '#ce3a21', '#ff831b', '#ffce50', '#fff7ca'];
export function eightBallCells(frame, team = 'blue') {
  const cells = fireballFrameCells(frame, team === 'red' ? FIREBALL_PALETTES.red : EIGHT_BALL_PALETTE);
  const charge = smooth(0, 1, (frame + 1) / SPAWN);
  const release = smooth(0, RELEASE_FRAMES, frame - SPAWN + 1);
  const radius = 9.4 * (0.1 + 0.55 * charge + 0.35 * release);
  const phase = (frame - FLIGHT_START) / FIREBALL_LOOP_FRAMES;
  const rim = team === 'red' ? [255, 103, 58] : [255, 186, 46];
  const hot = [255, 250, 205];
  function spark(x, y, color) {
    x = CENTER_X + Math.round(x);
    y = CENTER_Y + Math.round(y);
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) cells.set([...color, 255], (y * COLS + x) * 4);
  }
  // A segmented brass halo ignites outside the enamel and sheds curling embers.
  if (charge > 0.4) {
    const orbit = radius + 2 + 2.8 * release;
    for (let arc = 0; arc < 3; arc++) for (let step = 0; step < 16; step++) {
      const angle = TAU * (phase + arc / 3 + step / 100);
      spark(orbit * Math.cos(angle), orbit * Math.sin(angle), step > 12 ? hot : rim);
    }
    for (let lane = -1; lane <= 1; lane += 2) for (let i = 0; i < 15 * release; i++) {
      const x = lane * (radius + 2 + 2.5 * Math.sin(phase * TAU + i * 0.29));
      spark(x, -radius - 1.6 * i, i % 6 === 0 ? hot : rim);
    }
  }
  const extent = Math.ceil(radius);
  for (let dy = -extent; dy <= extent; dy++) for (let dx = -extent; dx <= extent; dx++) {
    const r = Math.hypot(dx, dy) / radius;
    if (r > 1) continue;
    // Travel-right rotates the whole texture -90 degrees.
    const x = dy / radius, y = -dx / radius;
    let ink = r > 0.89 ? [100, 52, 48] : y > 0.35 ? [24, 19, 34] : [53, 43, 59];
    if (Math.hypot(x, y) < 0.59) {
      const digit = EIGHT[Math.round(y * 8) + 3]?.[Math.round(x * 8) + 2];
      ink = digit === '1' ? [33, 22, 33] : [255, 238, 195];
    } else if (Math.hypot(x + 0.45, y + 0.56) < 0.17) ink = [255, 212, 164];
    // A narrow reflection sweeps the lacquer once per loop, leaving the digit clear.
    const glint = (phase - Math.floor(phase)) * 3 - 1.5;
    if (r > 0.61 && r < 0.88 && Math.abs(x + y * 0.4 - glint) < 0.09) ink = [255, 184, 108];
    cells.set([...ink, 255], ((CENTER_Y + dy) * COLS + CENTER_X + dx) * 4);
  }
  return cells;
}

export function eightBallTexture(scene, team) {
  const key = team === 'red' ? 'ozzy-pocket-ace-eight-ball-red' : 'ozzy-pocket-ace-eight-ball';
  if (!scene.textures.exists(key)) {
    bake(scene, key, FIREBALL_FRAME_COUNT, COLS, ROWS, frame => eightBallCells(frame, team), fireballFrameName);
  }
  return key;
}

// Builds both team sheets once per game; later calls are free.
export function ensureFireballTextures(scene) {
  if (!scene?.textures?.createCanvas) return;
  const sheets = { blue: "ozzy-fireball-unified", red: "ozzy-fireball-red" };
  for (const team of ["blue", "red"]) {
    if (!scene.textures.exists(sheets[team])) {
      bake(scene, sheets[team], FIREBALL_FRAME_COUNT, FRAME_W, FRAME_H,
        f => fireballFramePixels(f, FIREBALL_PALETTES[team]), fireballFrameName);
    }
    const key = explosionTextureKey(team);
    if (!scene.textures.exists(key)) {
      bake(scene, key, EXPLOSION_FRAMES, BOOM_W * BOOM_BLOCK, BOOM_H * BOOM_BLOCK,
        f => explosionFramePixels(f, FIREBALL_PALETTES[team], EXPLOSION_SMOKE[team]), f => `boom${f}`);
    }
  }
}
