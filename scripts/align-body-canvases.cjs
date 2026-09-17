// Standardize portrait canvases without changing relative character sizes.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../spritesheet-generator/node_modules/sharp');
const catalog = require('../src/shared/skinsCatalog.json');
const SIZE = 1254;
const root = path.resolve(__dirname, '..');

async function main() {
  const out = path.join(root, 'output/body-alignment');
  await fs.mkdir(path.join(out, 'before'), { recursive: true });
  const report = [], tiles = [];
  for (const character of Object.values(catalog.characters)) for (const skin of character.skins) {
    const target = path.join(root, 'public', skin.assetUrl);
    const original = await fs.readFile(target);
    const backup = path.join(out, 'before', `${skin.id}.webp`);
    try { await fs.writeFile(backup, original, { flag: 'wx' }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const metadata = await sharp(original).metadata();
    const { data, info } = await sharp(original).ensureAlpha()
      .resize(SIZE, SIZE, { fit: 'contain', kernel: 'nearest', background: '#00000000' })
      .raw().toBuffer({ resolveWithObject: true });
    let bottom = -1;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Generated files contain nearly invisible alpha flecks in their padding.
      // Clear those so they cannot prevent the visible feet/hem reaching ground.
      if (data[i + 3] < 128) data.fill(0, i, i + 4);
      else bottom = y;
    }
    if (bottom < 0) throw new Error(`Empty body: ${skin.id}`);
    const shift = SIZE - 1 - bottom;
    const aligned = Buffer.alloc(data.length);
    data.copy(aligned, shift * SIZE * 4, 0, (bottom + 1) * SIZE * 4);
    const output = await sharp(aligned, { raw: info }).webp({ lossless: true, exact: true }).toBuffer();
    await fs.writeFile(target, output);
    const label = Buffer.from(`<svg width="240" height="30"><text x="120" y="21" text-anchor="middle" fill="white" font-family="sans-serif" font-size="12">${skin.id}</text></svg>`);
    const tile = await sharp(output).resize(240, 240, { kernel: 'nearest' }).flatten({ background: '#202335' })
      .extend({ top: 0, left: 0, right: 0, bottom: 30, background: '#444b60' })
      .composite([{ input: label, top: 240, left: 0 }]).png().toBuffer();
    const n = tiles.length;
    tiles.push({ input: tile, left: n % 5 * 240, top: Math.floor(n / 5) * 270 });
    report.push({ id: skin.id, path: skin.assetUrl, before: [metadata.width, metadata.height], after: [SIZE, SIZE], downwardShift: shift, bottomRow: SIZE - 1 });
  }
  await sharp({ create: { width: 1200, height: Math.ceil(tiles.length / 5) * 270, channels: 3, background: '#202335' } })
    .composite(tiles).png().toFile(path.join(out, 'lineup.png'));
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
