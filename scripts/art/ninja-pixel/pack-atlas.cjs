// The art previews use a regular grid. Only upload the visible rectangles to
// the GPU, preserving each pose's logical frame and registration in Phaser.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

async function packNinjaAtlas(source, destination) {
  const atlas = JSON.parse(await fs.readFile(path.join(source, 'animations.json'), 'utf8'));
  const { data, info } = await sharp(path.join(source, atlas.meta.image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tiles = atlas.frames.map(entry => {
    const { x, y, w, h } = entry.frame;
    let left = w, top = h, right = -1, bottom = -1;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (!data[((y + row) * info.width + x + col) * 4 + 3]) continue;
        left = Math.min(left, col); right = Math.max(right, col);
        top = Math.min(top, row); bottom = Math.max(bottom, row);
      }
    }
    if (right < left) throw new Error('Empty Ninja frame ' + entry.filename);
    const width = right - left + 1, height = bottom - top + 1;
    entry.trimmed = true;
    entry.spriteSourceSize = { x: entry.spriteSourceSize.x + left, y: entry.spriteSourceSize.y + top, w: width, h: height };
    return { entry, left: x + left, top: y + top, width, height };
  });

  const width = 3072, gap = 2;
  let x = gap, y = gap, shelfHeight = 0;
  for (const tile of tiles.sort((a, b) => b.height - a.height)) {
    if (x + tile.width + gap > width) {
      x = gap;
      y += shelfHeight + gap;
      shelfHeight = 0;
    }
    tile.entry.frame = { x, y, w: tile.width, h: tile.height };
    x += tile.width + gap;
    shelfHeight = Math.max(shelfHeight, tile.height);
  }
  const height = y + shelfHeight + gap;
  if (height > 4096) throw new Error('Packed Ninja atlas exceeds a 4096px texture');
  const packed = Buffer.alloc(width * height * 4);
  for (const tile of tiles) {
    const frame = tile.entry.frame;
    for (let row = 0; row < frame.h; row++) {
      const from = ((tile.top + row) * info.width + tile.left) * 4;
      data.copy(packed, ((frame.y + row) * width + frame.x) * 4, from, from + frame.w * 4);
    }
  }
  atlas.meta.size = { w: width, h: height };
  await sharp(packed, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(path.join(destination, atlas.meta.image));
  await fs.writeFile(path.join(destination, 'animations.json'), JSON.stringify(atlas));
}

module.exports = { packNinjaAtlas };
