#!/usr/bin/env node
// Installs the site waffle-menu icons from Codex magenta-background renders.
// Usage: node scripts/art/install-menu-icons.cjs [sourceDir] [--preview]
// Reads <sourceDir>/<name>.png (default output/menu-icons), keys out #FF00FF,
// trims, fits into a 96px square with 4px padding and writes lossless WebP to
// public/assets/icons/menu/. --preview writes a contact sheet instead.
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const sourceDir = path.resolve(root, args.find(arg => !arg.startsWith('--')) || 'output/menu-icons');
const outDir = path.join(root, 'public/assets/icons/menu');
const NAMES = { about: 'about', news: 'news', help: 'help', feedback: 'feedback', settings: 'settings', admin: 'admin', mapstudio: 'map-studio', privacy: 'privacy', terms: 'terms' };
const SIZE = 96, PAD = 4;

async function keyed(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    // Magenta distance: high red and blue, low green.
    const pink = Math.min(r, b) - g;
    if (pink > 110) data[i + 3] = 0;
    else if (pink > 60) { data[i + 3] = Math.round(255 * (110 - pink) / 50); data[i] = Math.min(r, g + 40); data[i + 2] = Math.min(b, g + 40); }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function fit(file) {
  const trimmed = await sharp(await keyed(file)).trim({ threshold: 1 }).toBuffer();
  const inner = SIZE - PAD * 2;
  const body = await sharp(trimmed).resize(inner, inner, { fit: 'contain', kernel: 'lanczos3', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: body, left: PAD, top: PAD }]).png().toBuffer();
}

(async () => {
  const ready = Object.entries(NAMES).filter(([source]) => fs.existsSync(path.join(sourceDir, `${source}.png`)));
  if (!ready.length) throw new Error(`No icon renders in ${sourceDir}`);
  const icons = [];
  for (const [source, name] of ready) icons.push({ name, png: await fit(path.join(sourceDir, `${source}.png`)) });
  if (preview) {
    // Dark menu-coloured strip: each icon at 4x and at its 24px display size.
    const cell = 120, width = cell * icons.length;
    const composites = [];
    icons.forEach(({ png }, index) => {
      composites.push({ input: png, left: index * cell + 12, top: 12 });
      composites.push({ input: sharp(png).resize(24, 24).png().toBuffer(), left: index * cell + 48, top: 124 });
    });
    for (const item of composites) item.input = await item.input;
    const file = path.join(sourceDir, 'preview.png');
    await sharp({ create: { width, height: 164, channels: 4, background: '#152741' } }).composite(composites).png().toFile(file);
    console.log(file);
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const { name, png } of icons) {
    await sharp(png).webp({ lossless: true, effort: 6 }).toFile(path.join(outDir, `${name}.webp`));
    console.log(`installed ${name}.webp`);
  }
})().catch(error => { console.error(error.message); process.exit(1); });
