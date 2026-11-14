// Places the game's own currency artwork into a shop bundle banner, so a bundle
// that grants coins or gems visibly shows them (docs/art/shop-banners.md).
//
// Usage:
//   node scripts/art/compose-bundle-banner.cjs <banner.png|webp> <out.png> \
//     --art coins-stack --x 296 --floor 324 [--width 150]
//
// --art    public/assets/currency/<art>.webp. Pick the art the game shows for the
//          bundle's amount (see currencyRewardImage in src/client/views/rewardPresentation.js).
// --x      horizontal centre of the art, in banner pixels.
// --floor  y of the surface the art stands on, in banner pixels.
// --width  rendered width of the art (default 150).
// --light  optional scene lighting, "<#rrggbb>:<strength>:<brightness>", e.g.
//          "#3a1d5c:0.18:0.85" for a dim purple cave. Omit for daylight scenes.
// Keep the art inside the area every shop card shows (about x 230-795 of a
// 1024px banner) and away from the badge/info-button corners.
const path = require('node:path');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const root = path.resolve(__dirname, '../..');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function hexColor(hex) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

async function main() {
  const [banner, out] = process.argv.slice(2);
  const art = option('art');
  const centerX = Number(option('x'));
  const floor = Number(option('floor'));
  const width = Number(option('width', 150));
  const light = option('light');
  if (!banner || !out || !art || !Number.isFinite(centerX) || !Number.isFinite(floor)) {
    throw new Error('Usage: compose-bundle-banner.cjs <banner> <out.png> --art <name> --x <px> --floor <px> [--width <px>]');
  }
  const { width: bannerWidth, height: bannerHeight } = await sharp(banner).metadata();
  // Trim the art's transparent margin so --floor is where the coins actually sit.
  const trimmed = await sharp(path.join(root, 'public/assets/currency', `${art}.webp`)).trim().png().toBuffer();
  // Downscale smoothly to twice the size, then nearest-neighbour to the target:
  // edges come out crisp like the banner's own pixels instead of blurred.
  const doubled = await sharp(trimmed).resize({ width: width * 2, kernel: 'lanczos3' }).png().toBuffer();
  let scaled = await sharp(doubled).resize({ width, kernel: 'nearest' }).png().toBuffer();
  if (light) {
    // Match the scene: dim the art, then wash it with the ambient colour
    // (blend "atop" keeps the art's own transparency).
    const [color, strength, brightness] = light.split(':');
    const { width: w, height: h } = await sharp(scaled).metadata();
    const wash = await sharp({ create: { width: w, height: h, channels: 4, background: { ...hexColor(color), alpha: Number(strength) } } }).png().toBuffer();
    scaled = await sharp(scaled).linear([Number(brightness), Number(brightness), Number(brightness), 1], [0, 0, 0, 0]).composite([{ input: wash, blend: 'atop' }]).png().toBuffer();
  }
  const { height } = await sharp(scaled).metadata();
  const left = Math.round(centerX - width / 2);
  // The art's lowest pixels (loose coins) rest exactly on the floor line.
  const top = Math.round(floor - height);
  // Side-on scenes: a flat, blurred contact shadow hugging the floor line, a
  // little wider than the art, darkest right under it.
  const pad = 8;
  const shadowWidth = Math.round(width * 1.05) + pad * 2;
  const shadowHeight = Math.max(10, Math.round(width * 0.08)) + pad * 2;
  const shadow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${shadowWidth}" height="${shadowHeight}">
    <defs><filter id="b" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
    <ellipse cx="${shadowWidth / 2}" cy="${shadowHeight / 2}" rx="${shadowWidth / 2 - pad}" ry="${shadowHeight / 2 - pad}" fill="#000" fill-opacity="0.45" filter="url(#b)"/>
  </svg>`);
  await sharp(banner)
    .composite([
      { input: shadow, left: Math.round(centerX - shadowWidth / 2), top: Math.round(floor - shadowHeight / 2 - 1) },
      { input: scaled, left, top },
    ])
    .png()
    .toFile(out);
  console.log(`${path.basename(out)}: ${art} ${width}x${height} at x ${left}-${left + width}, floor ${floor} (${bannerWidth}x${bannerHeight})`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
