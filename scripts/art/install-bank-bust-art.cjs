#!/usr/bin/env node
// Installs the generated Bank Bust artwork from output/bank-bust-art/v1 into
// public/assets/bank-bust.
//
// Two things here are not just a file copy:
//
//  * Team colour. The vault is generated with its trim frame, dome lamp and
//    side banner painted flat magenta (255,0,255). That is a key, not a
//    colour: this script lifts those pixels into a separate white accent
//    sprite the game tints blue or red per team, and paints them neutral
//    steel in the body sprite underneath, so the vault still reads correctly
//    if the accent layer is missing.
//
//  * Alignment. The three vault states have to be swappable frame for frame,
//    so they are cropped to one shared bounding box rather than trimmed
//    individually.
//
//   node scripts/art/install-bank-bust-art.cjs [--dry]

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
// Newest generation wins; anything not regenerated this round is picked up
// from the previous one, so a single asset can be redone on its own.
const SRC_DIRS = ["v4", "v3"].map((v) => path.join(ROOT, "output", "bank-bust-art", v));
const resolve = (file) => SRC_DIRS.map((d) => path.join(d, file)).find((f) => fs.existsSync(f)) || null;
const DEST = path.join(ROOT, "public", "assets", "bank-bust");
const DRY = process.argv.includes("--dry");

let sharp;
try {
  sharp = require(path.join(ROOT, "spritesheet-generator", "node_modules", "sharp"));
} catch (_) {
  console.error("sharp is required; it ships with spritesheet-generator.");
  process.exit(1);
}

// Magenta key, and what the body sprite uses in its place.
const KEY = { r: 255, g: 0, b: 255 };
const KEY_TOLERANCE = 70;
const STEEL = { r: 86, g: 101, b: 133 };

const isKey = (r, g, b) =>
  Math.abs(r - KEY.r) < KEY_TOLERANCE &&
  g < KEY_TOLERANCE &&
  Math.abs(b - KEY.b) < KEY_TOLERANCE;

async function load(file, canvas) {
  let image = sharp(resolve(file)).ensureAlpha();
  // The generator does not always hand back the three damage states at the
  // same resolution. They have to share a canvas before they can share a crop,
  // and nearest-neighbour keeps the pixel edges hard while they are matched up.
  if (canvas) {
    const meta = await image.metadata();
    if (meta.width !== canvas.width || meta.height !== canvas.height) {
      image = sharp(await image.resize(canvas.width, canvas.height, { kernel: "nearest", fit: "fill" }).png().toBuffer());
    }
  }
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Tight box around every pixel that is not fully transparent. */
function alphaBounds({ data, width, height, channels }) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const union = (boxes) => {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
};

/** Splits a keyed image into its steel body and its white accent mask. */
function splitKey(src) {
  const { data, width, height, channels } = src;
  const body = Buffer.from(data);
  const accent = Buffer.alloc(width * height * 4, 0);
  let keyed = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    if (data[o + 3] <= 8) continue;
    if (!isKey(data[o], data[o + 1], data[o + 2])) continue;
    keyed++;
    body[o] = STEEL.r;
    body[o + 1] = STEEL.g;
    body[o + 2] = STEEL.b;
    accent[i * 4] = 255;
    accent[i * 4 + 1] = 255;
    accent[i * 4 + 2] = 255;
    accent[i * 4 + 3] = data[o + 3];
  }
  return { body, accent, keyed, width, height, channels };
}

async function write(buffer, width, height, channels, box, outName) {
  const out = path.join(DEST, outName);
  if (DRY) {
    console.log(`would write ${outName} (${box.width}x${box.height})`);
    return;
  }
  await sharp(buffer, { raw: { width, height, channels } })
    .extract(box)
    .webp({ quality: 94, alphaQuality: 100, effort: 6 })
    .toFile(out);
  console.log(`wrote ${path.relative(ROOT, out)} (${box.width}x${box.height})`);
}

async function installVaults() {
  const states = ["intact", "damaged", "breached"];
  const files = states.map((s) => `vault-${s}.png`);
  for (const f of files) {
    if (!resolve(f)) {
      console.warn(`skipping vault states: ${f} is missing`);
      return;
    }
  }
  // Match every state to the largest canvas the generator produced.
  const metas = await Promise.all(files.map((f) => sharp(resolve(f)).metadata()));
  const canvas = {
    width: Math.max(...metas.map((m) => m.width)),
    height: Math.max(...metas.map((m) => m.height)),
  };
  const images = [];
  for (const f of files) images.push(await load(f, canvas));
  // One shared crop keeps the three states swappable frame for frame.
  const box = union(images.map(alphaBounds));
  for (let i = 0; i < states.length; i++) {
    const src = images[i];
    const { body, accent, keyed } = splitKey(src);
    await write(body, src.width, src.height, src.channels, box, `vault-${states[i]}.webp`);
    // The current vault carries its team colour as a glow and a hit outline
    // drawn by the runtime, not as a painted accent. Writing an empty mask
    // would just put a transparent sprite over the door every frame, so when
    // there is no key the stale mask is removed instead.
    const accentName = `vault-${states[i]}-accent.webp`;
    if (keyed) await write(accent, src.width, src.height, 4, box, accentName);
    else if (!DRY && fs.existsSync(path.join(DEST, accentName))) {
      fs.unlinkSync(path.join(DEST, accentName));
      console.log(`removed ${accentName} (artwork has no team-colour key)`);
    }
  }
}

// The generator works several times denser than the level's tileset, and the
// runtime draws these props at a fixed world size. Left at source resolution a
// prop is squeezed to a third of its pixel size at draw time and turns smooth
// and detailed next to 64px girders, so each one is resampled here to the size
// it is actually drawn at and then drawn 1:1.
const DRAW_WIDTH = {
  "vault-intact.webp": 264, "vault-intact-accent.webp": 264,
  "vault-damaged.webp": 264, "vault-damaged-accent.webp": 264,
  "vault-breached.webp": 264, "vault-breached-accent.webp": 264,
  "center-bullion.webp": 180,
};

async function resampleToDrawSize() {
  for (const [name, width] of Object.entries(DRAW_WIDTH)) {
    const file = path.join(DEST, name);
    if (!fs.existsSync(file)) continue;
    const meta = await sharp(file).metadata();
    if (meta.width === width) continue;
    const height = Math.max(1, Math.round((meta.height * width) / meta.width));
    const buffer = await sharp(file).resize(width, height, { kernel: "nearest" })
      .webp({ quality: 94, alphaQuality: 100, effort: 6 }).toBuffer();
    fs.writeFileSync(file, buffer);
    console.log(`resampled ${name.padEnd(28)} ${meta.width}x${meta.height} -> ${width}x${height}`);
  }
}

async function installTrimmed(file, outName) {
  const full = resolve(file);
  if (!full) {
    console.warn(`skipping ${outName}: ${file} has not been generated yet`);
    return null;
  }
  const src = await load(file);
  const box = alphaBounds(src);
  await write(src.data, src.width, src.height, src.channels, box, outName);
  return box;
}

(async () => {
  // The vault is drawn by scripts/art/bake-iron-junction.cjs now; installVaults
  // only applies if generated art is brought back.
  if (process.argv.includes("--generated-vaults")) await installVaults();
  const sizes = {};
  for (const [file, out] of [
  ]) {
    const box = await installTrimmed(file, out);
    if (box) sizes[out] = { width: box.width, height: box.height };
  }
  await resampleToDrawSize();
  if (Object.keys(sizes).length) {
    console.log("\nInstalled frame sizes (feed these to scripts/maps/build-iron-junction.cjs):");
    for (const [name, s] of Object.entries(sizes)) {
      console.log(`  ${name.padEnd(20)} ${s.width} x ${s.height}`);
    }
  }
})();
