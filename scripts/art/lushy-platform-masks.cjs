#!/usr/bin/env node
// Prepares tracing data for generate-lushy-platforms.cjs from the installed Lushy art:
//  - the rock silhouette on the logical grid (so remakes keep the original shapes), and
//  - every original stone (found by the dark mortar between them) as a convex outline, so the
//    remakes copy the originals' stone sizes, long/small variety and placement.
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('../../spritesheet-generator/node_modules/sharp');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'output/lushy-code-platforms');
// S: texture px per logical px (on-screen pixel size matches the large ledge); smooth: majority passes on the outline.
// The large ledge keeps its approved outline, read from its own logical render.
const ITEMS = {
  base: { art: 'base.webp', S: 12, smooth: 2 },
  small: { art: 'smallPlatform.webp', S: 40, smooth: 0 },
  side: { art: 'sidePlatform.webp', S: 24, smooth: 1 },
  large: { art: 'largePlatform.webp', S: 8, smooth: 0, outline: 'output/lushy-code-large/large-logical.png' },
};
// rock palette shared with generate-lushy-platforms.cjs: index 0-2 mortar, 3-13 stone ramp
const PAL = ['#2a1a22', '#36242b', '#3f2a30', '#3f2a30', '#4a3236', '#523a3a', '#5c3f3f', '#644442', '#6c4a45', '#755249', '#7e5a4f', '#886056', '#94685b', '#9e7060']
  .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const nearest = (r, g, b) => { let best = 0, bd = 1e9; for (let k = 0; k < PAL.length; k++) { const d = (PAL[k][0] - r) ** 2 * 0.3 + (PAL[k][1] - g) ** 2 * 0.59 + (PAL[k][2] - b) ** 2 * 0.11; if (d < bd) { bd = d; best = k; } } return best; };
function morph(m, W, H, r, grow) {
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = x + dx, ny = y + dy, b = nx >= 0 && ny >= 0 && nx < W && ny < H ? m[ny * W + nx] : 0;
      if (grow && b) v = 1; if (!grow && !b) v = 0;
    }
    o[y * W + x] = v;
  }
  return o;
}
function components(m, W, H) {
  const lab = new Int32Array(W * H).fill(-1), comps = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!m[i0] || lab[i0] >= 0) continue;
    const id = comps.length, cells = [], q = [i0]; lab[i0] = id;
    while (q.length) { const i = q.pop(); cells.push(i); const x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (m[j] && lab[j] < 0) { lab[j] = id; q.push(j); } } }
    comps.push(cells);
  }
  return comps;
}
function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, it] of Object.entries(ITEMS)) {
    const S = it.S;
    const { data, info } = await sharp(path.join(ROOT, 'output/lushy-code-platforms/originals', it.art)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = Math.ceil(info.width / S), H = Math.ceil(info.height / S);
    const px = (x, y) => (y * info.width + x) * 4;
    let m = new Uint8Array(W * H);
    if (it.outline) {
      const o = await sharp(path.join(ROOT, it.outline)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < Math.min(H, o.info.height); y++) for (let x = 0; x < Math.min(W, o.info.width); x++) { const i = (y * o.info.width + x) * 4; m[y * W + x] = o.data[i + 3] > 128 ? 1 : 0; }
    } else {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let rock = 0, opq = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
          const X = x * S + sx, Y = y * S + sy; if (X >= info.width || Y >= info.height) continue;
          const i = px(X, Y); if (data[i + 3] < 128) continue; opq++; if (data[i] >= data[i + 1]) rock++;
        }
        m[y * W + x] = rock + (opq - rock) * 0.5 > S * S * 0.5 ? 1 : 0;
      }
    }
    { // fill enclosed holes (moss, vines, turf shadow inside the rock)
      const inv = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) inv[i] = m[i] ? 0 : 1;
      for (const cells of components(inv, W, H)) if (!cells.some((i) => { const x = i % W, y = (i / W) | 0; return x === 0 || y === 0 || x === W - 1 || y === H - 1; })) for (const i of cells) m[i] = 1;
    }
    if (!it.outline) {
      const r = S >= 16 ? 1 : 2;
      m = morph(morph(m, W, H, r, false), W, H, r, true);
      const big = components(m, W, H).reduce((a, b) => (b.length > a.length ? b : a), []);
      m = new Uint8Array(W * H); for (const i of big) m[i] = 1;
      m = morph(morph(m, W, H, 1, true), W, H, 1, false);
      for (let k = 0; k < it.smooth; k++) {
        const o = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && m[ny * W + nx]) n++; } o[y * W + x] = n > 12 || (m[y * W + x] && y < H * 0.25) ? 1 : 0; }
        m = o;
      }
    }
    // art cells: the original's own colours on the logical grid. Mode (not mean) of the palette-snapped
    // pixels in each block keeps edges crisp; green (moss/grass) cells are -1 and get inpainted from stone.
    const cells = new Int16Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const votes = new Int32Array(PAL.length); let green = 0, n = 0;
      for (let sy = 0; sy < S; sy += Math.max(1, S >> 3)) for (let sx = 0; sx < S; sx += Math.max(1, S >> 3)) {
        const X = x * S + sx, Y = y * S + sy; if (X >= info.width || Y >= info.height) continue;
        const i = px(X, Y); if (data[i + 3] < 128) continue; n++;
        if (data[i + 1] > data[i]) { green++; continue; }
        votes[nearest(data[i], data[i + 1], data[i + 2])]++;
      }
      let best = -1, bv = 0; for (let k = 0; k < PAL.length; k++) if (votes[k] > bv) { bv = votes[k]; best = k; }
      cells[y * W + x] = n && green < n * 0.5 ? best : -1;
    }
    const moss = Array.from(cells, (c) => (c < 0 ? 1 : 0));
    for (let pass = 0; pass < 40; pass++) { // inpaint moss holes from neighbouring stone, nearest first
      let changed = 0; const c2 = cells.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!m[y * W + x] || cells[y * W + x] >= 0) continue;
        const nb = []; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && cells[ny * W + nx] >= 0) nb.push(cells[ny * W + nx]); }
        if (nb.length) { c2[y * W + x] = nb[(x + y) % nb.length]; changed++; }
      }
      cells.set(c2); if (!changed) break;
    }
    for (let pass = 0; pass < 2; pass++) { // clean lone pixels: a cell unlike all 4 neighbours takes their majority
      const c2 = cells.slice();
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const v = cells[y * W + x]; if (v < 0) continue;
        const nb = [cells[y * W + x - 1], cells[y * W + x + 1], cells[(y - 1) * W + x], cells[(y + 1) * W + x]].filter((c) => c >= 0);
        if (nb.length < 3 || nb.some((c) => Math.abs(c - v) <= 1)) continue;
        const cnt = {}; for (const c of nb) cnt[c] = (cnt[c] || 0) + 1; c2[y * W + x] = +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
      }
      cells.set(c2);
    }
    // stones: lit, non-green rock at half-logical resolution, separated by the dark mortar
    const G = S / 2, GW = Math.ceil(info.width / G), GH = Math.ceil(info.height / G);
    let st = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      let lit = 0, n = 0;
      for (let sy = 0; sy < G; sy += 2) for (let sx = 0; sx < G; sx += 2) {
        const X = x * G + sx, Y = y * G + sy; if (X >= info.width || Y >= info.height) continue;
        const i = px(X, Y); if (data[i + 3] < 128) continue; n++;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (0.3 * r + 0.59 * g + 0.11 * b > 53 && r >= g) lit++;
      }
      st[y * GW + x] = n && lit / n > 0.55 ? 1 : 0;
    }
    const stones = [];
    for (const cells of components(st, GW, GH)) {
      if (cells.length < 6) continue;
      const pts = [];
      for (const i of cells) { const x = i % GW, y = (i / GW) | 0; for (const [dx, dy] of [[-0.5, -0.5], [1.5, -0.5], [1.5, 1.5], [-0.5, 1.5]]) pts.push([(x + dx) * G / S, (y + dy) * G / S]); }
      stones.push(hull(pts).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]));
    }
    fs.writeFileSync(path.join(OUT, name + '-mask.json'), JSON.stringify({ W, H, scale: S, cells: Array.from(cells), moss: moss.join(''), rows: Array.from({ length: H }, (_, y) => Array.from(m.slice(y * W, y * W + W)).join('')), stones }));
    console.log(`${name}: ${W}x${H} @${S}x, ${stones.length} traced stones`);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
