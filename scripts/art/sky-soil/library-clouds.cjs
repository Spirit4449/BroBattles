#!/usr/bin/env node
// Redraws the shared scenery cloud library (public/assets/clouds/cloud-1..12)
// as pixel cumulus in the Sky Soil style: puffy lobes with a lit upper-right
// crescent and teal-tinted shade, cream highlights, flat bases and wind tails.
//
//   node scripts/art/sky-soil/library-clouds.cjs [--out <dir>] [--install]
//
// Each replacement keeps its original's size so maps that place these clouds
// keep their layout. Clouds are drawn on a 4 px grid.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { Canvas, cumulus, CLOUD, rng } = require('./pixel-kit.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(ROOT, 'output/sky-soil-clouds'));
const INSTALL = argv.includes('--install');
const PX = 4;

// [original width, height, shape]: 'heap' is one tall mass, 'bank' a long low
// row of lobes, 'tail' trails a wind streak off one side.
const SHAPES = {
  1: [663, 232, 'tail'], 2: [599, 181, 'heap'], 3: [400, 168, 'bank'], 4: [229, 69, 'heap'],
  5: [233, 70, 'heap'], 6: [499, 149, 'tail'], 7: [524, 129, 'heap'], 8: [276, 66, 'heap'],
  9: [339, 81, 'heap'], 10: [542, 127, 'bank'], 11: [418, 81, 'tail'], 12: [565, 136, 'bank'],
};

function drawAt(id, [w0, h0, shape], k) {
  const w = Math.round(w0 / PX), h = Math.round(h0 / PX), cv = new Canvas(w, h * 3), r = rng(id * 97);
  const base = h * 3 - 2;
  // cumulus() domes reach ~1.25x its height above the base and its end lobes
  // overhang the width by ~0.45x height, so size each mass to fit the frame.
  const fit = (cx, width, height) => {
    const hp = Math.min(height, (h - 3) / 1.25) * k;
    const wp = Math.max(hp, width - hp * 0.9 - 2) * k;
    return [cx, base, Math.round(wp), Math.round(hp)];
  };
  if (shape === 'heap') {
    cumulus(cv, id * 13, ...fit(Math.round(w * 0.5), w, h), CLOUD);
  } else if (shape === 'bank') {
    const n = Math.max(2, Math.round(w / (h * 2.2)));
    for (let k = 0; k < n; k++) {
      const span = w / n, cx = Math.round(span * (k + 0.5));
      cumulus(cv, id * 13 + k, ...fit(cx, span * 1.25, (h - 3) / 1.25 * (k % 2 ? 0.7 : 1)), CLOUD);
    }
  } else {
    const left = r() < 0.5;
    const mass = Math.round(w * 0.58);
    cumulus(cv, id * 13, ...fit(left ? w - Math.round(mass / 2) - 1 : Math.round(mass / 2) + 1, mass, h), CLOUD);
    // Wind tail: tapered streaks off the trailing side.
    for (let row = 0; row < 3; row++) {
      const y = base - row * 2 - 1, len = Math.round(w * (0.5 - row * 0.12));
      for (let i = 0; i < len; i++) {
        const x = left ? w - mass + 4 - i : mass - 4 + i;
        if (x < 1 || x >= w - 1 || cv.alpha(x, y)) continue;
        cv.set(x, y, row === 0 ? CLOUD.shade : i > len * 0.7 ? CLOUD.mid : CLOUD.light);
        if (row === 0 && i < len * 0.6) cv.set(x, y + 1, CLOUD.deep);
      }
    }
  }
  return cv;
}

// Shrink until the whole silhouette fits the original frame, then crop to it.
function draw(id, spec) {
  const w = Math.round(spec[0] / PX), h = Math.round(spec[1] / PX);
  for (let k = 1; k > 0.4; k -= 0.04) {
    const cv = drawAt(id, spec, k);
    let top = cv.h, left = w, right = -1;
    for (let y = 0; y < cv.h; y++) for (let x = 0; x < w; x++) if (cv.alpha(x, y)) { top = Math.min(top, y); left = Math.min(left, x); right = Math.max(right, x); }
    if (cv.h - top > h - 1 || left < 1 || right > w - 2) continue;
    const out = new Canvas(w, h);
    out.d.set(cv.d.subarray((cv.h - h) * w * 4));
    return out;
  }
  throw new Error('cloud ' + id + ' does not fit');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [id, spec] of Object.entries(SHAPES)) {
    const cv = draw(Number(id), spec);
    await sharp(Buffer.from(cv.d.buffer), { raw: { width: cv.w, height: cv.h, channels: 4 } })
      .resize(cv.w * PX, cv.h * PX, { kernel: 'nearest' }).png({ compressionLevel: 9 })
      .toFile(path.join(OUT, `cloud-${id}.png`));
  }
  console.log('wrote', OUT);
  if (!INSTALL) return;
  for (const id of Object.keys(SHAPES)) fs.copyFileSync(path.join(OUT, `cloud-${id}.png`), path.join(ROOT, 'public/assets/clouds', `cloud-${id}.png`));
  console.log('installed into public/assets/clouds');
})().catch(e => { console.error(e); process.exit(1); });
