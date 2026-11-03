#!/usr/bin/env node
// Draws all of Iron Junction's structural and objective art, in code.
//
//   node scripts/maps/build-iron-junction.cjs     <- writes the shape list
//   node scripts/art/bake-iron-junction.cjs       <- bakes it
//   node scripts/maps/build-iron-junction.cjs     <- picks the art back up
//
// Everything is painted on a grid of 4 world pixels from one small palette, so
// the platforms, the vault, the mine, the turret and the walls have the same pixel
// size and the same colours. Only the small wall pieces are painted by Codex; see
// install-iron-junction-deco.cjs. Nothing is scaled at runtime.
//
// Solid ground is drawn from the union of every solid rectangle in the level,
// never from a tile stamped per block. A pixel looks at the air around it: air
// above makes a walking surface, air beside makes an edge. A staircase therefore
// has real treads and risers with no slices to line up, and blocks that touch
// share one brick grid. The grid is folded about the centre line so the right
// half of the level is an exact flip of the left.

const fs = require("fs");
const path = require("path");
const sharp = require(path.resolve(__dirname, "..", "..", "spritesheet-generator", "node_modules", "sharp"));

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "public", "assets", "bank-bust");
const MANIFEST = path.join(ROOT, "scripts", "maps", "iron-junction-shapes.json");

const PX = 4;
const C = {
  ink: "#0b1024", d3: "#141b36", d2: "#1c2546", d1: "#263157", mid: "#32406b",
  l1: "#46567c", l2: "#6a7da3", l3: "#9db0cc", l4: "#d3deea",
  b0: "#5f3a1c", b1: "#a0662a", b2: "#d9983a", b3: "#ffd264", glow: "#ffe9a8",
  hazard: "#e8b33a", red: "#d9503f",
};
const TEAM = { neutral: C.l2, team1: "#54a0ff", team2: "#ff6a6a" };

const rgba = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (!c) { this.d[i + 3] = 0; return; }
    const [r, g, b, a] = rgba(c);
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  on(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[(y * this.w + x) * 4 + 3] > 0; }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  disc(cx, cy, r, c) {
    for (let j = -r - 1; j <= r + 1; j++) for (let i = -r - 1; i <= r + 1; i++) {
      if (i * i + j * j <= r * r + r * 0.6) this.set(cx + i, cy + j, c);
    }
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) this.set(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c);
  }
  /** A dark edge round everything drawn so far, inside the canvas. */
  outline(c = C.ink) {
    const edge = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.on(x, y)) continue;
      if (this.on(x - 1, y) || this.on(x + 1, y) || this.on(x, y - 1) || this.on(x, y + 1)) edge.push([x, y]);
    }
    for (const [x, y] of edge) this.set(x, y, c);
  }
  mirrored() {
    const out = new Pix(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const from = (y * this.w + x) * 4;
      out.d.set(this.d.subarray(from, from + 4), (y * this.w + (this.w - 1 - x)) * 4);
    }
    return out;
  }
  async save(name) {
    const big = Buffer.alloc(this.w * PX * this.h * PX * 4);
    for (let y = 0; y < this.h * PX; y++) for (let x = 0; x < this.w * PX; x++) {
      const s = (Math.floor(y / PX) * this.w + Math.floor(x / PX)) * 4;
      big.set(this.d.subarray(s, s + 4), (y * this.w * PX + x) * 4);
    }
    await sharp(big, { raw: { width: this.w * PX, height: this.h * PX, channels: 4 } })
      .webp({ lossless: true, effort: 6 })
      .toFile(path.join(OUT, name));
  }
}

// ---------------------------------------------------------------------------
// Walking surface
// ---------------------------------------------------------------------------
// The same top edge everywhere: a bright lip, a ticked tread, a dark line, and a
// riveted lintel. It only makes sense one way up, which is the point: the
// old frame looked the same from all four sides and read as a rotated panel.
// Scuffs in the bright lip, hazard paint and bolted plates on a slow rhythm keep a
// long run from reading as one repeated strip.
const LIP_ROWS = 9;
function lipColour(row, x) {
  const span = x % 96;
  if (row === 0) return x % 37 < 2 ? C.l3 : C.l4;
  if (row === 1) return x % 23 < 3 ? C.l2 : C.l3;
  // A short run of worn hazard paint every so often.
  if (span >= 40 && span < 56 && (row === 2 || row === 3)) return (x + row) % 4 < 2 ? C.hazard : C.ink;
  // A bolted repair plate over the lintel.
  if (span >= 66 && span < 82 && row >= 5 && row <= 7) {
    if (row === 6 && (span === 67 || span === 80)) return C.b2;
    return row === 5 ? C.l2 : C.l1;
  }
  // A drain grate let into the tread now and then.
  if (span >= 14 && span < 26 && x % 288 < 96 && (row === 2 || row === 3)) return span % 2 ? C.ink : C.d1;
  if (x % 48 === 0) return row < 4 ? C.mid : C.ink; // a joint between deck plates
  if (x % 48 === 1 && row < 4) return C.l4;
  // Diamond tread: raised bars that alternate direction along the walkway.
  if (row === 2) return x % 4 === 0 ? C.l4 : x % 4 === 1 ? C.l3 : C.l2;
  if (row === 3) return x % 4 === 2 ? C.l3 : x % 4 === 3 ? C.d1 : C.l1;
  if (row === 4) return C.ink;
  if (row === 8) return C.ink;
  if (row === 6 && x % 16 === 8) return C.b2;
  if (row === 6 && x % 16 === 9) return C.b0;
  if (row === 5) return C.l1;
  if (row === 7) return x % 16 < 2 ? C.d2 : C.d1;
  return C.mid;
}

// ---------------------------------------------------------------------------
// Solid ground
// ---------------------------------------------------------------------------
const COURSE = 14;
const BRICK = 32;
const RAMPS = [
  { hi: C.l1, base: C.mid, alt: "#2d3a63", shade: "#2a365c", lo: C.d2 },
  { hi: C.mid, base: C.d1, alt: "#222c50", shade: "#1f294b", lo: C.d3 },
  { hi: C.d1, base: C.d2, alt: "#19213f", shade: "#171f3b", lo: C.ink },
];

// Most bricks are plain, and the odd one is marked: a bolted patch, a crack, a
// rust stain, a chipped corner. Chosen by a hash of the brick, so it stays put and
// mirrors exactly, and the marks take their colours from the brick's own shade.
function brickHash(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function brick(px, y, ramp) {
  const course = Math.floor(y / COURSE);
  const by = y % COURSE;
  const shifted = px + (course % 2 ? BRICK / 2 : 0);
  const bx = shifted % BRICK;
  if (by === COURSE - 1 || bx === 0) return ramp.lo;
  if (by === 0 || bx === 1) return ramp.hi;
  const brickId = Math.floor(shifted / BRICK);
  const mark = brickHash(brickId, course);
  if (mark < 0.025) {
    // A bolted patch.
    if (bx >= 6 && bx <= 25 && by >= 3 && by <= 10) {
      if ((bx === 6 || bx === 25) && (by === 3 || by === 10)) return C.b1;
      if (bx === 6 || bx === 25 || by === 3 || by === 10) return ramp.lo;
      return ramp.hi;
    }
  } else if (mark < 0.055) {
    // A crack running down across the brick.
    const line = 10 + Math.round(by * 0.8 + 2 * Math.sin(by * 1.3));
    if (bx === line) return ramp.lo;
    if (bx === line + 1) return ramp.hi;
  } else if (mark < 0.08) {
    // Rust running from the joint above.
    const streak = (bx * 7) % 5;
    if (bx >= 12 && bx <= 20 && by <= 3 + streak) return by > 1 + streak ? "#3a2c34" : "#5e3b2e";
  } else if (mark < 0.1) {
    // A chipped corner.
    if (bx + by < 7) return bx + by < 5 ? ramp.lo : C.ink;
  }
  // Every brick has a worn lower edge, the odd pit, and its own slight tone.
  if (by === COURSE - 2 && (bx * 13 + course * 7) % 11 < 7) return ramp.shade;
  if (brickHash(shifted, y) < 0.012) return ramp.lo;
  return brickHash(brickId + 40, course) < 0.3 ? ramp.alt : ramp.base;
}

// ---------------------------------------------------------------------------
// Steel plating
// ---------------------------------------------------------------------------
// Solid ground is a wall of bolted steel plates, not bricks. Each course is cut
// into plates of mixed widths, so no two runs repeat, and every plate is
// bevelled, riveted at its corners and given a job by a hash of where it is:
// most are plain and scuffed, and the rest are tread plate, braced, vented,
// hatched or stencilled. Girders, pipe runs and gauges are laid over the plates
// afterwards, so the large shapes break the grid up.
const PLATE_H = 20;
const PLATE_WIDTHS = [24, 32, 32, 40, 48, 56];
const STEEL_RAMPS = [
  { top: C.l2, hi: C.l1, base: C.mid, alt: "#2d3a63", shade: "#2a365c", lo: C.d2 },
  { top: C.l1, hi: C.mid, base: C.d1, alt: "#222c50", shade: "#1f294b", lo: C.d3 },
  { top: C.mid, hi: C.d1, base: C.d2, alt: "#19213f", shade: "#171f3b", lo: C.ink },
  { top: C.d1, hi: C.d2, base: "#18203d", alt: "#151c37", shade: "#131932", lo: C.ink },
];
const RUST = ["#5e3b2e", "#4a3030", "#3a2c34"];

const courseCuts = new Map();
/** The plates of one course as [left, width] pairs, from a little left of 0. */
function cutsFor(course) {
  let cuts = courseCuts.get(course);
  if (cuts) return cuts;
  cuts = [];
  let x = -Math.floor(brickHash(course, 7) * 40);
  for (let k = 0; x < 1400; k++) {
    const w = PLATE_WIDTHS[Math.floor(brickHash(course * 3 + 1, k) * PLATE_WIDTHS.length)];
    cuts.push([x, w]);
    x += w;
  }
  courseCuts.set(course, cuts);
  return cuts;
}

function plateAt(px, y) {
  const course = Math.floor(y / PLATE_H);
  for (const [left, w] of cutsFor(course)) {
    if (px < left + w) return { course, left, w, bx: px - left, by: y - course * PLATE_H, id: Math.floor(left) };
  }
  return { course, left: 0, w: 1, bx: 0, by: 0, id: 0 };
}

const PLATE_KINDS = [
  [0.46, "plain"], [0.6, "riveted"], [0.69, "tread"], [0.76, "brace"],
  [0.82, "hatch"], [0.87, "vent"], [0.9, "stencil"], [0.95, "rust"], [1, "dented"],
];
const plateKind = (id, course) => {
  const n = brickHash(id + 911, course * 5 + 3);
  return PLATE_KINDS.find(([p]) => n < p)[1];
};

/** One pixel of plating. `ramp` is the shade band; `lit` lights vents from inside. */
function steel(px, y, ramp, lit = false) {
  const { course, w, bx, by, id } = plateAt(px, y);
  const h = PLATE_H;
  // Seams: a dark line on the right and bottom of each plate, a lit one on its
  // top and left, and a softer inner bevel one pixel in.
  if (bx === w - 1 || by === h - 1) return ramp.lo;
  if (by === 0 || bx === 0) return ramp.top;
  if (by === 1 || bx === 1) return ramp.hi;
  if (bx === w - 2 || by === h - 2) return ramp.shade;

  // Corner rivets on every plate: a lit cap with a dark underside.
  for (const [rx, ry] of [[3, 3], [w - 5, 3], [3, h - 5], [w - 5, h - 5]]) {
    const dx = bx - rx, dy = by - ry;
    if (dx >= 0 && dx < 2 && dy >= 0 && dy < 2) return dx + dy === 0 ? ramp.top : dx + dy === 2 ? ramp.lo : ramp.hi;
    if (dx === 2 && dy === 2) return ramp.lo;
  }

  const kind = plateKind(id, course);
  const inner = bx >= 3 && bx < w - 3 && by >= 3 && by < h - 3;
  switch (kind) {
    case "riveted": {
      // A line of rivets along the top and bottom seams.
      if ((by === 3 || by === h - 5) && bx > 6 && bx < w - 7 && (bx - 7) % 6 === 0) return ramp.top;
      if ((by === 4 || by === h - 4) && bx > 6 && bx < w - 7 && (bx - 8) % 6 === 0) return ramp.lo;
      break;
    }
    case "tread": {
      // Diamond plate: short raised bars on a staggered diagonal grid.
      if (inner && bx > 4 && bx < w - 5) {
        const row = Math.floor(by / 3);
        const phase = (bx + (row % 2) * 3) % 6;
        if (by % 3 === 1 && phase === 0) return ramp.top;
        if (by % 3 === 2 && phase === 1) return ramp.lo;
        if (by % 3 === 1 && phase === 1) return ramp.hi;
      }
      break;
    }
    case "brace": {
      // An X stamped into the plate, raised and catching the light.
      if (bx >= 4 && bx < w - 4 && by >= 4 && by < h - 4) {
        const u = (bx - 4) / (w - 9), v = (by - 4) / (h - 9);
        const d1 = Math.abs(u - v) * (h - 9), d2 = Math.abs(1 - u - v) * (h - 9);
        if (d1 < 0.6 || d2 < 0.6) return ramp.hi;
        if (d1 < 1.3 || d2 < 1.3) return ramp.lo;
      }
      if ((bx === 4 || bx === w - 5) && by >= 4 && by < h - 4) return ramp.lo;
      if ((by === 4 || by === h - 5) && bx >= 4 && bx < w - 4) return ramp.lo;
      break;
    }
    case "hatch": {
      // An inset access panel with hinges on the left and a brass pull.
      const l = 5, r = w - 6, t = 5, b = h - 6;
      if (bx >= l && bx <= r && by >= t && by <= b) {
        if (bx === l || by === t) return ramp.lo;
        if (bx === r || by === b) return ramp.top;
        if ((bx === l + 1) && (by === t + 2 || by === b - 2)) return ramp.top;
        if (bx >= r - 4 && bx <= r - 2 && by === Math.round((t + b) / 2)) return C.b2;
        if (bx >= r - 4 && bx <= r - 2 && by === Math.round((t + b) / 2) + 1) return C.b0;
        return ramp.alt;
      }
      break;
    }
    case "vent": {
      // Louvres: slats with dark gaps, lit from inside on the upper courses.
      if (bx >= 5 && bx < w - 5 && by >= 5 && by < h - 5) {
        if (bx === 5 || bx === w - 6 || by === 5 || by === h - 6) return C.ink;
        const slat = (by - 6) % 3;
        if (slat === 0) return ramp.hi;
        if (slat === 1) return ramp.lo;
        return lit ? ((bx + by) % 5 === 0 ? C.b3 : C.b2) : C.ink;
      }
      break;
    }
    case "stencil": {
      // A brass ID plate with stamped figures.
      const pw = Math.min(16, w - 10), l = Math.floor((w - pw) / 2), t = 7;
      if (bx >= l && bx < l + pw && by >= t && by < t + 6) {
        if (bx === l || bx === l + pw - 1 || by === t || by === t + 5) return C.b0;
        if (by === t + 1) return C.b2;
        const glyph = Math.floor((bx - l - 1) / 3);
        const col = (bx - l - 1) % 3;
        const on = col < 2 && brickHash(id + glyph * 17, course + (by - t) * 3) < 0.55;
        return on ? C.b0 : C.b1;
      }
      break;
    }
    case "rust": {
      // Rust bleeding from the seam above, longest in the middle of the run.
      const streak = Math.floor(brickHash(id + bx, course) * 6) + (bx % 3);
      if (bx >= 6 && bx < Math.min(w - 6, 18) && by >= 2 && by < 3 + streak) {
        return RUST[Math.min(2, Math.floor((by - 2) / 3))];
      }
      break;
    }
    case "dented": {
      // A dent: a dark crescent above a lit one.
      const cx = Math.floor(w / 2) + Math.floor(brickHash(id, course + 1) * 8) - 4, cy = 10;
      const d = (bx - cx) ** 2 + ((by - cy) * 1.6) ** 2;
      if (d < 10 && by < cy) return ramp.lo;
      if (d < 10 && by >= cy) return ramp.hi;
      break;
    }
  }
  // Scuffs: a short diagonal scratch on some plates, and the odd pit.
  const scratch = brickHash(id + 3, course + 9);
  if (scratch < 0.35 && inner) {
    const sx = 6 + Math.floor(scratch * 60) % Math.max(1, w - 14), sy = 6 + Math.floor(scratch * 37) % 8;
    const k = bx - sx;
    if (k >= 0 && k < 4 && by === sy + (k >> 1)) return ramp.hi;
  }
  if (brickHash(px, y) < 0.003) return ramp.lo;
  // A slightly darker lower third, so each plate reads as a curved sheet.
  if (by > h - 6) return ramp.alt;
  return brickHash(id + 40, course) < 0.3 ? ramp.alt : ramp.base;
}

// Structural steel laid over the plates. Positions are in folded art pixels.
const GIRDER_EVERY = 168, GIRDER_W = 12;
function girder(px, y, ramp) {
  const gx = (px + 60) % GIRDER_EVERY;
  if (gx >= GIRDER_W) return null;
  // An I-beam face on: two flanges with a recessed web between them.
  if (gx === 0 || gx === GIRDER_W - 1) return C.ink;
  if (gx === 1) return ramp.top;
  if (gx === 2 || gx === 3) return (y % 12 === 4 && gx === 2) ? C.b2 : (y % 12 === 5 && gx === 3) ? C.b0 : ramp.hi;
  if (gx === 4 || gx === 7) return ramp.lo;
  if (gx === 8 || gx === 9) return (y % 12 === 10 && gx === 9) ? C.b2 : (y % 12 === 11 && gx === 8) ? C.b0 : ramp.base;
  if (gx === 10) return ramp.shade;
  // The web: darker, with lightening holes every so often.
  const hole = y % 30;
  if (hole >= 12 && hole < 18) return C.ink;
  if (hole === 11) return ramp.lo;
  return ramp.alt;
}

const PIPE_ROWS = [
  [C.ink, C.l3, C.l2, C.l1, C.l1, C.mid, C.d1, C.ink],
  [C.ink, C.l2, C.l1, C.mid, C.mid, C.d1, C.d2, C.ink],
  [C.ink, C.l1, C.mid, C.d1, C.d1, C.d2, C.d3, C.ink],
];
const PIPE_H = 8;
const FLANGE_EVERY = 56;
// Columns a gauge's centre needs on each side: its radius plus the side trim.
const GAUGE_CLEAR = 10;
/** A horizontal pipe whose top row is `top`, with flanges and the odd gauge. */
function pipe(px, y, top, shadeIndex, gaugeFits = () => true) {
  const row = y - top;
  const flange = (px + 20) % FLANGE_EVERY;
  const tones = PIPE_ROWS[Math.min(PIPE_ROWS.length - 1, shadeIndex)];
  if (flange < 5 && row >= -2 && row <= PIPE_H + 1) {
    // A bolted collar, a little proud of the pipe.
    if (row === -2 || row === PIPE_H + 1 || flange === 0 || flange === 4) return C.ink;
    if ((row === 0 || row === PIPE_H - 1) && flange === 2) return C.b2;
    if ((row === 1 || row === PIPE_H) && flange === 2) return C.b0;
    return flange === 1 ? tones[1] : flange === 3 ? tones[6] : tones[3];
  }
  // A strap bracket holding the pipe to the wall halfway between collars.
  if (flange >= 27 && flange < 30 && row >= -1 && row <= PIPE_H) {
    if (row === -1 || row === PIPE_H) return flange === 28 ? C.b1 : C.ink;
  }
  // A pressure gauge on a short stem on every third length of pipe.
  const length = Math.floor((px + 20) / FLANGE_EVERY);
  const gx = flange - 30;
  if (length % 3 === 1 && shadeIndex === 0 && gaugeFits(gx)) {
    const gy = row + 6;
    const r2 = gx * gx + gy * gy;
    if (r2 <= 22) {
      if (r2 >= 15) return C.ink;
      if (r2 >= 11) return gx + gy < 0 ? C.b2 : C.b1;
      if (gx === 0 && gy === 0) return C.ink;
      if ((gx === 1 && gy === -1) || (gx === 2 && gy === -2)) return C.red;
      if (gy === 2 && Math.abs(gx) <= 1) return C.l2;
      return gx + gy < 0 ? C.l4 : C.l3;
    }
    if (gx === 0 && row >= -1 && row < 0) return C.d1;
  }
  if (row < 0 || row >= PIPE_H) return null;
  return tones[row];
}

// One step darker along the palette, for colours in a shadow.
const DARKER = {
  [C.l4]: C.l3, [C.l3]: C.l2, [C.l2]: C.l1, [C.l1]: C.mid, [C.mid]: C.d1, [C.d1]: C.d2,
  [C.d2]: C.d3, [C.d3]: C.ink, [C.ink]: C.ink, [C.b3]: C.b2, [C.b2]: C.b1, [C.b1]: C.b0, [C.b0]: C.ink,
};
function shadeOf(c) {
  if (!c) return c;
  if (DARKER[c]) return DARKER[c];
  const [r, g, b] = rgba(c);
  const k = 0.7;
  return `#${[r * k, g * k, b * k].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function solidPainter(solids, worldW, midRow, bottomRow, shadeRow) {
  const W = Math.round(worldW / PX);
  const rows = bottomRow + 1;
  const hit = new Uint8Array(W * rows);
  for (const s of solids) {
    for (let y = Math.max(0, Math.round((s.top + 600) / PX)); y < rows; y++) {
      if (y >= Math.round((s.bottom + 600) / PX)) break;
      for (let x = Math.round(s.left / PX); x < Math.round(s.right / PX); x++) hit[y * W + x] = 1;
    }
  }
  const solid = (x, y) => x >= 0 && x < W && y >= 0 && y < rows && hit[y * W + x] === 1;
  const reach = (x, y, dx, dy, max) => {
    for (let k = 1; k <= max; k++) if (!solid(x + dx * k, y + dy * k)) return k - 1;
    return max;
  };
  return (x, y) => {
    if (!solid(x, y)) return null;
    const px = Math.min(x, W - 1 - x); // folded so both halves mirror exactly
    const toTop = reach(x, y, 0, -1, LIP_ROWS + 4);
    const toLeft = reach(x, y, -1, 0, 5);
    const toRight = reach(x, y, 1, 0, 5);
    if (toTop === 0 && (toLeft === 0 || toRight === 0)) return null; // eased corner
    if (toLeft === 0 || toRight === 0) return C.ink;
    if (toTop < LIP_ROWS) return lipColour(toTop, px);
    // The underside of anything with air below it, which is the tunnel's roof:
    // a riveted angle iron along the edge.
    const toBottom = reach(x, y, 0, 1, 4);
    if (toBottom === 0) return C.ink;
    if (toBottom === 1) return px % 10 === 3 ? C.b1 : C.d1;
    if (toBottom === 2) return C.d3;
    if (toBottom === 3) return C.ink;

    // Plates darken in steps by course, never part way through a plate.
    const course = Math.floor(y / PLATE_H);
    const depth = (course * PLATE_H + PLATE_H / 2 - midRow) / Math.max(1, shadeRow - midRow);
    const band = Math.min(STEEL_RAMPS.length - 1, Math.max(0, Math.floor(depth * STEEL_RAMPS.length)));
    const ramp = STEEL_RAMPS[band];

    // Angle iron down every exposed side: lit on the left of a block, in shade
    // on the right, riveted along its length.
    if (toLeft <= 4) {
      if (toLeft === 4) return C.ink;
      if (toLeft === 2 && y % 8 === 4) return C.b2;
      if (toLeft === 3 && y % 8 === 5) return C.b0;
      return toLeft === 1 ? C.l2 : toLeft === 2 ? C.l1 : C.mid;
    }
    if (toRight <= 4) {
      if (toRight === 4) return C.ink;
      if (toRight === 3 && y % 8 === 4) return C.b1;
      return toRight === 1 ? C.d3 : toRight === 2 ? C.d2 : C.d1;
    }

    // The lip throws a shadow on the first rows of plating under it.
    const under = toTop - LIP_ROWS;
    if (under === 0) return C.ink;

    // Two pipe runs through the upper courses, in front of everything.
    const pipes = [midRow + 46, midRow + 118];
    // A gauge only goes where the whole dial clears the angle iron at the
    // block's sides; one at an edge would be sliced in half.
    const mirror = px === x ? 1 : -1;
    const gaugeAt = (top) => (gx) => {
      const cx = x - mirror * gx;
      return reach(cx, top, -1, 0, GAUGE_CLEAR) >= GAUGE_CLEAR && reach(cx, top, 1, 0, GAUGE_CLEAR) >= GAUGE_CLEAR;
    };
    for (let k = 0; k < pipes.length; k++) {
      const c = pipe(px, y, pipes[k], band + k, gaugeAt(pipes[k]));
      if (c) return c;
    }
    // Cable sagging between girders, lower down where it is darker.
    const cableTop = midRow + 82;
    const bay = (px + 60) % GIRDER_EVERY;
    if (bay >= GIRDER_W) {
      const t = (bay - GIRDER_W) / (GIRDER_EVERY - GIRDER_W);
      const cy = cableTop + Math.round(Math.sin(t * Math.PI) * 9);
      if (y === cy) return C.ink;
      if (y === cy - 1) return ramp.top;
      if (y === cy + 1) return ramp.lo;
    }
    // Pipes throw a short shadow on the plates below them.
    const shadowed = pipes.some((top) => y >= top + PIPE_H + 2 && y < top + PIPE_H + 4 && (px + 20) % FLANGE_EVERY >= 5);
    const g = girder(px, y, ramp);
    if (g) return under < 3 ? C.d3 : g;

    const c = steel(px, y, ramp, band === 0);
    return under < 3 || shadowed ? shadeOf(c) : c;
  };
}

function bakeSolid(shape, paint) {
  const left = Math.round(shape.left / PX);
  const top = Math.round((shape.top + 600) / PX);
  const img = new Pix(Math.round(shape.width / PX), Math.round(shape.height / PX));
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const c = paint(left + x, top + y);
    if (c) img.set(x, y, c);
  }
  return img;
}

// ---------------------------------------------------------------------------
// The tunnel's back wall
// ---------------------------------------------------------------------------
// The same brick in deep shadow, with piers and one pipe along the run, and the
// fixtures the lamps shine from. The top rows are hidden behind the ground except
// in the shafts and the side passages.
function bakeTunnelBack(shape, lamps, tunnelCeiling) {
  const img = new Pix(Math.round(shape.width / PX), Math.round(shape.height / PX));
  const roof = Math.round((tunnelCeiling - shape.top) / PX);
  const BAY = 60;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const px = Math.min(x, img.w - 1 - x);
    let c = steel(px, y + 7, STEEL_RAMPS[3]);
    const bay = (px + BAY / 2) % BAY;
    if (bay < 6 && y >= roof) c = bay === 0 ? C.d1 : bay === 5 ? C.ink : C.d2;
    if (y >= roof + 17 && y <= roof + 19) c = y === roof + 17 ? C.mid : y === roof + 19 ? C.ink : C.d1;
    if (bay < 6 && y === roof + 3 && bay % 3 === 1) c = C.b2;
    img.set(x, y, c);
  }
  for (const lamp of lamps) {
    const x = Math.round((lamp.x - shape.left) / PX);
    const y = Math.round((lamp.y - shape.top) / PX);
    img.rect(x - 3, y, 7, 3, C.ink);
    img.rect(x - 2, y, 5, 1, C.d1);
    img.rect(x - 2, y + 3, 5, 1, C.b3);
    img.rect(x - 1, y + 3, 3, 1, C.glow);
  }
  return img;
}

// ---------------------------------------------------------------------------
// The side walls
// ---------------------------------------------------------------------------
// A column on the face you can touch: two rails running the full height and
// plate joints crossing between them, catching the light on the inner side.
// Behind it the same brick as the ground runs off the edge of the screen, in the
// darkest shade, so the wall is solid rather than a sheet with a gap behind it.
const WALL_FACE = 24;
function bakeWall(shape) {
  const img = new Pix(Math.round(shape.width / PX), Math.round(shape.height / PX));
  const w = WALL_FACE;
  const mass = img.w - WALL_FACE;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < mass; x++) {
      img.set(x, y, steel(x, y, STEEL_RAMPS[2]));
    }
    for (let x = 0; x < w; x++) {
      let c = C.d1;
      if (x < 3) c = C.d3;
      else if (x < 7) c = x === 3 ? C.l1 : x === 6 ? C.ink : C.mid;
      else if (x >= w - 7) {
        const from = x - (w - 7);
        c = from === 0 ? C.ink : from === 5 ? C.l3 : from === 6 ? C.ink : from === 1 ? C.mid : C.l1;
      } else if (x === 7) c = C.d3;
      const band = y % 40;
      if (x >= 7 && x < w - 7) {
        if (band === 0) c = C.ink;
        else if (band === 1) c = C.l1;
        else if (band === 2 || band === 3) c = C.mid;
      }
      if ((x === 4 || x === w - 4) && band % 10 === 5) c = C.b2;
      if (x >= 7 && x < w - 7) {
        if (x === 12 && band > 4) c = C.d3;
        if (band === 2 && (x === 9 || x === w - 9)) c = C.b2;
        if (band === 22 && x >= 9 && x <= 14) c = band === 22 && x % 2 ? C.d3 : C.d2;
        if (band === 39) c = C.d3;
      }
      img.set(mass + x, y, c);
    }
  }
  // A riser pipe up the wall beside the column, collared and strapped, with a
  // valve wheel at about head height.
  const tones = PIPE_ROWS[1];
  const px0 = mass - 14;
  for (let y = 0; y < img.h; y++) {
    const collar = y % 56;
    for (let k = 0; k < PIPE_H; k++) {
      let c = tones[k];
      if (collar < 5) c = collar === 0 || collar === 4 ? C.ink : k === 1 ? tones[1] : k === 2 && collar === 2 ? C.b2 : tones[3];
      img.set(px0 + k, y, c);
    }
    if (collar < 5) { img.set(px0 - 1, y, C.ink); img.set(px0 + PIPE_H, y, C.ink); }
  }
  for (let vy = 150; vy < img.h; vy += 224) {
    const cx = px0 + PIPE_H / 2, cy = vy;
    img.disc(cx, cy, 6, C.ink);
    img.disc(cx, cy, 5, C.red);
    img.disc(cx, cy, 3, C.ink);
    img.disc(cx, cy, 2, "#8e2f2b");
    for (const [dx, dy] of [[0, -4], [0, 4], [-4, 0], [4, 0]]) img.set(cx + dx, cy + dy, "#8e2f2b");
    img.rect(cx - 1, cy - 1, 2, 2, C.l3);
    img.set(cx - 3, cy - 4, "#ff8a76");
    img.set(cx - 4, cy - 3, "#ff8a76");
  }
  return img;
}

// ---------------------------------------------------------------------------
// Walkways
// ---------------------------------------------------------------------------
function paintWalkway(img, rows) {
  const w = img.w;
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) {
    if (y === 0 && (x === 0 || x === w - 1)) continue;
    img.set(x, y, x === 0 || x === w - 1 ? C.ink : lipColour(y, x));
  }
}

/** A catwalk: the same top edge as the ground, on a truss that is only decoration. */
function bakeDeck(shape) {
  const img = new Pix(Math.round(shape.width / PX), Math.round(shape.height / PX));
  paintWalkway(img, LIP_ROWS);
  const w = img.w, h = img.h;
  const top = LIP_ROWS, bottom = h - 3;
  // A Warren truss: top and bottom chords, diagonals two pixels thick that
  // alternate direction from node to node, and a vertical at every other node.
  const PERIOD = 14;
  const start = Math.floor(((w - 2) % PERIOD) / 2) + 1; // centred, so both ends match
  for (let x = 1; x < w - 1; x++) {
    const p = (x - start + PERIOD * 100) % PERIOD;
    const node = Math.floor((x - start + PERIOD * 100) / PERIOD);
    const t = p / PERIOD;
    const y = Math.round(top + 1 + (node % 2 ? 1 - t : t) * (bottom - top - 2));
    img.set(x, y, C.l1);
    img.set(x, y + 1, C.mid);
    img.set(x, y + 2, C.ink);
  }
  for (let x = 1; x < w - 1; x++) {
    // Chords.
    img.set(x, top, C.d1);
    img.set(x, top + 1, C.ink);
    img.set(x, bottom, C.l1);
    img.set(x, bottom + 1, C.mid);
    img.set(x, bottom + 2, C.ink);
  }
  for (let x = start; x < w - 1; x += PERIOD) {
    const node = Math.floor((x - start) / PERIOD);
    if (node % 2 === 0) for (let j = top + 2; j < bottom; j++) { img.set(x, j, C.mid); img.set(x + 1, j, C.ink); }
    // A gusset plate at each node with a brass rivet, top and bottom.
    const atTop = node % 2 === 0;
    const gy = atTop ? top : bottom - 1;
    img.rect(x - 2, gy, 5, 3, C.l1);
    img.rect(x - 2, gy + (atTop ? 2 : 0), 5, 1, atTop ? C.ink : C.l2);
    img.set(x - 2, gy + 1, C.ink);
    img.set(x + 2, gy + 1, C.ink);
    img.set(x, gy + 1, C.b2);
    img.set(x + 1, gy + 1, C.b0);
  }
  // End posts, riveted, so a deck stops as a made thing rather than a cut.
  for (const x of [1, w - 4]) {
    img.rect(x, top, 3, h - top, C.mid);
    img.rect(x, top, 1, h - top, C.l1);
    img.rect(x + 2, top, 1, h - top, C.ink);
    for (let j = top + 2; j < h - 1; j += 3) img.set(x + 1, j, C.b1);
  }
  // A caged work lamp hung in the middle of every few bays.
  for (let x = start + PERIOD * 3 + PERIOD / 2; x < w - PERIOD; x += PERIOD * 6) {
    const lx = Math.round(x), ly = top + 2;
    img.rect(lx - 3, ly, 7, 2, C.ink);
    img.rect(lx - 2, ly, 5, 1, C.l1);
    img.rect(lx - 2, ly + 2, 5, 4, C.b3);
    img.rect(lx - 1, ly + 2, 2, 3, C.glow);
    for (const cx of [lx - 3, lx + 3]) for (let j = ly + 2; j < ly + 6; j++) img.set(cx, j, C.ink);
    img.rect(lx - 2, ly + 4, 5, 1, C.b1);
    img.rect(lx - 2, ly + 6, 5, 1, C.ink);
    img.set(lx + 1, ly + 3, C.b2);
  }
  return img;
}

/** A small floating step: the top edge, a riveted fascia and a knee brace under each end. */
function bakeLedge(shape) {
  const img = new Pix(Math.round(shape.width / PX), Math.round(shape.height / PX));
  paintWalkway(img, Math.min(LIP_ROWS - 1, img.h));
  const w = img.w, h = img.h;
  const y0 = LIP_ROWS - 1;
  for (let y = y0; y < h; y++) {
    const inset = 1 + (y - y0) * 2;
    for (let x = inset; x < w - inset; x++) {
      const last = y === h - 1;
      img.set(x, y, last ? C.ink : x === inset ? C.l1 : x === w - inset - 1 ? C.d3 : y === y0 ? C.ink : C.d1);
    }
  }
  // Rivets along the fascia, and a little amber indicator in the middle.
  for (let x = 4; x < w - 4; x += 5) img.set(x, y0 + 1, C.b1);
  const mid = Math.floor(w / 2);
  img.rect(mid - 1, y0 + 1, 3, 1, C.ink);
  img.set(mid, y0 + 1, C.b3);
  return img;
}

// ---------------------------------------------------------------------------
// The vault: three states of one door
// ---------------------------------------------------------------------------
// The door stands up on three steps between two gilt plinths, so the foot of the
// frame is a stair and not a slab. The frame is the vault's hit box, so the steps
// fit inside it rather than widening it.
const VAULT_W = 54, VAULT_H = 56;
const VAULT_DOOR_Y = 26;
const VAULT_FOOT = 47;
const VAULT_PLINTH = 9;
function vaultFrame(lampColour) {
  const v = new Pix(VAULT_W, VAULT_H);
  const W = VAULT_W, right = (x) => W - 1 - x;
  v.rect(0, 0, W, VAULT_FOOT, C.ink);
  v.rect(1, 1, W - 2, VAULT_FOOT - 1, C.d2);
  v.rect(1, 1, W - 2, 5, C.l1);
  v.rect(1, 1, W - 2, 1, C.l3);
  v.rect(1, 6, W - 2, 1, C.ink);
  // A gold bead along the foot of the cornice.
  for (let x = 9; x < W - 9; x++) v.set(x, 5, x % 3 === 0 ? C.b3 : x % 3 === 1 ? C.b1 : C.b0);
  for (const x of [2, 47]) {
    v.rect(x, 7, 5, VAULT_FOOT - 7, C.mid);
    v.rect(x, 7, 1, VAULT_FOOT - 7, C.l1);
    v.rect(x + 4, 7, 1, VAULT_FOOT - 7, C.ink);
  }
  for (const x of [2, 47]) for (let y = 11; y < VAULT_FOOT - 4; y += 10) {
    v.rect(x, y, 5, 2, C.d1);
    v.set(x + 2, y, C.b2);
  }
  // Gilt gusset plates in the corners of the field, behind the door, each with a
  // scroll worked into it and a lit rivet.
  for (const [gx, gy, sx, sy] of [[8, 8, 1, 1], [45, 8, -1, 1], [8, 45, 1, -1], [45, 45, -1, -1]]) {
    for (let j = 0; j < 9; j++) for (let i = 0; i < 9 - j; i++) {
      const edge = i === 8 - j;
      const scroll = i + j === 5 || (i === 3 && j === 3);
      v.set(gx + i * sx, gy + j * sy, edge ? C.ink : j === 0 || i === 0 ? C.b3 : scroll ? C.b0 : C.b1);
    }
    v.set(gx + 2 * sx, gy + 2 * sy, C.glow);
    v.set(gx + 3 * sx, gy + 2 * sy, C.b2);
    v.set(gx + 2 * sx, gy + 3 * sy, C.b2);
  }
  // Gold brackets folded round the two top corners, a jewel set in each.
  for (const flip of [false, true]) {
    const at = (x) => (flip ? right(x) : x);
    for (let i = 1; i <= 8; i++) {
      v.set(at(i), 1, C.b3);
      v.set(at(i), 2, i === 8 ? C.b0 : C.b2);
      v.set(at(i), 3, i > 2 ? C.ink : C.b1);
      v.set(at(1), i, C.b3);
      v.set(at(2), i, i === 8 ? C.b0 : C.b2);
      v.set(at(3), i, i > 2 ? C.ink : C.b1);
    }
    v.rect(Math.min(at(2), at(3)), 2, 2, 2, C.ink);
    v.set(at(2), 2, C.glow);
    v.set(at(3), 3, C.b3);
    // A finial on the outer tip of each arm.
    v.set(at(9), 1, C.b2);
    v.set(at(9), 2, C.b0);
    v.set(at(1), 9, C.b2);
    v.set(at(2), 9, C.b0);
  }
  // The lamp over the door, caged.
  v.rect(21, 1, 12, 5, C.ink);
  v.rect(22, 2, 10, 3, lampColour);
  v.rect(22, 2, 10, 1, C.glow);
  for (let x = 24; x < 31; x += 3) v.rect(x, 2, 1, 3, C.ink);

  // The foot: a dark threshold between the plinths, and the steps over it.
  v.rect(0, VAULT_FOOT, W, VAULT_H - VAULT_FOOT, C.ink);
  v.rect(VAULT_PLINTH, VAULT_FOOT, W - VAULT_PLINTH * 2, VAULT_H - VAULT_FOOT - 1, C.d3);
  const steps = [[15, VAULT_FOOT], [12, VAULT_FOOT + 3], [VAULT_PLINTH, VAULT_FOOT + 6]];
  for (const [left, top] of steps) {
    const w = W - left * 2;
    v.rect(left, top, w, 3, C.ink);
    v.rect(left, top, w - 1, 1, C.l4);
    v.rect(left + 1, top + 1, w - 2, 1, C.l2);
    v.rect(left + 1, top + 2, w - 2, 1, C.l1);
    // Brass treads where the door's traffic has worn the steel down.
    for (let x = left + 3; x < left + w - 3; x += 4) v.set(x, top, C.b3);
  }
  v.rect(VAULT_PLINTH, VAULT_H - 1, W - VAULT_PLINTH * 2, 1, C.ink);
  // The gilt plinths either side, each with a cap, a rosette and a base.
  for (const flip of [false, true]) {
    const x0 = flip ? W - VAULT_PLINTH : 0;
    const w = VAULT_PLINTH;
    v.rect(x0, VAULT_FOOT, w, 2, C.b3);
    v.rect(x0, VAULT_FOOT + 1, w, 1, C.b2);
    v.rect(x0, VAULT_FOOT + 2, w, 1, C.ink);
    v.rect(x0 + 1, VAULT_FOOT + 3, w - 2, 5, C.mid);
    v.rect(x0 + 1, VAULT_FOOT + 3, 1, 5, C.l1);
    v.rect(x0 + w - 2, VAULT_FOOT + 3, 1, 5, C.d1);
    const rx = x0 + Math.floor(w / 2), ry = VAULT_FOOT + 5;
    v.rect(rx - 1, ry - 1, 3, 3, C.b1);
    v.set(rx, ry - 1, C.b3);
    v.set(rx - 1, ry, C.b2);
    v.set(rx, ry, C.glow);
    v.set(rx + 1, ry + 1, C.b0);
    v.rect(x0, VAULT_H - 1, w, 1, C.ink);
    v.rect(x0, VAULT_H - 2, w, 1, C.b1);
    v.rect(x0 + (flip ? 0 : 1), VAULT_H - 2, w - 1, 1, C.b2);
  }
  // Outline the whole frame again, over the corner gold.
  v.rect(0, 0, W, 1, C.ink);
  v.rect(0, 0, 1, VAULT_H, C.ink);
  v.rect(W - 1, 0, 1, VAULT_H, C.ink);
  return v;
}

function doorRing(v, cx, cy, boltAt = () => true) {
  v.disc(cx, cy, 20, C.ink);
  v.disc(cx, cy, 19, C.l2);
  v.disc(cx - 1, cy - 1, 18, C.l1);
  v.disc(cx, cy, 16, C.ink);
  v.disc(cx, cy, 15, C.mid);
  for (let j = -15; j <= 15; j++) for (let i = -15; i <= 15; i++) {
    if (i * i + j * j <= 225 && i + j > 8) v.set(cx + i, cy + j, C.d1);
    // Plate seams across the door, and a lit arc on its upper left.
    if (i * i + j * j <= 196 && (i === 0 || j === 0)) v.set(cx + i, cy + j, C.d2);
    const r = i * i + j * j;
    if (r >= 170 && r <= 196 && i + j < -10) v.set(cx + i, cy + j, C.l1);
  }
  // A stepped inner face: a dark groove with a lit lip inside it.
  for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) {
    const r = i * i + j * j;
    if (r >= 110 && r <= 132) v.set(cx + i, cy + j, i + j < 0 ? C.ink : C.d2);
    if (r >= 92 && r < 110 && i + j < -4) v.set(cx + i, cy + j, C.l1);
  }
  // A ring of rivets on the door face.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const x = Math.round(cx + Math.cos(a) * 13.5), y = Math.round(cy + Math.sin(a) * 13.5);
    v.set(x, y, Math.cos(a) + Math.sin(a) < 0 ? C.l3 : C.l2);
    v.set(x + 1, y + 1, C.ink);
  }
  // Locking bolts round the rim, each a shaded brass lug.
  for (let k = 0; k < 12; k++) {
    if (!boltAt(k)) continue;
    const a = (k * Math.PI) / 6 + Math.PI / 12;
    const x = Math.round(cx + Math.cos(a) * 18) - 1, y = Math.round(cy + Math.sin(a) * 18) - 1;
    v.rect(x, y, 3, 3, C.ink);
    v.set(x, y, C.b3);
    v.set(x + 1, y, C.b2);
    v.set(x, y + 1, C.b2);
    v.set(x + 1, y + 1, C.b1);
  }
  // Two hinge barrels on the left, pinned top and bottom.
  for (const hy of [cy - 12, cy + 5]) {
    v.rect(cx - 22, hy, 4, 8, C.ink);
    v.rect(cx - 21, hy + 1, 2, 6, C.l2);
    v.rect(cx - 21, hy + 1, 1, 6, C.l3);
    v.set(cx - 20, hy + 3, C.d1);
    v.set(cx - 20, hy, C.b2);
    v.set(cx - 20, hy + 7, C.b1);
  }
}

function doorWheel(v, cx, cy, turn = 0) {
  // Six spokes, a shaded rim, and a knob where each spoke meets the rim.
  for (let k = 0; k < 6; k++) {
    const a = turn + (k * Math.PI) / 3;
    v.line(cx + 1, cy + 1, cx + 1 + Math.cos(a) * 8, cy + 1 + Math.sin(a) * 8, C.b0);
    v.line(cx, cy, cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, C.b2);
  }
  for (let j = -10; j <= 10; j++) for (let i = -10; i <= 10; i++) {
    const r = i * i + j * j;
    if (r <= 100 && r > 81) v.set(cx + i, cy + j, C.b0);
    else if (r <= 81 && r >= 56) v.set(cx + i, cy + j, i + j < -3 ? C.b3 : i + j > 3 ? C.b1 : C.b2);
  }
  for (let k = 0; k < 6; k++) {
    const a = turn + (k * Math.PI) / 3;
    const x = Math.round(cx + Math.cos(a) * 11), y = Math.round(cy + Math.sin(a) * 11);
    v.rect(x - 1, y - 1, 3, 3, C.ink);
    v.set(x - 1, y - 1, C.b3);
    v.set(x, y - 1, C.b2);
    v.set(x - 1, y, C.b2);
    v.set(x, y, C.b1);
  }
  v.disc(cx, cy, 3, C.b0);
  v.disc(cx, cy, 2, C.b2);
  v.set(cx - 1, cy - 1, C.glow);
  v.set(cx, cy - 1, C.b3);
}

function bakeVaults() {
  const cx = 27, cy = VAULT_DOOR_Y;
  const intact = vaultFrame(C.b3);
  doorRing(intact, cx, cy);
  doorWheel(intact, cx, cy);

  const damaged = vaultFrame(C.red);
  doorRing(damaged, cx, cy, (k) => k !== 1 && k !== 4);
  doorWheel(damaged, cx, cy, 0.5);
  for (const crack of [[[10, 14], [16, 18], [14, 24], [21, 28]], [[44, 36], [38, 33], [39, 28], [33, 31]], [[30, 42], [28, 36], [31, 34]]]) {
    for (let i = 0; i < crack.length - 1; i++) {
      damaged.line(...crack[i], ...crack[i + 1], C.ink);
      damaged.line(crack[i][0] + 1, crack[i][1], crack[i + 1][0] + 1, crack[i + 1][1], C.l3);
    }
  }
  damaged.disc(38, 16, 3, C.d3);
  damaged.disc(16, 36, 2, C.d3);

  const breached = vaultFrame(C.d3);
  breached.disc(cx, cy, 20, C.ink);
  breached.disc(cx, cy, 19, C.l1);
  breached.disc(cx, cy, 16, C.ink);
  breached.disc(cx, cy, 15, C.d3);
  // Nearly empty: a last scatter of coins on the floor of the hole.
  for (const [x, y] of [[20, 38], [24, 39], [28, 38], [32, 39], [23, 36], [29, 36]]) breached.rect(x, y, 2, 2, x % 3 ? C.b2 : C.b3);
  // The door, swung open on its hinge and seen edge on.
  breached.rect(2, 10, 10, 34, C.ink);
  breached.rect(3, 11, 8, 32, C.mid);
  breached.rect(3, 11, 2, 32, C.l2);
  breached.rect(6, 22, 4, 8, C.b2);
  breached.rect(7, 24, 2, 4, C.b3);
  for (const [x, y] of [[40, 10], [44, 20], [42, 38], [36, 43]]) breached.rect(x, y, 3, 2, C.ink);
  return { "vault-intact.webp": intact, "vault-damaged.webp": damaged, "vault-breached.webp": breached };
}

// ---------------------------------------------------------------------------
// The mine: a hopper of gold on legs
// ---------------------------------------------------------------------------
// The plate on the hopper is where the game writes the mine's coin count.
const MINE_PLATE = { left: 11, top: 13, width: 18, height: 5 };
function bakeMine(accent, f) {
  const m = new Pix(40, 34);
  // Legs and feet.
  for (const x of [8, 29]) {
    m.rect(x, 19, 3, 13, C.mid);
    m.rect(x, 19, 1, 13, C.l1);
    m.rect(x - 2, 32, 7, 2, C.l1);
  }
  m.line(10, 22, 30, 31, C.d1);
  m.line(30, 22, 10, 31, C.d1);
  // Heap of gold, behind the rim. It glints a little differently each frame.
  for (let y = 0; y < 8; y++) {
    const half = Math.round(Math.sqrt(1 - ((8 - y) / 8.5) ** 2) * 15);
    for (let x = 20 - half; x <= 20 + half; x++) {
      const n = (x * 7 + y * 13 + f * 5) % 11;
      m.set(x, y + 1, n < 2 ? C.b1 : n < 8 ? C.b2 : C.b3);
    }
  }
  // Hopper narrowing to a chute.
  for (let y = 9; y < 21; y++) {
    const inset = Math.round(((y - 9) / 12) * 9);
    for (let x = 4 + inset; x < 36 - inset; x++) {
      const across = (x - 4 - inset) / (32 - 2 * inset);
      m.set(x, y, across < 0.18 ? C.l2 : across > 0.8 ? C.d1 : C.l1);
    }
  }
  m.rect(3, 9, 34, 3, accent);
  m.rect(3, 9, 34, 1, C.l4);
  m.rect(17, 21, 6, 4, C.d1);
  m.rect(17, 21, 1, 4, C.l1);
  for (let x = 6; x < 36; x += 5) m.set(x, 10, C.ink);
  // The coin plate: brass, with a dark window for the number.
  const { left, top, width, height } = MINE_PLATE;
  m.rect(left, top, width, height, C.b1);
  m.rect(left, top, width, 1, C.b2);
  m.rect(left + 1, top + 1, width - 2, height - 2, C.ink);
  // A warning lamp that blinks, and the gear that drives the hopper, turning.
  m.rect(6, 7, 3, 2, C.ink);
  m.set(7, 7, f % 2 ? "#5e2228" : C.red);
  m.disc(32, 25, 3, C.d1);
  m.disc(32, 25, 2, C.b1);
  m.set(32, 25, C.b3);
  const teeth = [[32, 21], [36, 25], [32, 29], [28, 25]];
  const between = [[35, 22], [35, 28], [29, 28], [29, 22]];
  for (const [x, y] of f % 2 ? between : teeth) m.set(x, y, C.mid);
  for (const x of [9, 30]) { m.set(x, 24, C.b1); m.set(x, 29, C.b1); }
  // What it has produced, on the tray below the chute.
  m.rect(11, 29, 18, 2, C.l1);
  m.rect(11, 31, 18, 1, C.d1);
  for (const [x, y] of [[14, 27], [17, 27], [20, 27], [23, 27], [16, 25], [20, 25]]) m.rect(x, y, 3, 2, (x + y) % 2 ? C.b2 : C.b3);
  m.outline();
  return m;
}

// ---------------------------------------------------------------------------
// The turret: a mount and a gun. The runtime turns the gun by aim + 180 degrees,
// so its barrels are drawn pointing left.
// ---------------------------------------------------------------------------
function bakeTurretMount(accent, f) {
  const m = new Pix(18, 10);
  // Base plate, bolted down at each end.
  m.rect(0, 8, 18, 2, C.l1);
  m.rect(0, 8, 18, 1, C.l2);
  for (const x of [1, 16]) m.set(x, 9, C.b2);
  // Housing with louvres and a status lamp that blinks while it idles.
  m.rect(2, 5, 14, 3, C.mid);
  m.rect(2, 5, 14, 1, C.l1);
  for (const x of [4, 6, 11, 13]) m.set(x, 6, C.ink);
  m.rect(8, 6, 2, 1, f % 2 ? C.d1 : C.red);
  // The team collar the gun turns on.
  for (let y = 2; y < 5; y++) {
    const inset = 4 - y;
    m.rect(4 + inset, y, 10 - inset * 2, 1, y === 2 ? C.l4 : accent);
  }
  m.rect(6, 4, 6, 1, shadeOf(accent));
  m.rect(7, 0, 4, 2, C.d1);
  m.set(7, 0, C.l1);
  m.outline();
  return m;
}

function bakeTurretGun(accent, f) {
  const g = new Pix(26, 12);
  g.rect(14, 3, 11, 2, C.l1);
  g.rect(14, 3, 11, 1, C.l2);
  g.rect(14, 7, 11, 2, C.mid);
  g.rect(14, 7, 11, 1, C.l1);
  g.rect(22, 2, 3, 4, C.d1);
  g.rect(22, 6, 3, 4, C.d1);
  g.rect(22, 2, 1, 4, C.b1);
  g.rect(22, 6, 1, 4, C.b1);
  g.rect(18, 3, 1, 2, C.d1);
  g.rect(18, 7, 1, 2, C.d2);
  g.rect(2, 2, 13, 8, C.mid);
  g.rect(2, 2, 13, 1, C.l2);
  g.rect(2, 9, 13, 1, C.d2);
  g.rect(3, 4, 4, 4, accent);
  g.disc(10, 6, 2, C.b2);
  // The hub's bright spot goes round.
  const [hx, hy] = [[10, 5], [11, 6], [10, 7], [9, 6]][f % 4];
  g.set(hx, hy, C.b3);
  for (const x of [3, 6, 13]) g.set(x, 3, C.b2);
  g.rect(8, 3, 5, 1, C.l1);
  g.rect(20, 3, 1, 2, C.l3);
  // Cooling rings along both barrels.
  for (let x = 15; x < 21; x += 2) { g.set(x, 4, C.d1); g.set(x, 8, C.d2); }
  // Bolts round the breech.
  for (const [x, y] of [[3, 8], [13, 8], [13, 3]]) g.set(x, y, C.b1);
  g.set(2, 8, C.l1);
  for (const x of [8, 10, 12]) g.rect(x, 8, 1, 1, C.ink);
  g.outline();
  return g.mirrored();
}

/** A row of frames as one spritesheet. */
async function saveFrames(name, draw, count) {
  const frames = Array.from({ length: count }, (_, f) => draw(f));
  const { w, h } = frames[0];
  const sheet = new Pix(w * count, h);
  frames.forEach((frame, f) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const from = (y * w + x) * 4;
      sheet.d.set(frame.d.subarray(from, from + 4), (y * sheet.w + f * w + x) * 4);
    }
  });
  await sheet.save(name);
}

// ---------------------------------------------------------------------------
// The buildable wall: an upright bulkhead
// ---------------------------------------------------------------------------
const WALL_W = 12;
function bakeWallBuilt(accent, WALL_H = 24) {
  const w = new Pix(WALL_W, WALL_H);
  w.rect(1, 0, 10, WALL_H, C.ink);
  w.rect(2, 1, 8, WALL_H - 2, C.l1);
  w.rect(2, 1, 1, WALL_H - 2, C.l2);
  w.rect(9, 1, 1, WALL_H - 2, C.d1);
  // A team-coloured cap with a lit top edge.
  w.rect(1, 1, 10, 3, accent);
  w.rect(1, 1, 10, 1, C.l4);
  w.rect(1, 3, 10, 1, shadeOf(accent));
  // A viewing slit with a glint of the lamp behind it.
  w.rect(3, 5, 6, 2, C.ink);
  w.set(4, 5, C.b2);
  w.rect(3, 7, 6, 1, C.mid);
  // Braced panels down the door: an X in each, between riveted cross bars.
  const panel = 7;
  for (let top = 9; top + panel <= WALL_H - 3; top += panel + 1) {
    w.rect(3, top - 1, 6, 1, C.ink);
    for (let k = 0; k < panel; k++) {
      const x1 = 3 + Math.round((k / (panel - 1)) * 5), x2 = 8 - Math.round((k / (panel - 1)) * 5);
      w.set(x1, top + k, C.l2);
      w.set(x2, top + k, C.mid);
    }
    w.set(3, top, C.b2);
    w.set(8, top, C.b2);
    w.set(3, top + panel - 1, C.b1);
    w.set(8, top + panel - 1, C.b1);
  }
  // Rivets down both edges and a footing plate.
  for (let y = 6; y < WALL_H - 3; y += 4) { w.set(1, y, C.l3); w.set(10, y, C.d3); }
  w.rect(0, WALL_H - 3, 12, 3, C.ink);
  w.rect(1, WALL_H - 3, 10, 1, C.l2);
  w.rect(1, WALL_H - 2, 10, 1, C.mid);
  w.set(2, WALL_H - 2, C.b2);
  w.set(9, WALL_H - 2, C.b2);
  return w;
}

function bakeWallSlot(WALL_H = 24) {
  const w = new Pix(WALL_W, WALL_H);
  w.rect(0, WALL_H - 2, 12, 2, C.ink);
  w.rect(1, WALL_H - 2, 10, 1, C.l1);
  w.rect(1, WALL_H - 5, 2, 3, C.mid);
  w.rect(9, WALL_H - 5, 2, 3, C.mid);
  // Marks where the bulkhead will stand, without looking like it is there.
  for (let y = 1; y < WALL_H - 6; y += 3) { w.set(1, y, C.l2); w.set(10, y, C.l2); }
  for (let x = 2; x < 10; x += 3) w.set(x, 0, C.l2);
  return w;
}

// ---------------------------------------------------------------------------
// Generated pieces, brought onto the grid
// ---------------------------------------------------------------------------
// The bank fittings and the gold pile are painted, not drawn here. Reducing them
// to the level's grid, and to hard-edged alpha and fewer colours, is what stops
// them reading as finer than everything around them.
const GENERATED = path.join(ROOT, "output", "bank-bust-art", "v3");
async function pixelate(source, out, height) {
  const file = path.join(GENERATED, source);
  if (!fs.existsSync(file)) return console.log(`  skip ${out}: ${source} is not generated here`);
  const trimmed = await sharp(file).ensureAlpha().trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const h = Math.round(height / PX);
  const w = Math.round((meta.width * height) / meta.height / PX);
  const { data } = await sharp(trimmed).resize(w, h, { kernel: "lanczos3", fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = new Pix(w, h);
  for (let i = 0; i < data.length; i += 4) {
    img.d[i + 3] = data[i + 3] > 128 ? 255 : 0;
    for (let c = 0; c < 3; c++) img.d[i + c] = Math.min(255, Math.round(data[i + c] / 24) * 24);
  }
  await img.save(out);
}

// ---------------------------------------------------------------------------
// The tunnel's darkness
// ---------------------------------------------------------------------------
// Covers only the air, so the ground around the tunnel keeps its colour, and
// deepens smoothly down each shaft. Under each lamp a soft cone is cut out of it,
// so whatever stands there, fighters included, is seen at full brightness. Painted
// at half the world's resolution, since unlike the art this has to be a smooth
// gradient, and drawn at twice its size.
const TUNNEL_DARK = 0.72;
const SHADE_RES = 2;
function lightAt(lamps, wx, wy) {
  let light = 0;
  for (const lamp of lamps) {
    const dy = wy - lamp.y;
    if (dy < -60 || dy > lamp.length) continue;
    const dx = wx - lamp.x;
    const down = Math.max(0, dy) / lamp.length;
    const half = 22 + (lamp.width / 2) * down;
    const cone = dy >= 0 ? Math.exp(-((dx / half) ** 2) * 1.1) * (1 - 0.3 * down) : 0;
    const halo = Math.exp(-(dx * dx + dy * dy) / (2 * 34 * 34));
    light = Math.max(light, cone, halo);
  }
  return Math.min(1, light);
}

async function saveTunnelShade(region, paint, lamps, shaft, shelf) {
  const w = Math.round((region.right - region.left) / SHADE_RES);
  const h = Math.round((region.bottom - region.top) / SHADE_RES);
  const data = Buffer.alloc(w * h * 4);
  const [shaftLeft, shaftRight] = shaft;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const wx = region.left + x * SHADE_RES, wy = region.top + y * SHADE_RES;
    if (paint(Math.floor(wx / PX), Math.floor((wy + 600) / PX))) continue;
    const fold = Math.min(wx, 5000 - wx);
    const inShaft = fold >= shaftLeft && fold < shaftRight;
    const ramp = inShaft ? Math.min(1, (wy - region.top) / (shelf - region.top)) : 1;
    const i = (y * w + x) * 4;
    data[i] = 4; data[i + 1] = 6; data[i + 2] = 16;
    data[i + 3] = Math.round(255 * TUNNEL_DARK * ramp * (1 - 0.95 * lightAt(lamps, wx, wy)));
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .webp({ lossless: true, effort: 6 })
    .toFile(path.join(OUT, "tunnel-shade.webp"));
}

async function main() {
  if (!fs.existsSync(MANIFEST)) throw new Error(`${MANIFEST} is missing -- run scripts/maps/build-iron-junction.cjs first`);
  const { shapes, solids, world, tunnelShade, tunnelLamps, tunnelCeiling, shaft, shelf } = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const paint = solidPainter(solids, world.width, Math.round((world.mid + 600) / PX), Math.round((world.bottom + 600) / PX), Math.round((world.shadeBottom + 600) / PX));
  const bakers = { solid: (s) => bakeSolid(s, paint), wall: bakeWall, deck: bakeDeck, ledge: bakeLedge, tunnel: (s) => bakeTunnelBack(s, tunnelLamps, tunnelCeiling) };

  for (const shape of shapes) {
    const bake = bakers[shape.kind];
    if (!bake) throw new Error(`${shape.id}: unknown shape kind ${shape.kind}`);
    await bake(shape).save(`shape-${shape.id}.webp`);
    console.log(`  shape-${shape.id}.webp ${shape.width}x${shape.height}`);
  }
  const keep = new Set(shapes.map((s) => `shape-${s.id}.webp`));
  for (const file of fs.readdirSync(OUT)) {
    if (file.startsWith("shape-") && !keep.has(file)) { fs.unlinkSync(path.join(OUT, file)); console.log(`  removed ${file}`); }
  }

  await saveTunnelShade(tunnelShade, paint, tunnelLamps, shaft, shelf);
  for (const [name, img] of Object.entries(bakeVaults())) await img.save(name);
  const PROP_FRAMES_COUNT = 4;
  for (const [team, colour] of Object.entries(TEAM)) {
    await saveFrames(`mine-${team}.webp`, (f) => bakeMine(colour, f), PROP_FRAMES_COUNT);
    await saveFrames(`turret-mount-${team}.webp`, (f) => bakeTurretMount(colour, f), PROP_FRAMES_COUNT);
    await saveFrames(`turret-gun-${team}.webp`, (f) => bakeTurretGun(colour, f), PROP_FRAMES_COUNT);
    await bakeWallBuilt(colour).save(`wall-built-${team}.webp`);
    await bakeWallBuilt(colour, 42).save(`wall-tall-${team}.webp`);
  }
  await bakeWallSlot().save("wall-slot.webp");
  await bakeWallSlot(42).save("wall-tall-slot.webp");
  // The sizes and drawing spots the client preload, the runtime and the build share.
  fs.writeFileSync(path.join(ROOT, "src", "client", "game", "modes", "bankBust", "propFrames.json"), JSON.stringify({
    mine: { frameWidth: 160, frameHeight: 136, frames: PROP_FRAMES_COUNT, rate: 2,
      plateX: (MINE_PLATE.left + MINE_PLATE.width / 2) / 40, plateY: (MINE_PLATE.top + MINE_PLATE.height / 2) / 34 },
    "turret-mount": { frameWidth: 72, frameHeight: 40, frames: PROP_FRAMES_COUNT, rate: 2, socketX: 0.5, socketY: 0.1 },
    "turret-gun": { frameWidth: 104, frameHeight: 48, frames: PROP_FRAMES_COUNT, rate: 3, hubX: 15.5 / 26, hubY: 0.5 },
  }, null, 2) + "\n");
  await pixelate("base-backdrop.png", "base-backdrop.webp", 216);
  await pixelate("gold-pile.png", "center-bullion.webp", 52);
  console.log("Baked vault, mine, turret and wall art.");
}

main().catch((error) => { console.error(error); process.exit(1); });
