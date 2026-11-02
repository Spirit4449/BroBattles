#!/usr/bin/env node
// Installs the generated Iron Junction artwork into public/assets/bank-bust/.
//
//   node scripts/art/install-iron-junction-art.cjs
//
// The generator hands back images at whatever resolution it works in, which is
// several times denser than the shipped tileset. Dropping them in at that size
// would put tiny smooth detail next to 64px girder tiles and the level would
// read as two different games. Each piece is resampled with nearest-neighbour
// to a size whose pixel clusters match the tileset, so one in-world pixel is
// one pixel everywhere.
//
const fs = require("fs");
const path = require("path");
const sharp = require(path.join(__dirname, "..", "..", "spritesheet-generator", "node_modules", "sharp"));

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "output", "bank-bust-art", "v2");
const SRC_V3 = path.join(ROOT, "output", "bank-bust-art", "v3");
const OUT = path.join(ROOT, "public", "assets", "bank-bust");

// target: the width to resample to. Heights follow the source aspect so a
// tiling piece stays tiling.
//
// Only the backdrops come through here now. The platform tiles that used to
// be installed alongside them are gone: platforms are composed as one image
// each by scripts/art/bake-iron-junction.cjs, straight from the nine-slice
// source, so there is nothing left to tile at runtime.
const PIECES = [
  { src: "bg-far.png", out: "bg-far.webp" },
  // The machinery and pipes come from install-iron-junction-backdrop.cjs, which
  // also cuts their moving parts out.
];

(async () => {
  for (const piece of PIECES) {
    const from = path.join(piece.from === "v3" ? SRC_V3 : SRC, piece.src);
    if (!fs.existsSync(from)) { console.log(`skip  ${piece.src} (not generated yet)`); continue; }
    const meta = await sharp(from).metadata();
    let image = sharp(from);
    if (piece.width) {
      const height = Math.max(1, Math.round((meta.height * piece.width) / meta.width));
      image = image.resize(piece.width, height, { kernel: "nearest" });
    }
    let resampled = await image.png().toBuffer();
    if (piece.crop) resampled = await sharp(resampled)
      .extract({ left: 0, top: piece.crop[0], width: piece.cropWidth || piece.width, height: piece.crop[1] })
      .png().toBuffer();
    const info = await sharp(resampled).webp({ quality: 92, alphaQuality: 100 }).toFile(path.join(OUT, piece.out));
    console.log(`write ${piece.out.padEnd(16)} ${meta.width}x${meta.height} -> ${info.width}x${info.height}  ${Math.round(info.size / 1024)}KB`);
  }
  console.log("\nRe-run scripts/maps/build-iron-junction.cjs to pick the new frame sizes up.");
})();
