#!/usr/bin/env node
// Cuts the moving parts out of Iron Junction's two backdrop layers.
//
//   node scripts/art/install-iron-junction-backdrop.cjs
//   node scripts/maps/build-iron-junction.cjs
//
// The layers are one painted image each, so a cog or a crane hook can't move as
// it stands. Each part is lifted out of the source art into a looping spritesheet,
// which keeps it exactly where and as it was painted, and the layer is rewritten
// without it where it would show through. Smoke is replaced outright, since a
// painted puff can't drift. Most loops hold still for a while: these are things
// happening in the distance, and they should only catch the eye now and then.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "public", "assets", "bank-bust");
const PARTS = path.join(ROOT, "scripts", "maps", "iron-junction-parts.json");
const sharp = require(path.join(ROOT, "spritesheet-generator", "node_modules", "sharp"));

const hold = (frame, n) => Array(n).fill(frame);
const span = (n) => Array.from({ length: n }, (_, i) => i);

class Image {
  constructor(width, height, data) {
    this.width = width; this.height = height;
    this.data = data || Buffer.alloc(width * height * 4);
  }
  get(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    return [...this.data.subarray((y * this.width + x) * 4, (y * this.width + x) * 4 + 4)];
  }
  set(x, y, px) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(px, (y * this.width + x) * 4);
  }
  /** Clear a rectangle back to see-through. */
  erase(left, top, right, bottom) {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) this.set(x, y, [0, 0, 0, 0]);
  }
}

async function load(file, width) {
  let image = sharp(path.join(ROOT, "output", "bank-bust-art", file)).ensureAlpha();
  if (width) {
    const meta = await sharp(path.join(ROOT, "output", "bank-bust-art", file)).metadata();
    image = image.resize(width, Math.round((meta.height * width) / meta.width), { kernel: "nearest" });
  }
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return new Image(info.width, info.height, Buffer.from(data));
}

async function saveSheet(name, frames, width, height) {
  const sheet = new Image(width * frames.length, height);
  frames.forEach((draw, f) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = draw(x, y);
      if (px && px[3]) sheet.set(f * width + x, y, px);
    }
  });
  await sharp(sheet.data, { raw: { width: sheet.width, height, channels: 4 } })
    .webp({ lossless: true, effort: 6 })
    .toFile(path.join(OUT, name));
}

/** A disc of the art turning about its centre. `keep` limits it to some pixels. */
async function wheel(art, name, cx, cy, radius, sweep, frames, sequence, frameRate, keep = () => true) {
  const size = radius * 2 + 2;
  const c = size / 2 - 0.5;
  await saveSheet(name, span(frames).map((f) => (x, y) => {
    const dx = x - c, dy = y - c;
    if (dx * dx + dy * dy > radius * radius) return null;
    const a = -((f / frames) * sweep * Math.PI) / 180;
    const px = art.get(cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a));
    return keep(px) ? px : null;
  }), size, size);
  return { url: `/assets/bank-bust/${name}`, x: cx, y: cy, frameWidth: size, frameHeight: size, frameRate, frames: sequence };
}

/** Rising puffs in the art's own muted greys. Loops without a seam. */
const SMOKE = { width: 60, height: 120, frames: 16, grid: 3 };
async function smoke() {
  const { width, height, frames, grid } = SMOKE;
  const pale = [150, 160, 186, 170], mid = [116, 128, 158, 150];
  await saveSheet("part-smoke.webp", span(frames).map((f) => {
    const puffs = [0, 1, 2, 3].map((k) => {
      const t = ((f / frames + k / 4) % 1);
      return { t, x: width / 2 + Math.sin(t * 5 + k * 1.7) * 8 * t, y: height - 6 - t * (height - 22), r: 5 + t * 15 };
    }).filter((p) => p.t > 0.02 && p.t < 0.92);
    return (x, y) => {
      const gx = Math.floor(x / grid) * grid + grid / 2, gy = Math.floor(y / grid) * grid + grid / 2;
      for (const p of puffs) {
        const d = Math.hypot(gx - p.x, gy - p.y);
        if (d > p.r) continue;
        const base = d < p.r * 0.6 && gy < p.y ? pale : mid;
        return [base[0], base[1], base[2], Math.round(base[3] * (1 - p.t * 0.85))];
      }
      return null;
    };
  }), width, height);
}
const smokePart = (x, stackTop) => ({
  url: "/assets/bank-bust/part-smoke.webp", x, y: stackTop - SMOKE.height / 2 + 4,
  frameWidth: SMOKE.width, frameHeight: SMOKE.height, frameRate: 6, frames: span(SMOKE.frames),
});

/** A lamp's lit pixels dimming, for an unsteady bulb. */
async function lamp(art, name, left, top, right, bottom, isLit, sequence, frameRate) {
  const levels = [1, 0.72, 0.45];
  const w = right - left, h = bottom - top;
  await saveSheet(name, levels.map((level) => (x, y) => {
    const px = art.get(left + x, top + y);
    if (!px[3] || !isLit(px)) return px;
    return [px[0] * level, px[1] * level, px[2] * level, px[3]].map(Math.round);
  }), w, h);
  return { url: `/assets/bank-bust/${name}`, x: (left + right) / 2, y: (top + bottom) / 2, frameWidth: w, frameHeight: h, frameRate, frames: sequence };
}

async function machinery() {
  const art = await load("v2/bg-machinery.png");
  const clean = new Image(art.width, art.height, Buffer.from(art.data));
  const parts = [];

  // The big cog, turning slowly and steadily: 12 teeth, so 30 degrees loops.
  parts.push(await wheel(art, "part-cog.webp", 612, 612, 76, 30, 6, span(6), 3));

  // The crane hook lowers, waits and comes back. The cable is stretched by
  // repeating one row of it, so the top stays fixed to the crane.
  const hook = { left: 788, right: 866, top: 286, bottom: 512, travel: 40, block: 372, cable: 330 };
  const hookFrames = 9;
  const hookW = hook.right - hook.left, hookH = hook.bottom - hook.top + hook.travel;
  await saveSheet("part-hook.webp", span(hookFrames).map((f) => {
    const drop = Math.round((0.5 - 0.5 * Math.cos((f / (hookFrames - 1)) * Math.PI)) * hook.travel);
    return (x, y) => {
      const row = y + hook.top;
      if (row < hook.block) return art.get(hook.left + x, row);
      if (row < hook.block + drop) return art.get(hook.left + x, hook.cable);
      return art.get(hook.left + x, row - drop);
    };
  }), hookW, hookH);
  clean.erase(hook.left, hook.top, hook.right, hook.bottom);
  parts.push({
    url: "/assets/bank-bust/part-hook.webp", x: (hook.left + hook.right) / 2, y: hook.top + hookH / 2,
    frameWidth: hookW, frameHeight: hookH, frameRate: 5,
    frames: [...hold(0, 40), ...span(hookFrames), ...hold(hookFrames - 1, 24), ...span(hookFrames).reverse()],
  });

  // Two unsteady lamps: mostly on, with the odd dip.
  const warm = (px) => px[0] > px[2] + 50;
  const cold = (px) => px[1] > 120 && px[2] > px[0] + 40;
  parts.push(await lamp(art, "part-lamp-warm.webp", 1820, 140, 1878, 225, warm, [...hold(0, 14), 1, 0, 2, 1, ...hold(0, 9), 1], 5));
  parts.push(await lamp(art, "part-lamp-cold.webp", 2090, 530, 2146, 600, cold, [...hold(0, 22), 2, 0, 1, ...hold(0, 6), 2, 1], 5));

  // Smoke off the two stacks.
  clean.erase(2050, 190, 2125, 256);
  clean.erase(2100, 365, 2165, 420);
  parts.push(smokePart(2072, 258), smokePart(2121, 422));
  return { clean, parts };
}

async function pipes() {
  const art = await load("v3/bg-pipes.png", 1536);
  const clean = new Image(art.width, art.height, Buffer.from(art.data));
  const parts = [];

  // The brass wheel is cut out by colour, because the pipe behind it stays put.
  // Both wheels give a quarter turn now and then.
  const brass = (px) => px[3] > 0 && px[0] > px[2] + 40;
  const turning = [...hold(0, 30), 1, 2, 3, 4, 5, ...hold(0, 16), 5, 4, 3, 2, 1];
  parts.push(await wheel(art, "part-wheel-brass.webp", 195, 210, 40, 90, 6, turning, 5, brass));
  for (let y = 170; y < 250; y++) for (let x = 155; x < 235; x++) {
    if (Math.hypot(x - 195, y - 210) <= 40 && brass(clean.get(x, y))) clean.set(x, y, [24, 32, 58, 255]);
  }
  parts.push(await wheel(art, "part-wheel-dark.webp", 840, 304, 32, 90, 6,
    [...hold(0, 44), 1, 2, 3, 4, 5, ...hold(0, 26), 5, 4, 3, 2, 1], 5));

  clean.erase(76, 56, 150, 133);
  clean.erase(1440, 116, 1526, 192);
  parts.push(smokePart(130, 135), smokePart(1460, 195));
  return { clean, parts };
}

(async () => {
  await smoke();
  const manifest = {};
  for (const [file, make] of [["machinery.webp", machinery], ["bg-pipes.webp", pipes]]) {
    const { clean, parts } = await make();
    await sharp(clean.data, { raw: { width: clean.width, height: clean.height, channels: 4 } })
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(path.join(OUT, file));
    manifest[file] = parts;
    console.log(`${file}: ${parts.length} moving parts`);
  }
  fs.writeFileSync(PARTS, JSON.stringify(manifest, null, 2) + "\n");
})();
