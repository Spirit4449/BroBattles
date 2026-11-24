// Pixel smoke painting for Draven's animations: soft stamps and strokes are
// summed into a heat field, quantised to the staff's magic palette with ordered
// dithering, then given a magenta rim light on the up-forward edge and a dark
// outline, so effects read as part of the sprite. Motifs (flame, coil, wisps,
// sweep smears, the wraith, streaks, specks, a burst) are shared by the
// animation scripts. Coordinates are canvas pixels on a SIDE x SIDE canvas.
const { SIZE, render } = require('./pose.cjs');
const { PALETTE } = require('./puppet.cjs');

const SIDE = 176; // canvas side; the 64px rest art sits centred on it
const M = (SIDE - SIZE) / 2; // rest-art origin on the canvas
const TAU = Math.PI * 2;
const RGB = Object.fromEntries(Object.entries(PALETTE).map(([k, h]) => [k, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]));

// ---------- effect painting (canvas coordinates, palette chars) ----------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

class Layer {
  constructor() { this.heat = new Float32Array(SIDE * SIDE); this.marks = []; }
  // A soft round stamp; overlapping stamps keep the strongest value.
  stamp(x, y, r, h = 1, squash = 1) {
    for (let py = Math.floor(y - r - 1); py <= y + r + 1; py++) for (let px = Math.floor(x - r - 1); px <= x + r + 1; px++) {
      if (px < 0 || py < 0 || px >= SIDE || py >= SIDE) continue;
      const d = Math.hypot(px + 0.5 - x, (py + 0.5 - y) * squash) / r;
      if (d >= 1) continue;
      const v = (1 - d * d) * h;
      const i = py * SIDE + px;
      if (v > this.heat[i]) this.heat[i] = v;
    }
  }
  // A stroke along points [[x, y, r, h], ...], stamped densely between them.
  stroke(points) {
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0, r0, h0 = 1] = points[i]; const [x1, y1, r1, h1 = 1] = points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        this.stamp(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, r0 + (r1 - r0) * u, h0 + (h1 - h0) * u);
      }
    }
  }
  // Hard pixels drawn after shading (eyes, sparks).
  mark(x, y, ch) { this.marks.push([Math.round(x), Math.round(y), ch]); }
  // A 1px line through points [[x, y], ...], drawn after shading with no
  // outline: the thin curling tendrils and fragments of the original smoke.
  line(points, ch = 'E') {
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i]; const [x1, y1] = points[i + 1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let k = i ? 1 : 0; k <= n; k++) this.mark(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, ch);
    }
  }
}

// Heat -> palette: the original's dark violet smoke, a little lighter where it
// thins, a soft purple rim on the up-forward edge and a dark outline all round.
const RAMP = ['C', 'E', 'E', 'M'];
// The attack's ghost and sweep are a lighter purple than the staff smoke.
const GHOST_RAMP = ['E', 'K', 'M', 'M'];
function paint(layer) {
  const g = new Array(SIDE * SIDE).fill(null);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const v = layer.heat[y * SIDE + x];
    const d = bayer(x, y);
    if (!(v + (d - 0.5) * 0.12 > 0.1)) continue;
    const ramp = layer.ramp || RAMP;
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.floor((1 - v) * ramp.length + (d - 0.5) * 0.9)));
    g[y * SIDE + x] = ramp[idx];
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < SIDE && y < SIDE ? g[y * SIDE + x] : null);
  // Lone pixels left by dithering.
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    if (at(x, y) && !at(x + 1, y) && !at(x - 1, y) && !at(x, y + 1) && !at(x, y - 1)) g[y * SIDE + x] = null;
  }
  const lit = [];
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    if (at(x, y) && (!at(x + 1, y - 1) || !at(x, y - 1)) && at(x - 1, y + 1)) lit.push(y * SIDE + x);
  }
  for (const i of lit) g[i] = g[i] === 'M' ? 'O' : 'M';
  const rim = [];
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    if (at(x, y)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) && at(x + dx, y + dy) !== 'A')) rim.push(y * SIDE + x);
  }
  for (const i of rim) g[i] = 'A';
  for (const [x, y, ch] of layer.marks) if (x >= 0 && y >= 0 && x < SIDE && y < SIDE) g[y * SIDE + x] = ch;
  return g;
}

// `under` paints only where the sprite is still transparent (smoke behind him).
function overlay(px, g, { under = false } = {}) {
  g.forEach((ch, i) => {
    if (!ch || (under && px[i * 4 + 3])) return;
    px.set(RGB[ch], i * 4); px[i * 4 + 3] = 255;
  });
  return px;
}

// ---------- effect motifs ----------
const C = (x, y) => [x + M, y + M]; // rest-art point -> canvas point

// The smoke ball the magic coils into on the staff head.
function coil(L, [hx, hy], r, t) {
  L.stamp(hx, hy, r, 1);
  for (let k = 0; k < 3; k++) {
    const a = t * 2.4 + (k * TAU) / 3;
    L.stamp(hx + Math.cos(a) * r * 0.7, hy + Math.sin(a) * r * 0.6 - 1, r * 0.55, 0.85);
  }
}

// A wisp curling up off a point: a tapering hooked stroke.
function wisp(L, [x, y], dir, len, curl) {
  const pts = [];
  for (let k = 0; k <= 5; k++) {
    const u = k / 5;
    const a = dir + curl * u * u;
    pts.push([x + Math.cos(a) * len * u, y + Math.sin(a) * len * u, 1.6 - u * 1.0, 0.75]);
  }
  L.stroke(pts);
}

// The sweep smear: an arc band around the grip from angle a0 to a1 (degrees
// from straight up, + forward) at radius r, thickest and brightest at the head.
function smear(L, [gx, gy], r, a0, a1, width, fade = 1) {
  const n = Math.ceil(Math.abs(a1 - a0) / 3);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const a = ((a0 + (a1 - a0) * u) * Math.PI) / 180;
    pts.push([gx + Math.sin(a) * r, gy - Math.cos(a) * r, 0.8 + width * u ** 1.6, (0.35 + 0.6 * u) * fade]);
  }
  L.stroke(pts);
}

// The ghost from the original attack, centred on (x, y) at scale s: a hooded
// smoke head and body with ragged edges, two big slanted red eyes, and long
// thin tendrils hanging and trailing behind it. `tail` ties it back to a point
// (the staff head) with thin strands; `tall` stretches it upward as it rears.
function wraith(L, [x, y], s, { tail, tall = 1, wave = 0, eyes = true } = {}) {
  const at = (dx, dy) => [x + dx * s, y + dy * s];
  L.ramp = GHOST_RAMP;
  // Hood (pointed, swept back) over a body that narrows into tendrils; the
  // heat stays below 1 so most of it reads in the original's purple, darkest
  // in the face hollow and the core.
  L.stamp(...at(-6.5, -18.5 * tall), 1.6 * s, 0.5);
  L.stamp(...at(-4, -16 * tall), 3 * s, 0.52);
  L.stamp(...at(0.5, -10 * tall), 7 * s, 0.55);
  L.stamp(...at(1.5, -9 * tall), 3.4 * s, 1);
  L.stroke([[...at(0, -3 * tall), 5.4 * s, 0.58], [...at(-2, 4 * tall), 3.8 * s, 0.6], [...at(-3.5, 8 * tall), 2.4 * s, 0.62]]);
  // Ragged lower edge lumps.
  for (let k = 0; k < 4; k++) L.stamp(...at(-6 + k * 2.2, 8 * tall + Math.sin(wave + k) * 1.2), 1.4 * s, 0.6);
  // Tendrils: pairs of 1px lines hanging down and drifting back.
  for (let k = 0; k < 6; k++) {
    const ox = -5 + k * 2; const long = (10 + 6 * Math.abs(Math.sin(k * 2.1))) * tall;
    const pts = [];
    for (let j = 0; j <= 7; j++) {
      const u = j / 7;
      pts.push(at(ox - 4 * u + Math.sin(wave + k * 1.4 + u * 4) * 1.5 * u, 8 * tall + long * u));
    }
    L.line(pts, k % 2 ? 'E' : 'C');
    if (k % 2 === 0) L.line(pts.slice(0, 4).map(([px, py]) => [px + 1, py]), 'E');
  }
  if (tail) {
    for (let k = 0; k < 3; k++) {
      const [sx, sy] = at(-6, -2 + k * 3);
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const u = j / 8;
        pts.push([sx + (tail[0] - sx) * u, sy + (tail[1] - sy) * u + Math.sin(u * Math.PI) * (2 + k * 2) + Math.sin(u * 7 + k) * 0.8]);
      }
      L.line(pts, k === 1 ? 'C' : 'E');
    }
  }
  if (eyes) {
    // Big slanted red eyes, angry: inner ends low.
    const [lx, ly] = at(-3.5, -9 * tall); const [rx, ry] = at(2.5, -9 * tall);
    for (const [dx, dy, ch] of [[0, 0, 'R'], [1, 1, 'R'], [2, 1, 'R'], [1, 0, 'Z']]) L.mark(lx + dx, ly + dy, ch);
    for (const [dx, dy, ch] of [[2, 0, 'R'], [1, 1, 'R'], [0, 1, 'R'], [1, 0, 'Z']]) L.mark(rx + dx, ry + dy, ch);
  }
}

// The ghost torn apart, after the original: long thin strands side by side,
// each bowed like a claw mark, with a red fleck where an eye was. `u` 0 = just
// torn, 1 = shredded into flecks lifting up and back.
function streaks(L, [x, y], s, u, seed = 1) {
  for (let k = 0; k < 6; k++) {
    const ox = (-6 + k * 3) * s; const top = (-14 + Math.abs(k - 2.5) * 2) * s; const long = (22 - Math.abs(k - 2.5) * 3) * s;
    const pts = [];
    for (let j = 0; j <= 10; j++) {
      const v = j / 10;
      pts.push([x + ox + Math.sin(v * Math.PI) * 4 * s - u * 10 * v, y + top + long * v - u * 14]);
    }
    if (u < 0.5) {
      L.line(pts, k % 3 ? 'E' : 'M');
      L.line(pts.slice(1, 8).map(([px, py]) => [px + 1, py]), 'C');
    } else {
      pts.filter((_, j) => (j + k + seed) % 3 === 0).forEach(([px, py]) => L.line([[px, py], [px - 1, py - 1]], k % 2 ? 'E' : 'M'));
    }
  }
  if (u < 0.5) { L.mark(x + 1 * s, y - 9 * s, 'R'); L.mark(x + 2 * s, y - 8 * s, 'R'); L.mark(x + 3 * s, y - 9 * s, 'Z'); }
}

// The attack's sweep, after the original: the ghost torn into a fan of thin
// curved strands arcing about `c` from behind his head up over the top and
// down in front, a red eye riding the outermost arc. Radii r..r+span; `u` 0 =
// the sweep just cut (whole strands), 1 = its tail end, broken into dashes
// and lifted up and away.
function sweep(L, [cx, cy], r, span, u, { a0 = -30, a1 = 150 } = {}) {
  L.ramp = GHOST_RAMP;
  const n = 10;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < n; k++) {
    const rr = r + (span * k) / (n - 1);
    const lag = (k % 3) * 8 + rnd() * 10;
    const from = a0 + lag + u * 70; const to = a1 - lag * 1.5 + u * 25 - rnd() * 15;
    const steps = Math.ceil(((to - from) * Math.PI * rr) / 180 / 1.5);
    const pts = [];
    for (let j = 0; j <= steps; j++) {
      const a = ((from + ((to - from) * j) / steps) * Math.PI) / 180;
      // Strands waver in and out as they go, like drawn-out smoke.
      const wob = Math.sin(j * 0.14 + k * 1.7) * 1.1;
      pts.push([cx + Math.sin(a) * (rr + wob), cy - Math.cos(a) * (rr + wob) - u * 8]);
    }
    const ch = k === n - 1 ? 'M' : (k % 2 ? 'E' : 'C');
    if (u < 0.5) {
      // Thin wisps: some painted (1-2px, tapering at both ends), some 1px lines.
      if (k % 3 !== 1) L.stroke(pts.map(([x, y], j) => [x, y, 0.5 + 0.6 * Math.sin((Math.PI * j) / pts.length), 0.55 + 0.25 * Math.sin(j * 0.3 + k)]));
      else L.line(pts, ch);
    } else {
      // Torn: short wisps that curl off at their ends, and faint puffs.
      let j = Math.floor(rnd() * 4);
      while (j < pts.length - 3) {
        const len = 3 + Math.floor(rnd() * 4);
        const seg = pts.slice(j, j + len);
        const [ex, ey] = seg[seg.length - 1];
        const hook = rnd() < 0.5 ? 1 : -1;
        L.line([...seg, [ex + hook, ey - 1], [ex + hook, ey - 2]], ch);
        if (rnd() < 0.3) L.stamp(seg[0][0], seg[0][1], 1.4, 0.5);
        j += len + 2 + Math.floor(rnd() * 3 + u * 2);
      }
    }
  }
  if (u < 0.5) {
    const a = ((a0 + 70) * Math.PI) / 180; const rr = r + span + 1;
    const ex = cx + Math.sin(a) * rr; const ey = cy - Math.cos(a) * rr;
    for (const [dx, dy, ch] of [[0, 0, 'R'], [1, 1, 'R'], [2, 1, 'Z'], [-1, 2, 'R'], [0, 3, 'R']]) L.mark(ex + dx, ey + dy, ch);
  }
}

function trail(L, [cx, cy], r0, r1, a0, a1, width, { eyes = false } = {}) {
  L.ramp = GHOST_RAMP;
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 3));
  const point = (u, dr = 0) => {
    const a = ((a0 + (a1 - a0) * u) * Math.PI) / 180; const r = r0 + (r1 - r0) * u + dr;
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  };
  const band = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    band.push([...point(u), 0.8 + width * u ** 1.2, 0.5 + 0.3 * u + 0.12 * Math.sin(u * 23)]);
  }
  L.stroke(band);
  // Billows along the outer edge so it reads as smoke, not a solid band.
  for (let k = 1; k < 9; k++) {
    const u = k / 9;
    L.stamp(...point(u, width * u ** 1.2 * 0.7 + Math.sin(k * 2.3) * 1.2), 1 + width * 0.35 * u, 0.55);
  }
  // Strands trailing off the outer edge, back along the swing.
  for (let k = 0; k < 4; k++) {
    const start = 0.25 + k * 0.17; const pts = [];
    for (let j = 0; j <= 8; j++) {
      const u = start - j * 0.035;
      if (u < 0) break;
      pts.push(point(u, width * u ** 1.4 * 0.8 + 1 + j * 0.5 + Math.sin(j + k) * 0.8));
    }
    L.line(pts, k % 2 ? 'E' : 'K');
  }
  if (eyes) {
    const [ex, ey] = point(0.86, 0);
    // Two big slanted eyes, angry: inner ends low.
    for (const [ox, oy, ch] of [[-5, 0, 'R'], [-4, 0, 'R'], [-4, 1, 'R'], [-3, 1, 'R'], [-2, 1, 'Z'], [-3, 2, 'R'],
      [4, 0, 'R'], [3, 0, 'R'], [3, 1, 'R'], [2, 1, 'R'], [1, 1, 'Z'], [2, 2, 'R']]) L.mark(ex + ox, ey + oy, ch);
  }
}

function specks(L, [x, y], n, spread, rise, seed) {
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const px = x + (rnd() - 0.3) * spread; const py = y - rnd() * rise;
    L.line([[px, py], [px + (rnd() < 0.5 ? 1 : -1), py - 1]], rnd() < 0.3 ? 'M' : 'E');
  }
}


// The smoke flame that burns on the staff head, after the original: a dark
// smoke ball, a little taller than wide, whose leading edge breaks into small
// flickering lumps, with thin 1px tendrils curling off it and a few loose
// fragments beyond. `dir` (a unit vector) is where it licks: up when still,
// back when he moves, when the ball also stretches and the tendrils trail long.
// Phase t (0..1) flickers the lumps and curls the tendrils.
function flame(L, [hx, hy], { dir = [0, -1], size = 1, t = 0, wisps = 2, reach = 1, lively = 1, curl = 0 } = {}) {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / len; const uy = dir[1] / len; const px = -uy; const py = ux;
  const s = size;
  const at = (along, side) => [hx + ux * along * s + px * side * s, hy + uy * along * s + py * side * s];
  // Ball, stretched along dir as it streams.
  const stretch = 3 + 3 * Math.max(0, reach - 1);
  L.stroke([[...at(0, 0), 4.6 * s, 1], [...at(stretch, 0), 4.2 * s, 1], [...at(stretch + 3, 0), 3 * s, 0.9]]);
  // Ragged leading edge: lumps that flicker frame to frame.
  for (let k = 0; k < 4; k++) {
    const side = (k - 1.5) * 2.4;
    const grow = 0.75 + (0.25 + 0.45 * lively) * Math.sin(TAU * (t + k * 0.29));
    L.stamp(...at(stretch + 4 + grow * 1.5, side), (1.1 + 0.6 * grow) * s, 0.85);
  }
  // `lively` (on by default): the ball churns, its leading edge bulging from
  // side to side, and puffs of smoke break off and drift away along `dir`,
  // shrinking as they go. `curl` bends the puffs' path to one side (+ = to
  // the left of dir: up, when the flame streams back off a moving staff).
  if (lively) {
    L.stamp(...at(stretch + 1.5, 2.4 * Math.sin(TAU * t)), 3.2 * s, 0.95);
    const puffs = 2 + Math.round(Math.max(0, reach - 1) * 2);
    for (let k = 0; k < puffs; k++) {
      const u = (t + k / puffs) % 1;
      const far = 12 + 8 * Math.max(0, reach - 1);
      L.stamp(...at(stretch + 7 + far * u, 2.5 * Math.sin(TAU * (u + k * 0.3)) + curl * 7 * u * u), (2.2 - 1.3 * u) * s * lively, 0.85);
    }
  }
  // Thin tendrils off the leading edge. They sway gently from frame to frame
  // rather than whipping about, so the flame reads as burning, not shaking.
  const tendrils = wisps;
  for (let k = 0; k < tendrils; k++) {
    const side = (k - (tendrils - 1) / 2) * 2.6;
    const long = (3 + 2 * Math.abs(Math.sin(k * 1.7 + 1)) + 7 * Math.max(0, reach - 1)) * (0.92 + 0.08 * Math.sin(TAU * (t + k * 0.21)));
    const pts = [];
    for (let j = 0; j <= 6; j++) {
      const u = j / 6;
      const curl = (Math.sin(u * 2.6 + k * 1.3) + 0.45 * Math.sin(TAU * t + k)) * (0.6 + u);
      pts.push(at(stretch + 5 + long * u, side * (1 + u * 0.4) + curl));
    }
    L.line(pts, 'E');
  }
  // One loose fragment drifting slowly off the end.
  if (wisps > 1) {
    const along = stretch + 12 + 7 * Math.max(0, reach - 1) + 3 * t;
    const [fx, fy] = at(along, Math.sin(TAU * 0.37) * 3);
    L.line([[fx, fy], [fx + px * 1.5 + ux, fy + py * 1.5 + uy]], 'E');
  }
}

// A hard-edged starburst where the staff's magic breaks (dying): dark smoke at
// the core, red and white spikes; `u` 0 = flash, 1 = shards flung out.
function burst(L, [x, y], u, seed = 3) {
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  if (u < 0.5) L.stamp(x, y, 7, 1);
  const rays = 12;
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * TAU + rnd() * 0.3;
    const r0 = u < 0.5 ? 6 : 8 + u * 8; const r1 = r0 + (u < 0.5 ? 6 + rnd() * 4 : 4 + rnd() * 5);
    const n = Math.ceil(r1 - r0);
    for (let j = 0; j <= n; j++) {
      const d = r0 + j;
      L.mark(x + Math.cos(a) * d, y + Math.sin(a) * d, j === n ? 'w' : (k % 2 ? 'R' : 'w'));
    }
    if (u >= 0.5) L.stamp(x + Math.cos(a + 0.2) * (r0 + 2), y + Math.sin(a + 0.2) * (r0 + 2), 1.5, 0.9);
  }
}

// A crescent sweep: an arc band about `c` from a0 to a1 (degrees from straight
// up, clockwise), fullest in the middle, with an optional red eye at the end.
function crescent(L, [cx, cy], r, a0, a1, width, { eye = false, broken = 0 } = {}) {
  const n = Math.ceil(Math.abs(a1 - a0) / 2.5);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const a = ((a0 + (a1 - a0) * u) * Math.PI) / 180;
    const w = 0.8 + width * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.8;
    pts.push([cx + Math.sin(a) * r, cy - Math.cos(a) * r, w, 0.95]);
  }
  if (broken) {
    // Break into parallel streaks: stroke thin bands at a few radii.
    for (const dr of [-width, 0, width]) {
      const band = pts.map(([x, y, w, h], k) => [cx + (x - cx) * (r + dr) / r, cy + (y - cy) * (r + dr) / r, Math.max(0.8, w * 0.35), h]);
      L.stroke(band.filter((_, k) => (k + Math.round(dr)) % 5 < 5 - broken * 2));
    }
  } else L.stroke(pts);
  if (eye) {
    const a = (a1 * Math.PI) / 180;
    const ex = cx + Math.sin(a) * r; const ey = cy - Math.cos(a) * r;
    L.stamp(ex, ey, width * 0.9 + 1.5, 1);
    L.mark(ex - 1, ey, 'R'); L.mark(ex, ey, 'R'); L.mark(ex + 1, ey - 1, 'Z');
  }
}

// Speed lines trailing behind a dash, along -dir from (x, y).
function speedLines(L, [x, y], dir, n, length, seed = 5) {
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  const [dx, dy] = dir; const len = Math.hypot(dx, dy); const ux = dx / len; const uy = dy / len;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * 5 + (rnd() - 0.5) * 2;
    const sx = x - uy * off - ux * (rnd() * 6); const sy = y + ux * off - uy * (rnd() * 6);
    const l = length * (0.6 + rnd() * 0.5);
    L.line([[sx, sy], [sx - ux * l, sy - uy * l]], k % 2 ? 'E' : 'M');
  }
}

// Render a posed figure on the effects canvas and paint smoke behind it
// (`behind`, only where he is transparent) and over it (`front`). Each gets
// (layer, points) with the staff head, grip, neck and waist on the canvas.
function drawFrame(pose, { behind, front, patch = false } = {}) {
  const px = render(pose, { size: SIDE, patch });
  const P = Object.fromEntries(Object.entries(pose.$).map(([k, v]) => [k, C(...v)]));
  for (const [fx, under] of [[behind, true], [front, false]]) {
    if (!fx) continue;
    const L = new Layer();
    fx(L, P);
    overlay(px, paint(L), { under });
  }
  // sheet.cjs writes this as the rig's per-frame `staffTip` (rest-art px).
  Object.defineProperty(px, 'staffHead', { value: pose.$.head });
  return px;
}

module.exports = { SIDE, M, C, Layer, paint, overlay, coil, wisp, smear, wraith, streaks, sweep, trail, specks, flame, burst, crescent, speedLines, drawFrame };
