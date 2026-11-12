// Ninja's frames, built from the editable pixel poses in poses/*.txt.
//
// A pose file is an 88x88 grid of palette characters (palette.cjs), one per art
// pixel; '.' is empty and '#' lines are comments. poses/idle.txt is the master:
// its head is stamped onto every other pose, so the face is drawn once and is
// identical in every frame. Edit a pose's text, run build.cjs, look at the result.
const fs = require('node:fs');
const path = require('node:path');
const { SIZE, GROUND, FEET_X, RGB } = require('./palette.cjs');

const POSES = path.join(__dirname, 'poses');
const read = (name) => fs.readFileSync(path.join(POSES, `${name}.txt`), 'utf8').split('\n')
  .filter((l) => l && !l.startsWith('#')).map((l) => [...l.padEnd(SIZE, '.')]);
const has = (name) => fs.existsSync(path.join(POSES, `${name}.txt`));
const copy = (grid) => grid.map((row) => row.slice());

const IDLE = read('idle');

// ---- the shared head ---------------------------------------------------------
// Everything from the top of the hood down to the chin of the master idle. The
// chin dips two rows lower on the far side, beside the scarf knot.
const HEAD_ROWS = [30, 50];
const CHIN = { 51: 40, 52: 41 }; // row -> first column that is still head
const HEAD = [];
for (let y = HEAD_ROWS[0]; y <= HEAD_ROWS[1] + 2; y++) for (let x = CHIN[y] || 0; x < SIZE; x++) {
  if (IDLE[y][x] !== '.' && !'rR'.includes(IDLE[y][x])) HEAD.push([x, y, IDLE[y][x]]);
}
// Small changes to the master head, drawn in its own coordinates, that bring a
// still head to life. Hood tip: the point at the top left of the hood, which
// can flick back or up in the wind (x 29..35, from y 32; '.' erases).
const HOOD_TIP = {
  at: [29, 32],
  back: ['.....kk', '..kkkdd', 'kkDdddd', 'kDddddd', '.kddddk'],
  up: ['....kkk', '.kkkddd', '.kDdddd', '..kdddd', '..kdddk'],
};
// Eyes: the near and far eye blocks. Narrowed, the bottom row of each eye turns
// to skin; squinting, the shine goes too.
const EYES = { boxes: [[43, 44, 47, 47], [52, 44, 56, 47]], bottom: 47 };
function faceVariant(grid, [ox, oy], { tip = null, eyes = 'open' } = {}) {
  if (tip) HOOD_TIP[tip].forEach((row, ry) => [...row].forEach((ch, rx) => {
    const x = HOOD_TIP.at[0] + rx + ox; const y = HOOD_TIP.at[1] + ry + oy;
    if (grid[y]?.[x] !== undefined) grid[y][x] = ch;
  }));
  if (eyes !== 'open') for (const [x0, y0, x1, y1] of EYES.boxes) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ch = IDLE[y][x]; const at = grid[y + oy]?.[x + ox];
    if (at === undefined || ch === 's') continue;
    if (y === EYES.bottom) grid[y + oy][x + ox] = 's';
    else if (eyes === 'squint' && (ch === 'w' || ch === 'm')) grid[y + oy][x + ox] = 'k';
  }
  return grid;
}
// The hood is what a pose's own head is matched on: generated faces differ.
const HOOD = HEAD.filter(([, , ch]) => ch === 'D' || ch === 'd' || ch === 'g');

// Finds the pose's own head, removes it, and stamps the master head there.
// `mirror` stamps the head facing left (the wall slide looks back over his
// shoulder). Returns where the head landed, as an offset from the idle's.
function stampHead(grid, { mirror = false } = {}) {
  const flip = ([x, y, ch]) => [mirror ? SIZE - 1 - x : x, y, ch];
  const head = HEAD.map(flip); const hood = HOOD.map(flip);
  let best = { score: -Infinity, dx: 0, dy: 0 };
  for (let dy = -16; dy <= 30; dy++) for (let dx = -24; dx <= 24; dx++) {
    let score = 0;
    for (const [x, y, ch] of hood) if (grid[y + dy]?.[x + dx] === ch) score++;
    for (const [x, y] of head) if ((grid[y + dy]?.[x + dx] ?? '.') === '.') score -= 2;
    if (score > best.score) best = { score, dx, dy };
  }
  const { dx, dy } = best;
  // Clear the pose's own head: everything above the chin within the head's width.
  // A raised arm beside the head is outside that width; wraps and a held star
  // that overlap it are kept.
  // A scarf blowing past the head is kept where the new head does not cover it.
  const xs = head.map(([x]) => x); const x0 = Math.min(...xs) + dx - 3; const x1 = Math.max(...xs) + dx + 3;
  const covered = new Set(head.map(([x, y]) => (y + dy) * SIZE + x + dx));
  const near = (x, y) => [-1, 0, 1].some((oy) => [-1, 0, 1].some((ox) => covered.has((y + oy) * SIZE + x + ox)));
  for (let y = 0; y <= HEAD_ROWS[1] + dy; y++) for (let x = x0; x <= x1; x++) {
    const ch = grid[y]?.[x];
    if (!ch || 'mMBbl'.includes(ch) || (RED(ch) && !near(x, y))) continue;
    grid[y][x] = '.';
  }
  for (const [x, y, ch] of head) if (grid[y + dy]?.[x + dx] !== undefined) grid[y + dy][x + dx] = ch;
  dropCrumbs(grid);
  closeEdges(grid);
  return { dx, dy };
}

// Gives every coloured pixel that borders empty space an outline.
function closeEdges(grid) {
  const open = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (grid[y][x] === '.' || grid[y][x] === 'k') continue;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (grid[y + oy]?.[x + ox] === '.') open.push([x + ox, y + oy]);
  }
  for (const [x, y] of open) grid[y][x] = 'k';
  return grid;
}
const RED = (ch) => ch === 'r' || ch === 'R';

// Removes specks left behind by the swap: tiny islands not attached to the figure.
function dropCrumbs(grid) {
  const seen = new Set();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (grid[y][x] === '.' || seen.has(y * SIZE + x)) continue;
    const island = []; const queue = [[x, y]]; seen.add(y * SIZE + x);
    while (queue.length) {
      const [cx, cy] = queue.pop(); island.push([cx, cy]);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = cx + ox; const ny = cy + oy;
        if (grid[ny]?.[nx] && grid[ny][nx] !== '.' && !seen.has(ny * SIZE + nx)) { seen.add(ny * SIZE + nx); queue.push([nx, ny]); }
      }
    }
    if (island.length < 30) for (const [cx, cy] of island) grid[cy][cx] = '.';
  }
  return grid;
}

const slide = (grid, dx, dy) => Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => grid[y - dy]?.[x - dx] ?? '.'));

// Turns a pose clockwise by `deg` about its own centre of mass, so the turned
// figure stays where the unturned one is. Quarter turns move every pixel onto a
// pixel and lose nothing. Other angles use RotSprite: the pose is scaled up 8x
// with Scale2x (which keeps outlines and diagonals crisp) and each output pixel
// samples that, so the turned drawing stays clean pixel art.
const centreOf = (grid) => {
  let sx = 0; let sy = 0; let n = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (grid[y][x] !== '.') { sx += x; sy += y; n++; }
  return [Math.round(sx / n), Math.round(sy / n)];
};
function scale2x(grid) {
  const h = grid.length; const w = grid[0].length;
  const at = (x, y) => grid[Math.min(h - 1, Math.max(0, y))][Math.min(w - 1, Math.max(0, x))];
  const out = Array.from({ length: h * 2 }, () => new Array(w * 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = at(x, y); const A = at(x, y - 1); const B = at(x + 1, y); const C = at(x - 1, y); const D = at(x, y + 1);
    out[2 * y][2 * x] = C === A && C !== D && A !== B ? A : P;
    out[2 * y][2 * x + 1] = A === B && A !== C && B !== D ? B : P;
    out[2 * y + 1][2 * x] = D === C && D !== B && C !== A ? C : P;
    out[2 * y + 1][2 * x + 1] = B === D && B !== A && D !== C ? D : P;
  }
  return out;
}
const UPSCALED = new Map();
function turn(grid, deg, key) {
  const [cx, cy] = centreOf(grid);
  const a = (deg * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a);
  if (deg % 90 === 0) {
    const q = (((deg / 90) % 4) + 4) % 4; // clockwise: (cx + a, cy + b) shows (cx + b, cy - a)
    let out = grid;
    for (let t = 0; t < q; t++) { const src = out; out = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => src[cy - (x - cx)]?.[cx + (y - cy)] ?? '.')); }
    return out;
  }
  if (!UPSCALED.has(key)) { let big = grid; for (let i = 0; i < 3; i++) big = scale2x(big); UPSCALED.set(key, big); }
  const big = UPSCALED.get(key);
  const out = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => {
    const dx = x + 0.5 - (cx + 0.5); const dy = y + 0.5 - (cy + 0.5);
    const sx = cx + 0.5 + c * dx + s * dy; const sy = cy + 0.5 - s * dx + c * dy;
    return big[Math.floor(sy * 8)]?.[Math.floor(sx * 8)] ?? '.';
  }));
  return dropCrumbs(out);
}

// The body settles onto bent legs: rows above the hips move down `dy` and
// forward `dx`, the leg rows between the hips and the soles are squeezed (or
// stretched) and sheared to meet them, and the soles stay where they are.
// `head` ([down, forward]) lets the head trail the torso by a frame: where the
// head sits higher than the torso, the neck row stretches to close the gap.
const HIP_ROW = GROUND - 20; // the belt, twenty rows above the ground
const NECK_ROW = 51; // first row below the master head's chin
function sinkBody(grid, dy, dx = 0, head = [dy, dx]) {
  const [hy, hx] = head;
  if (!dy && !dx && !hy && !hx) return grid;
  const legs = GROUND - HIP_ROW;
  const blank = new Array(SIZE).fill('.');
  return Array.from({ length: SIZE }, (_, y) => {
    let from; let lean;
    if (y < NECK_ROW + hy) { from = y - hy; lean = hx; }
    else if (y < HIP_ROW + dy) { from = Math.max(NECK_ROW, y - dy); lean = dx; }
    else if (y < GROUND) {
      from = HIP_ROW + Math.floor(((y - HIP_ROW - dy) * legs) / (legs - dy));
      lean = Math.round((dx * (GROUND - 1 - y)) / (legs - dy - 1));
    } else { from = y; lean = 0; }
    const row = grid[from] || blank;
    return Array.from({ length: SIZE }, (_, x) => row[x - lean] ?? '.');
  });
}

// Centre of the master head, and how far the idle reaches from it (to his soles).
const HEAD_CENTRE = (() => {
  const xs = HEAD.map(([x]) => x); const ys = HEAD.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...ys) + Math.max(...ys) + 1) / 2];
})();
function farthest(grid, [cx, cy]) {
  let far = { d: 0, x: cx, y: cy };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (grid[y][x] === '.') continue;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > far.d) far = { d, x: x + 0.5, y: y + 0.5 };
  }
  return far;
}
const IDLE_REACH = farthest(IDLE, HEAD_CENTRE).d;

// Shortens what trails furthest from the head (the legs, and the scarf behind
// them) so the figure reaches no further than `reach` from the head centre. The
// head and chest, up to `hip` of the way out, are untouched; beyond that the
// figure is pressed toward the hip along the line to the farthest point.
// The scarf is not a leg: it is lifted off first, kept exactly as drawn, and
// laid back behind the shortened body.
function shortenLegs(grid, centre, reach, hip = 0.42) {
  const scarf = largestRed(grid);
  const body = grid.map((row) => row.slice());
  for (const [x, y] of scarf) {
    body[y][x] = '.';
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const nx = x + ox; const ny = y + oy;
      if (body[ny]?.[nx] !== 'k') continue;
      const touchesBody = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([px, py]) => { const ch = grid[ny + py]?.[nx + px]; return ch && ch !== '.' && ch !== 'k' && !RED(ch); });
      if (!touchesBody) body[ny][nx] = '.';
    }
  }
  const far = farthest(body, centre);
  if (far.d <= reach) return grid;
  const [cx, cy] = centre; const u = [(far.x - cx) / far.d, (far.y - cy) / far.d];
  const t0 = far.d * hip; const k = (reach - t0) / (far.d - t0);
  const out = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => {
    const px = x + 0.5 - cx; const py = y + 0.5 - cy;
    const t = px * u[0] + py * u[1];
    if (t <= t0) return body[y][x];
    const ts = t0 + (t - t0) / k;
    const sx = Math.floor(cx + px + (ts - t) * u[0]); const sy = Math.floor(cy + py + (ts - t) * u[1]);
    return body[sy]?.[sx] ?? '.';
  }));
  closeEdges(out);
  for (const [x, y] of scarf) if (out[y][x] === '.') out[y][x] = grid[y][x];
  return closeEdges(dropCrumbs(out));
}
// The largest connected red shape: the scarf (the belt and pouch are smaller).
function largestRed(grid) {
  const seen = new Set(); let best = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (!RED(grid[y][x]) || seen.has(y * SIZE + x)) continue;
    const shape = []; const queue = [[x, y]]; seen.add(y * SIZE + x);
    while (queue.length) {
      const [cx, cy] = queue.pop(); shape.push([cx, cy]);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = cx + ox; const ny = cy + oy;
        if (RED(grid[ny]?.[nx]) && !seen.has(ny * SIZE + nx)) { seen.add(ny * SIZE + nx); queue.push([nx, ny]); }
      }
    }
    if (shape.length > best.length) best = shape;
  }
  return best;
}

// A pose with the shared head. `pin` then moves the whole frame so the head sits
// at a fixed offset from the idle's: [dx, dy], with null leaving that axis as drawn.
function pose(name, { head = true, mirror = false, pin = null } = {}) {
  const grid = read(name);
  if (!head) return grid;
  const at = stampHead(grid, { mirror });
  if (!pin) return grid;
  return slide(grid, pin[0] === null ? 0 : pin[0] - at.dx, pin[1] === null ? 0 : pin[1] - at.dy);
}

// ---- idle ----------------------------------------------------------------------
// A ready bounce, drawn at the sheet's finer resolution. The body dips onto bent
// knees and leans forward over the front foot, then rises and settles back; the
// head follows the torso a frame late, so it traces a small loop. The fists ride
// the body and also roll their own circles, out of step with each other, like a
// fighter keeping his hands loose. The feet never move.
// Nothing here is redrawn or resampled: each frame maps every sheet pixel back to
// one art pixel (build.cjs bakes it), so a part only ever slides, a quarter art
// pixel (one sheet pixel) at a time, and the legs bend and lean to meet it. That
// is what keeps it smooth: no frame moves anything by a whole art pixel.
const IDLE_MS = 80;
const IDLE_FRAMES = 16;
const SETTLED = 4; // the idle frame a throw comes to rest on
const QUARTER = 4; // sheet pixels per art pixel: motion snaps to this
const snap = (v) => Math.round(v * QUARTER) / QUARTER;
const DIP = 1; // art px the body sinks at the bottom of the bounce
const LEAN = 0.75; // art px it leans forward
const FIST_ROLL = 1; // radius of each fist's circle, in art px
// Each fist on the master idle: its centre, and where it starts on its circle.
const FISTS = [
  { at: [35.5, 64.5], phase: Math.PI * 0.9 }, // near fist, at the hip
  { at: [51.5, 63.5], phase: 0 }, // lead fist, out front
];
const FIST_REACH = [3, 7]; // fully moved within 3 px of the fist's centre, not at all past 7
// Where the body is at time t (0..1 of the cycle): down, then forward a little later.
const bodyAt = (t) => {
  const a = 2 * Math.PI * t;
  return [snap(LEAN * (0.5 - 0.5 * Math.cos(a - Math.PI / 3))), snap(DIP * (0.5 - 0.5 * Math.cos(a)))]; // [forward, down]
};
// Maps a point on the drawn frame (art units) to the master idle pixel it shows.
function idleWarp(i) {
  const t = i / IDLE_FRAMES;
  const [dx, dy] = bodyAt(t);
  const [hx, hy] = bodyAt(t - 1 / IDLE_FRAMES); // the head, a frame behind
  const fists = FISTS.map(({ at, phase }) => {
    const a = 2 * Math.PI * t + phase;
    return { x: at[0] + dx, y: at[1] + dy, d: [snap(FIST_ROLL * Math.cos(a)), snap(FIST_ROLL * Math.sin(a))] };
  });
  const legs = GROUND - HIP_ROW;
  return (x, y) => {
    let sx; let sy;
    if (y < NECK_ROW + hy) { sx = x - hx; sy = y - hy; }
    else if (y < HIP_ROW + dy) { sx = x - dx; sy = Math.max(NECK_ROW, y - dy); }
    else if (y < GROUND) {
      const k = (y - HIP_ROW - dy) / (legs - dy); // 0 at the hips, 1 at the soles
      sx = x - dx * (1 - k); sy = HIP_ROW + k * legs;
    } else { sx = x; sy = y; }
    for (const f of fists) {
      const dist = Math.hypot(x - f.x, y - f.y);
      const w = Math.max(0, Math.min(1, (FIST_REACH[1] - dist) / (FIST_REACH[1] - FIST_REACH[0])));
      sx -= snap(f.d[0] * w); sy -= snap(f.d[1] * w);
    }
    return [sx, sy];
  };
}
const idleFrame = (i) => ({ grid: IDLE, warp: idleWarp(i) });

// ---- scarf ---------------------------------------------------------------------
// Wind in the long scarf: a wave runs down the tail, growing toward its tip.
// The tail is the largest red shape; everything left of the neck is lifted and
// dropped by whole pixels and its outline redrawn. `phase` is 0..1 of a wave.
const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const N8 = [...N4, [-1, -1], [1, -1], [-1, 1], [1, 1]];
function flutter(source, phase, { amp = 1.7, length = 15, hold = 5, trim = Infinity, anchorX = null } = {}) {
  const grid = copy(source);
  // Largest connected red shape.
  const seen = new Set(); let tail = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (!RED(grid[y][x]) || seen.has(y * SIZE + x)) continue;
    const shape = []; const queue = [[x, y]]; seen.add(y * SIZE + x);
    while (queue.length) {
      const [cx, cy] = queue.pop(); shape.push([cx, cy]);
      for (const [ox, oy] of N8) {
        const nx = cx + ox; const ny = cy + oy;
        if (RED(grid[ny]?.[nx]) && !seen.has(ny * SIZE + nx)) { seen.add(ny * SIZE + nx); queue.push([nx, ny]); }
      }
    }
    if (shape.length > tail.length) tail = shape;
  }
  if (tail.length < 40) return grid; // no long scarf in this pose
  // The knot at the neck stays put. `anchorX` names its column where the red
  // reaches further forward in some poses than others (the run), so the tail is
  // the same length in every frame.
  const anchor = anchorX ?? Math.max(...tail.map(([x]) => x)) - hold;
  // `trim` shortens the tail to that many pixels past the knot, with a rounded end.
  const columns = new Map();
  for (const [x, y] of tail) { const c = columns.get(x) || [Infinity, -Infinity]; columns.set(x, [Math.min(c[0], y), Math.max(c[1], y)]); }
  const keeps = ([x, y]) => {
    const d = anchor - x; if (d <= trim - 2) return true; if (d > trim) return false;
    const [top, bottom] = columns.get(x); const cut = d === trim ? 2 : 1;
    return y >= top + cut && y <= bottom - cut;
  };
  const isTail = new Set(tail.map(([x, y]) => y * SIZE + x));
  // Lift the tail and the outline that belongs only to it.
  for (const [x, y] of tail) {
    if (x >= anchor) continue;
    for (const [ox, oy] of N8) {
      const nx = x + ox; const ny = y + oy;
      if (grid[ny]?.[nx] !== 'k') continue;
      const touchesBody = N4.some(([px, py]) => { const ch = source[ny + py]?.[nx + px]; return ch && ch !== '.' && ch !== 'k' && !RED(ch); });
      // Past the trimmed end the scarf is gone, so its outline goes even where it
      // ran along the body; the body's own edge is redrawn below.
      if (!touchesBody || !keeps([x, y])) grid[ny][nx] = '.';
    }
  }
  for (const [x, y] of tail) if (x < anchor) grid[y][x] = '.';
  const placed = [];
  for (const [x, y] of tail) {
    if (x >= anchor || !keeps([x, y])) continue;
    const d = anchor - x;
    const dy = Math.round(amp * Math.min(1, d / 10) * Math.sin(2 * Math.PI * (d / length - phase)));
    if (grid[y + dy]?.[x] === '.' || isTail.has((y + dy) * SIZE + x)) { grid[y + dy][x] = source[y][x]; placed.push([x, y + dy]); }
  }
  for (const [x, y] of placed) for (const [ox, oy] of N4) if (grid[y + oy]?.[x + ox] === '.') grid[y + oy][x + ox] = 'k';
  dropCrumbs(grid); // outline left over from a trimmed tail
  // Past the cut, outline that no longer borders anything is the scarf's too.
  if (Number.isFinite(trim)) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < anchor - trim + 2; x++) {
      if (grid[y][x] === 'k' && !N8.some(([ox, oy]) => { const ch = grid[y + oy]?.[x + ox]; return ch && ch !== '.' && ch !== 'k'; })) grid[y][x] = '.';
    }
  }
  // Close any body edge the trimmed scarf used to cover.
  const open = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (grid[y][x] === '.' || grid[y][x] === 'k') continue;
    for (const [ox, oy] of N4) if (grid[y + oy]?.[x + ox] === '.') open.push([x + ox, y + oy]);
  }
  for (const [x, y] of open) grid[y][x] = 'k';
  return grid;
}

// ---- throws ----------------------------------------------------------------------
// One clip per aim direction: gather (star in the fist), release (the star
// leaves on this frame), follow-through, then the idle, part-way into a breath.
const RELEASE_FRAME = 1;
const THROW_MS = [70, 70, 80, 60];
const BEATS = ['gather', 'RELEASE', 'follow', 'settle'];
const DIRECTIONS = { high: 65, up: 35, level: 0, down: -35, low: -70 };

// Knuckles of the release pose: the arm pixel furthest along the aim from the
// chest. `hands` overrides it where the search would find something else.
const CHEST = [FEET_X + 2, GROUND - 30];
function knuckles(grid, elevation) {
  const a = (-elevation * Math.PI) / 180; const u = [Math.cos(a), Math.sin(a)];
  let best = null;
  for (let y = 0; y < GROUND - 9; y++) for (let x = CHEST[0]; x < SIZE; x++) {
    if (grid[y][x] === '.') continue;
    const reach = (x + 0.5 - CHEST[0]) * u[0] + (y + 0.5 - CHEST[1]) * u[1];
    if (!best || reach > best.reach) best = { reach, x: x + 0.5, y: y + 0.5 };
  }
  return [best.x, best.y];
}

const frame = (grid, extra = {}) => ({ canvas: { size: SIZE, px: grid.flat() }, ...extra });
const idleDrawn = (i) => { const { grid, warp } = idleFrame(i); return frame(grid, { warp }); };
const CLIPS = [{ key: 'idle', prefix: 'idle', loop: true, beats: Array.from({ length: IDLE_FRAMES }, (_, i) => `beat ${i}`),
  frames: Array.from({ length: IDLE_FRAMES }, () => ({ ms: IDLE_MS })), drawn: Array.from({ length: IDLE_FRAMES }, (_, i) => idleDrawn(i)) }];
for (const [name, elevation] of Object.entries(DIRECTIONS)) {
  if (!has(`${name}-release`)) continue;
  const poses = ['gather', 'release', 'follow'].map((beat) => pose(`${name}-${beat}`));
  const level = name === 'level';
  CLIPS.push({ key: level ? 'attack' : `attack-${name}`, prefix: level ? 'attack' : `attack${name[0].toUpperCase()}${name.slice(1)}`,
    loop: false, direction: name, elevation, beats: BEATS, frames: THROW_MS.map((ms) => ({ ms })),
    drawn: [frame(poses[0]), frame(poses[1], { hand: knuckles(poses[1], elevation) }), frame(poses[2]), idleDrawn(SETTLED)] });
}

// ---- movement ------------------------------------------------------------------
// The run, jump, fall, wall slide and dashes are redraws of the old sheet's
// frames, pose for pose, so they flow the way they did.
//   face    'shared' stamps the master head on every upright pose, so the face is
//           the same drawing in every frame; 'drawn' keeps the pose's own head
//           (it tumbles in the somersault, or lies down in defeat). An array
//           gives one per pose.
//   steady  slides each frame so the head sits where it does in the clip's first
//           frame, so the face holds still while the limbs move
//   legs    the farthest the figure may reach from the head, as a multiple of the
//           idle's reach: the dashes drew stretched legs
//   wind    shows each pose that many times with the scarf wave moved on
//   waves   how many waves pass down the scarf per cycle of the clip
//   scarf   flutter settings (trim shortens the tail)
//   faces   one faceVariant per drawn frame (after `wind`) on a steady head
//   centre  the turned poses (and those named in `centred`) are slid so their
//           centre of mass sits on that pose's, so the somersault turns on one spot
//   msEach  ms per frame, overriding `ms`
//   endsOn  the clip's last frame is that clip's first frame, so one hands over
//           to the other on a matching pose
//   ease    from that pose on, the head travels in even steps from where it is
//           drawn to where `endsOn` has it, so the hand-over is one movement
//   sink    px per drawn frame (after `wind`) that the body sinks onto its legs:
//           the feet stay planted, everything above the hips drops (or rises,
//           when negative) and the legs bend (or straighten) to meet it
//   grounded  'clip' raises every frame by the same amount until the lowest foot
//           in the clip rests on the ground; 'each' sets every frame's lowest
//           point on the ground (the dashes: the body dips into the lunge)
const numbered = (name, count, from = 0) => Array.from({ length: count }, (_, i) => `${name}-${from + i}`);
// The jump plays at the old sheet's 24 fps and opens out into the fall's first
// pose, which it holds until the fall takes over at the top of the jump.
const FORWARD_DASH = ['dashright-0', 'dashright-1', 'dashright-2', 'dashright-2']; // the lunge holds a beat
const DASH = { face: 'shared', steady: true, legs: 1.05, grounded: 'each', ms: 40 };
// One in-between into the fall (jump-t1, the halfway pose); all three read as too many.
const TWEENS = has('jump-t1') ? ['jump-t1'] : [];
// Crouch, leap, curl in, one full forward somersault, uncurl, open out, then the
// in-between into the fall pose. The somersault is one tuck drawing (jump-2)
// turned an eighth of a turn clockwise per frame about a fixed centre, so the
// spin is even and the ball stays the same size in the same place; the curl-in
// and uncurl (jump-m0, jump-m1) are drawn in-betweens centred on the same spot.
const SPIN = [0, 45, 90, 135, 180, 225, 270, 315, 0].map((deg) => `jump-2@${deg}`);
const CURL = has('jump-m0') ? ['jump-m0'] : []; const UNCURL = has('jump-m1') ? ['jump-m1'] : [];
const JUMP_POSES = ['jump-0', 'jump-1', ...CURL, ...SPIN, ...UNCURL, 'jump-7', ...TWEENS];
const JUMP_FACES = JUMP_POSES.map((name) => (name.includes('@') ? 'drawn' : 'shared')); // the spin tumbles
// The spin goes by quicker than the poses around it, so the whole jump (about
// 460 ms) still reaches the fall pose by the top of a full jump (about 500 ms).
const JUMP_MS = [...JUMP_POSES.map((name) => (name.includes('@') ? 22 : 38)), 38];
const MOVES = [
  { key: 'falling', prefix: 'falling', loop: true, face: 'shared',
    ms: 1000 / 6, wind: 2, waves: 2, poses: ['fall-0', 'fall-1', 'fall-2', 'fall-1'] },
  // The head holds level, but lives: the hood tip flutters back and up in the
  // wind. The eyes stay open, as drawn.
  { key: 'running', prefix: 'running', loop: true, grounded: 'clip', face: 'shared', steady: true,
    faces: [null, 'back', 'back', null, 'up', 'up'].map((tip) => ({ tip })),
    ms: 1000 / 18, wind: 2, waves: 1, // the old run was 14 fps
    scarf: { anchorX: 47, trim: 23, amp: 1.5 }, poses: numbered('run', 6) }, // 47: just behind the hood
  { key: 'jumping', prefix: 'jumping', face: JUMP_FACES, endsOn: 'falling', ease: JUMP_POSES.indexOf('jump-7'),
    centre: 'jump-2', centred: [...CURL, ...UNCURL], ms: 38, msEach: JUMP_MS, poses: JUMP_POSES },
  { key: 'wall', prefix: 'wall', loop: true, face: 'shared', ms: 1000, poses: [has('wall') ? 'wall' : 'wall-first'] },
  // A redraw of the old crouch; the first generated one (`duck`) is the fallback.
  has('crouch') ? { key: 'ducking', prefix: 'duck', loop: true, face: 'shared', grounded: 'clip', ms: 1000, poses: ['crouch'] }
    : { key: 'ducking', prefix: 'duck', loop: true, ms: 1000, poses: ['duck'] },
  // One dash per direction; `dashing` is the forward one for art that asks for it by that name.
  { key: 'dashing', prefix: 'dash', ...DASH, poses: FORWARD_DASH },
  { key: 'dashright', prefix: 'dashRight', ...DASH, poses: FORWARD_DASH },
  { key: 'dashdiagonal', prefix: 'dashDiagonal', ...DASH, poses: numbered('dashdiagonal', 4) },
  { key: 'dashup', prefix: 'dashUp', ...DASH, poses: numbered('dashup', 4) },
  { key: 'dying', prefix: 'dying', face: 'drawn', ms: 100, poses: ['die-0', 'die-1', 'die-2'] },
  // The super: a barrage from alternating hands that sweeps from high to low,
  // as the fifteen shuriken leave top to bottom over about half a second. The
  // game loops this row at 30 fps for as long as the barrage lasts; eight poses
  // shown twice each fill one barrage.
  { key: 'special', prefix: 'special', loop: true, ms: 1000 / 30, poses: numbered('super', 8).flatMap((name) => [name, name]) },
];
const HEAD_AT = new Map(); // clip key -> where its first frame's head sits, for `steady` and `endsOn`
const ORDER = ['running', 'jumping', 'falling', 'wall', 'ducking', 'dashing', 'dashright', 'dashdiagonal', 'dashup', 'dying', 'special'];
const built = new Map();
for (const move of MOVES) {
  if (!move.poses.every((spec) => has(spec.split('@')[0]))) continue;
  const each = (value, i) => (Array.isArray(value) ? value[i] : value);
  // Each distinct pose once: its face, then its legs.
  const cache = new Map();
  const make = (name, i) => {
    const key = `${name}|${each(move.face, i)}`;
    if (cache.has(key)) return cache.get(key);
    const [file, spin] = name.split('@');
    let grid = read(file); let at = null;
    if (spin !== undefined) grid = turn(grid, Number(spin), file);
    if (each(move.face, i) === 'shared') at = stampHead(grid);
    const shaped = move.legs && at
      ? shortenLegs(grid, [HEAD_CENTRE[0] + at.dx, HEAD_CENTRE[1] + at.dy], IDLE_REACH * move.legs) : grid;
    const made = { grid: shaped, at };
    cache.set(key, made);
    return made;
  };
  const made = move.poses.map(make);
  // Where each frame's head should sit.
  const first = made.find((m) => m.at)?.at;
  const end = move.endsOn && HEAD_AT.get(move.endsOn);
  const want = made.map((m, i) => {
    if (!m.at) return null;
    if (move.ease !== undefined && end && i >= move.ease) {
      const from = made[move.ease].at; const f = (i - move.ease) / (made.length - move.ease);
      return { dx: from.dx + (end.dx - from.dx) * f, dy: from.dy + (end.dy - from.dy) * f };
    }
    if (!move.steady || !first) return m.at;
    return first;
  });
  if (made[0].at) HEAD_AT.set(move.key, want[0]);
  let grids = made.map((m, i) => (want[i] ? slide(m.grid, Math.round(want[i].dx - m.at.dx), Math.round(want[i].dy - m.at.dy)) : m.grid));
  if (move.centre) {
    const [tx, ty] = centreOf(made[move.poses.indexOf(`${move.centre}@0`)]?.grid || read(move.centre));
    const centred = (i) => move.poses[i].includes('@') || move.centred?.includes(move.poses[i]);
    grids = grids.map((grid, i) => { if (!centred(i)) return grid; const [x, y] = centreOf(grid); return slide(grid, tx - x, ty - y); });
  }
  const wind = move.wind || 1; const steps = move.poses.length * wind;
  const drawn = []; const beats = [];
  move.poses.forEach((name, i) => {
    for (let w = 0; w < wind; w++) {
      const j = i * wind + w;
      const grid = move.wind ? flutter(grids[i], (j * (move.waves || 1)) / steps, move.scarf) : grids[i];
      drawn.push(grid);
      beats.push(wind > 1 ? `${name} wind ${w}` : name);
    }
  });
  const lowestRow = (grid) => { let y = SIZE - 1; while (y > 0 && grid[y].every((ch) => ch === '.')) y--; return y; };
  let lift = 0;
  if (move.grounded === 'clip') {
    // Raised as one piece until the lowest foot in the clip rests on the ground.
    lift = GROUND - 1 - Math.max(...drawn.map(lowestRow));
    drawn.forEach((grid, j) => { drawn[j] = slide(grid, 0, lift); });
  } else if (move.grounded === 'each') {
    drawn.forEach((grid, j) => { drawn[j] = slide(grid, 0, GROUND - 1 - lowestRow(grid)); });
  }
  if (move.sink) drawn.forEach((grid, j) => { drawn[j] = sinkBody(grid, move.sink[j % move.sink.length]); });
  if (move.faces && move.steady && first) {
    const at = [Math.round(first.dx), Math.round(first.dy) + lift];
    drawn.forEach((grid, j) => { drawn[j] = faceVariant(grid.map((row) => row.slice()), at, move.faces[j % move.faces.length]); });
  }
  drawn.forEach((grid, j) => { drawn[j] = frame(grid); });
  if (move.endsOn && built.has(move.endsOn)) { drawn.push(built.get(move.endsOn).drawn[0]); beats.push(`${move.endsOn} 0`); }
  built.set(move.key, { key: move.key, prefix: move.prefix, loop: !!move.loop, beats,
    frames: drawn.map((_, j) => ({ ms: Math.round((move.msEach?.[j] ?? move.ms) / wind) })), drawn });
}
for (const key of ORDER) if (built.has(key)) CLIPS.push(built.get(key));

function toPixels(canvas) {
  const out = Buffer.alloc(canvas.px.length * 4);
  canvas.px.forEach((ch, i) => { const rgb = RGB[ch]; if (rgb) { out.set(rgb, i * 4); out[i * 4 + 3] = 255; } });
  return out;
}

module.exports = { CLIPS, RELEASE_FRAME, toPixels };
