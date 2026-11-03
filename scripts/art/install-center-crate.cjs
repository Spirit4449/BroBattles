#!/usr/bin/env node
//   node scripts/art/install-center-crate.cjs
//
// Installs the Bank Bust centre crate and bakes the coin sprites every coin
// effect draws from.
//
// The crate's three damage stages arrive on flat magenta at about ten times the
// level's pixel density. They share one crop so they swap in place, and the
// flying wreckage is cut straight out of the intact stage so it is recognisably
// the same crate.
//
// The coin spin is baked from the standard coin icon rather than redrawn.

const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "output", "bank-bust-art", "crate-steel");
const DEST = path.join(ROOT, "public", "assets", "bank-bust");
const ICONS = path.join(ROOT, "public", "assets", "icons");
const sharp = require(path.join(ROOT, "spritesheet-generator", "node_modules", "sharp"));

const CRATE_WIDTH = 124;
const DEBRIS_FRAME = 36;
// Pieces of the 1254px intact stage: [left, top, width, height].
const DEBRIS = [
  [240, 190, 420, 170], // lid plate
  [125, 640, 310, 80], // brass strap
  [90, 960, 155, 145], // corner bracket
  [430, 560, 400, 390], // combination dial
];

const WEBP = { quality: 94, alphaQuality: 100, effort: 6 };

async function keyed(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 170 && data[i + 1] < 120 && data[i + 2] > 170) data[i + 3] = 0;
  }
  return { data, width: info.width, height: info.height };
}

function alphaBox({ data, width, height }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function union(a, b) {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

const fromRaw = ({ data, width, height }) => sharp(data, { raw: { width, height, channels: 4 } });

async function installCrate() {
  const stages = {};
  for (const name of ["intact", "damaged", "broken"]) {
    stages[name] = await keyed(path.join(SRC, `${name}.png`));
  }
  const box = Object.values(stages).map(alphaBox).reduce(union);
  for (const [name, image] of Object.entries(stages)) {
    const info = await fromRaw(image).extract(box)
      .resize(CRATE_WIDTH, Math.round((box.height * CRATE_WIDTH) / box.width), { kernel: "nearest", fit: "fill" })
      .webp(WEBP).toFile(path.join(DEST, `center-crate-${name}.webp`));
    console.log(`write center-crate-${name}.webp ${box.width}x${box.height} -> ${info.width}x${info.height}`);
  }

  const frames = [];
  for (const [left, top, width, height] of DEBRIS) {
    const scale = 120 / 1254;
    frames.push(await fromRaw(stages.intact).extract({ left, top, width, height })
      .resize(Math.max(4, Math.round(width * scale)), Math.max(4, Math.round(height * scale)), { kernel: "nearest" })
      .resize(DEBRIS_FRAME, DEBRIS_FRAME, { fit: "contain", kernel: "nearest", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer());
  }
  await sharp({ create: { width: DEBRIS_FRAME * frames.length, height: DEBRIS_FRAME, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: i * DEBRIS_FRAME, top: 0 })))
    .webp(WEBP).toFile(path.join(DEST, "center-crate-debris.webp"));
  console.log("write center-crate-debris.webp");
}

// The spin is baked from the standard coin icon, so the coin in a match is the
// same coin as in the shop and the HUD. Each frame narrows it to the width it
// shows at that point in the turn, mirrored for the back half.
async function coinSpinFrames(size, count) {
  const face = await sharp(path.join(ICONS, "coin.webp"))
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .ensureAlpha().png().toBuffer();
  const frames = [];
  for (let i = 0; i < count; i++) {
    const cos = Math.cos((i / count) * Math.PI * 2);
    const width = Math.max(2, Math.round(size * Math.abs(cos)));
    let narrowed = sharp(face).resize(width, size, { fit: "fill", kernel: "lanczos3" });
    if (cos < 0) narrowed = narrowed.flop();
    const { data } = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await narrowed.png().toBuffer(), left: Math.floor((size - width) / 2), top: 0 }])
      .raw().toBuffer({ resolveWithObject: true });
    frames.push(data);
  }
  return frames;
}

function sparkleFrame(size, reach) {
  const pixels = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      const onArm = (dx === 0 && dy <= reach) || (dy === 0 && dx <= reach) || (dx + dy <= reach / 3);
      if (!onArm) continue;
      const hot = dx + dy <= reach / 2;
      Buffer.from(hot ? [255, 255, 255, 255] : [255, 226, 120, 255]).copy(pixels, (y * size + x) * 4);
    }
  }
  return pixels;
}

async function sheet(frames, size, file) {
  const out = Buffer.alloc(frames.length * size * size * 4);
  frames.forEach((frame, i) => {
    for (let y = 0; y < size; y++) {
      frame.copy(out, (y * size * frames.length + i * size) * 4, y * size * 4, (y + 1) * size * 4);
    }
  });
  await sharp(out, { raw: { width: size * frames.length, height: size, channels: 4 } })
    .webp({ lossless: true, effort: 6 }).toFile(file);
  console.log(`write ${path.basename(file)} ${frames.length} frames at ${size}px`);
}

(async () => {
  // `--coins` rebakes only the coin sprites, for when the crate sources are not on disk.
  if (!process.argv.includes("--coins")) await installCrate();
  await sheet(await coinSpinFrames(112, 16), 112, path.join(ICONS, "coin-spin.webp"));
  await sheet([1, 2, 4, 2].map((reach) => sparkleFrame(11, reach)), 11, path.join(ICONS, "coin-sparkle.webp"));
})();
