#!/usr/bin/env node
// Fit the Codex-painted platform concepts in scripts/art/platform-concepts/ to
// the installed texture sizes, ready for pixelate-map-platforms.cjs.
// - Mangrove: one painting of the whole assembled ground, clipped to the
//   original silhouette and sliced back into its four tiles so seams line up.
// - Serenity: each redesign is keyed, then stretched so its walkable surface
//   row and bottom land on the original's, keeping collision unchanged.
// Output: scripts/art/mangrove-repaint/ and scripts/art/serenity-redesign/.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const ART = __dirname;
const SRC = path.join(ART, 'platform-concepts');

const raw = async (input) => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
const toWebp = (img, file) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
  .webp({ lossless: true }).toFile(file);

// Flat #FF00FF background and its anti-aliased fringe become transparent.
function keyMagenta(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const m = Math.min(r, b) - g;
    if (m > 90) d[i + 3] = 0;
    else if (m > 45) { d[i + 3] = Math.round(255 * (90 - m) / 45); d[i] = d[i + 2] = Math.min(r, b, g + 45); }
  }
  return img;
}

function bounds(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// First row (from the top) where the art covers most of its own width:
// the walkable surface, below any flowers, lanterns or posts.
function surfaceRow(img, b) {
  const w = b.x1 - b.x0 + 1;
  for (let y = b.y0; y <= b.y1; y++) {
    let n = 0;
    for (let x = b.x0; x <= b.x1; x++) if (img.data[(y * img.width + x) * 4 + 3] >= 128) n++;
    if (n >= w * 0.6) return y;
  }
  return b.y0;
}

async function mangrove() {
  const out = path.join(ART, 'mangrove-repaint');
  fs.mkdirSync(out, { recursive: true });
  const { W, H, items } = JSON.parse(fs.readFileSync(path.join(SRC, 'mangrove-layout.json'), 'utf8'));
  const paint = await raw(await sharp(path.join(SRC, 'mangrove-ground.png')).resize(W, H, { fit: 'fill' }).png().toBuffer());
  for (const it of items) {
    const orig = await raw(path.join(ART, 'mangrove-originals', `${it.n}.webp`));
    const img = { width: it.w, height: it.h, data: Buffer.alloc(it.w * it.h * 4) };
    for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
      const o = (y * it.w + x) * 4;
      const a = orig.data[o + 3];
      if (!a) continue;
      const px = Math.min(W - 1, x + it.l), py = Math.min(H - 1, y + it.t);
      const p = (py * W + px) * 4;
      let r = paint.data[p], g = paint.data[p + 1], b = paint.data[p + 2];
      // Where the painting left background inside the silhouette, use soil,
      // except near the top, where it means the grass sits a little lower.
      // Near the top, also drop the magenta fringe left by anti-aliasing.
      if (y < 40 && Math.min(r, b) - g > 15) continue;
      if (Math.min(r, b) - g > 45) {
        r = 120; g = 72; b = 38;
      }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
    }
    await toWebp(img, path.join(out, `${it.n}.webp`));
    console.log(`mangrove/${it.n} ${it.w}x${it.h}`);
  }
  await fitBySurface(path.join(ART, 'mangrove-originals', 'lobbyPlatform.webp'),
    path.join(SRC, 'mangrove-small.png'), path.join(out, 'lobbyPlatform.webp'), 'mangrove/lobbyPlatform', 104); // walk line at body.offsetY 110
}

// surfaceY overrides the original's surface row, for art whose old top was
// drawn in perspective above its collision line.
async function fitBySurface(origFile, genFile, outFile, label, surfaceY) {
  const orig = await raw(origFile);
  const ob = bounds(orig), os = surfaceY ?? surfaceRow(orig, ob);
  const gen = keyMagenta(await raw(genFile));
  const gb = bounds(gen), gs = surfaceRow(gen, gb);
  // Vertical map: generated surface -> original surface, bottom -> bottom.
  const sy = (ob.y1 - os) / Math.max(1, gb.y1 - gs);
  const top = Math.round(os - (gs - gb.y0) * sy);
  const cropH = gb.y1 - gb.y0 + 1, cropW = gb.x1 - gb.x0 + 1;
  const tw = ob.x1 - ob.x0 + 1, th = Math.max(1, Math.round(cropH * sy));
  const scaled = await sharp(gen.data, { raw: { width: gen.width, height: gen.height, channels: 4 } })
    .extract({ left: gb.x0, top: gb.y0, width: cropW, height: cropH })
    .resize(tw, th, { fit: 'fill' }).png().toBuffer();
  // Clip anything that would rise above or fall below the texture.
  const clipTop = Math.max(0, -top), y = Math.max(0, top);
  const h = Math.min(th - clipTop, orig.height - y);
  const piece = await sharp(scaled).extract({ left: 0, top: clipTop, width: tw, height: h }).png().toBuffer();
  await sharp({ create: { width: orig.width, height: orig.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: piece, left: ob.x0, top: y }])
    .webp({ lossless: true }).toFile(outFile);
  console.log(`${label} ${orig.width}x${orig.height} surface ${os} (gen ${gs})`);
}

async function serenity() {
  const out = path.join(ART, 'serenity-redesign');
  fs.mkdirSync(out, { recursive: true });
  for (const n of ['largePlatform', 'sidePlatform', 'smallRock', 'logPlatform', 'lobbyPlatform']) {
    await fitBySurface(path.join(ART, 'serenity-originals', `${n}.webp`),
      path.join(SRC, `serenity-${n}.png`), path.join(out, `${n}.webp`), `serenity/${n}`);
  }
}

(async () => { await mangrove(); await serenity(); })().catch((e) => { console.error(e); process.exit(1); });
