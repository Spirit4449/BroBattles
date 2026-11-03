// Enlarge medium art masters exactly 2x without changing their pixels or palette.
// Usage: node scripts/art/install-shop-banner-art.cjs <directory-of-named-pngs>
// Masters must be half the installed dimensions listed below.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const root = path.resolve(__dirname, '../..');
const banners = {
  'daily-coins-scene': [2048, 768],
  'daily-gems-scene': [2048, 768],
  'coin-satchel-scene': [1536, 1024],
  'gem-pouch-scene': [1536, 1024],
  'gem-cache-scene': [1536, 1024],
  'gem-vault-scene': [1536, 1024],
  'ironbound-scene': [1536, 1024],
  'ironbound-arsenal-scene': [2048, 768],
};

async function main() {
  if (!process.argv[2]) throw new Error('Provide a directory of named banner PNGs.');
  const source = path.resolve(process.argv[2]);
  // Check the complete input set before replacing installed assets.
  for (const [name, [width, height]] of Object.entries(banners)) {
    const input = path.join(source, `${name}.png`);
    await fs.access(input);
    const metadata = await sharp(input).metadata();
    if (metadata.width !== width / 2 || metadata.height !== height / 2) {
      throw new Error(`${name} master must be ${width / 2}x${height / 2}.`);
    }
  }
  for (const [name, [width, height]] of Object.entries(banners)) {
    await sharp(path.join(source, `${name}.png`))
      .resize(width, height, { kernel: 'nearest' })
      .webp({ lossless: true, effort: 6 })
      .toFile(path.join(root, 'public/assets/shop/banners', `${name}.webp`));
    console.log(`${name}: ${width}x${height}, 2x nearest-neighbor, original palette`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
