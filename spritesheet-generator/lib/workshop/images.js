const sharp = require('sharp');
const {
  fs,
  path,
  local,
  randomUUID,
  fail
} = require('./store');
const LIMIT = 64 * 1024 * 1024;
function image(input) {
  return sharp(input, {
    limitInputPixels: LIMIT
  });
}
async function saveFrame(root, input) {
  const file = `frames/${randomUUID()}.png`;
  const {
    data,
    info
  } = await image(input).ensureAlpha().png().toBuffer({
    resolveWithObject: true
  });
  await fs.writeFile(local(root, file), data);
  return {
    file,
    width: info.width,
    height: info.height
  };
}
async function rendered(root, frame, cell = null) {
  let pipeline = image(local(root, frame.file));
  const t = frame.transform;
  const width = Math.max(1, Math.round(frame.width * t.scale)),
    height = Math.max(1, Math.round(frame.height * t.scale));
  if (width * height > LIMIT) fail('Transformed frame is too large.');
  const buffer = await pipeline.resize(width, height, {
    kernel: 'nearest'
  }).ensureAlpha().png().toBuffer();
  if (!cell) return buffer;
  const left = Math.round(cell / 2 - t.anchorX * t.scale + t.x);
  const top = Math.round(cell - t.anchorY * t.scale + t.y);
  const x = Math.max(0, left),
    y = Math.max(0, top);
  const w = Math.min(cell, left + width) - x,
    h = Math.min(cell, top + height) - y;
  let base = sharp({
    create: {
      width: cell,
      height: cell,
      channels: 4,
      background: '#00000000'
    }
  });
  if (w > 0 && h > 0) {
    const piece = await image(buffer).extract({
      left: x - left,
      top: y - top,
      width: w,
      height: h
    }).png().toBuffer();
    base = base.composite([{
      input: piece,
      left: x,
      top: y
    }]);
  }
  return base.png().toBuffer();
}
module.exports = {
  sharp,
  image,
  saveFrame,
  rendered,
  LIMIT
};
