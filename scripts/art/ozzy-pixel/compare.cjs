#!/usr/bin/env node
// Onion-skin check against the legacy art: each legacy frame scaled to this
// art's size and aligned on the ground (left), the code frame (middle), and the
// two overlaid (right), so poses can be matched beat for beat.
//   node scripts/art/ozzy-pixel/compare.cjs <animation> [legacyPrefix]
//     -> output/ozzy-pixel/compare/<animation>.png (reads output/ozzy-pixel/rig/<animation>/)
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { CANVAS, SIZE } = require('./pose.cjs');

const ROOT = path.resolve(__dirname, '../../..');
// Legacy px per art px, and where the legacy idle's staff edge / ground land on the art.
const LEGACY_PER_ART = 1.52;
const LEGACY_ANCHOR = [82, 140]; const ART_ANCHOR = [12, 63.5];

async function main() {
  const [name, prefix = name] = process.argv.slice(2);
  const atlas = JSON.parse(fs.readFileSync(path.join(__dirname, 'legacy/animations.json'), 'utf8'));
  const legacy = atlas.frames.filter((f) => new RegExp(`^${prefix}\\d+$`).test(f.filename)).sort((a, b) => a.filename.localeCompare(b.filename));
  const dir = path.join(ROOT, 'output/ozzy-pixel/rig', name);
  const ours = fs.readdirSync(dir).filter((f) => new RegExp(`^${name}\\d+\\.png$`).test(f)).sort();
  const S = 4; const margin = (CANVAS - SIZE) / 2; const tiles = [];
  const n = Math.max(legacy.length, ours.length);
  for (let i = 0; i < n; i++) {
    let leg = null;
    if (legacy[i]) {
      const f = legacy[i].frame; const w = Math.round(f.w / LEGACY_PER_ART); const h = Math.round(f.h / LEGACY_PER_ART);
      const img = await sharp(path.join(__dirname, 'legacy/spritesheet.webp')).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
      const left = Math.round(margin + ART_ANCHOR[0] - LEGACY_ANCHOR[0] / LEGACY_PER_ART); const top = Math.round(margin + ART_ANCHOR[1] - LEGACY_ANCHOR[1] / LEGACY_PER_ART);
      const pad = 200;
      leg = await sharp({ create: { width: CANVAS + pad * 2, height: CANVAS + pad * 2, channels: 4, background: '#0000' } }).composite([{ input: img, left: left + pad, top: top + pad }]).png().toBuffer();
      leg = await sharp(leg).extract({ left: pad, top: pad, width: CANVAS, height: CANVAS }).png().toBuffer();
    }
    const our = ours[i] ? await sharp(path.join(dir, ours[i])).png().toBuffer() : null;
    const big = (b, opacity = 1) => sharp(b).resize(CANVAS * S, CANVAS * S, { kernel: 'nearest' }).ensureAlpha(opacity).png().toBuffer();
    const y = i * CANVAS * S;
    if (leg) tiles.push({ input: await big(leg), left: 0, top: y });
    if (our) tiles.push({ input: await big(our), left: CANVAS * S, top: y });
    if (leg) tiles.push({ input: await big(leg), left: CANVAS * S * 2, top: y });
    if (our) {
      const { data, info } = await sharp(await big(our)).raw().toBuffer({ resolveWithObject: true });
      for (let j = 3; j < data.length; j += 4) data[j] = data[j] ? 150 : 0;
      tiles.push({ input: await sharp(data, { raw: info }).png().toBuffer(), left: CANVAS * S * 2, top: y });
    }
  }
  const out = path.join(ROOT, 'output/ozzy-pixel/compare'); fs.mkdirSync(out, { recursive: true });
  await sharp({ create: { width: CANVAS * S * 3, height: CANVAS * S * n, channels: 4, background: '#8c8c96' } }).composite(tiles).png().toFile(path.join(out, `${name}.png`));
  console.log(`wrote output/ozzy-pixel/compare/${name}.png`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
