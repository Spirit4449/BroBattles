// Usage: node scripts/art/import-trophy-video.cjs <animatedtrophy.mp4>
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Pass the trophy video path');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-trophy-'));
  const out = path.resolve(__dirname, '../../public/assets/icons');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-map', '0:v:0', path.join(temp, '%04d.png')]);
    const files = fs.readdirSync(temp).filter(file => file.endsWith('.png')).sort();
    const frames = [];
    let left = Infinity, top = Infinity, right = 0, bottom = 0;
    for (const file of files) {
      const { data, info } = await sharp(path.join(temp, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        // This gold/orange trophy contains no intentional green. Key enclosed
        // screen pixels in the handles too, not just the exterior background.
        if (data[i + 1] > Math.max(data[i], data[i + 2]) + 25) {
          data.fill(0, i, i + 4);
          continue;
        }
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      frames.push({ data, info });
    }
    const width = right - left + 1, height = bottom - top + 1;
    for (let i = 0; i < frames.length; i++) {
      const { data, info } = frames[i];
      await sharp(data, { raw: info }).extract({ left, top, width, height })
        .resize(148, 148, { fit: 'contain', background: '#00000000', kernel: 'nearest' })
        .extend({ top: 6, bottom: 6, left: 6, right: 6, background: '#00000000' })
        .png().toFile(path.join(temp, files[i]));
    }
    // Original 23.976fps timing, rounded to WebP's millisecond frame delays.
    execFileSync('img2webp', ['-loop', '0', '-min_size', '-lossy', '-q', '85', '-m', '6', '-d', '42', ...files.map(file => path.join(temp, file)), '-o', path.join(out, 'win-streak.webp')], { stdio: 'pipe' });
    await sharp(path.join(temp, files[0])).webp({ lossless: true }).toFile(path.join(out, 'win-streak-poster.webp'));
    const metadata = await sharp(path.join(out, 'win-streak.webp'), { animated: true }).metadata();
    console.log(JSON.stringify({ frames: metadata.pages, durationMs: metadata.delay.reduce((a, b) => a + b, 0), bytes: fs.statSync(path.join(out, 'win-streak.webp')).size, crop: { left, top, width, height } }));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
