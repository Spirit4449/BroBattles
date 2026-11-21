#!/usr/bin/env node
// Draven's effect atlases drawn in code as true pixel art: the Inferno super
// overlay (a seamless loop played behind him) and the splash
// hit explosion. Every frame is painted on a small logical grid in palette keys
// (fire, arcane, smoke, gold), coloured per team, then enlarged nearest-neighbour
// so each art pixel is a crisp block.
//   node scripts/art/draven-pixel/fx.cjs            -> output/draven-pixel/fx/ (previews)
//   node scripts/art/draven-pixel/fx.cjs --install  also writes the four atlases into
//                                                    public/assets/draven/
// Frame names and the loaders in characters/draven/constructor.js stay the same:
// special-bb*.json frames are sprite1..N, explosion-bb*.json are explosion1..N.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'output/draven-pixel/fx');
const ASSETS = path.join(ROOT, 'public/assets/draven');
const TAU = Math.PI * 2;

// ---------- palettes ----------
// Keys: F0 (white-hot) .. F5 (ember red) fire; A0 (white) .. A5 (deep) arcane;
// S0 (light) .. S2 (dark) smoke; G0/G1 gold accents.
const PALETTES = {
  default: {
    F0: '#fffbe8', F1: '#ffeb8f', F2: '#ffc23d', F3: '#ff8a1f', F4: '#e8501c', F5: '#a8261c',
    A0: '#ffffff', A1: '#f6dcff', A2: '#ff8ae0', A3: '#c264ff', A4: '#8a3cff', A5: '#4a1aa8',
    S0: '#6b3a86', S1: '#4a2462', S2: '#2a1338',
    G0: '#fff1b0', G1: '#ffc94a',
  },
  red: {
    F0: '#fff4e4', F1: '#ffd99a', F2: '#ff9e4a', F3: '#ff5a2f', F4: '#d9262a', F5: '#7e1222',
    A0: '#ffffff', A1: '#ffe2d6', A2: '#ff9a86', A3: '#ff4f52', A4: '#d8203a', A5: '#7a0e22',
    S0: '#5e3440', S1: '#40232c', S2: '#24141b',
    G0: '#fff0c4', G1: '#ffbf52',
  },
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---------- helpers ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const easeOut = (u) => 1 - (1 - clamp01(u)) ** 3;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

// A logical frame of palette keys (null = transparent).
class Grid {
  constructor(size) { this.size = size; this.px = new Array(size * size).fill(null); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  get(x, y) { return this.in(x, y) ? this.px[y * this.size + x] : null; }
  set(x, y, key) { x = Math.round(x); y = Math.round(y); if (this.in(x, y)) this.px[y * this.size + x] = key; }
  // Paint only where empty (for layers that sit underneath).
  under(x, y, key) { x = Math.round(x); y = Math.round(y); if (this.in(x, y) && !this.px[y * this.size + x]) this.px[y * this.size + x] = key; }
  // A b x b block whose top-left pixel is the rounded point.
  dot(x, y, key, b = 1) {
    x = Math.round(x - (b - 1) / 2); y = Math.round(y - (b - 1) / 2);
    for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) this.set(x + i, y + j, key);
  }
  line(x0, y0, x1, y1, key, b = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) this.dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, key, b);
  }
  // Ring of radius r and width b, drawn where `keep(angle)` (default all).
  ring(cx, cy, r, key, keep = () => true, ry = r, b = 1) {
    const n = Math.ceil(TAU * Math.max(r, ry) * 1.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      if (keep(a)) this.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * ry, key, b);
    }
  }
  // Four-point twinkle: a plus with arms of `len`, white core.
  twinkle(x, y, len, core, arm, tip = arm) {
    this.set(x, y, core);
    for (let i = 1; i <= len; i++) {
      const k = i === len ? tip : arm;
      this.set(x + i, y, k); this.set(x - i, y, k); this.set(x, y + i, k); this.set(x, y - i, k);
    }
  }
}

// Fill a grid from a scalar field mapped through a ramp with ordered dithering:
// value v in [0,1] picks ramp[floor(v*len + bayer-0.5)], values <= cut stay empty.
function fieldFill(g, field, ramp, { cut = 0.08, under = false, dither = 0.9 } = {}) {
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      const v = field(x + 0.5, y + 0.5);
      if (!(v > 0)) continue;
      const d = bayer(x, y);
      if (v + (d - 0.5) * 0.12 <= cut) continue;
      const idx = Math.max(0, Math.min(ramp.length - 1, Math.floor((1 - v) * ramp.length + (d - 0.5) * dither)));
      if (under) g.under(x, y, ramp[idx]); else g.set(x, y, ramp[idx]);
    }
  }
}

// Remove lone pixels with no 4-neighbour so dithering never leaves dust specks
// (sparks are drawn afterwards and are intentional singles).
function despeckle(g) {
  const out = g.px.slice();
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    if (!g.get(x, y)) continue;
    if (!g.get(x + 1, y) && !g.get(x - 1, y) && !g.get(x, y + 1) && !g.get(x, y - 1)) out[y * g.size + x] = null;
  }
  g.px = out;
}

// Dark rim around smoke (only on empty pixels) so puffs read as solid shapes.
function outline(g, keys, rimKey) {
  const add = [];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    if (g.get(x, y)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (keys.has(g.get(x + dx, y + dy))) { add.push([x, y]); break; }
  }
  for (const [x, y] of add) g.set(x, y, rimKey);
}

// ---------- explosion ----------
// 48px logical, 10 frames at 24 fps. Opens on the impact (no build-up), so the
// game plays it from frame 1. Kept compact: a white flash, a cluster of fire
// blobs that swell and break apart, a brief broken shock ring, sparks thrown
// out under gravity, a few small purple smoke puffs and arcane glints, all gone
// by the last frame.
const EX = { size: 48, frames: 10, scale: 2 };
// Max-combine heat stamps into a field, then fill through a ramp.
function heatFill(g, stamps, ramp, cut = 0.1, dither = 0.9) {
  const heat = new Float32Array(g.size * g.size);
  for (const s of stamps) {
    const r = s.r;
    for (let y = Math.floor(s.y - r - 1); y <= s.y + r + 1; y++) for (let x = Math.floor(s.x - r - 1); x <= s.x + r + 1; x++) {
      if (!g.in(x, y)) continue;
      const d = Math.hypot(x + 0.5 - s.x, (y + 0.5 - s.y) * (s.squash || 1)) / r;
      if (d >= 1) continue;
      const v = (1 - d * d) * s.h;
      const i = y * g.size + x;
      if (v > heat[i]) heat[i] = v;
    }
  }
  fieldFill(g, (x, y) => heat[Math.floor(y) * g.size + Math.floor(x)], ramp, { cut, dither });
}

function explosionFrames() {
  const N = EX.frames, S = EX.size, cx = S / 2, cy = S / 2 + 1;
  const rand = rng(41);
  const blobs = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * TAU + (rand() - 0.5) * 0.6;
    return { a, out: 4 + rand() * 5, r: 3.2 + rand() * 2.2, life: 0.5 + rand() * 0.3, lift: 2 + rand() * 3 };
  });
  const sparks = Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * TAU + (rand() - 0.5) * 0.5 - Math.PI / 2;
    return { a, v: 10 + rand() * 8, life: 0.45 + rand() * 0.5, big: rand() < 0.3 };
  });
  const puffs = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * TAU + rand() * 0.9 - Math.PI / 3;
    return { a, dist: 6 + rand() * 3, drift: 3 + rand() * 3, r: 2.4 + rand() * 1.2, start: 0.22 + rand() * 0.12 };
  });
  const glints = [{ x: cx - 10, y: cy - 8, t0: 0.15 }, { x: cx + 11, y: cy - 3, t0: 0.32 }, { x: cx + 3, y: cy + 10, t0: 0.5 }];
  const frames = [];
  for (let f = 0; f < N; f++) {
    const t = f / (N - 1);
    const g = new Grid(S);
    // Fire: a hot centre plus blobs flung outward that rise, shrink and cool.
    const stamps = [];
    const core = 1 - t / 0.5;
    if (core > 0) stamps.push({ x: cx, y: cy, r: 5 + 5 * easeOut(t * 3), h: 0.6 + 0.6 * core });
    for (const b of blobs) {
      const u = t / b.life;
      if (u >= 1) continue;
      const k = easeOut(u * 1.6);
      stamps.push({
        x: cx + Math.cos(b.a) * b.out * k,
        y: cy + Math.sin(b.a) * b.out * k - b.lift * u,
        r: b.r * (0.75 + 0.6 * k) * (1 - 0.65 * u * u),
        h: 1.05 - u * 0.9,
      });
    }
    heatFill(g, stamps, ['F0', 'F1', 'F2', 'F3', 'F4', 'F5'], 0.08);
    // Smoke puffs underneath, dissolving with dither.
    for (const p of puffs) {
      const u = (t - p.start) / (1 - p.start);
      if (u < 0) continue;
      const px = cx + Math.cos(p.a) * (p.dist + p.drift * easeOut(u));
      const py = cy + Math.sin(p.a) * (p.dist + p.drift * easeOut(u)) - 6 * u;
      const r = p.r * (0.8 + 0.5 * easeOut(u)) * (1 - 0.4 * u);
      const fade = 1 - u * 0.95;
      for (let y = Math.floor(py - r - 1); y <= py + r + 1; y++) for (let x = Math.floor(px - r - 1); x <= px + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / r;
        if (d > 1 || bayer(x, y) > fade * 1.2 - d * 0.3) continue;
        g.under(x, y, d < 0.5 && y + 0.5 < py ? 'S0' : 'S1');
      }
    }
    despeckle(g);
    outline(g, new Set(['S0', 'S1']), 'S2');
    // Impact flash: white core and rays on the first two frames.
    if (f <= 1) {
      const len = f === 0 ? 13 : 8;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + (Math.PI / 8) * f;
        const l = i % 2 ? len * 0.5 : len;
        for (let k = 0; k <= l; k++) g.set(cx + Math.cos(a) * k, cy + Math.sin(a) * k, k < l * 0.5 ? 'F0' : k < l * 0.8 ? 'F1' : 'F2');
      }
      const r = f === 0 ? 3.5 : 2.5;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= r * r) g.set(cx + x, cy + y, 'F0');
    }
    // Shock ring: brief, broken, behind nothing.
    if (f >= 1 && f <= 3) {
      const r = 9 + f * 4;
      const key = ['F1', 'F2', 'F3'][f - 1];
      g.ring(cx, cy, r, key, (a) => Math.sin(a * 7 + f) > (f - 1) * 0.35 - 0.2);
    }
    // Sparks: fly out with drag, fall, cool, with a one-pixel trail.
    for (const s of sparks) {
      const u = t / s.life;
      if (u <= 0.05 || u > 1) continue;
      const pos = (q) => [cx + Math.cos(s.a) * s.v * (q * (1.4 - 0.6 * q)), cy + Math.sin(s.a) * s.v * (q * (1.4 - 0.6 * q)) + 9 * q * q];
      const [x, y] = pos(u), [tx, ty] = pos(u - 0.12);
      const key = u < 0.3 ? 'F0' : u < 0.55 ? 'F1' : u < 0.8 ? 'F2' : 'F4';
      g.line(tx, ty, x, y, u < 0.5 ? 'F2' : 'F4');
      g.set(x, y, key);
      if (s.big && u < 0.5) { g.set(x + 1, y, key); g.set(x, y + 1, key); g.set(x + 1, y + 1, key); }
    }
    for (const gl of glints) {
      const u = (t - gl.t0) / 0.3;
      if (u < 0 || u > 1) continue;
      g.twinkle(gl.x, gl.y, u < 0.34 ? 1 : u < 0.67 ? 3 : 2, 'A0', 'A2', 'A3');
    }
    frames.push(g);
  }
  return frames;
}

// ---------- inferno overlay ----------
// Designed on a 96px square (SP.art) inside a 144px canvas for headroom,
// exported at 2x (288px frames),
// 24 frames = a one-second
// seamless loop at 24 fps, drawn behind Draven with normal blending (additive
// washed the palette out on bright maps). Layers, back to front: a faint
// dithered halo, flame tongues licking up from a rune circle, shock rings
// rolling out twice a loop, the rotating rune circle and a counter-rotating
// dashed inner circle, rising embers, three orbiting fire motes with trails,
// crackling arcs and twinkles, and a pulsing star at the heart.
// SP.art is the reference square the effect is designed on; the frame adds
// headroom round it so the tallest flames and wisps never touch the edge. The
// game sizes the overlay from SP.art * SP.scale (special.js INFERNO_FX_ART_PX).
// Drawn on a 96px grid and doubled: chunky pixels to match the game's art.
const SP = { size: 144, art: 96, frames: 24, scale: 2 };
function infernoFrames() {
  const N = SP.frames, S = SP.size, K = SP.art / 72; // K: art pixels per original 72-grid unit
  const cx = S / 2, cy = S / 2 + 3 * K;
  const ringR = 24 * K;
  const rand = rng(7);
  const embers = Array.from({ length: 30 }, () => ({
    x: cx + (rand() - 0.5) * 56 * K, y0: rand(), speed: 1 + Math.floor(rand() * 2), wob: rand() * TAU,
    key: rand() < 0.45 ? 'F1' : rand() < 0.5 ? 'A2' : 'F2', big: rand() < 0.4,
  }));
  const twinkles = Array.from({ length: 9 }, (_, i) => {
    const a = rand() * TAU, r = (30 + rand() * 4) * K;
    return { x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r * 0.85), t0: Math.floor((i / 9) * N + rand() * 2) };
  });
  // 18 flame tongues round the circle, longest on top, small underneath.
  const tongues = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * TAU + (rand() - 0.5) * 0.15;
    const up = Math.max(0, -Math.sin(a));
    const down = Math.max(0, Math.sin(a));
    return { a, len: (3.5 + 9 * up ** 1.2 + rand() * 2 - 0.6 * down) * K, w: (2.3 + 2.3 * up - 0.2 * down) * K, m: 1 + (i % 3), ph: rand() * TAU };
  });
  // Flame wisps that break off the tips and rise, one per tongue per loop.
  const wisps = tongues.map((k, i) => ({ k, t0: ((i * 7) % 18) / 18 }));
  // Arcs: a jagged bolt hopping between two runes, with a forked branch.
  const arcs = [
    { f: 2, a0: -2.6, a1: -1.7 }, { f: 8, a0: 0.3, a1: 1.1 }, { f: 13, a0: 2.3, a1: 3.1 }, { f: 19, a0: -1.0, a1: -0.2 },
  ].map((arc) => {
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const u = i / 7, am = arc.a0 + (arc.a1 - arc.a0) * u;
      const rr = ringR + K + (i === 0 || i === 7 ? 0 : (Math.sin(u * Math.PI) * 6 + (i % 2 ? 2.5 : -0.5) + rand() * 1.5) * K);
      pts.push([cx + Math.cos(am) * rr, cy + Math.sin(am) * rr]);
    }
    const at = pts[3];
    const out = Math.atan2(at[1] - cy, at[0] - cx) + (rand() - 0.5) * 0.8;
    const fork = [at, [at[0] + Math.cos(out) * 3 * K, at[1] + Math.sin(out) * 3 * K], [at[0] + Math.cos(out + 0.5) * 6 * K, at[1] + Math.sin(out + 0.5) * 6 * K]];
    return { ...arc, pts, fork };
  });
  const glyphShapes = [
    [[-1, -1], [1, -1], [0, 1], [-1, -1]], // triangle
    [[0, -1.3], [1, 0], [0, 1.3], [-1, 0], [0, -1.3]], // diamond
    [[-1, -1], [-1, 1], [1, 1], [1, -1]], // open bracket
    [[-1.2, 0], [1.2, 0], [0, 0], [0, -1.2], [0, 1.2]], // cross
  ];

  const frames = [];
  for (let f = 0; f < N; f++) {
    const t = f / N; // loop phase 0..1, never reaches 1
    const w = TAU * t;
    const g = new Grid(S);
    const breathe = 0.5 + 0.5 * Math.sin(2 * w);

    // Flame tongues: stamps along a path that leaves the circle and bends upward.
    const stamps = [];
    for (const k of tongues) {
      const L = k.len * (0.75 + 0.25 * Math.sin(k.m * w + k.ph));
      if (L < K) continue;
      const ra = [Math.cos(k.a), Math.sin(k.a)];
      for (let s = 0; s <= L; s += 0.5) {
        const q = s / L;
        // A wave travels up each tongue so it licks rather than sways.
        const wave = Math.sin(q * 5 - k.m * 2 * w + k.ph) * 1.4 * K * q;
        const x = cx + ra[0] * (ringR - K + s * 0.6) + wave;
        const y = cy + ra[1] * (ringR - K + s * 0.6) - s * 0.8 * q - (ra[1] < 0.3 ? s * 0.3 : 0);
        stamps.push({ x, y, r: Math.max(0.9, k.w * (1 - q) ** 0.7 + 0.4 * K), h: 1.05 - q * 0.8 });
      }
    }
    for (const wp of wisps) {
      const u = (t - wp.t0 + 1) % 1;
      if (u > 0.45) continue;
      const q = u / 0.45, k = wp.k, ra = [Math.cos(k.a), Math.sin(k.a)];
      const tipS = k.len * 0.9;
      const x = cx + ra[0] * (ringR - K + tipS * 0.6) + Math.sin(q * 6 + k.ph) * 1.2 * K;
      const y = cy + ra[1] * (ringR - K + tipS * 0.6) - tipS * 0.9 - q * 9 * K;
      if (y < 2) continue;
      stamps.push({ x, y, r: (1.3 * (1 - q) + 0.5) * K, h: 0.7 - q * 0.5 });
    }
    // Four flat bands with little dithering keep the flames chunky.
    heatFill(g, stamps, ['F0', 'F1', 'F2', 'F4'], 0.12, 0.3);
    despeckle(g);

    // Inner fire rim: a flickering dithered band of embers just inside the circle.
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d > ringR - 0.5 * K || d < ringR - 3.2 * K) continue;
      const a = Math.atan2(dy, dx);
      const v = 0.35 + 0.3 * Math.sin(8 * a + 2 * w) * Math.sin(5 * a - 3 * w) + 0.25 * ((d - (ringR - 3.2 * K)) / (2.7 * K));
      if (bayer(x, y) < v) g.under(x, y, v > 0.62 ? 'F2' : v > 0.45 ? 'F3' : 'F4');
    }
    // Vortex: three dithered spiral arms turning a third of a turn per loop,
    // densest at the rim, so the circle reads as a filled arcane field.
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d > ringR - K) continue;
      const a = Math.atan2(dy, dx), u = d / ringR;
      const arm = 0.5 + 0.5 * Math.cos(3 * (a - w / 3) + u * 7);
      const v = 0.18 + 0.42 * u ** 1.4 + 0.38 * arm * (0.4 + u) + 0.06 * breathe;
      if (bayer(x, y) >= v) continue;
      g.under(x, y, arm > 0.82 && u > 0.35 ? 'A3' : arm > 0.45 || u > 0.8 ? 'A4' : 'A5');
    }

    // Shock rings rolling out twice per loop.
    for (const off of [0, 0.5]) {
      const u = ((t + off) % 1) * 2;
      if (u > 1) continue;
      const r = ringR - 2 * K + 12 * K * easeOut(u);
      g.ring(cx, cy, r, u < 0.3 ? 'A1' : u < 0.6 ? 'A2' : 'A3',
        (a) => bayer(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)) < 1 - u * 1.1, r, 1);
    }

    // Rune circle: a double line with 8 glyphs, one-eighth turn per loop
    // (seamless by symmetry). The glyph under the turning "hand" flares white.
    const rot = w / 8;
    g.ring(cx, cy, ringR, 'A3');
    g.ring(cx, cy, ringR + 3 * K, 'A4', (a) => (((((a - rot) / TAU) * 32) % 1) + 1) % 1 < 0.6);
    const lit = Math.floor(t * 8);
    for (let i = 0; i < 8; i++) {
      const a = rot + (i / 8) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const at = (rad, side) => [cx + ca * rad - sa * side, cy + sa * rad + ca * side];
      const gr = ringR + 1.5 * K;
      const key = i === lit ? 'A0' : (i - lit + 8) % 8 === 7 ? 'A1' : 'A2';
      const shape = glyphShapes[i % glyphShapes.length];
      for (let p = 0; p < shape.length - 1; p++) {
        const [s0, r0] = shape[p], [s1, r1] = shape[p + 1];
        g.line(...at(gr + r0 * 1.6 * K, s0 * 1.6 * K), ...at(gr + r1 * 1.6 * K, s1 * 1.6 * K), key);
      }
    }
    const rot2 = -w / 12;
    g.ring(cx, cy, ringR - 5 * K, 'A4', (a) => (((((a - rot2) / TAU) * 12) % 1) + 1) % 1 < 0.5);
    // Eight-point star sigil ({8/3}) inside the circle, an eighth of a turn
    // per loop the opposite way, with glints at its points.
    const rot3 = -w / 8, starR = ringR - 7 * K;
    const pt = (i) => [cx + Math.cos(rot3 + (i / 8) * TAU) * starR, cy + Math.sin(rot3 + (i / 8) * TAU) * starR];
    for (let i = 0; i < 8; i++) g.line(...pt(i), ...pt((i + 3) % 8), 'A2');
    for (let i = 0; i < 8; i++) {
      const [x, y] = pt(i);
      g.twinkle(Math.round(x), Math.round(y), (i + Math.floor(t * 8)) % 4 === 0 ? 3 : 1, 'A0', 'A1', 'A2');
    }
    // Tick marks on the inner circle, turning with it.
    for (let i = 0; i < 24; i++) {
      const a = rot2 + (i / 24) * TAU;
      const r0 = ringR - 5 * K - (i % 2 ? 1 : 2.5) * K;
      g.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * (ringR - 5 * K), cy + Math.sin(a) * (ringR - 5 * K), 'A3');
    }

    // Embers rising, wrapping a whole number of times per loop.
    for (const e of embers) {
      const u = (e.y0 + t * e.speed) % 1;
      const y = cy + 26 * K - u * 62 * K, x = e.x + Math.sin(e.wob + u * TAU * 1.5) * 1.5 * K;
      const d = Math.hypot(x - cx, y - cy);
      if (d > 35.5 * K || d < ringR - 3 * K) continue;
      const key = u > 0.75 ? 'F3' : e.key;
      g.dot(x, y, key, 1);
      if (u < 0.55 && e.big) g.dot(x, y + 1, 'F4', 1);
    }

    // Orbiting motes: one lap per loop on a tilted ellipse, with tapering trails.
    for (let k = 0; k < 3; k++) {
      const base = w + (k / 3) * TAU;
      const orbit = (a) => [cx + Math.cos(a) * (ringR + 7 * K), cy - 2 * K + Math.sin(a) * (ringR + 7 * K) * 0.4 + Math.cos(a) * 3 * K];
      for (let s = 14; s >= 1; s--) {
        const key = s < 3 ? 'G0' : s < 8 ? 'G1' : 'F3';
        g.line(...orbit(base - s * 0.06), ...orbit(base - (s - 1) * 0.06), key, s < 3 ? 2 : 1);
      }
      g.dot(...orbit(base), 'F0', 2);
      const a = base;
      const hx = Math.round(cx + Math.cos(a) * (ringR + 7 * K)), hy = Math.round(cy - 2 * K + Math.sin(a) * (ringR + 7 * K) * 0.4 + Math.cos(a) * 3 * K);
      g.twinkle(hx + 1, hy + 1, 3 + (f % 2), 'F0', 'G0', 'G1');
    }

    // Crackling arcs, two frames each.
    for (const arc of arcs) {
      const age = (f - arc.f + N) % N;
      if (age > 1) continue;
      const key = age === 0 ? 'A0' : 'A2';
      for (let i = 0; i < arc.pts.length - 1; i++) g.line(...arc.pts[i], ...arc.pts[i + 1], key);
      for (let i = 0; i < arc.fork.length - 1; i++) g.line(...arc.fork[i], ...arc.fork[i + 1], 'A1');
      if (age === 0) for (const [x, y] of [arc.pts[0], arc.pts[arc.pts.length - 1]]) g.twinkle(Math.round(x), Math.round(y), 3, 'A0', 'A1', 'A2');
    }

    for (const tw of twinkles) {
      const age = (f - tw.t0 + N) % N;
      if (age > 3) continue;
      const len = Math.round([1.5, 4, 3, 1.5][age] * K * 0.75);
      g.twinkle(tw.x, tw.y, len, 'A0', age < 2 ? 'A1' : 'A2', 'A3');
    }

    // Heart: a four-point star pulsing with the breath, glimpsed around Draven.
    const cxr = Math.round(cx), cyr = Math.round(cy);
    g.twinkle(cxr, cyr, Math.round((4 + 3 * breathe) * K), 'A0', 'A1', 'A3');
    g.twinkle(cxr + 1, cyr, Math.round((2 + 2 * breathe) * K), 'A0', 'A1', 'A2');
    frames.push(g);
  }
  return frames;
}

// ---------- export ----------
function toRGBA(grid, palette, scale) {
  const S = grid.size * scale;
  const buf = Buffer.alloc(S * S * 4);
  const cache = {};
  for (let y = 0; y < grid.size; y++) for (let x = 0; x < grid.size; x++) {
    const key = grid.get(x, y);
    if (!key) continue;
    const c = cache[key] || (cache[key] = hex(palette[key]));
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
      const i = ((y * scale + yy) * S + x * scale + xx) * 4;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  }
  return { buf, size: S };
}

async function writeAtlas(frames, palette, scale, cols, prefix, file) {
  const size = frames[0].size * scale;
  const rows = Math.ceil(frames.length / cols);
  const W = cols * size, H = rows * size;
  const composite = frames.map((g, i) => {
    const { buf } = toRGBA(g, palette, scale);
    return { input: buf, raw: { width: size, height: size, channels: 4 }, left: (i % cols) * size, top: Math.floor(i / cols) * size };
  });
  const png = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composite).png().toBuffer();
  const json = {
    frames: frames.map((_, i) => ({
      filename: `${prefix}${i + 1}`,
      frame: { x: (i % cols) * size, y: Math.floor(i / cols) * size, w: size, h: size },
      rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: size, h: size },
      sourceSize: { w: size, h: size },
    })),
    meta: { app: 'scripts/art/draven-pixel/fx.cjs', image: `${file}.webp`, format: 'RGBA8888', size: { w: W, h: H }, scale: '1' },
  };
  return { png, json };
}

// Preview: frames over a dark game-like backdrop (`additive` simulates ADD
// blending, for comparing against the old additive overlay).
async function previewStrip(frames, palette, scale, cols, file, { additive = false, bg = [32, 36, 48], zoom = 1 } = {}) {
  const size = frames[0].size * scale;
  const rows = Math.ceil(frames.length / cols);
  const W = cols * size, H = rows * size;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) out.set(bg, i * 3);
  frames.forEach((g, i) => {
    const { buf } = toRGBA(g, palette, scale);
    const ox = (i % cols) * size, oy = Math.floor(i / cols) * size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      if (!buf[s + 3]) continue;
      const d = ((oy + y) * W + ox + x) * 3;
      for (let k = 0; k < 3; k++) out[d + k] = additive ? Math.min(255, out[d + k] + buf[s + k]) : buf[s + k];
    }
  });
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).resize(W * zoom, H * zoom, { kernel: 'nearest' }).png().toFile(file);
}

async function previewGif(frames, palette, scale, file, opts) {
  const tmp = path.join(OUT, 'tmp-' + path.basename(file, '.gif'));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (let i = 0; i < frames.length; i++) {
    await previewStrip([frames[i]], palette, scale, 1, path.join(tmp, `f${String(i).padStart(3, '0')}.png`), opts);
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', path.join(tmp, 'f%03d.png'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', file]);
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  const install = process.argv.includes('--install');
  fs.mkdirSync(OUT, { recursive: true });
  const ex = explosionFrames();
  const sp = infernoFrames();
  const jobs = [
    { frames: ex, scale: EX.scale, cols: 5, prefix: 'explosion', name: 'explosion-bb', additive: false },
    { frames: sp, scale: SP.scale, cols: 6, prefix: 'sprite', name: 'special-bb', additive: false },
  ];
  for (const job of jobs) {
    for (const [team, palette] of Object.entries(PALETTES)) {
      const file = team === 'default' ? job.name : `${job.name}-red`;
      const { png, json } = await writeAtlas(job.frames, palette, job.scale, job.cols, job.prefix, file);
      await sharp(png).toFile(path.join(OUT, `${file}.png`));
      const zoom = job.frames[0].size * job.scale > 200 ? 1 : 3;
      await previewStrip(job.frames, palette, job.scale, job.cols, path.join(OUT, `${file}-preview.png`), { additive: job.additive, zoom });
      await previewGif(job.frames, palette, job.scale, path.join(OUT, `${file}.gif`), { additive: job.additive, zoom });
      if (install) {
        await sharp(png).webp({ lossless: true, effort: 6 }).toFile(path.join(ASSETS, `${file}.webp`));
        fs.writeFileSync(path.join(ASSETS, `${file}.json`), JSON.stringify(json));
      }
    }
  }
  console.log(`Wrote previews to ${path.relative(ROOT, OUT)}${install ? ' and installed atlases into public/assets/draven' : ''}.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
