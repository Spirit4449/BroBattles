// Install native-resolution medium masters without changing pixels or palette.
// Usage: node scripts/art/install-shop-banner-art.cjs <directory-of-named-pngs>
// CSS scales these native masters with nearest-neighbor rendering.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const root = path.resolve(__dirname, '../..');
const banners = {
  'daily-coins-scene': [1024, 384],
  'daily-gems-scene': [1024, 384],
  'coin-satchel-scene': [768, 512],
  'gem-pouch-scene': [768, 512],
  'gem-cache-scene': [768, 512],
  'gem-vault-scene': [768, 512],
};

async function main() {
  if (!process.argv[2]) throw new Error('Provide a directory of named banner PNGs.');
  const source = path.resolve(process.argv[2]);
  // Check the complete input set before replacing installed assets.
  for (const [name, [width, height]] of Object.entries(banners)) {
    const input = path.join(source, `${name}.png`);
    await fs.access(input);
    const metadata = await sharp(input).metadata();
    if (metadata.width !== width || metadata.height !== height) {
      throw new Error(`${name} master must be ${width}x${height}.`);
    }
  }
  for (const [name, [width, height]] of Object.entries(banners)) {
    await sharp(path.join(source, `${name}.png`))
      .webp({ lossless: true, effort: 6 })
      .toFile(path.join(root, 'public/assets/shop/banners', `${name}.webp`));
    console.log(`${name}: ${width}x${height}, native resolution, original palette`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
