#!/usr/bin/env node
// Procedural pixel-art remake of the other Lushy Peaks platforms (base, small, side).
// Same method as generate-lushy-large-platform.cjs (the approved large ledge).
// Writes candidates to output/lushy-code-platforms/; never touches installed assets.
//   node scripts/art/generate-lushy-platforms.cjs <base|small|side> [seed]
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

// Platform table. Every sprite is drawn on a logical grid and scaled 8x with nearest neighbour,
// then cropped to the exact texture size of the installed asset (so map scale/collision never change).
// Every remake keeps the original's silhouette (traced by lushy-platform-masks.cjs) and uses the
// approved large ledge's style settings: same stone sizes, mortar, turf, vines and flowers.
const CFG = {
  base: { fromArt: true, file: 'base.webp', outW: 4000, outH: 1704, SURFACE: 16, ROCK_TOP: 19, seed: 11, hangMoss: { groups: 6, len: 14 }, stones: { w: [13, 25], rowH: [8.5, 12.5] }, vary: true, vines: { n: 12, long: [30, 50], short: [16, 26], w: 1 }, turfExtra: 0, pinkBed: 24 },
  small: { toneShift: -1, hullMortar: true, fromArt: true, vary: true, file: 'smallPlatform.webp', outW: 4000, outH: 1704, SURFACE: 3, ROCK_TOP: 6, seed: 23, stones: { w: [13, 25], rowH: [8.5, 12.5] }, vines: { n: 6, long: [30, 50], short: [16, 26], w: 1 }, turfExtra: 0, pinkBed: 14 },
  large: { fromArt: true, vary: true, file: 'largePlatform.webp', outW: 2800, outH: 484, SURFACE: 16, ROCK_TOP: 19, seed: 7, stones: { w: [13, 25], rowH: [8.5, 12.5] }, vines: { n: 16, long: [30, 50], short: [16, 26], w: 1 }, turfExtra: 0, pinkBed: 50 },
  side: { edgeFade: true, toneShift: -1, fromArt: true, file: 'sidePlatform.webp', outW: 2092, outH: 3512, SURFACE: 23, ROCK_TOP: 26, seed: 31, stones: { w: [13, 25], rowH: [8.5, 12.5] }, vary: true, vines: { n: 4, long: [40, 70], short: [16, 30], w: 1 }, turfExtra: 0, pinkBed: 0, thistle: true, hangMoss: { groups: 5, len: 12, wide: true } },
};
const NAME = process.argv[2] || 'base';
const C = CFG[NAME]; if (!C) throw Error('platform must be one of: ' + Object.keys(CFG).join(', '));
const MASK = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../output/lushy-code-platforms', NAME + '-mask.json'), 'utf8'));
const W = MASK.W, H = MASK.H + 1, SCALE = MASK.scale, OUT_W = C.outW, OUT_H = C.outH;
const OUT = path.resolve(__dirname, '../../output/lushy-code-platforms');
const FS = 1;
const SEED = Number(process.argv[3] || C.seed);

// ---------- seeded helpers ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const rr = (a, b) => a + rnd() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + (s + SEED) * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, cell, s) { // value noise in [0,1]
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = x / cell - gx, fy = y / cell - gy;
  const a = hash(gx, gy, s), b = hash(gx + 1, gy, s), c = hash(gx, gy + 1, s), d = hash(gx + 1, gy + 1, s);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const clampI = (v, n) => Math.max(0, Math.min(n - 1, v));

// ---------- palette (sampled from the original) ----------
const P = {
  mortarDeep: hex('#2a1a22'), mortar: hex('#36242b'), mortarHi: hex('#3f2a30'),
  stone: ['#3f2a30', '#4a3236', '#523a3a', '#5c3f3f', '#644442', '#6c4a45', '#755249', '#7e5a4f', '#886056', '#94685b', '#9e7060'].map(hex),
  // turf ramp: deep shadow -> sunlit tips
  turf: ['#3e4220', '#4f5427', '#62652c', '#757230', '#878035', '#998f3b', '#aba244', '#bdb455'].map(hex),
  moss: ['#34381a', '#545a20', '#6e7a26', '#8c9a2e', '#a4ae38', '#b8bc44'].map(hex),
  pink: hex('#e080a0'), pinkLight: hex('#f4a8c0'), pinkDark: hex('#b06070'),
  white: hex('#f8f8ec'), whiteShade: hex('#d0ccbc'), yellow: hex('#f0b020'), yellowDark: hex('#c08018'),
  bud: hex('#a05a70'), stem: hex('#55592c'),
};

const img = new Uint8ClampedArray(W * H * 4);
const set = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255; };
const opaque = (x, y) => x >= 0 && y >= 0 && x < W && y < H && img[(y * W + x) * 4 + 3] > 0;

// ---------- geometry helpers (convex polygons as [[x,y],...]) ----------
function clipHalf(poly, ax, ay, c) { // keep a·p <= c
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = ax * p[0] + ay * p[1] - c, dq = ax * q[0] + ay * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
const area = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const centroid = (poly) => { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; };
function inset(poly, g) {
  const sgn = Math.sign(area(poly)) || 1; let out = poly;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]; let nx = (q[1] - p[1]) * sgn, ny = -(q[0] - p[0]) * sgn; const l = Math.hypot(nx, ny); if (l < 1e-6) continue; nx /= l; ny /= l;
    out = clipHalf(out, nx, ny, nx * p[0] + ny * p[1] - g); if (out.length < 3) return [];
  }
  return out;
}
function chaikin(poly, it) {
  let p = poly;
  for (let n = 0; n < it; n++) { const o = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } p = o; }
  return p;
}
function chamfer(poly, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i - 1 + poly.length) % poly.length], p = poly[i], b = poly[(i + 1) % poly.length];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const cc = c * rr(0.85, 1.1), ca = Math.min(cc, la * 0.35), cb = Math.min(cc, lb * 0.35);
    out.push([p[0] + (a[0] - p[0]) * ca / la, p[1] + (a[1] - p[1]) * ca / la], [p[0] + (b[0] - p[0]) * cb / lb, p[1] + (b[1] - p[1]) * cb / lb]);
  }
  return out;
}
// non-convex test (stones get wobbly vertices, so use even-odd)
function inPoly(poly, x, y) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }

// ---------- layout ----------
const SURFACE = C.SURFACE, ROCK_TOP = C.ROCK_TOP;
const maskAt = (x, y) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < MASK.W && y < MASK.H && MASK.rows[y][x] === '1'; };
const colBottom = new Int16Array(W).fill(-1);
for (let x = 0; x < MASK.W; x++) for (let y = MASK.H - 1; y >= ROCK_TOP; y--) if (maskAt(x, y)) { colBottom[x] = y; break; }
const BOTTOM_MID = Math.max(...colBottom);
let L = W, R = 0; for (let x = 0; x < MASK.W; x++) if (maskAt(x, ROCK_TOP + 1)) { L = Math.min(L, x); R = Math.max(R, x); }
const SH = { left: L, right: R + 1 }, CX = (L + R + 1) / 2;
const bottomF = (x) => colBottom[Math.max(0, Math.min(W - 1, Math.floor(x)))];
// the original's exact silhouette, on whole pixels; the rock starts just under the turf
const inBodyF = (x, y) => y >= ROCK_TOP - 2 && maskAt(x, y);

// ---------- stones ----------
const STRETCH = 1;
const seeds = [];
{
  const cen = (h) => { let x = 0, y = 0; for (const p of h) { x += p[0]; y += p[1]; } return [x / h.length, y / h.length]; };
  const MAXA = 640;
  for (const h of MASK.stones) {
    const [x, y] = cen(h), A = Math.abs(area(h)); if (y < ROCK_TOP - 2) continue;
    const n = Math.ceil(A / MAXA);
    if (n === 1) { seeds.push({ x, y, r: Math.sqrt(A / Math.PI) * 0.85, hull: h }); continue; }
    // merged trace: split along its longer side into n stones of the right size
    const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]), bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n, sx = bw >= bh ? Math.min(...xs) + bw * f : x, sy = bw >= bh ? y : Math.min(...ys) + bh * f;
      if (inPoly(h, sx, sy)) seeds.push({ x: sx + rr(-1, 1), y: sy + rr(-1, 1), r: Math.sqrt(A / n / Math.PI) * 0.85, hull: h });
    }
  }
  // filler stones in rock the trace left bare (under moss in the original)
  const near = (x, y) => seeds.some((s) => s.hull ? inPoly(s.hull, x, y) : Math.hypot(s.x - x, s.y - y) < C.stones.w[0] * 0.6);
  for (let y = ROCK_TOP + 3; y < H; y += 3) for (let x = 2; x < W; x += 3) if (maskAt(x, y) && !near(x, y)) seeds.push({ x: x + rr(-1, 1), y: y + rr(-1, 1), r: 2 });
}
const LIGHT = (() => { const v = [-0.5, -0.72, 0.55], l = Math.hypot(...v); return v.map((c) => c / l); })();
const stones = [];
for (const s of seeds) {
  const cx = s.x / STRETCH; let poly;
  poly = [[cx - 60, s.y - 60], [cx + 60, s.y - 60], [cx + 60, s.y + 60], [cx - 60, s.y + 60]]; // weighted cell partitions the rock fully
  for (const o of seeds) {
    if (o === s) continue; const ox = o.x / STRETCH; if (Math.hypot(ox - cx, o.y - s.y) > 90) continue;
    poly = clipHalf(poly, 2 * (ox - cx), 2 * (o.y - s.y), ox * ox + o.y * o.y - cx * cx - s.y * s.y - o.r * o.r + s.r * s.r);
    if (poly.length < 3) break;
  }
  if (poly.length < 3) continue;
  poly = poly.map(([x, y]) => [x * STRETCH, y]);
  poly = clipHalf(poly, 0, -1, -(ROCK_TOP + 0.6));
  poly = inset(poly, rr(0.95, 1.1));
  if (poly.length < 3 || Math.abs(area(poly)) < 5) continue;
  poly = chaikin(chamfer(poly, 1.2), 2);   // soft rounded pebble outline
  // messy: wobble every vertex a little so edges are not ruler-straight
  poly = poly.map(([x, y]) => [x + rr(-0.12, 0.12), y + rr(-0.12, 0.12)]);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  const [mx, my] = centroid(poly);
  const apex = [mx - bw * rr(0.02, 0.2), my - bh * rr(0.08, 0.28)];
  const k = C.vary ? rr(0.32, 0.5) : rr(0.5, 0.75); // wider bevels on the chunky platforms
  const top = poly.map(([x, y]) => [apex[0] + (x - apex[0]) * k, apex[1] + (y - apex[1]) * k]);
  const sgn = Math.sign(area(poly)) || 1;
  const bevels = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]; let nx = (q[1] - p[1]) * sgn, ny = -(q[0] - p[0]) * sgn; const l = Math.hypot(nx, ny) || 1;
    const sa = 0.78, N = [nx / l * sa, ny / l * sa, Math.sqrt(1 - sa * sa)];
    return { quad: [p, q, top[(i + 1) % poly.length], top[i]], b: N[0] * LIGHT[0] + N[1] * LIGHT[1] + N[2] * LIGHT[2] };
  });
  const crease = bw > 12 && rnd() < (C.vary ? 0.9 : 0.7) ? { a: rr(-0.8, 0.8), d: rr(-0.4, 0.3) } : null;
  const crack = false && bw > 14 ? { x: mx + rr(-bw * 0.2, bw * 0.2), y: my - bh * 0.3, len: rr(3, 6), dir: rr(-0.6, 0.6) } : null;
  const base = ri(1, 3) + (rnd() < 0.15 ? 1 : 0);
  stones.push({ poly, top, bevels, apex, crease, crack, base, bbox: [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))] });
}
function stoneTone(st, x, y) {
  let b;
  if (inPoly(st.top, x, y)) {
    b = 0.55;
    if (st.crease) { const ux = Math.cos(st.crease.a), uy = Math.sin(st.crease.a); if ((x - st.apex[0]) * uy - (y - st.apex[1]) * ux > st.crease.d * 3) b = 0.22; }
  } else {
    b = -0.2; for (const f of st.bevels) if (inPoly(f.quad, x, y)) { b = f.b; break; }
  }
  const depth = Math.min(1, (y - ROCK_TOP) / Math.max(1, BOTTOM_MID - ROCK_TOP));
  return st.base + Math.round(b * (C.vary ? 6.2 : 5) + 2.2) - Math.round(depth * depth * 2.6);
}

// ---------- rasterise rock with 4x4 supersampling ----------
const SS = 4, NS = SS * SS;
const bodyCov = new Uint8Array(W * H), stoneCov = new Uint8Array(W * H), toneHist = new Uint8Array(W * H * 12);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++)
  if (inBodyF(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) bodyCov[y * W + x]++;
for (const st of stones) {
  const [x0, y0, x1, y1] = st.bbox;
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
    if (!inPoly(st.poly, px, py) || !inBodyF(px - 0.6, py) || !inBodyF(px + 0.6, py) || !inBodyF(px, py + 0.6)) continue;
    const i = y * W + x; stoneCov[i]++;
    toneHist[i * 12 + clampI(stoneTone(st, px, py), 12)]++;
  }
}
{ // remove stone fragments smaller than 28 px (clipped slivers beside the outline) and their soft fringe
  const m = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = stoneCov[i] >= NS / 2 ? 1 : 0;
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!m[i0] || seen[i0]) continue;
    const comp = [i0], q = [i0]; seen[i0] = 1;
    while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (m[j] && !seen[j]) { seen[j] = 1; comp.push(j); q.push(j); } } }
    if (comp.length >= 8) continue;
    for (const i of comp) { const x = i % W, y = (i / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && (dx === 0 && dy === 0 || stoneCov[ny * W + nx] < NS / 2)) stoneCov[ny * W + nx] = 0; } }
  }
}
const rock = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) rock[i] = bodyCov[i] >= NS / 2 ? 1 : 0;
const inRock = (x, y) => x >= 0 && y >= 0 && x < W && y < H && rock[y * W + x] === 1;
const isStone = (x, y) => inRock(x, y) && stoneCov[y * W + x] >= NS / 2;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!inRock(x, y)) continue;
  const i = y * W + x;
  if (!inRock(x, y + 1) || !inRock(x - 1, y) || !inRock(x + 1, y)) { set(x, y, P.mortarDeep); continue; }
  if (stoneCov[i] >= NS / 2) {
    let best = 0, bi = 0; for (let t = 0; t < 12; t++) if (toneHist[i * 12 + t] > best) { best = toneHist[i * 12 + t]; bi = t; }
    // messy: occasional chips and speckles on the faces
    const h = hash(x, y, 70);
    if (h < 0.05) bi -= 1; else if (h > 0.97) bi += 1;
    if (C.vary) {
      const sn = (dx, dy) => stoneCov[(y + dy) * W + x + dx] >= NS / 2;
      if (!sn(0, -1) || !sn(-1, 0)) bi += 1;            // lit top-left rim
      if (!sn(0, 1) || !sn(1, 0)) bi -= 2;              // shadowed bottom-right rim
    }
    set(x, y, P.stone[clampI(bi, P.stone.length)]);
  } else if (stoneCov[i] >= NS / 4) {
    set(x, y, P.stone[0]);
  } else {
    const near = isStone(x - 1, y) || isStone(x + 1, y) || isStone(x, y - 1) || isStone(x, y + 1);
    // stray pebbles in wide mortar gaps
    const castShadow = C.vary && (isStone(x, y - 1) || isStone(x - 1, y - 1));
    set(x, y, near || castShadow ? P.mortarDeep : P.mortar);
  }
}
// rock body from the original art's own pixels (keeps its stones, sizes, depth and shading exactly)
if (C.fromArt && MASK.cells) {
  // stone label per pixel: the traced stone that contains it, nearest centroid wins where they overlap
  const HL = new Int32Array(W * H).fill(-1);
  if (C.hullMortar) {
    const cs = MASK.stones.map((h) => centroid(h));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inRock(x, y)) { HL[y * W + x] = -2; continue; }
      let best = -1, bd = 1e9;
      MASK.stones.forEach((h, k) => { if (!inPoly(h, x + 0.5, y + 0.5)) return; const d = Math.hypot(cs[k][0] - x, cs[k][1] - y); if (d < bd) { bd = d; best = k; } });
      HL[y * W + x] = best;
    }
  }
  const MP = [P.mortarDeep, P.mortar, P.mortarHi, ...P.stone];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inRock(x, y)) continue;
    const i = y * W + x, c = y < MASK.H ? MASK.cells[i] : -1;
    if (c < 0) continue;
    if (C.hullMortar && MASK.moss && MASK.moss[i] === '1') continue; // original moss spot: keep the generated stones there
    let cc = c;
    if (C.hullMortar && c <= 6 && HL[i] !== -2 && (HL[i] < 0 || (x + 1 < W && HL[i + 1] >= 0 && HL[i + 1] !== HL[i]) || (y + 1 < H && HL[i + W] >= 0 && HL[i + W] !== HL[i]))) cc = y <= ROCK_TOP + 1 ? 0 : 1;
    const c0 = c; void c0;
    if (C.toneShift && cc >= 3) cc = Math.max(3, Math.min(MP.length - 1, cc + C.toneShift)); // brightness match across the set
    if (C.edgeFade && cc >= 3) { // darker sides that fade inward: -2 at the rim, -1 a little further, dithered tail
      let d = 0; while (d < 8 && inRock(x - d - 1, y) && inRock(x + d + 1, y)) d++;
      const f = d <= 2 ? 2 : d <= 4 ? 1 : d <= 6 && (x + y) % 2 === 0 ? 1 : 0;
      cc = Math.max(3, cc - f);
    }
    stoneCov[i] = cc >= 3 ? NS : 0;                       // vines read cracks from the real mortar
    const edge = !inRock(x, y + 1) || !inRock(x - 1, y) || !inRock(x + 1, y);
    set(x, y, edge ? P.mortarDeep : MP[cc]);
  }
}
// cracks across some bigger stones
for (const st of stones) if (st.crack) {
  let { x, y } = st.crack;
  for (let k = 0; k < st.crack.len; k++) { const px = Math.round(x), py = Math.round(y); if (isStone(px, py)) set(px, py, P.stone[0]); y += 1; x += st.crack.dir + rr(-0.5, 0.5); }
}

// ---------- moss: thin winding vines draped down the rock, plus slim moss clinging to stone tops ----------
function mline(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let k = 0; k <= n; k++) { const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n); if (inRock(x, y)) set(x, y, c); } }
function vine(x, y, len, depth) {
  const amp = rr(1.2, 2.6), freq = rr(0.35, 0.6), ph = rr(0, 6.3), drift = rr(-0.18, 0.18);
  let px = x, py = y;
  for (let k = 1; k <= len; k++) {
    const nx = Math.round(x + drift * k + Math.sin(k * freq + ph) * amp * Math.min(1, k / 4)), ny = y + k;
    const t = k / len, tone = t < 0.35 ? 4 : t < 0.75 ? 3 : 2;
    mline(px, py, nx, ny, P.moss[tone]);
    if (t < 0.4 && k % 2 === 0 && inRock(nx + 1, ny)) set(nx + 1, ny, P.moss[Math.max(1, tone - 1)]);
    if (k % 3 === 1 && k > 1 && k < len - 1) {                    // little leaf pairs, alternating sides
      const d = (k % 2 ? 1 : -1);
      if (inRock(nx + d, ny)) { set(nx + d, ny, P.moss[Math.min(5, tone + 1)]); if (inRock(nx + d, ny + 1) && k % 2) set(nx + d, ny + 1, P.moss[tone]); }
      if (k % 6 === 1 && inRock(nx + 2 * d, ny - 1)) set(nx + 2 * d, ny - 1, P.moss[tone]);
    }
    if (len > 8 && k === Math.floor(len * 0.5) && depth < 1) vine(nx, ny, Math.floor(len * 0.45), depth + 1); // a branch
    px = nx; py = ny;
  }
  if (inRock(px, py + 1)) set(px, py + 1, P.moss[1]);              // curled tip
}
// slim moss hugging the top edge of some stones (follows the stone, 1-2px thick)
for (const st of stones) {
  const bw = st.bbox[2] - st.bbox[0]; if (true) continue; // straight strips read as dashes; vines carry the moss
  const x0 = st.bbox[0] + ri(2, 5), x1 = st.bbox[2] - ri(2, 5);
  for (let x = x0; x <= x1; x++) {
    let y = Math.max(ROCK_TOP, st.bbox[1] - 1); while (y < H - 2 && y < st.bbox[1] + 4 && !isStone(x, y)) y++;
    if (!isStone(x, y)) continue;
    const e = Math.min(x - x0, x1 - x) / Math.max(1, (x1 - x0) / 2), th = e > 0.5 ? 2 : 1 + (hash(x, 1, 24) < 0.4 ? 1 : 0);
    for (let k = 0; k < th; k++) set(x, y + k, P.moss[k === th - 1 && th > 1 ? 2 : 3 + (hash(x, k, 25) < 0.3 ? 1 : 0)]);
    if (th > 1 && hash(x, 2, 26) < 0.4) set(x, y + th, P.moss[1]);
  }
}
// vines that creep down through the mortar cracks, following them as they branch and bend
const isMortar = (x, y) => inRock(x, y) && !isStone(x, y);
function crackVine(x, y, len) {
  const seen = new Set([x + ',' + y]);
  let px = x, py = y, dirBias = rnd() < 0.5 ? -1 : 1;
  for (let k = 0; k < len; k++) {
    const t = k / len, tone = t < 0.45 ? 4 : t < 0.8 ? 3 : 2;
    if (inRock(px, py)) set(px, py, P.moss[isMortar(px, py) ? tone : Math.max(2, tone - 1)]);
    if (C.vines.w > 1 && inRock(px + 1, py)) set(px + 1, py, P.moss[Math.max(1, tone - 1)]);
    if (k % 3 === 2) { // leaf nubs spill onto the neighbouring stone face
      for (const d of [dirBias, -dirBias]) if (inRock(px + d, py) && isStone(px + d, py) && hash(px, py, 27) < 0.6) { set(px + d, py, P.moss[Math.min(5, tone + 1)]); break; }
    }
    const moves = [[0, 1, 3], [-1, 1, 2.2], [1, 1, 2.2], [-1, 0, 0.8], [1, 0, 0.8]].filter(([dx, dy]) => !seen.has((px + dx) + ',' + (py + dy)) && isMortar(px + dx, py + dy));
    let nx, ny;
    if (moves.length) {
      let tot = 0; for (const m of moves) { m[2] *= (m[0] === dirBias ? 1.5 : 1); tot += m[2]; }
      let r = rnd() * tot, m = moves[0]; for (const c of moves) { r -= c[2]; if (r <= 0) { m = c; break; } }
      nx = px + m[0]; ny = py + m[1];
    } else { let best = null; for (const dx of [0, -1, 1, -2, 2]) if (isMortar(px + dx, py + 2) && !seen.has((px + dx) + ',' + (py + 2))) { best = dx; break; } nx = px + (best === null ? (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.3 ? 1 : 0) : Math.sign(best)); ny = py + 1; if (!inRock(nx, ny)) break; } // hang across a stone face
    if (rnd() < 0.08) dirBias = -dirBias;
    seen.add(nx + ',' + ny); px = nx; py = ny;
    if (py >= bottomF(px) - 2) break;
  }
}
for (let n = 0, tries = 0; n < C.vines.n && tries < 4000; tries++) {
  const top = rnd() < 0.8;                                   // half start under the turf, half anywhere down the rock
  const x = Math.round(SH.left + 6 + (SH.right - SH.left - 12) * Math.pow(rnd(), 1.25)), y0 = top ? ROCK_TOP + 1 : ri(ROCK_TOP + 6, Math.max(ROCK_TOP + 7, bottomF(x) - 24));
  let y = y0; while (y < y0 + 8 && !isMortar(x, y)) y++;
  if (!isMortar(x, y)) continue;
  crackVine(x, y, rnd() < 0.65 ? ri(...C.vines.long) : ri(...C.vines.short)); n++;
}
// a few short free-hanging vines under the turf
for (let x = SH.left + ri(8, 20); x < SH.right - 8; x += ri(24, 52)) vine(x, ROCK_TOP + 1 + ri(0, 2), ri(6, 14), 0);
// moss clumps hanging off the underside: a lumpy cushion hugging the outline, with winding strands below
if (C.hangMoss) {
  const G = C.hangMoss, span = SH.right - SH.left;
  for (let g = 0; g < G.groups; g++) {
    const cx = Math.round(SH.left + span * (g + 0.5 + rr(-0.3, 0.3)) / G.groups), w = G.wide ? ri(9, 16) : ri(6, 12);
    for (let x = cx - (w >> 1); x <= cx + (w >> 1); x++) {
      const by = colBottom[x]; if (by < 0) continue;
      const f = Math.sin(Math.PI * (x - cx + (w >> 1) + 0.5) / (w + 1)), th = Math.max(1, Math.round(f * 3 + rr(-0.5, 0.5)));
      for (let k = 0; k < th + 1; k++) { const y = by - th + 1 + k; if (y >= ROCK_TOP && y < H - 2) set(x, y, P.moss[k === 0 ? 4 : k >= th ? 2 : 3 + (hash(x, y, 60) < 0.3 ? 1 : 0)]); }
      if (by + 2 < H - 2 && f > 0.4) set(x, by + 2, P.moss[1]); // cushion underside
      if (hash(x, g, 61) < 0.45 && f > 0.25) { // a strand
        let px = x, py = by + 2; const len = Math.max(2, Math.round(G.len * f * rr(0.3, 1))), ph = rr(0, 6);
        for (let k = 0; k < len && py < H - 2; k++) {
          set(px, py, P.moss[k < len * 0.4 ? 3 : k < len * 0.8 ? 2 : 1]);
          if (k % 3 === 1 && k < len - 1) set(px + (k % 6 < 3 ? 1 : -1), py, P.moss[4]);
          py++; px = Math.round(x + Math.sin(k * 0.45 + ph) * 1.2);
        }
      }
    }
  }
}

// ---------- turf: a thick, lumpy grass mat that drapes over the rock ----------
// No flat strips: the mat's underside is ragged with hanging clumps, and its top is a
// row of overlapping rounded tussocks sitting on the flat walk line.
const turfBottom = new Int16Array(W);
for (let x = 0; x < W; x++) {
  const n = vnoise(x, 3, 6, 80);
  turfBottom[x] = ROCK_TOP + 1 + Math.round(n * 3) + C.turfExtra;
}
// hanging clumps / drips over the stone tops
for (let x = SH.left + 2; x < SH.right - 2; x += ri(6, 16)) {
  const w = ri(3, 6) + C.turfExtra * 2, d = ri(2, 4);
  for (let k = 0; k < w; k++) turfBottom[x + k] = Math.max(turfBottom[x + k], ROCK_TOP + 1 + Math.round((d + C.turfExtra) * Math.sin(Math.PI * (k + 0.5) / w)) + C.turfExtra);
}
const turfTop = (x) => SURFACE - (vnoise(x, 9, 4, 81) > 0.55 ? 1 : 0); // tiny lumps along the walk line
const endCut = (x, y) => { const e = Math.min(x - SH.left, SH.right - x); return e < 0 || (e < 4 && y - SURFACE < 4 - e); }; // round the two ends
const inTurf = (x, y) => x >= 0 && x < W && y >= turfTop(x) && y <= turfBottom[x] && !endCut(x, y);
for (let y = SURFACE - 2; y < ROCK_TOP + 14; y++) for (let x = 0; x < W; x++) {
  if (!inTurf(x, y)) continue;
  const fromTop = y - turfTop(x), toBottom = turfBottom[x] - y;
  // leafy clumps: 3x2 bumps offset per row, lit from above
  const by = Math.floor(y / 2), off = (by * 2 + Math.floor(hash(by, 0, 82) * 3)) % 3, bx = Math.floor((x + off) / 3), lx = (x + off) % 3;
  let k = 4 + Math.floor(hash(bx, by, 83) * 2.4) - Math.floor(fromTop / 2);
  if (y % 2 === 0 && lx === 1) k += 1;              // bump highlight
  if (y % 2 === 1 && lx === 2) k -= 1;              // bump shadow
  if (fromTop === 0) k = Math.max(k, 5) + (hash(x, y, 84) < 0.3 ? 1 : 0);
  if (toBottom === 0) k = 0; else if (toBottom === 1) k = Math.min(k, 2);
  set(x, y, P.turf[clampI(k, P.turf.length)]);
}
// soft shadow the mat casts on the stones just below it
for (let x = 0; x < W; x++) { const y = turfBottom[x] + 1; if (inRock(x, y) && opaque(x, y)) set(x, y, P.mortarDeep); }

// ---------- tussocks and blades above the walk line ----------
function line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let k = 0; k <= n; k++) set(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), typeof c === 'function' ? c(k / n) : c); }
// rounded tussock humps so the top edge is lumpy, not a ruled line
for (let x = SH.left; x < SH.right; x += ri(3, 8)) {
  const w = ri(3, 7), h = ri(1, Math.round(3 * (1 + (FS - 1) * 0.6)));
  for (let k = 0; k < w; k++) {
    const hh = Math.round(h * Math.sin(Math.PI * (k + 0.5) / w));
    for (let d = 1; d <= hh; d++) if (!endCut(x + k, SURFACE)) set(x + k, SURFACE - d, P.turf[clampI(4 + d + (hash(x + k, d, 85) < 0.3 ? 1 : 0), P.turf.length)]);
  }
}
// sparse blades poking out
for (let x = SH.left + 3; x < SH.right - 3; x++) {
  if (hash(x, 2, 86) > 0.16 * FS) continue;
  const h = Math.round(ri(2, 4) * FS), lean = ri(-1, 1);
  line(x, SURFACE - 1, x + lean, SURFACE - h, (t) => P.turf[t > 0.6 ? 6 : 3]);
}
// a few bigger, irregular tufts (every one different)
for (let x = SH.left + ri(10, 25); x < SH.right - 6; x += Math.max(6, Math.round(ri(14, 46) / FS))) {
  const n = ri(2, 5) + (FS > 1.3 ? 2 : 0);
  for (let k = 0; k < n; k++) {
    const bx = x + ri(-2, 2), h = Math.round(ri(3, 7) * FS), lean = Math.round(ri(-3, 3) * FS), sh = ri(2, 4);
    line(bx, SURFACE - 1, bx + lean, SURFACE - h, (t) => P.turf[clampI(sh + (t > 0.65 ? 2 : 0), P.turf.length)]);
  }
}

// ---------- flowers ----------
function stemTo(x, h0, lean) { const h = Math.max(2, Math.min(Math.round(h0 * FS), SURFACE - 2)); line(x, SURFACE - 1, x + lean, SURFACE - h, P.stem); return [x + lean, SURFACE - h]; }
function pinkBloom(x, y) {
  if (FS > 1.3) { ['.xx.', 'xxxx', 'xxxx', '.xx.'].forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch === 'x') set(x - 2 + dx, y - 2 + dy, dx + dy < 2 ? P.pinkLight : dx + dy > 4 ? P.pinkDark : P.pink); })); return; } set(x, y - 1, P.pinkLight); set(x - 1, y, P.pinkLight); set(x, y, P.pink); set(x + 1, y, P.pink); set(x, y + 1, P.pinkDark); set(x + 1, y - 1, P.pink); }
function daisy(x, y) {
  if (FS > 1.3) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) < 4) set(x + dx, y + dy, dx + dy > 1 ? P.whiteShade : P.white); for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [1, 0], [0, 1]]) set(x + dx, y + dy, dx + dy > 0 ? P.yellowDark : P.yellow); return; } set(x, y - 1, P.white); set(x - 1, y, P.white); set(x + 1, y, P.whiteShade); set(x, y + 1, P.whiteShade); set(x, y, P.yellow); }
function buttercup(x, y) {
  if (FS > 1.3) { for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [1, 1]]) set(x + dx, y + dy, dy > 0 ? P.yellowDark : P.yellow); return; } set(x, y, P.yellow); set(x + 1, y, P.yellowDark); set(x, y - 1, P.yellow); }
const FD = 1, X0 = SH.left + 3, X1 = SH.right - 3;
for (let x = X0 + 1; x < X0 + C.pinkBed; x += ri(3, 6)) {
  const h = ri(5, 12), [ex, ey] = stemTo(x, h, ri(-1, 1)); pinkBloom(ex, ey);
  if (rnd() < 0.6) set(x + (rnd() < 0.5 ? -1 : 1), SURFACE - Math.round(h * 0.5), P.turf[3]);
}
for (let n = 0; n < (X1 - X0) / 28 * FD; n++) { const [ex, ey] = stemTo(ri(X0, X1), ri(2, 5), 0); daisy(ex, ey); }
for (let n = 0; n < (X1 - X0) / 70 * FD; n++) { const [ex, ey] = stemTo(ri(X0, X1), ri(2, 4), 0); buttercup(ex, ey); }
for (let n = 0; n < (X1 - X0) / 60 * FD; n++) { const [ex, ey] = stemTo(ri(X0, X1), ri(5, 8), ri(-1, 1)); set(ex, ey, P.bud); set(ex, ey - 1, P.bud); }
if (C.thistle) { // tall thistle: leafy stem, round spiky head, two side buds
  const tx = Math.round(CX) + ri(-3, 3), top = Math.max(3, SURFACE - 16);
  for (let y = SURFACE - 1; y >= top + 3; y--) set(tx, y, P.stem);
  for (const [ly, d] of [[SURFACE - 4, -1], [SURFACE - 6, 1], [SURFACE - 9, -1]]) { set(tx + d, ly, P.turf[3]); set(tx + 2 * d, ly - 1, P.turf[3]); set(tx + 3 * d, ly - 1, P.turf[4]); }
  const hy = top + 1; // head: green cup under a pink tuft
  for (const [dx, dy, c] of [[-1, 1, 3], [0, 1, 2], [1, 1, 3], [-1, 2, 2], [0, 2, 3], [1, 2, 2]]) set(tx + dx, hy + dy, P.turf[c]);
  for (const [dx, dy] of [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, -1], [0, -1], [1, -1], [-2, -1], [2, -1], [0, -2]]) set(tx + dx, hy + dy, dy === 0 ? P.pinkDark : dx === 0 && dy === -2 ? P.pinkLight : P.pink);
  for (const d of [-1, 1]) { const bx = tx + 4 * d, by = hy + 5; set(tx + 2 * d, by + 1, P.stem); set(tx + 3 * d, by, P.stem); set(bx, by - 1, P.pink); set(bx, by, P.turf[3]); }
}

// ---------- write ----------
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (let x = 0; x < W; x++) if (opaque(x, H - 1)) throw Error('bottom logical row must stay empty (it is cropped)');
  const logical = await sharp(Buffer.from(img.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await sharp(logical).toFile(path.join(OUT, NAME + '-logical.png'));
  const big = await sharp(logical).resize(W * SCALE, H * SCALE, { kernel: 'nearest' }).extract({ left: 0, top: 0, width: OUT_W, height: OUT_H }).png().toBuffer();
  await sharp(big).toFile(path.join(OUT, NAME + '-8x.png'));
  await sharp(big).webp({ lossless: true }).toFile(path.join(OUT, C.file));
  const { data } = await sharp(big).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < OUT_H; y++) for (let x = 0; x < OUT_W; x++) for (let c = 0; c < 4; c++)
    if (data[(y * OUT_W + x) * 4 + c] !== img[(Math.floor(y / SCALE) * W + Math.floor(x / SCALE)) * 4 + c]) throw Error('nearest-neighbour mismatch');
  const colors = new Set(); for (let i = 0; i < img.length; i += 4) if (img[i + 3]) colors.add(img[i] << 16 | img[i + 1] << 8 | img[i + 2]);
  console.log(`${NAME} seed ${SEED}: ${W}x${H} logical -> ${OUT_W}x${OUT_H} (${SCALE}x NN), ${colors.size} colours -> ${OUT}/${C.file}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
