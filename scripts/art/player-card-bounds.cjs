const sharp = require('../../spritesheet-generator/node_modules/sharp');

// Measure visible art rather than its padded export canvas. Use the same bounds
// for the poster and video so playback never changes the battle frame's size.
async function measurePlayerCardBounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x = info.width, y = info.height, right = -1, bottom = -1;
  for (let row = 0; row < info.height; row++) {
    for (let col = 0; col < info.width; col++) {
      if (data[(row * info.width + col) * info.channels + info.channels - 1] <= 127) continue;
      x = Math.min(x, col);
      y = Math.min(y, row);
      right = Math.max(right, col);
      bottom = Math.max(bottom, row);
    }
  }
  if (right < x || bottom < y) throw new Error(`Empty player card: ${file}`);
  return { width: info.width, height: info.height, x, y, w: right - x + 1, h: bottom - y + 1 };
}

module.exports = { measurePlayerCardBounds };
