const {
  image
} = require('./images');
// Sharp encodes each lossless frame. This small RIFF mux avoids a dependency on
// optional FFmpeg WebP encoders. Full-canvas frames replace, rather than blend.
// Container: https://developers.google.com/speed/webp/docs/riff_container
function chunk(tag, payload) {
  const header = Buffer.alloc(8);
  header.write(tag);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, ...(payload.length % 2 ? [Buffer.alloc(1)] : [])]);
}
async function animatedWebp(buffers, size, fps, loop) {
  const extended = Buffer.alloc(10);
  extended[0] = 0x12; // alpha + animation
  extended.writeUIntLE(size - 1, 4, 3);
  extended.writeUIntLE(size - 1, 7, 3);
  const anim = Buffer.alloc(6);
  anim.writeUInt16LE(loop ? 0 : 1, 4);
  const chunks = [chunk('VP8X', extended), chunk('ANIM', anim)];
  for (const buffer of buffers) {
    const webp = await image(buffer).webp({
      lossless: true
    }).toBuffer();
    const frameData = [];
    for (let offset = 12; offset + 8 <= webp.length;) {
      const length = webp.readUInt32LE(offset + 4),
        end = offset + 8 + length + length % 2;
      if (['VP8L', 'VP8 ', 'ALPH'].includes(webp.toString('ascii', offset, offset + 4))) frameData.push(webp.subarray(offset, end));
      offset = end;
    }
    const frame = Buffer.alloc(16);
    frame.writeUIntLE(size - 1, 6, 3);
    frame.writeUIntLE(size - 1, 9, 3);
    frame.writeUIntLE(Math.max(1, Math.round(1000 / fps)), 12, 3);
    frame[15] = 2;
    chunks.push(chunk('ANMF', Buffer.concat([frame, ...frameData])));
  }
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  return chunk('RIFF', body);
}
module.exports = {
  animatedWebp
};
