#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE } = require('./rig.cjs');
const { clips, throwSettings } = require('./motion.cjs');

const root = path.resolve(__dirname, '../../..');
const preview = path.join(root, 'output/sovereign-pixel');
const installed = path.join(root, 'public/assets/ninja/skins/ninja-arena-sovereign');
const padding = 8;
const stride = SIZE + padding * 2;
const columns = 12;
const raw = (pixels, width, height) => sharp(pixels, { raw: { width, height, channels: 4 } });

async function writeAtlas() {
  const frames = [];
  const overrides = {};
  const width = columns * stride;
  const count = clips.reduce((sum, clip) => sum + clip.frames.length, 0);
  const height = Math.ceil(count / columns) * stride;
  const sheet = Buffer.alloc(width * height * 4);
  for (const clip of clips) {
    const names = [];
    clip.frames.forEach((pixels, index) => {
      const name = clip.prefix + String(index).padStart(2, '0');
      const x = frames.length % columns * stride + padding;
      const y = Math.floor(frames.length / columns) * stride + padding;
      const dimensions = { w: SIZE, h: SIZE };
      const frame = { x, y, ...dimensions };
      const spriteSourceSize = { x: 0, y: 0, ...dimensions };
      frames.push({ filename: name, frame, trimmed: false, rotated: false, spriteSourceSize, sourceSize: dimensions });
      names.push(name);
      for (let row = 0; row < SIZE; row++) {
        const from = row * SIZE * 4;
        pixels.copy(sheet, ((y + row) * width + x) * 4, from, from + SIZE * 4);
      }
    });
    overrides[clip.key] = { frames: names, frameRate: clip.frameRate, repeat: clip.repeat };
  }
  await raw(sheet, width, height).webp({ lossless: true }).toFile(path.join(preview, 'spritesheet.webp'));
  await fs.writeFile(path.join(preview, 'animations.json'), JSON.stringify({ frames,
    meta: { image: 'spritesheet.webp', format: 'RGBA8888', size: { w: width, h: height }, scale: '1' } }));
  await fs.writeFile(path.join(preview, 'animation-settings.json'),
    JSON.stringify({ animations: overrides, throw: throwSettings }, null, 2) + '\n');
}

async function writeStrip(key) {
  const { frames, frameRate } = clips.find(clip => clip.key === key);
  const scale = 3;
  const width = SIZE * scale;
  const rows = frames.length > 11 ? 2 : 1;
  const cols = Math.ceil(frames.length / rows);
  const tiles = await Promise.all(frames.map(async (frame, i) => ({
    input: await raw(frame, SIZE, SIZE).resize(width, width, { kernel: 'nearest' }).png().toBuffer(),
    left: i % cols * width, top: Math.floor(i / cols) * width,
  })));
  await sharp({ create: { width: cols * width, height: rows * width, channels: 4, background: '#515469' } })
    .composite(tiles).png().toFile(path.join(preview, key + '-frames.png'));
  const bg = Buffer.from([81, 84, 105, 255]);
  const flattened = frames.map(frame => {
    const pixels = Buffer.from(frame);
    for (let i = 0; i < pixels.length; i += 4) if (!pixels[i + 3]) bg.copy(pixels, i);
    return pixels;
  });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', SIZE + 'x' + SIZE,
    '-framerate', String(frameRate / 2), '-i', '-',
    '-filter_complex', `scale=${width}:${width}:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none`,
    '-loop', '0', path.join(preview, key + '.gif')], { input: Buffer.concat(flattened) });
}

async function main() {
  await fs.mkdir(preview, { recursive: true });
  await writeAtlas();
  await Promise.all(['idle', 'running', 'jumping', 'throw-up'].map(writeStrip));
  if (process.argv.includes('--install')) {
    for (const file of ['spritesheet.webp', 'animations.json', 'animation-settings.json']) {
      await fs.copyFile(path.join(preview, file), path.join(installed, file));
    }
  }
  console.log(`Arena Sovereign rendered ${clips.reduce((n, clip) => n + clip.frames.length, 0)} frames across ${clips.length} clips`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
