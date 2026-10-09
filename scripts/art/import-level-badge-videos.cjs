// Usage: node scripts/art/import-level-badge-videos.cjs <source-directory> [level ...]
// Requires ffmpeg, img2webp, and Sprite Workshop's sharp dependency.
// Filenames are explicitly mapped after inspecting the number in each clip.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const sharp = require('../../spritesheet-generator/node_modules/sharp');
const sources = {
  1: 'Animate_pixel_art_bronze_shield_20261009000201.mp4',
  2: 'Animate_pixel-art_bronze_shield_20261009005637.mp4',
  3: 'Animate_green_pixel_art_shield_20261009003355.mp4',
  4: 'Animate_blue_pixel-art_shield_1080p_20261009003333.mp4',
  5: 'Animate_pixel_art_shield_1080p_20261009004408.mp4',
  6: 'Pixel_art_badge_loop_1080p_20261009004813.mp4',
  7: 'Burgundy_shield_glowing_pixel_an…_20261009004009.mp4',
  8: 'Animating_pixel-art_laurel_shield_20261009000146.mp4',
  9: 'Animate_pixel_art_shield_flames_20261009003454.mp4',
  10: 'Animating_pixel_art_shield_badge_20261009004850.mp4',
};
// Half-open source-frame ranges, chosen at matching flame/wingbeat phases.
// Level 10 retains two continuous wingbeats and plays at one-third speed.
const loopEdits = {
  4: { fps: 40, startFrame: 8, endFrame: 112, delayMs: 33, bridgeFrames: 48 },
  9: { fps: 40, startFrame: 13, endFrame: 136, delayMs: 33, seamFrames: 8 },
  10: { fps: 72, startFrame: 30, endFrame: 102, delayMs: 42, seamFrames: 9 },
};

// Remove only screen-colored pixels connected to the frame exterior. This
// protects the green face of level 3 and the emerald details in level 8.
async function keyFrame(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, count = width * height;
  const seen = new Uint8Array(count), queue = new Int32Array(count);
  const screen = [...data.subarray(0, 3)];
  let head = 0, tail = 0;
  function visit(p) {
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (Math.hypot(data[i] - screen[0], data[i + 1] - screen[1], data[i + 2] - screen[2]) > 110) return;
    queue[tail++] = p;
    data.fill(0, i, i + 4);
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % width;
    if (x) visit(p - 1);
    if (x + 1 < width) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p + width < count) visit(p + width);
  }
  // Despill only the immediate edge, never the enclosed green artwork.
  const exterior = Uint8Array.from({ length: count }, (_, p) => data[p * 4 + 3] === 0);
  let left = width, top = height, right = 0, bottom = 0;
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (!data[i + 3]) continue;
    const x = p % width, y = Math.floor(p / width);
    let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && exterior[p + dy * width + dx]) { edge = true; break; }
    }
    if (edge && data[i + 1] > Math.max(data[i], data[i + 2]) + 20) {
      data[i + 1] = Math.max(data[i], data[i + 2]);
    }
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { data, info, left, top, right, bottom };
}

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw Error('Pass the directory containing the supplied badge videos.');
  const requested = process.argv.slice(3);
  for (const level of requested) if (!sources[level]) throw Error(`No video source for level ${level}`);
  const selected = Object.entries(sources).filter(([level]) => !requested.length || requested.includes(level));
  for (const [, file] of selected) fs.accessSync(path.join(sourceDir, file));
  const out = path.resolve(__dirname, '../../public/assets/levels');
  const manifestPath = path.join(out, 'animations.json');
  const manifest = requested.length ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  for (const [level, source] of selected) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-level-'));
    try {
      const { fps = 40, startFrame = 0, endFrame, delayMs = 33, seamFrames = 0, bridgeFrames = 0 } = loopEdits[level] || {};
      const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(sourceDir, source)], { encoding: 'utf8' }).trim());
      // Interpolate motion before keying so alpha edges move with their artwork.
      // Padding supplies the lookahead needed to retain the final source frames.
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(sourceDir, source), '-vf', `scale=640:-1,tpad=stop_mode=clone:stop_duration=0.15,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,trim=duration=${duration}`, path.join(temp, '%04d.png')]);
      const files = fs.readdirSync(temp).filter(f => f.endsWith('.png')).sort();
      const frames = [];
      for (const file of files) frames.push(await keyFrame(path.join(temp, file)));
      const left = Math.min(...frames.map(f => f.left)), top = Math.min(...frames.map(f => f.top));
      const right = Math.max(...frames.map(f => f.right)), bottom = Math.max(...frames.map(f => f.bottom));
      // One crop across the entire clip prevents breathing/jitter and retains effects.
      const side = Math.max(right - left + 1, bottom - top + 1) + 12;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const padded = await sharp(f.data, { raw: f.info })
          .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
          .resize(side - 12, side - 12, { fit: 'contain', background: '#00000000', kernel: 'nearest' })
          .extend({ top: 6, bottom: 6, left: 6, right: 6, background: '#00000000' })
          .png().toBuffer();
        await sharp(padded).resize(160, 160, { kernel: 'nearest' }).png().toFile(path.join(temp, files[i]));
      }
      const loopFiles = files.slice(startFrame, endFrame);
      // Ease the final matched wing/flame phase into the frames immediately
      // preceding the new start. The last-to-first transition is then a real
      // adjacent source-frame transition, without holding or reversing motion.
      for (let i = 0; i < seamFrames; i++) {
        const file = path.join(temp, loopFiles[loopFiles.length - seamFrames + i]);
        const { data: tail, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const lead = await sharp(path.join(temp, files[startFrame - seamFrames + i])).ensureAlpha().raw().toBuffer();
        const weight = (i + 1) / seamFrames;
        for (let p = 0; p < tail.length; p += 4) {
          const a = tail[p + 3] * (1 - weight), b = lead[p + 3] * weight;
          for (let c = 0; c < 3; c++) tail[p + c] = a + b ? Math.round((tail[p + c] * a + lead[p + c] * b) / (a + b)) : 0;
          tail[p + 3] = Math.round(a + b);
        }
        await sharp(tail, { raw: info }).png().toFile(file);
      }
      // Give level 4 extra time to settle back to its opening pose, without
      // restoring the removed flare. Premultiplied-alpha easing keeps edges clean.
      if (bridgeFrames) {
        const { data: last, info } = await sharp(path.join(temp, loopFiles.at(-1))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const first = await sharp(path.join(temp, loopFiles[0])).ensureAlpha().raw().toBuffer();
        for (let frame = 1; frame <= bridgeFrames; frame++) {
          const t = frame / (bridgeFrames + 1), weight = t * t * (3 - 2 * t);
          const data = Buffer.alloc(last.length);
          for (let p = 0; p < data.length; p += 4) {
            const a = last[p + 3] * (1 - weight), b = first[p + 3] * weight;
            for (let c = 0; c < 3; c++) data[p + c] = a + b ? Math.round((last[p + c] * a + first[p + c] * b) / (a + b)) : 0;
            data[p + 3] = Math.round(a + b);
          }
          const file = `bridge-${frame}.png`;
          await sharp(data, { raw: info }).png().toFile(path.join(temp, file));
          loopFiles.push(file);
        }
      }
      const animation = path.join(out, `${level}-animated.webp`);
      execFileSync('img2webp', ['-loop', '0', '-min_size', '-lossy', '-q', '82', '-m', '6', '-d', String(delayMs), ...loopFiles.map(f => path.join(temp, f)), '-o', animation], { stdio: 'pipe' });
      await sharp(path.join(temp, loopFiles[0])).webp({ lossless: true }).toFile(path.join(out, `${level}-poster.webp`));
      const version = createHash('sha256').update(fs.readFileSync(animation)).digest('hex').slice(0, 16);
      // The WebP encoder can merge identical adjacent frames; record its actual
      // frame count and durations, including any combined frame delays.
      const encoded = await sharp(animation, { animated: true }).metadata();
      manifest[level] = { source, version, frames: encoded.pages, durationMs: encoded.delay.reduce((sum, ms) => sum + ms, 0), bytes: fs.statSync(animation).size };
      console.log(`Level ${level}: ${encoded.pages} frames, ${manifest[level].durationMs}ms, ${manifest[level].bytes} bytes`);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  fs.writeFileSync(path.join(out, 'animations.json'), JSON.stringify(manifest, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
