#!/usr/bin/env node
// Renders the code-defined Sparrow (parts.cjs) to pixels.
//   node scripts/art/sparrow-pixel/render.cjs            -> output/sparrow-pixel/
//   node scripts/art/sparrow-pixel/render.cjs --compare  also diffs against public/assets/sparrow/body.webp
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, PALETTE, PARTS } = require('./parts.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel');
const REFERENCE = path.join(ROOT, 'public/assets/sparrow/body.webp');
const BODY_SIZE = 1254;

const { createRig, mul, translate, rotateAbout, apply, IDENTITY } = require('../pixel-rig/rig.cjs');
const { compose, renderPose, patchHoles } = createRig({ SIZE, PALETTE, PARTS, outline: { k: '1', K: '2' }, newOutline: 'k' });

const raw = (data, size) => sharp(data, { raw: { width: size, height: size, channels: 4 } });

async function compare(bodyPx) {
  const { data: ref } = await sharp(REFERENCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let diff = 0;
  for (let i = 0; i < ref.length; i += 4) {
    if (ref[i + 3] !== bodyPx[i + 3] || (ref[i + 3] && (ref[i] !== bodyPx[i] || ref[i + 1] !== bodyPx[i + 1] || ref[i + 2] !== bodyPx[i + 2]))) diff++;
  }
  const total = ref.length / 4;
  console.log(`vs reference: ${total - diff}/${total} pixels identical (${(100 * (1 - diff / total)).toFixed(2)}%)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logical = compose();
  await raw(logical, SIZE).png().toFile(path.join(OUT_DIR, 'body-64.png'));
  const body = await raw(logical, SIZE).resize(BODY_SIZE, BODY_SIZE, { kernel: 'nearest' }).raw().toBuffer();
  await raw(body, BODY_SIZE).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'body.webp'));
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}/body.webp (${BODY_SIZE}x${BODY_SIZE}) and body-64.png`);
  if (process.argv.includes('--compare')) await compare(body);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { compose, renderPose, patchHoles, mul, translate, rotateAbout, apply, IDENTITY };
