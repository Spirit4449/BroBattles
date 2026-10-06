// Imports Candy Land map art exported as full-canvas PNG layers. Only trims
// transparent margins, halves the resolution and converts to WebP; no repainting.
// Depth-of-field blur is applied in the game (scenery layer `blur`).
// Usage: node scripts/art/import-candyland.cjs [source dir]
// The source dir holds the exported folder layout ([Layer0]_Background.png,
// [Layer4]_Platforms/, [Layer5]_Clouds/ ...); default output/candyland-source.
// Prints each output's crop so map placement can be checked against the export,
// and flattens the backdrop layers into lobby-background.webp.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync: run } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const sources = path.resolve(process.argv[2] || path.join(root, 'output/candyland-source'));
const out = path.join(root, 'public/assets/candyland');
const SCALE = 0.5;
// Alpha at or below this is treated as empty when trimming (export haze).
const ALPHA_FLOOR = 40;

const jobs = [
  ['[Layer0]_Background.png', 'background'],
  ['[Layer1]_Peaks.png', 'peaks'],
  ['[Layer2]_MidgroundPeaks.png', 'midground-peaks'],
  ['[Layer3]_SideCandy_Left.png', 'side-candy-left'],
  ['[Layer3]_SideCandy_Right.png', 'side-candy-right'],
  ['[Layer4]_Platforms/base.png', 'platform-base'],
  ['[Layer4]_Platforms/tall-platform.png', 'platform-tall'],
  ['[Layer4]_Platforms/top-arch.png', 'platform-arch'],
  ['[Layer4]_Platforms/moving-platform.png', 'platform-moving'],
  ['[Layer6]_Top.png', 'frame-top'],
  ['[Layer6]_Bottom.png', 'frame-bottom'],
  ...Array.from({ length: 12 }, (_, i) => [`[Layer5]_Clouds/Layer ${i + 1}.png`, `cloud-${i + 1}`]),
];

const tmp = fs.mkdtempSync('/private/tmp/candyland-import-');
function read(file) {
  run('cwebp', ['-quiet', '-lossless', file, '-o', `${tmp}/input.webp`]);
  run('dwebp', ['-quiet', '-pam', `${tmp}/input.webp`, '-o', `${tmp}/input.pam`]);
  const b = fs.readFileSync(`${tmp}/input.pam`), end = b.indexOf('ENDHDR\n');
  const head = b.subarray(0, end).toString();
  return { w: +head.match(/WIDTH (\d+)/)[1], h: +head.match(/HEIGHT (\d+)/)[1], data: b.subarray(end + 7) };
}
function writeWebp({ w, h, data }, file) {
  const header = `P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`;
  fs.writeFileSync(`${tmp}/flat.pam`, Buffer.concat([Buffer.from(header), data]));
  run('cwebp', ['-quiet', '-q', '88', '-m', '6', `${tmp}/flat.pam`, '-o', file]);
}
// Source-over blend of `layer` onto `canvas` at (x, y).
function blend(canvas, layer, x, y) {
  for (let ly = 0; ly < layer.h; ly++) {
    const cy = y + ly;
    if (cy < 0 || cy >= canvas.h) continue;
    for (let lx = 0; lx < layer.w; lx++) {
      const cx = x + lx;
      if (cx < 0 || cx >= canvas.w) continue;
      const s = (ly * layer.w + lx) * 4, d = (cy * canvas.w + cx) * 4, a = layer.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) canvas.data[d + c] = Math.round(layer.data[s + c] * a + canvas.data[d + c] * (1 - a));
      canvas.data[d + 3] = 255;
    }
  }
}
// Backdrop layers share the exported frame, so their crops place them.
const LOBBY_LAYERS = ['background', 'peaks', 'midground-peaks', 'side-candy-left', 'side-candy-right', 'frame-top', 'frame-bottom'];

function opaqueBounds({ w, h, data }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] <= ALPHA_FLOOR) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('image is empty');
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

fs.mkdirSync(out, { recursive: true });
const crops = {};
try {
  for (const [source, name] of jobs) {
    const file = path.join(sources, source);
    const image = read(file);
    const crop = opaqueBounds(image);
    const width = Math.round(crop.w * SCALE), height = Math.round(crop.h * SCALE);
    run('cwebp', ['-quiet', '-q', '90', '-alpha_q', '100', '-m', '6',
      '-crop', String(crop.x), String(crop.y), String(crop.w), String(crop.h),
      '-resize', String(width), String(height), file, '-o', path.join(out, `${name}.webp`)]);
    crops[name] = crop;
    console.log(`${name}.webp ${width}x${height} from ${image.w}x${image.h} crop ${crop.x},${crop.y} ${crop.w}x${crop.h}`);
  }
  const frame = read(path.join(out, 'background.webp'));
  for (const name of LOBBY_LAYERS.slice(1)) {
    blend(frame, read(path.join(out, `${name}.webp`)), Math.round(crops[name].x * SCALE), Math.round(crops[name].y * SCALE));
  }
  writeWebp(frame, path.join(out, 'lobby-background.webp'));
  console.log(`lobby-background.webp ${frame.w}x${frame.h}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
