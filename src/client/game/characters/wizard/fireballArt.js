// Procedural pixel-art fireball. Each frame is drawn on a coarse cell grid
// (one cell = one art pixel) and baked at CELL texture pixels per cell, so the
// sprite keeps the game's chunky pixel scale at activeScale 0.5.
//
// Frame "up" is the trailing side: the sprite is rotated by baseAngleDeg
// (-90) on top of its travel angle, so the round hot face leads and the flame
// tongues stream behind. Frames fire00-15 grow the ball on the staff tip;
// fire16-31 are a seamless 16-frame flight loop.

export const FIREBALL_CELL = 4;
export const FIREBALL_COLS = 40;
export const FIREBALL_ROWS = 60;
const CENTER_X = 20;
const CENTER_Y = 43;
export const FIREBALL_ORIGIN = { x: (CENTER_X + 0.5) / FIREBALL_COLS, y: (CENTER_Y + 0.5) / FIREBALL_ROWS };

// Palette indices: 0 empty, 1 outline, 2 edge, 3 mid, 4 light, 5 core.
export const FIREBALL_PALETTES = {
  blue: ["", "#0b1452", "#1d46e8", "#2f9bff", "#7fe6ff", "#effdff"],
  red: ["", "#4a0b16", "#c8262f", "#ff6a2a", "#ffc65a", "#fff4d8"],
};

const RADIUS = 11.5;
// Ball radius on screen at activeScale 0.5 (two screen pixels per cell).
export const FIREBALL_RADIUS_PX = RADIUS * FIREBALL_CELL * 0.5;
const LOOP = 16;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Value noise that wraps every `period` lattice cells along v, so scrolling it
// by one period over LOOP frames loops seamlessly.
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

// Heat at a cell: > 0 is inside the flame. u runs across the travel line,
// v runs backwards along the trail (v < 0 is the leading face).
function heat(u, v, frame, grow) {
  const R = RADIUS * grow;
  const phase = (frame % LOOP) / LOOP;
  if (v <= 0) {
    // Leading face: a clean circle with a one-cell shimmer on its rim.
    const d = Math.hypot(u, v);
    const shimmer = (noise(Math.atan2(u, -v) * 6 + 40, phase * 32, 2, 16) - 0.5) * 0.9;
    return 1 - d / (R + shimmer * grow);
  }
  // Trailing side: the circle stretches into licks that sway and scroll back.
  const scroll = phase * 48;
  const sway = Math.sin(v * 0.33 - phase * Math.PI * 2) * v * 0.13 * grow;
  const su = u - sway;
  // Columns of noise across the trail make separate licks; finer noise
  // ragged their edges.
  const tongues = noise(su * 2.2, (v - scroll) * 0.5, 4, 6) * 0.7 + noise(su * 2, v - scroll, 2, 24) * 0.3;
  const stretch = 0.4 + 0.06 * Math.sin(phase * Math.PI * 4);
  const d = Math.hypot(su * (1 + v / (R * 6)), v * stretch);
  return 1 - d / R - (1 - tongues) * Math.min(1, v / R) * 0.85 + 0.12 * Math.min(1, v / R);
}

// Loose embers that drift back from the licks; positions loop with the frame.
function embers(frame, grow) {
  if (grow < 0.6) return [];
  const phase = (frame % LOOP) / LOOP;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t = (phase + i / 3) % 1;
    const v = RADIUS * (1 + t * 1.9) * grow;
    const u = Math.sin(i * 2.4 + t * 5) * RADIUS * (0.55 + t * 0.45) * (i % 2 ? 1 : -1);
    out.push({ x: Math.round(CENTER_X + u), y: Math.round(CENTER_Y - v), tone: t < 0.45 ? 4 : t < 0.8 ? 3 : 2 });
  }
  return out;
}

// Returns a Uint8Array of palette indices, row-major, COLS x ROWS.
export function fireballFrameCells(frame) {
  const spawn = frame < LOOP;
  const t = spawn ? (frame + 1) / LOOP : 1;
  const grow = spawn ? 0.18 + 0.82 * (1 - (1 - t) * (1 - t)) : 1;
  const cells = new Uint8Array(FIREBALL_COLS * FIREBALL_ROWS);
  for (let y = 0; y < FIREBALL_ROWS; y++) {
    for (let x = 0; x < FIREBALL_COLS; x++) {
      const u = x - CENTER_X, v = CENTER_Y - y;
      const h = heat(u, v, frame, grow);
      if (h <= 0) continue;
      // The hottest band sits slightly forward, so the ball reads as charging
      // into its target rather than a flat disc.
      const core = 1 - Math.hypot(u * 1.1, (v + 2.2 * grow) * (v > 0 ? 0.7 : 1)) / (RADIUS * grow);
      const band = Math.min(h + 0.1, core + 0.08);
      cells[y * FIREBALL_COLS + x] = band > 0.62 ? 5 : band > 0.4 ? 4 : band > 0.18 ? 3 : 2;
    }
  }
  // Single stray cells look like noise, not fire; drop them before outlining.
  const at = (x, y) => (x < 0 || y < 0 || x >= FIREBALL_COLS || y >= FIREBALL_ROWS ? 0 : cells[y * FIREBALL_COLS + x]);
  for (let y = 0; y < FIREBALL_ROWS; y++) {
    for (let x = 0; x < FIREBALL_COLS; x++) {
      if (at(x, y) && !at(x - 1, y) && !at(x + 1, y) && !at(x, y - 1) && !at(x, y + 1)) cells[y * FIREBALL_COLS + x] = 0;
    }
  }
  for (const e of embers(frame, grow)) {
    if (!at(e.x, e.y) && e.y >= 1 && e.x >= 1 && e.x < FIREBALL_COLS - 1) cells[e.y * FIREBALL_COLS + e.x] = e.tone;
  }
  const outlined = cells.slice();
  for (let y = 0; y < FIREBALL_ROWS; y++) {
    for (let x = 0; x < FIREBALL_COLS; x++) {
      if (at(x, y)) continue;
      if (at(x - 1, y) > 1 || at(x + 1, y) > 1 || at(x, y - 1) > 1 || at(x, y + 1) > 1) {
        outlined[y * FIREBALL_COLS + x] = 1;
      }
    }
  }
  return outlined;
}

const SHEET_COLS = 8;
const FRAME_COUNT = 32;

function paintSheet(scene, key, palette) {
  const fw = FIREBALL_COLS * FIREBALL_CELL, fh = FIREBALL_ROWS * FIREBALL_CELL;
  const texture = scene.textures.createCanvas(key, fw * SHEET_COLS, fh * (FRAME_COUNT / SHEET_COLS));
  if (!texture) return;
  const ctx = texture.getContext();
  for (let f = 0; f < FRAME_COUNT; f++) {
    const ox = (f % SHEET_COLS) * fw, oy = Math.floor(f / SHEET_COLS) * fh;
    const cells = fireballFrameCells(f);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      ctx.fillStyle = palette[cells[i]];
      ctx.fillRect(ox + (i % FIREBALL_COLS) * FIREBALL_CELL, oy + Math.floor(i / FIREBALL_COLS) * FIREBALL_CELL,
        FIREBALL_CELL, FIREBALL_CELL);
    }
    texture.add(`fire${String(f).padStart(2, "0")}`, 0, ox, oy, fw, fh);
  }
  texture.refresh();
  texture.setFilter?.(0);
}

// ---------------------------------------------------------------------------
// Impact explosion. The ball bursts into a hot white pop, swells into a jagged
// ring of flame tongues that rises as it cools, then breaks apart into embers
// and smoke puffs. Same cell size and palettes as the ball; palette index 6 is
// the team's smoke colour (smoke is never outlined).

export const EXPLOSION_FRAMES = 10;
export const EXPLOSION_COLS = 64;
export const EXPLOSION_ROWS = 72;
const BOOM_CX = 32;
const BOOM_CY = 43;
export const EXPLOSION_ORIGIN = { x: (BOOM_CX + 0.5) / EXPLOSION_COLS, y: (BOOM_CY + 0.5) / EXPLOSION_ROWS };
export const EXPLOSION_SMOKE = { blue: "#26305e", red: "#3b2a33" };

// Seamless noise around the ring: sample on a circle so angle 0 meets 2*PI.
const ringNoise = (theta, radius, size, seed) =>
  noise(Math.cos(theta) * radius + seed, Math.sin(theta) * radius + seed, size, 1 << 20);

export function explosionFrameCells(frame) {
  const t = Math.min(1, Math.max(0, frame / (EXPLOSION_FRAMES - 1)));
  const swell = 1 - (1 - t) * (1 - t) * (1 - t);
  const outer = 7 + 15 * swell;
  // The middle burns out after the pop, leaving a ring that thins as it cools.
  const hollow = t < 0.2 ? 0 : outer * Math.min(0.85, (t - 0.2) * 1.15);
  const rise = t * t * 7;
  const cells = new Uint8Array(EXPLOSION_COLS * EXPLOSION_ROWS);
  const set = (x, y, tone) => {
    // Two cells of margin leave room for the outline inside the frame.
    if (x > 1 && y > 1 && x < EXPLOSION_COLS - 2 && y < EXPLOSION_ROWS - 2) cells[y * EXPLOSION_COLS + x] = tone;
  };
  for (let y = 0; y < EXPLOSION_ROWS; y++) {
    for (let x = 0; x < EXPLOSION_COLS; x++) {
      const u = x - BOOM_CX, v = y - BOOM_CY + rise;
      const theta = Math.atan2(v, u);
      const up = Math.max(0, -Math.sin(theta));
      // Tongues lick outward, longest upward, and churn frame to frame.
      const lick = ringNoise(theta, 3, 1, frame * 0.7) * 0.55 + ringNoise(theta, 6, 1, 40 + frame) * 0.45;
      const edge = outer * (0.72 + 0.42 * lick + 0.3 * up * t);
      const d = Math.hypot(u, v * (1 + 0.15 * (1 - up)));
      if (d > edge) continue;
      const inner = hollow * (0.85 + 0.35 * ringNoise(theta, 4, 1, 90 + frame));
      if (d < inner) continue;
      // Late frames tear the ring into separate blobs.
      const tear = noise(u * 0.9 + frame * 1.7, v * 0.9 - frame * 2.3, 3, 1 << 20);
      if (t > 0.55 && tear < (t - 0.55) * 1.5) continue;
      const depth = inner < d ? (d - inner) / Math.max(1, edge - inner) : 0;
      const heat = 1 - Math.abs(depth - 0.45) * 1.4 - t * 0.85 + (t < 0.15 ? 0.6 : 0);
      set(x, y, heat > 0.62 ? 5 : heat > 0.36 ? 4 : heat > 0.1 ? 3 : 2);
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= EXPLOSION_COLS || y >= EXPLOSION_ROWS ? 0 : cells[y * EXPLOSION_COLS + x]);
  for (let y = 0; y < EXPLOSION_ROWS; y++) {
    for (let x = 0; x < EXPLOSION_COLS; x++) {
      if (at(x, y) && !at(x - 1, y) && !at(x + 1, y) && !at(x, y - 1) && !at(x, y + 1)) cells[y * EXPLOSION_COLS + x] = 0;
    }
  }
  // Embers thrown outward, and smoke puffs that drift up as the fire dies.
  for (let i = 0; i < 9; i++) {
    const theta = i * 2.39 + 0.4;
    const r = outer * (0.95 + 0.5 * t) + (i % 3) * 2;
    const ex = Math.round(BOOM_CX + Math.cos(theta) * r), ey = Math.round(BOOM_CY + Math.sin(theta) * r - rise * 1.4);
    if (t > 0.15 && t < 0.95 && !at(ex, ey)) set(ex, ey, t < 0.45 ? 4 : t < 0.75 ? 3 : 2);
  }
  if (t >= 0.45) {
    for (let i = 0; i < 5; i++) {
      const theta = -Math.PI / 2 + (i - 2) * 0.55;
      const r = outer * (0.55 + 0.2 * (i % 2));
      const px = BOOM_CX + Math.cos(theta) * r, py = BOOM_CY + Math.sin(theta) * r - rise * 1.3;
      const size = 2.2 + (t - 0.45) * 4 - (i % 2) * 0.6;
      for (let y = Math.floor(py - size); y <= Math.ceil(py + size); y++) {
        for (let x = Math.floor(px - size); x <= Math.ceil(px + size); x++) {
          if (!at(x, y) && Math.hypot(x - px, y - py) <= size) set(x, y, 6);
        }
      }
    }
  }
  const outlined = cells.slice();
  for (let y = 0; y < EXPLOSION_ROWS; y++) {
    for (let x = 0; x < EXPLOSION_COLS; x++) {
      if (at(x, y)) continue;
      const fire = n => n > 1 && n < 6;
      if (fire(at(x - 1, y)) || fire(at(x + 1, y)) || fire(at(x, y - 1)) || fire(at(x, y + 1))) outlined[y * EXPLOSION_COLS + x] = 1;
    }
  }
  return outlined;
}

function paintExplosion(scene, key, palette, smoke) {
  const fw = EXPLOSION_COLS * FIREBALL_CELL, fh = EXPLOSION_ROWS * FIREBALL_CELL;
  const texture = scene.textures.createCanvas(key, fw * 5, fh * Math.ceil(EXPLOSION_FRAMES / 5));
  if (!texture) return;
  const ctx = texture.getContext();
  const colours = [...palette, smoke];
  for (let f = 0; f < EXPLOSION_FRAMES; f++) {
    const ox = (f % 5) * fw, oy = Math.floor(f / 5) * fh;
    const cells = explosionFrameCells(f);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      ctx.fillStyle = colours[cells[i]];
      ctx.fillRect(ox + (i % EXPLOSION_COLS) * FIREBALL_CELL, oy + Math.floor(i / EXPLOSION_COLS) * FIREBALL_CELL,
        FIREBALL_CELL, FIREBALL_CELL);
    }
    texture.add(`boom${f}`, 0, ox, oy, fw, fh);
  }
  texture.refresh();
  texture.setFilter?.(0);
}

export const explosionTextureKey = team => `wizard-explosion-${team === "red" ? "red" : "blue"}`;

// Builds both team sheets once per game; later calls are free.
export function ensureFireballTextures(scene) {
  if (!scene?.textures?.createCanvas) return;
  if (!scene.textures.exists("wizard-fireball-unified")) paintSheet(scene, "wizard-fireball-unified", FIREBALL_PALETTES.blue);
  if (!scene.textures.exists("wizard-fireball-red")) paintSheet(scene, "wizard-fireball-red", FIREBALL_PALETTES.red);
  for (const team of ["blue", "red"]) {
    const key = explosionTextureKey(team);
    if (!scene.textures.exists(key)) paintExplosion(scene, key, FIREBALL_PALETTES[team], EXPLOSION_SMOKE[team]);
  }
}
